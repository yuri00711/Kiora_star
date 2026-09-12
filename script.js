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