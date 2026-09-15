console.log("KIORA NEW SCRIPT LOADED");

/* ========================================
   滚动出现动画
======================================== */

const revealElements =
    document.querySelectorAll(".reveal");

const observer =
    new IntersectionObserver(
        (entries) => {

            entries.forEach((entry) => {

                if (entry.isIntersecting) {

                    entry.target.classList.add("active");

                }

            });

        },
        {
            threshold: 0.01,
            rootMargin: "0px 0px -8% 0px"
        }
    );


revealElements.forEach((element) => {

    observer.observe(element);

});


/* ========================================
   首页鼠标视差
======================================== */

const hero =
    document.querySelector(".hero");

const heroBg =
    document.querySelector(".hero-bg");

const heroCenter =
    document.querySelector(".hero-center");


if (hero && heroBg && heroCenter) {

    hero.addEventListener(
        "mousemove",
        (event) => {

            const rect =
                hero.getBoundingClientRect();

            const x =
                event.clientX / rect.width - 0.5;

            const y =
                event.clientY / rect.height - 0.5;


            heroBg.style.transform =
                `translate(${x * 18}px, ${y * 18}px)`;


            heroCenter.style.transform =
                `translate(${x * -7}px, ${y * -7}px)`;

        }
    );


    hero.addEventListener(
        "mouseleave",
        () => {

            heroBg.style.transform =
                "translate(0, 0)";

            heroCenter.style.transform =
                "translate(0, 0)";

        }
    );

}

/* =========================================
   SUPABASE
========================================= */

const supabaseUrl =
    "https://sqgzlaunnmwkulboyems.supabase.co";

const supabaseKey =
    "sb_publishable_B35Zjt_oIOMZw-NCswwVmw_WhWwDzVa";

const supabaseClient =
    window.supabase.createClient(
        supabaseUrl,
        supabaseKey
    );


/* =========================================
   STATE
========================================= */

let currentUser = null;
let gamesCache = [];
let requestedGameEditorOpened = false;

// Small public bridge used by the optional profile/writing CMS module.
// The existing auth and Supabase client remain the single source of truth.
window.yuriArchive = Object.freeze({
    get currentUser() {
        return currentUser;
    },
    get games() {
        return gamesCache.slice();
    },
    supabaseClient,
    openModal,
    closeModal,
    safeImageUrl
});


/* =========================================
   HELPERS
========================================= */

function openModal(modal) {

    if (!modal) return;

    modal.classList.add("active");
    if (modal.hasAttribute("data-protect-draft")) modal.dataset.dirty = "false";

    document.body.style.overflow =
        "hidden";
}


function closeModal(modal) {

    if (!modal) return;

    if (
        modal.hasAttribute("data-protect-draft") &&
        modal.dataset.dirty === "true" &&
        !window.confirm("还有未保存的修改，确定关闭编辑器吗？")
    ) return;

    modal.classList.remove("active");

    document.body.style.overflow =
        document.querySelector(".archive-modal.active") ? "hidden" : "";
}


function safeImageUrl(url) {

    if (!url) return "";

    try {

        const parsed =
            new URL(url);

        if (
            parsed.protocol === "http:" ||
            parsed.protocol === "https:"
        ) {
            return url;
        }

    } catch (_) {}

    return "";
}


/* =========================================
   ELEMENTS
========================================= */

const loginModal =
    document.getElementById(
        "login-modal"
    );

const gameModal =
    document.getElementById(
        "game-modal"
    );

const loginForm =
    document.getElementById(
        "login-form"
    );

const gameForm =
    document.getElementById(
        "game-form"
    );

const deleteGameButton =
    document.getElementById(
        "delete-game-btn"
    );

/* =========================================
   STAR LOGIN
========================================= */

const loginStar =
    document.querySelector(
        ".hero .star"
    );

if (loginStar) {

    loginStar.setAttribute(
        "role",
        "button"
    );

    loginStar.setAttribute(
        "tabindex",
        "0"
    );

    loginStar.setAttribute(
        "aria-label",
        "Archive keeper login"
    );

    loginStar.dataset.tooltip = "ADMIN";

    loginStar.addEventListener(
        "click",
        async () => {

            /*
            如果已经登录：
            点击星星询问是否退出
            */

            if (currentUser) {

                const shouldLogout =
                    window.confirm(
                        "退出档案馆管理模式？"
                    );

                if (shouldLogout) {

                    await supabaseClient
                        .auth
                        .signOut();

                }

                return;
            }

            openModal(
                loginModal
            );
        }
    );

}


/* =========================================
   CLOSE MODALS
========================================= */

document
    .querySelectorAll(
        "[data-close-modal]"
    )
    .forEach((button) => {

        button.addEventListener(
            "click",
            () => {

                closeModal(
                    button.closest(
                        ".archive-modal"
                    )
                );

            }
        );

    });


document
    .querySelectorAll(
        ".archive-modal-backdrop"
    )
    .forEach((backdrop) => {

        backdrop.addEventListener(
            "click",
            () => {

                const modal = backdrop.closest(".archive-modal");
                if (modal?.hasAttribute("data-protect-draft")) return;

                closeModal(
                    modal
                );

            }
        );

    });


/* =========================================
   LOGIN
========================================= */

if (loginForm) {

    loginForm.addEventListener(
        "submit",
        async (event) => {

            event.preventDefault();

            const username =
                document
                    .getElementById(
                        "login-username"
                    )
                    .value
                    .trim();

            const password =
                document
                    .getElementById(
                        "login-password"
                    )
                    .value;

            const message =
                document
                    .getElementById(
                        "login-message"
                    );

            message.textContent =
                "Checking archive key…";

            const {
                data,
                error
            } =
                await supabaseClient
                    .auth
                    .signInWithPassword({
                        email,
                        password
                    });

            if (error) {

                message.textContent =
                    "登录失败：" +
                    error.message;

                return;
            }

            currentUser =
                data.user;

            message.textContent =
                "";

            loginForm.reset();

            closeModal(
                loginModal
            );

            updateAdminUI();

            await loadGames();

        }
    );

}


/* =========================================
   AUTH STATE
========================================= */

async function initialiseAuth() {

    const {
        data
    } =
        await supabaseClient
            .auth
            .getSession();

    currentUser =
        data.session?.user
        ?? null;

    updateAdminUI();
    publishGames(gamesCache);

}


supabaseClient
    .auth
    .onAuthStateChange(
        (_event, session) => {

            currentUser =
                session?.user
                ?? null;

            updateAdminUI();

            publishGames(
                gamesCache
            );

        }
    );


function updateAdminUI() {
    window.dispatchEvent(
        new CustomEvent("yuri:authchange", {
            detail: { user: currentUser }
        })
    );

}


/* =========================================
   LOAD GAMES
========================================= */

async function loadGames() {

    const {
        data,
        error
    } =
        await supabaseClient
            .from("games")
            .select("*")
            .order(
                "sort_order",
                {
                    ascending: true,
                    nullsFirst: false
                }
            );

    if (error) {

        console.error(
            "读取 games 失败：",
            error
        );

        return;
    }

    gamesCache =
        data ?? [];

    publishGames(
        gamesCache
    );

}


/* =========================================
   PUBLISH GAME DATA / OPEN ADMIN EDITOR
========================================= */

function publishGames(games) {
    window.dispatchEvent(
        new CustomEvent("yuri:gameschange", {
            detail: { games: games.slice() }
        })
    );
    openRequestedGameEditor();
}

function openRequestedGameEditor() {
    if (requestedGameEditorOpened || !currentUser) return;
    const editorParams = new URLSearchParams(window.location.search);
    if (editorParams.get("newGame") === "1") {
        requestedGameEditorOpened = true;
        openGameEditor(null);
        return;
    }
    if (!gamesCache.length) return;
    const requestedId = editorParams.get("editGame");
    if (!requestedId) return;
    const game = gamesCache.find((item) => String(item.id) === requestedId);
    if (!game) return;
    requestedGameEditorOpened = true;
    openGameEditor(game);
    if (new URLSearchParams(window.location.search).get("addCharacter") === "1") {
        window.setTimeout(() => openCharacterEditor(null), 0);
    }
}


/* =========================================
   OPEN EDITOR
========================================= */

function openGameEditor(game) {

    if (!currentUser) return;

    currentGameForCharacters = game && game.id ? game : null;
    charactersCache = [];
    renderCharacterEditorList([]);
    document.getElementById("game-form-message").textContent = "";

    const id =
        document.getElementById(
            "game-id"
        );

    const title =
        document.getElementById(
            "game-title"
        );

    const review =
        document.getElementById(
            "game-review"
        );

    const rating =
        document.getElementById(
            "game-rating"
        );

    const cover =
        document.getElementById(
            "game-cover-url"
        );

    const sort =
        document.getElementById(
            "game-sort-order"
        );

    const modalTitle =
        document.getElementById(
            "game-modal-title"
        );

    const normalizeList = (value) => {
        if (Array.isArray(value)) return value.map(String).filter(Boolean);
        if (typeof value === "string") {
            try {
                const parsed = JSON.parse(value);
                if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
            } catch (_) {}
            return value.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
        }
        return [];
    };

    const formatStoreLinks = (value) => {
        let links = value;
        if (typeof links === "string") {
            try { links = JSON.parse(links); } catch (_) { links = []; }
        }
        return Array.isArray(links)
            ? links.map((item) => `${item?.label || "LINK"} | ${item?.url || ""}`).join("\n")
            : "";
    };


    if (game) {

        id.value =
            game.id;

        title.value =
            game.title ?? "";

        review.value =
            game.review ?? "";

        rating.value =
            game.rating ?? "";

        cover.value =
            game.cover_url ?? "";

        sort.value =
            game.sort_order ?? "";

        document.getElementById("game-status").value = (game.status || game.play_status || "").toUpperCase();
        document.getElementById("game-favorite-level").value = (game.favorite_level || "").toUpperCase();
        document.getElementById("game-tags").value = normalizeList(game.tags).join(", ");
        document.getElementById("game-official-site-url").value = game.official_site_url || "";
        document.getElementById("game-store-links").value = formatStoreLinks(game.store_links);
        const selectedPlatforms = new Set(normalizeList(game.platforms).map((item) => item.toUpperCase()));
        document.querySelectorAll('input[name="game-platform"]').forEach((input) => {
            input.checked = selectedPlatforms.has(input.value);
        });

        modalTitle.textContent =
            "Edit record";

        deleteGameButton
            .classList
            .remove(
                "hidden"
            );

    } else {

        gameForm.reset();

        id.value =
            "";

        modalTitle.textContent =
            "New record";

        deleteGameButton
            .classList
            .add(
                "hidden"
            );

    }

    if (game && game.id) {

        loadCharactersForGame(game.id);

    }

    openModal(
        gameModal
    );

}


/* =========================================
   SAVE GAME
========================================= */

if (gameForm) {

    gameForm.addEventListener(
        "submit",
        async (event) => {

            event.preventDefault();

            if (!currentUser)
                return;

            const id =
                document
                    .getElementById(
                        "game-id"
                    )
                    .value;

            const message =
                document
                    .getElementById(
                        "game-form-message"
                    );

            const payload = {

                title:
                    document
                        .getElementById(
                            "game-title"
                        )
                        .value
                        .trim(),

                review:
                    document
                        .getElementById(
                            "game-review"
                        )
                        .value
                        .trim(),

                rating:
                    document
                        .getElementById(
                            "game-rating"
                        )
                        .value
                        || null,

                cover_url:
                    document
                        .getElementById(
                            "game-cover-url"
                        )
                        .value
                        .trim()
                        || null,

                sort_order:
                    document
                        .getElementById(
                            "game-sort-order"
                        )
                        .value
                        || null,

                status: document.getElementById("game-status").value || null,
                favorite_level: document.getElementById("game-favorite-level").value || null,
                platforms: Array.from(document.querySelectorAll('input[name="game-platform"]:checked')).map((input) => input.value),
                tags: document.getElementById("game-tags").value.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
                official_site_url: document.getElementById("game-official-site-url").value.trim() || null,
                store_links: document.getElementById("game-store-links").value.split("\n").map((line) => {
                    const separator = line.indexOf("|");
                    if (separator < 0) return null;
                    return { label: line.slice(0, separator).trim(), url: line.slice(separator + 1).trim() };
                }).filter((item) => item?.label && item?.url)

            };


            message.textContent =
                "Saving…";


            let result;


            if (id) {

                result =
                    await supabaseClient
                        .from("games")
                        .update(
                            payload
                        )
                        .eq(
                            "id",
                            id
                        );

            } else {

                result =
                    await supabaseClient
                        .from("games")
                        .insert(
                            payload
                        );

            }


            if (result.error) {

                console.error(
                    result.error
                );

                message.textContent =
                    "保存失败：" +
                    result.error.message;

                return;
            }


            message.textContent =
                "";

            closeModal(
                gameModal
            );

            await loadGames();

            if (document.body.dataset.page === "games") {
                window.location.replace("games.html");
            }

        }
    );

}


/* =========================================
   DELETE GAME
========================================= */

if (deleteGameButton) {

    deleteGameButton.addEventListener(
        "click",
        async () => {

            if (!currentUser)
                return;

            const id =
                document
                    .getElementById(
                        "game-id"
                    )
                    .value;

            if (!id) return;


            const confirmed =
                window.confirm(
                    "确定要从档案馆删除这条记录吗？"
                );

            if (!confirmed)
                return;


            const {
                error
            } =
                await supabaseClient
                    .from("games")
                    .delete()
                    .eq(
                        "id",
                        id
                    );


            if (error) {

                alert(
                    "删除失败：" +
                    error.message
                );

                return;
            }


            closeModal(
                gameModal
            );

            await loadGames();

            if (document.body.dataset.page === "games") {
                window.location.replace("games.html");
            }

        }
    );

}

/* =========================================
   CHARACTER STATE
========================================= */

let currentGameForCharacters = null;
let charactersCache = [];


/* =========================================
   CHARACTER ELEMENTS
========================================= */

const characterModal =
    document.getElementById(
        "character-modal"
    );

const characterForm =
    document.getElementById(
        "character-form"
    );

const addCharacterButton =
    document.getElementById(
        "add-character-btn"
    );

const deleteCharacterButton =
    document.getElementById(
        "delete-character-btn"
    );

const characterEditorList =
    document.getElementById(
        "character-editor-list"
    );


/* =========================================
   LOAD CHARACTERS FOR GAME
========================================= */

async function loadCharactersForGame(gameId) {

    if (!gameId) {
        charactersCache = [];
        renderCharacterEditorList([]);
        return;
    }

    const {
        data,
        error
    } =
        await supabaseClient
            .from("characters")
            .select("*")
            .eq("game_id", gameId)
            .order(
                "sort_order",
                {
                    ascending: true,
                    nullsFirst: false
                }
            );

    // Ignore results from a game that is no longer being edited.
    if (currentGameForCharacters?.id !== gameId) return;

    if (error) {

        console.error(
            "读取 characters 失败：",
            error
        );

        return;
    }

    charactersCache =
        data ?? [];

    renderCharacterEditorList(
        charactersCache
    );

}


/* =========================================
   RENDER CHARACTER LIST IN GAME EDITOR
========================================= */

function renderCharacterEditorList(characters) {

    if (!characterEditorList)
        return;

    characterEditorList.innerHTML = "";

    if (!characters.length) {

        const empty =
            document.createElement(
                "div"
            );

        empty.className =
            "character-empty";

        empty.textContent =
            currentGameForCharacters
                ? "还没有角色记录。点击 ＋ ADD CHARACTER 添加第一位攻略角色。"
                : "请先保存游戏记录，再重新打开 EDIT 添加攻略角色。";

        characterEditorList
            .appendChild(
                empty
            );

        return;
    }


    characters.forEach(
        (character) => {

            const row =
                document.createElement(
                    "div"
                );

            row.className =
                "character-editor-row";


            const main =
                document.createElement(
                    "div"
                );

            main.className =
                "character-editor-main";


            const name =
                document.createElement(
                    "p"
                );

            name.className =
                "character-editor-name";

            name.textContent =
                character.name ?? "";


            const subtitle =
                document.createElement(
                    "p"
                );

            subtitle.className =
                "character-editor-subtitle";

            subtitle.textContent =
                character.subtitle
                    ? character.subtitle
                    : "CHARACTER RECORD";


            main.appendChild(
                name
            );

            main.appendChild(
                subtitle
            );


            const rating =
                document.createElement(
                    "span"
                );

            rating.className =
                "character-editor-rating";

            rating.textContent =
                character.rating !== null &&
                character.rating !== undefined

                    ? `✦ ${character.rating}`

                    : "✦ —";


            const editButton =
                document.createElement(
                    "button"
                );

            editButton.type =
                "button";

            editButton.className =
                "character-edit-button";

            editButton.textContent =
                "EDIT";


            editButton.addEventListener(
                "click",
                () => {

                    openCharacterEditor(
                        character
                    );

                }
            );


            row.appendChild(
                main
            );

            row.appendChild(
                rating
            );

            row.appendChild(
                editButton
            );


            characterEditorList
                .appendChild(
                    row
                );

        }
    );

}

/* =========================================
   OPEN CHARACTER EDITOR
========================================= */

if (addCharacterButton) {
    addCharacterButton.addEventListener("click", () => {
        openCharacterEditor(null);
    });

document.addEventListener("input", (event) => {
    const modal = event.target.closest?.(".archive-modal[data-protect-draft]");
    if (modal) modal.dataset.dirty = "true";
});

window.addEventListener("beforeunload", (event) => {
    if (!document.querySelector('.archive-modal[data-protect-draft][data-dirty="true"]')) return;
    event.preventDefault();
    event.returnValue = "";
});
}

function openCharacterEditor(character) {

    console.log(
        "openCharacterEditor:",
        character,
        currentGameForCharacters
    );

    if (!currentUser) {
        console.warn("无法打开角色编辑器：未登录");
        return;
    }

    if (!currentGameForCharacters) {
        document.getElementById("game-form-message").textContent =
            "请先保存游戏记录，再重新打开 EDIT 添加攻略角色。";
        return;
    }


    const id =
        document.getElementById(
            "character-id"
        );

    const gameId =
        document.getElementById(
            "character-game-id"
        );

    const name =
        document.getElementById(
            "character-name"
        );

    const subtitle =
        document.getElementById(
            "character-subtitle"
        );

    const review =
        document.getElementById(
            "character-review"
        );

    const rating =
        document.getElementById(
            "character-rating"
        );

    const imageUrl =
        document.getElementById(
            "character-image-url"
        );

    const sortOrder =
        document.getElementById(
            "character-sort-order"
        );

    const modalTitle =
        document.getElementById(
            "character-modal-title"
        );

    const message =
        document.getElementById(
            "character-form-message"
        );


    message.textContent = "";


    gameId.value =
        currentGameForCharacters.id;


    if (character) {

        id.value =
            character.id;

        name.value =
            character.name ?? "";

        subtitle.value =
            character.subtitle ?? "";

        review.value =
            character.review ?? "";

        rating.value =
            character.rating ?? "";

        imageUrl.value =
            character.image_url ?? "";

        sortOrder.value =
            character.sort_order ?? "";

        modalTitle.textContent =
            "Edit character";


        deleteCharacterButton
            .classList
            .remove(
                "hidden"
            );

    } else {

        characterForm.reset();

        id.value = "";

        gameId.value =
            currentGameForCharacters.id;

        modalTitle.textContent =
            "New character";


        deleteCharacterButton
            .classList
            .add(
                "hidden"
            );

    }


    openModal(
        characterModal
    );

}


/* =========================================
   SAVE CHARACTER
========================================= */

if (characterForm) {

    characterForm
        .addEventListener(
            "submit",
            async (event) => {

                event.preventDefault();

                if (!currentUser)
                    return;


                const id =
                    document
                        .getElementById(
                            "character-id"
                        )
                        .value;


                const gameId =
                    document
                        .getElementById(
                            "character-game-id"
                        )
                        .value;


                const message =
                    document
                        .getElementById(
                            "character-form-message"
                        );


                const payload = {

                    game_id:
                        Number(
                            gameId
                        ),

                    name:
                        document
                            .getElementById(
                                "character-name"
                            )
                            .value
                            .trim(),

                    subtitle:
                        document
                            .getElementById(
                                "character-subtitle"
                            )
                            .value
                            .trim()
                            || null,

                    review:
                        document
                            .getElementById(
                                "character-review"
                            )
                            .value
                            .trim()
                            || null,

                    rating:
                        document
                            .getElementById(
                                "character-rating"
                            )
                            .value
                            || null,

                    image_url:
                        document
                            .getElementById(
                                "character-image-url"
                            )
                            .value
                            .trim()
                            || null,

                    sort_order:
                        document
                            .getElementById(
                                "character-sort-order"
                            )
                            .value
                            || null

                };


                message.textContent =
                    "Saving…";


                let result;


                if (id) {

                    result =
                        await supabaseClient
                            .from("characters")
                            .update(
                                payload
                            )
                            .eq(
                                "id",
                                id
                            );

                } else {

                    result =
                        await supabaseClient
                            .from("characters")
                            .insert(
                                payload
                            );

                }


                if (result.error) {

                    console.error(
                        result.error
                    );

                    message.textContent =
                        "保存失败：" +
                        result.error.message;

                    return;
                }


                message.textContent =
                    "";

                closeModal(
                    characterModal
                );


                await loadCharactersForGame(
                    currentGameForCharacters.id
                );

            }
        );

}


/* =========================================
   DELETE CHARACTER
========================================= */

if (deleteCharacterButton) {

    deleteCharacterButton
        .addEventListener(
            "click",
            async () => {

                if (!currentUser)
                    return;


                const id =
                    document
                        .getElementById(
                            "character-id"
                        )
                        .value;


                if (!id)
                    return;


                const confirmed =
                    window.confirm(
                        "确定要删除这条角色档案吗？"
                    );


                if (!confirmed)
                    return;


                const {
                    error
                } =
                    await supabaseClient
                        .from("characters")
                        .delete()
                        .eq(
                            "id",
                            id
                        );


                if (error) {

                    alert(
                        "删除失败：" +
                        error.message
                    );

                    return;
                }


                closeModal(
                    characterModal
                );


                await loadCharactersForGame(
                    currentGameForCharacters.id
                );

            }
        );

}

/* =========================================
   START
========================================= */

initialiseAuth();

loadGames();
