(async function () {
    "use strict";

    const common = window.yuriArticles;
    const db = common.getClient();
    const auth = window.KioraAuth;
    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
    const esc = (value) => common.escapeHtml(String(value ?? ""));
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
        signedUrls: new Map()
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

    async function openPractice(id) {
        const practice = state.practices.find((item) => item.id === id); if (!practice) return;
        state.activePractice = practice; status("Opening practice…");
        const entities = practice.practice_type === "aptitude" ? ["files","aptitude_answers","answer_keys"] : ["files","shenlun_questions"];
        const results = await Promise.all(entities.map((entity) => list(entity, { filters:{ practice_id:id }, limit:500 })));
        if (results.some((result) => result.error)) { status("Could not open this practice.", true); return; }
        status(""); const detail = $("#study-practice-detail"); detail.hidden = false;
        const data = Object.fromEntries(entities.map((entity,index)=>[entity,results[index].data||[]]));
        if (practice.practice_type === "aptitude") await renderAptitude(practice, data); else await renderShenlun(practice, data);
        detail.scrollIntoView({ behavior:"smooth", block:"start" });
    }

    async function paperMarkup(files) {
        const paper = files.find((file) => ["paper","material"].includes(file.file_kind));
        if (!paper) return `<div class="study-empty">No paper uploaded yet.</div>`;
        const url = await getSignedUrl(paper.storage_path); if (!url) return `<div class="study-empty study-error">Paper unavailable.</div>`;
        if (paper.mime_type === "application/pdf") return `<div class="study-pdf-document" data-pdf-url="${esc(url)}"><p class="study-pdf-loading" role="status">Loading PDF…</p></div>`;
        return paper.mime_type.startsWith("image/") ? `<img src="${esc(url)}" alt="Practice paper">` : `<iframe src="${esc(url)}#toolbar=1" title="Practice paper"></iframe>`;
    }

    async function renderPdfDocuments(root) {
        const documents = $$(".study-pdf-document[data-pdf-url]", root);
        if (!documents.length) return;
        try {
            await loadScript("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs", "pdfjsLib", true);
            for (const container of documents) {
                const pdf = await window.pdfjsLib.getDocument(container.dataset.pdfUrl).promise;
                container.replaceChildren();
                for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
                    const page = await pdf.getPage(pageNumber);
                    const base = page.getViewport({ scale: 1 });
                    const available = Math.max(container.clientWidth || base.width, 320);
                    const viewport = page.getViewport({ scale: Math.min(2, available / base.width) });
                    const figure = document.createElement("figure");
                    const canvas = document.createElement("canvas");
                    const caption = document.createElement("figcaption");
                    canvas.width = Math.ceil(viewport.width);
                    canvas.height = Math.ceil(viewport.height);
                    caption.textContent = `PAGE ${String(pageNumber).padStart(2, "0")} / ${String(pdf.numPages).padStart(2, "0")}`;
                    figure.append(canvas, caption);
                    container.append(figure);
                    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
                }
            }
        } catch (error) {
            documents.forEach((container) => { container.innerHTML = `<p class="study-empty study-error">PDF could not be loaded. ${esc(error.message || "")}</p>`; });
        }
    }

    async function renderAptitude(practice, data) {
        const detail = $("#study-practice-detail"); const total = practice.total_questions || Math.max(data.answer_keys.length, 1);
        const current = Math.min(Number(detail.dataset.question || 1), total); detail.dataset.question = current;
        const answers = new Map(data.aptitude_answers.map((item)=>[item.question_number,item])); const answer = answers.get(current);
        detail._studyData = data;
        const writable = state.writable;
        detail.innerHTML = `<div class="study-detail-toolbar"><div><p class="study-kicker">APTITUDE / ${esc(practice.status.toUpperCase())}</p><h3>${esc(practice.title)}</h3></div><div class="study-action-row">${writable ? '<button class="study-secondary" data-action="upload-paper">UPLOAD PAPER</button><button class="study-secondary" data-action="import-key">IMPORT ANSWER KEY</button><button class="study-primary" data-action="finish-practice">RESULT</button>' : ""}<button class="study-secondary" data-action="close-practice">CLOSE</button></div></div><div class="study-paper-workspace"><div class="study-paper-reader">${await paperMarkup(data.files)}</div><aside class="study-answer-panel">${answerPanel(current,total,answer,writable)}</aside></div>${writable ? `<div class="study-mobile-dock"><button data-answer-nav="prev" aria-label="上一题">‹</button><div class="study-mobile-answer-center"><span class="study-current-question">第 ${current} 题</span><div class="study-answer-options">${["A","B","C","D"].map(option=>`<button data-answer="${option}" class="${answer?.answer===option?"active":""}>${option}</button>`).join("")}</div></div><button data-answer-nav="next" aria-label="下一题">›</button></div>`:""}`;
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
        const mobile = $(".study-mobile-answer-center", detail);
        if (mobile) mobile.innerHTML = `<span class="study-current-question">第 ${current} 题</span><div class="study-answer-options">${["A","B","C","D"].map((option) => `<button data-answer="${option}" class="${answer?.answer === option ? "active" : ""}">${option}</button>`).join("")}</div>`;
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

    async function renderShenlun(practice,data) {
        const detail=$("#study-practice-detail"); detail._studyData=data; const questions=data.shenlun_questions.sort((a,b)=>a.question_number-b.question_number); const active=questions.find(item=>item.id===detail.dataset.questionId)||questions[0]; if(active) detail.dataset.questionId=active.id;
        let answer=null,reference=null,reviews=[]; if(active){ const results=await Promise.all([list("shenlun_answers",{filters:{question_id:active.id}}),list("shenlun_references",{filters:{question_id:active.id}}),list("reviews",{filters:{question_id:active.id}})]); answer=(results[0].data||[]).sort((a,b)=>b.attempt_number-a.attempt_number)[0]||null;reference=(results[1].data||[])[0]||null;reviews=results[2].data||[]; }
        detail._answer=answer;detail._reference=reference;
        detail.innerHTML=`<div class="study-detail-toolbar"><div><p class="study-kicker">SHENLUN / ${esc(practice.status.toUpperCase())}</p><h3>${esc(practice.title)}</h3></div><div class="study-action-row">${state.writable?'<button class="study-secondary" data-action="upload-paper">UPLOAD MATERIAL</button><button class="study-secondary" data-action="add-shenlun-question">＋ QUESTION</button>':""}<button class="study-secondary" data-action="close-practice">CLOSE</button></div></div><div class="study-filter-row">${questions.map(q=>`<button data-shenlun-question="${q.id}" class="${active?.id===q.id?"active":""}">${String(q.question_number).padStart(2,"0")} ${esc(q.title)}</button>`).join("")}</div>${active?`<div class="study-shenlun-layout"><section class="study-material"><p class="study-kicker">MATERIAL / QUESTION</p><h4>${esc(active.title)}</h4><p>${esc(active.prompt)}</p><div class="study-paper-reader">${await paperMarkup(data.files)}</div></section><section class="study-answer-editor"><p class="study-kicker">YOUR ANSWER</p>${active.question_type==="essay"?`<input id="shenlun-answer-title" value="${esc(answer?.title||"")}" placeholder="TITLE"><input id="shenlun-answer-thesis" value="${esc(answer?.thesis||"")}" placeholder="THESIS / 中心论点"><textarea id="shenlun-answer-outline" placeholder="OUTLINE — one point per line">${esc((answer?.outline||[]).join("\n"))}</textarea>`:""}<textarea id="shenlun-answer-body" ${state.writable?"":"readonly"} placeholder="Write here…">${esc(answer?.body||"")}</textarea><p id="shenlun-count" class="study-character-count">${(answer?.body||"").length} / ${active.max_characters||"∞"}</p>${state.writable?`<div class="study-action-row"><button class="study-secondary" data-action="save-shenlun-answer">SAVE DRAFT</button><button class="study-secondary" data-action="import-reference">IMPORT REFERENCE</button><button class="study-primary" data-action="review-shenlun">SUBMIT FOR KIORA REVIEW</button></div>`:""}</section></div><div id="study-review-output">${reviews.length?reviewMarkup(reviews.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))[0]):""}</div>`:empty("Add the first question to begin.")}`;
        installShenlunAutosave(active,answer);
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

    /*
     * crop 也加入缓存 key。
     * 否则重新框选以后可能仍然看到旧图片。
     */
    const cropKey = [
        item.crop_x,
        item.crop_y,
        item.crop_width,
        item.crop_height
    ].join(":");

    const cacheKey =
        `paper:${item.paper_file_id}:${item.paper_page}:${cropKey}`;

    if (state.signedUrls.has(cacheKey)) {
        return state.signedUrls.get(cacheKey);
    }

    const record =
        await getEntity("files", item.paper_file_id);

    const file = record.data;

    if (!file) {
        return "";
    }

    const url =
        await getSignedUrl(file.storage_path);

    if (!url) {
        return "";
    }

    /*
     * 普通图片暂时保持原逻辑。
     */
    if (file.mime_type.startsWith("image/")) {
        state.signedUrls.set(cacheKey, url);
        return url;
    }

    if (file.mime_type !== "application/pdf") {
        return "";
    }

    await loadScript(
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs",
        "pdfjsLib",
        true
    );

    const pdf =
        await window.pdfjsLib
            .getDocument(url)
            .promise;

    const pageNumber =
        Math.min(
            Math.max(
                Number(item.paper_page) || 1,
                1
            ),
            pdf.numPages
        );

    const page =
        await pdf.getPage(pageNumber);

    /*
     * 先渲染完整 PDF 页面。
     */
    const viewport =
        page.getViewport({
            scale: 2
        });

    const fullCanvas =
        document.createElement("canvas");

    fullCanvas.width =
        Math.ceil(viewport.width);

    fullCanvas.height =
        Math.ceil(viewport.height);

    await page.render({
        canvasContext:
            fullCanvas.getContext("2d"),
        viewport
    }).promise;

    /*
     * 没有框选数据：
     * 继续返回整页。
     */
    const hasCrop =
        [
            item.crop_x,
            item.crop_y,
            item.crop_width,
            item.crop_height
        ].every(value =>
            value !== null &&
            value !== undefined &&
            Number.isFinite(Number(value))
        );

    if (!hasCrop) {
        const image =
            fullCanvas.toDataURL(
                "image/jpeg",
                0.9
            );

        state.signedUrls.set(
            cacheKey,
            image
        );

        return image;
    }

    /*
     * 归一化坐标 → canvas 实际像素。
     */
    const x =
        Math.max(
            0,
            Math.round(
                Number(item.crop_x) *
                fullCanvas.width
            )
        );

    const y =
        Math.max(
            0,
            Math.round(
                Number(item.crop_y) *
                fullCanvas.height
            )
        );

    const width =
        Math.max(
            1,
            Math.round(
                Number(item.crop_width) *
                fullCanvas.width
            )
        );

    const height =
        Math.max(
            1,
            Math.round(
                Number(item.crop_height) *
                fullCanvas.height
            )
        );

    /*
     * 防止裁剪范围超出页面。
     */
    const safeWidth =
        Math.min(
            width,
            fullCanvas.width - x
        );

    const safeHeight =
        Math.min(
            height,
            fullCanvas.height - y
        );

    /*
     * 创建真正只有选中区域的新 canvas。
     */
    const cropCanvas =
        document.createElement("canvas");

    cropCanvas.width =
        safeWidth;

    cropCanvas.height =
        safeHeight;

    const context =
        cropCanvas.getContext("2d");

    context.drawImage(
        fullCanvas,

        // 原图区域
        x,
        y,
        safeWidth,
        safeHeight,

        // 新 canvas
        0,
        0,
        safeWidth,
        safeHeight
    );

    const image =
        cropCanvas.toDataURL(
            "image/jpeg",
            0.92
        );

    state.signedUrls.set(
        cacheKey,
        image
    );

    return image;
}
    function renderMistakes(){const subjects=[...new Set(state.mistakes.map(item=>item.subject))];$("#study-mistake-subjects").innerHTML=["all",...subjects].map(subject=>`<button data-mistake-subject="${esc(subject)}" class="${state.mistakeSubject===subject?"active":""}">${esc(subject==="all"?"ALL SUBJECTS":subject)}</button>`).join("");const items=filteredMistakes(),container=$("#study-mistake-content");if(!items.length){container.innerHTML=empty("No mistakes archived yet.",state.writable?'<button class="study-text-button" data-action="quick-mistake">＋ QUICK MISTAKE</button>':"");return;}state.currentMistake=Math.min(state.currentMistake,items.length-1);if(state.mistakeMode==="index")container.innerHTML=`<table class="study-mistake-index"><thead><tr><th>NO.</th><th>KNOWLEDGE</th><th>DATE</th><th>STATUS</th></tr></thead><tbody>${items.map((item,index)=>`<tr data-id="${item.id}"><td>${String(index+1).padStart(3,"0")}</td><td>${esc(item.knowledge_tag||item.subject)}</td><td>${displayDate(item.created_at)}</td><td>${esc(item.status.toUpperCase())}</td></tr>`).join("")}</tbody></table>`;else renderMistakeCard(items[state.currentMistake],items);}

    async function renderMistakeCard(item,items=filteredMistakes(),revisit=false){const container=$("#study-mistake-content"),image=await mistakeMediaUrl(item);container.innerHTML=`<article class="study-mistake-card" data-mistake-card="${item.id}"><p class="study-kicker">MISTAKE ${String(state.currentMistake+1).padStart(3,"0")} / ${esc(item.status.toUpperCase())}</p><h3>${esc(item.subject)} · ${item.question_number ? `第 ${esc(item.question_number)} 题` : "题号未记录"}</h3><div class="study-question-media" style="${item.crop_width&&item.crop_height?`aspect-ratio:${Number(item.crop_width)}/${Number(item.crop_height)};min-height:0`:""}">${image?`<img src="${esc(image)}" alt="Original question" style="${cropStyle(item)}">`:item.question_snapshot?`<p>${esc(item.question_snapshot)}</p>`:"Original question reference"}</div>${revisit?`<div class="study-answer-options">${["A","B","C","D"].map(option=>`<button data-revisit-answer="${option}">${option}</button>`).join("")}</div><button class="study-primary" data-action="submit-revisit" disabled>SUBMIT</button>`:`<div class="study-answer-reveal"><div><span>MY ANSWER</span><strong>${esc(item.my_answer||"—")}</strong></div><div><span>CORRECT</span><strong>${esc(item.correct_answer)}</strong></div></div><p><span class="study-kicker">REASON</span><br>${esc(item.reason||"—")}</p>${state.writable?`<div class="study-action-row"><button class="study-primary" data-action="start-revisit">REVISIT</button>${item.paper_file_id?'<button class="study-secondary" data-action="crop-mistake">SELECT QUESTION AREA</button>':""}<button class="study-secondary" data-action="master-mistake">MASTERED</button><button class="study-secondary" data-action="delete-mistake">DELETE</button></div>`:""}`}<footer class="study-detail-toolbar"><button class="study-text-button" data-card-nav="prev">← PREVIOUS</button><span>${state.currentMistake+1} / ${items.length}</span><button class="study-text-button" data-card-nav="next">NEXT →</button></footer></article>`;}
    
    function cropStyle(item) {
    return "";
}

    function renderRevisions(){const container=$("#study-revision-list");container.innerHTML=state.revisions.length?state.revisions.map((item,index)=>`<button class="study-record" data-revision-id="${item.id}"><span class="study-record-index">${String(index+1).padStart(3,"0")}</span><span><h3>${esc(item.title)}</h3><p>${esc((item.issue_tags||[]).join(" · ")||item.category||"")}</p></span><p class="study-record-meta">${displayDate(item.created_at)}<br>${esc(item.status.toUpperCase())}</p></button>`).join(""):empty("No revisions archived yet.");}
    async function openRevision(id){const item=state.revisions.find(x=>x.id===id);if(!item)return;const [attempts,reviews]=item.question_id?await Promise.all([list("shenlun_answers",{filters:{question_id:item.question_id}}),list("reviews",{filters:{question_id:item.question_id}})]):[{data:[]},{data:[]}];const sorted=(attempts.data||[]).sort((a,b)=>a.attempt_number-b.attempt_number);$("#study-revision-detail").hidden=false;$("#study-revision-detail").innerHTML=`<div class="study-detail-toolbar"><div><p class="study-kicker">REVISION / ${esc(item.status.toUpperCase())}</p><h3>${esc(item.title)}</h3></div></div><p>${esc((item.issue_tags||[]).join(" · "))}</p>${sorted.length>1?comparisonMarkup(sorted,reviews.data||[]):""}${state.writable?'<button class="study-primary" data-action="rewrite-revision" data-id="'+item.id+'">REWRITE</button>':""}`;}
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

    async function importAnswerKey(){const input=document.createElement("input");input.type="file";input.accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp";input.onchange=async()=>{const file=input.files[0];if(!file)return;status("Extracting Answer Key…");try{const upload=await uploadFile(file,`practices/${state.activePractice.id}/answer-key/${uid()}-${safeName(file.name)}`);if(upload.error)throw upload.error;const text=await extractText(file,true);const fileRecord=await upsert("files",{practice_id:state.activePractice.id,file_kind:"answer_key",storage_path:upload.data.path,file_name:file.name,mime_type:file.type,file_size:file.size,extracted_text:text});if(fileRecord.error)throw fileRecord.error;const parsed=parseAnswerKey(text);showKeyReview(parsed,fileRecord.data.id);}catch(error){status(`Answer Key import failed: ${error.message}`,true);}};input.click();}

    function parseAnswerKey(text){const answers=new Map();const source=String(text||"").toUpperCase().replace(/[：、，]/g," ");let match;const ranges=/(\d{1,3})\s*[-~～至]\s*(\d{1,3})\s*[:.]?\s*([A-D]{2,})/g;while((match=ranges.exec(source))){const start=Number(match[1]),end=Number(match[2]),letters=match[3];for(let n=start;n<=end&&n-start<letters.length;n++)answers.set(n,letters[n-start]);}const singles=/(?:^|\s)(\d{1,3})\s*[.、:：]?\s*([A-D](?:[A-D])?)(?=\s|$|[,.，。])/g;while((match=singles.exec(source)))answers.set(Number(match[1]),match[2]);return [...answers].map(([question_number,correct_answer])=>({question_number,correct_answer})).sort((a,b)=>a.question_number-b.question_number);}
    function showKeyReview(items,fileId){const total=state.activePractice.total_questions||items.at(-1)?.question_number||0,map=new Map(items.map(item=>[item.question_number,item.correct_answer]));openSheet(`<header><div><p class="study-kicker">ANSWER KEY REVIEW</p><h2>${items.length} / ${total} RECOGNIZED</h2></div><button class="study-dialog-close" data-close-sheet>×</button></header><div class="study-sheet-content"><form id="answer-key-review-form"><div class="study-answer-grid">${Array.from({length:total},(_,i)=>`<label class="study-field"><span>${String(i+1).padStart(3,"0")}</span><input name="key-${i+1}" value="${esc(map.get(i+1)||"")}" maxlength="8" placeholder="?"></label>`).join("")}</div><button class="study-primary" type="submit">CONFIRM ANSWER KEY</button></form></div>`);$("#answer-key-review-form")._fileId=fileId;}

    async function confirmAnswerKey(form){status("Saving confirmed Answer Key…");const total=state.activePractice.total_questions||0;for(let number=1;number<=total;number++){const answer=form.elements[`key-${number}`].value.trim().toUpperCase();if(!answer)continue;const existing=$("#study-practice-detail")._studyData.answer_keys.find(item=>item.question_number===number);const result=await upsert("answer_keys",{practice_id:state.activePractice.id,question_number:number,correct_answer:answer,source_file_id:form._fileId,confirmed:true},existing?.id);if(result.error){status(`Answer ${number} failed to save.`,true);return;}}$("#study-sheet").close();status("Answer Key confirmed.");openPractice(state.activePractice.id);}

    async function extractText(file,allowOcr=false){if(file.type.includes("wordprocessingml")){await loadScript("https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js","mammoth");return (await window.mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()})).value;}if(file.type==="application/pdf"){await loadScript("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs","pdfjsLib",true);const pdf=await window.pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;let text="";for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i);const content=await page.getTextContent();text+=content.items.map(item=>item.str).join(" ")+"\n";}if(text.trim().length>20)return text;if(!allowOcr)return text;await loadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js","Tesseract");for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i),viewport=page.getViewport({scale:1.6}),canvas=document.createElement("canvas"),context=canvas.getContext("2d");canvas.width=viewport.width;canvas.height=viewport.height;await page.render({canvasContext:context,viewport}).promise;const result=await window.Tesseract.recognize(canvas,"chi_sim+eng",{logger:message=>status(`OCR page ${i}/${pdf.numPages} · ${Math.round((message.progress||0)*100)}%`)});text+=result.data.text+"\n";}return text;}if(file.type.startsWith("image/")&&allowOcr){await loadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js","Tesseract");const result=await window.Tesseract.recognize(file,"chi_sim+eng",{logger:message=>status(`OCR ${Math.round((message.progress||0)*100)}%`)});return result.data.text;}throw new Error("This file contains no extractable text.");}
    function loadScript(src,global,module=false){if(window[global])return Promise.resolve();if(module)return import(src).then(value=>{window[global]=value;if(global==="pdfjsLib"&&value.GlobalWorkerOptions)value.GlobalWorkerOptions.workerSrc="https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs";});return new Promise((resolve,reject)=>{const script=document.createElement("script");script.src=src;script.onload=resolve;script.onerror=()=>reject(new Error("Parser could not be loaded."));document.head.append(script);});}

    async function addShenlunQuestion(){const count=$("#study-practice-detail")._studyData.shenlun_questions.length;openEditor({title:"New Shenlun Question",kicker:"QUESTION SETUP",fields:[{name:"question_number",label:"QUESTION NUMBER",type:"number",value:count+1,required:true},{name:"title",label:"TITLE",required:true},{name:"question_type",label:"TYPE",type:"select",options:[["summary","SUMMARY"],["analysis","ANALYSIS"],["proposal","PROPOSAL"],["official_document","OFFICIAL DOCUMENT"],["essay","ESSAY"],["other","OTHER"]]},{name:"max_characters",label:"MAX CHARACTERS",type:"number"},{name:"points",label:"POINTS",type:"number"},{name:"material_scope",label:"MATERIAL SCOPE"},{name:"prompt",label:"PROMPT / REQUIREMENTS",type:"textarea",required:true,full:true}],onSave:async data=>{data.practice_id=state.activePractice.id;data.question_number=Number(data.question_number);data.max_characters=data.max_characters?Number(data.max_characters):null;data.points=data.points?Number(data.points):null;const result=await upsert("shenlun_questions",data);if(result.error)throw result.error;return true;}});}
    async function importReference(){const input=document.createElement("input");input.type="file";input.accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp";input.onchange=async()=>{const file=input.files[0],question=$("#study-practice-detail")._studyData.shenlun_questions.find(item=>item.id===$("#study-practice-detail").dataset.questionId);if(!file||!question)return;status("Extracting reference…");try{const text=await extractText(file,true);openEditor({title:"Reference Import",kicker:"REVIEW BEFORE CONFIRM",fields:[{name:"body",label:`${String(question.question_number).padStart(2,"0")} ${question.title}`,type:"textarea",value:text,required:true,full:true}],onSave:async data=>{const existing=$("#study-practice-detail")._reference;const result=await upsert("shenlun_references",{practice_id:state.activePractice.id,question_id:question.id,body:data.body,confirmed:true},existing?.id);if(result.error)throw result.error;return true;}});}catch(error){status(error.message,true);}};input.click();}
    async function runReview(){const detail=$("#study-practice-detail"),question=detail._studyData.shenlun_questions.find(item=>item.id===detail.dataset.questionId);let answer=await saveShenlun(question,detail._answer,true);if(!answer)return;status("Kiora is reviewing the answer…");const result=await auth.requestStudyReview(answer.id);if(result.error){status(`Review unavailable: ${result.error.code||result.error.message}. Retry when the server is configured.`,true);return;}status("Review saved.");openPractice(state.activePractice.id);}
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

async function openCropEditor(item) {
    const fileResult = await getEntity("files", item.paper_file_id);
    const file = fileResult.data;

    if (!file) {
        return status("Source paper is unavailable.", true);
    }

    const url = await getSignedUrl(file.storage_path);

    if (!url) {
        return status("Source paper could not be opened.", true);
    }

    openSheet(`
        <header>
            <div>
                <p class="study-kicker">NORMALIZED CROP</p>
                <h2>Select Question Area</h2>
            </div>

            <button
                class="study-dialog-close"
                data-close-sheet
                type="button"
            >×</button>
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

                <button
                    class="study-secondary"
                    id="study-crop-load"
                    type="button"
                >
                    LOAD PAGE
                </button>

                <button
                    class="study-secondary"
                    id="study-crop-select"
                    type="button"
                >
                    SELECT AREA
                </button>

                <button
                    class="study-primary"
                    id="study-crop-save"
                    type="button"
                    disabled
                >
                    SAVE AREA
                </button>

            </div>

            <p id="study-crop-hint">
                Scroll to the question first, then press SELECT AREA.
            </p>

            <div
                id="study-crop-scroll"
                style="
                    position: relative;
                    width: 100%;
                    max-height: min(70vh, 760px);
                    overflow: auto;
                    overscroll-behavior: contain;
                    -webkit-overflow-scrolling: touch;
                    touch-action: pan-x pan-y;
                "
            >
                <div
                    id="study-crop-stage"
                    class="study-crop-stage"
                    style="
                        position: relative;
                        width: max-content;
                        min-width: 100%;
                        overflow: visible;
                        touch-action: pan-x pan-y;
                    "
                ></div>
            </div>

        </div>
    `);

    const scroll = $("#study-crop-scroll");
    const stage = $("#study-crop-stage");
    const selectButton = $("#study-crop-select");
    const saveButton = $("#study-crop-save");
    const hint = $("#study-crop-hint");

    let selectionController = null;

    const load = async () => {
        stage.innerHTML = "";
        stage._selection = null;

        saveButton.disabled = true;

        selectButton.textContent = "SELECT AREA";
        selectButton.classList.remove("active");

        hint.textContent =
            "Scroll to the question first, then press SELECT AREA.";

        scroll.style.touchAction = "pan-x pan-y";
        stage.style.touchAction = "pan-x pan-y";

        let source;

        if (file.mime_type === "application/pdf") {
            await loadScript(
                "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs",
                "pdfjsLib",
                true
            );

            const pdf = await window.pdfjsLib
                .getDocument(url)
                .promise;

            const requestedPage =
                Number($("#study-crop-page").value) || 1;

            const pageNumber = Math.min(
                Math.max(requestedPage, 1),
                pdf.numPages
            );

            const page = await pdf.getPage(pageNumber);

            /*
             * 不再固定使用 scale: 1.6。
             *
             * 先按照滚动区域的实际宽度计算一个适合屏幕的比例。
             * 手机和电脑都会完整显示 PDF 宽度，
             * 纵向通过外层 scroll 容器滚动。
             */
            const baseViewport =
                page.getViewport({ scale: 1 });

            const availableWidth =
                Math.max(
                    scroll.clientWidth || 320,
                    280
                );

            const scale = Math.min(
                2,
                availableWidth / baseViewport.width
            );

            const viewport =
                page.getViewport({ scale });

            source = document.createElement("canvas");

            source.width =
                Math.ceil(viewport.width);

            source.height =
                Math.ceil(viewport.height);

            /*
             * canvas 自己就是实际坐标基准。
             * 不让 stage 用滚动高度参与归一化计算。
             */
            source.style.display = "block";
            source.style.width = `${source.width}px`;
            source.style.height = `${source.height}px`;
            source.style.maxWidth = "none";

            await page.render({
                canvasContext:
                    source.getContext("2d"),
                viewport
            }).promise;

            $("#study-crop-page").value =
                pageNumber;
        } else {
            source =
                document.createElement("img");

            source.src = url;

            await source.decode();

            /*
             * 图片也使用实际显示尺寸作为坐标基准。
             */
            const availableWidth =
                Math.max(
                    scroll.clientWidth || 320,
                    280
                );

            const naturalWidth =
                source.naturalWidth || availableWidth;

            const naturalHeight =
                source.naturalHeight || availableWidth;

            const scale =
                Math.min(
                    1,
                    availableWidth / naturalWidth
                );

            const displayWidth =
                Math.round(naturalWidth * scale);

            const displayHeight =
                Math.round(naturalHeight * scale);

            source.style.display = "block";
            source.style.width =
                `${displayWidth}px`;
            source.style.height =
                `${displayHeight}px`;
            source.style.maxWidth = "none";
        }

        /*
         * source 和 selection 都放进 stage。
         *
         * 外层 study-crop-scroll 才负责滚动。
         *
         * 因此：
         *
         * PDF 滚多少
         * selection 就跟着滚多少。
         */
        stage.append(source);

        /*
         * stage 的尺寸直接跟 PDF / 图片一致。
         */
        const sourceRect =
            source.getBoundingClientRect();

        stage.style.width =
            `${sourceRect.width}px`;

        stage.style.height =
            `${sourceRect.height}px`;

        stage.style.minWidth = "0";

        selectionController =
            installCropSelection(
                stage,
                source,
                scroll,
                {
                    onSelectionChange(selection) {
                        saveButton.disabled =
                            !selection ||
                            selection.crop_width < 0.005 ||
                            selection.crop_height < 0.005;
                    },

                    onModeChange(selecting) {
                        if (selecting) {
                            selectButton.textContent =
                                "CANCEL SELECT";

                            selectButton.classList.add(
                                "active"
                            );

                            hint.textContent =
                                "Drag across the question area.";

                            /*
                             * 框选模式：
                             * stage 接收拖动。
                             */
                            stage.style.touchAction =
                                "none";
                        } else {
                            selectButton.textContent =
                                stage._selection
                                    ? "RESELECT"
                                    : "SELECT AREA";

                            selectButton.classList.remove(
                                "active"
                            );

                            hint.textContent =
                                stage._selection
                                    ? "Area selected. Scroll to check it, or press RESELECT."
                                    : "Scroll to the question first, then press SELECT AREA.";

                            /*
                             * 浏览模式：
                             * 手机手指可以继续正常滚 PDF。
                             */
                            stage.style.touchAction =
                                "pan-x pan-y";
                        }
                    }
                }
            );
    };

    $("#study-crop-load").onclick =
        async () => {
            await load();
        };

    selectButton.onclick = () => {
        if (!selectionController) return;

        if (selectionController.isSelecting()) {
            selectionController.stop();
        } else {
            selectionController.start();
        }
    };

    saveButton.onclick =
        async () => {
            const selection =
                stage._selection;

            if (!selection) return;

            const result =
                await upsert(
                    "mistakes",
                    mistakeData(
                        item,
                        {
                            paper_page:
                                Number(
                                    $("#study-crop-page").value
                                ) || 1,

                            ...selection
                        }
                    ),
                    item.id
                );

            if (result.error) {
                return status(
                    result.error.message,
                    true
                );
            }

            Object.assign(
                item,
                result.data
            );

            $("#study-sheet").close();

            renderMistakes();
        };

    await load();
}


function installCropSelection(
    stage,
    source,
    scroll,
    callbacks = {}
) {
    let selecting = false;
    let dragging = false;

    let pointerId = null;

    let start = null;
    let box = null;

    const clamp =
        (value) =>
            Math.min(
                Math.max(value, 0),
                1
            );

    /*
     * 重点：
     *
     * 坐标只根据 PDF canvas / image 本身计算。
     *
     * 不再使用：
     *
     * stage.scrollTop
     * stage.scrollHeight
     * stage.scrollLeft
     * stage.scrollWidth
     *
     * 因为滚动现在属于外层 scroll。
     */
    const point = (event) => {
        const rect =
            source.getBoundingClientRect();

        const x =
            event.clientX -
            rect.left;

        const y =
            event.clientY -
            rect.top;

        return {
            x: clamp(
                x / rect.width
            ),

            y: clamp(
                y / rect.height
            )
        };
    };

    const updateBox =
        (event) => {
            if (
                !start ||
                !box
            ) {
                return;
            }

            const end =
                point(event);

            const x =
                Math.min(
                    start.x,
                    end.x
                );

            const y =
                Math.min(
                    start.y,
                    end.y
                );

            const width =
                Math.abs(
                    end.x -
                    start.x
                );

            const height =
                Math.abs(
                    end.y -
                    start.y
                );

            /*
             * selection 的百分比也是相对于
             * PDF 本身，而不是滚动窗口。
             */
            Object.assign(
                box.style,
                {
                    position: "absolute",

                    left:
                        `${x * 100}%`,

                    top:
                        `${y * 100}%`,

                    width:
                        `${width * 100}%`,

                    height:
                        `${height * 100}%`,

                    boxSizing:
                        "border-box",

                    pointerEvents:
                        "none"
                }
            );

            stage._selection = {
                crop_x: x,
                crop_y: y,
                crop_width: width,
                crop_height: height
            };

            callbacks.onSelectionChange?.(
                stage._selection
            );
        };

    const stopDragging =
        (event) => {
            if (!dragging) {
                return;
            }

            /*
             * 松手瞬间再算一次，
             * 防止最后几像素丢失。
             */
            updateBox(event);

            dragging = false;
            start = null;

            if (
                pointerId !== null &&
                stage.hasPointerCapture?.(
                    pointerId
                )
            ) {
                try {
                    stage.releasePointerCapture(
                        pointerId
                    );
                } catch (_) {
                    // ignore
                }
            }

            pointerId = null;

            /*
             * 框完自动退出 SELECT 模式。
             * 这样手机马上又可以滚 PDF。
             */
            selecting = false;
            
            selecting = false;

            stage.classList.remove("is-selecting");

            callbacks.onModeChange?.(
                false
            );

            callbacks.onModeChange?.(
                false
            );
        };

    stage.onpointerdown =
        (event) => {
            if (!selecting) {
                return;
            }

            /*
             * 鼠标只响应左键。
             * 触摸设备 pointerType=touch
             * 不受 button 限制。
             */
            if (
                event.pointerType === "mouse" &&
                event.button !== 0
            ) {
                return;
            }

            event.preventDefault();

            dragging = true;
            pointerId =
                event.pointerId;

            start =
                point(event);

            stage
                .querySelector(
                    ".study-crop-selection"
                )
                ?.remove();

            box =
                document.createElement("i");

            box.className =
                "study-crop-selection";

            /*
             * 给一个明确可见的框。
             *
             * 即使原 CSS 有问题，
             * 这里也保证用户拖动时看得到。
             */
            Object.assign(
                box.style,
                {
                    position:
                        "absolute",

                    left:
                        `${start.x * 100}%`,

                    top:
                        `${start.y * 100}%`,

                    width:
                        "0",

                    height:
                        "0",

                    border:
                        "2px solid currentColor",

                    background:
                        "rgba(255,255,255,0.12)",

                    boxSizing:
                        "border-box",

                    pointerEvents:
                        "none",

                    zIndex:
                        "10"
                }
            );

            stage.append(box);

            if (
                stage.setPointerCapture
            ) {
                try {
                    stage.setPointerCapture(
                        event.pointerId
                    );
                } catch (_) {
                    // ignore
                }
            }
        };

    stage.onpointermove =
        (event) => {
            if (
                !selecting ||
                !dragging
            ) {
                return;
            }

            event.preventDefault();

            updateBox(event);
        };

    stage.onpointerup =
        (event) => {
            if (
                !selecting ||
                !dragging
            ) {
                return;
            }

            event.preventDefault();

            stopDragging(event);
        };

    stage.onpointercancel =
        (event) => {
            if (!dragging) {
                return;
            }

            dragging = false;
            start = null;

            if (
                pointerId !== null &&
                stage.hasPointerCapture?.(
                    pointerId
                )
            ) {
                try {
                    stage.releasePointerCapture(
                        pointerId
                    );
                } catch (_) {
                    // ignore
                }
            }

            pointerId = null;

            selecting = false;

            stage.classList.remove("is-selecting");

            callbacks.onModeChange?.(
                false
            );
        };

    return {
        start() {
            selecting = true;

            stage.classList.add("is-selecting");

            callbacks.onModeChange?.(
                true
            );
        },

        stop() {
            selecting = false;
            dragging = false;
            start = null;

            stage.classList.remove("is-selecting");

            callbacks.onModeChange?.(
                false
            );
        },

        isSelecting() {
            return selecting;
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
        const answer=event.target.closest("[data-answer]");if(answer){await saveAptitudeAnswer(answer.dataset.answer,{advance:true});return;}
        const answerNav=event.target.closest("[data-answer-nav]");if(answerNav){const detail=$("#study-practice-detail"),total=state.activePractice.total_questions||1,current=Number(detail.dataset.question);detail.dataset.question=Math.min(Math.max(current+(answerNav.dataset.answerNav==="next"?1:-1),1),total);updateAptitudeControls();return;}
        const sheetQuestion=event.target.closest("[data-sheet-question]");if(sheetQuestion){$("#study-practice-detail").dataset.question=sheetQuestion.dataset.sheetQuestion;$("#study-sheet").close();updateAptitudeControls();return;}
        const question=event.target.closest("[data-shenlun-question]");if(question){$("#study-practice-detail").dataset.questionId=question.dataset.shenlunQuestion;renderShenlun(state.activePractice,$("#study-practice-detail")._studyData);return;}
        const revisit=event.target.closest("[data-revisit-answer]");if(revisit){$$('[data-revisit-answer]').forEach(x=>x.classList.toggle("active",x===revisit));$("[data-action=submit-revisit]").disabled=false;return;}
        const revision=event.target.closest("[data-revision-id]");if(revision){openRevision(revision.dataset.revisionId);return;}
        const noteFilter=event.target.closest("[data-note-subject]");if(noteFilter){$$('[data-note-subject]').forEach(x=>x.classList.toggle("active",x===noteFilter));renderNoteList(noteFilter.dataset.noteSubject);return;}
        const editNote=event.target.closest("[data-edit-note]");if(editNote){noteEditor(state.notes.find(x=>x.id===editNote.dataset.editNote));return;}
        const close=event.target.closest("[data-close-sheet]");if(close){$("#study-sheet").close();return;}
        const action=event.target.closest("[data-action]")?.dataset.action;if(!action)return;
        if(action==="new-practice")newPractice();if(action==="new-note")noteEditor();if(action==="quick-mistake")quickMistake();
        if(action==="close-practice"){$("#study-practice-detail").hidden=true;state.activePractice=null;}
        if(action==="upload-paper")attachPaper();if(action==="import-key")importAnswerKey();if(action==="finish-practice")finishPractice();if(action==="open-answer-sheet")showAnswerSheet();
        if(action==="clear-answer")saveAptitudeAnswer(null);if(action==="toggle-flag"){const detail=$("#study-practice-detail"),item=detail._studyData.aptitude_answers.find(x=>x.question_number===Number(detail.dataset.question));saveAptitudeAnswer(undefined,{flagged:!item?.flagged});}
        if(action==="add-shenlun-question")addShenlunQuestion();if(action==="save-shenlun-answer"){const detail=$("#study-practice-detail"),q=detail._studyData.shenlun_questions.find(x=>x.id===detail.dataset.questionId);saveShenlun(q,detail._answer);}
        if(action==="import-reference")importReference();if(action==="review-shenlun")runReview();if(action==="add-revision")addRevision();
        if(action==="start-revisit")renderMistakeCard(filteredMistakes()[state.currentMistake],filteredMistakes(),true);if(action==="submit-revisit")submitRevisit();if(action==="crop-mistake")openCropEditor(filteredMistakes()[state.currentMistake]);
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





