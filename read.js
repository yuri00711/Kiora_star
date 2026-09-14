(async function () {
    "use strict";

    const common = window.yuriArticles;
    const db = common.getClient();
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    const status = document.getElementById("reader-status");
    const articleElement = document.getElementById("reader-article");

    function returnToJournal() {
        const stored = sessionStorage.getItem("yuri:return-scroll");
        if (stored) sessionStorage.setItem("yuri:restore-scroll", stored);
        window.location.href = "index.html#writing";
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

    if (!id) {
        status.textContent = "缺少文章 ID。";
        return;
    }

    const { data: { session } } = await db.auth.getSession();
    let articleQuery = db.from("writings").select("*").eq("id", id);
    if (!session?.user) articleQuery = articleQuery.eq("is_public", true);
    const { data: writing, error } = await articleQuery.maybeSingle();
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
    document.getElementById("article-body").innerHTML = common.markdownToHtml(writing.body);
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

    status.hidden = true;
    articleElement.hidden = false;
})();
