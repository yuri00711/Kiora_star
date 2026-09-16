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

const kioraAuth = window.KioraAuth;


/* =========================================
   STATE
========================================= */

let currentUser = null;
let gamesCache = [];
let requestedGameEditorOpened = false;
let lockedPageScrollY = 0;

// Small public bridge used by the optional profile/writing CMS module.
// The existing auth and Supabase client remain the single source of truth.
window.yuriArchive = Object.freeze({
    get currentUser() {
        return currentUser;
    },
    get authState() {
        return kioraAuth.state;
    },
    get games() {
        return gamesCache.slice();
    },
    supabaseClient,
    can: kioraAuth.can,
    write: kioraAuth.write,
    readForEditor: kioraAuth.readForEditor,
    uploadSiteMedia: kioraAuth.uploadSiteMedia,
    openGameEditor,
    openModal,
    closeModal,
    safeImageUrl
});


/* =========================================
   HELPERS
========================================= */

function openModal(modal) {

    if (!modal) return;

    if (!document.querySelector(".archive-modal.active")) {
        lockedPageScrollY = window.scrollY;
    }
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

    const anotherModalIsOpen = document.querySelector(".archive-modal.active");
    document.body.style.overflow = anotherModalIsOpen ? "hidden" : "";
    if (!anotherModalIsOpen) {
        window.scrollTo(0, lockedPageScrollY);
    }
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

            if (kioraAuth.role !== "viewer") {

                const shouldLogout =
                    window.confirm(
                        "退出档案馆管理模式？"
                    );

                if (shouldLogout) {

                    await kioraAuth.logout();
                    currentUser = null;
                    updateAdminUI();

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

function getAdminLoginMessage(errorCode) {
    const messages = {
        INVALID_CREDENTIALS:
            "登录失败：ID 或密码不正确。",
        SERVER_CONFIG_ERROR:
            "管理员登录服务尚未配置。",
        ADMIN_AUTH_FAILED:
            "管理员身份验证失败。",
        SESSION_ERROR:
            "登录会话建立失败，请重试。",
        FUNCTION_ERROR:
            "登录服务暂时不可用。",
        RATE_LIMITED:
            "尝试次数过多，请稍后再试。",
        EDITOR_SESSION_INVALID:
            "编辑会话无效，请重新登录。",
        EDITOR_SESSION_EXPIRED:
            "编辑会话已过期，请重新登录。"
    };

    return messages[errorCode]
        ?? messages.FUNCTION_ERROR;
}

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

            const submitButton =
                loginForm.querySelector(
                    'button[type="submit"]'
                );

            if (submitButton) {
                submitButton.disabled = true;
            }

            try {
                const ownerLogin = username.includes("@");
                const result = ownerLogin
                    ? await kioraAuth.loginOwner(username, password)
                    : await kioraAuth.loginEditor(username, password);

                if (result.error) {
                    const errorCode = result.error.code || "INVALID_CREDENTIALS";
                    message.textContent = ownerLogin
                        ? "登录失败：邮箱或密码不正确。"
                        : getAdminLoginMessage(errorCode);
                    return;
                }

                currentUser =
                    kioraAuth.role === "owner"
                        ? result.data.user
                        : null;

                message.textContent =
                    "";

                loginForm.reset();

                closeModal(
                    loginModal
                );

                updateAdminUI();

                await loadGames();

            } catch (error) {
                console.error(
                    "login failed:",
                    "FUNCTION_ERROR"
                );

                message.textContent =
                    getAdminLoginMessage(
                        "FUNCTION_ERROR"
                    );

            } finally {
                if (submitButton) {
                    submitButton.disabled = false;
                }
            }

        }
    );

}


/* =========================================
   AUTH STATE
========================================= */

async function initialiseAuth() {
    const state =
        await kioraAuth.initialize(
            supabaseClient
        );

    if (state.role === "owner") {
        const { data } =
            await supabaseClient
                .auth
                .getSession();
        currentUser = data.session?.user ?? null;
    } else {
        currentUser = null;
    }

    updateAdminUI();
    publishGames(gamesCache);
    openRequestedGameEditor();

}


supabaseClient
    .auth
    .onAuthStateChange(
        (_event, session) => {

            currentUser =
                session?.user
                ?? null;

            kioraAuth.syncOwnerSession(
                session
            );

            updateAdminUI();

            publishGames(
                gamesCache
            );

        }
    );


function updateAdminUI() {
    window.dispatchEvent(
        new CustomEvent("yuri:authchange", {
            detail: {
                user: currentUser,
                authState: kioraAuth.state
            }
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
    if (requestedGameEditorOpened || !(kioraAuth.can("game:create") || kioraAuth.can("game:edit"))) return;
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

const GAME_STATUSES = new Set(["PLAYING", "COMPLETED", "PAUSED", "DROPPED", "WISHLIST"]);
const GAME_FAVORITES = new Set(["FAVORITE", "BELOVED", "LOVE", "LIKE", "NEUTRAL", "NOT FOR ME"]);
let gameTagValues = [];
let gameCoverPreviewObjectUrl = "";
let gameSaveInProgress = false;

function normalizeGameList(value) {
    if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
    if (typeof value !== "string" || !value.trim()) return [];
    try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.trim()).filter(Boolean);
    } catch (_) {}
    return value.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
}

function formatGameStoreLinks(value) {
    const links = window.yuriArticles?.normalizeStoreLinks?.(value) || [];
    return links.map((item) => `${item.label} | ${item.url}`).join("\n");
}

function parseGameStoreLinks(value) {
    const links = [];
    const invalidLines = [];

    String(value || "").split(/\r?\n/).forEach((rawLine, index) => {
        const line = rawLine.trim();
        if (!line) return;
        const separator = line.search(/[|｜\t]/);
        if (separator < 0) {
            invalidLines.push(index + 1);
            return;
        }

        const label = line.slice(0, separator).trim();
        const url = line.slice(separator + 1).trim();
        let validUrl = false;
        try {
            validUrl = ["http:", "https:"].includes(new URL(url).protocol);
        } catch (_) {}

        if (!label || !validUrl) {
            invalidLines.push(index + 1);
            return;
        }
        links.push({ label, url });
    });

    return { links, invalidLines };
}

function gameDateInputValue(value) {
    const match = String(value || "").match(/^\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : "";
}

function renderGameTags() {
    const list = document.getElementById("game-tag-list");
    const hidden = document.getElementById("game-tags");
    if (!list || !hidden) return;
    list.replaceChildren();
    gameTagValues.forEach((tag) => {
        const chip = document.createElement("span");
        chip.textContent = tag;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.setAttribute("aria-label", `Remove ${tag}`);
        remove.textContent = "×";
        remove.addEventListener("click", () => {
            gameTagValues = gameTagValues.filter((value) => value !== tag);
            renderGameTags();
        });
        chip.append(remove);
        list.append(chip);
    });
    hidden.value = JSON.stringify(gameTagValues);
}

function addGameTag() {
    const entry = document.getElementById("game-tag-entry");
    const value = entry?.value.trim();
    if (!value) return;
    if (!gameTagValues.some((tag) => tag.toLocaleLowerCase() === value.toLocaleLowerCase())) {
        gameTagValues.push(value);
        renderGameTags();
    }
    entry.value = "";
    entry.focus();
}

function updateGameCoverPreview(url) {
    const preview = document.getElementById("game-cover-preview");
    if (!preview) return;
    preview.replaceChildren();
    const safeUrl = String(url || "").startsWith("blob:") ? String(url) : safeImageUrl(url);
    if (!safeUrl) {
        const empty = document.createElement("span");
        empty.textContent = "NO COVER";
        preview.append(empty);
        preview.classList.remove("has-image");
        return;
    }
    const image = document.createElement("img");
    image.src = safeUrl;
    image.alt = "Game cover preview";
    image.addEventListener("error", () => updateGameCoverPreview(""), { once: true });
    preview.classList.add("has-image");
    preview.append(image);
}

function setGameEditorMode(game) {
    const editing = Boolean(game?.id);
    document.getElementById("game-editor-mode").textContent = editing ? "EDIT MODE" : "CREATE MODE";
    document.getElementById("game-modal-title").textContent = editing ? "Edit record" : "New record";
    document.getElementById("game-editor-description").textContent = editing
        ? `Archive ${String(game.sort_order ?? game.id).padStart(3, "0")} / ${game.title || "UNTITLED"}`
        : "Create a new archive entry.";
    addCharacterButton.disabled = !editing;
    deleteGameButton.classList.toggle("hidden", !editing || kioraAuth.role !== "owner");
}

document.getElementById("game-add-tag")?.addEventListener("click", addGameTag);
document.getElementById("game-tag-entry")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addGameTag();
});
document.getElementById("game-cover-url")?.addEventListener("input", (event) => {
    if (!document.getElementById("game-cover-upload")?.files?.length) updateGameCoverPreview(event.target.value.trim());
});
document.getElementById("game-cover-upload")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) {
        updateGameCoverPreview(document.getElementById("game-cover-url").value.trim());
        return;
    }
    if (gameCoverPreviewObjectUrl) URL.revokeObjectURL(gameCoverPreviewObjectUrl);
    gameCoverPreviewObjectUrl = URL.createObjectURL(file);
    updateGameCoverPreview(gameCoverPreviewObjectUrl);
});
document.querySelectorAll("#game-started-at, #game-completed-at").forEach((input) => {
    input.addEventListener("input", () => {
        document.getElementById("game-date-message").textContent = "";
    });
});

function openGameEditor(game) {
    if (!kioraAuth.can(game ? "game:edit" : "game:create")) return;

    currentGameForCharacters = game && game.id ? game : null;
    charactersCache = [];
    renderCharacterEditorList([]);
    document.getElementById("game-form-message").textContent = "";
    document.getElementById("game-date-message").textContent = "";

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

        document.getElementById("game-started-at").value = gameDateInputValue(game.started_at);
        document.getElementById("game-completed-at").value = gameDateInputValue(game.completed_at);

        const statusValue = String(game.status || game.play_status || "").toUpperCase();
        const favoriteValue = String(game.favorite_level || "").toUpperCase();
        document.getElementById("game-status").value = GAME_STATUSES.has(statusValue) ? statusValue : "";
        document.getElementById("game-favorite-level").value = GAME_FAVORITES.has(favoriteValue) ? favoriteValue : "";
        gameTagValues = normalizeGameList(game.tags);
        renderGameTags();
        document.getElementById("game-official-site-url").value = game.official_site_url || "";
        document.getElementById("game-store-links").value = formatGameStoreLinks(game.store_links);
        const selectedPlatforms = new Set(normalizeGameList(game.platforms).map((item) => item.toUpperCase()));
        document.querySelectorAll('input[name="game-platform"]').forEach((input) => {
            input.checked = selectedPlatforms.has(input.value);
        });

        setGameEditorMode(game);

    } else {

        gameForm.reset();

        id.value =
            "";

        gameTagValues = [];
        renderGameTags();
        setGameEditorMode(null);

    }

    document.getElementById("game-cover-upload").value = "";
    if (gameCoverPreviewObjectUrl) URL.revokeObjectURL(gameCoverPreviewObjectUrl);
    gameCoverPreviewObjectUrl = "";
    updateGameCoverPreview(game?.cover_url || "");

    if (game && game.id) {

        loadCharactersForGame(game.id);

    }

    openModal(
        gameModal
    );
    const editorCard = gameModal.querySelector(".game-editor-card");
    if (editorCard) editorCard.scrollTop = 0;

}


/* =========================================
   SAVE GAME
========================================= */

if (gameForm) {

    gameForm.addEventListener(
        "submit",
        async (event) => {

            event.preventDefault();
            if (gameSaveInProgress) return;

            const id =
                document
                    .getElementById(
                        "game-id"
                    )
                    .value;

            if (!kioraAuth.can(id ? "game:edit" : "game:create"))
                return;

            const startedAt = document.getElementById("game-started-at").value || null;
            const completedAt = document.getElementById("game-completed-at").value || null;
            const dateMessage = document.getElementById("game-date-message");
            dateMessage.textContent = "";
            if (startedAt && completedAt && completedAt < startedAt) {
                dateMessage.textContent = "COMPLETED 不能早于 STARTED。";
                document.getElementById("game-completed-at").focus();
                return;
            }

            if (document.getElementById("game-tag-entry").value.trim()) addGameTag();

            const message =
                document
                    .getElementById(
                        "game-form-message"
                    );

            const parsedStoreLinks = parseGameStoreLinks(document.getElementById("game-store-links").value);
            if (parsedStoreLinks.invalidLines.length) {
                message.textContent = `STORE LINKS 第 ${parsedStoreLinks.invalidLines.join("、")} 行格式或 URL 无效，请使用 LABEL | https://...`;
                document.getElementById("game-store-links").focus();
                return;
            }

            const coverFile = document.getElementById("game-cover-upload").files?.[0];
            let coverUrl = document.getElementById("game-cover-url").value.trim() || null;

            if (coverFile) {
                if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(coverFile.type)) {
                    message.textContent = "仅支持 JPG、PNG、WEBP 或 GIF 图片。";
                    return;
                }
                if (coverFile.size > 5 * 1024 * 1024) {
                    message.textContent = "图片不能超过 5MB。";
                    return;
                }
                const extension = (coverFile.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
                const uploadPath = `collections/games/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension || "jpg"}`;
                message.textContent = "Uploading cover…";
                const upload = await kioraAuth.uploadSiteMedia(coverFile, uploadPath);
                if (upload.error) {
                    message.textContent = "封面上传失败：" + upload.error.message;
                    return;
                }
                coverUrl = upload.data.publicUrl;
                document.getElementById("game-cover-url").value = coverUrl;
            }

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

                cover_url: coverUrl,

                sort_order:
                    document
                        .getElementById(
                            "game-sort-order"
                        )
                        .value
                        || null,

                started_at: startedAt,
                completed_at: completedAt,

                status: document.getElementById("game-status").value || null,
                favorite_level: document.getElementById("game-favorite-level").value || null,
                platforms: Array.from(document.querySelectorAll('input[name="game-platform"]:checked')).map((input) => input.value),
                tags: gameTagValues.slice(),
                official_site_url: document.getElementById("game-official-site-url").value.trim() || null,
                store_links: parsedStoreLinks.links

            };


            message.textContent = "Saving…";
            gameSaveInProgress = true;
            const submitButton = gameForm.querySelector('button[type="submit"]');
            if (submitButton) submitButton.disabled = true;


            let result;


            try {
                result = await kioraAuth.write(
                    id ? "game_update" : "game_create",
                    id ? { id, data: payload } : { data: payload },
                    () => id
                        ? supabaseClient.from("games").update(payload).eq("id", id).select("*").single()
                        : supabaseClient.from("games").insert(payload).select("*").single()
                );
            } finally {
                gameSaveInProgress = false;
                if (submitButton) submitButton.disabled = false;
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


            await loadGames();
            const returned = Array.isArray(result.data) ? result.data[0] : result.data;
            const savedId = String(returned?.id ?? id);
            const savedGame = gamesCache.find((item) => String(item.id) === savedId);

            if (!id && savedGame) {
                currentGameForCharacters = savedGame;
                document.getElementById("game-id").value = savedGame.id;
                document.getElementById("game-cover-upload").value = "";
                setGameEditorMode(savedGame);
                renderCharacterEditorList([]);
                message.textContent = "Record created. You can add characters now.";
                return;
            }

            message.textContent = "";
            closeModal(gameModal);

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

            if (kioraAuth.role !== "owner")
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
                : "创建游戏记录后即可添加攻略角色。";

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

    if (!kioraAuth.can(character ? "character:edit" : "character:create")) {
        console.warn("无法打开角色编辑器：未登录");
        return;
    }

    if (!currentGameForCharacters) {
        document.getElementById("game-form-message").textContent =
            "创建游戏记录后即可添加攻略角色。";
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


        deleteCharacterButton.classList.toggle(
            "hidden",
            kioraAuth.role !== "owner"
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

                const id =
                    document
                        .getElementById(
                            "character-id"
                        )
                        .value;

                if (!kioraAuth.can(id ? "character:edit" : "character:create"))
                    return;


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


                result = await kioraAuth.write(
                    id ? "character_update" : "character_create",
                    id ? { id, data: payload } : { data: payload },
                    () => id
                        ? supabaseClient.from("characters").update(payload).eq("id", id)
                        : supabaseClient.from("characters").insert(payload)
                );


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

                if (kioraAuth.role !== "owner")
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
