(function () {
    "use strict";

    /* Interface-only localization. Values, article bodies, game/character names
       and other owner-authored content are intentionally excluded. */
    const textMap = new Map(Object.entries({
        "HOME": "ホーム",
        "ABOUT": "わたしのこと",
        "ARCHIVE": "アーカイブ",
        "GAMES": "ゲーム",
        "WRITING": "かきもの",
        "STUDY": "おべんきょう",
        "SALE": "セール",
        "PROFILE": "わたしのこと",
        "MENU": "メニュー",
        "KIORA.SPACE / ABOUT": "KIORA.SPACE / わたしのこと",
        "KIORA.SPACE / ARCHIVE": "KIORA.SPACE / アーカイブ",
        "KIORA.SPACE / WRITING": "KIORA.SPACE / かきもの",
        "KIORA.SPACE / PRIVATE LEARNING ARCHIVE": "KIORA.SPACE / まなびの記録",
        "PRIVATE CELESTIAL INDEX / 03": "わたしのゲーム棚 / 03",
        "PRIVATE GAME ARCHIVE": "わたしのゲーム記録",
        "PRIVATE CELESTIAL ARCHIVE": "わたしの小さなアーカイブ",
        "Kiora's little universe": "Kioraの小さな宇宙",
        "Kiora's learning constellation": "Kioraの学びの星座",
        "PRIVATE ARCHIVE": "プライベートアーカイブ",
        "KIORA / PRIVATE ARCHIVE": "KIORA / プライベートアーカイブ",
        "KIORA / KIORA.SPACE": "KIORA / KIORA.SPACE",
        "A quiet catalogue of stories once held close.": "好きだった物語を静かに並べた記録。",
        "A portrait made of little things I love.": "好きなもののかけらでできた、わたしの記録。",
        "Sounds kept in a small constellation.": "小さな星座にしまっておく音たち。",
        "Learning Constellation": "学びの星座",
        "Discount Constellation": "セールの星座",
        "A QUIETER": "もっと静かで",
        "KINDER WORLD": "やさしい世界",
        "A LITTLE UNIVERSE": "好きなものを集めた",
        "OF THINGS I LOVE.": "小さな宇宙。",
        "a little universe": "好きなものを集めた",
        "made of things I love": "小さな宇宙",
        "scroll ↓": "下へ ↓",
        "PERSONAL RECORD / 02": "わたしの記録 / 02",
        "RECENT PAGES / 01": "最近のかきもの / 01",
        "VIEW ALL WRITING →": "かきものを全部見る →",
        "VIEW FULL PROFILE →": "プロフィールを全部見る →",
        "FANDOMS": "好きな作品",
        "FAVORITES": "お気に入り",
        "OTOME PROFILE": "乙女ゲームの好み",
        "CURRENTLY PLAYING": "いま遊んでいる",
        "TAGS / KEYWORDS": "タグ / キーワード",
        "OPEN GAME →": "ゲームを開く →",
        "FREE SPACE": "自由帳",
        "PROFILE EDITOR": "プロフィール編集",
        "PROFILE COLLECTION": "プロフィールのコレクション",
        "OTOME PROFILE EDITOR": "乙女ゲーム設定の編集",
        "PROFILE EXPORT": "プロフィールを書き出す",
        "PROFILE / CURRENT NOTE": "プロフィール / いま遊んでいる",
        "PROFILE / EXPORT SETTINGS": "プロフィール / 書き出し設定",
        "ABOUT ME": "わたしについて",
        "FREE SPACE TITLE": "自由帳のタイトル",
        "FREE SPACE CONTENT": "自由帳の内容",
        "UPDATED DATE": "更新日",
        "SAVE PROFILE": "プロフィールを保存",
        "SAVE PLAYER CARD": "プレイヤーカードを保存",
        "ATTRIBUTE AXES": "属性バランス",
        "＋ ADD AXIS": "＋ 軸を追加",
        "WORK / TITLE": "作品 / タイトル",
        "SYMBOL": "シンボル",
        "DESCRIPTION": "説明",
        "SORT ORDER": "並び順",
        "MUSIC / NOW PLAYING": "おんがく / 再生中",
        "ARCHIVED TRACKS": "保存した曲",
        "MUSIC RECORD": "音楽の記録",
        "New music": "新しい曲",
        "TITLE": "タイトル",
        "PROVIDER": "再生サービス",
        "MUSIC URL": "音楽URL",
        "COVER IMAGE URL": "ジャケット画像URL",
        "MY NOTE": "ひとこと",
        "LYRIC EXCERPT": "歌詞の抜粋",
        "LRC DATA": "LRCデータ",
        "SAVE MUSIC": "音楽を保存",
        "SEARCH": "さがす",
        "TITLE / TAG": "タイトル / タグ",
        "FILTER": "絞り込み",
        "GRID": "カード",
        "INDEX": "一覧",
        "CATALOGUE": "ゲーム棚",
        "All records": "すべてのゲーム",
        "CLEAR SELECTIONS": "選択をクリア",
        "SELECT ACROSS SECTIONS TO NARROW THE CONSTELLATION.": "条件を組み合わせてゲームを絞り込めます。",
        "RETURN HOME ↑": "ホームへ戻る ↑",
        "ARCHIVE INDEX": "アーカイブの索引",
        "Filter records": "ゲームを絞り込む",
        "CLEAR": "クリア",
        "VIEW RECORDS": "結果を見る",
        "CREATE MODE": "新規作成",
        "EDIT MODE": "編集",
        "New record": "新しい記録",
        "OVERVIEW": "基本情報",
        "AFTERGLOW": "余韻",
        "CHARACTERS": "キャラクター",
        "BASIC": "基本情報",
        "RATING": "評価",
        "PLAYED DATE": "プレイした日",
        "STARTED": "開始日",
        "COMPLETED": "クリア済み",
        "STATUS": "状態",
        "FAVORITE LEVEL": "お気に入り度",
        "PLATFORM": "機種",
        "TAGS": "タグ",
        "＋ ADD TAG": "＋ タグを追加",
        "OFFICIAL SITE URL": "公式サイトURL",
        "STORE LINKS": "ストアリンク",
        "AFTERGLOW / PERSONAL NOTE": "余韻 / ゲーム感想",
        "GAME IMPRESSION": "ゲームの感想",
        "CHARACTER ARCHIVE": "キャラクター記録",
        "CHARACTER IMPRESSIONS": "キャラクターの印象",
        "＋ ADD CHARACTER": "＋ キャラクターを追加",
        "SAVE RECORD": "記録を保存",
        "CANCEL": "キャンセル",
        "DELETE RECORD": "記録を削除",
        "CHARACTER IMPRESSION": "キャラクターの印象",
        "UNTITLED": "タイトル未設定",
        "SUBTITLE / ROUTE NOTE": "サブタイトル / ルートメモ",
        "SAVE CHARACTER": "キャラクターを保存",
        "DELETE CHARACTER": "キャラクターを削除",
        "← BACK TO ARCHIVE": "← ゲーム一覧へ",
        "← BACK TO GAME": "← ゲームへ戻る",
        "← RETURN TO GAME": "← ゲームへ戻る",
        "CHARACTER RECORD": "キャラクター記録",
        "MY RATING": "わたしの評価",
        "EDIT IMPRESSION": "印象を編集",
        "PERSONAL RECORD": "わたしの記録",
        "KEYWORDS": "キーワード",
        "OPEN FULL RECORD →": "記録を全部見る →",
        "EDIT RECORD": "記録を編集",
        "WRITING / AFTERGLOW": "かきもの / 余韻",
        "STORIES LINKED TO THIS GAME": "このゲームに結びついた文章",
        "GAME NOTE / PRIVATE IMPRESSION": "ゲームメモ / 個人的な感想",
        "ROUTES IN THIS CONSTELLATION": "このゲームのキャラクターたち",
        "LINKS": "リンク",
        "OFFICIAL / STORE": "公式サイト / ストア",
        "← BACK": "← 戻る",
        "RELATED GAME / GAMES ARCHIVE": "関連ゲーム / ゲーム記録",
        "OPEN GAME RECORD": "ゲーム記録を開く",
        "VIEW ARCHIVE →": "アーカイブを見る →",
        "BACK TO JOURNAL": "かきもの一覧へ",
        "WRITING EDITOR": "かきもの編集",
        "SUBTITLE / SUMMARY": "サブタイトル / あらすじ",
        "RELATED GAME": "関連ゲーム",
        "PREVIEW": "プレビュー",
        "SAVE / 保存": "保存",
        "DELETE / 删除": "削除",
        "VIEW": "見る",
        "SAVE": "保存",
        "ARTICLE INDEX": "文章の一覧",
        "stories, notes and dreams collected here.": "物語と日々のこと、夢のかけらを集めています。",
        "AFTERGLOW": "ゲーム感想",
        "MOON NOTES": "随筆",
        "DREAM LETTERS": "夢の文章",
        "Reading the archive…": "アーカイブを読み込んでいます…",
        "INDEX": "一覧",
        "CALENDAR": "カレンダー",
        "PRACTICE": "練習",
        "MISTAKES": "まちがいノート",
        "REVISIONS": "答案の見直し",
        "NOTES": "メモ",
        "CURRENT MONTH / CALENDAR PREVIEW": "今月 / カレンダー",
        "VIEW CALENDAR →": "カレンダーを見る →",
        "TIME INDEX": "学びの時間",
        "Calendar": "カレンダー",
        "TODAY": "今日",
        "SELECT A DAY": "日付を選んでください",
        "RAW LEARNING RECORDS": "学習の記録",
        "Practice": "練習",
        "＋ NEW PRACTICE": "＋ 練習を追加",
        "APTITUDE ARCHIVE": "まちがいの記録",
        "Mistakes": "まちがいノート",
        "＋ QUICK MISTAKE": "＋ まちがいを追加",
        "ALL": "すべて",
        "LEARNING": "学習中",
        "REVIEW": "復習",
        "MASTERED": "習得済み",
        "CARD": "カード",
        "SHENLUN ARCHIVE": "申論の記録",
        "Revisions": "答案の見直し",
        "LEARNING FRAGMENTS": "学びのかけら",
        "Notes": "メモ",
        "＋ NEW NOTE": "＋ メモを追加",
        "STUDY EDITOR": "学習記録の編集",
        "TYPE": "種類",
        "PRACTICE DATE": "練習日",
        "SOURCE": "出典",
        "SUBJECT": "科目",
        "TOTAL QUESTIONS": "問題数",
        "NOTE": "メモ",
        "CHECKING…": "確認中…",
        "← BACK TO PROFILE": "← プロフィールへ",
        "LINK TO GAME": "ゲームと関連づける",
        "DISPLAY TITLE": "表示タイトル",
        "SUBTITLE": "サブタイトル",
        "SHORT NOTE": "ひとことメモ",
        "＋ ADD TAG": "＋ タグを追加",
        "SAVE CURRENTLY PLAYING": "現在のゲームを保存",
        "CLEAR SETTING": "設定をクリア",
        "SAVE EXPORT PROFILE": "書き出し設定を保存",
        "RESET TO PROFILE DEFAULTS": "プロフィールの初期値に戻す",
        "EXPORT PREVIEW": "書き出しプレビュー",
        "ABOUT TEXT": "自己紹介文",
        "PLAYING": "プレイ中",
        "REPLAYING": "再プレイ中",
        "PAUSED": "休止中",
        "DROPPED": "中断",
        "WISHLIST": "気になる",
        "UNFILED": "未分類",
        "TIER BOARD →": "ティア表 →",
        "SALE →": "セール →",
        "GAME SALE OBSERVATORY": "ゲームセール観測所",
        "KIORA.SPACE / GAME SALE OBSERVATORY": "KIORA.SPACE / ゲームセール観測所",
        "DISCOUNT CALENDAR": "セールカレンダー",
        "REGION OVERVIEW": "地域別の一覧",
        "LIVE SALES": "開催中のセール",
        "CONFIRMED SALE": "確認済みセール",
        "OPEN HK STORE": "香港ストアを開く",
        "OPEN JP STORE": "日本ストアを開く",
        "← SALE OBSERVATORY": "← セール一覧へ",
        "EDIT BALANCE": "予算を編集",
        "OVERVIEW →": "概要を見る →",
        "SELECTED PURCHASE": "選択したゲーム",
        "SELECTED": "選択中",
        "GAMES": "ゲーム",
        "CURRENT PRICE": "現在価格",
        "SELECT GAMES TO CALCULATE": "ゲームを選ぶと合計を計算します",
        "ADD SALE DIALOG": "セールを追加",
        "GAME": "ゲーム",
        "PRICE": "価格",
        "REGULAR PRICE": "通常価格",
        "DISCOUNT": "割引率",
        "SALE PRICE": "セール価格",
        "SALE PERIOD": "セール期間",
        "SAVE SALE": "セールを保存",
        "TIER ARCHIVE": "ティア記録",
        "UNFILED GAMES": "未分類のゲーム",
        "Drag a cover into any tier.": "表紙を好きな段へ移動できます。",
        "DELETE": "削除",
        "CLOSE": "閉じる"
    }));

    const placeholderMap = new Map(Object.entries({
        "TITLE / TAG": "タイトル / タグ",
        "Title or tag": "タイトルやタグ",
        "Type a tag": "タグを入力",
        "Official music page URL": "公式の音楽ページURL",
        "留空使用 Profile Tagline": "空欄ならプロフィールの一言を使用",
        "留空使用 About 内容": "空欄なら自己紹介の内容を使用",
        "留空使用 Currently Playing 设置": "空欄なら現在のゲーム設定を使用"
    }));

    const titleMap = new Map(Object.entries({
        "Character Record · Kiora": "キャラクター記録 · Kiora",
        "Full Game Record · Kiora": "ゲームの全記録 · Kiora",
        "Game Archive · Kiora": "ゲーム記録 · Kiora",
        "Reading · Kiora": "読む · Kiora",
        "Write · Kiora": "かきもの編集 · Kiora",
        "JP Sale · Kiora": "日本のセール · Kiora",
        "HK Sale · Kiora": "香港のセール · Kiora"
    }));

    const monthNames = {
        JANUARY: "1月", FEBRUARY: "2月", MARCH: "3月", APRIL: "4月",
        MAY: "5月", JUNE: "6月", JULY: "7月", AUGUST: "8月",
        SEPTEMBER: "9月", OCTOBER: "10月", NOVEMBER: "11月", DECEMBER: "12月"
    };

    function patternedTranslation(key) {
        let match = key.match(/^ARCHIVE\s+(\d+)$/);
        if (match) return `記録 ${match[1]}`;
        match = key.match(/^(\d+)\s*\/\s*(\d+)\s+RECORDS$/);
        if (match) return `${match[1]} / ${match[2]} 件`;
        match = key.match(/^UPDATED\s*\/\s*(.+)$/);
        if (match) return `更新 / ${match[1]}`;
        match = key.match(/^(\d+)\s+GAMES$/);
        if (match) return `${match[1]} 本`;
        match = key.match(/^(PLAYING|COMPLETED|PAUSED|DROPPED|WISHLIST)(\s*[·•]\s*.+)?$/);
        if (match) return `${textMap.get(match[1]) || match[1]}${match[2] || ""}`;
        match = key.match(/^([A-Z]+)\s+(\d{4})$/);
        if (match && monthNames[match[1]]) return `${match[2]}年${monthNames[match[1]]}`;
        return "";
    }

    const contentExclusions = [
        ".rich-reading",
        ".article-body",
        "#article-content",
        "#article-title",
        "#article-subtitle",
        "#article-related-game-title",
        "#free-space-content",
        "#profile-display-name",
        "#profile-display-summary",
        "#profile-display-about",
        "#profile-current-game",
        "#profile-current-subtitle",
        "#profile-current-note",
        "#profile-fandoms",
        "#profile-favorites",
        "#home-profile-name",
        "#home-profile-tagline",
        "#home-profile-summary",
        "#home-profile-fandoms",
        "#home-profile-favorites",
        "#home-profile-current",
        "#game-detail-title",
        "#record-title",
        "#character-name",
        "#character-subtitle",
        "#character-review",
        "#board-title",
        "#board-description",
        ".game-detail-reading",
        ".game-character-review",
        ".game-note-preview",
        ".game-card-title",
        "a.game-card h3",
        ".game-list-title",
        ".writing-flow-title",
        ".writing-flow-summary",
        ".profile-current-note",
        ".fandom-card",
        ".favorite-card",
        ".study-record h3",
        ".study-note h3",
        ".study-note > p:not(.study-kicker)",
        "[data-game-id] h2",
        "[data-game-id] h3",
        "[data-game-id] strong",
        "[data-writing-id] h2",
        "[data-writing-id] h3",
        "[data-character-id] h2",
        "[data-character-id] h3",
        "[data-music-id] h2",
        "[data-music-id] h3",
        "#currently-game option:not([value=''])",
        ".music-lyric-lines",
        "textarea",
        "[contenteditable='true']"
    ].join(",");

    const uiSelectors = [
        "button", "label", "legend", "option", "th", "dt", "nav", "header", "footer", "dialog",
        "[role='tab']", "[role='button']", ".modal-label", ".game-detail-label", ".study-kicker",
        ".games-status", ".settings-save-state", ".writing-flow-heading", ".music-library-heading",
        ".home-profile-index", ".home-profile-more", ".home-writing-all", ".index-footnote",
        ".site-home-tail", ".hero-desktop-epigraph", ".subtitle", ".scroll", ".games-heading-copy",
        ".game-card-number", ".game-card-meta", ".game-card-foot", "#games-count",
        ".profile-current-game-link", ".profile-sidebar-meta-row", ".profile-updated", "#study-current-month", "#study-calendar-title",
        ".writing-flow-meta", ".writing-featured-label", ".writing-flow-index",
        "[class*='heading']", "[class*='kicker']", "[class*='label']", "[class*='toolbar']", "[class*='actions']", "[class*='status']"
    ].join(",");

    function isInterfaceText(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest(contentExclusions)) return false;
        return Boolean(parent.closest(uiSelectors) || /^H[1-4]$/.test(parent.tagName));
    }

    function translateTextNode(node) {
        if (!isInterfaceText(node)) return;
        const raw = node.nodeValue || "";
        const key = raw.trim().replace(/\s+/g, " ");
        const translated = textMap.get(key) || patternedTranslation(key);
        if (!translated || translated === key) return;
        node.nodeValue = translated;
    }

    function translateElement(element) {
        if (!(element instanceof Element) || element.closest(contentExclusions)) return;
        const placeholder = element.getAttribute("placeholder");
        if (placeholder && placeholderMap.has(placeholder)) element.setAttribute("placeholder", placeholderMap.get(placeholder));
        const ariaLabel = element.getAttribute("aria-label");
        if (ariaLabel && textMap.has(ariaLabel)) element.setAttribute("aria-label", textMap.get(ariaLabel));

        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(translateTextNode);
        element.querySelectorAll("[placeholder], [aria-label]").forEach((child) => {
            const childPlaceholder = child.getAttribute("placeholder");
            if (childPlaceholder && placeholderMap.has(childPlaceholder)) child.setAttribute("placeholder", placeholderMap.get(childPlaceholder));
            const childLabel = child.getAttribute("aria-label");
            if (childLabel && textMap.has(childLabel)) child.setAttribute("aria-label", textMap.get(childLabel));
        });
    }

    function run() {
        if (titleMap.has(document.title)) document.title = titleMap.get(document.title);
        translateElement(document.body);

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
                    else if (node.nodeType === Node.ELEMENT_NODE) translateElement(node);
                });
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
    else run();
})();
