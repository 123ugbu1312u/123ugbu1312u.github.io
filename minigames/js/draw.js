/*
 * draw.js —— 移植自 Codes/DrawScene.cs（1:1 对照，未改动任何坐标/字号/配色/文案）
 * ------------------------------------------------------------------
 * 加载方式：经典 <script>，非 ES Module；IIFE 包裹。
 * 依赖：core.js（NB.G / NB.M / NB.Color / NB.Profile / NB.Economy）
 *       levels.js（NB.Levels.count）
 *       meta.js（NB.Meta.shakeOn / particleOn）
 *       render.js（NB.Draw 绘制基元 / NB.UI 即时模式组件）
 *       shop.js（NB.Shop.drawShop / NB.Shop.drawPill）、pauseitems.js（NB.PauseItems.draw）
 *
 * 职责边界（严格）：本文件只负责「绘制 + 命中区域注册」。
 *   状态机入口（StartGame / ChooseUpgrade / UseReviveCard / 回到主菜单 / 重开）不在本文件，
 *   由下一阶段 game.js 在 handleClick 中根据 NB.UI.hitId() 判定后调用；
 *   本文件通过 NB.UI.addHot 注册可点击区域，id 与 game.js 约定见 移植映射说明.md。
 *
 * 绘制函数统一签名：drawXxx(ctx, g)，其中
 *   ctx —— CanvasRenderingContext2D（C# 的 Graphics）
 *   g   —— 游戏状态对象（game.js 提供，只读；字段清单见下方 STATE CONTRACT）
 *
 * STATE CONTRACT（draw.js 只读这些字段，缺省由 game.js 补齐）：
 *   g.state            'menu'|'help'|'shop'|'play'|'pause'|'upgrade'|'gameover'|'win'
 *   g.gameTime         秒，累计动画时钟
 *   g.runTime          本局时长（秒）
 *   g.backdrop         NB.Draw.BuildBackdrop 产物（离屏 canvas，可为 null）
 *   g.mousePos         {x,y} 逻辑坐标（viewScale 换算后）
 *   g.score / g.displayScore / g.combo / g.comboT / g.bestCombo / g.lives
 *   g.levelIndex / g.levelName / g.wave / g.endlessMode
 *   g.stats            NB.Stats（shieldCharges 等）
 *   g.bricks / g.balls / g.drops / g.parts  数组
 *   g.lasers          [{x,y,w,life}]
 *   g.paddleX / g.paddleW
 *   g.shake / g.flashWhite / g.banner / g.bannerT / g.bannerColor
 *   g.kitNotice / g.kitNoticeT / g.hintT / g.levelHint
 *   g.toast / g.toastT / g.toastColor
 *   g.offers          NB.Upgrade[]（升级三选一）
 *   g.upgradeAnim / g.lastReward / g.lastRewardLucky
 *   g.lastSettlePoints / g.newRecord / g.pitOpen
 *
 * 视口缩放（C# viewOffX/viewOffY/viewScale、Replay 离屏渲染）由 game.js 主循环负责，
 * 本文件所有绘制均使用 1280×800 逻辑坐标，与源码同一坐标系。
 */
(function () {
    'use strict';

    var NB = globalThis.NB = globalThis.NB || {};
    var G = NB.G;
    var M = NB.M;
    var Color = NB.Color;
    var Profile = NB.Profile;
    var Economy = NB.Economy;

    // 延迟取，避免脚本加载顺序影响（render.js 已在前，但保持与其它模块一致）
    function DR() { return NB.Draw; }
    function UI() { return NB.UI; }

    // ===================== 状态枚举（C# State） =====================
    var State = {
        Menu: 'menu',
        Help: 'help',
        Shop: 'shop',
        Play: 'play',
        Pause: 'pause',
        Upgrade: 'upgrade',
        GameOver: 'gameover',
        Win: 'win'
    };
    NB.State = NB.State || State;

    // ===================== 界面布局常量（逐项对照 DrawScene.cs） =====================
    var RMenuCampaign = { x: 470, y: 348, w: 340, h: 72 };
    var RMenuEndless = { x: 470, y: 428, w: 340, h: 72 };
    var RMenuShop = { x: 330, y: 518, w: 196, h: 56 };
    var RMenuUpgrade = { x: 542, y: 518, w: 196, h: 56 };
    var RMenuSet = { x: 754, y: 518, w: 196, h: 56 };
    var RMenuHelp = { x: 410, y: 584, w: 220, h: 52 };
    var RMenuQuit = { x: 650, y: 584, w: 220, h: 52 };
    var RHelpBack = { x: 540, y: 620, w: 200, h: 54 };

    var RPauseResume = { x: 500, y: 286, w: 280, h: 60 };
    var RPauseItems = { x: 500, y: 358, w: 280, h: 60 };
    var RPauseRestart = { x: 500, y: 430, w: 280, h: 60 };
    var RPauseMenu = { x: 500, y: 502, w: 280, h: 60 };

    var REndRetry = { x: 410, y: 492, w: 220, h: 58 };
    var REndMenu = { x: 650, y: 492, w: 220, h: 58 };
    var REndNext = { x: 410, y: 492, w: 220, h: 58 };
    var REndRevive = { x: 530, y: 566, w: 220, h: 56 };

    // C# RectangleF CardRect(int i) => new RectangleF(190 + i*310, 252, 280, 384)
    function cardRect(i) { return { x: 190 + i * 310, y: 252, w: 280, h: 384 }; }

    // ===================== 小工具 =====================
    // C# GameForm.Hit(r,p)
    function hitRect(r, p) {
        return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    }

    // C# TimeStr(float sec)： (int)sec → "m:ss"
    function timeStr(sec) {
        var s = Math.trunc(sec);
        var mm = Math.trunc(s / 60);
        var ss = s % 60;
        return mm + ':' + (ss < 10 ? '0' + ss : String(ss));
    }

    // C# ToString("N0")
    function n0(v) { return Economy.fmt(Math.trunc(v)); }
    // C# ToString("0.00")
    function f2(v) { return Number(v).toFixed(2); }

    // C# Capsule(...) → UiKit.Capsule
    function capsule(ctx, r, text, sub, tint, enabled, selected) {
        UI().capsule(ctx, r, text, sub, tint, enabled, selected);
    }
    // C# ScrollBar(...) → UiKit.ScrollBar
    function scrollBar(ctx, track, maxScroll, pos, tint) {
        UI().scrollBar(ctx, track, maxScroll, pos, tint);
    }
    // C# DrawPill(...)（定义在 Shop.cs，见 shop.js）
    function drawPill(ctx, r, label, value, tint, progress) {
        NB.Shop.drawPill(ctx, r, label, value, tint, progress);
    }

    // 90° 垂直线性渐变填充矩形（C# LinearGradientBrush(rect, c1, c2, 90f)）
    function fillRectGradV(ctx, x, y, w, h, top, bottom) {
        if (w <= 0 || h <= 0) return;
        var grd;
        try { grd = ctx.createLinearGradient(x, y, x, y + h); } catch (e) { return; }
        grd.addColorStop(0, Color.rgba(top));
        grd.addColorStop(1, Color.rgba(bottom));
        ctx.fillStyle = grd;
        ctx.fillRect(x, y, w, h);
    }

    var DrawScene = {
        State: State,

        // 布局常量（供 game.js 命中判定与文档对照）
        RMenuCampaign: RMenuCampaign, RMenuEndless: RMenuEndless,
        RMenuShop: RMenuShop, RMenuUpgrade: RMenuUpgrade, RMenuSet: RMenuSet,
        RMenuHelp: RMenuHelp, RMenuQuit: RMenuQuit, RHelpBack: RHelpBack,
        RPauseResume: RPauseResume, RPauseItems: RPauseItems,
        RPauseRestart: RPauseRestart, RPauseMenu: RPauseMenu,
        REndRetry: REndRetry, REndMenu: REndMenu, REndNext: REndNext, REndRevive: REndRevive,
        cardRect: cardRect,
        hitRect: hitRect,
        timeStr: timeStr,

        // 帮助页滚动状态（C# DrawScene : helpScroll / helpMaxScroll，模块级状态）
        helpScroll: 0,
        helpMaxScroll: 0,

        // C# GameForm.ShowToast(string text, Color c)
        //   toast = text; toastColor = c; toastT = 1.5f
        // 由 shop.js / pauseitems.js / game.js 复用，保证提示文案与配色同源。
        showToast: function (g, text, c) {
            if (!g) return;
            g.toast = text;
            g.toastColor = c;
            g.toastT = 1.5;
        },

        // ===================== 主绘制（C# OnPaint 的状态分发） =====================
        // 只做「背景 + 状态分发 + 边框 + Toast」；离屏回放/缩放由 game.js 负责。
        draw: function (ctx, g) {
            DR().Quality(ctx);
            ctx.setTransform(1, 0, 0, 1, 0, 0);

            // C# 字段 mousePos：Capsule / Hit 等 UiKit 命中判定依赖它
            UI().mouse = { x: g.mousePos.x, y: g.mousePos.y };
            UI().uiDt = (g.dt === undefined || g.dt === null) ? 0.016 : g.dt;

            // canvas.Clear(G.BgTop)
            ctx.fillStyle = Color.rgba(G.BgTop);
            ctx.fillRect(0, 0, G.W, G.H);

            // if (backdrop != null) canvas.DrawImageUnscaled(backdrop, 0, 0)
            if (g.backdrop) ctx.drawImage(g.backdrop, 0, 0);

            UI().begin();

            switch (g.state) {
                case State.Menu: this.drawMenu(ctx, g); break;
                case State.Help: this.drawHelp(ctx, g); break;
                case State.Shop: NB.Shop.drawShop(ctx, g); break;
                case State.Play: this.drawWorld(ctx, g); this.drawHUD(ctx, g); break;
                case State.Pause: this.drawWorld(ctx, g); this.drawHUD(ctx, g); this.drawPause(ctx, g); break;
                case State.Upgrade: this.drawWorld(ctx, g); this.drawHUD(ctx, g); this.drawUpgrade(ctx, g); break;
                case State.GameOver: this.drawWorld(ctx, g); this.drawHUD(ctx, g); this.drawEnd(ctx, g, false); break;
                case State.Win: this.drawWorld(ctx, g); this.drawHUD(ctx, g); this.drawEnd(ctx, g, true); break;
            }

            this.drawFrame(ctx, g);
            this.drawToast(ctx, g);
        },

        // ===================== 外框（C# DrawFrame） =====================
        drawFrame: function (ctx, g) {
            ctx.lineWidth = 2;
            ctx.strokeStyle = Color.rgba(Color.fromArgb(70, G.NeonCyan));
            ctx.strokeRect(1, 1, G.W - 2, G.H - 2);

            ctx.lineWidth = 6;
            ctx.strokeStyle = Color.rgba(Color.fromArgb(26, G.NeonPurple));
            ctx.strokeRect(5, 5, G.W - 10, G.H - 10);

            // 四角装饰
            var c = G.NeonCyan;
            ctx.strokeStyle = Color.rgba(M.withAlpha(c, 210));
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(0, 0); ctx.lineTo(46, 0);
            ctx.moveTo(0, 0); ctx.lineTo(0, 46);
            ctx.moveTo(G.W, 0); ctx.lineTo(G.W - 46, 0);
            ctx.moveTo(G.W, 0); ctx.lineTo(G.W, 46);
            ctx.moveTo(0, G.H); ctx.lineTo(46, G.H);
            ctx.moveTo(0, G.H); ctx.lineTo(0, G.H - 46);
            ctx.moveTo(G.W, G.H); ctx.lineTo(G.W - 46, G.H);
            ctx.moveTo(G.W, G.H); ctx.lineTo(G.W, G.H - 46);
            ctx.stroke();
        },

        // ===================== Toast（C# DrawToast） =====================
        drawToast: function (ctx, g) {
            if (!(g.toastT > 0)) return;
            var a = Math.min(1, g.toastT * 2.2);
            var s = String(g.toast == null ? '' : g.toast);
            var f = DR().UIFont(22);
            var sz = DR().Measure(ctx, s, f);
            var w = sz.width + 48, h = 48;
            var x = G.W * 0.5 - w * 0.5, y = 122;
            DR().FillRound(ctx, { x: x, y: y, w: w, h: h }, 10, Color.fromArgb(Math.trunc(190 * a), 12, 10, 26));
            DR().StrokeRound(ctx, { x: x, y: y, w: w, h: h }, 10,
                M.withAlpha(g.toastColor || G.NeonCyan, Math.trunc(220 * a)), 1.6);
            DR().TextCenter(ctx, s, f, M.withAlpha(g.toastColor || G.NeonCyan, Math.trunc(255 * a)),
                G.W * 0.5, y + 10);
        },

        // ===================== 世界（C# DrawWorld） =====================
        drawWorld: function (ctx, g) {
            ctx.save();
            var shk = NB.Meta.shakeOn ? (g.shake || 0) : 0;
            if (shk > 0.1) {
                var sx = (Math.random() - 0.5) * shk;
                var sy = (Math.random() - 0.5) * shk;
                ctx.translate(sx, sy);
            }

            // 顶部柔光带：RectangleF(0, 80, G.W, 26)，FromArgb(38,90,220,255) → 透明，90°
            fillRectGradV(ctx, 0, 80, G.W, 26,
                Color.fromArgb(38, 90, 220, 255), Color.fromArgb(0, 0, 0, 0));

            // 砖块
            var bricks = g.bricks || [];
            for (var i = 0; i < bricks.length; i++) if (!bricks[i].dead) this.drawBrick(ctx, g, bricks[i]);

            // 掉落物
            var drops = g.drops || [];
            for (var d = 0; d < drops.length; d++) this.drawDrop(ctx, g, drops[d]);

            // 激光
            var lasers = g.lasers || [];
            for (var k = 0; k < lasers.length; k++) {
                var l = lasers[k];
                var a = Math.min(1, l.life / 0.16);
                fillRectGradV(ctx, l.x - l.w * 0.5, 60, l.w, G.PaddleY - 60,
                    Color.fromArgb(Math.trunc(10 * a), G.NeonPink),
                    Color.fromArgb(Math.trunc(225 * a), 255, 255, 255));
                ctx.fillStyle = Color.rgba(Color.fromArgb(Math.trunc(240 * a), 255, 255, 255));
                ctx.beginPath();
                ctx.arc(l.x, G.PaddleY - 21, 5, 0, Math.PI * 2);   // C# FillEllipse(l.X-5, PaddleY-26, 10, 10)
                ctx.fill();
            }

            // 挡板
            this.drawPaddle(ctx, g);

            // 球
            var balls = g.balls || [];
            for (var b = 0; b < balls.length; b++) this.drawBall(ctx, g, balls[b]);

            // 粒子
            this.drawParticles(ctx, g);

            ctx.restore();
        },

        // ===================== 砖块（C# DrawBrick） =====================
        drawBrick: function (ctx, g, b) {
            var t = M.clamp(b.spawn, 0, 1);
            if (t <= 0.02) return;
            var y = b.y - (1 - t) * 14;
            var r = { x: b.x, y: y, w: b.w, h: b.h };

            // 不可破坏砖：深底 + 斜线剖面
            if (b.type === NB.BrickType.Unbreak) {
                DR().FillRound(ctx, r, 7, Color.fromArgb(215, 38, 40, 56));
                // C# HatchBrush(HatchStyle.LightUpwardDiagonal, FromArgb(70,120,130,160), Transparent)
                ctx.save();
                DR().RoundRect(ctx, r, 7);
                ctx.clip();
                ctx.strokeStyle = Color.rgba(Color.fromArgb(70, 120, 130, 160));
                ctx.lineWidth = 1.4;
                ctx.beginPath();
                for (var hx = r.x - r.h; hx < r.x + r.w + r.h; hx += 7) {
                    ctx.moveTo(hx, r.y + r.h);
                    ctx.lineTo(hx + r.h, r.y);
                }
                ctx.stroke();
                ctx.restore();

                DR().StrokeRound(ctx, r, 7, Color.fromArgb(170, 96, 104, 138), 1.4);
                if (b.flash > 0) DR().FillRound(ctx, r, 7, Color.fromArgb(Math.trunc(120 * b.flash), 255, 255, 255));
                return;
            }

            var tint = b.tint;
            var hpRatio = b.maxHp > 0 ? b.hp / b.maxHp : 1;

            // 主体（上下渐变）
            var fillTop = M.mix(Color.fromArgb(18, 16, 36), tint, 0.30 + 0.18 * hpRatio);
            var fillBot = M.mix(Color.fromArgb(10, 9, 22), tint, 0.20 + 0.12 * hpRatio);
            DR().FillRoundGradient(ctx, r, 7,
                M.withAlpha(fillTop, Math.trunc(245 * t)),
                M.withAlpha(fillBot, Math.trunc(245 * t)));

            // 顶部高光：RectangleF(r.X + 5, r.Y + 3.5f, r.Width - 10, 6f)
            DR().FillRound(ctx, { x: r.x + 5, y: r.y + 3.5, w: r.w - 10, h: 6 }, 3,
                M.withAlpha(tint, Math.trunc(110 * t)));

            // 边框辉光
            DR().GlowRound(ctx, r, 7, M.withAlpha(tint, Math.trunc(255 * t)), 2);

            // 特殊标记
            if (b.type === NB.BrickType.Bomb) {
                var pulse = 0.5 + 0.5 * Math.sin(g.gameTime * 6 + b.baseX * 0.05);
                DR().Sparkle(ctx, r.x + r.w * 0.5, r.y + r.h * 0.5, 8 + pulse * 3,
                    M.withAlpha(Color.White, Math.trunc(200 * t)));
            } else if (b.type === NB.BrickType.Moving) {
                ctx.fillStyle = Color.rgba(M.withAlpha(Color.White, Math.trunc(120 * t)));
                var cy = r.y + r.h * 0.5;
                ctx.beginPath();
                ctx.moveTo(r.x + 10, cy - 5); ctx.lineTo(r.x + 16, cy); ctx.lineTo(r.x + 10, cy + 5);
                ctx.closePath(); ctx.fill();
                ctx.beginPath();
                ctx.moveTo(r.x + r.w - 10, cy - 5); ctx.lineTo(r.x + r.w - 16, cy); ctx.lineTo(r.x + r.w - 10, cy + 5);
                ctx.closePath(); ctx.fill();
            } else if (b.type === NB.BrickType.Nova) {
                var pulse2 = 0.5 + 0.5 * Math.sin(g.gameTime * 5);
                var cx = r.x + r.w * 0.5;
                DR().Sparkle(ctx, cx, r.y + r.h * 0.5, 14 + pulse2 * 8,
                    M.withAlpha(Color.fromArgb(255, 170, 120), Math.trunc(190 * t)));
                DR().StrokeRound(ctx, r, 7, M.withAlpha(G.NeonYellow, Math.trunc((210 + 45 * pulse2) * t)), 2.2);
                DR().TextCenter(ctx, "TNT", DR().NumFont(15), M.withAlpha(Color.White, Math.trunc(245 * t)),
                    cx, r.y + 5);
            }

            // 血量条
            if (b.maxHp > 1) {
                var pad = 8;
                var barW = r.w - pad * 2;
                var bw = barW / b.maxHp;
                var n = Math.min(b.maxHp, 8);
                for (var i = 0; i < n; i++) {
                    var cc = i < b.hp
                        ? Color.fromArgb(Math.trunc(230 * t), 255, 255, 255)
                        : Color.fromArgb(Math.trunc(45 * t), 255, 255, 255);
                    DR().FillRound(ctx,
                        { x: r.x + pad + i * bw + 1.2, y: r.y + r.h - 8, w: bw - 2.4, h: 3.2 }, 1.6, cc);
                }
            }

            // 受击闪白
            if (b.flash > 0) DR().FillRound(ctx, r, 7, Color.fromArgb(Math.trunc(150 * b.flash), 255, 255, 255));
        },

        // ===================== 球（C# DrawBall） =====================
        drawBall: function (ctx, g, ball) {
            // 拖尾
            if (!ball.stuck) {
                var trail = ball.trail || [];
                for (var i = 0; i < trail.length; i++) {
                    var k = (i + 1) / trail.length;
                    var rad = ball.r * (0.35 + 0.5 * k);
                    var a = Math.trunc(95 * k);
                    ctx.fillStyle = Color.rgba(Color.fromArgb(a, G.NeonCyan));
                    ctx.beginPath();
                    ctx.arc(trail[i].x, trail[i].y, rad, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            // 光晕
            var pulse = 0.85 + 0.15 * Math.sin(ball.glowPhase);
            for (var j = 3; j >= 1; j--) {
                var rad2 = ball.r * (1.4 + j * 0.75) * pulse;
                var a2 = Math.trunc(26 / j);
                ctx.fillStyle = Color.rgba(Color.fromArgb(a2, G.NeonCyan));
                ctx.beginPath();
                ctx.arc(ball.x, ball.y, rad2, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.fillStyle = Color.rgba(Color.fromArgb(255, 250, 255, 255));
            ctx.beginPath();
            ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = Color.rgba(M.withAlpha(G.NeonCyan, 200));
            ctx.beginPath();
            ctx.arc(ball.x, ball.y, ball.r * 0.55, 0, Math.PI * 2);
            ctx.fill();

            // 未发射提示
            if (ball.stuck) {
                ctx.strokeStyle = Color.rgba(Color.fromArgb(
                    120 + Math.trunc(80 * Math.sin(g.gameTime * 5)), 255, 255, 255));
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(ball.x, ball.y - ball.r - 8); ctx.lineTo(ball.x, ball.y - ball.r - 20);
                ctx.moveTo(ball.x - 5, ball.y - ball.r - 15); ctx.lineTo(ball.x, ball.y - ball.r - 21);
                ctx.moveTo(ball.x + 5, ball.y - ball.r - 15); ctx.lineTo(ball.x, ball.y - ball.r - 21);
                ctx.stroke();
            }
        },

        // ===================== 挡板（C# DrawPaddle） =====================
        drawPaddle: function (ctx, g) {
            var w = g.paddleW;
            var x = g.paddleX - w * 0.5;
            var r = { x: x, y: G.PaddleY, w: w, h: G.PaddleH };

            // 底部光晕：LinearGradientBrush(rect(x-30, PaddleY+PaddleH, w+60, 40), FromArgb(70,NeonCyan), FromArgb(0,NeonCyan), 90f)
            var grd;
            try { grd = ctx.createLinearGradient(0, G.PaddleY + G.PaddleH, 0, G.PaddleY + G.PaddleH + 40); } catch (e) { grd = null; }
            if (grd) {
                grd.addColorStop(0, Color.rgba(Color.fromArgb(70, G.NeonCyan.r, G.NeonCyan.g, G.NeonCyan.b)));
                grd.addColorStop(1, Color.rgba(Color.fromArgb(0, G.NeonCyan.r, G.NeonCyan.g, G.NeonCyan.b)));
                ctx.fillStyle = grd;
                ctx.fillRect(x - 30, G.PaddleY + G.PaddleH, w + 60, 40);
            }

            DR().FillRoundGradient(ctx, r, 8,
                Color.fromArgb(255, 225, 255, 255), Color.fromArgb(255, G.NeonCyan.r, G.NeonCyan.g, G.NeonCyan.b));
            DR().GlowRound(ctx, r, 8, G.NeonCyan, 3);

            // 两端亮点（C# FillEllipse(x-2, PaddleY+3, 10, 10) / (x+w-8, ...)）
            ctx.fillStyle = Color.rgba(Color.White);
            ctx.beginPath(); ctx.arc(x - 2 + 5, G.PaddleY + 3 + 5, 5, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(x + w - 8 + 5, G.PaddleY + 3 + 5, 5, 0, Math.PI * 2); ctx.fill();

            // 中央标记
            DR().FillRound(ctx, { x: g.paddleX - 14, y: G.PaddleY + 6, w: 28, h: 4 }, 2,
                Color.fromArgb(150, 20, 40, 60));
        },

        // ===================== 掉落物（C# DrawDrop） =====================
        drawDrop: function (ctx, g, d) {
            var c = NB.Drop.colorOf(d.kind);
            var bob = Math.sin(d.phase) * 2.5;
            var r = { x: d.x - 17, y: d.y - 17 + bob, w: 34, h: 34 };
            for (var i = 2; i >= 1; i--) {
                var pad = i * 3;
                DR().StrokeRound(ctx,
                    { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 },
                    (r.w + pad * 2) * 0.35, M.withAlpha(c, 40), 2);
            }
            DR().FillRound(ctx, r, 10, Color.fromArgb(235, 14, 12, 28));
            DR().StrokeRound(ctx, r, 10, c, 2);
            DR().TextCenter(ctx, NB.Drop.glyphOf(d.kind), DR().NumFont(19), c, d.x, d.y - 12 + bob);
        },

        // ===================== 粒子（C# DrawParticles） =====================
        drawParticles: function (ctx, g) {
            if (!NB.Meta.particleOn) return;
            var parts = g.parts || [];
            if (parts.length === 0) return;
            for (var i = 0; i < parts.length; i++) {
                var p = parts[i];
                var k = p.life / p.maxLife;
                if (k <= 0) continue;
                ctx.fillStyle = Color.rgba(Color.fromArgb(Math.trunc(230 * Math.min(1, k * 1.6)), p.c.r, p.c.g, p.c.b));
                var s = p.size * (0.4 + k * 0.8);
                if (p.square) {
                    ctx.fillRect(p.x - s * 0.5, p.y - s * 0.5, s, s);
                } else {
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, s * 0.5, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        },

        // ===================== HUD（C# DrawHUD） =====================
        drawHUD: function (ctx, g) {
            // 顶部渐变条：LinearGradientBrush(rect(0,0,W,92), FromArgb(190,6,5,16) → FromArgb(0,6,5,16), 90f)
            fillRectGradV(ctx, 0, 0, G.W, 92,
                Color.fromArgb(190, 6, 5, 16), Color.fromArgb(0, 6, 5, 16));

            // 分数
            DR().TextLeft(ctx, "SCORE", DR().UIFont(13), G.TextDim, 34, 16);
            DR().TextLeft(ctx, n0(g.displayScore), DR().NumFont(40), Color.White, 32, 30);
            DR().TextLeft(ctx, "≈+" + NB.Economy.settlePoints(Math.trunc(g.displayScore)) + " 积分",
                DR().UIFontLight(15), M.withAlpha(G.NeonYellow, 210), 205, 50);

            // 连击
            if (g.combo >= 2) {
                var pulse = 1 + 0.06 * Math.sin(g.gameTime * 12);
                var cs = "COMBO x" + g.combo;
                var cf = DR().UIFont(Math.trunc(26 * pulse));
                DR().GlowTextCenter(ctx, cs, cf, G.NeonYellow, G.NeonOrange, G.W * 0.5, 26, 3);
                // 连击剩余时间条
                var k2 = M.clamp(g.comboT / 2.6, 0, 1);
                DR().FillRound(ctx, { x: G.W * 0.5 - 70, y: 62, w: 140 * k2, h: 4 }, 2,
                    M.withAlpha(G.NeonYellow, 180));
            }

            // 生命
            for (var i = 0; i < g.lives; i++) {
                var cx = G.W - 44 - i * 34;
                DR().HeartPath(ctx, cx, 40, 16);
                ctx.fillStyle = Color.rgba(Color.fromArgb(230, 255, 90, 130));
                ctx.fill();
                ctx.strokeStyle = Color.rgba(Color.fromArgb(160, 255, 190, 210));
                ctx.lineWidth = 1.4;
                ctx.stroke();
            }
            DR().TextLeft(ctx, "LIVES", DR().UIFont(12), G.TextDim, G.W - 100, 62);

            // 关卡 / 波次
            var info = g.endlessMode ? ("WAVE " + (g.wave + 1)) : ("LEVEL " + (g.levelIndex + 1) + "/" + NB.Levels.count);
            DR().TextLeft(ctx, info, DR().NumFont(15), G.NeonCyan, 34, 74);
            DR().TextLeft(ctx, g.endlessMode ? "无尽模式" : String(g.levelName),
                DR().UIFontLight(14), G.TextDim, 150, 75);

            // 护盾
            if (g.stats && g.stats.shieldCharges > 0) {
                for (var s = 0; s < g.stats.shieldCharges; s++) {
                    var sr = { x: G.W * 0.5 - 44 + s * 22, y: 74, w: 16, h: 16 };
                    DR().FillRound(ctx, sr, 5, M.withAlpha(G.NeonPurple, 180));
                    DR().StrokeRound(ctx, sr, 5, Color.fromArgb(230, 220, 190, 255), 1.2);
                }
            }

            // 道具计时（C# ref float bx 递减 82）
            var bx = G.W - 260;
            var by = 70;
            bx = this.drawBuffBar(ctx, bx, by, "激光", g.laserT || 0, 26, G.NeonPink);
            bx = this.drawBuffBar(ctx, bx, by, "扩张", g.wideT || 0, 26, G.NeonGreen);
            bx = this.drawBuffBar(ctx, bx, by, "缓速", g.slowT || 0, 22, G.NeonBlue);

            // 开局携带道具提示
            if (g.kitNoticeT > 0) {
                var ka = Math.min(1, g.kitNoticeT);
                DR().TextCenter(ctx, g.kitNotice, DR().UIFontLight(16),
                    M.withAlpha(G.NeonGreen, Math.trunc(230 * ka)), G.W * 0.5, 104);
            }

            // 提示
            if (g.hintT > 0) {
                var ha = Math.min(1, g.hintT * 1.5);
                DR().TextCenter(ctx, g.levelHint, DR().UIFontLight(19),
                    M.withAlpha(G.TextDim, Math.trunc(240 * ha)), G.W * 0.5, G.H - 62);
            }

            // 发射提示
            var balls = g.balls || [];
            var allStuck = balls.length > 0;
            for (var bi = 0; bi < balls.length; bi++) if (!balls[bi].stuck) allStuck = false;
            if (allStuck) {
                DR().TextCenter(ctx, "点击鼠标 / 空格  发射", DR().UIFont(20),
                    M.withAlpha(Color.White, 150 + Math.trunc(90 * Math.sin(g.gameTime * 4))),
                    G.W * 0.5, G.PaddleY - 96);
            }

            // 横幅
            if (g.bannerT > 0) {
                var ba = Math.min(1, g.bannerT * 1.6);
                DR().GlowTextCenter(ctx, g.banner, DR().UIFont(46),
                    M.withAlpha(Color.White, Math.trunc(255 * ba)), g.bannerColor || G.NeonCyan,
                    G.W * 0.5, G.H * 0.36, 4);
            }

            // 白闪
            if (g.flashWhite > 0) {
                ctx.fillStyle = Color.rgba(Color.fromArgb(Math.trunc(120 * g.flashWhite), 255, 255, 255));
                ctx.fillRect(0, 0, G.W, G.H);
            }
        },

        // C# DrawBuffBar(Graphics g, ref float x, float y, string name, float t, float max, Color c)
        // ref 参数 → 返回新的 x（递增顺序：激光、扩张、缓速各 -82）
        drawBuffBar: function (ctx, x, y, name, t, max, c) {
            if (t <= 0) return x - 82;
            var k = M.clamp(t / max, 0, 1);
            DR().TextLeft(ctx, name, DR().UIFontLight(13), M.withAlpha(c, 220), x, y - 2);
            DR().FillRound(ctx, { x: x, y: y + 18, w: 62, h: 6 }, 3, Color.fromArgb(70, 255, 255, 255));
            DR().FillRound(ctx, { x: x, y: y + 18, w: 62 * k, h: 6 }, 3, c);
            return x - 82;
        },

        // ===================== 主菜单（C# DrawMenu） =====================
        drawMenu: function (ctx, g) {
            // 装饰：环绕飞行的球
            for (var i = 0; i < 7; i++) {
                var a = g.gameTime * 0.6 + i * 1.05;
                var rad = 300 + (i % 3) * 42;
                var cx = G.W * 0.5 + Math.cos(a) * rad;
                var cy = 300 + Math.sin(a) * rad * 0.42;
                var r = 3 + (i % 3) * 1.6;
                ctx.fillStyle = Color.rgba(M.withAlpha(i % 2 === 0 ? G.NeonCyan : G.NeonPurple, 150));
                ctx.beginPath();
                ctx.arc(cx, cy, r, 0, Math.PI * 2);
                ctx.fill();
            }

            // 标题
            var bump = Math.sin(g.gameTime * 1.6) * 3;
            DR().GlowTextCenter(ctx, "NEON BREAKER", DR().TitleFont(96), Color.White, G.NeonCyan,
                G.W * 0.5, 96 + bump, 5);
            DR().TextCenter(ctx, "霓 虹 破 砖", DR().UIFont(38), G.NeonCyan, G.W * 0.5, 212);
            DR().TextCenter(ctx, "- 弹射 · 破坏 · 进化 -", DR().UIFontLight(16), G.TextDim, G.W * 0.5, 264);

            // 货币栏：积分 / 砖块币 / 热度
            drawPill(ctx, { x: 317, y: 286, w: 206, h: 46 }, "积 分", Economy.fmt(Profile.points), G.NeonYellow, -1);
            drawPill(ctx, { x: 537, y: 286, w: 206, h: 46 }, "砖块币", n0(Profile.coins), G.NeonOrange, -1);
            drawPill(ctx, { x: 757, y: 286, w: 206, h: 46 }, "热度 Lv." + Profile.heatLevel,
                "奖励 ×" + f2(Economy.bonusMul), G.NeonPurple, Profile.heatProgress);

            capsule(ctx, RMenuCampaign, "闯 关 模 式", "共 30 关 · 逐步强化", G.NeonCyan, true, false);
            capsule(ctx, RMenuEndless, "无 尽 模 式", "砖块不断下压 · 挑战最高分", G.NeonPurple, true, false);
            capsule(ctx, RMenuShop, "商 店", "", G.NeonYellow, true, false);
            capsule(ctx, RMenuUpgrade, "升 级", "", G.NeonGreen, true, false);
            capsule(ctx, RMenuSet, "设 置", "", G.NeonBlue, true, false);
            capsule(ctx, RMenuHelp, "玩 法", "", G.NeonCyan, true, false);
            capsule(ctx, RMenuQuit, "退 出", "", Color.fromArgb(150, 110, 130, 170), true, false);

            // 语义化命中 id（晚于 Capsule 注册，优先级更高，供 game.js 分发）
            UI().addHot(RMenuCampaign, 'menu:campaign');
            UI().addHot(RMenuEndless, 'menu:endless');
            UI().addHot(RMenuShop, 'menu:shop');
            UI().addHot(RMenuUpgrade, 'menu:upgrade');
            UI().addHot(RMenuSet, 'menu:set');
            UI().addHot(RMenuHelp, 'menu:help');
            UI().addHot(RMenuQuit, 'menu:quit');

            // 记录
            var rec = "最高分  " + n0(Profile.bestEndless) + "      最远波次  " + Profile.bestEndlessWave +
                "      闯关进度  " + Profile.bestCampaign + "/" + NB.Levels.count;
            DR().TextCenter(ctx, rec, DR().UIFontLight(16), G.TextDim, G.W * 0.5, 660);
            var rec2 = "累计分数  " + Economy.fmt(Profile.totalScore) + "      积分  " + Economy.fmt(Profile.points) +
                "      砖块币  " + n0(Profile.coins);
            DR().TextCenter(ctx, rec2, DR().UIFontLight(15), Color.fromArgb(150, 175, 215), G.W * 0.5, 686);

            DR().TextCenter(ctx, "全程鼠标操作 · 移动控制挡板 · 点击发射 · 滚轮翻页 · 设置调画质/音乐/音效",
                DR().UIFontLight(13), Color.fromArgb(120, 130, 170), G.W * 0.5, 716);
        },

        // ===================== 通用按钮（C# DrawButton） =====================
        drawButton: function (ctx, g, r, text, tint, sub, big) {
            var hover = hitRect(r, g.mousePos);
            var rr = r;
            if (hover) rr = { x: r.x - 4, y: r.y - 3, w: r.w + 8, h: r.h + 6 };

            var fill = hover ? Color.fromArgb(48, tint.r, tint.g, tint.b) : Color.fromArgb(24, tint.r, tint.g, tint.b);
            DR().FillRound(ctx, rr, 12, Color.fromArgb(215, 10, 9, 22));
            // LinearGradientBrush(rect(rr.X, rr.Y-1, rr.Width, rr.Height+2), fill, FromArgb(180,8,7,18), 60f)
            ctx.save();
            DR().RoundRect(ctx, rr, 12);
            ctx.clip();
            var grd;
            try { grd = ctx.createLinearGradient(rr.x, rr.y, rr.x + rr.w * 0.33, rr.y + rr.h); } catch (e) { grd = null; }
            if (grd) {
                grd.addColorStop(0, Color.rgba(fill));
                grd.addColorStop(1, Color.rgba(Color.fromArgb(180, 8, 7, 18)));
                ctx.fillStyle = grd;
                ctx.fillRect(rr.x, rr.y, rr.w, rr.h);
            }
            ctx.restore();

            for (var i = 3; i >= 1; i--) {
                var a = hover ? Math.trunc(70 / i) : Math.trunc(34 / i);
                DR().StrokeRound(ctx,
                    { x: rr.x - i * 2, y: rr.y - i * 2, w: rr.w + i * 4, h: rr.h + i * 4 },
                    12 + i * 2, Color.fromArgb(a, tint.r, tint.g, tint.b), 2);
            }
            DR().StrokeRound(ctx, rr, 12, M.withAlpha(tint, hover ? 255 : 160), hover ? 2.2 : 1.4);
            // 左侧色条
            DR().FillRound(ctx, { x: rr.x + 10, y: rr.y + 12, w: 4, h: rr.h - 24 }, 2, tint);

            var subEmpty = (sub === null || sub === undefined || sub === '');
            if (subEmpty) {
                DR().TextCenter(ctx, text, DR().UIFont(big ? 28 : 21),
                    hover ? Color.White : M.withAlpha(Color.White, 220),
                    rr.x + rr.w * 0.5 + 6, rr.y + rr.h * 0.5 - (big ? 20 : 15));
            } else {
                DR().TextCenter(ctx, text, DR().UIFont(28),
                    hover ? Color.White : M.withAlpha(Color.White, 230), rr.x + rr.w * 0.5 + 6, rr.y + 12);
                DR().TextCenter(ctx, sub, DR().UIFontLight(14), M.withAlpha(tint, 200),
                    rr.x + rr.w * 0.5 + 6, rr.y + 48);
            }
        },

        // ===================== 帮助页（C# DrawHelp） =====================
        helpLines: [
            "【基本操作】",
            "  · 移动鼠标控制挡板（无需键盘）",
            "  · 点击任意位置发射小球",
            "  · 游戏中的暂停、继续、复活、加命全部用鼠标点击按钮",
            "  · 列表与商店页面支持滚轮上下翻页",
            "",
            "【核心机制】",
            "  · 球的反弹角度由命中挡板的位置决定，边缘反弹更斜",
            "  · 连续击碎砖块累积 COMBO，分数倍率随连击提升",
            "  · 砖块上的白色短条表示剩余血量，颜色代表血量厚度",
            "  · 打得好会在局内直接掉落大额积分（100 ~ 5000）或砖块币（20 ~ 500）",
            "",
            "【特殊砖块】",
            "  青色 1 血 / 紫色 2 血 / 橙色 3 血 / 粉色 4 血",
            "  黄色爆炸砖：破坏时炸开周围一大片",
            "  灰色钢砖：不可破坏，只能绕行",
            "  蓝色移动砖：左右游走",
            "",
            "【掉落道具 · 共 11 种】",
            "  3 三球分裂    W 挡板扩张    L 激光炮台    S 时间缓速",
            "  O 底部护盾    + 额外生命    $ 能量结晶（加分/换币）",
            "  B 爆破冲击（就地炸开一片）    F 时间冻结（砖块停住约 8 秒）",
            "  G 巨型球（球体放大 12 秒）    R 超速冲刺（球速提升 12 秒）",
            "  掉落概率已大幅提升，且可在商店「升级」页继续加点",
            "",
            "【商店与升级】",
            "  · 商店共 60+ 商品，分为 3 个分类 × 4 行 × 5 列，滚轮翻页",
            "  · 每件商品可用积分或砖块币购买，两种价格略有不同",
            "  · 购买支持「全部 / 一个 / 自定义数量」，兑换支持全部或自定义",
            "  · 鼠标停在商品上 1 秒会弹出详细说明",
            "  · 升级页可对小球、挡板、球速、掉落率等无限升级，价格逐级上涨",
            "",
            "【两种模式】",
            "  闯关模式：30 个精心设计的关卡，每关结束点击卡片三选一永久强化",
            "  无尽模式：砖块不断下压，越拖越危险，追求更高分数",
            "",
            "  提示：闯关模式的强化会一路累积，后期能凑出爆裂球 + 激光的强力组合"
        ],

        drawHelp: function (ctx, g) {
            var panel = { x: 220, y: 58, w: 840, h: 648 };
            DR().FillRound(ctx, panel, 20, Color.fromArgb(234, 9, 8, 20));
            DR().GlowRound(ctx, panel, 20, G.NeonCyan, 3);
            DR().TextCenter(ctx, "玩 法 说 明", DR().UIFont(32), Color.White, G.W * 0.5, 82);

            var lines = this.helpLines;

            var totalH = 12;
            for (var i = 0; i < lines.length; i++) totalH += (lines[i].indexOf("【") === 0) ? 40 : 28;

            var view = { x: 252, y: 116, w: 772, h: 476 };
            this.helpMaxScroll = Math.max(0, totalH - view.h + 12);
            this.helpScroll = M.clamp(this.helpScroll, 0, this.helpMaxScroll);

            ctx.save();
            ctx.beginPath();
            ctx.rect(view.x, view.y, view.w, view.h);
            ctx.clip();
            var y = view.y + 4 - this.helpScroll;
            for (var n = 0; n < lines.length; n++) {
                var t = lines[n];
                var isHead = t.indexOf("【") === 0;
                if (y > view.y - 40 && y < view.y + view.h + 10) {
                    var c = G.TextMain;
                    var f = DR().UIFontLight(15);
                    if (isHead) { c = G.NeonCyan; f = DR().UIFont(18); y += 6; }
                    DR().TextLeft(ctx, t, f, c, 268, y);
                    y += isHead ? 34 : 22;
                } else {
                    if (isHead) y += 6;
                    y += isHead ? 34 : 22;
                }
            }
            ctx.restore();

            if (this.helpMaxScroll > 0) {
                scrollBar(ctx, { x: 1040, y: 116, w: 6, h: 476 }, this.helpMaxScroll, this.helpScroll, G.NeonCyan);
                DR().TextCenter(ctx, "滚轮上下翻页", DR().UIFontLight(12), Color.fromArgb(112, 126, 166), G.W * 0.5, 598);
            }

            capsule(ctx, RHelpBack, "返 回", "", G.NeonCyan, true, false);
            UI().addHot(RHelpBack, 'help:back');
        },

        // 帮助页滚轮（C# 主窗体 MouseWheel 中 State.Help 分支：helpScroll -= e.Delta/120*60）
        helpWheel: function (delta) {
            this.helpScroll = M.clamp(this.helpScroll - (delta / 120) * 60, 0, this.helpMaxScroll);
        },

        // ===================== 暂停面板（C# DrawPause） =====================
        drawPause: function (ctx, g) {
            ctx.fillStyle = Color.rgba(Color.fromArgb(170, 4, 3, 12));
            ctx.fillRect(0, 0, G.W, G.H);

            var panel = { x: 400, y: 150, w: 480, h: 462 };
            DR().FillRound(ctx, panel, 18, Color.fromArgb(240, 10, 9, 22));
            DR().GlowRound(ctx, panel, 18, G.NeonPurple, 3);
            DR().TextCenter(ctx, "暂 停", DR().UIFont(34), Color.White, G.W * 0.5, 178);
            DR().TextCenter(ctx, "当前分数  " + n0(g.score) + "      生命 " + g.lives,
                DR().UIFontLight(17), G.TextDim, G.W * 0.5, 232);
            DR().TextCenter(ctx,
                "本局时长 " + timeStr(g.runTime) + "  ·  热度 Lv." + Profile.heatLevel +
                "（奖励 ×" + f2(Economy.bonusMul) + "）",
                DR().UIFontLight(14), Color.fromArgb(130, 145, 185), G.W * 0.5, 256);

            capsule(ctx, RPauseResume, "继 续", "", G.NeonCyan, true, false);
            capsule(ctx, RPauseItems, "使 用 道 具", "", G.NeonPink, true, false);
            capsule(ctx, RPauseRestart, "重 新 开 始", "", G.NeonPurple, true, false);
            capsule(ctx, RPauseMenu, "返 回 主 菜 单", "", G.NeonBlue, true, false);

            UI().addHot(RPauseResume, 'pause:resume');
            UI().addHot(RPauseItems, 'pause:items');
            UI().addHot(RPauseRestart, 'pause:restart');
            UI().addHot(RPauseMenu, 'pause:menu');

            DR().TextCenter(ctx, "点击按钮操作 · 加命不影响热度加成规则", DR().UIFontLight(13),
                Color.fromArgb(110, 125, 165), G.W * 0.5, 580);

            // if (pitOpen) DrawPauseItems(g)
            if (g.pitOpen) NB.PauseItems.drawPauseItems(ctx, g);
        },

        // ===================== 升级选择（C# DrawUpgrade） =====================
        drawUpgrade: function (ctx, g) {
            ctx.fillStyle = Color.rgba(Color.fromArgb(200, 4, 3, 12));
            ctx.fillRect(0, 0, G.W, G.H);

            var a = g.upgradeAnim;
            DR().GlowTextCenter(ctx, "关 卡 完 成", DR().UIFont(42), Color.White, G.NeonCyan, G.W * 0.5, 96, 4);
            DR().TextCenter(ctx, "点击下面任意一张卡片，选择一项永久强化", DR().UIFontLight(17), G.TextDim, G.W * 0.5, 166);
            if (g.lastReward > 0) {
                var rw = (g.lastRewardLucky ? "★ 幸运奖励  +" : "过关奖励  +") + g.lastReward + " 积分";
                DR().TextCenter(ctx, rw, DR().UIFont(20),
                    g.lastRewardLucky ? G.NeonYellow : G.NeonGreen, G.W * 0.5, 202);
            }

            var offers = g.offers || [];
            for (var i = 0; i < offers.length; i++) {
                var u = offers[i];
                var baseR = cardRect(i);
                var slip = (1 - a) * 40;
                var r = { x: baseR.x, y: baseR.y + slip, w: baseR.w, h: baseR.h };
                var hover = hitRect(r, g.mousePos);
                if (hover) r = { x: r.x - 6, y: r.y - 8, w: r.w + 12, h: r.h + 16 };

                DR().FillRound(ctx, r, 16, Color.fromArgb(hover ? 245 : 230, 12, 11, 26));
                // LinearGradientBrush(rect(r.X, r.Y-1, r.Width, r.Height+2), tint@(hover?70:34) → tint@0, 90f)
                ctx.save();
                DR().RoundRect(ctx, r, 16);
                ctx.clip();
                var grd = null;
                try { grd = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h); } catch (e) { grd = null; }
                if (grd) {
                    grd.addColorStop(0, Color.rgba(Color.fromArgb(hover ? 70 : 34, u.tint.r, u.tint.g, u.tint.b)));
                    grd.addColorStop(1, Color.rgba(Color.fromArgb(0, u.tint.r, u.tint.g, u.tint.b)));
                    ctx.fillStyle = grd;
                    ctx.fillRect(r.x, r.y, r.w, r.h);
                }
                ctx.restore();

                for (var k = hover ? 4 : 2; k >= 1; k--) {
                    DR().StrokeRound(ctx,
                        { x: r.x - k * 3, y: r.y - k * 3, w: r.w + k * 6, h: r.h + k * 6 },
                        16 + k * 3,
                        Color.fromArgb(hover ? Math.trunc(80 / k) : Math.trunc(30 / k), u.tint.r, u.tint.g, u.tint.b), 2);
                }
                DR().StrokeRound(ctx, r, 16, u.tint, hover ? 2.6 : 1.6);

                // 图标
                var cx = r.x + r.w * 0.5;
                var iy = r.y + 78;
                for (var h = 3; h >= 1; h--) {
                    ctx.fillStyle = Color.rgba(Color.fromArgb(Math.trunc(30 / h), u.tint.r, u.tint.g, u.tint.b));
                    ctx.beginPath();
                    ctx.arc(cx, iy, 42 + h * 4, 0, Math.PI * 2);
                    ctx.fill();
                }
                DR().FillRound(ctx, { x: cx - 40, y: iy - 40, w: 80, h: 80 }, 22, Color.fromArgb(240, 16, 14, 34));
                DR().StrokeRound(ctx, { x: cx - 40, y: iy - 40, w: 80, h: 80 }, 22, u.tint, 2);
                DR().TextCenter(ctx, u.tag, DR().NumFont(26), u.tint, cx, iy - 18);

                DR().TextCenter(ctx, u.name, DR().UIFont(23), Color.White, cx, r.y + 150);
                // 描述换行（C# DrawWrapped：居中，宽 r.Width-44，行高 22，最多 4 行）
                this.drawWrapped(ctx, u.desc, DR().UIFontLight(15), G.TextDim, cx, r.y + 190, r.w - 44, 22);

                DR().TextCenter(ctx, "点击选择", DR().UIFontLight(14), M.withAlpha(u.tint, 200), cx, r.y + r.h - 44);

                UI().addHot(r, 'up:' + i);
            }
        },

        // C# DrawWrapped：居中自动换行（宽 width，最多 4 行，行高 lineH）
        drawWrapped: function (ctx, text, font, c, cx, y, width, lineH) {
            var lines = this.wrapText(ctx, text, font, width);
            ctx.font = font;
            ctx.fillStyle = Color.rgba(c);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            for (var i = 0; i < lines.length && i < 4; i++) {
                ctx.fillText(lines[i], cx, y + i * lineH);
            }
            ctx.textAlign = 'left';
        },

        // 逐字符测量换行（对应 GDI+ 居中 DrawString 的自动折行）
        wrapText: function (ctx, text, font, width) {
            var s = String(text == null ? '' : text);
            var out = [];
            var cur = '';
            ctx.font = font;
            for (var i = 0; i < s.length; i++) {
                var ch = s.charAt(i);
                if (ch === '\n') { out.push(cur); cur = ''; continue; }
                var test = cur + ch;
                if (ctx.measureText(test).width > width && cur.length > 0) {
                    out.push(cur);
                    cur = ch;
                } else {
                    cur = test;
                }
            }
            if (cur.length > 0 || out.length === 0) out.push(cur);
            ctx.textAlign = 'left';
            return out;
        },

        // ===================== 结束画面（C# DrawEnd） =====================
        drawEnd: function (ctx, g, win) {
            ctx.fillStyle = Color.rgba(Color.fromArgb(200, 4, 3, 12));
            ctx.fillRect(0, 0, G.W, G.H);

            var panel = { x: 370, y: 140, w: 540, h: 530 };
            DR().FillRound(ctx, panel, 20, Color.fromArgb(245, 10, 9, 22));
            DR().GlowRound(ctx, panel, 20, win ? G.NeonYellow : G.NeonPink, 3);

            var title = win ? "全 部 通 关 ！" : (g.endlessMode ? "无 尽 终 结" : "游 戏 结 束");
            DR().GlowTextCenter(ctx, title, DR().UIFont(42), Color.White,
                win ? G.NeonYellow : G.NeonPink, G.W * 0.5, 170, 4);

            DR().TextCenter(ctx, "本局得分", DR().UIFontLight(15), G.TextDim, G.W * 0.5, 228);
            DR().TextCenter(ctx, n0(g.score), DR().NumFont(48), Color.White, G.W * 0.5, 246);

            // 结算积分
            var settle = "结算积分  +" + Economy.fmt(g.lastSettlePoints);
            DR().TextCenter(ctx, settle, DR().UIFont(19), G.NeonGreen, G.W * 0.5, 314);
            if (g.lastSettlePoints > 0 && g.score > 0) {
                var rate = g.lastSettlePoints / Math.max(1, g.score);
                DR().TextCenter(ctx,
                    "换算率 " + Number(rate * 100).toFixed(1) + "%  ·  热度加成 ×" + f2(Economy.bonusMul),
                    DR().UIFontLight(13), Color.fromArgb(125, 140, 180), G.W * 0.5, 340);
            }

            if (g.endlessMode) {
                DR().TextCenter(ctx, "坚持波次  " + (g.wave + 1) + "      历史最高  " + n0(Profile.bestEndless),
                    DR().UIFontLight(16), G.TextDim, G.W * 0.5, 376);
            } else {
                DR().TextCenter(ctx,
                    "到达关卡  " + (g.levelIndex + 1) + " / " + NB.Levels.count + "      最高连击  " + g.bestCombo,
                    DR().UIFontLight(16), G.TextDim, G.W * 0.5, 376);
            }

            DR().TextCenter(ctx,
                "累计分数  " + Economy.fmt(Profile.totalScore) + "      当前积分  " + Economy.fmt(Profile.points) +
                "      砖块币  " + n0(Profile.coins),
                DR().UIFontLight(15), Color.fromArgb(150, 175, 215), G.W * 0.5, 412);

            if (g.newRecord)
                DR().TextCenter(ctx, "★ 新 纪 录 ★", DR().UIFont(20), G.NeonYellow, G.W * 0.5, 444);
            else
                DR().TextCenter(ctx, "累计游玩 " + Profile.playCount + " 局", DR().UIFontLight(15),
                    Color.fromArgb(110, 120, 160), G.W * 0.5, 446);

            if (win) {
                capsule(ctx, REndNext, "从 头 再 战", "", G.NeonYellow, true, false);
                capsule(ctx, REndMenu, "返 回 主 菜 单", "", G.NeonCyan, true, false);
                UI().addHot(REndNext, 'end:next');
                UI().addHot(REndMenu, 'end:menu');
            } else {
                capsule(ctx, REndRetry, "再 来 一 局", "", G.NeonPink, true, false);
                capsule(ctx, REndMenu, "返 回 主 菜 单", "", G.NeonCyan, true, false);
                UI().addHot(REndRetry, 'end:retry');
                UI().addHot(REndMenu, 'end:menu');

                // 复活卡
                if (Profile.reviveCards > 0) {
                    capsule(ctx, REndRevive, "使 用 复 活 卡   ×" + Profile.reviveCards, "", G.NeonGreen, true, false);
                    UI().addHot(REndRevive, 'end:revive');
                    DR().TextCenter(ctx, "点击复活卡原地复活 · 代价：热度 -20%（削弱长久奖励加成）",
                        DR().UIFontLight(13), Color.fromArgb(125, 140, 180), G.W * 0.5, 632);
                } else {
                    DR().TextCenter(ctx, "没有复活卡 · 可在商店用 3 砖块币购买", DR().UIFontLight(14),
                        Color.fromArgb(120, 135, 175), G.W * 0.5, 586);
                }
            }
        }
    };

    NB.DrawScene = DrawScene;

    // 扩展 NB.Draw：场景绘制总入口（不改动 render.js 已提供的基元）
    if (NB.Draw) {
        NB.Draw.scene = function (ctx, g) { return DrawScene.draw(ctx, g); };
        NB.Draw.DrawScene = DrawScene;
    }

})();
