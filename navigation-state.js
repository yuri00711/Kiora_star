(function () {
    "use strict";

    const PENDING_KEY = "kiora:navigation:pending:v2";
    const RESTORE_KEY = "kiora:navigation:restore:v2";
    const STATE_KEY = "kioraNavigation";
    const MAX_AGE = 4 * 60 * 60 * 1000;

    if ("scrollRestoration" in history) history.scrollRestoration = "manual";

    function currentHref() {
        return `${window.location.pathname}${window.location.search}${window.location.hash}`;
    }

    function safeHref(value) {
        try {
            const url = new URL(String(value || ""), window.location.href);
            if (url.origin !== window.location.origin) return "";
            return `${url.pathname}${url.search}${url.hash}`;
        } catch (_) {
            return "";
        }
    }

    function normalizeEntry(value) {
        const href = safeHref(value?.href);
        const createdAt = Number(value?.createdAt);
        if (!href || !Number.isFinite(createdAt) || Date.now() - createdAt > MAX_AGE) return null;
        return {
            href,
            scrollY: Math.max(0, Number(value?.scrollY) || 0),
            createdAt,
            label: String(value?.label || "")
        };
    }

    function readSession(key) {
        try {
            const value = normalizeEntry(JSON.parse(sessionStorage.getItem(key) || "null"));
            if (!value) sessionStorage.removeItem(key);
            return value;
        } catch (_) {
            sessionStorage.removeItem(key);
            return null;
        }
    }

    function normalizeTrail(value) {
        return (Array.isArray(value) ? value : []).map(normalizeEntry).filter(Boolean).slice(-16);
    }

    function readPending() {
        try {
            const raw = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null");
            const pendingEntry = normalizeEntry(raw?.entry || raw);
            if (!pendingEntry) {
                sessionStorage.removeItem(PENDING_KEY);
                return null;
            }
            return { entry: pendingEntry, trail: normalizeTrail(raw?.trail) };
        } catch (_) {
            sessionStorage.removeItem(PENDING_KEY);
            return null;
        }
    }

    function stateData() {
        return history.state?.[STATE_KEY] || {};
    }

    function replaceNavigationState(data) {
        history.replaceState({ ...(history.state || {}), [STATE_KEY]: data }, "", window.location.href);
    }

    function entry(label) {
        return {
            href: currentHref(),
            scrollY: Math.max(0, window.scrollY || 0),
            createdAt: Date.now(),
            label: String(label || document.title || "")
        };
    }

    function referrerHref() {
        try {
            const url = new URL(document.referrer);
            if (url.origin !== window.location.origin) return "";
            return `${url.pathname}${url.search}${url.hash}`;
        } catch (_) {
            return "";
        }
    }

    function claimPendingParent() {
        const pending = readPending();
        if (!pending) return;
        sessionStorage.removeItem(PENDING_KEY);
        if (pending.entry.href.split("#")[0] !== referrerHref().split("#")[0]) return;
        const current = stateData();
        replaceNavigationState({
            ...current,
            parent: pending.entry,
            trail: pending.trail,
            returnSteps: 1,
            entry: current.entry || entry()
        });
    }

    function capture(options = {}) {
        const current = entry(options.label);
        const previous = stateData();
        replaceNavigationState({ ...previous, entry: current });
        sessionStorage.setItem(PENDING_KEY, JSON.stringify({
            entry: current,
            trail: [...normalizeTrail(previous.trail), current]
        }));
        sessionStorage.removeItem(RESTORE_KEY);
        return current;
    }

    function peek() {
        return normalizeEntry(stateData().parent) || readPending()?.entry || null;
    }

    function markSameDocumentPush(nextState = {}) {
        const current = stateData();
        return {
            ...(history.state || {}),
            ...nextState,
            [STATE_KEY]: {
                ...current,
                returnSteps: Math.max(1, Number(current.returnSteps) || 1) + 1,
                entry: entry(current.entry?.label)
            }
        };
    }

    function back(fallbackHref) {
        const fallback = safeHref(fallbackHref) || "/";
        const current = stateData();
        const parent = normalizeEntry(current.parent);
        const trail = normalizeTrail(current.trail);
        const fallbackPath = fallback.split("#")[0];
        let targetIndex = -1;
        for (let index = trail.length - 1; index >= 0; index -= 1) {
            if (trail[index].href.split("#")[0] === fallbackPath) {
                targetIndex = index;
                break;
            }
        }
        const target = targetIndex >= 0 ? trail[targetIndex] : parent;
        if (target && history.length > 1) {
            const documentSteps = targetIndex >= 0 ? trail.length - 1 - targetIndex : 0;
            const steps = Math.max(1, Number(current.returnSteps) || 1) + documentSteps;
            sessionStorage.setItem(RESTORE_KEY, JSON.stringify(target));
            history.go(-steps);
            return;
        }
        sessionStorage.removeItem(PENDING_KEY);
        window.location.replace(fallback);
    }

    function navigate(targetHref, options = {}) {
        const target = safeHref(targetHref);
        if (!target || target === currentHref()) return false;
        if (options.replace) {
            window.location.replace(target);
            return true;
        }
        capture({ label: options.label });
        window.location.assign(target);
        return true;
    }

    function scrollToEntry(value) {
        const state = normalizeEntry(value);
        if (!state || state.href !== currentHref()) return false;
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const root = document.documentElement;
            const previousBehavior = root.style.scrollBehavior;
            const maxScroll = Math.max(0, root.scrollHeight - window.innerHeight);
            root.style.setProperty("scroll-behavior", "auto", "important");
            window.scrollTo(0, Math.min(state.scrollY, maxScroll));
            requestAnimationFrame(() => {
                if (previousBehavior) root.style.scrollBehavior = previousBehavior;
                else root.style.removeProperty("scroll-behavior");
            });
        }));
        return true;
    }

    function restore() {
        const explicit = readSession(RESTORE_KEY);
        if (explicit) sessionStorage.removeItem(RESTORE_KEY);
        if (explicit && scrollToEntry(explicit)) return true;
        const navigationType = performance.getEntriesByType?.("navigation")?.[0]?.type;
        if (navigationType === "back_forward") return scrollToEntry(stateData().entry);
        return false;
    }

    function rememberScroll() {
        const current = stateData();
        replaceNavigationState({ ...current, entry: entry(current.entry?.label) });
    }

    function clear() {
        sessionStorage.removeItem(PENDING_KEY);
        sessionStorage.removeItem(RESTORE_KEY);
    }

    claimPendingParent();
    document.addEventListener("click", (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = event.target.closest?.("a[href]");
        if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
        if (link.hasAttribute("data-navigation-back")) {
            event.preventDefault();
            back(link.getAttribute("href"));
            return;
        }
        const rawHref = link.getAttribute("href") || "";
        if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("mailto:") || rawHref.startsWith("tel:")) return;
        const target = safeHref(link.href);
        if (!target) return;
        if (target === currentHref()) {
            event.preventDefault();
            return;
        }
        capture({ label: link.dataset.navigationLabel || document.title });
    });
    window.addEventListener("pagehide", rememberScroll);
    window.addEventListener("pageshow", (event) => {
        if (event.persisted) restore();
    });

    window.KioraNavigation = Object.freeze({
        back,
        capture,
        clear,
        markSameDocumentPush,
        navigate,
        peek,
        rememberScroll,
        restore
    });
})();
