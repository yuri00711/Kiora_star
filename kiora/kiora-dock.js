(function () {
    "use strict";

    const SUPABASE_URL = "https://sqgzlaunnmwkulboyems.supabase.co";
    const SUPABASE_KEY = "sb_publishable_B35Zjt_oIOMZw-NCswwVmw_WhWwDzVa";
    const auth = window.KioraAuth;
    const contextBroker = window.KioraContextBroker;
    if (!auth || !contextBroker || !window.supabase) return;

    const client = window.yuriArticles?.getClient?.()
        || window.yuriArchive?.supabaseClient
        || window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const UI_STATE_KEY = "kiora_ui_state_v1";
    const DESKTOP_MIN_WIDTH = 320;
    const DESKTOP_MIN_HEIGHT = 360;
    const VIEWPORT_MARGIN = 8;
    let root;
    let panel;
    let entry;
    let messages;
    let composer;
    let input;
    let sendButton;
    let newButton;
    let statusLine;
    let contextLine;
    let budgetLine;
    let selectionRow;
    let selectionToggle;
    let state = null;
    let busy = false;
    let uiState = readUiState();
    let pointerOperation = null;

    const errors = Object.freeze({
        AUTH_REQUIRED: "OWNER session 已失效，请重新登录。",
        OWNER_REQUIRED: "Kiora 只允许 OWNER 使用。",
        OWNER_CHECK_FAILED: "服务端暂时无法确认 OWNER 身份。",
        KIORA_NOT_STARTED: "请先进行 First Boot。",
        BRAIN_NOT_CONFIGURED: "Brain 尚未配置。消息已记录，但 Kiora 现在还无法回答。",
        BRAIN_SECRET_MISSING: "Brain Provider Secret 尚未配置。",
        BRAIN_COST_CONFIG_INVALID: "当前 Brain 缺少有效的费用配置，调用已停止。",
        BRAIN_PROVIDER_UNAVAILABLE: "Brain Provider 暂时无法连接。",
        BRAIN_PROVIDER_FAILED: "Brain Provider 拒绝了本次请求。",
        BUDGET_HARD_LIMIT: "本月预算已达到硬限制。",
        CHAT_BUDGET_LIMIT: "本月聊天预算已达到限制。",
        TURN_IN_PROGRESS: "这条消息仍在处理中，请稍后刷新。",
        ORIGIN_DENIED: "当前域名不允许调用 Kiora Runtime。",
        RUNTIME_ERROR: "Kiora Runtime 暂时无法完成这次请求。"
    });

    function create(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function readUiState() {
        try {
            const saved = JSON.parse(localStorage.getItem(UI_STATE_KEY) || "null");
            if (!saved || typeof saved !== "object") throw new Error("INVALID");
            const savedNumber = (value) => typeof value === "number" && Number.isFinite(value) ? value : NaN;
            return {
                open: saved.open === true,
                minimized: saved.minimized !== false,
                x: savedNumber(saved.x),
                y: savedNumber(saved.y),
                width: savedNumber(saved.width),
                height: savedNumber(saved.height),
                mobileSnap: [0.4, 0.7, 0.95].includes(Number(saved.mobileSnap)) ? Number(saved.mobileSnap) : 0.7
            };
        } catch (_) {
            return { open: false, minimized: true, x: NaN, y: NaN, width: 420, height: NaN, mobileSnap: 0.7 };
        }
    }

    function saveUiState() {
        try { localStorage.setItem(UI_STATE_KEY, JSON.stringify(uiState)); } catch (_) { /* device storage unavailable */ }
    }

    function isMobile() {
        return window.matchMedia("(max-width: 767px)").matches;
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), Math.max(min, max));
    }

    function clampedDesktopState(source = uiState) {
        const width = clamp(Number.isFinite(source.width) ? source.width : 420, DESKTOP_MIN_WIDTH, innerWidth - VIEWPORT_MARGIN * 2);
        const height = clamp(Number.isFinite(source.height) ? source.height : innerHeight - 36, DESKTOP_MIN_HEIGHT, innerHeight - VIEWPORT_MARGIN * 2);
        const defaultX = innerWidth - width - 18;
        const x = clamp(Number.isFinite(source.x) ? source.x : defaultX, VIEWPORT_MARGIN, innerWidth - width - VIEWPORT_MARGIN);
        const y = clamp(Number.isFinite(source.y) ? source.y : 18, VIEWPORT_MARGIN, innerHeight - height - VIEWPORT_MARGIN);
        return { width, height, x, y };
    }

    function applyWindowGeometry() {
        if (!panel) return;
        if (isMobile()) {
            panel.style.removeProperty("left");
            panel.style.removeProperty("top");
            panel.style.removeProperty("width");
            panel.style.height = `${Math.round(innerHeight * uiState.mobileSnap)}px`;
            return;
        }
        const next = clampedDesktopState();
        Object.assign(uiState, next);
        panel.style.left = `${next.x}px`;
        panel.style.top = `${next.y}px`;
        panel.style.width = `${next.width}px`;
        panel.style.height = `${next.height}px`;
    }

    function beginPanelPointer(event, mode) {
        if (event.button !== undefined && event.button !== 0) return;
        if (event.target.closest("button, input, textarea, label")) return;
        event.preventDefault();
        panel.setPointerCapture(event.pointerId);
        pointerOperation = {
            mode,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            x: uiState.x,
            y: uiState.y,
            width: panel.getBoundingClientRect().width,
            height: panel.getBoundingClientRect().height
        };
    }

    function movePanelPointer(event) {
        if (!pointerOperation || event.pointerId !== pointerOperation.pointerId) return;
        const dx = event.clientX - pointerOperation.startX;
        const dy = event.clientY - pointerOperation.startY;
        if (isMobile()) {
            const height = clamp(pointerOperation.height - dy, innerHeight * 0.4, innerHeight * 0.95);
            panel.style.height = `${height}px`;
            return;
        }
        const draft = { ...uiState };
        if (pointerOperation.mode === "move") {
            draft.x = pointerOperation.x + dx;
            draft.y = pointerOperation.y + dy;
        } else {
            if (pointerOperation.mode.includes("e")) draft.width = pointerOperation.width + dx;
            if (pointerOperation.mode.includes("s")) draft.height = pointerOperation.height + dy;
        }
        Object.assign(uiState, clampedDesktopState(draft));
        applyWindowGeometry();
    }

    function endPanelPointer(event) {
        if (!pointerOperation || event.pointerId !== pointerOperation.pointerId) return;
        if (isMobile()) {
            const ratio = panel.getBoundingClientRect().height / innerHeight;
            uiState.mobileSnap = [0.4, 0.7, 0.95].reduce((best, value) => Math.abs(value - ratio) < Math.abs(best - ratio) ? value : best, 0.7);
            applyWindowGeometry();
        }
        pointerOperation = null;
        saveUiState();
    }

    function build() {
        root = create("div");
        root.id = "kiora-dock-root";
        root.hidden = true;

        entry = create("button", "kiora-star-entry", "✦");
        entry.type = "button";
        entry.setAttribute("aria-label", "Open Kiora");
        entry.setAttribute("aria-expanded", "false");
        entry.addEventListener("click", open);

        panel = create("aside", "kiora-dock-panel");
        panel.setAttribute("aria-label", "Kiora conversation");
        panel.setAttribute("aria-hidden", "true");

        const header = create("header", "kiora-dock-header");
        header.addEventListener("pointerdown", (event) => beginPanelPointer(event, "move"));
        const heading = create("div", "kiora-dock-heading");
        heading.append(create("strong", "", "✦ Kiora"), create("span", "", "LIFE / 01"));
        const actions = create("div", "kiora-dock-actions");
        newButton = create("button", "", "＋");
        newButton.type = "button";
        newButton.title = "New conversation";
        newButton.setAttribute("aria-label", "New conversation");
        newButton.addEventListener("click", newConversation);
        const closeButton = create("button", "", "—");
        closeButton.type = "button";
        closeButton.setAttribute("aria-label", "Close Kiora");
        closeButton.addEventListener("click", close);
        actions.append(newButton, closeButton);
        header.append(heading, actions);

        const meta = create("div", "kiora-dock-meta");
        contextLine = create("div", "kiora-context-line", "CONTEXT / READING PAGE");
        budgetLine = create("div", "kiora-budget-line", "BRAIN / READING REGISTRY");
        meta.append(contextLine, budgetLine);

        messages = create("div", "kiora-messages");
        messages.setAttribute("aria-live", "polite");

        composer = create("form", "kiora-composer");
        selectionRow = create("label", "kiora-context-choice");
        selectionToggle = document.createElement("input");
        selectionToggle.type = "checkbox";
        const selectionLabel = create("span", "", "INCLUDE SELECTED TEXT");
        selectionRow.append(selectionToggle, selectionLabel);
        selectionRow.hidden = true;
        const composeRow = create("div", "kiora-compose-row");
        input = document.createElement("textarea");
        input.rows = 1;
        input.maxLength = 6000;
        input.placeholder = "说点什么……";
        input.setAttribute("aria-label", "Message Kiora");
        sendButton = create("button", "kiora-send", "↗");
        sendButton.type = "submit";
        sendButton.setAttribute("aria-label", "Send message");
        composeRow.append(input, sendButton);
        statusLine = create("div", "kiora-runtime-status");
        statusLine.setAttribute("role", "status");
        composer.append(selectionRow, composeRow, statusLine);
        composer.addEventListener("submit", send);
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
                event.preventDefault();
                composer.requestSubmit();
            }
        });

        const resizeEast = create("div", "kiora-resize-handle kiora-resize-e");
        const resizeSouth = create("div", "kiora-resize-handle kiora-resize-s");
        const resizeCorner = create("div", "kiora-resize-handle kiora-resize-se");
        resizeEast.addEventListener("pointerdown", (event) => beginPanelPointer(event, "e"));
        resizeSouth.addEventListener("pointerdown", (event) => beginPanelPointer(event, "s"));
        resizeCorner.addEventListener("pointerdown", (event) => beginPanelPointer(event, "es"));
        panel.addEventListener("pointermove", movePanelPointer);
        panel.addEventListener("pointerup", endPanelPointer);
        panel.addEventListener("pointercancel", endPanelPointer);
        panel.append(header, meta, messages, composer, resizeEast, resizeSouth, resizeCorner);
        root.append(entry, panel);
        document.body.append(root);
        applyWindowGeometry();
        updateContext();
    }

    function setOpen(value) {
        root.classList.toggle("kiora-dock-root-open", value);
        entry.setAttribute("aria-expanded", String(value));
        panel.setAttribute("aria-hidden", String(!value));
        document.documentElement.classList.toggle("kiora-dock-open", value);
    }

    async function open() {
        uiState.open = true;
        uiState.minimized = false;
        saveUiState();
        applyWindowGeometry();
        setOpen(true);
        await load();
        if (state?.initialized && state?.chat_enabled) input.focus();
    }

    function close() {
        uiState.open = false;
        uiState.minimized = true;
        saveUiState();
        setOpen(false);
        entry.focus();
    }

    function setBusy(value) {
        busy = value;
        sendButton.disabled = value;
        newButton.disabled = value || !state?.initialized;
        input.disabled = value || !state?.chat_enabled;
    }

    function setStatus(text = "") {
        statusLine.textContent = text;
    }

    async function errorCode(error, data) {
        if (data?.code) return data.code;
        const response = error?.context;
        if (response?.clone) {
            try { return (await response.clone().json())?.code || "RUNTIME_ERROR"; } catch (_) { /* no-op */ }
        }
        return "RUNTIME_ERROR";
    }

    async function invoke(action, payload = {}) {
        const token = await auth.getOwnerAccessToken();
        if (!token) throw new Error("AUTH_REQUIRED");
        let result;
        try {
            result = await client.functions.invoke("kiora-runtime", {
                body: { action, ...payload },
                headers: { Authorization: `Bearer ${token}` }
            });
        } catch (_) {
            throw new Error("RUNTIME_ERROR");
        }
        if (result.error || !result.data?.success) throw new Error(await errorCode(result.error, result.data));
        return result.data.data;
    }

    function formatTime(value) {
        if (!value) return "";
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
    }

    function safeExternalUrl(value) {
        try {
            const url = new URL(String(value || ""));
            return ["http:", "https:"].includes(url.protocol) ? url.href : "";
        } catch (_) {
            return "";
        }
    }

    function messageNode(message) {
        const role = message.role === "owner" ? "owner" : "kiora";
        const node = create("div", `kiora-message kiora-message-${role}`);
        node.append(document.createTextNode(String(message.content || "")));
        const time = create("time", "", formatTime(message.created_at));
        if (time.textContent) node.append(time);
        if (Array.isArray(message.sources) && message.sources.length) {
            const details = create("details", "kiora-message-sources");
            details.append(create("summary", "", `SOURCES / ${message.sources.length}`));
            const list = create("div", "kiora-source-list");
            message.sources.forEach((source) => {
                const href = safeExternalUrl(source.url);
                if (!href) return;
                const link = create("a", "kiora-source-link", String(source.title || source.domain || "SOURCE"));
                link.href = href; link.target = "_blank"; link.rel = "noopener noreferrer";
                link.append(create("small", "", `${String(source.source_type || "unknown").toUpperCase()} · ${String(source.domain || "")}`));
                list.append(link);
            });
            details.append(list); node.append(details);
        }
        return node;
    }

    function render() {
        messages.replaceChildren();
        const initialized = Boolean(state?.initialized);
        const chatReady = initialized && state?.chat_enabled === true;
        composer.hidden = !chatReady;
        newButton.hidden = !chatReady;
        if (!chatReady) {
            const first = create("div", "kiora-first-boot");
            first.append(create("strong", "", initialized ? "PHASE 1" : "FIRST BOOT"));
            first.append(document.createTextNode(initialized
                ? "Kiora 的 Life 数据已经存在。启用 Phase 1 后，当前 Conversation 才会进入实际聊天链路。"
                : "这一步会创建 Kiora 的 Core 1.0、Growth 0.0、初始关系、自我状态和第一段 Conversation，并把此刻记录为出生时间。"));
            const start = create("button", "", initialized ? "ENABLE PHASE 1" : "BEGIN KIORA");
            start.type = "button";
            start.addEventListener("click", firstBoot);
            first.append(start);
            messages.append(first);
            budgetLine.textContent = "BRAIN / WAITING FOR FIRST BOOT";
            setBusy(false);
            return;
        }

        const rows = Array.isArray(state.messages) ? state.messages : [];
        if (!rows.length) messages.append(create("p", "kiora-empty", "这里还没有说过话。你可以只是叫她一声。"));
        else rows.forEach((message) => messages.append(messageNode(message)));
        const model = state.model;
        budgetLine.textContent = model
            ? `BRAIN / ${String(model.model_key || model.provider).toUpperCase()} · ${String(model.status || "").toUpperCase()}`
            : "BRAIN / UNCONFIGURED";
        setBusy(false);
        requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight; });
    }

    async function load() {
        if (busy) return;
        setBusy(true);
        setStatus("READING THE CURRENT CONVERSATION…");
        try {
            state = await invoke("bootstrap");
            setStatus("");
            render();
        } catch (error) {
            setStatus(errors[error.message] || errors.RUNTIME_ERROR);
            setBusy(false);
        }
    }

    async function firstBoot(event) {
        const button = event.currentTarget;
        button.disabled = true;
        setStatus("CREATING KIORA LIFE 1.0…");
        try {
            state = await invoke("start");
            setStatus("");
            render();
            input.focus();
        } catch (error) {
            setStatus(errors[error.message] || errors.RUNTIME_ERROR);
            button.disabled = false;
        }
    }

    async function newConversation() {
        if (busy || !state?.initialized) return;
        setBusy(true);
        setStatus("OPENING A NEW CONVERSATION…");
        try {
            state = await invoke("new_conversation");
            contextBroker.clearSelection();
            selectionToggle.checked = false;
            setStatus("");
            render();
            input.focus();
        } catch (error) {
            setStatus(errors[error.message] || errors.RUNTIME_ERROR);
            setBusy(false);
        }
    }

    async function send(event) {
        event.preventDefault();
        const content = input.value.trim();
        if (!content || busy || !state?.chat_enabled) return;
        const optimistic = { role: "owner", content, created_at: new Date().toISOString() };
        messages.querySelector(".kiora-empty")?.remove();
        messages.append(messageNode(optimistic));
        messages.scrollTop = messages.scrollHeight;
        input.value = "";
        setBusy(true);
        setStatus(/查一下|帮我查|搜索|调查|研究一下|最新|最近|新消息|look up|search|research/i.test(content) ? "CHECKING SOURCES…" : "KIORA IS LISTENING…");
        try {
            const result = await invoke("send_message", {
                content,
                client_message_key: crypto.randomUUID(),
                page_context: contextBroker.snapshot({ includeSelection: selectionToggle.checked })
            });
            if (result.reply) messages.append(messageNode({ role: "kiora", ...result.reply, sources: result.sources || [] }));
            selectionToggle.checked = false;
            contextBroker.clearSelection();
            setStatus("");
            setBusy(false);
            messages.scrollTop = messages.scrollHeight;
        } catch (error) {
            const message = errors[error.message] || errors.RUNTIME_ERROR;
            try {
                state = await invoke("bootstrap");
                render();
            } catch (_) {
                setBusy(false);
            }
            setStatus(message);
        }
    }

    function updateContext() {
        if (!contextLine) return;
        const context = contextBroker.snapshot();
        const visible = context.visible || {};
        const entity = String(visible.title || visible.name || "").trim();
        contextLine.textContent = `CONTEXT / ${String(context.page).replaceAll("_", " ").toUpperCase()}${entity ? ` / ${entity.slice(0, 48)}` : ""}`;
        const selection = contextBroker.selection();
        selectionRow.hidden = !selection;
        selectionRow.querySelector("span").textContent = selection ? `INCLUDE SELECTION / ${selection.slice(0, 54)}` : "INCLUDE SELECTED TEXT";
        if (!selection) selectionToggle.checked = false;
    }

    async function syncVisibility(nextState = auth.state) {
        const ownerSession = nextState?.role === "owner";
        root.hidden = true;
        if (!ownerSession) {
            setOpen(false);
            state = null;
            messages.replaceChildren();
            return;
        }
        try {
            state = await invoke("status");
            root.hidden = false;
            applyWindowGeometry();
            setOpen(uiState.open === true);
            if (uiState.open) render();
        } catch (_) {
            setOpen(false);
            state = null;
            messages.replaceChildren();
        }
    }

    build();
    window.addEventListener("kiora:contextchange", updateContext);
    window.addEventListener("kiora:authchange", (event) => syncVisibility(event.detail));
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && root.classList.contains("kiora-dock-root-open")) close(); });
    window.addEventListener("resize", () => { applyWindowGeometry(); saveUiState(); });
    window.addEventListener("beforeunload", saveUiState);
    auth.initialize(client).then(syncVisibility).catch(() => syncVisibility({ role: "viewer" }));
})();
