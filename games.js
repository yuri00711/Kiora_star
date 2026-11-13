(async function () {
    "use strict";

    const db = window.yuriArticles.getClient();
    const auth = window.KioraAuth;
    const navigation = window.KioraNavigation;
    const pageParams = new URLSearchParams(window.location.search);
    const STATES = ["PLAYING", "COMPLETED", "PAUSED", "DROPPED", "WISHLIST"];
    const PLATFORMS = ["SWITCH", "STEAM", "PC", "PSVITA", "PSP", "PS4", "PS5", "MOBILE", "OTHER"];
    const FAVORITES = ["FAVORITE", "BELOVED", "LOVE", "LIKE", "NEUTRAL", "NOT FOR ME", "UNFILED"];
    const STATUS_LABELS = { PLAYING: "プレイ中", COMPLETED: "クリア済み", PAUSED: "休止中", DROPPED: "中断", WISHLIST: "気になる" };
    const FAVORITE_LABELS = { FAVORITE: "いちばん好き", BELOVED: "大切", LOVE: "大好き", LIKE: "好き", NEUTRAL: "ふつう", "NOT FOR ME": "合わなかった", UNFILED: "未分類" };
    const selection = {
        status: new Set(pageParams.getAll("status")),
        platforms: new Set(pageParams.getAll("platform")),
        tags: new Set(pageParams.getAll("tag")),
        favorite: new Set(pageParams.getAll("favorite"))
    };
    let games = [];
    let query = pageParams.get("q") || "";
    let view = pageParams.get("view") === "index" || (!pageParams.has("view") && localStorage.getItem("kiora:games-view") === "index") ? "index" : "grid";

    const list = document.getElementById("games-list");
    const statusLine = document.getElementById("games-status");
    const sheet = document.getElementById("filter-sheet");

    function updateUrl() {
        const url = new URL(window.location.href);
        ["status", "platform", "tag", "favorite", "q", "view"].forEach((key) => url.searchParams.delete(key));
        selection.status.forEach((value) => url.searchParams.append("status", value));
        selection.platforms.forEach((value) => url.searchParams.append("platform", value));
        selection.tags.forEach((value) => url.searchParams.append("tag", value));
        selection.favorite.forEach((value) => url.searchParams.append("favorite", value));
        if (query.trim()) url.searchParams.set("q", query.trim());
        if (view !== "grid") url.searchParams.set("view", view);
        history.replaceState(history.state, "", url);
    }

    const normalizeList = (value) => {
        if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
        if (typeof value !== "string" || !value.trim()) return [];
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.trim()).filter(Boolean);
        } catch (_) {}
        return value.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
    };

    const ratingText = (rating) => rating === null || rating === undefined || rating === "" ? "—" : Number(rating).toFixed(1);
    const gameStatus = (game) => String(game.status || game.play_status || "").toUpperCase();
    const gamePlatforms = (game) => normalizeList(game.platforms).map((item) => item.toUpperCase());
    const gameTags = (game) => normalizeList(game.tags);
    const statusLabel = (value) => STATUS_LABELS[String(value || "").toUpperCase()] || value || "未分類";
    const filterValueLabel = (key, value) => key === "status" ? statusLabel(value) : key === "favorite" ? (FAVORITE_LABELS[value] || value) : value;
    const favoriteLevel = (game) => {
        const value = String(game.favorite_level || "").toUpperCase();
        return ["FAVORITE", "BELOVED", "LOVE", "LIKE", "NEUTRAL", "NOT FOR ME"].includes(value) ? value : "UNFILED";
    };

    function openEditor(game) {
        window.yuriArchive?.openGameEditor(game || null);
    }

    function editButton(game) {
        if (!auth.can("game:edit")) return null;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "game-record-edit";
        button.textContent = "編集";
        button.setAttribute("aria-label", `${game.title || "ゲーム"}を編集`);
        button.addEventListener("click", () => openEditor(game));
        return button;
    }

    function filterGroup(title, key, options) {
        const section = document.createElement("section");
        section.className = "filter-section";
        const heading = document.createElement("p");
        heading.textContent = title;
        const choices = document.createElement("div");
        choices.className = "filter-choices";
        options.forEach((option) => {
            const button = document.createElement("button");
            button.type = "button";
            button.dataset.filterKey = key;
            button.dataset.filterValue = option;
            button.textContent = filterValueLabel(key, option);
            button.setAttribute("aria-pressed", selection[key].has(option));
            button.addEventListener("click", () => {
                selection[key].has(option) ? selection[key].delete(option) : selection[key].add(option);
                updateUrl();
                syncFilters();
                render();
            });
            choices.append(button);
        });
        section.append(heading, choices);
        return section;
    }

    function renderFilterSets() {
        const tags = [...new Set(games.flatMap(gameTags))].sort((a, b) => a.localeCompare(b, "zh-CN"));
        [document.getElementById("desktop-filters"), document.getElementById("mobile-filters")].forEach((root) => {
            root.replaceChildren(
                filterGroup("状態", "status", STATES),
                filterGroup("機種", "platforms", PLATFORMS),
                filterGroup("タグ", "tags", tags),
                filterGroup("お気に入り度", "favorite", FAVORITES)
            );
        });
    }

    function selectedValues() { return Object.values(selection).flatMap((set) => [...set]); }

    function syncFilters() {
        document.querySelectorAll("[data-filter-key]").forEach((button) => {
            button.setAttribute("aria-pressed", selection[button.dataset.filterKey].has(button.dataset.filterValue));
        });
        const active = selectedValues();
        document.getElementById("desktop-clear").hidden = !active.length;
        document.getElementById("mobile-filter-count").textContent = active.length ? `(${active.length})` : "";
        const bar = document.getElementById("active-filters");
        bar.hidden = !active.length;
        bar.replaceChildren();
        active.forEach((value) => {
            const span = document.createElement("span");
            const key = Object.entries(selection).find(([, values]) => values.has(value))?.[0] || "";
            span.textContent = filterValueLabel(key, value);
            bar.append(span);
        });
        if (active.length) {
            const clear = document.createElement("button");
            clear.type = "button";
            clear.textContent = "クリア";
            clear.addEventListener("click", clearFilters);
            bar.append(clear);
        }
    }

    function matchesAny(selected, values) {
        if (!selected.size) return true;
        return values.some((value) => selected.has(value));
    }

    function filteredGames() {
        const needle = query.trim().toLocaleLowerCase();
        return games.filter((game) => {
            const searchText = [game.title, ...gameTags(game), ...gamePlatforms(game)].join(" ").toLocaleLowerCase();
            return (!needle || searchText.includes(needle))
                && matchesAny(selection.status, [gameStatus(game)])
                && matchesAny(selection.platforms, gamePlatforms(game))
                && matchesAny(selection.tags, gameTags(game))
                && matchesAny(selection.favorite, [favoriteLevel(game)]);
        });
    }

    function createCover(game, compact = false) {
        const frame = document.createElement("div");
        frame.className = compact ? "game-index-cover" : "game-card-cover";
        const url = window.yuriArticles.safeUrl(game.cover_url);
        if (!url) {
            frame.classList.add("no-cover");
            frame.textContent = "✦";
            return frame;
        }
        const image = document.createElement("img");
        image.src = url;
        image.alt = `${game.title || "Game"} cover`;
        image.loading = "lazy";
        image.addEventListener("error", () => { frame.classList.add("no-cover"); frame.replaceChildren("✦"); }, { once: true });
        frame.append(image);
        return frame;
    }

    function createGridCard(game, index) {
        const shell = document.createElement("article");
        shell.className = "game-record-shell";
        const card = document.createElement("a");
        card.className = "game-card";
        card.href = `game.html?id=${encodeURIComponent(game.id)}`;
        card.addEventListener("click", () => navigation?.capture({ label: "Games Archive" }));
        card.append(createCover(game));
        const copy = document.createElement("div");
        copy.className = "game-card-copy";
        const number = document.createElement("p");
        number.className = "game-card-number";
        number.textContent = `記録 ${String(game.sort_order ?? index + 1).padStart(3, "0")}`;
        const title = document.createElement("h3");
        title.textContent = game.title || "タイトル未設定";
        const meta = document.createElement("p");
        meta.className = "game-card-meta";
        meta.textContent = [statusLabel(gameStatus(game)), ...gamePlatforms(game)].filter(Boolean).join(" · ") || "未分類";
        const foot = document.createElement("div");
        foot.className = "game-card-foot";
        const tags = gameTags(game);
        const tagLine = document.createElement("p");
        tagLine.textContent = tags.slice(0, 3).map((tag) => `#${tag}`).join(" ") + (tags.length > 3 ? `  +${tags.length - 3}` : "");
        const rating = document.createElement("strong");
        rating.innerHTML = `<span>評価</span>${ratingText(game.rating)}`;
        foot.append(tagLine, rating);
        copy.append(number, title, meta, foot);
        card.append(copy);
        shell.append(card);
        const edit = editButton(game);
        if (edit) shell.append(edit);
        return shell;
    }

    function createIndexRow(game, index) {
        const shell = document.createElement("article");
        shell.className = "game-index-shell";
        const row = document.createElement("a");
        row.className = "game-index-row";
        row.href = `game.html?id=${encodeURIComponent(game.id)}`;
        row.addEventListener("click", () => navigation?.capture({ label: "Games Archive" }));
        const no = document.createElement("span"); no.textContent = String(index + 1).padStart(3, "0");
        row.append(no, createCover(game, true));
        const title = document.createElement("strong"); title.textContent = game.title || "タイトル未設定";
        const state = document.createElement("span"); state.textContent = gameStatus(game) ? statusLabel(gameStatus(game)) : "—";
        const platform = document.createElement("span"); platform.textContent = gamePlatforms(game).join(" · ") || "—";
        const rating = document.createElement("span"); rating.textContent = ratingText(game.rating);
        row.append(title, state, platform, rating);
        shell.append(row);
        const edit = editButton(game);
        if (edit) shell.append(edit);
        return shell;
    }

    function render() {
        const matches = filteredGames();
        list.className = view === "grid" ? "games-grid" : "games-index-list";
        list.replaceChildren(...matches.map((game, index) => view === "grid" ? createGridCard(game, index) : createIndexRow(game, index)));
        list.hidden = false;
        statusLine.hidden = Boolean(matches.length);
        statusLine.textContent = games.length ? "条件に合うゲームがありません。" : "最初のゲーム記録を待っています。";
        document.getElementById("games-count").textContent = `${String(matches.length).padStart(2, "0")} / ${String(games.length).padStart(2, "0")} 件`;
        document.getElementById("games-result-heading").textContent = selectedValues().length || query ? "選んだゲーム" : "すべてのゲーム";
        document.querySelectorAll("[data-view]").forEach((button) => button.setAttribute("aria-pressed", button.dataset.view === view));
    }

    function clearFilters() {
        Object.values(selection).forEach((set) => set.clear());
        updateUrl();
        syncFilters();
        render();
    }

    function closeSheet() { sheet.hidden = true; document.body.classList.remove("sheet-open"); }
    function openSheet() { sheet.hidden = false; document.body.classList.add("sheet-open"); document.getElementById("close-filters").focus(); }

    document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
        view = button.dataset.view;
        localStorage.setItem("kiora:games-view", view);
        updateUrl();
        render();
    }));
    [document.getElementById("games-search"), document.getElementById("games-search-mobile")].forEach((input) => input.addEventListener("input", (event) => {
        query = event.target.value;
        document.getElementById("games-search").value = query;
        document.getElementById("games-search-mobile").value = query;
        updateUrl();
        render();
    }));
    document.getElementById("desktop-clear").addEventListener("click", clearFilters);
    document.getElementById("mobile-clear").addEventListener("click", clearFilters);
    document.getElementById("open-filters").addEventListener("click", openSheet);
    document.getElementById("close-filters").addEventListener("click", closeSheet);
    document.querySelector(".filter-sheet-backdrop").addEventListener("click", closeSheet);
    document.getElementById("apply-filters").addEventListener("click", closeSheet);
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !sheet.hidden) closeSheet(); });

    const [{ data, error }] = await Promise.all([
        db.from("games").select("*").order("sort_order", { ascending: true, nullsFirst: false }),
        auth.initialize(db)
    ]);
    if (error) {
        statusLine.textContent = `Archive unavailable: ${error.message}`;
        return;
    }
    games = data || [];
    document.getElementById("games-search").value = query;
    document.getElementById("games-search-mobile").value = query;
    renderFilterSets();
    syncFilters();
    render();
    navigation?.restore();

    window.addEventListener("yuri:gameschange", (event) => {
        games = Array.isArray(event.detail?.games) ? event.detail.games : [];
        renderFilterSets();
        syncFilters();
        render();
    });

    window.addEventListener("yuri:authchange", () => {
        render();
        renderAdminAction();
    });

    function renderAdminAction() {
        const admin = document.getElementById("games-admin-actions");
        admin.replaceChildren();
        if (!auth.can("game:create")) return;
        const add = document.createElement("button");
        add.type = "button";
        add.textContent = "＋ ADD RECORD";
        add.addEventListener("click", () => openEditor(null));
        admin.append(add);
    }
    renderAdminAction();
})();
