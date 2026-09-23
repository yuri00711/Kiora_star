(async function () {
    "use strict";

    const common = window.yuriArticles;
    const db = common.getClient();
    const auth = window.KioraAuth;
    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
    const esc = (value) => common.escapeHtml(String(value ?? ""));
    const STUDY_PHONE_PDF_QUERY = "(max-width: 520px)";
    const studyPdfResizeObservers = [];
    const tables = Object.freeze({
        practices: "study_practices", files: "study_files", aptitude_answers: "study_aptitude_answers",
        answer_keys: "study_answer_keys", mistakes: "study_mistakes", mistake_attempts: "study_mistake_attempts",
        shenlun_questions: "study_shenlun_questions", shenlun_answers: "study_shenlun_answers",
        shenlun_references: "study_shenlun_references", reviews: "study_reviews", revisions: "study_revisions",
        notes: "study_notes", activities: "study_activities"
    });
    const state = {
        view: "home", practices: [], mistakes: [], revisions: [], notes: [], activities: [],
        calendarDate: new Date(), selectedDay: new Date(), practiceFilter: "all", mistakeSubject: "all",
        mistakeStatus: "all", mistakeMode: "index", currentMistake: 0, writable: false, activePractice: null,
        activeRevision: null, practiceListScrollY: 0, revisionListScrollY: 0, signedUrls: new Map()
    };

    function isoDate(value = new Date()) {
        const date = new Date(value);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }
    function displayDate(value) { return value ? String(value).slice(0, 10).replaceAll("-", ".") : "—"; }
    function monthLabel(date) { return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(date).toUpperCase(); }
    function status(text, error = false) { const node = $("#study-status"); node.textContent = text; node.classList.toggle("study-error", error); node.hidden = !text; }
    function empty(text, action = "") { return `<div class="study-empty"><p>${esc(text)}</p>${action}</div>`; }
    function uid() { return crypto.randomUUID(); }

    async function list(entity, options = {}) {
        if (auth.role === "editor") {
            return auth.readForEditor("study_list", { entity, filters: options.filters || {}, from: options.from, to: options.to, limit: options.limit || 300 });
        }
        let query = db.from(tables[entity]).select("*");
        for (const [key, value] of Object.entries(options.filters || {})) query = query.eq(key, value);
        if (options.from) query = query.gte(options.order || "created_at", options.from);
        if (options.to) query = query.lte(options.order || "created_at", options.to);
        query = query.limit(options.limit || 300);
        return query;
    }

    async function getEntity(entity, id) {
        if (auth.role === "editor") return auth.readForEditor("study_get", { entity, id });
        return db.from(tables[entity]).select("*").eq("id", id).maybeSingle();
    }

    async function upsert(entity, data, id = null) {
        return auth.write("study_upsert", { entity, id, data }, async () => {
            const query = id ? db.from(tables[entity]).update(data).eq("id", id) : db.from(tables[entity]).insert(data);
            return query.select("*").single();
        });
    }

    async function remove(entity, id) {
        return auth.write("study_delete", { entity, id }, () => db.from(tables[entity]).delete().eq("id", id).select("id").single());
    }

    async function getSignedUrl(path) {
        if (!path) return "";
        if (state.signedUrls.has(path)) return state.signedUrls.get(path);
        const result = await auth.studySignedUrl(path, 3600);
        const url = result.data?.signedUrl || "";
        if (url) state.signedUrls.set(path, url);
        return url;
    }

    async function loadBase() {
        status("Reading the constellation…");
        const publicViewer = auth.role === "viewer";
        const requests = [list("practices"), list("mistakes"), list("notes"), list("activities", { limit: 500 })];
        if (!publicViewer) requests.push(list("revisions"));
        const [practices, mistakes, notes, activities, revisions] = await Promise.all(requests);
        const failure = [practices, mistakes, notes, activities, revisions].find((result) => result?.error);
        if (failure) { status(`Study data unavailable: ${failure.error.message || failure.error.code}. Please run supabase-study-migration.sql.`, true); return false; }
        state.practices = practices.data || []; state.mistakes = mistakes.data || []; state.notes = notes.data || [];
        state.activities = activities.data || []; state.revisions = revisions?.data || [];
        status(""); renderAll(); return true;
    }

    function setView(view, updateHash = true) {
        if (!$( `#study-view-${view}`)) return;
        state.view = view;
        $$(".study-view").forEach((section) => { section.hidden = section.dataset.view !== view; });
        $$('[data-study-view]').forEach((button) => button.setAttribute("aria-current", button.dataset.studyView === view ? "page" : "false"));
        if (updateHash) history.replaceState(null, "", `#${view}`);
        if (view === "calendar") renderCalendar(); if (view === "practice") renderPractices();
        if (view === "mistakes") renderMistakes(); if (view === "revisions") renderRevisions(); if (view === "notes") renderNotes();
        window.scrollTo({ top: $(".study-index").offsetTop - 80, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }

    function renderAll() { renderHome(); renderCalendar(); renderPractices(); renderMistakes(); renderRevisions(); renderNotes(); }

    function renderHome() {
        const now = new Date(); $("#study-current-month").textContent = monthLabel(now);
        const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const counts = new Map();
        state.activities.forEach((item) => { const date = String(item.activity_at).slice(0, 10); if (date.startsWith(isoDate(now).slice(0, 7))) counts.set(Number(date.slice(8)), (counts.get(Number(date.slice(8))) || 0) + 1); });
        $("#study-month-stars").innerHTML = Array.from({ length: days }, (_, index) => `<button type="button" data-calendar-day="${index + 1}" style="--density:${Math.min(counts.get(index + 1) || 0, 4)}" aria-label="${index + 1}日，${counts.get(index + 1) || 0}条记录"><small>${index + 1}</small></button>`).join("");
        const aptitude = state.practices.filter((item) => item.practice_type === "aptitude").length;
        const shenlun = state.practices.filter((item) => item.practice_type === "shenlun").length;
        const subjects = Object.entries(state.mistakes.reduce((map, item) => ({ ...map, [item.subject]: (map[item.subject] || 0) + 1 }), {})).slice(0, 3);
        const cards = [
            ["01","PRACTICE",state.practices.length,`APTITUDE ${aptitude}<br>SHENLUN ${shenlun}`,"practice"],
            ["02","MISTAKES",state.mistakes.length,subjects.map(([name,count])=>`${esc(name)} ${count}`).join("<br>") || "No records yet.","mistakes"],
            ["03","REVISIONS",state.revisions.length,"Rewrite and compare.","revisions"],
            ["04","NOTES",state.notes.length,"Learning fragments.","notes"]
        ];
        $("#study-dashboard").innerHTML = cards.map(([index,title,count,detail,view]) => `<button type="button" class="study-dashboard-card" data-open-view="${view}"><span class="index">${index} / ARCHIVE</span><h3>${title}</h3><strong>${count}</strong><p>${detail}</p></button>`).join("");
    }

    function renderCalendar() {
        const date = state.calendarDate; $("#study-calendar-title").textContent = monthLabel(date);
        const first = new Date(date.getFullYear(), date.getMonth(), 1); const offset = (first.getDay() + 6) % 7;
        const start = new Date(first); start.setDate(first.getDate() - offset);
        $("#study-calendar-grid").innerHTML = Array.from({ length: 42 }, (_, index) => {
            const day = new Date(start); day.setDate(start.getDate() + index); const key = isoDate(day);
            const activities = state.activities.filter((item) => String(item.activity_at).slice(0,10) === key);
            return `<button type="button" class="study-calendar-day ${day.getMonth() !== date.getMonth() ? "other" : ""} ${key === isoDate() ? "today" : ""} ${key === isoDate(state.selectedDay) ? "selected" : ""}" data-date="${key}"><span class="day-number">${day.getDate()}</span><span class="day-stars">${"✦".repeat(Math.min(activities.length, 5))}</span></button>`;
        }).join("");
        renderDay();
    }

    function renderDay() {
        const key = isoDate(state.selectedDay); const events = state.activities.filter((item) => String(item.activity_at).slice(0,10) === key).sort((a,b) => String(a.activity_at).localeCompare(String(b.activity_at)));
        $("#study-day-title").textContent = new Intl.DateTimeFormat("en-US", { month:"long", day:"numeric", year:"numeric" }).format(state.selectedDay).toUpperCase();
        $("#study-day-activities").innerHTML = events.length ? events.map((item) => `<a href="#${entityView(item.entity_type)}" class="study-timeline-item" data-activity-entity="${esc(item.entity_type)}" data-activity-id="${esc(item.entity_id || "")}"><time>${new Date(item.activity_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</time><em>${esc(String(item.activity_type).replaceAll("_"," ").toUpperCase())}</em><strong>${esc(item.title)}</strong></a>`).join("") : empty("No learning activity recorded on this day.");
    }

    function entityView(type) { return type.includes("mistake") ? "mistakes" : type.includes("revision") ? "revisions" : type === "note" ? "notes" : "practice"; }

    function renderPractices() {
        const listItems = state.practices.filter((item) => state.practiceFilter === "all" || item.practice_type === state.practiceFilter).sort((a,b) => String(b.practice_date).localeCompare(String(a.practice_date)));
        $("#study-practice-list").innerHTML = listItems.length ? listItems.map((item,index) => `<button type="button" class="study-record" data-practice-id="${item.id}"><span class="study-record-index">${String(index+1).padStart(3,"0")}</span><span><h3>${esc(item.title)}</h3><p>${esc((item.practice_type === "aptitude" ? "APTITUDE / 行测" : "SHENLUN / 申论") + (item.subject ? ` · ${item.subject}` : ""))}</p></span><p class="study-record-meta">${displayDate(item.practice_date)}<br>${esc(item.status.toUpperCase())}</p></button>`).join("") : empty("No practice recorded yet.", state.writable ? '<button class="study-text-button" data-action="new-practice">＋ NEW PRACTICE</button>' : "");
    }

    function setPracticeDetailMode(showDetail) {
        const section = $("#study-view-practice");
        $(".study-view-heading", section).hidden = showDetail;
        $(".study-filter-row", section).hidden = showDetail;
        $("#study-practice-list").hidden = showDetail;
        $("#study-practice-detail").hidden = !showDetail;
    }

    function closePractice() {
        disconnectStudyPdfResizeObservers();
        setPracticeDetailMode(false);
        state.activePractice = null;
        requestAnimationFrame(() => window.scrollTo({ top: state.practiceListScrollY, behavior: "auto" }));
    }

    async function openPractice(id) {
        const practice = state.practices.find((item) => item.id === id); if (!practice) return;
        if (!state.activePractice) state.practiceListScrollY = window.scrollY;
        disconnectStudyPdfResizeObservers();
        state.activePractice = practice;
        const detail = $("#study-practice-detail");
        setPracticeDetailMode(true);
        detail.innerHTML = `<button class="study-text-button study-back-button" type="button" data-action="close-practice">← BACK TO PRACTICE</button>${empty("Opening practice…")}`;
        window.scrollTo({ top: Math.max($("#study-view-practice").offsetTop - 84, 0), behavior: "auto" });
        status("Opening practice…");
        const entities = practice.practice_type === "aptitude" ? ["files","aptitude_answers","answer_keys"] : ["files","shenlun_questions"];
        const results = await Promise.all(entities.map((entity) => list(entity, { filters:{ practice_id:id }, limit:500 })));
        if (results.some((result) => result.error)) {
            status("Could not open this practice.", true);
            detail.innerHTML = `<button class="study-text-button study-back-button" type="button" data-action="close-practice">← BACK TO PRACTICE</button>${empty("Could not open this practice.")}`;
            return;
        }
        status("");
        const data = Object.fromEntries(entities.map((entity,index)=>[entity,results[index].data||[]]));
        if (practice.practice_type === "aptitude") await renderAptitude(practice, data); else await renderShenlun(practice, data);
    }

    async function paperMarkup(files) {
        const paper = files.find((file) => ["paper","material"].includes(file.file_kind));
        if (!paper) return `<div class="study-empty">No paper uploaded yet.</div>`;
        const url = await getSignedUrl(paper.storage_path); if (!url) return `<div class="study-empty study-error">Paper unavailable.</div>`;
        if (paper.mime_type === "application/pdf") return `<div class="study-pdf-document" data-pdf-url="${esc(url)}"><p class="study-pdf-loading" role="status">Loading PDF…</p></div>`;
        return paper.mime_type.startsWith("image/") ? `<img src="${esc(url)}" alt="Practice paper">` : `<iframe src="${esc(url)}#toolbar=1" title="Practice paper"></iframe>`;
    }

    function disconnectStudyPdfResizeObservers() {
        while (studyPdfResizeObservers.length) {
            const cleanup = studyPdfResizeObservers.pop();
            cleanup();
        }
    }

    function studyPdfContentWidth(container) {
        const containerStyle = window.getComputedStyle(container);
        const horizontalPadding = (Number.parseFloat(containerStyle.paddingLeft) || 0)
            + (Number.parseFloat(containerStyle.paddingRight) || 0);
        return Math.max(container.clientWidth - horizontalPadding, 1);
    }

    async function renderPdfPages(container, pdf) {
        const renderToken = {};
        container._studyPdfRenderToken = renderToken;
        container.replaceChildren();

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
            const page = await pdf.getPage(pageNumber);
            if (container._studyPdfRenderToken !== renderToken) return;

            const baseViewport = page.getViewport({ scale: 1 });
            const phone = window.matchMedia(STUDY_PHONE_PDF_QUERY).matches;
            const availableWidth = phone
                ? studyPdfContentWidth(container)
                : Math.max(container.clientWidth || baseViewport.width, 320);
            const displayScale = phone
                ? availableWidth / baseViewport.width
                : Math.min(2, availableWidth / baseViewport.width);
            const displayViewport = page.getViewport({ scale: displayScale });

            // On phones DPR only increases backing-store resolution. The CSS size stays
            // equal to displayViewport, so PDF.js and the visible canvas keep one ratio.
            const dpr = phone ? Math.min(Math.max(window.devicePixelRatio || 1, 1), 2) : 1;
            const renderViewport = phone
                ? page.getViewport({ scale: displayScale * dpr })
                : displayViewport;
            const figure = document.createElement("figure");
            const canvas = document.createElement("canvas");
            const caption = document.createElement("figcaption");

            canvas.width = Math.floor(renderViewport.width);
            canvas.height = Math.floor(renderViewport.height);
            if (phone) {
                figure.style.width = `${displayViewport.width}px`;
                canvas.style.width = `${displayViewport.width}px`;
                canvas.style.height = "auto";
            }

            const pageRatio = baseViewport.width / baseViewport.height;
            if (phone && (!Number.isFinite(pageRatio) || pageRatio < 0.2 || pageRatio > 5)) {
                console.warn("STUDY_PDF_UNUSUAL_PAGE_BOX", {
                    page: pageNumber,
                    width: baseViewport.width,
                    height: baseViewport.height
                });
            }

            caption.textContent = `PAGE ${String(pageNumber).padStart(2, "0")} / ${String(pdf.numPages).padStart(2, "0")}`;
            figure.append(canvas, caption);
            container.append(figure);
            await page.render({
                canvasContext: canvas.getContext("2d"),
                viewport: renderViewport
            }).promise;
            if (container._studyPdfRenderToken !== renderToken) return;
        }
    }

    function observePhonePdfWidth(container, pdf) {
        if (!window.matchMedia(STUDY_PHONE_PDF_QUERY).matches || typeof ResizeObserver === "undefined") return;

        let lastWidth = studyPdfContentWidth(container);
        let resizeTimer = 0;
        const resizeObserver = new ResizeObserver(() => {
            const nextWidth = studyPdfContentWidth(container);
            if (Math.abs(nextWidth - lastWidth) < 1) return;
            lastWidth = nextWidth;
            window.clearTimeout(resizeTimer);
            resizeTimer = window.setTimeout(() => {
                renderPdfPages(container, pdf).catch((error) => {
                    container.innerHTML = `<p class="study-empty study-error">PDF could not be loaded. ${esc(error.message || "")}</p>`;
                });
            }, 160);
        });
        resizeObserver.observe(container);
        studyPdfResizeObservers.push(() => {
            window.clearTimeout(resizeTimer);
            resizeObserver.disconnect();
            container._studyPdfRenderToken = null;
        });
    }

    async function renderPdfDocuments(root) {
        const documents = $$(".study-pdf-document[data-pdf-url]", root);
        if (!documents.length) return;
        disconnectStudyPdfResizeObservers();
        try {
            await loadScript("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs", "pdfjsLib", true);
            for (const container of documents) {
                const pdf = await window.pdfjsLib.getDocument(container.dataset.pdfUrl).promise;
                await renderPdfPages(container, pdf);
                observePhonePdfWidth(container, pdf);
            }
        } catch (error) {
            documents.forEach((container) => { container.innerHTML = `<p class="study-empty study-error">PDF could not be loaded. ${esc(error.message || "")}</p>`; });
        }
    }

    function mobileAnswerControls(current, total, answer, writable) {
        const options = ["A", "B", "C", "D"].map((option) => {
            const selected = answer?.answer === option;
            return `<button type="button" data-answer="${option}" class="${selected ? "active" : ""}" aria-label="第 ${current} 题选择 ${option}" aria-pressed="${selected}" ${writable ? "" : "disabled"}>${option}</button>`;
        }).join("");
        return `<div class="study-mobile-answer-center"><span class="study-current-question">第 ${current} 题</span><div class="study-answer-options">${options}</div></div><div class="study-mobile-answer-nav"><button type="button" data-answer-nav="prev" aria-label="上一题" ${current <= 1 ? "disabled" : ""}>‹</button><button type="button" data-answer-nav="next" aria-label="下一题" ${current >= total ? "disabled" : ""}>›</button></div>`;
    }

    async function renderAptitude(practice, data) {
        const detail = $("#study-practice-detail"); const total = practice.total_questions || Math.max(data.answer_keys.length, 1);
        const current = Math.min(Number(detail.dataset.question || 1), total); detail.dataset.question = current;
        const answers = new Map(data.aptitude_answers.map((item)=>[item.question_number,item])); const answer = answers.get(current);
        detail._studyData = data;
        const writable = state.writable;
        detail.innerHTML = `<button class="study-text-button study-back-button" type="button" data-action="close-practice">← BACK TO PRACTICE</button><div class="study-detail-toolbar"><div><p class="study-kicker">APTITUDE / ${esc(practice.status.toUpperCase())}</p><h3>${esc(practice.title)}</h3></div><div class="study-action-row">${writable ? '<button class="study-secondary" data-action="upload-paper">UPLOAD PAPER</button><button class="study-secondary" data-action="import-key">IMPORT ANSWER KEY</button><button class="study-primary" data-action="finish-practice">RESULT</button>' : ""}</div></div><div class="study-paper-workspace"><div class="study-paper-reader">${await paperMarkup(data.files)}</div><aside class="study-answer-panel">${answerPanel(current,total,answer,writable)}</aside></div><div class="study-mobile-dock">${mobileAnswerControls(current,total,answer,writable)}</div>`;
        await renderPdfDocuments(detail);
    }

    function answerPanel(current,total,answer,writable) {
        return `<p class="study-kicker">QUESTION</p><p class="study-question-count">${String(current).padStart(3,"0")} / ${String(total).padStart(3,"0")}</p><p class="study-current-question">第 ${current} 题</p><div class="study-answer-options">${["A","B","C","D"].map(option=>`<button type="button" data-answer="${option}" class="${answer?.answer===option?"active":""}" ${writable?"":"disabled"}>${option}</button>`).join("")}</div><div class="study-answer-nav"><button type="button" data-answer-nav="prev">← PREV</button><button type="button" data-answer-nav="next">NEXT →</button></div><div class="study-mini-actions"><button type="button" data-action="clear-answer">CLEAR ANSWER</button><button type="button" data-action="toggle-flag">${answer?.flagged?"UNFLAG":"FLAG"}</button><button type="button" data-action="open-answer-sheet">ANSWER SHEET</button><label><input type="checkbox" data-auto-advance ${practiceAutoAdvance()?"checked":""}> AUTO ADVANCE</label></div>`;
    }
    function updateAptitudeControls() {
        const detail = $("#study-practice-detail");
        const data = detail._studyData;
        if (!data || !state.activePractice) return;
        const total = state.activePractice.total_questions || Math.max(data.answer_keys.length, 1);
        const current = Math.min(Math.max(Number(detail.dataset.question || 1), 1), total);
        detail.dataset.question = current;
        const answer = data.aptitude_answers.find((item) => item.question_number === current);
        const panel = $(".study-answer-panel", detail);
        if (panel) panel.innerHTML = answerPanel(current, total, answer, state.writable);
        const mobileDock = $(".study-mobile-dock", detail);
        if (mobileDock) mobileDock.innerHTML = mobileAnswerControls(current, total, answer, state.writable);
    }
    function practiceAutoAdvance(){ return state.activePractice?.auto_advance !== false; }

    async function saveAptitudeAnswer(value, changes = {}) {
        const detail=$("#study-practice-detail"), data=detail._studyData, question=Number(detail.dataset.question), existing=data.aptitude_answers.find((item)=>item.question_number===question);
        const payload={practice_id:state.activePractice.id,question_number:question,answer:value ?? existing?.answer ?? null,flagged:changes.flagged ?? existing?.flagged ?? false};
        const result=await upsert("aptitude_answers",payload,existing?.id||null); if(result.error){status(`Answer not saved: ${result.error.message}`,true);return;}
        if(existing) Object.assign(existing,result.data); else data.aptitude_answers.push(result.data);
        if(changes.advance && practiceAutoAdvance() && question<(state.activePractice.total_questions||1)) detail.dataset.question=question+1;
        updateAptitudeControls();
    }

    function showAnswerSheet() {
        const detail=$("#study-practice-detail"),data=detail._studyData,total=state.activePractice.total_questions||Math.max(data.answer_keys.length,1),map=new Map(data.aptitude_answers.map(item=>[item.question_number,item]));
        openSheet(`<header><div><p class="study-kicker">APTITUDE</p><h2>Answer Sheet</h2></div><button class="study-dialog-close" data-close-sheet>×</button></header><div class="study-sheet-content"><div class="study-answer-grid">${Array.from({length:total},(_,i)=>{const item=map.get(i+1);return `<button data-sheet-question="${i+1}" class="${item?.answer?"answered":""} ${item?.flagged?"flagged":""}">${String(i+1).padStart(3,"0")} ${esc(item?.answer||"—")}</button>`}).join("")}</div></div>`);
    }

    async function finishPractice() {
        const data=$("#study-practice-detail")._studyData, keys=data.answer_keys.filter(item=>item.confirmed), answers=new Map(data.aptitude_answers.map(item=>[item.question_number,item.answer]));
        if(!keys.length){ return status("Confirm an Answer Key before grading.",true); }
        if (state.activePractice.status !== "completed") {
            const p = state.activePractice;
            const completed = await upsert("practices", { practice_type:p.practice_type,title:p.title,practice_date:p.practice_date,source:p.source,subject:p.subject,note:p.note,status:"completed",total_questions:p.total_questions,auto_advance:p.auto_advance,is_public:p.is_public }, p.id);
            if (!completed.error) Object.assign(p, completed.data);
        }
        const rows=keys.map(key=>({number:key.question_number,mine:answers.get(key.question_number)||"",correct:key.correct_answer,ok:(answers.get(key.question_number)||"").toUpperCase()===key.correct_answer.toUpperCase()}));
        const correct=rows.filter(row=>row.ok).length, wrong=rows.filter(row=>!row.ok&&row.mine).length,unanswered=rows.filter(row=>!row.mine).length;
        openSheet(`<header><div><p class="study-kicker">APTITUDE RESULT</p><h2>${esc(state.activePractice.title)}</h2></div><button class="study-dialog-close" data-close-sheet>×</button></header><div class="study-sheet-content"><div class="study-result-summary"><div><strong>${correct}</strong>CORRECT</div><div><strong>${wrong}</strong>WRONG</div><div><strong>${unanswered}</strong>UNANSWERED</div></div><form id="archive-wrong-form"><p class="study-kicker">SELECT TO ARCHIVE</p><div class="study-result-list">${rows.filter(row=>!row.ok).map(row=>`<label><input type="checkbox" name="wrong" value="${row.number}" ${row.mine?"":"disabled"}><span>${String(row.number).padStart(3,"0")}</span><span>${esc(row.mine||"—")} → ${esc(row.correct)}</span></label>`).join("")}</div>${state.writable?'<button class="study-primary" type="submit">ADD SELECTED TO MISTAKE BOOK</button>':""}</form></div>`);
    }

   async function shenlunRegionMarkup(question, kind) {
    const regions = Array.isArray(question?.[kind]) ? question[kind] : [];

    if (!question?.source_file_id || !regions.length) {
        return `
            <div class="study-shenlun-region-empty">
                No ${kind === "question_regions" ? "question" : "reference answer"} area selected.
            </div>
        `;
    }

    const urls = await Promise.all(
        regions.map((region) =>
            mistakeMediaUrl({
                paper_file_id: question.source_file_id,
                paper_page: region.page,
                crop_x: region.crop_x,
                crop_y: region.crop_y,
                crop_width: region.crop_width,
                crop_height: region.crop_height
            })
        )
    );

    return `
        <div class="study-shenlun-region-stack">
            ${urls
                .map((url, index) =>
                    url
                        ? `
                            <figure>
                                <img
                                    src="${esc(url)}"
                                    alt="${
                                        kind === "question_regions"
                                            ? "Question"
                                            : "Reference answer"
                                    } selection ${index + 1}"
                                >
                                <figcaption>
                                    PAGE ${String(regions[index].page || 1).padStart(2, "0")}
                                    · AREA ${String(index + 1).padStart(2, "0")}
                                </figcaption>
                            </figure>
                        `
                        : ""
                )
                .join("")}
        </div>
    `;
}


async function renderShenlun(practice, data) {
    const detail = $("#study-practice-detail");

    detail._studyData = data;

    const questions = data.shenlun_questions.sort(
        (a, b) => a.question_number - b.question_number
    );

    const active =
        questions.find(
            (item) => item.id === detail.dataset.questionId
        ) || questions[0];

    if (active) {
        detail.dataset.questionId = active.id;
    }

    let answer = null;
    let reference = null;
    let reviews = [];

    if (active) {
        const results = await Promise.all([
            list("shenlun_answers", {
                filters: {
                    question_id: active.id
                }
            }),

            list("shenlun_references", {
                filters: {
                    question_id: active.id
                }
            }),

            list("reviews", {
                filters: {
                    question_id: active.id
                }
            })
        ]);

        answer =
            (results[0].data || [])
                .sort(
                    (a, b) =>
                        b.attempt_number - a.attempt_number
                )[0] || null;

        reference =
            (results[1].data || [])[0] || null;

        reviews =
            results[2].data || [];
    }

    detail._answer = answer;
    detail._reference = reference;

    const questionMarkup = active
        ? await shenlunRegionMarkup(
              active,
              "question_regions"
          )
        : "";

    const answerRegionMarkup = active
        ? await shenlunRegionMarkup(
              active,
              "answer_regions"
          )
        : "";

    /*
     * 只有用户已经写过答案，或者已经存在 Review，
     * 才展示参考答案。
     *
     * 这样刚进入题目时不会直接看到答案。
     */
    const hasWorked = Boolean(
        answer?.body?.trim() ||
        reviews.length
    );

    detail.innerHTML = `
        <button
            class="study-text-button study-back-button"
            type="button"
            data-action="close-practice"
        >
            ← BACK TO PRACTICE
        </button>

        <div class="study-detail-toolbar">

            <div>
                <p class="study-kicker">
                    SHENLUN /
                    ${esc(practice.status.toUpperCase())}
                </p>

                <h3>
                    ${esc(practice.title)}
                </h3>
            </div>

            <div class="study-action-row">

                ${
                    state.writable
                        ? `
                            <button
                                class="study-secondary"
                                data-action="upload-paper"
                            >
                                UPLOAD MATERIAL
                            </button>

                            <button
                                class="study-secondary"
                                data-action="add-shenlun-question"
                            >
                                ＋ QUESTION
                            </button>
                        `
                        : ""
                }

            </div>
        </div>


        <div class="study-filter-row">

            ${questions
                .map(
                    (q) => `
                        <button
                            data-shenlun-question="${q.id}"
                            class="${
                                active?.id === q.id
                                    ? "active"
                                    : ""
                            }"
                        >
                            ${String(q.question_number).padStart(2, "0")}
                            ${esc(q.title)}
                        </button>
                    `
                )
                .join("")}

        </div>


        ${
            active
                ? `
                    <div class="study-shenlun-layout">

                        <section class="study-material">

                            <p class="study-kicker">
                                QUESTION /
                                ${esc(
                                    active.question_type.toUpperCase()
                                )}
                            </p>

                            <h4>
                                ${esc(active.title)}
                            </h4>

                            ${questionMarkup}

                        </section>


                        <section class="study-answer-editor">

                            <p class="study-kicker">
                                YOUR ANSWER
                            </p>

                            ${
                                active.question_type === "essay"
                                    ? `
                                        <input
                                            id="shenlun-answer-title"
                                            value="${esc(
                                                answer?.title || ""
                                            )}"
                                            placeholder="TITLE"
                                        >

                                        <input
                                            id="shenlun-answer-thesis"
                                            value="${esc(
                                                answer?.thesis || ""
                                            )}"
                                            placeholder="THESIS / 中心论点"
                                        >

                                        <textarea
                                            id="shenlun-answer-outline"
                                            placeholder="OUTLINE — one point per line"
                                        >${esc(
                                            (
                                                answer?.outline || []
                                            ).join("\n")
                                        )}</textarea>
                                    `
                                    : ""
                            }

                            <textarea
                                id="shenlun-answer-body"
                                ${
                                    state.writable
                                        ? ""
                                        : "readonly"
                                }
                                placeholder="Write here…"
                            >${esc(answer?.body || "")}</textarea>


                            <p
                                id="shenlun-count"
                                class="study-character-count"
                            >
                                ${(answer?.body || "").length}
                                /
                                ${
                                    active.max_characters ||
                                    "∞"
                                }
                            </p>


                            ${
                                state.writable
                                    ? `
                                        <div class="study-action-row">

                                            <button
                                                class="study-secondary"
                                                data-action="save-shenlun-answer"
                                            >
                                                SAVE DRAFT
                                            </button>

                                            <button
                                                class="study-secondary"
                                                data-action="import-reference"
                                            >
                                                IMPORT REFERENCE TEXT
                                            </button>

                                            <button
                                                class="study-primary"
                                                data-action="review-shenlun"
                                            >
                                                SUBMIT FOR KIORA REVIEW
                                            </button>

                                        </div>
                                    `
                                    : ""
                            }

                        </section>

                    </div>


                    ${
                        hasWorked
                            ? `
                                <section
                                    class="study-shenlun-reference"
                                >

                                    <div
                                        class="study-shenlun-reference-heading"
                                    >

                                        <div>
                                            <p class="study-kicker">
                                                REFERENCE ANSWER
                                            </p>

                                            <h4>
                                                Selected answer area
                                            </h4>
                                        </div>

                                    </div>

                                    ${answerRegionMarkup}

                                </section>
                            `
                            : ""
                    }


                    <div id="study-review-output">

                        ${
                            reviews.length
                                ? reviewMarkup(
                                      reviews.sort(
                                          (a, b) =>
                                              String(
                                                  b.created_at
                                              ).localeCompare(
                                                  String(
                                                      a.created_at
                                                  )
                                              )
                                      )[0]
                                  )
                                : ""
                        }

                    </div>
                `
                : empty(
                      "Add the first question to begin."
                  )
        }
    `;

    installShenlunAutosave(
        active,
        answer
    );
}

    function reviewMarkup(review){ const sections=[["CONTENT COVERAGE",review.content_coverage],["MATERIAL EVIDENCE",review.material_evidence],["TASK ANALYSIS",review.task_analysis],["EXPRESSION",review.expression_review],["STRUCTURE",review.structure_review]];return `<div class="study-detail"><p class="study-kicker">KIORA REVIEW / ${esc(review.assessment?.level||"")}</p>${sections.map(([title,value])=>`<section class="study-review-section"><h4>${title}</h4><p>${esc(value?.summary||"")}</p><ul>${(value?.findings||[]).map(item=>`<li><strong>${esc(item.status?.toUpperCase())}</strong> ${esc(item.point)}<br>${esc(item.evidence)}<br>${esc(item.suggestion)}</li>`).join("")}</ul></section>`).join("")}<section class="study-review-section"><h4>PRIORITY</h4><p>${esc(review.assessment?.main_issue||"")}</p><ol>${(review.assessment?.priorities||[]).map(item=>`<li>${esc(item)}</li>`).join("")}</ol>${state.writable?'<button class="study-primary" data-action="add-revision">ADD TO REVISION</button>':""}</section></div>`; }

    let autosaveTimer;
    function installShenlunAutosave(question,answer){ const body=$("#shenlun-answer-body");if(!body)return;const count=$("#shenlun-count"),limit=question.max_characters||Infinity;body.addEventListener("input",()=>{count.textContent=`${body.value.length} / ${Number.isFinite(limit)?limit:"∞"}`;count.classList.toggle("over",body.value.length>limit);localStorage.setItem(`kiora:study-draft:${question.id}`,body.value);clearTimeout(autosaveTimer);autosaveTimer=setTimeout(()=>saveShenlun(question,answer,true),1800)});if(!answer&&localStorage.getItem(`kiora:study-draft:${question.id}`))body.value=localStorage.getItem(`kiora:study-draft:${question.id}`); }

    async function saveShenlun(question,existing,silent=false){const body=$("#shenlun-answer-body")?.value||"";const data={practice_id:state.activePractice.id,question_id:question.id,attempt_number:existing?.attempt_number||1,title:$("#shenlun-answer-title")?.value||null,thesis:$("#shenlun-answer-thesis")?.value||null,outline:($("#shenlun-answer-outline")?.value||"").split("\n").map(x=>x.trim()).filter(Boolean),body};const result=await upsert("shenlun_answers",data,existing?.id||null);if(result.error){if(!silent)status("Draft save failed.",true);return null;}localStorage.removeItem(`kiora:study-draft:${question.id}`);$("#study-practice-detail")._answer=result.data;if(!silent)status("Draft saved.");return result.data;}

    function filteredMistakes(){return state.mistakes.filter(item=>(state.mistakeSubject==="all"||item.subject===state.mistakeSubject)&&(state.mistakeStatus==="all"||item.status===state.mistakeStatus)).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));}
    async function mistakeMediaUrl(item) {
        if (item.image_path) {
            return getSignedUrl(item.image_path);
        }

        if (!item.paper_file_id || !item.paper_page) {
            return "";
        }

        const hasCrop = [
            item.crop_x,
            item.crop_y,
            item.crop_width,
            item.crop_height
        ].every((value) =>
            value !== null &&
            value !== undefined &&
            Number.isFinite(Number(value))
        );

        const cropKey = hasCrop
            ? [item.crop_x, item.crop_y, item.crop_width, item.crop_height]
                .map((value) => Number(value).toFixed(8))
                .join(":")
            : "full";

        const cacheKey = `crop:${item.paper_file_id}:${item.paper_page}:${cropKey}`;
        if (state.signedUrls.has(cacheKey)) {
            return state.signedUrls.get(cacheKey);
        }

        const record = await getEntity("files", item.paper_file_id);
        const file = record.data;
        if (!file) return "";

        const url = await getSignedUrl(file.storage_path);
        if (!url) return "";

        let sourceCanvas;

        if (file.mime_type === "application/pdf") {
            await loadScript(
                "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs",
                "pdfjsLib",
                true
            );

            const pdf = await window.pdfjsLib.getDocument(url).promise;
            const pageNumber = Math.min(
                Math.max(Number(item.paper_page) || 1, 1),
                pdf.numPages
            );
            const page = await pdf.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 2 });

            sourceCanvas = document.createElement("canvas");
            sourceCanvas.width = Math.ceil(viewport.width);
            sourceCanvas.height = Math.ceil(viewport.height);

            await page.render({
                canvasContext: sourceCanvas.getContext("2d"),
                viewport
            }).promise;
        } else if (file.mime_type.startsWith("image/")) {
            if (!hasCrop) {
                state.signedUrls.set(cacheKey, url);
                return url;
            }

            const image = document.createElement("img");
            image.crossOrigin = "anonymous";
            image.src = url;
            await image.decode();

            sourceCanvas = document.createElement("canvas");
            sourceCanvas.width = image.naturalWidth;
            sourceCanvas.height = image.naturalHeight;
            sourceCanvas.getContext("2d").drawImage(image, 0, 0);
        } else {
            return "";
        }

        if (!hasCrop) {
            const image = sourceCanvas.toDataURL("image/jpeg", 0.92);
            state.signedUrls.set(cacheKey, image);
            return image;
        }

        const clamp = (value, min = 0, max = 1) =>
            Math.min(Math.max(value, min), max);

        const x1 = clamp(Number(item.crop_x));
        const y1 = clamp(Number(item.crop_y));
        const x2 = clamp(x1 + Number(item.crop_width));
        const y2 = clamp(y1 + Number(item.crop_height));

        const sx = Math.max(0, Math.floor(x1 * sourceCanvas.width));
        const sy = Math.max(0, Math.floor(y1 * sourceCanvas.height));
        const ex = Math.min(sourceCanvas.width, Math.ceil(x2 * sourceCanvas.width));
        const ey = Math.min(sourceCanvas.height, Math.ceil(y2 * sourceCanvas.height));

        const sw = Math.max(1, ex - sx);
        const sh = Math.max(1, ey - sy);

        const cropCanvas = document.createElement("canvas");
        cropCanvas.width = sw;
        cropCanvas.height = sh;

        cropCanvas.getContext("2d").drawImage(
            sourceCanvas,
            sx,
            sy,
            sw,
            sh,
            0,
            0,
            sw,
            sh
        );

        const resultImage = cropCanvas.toDataURL("image/jpeg", 0.94);
        state.signedUrls.set(cacheKey, resultImage);
        return resultImage;
    }
    function renderMistakes(){const subjects=[...new Set(state.mistakes.map(item=>item.subject))];$("#study-mistake-subjects").innerHTML=["all",...subjects].map(subject=>`<button data-mistake-subject="${esc(subject)}" class="${state.mistakeSubject===subject?"active":""}">${esc(subject==="all"?"ALL SUBJECTS":subject)}</button>`).join("");const items=filteredMistakes(),container=$("#study-mistake-content");if(!items.length){container.innerHTML=empty("No mistakes archived yet.",state.writable?'<button class="study-text-button" data-action="quick-mistake">＋ QUICK MISTAKE</button>':"");return;}state.currentMistake=Math.min(state.currentMistake,items.length-1);if(state.mistakeMode==="index")container.innerHTML=`<table class="study-mistake-index"><thead><tr><th>NO.</th><th>KNOWLEDGE</th><th>DATE</th><th>STATUS</th></tr></thead><tbody>${items.map((item,index)=>`<tr data-id="${item.id}"><td>${String(index+1).padStart(3,"0")}</td><td>${esc(item.knowledge_tag||item.subject)}</td><td>${displayDate(item.created_at)}</td><td>${esc(item.status.toUpperCase())}</td></tr>`).join("")}</tbody></table>`;else renderMistakeCard(items[state.currentMistake],items);}

    async function renderMistakeCard(item, items = filteredMistakes(), revisit = false) {
        const container = $("#study-mistake-content");
        const image = await mistakeMediaUrl(item);

        container.innerHTML = `
            <article class="study-mistake-card" data-mistake-card="${item.id}">
                <p class="study-kicker">
                    MISTAKE ${String(state.currentMistake + 1).padStart(3, "0")} /
                    ${esc(item.status.toUpperCase())}
                </p>

                <h3>
                    ${esc(item.subject)} ·
                    ${item.question_number ? `第 ${esc(item.question_number)} 题` : "题号未记录"}
                </h3>

                <div class="study-question-media ${image ? "has-image" : ""}" style="${image ? "min-height:0" : ""}">
                    ${image
                        ? `<img src="${esc(image)}" alt="Original question">`
                        : item.question_snapshot
                            ? `<p>${esc(item.question_snapshot)}</p>`
                            : "Original question reference"
                    }
                </div>

                ${revisit
                    ? `
                        <div class="study-answer-options">
                            ${["A", "B", "C", "D"].map((option) =>
                                `<button data-revisit-answer="${option}">${option}</button>`
                            ).join("")}
                        </div>
                        <button class="study-primary" data-action="submit-revisit" disabled>SUBMIT</button>
                    `
                    : `
                        <div class="study-answer-reveal">
                            <div>
                                <span>MY ANSWER</span>
                                <strong>${esc(item.my_answer || "—")}</strong>
                            </div>
                            <div>
                                <span>CORRECT</span>
                                <strong>${esc(item.correct_answer)}</strong>
                            </div>
                        </div>

                        ${state.writable
                            ? `
                                <section class="study-mistake-reason" data-mistake-reason-editor="${item.id}">
                                    <label class="study-kicker" for="study-mistake-reason-${item.id}">WHY I GOT IT WRONG</label>
                                    <div class="study-reason-presets" aria-label="Quick reason choices">
                                        ${["知识点不会", "概念混淆", "审题", "粗心", "时间不足", "做题策略"].map((reason) => `<button type="button" data-reason-preset="${esc(reason)}">${esc(reason)}</button>`).join("")}
                                    </div>
                                    <textarea id="study-mistake-reason-${item.id}" data-mistake-reason-input placeholder="写下这道题为什么做错……">${esc(item.reason || "")}</textarea>
                                    <div class="study-reason-save-row">
                                        <span data-mistake-reason-status role="status"></span>
                                        <button class="study-primary" type="button" data-action="save-mistake-reason" data-id="${item.id}">SAVE</button>
                                    </div>
                                </section>
                            `
                            : `
                                <p class="study-mistake-reason-readonly">
                                    <span class="study-kicker">WHY I GOT IT WRONG</span><br>
                                    ${esc(item.reason || "—")}
                                </p>
                            `
                        }

                        ${state.writable
                            ? `
                                <div class="study-action-row">
                                    <button class="study-primary" data-action="start-revisit">REVISIT</button>
                                    ${item.paper_file_id
                                        ? `<button class="study-secondary" data-action="crop-mistake">SELECT QUESTION AREA</button>`
                                        : ""
                                    }
                                    <button class="study-secondary" data-action="master-mistake">MASTERED</button>
                                    <button class="study-secondary" data-action="delete-mistake">DELETE</button>
                                </div>
                            `
                            : ""
                        }
                    `
                }

                <footer class="study-detail-toolbar">
                    <button class="study-text-button" data-card-nav="prev">← PREVIOUS</button>
                    <span>${state.currentMistake + 1} / ${items.length}</span>
                    <button class="study-text-button" data-card-nav="next">NEXT →</button>
                </footer>
            </article>
        `;
    }

    async function saveMistakeReason(button) {
        const item = state.mistakes.find((entry) => entry.id === button.dataset.id);
        const editor = button.closest("[data-mistake-reason-editor]");
        const input = $("[data-mistake-reason-input]", editor);
        const message = $("[data-mistake-reason-status]", editor);
        if (!item || !input) return;

        button.disabled = true;
        message.textContent = "Saving…";
        const reason = input.value.trim();
        const result = await upsert("mistakes", mistakeData(item, { reason: reason || null }), item.id);
        button.disabled = false;

        if (result.error) {
            message.textContent = "Save failed.";
            return;
        }

        Object.assign(item, result.data);
        input.value = item.reason || "";
        message.textContent = "Saved.";
    }

    function renderRevisions(){const container=$("#study-revision-list");container.innerHTML=state.revisions.length?state.revisions.map((item,index)=>`<button class="study-record" data-revision-id="${item.id}"><span class="study-record-index">${String(index+1).padStart(3,"0")}</span><span><h3>${esc(item.title)}</h3><p>${esc((item.issue_tags||[]).join(" · ")||item.category||"")}</p></span><p class="study-record-meta">${displayDate(item.created_at)}<br>${esc(item.status.toUpperCase())}</p></button>`).join(""):empty("No revisions archived yet.");}

    function setRevisionDetailMode(showDetail) {
        const section = $("#study-view-revisions");
        $(".study-view-heading", section).hidden = showDetail;
        $("#study-revision-list").hidden = showDetail;
        $("#study-revision-detail").hidden = !showDetail;
    }

    function closeRevision() {
        setRevisionDetailMode(false);
        state.activeRevision = null;
        requestAnimationFrame(() => window.scrollTo({ top: state.revisionListScrollY, behavior: "auto" }));
    }

    async function openRevision(id) {
        const item = state.revisions.find((entry) => entry.id === id);
        if (!item) return;

        if (!state.activeRevision) state.revisionListScrollY = window.scrollY;
        state.activeRevision = item;
        const detail = $("#study-revision-detail");
        setRevisionDetailMode(true);
        detail.innerHTML = `<button class="study-text-button study-back-button" type="button" data-action="close-revision">← BACK TO REVISIONS</button>${empty("Opening revision…")}`;
        window.scrollTo({ top: Math.max($("#study-view-revisions").offsetTop - 84, 0), behavior: "auto" });

        const [attemptsResult, reviewsResult, questionResult] = item.question_id
            ? await Promise.all([
                list("shenlun_answers", { filters: { question_id: item.question_id } }),
                list("reviews", { filters: { question_id: item.question_id } }),
                getEntity("shenlun_questions", item.question_id)
            ])
            : [{ data: [] }, { data: [] }, { data: null }];

        const attempts = (attemptsResult.data || []).sort((a, b) => a.attempt_number - b.attempt_number);
        const reviews = reviewsResult.data || [];
        const question = questionResult.data || null;
        const snapshot = item.source_snapshot && typeof item.source_snapshot === "object" ? item.source_snapshot : {};
        const prompt = String(snapshot.prompt || question?.prompt || "").trim();
        const previousAnswer = attempts.find((answer) => answer.id === item.answer_id) || attempts[0] || null;
        const review = reviews.find((entry) => entry.id === item.review_id)
            || reviews.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]
            || null;
        const mainIssue = String(review?.assessment?.main_issue || (item.issue_tags || []).join("；") || "").trim();
        const priorities = Array.isArray(review?.assessment?.priorities) ? review.assessment.priorities.filter(Boolean) : [];
        const hasQuestionRegions = Boolean(question?.source_file_id && Array.isArray(question.question_regions) && question.question_regions.length);
        const questionImage = hasQuestionRegions ? await shenlunRegionMarkup(question, "question_regions") : "";
        const questionNumber = question?.question_number ? `第 ${question.question_number} 题` : "原题";

        detail.innerHTML = `
            <button class="study-text-button study-back-button" type="button" data-action="close-revision">← BACK TO REVISIONS</button>
            <p class="study-kicker">REVISION / ${esc(item.status.toUpperCase())}</p>
            <section class="study-revision-section">
                <p class="study-kicker">QUESTION</p>
                <h4>${esc(questionNumber)}</h4>
                <p class="study-revision-copy">${esc(prompt || "原题文字未保存。")}</p>
                ${questionImage}
            </section>
            <section class="study-revision-section">
                <p class="study-kicker">MY PREVIOUS ANSWER</p>
                <p class="study-revision-copy">${esc(previousAnswer?.body || "—")}</p>
            </section>
            <section class="study-revision-section">
                <p class="study-kicker">WHAT WAS WRONG</p>
                <p class="study-revision-copy">${esc(mainIssue || "—")}</p>
                ${priorities.length ? `<ul class="study-revision-priorities">${priorities.map((priority) => `<li>${esc(priority)}</li>`).join("")}</ul>` : ""}
            </section>
            ${state.writable ? `<div class="study-action-row"><button class="study-primary" type="button" data-action="rewrite-revision" data-id="${item.id}">REWRITE</button></div>` : ""}
        `;
    }
    function reviewMetrics(review){const findings=[...(review?.content_coverage?.findings||[]),...(review?.structure_review?.findings||[]),...(review?.expression_review?.findings||[])];return{covered:findings.filter(x=>x.status==="covered"||x.status==="good").length,missing:findings.filter(x=>x.status==="missing").length,partial:findings.filter(x=>x.status==="partial").length,issues:findings.filter(x=>x.status==="issue").length,priorities:review?.assessment?.priorities||[]};}
    function comparisonMarkup(attempts,reviews){const first=attempts[0],last=attempts[attempts.length-1],firstReview=reviews.find(x=>x.answer_id===first.id),lastReview=reviews.find(x=>x.answer_id===last.id),a=reviewMetrics(firstReview),b=reviewMetrics(lastReview),improvements=[];if(b.covered>a.covered)improvements.push(`覆盖/良好项增加 ${b.covered-a.covered}`);if(b.missing<a.missing)improvements.push(`漏点减少 ${a.missing-b.missing}`);if(b.partial<a.partial)improvements.push(`部分覆盖减少 ${a.partial-b.partial}`);if(b.issues<a.issues)improvements.push(`结构与表达问题减少 ${a.issues-b.issues}`);return `<div class="study-result-summary"><div><strong>${a.covered} → ${b.covered}</strong>COVERED / GOOD</div><div><strong>${a.missing} → ${b.missing}</strong>MISSING</div><div><strong>${a.issues} → ${b.issues}</strong>ISSUES</div></div><section class="study-review-section"><h4>WHAT IMPROVED</h4><p>${esc(improvements.join("；")||"No confirmed improvement detected yet.")}</p><h4>WHAT STILL NEEDS WORK</h4><p>${esc(b.priorities.join("；")||"No major issue detected.")}</p><p>${first.body.length} → ${last.body.length} CHARACTERS</p></section><div class="study-answer-reveal"><div><span>ATTEMPT 01</span><p>${esc(first.body)}</p></div><div><span>ATTEMPT ${String(last.attempt_number).padStart(2,"0")}</span><p>${esc(last.body)}</p></div></div>`;}

    function renderNotes(){const subjects=[...new Set(state.notes.map(item=>item.subject).filter(Boolean))];$("#study-note-filters").innerHTML=["all",...subjects].map((subject,index)=>`<button data-note-subject="${esc(subject)}" class="${index===0?"active":""}">${esc(subject==="all"?"ALL":subject)}</button>`).join("");renderNoteList("all");}
    function renderNoteList(subject){const items=state.notes.filter(item=>subject==="all"||item.subject===subject);$("#study-note-list").innerHTML=items.length?items.map(item=>`<article class="study-note"><p class="study-kicker">${esc(item.subject||"STUDY NOTE")}</p><h3>${esc(item.title)}</h3><p>${esc(item.body)}</p><footer><span>${displayDate(item.note_date)}</span>${state.writable?`<span><button class="study-text-button" data-edit-note="${item.id}">EDIT</button> <button class="study-text-button" data-delete-note="${item.id}">DELETE</button></span>`:""}</footer></article>`).join(""):empty("No study notes yet.");}

    function fieldsMarkup(fields){return fields.map(field=>`<div class="study-field ${field.full?"full":""}"><label for="study-field-${field.name}">${esc(field.label)}</label>${field.type==="textarea"?`<textarea id="study-field-${field.name}" name="${field.name}" ${field.required?"required":""}>${esc(field.value||"")}</textarea>`:field.type==="select"?`<select id="study-field-${field.name}" name="${field.name}">${field.options.map(([value,label])=>`<option value="${esc(value)}" ${String(field.value)===String(value)?"selected":""}>${esc(label)}</option>`).join("")}</select>`:`<input id="study-field-${field.name}" name="${field.name}" type="${field.type||"text"}" value="${esc(field.value||"")}" ${field.required?"required":""} ${field.accept?`accept="${esc(field.accept)}"`:""} ${field.max?`max="${field.max}"`:""}>`}</div>`).join("");}
    function openEditor({title,kicker="STUDY EDITOR",fields,onSave}){const dialog=$("#study-editor");$("#study-editor-title").textContent=title;$("#study-editor-kicker").textContent=kicker;$("#study-editor-fields").innerHTML=fieldsMarkup(fields);$("#study-editor-message").textContent="";dialog._onSave=onSave;dialog.showModal();setTimeout(()=>$("input,textarea,select",dialog)?.focus(),50);}
    function openSheet(html){const dialog=$("#study-sheet");$("#study-sheet-content").innerHTML=html;dialog.showModal();}

    function newPractice(){openEditor({title:"New Practice",kicker:"PRACTICE ARCHIVE",fields:[{name:"practice_type",label:"TYPE",type:"select",options:[["aptitude","APTITUDE / 行测"],["shenlun","SHENLUN / 申论"]]},{name:"title",label:"TITLE",required:true},{name:"practice_date",label:"PRACTICE DATE",type:"date",value:isoDate(),required:true},{name:"source",label:"SOURCE"},{name:"subject",label:"SUBJECT"},{name:"total_questions",label:"TOTAL QUESTIONS",type:"number"},{name:"note",label:"NOTE",type:"textarea",full:true}],onSave:async data=>{data.total_questions=data.total_questions?Number(data.total_questions):null;data.status="draft";data.auto_advance=true;data.is_public=false;const result=await upsert("practices",data);if(!result.error){state.practices.unshift(result.data);return true;}throw result.error;}});}
    function noteEditor(note=null){openEditor({title:note?"Edit Note":"New Note",kicker:"LEARNING FRAGMENT",fields:[{name:"title",label:"TITLE",value:note?.title,required:true},{name:"note_date",label:"DATE",type:"date",value:note?.note_date||isoDate(),required:true},{name:"subject",label:"SUBJECT",value:note?.subject},{name:"tags",label:"TAGS / comma separated",value:(note?.tags||[]).join(", ")},{name:"body",label:"BODY",type:"textarea",value:note?.body,required:true,full:true}],onSave:async data=>{data.tags=data.tags.split(/[,，]/).map(x=>x.trim()).filter(Boolean);data.is_public=note?.is_public||false;const result=await upsert("notes",data,note?.id);if(result.error)throw result.error;if(note)Object.assign(note,result.data);else state.notes.unshift(result.data);return true;}});}
    function quickMistake(){openEditor({title:"Quick Mistake",kicker:"BATCH CAPTURE",fields:[{name:"image",label:"IMAGE / paste or upload",type:"file",accept:"image/jpeg,image/png,image/webp",full:true},{name:"subject",label:"SUBJECT",required:true},{name:"knowledge_tag",label:"KNOWLEDGE TAG"},{name:"my_answer",label:"MY ANSWER"},{name:"correct_answer",label:"CORRECT ANSWER",required:true},{name:"reason",label:"REASON",type:"select",options:[["知识点不会","知识点不会"],["概念混淆","概念混淆"],["审题","审题"],["粗心","粗心"],["时间不足","时间不足"],["做题策略","做题策略"],["其他","其他"]]},{name:"question_snapshot",label:"QUESTION / optional text",type:"textarea",full:true}],onSave:async(data,form)=>{const file=form.elements.image.files[0];delete data.image;data.source_type="quick";data.status="learning";data.is_public=false;let result=await upsert("mistakes",data);if(result.error)throw result.error;if(file){const upload=await uploadFile(file,`mistakes/${result.data.id}/${safeName(file.name)}`);if(upload.error)throw upload.error;result=await upsert("mistakes",{...data,image_path:upload.data.path},result.data.id);}state.mistakes.unshift(result.data);return true;}});const area=$("#study-editor-fields");area.addEventListener("paste",event=>{const file=Array.from(event.clipboardData?.files||[]).find(item=>item.type.startsWith("image/"));if(!file)return;const transfer=new DataTransfer();transfer.items.add(file);$("#study-field-image").files=transfer.files;},{once:true});}

    function safeName(name){return String(name||"file").normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g,"-").slice(-120);}
    async function uploadFile(file,path){if(file.size>50*1024*1024)return{error:{message:"File exceeds 50 MB."}};return auth.uploadStudyFile(file,`${path.replace(/^\/+/,"")}`);}

    async function attachPaper(){const input=document.createElement("input");input.type="file";input.accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp";input.onchange=async()=>{const file=input.files[0];if(!file)return;status("Uploading paper…");const upload=await uploadFile(file,`practices/${state.activePractice.id}/paper/${uid()}-${safeName(file.name)}`);if(upload.error){status(upload.error.message,true);return;}const extracted=await extractText(file).catch(()=>"");const saved=await upsert("files",{practice_id:state.activePractice.id,file_kind:state.activePractice.practice_type==="shenlun"?"material":"paper",storage_path:upload.data.path,file_name:file.name,mime_type:file.type,file_size:file.size,extracted_text:extracted||null});if(saved.error){status(saved.error.message,true);return;}status("Paper uploaded.");openPractice(state.activePractice.id);};input.click();}

    async function importAnswerKey() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp";

        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;

            const total = Number(state.activePractice?.total_questions) || 0;
            status("Reading Answer Key…");

            try {
                const upload = await uploadFile(file, `practices/${state.activePractice.id}/answer-key/${uid()}-${safeName(file.name)}`);
                if (upload.error) throw upload.error;

                let text = await extractAnswerKeyText(file, false).catch(() => "");
                let parsed = parseAnswerKey(text, total);
                const localResultIsIncomplete = () => total ? parsed.length < Math.ceil(total * 0.7) : parsed.length === 0;

                if (localResultIsIncomplete() && (file.type === "application/pdf" || file.type.startsWith("image/"))) {
                    status("The embedded text was incomplete. Reading the answer marks…");
                    const ocrText = await extractAnswerKeyText(file, true).catch(() => "");
                    const ocrParsed = parseAnswerKey(ocrText, total);
                    if (ocrParsed.length > parsed.length) parsed = ocrParsed;
                    if (ocrText.trim() && !text.includes(ocrText)) text = [text, ocrText].filter(Boolean).join("\n");
                }

                if (localResultIsIncomplete() && text.trim()) {
                    status("Completing unclear answer marks…");
                    const aiResult = await auth.requestAnswerKeyExtraction(text, total);
                    if (!aiResult.error) parsed = mergeAnswerKeyResults(parsed, aiResult.data?.answers, total);
                }

                const fileRecord = await upsert("files", {
                    practice_id: state.activePractice.id,
                    file_kind: "answer_key",
                    storage_path: upload.data.path,
                    file_name: file.name,
                    mime_type: file.type,
                    file_size: file.size,
                    extracted_text: text || null
                });
                if (fileRecord.error) throw fileRecord.error;

                status(total
                    ? `Recognized ${parsed.length}/${total} answers. Please review them before confirming.`
                    : `Recognized ${parsed.length} answers. Please review them before confirming.`
                );
                showKeyReview(parsed, fileRecord.data.id);
            } catch (error) {
                status(`Answer Key import failed: ${error.message}`, true);
            }
        };

        input.click();
    }

    function mergeAnswerKeyResults(primary, fallback, expectedTotal = 0) {
        const answers = new Map();
        for (const item of [...(primary || []), ...(Array.isArray(fallback) ? fallback : [])]) {
            const questionNumber = Number(item?.question_number);
            const correctAnswer = String(item?.correct_answer || "").trim().toUpperCase();
            if (!Number.isInteger(questionNumber) || questionNumber < 1 || (expectedTotal && questionNumber > expectedTotal)) continue;
            if (!/^[A-D]$/.test(correctAnswer) || answers.has(questionNumber)) continue;
            answers.set(questionNumber, correctAnswer);
        }
        return Array.from(answers, ([question_number, correct_answer]) => ({ question_number, correct_answer }))
            .sort((a, b) => a.question_number - b.question_number);
    }

    function showKeyReview(parsed, fileId) {
        const answerMap = new Map((parsed || []).map((item) => [Number(item.question_number), item.correct_answer]));
        const inferredTotal = Math.max(0, ...answerMap.keys());
        const total = Number(state.activePractice?.total_questions) || inferredTotal;
        const rows = total
            ? Array.from({ length: total }, (_, index) => {
                const number = index + 1;
                const answer = answerMap.get(number) || "";
                return `<label><span>${String(number).padStart(3, "0")}</span><select name="key-${number}" data-key-question="${number}"><option value="">—</option>${["A", "B", "C", "D"].map((option) => `<option value="${option}" ${answer === option ? "selected" : ""}>${option}</option>`).join("")}</select></label>`;
            }).join("")
            : `<p class="study-empty">No answer numbers were recognized. Set TOTAL QUESTIONS on the practice and import again.</p>`;

        openSheet(`<header><div><p class="study-kicker">ANSWER KEY</p><h2>Review</h2></div><button class="study-dialog-close" type="button" data-close-sheet>×</button></header><div class="study-sheet-content"><form id="answer-key-review-form"><div class="study-answer-grid">${rows}</div>${total && state.writable ? '<button class="study-primary" type="submit">SAVE ANSWER KEY</button>' : ""}</form></div>`);
        const form = $("#answer-key-review-form");
        if (form) form._fileId = fileId;
    }


function normalizeAnswerKeyText(text) {
    return String(text || "")
        /*
         * 统一换行。
         */
        .replace(/\r\n?/g, "\n")

        /*
         * 一些常见全角符号。
         */
        .replace(/．/g, ".")
        .replace(/：/g, ":")
        .replace(/，/g, ",")
        .replace(/；/g, ";")

        /*
         * 连续空格压缩，
         * 但不要删除换行。
         */
        .replace(/[ \t]+/g, " ")

        /*
         * 太多空行压成一个。
         */
        .replace(/\n{3,}/g, "\n\n")

        .toUpperCase();
}


function parseAnswerKey(
    text,
    expectedTotal = 0
) {
    const source =
        normalizeAnswerKeyText(text);

    const answers =
        new Map();

    const rangePattern = /(?:^|\s)(\d{1,3})\s*[-–—~至]\s*(\d{1,3})\s*[.:、：]?\s*([A-D](?:\s*[A-D])*)/g;
    let rangeMatch;
    while ((rangeMatch = rangePattern.exec(source))) {
        const start = Number(rangeMatch[1]);
        const end = Number(rangeMatch[2]);
        const sequence = rangeMatch[3].replace(/\s+/g, "");
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) continue;
        if (expectedTotal && end > expectedTotal) continue;
        if (sequence.length !== end - start + 1) continue;
        for (let offset = 0; offset < sequence.length; offset += 1) answers.set(start + offset, sequence[offset]);
    }


    /*
     * 你的主要格式：
     *
     * 1. A 解析……
     * 2、C 【解析】……
     * 3 B 答案解析……
     * 4（D）……
     *
     * 重点：
     * 只取题号后面第一个 A-D。
     * 后面解析内容完全不管。
     */
    const patterns = [

        /*
         * 优先匹配“新的一行开头”。
         *
         * 这是最安全的规则，
         * 可以避免解析正文里的数字干扰。
         */
        /(?:^|\n)[ \t]*(\d{1,3})[ \t]*[.、,:：\-]?[ \t]*[（(【\[]?[ \t]*([A-D])[）)】\]]?/g,


        /*
         * 某些 PDF 会把换行吃掉，
         * 所以准备一个较宽松的备用规则。
         *
         * 比如：
         * 1.A 解析…… 2.C 解析……
         */
        /(?:^|[ \t])(\d{1,3})[ \t]*[.、,:：\-][ \t]*[（(【\[]?[ \t]*([A-D])[）)】\]]?/g
    ];


    for (
        const pattern of patterns
    ) {
        let match;

        while (
            (
                match =
                    pattern.exec(source)
            )
        ) {
            const number =
                Number(match[1]);

            const answer =
                match[2];


            if (
                !Number.isFinite(number)
            ) {
                continue;
            }


            if (
                number < 1
            ) {
                continue;
            }


            /*
             * 如果 Practice 已经填写了
             * TOTAL QUESTIONS，
             * 就拒绝超出范围的数字。
             *
             * 比如解析正文出现：
             * “2025 年……”
             * 就不会被当题号。
             */
            if (
                expectedTotal &&
                number > expectedTotal
            ) {
                continue;
            }


            /*
             * 第一次识别到的答案优先。
             *
             * 防止解析正文后面又出现
             * “1.A” 这种干扰内容覆盖答案。
             */
            if (
                !answers.has(number)
            ) {
                answers.set(
                    number,
                    answer
                );
            }
        }


        /*
         * 第一套严格规则已经认得很好时，
         * 不需要继续用宽松规则污染结果。
         */
        if (
            expectedTotal
                ? answers.size >=
                  expectedTotal * 0.8
                : answers.size >= 10
        ) {
            break;
        }
    }


    /*
     * 最后再做一次简单连续性清理。
     */
    return Array
        .from(answers)
        .map(
            ([
                question_number,
                correct_answer
            ]) => ({
                question_number,
                correct_answer
            })
        )
        .filter(
            (item) =>
                /^[A-D]$/.test(
                    item.correct_answer
                )
        )
        .sort(
            (a, b) =>
                a.question_number -
                b.question_number
        );
}

    async function confirmAnswerKey(form){status("Saving confirmed Answer Key…");const fields=$$("[data-key-question]",form);for(const field of fields){const number=Number(field.dataset.keyQuestion),answer=field.value.trim().toUpperCase();if(!answer)continue;if(!/^[A-D]$/.test(answer))continue;const existing=$("#study-practice-detail")._studyData.answer_keys.find(item=>item.question_number===number);const result=await upsert("answer_keys",{practice_id:state.activePractice.id,question_number:number,correct_answer:answer,source_file_id:form._fileId,confirmed:true},existing?.id);if(result.error){status(`Answer ${number} failed to save.`,true);return;}}$("#study-sheet").close();status("Answer Key confirmed.");openPractice(state.activePractice.id);}

    

    async function extractAnswerKeyText(file, allowOcr = false) { return extractText(file, allowOcr); }
    async function extractText(file,allowOcr=false){if(file.type.includes("wordprocessingml")){await loadScript("https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js","mammoth");return (await window.mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()})).value;}if(file.type==="application/pdf"){await loadScript("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs","pdfjsLib",true);const pdf=await window.pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;let text="";for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i);const content=await page.getTextContent();text+=content.items.map(item=>item.str).join(" ")+"\n";}if(text.trim().length>20)return text;if(!allowOcr)return text;await loadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js","Tesseract");for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i),viewport=page.getViewport({scale:1.6}),canvas=document.createElement("canvas"),context=canvas.getContext("2d");canvas.width=viewport.width;canvas.height=viewport.height;await page.render({canvasContext:context,viewport}).promise;const result=await window.Tesseract.recognize(canvas,"chi_sim+eng",{logger:message=>status(`OCR page ${i}/${pdf.numPages} · ${Math.round((message.progress||0)*100)}%`)});text+=result.data.text+"\n";}return text;}if(file.type.startsWith("image/")&&allowOcr){await loadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js","Tesseract");const result=await window.Tesseract.recognize(file,"chi_sim+eng",{logger:message=>status(`OCR ${Math.round((message.progress||0)*100)}%`)});return result.data.text;}throw new Error("This file contains no extractable text.");}
    function loadScript(src,global,module=false){if(window[global])return Promise.resolve();if(module)return import(src).then(value=>{window[global]=value;if(global==="pdfjsLib"&&value.GlobalWorkerOptions)value.GlobalWorkerOptions.workerSrc="https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs";});return new Promise((resolve,reject)=>{const script=document.createElement("script");script.src=src;script.onload=resolve;script.onerror=()=>reject(new Error("Parser could not be loaded."));document.head.append(script);});}

    function shenlunTypeOptions(selected = "summary") {
    const options = [
        [
            "summary",
            "概括题 / SUMMARY"
        ],

        [
            "analysis",
            "分析题 / ANALYSIS"
        ],

        [
            "proposal",
            "对策题 / PROPOSAL"
        ],

        [
            "official_document",
            "应用文 / OFFICIAL DOCUMENT"
        ],

        [
            "essay",
            "大作文 / ESSAY"
        ],

        [
            "other",
            "其他 / OTHER"
        ]
    ];

    return options
        .map(
            ([value, label]) => `
                <option
                    value="${value}"
                    ${
                        value === selected
                            ? "selected"
                            : ""
                    }
                >
                    ${label}
                </option>
            `
        )
        .join("");
}


async function openShenlunRegionSelector({
    file,
    regions = [],
    label = "QUESTION",
    onDone
}) {
    /*
     * 直接复用行测错题集现有框选样式和
     * installCropSelection。
     *
     * 不重新创造坐标系统。
     */
    ensureStudyCropStyles();

    if (!file) {
        return status(
            "Please upload the Shenlun PDF first.",
            true
        );
    }

    const url =
        await getSignedUrl(
            file.storage_path
        );

    if (!url) {
        return status(
            "Source paper could not be opened.",
            true
        );
    }

    /*
     * working 是本次正在编辑的全部框。
     *
     * 一个 QUESTION / ANSWER
     * 可以保存多个区域。
     */
    const working = (
        Array.isArray(regions)
            ? regions
            : []
    ).map((item) => ({
        ...item
    }));


    openSheet(`
        <header>

            <div>
                <p class="study-kicker">
                    SHENLUN / ${esc(label)}
                </p>

                <h2>
                    Select ${
                        esc(
                            label === "ANSWER"
                                ? "Answer"
                                : "Question"
                        )
                    } Area
                </h2>
            </div>

            <button
                class="study-dialog-close"
                data-close-sheet
                type="button"
            >
                ×
            </button>

        </header>


        <div class="study-sheet-content">

            <div class="study-crop-controls">

                <label>
                    PAGE

                    <input
                        id="study-crop-page"
                        type="number"
                        min="1"
                        value="${
                            working.at(-1)?.page ||
                            1
                        }"
                    >
                </label>


                <button
                    class="study-secondary"
                    id="study-crop-load"
                    type="button"
                >
                    LOAD PAGE
                </button>


                <div class="study-crop-jumps">

                    <button
                        class="study-secondary"
                        data-crop-jump="top"
                        type="button"
                    >
                        TOP
                    </button>

                    <button
                        class="study-secondary"
                        data-crop-jump="middle"
                        type="button"
                    >
                        MIDDLE
                    </button>

                    <button
                        class="study-secondary"
                        data-crop-jump="bottom"
                        type="button"
                    >
                        BOTTOM
                    </button>

                </div>


                <button
                    class="study-secondary"
                    id="study-crop-select"
                    type="button"
                >
                    SELECT AREA
                </button>


                <button
                    class="study-primary"
                    id="study-crop-add"
                    type="button"
                    disabled
                >
                    ADD AREA
                </button>

            </div>


            <p id="study-crop-hint">
                Choose a page,
                press SELECT AREA,
                then drag.
                Add as many areas as you need.
            </p>


            <div
                id="study-shenlun-region-list"
                class="study-shenlun-region-list"
            ></div>


            <div
                id="study-crop-scroll"
                class="study-crop-scroll"
            >

                <div
                    id="study-crop-stage"
                    class="study-crop-stage"
                ></div>

            </div>


            <div
                class="study-shenlun-selector-footer"
            >

                <button
                    class="study-secondary"
                    id="study-crop-clear"
                    type="button"
                >
                    CLEAR ALL
                </button>

                <button
                    class="study-primary"
                    id="study-crop-done"
                    type="button"
                >
                    DONE
                </button>

            </div>

        </div>
    `);


    const sheet =
        $("#study-sheet");

    const scroll =
        $("#study-crop-scroll");

    const stage =
        $("#study-crop-stage");

    const pageInput =
        $("#study-crop-page");

    const selectButton =
        $("#study-crop-select");

    const addButton =
        $("#study-crop-add");

    const hint =
        $("#study-crop-hint");

    const listNode =
        $("#study-shenlun-region-list");


    let controller = null;
    let pdf = null;


    /*
     * 显示当前已经加入的框选区域。
     */
    const renderRegionList = () => {
        listNode.innerHTML =
            working.length
                ? working
                      .map(
                          (
                              region,
                              index
                          ) => `
                              <div
                                  class="study-shenlun-region-chip"
                              >

                                  <span>
                                      ${String(
                                          index + 1
                                      ).padStart(
                                          2,
                                          "0"
                                      )}
                                      ·
                                      PAGE
                                      ${String(
                                          region.page ||
                                              1
                                      ).padStart(
                                          2,
                                          "0"
                                      )}
                                  </span>

                                  <button
                                      type="button"
                                      data-remove-region="${index}"
                                  >
                                      REMOVE
                                  </button>

                              </div>
                          `
                      )
                      .join("")
                : `
                    <p>
                        No areas selected yet.
                    </p>
                `;


        $$(
            "[data-remove-region]",
            listNode
        ).forEach((button) => {

            button.onclick = () => {
                working.splice(
                    Number(
                        button.dataset
                            .removeRegion
                    ),
                    1
                );

                renderRegionList();
            };

        });
    };


    /*
     * 加载指定 PDF 页面。
     */
    const renderPage =
        async () => {

            controller?.destroy();
            controller = null;

            stage.replaceChildren();
            stage._selection = null;

            addButton.disabled = true;

            selectButton.textContent =
                "SELECT AREA";

            selectButton.classList.remove(
                "active"
            );

            stage.classList.remove(
                "is-selecting"
            );

            scroll.scrollTop = 0;
            scroll.scrollLeft = 0;


            let canvas;


            if (
                file.mime_type ===
                "application/pdf"
            ) {
                await loadScript(
                    "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs",
                    "pdfjsLib",
                    true
                );


                if (!pdf) {
                    pdf =
                        await window.pdfjsLib
                            .getDocument(url)
                            .promise;
                }


                const pageNumber =
                    Math.min(
                        Math.max(
                            Number(
                                pageInput.value
                            ) || 1,
                            1
                        ),
                        pdf.numPages
                    );


                pageInput.value =
                    pageNumber;


                const page =
                    await pdf.getPage(
                        pageNumber
                    );


                const viewport =
                    page.getViewport({
                        scale: 2
                    });


                canvas =
                    document.createElement(
                        "canvas"
                    );


                canvas.width =
                    Math.ceil(
                        viewport.width
                    );

                canvas.height =
                    Math.ceil(
                        viewport.height
                    );


                await page.render({
                    canvasContext:
                        canvas.getContext(
                            "2d"
                        ),

                    viewport
                }).promise;

            } else if (
                file.mime_type.startsWith(
                    "image/"
                )
            ) {
                const image =
                    document.createElement(
                        "img"
                    );

                image.crossOrigin =
                    "anonymous";

                image.src = url;

                await image.decode();


                canvas =
                    document.createElement(
                        "canvas"
                    );

                canvas.width =
                    image.naturalWidth;

                canvas.height =
                    image.naturalHeight;


                canvas
                    .getContext("2d")
                    .drawImage(
                        image,
                        0,
                        0
                    );

            } else {
                stage.innerHTML = `
                    <p
                        class="study-empty study-error"
                    >
                        This source cannot be cropped.
                    </p>
                `;

                return;
            }


            canvas.className =
                "study-crop-canvas";

            stage.append(canvas);


            await new Promise(
                (resolve) =>
                    requestAnimationFrame(
                        resolve
                    )
            );


            /*
             * 这里直接调用你已经做好的
             * 行测框选器。
             */
            controller =
                installCropSelection({

                    stage,

                    source: canvas,

                    scroll,


                    onSelectionChange(
                        selection
                    ) {
                        addButton.disabled =
                            !selection ||
                            selection.crop_width <
                                0.003 ||
                            selection.crop_height <
                                0.003;
                    },


                    onModeChange(
                        selecting
                    ) {
                        stage.classList.toggle(
                            "is-selecting",
                            selecting
                        );

                        selectButton.classList.toggle(
                            "active",
                            selecting
                        );


                        selectButton.textContent =
                            selecting
                                ? "CANCEL SELECT"
                                : stage._selection
                                    ? "RESELECT"
                                    : "SELECT AREA";


                        hint.textContent =
                            selecting
                                ? "Selecting… keep holding. You can use the mouse wheel or drag near the top/bottom edge to continue scrolling."
                                : stage._selection
                                    ? "Area selected. Press ADD AREA, or RESELECT."
                                    : "Choose a page, then press SELECT AREA.";
                    }
                });
        };


    /*
     * LOAD PAGE
     */
    $("#study-crop-load").onclick =
        renderPage;


    /*
     * TOP / MIDDLE / BOTTOM
     */
    $$(
        "[data-crop-jump]",
        sheet
    ).forEach((button) => {

        button.onclick = () => {

            const max =
                Math.max(
                    0,
                    scroll.scrollHeight -
                        scroll.clientHeight
                );


            const target =
                button.dataset.cropJump ===
                "middle"
                    ? max / 2
                    : button.dataset
                          .cropJump ===
                      "bottom"
                        ? max
                        : 0;


            scroll.scrollTo({
                top: target,

                behavior:
                    matchMedia(
                        "(prefers-reduced-motion: reduce)"
                    ).matches
                        ? "auto"
                        : "smooth"
            });
        };

    });


    /*
     * 开始 / 取消框选
     */
    selectButton.onclick = () => {

        if (!controller) {
            return;
        }


        if (
            controller.isSelecting()
        ) {
            controller.cancel();
        } else {
            controller.start();
        }

    };


    /*
     * 将当前框加入区域列表。
     *
     * 加完以后仍然可以继续：
     * - 当前页再框一次
     * - 切换下一页继续框
     */
    addButton.onclick = () => {

        const selection =
            stage._selection;


        if (!selection) {
            return;
        }


        working.push({

            page:
                Number(
                    pageInput.value
                ) || 1,

            crop_x:
                selection.crop_x,

            crop_y:
                selection.crop_y,

            crop_width:
                selection.crop_width,

            crop_height:
                selection.crop_height
        });


        controller.cancel();

        renderRegionList();


        hint.textContent =
            "Area added. Change PAGE and LOAD PAGE if you need another page, or select another area on this page.";
    };


    /*
     * 删除当前 QUESTION / ANSWER
     * 的全部框。
     */
    $("#study-crop-clear").onclick =
        () => {

            working.splice(
                0,
                working.length
            );

            controller?.cancel();

            renderRegionList();
        };


    /*
     * 完成。
     */
    $("#study-crop-done").onclick =
        () => {

            if (!working.length) {
                return status(
                    `Select at least one ${label.toLowerCase()} area.`,
                    true
                );
            }


            controller?.destroy();

            controller = null;


            sheet.close();


            onDone(
                working.map(
                    (item) => ({
                        ...item
                    })
                )
            );
        };


    /*
     * 用户直接关闭弹窗时，
     * 销毁 pointer listener。
     */
    sheet.addEventListener(
        "close",
        () => {

            controller?.destroy();
            controller = null;

        },
        {
            once: true
        }
    );


    renderRegionList();

    await renderPage();
}


async function addShenlunQuestion() {

    const detail =
        $("#study-practice-detail");

    const data =
        detail._studyData;


    const count =
        data.shenlun_questions.length;


    /*
     * 申论整份文件只上传一次。
     */
    const material =
        data.files.find(
            (file) =>
                [
                    "material",
                    "paper"
                ].includes(
                    file.file_kind
                )
        );


    if (!material) {
        return status(
            "Upload the Shenlun PDF before adding questions.",
            true
        );
    }


    /*
     * 一个题目和一个答案
     * 都可以拥有多个框。
     */
    let questionRegions = [];
    let answerRegions = [];


    const dialog =
        $("#study-editor");


    $("#study-editor-title")
        .textContent =
        "New Shenlun Question";


    $("#study-editor-kicker")
        .textContent =
        "QUESTION SETUP";


    $("#study-editor-message")
        .textContent = "";


    /*
     * 导题阶段现在只显示：
     *
     * 题号
     * 题型
     * 题目框选
     * 答案框选
     */
    $("#study-editor-fields")
        .innerHTML = `

            <div class="study-field">

                <label
                    for="study-field-question_number"
                >
                    QUESTION NUMBER
                </label>

                <input
                    id="study-field-question_number"
                    name="question_number"
                    type="number"
                    min="1"
                    max="100"
                    value="${count + 1}"
                    required
                >

            </div>


            <div class="study-field">

                <label
                    for="study-field-question_type"
                >
                    TYPE
                </label>

                <select
                    id="study-field-question_type"
                    name="question_type"
                >
                    ${shenlunTypeOptions()}
                </select>

            </div>


            <div
                class="
                    study-field
                    full
                    study-shenlun-picker-field
                "
            >

                <label>
                    QUESTION
                </label>


                <div
                    class="study-shenlun-picker-row"
                >

                    <span
                        id="study-shenlun-question-count"
                    >
                        0 areas selected
                    </span>


                    <button
                        class="study-secondary"
                        id="study-select-question-regions"
                        type="button"
                    >
                        SELECT QUESTION
                    </button>

                </div>

            </div>


            <div
                class="
                    study-field
                    full
                    study-shenlun-picker-field
                "
            >

                <label>
                    ANSWER
                </label>


                <div
                    class="study-shenlun-picker-row"
                >

                    <span
                        id="study-shenlun-answer-count"
                    >
                        0 areas selected
                    </span>


                    <button
                        class="study-secondary"
                        id="study-select-answer-regions"
                        type="button"
                    >
                        SELECT ANSWER
                    </button>

                </div>

            </div>
        `;


    const updateCounts = () => {

        $("#study-shenlun-question-count")
            .textContent =
            `${questionRegions.length} area${
                questionRegions.length === 1
                    ? ""
                    : "s"
            } selected`;


        $("#study-shenlun-answer-count")
            .textContent =
            `${answerRegions.length} area${
                answerRegions.length === 1
                    ? ""
                    : "s"
            } selected`;
    };


    /*
     * 框题目。
     */
    $("#study-select-question-regions")
        .onclick = () =>
            openShenlunRegionSelector({

                file: material,

                regions:
                    questionRegions,

                label:
                    "QUESTION",

                onDone(regions) {
                    questionRegions =
                        regions;

                    updateCounts();
                }
            });


    /*
     * 框参考答案。
     */
    $("#study-select-answer-regions")
        .onclick = () =>
            openShenlunRegionSelector({

                file: material,

                regions:
                    answerRegions,

                label:
                    "ANSWER",

                onDone(regions) {
                    answerRegions =
                        regions;

                    updateCounts();
                }
            });


    /*
     * SAVE
     */
    dialog._onSave =
        async (formData) => {

            if (
                !questionRegions.length
            ) {
                throw new Error(
                    "Please select the question area first."
                );
            }


            if (
                !answerRegions.length
            ) {
                throw new Error(
                    "Please select the answer area first."
                );
            }


            const questionNumber =
                Number(
                    formData.question_number
                );


            /*
             * title / prompt
             * 数据库仍要求存在，
             * 但用户无需手动填写。
             */
            const payload = {

                practice_id:
                    state.activePractice.id,

                question_number:
                    questionNumber,

                title:
                    `第${questionNumber}题`,

                question_type:
                    formData.question_type ||
                    "other",

                prompt: "",

                material_scope:
                    null,

                max_characters:
                    null,

                points:
                    null,

                source_file_id:
                    material.id,

                question_regions:
                    questionRegions,

                answer_regions:
                    answerRegions
            };


            const result =
                await upsert(
                    "shenlun_questions",
                    payload
                );


            if (result.error) {
                throw result.error;
            }


            return true;
        };


    updateCounts();


    dialog.showModal();


    setTimeout(
        () =>
            $(
                "#study-field-question_number"
            )?.focus(),
        50
    );
}

    async function importReference(){const input=document.createElement("input");input.type="file";input.accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp";input.onchange=async()=>{const file=input.files[0],question=$("#study-practice-detail")._studyData.shenlun_questions.find(item=>item.id===$("#study-practice-detail").dataset.questionId);if(!file||!question)return;status("Extracting reference…");try{const text=await extractText(file,true);openEditor({title:"Reference Import",kicker:"REVIEW BEFORE CONFIRM",fields:[{name:"body",label:`${String(question.question_number).padStart(2,"0")} ${question.title}`,type:"textarea",value:text,required:true,full:true}],onSave:async data=>{const existing=$("#study-practice-detail")._reference;const result=await upsert("shenlun_references",{practice_id:state.activePractice.id,question_id:question.id,body:data.body,confirmed:true},existing?.id);if(result.error)throw result.error;return true;}});}catch(error){status(error.message,true);}};input.click();}
    
    async function runReview() {
    const detail =
        $("#study-practice-detail");

    const question =
        detail._studyData.shenlun_questions.find(
            item =>
                item.id ===
                detail.dataset.questionId
        );

    if (!question) {
        status(
            "Question unavailable.",
            true
        );
        return;
    }

    const answer =
        await saveShenlun(
            question,
            detail._answer,
            true
        );

    if (!answer) {
        return;
    }

    if (!answer.body?.trim()) {
        status(
            "请先填写答案。",
            true
        );
        return;
    }

    const button =
        $('[data-action="review-shenlun"]');

    if (button) {
        button.disabled = true;
        button.textContent =
            "KIORA IS REVIEWING…";
    }

    status(
        "Kiora is reviewing the answer…"
    );

    const result =
        await auth.requestStudyReview(
            answer.id
        );

    if (result.error) {
        if (button) {
            button.disabled = false;
            button.textContent =
                "SUBMIT FOR KIORA REVIEW";
        }

        status(
            `Review unavailable: ${
                result.error.code ||
                result.error.message
            }.`,
            true
        );

        return;
    }

    const output =
        $("#study-review-output");

    if (output) {
        output.innerHTML =
            reviewMarkup(
                result.data
            );

        output.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }

    detail._answer = answer;

    if (button) {
        button.disabled = false;
        button.textContent =
            "REVIEW AGAIN";
    }

    status(
        `Review complete${
            result.data?.model
                ? ` · ${result.data.model}${
                      result.data?.model_version
                          ? ` · ${result.data.model_version}`
                          : ""
                  }`
                : ""
        }.`
    );
}

    async function addRevision(){const detail=$("#study-practice-detail"),question=detail._studyData.shenlun_questions.find(item=>item.id===detail.dataset.questionId),answer=detail._answer,reviews=await list("reviews",{filters:{question_id:question.id}}),review=(reviews.data||[]).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))[0];if(!review)return;const result=await upsert("revisions",{practice_id:state.activePractice.id,question_id:question.id,answer_id:answer.id,review_id:review.id,title:`${state.activePractice.title} · ${question.title}`,category:question.question_type,issue_tags:[review.assessment?.main_issue].filter(Boolean),source_snapshot:{material_scope:question.material_scope,prompt:question.prompt},status:"pending"});if(result.error)return status(result.error.message,true);state.revisions.unshift(result.data);status("Added to Revision Archive.");}

    async function archiveSelected(form){const detail=$("#study-practice-detail"),data=detail._studyData,selected=Array.from(form.elements.wrong).filter(input=>input.checked).map(input=>Number(input.value));for(const number of selected){const mine=data.aptitude_answers.find(x=>x.question_number===number)?.answer||null,correct=data.answer_keys.find(x=>x.question_number===number)?.correct_answer;if(!correct)continue;const result=await upsert("mistakes",{practice_id:state.activePractice.id,question_number:number,source_type:"practice",subject:state.activePractice.subject||"APTITUDE",paper_file_id:data.files.find(x=>x.file_kind==="paper")?.id||null,my_answer:mine,correct_answer:correct,reason:null,status:"learning",is_public:false});if(!result.error)state.mistakes.unshift(result.data);}$("#study-sheet").close();status(`${selected.length} records added to Mistake Book.`);renderHome();}

    function mistakeData(item, overrides = {}) {
        return {
            practice_id: item.practice_id,
            question_number: item.question_number,
            source_type: item.source_type,
            subject: item.subject,
            knowledge_tag: item.knowledge_tag,
            image_path: item.image_path,
            paper_file_id: item.paper_file_id,
            paper_page: item.paper_page,
            crop_x: item.crop_x,
            crop_y: item.crop_y,
            crop_width: item.crop_width,
            crop_height: item.crop_height,
            question_snapshot: item.question_snapshot,
            my_answer: item.my_answer,
            correct_answer: item.correct_answer,
            reason: item.reason,
            status: item.status,
            is_public: item.is_public,
            ...overrides
        };
    }

    function ensureStudyCropStyles() {
        if ($("#study-crop-runtime-styles")) return;

        const style = document.createElement("style");
        style.id = "study-crop-runtime-styles";
        style.textContent = `
            .study-crop-controls {
                display: flex !important;
                align-items: center !important;
                flex-wrap: wrap !important;
                gap: 12px !important;
                margin-bottom: 20px !important;
            }

            .study-crop-controls label {
                display: flex !important;
                align-items: center !important;
                gap: 8px !important;
                color: var(--study-soft) !important;
                font-size: 8px !important;
                letter-spacing: 1.5px !important;
            }

            .study-crop-controls input {
                width: 70px !important;
                min-height: 40px !important;
                border: 1px solid var(--study-line) !important;
                background: transparent !important;
                color: inherit !important;
                text-align: center !important;
            }

            .study-crop-jumps {
                display: flex !important;
                flex-wrap: wrap !important;
                gap: 8px !important;
            }

            .study-crop-scroll {
                position: relative !important;
                width: 100% !important;
                max-height: 65vh !important;
                overflow: auto !important;
                border: 1px solid var(--study-line) !important;
                background: #fff !important;
                overscroll-behavior: contain !important;
                -webkit-overflow-scrolling: touch !important;
                touch-action: pan-x pan-y !important;
            }

            .study-crop-stage {
                position: relative !important;
                width: 100% !important;
                min-width: 0 !important;
                max-height: none !important;
                overflow: visible !important;
                border: 0 !important;
                background: #fff !important;
                touch-action: pan-x pan-y !important;
                cursor: default !important;
            }

            .study-crop-stage.is-selecting {
                touch-action: none !important;
                cursor: crosshair !important;
                user-select: none !important;
            }

            .study-crop-canvas {
                display: block !important;
                width: 100% !important;
                height: auto !important;
                max-width: 100% !important;
            }

            .study-crop-selection {
                position: absolute !important;
                z-index: 20 !important;
                box-sizing: border-box !important;
                border: 2px solid rgba(139, 93, 134, .95) !important;
                background: rgba(220, 190, 218, .18) !important;
                box-shadow: 0 0 0 9999px rgba(64, 51, 66, .10) !important;
                pointer-events: none !important;
            }

            .study-question-media.has-image {
                min-height: 0 !important;
            }

            .study-question-media.has-image img {
                display: block !important;
                position: static !important;
                width: 100% !important;
                max-width: 100% !important;
                height: auto !important;
                transform: none !important;
                left: auto !important;
                top: auto !important;
                object-fit: contain !important;
            }

            @media (max-width: 900px) {
                .study-crop-scroll {
                    max-height: 62vh !important;
                    touch-action: pan-y !important;
                }

                .study-crop-controls {
                    align-items: stretch !important;
                }

                .study-crop-controls button {
                    min-height: 44px !important;
                }
            }
        `;

        document.head.append(style);
    }

    async function openCropEditor(item) {
        ensureStudyCropStyles();

        const fileResult = await getEntity("files", item.paper_file_id);
        const file = fileResult.data;
        if (!file) return status("Source paper is unavailable.", true);

        const url = await getSignedUrl(file.storage_path);
        if (!url) return status("Source paper could not be opened.", true);

        openSheet(`
            <header>
                <div>
                    <p class="study-kicker">QUESTION CROP</p>
                    <h2>Select Question Area</h2>
                </div>
                <button class="study-dialog-close" data-close-sheet type="button">×</button>
            </header>

            <div class="study-sheet-content">
                <div class="study-crop-controls">
                    <label>
                        PAGE
                        <input
                            id="study-crop-page"
                            type="number"
                            min="1"
                            value="${item.paper_page || 1}"
                        >
                    </label>

                    <button class="study-secondary" id="study-crop-load" type="button">
                        LOAD PAGE
                    </button>

                    <div class="study-crop-jumps">
                        <button class="study-secondary" data-crop-jump="top" type="button">TOP</button>
                        <button class="study-secondary" data-crop-jump="middle" type="button">MIDDLE</button>
                        <button class="study-secondary" data-crop-jump="bottom" type="button">BOTTOM</button>
                    </div>

                    <button class="study-secondary" id="study-crop-select" type="button">
                        SELECT AREA
                    </button>

                    <button class="study-primary" id="study-crop-save" type="button" disabled>
                        SAVE AREA
                    </button>
                </div>

                <p id="study-crop-hint">
                    Scroll to the question, press SELECT AREA, then drag. You can keep scrolling while selecting.
                </p>

                <div id="study-crop-scroll" class="study-crop-scroll">
                    <div id="study-crop-stage" class="study-crop-stage"></div>
                </div>
            </div>
        `);

        const sheet = $("#study-sheet");
        const scroll = $("#study-crop-scroll");
        const stage = $("#study-crop-stage");
        const pageInput = $("#study-crop-page");
        const selectButton = $("#study-crop-select");
        const saveButton = $("#study-crop-save");
        const hint = $("#study-crop-hint");

        let controller = null;
        let pdf = null;

        const clearCropCache = () => {
            const prefix = `crop:${item.paper_file_id}:`;
            for (const key of Array.from(state.signedUrls.keys())) {
                if (key.startsWith(prefix)) {
                    state.signedUrls.delete(key);
                }
            }
        };

        const renderPage = async () => {
            controller?.destroy();
            controller = null;

            stage.replaceChildren();
            stage._selection = null;
            saveButton.disabled = true;
            selectButton.textContent = "SELECT AREA";
            selectButton.classList.remove("active");
            stage.classList.remove("is-selecting");

            hint.textContent =
                "Scroll to the question, press SELECT AREA, then drag. While dragging, use the mouse wheel or move near the top/bottom edge to keep scrolling.";

            scroll.scrollTop = 0;
            scroll.scrollLeft = 0;

            let canvas;

            if (file.mime_type === "application/pdf") {
                await loadScript(
                    "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs",
                    "pdfjsLib",
                    true
                );

                if (!pdf) {
                    pdf = await window.pdfjsLib.getDocument(url).promise;
                }

                const pageNumber = Math.min(
                    Math.max(Number(pageInput.value) || 1, 1),
                    pdf.numPages
                );
                pageInput.value = pageNumber;

                const page = await pdf.getPage(pageNumber);
                const viewport = page.getViewport({ scale: 2 });

                canvas = document.createElement("canvas");
                canvas.width = Math.ceil(viewport.width);
                canvas.height = Math.ceil(viewport.height);

                await page.render({
                    canvasContext: canvas.getContext("2d"),
                    viewport
                }).promise;
            } else if (file.mime_type.startsWith("image/")) {
                const image = document.createElement("img");
                image.crossOrigin = "anonymous";
                image.src = url;
                await image.decode();

                canvas = document.createElement("canvas");
                canvas.width = image.naturalWidth;
                canvas.height = image.naturalHeight;
                canvas.getContext("2d").drawImage(image, 0, 0);
            } else {
                stage.innerHTML = `
                    <p class="study-empty study-error">This source cannot be cropped.</p>
                `;
                return;
            }

            canvas.className = "study-crop-canvas";
            stage.append(canvas);

            await new Promise((resolve) => requestAnimationFrame(resolve));

            controller = installCropSelection({
                stage,
                source: canvas,
                scroll,

                onSelectionChange(selection) {
                    saveButton.disabled =
                        !selection ||
                        selection.crop_width < 0.003 ||
                        selection.crop_height < 0.003;
                },

                onModeChange(selecting) {
                    stage.classList.toggle("is-selecting", selecting);
                    selectButton.classList.toggle("active", selecting);

                    selectButton.textContent = selecting
                        ? "CANCEL SELECT"
                        : stage._selection
                            ? "RESELECT"
                            : "SELECT AREA";

                    hint.textContent = selecting
                        ? "Selecting… keep holding. Use the mouse wheel, or drag near the top/bottom edge to continue scrolling."
                        : stage._selection
                            ? "Area selected. Check it, then SAVE AREA or RESELECT."
                            : "Scroll to the question, then press SELECT AREA.";
                }
            });
        };

        $("#study-crop-load").onclick = renderPage;

        $$("[data-crop-jump]", sheet).forEach((button) => {
            button.onclick = () => {
                const max = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
                const target = button.dataset.cropJump === "middle"
                    ? max / 2
                    : button.dataset.cropJump === "bottom"
                        ? max
                        : 0;

                scroll.scrollTo({
                    top: target,
                    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
                });
            };
        });

        selectButton.onclick = () => {
            if (!controller) return;

            if (controller.isSelecting()) {
                controller.cancel();
            } else {
                controller.start();
            }
        };

        saveButton.onclick = async () => {
            const selection = stage._selection;
            if (!selection) return;

            const result = await upsert(
                "mistakes",
                mistakeData(item, {
                    paper_page: Number(pageInput.value) || 1,
                    crop_x: selection.crop_x,
                    crop_y: selection.crop_y,
                    crop_width: selection.crop_width,
                    crop_height: selection.crop_height
                }),
                item.id
            );

            if (result.error) {
                return status(result.error.message, true);
            }

            clearCropCache();
            Object.assign(item, result.data);

            controller?.destroy();
            controller = null;
            $("#study-sheet").close();
            renderMistakes();
        };

        sheet.addEventListener(
            "close",
            () => {
                controller?.destroy();
                controller = null;
            },
            { once: true }
        );

        await renderPage();
    }

    function installCropSelection({
        stage,
        source,
        scroll,
        onSelectionChange,
        onModeChange
    }) {
        let selecting = false;
        let dragging = false;
        let pointerId = null;

        let startContentX = 0;
        let startContentY = 0;
        let box = null;

        let lastClientX = 0;
        let lastClientY = 0;
        let autoScrollFrame = 0;

        const EDGE_SIZE = 72;
        const MAX_SCROLL_SPEED = 24;

        const clamp = (value, min, max) =>
            Math.min(Math.max(value, min), max);

        const contentPoint = (clientX, clientY) => {
            const rect = source.getBoundingClientRect();

            return {
                x: clamp(clientX - rect.left, 0, rect.width),
                y: clamp(clientY - rect.top, 0, rect.height),
                width: rect.width,
                height: rect.height
            };
        };

        const removeBox = () => {
            stage.querySelector(".study-crop-selection")?.remove();
            box = null;
        };

        const makeBox = () => {
            removeBox();
            box = document.createElement("i");
            box.className = "study-crop-selection";
            stage.append(box);
        };

        const updateSelection = () => {
            if (!dragging || !box) return;

            const end = contentPoint(lastClientX, lastClientY);
            const rect = source.getBoundingClientRect();
            if (!rect.width || !rect.height) return;

            const left = Math.min(startContentX, end.x);
            const top = Math.min(startContentY, end.y);
            const width = Math.abs(end.x - startContentX);
            const height = Math.abs(end.y - startContentY);

            const cropX = clamp(left / rect.width, 0, 1);
            const cropY = clamp(top / rect.height, 0, 1);
            const cropWidth = clamp(width / rect.width, 0, 1 - cropX);
            const cropHeight = clamp(height / rect.height, 0, 1 - cropY);

            Object.assign(box.style, {
                left: `${cropX * 100}%`,
                top: `${cropY * 100}%`,
                width: `${cropWidth * 100}%`,
                height: `${cropHeight * 100}%`
            });

            stage._selection = {
                crop_x: cropX,
                crop_y: cropY,
                crop_width: cropWidth,
                crop_height: cropHeight
            };

            onSelectionChange?.(stage._selection);
        };

        const stopAutoScroll = () => {
            if (autoScrollFrame) {
                cancelAnimationFrame(autoScrollFrame);
                autoScrollFrame = 0;
            }
        };

        const autoScrollLoop = () => {
            if (!selecting || !dragging) {
                autoScrollFrame = 0;
                return;
            }

            const rect = scroll.getBoundingClientRect();
            let speed = 0;

            if (lastClientY < rect.top + EDGE_SIZE) {
                const strength = clamp(
                    (rect.top + EDGE_SIZE - lastClientY) / EDGE_SIZE,
                    0,
                    1
                );
                speed = -MAX_SCROLL_SPEED * strength;
            } else if (lastClientY > rect.bottom - EDGE_SIZE) {
                const strength = clamp(
                    (lastClientY - (rect.bottom - EDGE_SIZE)) / EDGE_SIZE,
                    0,
                    1
                );
                speed = MAX_SCROLL_SPEED * strength;
            }

            if (speed !== 0) {
                const before = scroll.scrollTop;
                scroll.scrollTop += speed;

                if (scroll.scrollTop !== before) {
                    updateSelection();
                }
            }

            autoScrollFrame = requestAnimationFrame(autoScrollLoop);
        };

        const startAutoScroll = () => {
            if (!autoScrollFrame) {
                autoScrollFrame = requestAnimationFrame(autoScrollLoop);
            }
        };

        const releasePointer = () => {
            if (
                pointerId !== null &&
                stage.hasPointerCapture?.(pointerId)
            ) {
                try {
                    stage.releasePointerCapture(pointerId);
                } catch (_) {}
            }
            pointerId = null;
        };

        const finishSelection = () => {
            if (!dragging) return;

            updateSelection();
            dragging = false;
            stopAutoScroll();
            releasePointer();
            selecting = false;
            onModeChange?.(false);
        };

        const pointerDown = (event) => {
            if (!selecting) return;
            if (event.pointerType === "mouse" && event.button !== 0) return;

            event.preventDefault();

            lastClientX = event.clientX;
            lastClientY = event.clientY;

            const point = contentPoint(lastClientX, lastClientY);
            startContentX = point.x;
            startContentY = point.y;

            dragging = true;
            pointerId = event.pointerId;
            stage._selection = null;
            onSelectionChange?.(null);

            makeBox();
            Object.assign(box.style, {
                left: `${(point.x / point.width) * 100}%`,
                top: `${(point.y / point.height) * 100}%`,
                width: "0%",
                height: "0%"
            });

            try {
                stage.setPointerCapture?.(event.pointerId);
            } catch (_) {}

            startAutoScroll();
        };

        const pointerMove = (event) => {
            if (!selecting || !dragging) return;

            event.preventDefault();
            lastClientX = event.clientX;
            lastClientY = event.clientY;
            updateSelection();
        };

        const pointerUp = (event) => {
            if (!selecting || !dragging) return;

            event.preventDefault();
            lastClientX = event.clientX;
            lastClientY = event.clientY;
            finishSelection();
        };

        const pointerCancel = () => {
            dragging = false;
            stopAutoScroll();
            releasePointer();
            selecting = false;
            onModeChange?.(false);
        };

        const scrollWhileSelecting = () => {
            if (dragging) {
                updateSelection();
            }
        };

        stage.addEventListener("pointerdown", pointerDown);
        stage.addEventListener("pointermove", pointerMove);
        stage.addEventListener("pointerup", pointerUp);
        stage.addEventListener("pointercancel", pointerCancel);
        scroll.addEventListener("scroll", scrollWhileSelecting, { passive: true });

        return {
            start() {
                selecting = true;
                dragging = false;
                stage._selection = null;
                onSelectionChange?.(null);
                removeBox();
                onModeChange?.(true);
            },

            cancel() {
                selecting = false;
                dragging = false;
                stopAutoScroll();
                releasePointer();
                removeBox();
                stage._selection = null;
                onSelectionChange?.(null);
                onModeChange?.(false);
            },

            isSelecting() {
                return selecting;
            },

            destroy() {
                stopAutoScroll();
                releasePointer();
                stage.removeEventListener("pointerdown", pointerDown);
                stage.removeEventListener("pointermove", pointerMove);
                stage.removeEventListener("pointerup", pointerUp);
                stage.removeEventListener("pointercancel", pointerCancel);
                scroll.removeEventListener("scroll", scrollWhileSelecting);
            }
        };
    }

    async function submitRevisit(){const item=filteredMistakes()[state.currentMistake],answer=$("[data-revisit-answer].active")?.dataset.revisitAnswer;if(!answer)return;const isCorrect=answer.toUpperCase()===item.correct_answer.toUpperCase();const result=await upsert("mistake_attempts",{mistake_id:item.id,answer,is_correct:isCorrect,attempted_at:new Date().toISOString()});if(result.error)return status(result.error.message,true);await upsert("mistakes",mistakeData(item,{status:isCorrect?"review":"learning"}),item.id);item.status=isCorrect?"review":"learning";const attempts=await list("mistake_attempts",{filters:{mistake_id:item.id}});openSheet(`<header><div><p class="study-kicker">REVISIT RESULT</p><h2>${isCorrect?"✓ CORRECT":"× NEEDS REVIEW"}</h2></div><button class="study-dialog-close" data-close-sheet>×</button></header><div class="study-sheet-content"><div class="study-answer-reveal"><div><span>CURRENT</span><strong>${esc(answer)} ${isCorrect?"✓":"×"}</strong></div><div><span>LAST TIME</span><strong>${esc(item.my_answer||"—")}</strong></div></div><p class="study-kicker">ATTEMPTS</p>${(attempts.data||[]).map(attempt=>`<p>${displayDate(attempt.attempted_at)}　${esc(attempt.answer)} ${attempt.is_correct?"✓":"×"}</p>`).join("")}</div>`);}

    async function rewriteRevision(id){const revision=state.revisions.find(item=>item.id===id);if(!revision?.question_id)return;const questions=await list("shenlun_questions",{filters:{practice_id:revision.practice_id}}),question=(questions.data||[]).find(item=>item.id===revision.question_id),answers=await list("shenlun_answers",{filters:{question_id:revision.question_id}}),attempt=Math.max(0,...(answers.data||[]).map(item=>item.attempt_number))+1;openEditor({title:"Rewrite",kicker:"MATERIAL + QUESTION ONLY",fields:[{name:"prompt",label:"QUESTION",type:"textarea",value:question?.prompt||revision.source_snapshot?.prompt||"",full:true},{name:"body",label:"YOUR NEW ANSWER",type:"textarea",required:true,full:true}],onSave:async data=>{const result=await upsert("shenlun_answers",{practice_id:revision.practice_id,question_id:revision.question_id,attempt_number:attempt,body:data.body,outline:[],submitted_at:new Date().toISOString()});if(result.error)throw result.error;const review=await auth.requestStudyReview(result.data.id);const nextStatus=review.error?"rewriting":"completed";await upsert("revisions",{practice_id:revision.practice_id,question_id:revision.question_id,answer_id:revision.answer_id,review_id:revision.review_id,title:revision.title,category:revision.category,issue_tags:revision.issue_tags,source_snapshot:revision.source_snapshot,status:nextStatus},revision.id);revision.status=nextStatus;if(review.error)status("Rewrite saved. Review unavailable; retry from the Shenlun record.",true);return true;}});}

    $("#study-editor-form").addEventListener("submit",async event=>{event.preventDefault();const form=event.currentTarget,data=Object.fromEntries(new FormData(form).entries());$("#study-editor-save").disabled=true;$("#study-editor-message").textContent="Saving…";try{const done=await $("#study-editor")._onSave(data,form);if(done){$("#study-editor").close();await loadBase();if(state.activePractice)openPractice(state.activePractice.id);}}catch(error){$("#study-editor-message").textContent=error.message||"Save failed.";}finally{$("#study-editor-save").disabled=false;}});
    $$(".study-dialog-close",$("#study-editor")).forEach(button=>button.addEventListener("click",()=>$("#study-editor").close()));

    document.addEventListener("click",async event=>{
        const activityLink=event.target.closest("[data-activity-entity]");if(activityLink){event.preventDefault();const view=entityView(activityLink.dataset.activityEntity);setView(view);if(view==="practice"&&activityLink.dataset.activityId)openPractice(activityLink.dataset.activityId);return;}
        const viewButton=event.target.closest("[data-study-view],[data-open-view]");if(viewButton){setView(viewButton.dataset.studyView||viewButton.dataset.openView);return;}
        const day=event.target.closest("[data-calendar-day]");if(day){state.selectedDay=new Date(state.calendarDate.getFullYear(),state.calendarDate.getMonth(),Number(day.dataset.calendarDay));setView("calendar");renderCalendar();return;}
        const calendarDay=event.target.closest(".study-calendar-day");if(calendarDay){state.selectedDay=new Date(`${calendarDay.dataset.date}T12:00:00`);renderCalendar();return;}
        const practice=event.target.closest("[data-practice-id]");if(practice){openPractice(practice.dataset.practiceId);return;}
        const filter=event.target.closest("[data-practice-filter]");if(filter){state.practiceFilter=filter.dataset.practiceFilter;$$('[data-practice-filter]').forEach(x=>x.classList.toggle("active",x===filter));renderPractices();return;}
        const subject=event.target.closest("[data-mistake-subject]");if(subject){state.mistakeSubject=subject.dataset.mistakeSubject;renderMistakes();return;}
        const mistakeStatus=event.target.closest("[data-mistake-status]");if(mistakeStatus){state.mistakeStatus=mistakeStatus.dataset.mistakeStatus;$$('[data-mistake-status]').forEach(x=>x.classList.toggle("active",x===mistakeStatus));renderMistakes();return;}
        const mode=event.target.closest("[data-mistake-mode]");if(mode){state.mistakeMode=mode.dataset.mistakeMode;$$('[data-mistake-mode]').forEach(x=>x.classList.toggle("active",x===mode));renderMistakes();return;}
        const row=event.target.closest(".study-mistake-index tr[data-id]");if(row){state.currentMistake=filteredMistakes().findIndex(x=>x.id===row.dataset.id);state.mistakeMode="card";renderMistakes();return;}
        const cardNav=event.target.closest("[data-card-nav]");if(cardNav){const items=filteredMistakes();state.currentMistake=(state.currentMistake+(cardNav.dataset.cardNav==="next"?1:-1)+items.length)%items.length;renderMistakeCard(items[state.currentMistake],items);return;}
        const answer=event.target.closest("[data-answer]");if(answer){await saveAptitudeAnswer(answer.dataset.answer,{advance:!answer.closest(".study-mobile-dock")});return;}
        const answerNav=event.target.closest("[data-answer-nav]");if(answerNav){const detail=$("#study-practice-detail"),total=state.activePractice.total_questions||1,current=Number(detail.dataset.question);detail.dataset.question=Math.min(Math.max(current+(answerNav.dataset.answerNav==="next"?1:-1),1),total);updateAptitudeControls();return;}
        const sheetQuestion=event.target.closest("[data-sheet-question]");if(sheetQuestion){$("#study-practice-detail").dataset.question=sheetQuestion.dataset.sheetQuestion;$("#study-sheet").close();updateAptitudeControls();return;}
        const question=event.target.closest("[data-shenlun-question]");if(question){$("#study-practice-detail").dataset.questionId=question.dataset.shenlunQuestion;renderShenlun(state.activePractice,$("#study-practice-detail")._studyData);return;}
        const revisit=event.target.closest("[data-revisit-answer]");if(revisit){$$('[data-revisit-answer]').forEach(x=>x.classList.toggle("active",x===revisit));$("[data-action=submit-revisit]").disabled=false;return;}
        const reasonPreset=event.target.closest("[data-reason-preset]");if(reasonPreset){const editor=reasonPreset.closest("[data-mistake-reason-editor]"),input=$("[data-mistake-reason-input]",editor);if(input){input.value=reasonPreset.dataset.reasonPreset;input.focus();}return;}
        const revision=event.target.closest("[data-revision-id]");if(revision){openRevision(revision.dataset.revisionId);return;}
        const noteFilter=event.target.closest("[data-note-subject]");if(noteFilter){$$('[data-note-subject]').forEach(x=>x.classList.toggle("active",x===noteFilter));renderNoteList(noteFilter.dataset.noteSubject);return;}
        const editNote=event.target.closest("[data-edit-note]");if(editNote){noteEditor(state.notes.find(x=>x.id===editNote.dataset.editNote));return;}
        const close=event.target.closest("[data-close-sheet]");if(close){$("#study-sheet").close();return;}
        const action=event.target.closest("[data-action]")?.dataset.action;if(!action)return;
        if(action==="new-practice")newPractice();if(action==="new-note")noteEditor();if(action==="quick-mistake")quickMistake();
        if(action==="close-practice")closePractice();if(action==="close-revision")closeRevision();
        if(action==="upload-paper")attachPaper();if(action==="import-key")importAnswerKey();if(action==="finish-practice")finishPractice();if(action==="open-answer-sheet")showAnswerSheet();
        if(action==="clear-answer")saveAptitudeAnswer(null);if(action==="toggle-flag"){const detail=$("#study-practice-detail"),item=detail._studyData.aptitude_answers.find(x=>x.question_number===Number(detail.dataset.question));saveAptitudeAnswer(undefined,{flagged:!item?.flagged});}
        if(action==="add-shenlun-question")addShenlunQuestion();if(action==="save-shenlun-answer"){const detail=$("#study-practice-detail"),q=detail._studyData.shenlun_questions.find(x=>x.id===detail.dataset.questionId);saveShenlun(q,detail._answer);}
        if(action==="import-reference")importReference();if(action==="review-shenlun")runReview();if(action==="add-revision")addRevision();
        if(action==="start-revisit")renderMistakeCard(filteredMistakes()[state.currentMistake],filteredMistakes(),true);if(action==="submit-revisit")submitRevisit();if(action==="crop-mistake")openCropEditor(filteredMistakes()[state.currentMistake]);
        if(action==="save-mistake-reason")await saveMistakeReason(event.target.closest("[data-id]"));
        if(action==="master-mistake"){const item=filteredMistakes()[state.currentMistake];const result=await upsert("mistakes",{...Object.fromEntries(Object.entries(item).filter(([key])=>!["id","owner_id","created_at","updated_at"].includes(key))),status:"mastered"},item.id);if(!result.error){Object.assign(item,result.data);renderMistakes();}}
        if(action==="delete-mistake"){const item=filteredMistakes()[state.currentMistake];if(confirm("Delete this mistake record?")){const result=await remove("mistakes",item.id);if(!result.error){state.mistakes=state.mistakes.filter(x=>x.id!==item.id);renderMistakes();}}}
        if(action==="rewrite-revision")rewriteRevision(event.target.closest("[data-id]").dataset.id);
    });
    $("#study-calendar-prev").addEventListener("click",()=>{state.calendarDate=new Date(state.calendarDate.getFullYear(),state.calendarDate.getMonth()-1,1);renderCalendar();});
    $("#study-calendar-next").addEventListener("click",()=>{state.calendarDate=new Date(state.calendarDate.getFullYear(),state.calendarDate.getMonth()+1,1);renderCalendar();});
    $("#study-calendar-today").addEventListener("click",()=>{state.calendarDate=new Date();state.selectedDay=new Date();renderCalendar();});
    $("#study-sheet").addEventListener("submit",event=>{if(event.target.id==="answer-key-review-form"){event.preventDefault();confirmAnswerKey(event.target);}if(event.target.id==="archive-wrong-form"){event.preventDefault();archiveSelected(event.target);}});
    $("#study-practice-detail").addEventListener("change",async event=>{if(event.target.matches("[data-auto-advance]")){const p=state.activePractice;const result=await upsert("practices",{practice_type:p.practice_type,title:p.title,practice_date:p.practice_date,source:p.source,subject:p.subject,note:p.note,status:p.status,total_questions:p.total_questions,auto_advance:event.target.checked,is_public:p.is_public},p.id);if(!result.error)Object.assign(p,result.data);}});
    $("#study-note-list").addEventListener("click",async event=>{const button=event.target.closest("[data-delete-note]");if(button&&confirm("Delete this note?")){const result=await remove("notes",button.dataset.deleteNote);if(!result.error){state.notes=state.notes.filter(x=>x.id!==button.dataset.deleteNote);renderNotes();}}});

    await auth.initialize(db); state.writable=auth.can("study:write");
    if(!state.writable) $$('[data-action="new-practice"],[data-action="quick-mistake"],[data-action="new-note"]').forEach(button=>button.remove());
    const initial=location.hash.slice(1);if($( `#study-view-${initial}`))state.view=initial;
    await loadBase();setView(state.view,false);
})();
