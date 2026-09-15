(async function () {
    "use strict";

    const db = window.yuriArticles.getClient();
    const STATES = ["PLAYING", "COMPLETED", "PAUSED", "DROPPED", "WISHLIST"];
    const PLATFORMS = ["SWITCH", "STEAM", "PC", "PSVITA", "PSP", "PS4", "PS5", "MOBILE", "OTHER"];
    const FAVORITES = ["FAVORITE", "LOVE", "LIKE", "NEUTRAL", "NOT FOR ME"];
    const selection = { status: new Set(), platforms: new Set(), tags: new Set(), favorite: new Set() };
    let games = [];
    let query = "";
    let view = localStorage.getItem("kiora:games-view") === "index" ? "index" : "grid";

    const list = document.getElementById("games-list");
    const statusLine = document.getElementById("games-status");
    const sheet = document.getElementById("filter-sheet");

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
    const favoriteLevel = (game) => String(game.favorite_level || "").toUpperCase();

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
            button.textContent = option;
            button.setAttribute("aria-pressed", selection[key].has(option));
            button.addEventListener("click", () => {
                selection[key].has(option) ? selection[key].delete(option) : selection[key].add(option);
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
                filterGroup("STATUS", "status", STATES),
                filterGroup("PLATFORM", "platforms", PLATFORMS),
                filterGroup("TAGS", "tags", tags),
                filterGroup("FAVORITE LEVEL", "favorite", FAVORITES)
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
            span.textContent = value;
            bar.append(span);
        });
        if (active.length) {
            const clear = document.createElement("button");
            clear.type = "button";
            clear.textContent = "CLEAR";
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
        const card = document.createElement("a");
        card.className = "game-card";
        card.href = `game.html?id=${encodeURIComponent(game.id)}`;
        card.append(createCover(game));
        const copy = document.createElement("div");
        copy.className = "game-card-copy";
        const number = document.createElement("p");
        number.className = "game-card-number";
        number.textContent = `ARCHIVE ${String(game.sort_order ?? index + 1).padStart(3, "0")}`;
        const title = document.createElement("h3");
        title.textContent = game.title || "UNTITLED";
        const meta = document.createElement("p");
        meta.className = "game-card-meta";
        meta.textContent = [gameStatus(game), ...gamePlatforms(game)].filter(Boolean).join(" · ") || "UNFILED";
        const foot = document.createElement("div");
        foot.className = "game-card-foot";
        const tags = gameTags(game);
        const tagLine = document.createElement("p");
        tagLine.textContent = tags.slice(0, 3).map((tag) => `#${tag}`).join(" ") + (tags.length > 3 ? `  +${tags.length - 3}` : "");
        const rating = document.createElement("strong");
        rating.innerHTML = `<span>RATING</span>${ratingText(game.rating)}`;
        foot.append(tagLine, rating);
        copy.append(number, title, meta, foot);
        card.append(copy);
        return card;
    }

    function createIndexRow(game, index) {
        const row = document.createElement("a");
        row.className = "game-index-row";
        row.href = `game.html?id=${encodeURIComponent(game.id)}`;
        const no = document.createElement("span"); no.textContent = String(index + 1).padStart(3, "0");
        row.append(no, createCover(game, true));
        const title = document.createElement("strong"); title.textContent = game.title || "UNTITLED";
        const state = document.createElement("span"); state.textContent = gameStatus(game) || "—";
        const platform = document.createElement("span"); platform.textContent = gamePlatforms(game).join(" · ") || "—";
        const rating = document.createElement("span"); rating.textContent = ratingText(game.rating);
        row.append(title, state, platform, rating);
        return row;
    }

    function render() {
        const matches = filteredGames();
        list.className = view === "grid" ? "games-grid" : "games-index-list";
        list.replaceChildren(...matches.map((game, index) => view === "grid" ? createGridCard(game, index) : createIndexRow(game, index)));
        list.hidden = false;
        statusLine.hidden = Boolean(matches.length);
        statusLine.textContent = games.length ? "No records found in this constellation." : "The archive is still waiting for its first record.";
        document.getElementById("games-count").textContent = `${String(matches.length).padStart(2, "0")} / ${String(games.length).padStart(2, "0")} RECORDS`;
        document.getElementById("games-result-heading").textContent = selectedValues().length || query ? "Selected records" : "All records";
        document.querySelectorAll("[data-view]").forEach((button) => button.setAttribute("aria-pressed", button.dataset.view === view));
    }

    function clearFilters() {
        Object.values(selection).forEach((set) => set.clear());
        syncFilters();
        render();
    }

    function closeSheet() { sheet.hidden = true; document.body.classList.remove("sheet-open"); }
    function openSheet() { sheet.hidden = false; document.body.classList.add("sheet-open"); document.getElementById("close-filters").focus(); }

    document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
        view = button.dataset.view;
        localStorage.setItem("kiora:games-view", view);
        render();
    }));
    [document.getElementById("games-search"), document.getElementById("games-search-mobile")].forEach((input) => input.addEventListener("input", (event) => {
        query = event.target.value;
        document.getElementById("games-search").value = query;
        document.getElementById("games-search-mobile").value = query;
        render();
    }));
    document.getElementById("desktop-clear").addEventListener("click", clearFilters);
    document.getElementById("mobile-clear").addEventListener("click", clearFilters);
    document.getElementById("open-filters").addEventListener("click", openSheet);
    document.getElementById("close-filters").addEventListener("click", closeSheet);
    document.querySelector(".filter-sheet-backdrop").addEventListener("click", closeSheet);
    document.getElementById("apply-filters").addEventListener("click", closeSheet);
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !sheet.hidden) closeSheet(); });

    const [{ data, error }, sessionResult] = await Promise.all([
        db.from("games").select("*").order("sort_order", { ascending: true, nullsFirst: false }),
        db.auth.getSession()
    ]);
    if (error) {
        statusLine.textContent = `Archive unavailable: ${error.message}`;
        return;
    }
    games = data || [];
    renderFilterSets();
    syncFilters();
    render();

    if (sessionResult.data.session?.user) {
        const admin = document.getElementById("games-admin-actions");
        const add = document.createElement("a");
        add.href = "games.html?newGame=1";
        add.textContent = "＋ ADD RECORD";
        admin.append(add);
    }
})();
