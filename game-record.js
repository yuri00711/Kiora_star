(async function () {
    "use strict";

    const common = window.yuriArticles;
    const db = common.getClient();
    const id = new URLSearchParams(window.location.search).get("id");
    const status = document.getElementById("record-status");
    const record = document.getElementById("full-game-record");

    if (!id) {
        status.textContent = "缺少游戏档案 ID。";
        return;
    }

    const gamePath = `game.html?id=${encodeURIComponent(id)}`;
    document.getElementById("record-back").href = gamePath;
    document.getElementById("record-back-bottom").href = gamePath;

    const [{ data: game, error }, { data: characters, error: characterError }] = await Promise.all([
        db.from("games").select("*").eq("id", id).maybeSingle(),
        db.from("characters").select("*").eq("game_id", id).order("sort_order", { ascending: true, nullsFirst: false }),
        window.KioraAuth.initialize(db)
    ]);
    if (error || !game) {
        status.textContent = error?.message || "这条游戏档案不存在。";
        return;
    }
    if (characterError) console.warn("Character archive could not be loaded:", characterError.message);

    const archiveNumber = String(game.sort_order ?? game.id).padStart(3, "0");
    document.title = `${game.title || "Game"} · Full Record · Kiora`;
    document.getElementById("record-archive-number").textContent = `ARCHIVE ${archiveNumber} / FULL RECORD`;
    document.getElementById("record-title").textContent = game.title || "UNTITLED";

    const original = common.firstValue(game, ["original_title", "title_jp", "japanese_title"]);
    if (original) {
        document.getElementById("record-original").textContent = original;
        document.getElementById("record-original").hidden = false;
    }

    document.getElementById("record-rating").textContent = game.rating !== null && game.rating !== undefined && game.rating !== ""
        ? `✦ ${game.rating} / 10`
        : "UNRATED";
    const startedDate = common.formatPureDate(common.firstValue(game, ["started_at", "start_date"]));
    const completedDate = common.formatPureDate(common.firstValue(game, ["completed_at", "completed_date", "finished_at", "played_at", "played_date"]));
    document.getElementById("record-played").textContent = startedDate && completedDate
        ? `${startedDate} — ${completedDate}`
        : startedDate
            ? `${startedDate} —`
            : completedDate || "—";
    document.getElementById("record-played-fact").hidden = false;

    const description = common.firstValue(game, ["description", "summary", "introduction"]);
    if (description) {
        document.getElementById("record-description").innerHTML = common.markdownToHtml(description);
        document.getElementById("record-description-section").hidden = false;
    }

    const note = common.firstValue(game, ["note", "long_review", "review"]);
    if (note) {
        document.getElementById("record-note").innerHTML = common.markdownToHtml(note);
        document.getElementById("record-note-section").hidden = false;
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
        const container = document.getElementById("record-links");
        links.forEach((item) => {
            const anchor = document.createElement("a");
            anchor.href = item.url;
            anchor.target = "_blank";
            anchor.rel = "noopener noreferrer";
            anchor.textContent = `${item.label} ↗`;
            container.append(anchor);
        });
        document.getElementById("record-links-section").hidden = false;
    }

    const characterList = Array.isArray(characters) ? characters : [];
    const list = document.getElementById("record-character-list");
    characterList.forEach((character, index) => {
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
            const preview = document.createElement("p");
            preview.className = "game-character-review";
            preview.textContent = common.truncateText(common.plainText(character.review), 150);
            copy.append(preview);
        }

        const view = document.createElement("a");
        view.className = "game-character-view";
        view.href = `character.html?id=${encodeURIComponent(character.id)}&gameId=${encodeURIComponent(game.id)}`;
        view.textContent = "VIEW RECORD →";
        copy.append(view);
        card.append(copy);
        list.append(card);
    });

    document.getElementById("record-character-count").textContent = `${String(characterList.length).padStart(2, "0")} ROUTE${characterList.length === 1 ? "" : "S"}`;
    document.getElementById("record-character-empty").hidden = characterList.length !== 0;

    const updatedAt = common.firstValue(game, ["updated_at", "created_at"]);
    document.getElementById("record-updated").textContent = updatedAt ? `UPDATED / ${common.formatDate(updatedAt)}` : "";
    status.hidden = true;
    record.hidden = false;
})();
