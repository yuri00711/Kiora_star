(function () {
    "use strict";

    const PAGE_WIDTH = 1280;
    const PADDING = 54;
    const CARD_WIDTH = 153;
    const COVER_WIDTH = 112;
    const COVER_HEIGHT = 148;
    const COLUMNS = 6;
    const COLORS = ["#82cddd", "#e9a6c4", "#edcf78", "#b5a6d6", "#9acdb7"];
    const FONT = '"Yu Gothic", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

    function sorted(rows) {
        return [...rows].sort((a, b) => (a.sort_order ?? 999999) - (b.sort_order ?? 999999) || String(a.id).localeCompare(String(b.id)));
    }

    function layout(board, sections, items, games, showNames) {
        const gameMap = new Map(games.map((game) => [String(game.id), game]));
        const ordered = sorted(sections).map((section) => ({
            section,
            games: sorted(items.filter((item) => String(item.section_id) === String(section.id)))
                .map((item) => gameMap.get(String(item.game_id))).filter(Boolean)
        }));
        const gameCount = ordered.reduce((total, row) => total + row.games.length, 0);
        if (!board || !gameCount) return { rows: ordered, gameCount: 0, height: 0 };
        const cardHeight = showNames ? 190 : 164;
        ordered.forEach((row) => {
            row.height = Math.max(184, 30 + Math.ceil(row.games.length / COLUMNS) * cardHeight);
        });
        return {
            rows: ordered,
            gameCount,
            cardHeight,
            height: 196 + ordered.reduce((total, row) => total + row.height + 10, 0) + 88
        };
    }

    function loadImage(url) {
        return new Promise((resolve) => {
            if (!url) return resolve(null);
            const image = new Image();
            let settled = false;
            const complete = (result) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                resolve(result);
            };
            const timeout = setTimeout(() => complete(null), 8000);
            image.crossOrigin = "anonymous";
            image.onload = () => complete(image);
            image.onerror = () => complete(null);
            image.src = url;
        });
    }

    function roundRect(ctx, x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + width, y, x + width, y + height, r);
        ctx.arcTo(x + width, y + height, x, y + height, r);
        ctx.arcTo(x, y + height, x, y, r);
        ctx.arcTo(x, y, x + width, y, r);
        ctx.closePath();
    }

    function fitText(ctx, value, maxWidth) {
        let text = String(value || "");
        if (ctx.measureText(text).width <= maxWidth) return text;
        while (text && ctx.measureText(`${text}…`).width > maxWidth) text = text.slice(0, -1);
        return `${text}…`;
    }

    function drawCover(ctx, game, image, x, y, showNames) {
        ctx.save();
        roundRect(ctx, x, y, COVER_WIDTH, COVER_HEIGHT, 7);
        ctx.clip();
        ctx.fillStyle = "#f1e9f2";
        ctx.fillRect(x, y, COVER_WIDTH, COVER_HEIGHT);
        if (image?.naturalWidth && image?.naturalHeight) {
            const scale = Math.max(COVER_WIDTH / image.naturalWidth, COVER_HEIGHT / image.naturalHeight);
            const sourceWidth = COVER_WIDTH / scale;
            const sourceHeight = COVER_HEIGHT / scale;
            ctx.drawImage(image, (image.naturalWidth - sourceWidth) / 2, (image.naturalHeight - sourceHeight) / 2, sourceWidth, sourceHeight, x, y, COVER_WIDTH, COVER_HEIGHT);
        } else {
            ctx.fillStyle = "#a687af";
            ctx.font = `600 23px ${FONT}`;
            ctx.textAlign = "center";
            ctx.fillText("✦", x + COVER_WIDTH / 2, y + 70);
            if (!showNames) {
                ctx.fillStyle = "#78687c";
                ctx.font = `12px ${FONT}`;
                ctx.fillText(fitText(ctx, game.title || "タイトル未設定", COVER_WIDTH - 16), x + COVER_WIDTH / 2, y + 99);
            }
        }
        ctx.restore();
        ctx.strokeStyle = "#ded6e2";
        ctx.lineWidth = 1;
        roundRect(ctx, x + .5, y + .5, COVER_WIDTH - 1, COVER_HEIGHT - 1, 7);
        ctx.stroke();
    }

    async function render({ board, sections = [], items = [], games = [], showNames = true, pixelRatio = 1, safeUrl = (value) => value }) {
        const plan = layout(board, sections, items, games, showNames);
        if (!plan.gameCount) return { canvas: null, gameCount: 0, missingCovers: 0 };
        await document.fonts?.ready;
        const ratio = Math.max(1, Math.min(2, Number(pixelRatio) || 1));
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(PAGE_WIDTH * ratio);
        canvas.height = Math.ceil(plan.height * ratio);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("画像の描画を開始できませんでした。");
        ctx.scale(ratio, ratio);

        const uniqueGames = [...new Map(plan.rows.flatMap((row) => row.games).map((game) => [String(game.id), game])).values()];
        const loaded = await Promise.all(uniqueGames.map(async (game) => [String(game.id), await loadImage(safeUrl(game.cover_url))]));
        const images = new Map(loaded);
        const missingCovers = loaded.filter(([, image]) => !image).length;

        ctx.fillStyle = "#fffcf8";
        ctx.fillRect(0, 0, PAGE_WIDTH, plan.height);
        const wash = ctx.createLinearGradient(0, 0, PAGE_WIDTH, 190);
        wash.addColorStop(0, "#eaf8fa");
        wash.addColorStop(.58, "#f8f4fb");
        wash.addColorStop(1, "#fff0f4");
        ctx.fillStyle = wash;
        ctx.fillRect(0, 0, PAGE_WIDTH, 188);
        ctx.fillStyle = "#83d0dd";
        ctx.fillRect(0, 0, 9, 188);
        ctx.fillStyle = "#665d72";
        ctx.font = `700 15px ${FONT}`;
        ctx.fillText("わたしのゲーム棚  /  好きな作品の記録", PADDING, 44);
        ctx.fillStyle = "#3d4d61";
        ctx.font = `700 43px ${FONT}`;
        ctx.fillText(fitText(ctx, board.title || "タイトル未設定", 900), PADDING, 104);
        if (board.description) {
            ctx.fillStyle = "#6d6875";
            ctx.font = `16px ${FONT}`;
            ctx.fillText(fitText(ctx, board.description, 900), PADDING, 139);
        }
        ctx.textAlign = "right";
        ctx.fillStyle = "#8d688b";
        ctx.font = `700 16px ${FONT}`;
        ctx.fillText(`${plan.gameCount} 作品`, PAGE_WIDTH - PADDING, 104);
        ctx.textAlign = "left";
        ctx.fillStyle = "#e8b4cd";
        ctx.fillRect(PADDING, 169, PAGE_WIDTH - PADDING * 2, 2);

        let y = 196;
        plan.rows.forEach((row, index) => {
            const accent = COLORS[index % COLORS.length];
            ctx.fillStyle = index % 2 ? "#fcf8fb" : "#f4f9fa";
            roundRect(ctx, PADDING, y, PAGE_WIDTH - PADDING * 2, row.height, 13);
            ctx.fill();
            ctx.fillStyle = accent;
            roundRect(ctx, PADDING, y, 7, row.height, 3);
            ctx.fill();
            ctx.fillStyle = "#88718a";
            ctx.font = `700 13px ${FONT}`;
            ctx.fillText(`段 ${String(index + 1).padStart(2, "0")}`, PADDING + 25, y + 36);
            ctx.fillStyle = "#4c4659";
            ctx.font = `700 23px ${FONT}`;
            ctx.fillText(fitText(ctx, row.section.title || "名前のない段", 170), PADDING + 25, y + 73);
            if (row.section.description) {
                ctx.fillStyle = "#817986";
                ctx.font = `12px ${FONT}`;
                ctx.fillText(fitText(ctx, row.section.description, 170), PADDING + 25, y + 99);
            }
            if (!row.games.length) {
                ctx.fillStyle = "#9f929e";
                ctx.font = `13px ${FONT}`;
                ctx.fillText("まだ作品がありません", 310, y + 75);
            }
            row.games.forEach((game, gameIndex) => {
                const x = 300 + (gameIndex % COLUMNS) * CARD_WIDTH;
                const cardY = y + 20 + Math.floor(gameIndex / COLUMNS) * plan.cardHeight;
                drawCover(ctx, game, images.get(String(game.id)), x, cardY, showNames);
                if (showNames) {
                    ctx.fillStyle = "#554d5d";
                    ctx.font = `12px ${FONT}`;
                    ctx.fillText(fitText(ctx, game.title || "タイトル未設定", COVER_WIDTH), x, cardY + COVER_HEIGHT + 18);
                }
            });
            y += row.height + 10;
        });

        ctx.strokeStyle = "#e6dce6";
        ctx.beginPath();
        ctx.moveTo(PADDING, plan.height - 65);
        ctx.lineTo(PAGE_WIDTH - PADDING, plan.height - 65);
        ctx.stroke();
        ctx.fillStyle = "#746b7c";
        ctx.font = `13px ${FONT}`;
        ctx.fillText("Kiora · ゲームの記録", PADDING, plan.height - 37);
        ctx.textAlign = "right";
        ctx.fillText(new Date().toLocaleDateString("ja-JP").replaceAll("/", "."), PAGE_WIDTH - PADDING, plan.height - 37);
        return { canvas, gameCount: plan.gameCount, missingCovers };
    }

    window.KioraTierExport = { render, layout };
})();
