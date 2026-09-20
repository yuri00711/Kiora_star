(async function () {
    "use strict";

    const common = window.yuriArticles;
    const db = common.getClient();
    const auth = window.KioraAuth;
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    const status = document.getElementById("reader-status");
    const articleElement = document.getElementById("reader-article");
    const articleBody = document.getElementById("article-body");
    const readingInfo = document.getElementById("article-reading-info");
    const pagePager = document.getElementById("article-page-pager");
    const previousPageButton = document.getElementById("previous-page");
    const nextPageButton = document.getElementById("next-page");
    const pageLabel = document.getElementById("article-page-label");
    const pageProgress = document.getElementById("article-page-progress");
    let articlePages = [];
    let articleStats = null;
    let currentPage = 1;

    const pageStorageKey = `kiora:reading-page:${id || "unknown"}`;

    function pageNumber(value, total) {
        const parsed = Number.parseInt(String(value || ""), 10);
        if (!Number.isFinite(parsed)) return 1;
        return Math.min(Math.max(parsed, 1), Math.max(total, 1));
    }

    function pageText(page, total) {
        return `PAGE ${String(page).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
    }

    function updatePageUrl(page, mode) {
        const url = new URL(window.location.href);
        if (articlePages.length > 1) url.searchParams.set("page", String(page));
        else url.searchParams.delete("page");
        const state = { articleId: String(id), page };
        if (mode === "push") history.pushState(state, "", url);
        else if (mode === "replace") history.replaceState(state, "", url);
    }

    function updateReadingInfo(page) {
        if (!articleStats) return;
        const parts = [
            `${new Intl.NumberFormat("en-US").format(articleStats.characters)} 字`,
            `约 ${articleStats.minutes} MIN READ`
        ];
        if (articlePages.length > 1) parts.push(pageText(page, articlePages.length));
        readingInfo.textContent = parts.join("  ·  ");
        readingInfo.hidden = false;
    }

    function renderArticlePage(page, options = {}) {
        if (!articlePages.length) return;
        const nextPage = pageNumber(page, articlePages.length);
        currentPage = nextPage;
        articleBody.innerHTML = articlePages[nextPage - 1].html;
        sessionStorage.setItem(pageStorageKey, String(nextPage));
        sessionStorage.setItem("kiora:reading-position", JSON.stringify({ articleId: String(id), page: nextPage }));
        updateReadingInfo(nextPage);

        const hasMultiplePages = articlePages.length > 1;
        pagePager.hidden = !hasMultiplePages;
        if (hasMultiplePages) {
            previousPageButton.disabled = nextPage === 1;
            nextPageButton.disabled = nextPage === articlePages.length;
            pageLabel.textContent = pageText(nextPage, articlePages.length);
            pageProgress.style.width = `${(nextPage / articlePages.length) * 100}%`;
            pagePager.setAttribute("aria-label", `文章页码，第 ${nextPage} 页，共 ${articlePages.length} 页`);
        }

        if (options.historyMode) updatePageUrl(nextPage, options.historyMode);
        if (options.scroll) {
            requestAnimationFrame(() => articleBody.scrollIntoView({
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
                block: "start"
            }));
        }
    }

    function returnToJournal() {
        const stored = sessionStorage.getItem("yuri:return-scroll");
        if (stored) sessionStorage.setItem("yuri:restore-scroll", stored);
        window.location.href = "writing.html";
    }

    document.getElementById("reader-back").addEventListener("click", returnToJournal);
    document.getElementById("back-to-category").addEventListener("click", returnToJournal);

    const settingsButton = document.getElementById("reader-settings-button");
    const settings = document.getElementById("reader-settings");
    let savedSettings = {};
    try {
        savedSettings = JSON.parse(localStorage.getItem("yuri:reader-settings") || "{}");
    } catch (_) {
        localStorage.removeItem("yuri:reader-settings");
    }
    const readerSettings = {
        fontSize: savedSettings.fontSize || "medium",
        lineHeight: savedSettings.lineHeight || "standard"
    };

    function applyReaderSettings() {
        document.body.classList.remove("reader-font-small", "reader-font-medium", "reader-font-large", "reader-leading-standard", "reader-leading-relaxed");
        document.body.classList.add(`reader-font-${readerSettings.fontSize}`, `reader-leading-${readerSettings.lineHeight}`);
        document.querySelectorAll("[data-font-size]").forEach((button) => button.classList.toggle("active", button.dataset.fontSize === readerSettings.fontSize));
        document.querySelectorAll("[data-line-height]").forEach((button) => button.classList.toggle("active", button.dataset.lineHeight === readerSettings.lineHeight));
        localStorage.setItem("yuri:reader-settings", JSON.stringify(readerSettings));
    }

    settingsButton.addEventListener("click", () => {
        settings.hidden = !settings.hidden;
        settingsButton.setAttribute("aria-expanded", String(!settings.hidden));
    });
    settings.addEventListener("click", (event) => {
        const font = event.target.closest("[data-font-size]");
        const line = event.target.closest("[data-line-height]");
        if (font) readerSettings.fontSize = font.dataset.fontSize;
        if (line) readerSettings.lineHeight = line.dataset.lineHeight;
        applyReaderSettings();
    });
    applyReaderSettings();

    previousPageButton.addEventListener("click", () => {
        if (currentPage > 1) renderArticlePage(currentPage - 1, { historyMode: "push", scroll: true });
    });
    nextPageButton.addEventListener("click", () => {
        if (currentPage < articlePages.length) renderArticlePage(currentPage + 1, { historyMode: "push", scroll: true });
    });
    window.addEventListener("popstate", () => {
        if (articlePages.length < 2) return;
        const page = new URLSearchParams(window.location.search).get("page");
        renderArticlePage(page, { scroll: true });
    });

    if (!id) {
        status.textContent = "缺少文章 ID。";
        return;
    }

    await auth.initialize(db);
    let writing;
    let error;
    if (auth.role === "editor") {
        const result = await auth.readForEditor("writing_get", { id });
        writing = result.data;
        error = result.error;
    } else {
        let articleQuery = db.from("writings").select("*").eq("id", id);
        if (auth.role !== "owner") articleQuery = articleQuery.eq("is_public", true);
        const result = await articleQuery.maybeSingle();
        writing = result.data;
        error = result.error;
    }
    if (error || !writing || writing.category === "archive") {
        status.textContent = error?.message || "这篇文字不存在或暂未公开。";
        return;
    }

    const category = common.categories[writing.category];
    document.title = `${writing.title} · Kiora`;
    document.getElementById("article-meta").textContent = `${category?.label || "WRITING"} / ${common.formatDate(writing.published_at)}`;
    document.getElementById("article-title").textContent = writing.title;
    document.getElementById("article-subtitle").textContent = writing.subtitle || "";
    document.getElementById("article-subtitle").hidden = !writing.subtitle;
    const renderedArticle = document.createElement("div");
    renderedArticle.innerHTML = common.markdownToHtml(writing.body);
    articleStats = common.readingStats(writing.body);
    articlePages = common.paginateRenderedBlocks(renderedArticle, {
        target: 3000,
        minimumForPagination: 3600,
        maximum: 3500
    });
    document.getElementById("article-updated").textContent = writing.updated_at ? `UPDATED / ${common.formatDate(writing.updated_at)}` : "";

    const tags = document.getElementById("article-tags");
    (writing.tags || []).forEach((tag) => {
        const span = document.createElement("span");
        span.textContent = tag;
        tags.append(span);
    });
    tags.hidden = !tags.childElementCount;

    const cover = document.getElementById("article-cover");
    const coverUrl = common.safeUrl(writing.cover_url);
    if (coverUrl) {
        cover.src = coverUrl;
        cover.alt = writing.title;
        cover.hidden = false;
    }

    const { data: neighbours } = await db.from("writings")
        .select("id,title,published_at,category,is_public")
        .eq("category", writing.category)
        .eq("is_public", true)
        .order("published_at", { ascending: false });
    const list = neighbours || [];
    const currentIndex = list.findIndex((item) => String(item.id) === String(writing.id));
    const previous = list[currentIndex + 1];
    const next = list[currentIndex - 1];
    const previousLink = document.getElementById("previous-article");
    const nextLink = document.getElementById("next-article");
    if (previous) {
        previousLink.href = `read.html?id=${encodeURIComponent(previous.id)}&from=${encodeURIComponent(writing.category)}`;
        previousLink.hidden = false;
    }
    if (next) {
        nextLink.href = `read.html?id=${encodeURIComponent(next.id)}&from=${encodeURIComponent(writing.category)}`;
        nextLink.hidden = false;
    }

    const explicitPage = new URLSearchParams(window.location.search).get("page");
    const storedPage = sessionStorage.getItem(pageStorageKey);
    const initialPage = pageNumber(explicitPage || storedPage || 1, articlePages.length);
    renderArticlePage(initialPage, { historyMode: "replace" });

    status.hidden = true;
    articleElement.hidden = false;
})();
