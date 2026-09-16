(async function () {
    "use strict";

    const common = window.yuriArticles;
    const db = common.getClient();
    const auth = window.KioraAuth;
    const id = new URLSearchParams(window.location.search).get("id");
    const status = document.getElementById("game-detail-status");
    const detail = document.getElementById("game-detail");

    document.getElementById("game-back").addEventListener("click", () => {
        window.location.href = "games.html";
    });

    const setOptionalText = (elementId, value) => {
        const element = document.getElementById(elementId);
        element.textContent = value || "";
        element.hidden = !value;
    };

    if (!id) {
        status.textContent = "缺少游戏档案 ID。";
        return;
    }

    const [{ data: game, error }] = await Promise.all([
        db.from("games").select("*").eq("id", id).maybeSingle(),
        auth.initialize(db)
    ]);
    if (error || !game) {
        status.textContent = error?.message || "这条游戏档案不存在。";
        return;
    }

    const archiveNumber = String(game.sort_order ?? game.id).padStart(3, "0");
    document.title = `${game.title || "Game Archive"} · Kiora`;
    document.getElementById("game-detail-archive-number").textContent = `ARCHIVE ${archiveNumber}`;
    document.getElementById("game-detail-title").textContent = game.title || "UNTITLED";
    setOptionalText("game-detail-original", common.firstValue(game, ["original_title", "title_jp", "japanese_title"]));

    const coverUrl = common.safeUrl(game.cover_url);
    const cover = document.getElementById("game-detail-cover");
    if (coverUrl) {
        cover.src = coverUrl;
        cover.alt = `${game.title || "Game"} cover`;
        cover.hidden = false;
        document.getElementById("game-detail-cover-placeholder").hidden = true;
        cover.addEventListener("error", () => {
            cover.hidden = true;
            document.getElementById("game-detail-cover-placeholder").hidden = false;
        }, { once: true });
    }

    document.getElementById("game-detail-rating").textContent = game.rating !== null && game.rating !== undefined && game.rating !== ""
        ? `✦ ${game.rating} / 10`
        : "UNRATED";

    const playStatus = common.firstValue(game, ["play_status", "status"]);
    if (playStatus) {
        document.getElementById("game-status-fact").hidden = false;
        document.getElementById("game-detail-play-status").textContent = String(playStatus).toUpperCase();
    }

    const startedDate = common.formatPureDate(common.firstValue(game, ["started_at", "start_date"]));
    const completedDate = common.formatPureDate(common.firstValue(game, ["completed_at", "completed_date", "finished_at", "played_at", "played_date"]));
    const playedText = startedDate && completedDate
        ? `${startedDate} — ${completedDate}`
        : startedDate
            ? `${startedDate} —`
            : completedDate || "—";
    document.getElementById("game-date-fact").hidden = false;
    document.getElementById("game-detail-date").textContent = playedText;

    const platforms = common.formatList(game.platforms).map((item) => item.toUpperCase());
    if (platforms.length) {
        document.getElementById("game-platform-fact").hidden = false;
        document.getElementById("game-detail-platforms").textContent = platforms.join(" · ");
    }

    const favorite = common.firstValue(game, ["favorite_level"]);
    if (favorite) {
        document.getElementById("game-favorite-fact").hidden = false;
        document.getElementById("game-detail-favorite").textContent = String(favorite).toUpperCase();
    }

    const tags = common.formatList(game.tags);
    const tagContainer = document.getElementById("game-detail-tags");
    tags.forEach((tag) => {
        const span = document.createElement("span");
        span.textContent = tag;
        tagContainer.append(span);
    });
    tagContainer.hidden = !tags.length;
    document.getElementById("game-detail-keywords-label").hidden = !tags.length;

    const note = common.firstValue(game, ["note", "long_review", "review"]);
    if (note) {
        document.getElementById("game-note-preview").hidden = false;
        document.getElementById("game-note-preview-text").textContent = common.truncateText(common.plainText(note), 240);
        document.getElementById("game-read-full-note").href = `game-record.html?id=${encodeURIComponent(game.id)}`;
    }

    if (auth.can("game:edit") || auth.can("character:create")) {
        document.getElementById("game-edit-record").href = `games.html?editGame=${encodeURIComponent(game.id)}`;
        document.getElementById("game-add-character").href = `games.html?editGame=${encodeURIComponent(game.id)}&addCharacter=1`;
        document.getElementById("game-admin-actions").hidden = false;
    }

    status.hidden = true;
    detail.hidden = false;
})();
