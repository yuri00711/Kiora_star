(function () {
    "use strict";

    const SUPABASE_URL = "https://sqgzlaunnmwkulboyems.supabase.co";
    const SUPABASE_KEY = "sb_publishable_B35Zjt_oIOMZw-NCswwVmw_WhWwDzVa";
    const categories = {
        game_review: { label: "AFTERGLOW", note: "游戏感想" },
        essay: { label: "MOON NOTES", note: "随笔" },
        dream: { label: "DREAM LETTERS", note: "梦向创作" }
    };
    let client;

    function getClient() {
        if (!client) client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        return client;
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function safeUrl(value) {
        try {
            const url = new URL(String(value || ""));
            return ["http:", "https:"].includes(url.protocol) ? url.href : "";
        } catch (_) {
            return "";
        }
    }

    function inlineMarkdown(value) {
        const code = [];
        let text = escapeHtml(value).replace(/`([^`]+)`/g, (_match, content) => {
            code.push(`<code>${content}</code>`);
            return `\u0000CODE${code.length - 1}\u0000`;
        });
        text = text
            .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
            .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
            .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
            .replace(/~~([^~]+)~~/g, "<del>$1</del>")
            .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
            .replace(/\u0000CODE(\d+)\u0000/g, (_match, index) => code[Number(index)]);
        return text;
    }

    function markdownToHtml(source) {
        const lines = String(source ?? "").replaceAll("\r\n", "\n").split("\n");
        const output = [];
        let paragraph = [];
        let listType = "";
        let listItems = [];
        let codeLines = [];
        let inCode = false;

        const flushParagraph = () => {
            if (!paragraph.length) return;
            output.push(`<p>${paragraph.map(inlineMarkdown).join("<br>")}</p>`);
            paragraph = [];
        };
        const flushList = () => {
            if (!listItems.length) return;
            output.push(`<${listType}>${listItems.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</${listType}>`);
            listItems = [];
            listType = "";
        };

        lines.forEach((line) => {
            if (/^```/.test(line)) {
                flushParagraph();
                flushList();
                if (inCode) {
                    output.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
                    codeLines = [];
                }
                inCode = !inCode;
                return;
            }
            if (inCode) {
                codeLines.push(line);
                return;
            }
            if (!line.trim()) {
                flushParagraph();
                flushList();
                return;
            }
            const heading = line.match(/^(#{1,3})\s+(.+)$/);
            if (heading) {
                flushParagraph();
                flushList();
                const level = heading[1].length + 1;
                output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
                return;
            }
            if (/^(---|\*\*\*|___)\s*$/.test(line)) {
                flushParagraph();
                flushList();
                output.push("<hr>");
                return;
            }
            const quote = line.match(/^>\s?(.*)$/);
            if (quote) {
                flushParagraph();
                flushList();
                output.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`);
                return;
            }
            const unordered = line.match(/^[-*+]\s+(.+)$/);
            const ordered = line.match(/^\d+[.)]\s+(.+)$/);
            if (unordered || ordered) {
                flushParagraph();
                const nextType = unordered ? "ul" : "ol";
                if (listType && listType !== nextType) flushList();
                listType = nextType;
                listItems.push((unordered || ordered)[1]);
                return;
            }
            flushList();
            paragraph.push(line);
        });
        flushParagraph();
        flushList();
        if (codeLines.length) output.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        return output.join("");
    }

    function formatDate(value) {
        if (!value) return "";
        const parts = new Intl.DateTimeFormat("ja-JP", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            timeZone: "Asia/Tokyo"
        }).formatToParts(new Date(value));
        const part = (type) => parts.find((item) => item.type === type)?.value || "";
        return [part("year"), part("month"), part("day")].join(".");
    }

    function formatPureDate(value) {
        const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
        return match ? `${match[1]}.${match[2]}.${match[3]}` : "";
    }

    function firstValue(record, keys) {
        for (const key of keys) {
            if (record?.[key] !== null && record?.[key] !== undefined && record?.[key] !== "") return record[key];
        }
        return "";
    }

    function formatList(value) {
        if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
        if (typeof value !== "string" || !value.trim()) return [];
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.trim()).filter(Boolean);
        } catch (_) {}
        return value.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
    }

    function normalizeStoreLinks(value) {
        const links = [];

        const addLink = (label, url) => {
            const normalizedLabel = String(label || "STORE").trim();
            const normalizedUrl = String(url || "").trim();
            if (normalizedLabel && normalizedUrl) links.push({ label: normalizedLabel, url: normalizedUrl });
        };

        const visit = (entry) => {
            if (entry === null || entry === undefined || entry === "") return;
            if (Array.isArray(entry)) {
                entry.forEach(visit);
                return;
            }
            if (typeof entry === "object") {
                const directUrl = entry.url ?? entry.href ?? entry.link;
                if (directUrl) {
                    addLink(entry.label ?? entry.name ?? entry.store, directUrl);
                    return;
                }
                Object.entries(entry).forEach(([label, url]) => {
                    if (typeof url === "string") addLink(label, url);
                });
                return;
            }
            if (typeof entry !== "string") return;

            const text = entry.trim();
            if (!text) return;
            try {
                const parsed = JSON.parse(text);
                if (parsed !== text) {
                    visit(parsed);
                    return;
                }
            } catch (_) {}

            text.split(/\r?\n/).forEach((line) => {
                const separator = line.search(/[|｜\t]/);
                if (separator < 0) return;
                addLink(line.slice(0, separator), line.slice(separator + 1));
            });
        };

        visit(value);
        return links;
    }

    function plainText(markdown) {
        const holder = document.createElement("div");
        holder.innerHTML = markdownToHtml(markdown || "");
        return holder.textContent.trim();
    }

    function truncateText(value, maximum = 240) {
        const text = String(value || "").replace(/\s+/g, " ").trim();
        if (text.length <= maximum) return text;
        return `${text.slice(0, maximum).trimEnd()}…`;
    }

    function textMetricsFromPlainText(value) {
        const text = String(value || "").replace(/\s+/g, " ").trim();
        const cjkPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
        const cjkCharacters = (text.match(cjkPattern) || []).length;
        const nonCjk = text.replace(cjkPattern, " ");
        const latinWords = (nonCjk.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu) || []).length;
        return {
            cjkCharacters,
            latinWords,
            characters: cjkCharacters + latinWords,
            readingUnits: cjkCharacters + latinWords * 2
        };
    }

    function readingStats(value) {
        const metrics = textMetricsFromPlainText(plainText(value));
        const minutes = Math.max(1, Math.ceil(metrics.cjkCharacters / 450 + metrics.latinWords / 225));
        return { ...metrics, minutes };
    }

    function wordCount(value) {
        return readingStats(value).characters;
    }

    function readingMinutes(value) {
        return readingStats(value).minutes;
    }

    function renderedBlockUnits(block) {
        const metrics = textMetricsFromPlainText(block.textContent || "");
        const tag = block.tagName.toLowerCase();
        let visualWeight = 0;
        if (/^h[2-4]$/.test(tag)) visualWeight += 180;
        if (tag === "blockquote") visualWeight += 120;
        if (tag === "pre") visualWeight += 180;
        if (tag === "hr") visualWeight += 140;
        visualWeight += block.querySelectorAll("img").length * 720;
        return Math.max(1, metrics.readingUnits + visualWeight);
    }

    function paginateRenderedBlocks(container, options = {}) {
        const target = Number(options.target) || 3000;
        const minimumForPagination = Number(options.minimumForPagination) || 3600;
        const maximum = Number(options.maximum) || 3500;
        const blocks = Array.from(container.children);
        const weights = blocks.map(renderedBlockUnits);
        const totalUnits = weights.reduce((sum, value) => sum + value, 0);
        if (blocks.length < 2 || totalUnits <= minimumForPagination) {
            return [{ html: container.innerHTML, units: totalUnits }];
        }

        const pages = [];
        let pageBlocks = [];
        let pageUnits = 0;
        const flush = () => {
            if (!pageBlocks.length) return;
            pages.push({ html: pageBlocks.map((block) => block.outerHTML).join(""), units: pageUnits });
            pageBlocks = [];
            pageUnits = 0;
        };

        blocks.forEach((block, index) => {
            const units = weights[index];
            const tag = block.tagName.toLowerCase();
            const nextUnits = weights[index + 1] || 0;
            const headingWithNext = /^h[2-4]$/.test(tag) ? units + nextUnits : units;

            if (pageBlocks.length && pageUnits >= target * 0.62 && pageUnits + headingWithNext > maximum) flush();
            if (pageBlocks.length && pageUnits + units > maximum && pageUnits >= target * 0.62) {
                const last = pageBlocks[pageBlocks.length - 1];
                if (last && /^h[2-4]$/.test(last.tagName.toLowerCase())) {
                    pageBlocks.pop();
                    const headingUnits = renderedBlockUnits(last);
                    pageUnits -= headingUnits;
                    flush();
                    pageBlocks.push(last);
                    pageUnits = headingUnits;
                } else {
                    flush();
                }
            }

            pageBlocks.push(block);
            pageUnits += units;
            if (pageUnits >= target && !/^h[2-4]$/.test(tag)) flush();
        });
        flush();

        if (pages.length > 1) {
            const last = pages[pages.length - 1];
            const previous = pages[pages.length - 2];
            if (last.units < target * 0.4 && previous.units + last.units <= maximum * 1.08) {
                previous.html += last.html;
                previous.units += last.units;
                pages.pop();
            }
        }
        return pages;
    }

    window.yuriArticles = Object.freeze({
        categories,
        escapeHtml,
        firstValue,
        formatDate,
        formatPureDate,
        formatList,
        normalizeStoreLinks,
        getClient,
        markdownToHtml,
        paginateRenderedBlocks,
        plainText,
        readingMinutes,
        readingStats,
        safeUrl,
        truncateText,
        wordCount
    });
})();
