(async function () {
    "use strict";

    const common = window.yuriArticles;
    const db = common.getClient();
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    const status = document.getElementById("game-detail-status");
    const detail = document.getElementById("game-detail");

    function returnToGames() {
        if (document.referrer && new URL(document.referrer).pathname.endsWith("/games.html")) {
            history.back();
            return;
        }
        window.location.href = "games.html";
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

    const plainText = (markdown) => {
        const holder = document.createElement("div");
        holder.innerHTML = common.markdownToHtml(markdown || "");
        return holder.textContent.trim();
    };

    const formatTags = (value) => {
        if (Array.isArray(value)) return value.filter(Boolean);
        if (typeof value === "string") return value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
        return [];
    };

    if (!id) {
        status.textContent = "缺少游戏档案 ID。";
        return;
    }

    const [{ data: game, error }, sessionResult] = await Promise.all([
        db.from("games").select("*").eq("id", id).maybeSingle(),
        db.auth.getSession()
    ]);
    if (error || !game) {
        status.textContent = error?.message || "这条游戏档案不存在。";
        return;
    }

    const archiveNumber = String(game.sort_order ?? game.id).padStart(3, "0");
    document.title = `${game.title || "Game Archive"} · Kiora`;
    document.getElementById("game-detail-archive-number").textContent = `ARCHIVE ${archiveNumber}`;
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

    document.getElementById("game-detail-rating").textContent = game.rating !== null && game.rating !== undefined && game.rating !== ""
        ? `✦ ${game.rating} / 10`
        : "UNRATED";

    const playStatus = firstValue(game, ["play_status", "status"]);
    if (playStatus) {
        document.getElementById("game-status-fact").hidden = false;
        document.getElementById("game-detail-play-status").textContent = String(playStatus).toUpperCase();
    }

    const playedAt = firstValue(game, ["played_at", "play_date", "completed_at", "started_at", "created_at"]);
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
    document.getElementById("game-detail-keywords-label").hidden = !tags.length;

    const platforms = formatTags(game.platforms).map((item) => item.toUpperCase());
    if (platforms.length) {
        document.getElementById("game-platform-fact").hidden = false;
        document.getElementById("game-detail-platforms").textContent = platforms.join(" · ");
    }

    const favorite = firstValue(game, ["favorite_level"]);
    if (favorite) {
        document.getElementById("game-favorite-fact").hidden = false;
        document.getElementById("game-detail-favorite").textContent = String(favorite).toUpperCase();
    }

    const description = firstValue(game, ["description", "summary", "introduction"]);
    if (description) {
        document.getElementById("game-description-section").hidden = false;
        document.getElementById("game-detail-description").innerHTML = common.markdownToHtml(description);
    }

    const note = firstValue(game, ["note", "long_review", "review"]);
    if (note) {
        document.getElementById("game-note-preview").hidden = false;
        document.getElementById("game-note-preview-text").textContent = plainText(note);
        document.getElementById("game-note-section").hidden = false;
        document.getElementById("game-detail-note").innerHTML = common.markdownToHtml(note);
    }

    const links = [];
    const officialUrl = common.safeUrl(game.official_site_url);
    if (officialUrl) links.push({ label: "OFFICIAL SITE", url: officialUrl });
    let storeLinks = game.store_links;
    if (typeof storeLinks === "string") {
        try { storeLinks = JSON.parse(storeLinks); } catch (_) { storeLinks = []; }
    }
    if (Array.isArray(storeLinks)) {
        storeLinks.forEach((item) => {
            const url = common.safeUrl(item?.url);
            if (url) links.push({ label: String(item?.label || "STORE").toUpperCase(), url });
        });
    }
    if (links.length) {
        const linkContainer = document.getElementById("game-detail-links");
        links.forEach((item) => {
            const anchor = document.createElement("a");
            anchor.href = item.url;
            anchor.target = "_blank";
            anchor.rel = "noopener noreferrer";
            anchor.textContent = `${item.label} ↗`;
            linkContainer.append(anchor);
        });
        document.getElementById("game-links-section").hidden = false;
    }

    const isAdmin = Boolean(sessionResult.data.session?.user);
    if (isAdmin) {
        const actions = document.getElementById("game-admin-actions");
        document.getElementById("game-edit-record").href = `index.html?editGame=${encodeURIComponent(game.id)}#games`;
        document.getElementById("game-add-character").href = `index.html?editGame=${encodeURIComponent(game.id)}&addCharacter=1#games`;
        actions.hidden = false;
    }

    const { data: characters, error: characterError } = await db.from("characters")
        .select("*")
        .eq("game_id", game.id)
        .order("sort_order", { ascending: true, nullsFirst: false });
    if (characterError) console.warn("Character archive could not be loaded:", characterError.message);
    if (characters?.length) {
        const list = document.getElementById("game-character-list");
        characters.forEach((character, index) => {
            const card = document.createElement("article");
            card.className = "game-character-card";

            const imageUrl = common.safeUrl(character.image_url);
            if (imageUrl) {
                card.classList.add("has-image");
                const image = document.createElement("img");
                image.className = "game-character-image";
                image.src = imageUrl;
                image.alt = character.name || "Character";
                image.loading = "lazy";
                image.addEventListener("error", () => {
                    image.remove();
                    card.classList.remove("has-image");
                }, { once: true });
                card.append(image);
            }

            const copy = document.createElement("div");
            copy.className = "game-character-copy";
            const meta = document.createElement("p");
            meta.className = "game-character-meta";
            meta.textContent = `CHARACTER ${String(index + 1).padStart(2, "0")}${character.rating !== null && character.rating !== undefined ? `  /  ✦ ${character.rating}` : ""}`;
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
                review.textContent = plainText(character.review);
                copy.append(review);

                const record = document.createElement("details");
                record.className = "game-character-record";
                const toggle = document.createElement("summary");
                toggle.textContent = "VIEW RECORD →";
                const full = document.createElement("div");
                full.className = "game-character-full";
                full.innerHTML = common.markdownToHtml(character.review);
                record.append(toggle, full);
                copy.append(record);
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
