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

const supabaseUrl = "https://sqgzlaunnmwkulboyems.supabase.co";
const supabaseKey = "sb_publishable_B35Zjt_oIOMZw-NCswwVmw_WhWwDzVa";

const supabaseClient = window.supabase.createClient(
    supabaseUrl,
    supabaseKey
);

async function loadGames() {
    const { data, error } = await supabaseClient
        .from("games")
        .select("*")
        .order("sort_order", { ascending: true });

    if (error) {
        console.error("读取 games 失败：", error);
        return;
    }

    console.log("games 数据：", data);

    const container = document.querySelector(".game-list");

    if (!container) {
        console.warn("没有找到 .game-list");
        return;
    }

    container.innerHTML = "";

    data.forEach((game) => {
        const item = document.createElement("div");
        item.className = "game-item";

        item.innerHTML = `
            <h3>${game.title ?? ""}</h3>
            <p>${game.review ?? ""}</p>
            ${
                game.rating
                    ? `<div class="game-rating">★ ${game.rating}</div>`
                    : ""
            }
            ${
                game.cover_url
                    ? `<img class="game-cover" src="${game.cover_url}" alt="${game.title ?? "game cover"}">`
                    : ""
            }
        `;

        container.appendChild(item);
    });
}

loadGames();