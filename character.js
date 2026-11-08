(async function () {
    "use strict";

    const common = window.yuriArticles;
    const db = common.getClient();
    const auth = window.KioraAuth;
    const navigation = window.KioraNavigation;
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    const status = document.getElementById("character-status");
    const detail = document.getElementById("character-detail");

    if (!id) {
        status.textContent = "缺少角色档案 ID。";
        return;
    }

    await auth.initialize(db);
    const { data: character, error } = await db.from("characters").select("*").eq("id", id).maybeSingle();
    if (error || !character) {
        status.textContent = error?.message || "这条角色档案不存在。";
        return;
    }

    const gameId = character.game_id ?? params.get("gameId");
    const { data: game } = gameId
        ? await db.from("games").select("id,title").eq("id", gameId).maybeSingle()
        : { data: null };
    const backPath = gameId ? `game-record.html?id=${encodeURIComponent(gameId)}` : "games.html";
    document.getElementById("character-back").href = backPath;
    document.getElementById("character-back-bottom").href = backPath;
    [document.getElementById("character-back"), document.getElementById("character-back-bottom")].forEach((link) => {
        link.addEventListener("click", (event) => {
            if (!navigation?.peek()) return;
            event.preventDefault();
            navigation.back(backPath);
        });
    });

    document.title = `${character.name || "Character Record"} · Kiora`;
    document.getElementById("character-index").textContent = `CHARACTER ${String(character.sort_order ?? character.id).padStart(2, "0")}`;
    document.getElementById("character-name").textContent = character.name || "CHARACTER";
    document.getElementById("character-rating").textContent = character.rating !== null && character.rating !== undefined && character.rating !== ""
        ? `${character.rating} / 10`
        : "—";
    document.getElementById("character-game-title").textContent = game?.title || "GAME ARCHIVE";
    const gameLink = document.getElementById("character-game-link");
    gameLink.href = gameId ? `game.html?id=${encodeURIComponent(gameId)}` : "games.html";
    gameLink.addEventListener("click", () => navigation?.capture({ label: character.name || "Character" }));

    if (gameId && auth.can("character:edit")) {
        const edit = document.getElementById("character-edit");
        edit.href = `games.html?editGame=${encodeURIComponent(gameId)}&gameSection=characters&editCharacter=${encodeURIComponent(character.id)}`;
        edit.hidden = false;
        edit.addEventListener("click", () => navigation?.capture({ label: character.name || "Character" }));
    }

    if (character.subtitle) {
        document.getElementById("character-subtitle").textContent = character.subtitle;
        document.getElementById("character-subtitle").hidden = false;
    }

    const imageUrl = common.safeUrl(character.image_url);
    if (imageUrl) {
        const header = document.querySelector(".character-detail-header");
        const frame = document.getElementById("character-image-frame");
        const image = document.getElementById("character-image");
        header.classList.add("has-image");
        image.src = imageUrl;
        image.alt = character.name || "Character";
        frame.hidden = false;
        image.addEventListener("error", () => {
            frame.remove();
            header.classList.remove("has-image");
        }, { once: true });
    }

    if (character.review) {
        document.getElementById("character-review").innerHTML = common.markdownToHtml(character.review);
        document.getElementById("character-review-section").hidden = false;
    }

    status.hidden = true;
    detail.hidden = false;
    navigation?.restore();
})();
