(function () {
    "use strict";
    const auth = window.KioraAuth;
    const common = window.yuriArticles;
    let game, characters = [], config, keywords = [], currentPage = 0, pendingCover = null, pendingFavorite = null;
    const byId = (id) => document.getElementById(id);
    const esc = (value) => common.escapeHtml(String(value ?? ""));
    const clean = (value) => String(value ?? "").trim();
    const safeImage = (value) => String(value || "").startsWith("blob:") ? String(value) : common.safeUrl(value);
    const bool = (value, fallback = true) => typeof value === "boolean" ? value : fallback;
    const deepMerge = (base, saved) => ({ ...base, ...(saved || {}), profile: { ...base.profile, ...(saved?.profile || {}) }, favorites: { ...base.favorites, ...(saved?.favorites || {}) }, my_favorite: { ...base.my_favorite, ...(saved?.my_favorite || {}) }, visibility: { ...base.visibility, ...(saved?.visibility || {}) } });

    function defaults() {
        const platform = Array.isArray(game.platforms) ? game.platforms[0] : "";
        return {
            title: game.title || "", cover_url: game.cover_url || "", started_at: game.started_at || "", completed_at: game.completed_at || "",
            play_time: "", platform: platform || "", language: "日本語", completion: game.status === "COMPLETED" ? "全通" : "",
            played_because: "", profile: { story: 3, character: 3, romance: 3, visual: 3, music: 3 },
            favorites: { character: "", end: "", scene: "", quote: "" },
            my_favorite: { name: "", image_url: game.cover_url || "", review: "" }, note: "",
            review_title: "", review_route: game.title || "", review_keywords: Array.isArray(game.tags) ? game.tags : [], long_review: game.review || "",
            visibility: { played_because: true, profile: true, favorite_character: true, favorite_end: true, favorite_scene: true, favorite_quote: true, my_favorite: true, note: true },
            cover_position: "center", favorite_position: "center"
        };
    }

    function markup() {
        return `<div id="repo-overlay" class="repo-overlay" hidden><section class="repo-editor" data-mobile-view="edit" role="dialog" aria-modal="true" aria-label="Game Repo Editor">
          <header class="repo-editor-head"><strong>EXPORT REPO</strong><div class="repo-tabs"><button type="button" data-repo-tab="edit" class="active">EDIT</button><button type="button" data-repo-tab="preview">PREVIEW</button><button type="button" data-repo-tab="export">EXPORT</button></div><button class="repo-close" type="button" aria-label="Close">×</button></header>
          <div class="repo-editor-body"><form id="repo-form" class="repo-form">
            <details open><summary>01 / BASIC</summary><div class="repo-fields">
              <label>TITLE<input data-field="title" maxlength="240"></label><label>COVER IMAGE URL<input data-field="cover_url" type="url"></label>
              <div class="repo-grid-2"><label>UPLOAD COVER<input id="repo-cover-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label><label>IMAGE POSITION<select data-field="cover_position"><option value="top">TOP</option><option value="center">CENTER</option><option value="bottom">BOTTOM</option></select></label></div>
              <div class="repo-grid-2"><label>STARTED<input data-field="started_at" type="date"></label><label>COMPLETED<input data-field="completed_at" type="date"></label><label>PLAY TIME<input data-field="play_time" placeholder="48 HOURS"></label><label>PLATFORM<select data-field="platform"><option></option>${["PC","Steam","Switch","PSP","PS Vita","PS4","PS5","Other"].map(x=>`<option>${x}</option>`).join("")}</select></label><label>LANGUAGE<select data-field="language">${["中文","日本語","English","Other"].map(x=>`<option>${x}</option>`).join("")}</select></label><label>COMPLETE<select data-field="completion"><option></option>${["全通","部分攻略","未全通","Other"].map(x=>`<option>${x}</option>`).join("")}</select></label></div>
              ${optionalText("played_because","PLAYED BECAUSE","played_because",2)}
            </div></details>
            <details><summary>02 / PROFILE</summary><div class="repo-fields"><label><input data-visible="profile" type="checkbox"> SHOW GAME PROFILE</label><div class="repo-score-grid">${[["story","剧情"],["character","角色"],["romance","感情"],["visual","视觉"],["music","音乐"]].map(([key,label])=>`<label>${label}<input data-score="${key}" type="number" min="1" max="5" step="0.5"></label>`).join("")}</div></div></details>
            <details><summary>03 / FAVORITES</summary><div class="repo-fields repo-favorite-grid">
              ${optionalText("favorite_character","FAVORITE CHARACTER","favorites.character",2)}${optionalText("favorite_end","FAVORITE END","favorites.end",2)}${optionalText("favorite_scene","FAVORITE SCENE","favorites.scene",2)}${optionalText("favorite_quote","FAVORITE QUOTE","favorites.quote",3)}
              <div class="repo-optional" style="grid-column:1/-1"><label><input data-visible="my_favorite" type="checkbox"> SHOW MY FAVORITE</label><label>NAME<input data-nested="my_favorite.name" maxlength="160"></label><label>IMAGE SOURCE<select id="repo-image-source"></select></label><label>UPLOAD IMAGE<input id="repo-favorite-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label><label>IMAGE POSITION<select data-field="favorite_position"><option value="top">TOP</option><option value="center">CENTER</option><option value="bottom">BOTTOM</option></select></label><label>PERSONAL NOTE<textarea data-nested="my_favorite.review" rows="4" maxlength="1000"></textarea></label></div>
            </div></details>
            <details><summary>04 / NOTE</summary><div class="repo-fields">${optionalText("note","NOTE / 感想","note",7)}</div></details>
            <details><summary>05 / LONG REVIEW</summary><div class="repo-fields"><label>ARTICLE TITLE<input data-field="review_title" maxlength="240"></label><label>WORK / ROUTE<input data-field="review_route" maxlength="500"></label><div><p class="repo-field-label">KEYWORDS</p><div id="repo-keywords" class="repo-keyword-list"></div><div class="repo-keyword-entry"><input id="repo-keyword-input" maxlength="120"><button id="repo-keyword-add" type="button">＋ ADD</button></div></div><label>LONG REVIEW<textarea data-field="long_review" rows="16"></textarea></label></div></details>
          </form><section class="repo-preview-pane"><div class="repo-preview-scroll"><div id="repo-preview-stage" class="repo-preview-stage"></div></div><div class="repo-page-nav"><button type="button" id="repo-prev">←</button><span id="repo-page-count">01 / 02</span><button type="button" id="repo-next">→</button></div></section></div>
          <footer class="repo-editor-actions"><button class="primary" id="repo-save" type="button">SAVE REPO</button><button data-export="current" type="button">EXPORT PNG</button><button data-export="all" type="button">EXPORT ALL PNG</button><button data-export="pdf" type="button">EXPORT PDF</button><span id="repo-message" class="repo-message"></span></footer>
        </section></div>`;
    }
    function optionalText(vis, label, path, rows) { return `<div class="repo-optional"><label><input data-visible="${vis}" type="checkbox"> SHOW ${label}</label><label>${label}<textarea data-nested="${path}" rows="${rows}"></textarea></label></div>`; }
    function getPath(path) { return path.split(".").reduce((value,key)=>value?.[key],config); }
    function setPath(path, value) { const keys=path.split("."); let target=config; keys.slice(0,-1).forEach(key=>target=target[key]); target[keys.at(-1)]=value; }
    function setMessage(text, error=false) { byId("repo-message").textContent=text; byId("repo-message").style.color=error?"#996370":""; }

    function applyForm() {
        document.querySelectorAll("[data-field]").forEach(el=>el.value=config[el.dataset.field]??"");
        document.querySelectorAll("[data-nested]").forEach(el=>el.value=getPath(el.dataset.nested)??"");
        document.querySelectorAll("[data-score]").forEach(el=>el.value=config.profile[el.dataset.score]??3);
        document.querySelectorAll("[data-visible]").forEach(el=>el.checked=bool(config.visibility[el.dataset.visible]));
        keywords=[...(Array.isArray(config.review_keywords)?config.review_keywords:[])]; renderKeywords(); buildImageSources(); render();
    }
    function collectForm() {
        document.querySelectorAll("[data-field]").forEach(el=>config[el.dataset.field]=el.value);
        document.querySelectorAll("[data-nested]").forEach(el=>setPath(el.dataset.nested,el.value));
        document.querySelectorAll("[data-score]").forEach(el=>config.profile[el.dataset.score]=Math.max(1,Math.min(5,Number(el.value)||1)));
        document.querySelectorAll("[data-visible]").forEach(el=>config.visibility[el.dataset.visible]=el.checked);
        config.review_keywords=keywords.slice();
    }
    function renderKeywords() {
        const list=byId("repo-keywords"); list.replaceChildren(); keywords.forEach(word=>{const chip=document.createElement("span");chip.className="repo-keyword-chip";chip.append(document.createTextNode(word));const x=document.createElement("button");x.type="button";x.textContent="×";x.onclick=()=>{keywords=keywords.filter(v=>v!==word);renderKeywords();render();};chip.append(x);list.append(chip);});
    }
    function addKeyword(){const input=byId("repo-keyword-input"),word=clean(input.value);if(word&&!keywords.includes(word)&&keywords.length<30)keywords.push(word);input.value="";renderKeywords();render();}
    function buildImageSources(){const select=byId("repo-image-source");select.replaceChildren();const options=[{label:"GAME COVER",url:game.cover_url},...characters.filter(c=>c.image_url).map(c=>({label:`CHARACTER / ${c.name}`,url:c.image_url}))];options.forEach(item=>{const o=document.createElement("option");o.value=item.url||"";o.textContent=item.label;select.append(o);});const custom=document.createElement("option");custom.value=config.my_favorite.image_url||"";custom.textContent="CURRENT / CUSTOM";select.append(custom);select.value=config.my_favorite.image_url||options[0]?.url||"";}

    function radarSvg() {
        const keys=[["story","剧情"],["character","角色"],["romance","感情"],["visual","视觉"],["music","音乐"]], cx=112,cy=86,r=60;
        const point=(i,scale)=>{const a=-Math.PI/2+i*Math.PI*2/5;return `${cx+Math.cos(a)*r*scale},${cy+Math.sin(a)*r*scale}`;};
        const grids=[1,.8,.6,.4,.2].map(s=>`<polygon points="${keys.map((_,i)=>point(i,s)).join(" ")}" fill="none" stroke="rgba(112,91,118,.18)"/>`).join("");
        const data=keys.map(([key],i)=>point(i,(Number(config.profile[key])||1)/5)).join(" ");
        const labels=keys.map(([,label],i)=>{const [x,y]=point(i,1.22).split(",");return `<text x="${x}" y="${y}" text-anchor="middle">${label}</text>`;}).join("");
        return `<svg class="repo-radar" viewBox="0 0 224 172">${grids}${keys.map((_,i)=>`<line x1="${cx}" y1="${cy}" x2="${point(i,1).replace(',','" y2="')}" stroke="rgba(112,91,118,.16)"/>`).join("")}<polygon points="${data}" fill="rgba(174,137,170,.28)" stroke="#9a7595" stroke-width="1.5"/>${labels}</svg>`;
    }
    function basic(label,value){return `<div><p class="repo-label">${label}</p><p class="repo-value">${esc(value||"—")}</p></div>`;}
    function favorite(label,value,extra=""){return `<div class="repo-favorite ${extra}"><p class="repo-label">${label}</p><p class="repo-copy">${esc(value)}</p></div>`;}
    function pageShell(number,type,body){return `<article class="repo-page"><header class="repo-mast"><span>KIORA.SPACE / GAME ARCHIVE</span><span>${String(number).padStart(2,"0")} / ${type}</span></header>${body}<footer class="repo-page-footer"><span>PRIVATE OTOME GAME RECORD</span><span>PAGE ${String(number).padStart(2,"0")}</span></footer></article>`;}
    function pageOne(){const v=config.visibility,cover=safeImage(config.cover_url),fav=safeImage(config.my_favorite.image_url);const blocks=[];
      if(v.favorite_character&&config.favorites.character)blocks.push(favorite("FAVORITE CHARACTER",config.favorites.character));if(v.favorite_end&&config.favorites.end)blocks.push(favorite("FAVORITE END",config.favorites.end));if(v.favorite_scene&&config.favorites.scene)blocks.push(favorite("FAVORITE SCENE",config.favorites.scene));if(v.favorite_quote&&config.favorites.quote)blocks.push(favorite("FAVORITE QUOTE",`「${config.favorites.quote}」`,"repo-quote"));
      const image=cover?`<img class="repo-cover" src="${esc(cover)}" style="object-position:center ${config.cover_position}">`:`<div class="repo-cover-empty">NO IMAGE</div>`;
      const mid=[v.played_because&&config.played_because?`<div class="repo-block"><p class="repo-label">PLAYED BECAUSE</p><p class="repo-copy">${esc(config.played_because)}</p></div>`:"",v.profile?`<div class="repo-block"><p class="repo-label">GAME PROFILE</p>${radarSvg()}</div>`:""].filter(Boolean).join("");
      const bottom=[v.my_favorite&&(config.my_favorite.name||config.my_favorite.review)?`<div class="repo-block"><p class="repo-label">MY FAVORITE</p><div class="repo-my-favorite">${fav?`<img src="${esc(fav)}" style="object-position:center ${config.favorite_position}">`:""}<div><p class="repo-value">${esc(config.my_favorite.name)}</p><p class="repo-copy">${esc(config.my_favorite.review)}</p></div></div></div>`:"",v.note&&config.note?`<div class="repo-block"><p class="repo-label">NOTE / 感想</p><p class="repo-copy">${esc(config.note)}</p></div>`:""].filter(Boolean).join("");
      return pageShell(1,"GAME REPO",`<h1 class="repo-title">${esc(config.title||"UNTITLED")}</h1><div class="repo-hero-grid">${image}<div class="repo-basic">${basic("PLAYED",[common.formatPureDate(config.started_at),common.formatPureDate(config.completed_at)].filter(Boolean).join(" — "))}${basic("PLAY TIME",config.play_time)}${basic("PLATFORM",config.platform)}${basic("LANGUAGE",config.language)}${basic("COMPLETE",config.completion)}</div></div>${mid?`<div class="repo-mid-grid">${mid}</div>`:""}${blocks.length?`<div class="repo-favorites">${blocks.join("")}</div>`:""}${bottom?`<div class="repo-bottom-grid">${bottom}</div>`:""}`);
    }
    function reviewChunks(text,max=1500){const source=String(text||"").replace(/\r/g,"");const paragraphs=source.split(/\n{2,}/).map(v=>v.trim()).filter(Boolean),units=[];paragraphs.forEach(paragraph=>{let rest=paragraph;while(rest.length>max){const windowText=rest.slice(0,max+1);let cut=Math.max(windowText.lastIndexOf("。"),windowText.lastIndexOf("！"),windowText.lastIndexOf("？"),windowText.lastIndexOf("."),windowText.lastIndexOf("!"),windowText.lastIndexOf("?"),windowText.lastIndexOf("\n"));if(cut<max*.55)cut=max;else cut+=1;units.push(rest.slice(0,cut).trim());rest=rest.slice(cut).trim();}if(rest)units.push(rest);});const pages=[];let page=[],size=0;units.forEach(part=>{if(size&&size+part.length>max){pages.push(page);page=[];size=0;}page.push(part);size+=part.length;});if(page.length||!pages.length)pages.push(page);return pages;}
    function reviewPages(){const count=String(config.long_review||"").replace(/\s/g,"").length;return reviewChunks(config.long_review).map((parts,index)=>pageShell(index+2,"TEXT PAGE",`<h1 class="repo-text-title">${esc(config.review_title||config.title||"LONG REVIEW")}</h1><p class="repo-text-route">${esc(config.review_route||config.title)}</p><div class="repo-text-meta"><span>LONG REVIEW / ${count} 字</span>${keywords.map(k=>`<span>${esc(k)}</span>`).join("")}</div><div class="repo-text-body">${parts.length?parts.map(p=>`<p>${esc(p).replaceAll("\n","<br>")}</p>`).join(""):'<p>LONG REVIEW</p>'}</div>`));}
    function render(){collectForm();const stage=byId("repo-preview-stage");stage.innerHTML=[pageOne(),...reviewPages()].join("");const pages=[...stage.children];currentPage=Math.min(currentPage,pages.length-1);pages.forEach((p,i)=>p.classList.toggle("is-current",i===currentPage));byId("repo-page-count").textContent=`${String(currentPage+1).padStart(2,"0")} / ${String(pages.length).padStart(2,"0")}`;resizePreview();}
    function resizePreview(){if(innerWidth>900)return;const pane=document.querySelector(".repo-preview-scroll");if(!pane)return;document.querySelector(".repo-editor").style.setProperty("--repo-preview-scale",String(Math.min(.72,(pane.clientWidth-16)/720)));}

    async function loadSaved(){if(auth.role==="editor")return auth.readForEditor("game_repo_get",{game_id:game.id});return dbQuery("get");}
    async function dbQuery(mode,payload){const db=common.getClient();if(mode==="get")return db.from("game_repo").select("id,game_id,config,updated_at").eq("game_id",game.id).maybeSingle();return db.from("game_repo").upsert({game_id:game.id,config:payload},{onConflict:"game_id"}).select("id,game_id,config,updated_at").single();}
    async function upload(file,kind){if(!file)return null;if(!file.type.startsWith("image/")||file.size>5*1024*1024)throw new Error("图片必须是不超过 5MB 的 JPG / PNG / WEBP / GIF。");const ext=(file.name.split(".").pop()||"jpg").replace(/[^a-z0-9]/gi,"")||"jpg";const result=await auth.uploadSiteMedia(file,`collections/game-repo/${game.id}-${kind}-${crypto.randomUUID()}.${ext}`);if(result.error)throw result.error;return result.data.publicUrl;}
    async function save(){collectForm();setMessage("Saving…");try{const cover=await upload(pendingCover,"cover"),favorite=await upload(pendingFavorite,"favorite");if(cover)config.cover_url=cover;if(favorite)config.my_favorite.image_url=favorite;const result=await auth.write("game_repo_upsert",{game_id:game.id,config},()=>dbQuery("save",config));if(result.error)throw result.error;pendingCover=pendingFavorite=null;applyForm();setMessage("SAVED / Repo 配置已保存");}catch(error){setMessage(`保存失败：${error.message}`,true);}}
    function loadScript(src,test){return new Promise((resolve,reject)=>{if(test())return resolve();const s=document.createElement("script");s.src=src;s.onload=resolve;s.onerror=()=>reject(new Error("导出组件加载失败"));document.head.append(s);});}
    async function canvasFor(page){await loadScript("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js",()=>typeof html2canvas==="function");const host=document.createElement("div");host.className="repo-export-host";const clone=page.cloneNode(true);clone.classList.remove("is-current");host.append(clone);document.body.append(host);await Promise.all([...clone.querySelectorAll("img")].map(img=>img.decode?.().catch(()=>{})));const canvas=await html2canvas(clone,{scale:2,width:720,height:960,useCORS:true,backgroundColor:"#f8f4f7",logging:false});host.remove();return canvas;}
    function download(canvas,name){canvas.toBlob(blob=>{const a=document.createElement("a");const url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},"image/png");}
    function slug(){return clean(config.title).toLowerCase().replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/gi,"-").replace(/^-|-$/g,"")||`game-${game.id}`;}
    async function exportRepo(mode){setMessage("Rendering export…");try{const pages=[...byId("repo-preview-stage").children],targets=mode==="current"?[pages[currentPage]]:pages,canvases=[];for(const page of targets)canvases.push(await canvasFor(page));if(mode==="pdf"){await loadScript("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js",()=>Boolean(window.jspdf?.jsPDF));const pdf=new jspdf.jsPDF({orientation:"portrait",unit:"px",format:[720,960],hotfixes:["px_scaling"]});canvases.forEach((canvas,i)=>{if(i)pdf.addPage([720,960],"portrait");pdf.addImage(canvas.toDataURL("image/png"),"PNG",0,0,720,960);});pdf.save(`${slug()}-repo.pdf`);}else canvases.forEach((canvas,i)=>download(canvas,`${slug()}-repo-${String(mode==="current"?currentPage+1:i+1).padStart(2,"0")}.png`));setMessage("Export complete");}catch(error){setMessage(`导出失败：${error.message}`,true);}}

    async function init(detail){if(game)return;game=detail.game;characters=detail.characters||[];await auth.initialize(common.getClient());if(!auth.can("game-repo:edit"))return;const button=document.createElement("button");button.type="button";button.className="repo-launch";button.textContent="EXPORT REPO";document.querySelector(".game-detail-nav")?.append(button);document.body.insertAdjacentHTML("beforeend",markup());const overlay=byId("repo-overlay");button.onclick=async()=>{overlay.hidden=false;document.body.style.overflow="hidden";setMessage("Loading Repo…");const result=await loadSaved();if(result.error&&!["42P01","PGRST205"].includes(result.error.code)){setMessage(result.error.message,true);}config=deepMerge(defaults(),result.data?.config);applyForm();setMessage(result.data?.config?"Saved Repo restored":"New Repo / based on this game");};
      document.querySelector(".repo-close").onclick=()=>{overlay.hidden=true;document.body.style.overflow="";};overlay.addEventListener("click",e=>{if(e.target===overlay)document.querySelector(".repo-close").click();});
      byId("repo-form").addEventListener("input",()=>render());byId("repo-cover-file").onchange=e=>{pendingCover=e.target.files[0]||null;if(pendingCover){config.cover_url=URL.createObjectURL(pendingCover);render();}};byId("repo-favorite-file").onchange=e=>{pendingFavorite=e.target.files[0]||null;if(pendingFavorite){config.my_favorite.image_url=URL.createObjectURL(pendingFavorite);render();}};byId("repo-image-source").onchange=e=>{config.my_favorite.image_url=e.target.value;render();};
      byId("repo-keyword-add").onclick=addKeyword;byId("repo-keyword-input").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();addKeyword();}};byId("repo-prev").onclick=()=>{currentPage=Math.max(0,currentPage-1);render();};byId("repo-next").onclick=()=>{currentPage=Math.min(byId("repo-preview-stage").children.length-1,currentPage+1);render();};byId("repo-save").onclick=save;document.querySelectorAll("[data-export]").forEach(b=>b.onclick=()=>exportRepo(b.dataset.export));document.querySelectorAll("[data-repo-tab]").forEach(b=>b.onclick=()=>{document.querySelectorAll("[data-repo-tab]").forEach(x=>x.classList.toggle("active",x===b));const editor=document.querySelector(".repo-editor");editor.dataset.mobileView=b.dataset.repoTab==="edit"?"edit":"preview";resizePreview();});addEventListener("resize",resizePreview);
    }
    window.addEventListener("kiora:game-record-ready",e=>init(e.detail));if(window.KioraGameRecordData)init(window.KioraGameRecordData);
})();
