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

    function wordCount(value) {
        const text = String(value || "").replace(/[#>*_~`\[\]()!-]/g, " ");
        const cjk = (text.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
        const latin = (text.replace(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, " ").match(/[\p{L}\p{N}]+/gu) || []).length;
        return cjk + latin;
    }

    function readingMinutes(value) {
        return Math.max(1, Math.ceil(wordCount(value) / 400));
    }

    window.yuriArticles = Object.freeze({
        categories,
        escapeHtml,
        formatDate,
        getClient,
        markdownToHtml,
        readingMinutes,
        safeUrl,
        wordCount
    });
})();
