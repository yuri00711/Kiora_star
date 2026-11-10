(function () {
    "use strict";
    const header = document.getElementById("site-top-nav");
    const menu = document.getElementById("site-mobile-menu");
    const button = document.getElementById("site-mobile-menu-button");
    const page = document.body.dataset.page || "";

    const labels = {
        home: "ホーム",
        about: "わたしのこと",
        archive: "アーカイブ",
        games: "ゲーム",
        sale: "セール",
        writing: "かきもの",
        study: "おべんきょう"
    };

    const pageKeyFromLink = (link) => {
        if (link.dataset.pageLink) return link.dataset.pageLink;
        const file = new URL(link.href, window.location.href).pathname.split("/").pop() || "";
        if (!file || file === "index.html") return "home";
        if (file.startsWith("sale")) return "sale";
        return file.replace(/\.html$/i, "");
    };

    const setVisibleLabel = (link, label) => {
        const textNode = Array.from(link.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
        if (textNode) textNode.textContent = label;
        else link.append(document.createTextNode(label));
        link.setAttribute("aria-label", label);
    };

    document.querySelectorAll(".site-desktop-nav a, .site-mobile-menu a, [data-page-link]").forEach((link) => {
        const linkPage = pageKeyFromLink(link);
        if (labels[linkPage]) {
            link.dataset.pageLink = linkPage;
            setVisibleLabel(link, labels[linkPage]);
        }
        const active = linkPage === page;
        link.classList.toggle("active", active);
        if (active) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
        if (active) link.addEventListener("click", (event) => {
            const target = new URL(link.href, window.location.href);
            if (target.pathname === window.location.pathname && target.search === window.location.search && !target.hash) event.preventDefault();
        });
    });

    function setMenu(open, returnFocus = false) {
        menu?.classList.toggle("active", open);
        menu?.setAttribute("aria-hidden", String(!open));
        button?.setAttribute("aria-expanded", String(open));
        if (open) menu?.querySelector("a")?.focus({ preventScroll: true });
        else if (returnFocus) button?.focus({ preventScroll: true });
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
