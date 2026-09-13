console.log("YURI NEW SCRIPT LOADED");

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
            threshold: 0.25
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


/* =========================================
   HELPERS
========================================= */

function openModal(modal) {

    if (!modal) return;

    modal.classList.add("active");

    document.body.style.overflow =
        "hidden";
}


function closeModal(modal) {

    if (!modal) return;

    modal.classList.remove("active");

    document.body.style.overflow =
        "";
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

const addGameButton =
    document.getElementById(
        "add-game-btn"
    );

const deleteGameButton =
    document.getElementById(
        "delete-game-btn"
    );

const gameList =
    document.querySelector(
        ".game-list"
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

                closeModal(
                    backdrop.closest(
                        ".archive-modal"
                    )
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

            const email =
                document
                    .getElementById(
                        "login-email"
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

}


supabaseClient
    .auth
    .onAuthStateChange(
        (_event, session) => {

            currentUser =
                session?.user
                ?? null;

            updateAdminUI();

            renderGames(
                gamesCache
            );

        }
    );


function updateAdminUI() {

    if (!addGameButton) return;

    if (currentUser) {

        addGameButton
            .classList
            .remove(
                "hidden"
            );

    } else {

        addGameButton
            .classList
            .add(
                "hidden"
            );

    }

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

    renderGames(
        gamesCache
    );

}


/* =========================================
   RENDER ARCHIVE
========================================= */

function renderGames(games) {

    if (!gameList) return;

    gameList.innerHTML = "";

    games.forEach(
        (game, index) => {

            const article =
                document.createElement(
                    "article"
                );

            article.className =
                "game-card";

            /*
            ARCHIVE 001 / 002 / 003
            */

            const number =
                document.createElement(
                    "div"
                );

            number.className =
                "game-archive-number";

            number.textContent =
                `ARCHIVE ${String(
                    index + 1
                ).padStart(
                    3,
                    "0"
                )}`;

            article.appendChild(
                number
            );


            /*
            ADMIN EDIT
            */

            if (currentUser) {

                const editButton =
                    document.createElement(
                        "button"
                    );

                editButton.className =
                    "game-edit-button";

                editButton.type =
                    "button";

                editButton.textContent =
                    "EDIT";

                editButton.addEventListener(
                    "click",
                    () => {
                        openGameEditor(
                            game
                        );
                    }
                );

                article.appendChild(
                    editButton
                );

            }


            /*
            COVER
            */

            const coverFrame =
                document.createElement(
                    "div"
                );

            coverFrame.className =
                "game-cover-frame";

            const coverUrl =
                safeImageUrl(
                    game.cover_url
                );

            if (coverUrl) {

                const image =
                    document.createElement(
                        "img"
                    );

                image.className =
                    "game-cover";

                image.src =
                    coverUrl;

                image.alt =
                    game.title ||
                    "game cover";

                image.loading =
                    "lazy";

                coverFrame.appendChild(
                    image
                );

            } else {

                const placeholder =
                    document.createElement(
                        "div"
                    );

                placeholder.className =
                    "game-cover-placeholder";

                const star =
                    document.createElement(
                        "span"
                    );

                star.textContent =
                    "✦";

                placeholder.appendChild(
                    star
                );

                coverFrame.appendChild(
                    placeholder
                );

            }

            article.appendChild(
                coverFrame
            );


            /*
            TITLE
            */

            const title =
                document.createElement(
                    "h3"
                );

            title.className =
                "game-title";

            title.textContent =
                game.title || "";

            article.appendChild(
                title
            );


            /*
            REVIEW
            */

            const review =
                document.createElement(
                    "p"
                );

            review.className =
                "game-review";

            review.textContent =
                game.review || "";

            article.appendChild(
                review
            );


            /*
            FOOTER
            */

            const meta =
                document.createElement(
                    "div"
                );

            meta.className =
                "game-meta";


            const rating =
                document.createElement(
                    "span"
                );

            rating.className =
                "game-rating";

            rating.textContent =
                game.rating !== null &&
                game.rating !== undefined

                    ? `✦  ${game.rating} / 10`

                    : "✦  UNRATED";


            const note =
                document.createElement(
                    "button"
                );

            note.className =
                "game-view-note";

            note.type =
                "button";

            note.textContent =
                "VIEW NOTE →";


            /*
            点击 VIEW NOTE
            暂时展开 / 收起全文
            */

            note.addEventListener(
                "click",
                () => {

                    const expanded =
                        review.classList
                            .toggle(
                                "expanded"
                            );

                    if (expanded) {

                        review.style
                            .webkitLineClamp =
                            "unset";

                        note.textContent =
                            "CLOSE NOTE ←";

                    } else {

                        review.style
                            .webkitLineClamp =
                            "2";

                        note.textContent =
                            "VIEW NOTE →";

                    }

                }
            );


            meta.appendChild(
                rating
            );

            meta.appendChild(
                note
            );

            article.appendChild(
                meta
            );

            gameList.appendChild(
                article
            );

        }
    );

}


/* =========================================
   NEW GAME
========================================= */

if (addGameButton) {

    addGameButton.addEventListener(
        "click",
        () => {

            openGameEditor(
                null
            );

        }
    );

}


/* =========================================
   OPEN EDITOR
========================================= */

function openGameEditor(game) {

    if (!currentUser) return;

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
                        || null

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

        }
    );

}


/* =========================================
   START
========================================= */

initialiseAuth();

loadGames();