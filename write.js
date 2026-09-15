(async function () {
    "use strict";

    const common = window.yuriArticles;
    const db = common.getClient();
    const auth = window.KioraAuth;
    const params = new URLSearchParams(window.location.search);
    const writingId = params.get("id");
    const requestedType = params.get("type");
    const allowedCategories = Object.keys(common.categories);
    const initialType = allowedCategories.includes(requestedType) ? requestedType : "essay";
    const draftKey = `yuri:writing-draft:${writingId ? `id:${writingId}` : `new:${initialType}`}`;
    const editor = document.getElementById("write-editor");
    const gateStatus = document.getElementById("write-gate-status");
    const form = document.getElementById("write-form");
    const body = document.getElementById("write-body");
    const preview = document.getElementById("write-preview");
    const saveState = document.getElementById("save-state");
    const message = document.getElementById("write-message");
    let currentWriting = null;
    let adminUser = null;
    let dirty = false;
    let previewing = false;
    let draftTimer;

    const field = (id) => document.getElementById(id);
    const setMessage = (text, error = false) => {
        message.textContent = text;
        message.classList.toggle("error", error);
    };

    function localDate(value = new Date()) {
        const date = new Date(value);
        const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
        return local.toISOString().slice(0, 10);
    }

    function collectDraft() {
        return {
            title: field("write-title").value,
            subtitle: field("write-subtitle").value,
            excerpt: field("write-excerpt").value,
            date: field("write-date").value,
            category: field("write-category").value,
            tags: field("write-tags").value,
            sortOrder: field("write-sort").value,
            cover: field("write-cover").value,
            pinned: field("write-pinned").checked,
            isPublic: field("write-public").checked,
            body: body.value,
            savedAt: new Date().toISOString()
        };
    }

    function applyDraft(draft) {
        field("write-title").value = draft.title || "";
        field("write-subtitle").value = draft.subtitle || "";
        field("write-excerpt").value = draft.excerpt || "";
        field("write-date").value = draft.date || localDate();
        field("write-category").value = allowedCategories.includes(draft.category) ? draft.category : initialType;
        field("write-tags").value = draft.tags || "";
        field("write-sort").value = draft.sortOrder ?? "";
        field("write-cover").value = draft.cover || "";
        field("write-pinned").checked = Boolean(draft.pinned);
        field("write-public").checked = draft.isPublic !== false;
        body.value = draft.body || "";
        updateStats();
    }

    function saveDraft() {
        if (!dirty) return;
        localStorage.setItem(draftKey, JSON.stringify(collectDraft()));
        saveState.textContent = "DRAFT SAVED";
    }

    function scheduleDraft() {
        dirty = true;
        saveState.textContent = "UNSAVED";
        clearTimeout(draftTimer);
        draftTimer = setTimeout(saveDraft, 3000);
    }

    function updateStats() {
        const count = common.wordCount(body.value);
        field("word-count").textContent = `${count} 字`;
        field("reading-time").textContent = `约 ${common.readingMinutes(body.value)} 分钟阅读`;
        if (previewing) preview.innerHTML = common.markdownToHtml(body.value);
    }

    function togglePreview(force) {
        previewing = typeof force === "boolean" ? force : !previewing;
        body.hidden = previewing;
        preview.hidden = !previewing;
        field("toggle-preview").classList.toggle("active", previewing);
        field("toggle-preview").textContent = previewing ? "EDIT" : "PREVIEW";
        if (previewing) preview.innerHTML = common.markdownToHtml(body.value);
    }

    function replaceSelection(prefix, suffix = prefix) {
        body.focus();
        const start = body.selectionStart;
        const end = body.selectionEnd;
        const selected = body.value.slice(start, end);
        body.setRangeText(`${prefix}${selected}${suffix}`, start, end, "select");
        body.selectionStart = start + prefix.length;
        body.selectionEnd = start + prefix.length + selected.length;
        scheduleDraft();
        updateStats();
    }

    function prefixLines(prefix) {
        body.focus();
        const start = body.selectionStart;
        const end = body.selectionEnd;
        const selected = body.value.slice(start, end) || "文字";
        const changed = selected.split("\n").map((line) => `${prefix}${line}`).join("\n");
        body.setRangeText(changed, start, end, "end");
        scheduleDraft();
        updateStats();
    }

    function toolbarAction(button) {
        if (button.dataset.wrap) return replaceSelection(button.dataset.wrap);
        if (button.dataset.prefix) return prefixLines(button.dataset.prefix);
        const command = button.dataset.command;
        if (command === "undo" || command === "redo") {
            body.focus();
            document.execCommand(command);
            scheduleDraft();
            updateStats();
        } else if (command === "link") {
            body.focus();
            const start = body.selectionStart;
            const end = body.selectionEnd;
            const label = body.value.slice(start, end) || "链接文字";
            body.setRangeText(`[${label}](https://)`, start, end, "end");
            scheduleDraft();
        } else if (command === "rule") {
            body.setRangeText("\n\n---\n\n", body.selectionStart, body.selectionEnd, "end");
            scheduleDraft();
        } else if (command === "preview") {
            togglePreview();
        } else if (command === "save") {
            form.requestSubmit();
        }
    }

    document.querySelectorAll(".editor-toolbar, .mobile-write-toolbar").forEach((toolbar) => {
        toolbar.addEventListener("click", (event) => {
            const button = event.target.closest("button");
            if (!button) return;
            if (button.id === "toggle-preview") return togglePreview();
            toolbarAction(button);
        });
    });

    form.addEventListener("input", () => {
        scheduleDraft();
        updateStats();
    });

    window.addEventListener("beforeunload", (event) => {
        if (!dirty) return;
        saveDraft();
        event.preventDefault();
        event.returnValue = "";
    });

    function goBack() {
        if (dirty && !window.confirm("还有未保存的修改，确定离开写作页吗？草稿会保留在此设备。")) return;
        const stored = sessionStorage.getItem("yuri:return-scroll");
        if (stored) sessionStorage.setItem("yuri:restore-scroll", stored);
        window.location.href = "writing.html";
    }
    field("write-back").addEventListener("click", goBack);

    async function uploadCover() {
        const file = field("write-cover-file").files[0];
        if (!file) return field("write-cover").value.trim() || null;
        if (!file.type.startsWith("image/")) throw new Error("请选择图片文件。");
        if (file.size > 5 * 1024 * 1024) throw new Error("图片不能超过 5MB。");
        const extension = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
        const path = `writings/${crypto.randomUUID()}.${extension}`;
        const { data, error } = await auth.uploadSiteMedia(file, path);
        if (error) throw error;
        return data.publicUrl;
    }

    function managedPath(url) {
        try {
            const marker = "/storage/v1/object/public/site-media/";
            const pathname = new URL(url).pathname;
            const index = pathname.indexOf(marker);
            return index < 0 ? null : decodeURIComponent(pathname.slice(index + marker.length));
        } catch (_) {
            return null;
        }
    }

    async function removeOldCover(oldUrl, newUrl) {
        if (auth.role !== "owner") return;
        if (!oldUrl || oldUrl === newUrl) return;
        const path = managedPath(oldUrl);
        if (path) await db.storage.from("site-media").remove([path]);
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!adminUser) return;
        setMessage("正在保存……");
        saveState.textContent = "SAVING…";
        let coverUrl;
        try {
            coverUrl = await uploadCover();
        } catch (error) {
            setMessage(`封面上传失败：${error.message}`, true);
            saveState.textContent = "SAVE FAILED";
            saveDraft();
            return;
        }

        const payload = {
            title: field("write-title").value.trim(),
            subtitle: field("write-subtitle").value.trim() || null,
            excerpt: field("write-excerpt").value.trim() || null,
            body: body.value.trim(),
            category: field("write-category").value,
            published_at: new Date(`${field("write-date").value}T00:00:00+09:00`).toISOString(),
            cover_url: coverUrl,
            tags: field("write-tags").value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
            sort_order: field("write-sort").value === "" ? null : Number(field("write-sort").value),
            is_pinned: field("write-pinned").checked,
            is_public: field("write-public").checked
        };
        if (!payload.title || !payload.body) {
            setMessage("标题和正文不能为空。", true);
            saveDraft();
            return;
        }

        const result = await auth.write(
            currentWriting ? "writing_update" : "writing_create",
            currentWriting ? { id: currentWriting.id, data: payload } : { data: payload },
            () => currentWriting
                ? db.from("writings").update(payload).eq("id", currentWriting.id).select("id").single()
                : db.from("writings").insert(payload).select("id").single()
        );
        if (result.error) {
            setMessage(`保存失败：${result.error.message}`, true);
            saveState.textContent = "SAVE FAILED";
            saveDraft();
            return;
        }

        await removeOldCover(currentWriting?.cover_url, coverUrl);
        localStorage.removeItem(draftKey);
        dirty = false;
        saveState.textContent = "SAVED";
        setMessage("Saved / 已保存");
        window.setTimeout(() => {
            window.location.href = `read.html?id=${encodeURIComponent(result.data.id)}&from=${encodeURIComponent(payload.category)}`;
        }, 450);
    });

    field("delete-writing").addEventListener("click", async () => {
        if (auth.role !== "owner") return;
        if (!currentWriting || !window.confirm(`确定删除《${currentWriting.title}》吗？`)) return;
        const { error } = await db.from("writings").delete().eq("id", currentWriting.id);
        if (error) {
            setMessage(`删除失败：${error.message}`, true);
            return;
        }
        const path = managedPath(currentWriting.cover_url);
        if (path) await db.storage.from("site-media").remove([path]);
        localStorage.removeItem(draftKey);
        dirty = false;
        goBack();
    });

    document.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            form.requestSubmit();
        }
    });

    await auth.initialize(db);
    if (!(auth.can("writing:create") || auth.can("writing:edit"))) {
        gateStatus.textContent = "此页面仅限管理员使用，正在返回首页……";
        window.setTimeout(() => { window.location.href = "index.html"; }, 900);
        return;
    }
    adminUser = auth.state.identity || auth.role;

    if (writingId) {
        const { data, error } = auth.role === "editor"
            ? await auth.readForEditor("writing_get", { id: writingId })
            : await db.from("writings").select("*").eq("id", writingId).maybeSingle();
        if (error || !data || data.category === "archive") {
            gateStatus.textContent = error?.message || "文章不存在。";
            return;
        }
        currentWriting = data;
        applyDraft({
            title: data.title,
            subtitle: data.subtitle,
            excerpt: data.excerpt,
            date: localDate(data.published_at),
            category: data.category,
            tags: (data.tags || []).join(", "),
            sortOrder: data.sort_order,
            cover: data.cover_url,
            pinned: data.is_pinned,
            isPublic: data.is_public,
            body: data.body
        });
        field("write-page-title").textContent = "Edit writing";
        field("write-mode").textContent = common.categories[data.category]?.label || "WRITING EDITOR";
        field("delete-writing").hidden = auth.role !== "owner";
        document.title = `Edit ${data.title} · Kiora`;
    } else {
        applyDraft({ date: localDate(), category: initialType, isPublic: true });
        field("write-mode").textContent = common.categories[initialType].label;
    }

    const savedDraft = localStorage.getItem(draftKey);
    if (savedDraft) field("draft-recovery").hidden = false;
    field("restore-draft").addEventListener("click", () => {
        try {
            applyDraft(JSON.parse(savedDraft));
            dirty = true;
            saveState.textContent = "DRAFT RESTORED";
        } catch (_) {
            localStorage.removeItem(draftKey);
        }
        field("draft-recovery").hidden = true;
    });
    field("discard-draft").addEventListener("click", () => {
        localStorage.removeItem(draftKey);
        field("draft-recovery").hidden = true;
    });

    gateStatus.hidden = true;
    editor.hidden = false;
    field("mobile-write-toolbar").hidden = false;
    saveState.textContent = "READY";
    updateStats();
})();
