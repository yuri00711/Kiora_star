(function () {
    "use strict";

    const adapters = new Map();
    let selectedText = "";

    function cleanText(value, max = 500) {
        return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
    }

    function selectionFromDocument() {
        const active = document.activeElement;
        if (active && !active.closest?.("#kiora-dock-root") && /^(TEXTAREA|INPUT)$/.test(active.tagName)) {
            const start = Number(active.selectionStart);
            const end = Number(active.selectionEnd);
            if (Number.isInteger(start) && Number.isInteger(end) && end > start) {
                return cleanText(active.value.slice(start, end), 4000);
            }
        }
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return "";
        const anchor = selection.anchorNode?.parentElement;
        if (anchor?.closest("#kiora-dock-root")) return "";
        return cleanText(selection.toString(), 4000);
    }

    function rememberSelection() {
        const next = selectionFromDocument();
        if (next) selectedText = next;
        window.dispatchEvent(new CustomEvent("kiora:contextchange"));
    }

    document.addEventListener("selectionchange", rememberSelection, { passive: true });
    document.addEventListener("keyup", rememberSelection, { passive: true });

    function register(name, adapter) {
        if (typeof name === "string" && typeof adapter === "function") adapters.set(name, adapter);
    }

    function activeAdapter() {
        const declared = document.body?.dataset.page;
        const file = location.pathname.split("/").pop()?.replace(/\.html$/i, "") || "home";
        return adapters.get(declared) || adapters.get(file) || adapters.get("default");
    }

    function snapshot(options = {}) {
        let adapted = {};
        try {
            adapted = activeAdapter()?.() || {};
        } catch (_) {
            adapted = {};
        }
        const page = cleanText(adapted.page || document.body?.dataset.page || "unknown", 60) || "unknown";
        const visible = Object.fromEntries(Object.entries(adapted.visible || {}).slice(0, 24).map(([key, value]) => [
            cleanText(key, 80),
            typeof value === "number" || typeof value === "boolean" ? value : cleanText(value, 500)
        ]));
        const privateDescriptors = Array.isArray(adapted.private) ? adapted.private.map((item) => cleanText(item, 120)).filter(Boolean) : [];
        const context = {
            page,
            url_path: `${location.pathname}${location.search}`.slice(0, 500),
            visible,
            boundaries: {
                conditional_available: Boolean(selectedText),
                private_present: privateDescriptors.length > 0
            }
        };
        if (options.includeSelection === true && selectedText) context.explicit_selection = selectedText;
        return context;
    }

    function selection() {
        return selectedText;
    }

    function clearSelection() {
        selectedText = "";
        window.dispatchEvent(new CustomEvent("kiora:contextchange"));
    }

    window.KioraContextBroker = Object.freeze({ register, snapshot, selection, clearSelection });
})();
