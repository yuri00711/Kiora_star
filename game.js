(async function () {
    "use strict";

    const common = window.yuriArticles;
    const db = common.getClient();
    const auth = window.KioraAuth;
    const navigation = window.KioraNavigation;
    const id = new URLSearchParams(window.location.search).get("id");
    const status = document.getElementById("game-detail-status");
    const detail = document.getElementById("game-detail");

    document.getElementById("game-back").addEventListener("click", () => {
        if (navigation) navigation.back("games.html");
        else window.location.replace("games.html");
    });

    const returnState = navigation?.peek();
    if (returnState?.href.includes("/read.html")) {
        document.getElementById("game-back").textContent = "← かきものへ戻る";
    }

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
    window.KioraDetailState = window.KioraDetailState || {};
    window.KioraDetailState.game = game;

    const archiveNumber = String(game.sort_order ?? game.id).padStart(3, "0");
    document.title = `${game.title || "Game Archive"} · Kiora`;
    document.getElementById("game-detail-archive-number").textContent = `記録 ${archiveNumber}`;
    document.getElementById("game-detail-title").textContent = game.title || "タイトル未設定";
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
        : "未評価";

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
    }

    const openRecord = document.getElementById("game-open-record");
    openRecord.href = `game-record.html?id=${encodeURIComponent(game.id)}`;
    openRecord.addEventListener("click", () => navigation?.capture({ label: game.title }));

    if (auth.can("game:edit") || auth.can("character:create")) {
        document.getElementById("game-edit-record").hidden = !auth.can("game:edit");
        document.getElementById("game-add-character").hidden = !auth.can("character:create");
        const writeAfterglow = document.getElementById("game-write-afterglow");
        writeAfterglow.href = `write.html?type=game_review&gameId=${encodeURIComponent(game.id)}`;
        writeAfterglow.hidden = !auth.can("writing:create");
        writeAfterglow.addEventListener("click", () => navigation?.capture({ label: game.title }));
        document.getElementById("game-admin-actions").hidden = false;
    }

    let relatedWritings = [];
    if (auth.role === "editor") {
        const result = await auth.readForEditor("writing_list");
        if (!result.error) {
            relatedWritings = (result.data || []).filter((writing) =>
                String(writing.game_id || "") === String(game.id) && writing.category === "game_review"
            );
        }
    } else {
        let relatedQuery = db.from("writings")
            .select("id,title,subtitle,excerpt,published_at,is_public,game_id")
            .eq("game_id", game.id)
            .eq("category", "game_review")
            .order("published_at", { ascending: false });
        if (auth.role !== "owner") relatedQuery = relatedQuery.eq("is_public", true);
        const result = await relatedQuery;
        if (!result.error) relatedWritings = result.data || [];
    }

    if (relatedWritings.length) {
        const list = document.getElementById("game-related-writing-list");
        relatedWritings.forEach((writing) => {
            const link = document.createElement("a");
            link.href = `read.html?id=${encodeURIComponent(writing.id)}&from=game_review&gameId=${encodeURIComponent(game.id)}`;
            link.addEventListener("click", () => navigation?.capture({ label: game.title }));
            const copy = document.createElement("span");
            const label = document.createElement("small");
            label.textContent = common.formatDate(writing.published_at);
            const title = document.createElement("strong");
            title.textContent = writing.title || "タイトル未設定";
            copy.append(label, title);
            if (writing.subtitle || writing.excerpt) {
                const note = document.createElement("p");
                note.textContent = writing.subtitle || common.truncateText(writing.excerpt, 120);
                copy.append(note);
            }
            const arrow = document.createElement("i");
            arrow.textContent = "読む →";
            link.append(copy, arrow);
            list.append(link);
        });
        document.getElementById("game-related-writing-count").textContent = `${String(relatedWritings.length).padStart(2, "0")} 篇`;
        document.getElementById("game-related-writing-section").hidden = false;
    }

    status.hidden = true;
    detail.hidden = false;
    window.dispatchEvent(new CustomEvent("kiora:game-detail-ready", { detail: { game } }));
    navigation?.restore();
})();
