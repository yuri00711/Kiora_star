(async function () {
    "use strict";

    const db = window.yuriArticles.getClient();
    const auth = ;
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
                ? "Tier Board 尚未启用。请先运行 supabase-games-migration.sql。"
                : `Tier Board unavailable: ${boardsResult.error.message}`;
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
            statusLine.textContent = isAdmin ? "Create the first board to begin arranging games." : "No Tier Boards have been published yet.";
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
        add.textContent = "＋ NEW BOARD";
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
                history.replaceState(null, "", `?id=${encodeURIComponent(board.id)}`);
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
            empty.textContent = isAdmin ? "Add a tier to begin this board." : "This board has no sections yet.";
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
            button("EDIT BOARD", editBoard),
            button("＋ ADD TIER", createTierSection),
            button("EXPORT TIER IMAGE", exportBoard, "export-button")
        );
        if (auth.role === "owner") root.append(button("DELETE BOARD", deleteBoard, "danger-button"));
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = showNamesInExport;
        checkbox.addEventListener("change", () => { showNamesInExport = checkbox.checked; });
        label.append(checkbox, " SHOW GAME NAMES");
        root.append(label);
    }

    function createTier(section, index) {
        const article = document.createElement("section");
        article.className = "tier-section";
        article.dataset.sectionId = section.id;
        const heading = document.createElement("header");
        const copy = document.createElement("div");
        const number = document.createElement("p"); number.textContent = `TIER ${String(index + 1).padStart(2, "0")}`;
        const title = document.createElement("h3"); title.textContent = section.title;
        const description = document.createElement("span"); description.textContent = section.description || ""; description.hidden = !section.description;
        copy.append(number, title, description);
        heading.append(copy);
        if (isAdmin) {
            const controls = document.createElement("div");
            controls.className = "tier-controls";
            const handle = button("↕", () => {}, "tier-drag-handle");
            handle.setAttribute("aria-label", "Drag tier");
            handle.dataset.dragKind = "tier";
            handle.dataset.dragId = section.id;
            controls.append(
                handle,
                button("↑", () => shiftTier(section.id, -1), "tier-order-button"),
                button("↓", () => shiftTier(section.id, 1), "tier-order-button"),
                button("EDIT", () => editTier(section))
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
            const empty = document.createElement("p"); empty.className = "drop-hint"; empty.textContent = isAdmin ? "DROP A GAME HERE" : "—"; dropzone.append(empty);
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
        const name = document.createElement("p"); name.textContent = game.title || "UNTITLED";
        tile.append(cover, name);
        if (isAdmin) {
            const handle = button("⋮⋮", () => {}, "game-drag-handle");
            handle.setAttribute("aria-label", `Drag ${game.title || "game"}`);
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
            const empty = document.createElement("p"); empty.className = "drop-hint"; empty.textContent = "ALL GAMES ARE FILED"; root.append(empty);
        }
    }

    async function createBoard() {
        const title = prompt("Tier Board title");
        if (!title?.trim()) return;
        const description = prompt("Description (optional)") || null;
        const payload = { title: title.trim(), description, sort_order: boards.length };
        const { data, error } = await auth.write("tier_board_create", payload, () => db.from("tier_boards").insert(payload).select("id,title,description,sort_order,created_at,updated_at").single());
        if (error) return alert(`Create failed: ${error.message}`);
        boards.push(data); activeBoard = data; sections = []; items = [];
        history.replaceState(null, "", `?id=${encodeURIComponent(data.id)}`);
        renderTabs(); renderBoard();
    }

    async function editBoard() {
        const title = prompt("Tier Board title", activeBoard.title);
        if (!title?.trim()) return;
        const description = prompt("Description (optional)", activeBoard.description || "") || null;
        const payload = { id: activeBoard.id, title: title.trim(), description };
        const { error } = await auth.write("tier_board_update", payload, () => db.from("tier_boards").update({ title: payload.title, description }).eq("id", activeBoard.id));
        if (error) return alert(`Save failed: ${error.message}`);
        Object.assign(activeBoard, { title: title.trim(), description }); renderTabs(); renderBoard();
    }

    async function deleteBoard() {
        if (auth.role !== "owner") return;
        if (!confirm(`Delete “${activeBoard.title}” and all of its tiers?`)) return;
        const { error } = await db.from("tier_boards").delete().eq("id", activeBoard.id);
        if (error) return alert(`Delete failed: ${error.message}`);
        boards = boards.filter((board) => board !== activeBoard); activeBoard = boards[0] || null; renderTabs();
        if (activeBoard) await loadBoard(activeBoard.id); else { boardRoot.hidden = true; statusLine.hidden = false; statusLine.textContent = "Create the first board to begin arranging games."; }
    }

    async function createTierSection() {
        const title = prompt("Tier title");
        if (!title?.trim()) return;
        const description = prompt("Tier description (optional)") || null;
        const payload = { board_id: activeBoard.id, title: title.trim(), description, sort_order: sections.length };
        const { data, error } = await auth.write("tier_section_create", payload, () => db.from("tier_sections").insert(payload).select("id,board_id,title,description,sort_order,created_at,updated_at").single());
        if (error) return alert(`Create failed: ${error.message}`);
        sections.push(data); renderBoard();
    }

    async function editTier(section) {
        const title = prompt("Tier title", section.title);
        if (!title?.trim()) return;
        const description = prompt("Tier description (optional)", section.description || "") || null;
        const payload = { id: section.id, title: title.trim(), description };
        const { error } = await auth.write("tier_section_update", payload, () => db.from("tier_sections").update({ title: payload.title, description }).eq("id", section.id));
        if (error) return alert(`Save failed: ${error.message}`);
        Object.assign(section, { title: title.trim(), description }); renderBoard();
    }

    async function deleteTier(section) {
        if (auth.role !== "owner") return;
        if (!confirm(`Delete tier “${section.title}”? Its games will return to UNFILED.`)) return;
        const { error } = await db.from("tier_sections").delete().eq("id", section.id);
        if (error) return alert(`Delete failed: ${error.message}`);
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
        if (failed) alert(`Sort failed: ${failed.error.message}`);
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
        if (result.error) return alert(`Move failed: ${result.error.message}`);
        const moved = items.find((item) => String(item.game_id) === String(gameId));
        const arranged = items.filter((item) => String(item.section_id) === String(sectionId) && item !== moved).sort(byOrder);
        arranged.splice(beforeIndex < 0 ? arranged.length : beforeIndex, 0, moved);
        arranged.forEach((item, index) => { item.sort_order = index; });
        await normalizeItemOrders(); renderBoard();
    }

    async function removeGame(item) {
        if (auth.role !== "owner") return;
        const { error } = await db.from("tier_items").delete().eq("id", item.id);
        if (error) return alert(`Remove failed: ${error.message}`);
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
        if (failed) alert(`Sort failed: ${failed.error.message}`);
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

    function loadImage(url) {
        return new Promise((resolve) => {
            if (!url) return resolve(null);
            const image = new Image();
            image.crossOrigin = "anonymous";
            image.onload = () => resolve(image);
            image.onerror = () => resolve(null);
            image.src = url;
        });
    }

    async function exportBoard() {
        const columns = 6;
        const cardW = 142;
        const cardH = showNamesInExport ? 225 : 190;
        const tierHeights = sections.map((section) => Math.max(250, 78 + Math.ceil(items.filter((item) => String(item.section_id) === String(section.id)).length / columns) * cardH));
        const width = 1200;
        const height = 230 + tierHeights.reduce((sum, value) => sum + value, 0) + 110;
        const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, "#fcf8f2"); gradient.addColorStop(.52, "#f7eef3"); gradient.addColorStop(1, "#f1eff8");
        ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = "rgba(109,85,116,.18)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(1080, 120, 150, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = "#a183a3"; ctx.font = "18px Georgia"; ctx.fillText("KIORA.SPACE / TIER ARCHIVE", 72, 64);
        ctx.fillStyle = "#4f4653"; ctx.font = "46px Georgia"; ctx.fillText(activeBoard.title, 72, 125);
        if (activeBoard.description) { ctx.fillStyle = "#887b8c"; ctx.font = "19px Georgia"; ctx.fillText(activeBoard.description.slice(0, 84), 73, 165); }
        ctx.strokeStyle = "rgba(92,72,98,.22)"; ctx.beginPath(); ctx.moveTo(72, 195); ctx.lineTo(1128, 195); ctx.stroke();

        const uniqueGames = [...new Set(items.map((item) => String(item.game_id)))].map(gameById).filter(Boolean);
        const imageEntries = await Promise.all(uniqueGames.map(async (game) => [String(game.id), await loadImage(safe(game.cover_url))]));
        const images = new Map(imageEntries);
        let y = 220;
        sections.forEach((section, sectionIndex) => {
            const tierHeight = tierHeights[sectionIndex];
            ctx.fillStyle = sectionIndex % 2 ? "rgba(255,255,255,.48)" : "rgba(255,253,250,.66)";
            ctx.fillRect(48, y, 1104, tierHeight - 12);
            ctx.strokeStyle = "rgba(102,80,109,.18)"; ctx.strokeRect(48.5, y + .5, 1103, tierHeight - 13);
            ctx.fillStyle = "#967596"; ctx.font = "13px Georgia"; ctx.fillText(`TIER ${String(sectionIndex + 1).padStart(2, "0")}`, 72, y + 39);
            ctx.fillStyle = "#514853"; ctx.font = "27px Georgia"; ctx.fillText(section.title, 72, y + 75);
            if (section.description) { ctx.fillStyle = "#928695"; ctx.font = "14px Georgia"; ctx.fillText(section.description.slice(0, 28), 72, y + 103); }
            const tierItems = items.filter((item) => String(item.section_id) === String(section.id)).sort(byOrder);
            tierItems.forEach((item, index) => {
                const game = gameById(item.game_id); if (!game) return;
                const x = 285 + (index % columns) * cardW;
                const rowY = y + 28 + Math.floor(index / columns) * cardH;
                const image = images.get(String(game.id));
                ctx.fillStyle = "rgba(239,230,239,.8)"; ctx.fillRect(x, rowY, 116, 158);
                if (image) {
                    const scale = Math.max(116 / image.width, 158 / image.height);
                    const sw = 116 / scale, sh = 158 / scale;
                    ctx.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, x, rowY, 116, 158);
                } else { ctx.fillStyle = "#a98daa"; ctx.font = "20px Georgia"; ctx.fillText("✦", x + 49, rowY + 86); }
                if (showNamesInExport) { ctx.fillStyle = "#5d5260"; ctx.font = "13px Georgia"; const name = (game.title || "UNTITLED"); ctx.fillText(name.length > 15 ? `${name.slice(0, 14)}…` : name, x, rowY + 183); }
            });
            y += tierHeight;
        });
        ctx.fillStyle = "#9c8e9f"; ctx.font = "13px Georgia"; ctx.fillText("KIORA / PRIVATE GAME ARCHIVE", 72, height - 52);
        ctx.textAlign = "right"; ctx.fillText(new Date().toLocaleDateString("ja-JP").replaceAll("/", "."), 1128, height - 52);
        canvas.toBlob((blob) => {
            if (!blob) return alert("Export failed.");
            const anchor = document.createElement("a"); anchor.href = URL.createObjectURL(blob); anchor.download = `kiora-tier-${String(activeBoard.title).replace(/[^\p{L}\p{N}]+/gu, "-")}.png`; anchor.click();
            setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
        }, "image/png");
    }

    await loadAll();
})();
