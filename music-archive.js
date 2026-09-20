(function () {
    "use strict";

    const bridge = window.yuriArchive;
    if (!bridge) return;
    if (!document.getElementById("music-archive-title") || !document.getElementById("music-form")) return;
    const db = bridge.supabaseClient;
    const auth = ;
    const byId = (id) => document.getElementById(id);
    const state = { tracks: [], currentId: null, youtubePlayer: null, youtubeTimer: null, manualUntil: 0 };
    let youtubeApiPromise = null;
    const isAdmin = () => auth.role !== "viewer";
    const isOwner = () => auth.role === "owner";
    const clean = (value) => String(value ?? "").trim();
    const safeUrl = (value) => bridge.safeImageUrl(clean(value));
    const create = (tag, className, text) => {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    };

    function parseMusicUrl(provider, value) {
        const source = safeUrl(value);
        const result = { provider, source, embed: "", externalLabel: "OPEN IN ORIGINAL SOURCE →", youtubeId: "" };
        if (!source) return result;
        let url;
        try { url = new URL(source); } catch (_) { return result; }
        const host = url.hostname.toLowerCase().replace(/^www\./, "");

        if (provider === "netease") {
            result.externalLabel = "OPEN IN NETEASE MUSIC →";
            const hashId = url.hash.match(/[?&]id=(\d+)/)?.[1];
            const songId = url.searchParams.get("id")?.match(/^\d+$/)?.[0] || hashId;
            if ((host === "music.163.com" || host.endsWith(".music.163.com")) && songId) {
                result.embed = `https://music.163.com/outchain/player?type=2&id=${encodeURIComponent(songId)}&auto=0&height=66`;
            }
        } else if (provider === "spotify") {
            result.externalLabel = "OPEN IN SPOTIFY →";
            const match = url.pathname.match(/^\/(track|album|playlist)\/([A-Za-z0-9]+)\/?/);
            if (host === "open.spotify.com" && match) result.embed = `https://open.spotify.com/embed/${match[1]}/${match[2]}`;
        } else if (provider === "youtube") {
            result.externalLabel = "WATCH ON YOUTUBE →";
            let videoId = "";
            if (host === "youtu.be") videoId = url.pathname.split("/").filter(Boolean)[0] || "";
            if (host === "youtube.com" || host.endsWith(".youtube.com")) {
                videoId = url.searchParams.get("v") || url.pathname.match(/^\/(?:shorts|embed)\/([^/?]+)/)?.[1] || "";
            }
            if (/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
                result.youtubeId = videoId;
                result.embed = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?rel=0`;
            }
        } else if (provider === "apple_music") {
            result.externalLabel = "OPEN IN APPLE MUSIC →";
            if (host === "music.apple.com" || host === "embed.music.apple.com") {
                url.hostname = "embed.music.apple.com";
                result.embed = url.toString();
            }
        }
        return result;
    }

    function parseLrc(value) {
        const entries = [];
        clean(value).split(/\r?\n/).forEach((line) => {
            const text = line.replace(/\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]/g, "").trim();
            const stamps = [...line.matchAll(/\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]/g)];
            stamps.forEach((stamp) => entries.push({ time: Number(stamp[1]) * 60 + Number(stamp[2]), text }));
        });
        return entries.filter((entry) => Number.isFinite(entry.time) && entry.text).sort((a, b) => a.time - b.time);
    }

    function stopYoutube() {
        if (state.youtubeTimer) window.clearInterval(state.youtubeTimer);
        state.youtubeTimer = null;
        try { state.youtubePlayer?.destroy(); } catch (_) {}
        state.youtubePlayer = null;
    }

    function ensureYoutubeApi() {
        if (window.YT?.Player) return Promise.resolve(window.YT);
        if (youtubeApiPromise) return youtubeApiPromise;
        youtubeApiPromise = new Promise((resolve, reject) => {
            const previous = window.onYouTubeIframeAPIReady;
            window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(window.YT); };
            const script = document.createElement("script");
            script.src = "https://www.youtube.com/iframe_api";
            script.async = true;
            script.onerror = () => reject(new Error("YouTube player unavailable"));
            document.head.append(script);
        });
        return youtubeApiPromise;
    }

    function updateLyrics(container, time) {
        const lines = [...container.querySelectorAll(".music-lyric-line")];
        let current = -1;
        lines.forEach((line, index) => { if (Number(line.dataset.time) <= time) current = index; });
        lines.forEach((line, index) => line.classList.toggle("is-current", index === current));
        if (current >= 0 && Date.now() > state.manualUntil) {
            lines[current].scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        }
    }

    function createPlayer(track, parsed, lyricLines) {
        const shell = create("div", "music-player-shell");
        shell.dataset.provider = track.provider;
        if (!parsed.embed) {
            shell.append(create("p", "music-player-fallback", "Official embed unavailable. Open the original source below."));
            return shell;
        }

        if (track.provider === "youtube" && parsed.youtubeId && lyricLines) {
            const target = create("div", "music-youtube-player");
            target.id = `music-youtube-${String(track.id).replace(/[^A-Za-z0-9_-]/g, "")}`;
            shell.append(target);
            ensureYoutubeApi().then(() => {
                if (String(state.currentId) !== String(track.id) || !document.getElementById(target.id)) return;
                state.youtubePlayer = new window.YT.Player(target.id, {
                    host: "https://www.youtube-nocookie.com",
                    videoId: parsed.youtubeId,
                    playerVars: { rel: 0 },
                    events: { onReady: () => {
                        state.youtubeTimer = window.setInterval(() => {
                            const time = Number(state.youtubePlayer?.getCurrentTime?.());
                            if (Number.isFinite(time)) updateLyrics(lyricLines, time);
                        }, 500);
                    } }
                });
            }).catch(() => {
                shell.replaceChildren(create("p", "music-player-fallback", "YouTube embed unavailable. Use the original source link below."));
            });
            return shell;
        }

        const iframe = document.createElement("iframe");
        iframe.src = parsed.embed;
        iframe.title = `${track.title || "Music"} — official ${track.provider} player`;
        iframe.loading = "lazy";
        iframe.allow = "autoplay; encrypted-media; picture-in-picture";
        iframe.referrerPolicy = "strict-origin-when-cross-origin";
        iframe.allowFullscreen = track.provider === "youtube";
        iframe.addEventListener("error", () => shell.replaceChildren(create("p", "music-player-fallback", "Official player unavailable. Use the source link below.")), { once: true });
        shell.append(iframe);
        return shell;
    }

    function createLyrics(track) {
        const lrc = parseLrc(track.lrc_data);
        const excerpt = clean(track.lyric_excerpt);
        if (!lrc.length && !excerpt) return { section: null, lines: null };
        const section = create("section", "music-lyrics");
        section.append(create("p", "music-label", "LYRICS"));
        let lines = null;
        if (lrc.length) {
            lines = create("div", "music-lyric-lines");
            lrc.forEach((entry) => {
                const line = create("p", "music-lyric-line", entry.text);
                line.dataset.time = String(entry.time);
                lines.append(line);
            });
            ["wheel", "touchstart", "pointerdown"].forEach((type) => lines.addEventListener(type, () => { state.manualUntil = Date.now() + 4000; }, { passive: true }));
            section.append(lines);
        } else {
            section.append(create("p", "music-lyric-excerpt", excerpt));
        }
        return { section, lines };
    }

    function createVisual(track) {
        const visual = create("div", "music-visual");
        const cover = safeUrl(track.cover_url);
        const makeEmpty = () => {
            visual.replaceChildren(create("span", "", "✦"));
            visual.classList.add("is-empty");
        };
        if (!cover) makeEmpty();
        else {
            const image = document.createElement("img");
            image.className = "music-cover";
            image.src = cover;
            image.alt = `${track.title || "Music"} cover`;
            image.loading = "lazy";
            image.addEventListener("error", makeEmpty, { once: true });
            visual.append(image);
        }
        return visual;
    }

    function renderNowPlaying() {
        stopYoutube();
        const host = byId("music-now-playing");
        const track = state.tracks.find((item) => String(item.id) === String(state.currentId)) || state.tracks[0];
        host.replaceChildren();
        if (!track) { host.hidden = true; return; }
        state.currentId = track.id;
        const parsed = parseMusicUrl(track.provider, track.music_url);
        const record = create("article", "music-record");
        record.append(createVisual(track));
        const copy = create("div", "music-record-copy");
        copy.append(create("p", "music-record-index", `NOW PLAYING / ${String(state.tracks.indexOf(track) + 1).padStart(2, "0")}`));
        copy.append(create("h4", "", track.title || "UNTITLED"));
        if (track.artist) copy.append(create("p", "music-artist", track.artist));
        copy.append(create("p", "music-provider", String(track.provider || "source").replace("_", " ").toUpperCase()));
        const lyrics = createLyrics(track);
        copy.append(createPlayer(track, parsed, lyrics.lines));
        if (parsed.source) {
            const link = create("a", "music-source-link", parsed.externalLabel);
            link.href = parsed.source;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            copy.append(link);
        }
        if (track.note) {
            const note = create("section", "music-note");
            note.append(create("p", "music-label", "MY NOTE"), create("p", "", track.note));
            copy.append(note);
        }
        if (lyrics.section) copy.append(lyrics.section);
        if (isAdmin()) {
            const controls = create("div", "music-record-admin");
            const edit = create("button", "music-edit-button", "EDIT");
            edit.type = "button";
            edit.addEventListener("click", () => openMusicEditor(track));
            controls.append(edit);
            copy.append(controls);
        }
        record.append(copy);
        host.append(record);
        host.hidden = false;
    }

    function renderLibrary() {
        const library = byId("music-library");
        const list = byId("music-list");
        list.replaceChildren();
        state.tracks.forEach((track, index) => {
            const row = create("article", "music-list-item");
            row.classList.toggle("is-current", String(track.id) === String(state.currentId));
            row.append(create("span", "music-list-number", String(index + 1).padStart(2, "0")));
            const copy = create("div", "music-list-copy");
            copy.append(create("strong", "", track.title || "UNTITLED"));
            if (track.artist) copy.append(create("span", "", track.artist));
            const select = create("button", "music-select-button", String(track.id) === String(state.currentId) ? "PLAYING" : "PLAY →");
            select.type = "button";
            select.addEventListener("click", () => { state.currentId = track.id; renderNowPlaying(); renderLibrary(); byId("music-now-playing").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" }); });
            row.append(copy, select);
            list.append(row);
        });
        byId("music-count").textContent = `${state.tracks.length} TRACK${state.tracks.length === 1 ? "" : "S"}`;
        library.hidden = state.tracks.length < 2;
    }

    function renderAdminActions() {
        const host = byId("music-admin-actions");
        host.replaceChildren();
        if (!isAdmin()) return;
        const add = create("button", "music-admin-button", "＋ ADD MUSIC");
        add.type = "button";
        add.addEventListener("click", () => openMusicEditor(null));
        host.append(add);
    }

    function renderArchive() {
        renderAdminActions();
        renderNowPlaying();
        renderLibrary();
        const status = byId("music-status");
        status.textContent = state.tracks.length ? "" : "No music archived yet.";
        status.hidden = Boolean(state.tracks.length);
    }

    async function loadMusic() {
        const { data, error } = await db.from("music")
            .select("id,created_at,updated_at,title,artist,cover_url,music_url,provider,note,lyric_excerpt,lrc_data,sort_order")
            .order("sort_order", { ascending: true, nullsFirst: false })
            .order("created_at", { ascending: true });
        if (error) {
            byId("music-status").textContent = "Music archive is waiting to be opened.";
            renderAdminActions();
            return;
        }
        state.tracks = data || [];
        if (!state.tracks.some((track) => String(track.id) === String(state.currentId))) state.currentId = state.tracks[0]?.id || null;
        renderArchive();
    }

    function openMusicEditor(track) {
        if (!isAdmin()) return;
        const form = byId("music-form");
        form.reset();
        byId("music-id").value = track?.id || "";
        byId("music-title").value = track?.title || "";
        byId("music-artist").value = track?.artist || "";
        byId("music-provider").value = track?.provider || "netease";
        byId("music-url").value = track?.music_url || "";
        byId("music-cover-url").value = track?.cover_url || "";
        byId("music-note").value = track?.note || "";
        byId("music-lyric-excerpt").value = track?.lyric_excerpt || "";
        byId("music-lrc-data").value = track?.lrc_data || "";
        byId("music-sort-order").value = track?.sort_order ?? "";
        byId("music-modal-title").textContent = track ? "Edit music" : "New music";
        byId("delete-music-btn").classList.toggle("hidden", !track || !isOwner());
        byId("music-form-message").textContent = "";
        bridge.openModal(byId("music-modal"));
    }

    byId("music-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!isAdmin()) return;
        const id = clean(byId("music-id").value);
        const payload = {
            title: clean(byId("music-title").value), artist: clean(byId("music-artist").value) || null,
            provider: byId("music-provider").value, music_url: safeUrl(byId("music-url").value),
            cover_url: safeUrl(byId("music-cover-url").value) || null, note: clean(byId("music-note").value) || null,
            lyric_excerpt: clean(byId("music-lyric-excerpt").value) || null, lrc_data: clean(byId("music-lrc-data").value) || null,
            sort_order: byId("music-sort-order").value === "" ? null : Number(byId("music-sort-order").value)
        };
        const message = byId("music-form-message");
        if (!payload.music_url) { message.textContent = "请输入有效的官方音乐页面 URL。"; return; }
        message.textContent = "Saving…";
        const result = await bridge.write(
            id ? "music_update" : "music_create",
            id ? { id, data: payload } : { data: payload },
            () => id ? db.from("music").update(payload).eq("id", id) : db.from("music").insert(payload)
        );
        if (result.error) { message.textContent = `保存失败：${result.error.message}`; return; }
        byId("music-modal").dataset.dirty = "false";
        bridge.closeModal(byId("music-modal"));
        await loadMusic();
    });

    byId("delete-music-btn").addEventListener("click", async () => {
        if (!isOwner()) return;
        const id = clean(byId("music-id").value);
        if (!id || !window.confirm("确定要从 MUSIC ARCHIVE 删除这条记录吗？")) return;
        const { error } = await db.from("music").delete().eq("id", id);
        if (error) { byId("music-form-message").textContent = `删除失败：${error.message}`; return; }
        byId("music-modal").dataset.dirty = "false";
        bridge.closeModal(byId("music-modal"));
        state.currentId = null;
        await loadMusic();
    });

    window.addEventListener("yuri:authchange", () => {
        renderAdminActions();
        renderNowPlaying();
    });
    window.kioraMusic = Object.freeze({ parseMusicUrl, parseLrc });
    loadMusic();
    auth.initialize(db).then(() => {
        renderAdminActions();
        renderNowPlaying();
    });
})();
