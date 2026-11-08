(function () {
    "use strict";

    const RETURN_KEY = "kiora:navigation:return:v1";
    const RESTORE_KEY = "kiora:navigation:restore:v1";
    const MAX_AGE = 4 * 60 * 60 * 1000;

    function currentHref() {
        return `${window.location.pathname}${window.location.search}`;
    }

    function safeHref(value) {
        try {
            const url = new URL(String(value || ""), window.location.href);
            if (url.origin !== window.location.origin) return "";
            return `${url.pathname}${url.search}`;
        } catch (_) {
            return "";
        }
    }

    function normalizeState(value) {
        const href = safeHref(value?.href);
        const createdAt = Number(value?.createdAt);
        const scrollY = Math.max(0, Number(value?.scrollY) || 0);
        if (!href || !Number.isFinite(createdAt) || Date.now() - createdAt > MAX_AGE) return null;
        return { href, scrollY, createdAt, label: String(value?.label || "") };
    }

    function read(key) {
        try {
            const value = JSON.parse(sessionStorage.getItem(key) || "null");
            const state = normalizeState(value);
            if (!state) {
                sessionStorage.removeItem(key);
                return null;
            }
            return state;
        } catch (_) {
            sessionStorage.removeItem(key);
            return null;
        }
    }

    function readStack() {
        try {
            const value = JSON.parse(sessionStorage.getItem(RETURN_KEY) || "[]");
            const rows = (Array.isArray(value) ? value : [value]).map(normalizeState).filter(Boolean);
            if (!rows.length) sessionStorage.removeItem(RETURN_KEY);
            return rows.slice(-12);
        } catch (_) {
            sessionStorage.removeItem(RETURN_KEY);
            return [];
        }
    }

    function writeStack(stack) {
        if (stack.length) sessionStorage.setItem(RETURN_KEY, JSON.stringify(stack.slice(-12)));
        else sessionStorage.removeItem(RETURN_KEY);
    }

    function capture(options = {}) {
        const state = {
            href: currentHref(),
            scrollY: Math.max(0, window.scrollY || 0),
            createdAt: Date.now(),
            label: String(options.label || document.title || "")
        };
        const stack = readStack();
        const last = stack[stack.length - 1];
        if (last?.href === state.href) stack[stack.length - 1] = state;
        else stack.push(state);
        writeStack(stack);
        sessionStorage.removeItem(RESTORE_KEY);
        sessionStorage.removeItem("yuri:return-scroll");
        sessionStorage.removeItem("yuri:restore-scroll");
        return state;
    }

    function peek() {
        const stack = readStack();
        return stack[stack.length - 1] || null;
    }

    function back(fallbackHref) {
        const fallback = safeHref(fallbackHref) || "/";
        const stack = readStack();
        const state = stack.pop() || null;
        writeStack(stack);
        sessionStorage.removeItem("yuri:return-scroll");
        sessionStorage.removeItem("yuri:restore-scroll");
        if (state) {
            sessionStorage.setItem(RESTORE_KEY, JSON.stringify(state));
            window.location.href = state.href;
            return;
        }
        window.location.href = fallback;
    }

    function restore() {
        const state = read(RESTORE_KEY);
        if (!state) return false;
        sessionStorage.removeItem(RESTORE_KEY);
        sessionStorage.removeItem("yuri:return-scroll");
        sessionStorage.removeItem("yuri:restore-scroll");
        if (state.href !== currentHref()) return false;
        requestAnimationFrame(() => requestAnimationFrame(() => {
            window.scrollTo({ top: state.scrollY, behavior: "auto" });
        }));
        return true;
    }

    function clear() {
        sessionStorage.removeItem(RETURN_KEY);
        sessionStorage.removeItem(RESTORE_KEY);
        sessionStorage.removeItem("yuri:return-scroll");
        sessionStorage.removeItem("yuri:restore-scroll");
    }

    sessionStorage.removeItem("yuri:return-scroll");
    sessionStorage.removeItem("yuri:restore-scroll");
    window.KioraNavigation = Object.freeze({ capture, peek, back, restore, clear });
})();
