(async function () {
    "use strict";

    const common = window.yuriArticles;
    const db = common.getClient();
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    const status = document.getElementById("game-detail-status");
    const detail = document.getElementById("game-detail");

    function returnToGames() {
        const stored = sessionStorage.getItem("yuri:return-scroll");
        if (stored) sessionStorage.setItem("yuri:restore-scroll", stored);
        window.location.href = "index.html#games";
    }

    document.getElementById("game-back").addEventListener("click", returnToGames);
    document.getElementById("game-back-bottom").addEventListener("click", returnToGames);

    const firstValue = (record, keys) => {
        for (const key of keys) {
            if (record[key] !== null && record[key] !== undefined && record[key] !== "") return record[key];
        }
        return "";
    };

    const setOptionalText = (elementId, value) => {
        const element = document.getElementById(elementId);
        element.textContent = value || "";
        element.hidden = !value;
    };

    function formatTags(value) {
        if (Array.isArray(value)) return value.filter(Boolean);
        if (typeof value === "string") return value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
        return [];
    }

    if (!id) {
        status.textContent = "缺少游戏档案 ID。";
        return;
    }

    const { data: game, error } = await db.from("games").select("*").eq("id", id).maybeSingle();
    if (error || !game) {
        status.textContent = error?.message || "这条游戏档案不存在。";
        return;
    }

    document.title = `${game.title || "Game Archive"} · Kiora`;
    document.getElementById("game-detail-title").textContent = game.title || "UNTITLED";
    setOptionalText("game-detail-original", firstValue(game, ["original_title", "title_jp", "japanese_title"]));

    const coverUrl = common.safeUrl(game.cover_url);
    const cover = document.getElementById("game-detail-cover");
    if (coverUrl) {
        cover.src = coverUrl;
        cover.alt = `${game.title || "Game"} cover`;
        cover.hidden = false;
        document.getElementById("game-detail-cover-placeholder").hidden = true;
    }

    const rating = game.rating !== null && game.rating !== undefined && game.rating !== ""
        ? `✦ ${game.rating} / 10`
        : "UNRATED";
    document.getElementById("game-detail-rating").textContent = rating;

    const playStatus = firstValue(game, ["play_status", "status"]);
    if (playStatus) {
        document.getElementById("game-status-fact").hidden = false;
        document.getElementById("game-detail-play-status").textContent = playStatus;
    }

    const playedAt = firstValue(game, ["played_at", "play_date", "completed_at", "started_at"]);
    if (playedAt) {
        document.getElementById("game-date-fact").hidden = false;
        document.getElementById("game-detail-date").textContent = common.formatDate(playedAt);
    }

    const tags = formatTags(game.tags);
    const tagContainer = document.getElementById("game-detail-tags");
    tags.forEach((tag) => {
        const span = document.createElement("span");
        span.textContent = tag;
        tagContainer.append(span);
    });
    tagContainer.hidden = !tags.length;

    const description = firstValue(game, ["description", "summary", "introduction"]);
    if (description) {
        document.getElementById("game-description-section").hidden = false;
        document.getElementById("game-detail-description").innerHTML = common.markdownToHtml(description);
    }

    const note = firstValue(game, ["note", "long_review", "review"]);
    if (note) {
        document.getElementById("game-note-section").hidden = false;
        document.getElementById("game-detail-note").innerHTML = common.markdownToHtml(note);
    }

    const { data: characters, error: characterError } = await db.from("characters")
        .select("*")
        .eq("game_id", game.id)
        .order("sort_order", { ascending: true, nullsFirst: false });
    if (characterError) console.warn("Character archive could not be loaded:", characterError.message);
    if (characters?.length) {
        const list = document.getElementById("game-character-list");
        characters.forEach((character) => {
            const card = document.createElement("article");
            card.className = "game-character-card";
            const imageUrl = common.safeUrl(character.image_url);
            if (imageUrl) {
                const image = document.createElement("img");
                image.src = imageUrl;
                image.alt = character.name || "Character";
                image.loading = "lazy";
                card.append(image);
            }
            const copy = document.createElement("div");
            const meta = document.createElement("p");
            meta.className = "game-character-meta";
            meta.textContent = character.rating !== null && character.rating !== undefined ? `ROUTE / ${character.rating}` : "ROUTE NOTE";
            const heading = document.createElement("h3");
            heading.textContent = character.name || "CHARACTER";
            copy.append(meta, heading);
            if (character.subtitle) {
                const subtitle = document.createElement("p");
                subtitle.className = "game-character-subtitle";
                subtitle.textContent = character.subtitle;
                copy.append(subtitle);
            }
            if (character.review) {
                const review = document.createElement("div");
                review.className = "game-character-review";
                review.innerHTML = common.markdownToHtml(character.review);
                copy.append(review);
            }
            card.append(copy);
            list.append(card);
        });
        document.getElementById("game-character-count").textContent = `${characters.length} ROUTE${characters.length === 1 ? "" : "S"}`;
        document.getElementById("game-characters-section").hidden = false;
    }

    const updatedAt = firstValue(game, ["updated_at", "created_at"]);
    document.getElementById("game-detail-updated").textContent = updatedAt ? `UPDATED / ${common.formatDate(updatedAt)}` : "";
    status.hidden = true;
    detail.hidden = false;
})();
