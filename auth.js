(function () {
    "use strict";

    const EDITOR_TOKEN_KEY = "kiora:editor-session";
    const EDITOR_PERMISSIONS = new Set([
        "profile:update",
        "profile-item:create",
        "profile-item:edit",
        "otome:update",
        "writing:create",
        "writing:edit",
        "writing:pin",
        "game:create",
        "game:edit",
        "game-repo:edit",
        "character:create",
        "character:edit",
        "music:create",
        "music:edit",
        "currently-playing:update",
        "tier-board:create",
        "tier-board:edit",
        "tier-section:create",
        "tier-section:edit",
        "tier-section:reorder",
        "tier-item:edit",
        "tier-item:reorder",
        "storage:upload"
    ]);
    const ACTION_PERMISSIONS = Object.freeze({
        profile_update: "profile:update",
        profile_item_create: "profile-item:create",
        profile_item_update: "profile-item:edit",
        otome_update: "otome:update",
        writing_create: "writing:create",
        writing_update: "writing:edit",
        writing_pin: "writing:pin",
        game_create: "game:create",
        game_update: "game:edit",
        game_repo_get: "game-repo:edit",
        game_repo_upsert: "game-repo:edit",
        character_create: "character:create",
        character_update: "character:edit",
        music_create: "music:create",
        music_update: "music:edit",
        currently_playing_update: "currently-playing:update",
        tier_board_create: "tier-board:create",
        tier_board_update: "tier-board:edit",
        tier_section_create: "tier-section:create",
        tier_section_update: "tier-section:edit",
        tier_sections_reorder: "tier-section:reorder",
        tier_item_move: "tier-item:edit",
        tier_items_reorder: "tier-item:reorder",
        upload_site_media: "storage:upload"
    });

    let client = null;
    let initPromise = null;
    let authState = Object.freeze({ role: "viewer", identity: null });

    function publish(role, identity = null) {
        authState = Object.freeze({ role, identity });
        window.dispatchEvent(new CustomEvent("kiora:authchange", { detail: authState }));
        return authState;
    }

    function storedEditorSession() {
        try {
            const value = JSON.parse(localStorage.getItem(EDITOR_TOKEN_KEY) || "null");
            if (!value?.token || !Number.isFinite(Number(value.expiresAt))) return null;
            if (Number(value.expiresAt) <= Math.floor(Date.now() / 1000)) {
                localStorage.removeItem(EDITOR_TOKEN_KEY);
                return null;
            }
            return value;
        } catch (_) {
            localStorage.removeItem(EDITOR_TOKEN_KEY);
            return null;
        }
    }

    function saveEditorSession(token, expiresAt) {
        localStorage.setItem(EDITOR_TOKEN_KEY, JSON.stringify({ token, expiresAt }));
    }

    function clearEditorSession() {
        localStorage.removeItem(EDITOR_TOKEN_KEY);
    }

    async function readFunctionError(error, data) {
        if (typeof data?.code === "string") return data.code;
        const response = error?.context;
        if (!response || typeof response.clone !== "function") return error?.name || "FUNCTION_ERROR";
        try {
            const body = await response.clone().json();
            return typeof body?.code === "string" ? body.code : "FUNCTION_ERROR";
        } catch (_) {
            return "FUNCTION_ERROR";
        }
    }

    function normalizedError(code, fallback = "Request failed") {
        return { code: code || "FUNCTION_ERROR", message: fallback };
    }

    async function invokeEditorApi(action, payload = {}) {
        const editor = storedEditorSession();
        if (!client || !editor) {
            return { data: null, error: normalizedError("EDITOR_SESSION_REQUIRED", "Editor session required") };
        }
        let data;
        let error;
        try {
            const result = await client.functions.invoke("editor-api", {
                body: { action, payload },
                headers: { Authorization: `Bearer ${editor.token}` }
            });
            data = result.data;
            error = result.error;
        } catch (_) {
            return { data: null, error: normalizedError("FUNCTION_ERROR", "Editor request failed") };
        }
        if (error || !data?.success) {
            const code = await readFunctionError(error, data);
            if (["EDITOR_SESSION_INVALID", "EDITOR_SESSION_EXPIRED"].includes(code)) {
                clearEditorSession();
                publish("viewer");
            }
            return { data: null, error: normalizedError(code, "Editor request failed") };
        }
        return { data: data.data ?? null, error: null };
    }

    async function initialize(db, force = false) {
        if (db) client = db;
        if (!client) throw new Error("Supabase client is required");
        if (initPromise && !force) return initPromise;
        initPromise = (async () => {
            const { data, error } = await client.auth.getSession();
            if (!error && data.session?.user) {
                return publish("owner", {
                    id: data.session.user.id,
                    email: data.session.user.email || null
                });
            }
            const editor = storedEditorSession();
            if (!editor) return publish("viewer");
            const verified = await invokeEditorApi("session_status");
            if (verified.error) {
                return publish("viewer");
            }
            return publish("editor", verified.data?.identity || "editor");
        })();
        try {
            return await initPromise;
        } finally {
            initPromise = null;
        }
    }

    function syncOwnerSession(session) {
        if (session?.user) {
            return publish("owner", { id: session.user.id, email: session.user.email || null });
        }
        if (authState.role === "owner") return publish("viewer");
        return authState;
    }

    async function loginOwner(email, password) {
        if (!client) throw new Error("Supabase client is required");
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error || !data.user || !data.session) return { data: null, error };
        clearEditorSession();
        publish("owner", { id: data.user.id, email: data.user.email || null });
        return { data, error: null };
    }

    async function loginEditor(username, password) {
        if (!client) throw new Error("Supabase client is required");
        let data;
        let error;
        try {
            const result = await client.functions.invoke("editor-login", {
                body: { username: String(username ?? "").trim(), password: String(password ?? "") }
            });
            data = result.data;
            error = result.error;
        } catch (_) {
            return { data: null, error: normalizedError("FUNCTION_ERROR", "Editor login failed") };
        }
        if (error || !data?.token || !data?.expires_at) {
            return { data: null, error: normalizedError(await readFunctionError(error, data), "Editor login failed") };
        }
        saveEditorSession(data.token, Number(data.expires_at));
        publish("editor", data.identity || String(username ?? "").trim());
        return { data, error: null };
    }

    async function logout() {
        if (authState.role === "owner" && client) await client.auth.signOut();
        if (authState.role === "editor") clearEditorSession();
        return publish("viewer");
    }

    function can(permission) {
        if (authState.role === "owner") return true;
        return authState.role === "editor" && EDITOR_PERMISSIONS.has(permission);
    }

    async function write(action, payload, ownerOperation) {
        if (authState.role === "owner") {
            return typeof ownerOperation === "function"
                ? ownerOperation()
                : { data: null, error: normalizedError("OWNER_OPERATION_MISSING") };
        }
        const permission = ACTION_PERMISSIONS[action];
        if (authState.role !== "editor" || !permission || !can(permission)) {
            return { data: null, error: normalizedError("PERMISSION_DENIED", "Permission denied") };
        }
        return invokeEditorApi(action, payload);
    }

    async function readForEditor(action, payload = {}) {
        if (authState.role !== "editor") {
            return { data: null, error: normalizedError("EDITOR_SESSION_REQUIRED") };
        }
        return invokeEditorApi(action, payload);
    }

    async function fileToBase64(file) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        const chunk = 0x8000;
        for (let index = 0; index < bytes.length; index += chunk) {
            binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
        }
        return btoa(binary);
    }

    async function uploadSiteMedia(file, path) {
        if (!file || !path) return { data: null, error: normalizedError("INVALID_PAYLOAD") };
        if (authState.role === "owner") {
            const result = await client.storage.from("site-media").upload(path, file, {
                cacheControl: "3600",
                contentType: file.type,
                upsert: false
            });
            if (result.error) return result;
            const publicUrl = client.storage.from("site-media").getPublicUrl(path).data.publicUrl;
            return { data: { path, publicUrl }, error: null };
        }
        if (!can("storage:upload")) {
            return { data: null, error: normalizedError("PERMISSION_DENIED") };
        }
        return invokeEditorApi("upload_site_media", {
            path,
            content_type: file.type,
            base64: await fileToBase64(file)
        });
    }

    window.KioraAuth = Object.freeze({
        can,
        initialize,
        loginEditor,
        loginOwner,
        logout,
        readForEditor,
        syncOwnerSession,
        uploadSiteMedia,
        write,
        get state() { return authState; },
        get role() { return authState.role; }
    });
})();
