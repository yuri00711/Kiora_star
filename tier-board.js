(async function () {
    "use strict";

    const db = window.yuriArticles.getClient();
    const auth = window.KioraAuth;
    const statusLine = document.getElementById("tier-status");
    const boardRoot = document.getElementById("tier-board");
    let games = [];
    let boards = [];
    let sections = [];
    let items = [];
    let activeBoard = null;
    let isAdmin = false;
    let showNamesInExport = true;

    const safe = window.yuriArticles.safeUrl;
    const byOrder = (a, b) => (a.sort_order ?? 999999) - (b.sort_order ?? 999999) || String(a.id).localeCompare(String(b.id));
    const gameById = (id) => games.find((game) => String(game.id) === String(id));

    async function loadAll() {
        const params = new URLSearchParams(location.search);
        const [gamesResult, boardsResult] = await Promise.all([
            db.from("games").select("id,title,cover_url,sort_order").order("sort_order", { ascending: true, nullsFirst: false }),
            db.from("tier_boards").select("id,title,description,sort_order,created_at,updated_at").order("sort_order", { ascending: true, nullsFirst: false }),
            auth.initialize(db)
        ]);
        isAdmin = auth.can("tier-board:create") || auth.can("tier-board:edit");
        if (boardsResult.error) {
            statusLine.textContent = boardsResult.error.message.includes("tier_boards")
                ? "ティア表はまだ有効になっていません。先に supabase-games-migration.sql を実行してください。"
                : `ティア表を読み込めません：${boardsResult.error.message}`;
            return;
        }
        games = gamesResult.data || [];
        boards = (boardsResult.data || []).sort(byOrder);
        const requested = params.get("id");
        activeBoard = boards.find((board) => String(board.id) === requested) || boards[0] || null;
        renderAdminHeader();
        renderTabs();
        if (activeBoard) await loadBoard(activeBoard.id);
        else {
            statusLine.textContent = isAdmin ? "最初のボードを作って、ゲームを並べましょう。" : "公開されているティア表はまだありません。";
            boardRoot.hidden = true;
        }
    }

    async function loadBoard(boardId) {
        const [sectionResult, itemResult] = await Promise.all([
            db.from("tier_sections").select("id,board_id,title,description,sort_order,created_at,updated_at").eq("board_id", boardId).order("sort_order", { ascending: true, nullsFirst: false }),
            db.from("tier_items").select("id,board_id,section_id,game_id,sort_order,created_at,updated_at").eq("board_id", boardId).order("sort_order", { ascending: true, nullsFirst: false })
        ]);
        if (sectionResult.error || itemResult.error) {
            statusLine.textContent = sectionResult.error?.message || itemResult.error?.message;
            return;
        }
        sections = (sectionResult.data || []).sort(byOrder);
        items = (itemResult.data || []).sort(byOrder);
        renderBoard();
    }

    function renderAdminHeader() {
        const root = document.getElementById("tier-admin-actions");
        root.replaceChildren();
        if (!isAdmin) return;
        const add = document.createElement("button");
        add.type = "button";
        add.textContent = "＋ 新しいボード";
        add.addEventListener("click", createBoard);
        root.append(add);
    }

    function renderTabs() {
        const root = document.getElementById("board-tabs");
        root.replaceChildren();
        boards.forEach((board, index) => {
            const button = document.createElement("button");
            button.type = "button";
            button.setAttribute("aria-current", board === activeBoard ? "page" : "false");
            button.innerHTML = `<span>${String(index + 1).padStart(2, "0")}</span>${escapeText(board.title)}`;
            button.addEventListener("click", async () => {
                activeBoard = board;
                history.replaceState(history.state, "", `?id=${encodeURIComponent(board.id)}`);
                renderTabs();
                await loadBoard(board.id);
            });
            root.append(button);
        });
    }

    function escapeText(value) {
        return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
    }

    function button(text, handler, className = "") {
        const element = document.createElement("button");
        element.type = "button";
        element.textContent = text;
        element.className = className;
        element.addEventListener("click", handler);
        return element;
    }

    function renderBoard() {
        statusLine.hidden = true;
        boardRoot.hidden = false;
        document.getElementById("board-title").textContent = activeBoard.title;
        const description = document.getElementById("board-description");
        description.textContent = activeBoard.description || "";
        description.hidden = !activeBoard.description;
        renderBoardActions();

        const root = document.getElementById("tier-sections");
        root.replaceChildren();
        sections.forEach((section, index) => root.append(createTier(section, index)));
        if (!sections.length) {
            const empty = document.createElement("p");
            empty.className = "tier-empty";
            empty.textContent = isAdmin ? "段を追加して、このボードを始めましょう。" : "このボードにはまだ段がありません。";
            root.append(empty);
        }
        renderUnassigned();
        installDragTargets();
    }

    function renderBoardActions() {
        const root = document.getElementById("board-editor-actions");
        root.replaceChildren();
        if (!isAdmin) return;
        root.append(
            button("ボードを編集", editBoard),
            button("＋ 段を追加", createTierSection),
            button("画像を書き出す", openExportDialog, "export-button")
        );
        if (auth.role === "owner") root.append(button("ボードを削除", deleteBoard, "danger-button"));
    }

    function createTier(section, index) {
        const article = document.createElement("section");
        article.className = "tier-section";
        article.dataset.sectionId = section.id;
        const heading = document.createElement("header");
        const copy = document.createElement("div");
        const number = document.createElement("p"); number.textContent = `ティア ${String(index + 1).padStart(2, "0")}`;
        const title = document.createElement("h3"); title.textContent = section.title;
        const description = document.createElement("span"); description.textContent = section.description || ""; description.hidden = !section.description;
        copy.append(number, title, description);
        heading.append(copy);
        if (isAdmin) {
            const controls = document.createElement("div");
            controls.className = "tier-controls";
            const handle = button("↕", () => {}, "tier-drag-handle");
            handle.setAttribute("aria-label", "段を移動");
            handle.dataset.dragKind = "tier";
            handle.dataset.dragId = section.id;
            controls.append(
                handle,
                button("↑", () => shiftTier(section.id, -1), "tier-order-button"),
                button("↓", () => shiftTier(section.id, 1), "tier-order-button"),
                button("編集", () => editTier(section))
            );
            if (auth.role === "owner") controls.append(button("×", () => deleteTier(section), "danger-button"));
            heading.append(controls);
        }
        const dropzone = document.createElement("div");
        dropzone.className = "tier-dropzone";
        dropzone.dataset.sectionId = section.id;
        items.filter((item) => String(item.section_id) === String(section.id)).sort(byOrder).forEach((item) => {
            const game = gameById(item.game_id);
            if (game) dropzone.append(createGameTile(game, item));
        });
        if (!dropzone.children.length) {
            const empty = document.createElement("p"); empty.className = "drop-hint"; empty.textContent = isAdmin ? "ここにゲームを置く" : "—"; dropzone.append(empty);
        }
        article.append(heading, dropzone);
        return article;
    }

    function createGameTile(game, item = null) {
        const tile = document.createElement(isAdmin ? "div" : "a");
        tile.className = `tier-game${item ? " assigned" : " unassigned-game"}`;
        if (!isAdmin) tile.href = `game.html?id=${encodeURIComponent(game.id)}`;
        tile.dataset.gameId = game.id;
        if (item) tile.dataset.itemId = item.id;
        const cover = document.createElement("div");
        cover.className = "tier-game-cover";
        const url = safe(game.cover_url);
        if (url) {
            const image = document.createElement("img"); image.src = url; image.alt = ""; image.loading = "lazy";
            image.addEventListener("error", () => cover.replaceChildren("✦"), { once: true });
            cover.append(image);
        } else cover.textContent = "✦";
        const name = document.createElement("p"); name.textContent = game.title || "タイトル未設定";
        tile.append(cover, name);
        if (isAdmin) {
            const handle = button("⋮⋮", () => {}, "game-drag-handle");
            handle.setAttribute("aria-label", `${game.title || "ゲーム"}を移動`);
            handle.dataset.dragKind = "game";
            handle.dataset.dragId = game.id;
            tile.append(handle);
            if (item) {
                if (auth.role === "owner") tile.append(button("×", () => removeGame(item), "remove-game"));
            } else if (sections.length) {
                tile.append(button("＋", () => moveGame(game.id, sections[0].id), "quick-add-game"));
            }
        }
        return tile;
    }

    function renderUnassigned() {
        const section = document.getElementById("unassigned-section");
        if (!isAdmin) { section.hidden = true; return; }
        section.hidden = false;
        const assigned = new Set(items.map((item) => String(item.game_id)));
        const unassigned = games.filter((game) => !assigned.has(String(game.id)));
        const root = document.getElementById("unassigned-games");
        root.replaceChildren(...unassigned.map((game) => createGameTile(game)));
        if (!unassigned.length) {
            const empty = document.createElement("p"); empty.className = "drop-hint"; empty.textContent = "すべてのゲームを分類しました"; root.append(empty);
        }
    }

    async function createBoard() {
        const title = prompt("ティアボードのタイトル");
        if (!title?.trim()) return;
        const description = prompt("説明（任意）") || null;
        const payload = { title: title.trim(), description, sort_order: boards.length };
        const { data, error } = await auth.write("tier_board_create", payload, () => db.from("tier_boards").insert(payload).select("id,title,description,sort_order,created_at,updated_at").single());
        if (error) return alert(`作成できませんでした：${error.message}`);
        boards.push(data); activeBoard = data; sections = []; items = [];
        history.replaceState(history.state, "", `?id=${encodeURIComponent(data.id)}`);
        renderTabs(); renderBoard();
    }

    async function editBoard() {
        const title = prompt("ティアボードのタイトル", activeBoard.title);
        if (!title?.trim()) return;
        const description = prompt("説明（任意）", activeBoard.description || "") || null;
        const payload = { id: activeBoard.id, title: title.trim(), description };
        const { error } = await auth.write("tier_board_update", payload, () => db.from("tier_boards").update({ title: payload.title, description }).eq("id", activeBoard.id));
        if (error) return alert(`保存できませんでした：${error.message}`);
        Object.assign(activeBoard, { title: title.trim(), description }); renderTabs(); renderBoard();
    }

    async function deleteBoard() {
        if (auth.role !== "owner") return;
        if (!confirm(`「${activeBoard.title}」と中の段をすべて削除しますか？`)) return;
        const { error } = await db.from("tier_boards").delete().eq("id", activeBoard.id);
        if (error) return alert(`削除できませんでした：${error.message}`);
        boards = boards.filter((board) => board !== activeBoard); activeBoard = boards[0] || null; renderTabs();
        if (activeBoard) await loadBoard(activeBoard.id); else { boardRoot.hidden = true; statusLine.hidden = false; statusLine.textContent = "最初のボードを作って、ゲームを並べましょう。"; }
    }

    async function createTierSection() {
        const title = prompt("段のタイトル");
        if (!title?.trim()) return;
        const description = prompt("段の説明（任意）") || null;
        const payload = { board_id: activeBoard.id, title: title.trim(), description, sort_order: sections.length };
        const { data, error } = await auth.write("tier_section_create", payload, () => db.from("tier_sections").insert(payload).select("id,board_id,title,description,sort_order,created_at,updated_at").single());
        if (error) return alert(`作成できませんでした：${error.message}`);
        sections.push(data); renderBoard();
    }

    async function editTier(section) {
        const title = prompt("段のタイトル", section.title);
        if (!title?.trim()) return;
        const description = prompt("段の説明（任意）", section.description || "") || null;
        const payload = { id: section.id, title: title.trim(), description };
        const { error } = await auth.write("tier_section_update", payload, () => db.from("tier_sections").update({ title: payload.title, description }).eq("id", section.id));
        if (error) return alert(`保存できませんでした：${error.message}`);
        Object.assign(section, { title: title.trim(), description }); renderBoard();
    }

    async function deleteTier(section) {
        if (auth.role !== "owner") return;
        if (!confirm(`段「${section.title}」を削除しますか？ゲームは未分類へ戻ります。`)) return;
        const { error } = await db.from("tier_sections").delete().eq("id", section.id);
        if (error) return alert(`削除できませんでした：${error.message}`);
        sections = sections.filter((item) => item !== section);
        items = items.filter((item) => String(item.section_id) !== String(section.id));
        await persistTierOrder(); renderBoard();
    }

    async function shiftTier(id, delta) {
        const index = sections.findIndex((section) => String(section.id) === String(id));
        const target = index + delta;
        if (index < 0 || target < 0 || target >= sections.length) return;
        [sections[index], sections[target]] = [sections[target], sections[index]];
        await persistTierOrder(); renderBoard();
    }

    async function reorderTier(sourceId, targetId) {
        const from = sections.findIndex((section) => String(section.id) === String(sourceId));
        const to = sections.findIndex((section) => String(section.id) === String(targetId));
        if (from < 0 || to < 0 || from === to) return;
        const [moved] = sections.splice(from, 1); sections.splice(to, 0, moved);
        await persistTierOrder(); renderBoard();
    }

    async function persistTierOrder() {
        const order = sections.map((section, index) => ({ id: section.id, sort_order: index }));
        const result = await auth.write("tier_sections_reorder", { items: order }, () => Promise.all(order.map((entry) => db.from("tier_sections").update({ sort_order: entry.sort_order }).eq("id", entry.id))).then((results) => ({ data: null, error: results.find((entry) => entry.error)?.error || null })));
        const failed = result.error ? { error: result.error } : null;
        if (failed) alert(`並べ替えに失敗しました：${failed.error.message}`);
        sections.forEach((section, index) => { section.sort_order = index; });
    }

    async function moveGame(gameId, sectionId, beforeGameId = null) {
        const existing = items.find((item) => String(item.game_id) === String(gameId));
        const sectionItems = items.filter((item) => String(item.section_id) === String(sectionId) && String(item.game_id) !== String(gameId)).sort(byOrder);
        const beforeIndex = beforeGameId === null ? -1 : sectionItems.findIndex((item) => String(item.game_id) === String(beforeGameId));
        const nextOrder = beforeIndex < 0 ? sectionItems.length : beforeIndex;
        let result;
        if (existing) {
            result = await auth.write("tier_item_move", { id: existing.id, section_id: sectionId, sort_order: nextOrder }, () => db.from("tier_items").update({ section_id: sectionId, sort_order: nextOrder }).eq("id", existing.id));
            if (!result.error) Object.assign(existing, { section_id: sectionId, sort_order: nextOrder });
        } else {
            const payload = { board_id: activeBoard.id, section_id: sectionId, game_id: gameId, sort_order: nextOrder };
            result = await auth.write("tier_item_move", payload, () => db.from("tier_items").insert(payload).select("id,board_id,section_id,game_id,sort_order,created_at,updated_at").single());
            if (!result.error) items.push(result.data);
        }
        if (result.error) return alert(`移動できませんでした：${result.error.message}`);
        const moved = items.find((item) => String(item.game_id) === String(gameId));
        const arranged = items.filter((item) => String(item.section_id) === String(sectionId) && item !== moved).sort(byOrder);
        arranged.splice(beforeIndex < 0 ? arranged.length : beforeIndex, 0, moved);
        arranged.forEach((item, index) => { item.sort_order = index; });
        await normalizeItemOrders(); renderBoard();
    }

    async function removeGame(item) {
        if (auth.role !== "owner") return;
        const { error } = await db.from("tier_items").delete().eq("id", item.id);
        if (error) return alert(`取り外せませんでした：${error.message}`);
        items = items.filter((entry) => entry !== item); await normalizeItemOrders(); renderBoard();
    }

    async function normalizeItemOrders() {
        const updates = [];
        sections.forEach((section) => {
            items.filter((item) => String(item.section_id) === String(section.id)).sort(byOrder).forEach((item, index) => {
                item.sort_order = index;
                updates.push({ id: item.id, sort_order: index });
            });
        });
        const result = await auth.write("tier_items_reorder", { items: updates }, () => Promise.all(updates.map((entry) => db.from("tier_items").update({ sort_order: entry.sort_order }).eq("id", entry.id))).then((results) => ({ data: null, error: results.find((entry) => entry.error)?.error || null })));
        const failed = result.error ? { error: result.error } : null;
        if (failed) alert(`並べ替えに失敗しました：${failed.error.message}`);
    }

    function installDragTargets() {
        if (!isAdmin) return;
        document.querySelectorAll(".tier-game").forEach((tile) => {
            tile.draggable = true;
            tile.addEventListener("dragstart", (event) => {
                event.dataTransfer.setData("text/kiora-game", tile.dataset.gameId);
                event.dataTransfer.effectAllowed = "move";
            });
            tile.addEventListener("dragover", (event) => { event.preventDefault(); tile.classList.add("drag-before"); });
            tile.addEventListener("dragleave", () => tile.classList.remove("drag-before"));
            tile.addEventListener("drop", (event) => {
                event.preventDefault(); event.stopPropagation(); tile.classList.remove("drag-before");
                const id = event.dataTransfer.getData("text/kiora-game");
                const zone = tile.closest(".tier-dropzone");
                if (id && zone && String(id) !== String(tile.dataset.gameId)) moveGame(id, zone.dataset.sectionId, tile.dataset.gameId);
            });
        });
        document.querySelectorAll(".tier-dropzone").forEach((zone) => {
            zone.addEventListener("dragover", (event) => { event.preventDefault(); zone.classList.add("drag-over"); });
            zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
            zone.addEventListener("drop", (event) => { event.preventDefault(); zone.classList.remove("drag-over"); const id = event.dataTransfer.getData("text/kiora-game"); if (id) moveGame(id, zone.dataset.sectionId); });
        });
        document.querySelectorAll(".tier-section").forEach((tier) => {
            tier.draggable = true;
            tier.addEventListener("dragstart", (event) => {
                if (event.target.closest(".tier-game")) return;
                if (!event.target.closest(".tier-drag-handle")) { event.preventDefault(); return; }
                event.dataTransfer.setData("text/kiora-tier", tier.dataset.sectionId);
                event.dataTransfer.effectAllowed = "move";
            });
            tier.addEventListener("dragover", (event) => {
                if (Array.from(event.dataTransfer.types).includes("text/kiora-tier")) { event.preventDefault(); tier.classList.add("drag-target"); }
            });
            tier.addEventListener("dragleave", () => tier.classList.remove("drag-target"));
            tier.addEventListener("drop", (event) => {
                const id = event.dataTransfer.getData("text/kiora-tier");
                if (!id) return;
                event.preventDefault(); tier.classList.remove("drag-target"); reorderTier(id, tier.dataset.sectionId);
            });
        });
        installPointerDrag();
    }

    function installPointerDrag() {
        document.querySelectorAll("[data-drag-kind]").forEach((handle) => {
            handle.onpointerdown = (event) => {
                if (event.pointerType === "mouse") return;
                const kind = handle.dataset.dragKind;
                const id = handle.dataset.dragId;
                const source = handle.closest(kind === "game" ? ".tier-game" : ".tier-section");
                const ghost = source.cloneNode(true);
                ghost.className = "drag-ghost";
                ghost.style.width = `${source.getBoundingClientRect().width}px`;
                document.body.append(ghost);
                const move = (pointerEvent) => {
                    pointerEvent.preventDefault();
                    ghost.style.transform = `translate3d(${pointerEvent.clientX + 12}px, ${pointerEvent.clientY + 12}px, 0)`;
                    document.querySelectorAll(".drag-target").forEach((node) => node.classList.remove("drag-target"));
                    const target = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY)?.closest(kind === "game" ? ".tier-game, .tier-dropzone" : ".tier-section");
                    target?.classList.add("drag-target");
                };
                const end = async (pointerEvent) => {
                    ghost.remove();
                    const target = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY)?.closest(kind === "game" ? ".tier-game, .tier-dropzone" : ".tier-section");
                    document.querySelectorAll(".drag-target").forEach((node) => node.classList.remove("drag-target"));
                    document.removeEventListener("pointermove", move);
                    document.removeEventListener("pointerup", end);
                    if (!target) return;
                    if (kind === "game") {
                        const zone = target.matches(".tier-dropzone") ? target : target.closest(".tier-dropzone");
                        if (zone && String(id) !== String(target.dataset.gameId || "")) await moveGame(id, zone.dataset.sectionId, target.matches(".tier-game") ? target.dataset.gameId : null);
                    }
                    else await reorderTier(id, target.dataset.sectionId);
                };
                document.addEventListener("pointermove", move, { passive: false });
                document.addEventListener("pointerup", end, { once: true });
            };
        });
    }

    const exportDialog = document.getElementById("tier-export-dialog");
    const exportPreview = document.getElementById("tier-export-preview");
    const exportStatus = document.getElementById("tier-export-status");
    const exportDownload = document.getElementById("tier-export-download");
    const exportNames = document.getElementById("tier-export-show-names");
    let exportRequest = 0;
    let exportReturnFocus = null;

    function closeExportDialog() {
        exportRequest++;
        exportDialog.hidden = true;
        exportPreview.replaceChildren();
        exportStatus.textContent = "";
        exportReturnFocus?.focus();
        exportReturnFocus = null;
    }

    function openExportDialog() {
        if (!activeBoard || !isAdmin) return;
        exportReturnFocus = document.activeElement;
        exportDialog.hidden = false;
        exportNames.checked = showNamesInExport;
        exportPreview.replaceChildren();
        exportDownload.disabled = true;
        exportStatus.textContent = "プレビューを作成しています…";
        exportDialog.querySelector('[data-tier-export-close]:not(.tier-export-backdrop)').focus();
        renderExportPreview();
    }

    async function renderExportPreview() {
        const request = ++exportRequest;
        showNamesInExport = exportNames.checked;
        exportPreview.replaceChildren();
        exportDownload.disabled = true;
        const assignedCount = window.KioraTierExport.layout(activeBoard, sections, items, games, showNamesInExport).gameCount;
        if (!assignedCount) {
            exportStatus.textContent = "このボードにはまだ作品がありません。段を追加し、未分類のゲームを段へ移動してから書き出してください。";
            return;
        }
        exportStatus.textContent = "プレビューを作成しています…";
        try {
            const result = await window.KioraTierExport.render({ board: activeBoard, sections, items, games, showNames: showNamesInExport, safeUrl: safe });
            if (request !== exportRequest || exportDialog.hidden) return;
            exportPreview.append(result.canvas);
            exportDownload.disabled = false;
            exportStatus.textContent = result.missingCovers
                ? `${result.gameCount} 作品を表示中。読み込めない表紙は作品名で表示します。`
                : `${result.gameCount} 作品を表示中。画像を確認して保存できます。`;
        } catch (error) {
            if (request === exportRequest) exportStatus.textContent = `プレビューを作成できませんでした：${error.message}`;
        }
    }

    async function downloadExport() {
        if (exportDownload.disabled) return;
        exportDownload.disabled = true;
        exportStatus.textContent = "高画質の PNG を作成しています…";
        try {
            const result = await window.KioraTierExport.render({ board: activeBoard, sections, items, games, showNames: exportNames.checked, pixelRatio: 2, safeUrl: safe });
            if (!result.canvas) throw new Error("書き出す作品がありません。");
            const blob = await new Promise((resolve) => result.canvas.toBlob(resolve, "image/png"));
            if (!blob) throw new Error("PNG を生成できませんでした。");
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `kiora-tier-${String(activeBoard.title).replace(/[^\p{L}\p{N}]+/gu, "-")}.png`;
            anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 30000);
            exportStatus.textContent = "PNG を保存しました。";
        } catch (error) {
            exportStatus.textContent = `画像を書き出せませんでした：${error.message}`;
        } finally {
            exportDownload.disabled = false;
        }
    }

    exportDialog.querySelectorAll("[data-tier-export-close]").forEach((control) => control.addEventListener("click", closeExportDialog));
    exportNames.addEventListener("change", renderExportPreview);
    exportDownload.addEventListener("click", downloadExport);
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !exportDialog.hidden) closeExportDialog(); });

    await loadAll();
})();
