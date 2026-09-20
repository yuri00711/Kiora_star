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

    function build() {
        root = create("div");
        root.id = "kiora-dock-root";
        root.hidden = true;

        const scrim = create("button", "kiora-dock-scrim");
        scrim.type = "button";
        scrim.tabIndex = -1;
        scrim.setAttribute("aria-label", "Close Kiora");
        scrim.addEventListener("click", close);

        entry = create("button", "kiora-star-entry", "✦");
        entry.type = "button";
        entry.setAttribute("aria-label", "Open Kiora");
        entry.setAttribute("aria-expanded", "false");
        entry.addEventListener("click", open);

        panel = create("aside", "kiora-dock-panel");
        panel.setAttribute("aria-label", "Kiora conversation");
        panel.setAttribute("aria-hidden", "true");

        const header = create("header", "kiora-dock-header");
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

        panel.append(header, meta, messages, composer);
        root.append(scrim, entry, panel);
        document.body.append(root);
        updateContext();
    }

    function setOpen(value) {
        root.classList.toggle("kiora-dock-root-open", value);
        entry.setAttribute("aria-expanded", String(value));
        panel.setAttribute("aria-hidden", String(!value));
        document.documentElement.classList.toggle("kiora-dock-open", value);
    }

    async function open() {
        setOpen(true);
        await load();
        if (state?.initialized && state?.chat_enabled) input.focus();
    }

    function close() {
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

    function messageNode(message) {
        const role = message.role === "owner" ? "owner" : "kiora";
        const node = create("div", `kiora-message kiora-message-${role}`);
        node.append(document.createTextNode(String(message.content || "")));
        const time = create("time", "", formatTime(message.created_at));
        if (time.textContent) node.append(time);
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
        const budget = state.budget || {};
        const spent = Number(budget.spent);
        const usage = Number.isFinite(spent) && budget.currency ? ` · ${spent.toFixed(4)} ${budget.currency}` : "";
        budgetLine.textContent = model
            ? `BRAIN / ${String(model.model_key || model.provider).toUpperCase()} · ${String(model.status || "").toUpperCase()}${usage}`
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
        setStatus("KIORA IS LISTENING…");
        try {
            const result = await invoke("send_message", {
                content,
                client_message_key: crypto.randomUUID(),
                page_context: contextBroker.snapshot({ includeSelection: selectionToggle.checked })
            });
            if (result.reply) messages.append(messageNode({ role: "kiora", ...result.reply }));
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
        contextLine.textContent = `CONTEXT / ${String(context.page).replaceAll("_", " ").toUpperCase()}`;
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
    auth.initialize(client).then(syncVisibility).catch(() => syncVisibility({ role: "viewer" }));
})();
