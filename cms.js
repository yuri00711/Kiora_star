(function () {
    "use strict";

    const bridge = window.yuriArchive;
    if (!bridge?.supabaseClient) {
        console.error("CMS could not start: the main archive script is unavailable.");
        return;
    }

    const db = bridge.supabaseClient;
    const categoryLabels = {
        game_review: "星间余响",
        essay: "月下漫笔",
        dream: "梦境来信",
        archive: "拾光匣"
    };
    const itemTables = {
        fandom: "profile_fandoms",
        favorite: "profile_favorites",
        boundary: "profile_boundaries"
    };
    const state = {
        profile: {},
        fandoms: [],
        favorites: [],
        boundaries: [],
        otome: { axes: [], play_styles: [], favorite_elements: [], not_my_type: [] },
        writings: []
    };

    const byId = (id) => document.getElementById(id);
    const isAdmin = () => Boolean(bridge.currentUser);
    const value = (id) => byId(id)?.value ?? "";
    const optional = (text) => text.trim() || null;
    const numberOrNull = (text) => text === "" ? null : Number(text);
    const splitTags = (text) => text
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean);

    function escapeHtml(text) {
        return String(text ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function safeUrl(url) {
        return bridge.safeImageUrl(String(url ?? "").trim());
    }

    function inlineMarkup(text) {
        let html = escapeHtml(text);
        html = html.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, (_match, alt, url) =>
            `<img src="${url}" alt="${alt}" loading="lazy">`
        );
        html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label, url) =>
            `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
        );
        html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
        html = html.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
        return html;
    }

    function markdownToHtml(source) {
        const lines = String(source ?? "").replaceAll("\r\n", "\n").split("\n");
        const output = [];
        let paragraph = [];
        const flush = () => {
            if (!paragraph.length) return;
            output.push(`<p>${paragraph.map(inlineMarkup).join("<br>")}</p>`);
            paragraph = [];
        };

        for (const line of lines) {
            if (!line.trim()) {
                flush();
                continue;
            }
            const heading = line.match(/^(#{1,3})\s+(.+)$/);
            if (heading) {
                flush();
                const level = heading[1].length + 1;
                output.push(`<h${level}>${inlineMarkup(heading[2])}</h${level}>`);
                continue;
            }
            const quote = line.match(/^>\s?(.*)$/);
            if (quote) {
                flush();
                output.push(`<blockquote>${inlineMarkup(quote[1])}</blockquote>`);
                continue;
            }
            paragraph.push(line);
        }
        flush();
        return output.join("");
    }

    function formatDate(date) {
        if (!date) return "";
        return new Intl.DateTimeFormat("zh-CN", {
            year: "numeric",
            month: "long",
            day: "numeric"
        }).format(new Date(date));
    }

    function toLocalDateTime(date) {
        const source = date ? new Date(date) : new Date();
        const local = new Date(source.getTime() - source.getTimezoneOffset() * 60000);
        return local.toISOString().slice(0, 16);
    }

    function create(tag, className, text) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    }

    function emptyState(text) {
        return create("p", "cms-empty", text);
    }

    function showMessage(id, text, isError = false) {
        const element = byId(id);
        if (!element) return;
        element.textContent = text;
        element.classList.toggle("error", isError);
    }

    function errorMessage(error) {
        const missingTable = error?.code === "42P01" || error?.code === "PGRST205";
        return missingTable
            ? "CMS 数据表尚未创建。请先在 Supabase 执行 supabase-cms-migration.sql。"
            : `读取失败：${error?.message || "Unknown error"}`;
    }

    async function uploadImage(inputId, folder, fallbackUrl) {
        const file = byId(inputId)?.files?.[0];
        if (!file) return optional(fallbackUrl || "");
        if (!file.type.startsWith("image/")) throw new Error("请选择图片文件。");
        if (file.size > 5 * 1024 * 1024) throw new Error("图片不能超过 5MB。");
        const extension = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
        const path = `${folder}/${crypto.randomUUID()}.${extension}`;
        const { error } = await db.storage.from("site-media").upload(path, file, {
            cacheControl: "3600",
            contentType: file.type,
            upsert: false
        });
        if (error) throw error;
        const { data } = db.storage.from("site-media").getPublicUrl(path);
        return data.publicUrl;
    }

    function managedStoragePath(url) {
        if (!url) return null;
        try {
            const parsed = new URL(url);
            const marker = "/storage/v1/object/public/site-media/";
            const index = parsed.pathname.indexOf(marker);
            return index === -1 ? null : decodeURIComponent(parsed.pathname.slice(index + marker.length));
        } catch (_) {
            return null;
        }
    }

    async function removeReplacedImage(oldUrl, newUrl) {
        if (!oldUrl || oldUrl === newUrl) return;
        const path = managedStoragePath(oldUrl);
        if (!path) return;
        const { error } = await db.storage.from("site-media").remove([path]);
        if (error) console.warn("Could not remove replaced site image:", error.message);
    }

    function updateAdminControls() {
        document.querySelectorAll(".cms-admin-button").forEach((button) => {
            button.classList.toggle("hidden", !isAdmin());
        });
        renderProfileCollections();
        renderWritings();
    }

    // Sidebar
    const sidebarShell = byId("site-sidebar-shell");
    const menuButton = byId("site-menu-button");

    function setSidebar(open) {
        sidebarShell?.classList.toggle("active", open);
        sidebarShell?.setAttribute("aria-hidden", String(!open));
        menuButton?.setAttribute("aria-expanded", String(open));
        document.body.classList.toggle("sidebar-open", open);
        if (open) byId("site-sidebar")?.querySelector("a")?.focus();
        else menuButton?.focus();
    }

    menuButton?.addEventListener("click", () => setSidebar(true));
    document.querySelector(".site-sidebar-backdrop")?.addEventListener("click", () => setSidebar(false));
    document.querySelector(".site-sidebar-close")?.addEventListener("click", () => setSidebar(false));
    document.querySelectorAll(".site-sidebar a").forEach((link) => {
        link.addEventListener("click", () => setSidebar(false));
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && sidebarShell?.classList.contains("active")) setSidebar(false);
    });

    const sectionObserver = new IntersectionObserver((entries) => {
        const visible = entries
            .filter((entry) => entry.isIntersecting)
            .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        document.querySelectorAll(".site-sidebar a").forEach((link) => {
            link.classList.toggle("active", link.dataset.section === visible.target.id);
        });
    }, { rootMargin: "-35% 0px -45%", threshold: [0, 0.2, 0.5] });
    ["about", "games", "writing", "archive"].forEach((id) => {
        const section = byId(id);
        if (section) sectionObserver.observe(section);
    });

    // Profile loading and rendering
    async function loadProfile() {
        byId("profile-status")?.classList.remove("hidden");
        showMessage("profile-status", "Loading profile…");
        const queries = await Promise.all([
            db.from("site_profile").select("*").eq("id", 1).maybeSingle(),
            db.from("profile_fandoms").select("*").order("sort_order", { ascending: true, nullsFirst: false }).order("created_at"),
            db.from("profile_favorites").select("*").order("sort_order", { ascending: true, nullsFirst: false }).order("created_at"),
            db.from("profile_boundaries").select("*").order("sort_order", { ascending: true, nullsFirst: false }).order("created_at"),
            db.from("otome_profile").select("*").eq("id", 1).maybeSingle()
        ]);

        const firstError = queries.find((result) => result.error)?.error;
        if (firstError) {
            showMessage("profile-status", errorMessage(firstError), true);
            byId("profile-content")?.classList.add("hidden");
            return;
        }

        state.profile = queries[0].data || {};
        state.fandoms = queries[1].data || [];
        state.favorites = queries[2].data || [];
        state.boundaries = queries[3].data || [];
        state.otome = queries[4].data || state.otome;
        showMessage("profile-status", "");
        byId("profile-status")?.classList.add("hidden");
        byId("profile-content")?.classList.remove("hidden");
        renderProfile();
    }

    function renderProfile() {
        const profile = state.profile;
        byId("profile-nickname").textContent = profile.nickname || (isAdmin() ? "尚未填写名字" : "");
        byId("profile-tagline").textContent = profile.tagline || "";
        byId("profile-summary").textContent = profile.summary || "";
        byId("profile-about-text").innerHTML = profile.about_text
            ? markdownToHtml(profile.about_text)
            : `<p class="cms-empty">${isAdmin() ? "点击 EDIT PROFILE 写下完整的自我介绍。" : ""}</p>`;
        byId("free-space-content").innerHTML = profile.free_space_content
            ? markdownToHtml(profile.free_space_content)
            : `<p class="cms-empty">${isAdmin() ? "这里还没有留下文字。" : ""}</p>`;

        const avatar = byId("profile-avatar");
        const placeholder = byId("profile-avatar-placeholder");
        const avatarUrl = safeUrl(profile.avatar_url);
        avatar.classList.toggle("hidden", !avatarUrl);
        placeholder.classList.toggle("hidden", Boolean(avatarUrl));
        if (avatarUrl) {
            avatar.src = avatarUrl;
            avatar.alt = profile.nickname ? `${profile.nickname} 的头像` : "Profile avatar";
        } else {
            avatar.removeAttribute("src");
        }
        renderProfileCollections();
        renderOtome();
    }

    function adminEditButton(kind, item) {
        if (!isAdmin()) return null;
        const button = create("button", "cms-mini-button", "EDIT");
        button.type = "button";
        button.dataset.editItem = kind;
        button.dataset.itemId = item.id;
        return button;
    }

    function renderProfileCollections() {
        renderFandoms();
        renderFavorites();
        renderBoundaries();
    }

    function renderFandoms() {
        const container = byId("profile-fandoms");
        if (!container) return;
        container.replaceChildren();
        if (!state.fandoms.length) {
            container.append(emptyState(isAdmin() ? "还没有添加坑。" : "暂无内容。"));
            return;
        }
        state.fandoms.forEach((item) => {
            const card = create("article", "fandom-card");
            const imageUrl = safeUrl(item.image_url);
            if (imageUrl) {
                const image = create("img", "fandom-image");
                image.src = imageUrl;
                image.alt = "";
                image.loading = "lazy";
                card.append(image);
            }
            const copy = create("div", "fandom-copy");
            copy.append(create("span", "collection-status", item.status));
            copy.append(create("h4", "", item.name));
            if (item.description) copy.append(create("p", "", item.description));
            card.append(copy);
            const edit = adminEditButton("fandom", item);
            if (edit) card.append(edit);
            container.append(card);
        });
    }

    function renderFavorites() {
        const container = byId("profile-favorites");
        if (!container) return;
        container.replaceChildren();
        if (!state.favorites.length) {
            container.append(emptyState(isAdmin() ? "陈列柜还是空的。" : "暂无内容。"));
            return;
        }
        state.favorites.forEach((item) => {
            const card = create("article", "favorite-card");
            const imageUrl = safeUrl(item.image_url);
            const visual = create("div", "favorite-visual");
            if (imageUrl) {
                const image = create("img", "");
                image.src = imageUrl;
                image.alt = item.name;
                image.loading = "lazy";
                visual.append(image);
            } else {
                visual.append(create("span", "", item.symbol || "✦"));
            }
            const copy = create("div", "favorite-copy");
            const top = create("div", "favorite-topline");
            top.append(create("span", "collection-status", item.favorite_level));
            if (item.symbol) top.append(create("span", "favorite-symbol", item.symbol));
            copy.append(top, create("h4", "", item.name));
            if (item.work_name) copy.append(create("p", "favorite-work", item.work_name));
            if (item.note) copy.append(create("p", "favorite-note", item.note));
            card.append(visual, copy);
            const edit = adminEditButton("favorite", item);
            if (edit) card.append(edit);
            container.append(card);
        });
    }

    function renderBoundaries() {
        const container = byId("profile-boundaries");
        if (!container) return;
        container.replaceChildren();
        if (!state.boundaries.length) {
            container.append(emptyState(isAdmin() ? "还没有填写需要避开的内容。" : "暂无内容。"));
            return;
        }
        state.boundaries.forEach((item) => {
            const chip = create("div", "boundary-chip");
            chip.append(create("span", "boundary-kind", item.kind), create("p", "", item.label));
            const edit = adminEditButton("boundary", item);
            if (edit) chip.append(edit);
            container.append(chip);
        });
    }

    function renderTags(containerId, tags) {
        const container = byId(containerId);
        if (!container) return;
        container.replaceChildren();
        (tags || []).forEach((tag) => container.append(create("span", "", tag)));
        if (!tags?.length) container.append(emptyState("—"));
    }

    function renderOtome() {
        const container = byId("otome-axes");
        if (!container) return;
        container.replaceChildren();
        const axes = Array.isArray(state.otome.axes) ? state.otome.axes : [];
        if (!axes.length) {
            container.append(emptyState(isAdmin() ? "点击 EDIT 添加你的第一条玩家属性轴。" : "暂无属性记录。"));
        } else {
            axes.forEach((axis) => {
                const row = create("div", "otome-axis");
                const labels = create("div", "otome-axis-labels");
                labels.append(create("span", "", axis.left || ""), create("span", "", axis.right || ""));
                const track = create("div", "otome-axis-track");
                const dot = create("span", "otome-axis-dot");
                const numericValue = Math.min(5, Math.max(1, Number(axis.value) || 3));
                dot.style.left = `${((numericValue - 1) / 4) * 100}%`;
                dot.title = `${numericValue} / 5`;
                track.append(dot);
                row.append(labels, track);
                container.append(row);
            });
        }
        renderTags("otome-play-styles", state.otome.play_styles);
        renderTags("otome-favorite-elements", state.otome.favorite_elements);
        renderTags("otome-not-my-type", state.otome.not_my_type);
    }

    // Profile editors
    function openProfileEditor() {
        if (!isAdmin()) return;
        byId("profile-edit-nickname").value = state.profile.nickname || "";
        byId("profile-edit-tagline").value = state.profile.tagline || "";
        byId("profile-edit-avatar").value = state.profile.avatar_url || "";
        byId("profile-edit-summary").value = state.profile.summary || "";
        byId("profile-edit-about").value = state.profile.about_text || "";
        byId("profile-edit-free-title").value = state.profile.free_space_title || "";
        byId("profile-edit-free-content").value = state.profile.free_space_content || "";
        showMessage("profile-form-message", "");
        bridge.openModal(byId("profile-modal"));
    }

    byId("profile-form")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!isAdmin()) return;
        showMessage("profile-form-message", "Saving…");
        let avatarUrl;
        try {
            avatarUrl = await uploadImage("profile-edit-avatar-file", "profile", value("profile-edit-avatar"));
        } catch (error) {
            showMessage("profile-form-message", `上传失败：${error.message}`, true);
            return;
        }
        const payload = {
            id: 1,
            nickname: optional(value("profile-edit-nickname")),
            tagline: optional(value("profile-edit-tagline")),
            avatar_url: avatarUrl,
            summary: optional(value("profile-edit-summary")),
            about_text: optional(value("profile-edit-about")),
            free_space_title: optional(value("profile-edit-free-title")),
            free_space_content: optional(value("profile-edit-free-content"))
        };
        const { error } = await db.from("site_profile").upsert(payload, { onConflict: "id" });
        if (error) {
            showMessage("profile-form-message", `保存失败：${error.message}`, true);
            return;
        }
        await removeReplacedImage(state.profile.avatar_url, avatarUrl);
        bridge.closeModal(byId("profile-modal"));
        await loadProfile();
    });

    function itemConfig(kind) {
        return {
            fandom: {
                kicker: "FANDOMS COLLECTION",
                name: "NAME",
                description: "DESCRIPTION",
                choice: "STATUS",
                options: ["CURRENT", "LONG TERM", "OCCASIONAL", "CLOSED"]
            },
            favorite: {
                kicker: "FAVORITES COLLECTION",
                name: "CHARACTER NAME",
                description: "NOTE",
                choice: "FAVORITE TYPE",
                options: ["最推", "推", "好感"]
            },
            boundary: {
                kicker: "DNI / NOT FOR ME",
                name: "CONTENT",
                description: "",
                choice: "TYPE",
                options: ["雷点", "苦手", "不太感兴趣"]
            }
        }[kind];
    }

    function itemsFor(kind) {
        const stateKey = {
            fandom: "fandoms",
            favorite: "favorites",
            boundary: "boundaries"
        }[kind];
        return state[stateKey] || [];
    }

    function openItemEditor(kind, item = null) {
        if (!isAdmin() || !itemConfig(kind)) return;
        const config = itemConfig(kind);
        byId("profile-item-form").reset();
        byId("profile-item-id").value = item?.id || "";
        byId("profile-item-kind").value = kind;
        byId("profile-item-kicker").textContent = config.kicker;
        byId("profile-item-title").textContent = item ? "Edit item" : "New item";
        byId("profile-item-name-label").textContent = config.name;
        byId("profile-item-description-label").textContent = config.description;
        byId("profile-item-choice-label").textContent = config.choice;
        document.querySelectorAll("[data-visible-for]").forEach((field) => {
            field.classList.toggle("hidden", !field.dataset.visibleFor.split(" ").includes(kind));
        });
        const choice = byId("profile-item-choice");
        choice.replaceChildren(...config.options.map((option) => {
            const element = create("option", "", option);
            element.value = option;
            return element;
        }));
        byId("profile-item-name").value = item?.name || item?.label || "";
        byId("profile-item-secondary").value = item?.work_name || "";
        byId("profile-item-image").value = item?.image_url || "";
        byId("profile-item-choice").value = item?.status || item?.favorite_level || item?.kind || config.options[0];
        byId("profile-item-symbol").value = item?.symbol || "";
        byId("profile-item-description").value = item?.description || item?.note || "";
        byId("profile-item-sort").value = item?.sort_order ?? "";
        byId("profile-item-delete").classList.toggle("hidden", !item);
        showMessage("profile-item-message", "");
        bridge.openModal(byId("profile-item-modal"));
    }

    byId("profile-item-form")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!isAdmin()) return;
        const kind = value("profile-item-kind");
        const id = value("profile-item-id");
        const previousItem = id ? itemsFor(kind).find((item) => String(item.id) === String(id)) : null;
        let imageUrl = null;
        if (kind !== "boundary") {
            try {
                imageUrl = await uploadImage("profile-item-image-file", "collections", value("profile-item-image"));
            } catch (error) {
                showMessage("profile-item-message", `上传失败：${error.message}`, true);
                return;
            }
        }
        let payload;
        if (kind === "fandom") {
            payload = {
                name: value("profile-item-name").trim(),
                image_url: imageUrl,
                description: optional(value("profile-item-description")),
                status: value("profile-item-choice"),
                sort_order: numberOrNull(value("profile-item-sort"))
            };
        } else if (kind === "favorite") {
            payload = {
                name: value("profile-item-name").trim(),
                work_name: optional(value("profile-item-secondary")),
                image_url: imageUrl,
                favorite_level: value("profile-item-choice"),
                note: optional(value("profile-item-description")),
                symbol: optional(value("profile-item-symbol")),
                sort_order: numberOrNull(value("profile-item-sort"))
            };
        } else {
            payload = {
                label: value("profile-item-name").trim(),
                kind: value("profile-item-choice"),
                sort_order: numberOrNull(value("profile-item-sort"))
            };
        }
        showMessage("profile-item-message", "Saving…");
        const query = id
            ? db.from(itemTables[kind]).update(payload).eq("id", id)
            : db.from(itemTables[kind]).insert(payload);
        const { error } = await query;
        if (error) {
            showMessage("profile-item-message", `保存失败：${error.message}`, true);
            return;
        }
        await removeReplacedImage(previousItem?.image_url, imageUrl);
        bridge.closeModal(byId("profile-item-modal"));
        await loadProfile();
    });

    byId("profile-item-delete")?.addEventListener("click", async () => {
        if (!isAdmin()) return;
        const kind = value("profile-item-kind");
        const id = value("profile-item-id");
        if (!id || !window.confirm("确定删除这条资料吗？")) return;
        const { error } = await db.from(itemTables[kind]).delete().eq("id", id);
        if (error) {
            showMessage("profile-item-message", `删除失败：${error.message}`, true);
            return;
        }
        const deletedItem = itemsFor(kind).find((item) => String(item.id) === String(id));
        await removeReplacedImage(deletedItem?.image_url, null);
        bridge.closeModal(byId("profile-item-modal"));
        await loadProfile();
    });

    function addAxisEditor(axis = {}) {
        const row = create("div", "otome-axis-edit-row");
        const left = create("input");
        left.type = "text";
        left.placeholder = "左侧属性";
        left.value = axis.left || "";
        left.dataset.axisLeft = "";
        const range = create("input");
        range.type = "range";
        range.min = "1";
        range.max = "5";
        range.step = "1";
        range.value = String(axis.value || 3);
        range.dataset.axisValue = "";
        const right = create("input");
        right.type = "text";
        right.placeholder = "右侧属性";
        right.value = axis.right || "";
        right.dataset.axisRight = "";
        const remove = create("button", "cms-axis-remove", "×");
        remove.type = "button";
        remove.setAttribute("aria-label", "删除属性轴");
        remove.addEventListener("click", () => row.remove());
        row.append(left, range, right, remove);
        byId("otome-axis-editor").append(row);
    }

    function openOtomeEditor() {
        if (!isAdmin()) return;
        byId("otome-axis-editor").replaceChildren();
        (Array.isArray(state.otome.axes) ? state.otome.axes : []).forEach(addAxisEditor);
        byId("otome-edit-play-styles").value = (state.otome.play_styles || []).join(", ");
        byId("otome-edit-favorite-elements").value = (state.otome.favorite_elements || []).join(", ");
        byId("otome-edit-not-my-type").value = (state.otome.not_my_type || []).join(", ");
        showMessage("otome-form-message", "");
        bridge.openModal(byId("otome-modal"));
    }

    byId("add-otome-axis")?.addEventListener("click", () => addAxisEditor());
    byId("otome-form")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!isAdmin()) return;
        const axes = [...document.querySelectorAll(".otome-axis-edit-row")].map((row) => ({
            left: row.querySelector("[data-axis-left]").value.trim(),
            right: row.querySelector("[data-axis-right]").value.trim(),
            value: Number(row.querySelector("[data-axis-value]").value)
        })).filter((axis) => axis.left && axis.right);
        const payload = {
            id: 1,
            axes,
            play_styles: splitTags(value("otome-edit-play-styles")),
            favorite_elements: splitTags(value("otome-edit-favorite-elements")),
            not_my_type: splitTags(value("otome-edit-not-my-type"))
        };
        showMessage("otome-form-message", "Saving…");
        const { error } = await db.from("otome_profile").upsert(payload, { onConflict: "id" });
        if (error) {
            showMessage("otome-form-message", `保存失败：${error.message}`, true);
            return;
        }
        bridge.closeModal(byId("otome-modal"));
        await loadProfile();
    });

    // Writings
    async function loadWritings() {
        document.querySelectorAll("[data-writing-list]").forEach((list) => {
            list.replaceChildren(emptyState("Loading…"));
        });
        let query = db.from("writings")
            .select("*")
            .order("is_pinned", { ascending: false })
            .order("sort_order", { ascending: true, nullsFirst: false })
            .order("published_at", { ascending: false });
        if (!isAdmin()) query = query.eq("is_public", true);
        const { data, error } = await query;
        if (error) {
            document.querySelectorAll("[data-writing-list]").forEach((list) => {
                list.replaceChildren(emptyState(errorMessage(error)));
            });
            return;
        }
        state.writings = data || [];
        renderWritings();
    }

    function writingAction(label, action, id) {
        const button = create("button", "cms-mini-button", label);
        button.type = "button";
        button.dataset.writingAction = action;
        button.dataset.writingId = id;
        return button;
    }

    function renderWritings() {
        document.querySelectorAll("[data-writing-list]").forEach((container) => {
            const category = container.dataset.writingList;
            const writings = state.writings.filter((item) => item.category === category && (isAdmin() || item.is_public));
            container.replaceChildren();
            if (!writings.length) {
                container.append(emptyState(isAdmin() ? "这个分区还没有文章。" : "文字正在慢慢抵达这里。"));
                return;
            }
            writings.forEach((writing) => {
                const article = create("article", "writing-entry");
                if (!writing.is_public) article.classList.add("is-private");
                const coverUrl = safeUrl(writing.cover_url);
                if (coverUrl) {
                    const image = create("img", "writing-entry-cover");
                    image.src = coverUrl;
                    image.alt = "";
                    image.loading = "lazy";
                    article.append(image);
                }
                const copy = create("div", "writing-entry-copy");
                const meta = create("div", "writing-entry-meta");
                meta.append(create("time", "", formatDate(writing.published_at)));
                if (writing.is_pinned) meta.append(create("span", "writing-pin", "✦ PINNED"));
                if (!writing.is_public && isAdmin()) meta.append(create("span", "writing-draft", "PRIVATE"));
                copy.append(meta, create("h4", "", writing.title));
                if (writing.subtitle) copy.append(create("p", "writing-entry-subtitle", writing.subtitle));
                if (writing.excerpt) copy.append(create("p", "writing-entry-excerpt", writing.excerpt));
                const tags = create("div", "writing-entry-tags");
                (writing.tags || []).forEach((tag) => tags.append(create("span", "", `# ${tag}`)));
                if (tags.childElementCount) copy.append(tags);
                const footer = create("div", "writing-entry-footer");
                const read = writingAction("READ MORE / 阅读全文", "read", writing.id);
                read.className = "writing-read-button";
                footer.append(read);
                if (isAdmin()) {
                    const actions = create("div", "writing-admin-actions");
                    actions.append(
                        writingAction("EDIT", "edit", writing.id),
                        writingAction(writing.is_pinned ? "UNPIN" : "PIN", "pin", writing.id),
                        writingAction("DELETE", "delete", writing.id)
                    );
                    footer.append(actions);
                }
                copy.append(footer);
                article.append(copy);
                container.append(article);
            });
        });
    }

    function findWriting(id) {
        return state.writings.find((item) => String(item.id) === String(id));
    }

    function openWritingEditor(category, writing = null) {
        if (!isAdmin()) return;
        byId("writing-form").reset();
        byId("writing-id").value = writing?.id || "";
        byId("writing-modal-title").textContent = writing ? "Edit writing" : "New writing";
        byId("writing-title").value = writing?.title || "";
        byId("writing-subtitle").value = writing?.subtitle || "";
        byId("writing-excerpt").value = writing?.excerpt || "";
        byId("writing-body").value = writing?.body || "";
        byId("writing-category").value = writing?.category || category;
        byId("writing-published-at").value = toLocalDateTime(writing?.published_at);
        byId("writing-cover").value = writing?.cover_url || "";
        byId("writing-tags").value = (writing?.tags || []).join(", ");
        byId("writing-sort").value = writing?.sort_order ?? "";
        byId("writing-pinned").checked = Boolean(writing?.is_pinned);
        byId("writing-public").checked = writing ? Boolean(writing.is_public) : true;
        byId("writing-delete").classList.toggle("hidden", !writing);
        showMessage("writing-form-message", "");
        bridge.openModal(byId("writing-modal"));
    }

    function openReading(writing) {
        const coverUrl = safeUrl(writing.cover_url);
        byId("reading-cover-wrap").classList.toggle("hidden", !coverUrl);
        if (coverUrl) {
            byId("reading-cover").src = coverUrl;
            byId("reading-cover").alt = writing.title;
        }
        byId("reading-category").textContent = categoryLabels[writing.category] || "WRITING";
        byId("reading-title").textContent = writing.title;
        byId("reading-subtitle").textContent = writing.subtitle || "";
        byId("reading-date").textContent = formatDate(writing.published_at);
        const tags = byId("reading-tags");
        tags.replaceChildren();
        (writing.tags || []).forEach((tag) => tags.append(create("span", "", tag)));
        byId("reading-body").innerHTML = markdownToHtml(writing.body);
        byId("reading-updated").textContent = writing.updated_at
            ? `LAST REVISED / ${formatDate(writing.updated_at)}`
            : "";
        bridge.openModal(byId("reading-modal"));
    }

    byId("writing-form")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!isAdmin()) return;
        const id = value("writing-id");
        const previousWriting = id ? findWriting(id) : null;
        let coverUrl;
        try {
            coverUrl = await uploadImage("writing-cover-file", "writings", value("writing-cover"));
        } catch (error) {
            showMessage("writing-form-message", `上传失败：${error.message}`, true);
            return;
        }
        const payload = {
            title: value("writing-title").trim(),
            subtitle: optional(value("writing-subtitle")),
            excerpt: optional(value("writing-excerpt")),
            body: value("writing-body").trim(),
            category: value("writing-category"),
            published_at: new Date(value("writing-published-at")).toISOString(),
            cover_url: coverUrl,
            tags: splitTags(value("writing-tags")),
            sort_order: numberOrNull(value("writing-sort")),
            is_pinned: byId("writing-pinned").checked,
            is_public: byId("writing-public").checked
        };
        showMessage("writing-form-message", "Saving…");
        const query = id
            ? db.from("writings").update(payload).eq("id", id)
            : db.from("writings").insert(payload);
        const { error } = await query;
        if (error) {
            showMessage("writing-form-message", `保存失败：${error.message}`, true);
            return;
        }
        await removeReplacedImage(previousWriting?.cover_url, coverUrl);
        bridge.closeModal(byId("writing-modal"));
        await loadWritings();
    });

    async function deleteWriting(writing, fromModal = false) {
        if (!isAdmin() || !writing || !window.confirm(`确定删除《${writing.title}》吗？`)) return;
        const { error } = await db.from("writings").delete().eq("id", writing.id);
        if (error) {
            if (fromModal) showMessage("writing-form-message", `删除失败：${error.message}`, true);
            else window.alert(`删除失败：${error.message}`);
            return;
        }
        await removeReplacedImage(writing.cover_url, null);
        if (fromModal) bridge.closeModal(byId("writing-modal"));
        await loadWritings();
    }

    byId("writing-delete")?.addEventListener("click", () => {
        deleteWriting(findWriting(value("writing-id")), true);
    });

    document.addEventListener("click", async (event) => {
        const profileEdit = event.target.closest("[data-edit-profile]");
        if (profileEdit) return openProfileEditor();

        const addItem = event.target.closest("[data-add-item]");
        if (addItem) return openItemEditor(addItem.dataset.addItem);

        const editItem = event.target.closest("[data-edit-item]");
        if (editItem) {
            const item = itemsFor(editItem.dataset.editItem)
                .find((entry) => String(entry.id) === editItem.dataset.itemId);
            return openItemEditor(editItem.dataset.editItem, item);
        }

        if (event.target.closest("[data-edit-otome]")) return openOtomeEditor();

        const addWriting = event.target.closest("[data-add-writing]");
        if (addWriting) return openWritingEditor(addWriting.dataset.addWriting);

        const action = event.target.closest("[data-writing-action]");
        if (!action) return;
        const writing = findWriting(action.dataset.writingId);
        if (!writing) return;
        if (action.dataset.writingAction === "read") return openReading(writing);
        if (action.dataset.writingAction === "edit") return openWritingEditor(writing.category, writing);
        if (action.dataset.writingAction === "delete") return deleteWriting(writing);
        if (action.dataset.writingAction === "pin" && isAdmin()) {
            const { error } = await db.from("writings")
                .update({ is_pinned: !writing.is_pinned })
                .eq("id", writing.id);
            if (error) window.alert(`更新失败：${error.message}`);
            else await loadWritings();
        }
    });

    window.addEventListener("yuri:authchange", () => {
        updateAdminControls();
        loadWritings();
    });

    updateAdminControls();
    loadProfile();
    loadWritings();
})();
