(async function () {

    "use strict";


    /* =====================================================
       BASIC
    ===================================================== */

    const common =
        window.yuriArticles;


    if (!common) {

        console.error(
            "Kiora article-common.js is unavailable."
        );

        return;

    }


    const db =
        common.getClient();


    const auth =
        window.KioraAuth;


    const $ =
        (selector, root = document) =>
            root.querySelector(selector);


    const $$ =
        (selector, root = document) =>
            Array.from(
                root.querySelectorAll(
                    selector
                )
            );


    const esc =
        (value) =>
            common.escapeHtml(
                String(
                    value ?? ""
                )
            );



    const REGION =
        String(
            document.body
                .dataset
                .saleRegion ||
            "HK"
        )
        .toUpperCase();


    const CURRENCY =
        REGION === "JP"
            ? "JPY"
            : "HKD";


    const CURRENCY_SYMBOL =
        CURRENCY === "JPY"
            ? "¥"
            : "HK$";



    const state = {

        games: [],

        prices: [],

        forecasts: [],

        wallet: null,

        selected:
            new Set(),

        writable:
            false

    };



    /* =====================================================
       STATUS
    ===================================================== */

    function status(
        message = "",
        error = false
    ) {

        const node =
            $(
                "#sale-region-status"
            );


        if (!node) {
            return;
        }


        node.textContent =
            message;


        node.hidden =
            !message;


        node.classList.toggle(
            "error",
            error
        );

    }



    /* =====================================================
       GAME HELPERS
    ===================================================== */

    function gameTitle(
        game
    ) {

        if (!game) {
            return "Unknown game";
        }


        return (
            game.title ||
            game.name ||
            game.game_title ||
            game.cn_title ||
            game.jp_title ||
            `GAME #${game.id}`
        );

    }



    function gameCover(
        game
    ) {

        if (!game) {
            return "";
        }


        return (
            game.cover_url ||
            game.cover_image ||
            game.image_url ||
            game.image ||
            game.cover ||
            game.thumbnail ||
            ""
        );

    }



    function gamePlatform(
        game
    ) {

        return (
            game?.platform ||
            game?.platform_name ||
            game?.system ||
            ""
        );

    }



    function gameById(
        id
    ) {

        return state.games.find(
            (game) =>
                Number(
                    game.id
                ) ===
                Number(
                    id
                )
        );

    }



    /* =====================================================
       MONEY / DATE
    ===================================================== */

    function money(
        value
    ) {

        if (
            value === null ||
            value === undefined ||
            value === ""
        ) {
            return "—";
        }


        const number =
            Number(
                value
            );


        if (
            !Number.isFinite(
                number
            )
        ) {
            return "—";
        }


        if (
            CURRENCY === "JPY"
        ) {

            return (
                "¥" +
                Math.round(
                    number
                )
                .toLocaleString(
                    "ja-JP"
                )
            );

        }


        return (
            "HK$" +
            number.toLocaleString(
                "en-HK",
                {
                    minimumFractionDigits:
                        0,

                    maximumFractionDigits:
                        2
                }
            )
        );

    }



    function dateOnly(
        value
    ) {

        if (!value) {
            return "";
        }


        return String(
            value
        ).slice(
            0,
            10
        );

    }



    function displayDate(
        value
    ) {

        const date =
            dateOnly(
                value
            );


        if (!date) {
            return "—";
        }


        return date
            .replaceAll(
                "-",
                "."
            );

    }



    function today() {

        const date =
            new Date();


        return (
            date.getFullYear() +
            "-" +
            String(
                date.getMonth() +
                1
            )
            .padStart(
                2,
                "0"
            ) +
            "-" +
            String(
                date.getDate()
            )
            .padStart(
                2,
                "0"
            )
        );

    }



    /* =====================================================
       SALES
    ===================================================== */

    function isCurrentSale(
        item
    ) {

        const now =
            today();


        const start =
            dateOnly(
                item.sale_starts_at
            );


        const end =
            dateOnly(
                item.sale_ends_at
            );


        if (
            start &&
            start > now
        ) {
            return false;
        }


        if (
            end &&
            end < now
        ) {
            return false;
        }


        return true;

    }



    function latestPriceRows() {

        /*
         * 同一游戏可能有很多历史快照。
         * 当前列表只保留最新一条。
         */

        const map =
            new Map();


        const rows =
            [...state.prices]
                .sort(
                    (
                        a,
                        b
                    ) =>
                        String(
                            b.observed_at ||
                            b.created_at ||
                            ""
                        )
                        .localeCompare(
                            String(
                                a.observed_at ||
                                a.created_at ||
                                ""
                            )
                        )
                );


        for (
            const row of rows
        ) {

            if (
                row.region !==
                REGION
            ) {
                continue;
            }


            const key =
                Number(
                    row.game_id
                );


            if (
                map.has(
                    key
                )
            ) {
                continue;
            }


            map.set(
                key,
                row
            );

        }


        return Array.from(
            map.values()
        );

    }



    function liveSales() {

        return latestPriceRows()
            .filter(
                isCurrentSale
            );

    }



    function historyLow(
        gameId
    ) {

        const values =
            state.prices
                .filter(
                    (item) =>
                        item.region ===
                            REGION &&
                        Number(
                            item.game_id
                        ) ===
                            Number(
                                gameId
                            ) &&
                        Number.isFinite(
                            Number(
                                item.sale_price
                            )
                        )
                )
                .map(
                    (item) =>
                        Number(
                            item.sale_price
                        )
                );


        if (!values.length) {
            return null;
        }


        return Math.min(
            ...values
        );

    }



    function forecasts() {

        const current =
            today();


        /*
         * 同一游戏如果有多个预测，
         * 只显示最新生成的一条。
         */

        const map =
            new Map();


        const rows =
            [...state.forecasts]
                .filter(
                    (item) =>
                        item.region ===
                            REGION &&
                        (
                            !item.predicted_end ||
                            item.predicted_end >=
                                current
                        )
                )
                .sort(
                    (
                        a,
                        b
                    ) =>
                        String(
                            b.generated_at ||
                            b.created_at ||
                            ""
                        )
                        .localeCompare(
                            String(
                                a.generated_at ||
                                a.created_at ||
                                ""
                            )
                        )
                );


        for (
            const row of rows
        ) {

            const key =
                Number(
                    row.game_id
                );


            if (
                map.has(
                    key
                )
            ) {
                continue;
            }


            map.set(
                key,
                row
            );

        }


        return Array.from(
            map.values()
        );

    }



    /* =====================================================
       LOAD DATA
    ===================================================== */

    async function loadData() {

        status(
            `Reading ${REGION} sale constellation…`
        );


        try {

            if (auth) {

                await auth.initialize(
                    db
                );

            }


            state.writable =
                auth?.role ===
                "owner";


            const [
                gamesResult,
                priceResult,
                forecastResult
            ] =
                await Promise.all([

                    db
                        .from(
                            "games"
                        )
                        .select("*")
                        .limit(
                            2000
                        ),

                    db
                        .from(
                            "game_price_history"
                        )
                        .select("*")
                        .eq(
                            "region",
                            REGION
                        )
                        .order(
                            "observed_at",
                            {
                                ascending:
                                    false
                            }
                        )
                        .limit(
                            5000
                        ),

                    db
                        .from(
                            "game_sale_forecasts"
                        )
                        .select("*")
                        .eq(
                            "region",
                            REGION
                        )
                        .order(
                            "generated_at",
                            {
                                ascending:
                                    false
                            }
                        )
                        .limit(
                            2000
                        )

                ]);


            if (
                gamesResult.error
            ) {
                throw gamesResult.error;
            }


            if (
                priceResult.error
            ) {
                throw priceResult.error;
            }


            if (
                forecastResult.error
            ) {
                throw forecastResult.error;
            }


            state.games =
                gamesResult.data ||
                [];


            state.prices =
                priceResult.data ||
                [];


            state.forecasts =
                forecastResult.data ||
                [];



            /*
             * 钱包只有 OWNER 能读。
             */

            if (
                state.writable
            ) {

                const walletResult =
                    await db
                        .from(
                            "game_sale_wallets"
                        )
                        .select("*")
                        .eq(
                            "region",
                            REGION
                        )
                        .maybeSingle();


                if (
                    !walletResult.error
                ) {

                    state.wallet =
                        walletResult.data ||
                        null;

                }

            }


            status("");

            render();

        } catch (
            error
        ) {

            console.error(
                error
            );


            status(
                `Sale data unavailable: ${
                    error?.message ||
                    error
                }`,
                true
            );

        }

    }



    /* =====================================================
       COVER
    ===================================================== */

    function coverMarkup(
        game
    ) {

        const url =
            gameCover(
                game
            );


        if (!url) {

            return `
                <div
                    class="sale-game-cover"
                >
                    <span>✦</span>
                </div>
            `;

        }


        return `
            <div
                class="sale-game-cover"
            >
                <img
                    src="${esc(
                        url
                    )}"
                    alt=""
                    loading="lazy"
                >
            </div>
        `;

    }



    /* =====================================================
       LIVE ROW
    ===================================================== */

    function liveRow(
        row
    ) {

        const game =
            gameById(
                row.game_id
            );


        const low =
            historyLow(
                row.game_id
            );


        const checked =
            state.selected.has(
                String(
                    row.id
                )
            );


        return `
            <article
                class="sale-game-row"
                data-sale-id="${esc(
                    row.id
                )}"
            >

                <label
                    class="sale-game-check"
                >
                    <input
                        type="checkbox"

                        data-select-sale="${esc(
                            row.id
                        )}"

                        ${
                            checked
                                ? "checked"
                                : ""
                        }
                    >
                </label>


                ${coverMarkup(
                    game
                )}


                <div
                    class="sale-game-info"
                >

                    <h3>
                        ${esc(
                            gameTitle(
                                game
                            )
                        )}
                    </h3>

                    <p>
                        ${
                            esc(
                                gamePlatform(
                                    game
                                )
                            ) ||
                            "GAME ARCHIVE"
                        }

                        · ${REGION} STORE
                    </p>

                </div>


                <div
                    class="sale-game-discount"
                >

                    <span>
                        DISCOUNT
                    </span>

                    <strong>
                        ${
                            row.discount_percent !==
                                null &&
                            row.discount_percent !==
                                undefined
                                ? `-${esc(
                                      row.discount_percent
                                  )}%`
                                : "SALE"
                        }
                    </strong>

                </div>


                <div
                    class="sale-game-price"
                >

                    <span>
                        CURRENT PRICE
                    </span>

                    <strong>
                        ${esc(
                            money(
                                row.sale_price
                            )
                        )}
                    </strong>


                    ${
                        row.regular_price !==
                            null &&
                        row.regular_price !==
                            undefined
                            ? `
                                <small
                                    class="sale-old-price"
                                >
                                    ${esc(
                                        money(
                                            row.regular_price
                                        )
                                    )}
                                </small>
                            `
                            : ""
                    }


                    ${
                        low !== null
                            ? `
                                <small
                                    class="sale-history-low"
                                >
                                    LOWEST
                                    ${esc(
                                        money(
                                            low
                                        )
                                    )}
                                </small>
                            `
                            : ""
                    }

                </div>


                <div
                    class="sale-game-date"
                >

                    <span>
                        UNTIL
                    </span>

                    <strong>
                        ${esc(
                            displayDate(
                                row.sale_ends_at
                            )
                        )}
                    </strong>

                </div>

            </article>
        `;

    }



    /* =====================================================
       FORECAST ROW
    ===================================================== */

    function forecastRow(
        row
    ) {

        const game =
            gameById(
                row.game_id
            );


        return `
            <article
                class="sale-game-row forecast"
            >

                <div
                    class="sale-game-check"
                >
                    ◇
                </div>


                ${coverMarkup(
                    game
                )}


                <div
                    class="sale-game-info"
                >

                    <h3>
                        ${esc(
                            gameTitle(
                                game
                            )
                        )}
                    </h3>

                    <p>
                        ${
                            esc(
                                gamePlatform(
                                    game
                                )
                            ) ||
                            "GAME ARCHIVE"
                        }

                        · FORECAST ONLY
                    </p>

                </div>


                <div
                    class="sale-game-discount"
                >

                    <span>
                        EXPECTED
                    </span>

                    <strong>
                        ${
                            row.predicted_discount_percent !==
                                null &&
                            row.predicted_discount_percent !==
                                undefined
                                ? `~${esc(
                                      row.predicted_discount_percent
                                  )}%`
                                : "—"
                        }
                    </strong>

                </div>


                <div
                    class="sale-game-price"
                >

                    <span>
                        PREDICTED PRICE
                    </span>

                    <strong>
                        ${esc(
                            money(
                                row.predicted_price
                            )
                        )}
                    </strong>


                    ${
                        row.confidence !==
                            null &&
                        row.confidence !==
                            undefined
                            ? `
                                <small
                                    class="sale-history-low"
                                >
                                    CONFIDENCE
                                    ${Math.round(
                                        Number(
                                            row.confidence
                                        ) * 100
                                    )}%
                                </small>
                            `
                            : ""
                    }

                </div>


                <div
                    class="sale-game-date"
                >

                    <span>
                        EXPECTED
                    </span>

                    <strong>
                        ${esc(
                            displayDate(
                                row.predicted_start
                            )
                        )}
                    </strong>

                </div>

            </article>
        `;

    }



    /* =====================================================
       RENDER LISTS
    ===================================================== */

    function renderLive() {

        const rows =
            liveSales();


        $("#sale-live-count")
            .textContent =
            `${rows.length} ${
                rows.length === 1
                    ? "GAME"
                    : "GAMES"
            }`;


        $("#sale-live-list")
            .innerHTML =
            rows.length
                ? rows
                      .map(
                          liveRow
                      )
                      .join("")
                : `
                    <div
                        class="sale-empty"
                    >
                        No confirmed ${REGION} sale
                        has been recorded yet.
                        <br>
                        OWNER 可以点击
                        “＋ ADD SALE”
                        添加第一条价格记录。
                    </div>
                `;

    }



    function renderForecasts() {

        const rows =
            forecasts();


        $("#sale-forecast-count")
            .textContent =
            `${rows.length} ${
                rows.length === 1
                    ? "GAME"
                    : "GAMES"
            }`;


        $("#sale-forecast-list")
            .innerHTML =
            rows.length
                ? rows
                      .map(
                          forecastRow
                      )
                      .join("")
                : `
                    <div
                        class="sale-empty"
                    >
                        No ${REGION} forecast yet.
                        <br>
                        有足够历史价格后，
                        这里会显示预测结果。
                    </div>
                `;

    }



    /* =====================================================
       WALLET
    ===================================================== */

    function walletBalance() {

        if (!state.wallet) {
            return 0;
        }


        const value =
            Number(
                state.wallet.balance
            );


        return Number.isFinite(
            value
        )
            ? value
            : 0;

    }



    function renderWallet() {

        const node =
            $(
                "#sale-wallet-balance"
            );


        if (
            state.writable
        ) {

            node.textContent =
                money(
                    walletBalance()
                );


            $(
                "#sale-edit-balance"
            ).hidden =
                false;


            $(
                "#sale-add-record"
            ).hidden =
                false;

        } else {

            node.textContent =
                "PRIVATE";

        }

    }



    /* =====================================================
       SELECTION
    ===================================================== */

    function selectedRows() {

        const rows =
            liveSales();


        return rows.filter(
            (row) =>
                state.selected.has(
                    String(
                        row.id
                    )
                )
        );

    }



    function renderSelection() {

        const rows =
            selectedRows();


        const total =
            rows.reduce(
                (
                    sum,
                    row
                ) =>
                    sum +
                    Number(
                        row.sale_price ||
                        0
                    ),
                0
            );


        const balance =
            walletBalance();


        const after =
            balance -
            total;


        $("#sale-selected-count")
            .textContent =
            rows.length;


        $("#sale-selected-total")
            .textContent =
            money(
                total
            );


        const afterNode =
            $(
                "#sale-balance-after"
            );


        const noteNode =
            $(
                "#sale-balance-note"
            );


        if (
            !state.writable
        ) {

            afterNode.textContent =
                "PRIVATE";


            noteNode.textContent =
                "OWNER BALANCE ONLY";


            afterNode.classList.remove(
                "negative"
            );

            return;

        }


        afterNode.textContent =
            money(
                after
            );


        afterNode.classList.toggle(
            "negative",
            after < 0
        );


        if (!rows.length) {

            noteNode.textContent =
                "SELECT GAMES TO CALCULATE";

        } else if (
            after < 0
        ) {

            noteNode.textContent =
                `SHORT ${
                    CURRENCY_SYMBOL
                }${Math.abs(
                    after
                ).toLocaleString()}`;

        } else {

            noteNode.textContent =
                "AVAILABLE AFTER PURCHASE";

        }

    }



    /* =====================================================
       GAME SELECT
    ===================================================== */

    document
        .addEventListener(
            "change",
            (
                event
            ) => {

                const checkbox =
                    event.target.closest(
                        "[data-select-sale]"
                    );


                if (!checkbox) {
                    return;
                }


                const id =
                    String(
                        checkbox
                            .dataset
                            .selectSale
                    );


                if (
                    checkbox.checked
                ) {

                    state.selected.add(
                        id
                    );

                } else {

                    state.selected.delete(
                        id
                    );

                }


                renderSelection();

            }
        );



    $("#sale-clear-selection")
        ?.addEventListener(
            "click",
            () => {

                state.selected.clear();


                $$(
                    "[data-select-sale]"
                ).forEach(
                    (
                        checkbox
                    ) => {

                        checkbox.checked =
                            false;

                    }
                );


                renderSelection();

            }
        );



    /* =====================================================
       DIALOG HELPERS
    ===================================================== */

    function closeDialogs() {

        $$(
            ".sale-dialog"
        ).forEach(
            (
                dialog
            ) => {

                if (
                    dialog.open
                ) {

                    dialog.close();

                }

            }
        );

    }



    $$(
        "[data-close-dialog]"
    ).forEach(
        (
            button
        ) => {

            button.addEventListener(
                "click",
                closeDialogs
            );

        }
    );



    /* =====================================================
       EDIT WALLET
    ===================================================== */

    $(
        "#sale-edit-balance"
    )
        ?.addEventListener(
            "click",
            () => {

                if (
                    !state.writable
                ) {
                    return;
                }


                $(
                    "#sale-balance-input"
                ).value =
                    walletBalance();


                $(
                    "#sale-balance-dialog"
                )
                    .showModal();

            }
        );



    $(
        "#sale-balance-form"
    )
        ?.addEventListener(
            "submit",
            async (
                event
            ) => {

                event.preventDefault();


                if (
                    !state.writable
                ) {
                    return;
                }


                const value =
                    Number(
                        $(
                            "#sale-balance-input"
                        ).value
                    );


                if (
                    !Number.isFinite(
                        value
                    ) ||
                    value < 0
                ) {

                    status(
                        "Balance must be 0 or greater.",
                        true
                    );

                    return;

                }


                status(
                    `Saving ${REGION} balance…`
                );


                let result;


                if (
                    state.wallet?.id
                ) {

                    result =
                        await db
                            .from(
                                "game_sale_wallets"
                            )
                            .update({
                                balance:
                                    value,

                                currency:
                                    CURRENCY
                            })
                            .eq(
                                "id",
                                state.wallet.id
                            )
                            .select("*")
                            .single();

                } else {

                    const user =
                        auth?.state
                            ?.identity;


                    if (
                        !user?.id
                    ) {

                        status(
                            "OWNER session unavailable.",
                            true
                        );

                        return;

                    }


                    result =
                        await db
                            .from(
                                "game_sale_wallets"
                            )
                            .insert({
                                owner_id:
                                    user.id,

                                region:
                                    REGION,

                                currency:
                                    CURRENCY,

                                balance:
                                    value
                            })
                            .select("*")
                            .single();

                }


                if (
                    result.error
                ) {

                    status(
                        result.error.message,
                        true
                    );

                    return;

                }


                state.wallet =
                    result.data;


                closeDialogs();

                status("");

                renderWallet();

                renderSelection();

            }
        );



    /* =====================================================
       ADD SALE RECORD
    ===================================================== */

    function normalizeSaleSearch(value) {

        return String(value ?? "")
            .normalize("NFKC")
            .toLocaleLowerCase()
            .replace(/\s+/g, "")
            .replace(
                /[・･\-‐‑‒–—―~〜～_:：!！?？、。,.，'"“”‘’（）()【】\[\]{}<>＜＞\/\\|｜]/g,
                ""
            );

    }


    function saleGameSearchScore(text, query) {

        const target =
            normalizeSaleSearch(text);

        const keyword =
            normalizeSaleSearch(query);


        if (!keyword) {
            return 0;
        }


        const includedAt =
            target.indexOf(keyword);


        if (includedAt !== -1) {
            return 10000 - includedAt;
        }


        let cursor = 0;
        let gap = 0;


        for (const character of keyword) {

            const found =
                target.indexOf(
                    character,
                    cursor
                );


            if (found === -1) {
                return 0;
            }


            gap +=
                found - cursor;

            cursor =
                found + 1;

        }


        return 1000 - gap;

    }


    function setupGameAutocomplete() {

        const input =
            $("#sale-record-game-search");

        const hidden =
            $("#sale-record-game");

        const suggestions =
            $("#sale-game-suggestions");


        if (
            !input ||
            !hidden ||
            !suggestions
        ) {
            return;
        }


        const searchableGames =
            state.games.map(
                (game) => ({
                    game,
                    title:
                        gameTitle(game),
                    searchText:
                        [
                            gameTitle(game),
                            game.title,
                            game.name,
                            game.game_title,
                            game.cn_title,
                            game.jp_title
                        ]
                        .filter(Boolean)
                        .join(" ")
                })
            );


        const closeSuggestions =
            () => {
                suggestions.classList.remove(
                    "open"
                );
            };


        const renderSuggestions =
            (query) => {
                if (!String(query).trim()) {

                    suggestions.innerHTML = `
                        <div class="sale-game-suggestion-empty">
                            输入部分游戏名称开始搜索
                        </div>
                    `;

                    suggestions.classList.add(
                        "open"
                    );

                    return;

                }


                const matches =
                    searchableGames
                        .map(
                            (item) => ({
                                ...item,
                                score:
                                    saleGameSearchScore(
                                        item.searchText,
                                        query
                                    )
                            })
                        )
                        .filter(
                            (item) =>
                                item.score > 0
                        )
                        .sort(
                            (a, b) =>
                                b.score - a.score ||
                                a.title.localeCompare(
                                    b.title,
                                    "ja"
                                )
                        )
                        .slice(0, 12);


                if (!matches.length) {

                    suggestions.innerHTML = `
                        <div class="sale-game-suggestion-empty">
                            没有找到匹配的游戏
                        </div>
                    `;

                } else {

                    suggestions.innerHTML =
                        matches
                            .map(
                                ({ game, title }) => `
                                    <button
                                        type="button"
                                        class="sale-game-suggestion"
                                        data-sale-game-id="${esc(game.id)}"
                                    >
                                        <span>${esc(title)}</span>
                                        <small>${esc(
                                            gamePlatform(game) ||
                                            "GAME ARCHIVE"
                                        )}</small>
                                    </button>
                                `
                            )
                            .join("");

                }


                suggestions.classList.add(
                    "open"
                );

            };


        input.oninput =
            () => {
                hidden.value = "";

                renderSuggestions(
                    input.value
                );
            };


        input.onfocus =
            () => {
                renderSuggestions(
                    input.value
                );
            };


        suggestions.onclick =
            (event) => {

                const button =
                    event.target.closest(
                        "[data-sale-game-id]"
                    );


                if (!button) {
                    return;
                }


                const id =
                    String(
                        button.dataset.saleGameId
                    );

                const selectedGame =
                    state.games.find(
                        (game) =>
                            String(game.id) === id
                    );


                if (!selectedGame) {
                    return;
                }


                input.value =
                    gameTitle(selectedGame);

                hidden.value =
                    id;

                closeSuggestions();

            };


        input.value = "";
        hidden.value = "";
        suggestions.innerHTML = "";
        closeSuggestions();

    }


    function recalculateSalePrice() {

        const regularInput =
            $("#sale-record-regular");

        const discountInput =
            $("#sale-record-discount");

        const priceInput =
            $("#sale-record-price");

        const formula =
            $("#sale-price-formula");


        if (
            !regularInput ||
            !discountInput ||
            !priceInput
        ) {
            return;
        }


        const regular =
            Number.parseFloat(
                regularInput.value
            );

        const discount =
            Number.parseFloat(
                discountInput.value
            );


        if (
            !Number.isFinite(regular) ||
            regular < 0 ||
            !Number.isFinite(discount) ||
            discount < 0 ||
            discount > 100
        ) {

            priceInput.value = "";

            if (formula) {
                formula.textContent =
                    "输入原价和折扣后自动计算";
            }

            return;

        }


        let salePrice =
            regular *
            (1 - discount / 100);


        if (REGION === "JP") {
            salePrice =
                Math.round(salePrice);
        } else {
            salePrice =
                Math.round(
                    salePrice * 100
                ) / 100;
        }


        priceInput.value =
            String(salePrice);

        if (formula) {
            const payPercent =
                100 - discount;

            formula.textContent =
                `${money(regular)} × ${payPercent}% = ${money(salePrice)}`;
        }

    }


    $("#sale-add-record")
        ?.addEventListener(
            "click",
            () => {

                if (!state.writable) {
                    return;
                }


                $("#sale-record-form")
                    .reset();

                $("#sale-record-price").value = "";

                const formula =
                    $("#sale-price-formula");

                if (formula) {
                    formula.textContent =
                        "输入原价和折扣后自动计算";
                }

                setupGameAutocomplete();

                $("#sale-record-dialog")
                    .showModal();

            }
        );


    $("#sale-record-regular")
        ?.addEventListener(
            "input",
            recalculateSalePrice
        );


    $("#sale-record-regular")
        ?.addEventListener(
            "change",
            recalculateSalePrice
        );


    $("#sale-record-discount")
        ?.addEventListener(
            "input",
            recalculateSalePrice
        );


    $("#sale-record-discount")
        ?.addEventListener(
            "change",
            recalculateSalePrice
        );


    $("#sale-record-form")
        ?.addEventListener(
            "submit",
            async (event) => {

                event.preventDefault();


                if (!state.writable) {
                    return;
                }


                const gameId =
                    $("#sale-record-game")
                        .value
                        .trim();

                const salePrice =
                    Number(
                        $("#sale-record-price").value
                    );

                const regularRaw =
                    $("#sale-record-regular").value;

                const discountRaw =
                    $("#sale-record-discount").value;

                const validGame =
                    /^\d+$/.test(gameId) &&
                    state.games.some(
                        (game) =>
                            String(game.id) === gameId
                    );


                if (!validGame) {

                    status(
                        "请先从匹配结果里选择一个游戏。",
                        true
                    );

                    return;

                }


                if (
                    !$("#sale-record-price").value ||
                    !Number.isFinite(salePrice)
                ) {

                    status(
                        "请输入有效的原价和折扣。",
                        true
                    );

                    return;

                }


                const starts =
                    $("#sale-record-start").value;

                const ends =
                    $("#sale-record-end").value;

                const source =
                    $("#sale-record-source")
                        .value
                        .trim();


                status("Saving sale record…");


                const result =
                    await db
                        .from("game_price_history")
                        .insert({
                            game_id:
                                gameId,
                            region:
                                REGION,
                            currency:
                                CURRENCY,
                            regular_price:
                                regularRaw === ""
                                    ? null
                                    : Number(regularRaw),
                            sale_price:
                                salePrice,
                            discount_percent:
                                discountRaw === ""
                                    ? null
                                    : Number(discountRaw),
                            sale_starts_at:
                                starts
                                    ? new Date(starts).toISOString()
                                    : null,
                            sale_ends_at:
                                ends
                                    ? new Date(ends).toISOString()
                                    : null,
                            source_url:
                                source || null
                        })
                        .select("*")
                        .single();


                if (result.error) {

                    status(
                        result.error.message,
                        true
                    );

                    return;

                }


                state.prices.unshift(
                    result.data
                );

                closeDialogs();
                status("Sale record saved.");
                renderLive();
                renderSelection();

            }
        );



    /* =====================================================
       RENDER
    ===================================================== */

    function render() {

        renderWallet();

        renderLive();

        renderForecasts();

        renderSelection();

    }



    /* =====================================================
       START
    ===================================================== */

    await loadData();


})();
