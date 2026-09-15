(function () {
    "use strict";

    const bridge = window.yuriArchive;
    if (!bridge?.supabaseClient) {
        console.error("CMS could not start: the main archive script is unavailable.");
        return;
    }

    const db = bridge.supabaseClient;
    const categoryLabels = {
        game_review: "AFTERGLOW",
        essay: "MOON NOTES",
        dream: "DREAM LETTERS"
    };
    const categoryMeta = {
        game_review: {
            index: "01 / AFTERGLOW"
        },
        essay: {
            index: "02 / MOON NOTES"
        },
        dream: {
            index: "03 / DREAM LETTERS"
        }
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
        writings: [],
        settings: {}
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
            day: "numeric",
            timeZone: "Asia/Tokyo"
        }).format(new Date(date));
    }

    function formatCompactDate(date) {
        if (!date) return "";
        const parts = new Intl.DateTimeFormat("ja-JP", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            timeZone: "Asia/Tokyo"
        }).formatToParts(new Date(date));
        const value = (type) => parts.find((part) => part.type === type)?.value || "";
        return [value("year"), value("month"), value("day")].filter(Boolean).join(".");
    }

    function formatYear(date) {
        if (!date) return "UNDATED";
        return new Intl.DateTimeFormat("en", {
            year: "numeric",
            timeZone: "Asia/Tokyo"
        }).format(new Date(date));
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
        const controls = document.querySelector("[data-profile-admin-controls]");
        const slots = document.querySelectorAll("[data-admin-slot]");
        controls?.replaceChildren();
        slots.forEach((slot) => slot.replaceChildren());

        if (isAdmin()) {
            const makeButton = (text, attributes) => {
                const button = create("button", "cms-admin-button", text);
                button.type = "button";
                Object.entries(attributes).forEach(([key, value]) => { button.dataset[key] = value; });
                return button;
            };
            controls?.append(
                makeButton("EDIT PROFILE", { editProfile: "" }),
                makeButton("EXPORT PROFILE", { exportProfileOpen: "" }),
                makeButton("EDIT EXPORT PROFILE", { editExportProfile: "" })
            );
            document.querySelector('[data-admin-slot="add-fandom"]')?.append(makeButton("＋ ADD", { addItem: "fandom" }));
            document.querySelector('[data-admin-slot="add-favorite"]')?.append(makeButton("＋ ADD", { addItem: "favorite" }));
            document.querySelector('[data-admin-slot="edit-otome"]')?.append(makeButton("EDIT", { editOtome: "" }));
            document.querySelector('[data-admin-slot="add-boundary"]')?.append(makeButton("＋ ADD", { addItem: "boundary" }));
            document.querySelector('[data-admin-slot="edit-currently-playing"]')?.append(makeButton("EDIT", { editCurrentlyPlaying: "" }));
            ["game_review", "essay", "dream"].forEach((category) => {
                document.querySelector(`[data-admin-slot="add-writing-${category}"]`)
                    ?.append(makeButton("＋ WRITE", { addWriting: category }));
            });
        }
        renderProfileCollections();
        renderWritings();
    }

    function loadExternalScript(source, ready) {
        if (ready()) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[src="${source}"]`);
            if (existing) {
                existing.addEventListener("load", resolve, { once: true });
                existing.addEventListener("error", reject, { once: true });
                return;
            }
            const script = document.createElement("script");
            script.src = source;
            script.onload = resolve;
            script.onerror = () => reject(new Error("导出组件加载失败。"));
            document.head.append(script);
        });
    }

    function exportText(value) {
        return String(value || "")
            .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
            .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
            .replace(/[#>*_~`-]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function exportRows(value) {
        return String(value || "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
            const [name, ...description] = line.split("|");
            return { name: name.trim(), description: description.join("|").trim() };
        });
    }

    function buildProfileExportSheet() {
        const sheet = byId("profile-export-sheet");
        sheet.replaceChildren();

        const exportSettings = state.settings.export_profile_settings || {};
        const overrides = exportSettings.overrides || {};
        const visibility = {
            avatar: true, name: true, subtitle: true, bio: true, fandoms: true,
            favorites: true, boundaries: true, otome_profile: true,
            currently_playing: true, free_space: true, updated: true,
            ...(exportSettings.visibility || {})
        };
        const resolved = (override, fallback) => String(overrides[override] || "").trim() || fallback || "";
        const displayName = resolved("display_name", state.profile.nickname);
        const subtitleText = resolved("subtitle", state.profile.tagline);
        const bioText = resolved("bio", state.profile.summary);
        const aboutText = resolved("about", state.profile.about_text);
        const exportAvatar = resolved("avatar_url", state.profile.avatar_url);

        const issueDate = formatCompactDate(new Date());
        const masthead = create("header", "profile-sheet-masthead");
        masthead.append(
            create("span", "profile-sheet-publication", "KIORA.SPACE"),
            create("span", "profile-sheet-edition", "PERSONAL ARCHIVE / 私人記録"),
            create("span", "profile-sheet-issue", `ISSUE ${issueDate}`)
        );
        sheet.append(masthead);

        const spread = create("div", "profile-sheet-spread");
        const portraitColumn = create("aside", "profile-sheet-portrait-column");
        const portraitFrame = create("figure", "profile-sheet-portrait-frame");
        const avatarUrl = visibility.avatar ? safeUrl(exportAvatar) : "";
        if (visibility.avatar && avatarUrl) {
            const image = create("img", "profile-sheet-avatar");
            image.src = avatarUrl;
            image.crossOrigin = "anonymous";
            image.alt = "";
            portraitFrame.append(image);
        } else if (visibility.avatar) {
            portraitFrame.append(create("div", "profile-sheet-avatar profile-sheet-avatar-placeholder", "✦"));
        } else {
            portraitFrame.classList.add("profile-sheet-portrait-hidden");
        }
        portraitFrame.append(create("figcaption", "", "PORTRAIT / PERSONAL RECORD"));
        portraitColumn.append(portraitFrame);

        const identity = create("div", "profile-sheet-identity");
        identity.append(create("p", "profile-sheet-overline", "PROFILE  —  NO. 01"));
        if (visibility.name) identity.append(create("h1", "", displayName || "PROFILE"));
        if (visibility.subtitle && subtitleText) identity.append(create("p", "profile-sheet-tagline", subtitleText));
        if (visibility.bio && bioText) identity.append(create("p", "profile-sheet-summary", exportText(bioText)));
        portraitColumn.append(identity);
        spread.append(portraitColumn);

        const editorial = create("main", "profile-sheet-editorial");
        const editorialLead = create("section", "profile-sheet-lead");
        editorialLead.append(create("p", "profile-sheet-kicker", "A SMALL INDEX OF THE THINGS I LOVE"));
        editorialLead.append(create("h2", "", "静かな記録、好きなものの輪郭。"));
        if (visibility.bio && aboutText) {
            editorialLead.append(create("p", "profile-sheet-prose", exportText(aboutText)));
        }
        editorial.append(editorialLead);

        const columns = create("div", "profile-sheet-columns");
        const collection = (title, items, describe) => {
            if (!items.length) return;
            const section = create("section", "profile-sheet-section");
            section.append(create("h2", "", title));
            items.forEach((item) => {
                const row = create("article", "profile-sheet-row");
                row.append(create("h3", "", item.name || item.label || ""));
                const description = describe(item);
                if (description) row.append(create("p", "", description));
                section.append(row);
            });
            columns.append(section);
        };
        if (visibility.fandoms) {
            const custom = exportRows(overrides.fandoms);
            collection("FANDOMS", custom.length ? custom : state.fandoms, (item) => item.description || [item.status].filter(Boolean).join(" / "));
        }
        if (visibility.favorites) {
            const custom = exportRows(overrides.favorites);
            collection("FAVORITES", custom.length ? custom : state.favorites, (item) => item.description || [item.work_name, item.favorite_level, item.note].filter(Boolean).join(" / "));
        }
        if (visibility.boundaries) {
            const custom = exportRows(overrides.boundaries);
            collection("NG", custom.length ? custom : state.boundaries, (item) => item.description || item.kind || "");
        }

        const hasOtomeTags = state.otome.play_styles?.length || state.otome.favorite_elements?.length || state.otome.not_my_type?.length;
        if (visibility.otome_profile && (overrides.otome_profile || hasOtomeTags || state.otome.axes?.length)) {
            const otome = create("section", "profile-sheet-section profile-sheet-otome");
            otome.append(create("h2", "", "OTOME PROFILE"));
            if (overrides.otome_profile) {
                otome.append(create("p", "", exportText(overrides.otome_profile)));
            } else (state.otome.axes || []).forEach((axis) => {
                const numericValue = Math.min(5, Math.max(1, Number(axis.value) || 3));
                const percentage = ((numericValue - 1) / 4) * 100;
                const axisRow = create("div", "profile-sheet-axis");
                const labels = create("div", "profile-sheet-axis-labels");
                labels.append(create("span", "", axis.left || ""), create("span", "", axis.right || ""));
                const track = create("div", "profile-sheet-axis-track");
                const fill = create("span", "profile-sheet-axis-fill");
                const marker = create("span", "profile-sheet-axis-marker");
                fill.style.width = `${percentage}%`;
                marker.style.left = `${percentage}%`;
                track.append(fill, marker);
                axisRow.append(labels, track);
                otome.append(axisRow);
            });
            const tagGroups = [
                ["PLAY STYLE", state.otome.play_styles],
                ["FAVORITE ELEMENTS", state.otome.favorite_elements],
                ["NOT MY TYPE", state.otome.not_my_type]
            ];
            if (!overrides.otome_profile) tagGroups.forEach(([label, values]) => {
                if (!values?.length) return;
                const row = create("p", "profile-sheet-tags");
                row.append(create("b", "", label), document.createTextNode(values.join(" ・ ")));
                otome.append(row);
            });
            columns.append(otome);
        }

        const currently = state.settings.currently_playing || {};
        if (visibility.currently_playing && (overrides.currently_playing || currently.title || currently.game_id)) {
            const current = create("section", "profile-sheet-section");
            current.append(create("h2", "", "CURRENTLY PLAYING"));
            const linked = (bridge.games || []).find((game) => String(game.id) === String(currently.game_id));
            current.append(create("p", "", resolved("currently_playing", [currently.title || linked?.title, currently.subtitle, currently.status, currently.note].filter(Boolean).join(" / "))));
            columns.append(current);
        }

        const freeSpace = resolved("free_space", state.profile.free_space_content);
        if (visibility.free_space && freeSpace) {
            const free = create("section", "profile-sheet-section profile-sheet-free");
            free.append(create("h2", "", state.profile.free_space_title || "FREE SPACE"));
            free.append(create("p", "", exportText(freeSpace)));
            columns.append(free);
        }
        editorial.append(columns);
        spread.append(editorial);
        sheet.append(spread);

        const footer = create("footer", "profile-sheet-footer");
        footer.append(create("span", "", "WORDS, GAMES & SMALL CONSTELLATIONS"));
        footer.append(create("span", "", "KIORA.SPACE  /  ALL THINGS KEPT WITH CARE"));
        footer.append(create("span", "", visibility.updated ? (byId("profile-updated")?.textContent || "") : ""));
        sheet.append(footer);
        return sheet;
    }

    async function renderProfileCanvas() {
        await loadExternalScript(
            "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js",
            () => typeof window.html2canvas === "function"
        );
        const sheet = buildProfileExportSheet();
        sheet.classList.add("is-rendering");
        await Promise.all(Array.from(sheet.querySelectorAll("img")).map((image) => image.decode?.().catch(() => {})));
        const sheetRect = sheet.getBoundingClientRect();
        const sectionOffsets = Array.from(sheet.querySelectorAll(".profile-sheet-section"))
            .map((section) => section.getBoundingClientRect().top - sheetRect.top)
            .filter((offset) => offset > 0);
        const canvas = await window.html2canvas(sheet, {
            backgroundColor: "#f5eff4",
            scale: 2,
            useCORS: true,
            logging: false
        });
        const renderScale = canvas.height / sheetRect.height;
        canvas.profileSectionBreaks = sectionOffsets.map((offset) => Math.round(offset * renderScale));
        sheet.classList.remove("is-rendering");
        return canvas;
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async function exportProfile(format) {
        if (!isAdmin()) return;
        showMessage("profile-export-message", "正在生成资料卡……");
        try {
            const canvas = await renderProfileCanvas();
            if (format === "png") {
                const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
                downloadBlob(blob, `kiora-profile-${formatCompactDate(new Date())}.png`);
            } else {
                await loadExternalScript(
                    "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js",
                    () => Boolean(window.jspdf?.jsPDF)
                );
                const { jsPDF } = window.jspdf;
                const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
                const pageWidth = 297;
                const pageHeight = 210;
                const pageHeightPixels = Math.floor(canvas.width * pageHeight / pageWidth);
                let offset = 0;
                let page = 0;
                while (offset < canvas.height) {
                    if (page > 0) pdf.addPage();
                    let sliceHeight = Math.min(pageHeightPixels, canvas.height - offset);
                    const naturalEnd = offset + sliceHeight;
                    const cleanBreak = (canvas.profileSectionBreaks || [])
                        .filter((point) => point > offset + pageHeightPixels * 0.38 && point < naturalEnd - 20)
                        .pop();
                    if (cleanBreak) sliceHeight = cleanBreak - offset;
                    const slice = document.createElement("canvas");
                    slice.width = canvas.width;
                    slice.height = sliceHeight;
                    slice.getContext("2d").drawImage(canvas, 0, offset, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
                    pdf.addImage(slice.toDataURL("image/jpeg", 0.94), "JPEG", 0, 0, pageWidth, sliceHeight * pageWidth / canvas.width);
                    offset += sliceHeight;
                    page += 1;
                }
                pdf.save(`kiora-profile-${formatCompactDate(new Date())}.pdf`);
            }
            showMessage("profile-export-message", "导出完成。");
        } catch (error) {
            byId("profile-export-sheet")?.classList.remove("is-rendering");
            showMessage("profile-export-message", `导出失败：${error.message}`, true);
        }
    }

    // Top navigation: horizontal index on desktop, compact dropdown on mobile.
    const topNavigation = byId("site-top-nav");
    const mobileMenu = byId("site-mobile-menu");
    const mobileMenuButton = byId("site-mobile-menu-button");
    let navigationLockUntil = 0;

    function setActiveNavigation(sectionId) {
        document.querySelectorAll("[data-home-section]").forEach((link) => {
            link.classList.toggle("active", link.dataset.homeSection === sectionId);
        });
    }

    function setMobileMenu(open, returnFocus = false) {
        mobileMenu?.classList.toggle("active", open);
        mobileMenu?.setAttribute("aria-hidden", String(!open));
        mobileMenuButton?.setAttribute("aria-expanded", String(open));
        if (open) mobileMenu?.querySelector("a")?.focus();
        else if (returnFocus) mobileMenuButton?.focus();
    }

    mobileMenuButton?.addEventListener("click", () => {
        setMobileMenu(mobileMenuButton.getAttribute("aria-expanded") !== "true");
    });
    mobileMenu?.querySelectorAll("a").forEach((link) => {
        link.addEventListener("click", () => setMobileMenu(false));
    });
    document.querySelectorAll('[data-home-section][href^="#"]').forEach((link) => {
        link.addEventListener("click", () => {
            navigationLockUntil = performance.now() + 700;
            setActiveNavigation(link.dataset.homeSection);
        });
    });
    document.addEventListener("click", (event) => {
        if (mobileMenu?.classList.contains("active") && !topNavigation?.contains(event.target)) setMobileMenu(false);
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && mobileMenu?.classList.contains("active")) setMobileMenu(false, true);
    });
    window.addEventListener("resize", () => {
        if (window.innerWidth > 900) setMobileMenu(false);
    });

    const updateNavigationSurface = () => topNavigation?.classList.toggle("is-scrolled", window.scrollY > 18);
    updateNavigationSurface();
    window.addEventListener("scroll", updateNavigationSurface, { passive: true });

    const visibleHomeSections = new Map();
    const sectionObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) visibleHomeSections.set(entry.target.id, entry);
            else visibleHomeSections.delete(entry.target.id);
        });
        const visible = [...visibleHomeSections.values()]
            .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        if (performance.now() < navigationLockUntil) return;
        setActiveNavigation(visible.target.id);
    }, { rootMargin: "-28% 0px -58%", threshold: [0, 0.08, 0.25] });
    ["home", "about", "games", "writing", "archive"].forEach((id) => {
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
            db.from("otome_profile").select("*").eq("id", 1).maybeSingle(),
            db.from("site_settings").select("*").eq("id", 1).maybeSingle()
        ]);

        const firstError = queries.slice(0, 5).find((result) => result.error)?.error;
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
        state.settings = queries[5].error ? {} : (queries[5].data || {});
        if (queries[5].error) console.warn("site_settings is unavailable; run supabase-site-settings-migration.sql.", queries[5].error);
        showMessage("profile-status", "");
        byId("profile-status")?.classList.add("hidden");
        byId("profile-content")?.classList.remove("hidden");
        renderProfile();
    }

    function renderProfile() {
        renderProfileIdentity();
        byId("free-space-content").innerHTML = state.profile.free_space_content
            ? markdownToHtml(state.profile.free_space_content)
            : `<p class="cms-empty">${isAdmin() ? "这里还没有留下文字。" : ""}</p>`;
        renderProfileCollections();
        renderOtome();
        renderProfileSidebarMeta();
    }

    function renderProfileIdentity() {
        const avatar = byId("profile-display-avatar");
        const placeholder = byId("profile-display-avatar-placeholder");
        const avatarUrl = safeUrl(state.profile.avatar_url);
        if (avatar) {
            avatar.hidden = !avatarUrl;
            if (avatarUrl) {
                avatar.src = avatarUrl;
                avatar.alt = state.profile.nickname ? `${state.profile.nickname} avatar` : "Profile avatar";
            } else {
                avatar.removeAttribute("src");
                avatar.alt = "";
            }
        }
        if (placeholder) placeholder.hidden = Boolean(avatarUrl);

        const name = byId("profile-display-name");
        const tagline = byId("profile-display-tagline");
        const summary = byId("profile-display-summary");
        const about = byId("profile-display-about");
        if (name) name.textContent = state.profile.nickname || "KIORA";
        if (tagline) {
            tagline.textContent = state.profile.tagline || "";
            tagline.hidden = !state.profile.tagline;
        }
        if (summary) {
            summary.innerHTML = state.profile.summary ? markdownToHtml(state.profile.summary) : "";
            summary.hidden = !state.profile.summary;
        }
        if (about) {
            about.innerHTML = state.profile.about_text ? markdownToHtml(state.profile.about_text) : "";
            about.hidden = !state.profile.about_text;
        }
    }

    function renderProfileSidebarMeta() {
        const tags = [
            ...(state.otome.play_styles || []),
            ...(state.otome.favorite_elements || []),
            ...state.favorites.map((item) => item.name)
        ].filter((tag, index, all) => tag && all.indexOf(tag) === index).slice(0, 10);
        renderTags("profile-sidebar-tags", tags);

        renderUpdatedDate();
        renderCurrentGame(bridge.games || []);
    }

    function renderUpdatedDate() {
        const updated = byId("profile-updated");
        if (!updated) return;

        const manual = state.settings.manual_updated_at;
        const automaticCandidates = [
            state.settings.content_updated_at,
            state.profile.updated_at,
            state.otome.updated_at,
            ...state.fandoms.map((item) => item.updated_at || item.created_at),
            ...state.favorites.map((item) => item.updated_at || item.created_at),
            ...state.boundaries.map((item) => item.updated_at || item.created_at),
            ...state.writings.map((item) => item.updated_at || item.published_at || item.created_at),
            ...(bridge.games || []).map((item) => item.updated_at || item.created_at)
        ].filter(Boolean)
            .map((date) => new Date(date))
            .filter((date) => !Number.isNaN(date.getTime()))
            .sort((a, b) => b - a);
        const finalDate = manual || automaticCandidates[0];
        updated.textContent = finalDate ? `UPDATED / ${formatCompactDate(finalDate)}` : "";
        updated.dataset.updateMode = manual ? "manual" : "automatic";
    }

    function renderCurrentGame(games) {
        const setting = state.settings.currently_playing || {};
        const linked = games?.find((game) => String(game.id) === String(setting.game_id));
        const current = byId("profile-current-game");
        const subtitle = byId("profile-current-subtitle");
        const status = byId("profile-current-status");
        const note = byId("profile-current-note");
        if (current) current.textContent = setting.title || linked?.title || games?.[0]?.title || "—";
        if (subtitle) {
            subtitle.textContent = setting.subtitle || "";
            subtitle.hidden = !setting.subtitle;
        }
        if (status) {
            status.textContent = setting.status ? String(setting.status).toUpperCase() : "";
            status.hidden = !setting.status;
        }
        if (note) {
            note.textContent = setting.note || "";
            note.hidden = !setting.note;
        }
    }

    window.addEventListener("yuri:gameschange", (event) => {
        renderCurrentGame(event.detail?.games || []);
        renderUpdatedDate();
    });

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
        byId("site-manual-updated-at").value = state.settings.manual_updated_at || "";
        const automatic = byId("profile-updated")?.textContent?.replace("UPDATED / ", "") || "—";
        byId("site-updated-mode").textContent = state.settings.manual_updated_at
            ? `当前使用手动日期：${formatCompactDate(state.settings.manual_updated_at)}`
            : `当前为自动更新：${automatic}`;
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
        const { error: settingsError } = await db.from("site_settings").upsert({
            id: 1,
            manual_updated_at: optional(value("site-manual-updated-at"))
        }, { onConflict: "id" });
        if (settingsError) {
            showMessage("profile-form-message", `更新时间保存失败：${settingsError.message}。请先运行 supabase-site-settings-migration.sql。`, true);
            return;
        }
        await removeReplacedImage(state.profile.avatar_url, avatarUrl);
        byId("profile-modal").dataset.dirty = "false";
        bridge.closeModal(byId("profile-modal"));
        await loadProfile();
    });

    byId("restore-auto-updated")?.addEventListener("click", async () => {
        if (!isAdmin()) return;
        showMessage("profile-form-message", "正在恢复自动更新时间…");
        const { error } = await db.from("site_settings").upsert({
            id: 1,
            manual_updated_at: null
        }, { onConflict: "id" });
        if (error) {
            showMessage("profile-form-message", `恢复失败：${error.message}。请先运行 supabase-site-settings-migration.sql。`, true);
            return;
        }
        state.settings.manual_updated_at = null;
        byId("site-manual-updated-at").value = "";
        await loadProfile();
        byId("site-updated-mode").textContent = `已恢复自动更新：${byId("profile-updated")?.textContent?.replace("UPDATED / ", "") || "—"}`;
        showMessage("profile-form-message", "已恢复自动更新时间。");
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
        byId("profile-item-modal").dataset.dirty = "false";
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
        byId("profile-item-modal").dataset.dirty = "false";
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
        byId("otome-modal").dataset.dirty = "false";
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
            .neq("category", "archive")
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
        renderUpdatedDate();
    }

    function writingAction(label, action, id) {
        const button = create("button", "cms-mini-button", label);
        button.type = "button";
        button.dataset.writingAction = action;
        button.dataset.writingId = id;
        return button;
    }

    function createWritingEntry(writing, archiveView = false) {
        const article = create("article", archiveView ? "writing-entry writing-archive-entry" : "writing-entry");
        if (!writing.is_public) article.classList.add("is-private");
        const coverUrl = safeUrl(writing.cover_url);
        if (coverUrl) {
            article.classList.add("has-cover");
            const image = create("img", "writing-entry-cover");
            image.src = coverUrl;
            image.alt = "";
            image.loading = "lazy";
            article.append(image);
        }

        const copy = create("div", "writing-entry-copy");
        const meta = create("div", "writing-entry-meta");
        const publishedDate = writing.published_at || writing.created_at;
        const time = create("time", "writing-date", formatDate(publishedDate));
        if (publishedDate) {
            time.dateTime = publishedDate;
            time.dataset.desktopDate = formatCompactDate(publishedDate);
        }
        meta.append(time);
        if (writing.is_pinned) meta.append(create("span", "writing-pin", "✦ PINNED"));
        if (!writing.is_public && isAdmin()) meta.append(create("span", "writing-draft", "PRIVATE"));
        copy.append(meta, create("h4", "", writing.title));
        if (writing.subtitle) copy.append(create("p", "writing-entry-subtitle", writing.subtitle));
        if (writing.excerpt) copy.append(create("p", "writing-entry-excerpt", writing.excerpt));

        const tags = create("div", "writing-entry-tags");
        (writing.tags || []).forEach((tag) => tags.append(create("span", "", `# ${tag}`)));
        if (tags.childElementCount) copy.append(tags);

        const footer = create("div", "writing-entry-footer");
        const read = writingAction("READ STORY →", "read", writing.id);
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
        return article;
    }

    function renderWritings() {
        document.querySelectorAll("[data-writing-list]").forEach((container) => {
            const category = container.dataset.writingList;
            const writings = state.writings.filter((item) => item.category === category && (isAdmin() || item.is_public));
            container.replaceChildren();
            const viewAll = document.querySelector(`[data-view-writing-category="${category}"]`);
            if (viewAll) {
                viewAll.classList.toggle("has-stories", writings.length > 0);
                viewAll.textContent = `VIEW ALL / ${writings.length} ${writings.length === 1 ? "STORY" : "STORIES"} →`;
            }
            if (!writings.length) {
                container.append(emptyState(isAdmin() ? "这个分区还没有文章。" : "文字正在慢慢抵达这里。"));
                return;
            }
            writings.forEach((writing) => {
                container.append(createWritingEntry(writing));
            });
        });
    }

    function openWritingArchive(category) {
        const meta = categoryMeta[category];
        if (!meta) return;

        byId("writing-archive-index").textContent = meta.index;
        byId("writing-archive-title").textContent = categoryLabels[category];
        byId("writing-archive-description").textContent = "";
        const years = byId("writing-archive-years");
        years.replaceChildren();

        const writings = state.writings
            .filter((item) => item.category === category && (isAdmin() || item.is_public))
            .sort((a, b) => new Date(b.published_at || b.created_at || 0) - new Date(a.published_at || a.created_at || 0));

        if (!writings.length) {
            years.append(emptyState("文字正在慢慢抵达这里。"));
        } else {
            const groups = new Map();
            writings.forEach((writing) => {
                const year = formatYear(writing.published_at || writing.created_at);
                if (!groups.has(year)) groups.set(year, []);
                groups.get(year).push(writing);
            });
            groups.forEach((items, year) => {
                const group = create("section", "writing-archive-year");
                const heading = create("div", "writing-archive-year-heading");
                heading.append(create("h4", "", year), create("span", "", `${items.length} ${items.length === 1 ? "STORY" : "STORIES"}`));
                const list = create("div", "writing-archive-list");
                items.forEach((writing) => list.append(createWritingEntry(writing, true)));
                group.append(heading, list);
                years.append(group);
            });
        }

        byId("writing-archive-modal").dataset.category = category;
        bridge.openModal(byId("writing-archive-modal"));
    }

    function findWriting(id) {
        return state.writings.find((item) => String(item.id) === String(id));
    }

    function openWritingEditor(category, writing = null) {
        if (!isAdmin()) return;
        sessionStorage.setItem("yuri:return-scroll", String(window.scrollY));
        const query = writing?.id
            ? `id=${encodeURIComponent(writing.id)}`
            : `type=${encodeURIComponent(category || "essay")}`;
        window.location.href = `write.html?${query}`;
    }

    function openReading(writing) {
        sessionStorage.setItem("yuri:return-scroll", String(window.scrollY));
        sessionStorage.setItem("yuri:return-category", writing.category || "");
        window.location.href = `read.html?id=${encodeURIComponent(writing.id)}&from=${encodeURIComponent(writing.category || "")}`;
    }

    document.addEventListener("click", async (event) => {
        if (event.target.closest("[data-edit-currently-playing]")) {
            if (!isAdmin()) return;
            window.location.href = "currently-playing.html";
            return;
        }

        if (event.target.closest("[data-edit-export-profile]")) {
            if (!isAdmin()) return;
            window.location.href = "export-profile.html";
            return;
        }

        if (event.target.closest("[data-export-profile-open]")) {
            if (!isAdmin()) return;
            showMessage("profile-export-message", "");
            return bridge.openModal(byId("profile-export-modal"));
        }

        const exportAction = event.target.closest("[data-profile-export]");
        if (exportAction) return exportProfile(exportAction.dataset.profileExport);

        const viewCategory = event.target.closest("[data-view-writing-category]");
        if (viewCategory) return openWritingArchive(viewCategory.dataset.viewWritingCategory);

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
        const archiveModal = byId("writing-archive-modal");
        if (archiveModal?.classList.contains("active")) bridge.closeModal(archiveModal);
        if (action.dataset.writingAction === "read") {
            return openReading(writing);
        }
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
    Promise.all([loadProfile(), loadWritings()]).then(() => {
        const restore = Number(sessionStorage.getItem("yuri:restore-scroll"));
        if (!Number.isFinite(restore) || restore < 0) return;
        sessionStorage.removeItem("yuri:restore-scroll");
        requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: restore, behavior: "auto" })));
    });
})();
