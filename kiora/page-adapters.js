(function () {
    "use strict";

    const broker = window.KioraContextBroker;
    if (!broker) return;
    const params = () => new URLSearchParams(location.search);
    const text = (...selectors) => {
        for (const selector of selectors) {
            const value = document.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim();
            if (value) return value;
        }
        return "";
    };
    const common = (page, visible = {}, privateContent = []) => ({ page, visible, private: privateContent });

    broker.register("home", () => common("home", { section: "home", title: "Kiora" }));
    broker.register("about", () => common("about", {
        section: "about",
        profile_name: text("#profile-display-name"),
        currently_playing: text("#profile-current-game"),
        currently_playing_subtitle: text("#profile-current-subtitle")
    }, ["profile private fields"]));
    broker.register("archive", () => common("archive", { section: "music archive", title: text("#music-archive-title") || "Music Archive" }));
    broker.register("games", () => common("games", { section: "games archive", filter: text("#games-result-heading"), result_count: text("#games-count") }));
    broker.register("game", () => common("game", {
        entity_type: "game", entity_id: params().get("id") || "", title: text("#game-detail-title"), status: text("#game-detail-play-status")
    }, ["full game review"]));
    broker.register("game-record", () => common("game_record", {
        entity_type: "game", entity_id: params().get("id") || "", title: text("#record-title")
    }, ["long review", "repo editor content"]));
    broker.register("character", () => common("character", {
        entity_type: "character", entity_id: params().get("id") || "", name: text("#character-name"), game: text("#character-game-title")
    }, ["character review"]));
    broker.register("writing", () => common("writing", { section: "writing archive", title: "Writing" }));
    broker.register("read", () => common("read", {
        entity_type: "writing", entity_id: params().get("id") || "", title: text("#article-title"), subtitle: text("#article-subtitle")
    }, ["article body"]));
    broker.register("write", () => common("write", {
        entity_type: "writing draft", entity_id: params().get("id") || "new", title: document.querySelector("#write-title")?.value || text("#write-page-title")
    }, ["draft body", "unpublished metadata"]));
    broker.register("study", () => common("study", {
        section: "study",
        active_view: document.querySelector(".study-view:not([hidden])")?.dataset.view || "home"
    }, ["answers", "notes", "private study files"]));
    broker.register("sale", () => common("sale", { section: "sale", region: document.body.dataset.saleRegion || "overview" }, ["wallet records"]));
    broker.register("tier-board", () => common("tier_board", { title: text("#board-title") || "Tier Board", description: text("#board-description") }));
    broker.register("export-profile", () => common("profile_export", { section: "profile export" }, ["profile export source"]));
    broker.register("currently-playing", () => common("about", { section: "currently playing editor" }, ["currently playing draft"]));
    broker.register("default", () => common("unknown", { document_title: document.title }));
})();
