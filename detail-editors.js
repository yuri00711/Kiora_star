(function () {
    "use strict";

    const common = window.yuriArticles;
    const auth = window.KioraAuth;
    const db = common?.getClient?.();
    let savedScrollY = 0;

    const platforms = ["SWITCH", "STEAM", "PC", "PSVITA", "PSP", "PS4", "PS5", "MOBILE", "OTHER"];

    function instantScroll(y) {
        requestAnimationFrame(() => {
            const root = document.documentElement;
            const previous = root.style.scrollBehavior;
            root.style.setProperty("scroll-behavior", "auto", "important");
            window.scrollTo(0, Math.max(0, y));
            requestAnimationFrame(() => {
                if (previous) root.style.scrollBehavior = previous;
                else root.style.removeProperty("scroll-behavior");
            });
        });
    }

    function openDialog(dialog) {
        savedScrollY = window.scrollY;
        dialog.dataset.dirty = "false";
        dialog.showModal();
    }

    function closeDialog(dialog) {
        dialog.close();
        instantScroll(savedScrollY);
    }

    function installDialogBehavior(dialog) {
        dialog.addEventListener("input", () => { dialog.dataset.dirty = "true"; });
        dialog.addEventListener("cancel", (event) => {
            event.preventDefault();
            if (dialog.dataset.dirty === "true" && !window.confirm("放弃尚未保存的修改吗？")) return;
            closeDialog(dialog);
        });
        dialog.addEventListener("click", (event) => {
            if (event.target !== dialog && !event.target.closest("[data-detail-editor-cancel]")) return;
            if (dialog.dataset.dirty === "true" && !window.confirm("放弃尚未保存的修改吗？")) return;
            closeDialog(dialog);
        });
    }

    function value(form, name) {
        return form.elements.namedItem(name)?.value?.trim?.() || "";
    }

    function nullable(value) {
        const text = String(value ?? "").trim();
        return text || null;
    }

    function returnedRow(result, fallback) {
        const row = Array.isArray(result?.data) ? result.data[0] : result?.data;
        return row && typeof row === "object" ? row : fallback;
    }

    function parseStoreLinks(text) {
        const links = [];
        for (const rawLine of String(text || "").split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line) continue;
            const separator = line.search(/[|｜\t]/);
            if (separator < 0) throw new Error(`商店链接格式不正确：${line}`);
            const label = line.slice(0, separator).trim();
            const url = line.slice(separator + 1).trim();
            if (!label || !common.safeUrl(url)) throw new Error(`商店链接格式不正确：${line}`);
            links.push({ label, url });
        }
        return links;
    }

    function formatStoreLinks(value) {
        return common.normalizeStoreLinks(value).map((item) => `${item.label} | ${item.url}`).join("\n");
    }

    function gameDialog() {
        const dialog = document.createElement("dialog");
        dialog.id = "game-inline-editor";
        dialog.className = "detail-inline-editor";
        dialog.innerHTML = `
            <form method="dialog" class="detail-inline-editor__panel" data-game-inline-form>
                <header><div><p>ゲームアーカイブ / 編集</p><h2>ゲーム記録を編集</h2></div><button type="button" data-detail-editor-cancel aria-label="閉じる">×</button></header>
                <div class="detail-inline-editor__grid">
                    <label class="wide">タイトル<input name="title" required></label>
                    <label>評価<input name="rating" type="number" min="0" max="10" step="0.1"></label>
                    <label>並び順<input name="sort_order" type="number"></label>
                    <label>開始日<input name="started_at" type="date"></label>
                    <label>終了日<input name="completed_at" type="date"></label>
                    <label>状態<select name="status"><option value="">未分類</option><option value="PLAYING">プレイ中</option><option value="COMPLETED">クリア済み</option><option value="PAUSED">一時休止</option><option value="DROPPED">中断</option><option value="WISHLIST">気になる</option></select></label>
                    <label>お気に入り度<select name="favorite_level"><option value="">未設定</option><option value="FAVORITE">お気に入り</option><option value="BELOVED">とても大切</option><option value="LOVE">大好き</option><option value="LIKE">好き</option><option value="NEUTRAL">ふつう</option><option value="NOT FOR ME">合わなかった</option></select></label>
                    <label class="wide">カバー画像URL<input name="cover_url" type="url" placeholder="https://..."></label>
                    <label class="wide">カバー画像をアップロード<input name="cover_file" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label>
                    <fieldset class="wide"><legend>機種</legend><div class="detail-inline-editor__checks">${platforms.map((item) => `<label><input type="checkbox" name="platform" value="${item}"><span>${item === "MOBILE" ? "モバイル" : item === "OTHER" ? "その他" : item}</span></label>`).join("")}</div></fieldset>
                    <label class="wide">タグ <small>読点区切り</small><input name="tags"></label>
                    <label class="wide">公式サイトURL<input name="official_site_url" type="url" placeholder="https://..."></label>
                    <label class="wide">ストアリンク <small>1行ずつ：名前 | URL</small><textarea name="store_links" rows="4"></textarea></label>
                    <label class="wide detail-inline-editor__writing">ゲームの感想<textarea name="review" rows="12"></textarea></label>
                </div>
                <p class="detail-inline-editor__message" role="status"></p>
                <footer><button type="submit" class="primary">記録を保存</button><button type="button" data-detail-editor-cancel>キャンセル</button></footer>
            </form>`;
        document.body.append(dialog);
        installDialogBehavior(dialog);
        return dialog;
    }

    function characterDialog() {
        const dialog = document.createElement("dialog");
        dialog.id = "character-inline-editor";
        dialog.className = "detail-inline-editor";
        dialog.innerHTML = `
            <form method="dialog" class="detail-inline-editor__panel" data-character-inline-form>
                <header><div><p>キャラクターアーカイブ / 編集</p><h2>キャラクターの印象を編集</h2></div><button type="button" data-detail-editor-cancel aria-label="閉じる">×</button></header>
                <input type="hidden" name="id"><input type="hidden" name="game_id">
                <div class="detail-inline-editor__grid">
                    <label class="wide">名前<input name="name" required></label>
                    <label class="wide">サブタイトル / ルートメモ<input name="subtitle"></label>
                    <label>評価<input name="rating" type="number" min="0" max="10" step="0.1"></label>
                    <label>並び順<input name="sort_order" type="number"></label>
                    <label class="wide">画像URL<input name="image_url" type="url" placeholder="https://..."></label>
                    <label class="wide detail-inline-editor__writing">わたしの感想<textarea name="review" rows="14"></textarea></label>
                </div>
                <p class="detail-inline-editor__message" role="status"></p>
                <footer><button type="submit" class="primary">キャラクターを保存</button><button type="button" data-detail-editor-cancel>キャンセル</button></footer>
            </form>`;
        document.body.append(dialog);
        installDialogBehavior(dialog);
        return dialog;
    }

    function setFact(rowId, valueId, value) {
        const row = document.getElementById(rowId);
        const output = document.getElementById(valueId);
        if (!row || !output) return;
        row.hidden = !value;
        output.textContent = value || "";
    }

    function updateGameView(game) {
        document.title = `${game.title || "Game Archive"} · Kiora`;
        document.getElementById("game-detail-title").textContent = game.title || "タイトル未設定";
        document.getElementById("game-detail-archive-number").textContent = `記録 ${String(game.sort_order ?? game.id).padStart(3, "0")}`;
        document.getElementById("game-detail-rating").textContent = game.rating !== null && game.rating !== "" ? `✦ ${game.rating} / 10` : "未評価";
        setFact("game-status-fact", "game-detail-play-status", game.status ? String(game.status).toUpperCase() : "");
        setFact("game-platform-fact", "game-detail-platforms", common.formatList(game.platforms).map((item) => item.toUpperCase()).join(" · "));
        setFact("game-favorite-fact", "game-detail-favorite", game.favorite_level ? String(game.favorite_level).toUpperCase() : "");
        const started = common.formatPureDate(game.started_at);
        const completed = common.formatPureDate(game.completed_at);
        setFact("game-date-fact", "game-detail-date", started && completed ? `${started} — ${completed}` : started ? `${started} —` : completed || "—");
        const tags = common.formatList(game.tags);
        const tagHost = document.getElementById("game-detail-tags");
        tagHost.replaceChildren(...tags.map((tag) => Object.assign(document.createElement("span"), { textContent: tag })));
        tagHost.hidden = !tags.length;
        document.getElementById("game-detail-keywords-label").hidden = !tags.length;
        const note = nullable(game.review);
        document.getElementById("game-note-preview").hidden = !note;
        document.getElementById("game-note-preview-text").textContent = note ? common.truncateText(common.plainText(note), 240) : "";
        const cover = document.getElementById("game-detail-cover");
        const placeholder = document.getElementById("game-detail-cover-placeholder");
        const coverUrl = common.safeUrl(game.cover_url);
        cover.hidden = !coverUrl;
        placeholder.hidden = Boolean(coverUrl);
        if (coverUrl) cover.src = coverUrl;
        window.KioraDetailState.game = game;
    }

    function updateCharacterView(character) {
        document.title = `${character.name || "Character Record"} · Kiora`;
        document.getElementById("character-index").textContent = `キャラクター ${String(character.sort_order ?? character.id).padStart(2, "0")}`;
        document.getElementById("character-name").textContent = character.name || "キャラクター";
        document.getElementById("character-rating").textContent = character.rating !== null && character.rating !== "" ? `${character.rating} / 10` : "—";
        const subtitle = document.getElementById("character-subtitle");
        subtitle.textContent = character.subtitle || "";
        subtitle.hidden = !character.subtitle;
        const reviewSection = document.getElementById("character-review-section");
        const review = document.getElementById("character-review");
        review.innerHTML = character.review ? common.markdownToHtml(character.review) : "";
        reviewSection.hidden = !character.review;
        const header = document.querySelector(".character-detail-header");
        const frame = document.getElementById("character-image-frame");
        const image = document.getElementById("character-image");
        const imageUrl = common.safeUrl(character.image_url);
        header.classList.toggle("has-image", Boolean(imageUrl));
        frame.hidden = !imageUrl;
        if (imageUrl) {
            image.src = imageUrl;
            image.alt = character.name || "Character";
        } else {
            image.removeAttribute("src");
        }
        window.KioraDetailState.character = character;
    }

    function fillGameForm(form, game) {
        for (const name of ["title", "rating", "sort_order", "started_at", "completed_at", "status", "favorite_level", "cover_url", "official_site_url", "review"]) {
            form.elements.namedItem(name).value = game[name] ?? "";
        }
        form.elements.namedItem("tags").value = common.formatList(game.tags).join(", ");
        form.elements.namedItem("store_links").value = formatStoreLinks(game.store_links);
        const selected = new Set(common.formatList(game.platforms).map((item) => item.toUpperCase()));
        form.querySelectorAll('[name="platform"]').forEach((input) => { input.checked = selected.has(input.value); });
        form.elements.namedItem("cover_file").value = "";
    }

    async function uploadCover(form, message) {
        const file = form.elements.namedItem("cover_file").files?.[0];
        if (!file) return nullable(value(form, "cover_url"));
        if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) throw new Error("封面须为 5MB 以内的图片文件。");
        message.textContent = "表紙をアップロードしています…";
        const extension = (file.name.split(".").pop() || "jpg").replace(/[^a-z0-9]/gi, "").toLowerCase();
        const result = await auth.uploadSiteMedia(file, `collections/games/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${extension || "jpg"}`);
        if (result.error) throw result.error;
        return result.data.publicUrl;
    }

    function bindGameEditor() {
        const trigger = document.getElementById("game-edit-record");
        if (!trigger) return;
        const dialog = gameDialog();
        const form = dialog.querySelector("[data-game-inline-form]");
        const message = dialog.querySelector(".detail-inline-editor__message");
        trigger.addEventListener("click", () => {
            const game = window.KioraDetailState?.game;
            if (!game) return;
            fillGameForm(form, game);
            message.textContent = "";
            openDialog(dialog);
        });
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const game = window.KioraDetailState.game;
            const submit = form.querySelector('[type="submit"]');
            try {
                submit.disabled = true;
                const started = nullable(value(form, "started_at"));
                const completed = nullable(value(form, "completed_at"));
                if (started && completed && started > completed) throw new Error("完成日期不能早于开始日期。");
                const payload = {
                    title: value(form, "title"),
                    review: nullable(value(form, "review")),
                    rating: nullable(value(form, "rating")),
                    cover_url: await uploadCover(form, message),
                    sort_order: nullable(value(form, "sort_order")),
                    started_at: started,
                    completed_at: completed,
                    status: nullable(value(form, "status")),
                    favorite_level: nullable(value(form, "favorite_level")),
                    platforms: [...form.querySelectorAll('[name="platform"]:checked')].map((input) => input.value),
                    tags: value(form, "tags").split(/[,，\n]/).map((tag) => tag.trim()).filter((tag, index, all) => tag && all.indexOf(tag) === index),
                    official_site_url: nullable(value(form, "official_site_url")),
                    store_links: parseStoreLinks(value(form, "store_links"))
                };
                if (!payload.title) throw new Error("请填写游戏标题。");
                message.textContent = "保存しています…";
                const result = await auth.write("game_update", { id: game.id, data: payload }, () => db.from("games").update(payload).eq("id", game.id).select("*").single());
                if (result.error) throw result.error;
                const saved = returnedRow(result, { ...game, ...payload });
                updateGameView(saved);
                dialog.dataset.dirty = "false";
                closeDialog(dialog);
            } catch (error) {
                message.textContent = `保存失败：${error.message}`;
            } finally {
                submit.disabled = false;
            }
        });
    }

    function fillCharacterForm(form, character, gameId) {
        form.elements.namedItem("id").value = character?.id ?? "";
        form.elements.namedItem("game_id").value = gameId ?? character?.game_id ?? "";
        for (const name of ["name", "subtitle", "rating", "sort_order", "image_url", "review"]) {
            form.elements.namedItem(name).value = character?.[name] ?? "";
        }
    }

    function bindCharacterEditors() {
        const editTrigger = document.getElementById("character-edit");
        const addTrigger = document.getElementById("game-add-character");
        if (!editTrigger && !addTrigger) return;
        const dialog = characterDialog();
        const form = dialog.querySelector("[data-character-inline-form]");
        const message = dialog.querySelector(".detail-inline-editor__message");
        editTrigger?.addEventListener("click", () => {
            const character = window.KioraDetailState?.character;
            if (!character) return;
            fillCharacterForm(form, character, character.game_id);
            dialog.querySelector("h2").textContent = "编辑角色印象";
            message.textContent = "";
            openDialog(dialog);
        });
        addTrigger?.addEventListener("click", () => {
            const game = window.KioraDetailState?.game;
            if (!game) return;
            fillCharacterForm(form, null, game.id);
            dialog.querySelector("h2").textContent = "新增角色印象";
            message.textContent = "";
            openDialog(dialog);
        });
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const id = value(form, "id");
            const gameId = value(form, "game_id");
            const submit = form.querySelector('[type="submit"]');
            const payload = {
                game_id: Number(gameId),
                name: value(form, "name"),
                subtitle: nullable(value(form, "subtitle")),
                review: nullable(value(form, "review")),
                rating: nullable(value(form, "rating")),
                image_url: nullable(value(form, "image_url")),
                sort_order: nullable(value(form, "sort_order"))
            };
            if (!payload.name) {
                message.textContent = "请填写角色名称。";
                return;
            }
            try {
                submit.disabled = true;
                message.textContent = "保存しています…";
                const action = id ? "character_update" : "character_create";
                const result = await auth.write(action, id ? { id, data: payload } : { data: payload }, () => id
                    ? db.from("characters").update(payload).eq("id", id).select("*").single()
                    : db.from("characters").insert(payload).select("*").single());
                if (result.error) throw result.error;
                const fallback = id ? { ...window.KioraDetailState.character, ...payload } : payload;
                const saved = returnedRow(result, fallback);
                if (id && document.getElementById("character-name")) updateCharacterView(saved);
                dialog.dataset.dirty = "false";
                closeDialog(dialog);
            } catch (error) {
                message.textContent = `保存失败：${error.message}`;
            } finally {
                submit.disabled = false;
            }
        });
    }

    window.KioraDetailState = window.KioraDetailState || {};
    bindGameEditor();
    bindCharacterEditors();
})();
