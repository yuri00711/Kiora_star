(async function () {

    "use strict";


    const common =
        window.yuriArticles;


    if (!common) {
        console.error(
            "yuriArticles is unavailable."
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


    const esc =
        (value) =>
            common.escapeHtml(
                String(value ?? "")
            );


    const state = {

        games: [],

        prices: [],

        forecasts: [],

        wallets: [],

        calendarDate:
            new Date()

    };



    /* ==========================================
       HELPERS
    ========================================== */


    function setStatus(
        message = "",
        error = false
    ) {

        const node =
            $("#sale-status");

        if (!node) {
            return;
        }


        node.textContent =
            message;


        node.hidden =
            !message;


        node.style.color =
            error
                ? "#95616b"
                : "";

    }



    function gameTitle(
        game
    ) {

        return (
            game?.title ||
            game?.name ||
            game?.game_title ||
            game?.jp_title ||
            game?.cn_title ||
            `GAME #${game?.id ?? "?"}`
        );

    }



    function gameById(
        id
    ) {

        return state.games.find(
            (game) =>
                Number(game.id) ===
                Number(id)
        );

    }



    function currencySymbol(
        currency
    ) {

        if (
            currency === "HKD"
        ) {
            return "HK$";
        }


        if (
            currency === "JPY"
        ) {
            return "¥";
        }


        return "";

    }



    function formatMoney(
        value,
        currency
    ) {

        if (
            value === null ||
            value === undefined ||
            value === ""
        ) {
            return "—";
        }


        const number =
            Number(value);


        if (
            !Number.isFinite(number)
        ) {
            return "—";
        }


        if (
            currency === "JPY"
        ) {

            return (
                "¥" +
                Math.round(number)
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


        return String(value)
            .slice(0, 10);

    }



    function todayString() {

        const date =
            new Date();


        return (
            date.getFullYear() +
            "-" +
            String(
                date.getMonth() + 1
            ).padStart(2, "0") +
            "-" +
            String(
                date.getDate()
            ).padStart(2, "0")
        );

    }



    function isLiveSale(
        item
    ) {

        const today =
            todayString();


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
            start > today
        ) {
            return false;
        }


        if (
            end &&
            end < today
        ) {
            return false;
        }


        return true;

    }



    function currentSales() {

        /*
         * 一个游戏可能留下很多历史记录。
         *
         * 首页只取每个 game + region
         * 最新的一条。
         */

        const newest =
            new Map();


        const sorted =
            [...state.prices]
                .sort(
                    (a, b) =>
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
            const item of sorted
        ) {

            const key =
                `${item.game_id}:${item.region}`;


            if (
                newest.has(key)
            ) {
                continue;
            }


            newest.set(
                key,
                item
            );

        }


        return Array
            .from(
                newest.values()
            )
            .filter(
                isLiveSale
            );

    }



    function upcomingForecasts() {

        const today =
            todayString();


        return state.forecasts
            .filter(
                (item) =>
                    !item.predicted_start ||
                    item.predicted_start >=
                        today
            )
            .sort(
                (a, b) =>
                    String(
                        a.predicted_start ||
                        ""
                    )
                    .localeCompare(
                        String(
                            b.predicted_start ||
                            ""
                        )
                    )
            );

    }



    /* ==========================================
       LOAD
    ========================================== */


    async function loadData() {

        setStatus(
            "Reading sale constellation…"
        );


        try {

            if (auth) {

                await auth.initialize(
                    db
                );

            }


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
                        .limit(1000),

                    db
                        .from(
                            "game_price_history"
                        )
                        .select("*")
                        .order(
                            "observed_at",
                            {
                                ascending:
                                    false
                            }
                        )
                        .limit(2000),

                    db
                        .from(
                            "game_sale_forecasts"
                        )
                        .select("*")
                        .order(
                            "predicted_start",
                            {
                                ascending:
                                    true
                            }
                        )
                        .limit(1000)

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
             * 钱包不是公开信息。
             *
             * OWNER 登录时再读取。
             */

            if (
                auth?.role ===
                "owner"
            ) {

                const walletResult =
                    await db
                        .from(
                            "game_sale_wallets"
                        )
                        .select("*");


                if (
                    !walletResult.error
                ) {

                    state.wallets =
                        walletResult.data ||
                        [];

                }

            }


            setStatus("");

            renderAll();

        } catch (
            error
        ) {

            console.error(
                error
            );


            setStatus(
                `Sale data unavailable: ${
                    error?.message ||
                    error
                }`,
                true
            );

        }

    }



    /* ==========================================
       SUMMARY
    ========================================== */


    function renderSummary() {

        const live =
            currentSales();


        const forecasts =
            upcomingForecasts();


        $("#sale-game-count")
            .textContent =
            state.games.length;


        $("#sale-live-count")
            .textContent =
            live.length;


        $("#sale-forecast-count")
            .textContent =
            forecasts.length;

    }



    /* ==========================================
       REGION
    ========================================== */


    function renderRegion(
        region
    ) {

        const lower =
            region.toLowerCase();


        const live =
            currentSales()
                .filter(
                    (item) =>
                        item.region ===
                        region
                );


        const forecasts =
            upcomingForecasts()
                .filter(
                    (item) =>
                        item.region ===
                        region
                );


        $(
            `#sale-${lower}-live`
        ).textContent =
            live.length;


        $(
            `#sale-${lower}-forecast`
        ).textContent =
            forecasts.length;



        const wallet =
            state.wallets.find(
                (item) =>
                    item.region ===
                    region
            );


        const balanceNode =
            $(
                `#sale-${lower}-balance`
            );


        if (wallet) {

            balanceNode.textContent =
                formatMoney(
                    wallet.balance,
                    wallet.currency
                );

        } else {

            balanceNode.textContent =
                auth?.role ===
                "owner"
                    ? "0"
                    : "PRIVATE";

        }



        const preview =
            $(
                `#sale-${lower}-preview`
            );


        /*
         * 优先显示真实折扣。
         */

        if (
            live.length
        ) {

            preview.innerHTML =
                live
                    .slice(0, 4)
                    .map(
                        (item) => {

                            const game =
                                gameById(
                                    item.game_id
                                );


                            return `
                                <div
                                    class="sale-preview-item"
                                >
                                    <span>
                                        ${esc(
                                            gameTitle(
                                                game
                                            )
                                        )}
                                    </span>

                                    <strong>
                                        ${
                                            item.discount_percent
                                                ? `-${esc(
                                                      item.discount_percent
                                                  )}% · `
                                                : ""
                                        }

                                        ${esc(
                                            formatMoney(
                                                item.sale_price,
                                                item.currency
                                            )
                                        )}
                                    </strong>
                                </div>
                            `;

                        }
                    )
                    .join("");

            return;

        }



        /*
         * 没有实时折扣时显示预测。
         */

        if (
            forecasts.length
        ) {

            preview.innerHTML =
                forecasts
                    .slice(0, 4)
                    .map(
                        (item) => {

                            const game =
                                gameById(
                                    item.game_id
                                );


                            return `
                                <div
                                    class="sale-preview-item"
                                >
                                    <span>
                                        ${esc(
                                            gameTitle(
                                                game
                                            )
                                        )}
                                    </span>

                                    <strong>
                                        FORECAST ·
                                        ${esc(
                                            item.predicted_start ||
                                            "—"
                                        )}
                                    </strong>
                                </div>
                            `;

                        }
                    )
                    .join("");

            return;

        }



        preview.innerHTML = `
            <p
                class="sale-preview-empty"
            >
                No sale data yet.<br>
                等第一次价格记录进入之后，
                这里会自动出现。
            </p>
        `;

    }



    /* ==========================================
       CALENDAR
    ========================================== */


    function calendarEvents() {

        const events =
            [];


        for (
            const item of state.prices
        ) {

            const game =
                gameById(
                    item.game_id
                );


            if (
                item.sale_starts_at
            ) {

                events.push({
                    date:
                        dateOnly(
                            item.sale_starts_at
                        ),

                    kind:
                        "live",

                    region:
                        item.region,

                    title:
                        gameTitle(
                            game
                        ),

                    text:
                        item.discount_percent
                            ? `-${item.discount_percent}%`
                            : formatMoney(
                                  item.sale_price,
                                  item.currency
                              )
                });

            }

        }



        for (
            const item of state.forecasts
        ) {

            if (
                !item.predicted_start
            ) {
                continue;
            }


            const game =
                gameById(
                    item.game_id
                );


            events.push({
                date:
                    item.predicted_start,

                kind:
                    "forecast",

                region:
                    item.region,

                title:
                    gameTitle(
                        game
                    ),

                text:
                    item.predicted_discount_percent
                        ? `~${item.predicted_discount_percent}%`
                        : "FORECAST"
            });

        }


        return events;

    }



    function renderCalendar() {

        const year =
            state.calendarDate
                .getFullYear();


        const month =
            state.calendarDate
                .getMonth();


        const title =
            new Intl.DateTimeFormat(
                "en-US",
                {
                    month:
                        "long",
                    year:
                        "numeric"
                }
            )
            .format(
                state.calendarDate
            )
            .toUpperCase();


        $("#sale-calendar-title")
            .textContent =
            title;



        const first =
            new Date(
                year,
                month,
                1
            );


        /*
         * JS:
         * Sunday = 0
         *
         * 页面：
         * Monday = first column
         */

        const leading =
            (
                first.getDay() +
                6
            ) % 7;


        const totalDays =
            new Date(
                year,
                month + 1,
                0
            )
            .getDate();


        const events =
            calendarEvents();


        const cells =
            [];


        for (
            let index = 0;
            index < leading;
            index++
        ) {

            cells.push(`
                <div
                    class="sale-day is-empty"
                ></div>
            `);

        }



        const today =
            todayString();


        for (
            let day = 1;
            day <= totalDays;
            day++
        ) {

            const date =
                `${year}-${String(
                    month + 1
                ).padStart(
                    2,
                    "0"
                )}-${String(
                    day
                ).padStart(
                    2,
                    "0"
                )}`;


            const dayEvents =
                events
                    .filter(
                        (item) =>
                            item.date ===
                            date
                    )
                    .slice(
                        0,
                        5
                    );


            cells.push(`
                <div
                    class="
                        sale-day
                        ${
                            date ===
                            today
                                ? "is-today"
                                : ""
                        }
                    "
                >

                    <span
                        class="sale-day-number"
                    >
                        ${day}
                    </span>


                    ${
                        dayEvents
                            .map(
                                (event) => `
                                    <span
                                        class="
                                            sale-calendar-event
                                            ${
                                                event.kind ===
                                                "forecast"
                                                    ? "forecast"
                                                    : ""
                                            }
                                        "
                                    >
                                        ${esc(
                                            event.title
                                        )}

                                        <small>
                                            ${esc(
                                                event.region
                                            )}
                                            ·
                                            ${esc(
                                                event.text
                                            )}
                                        </small>
                                    </span>
                                `
                            )
                            .join("")
                    }

                </div>
            `);

        }



        while (
            cells.length % 7
        ) {

            cells.push(`
                <div
                    class="sale-day is-empty"
                ></div>
            `);

        }


        $("#sale-calendar")
            .innerHTML =
            cells.join("");

    }



    /* ==========================================
       EVENTS
    ========================================== */


    $("#sale-prev-month")
        ?.addEventListener(
            "click",
            () => {

                state.calendarDate =
                    new Date(
                        state.calendarDate
                            .getFullYear(),

                        state.calendarDate
                            .getMonth() -
                            1,

                        1
                    );


                renderCalendar();

            }
        );


    $("#sale-next-month")
        ?.addEventListener(
            "click",
            () => {

                state.calendarDate =
                    new Date(
                        state.calendarDate
                            .getFullYear(),

                        state.calendarDate
                            .getMonth() +
                            1,

                        1
                    );


                renderCalendar();

            }
        );


    $("#sale-today")
        ?.addEventListener(
            "click",
            () => {

                state.calendarDate =
                    new Date();


                renderCalendar();

            }
        );



    /* ==========================================
       RENDER
    ========================================== */


    function renderAll() {

        renderSummary();

        renderRegion(
            "HK"
        );

        renderRegion(
            "JP"
        );

        renderCalendar();

    }



    /* ==========================================
       START
    ========================================== */


    await loadData();


})();