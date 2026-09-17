(async function () {
    "use strict";
    const db = window.yuriArticles.getClient();
    const auth = window.KioraAuth;
    const draftKey = "yuri:currently-playing-draft";
    const byId = (id) => document.getElementById(id);
    const form = byId("currently-form");
    let dirty = false;
    let timer;
    let games = [];
    let tags = [];
    const message = (text, error = false) => { byId("settings-message").textContent = text; byId("settings-message").classList.toggle("error", error); };
    const normalizeTags = (value) => {
        let values = value;
        if (!Array.isArray(values) && typeof values === "string") {
            try { values = JSON.parse(values); } catch (_) { values = values.split(/[,，\n]/); }
        }
        if (!Array.isArray(values)) return [];
        return values.map((tag) => String(tag || "").trim()).filter((tag, index, all) => tag && all.indexOf(tag) === index).slice(0, 30);
    };
    const markDirty = () => { dirty = true; byId("settings-save-state").textContent = "UNSAVED"; clearTimeout(timer); timer = setTimeout(saveDraft, 2500); };
    const renderTags = () => {
        const list = byId("currently-tag-list");
        list.replaceChildren();
        tags.forEach((tag) => {
            const chip = document.createElement("span");
            chip.className = "settings-tag-chip";
            chip.append(document.createTextNode(tag));
            const remove = document.createElement("button");
            remove.type = "button";
            remove.textContent = "×";
            remove.setAttribute("aria-label", `删除标签 ${tag}`);
            remove.addEventListener("click", () => { tags = tags.filter((item) => item !== tag); renderTags(); markDirty(); });
            chip.append(remove);
            list.append(chip);
        });
    };
    const collect = () => ({ game_id: byId("currently-game").value || null, title: byId("currently-title").value.trim(), subtitle: byId("currently-subtitle").value.trim(), status: byId("currently-status").value, note: byId("currently-note").value.trim(), tags: tags.slice() });
    const apply = (value = {}, fallbackTags = []) => {
        byId("currently-game").value = value.game_id ?? "";
        byId("currently-title").value = value.title || "";
        byId("currently-subtitle").value = value.subtitle || "";
        byId("currently-status").value = value.status || "";
        byId("currently-note").value = value.note || "";
        tags = normalizeTags(Object.prototype.hasOwnProperty.call(value, "tags") ? value.tags : fallbackTags);
        renderTags();
    };
    const addTag = () => {
        const input = byId("currently-tag-entry");
        const tag = input.value.trim();
        if (!tag) return;
        if (!tags.includes(tag)) {
            if (tags.length >= 30) return message("最多可添加 30 个标签。", true);
            tags.push(tag);
            renderTags();
            markDirty();
        }
        input.value = "";
        input.focus();
    };
    function saveDraft() { if (!dirty) return; localStorage.setItem(draftKey, JSON.stringify(collect())); byId("settings-save-state").textContent = "DRAFT SAVED"; }
    form.addEventListener("input", markDirty);
    byId("currently-add-tag").addEventListener("click", addTag);
    byId("currently-tag-entry").addEventListener("keydown", (event) => { if (event.key !== "Enter") return; event.preventDefault(); addTag(); });
    window.addEventListener("beforeunload", (event) => { if (!dirty) return; saveDraft(); event.preventDefault(); event.returnValue = ""; });
    function back() { if (dirty && !confirm("还有未保存的修改，确定返回吗？草稿会保留在此设备。")) return; window.location.href = "about.html"; }
    byId("settings-back").addEventListener("click", back);
    await auth.initialize(db);
    if (!auth.can("currently-playing:update")) { byId("settings-gate").textContent = "此页面仅限管理员使用，正在返回首页……"; setTimeout(() => location.href = "index.html", 900); return; }
    const [settingsResult, gamesResult, otomeResult, favoritesResult] = await Promise.all([db.from("site_settings").select("*").eq("id", 1).maybeSingle(), db.from("games").select("id,title").order("sort_order", { ascending: true, nullsFirst: false }), db.from("otome_profile").select("play_styles,favorite_elements").eq("id", 1).maybeSingle(), db.from("profile_favorites").select("name").order("sort_order", { ascending: true, nullsFirst: false })]);
    if (settingsResult.error || gamesResult.error) { byId("settings-gate").textContent = settingsResult.error?.message || gamesResult.error?.message; return; }
    games = gamesResult.data || [];
    games.forEach((game) => { const option = document.createElement("option"); option.value = game.id; option.textContent = game.title; byId("currently-game").append(option); });
    const legacyTags = normalizeTags([...(otomeResult.data?.play_styles || []), ...(otomeResult.data?.favorite_elements || []), ...(favoritesResult.data || []).map((item) => item.name)]);
    apply(settingsResult.data?.currently_playing || {}, legacyTags);
    const draft = localStorage.getItem(draftKey);
    if (draft && confirm("检测到未保存的 CURRENTLY PLAYING 草稿，是否恢复？")) { try { apply(JSON.parse(draft), legacyTags); dirty = true; } catch (_) { localStorage.removeItem(draftKey); } }
    byId("currently-game").addEventListener("change", () => { const game = games.find((item) => String(item.id) === byId("currently-game").value); if (game && !byId("currently-title").value.trim()) byId("currently-title").value = game.title; });
    form.addEventListener("submit", async (event) => { event.preventDefault(); message("Saving…"); const payload = collect(); const { error } = await auth.write("currently_playing_update", { data: payload }, () => db.from("site_settings").upsert({ id: 1, currently_playing: payload }, { onConflict: "id" })); if (error) { message(`保存失败：${error.message}。请先运行最新的 Supabase 设置迁移。`, true); saveDraft(); return; } localStorage.removeItem(draftKey); dirty = false; byId("settings-save-state").textContent = "SAVED"; message("Saved / 已保存"); });
    byId("currently-clear").addEventListener("click", async () => { if (!confirm("清空 CURRENTLY PLAYING 设置吗？")) return; const { error } = await auth.write("currently_playing_update", { data: null }, () => db.from("site_settings").upsert({ id: 1, currently_playing: null }, { onConflict: "id" })); if (error) return message(`清空失败：${error.message}`, true); localStorage.removeItem(draftKey); dirty = false; apply({ tags: [] }); message("已恢复自动显示游戏列表中的第一项。"); });
    byId("settings-gate").hidden = true; byId("currently-editor").hidden = false; byId("settings-save-state").textContent = "READY";
})();
