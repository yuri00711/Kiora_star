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
    const message = (text, error = false) => { byId("settings-message").textContent = text; byId("settings-message").classList.toggle("error", error); };
    const collect = () => ({ game_id: byId("currently-game").value || null, title: byId("currently-title").value.trim(), subtitle: byId("currently-subtitle").value.trim(), status: byId("currently-status").value, note: byId("currently-note").value.trim() });
    const apply = (value = {}) => { byId("currently-game").value = value.game_id ?? ""; byId("currently-title").value = value.title || ""; byId("currently-subtitle").value = value.subtitle || ""; byId("currently-status").value = value.status || ""; byId("currently-note").value = value.note || ""; };
    function saveDraft() { if (!dirty) return; localStorage.setItem(draftKey, JSON.stringify(collect())); byId("settings-save-state").textContent = "DRAFT SAVED"; }
    form.addEventListener("input", () => { dirty = true; byId("settings-save-state").textContent = "UNSAVED"; clearTimeout(timer); timer = setTimeout(saveDraft, 2500); });
    window.addEventListener("beforeunload", (event) => { if (!dirty) return; saveDraft(); event.preventDefault(); event.returnValue = ""; });
    function back() { if (dirty && !confirm("还有未保存的修改，确定返回吗？草稿会保留在此设备。")) return; window.location.href = "about.html"; }
    byId("settings-back").addEventListener("click", back);
    await auth.initialize(db);
    if (!auth.can("currently-playing:update")) { byId("settings-gate").textContent = "此页面仅限管理员使用，正在返回首页……"; setTimeout(() => location.href = "index.html", 900); return; }
    const [settingsResult, gamesResult] = await Promise.all([db.from("site_settings").select("*").eq("id", 1).maybeSingle(), db.from("games").select("id,title").order("sort_order", { ascending: true, nullsFirst: false })]);
    if (settingsResult.error || gamesResult.error) { byId("settings-gate").textContent = settingsResult.error?.message || gamesResult.error?.message; return; }
    games = gamesResult.data || [];
    games.forEach((game) => { const option = document.createElement("option"); option.value = game.id; option.textContent = game.title; byId("currently-game").append(option); });
    apply(settingsResult.data?.currently_playing || {});
    const draft = localStorage.getItem(draftKey);
    if (draft && confirm("检测到未保存的 CURRENTLY PLAYING 草稿，是否恢复？")) { try { apply(JSON.parse(draft)); dirty = true; } catch (_) { localStorage.removeItem(draftKey); } }
    byId("currently-game").addEventListener("change", () => { const game = games.find((item) => String(item.id) === byId("currently-game").value); if (game && !byId("currently-title").value.trim()) byId("currently-title").value = game.title; });
    form.addEventListener("submit", async (event) => { event.preventDefault(); message("Saving…"); const payload = collect(); const { error } = await auth.write("currently_playing_update", { data: payload }, () => db.from("site_settings").upsert({ id: 1, currently_playing: payload }, { onConflict: "id" })); if (error) { message(`保存失败：${error.message}。请先运行最新的 Supabase 设置迁移。`, true); saveDraft(); return; } localStorage.removeItem(draftKey); dirty = false; byId("settings-save-state").textContent = "SAVED"; message("Saved / 已保存"); });
    byId("currently-clear").addEventListener("click", async () => { if (!confirm("清空 CURRENTLY PLAYING 设置吗？")) return; const { error } = await auth.write("currently_playing_update", { data: null }, () => db.from("site_settings").upsert({ id: 1, currently_playing: null }, { onConflict: "id" })); if (error) return message(`清空失败：${error.message}`, true); localStorage.removeItem(draftKey); dirty = false; apply({}); message("已恢复自动显示游戏列表中的第一项。"); });
    byId("settings-gate").hidden = true; byId("currently-editor").hidden = false; byId("settings-save-state").textContent = "READY";
})();
