(function () {
    "use strict";
    const header = document.getElementById("site-top-nav");
    const menu = document.getElementById("site-mobile-menu");
    const button = document.getElementById("site-mobile-menu-button");
    const page = document.body.dataset.page || "";

    document.querySelectorAll("[data-page-link]").forEach((link) => {
        const active = link.dataset.pageLink === page;
        link.classList.toggle("active", active);
        if (active) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
    });

    function setMenu(open, returnFocus = false) {
        menu?.classList.toggle("active", open);
        menu?.setAttribute("aria-hidden", String(!open));
        button?.setAttribute("aria-expanded", String(open));
        if (open) menu?.querySelector("a")?.focus();
        else if (returnFocus) button?.focus();
    }

    button?.addEventListener("click", () => setMenu(button.getAttribute("aria-expanded") !== "true"));
    menu?.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => setMenu(false)));
    document.addEventListener("click", (event) => {
        if (menu?.classList.contains("active") && !header?.contains(event.target)) setMenu(false);
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && menu?.classList.contains("active")) setMenu(false, true);
    });
    window.addEventListener("resize", () => { if (window.innerWidth > 900) setMenu(false); });

    const updateSurface = () => header?.classList.toggle("is-scrolled", window.scrollY > 18);
    updateSurface();
    window.addEventListener("scroll", updateSurface, { passive: true });
})();
