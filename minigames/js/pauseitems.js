/* =====================================================================
 * pauseitems.js —— 暂停 · 使用道具面板（第二阶段：界面与商店层）
 * 1:1 移植自 Codes\PauseItems.cs（绘制 + 命中 + 使用逻辑）
 *
 * 依赖顺序：core.js → levels.js → audio.js → meta.js → render.js → draw.js → pauseitems.js
 *   NB.G / NB.M / NB.Color / NB.Meta / NB.Sfx / NB.Draw / NB.UI
 *   NB.DrawScene.showToast（C# GameForm.ShowToast）
 *
 * 职责边界（严格遵守）：
 *   - 本文件只做「绘制 + 命中判定 + 道具消耗与增益写入」；
 *   - 不创建/销毁对局对象；对局内的唯一破坏性效果（C# NovaBlast）通过
 *     NB.PauseItems.hooks.novaBlast(x, y) 交给 game.js 执行；
 *   - 不切换状态机：打开/关闭面板只改 pitOpen（对应 C# pitOpen），
 *     State.Pause 的进入/退出由 game.js 负责。
 *
 * 状态字段对照（C# GameForm 字段 → NB.PauseItems.st.*）：
 *   pitOpen→st.open, pitScroll→st.scroll, pitMaxScroll→st.maxScroll
 *
 * 依赖的对局字段（g）：
 *   g.lives、g.balls[]、g.stats（shieldCharges / dropBonus / magnet）、
 *   g.slowT / g.laserT / g.wideT / g.freezeT
 * ===================================================================== */
(function () {
    'use strict';

    var NB = globalThis.NB = globalThis.NB || {};
    var G = NB.G, M = NB.M, Color = NB.Color;
    var Meta = NB.Meta, Sfx = NB.Sfx;

    function DR() { return NB.Draw; }
    function UI() { return NB.UI; }

    // ===================== 常量（C# PauseItems.cs 原值，禁止改动） =====================
    var PIT_CELL_W = 128, PIT_CELL_H = 84, PIT_GAP_X = 10, PIT_GAP_Y = 10;
    var PIT_KEYS = ['life', 'shield', 'lucky', 'multi', 'slow',
        'laserkit', 'widekit', 'magnetkit', 'nukekit', 'freezekit'];

    // C# RectangleF PitPanelRect() = new RectangleF(340f, 150f, 600f, 470f)
    function pitPanelRect() { return { x: 340, y: 150, w: 600, h: 470 }; }

    // C# RectangleF PitCloseRect()
    function pitCloseRect() {
        var panel = pitPanelRect();
        return { x: panel.x + panel.w * 0.5 - 70, y: (panel.y + panel.h) - 58, w: 140, h: 40 };
    }

    // C# float PitListTop => panel.Y + 76f
    function pitListTop() { return pitPanelRect().y + 76; }
    // C# float PitListHeight => panel.Height - 76f - 78f
    function pitListHeight() { return pitPanelRect().h - 76 - 78; }

    // ===================== 模块状态 =====================
    var S = { open: false, scroll: 0, maxScroll: 0 };

    // 外部副作用钩子（由 game.js 注入）：C# NovaBlast(G.W*0.5f, G.H*0.52f)
    var hooks = { novaBlast: null };

    // ===================== 数据（C# PitKeys / PitOwned） =====================
    function pitOwned() {
        var ls = [];
        for (var i = 0; i < PIT_KEYS.length; i++) {
            if (Meta.count(PIT_KEYS[i]) > 0) ls.push(PIT_KEYS[i]);
        }
        return ls;
    }

    // C# string PitName(string key)
    function pitName(key) {
        switch (key) {
            case 'life': return '生命 +1 张';
            case 'shield': return '护盾套件';
            case 'lucky': return '幸运符';
            case 'multi': return '多重球';
            case 'slow': return '缓速器';
            case 'nukekit': return '星爆核心';
            case 'freezekit': return '时空凝滞';
        }
        return key;
    }

    // C# Color PitTint(string key)
    function pitTint(key) {
        switch (key) {
            case 'life': return Color.fromArgb(255, 120, 160);
            case 'shield': return Color.fromArgb(190, 120, 255);
            case 'lucky': return G.NeonYellow;
            case 'multi': return G.NeonGreen;
            case 'slow': return G.NeonBlue;
            case 'laserkit': return G.NeonBlue;
            case 'widekit': return G.NeonCyan;
            case 'magnetkit': return Color.fromArgb(120, 220, 255);
            case 'nukekit': return Color.fromArgb(255, 140, 90);
            case 'freezekit': return Color.fromArgb(140, 235, 255);
        }
        return Color.White;
    }

    // C# RectangleF PitCellRect(int idx)：4 列网格，纵向减去 pitScroll
    function pitCellRect(idx) {
        var panel = pitPanelRect();
        var col = idx % 4, row = Math.trunc(idx / 4);
        return {
            x: panel.x + 28 + col * (PIT_CELL_W + PIT_GAP_X),
            y: pitListTop() + row * (PIT_CELL_H + PIT_GAP_Y) - S.scroll,
            w: PIT_CELL_W, h: PIT_CELL_H
        };
    }

    // ===================== 开关（C# OpenPauseItems / ClosePauseItems） =====================
    function openPauseItems(g) {
        S.open = true;
        S.scroll = 0;
        Sfx.play('click');
        return S.open;
    }

    function closePauseItems(g) {
        S.open = false;
        S.scroll = 0;
        Sfx.play('click');
        return S.open;
    }

    function toast(g, text, c) { NB.DrawScene.showToast(g, text, c); }

    // ===================== 绘制（C# DrawPauseItems） =====================
    function drawPauseItems(ctx, g) {
        ctx.fillStyle = Color.rgba(Color.fromArgb(208, 3, 2, 10));
        ctx.fillRect(0, 0, G.W, G.H);

        var panel = pitPanelRect();
        UI().glassPanel(ctx, panel, G.NeonCyan);
        DR().GlowTextCenter(ctx, '使用道具', DR().UIFont(24), Color.White, G.NeonCyan,
            panel.x + panel.w * 0.5, panel.y + 18, 2);

        var own = pitOwned();
        var top = pitListTop();
        var listH = pitListHeight();

        if (own.length === 0) {
            DR().TextCenter(ctx, '暂无可用道具', DR().UIFontLight(17), M.withAlpha(G.TextDim, 235),
                panel.x + panel.w * 0.5, top + listH * 0.5 - 12);
        } else {
            var rows = Math.trunc((own.length + 3) / 4);
            var contentH = rows * PIT_CELL_H + Math.max(0, rows - 1) * PIT_GAP_Y;
            S.maxScroll = Math.max(0, contentH - listH);
            S.scroll = M.clamp(S.scroll, 0, S.maxScroll);

            // C# g.SetClip(new RectangleF(panel.X + 22f, top - 6f, panel.Width - 52f, listH + 12f))
            ctx.save();
            ctx.beginPath();
            ctx.rect(panel.x + 22, top - 6, panel.w - 52, listH + 12);
            ctx.clip();
            for (var i = 0; i < own.length; i++) {
                var r = pitCellRect(i);
                var key = own[i];
                var tint = pitTint(key);
                DR().FillRound(ctx, r, 12, Color.fromArgb(215, 14, 13, 28));
                DR().StrokeRound(ctx, r, 12, M.withAlpha(tint, 175), 1.4);
                DR().FillRound(ctx, { x: r.x + 12, y: r.y + 14, w: 4, h: 24 }, 2, tint);
                DR().TextLeft(ctx, pitName(key), DR().UIFont(14), Color.White, r.x + 24, r.y + 14);
                DR().TextLeft(ctx, '× ' + Meta.count(key), DR().NumFont(18), tint, r.x + 24, r.y + 42);
            }
            ctx.restore();

            if (S.maxScroll > 0) {
                UI().scrollBar(ctx, { x: (panel.x + panel.w) - 16, y: top, w: 6, h: listH }, S.maxScroll, S.scroll, G.NeonCyan);
            }
        }

        var close = pitCloseRect();
        UI().miniCapsule(ctx, close, '关闭', G.NeonCyan, true, false);
        UI().addHot(close, 'pit:close');
    }

    // ===================== 点击（C# HandlePauseItemsClick） =====================
    // 返回：'' = 无变化；'close' = 面板已关闭
    function handlePauseItemsClick(g, p) {
        var id = UI().hitId(p);
        if (id === 'pit:close') { closePauseItems(g); return 'close'; }

        var own = pitOwned();
        var top = pitListTop();
        var listH = pitListHeight();
        for (var i = 0; i < own.length; i++) {
            var r = pitCellRect(i);
            if (r.y < top - 2 || (r.y + r.h) > top + listH + 2) continue;
            if (UI().hit(r, p)) { usePauseItem(g, own[i]); return ''; }
        }
        return '';
    }

    // ===================== 滚轮（C# PauseItemsWheel） =====================
    function pauseItemsWheel(delta) {
        if (!S.open) return;
        S.scroll = M.clamp(S.scroll - delta * 0.4, 0, S.maxScroll);
    }

    // ===================== 使用道具（C# UsePauseItem） =====================
    function usePauseItem(g, key) {
        if (Meta.count(key) <= 0) { toast(g, '这个道具已经用完了', Color.fromArgb(200, 205, 220)); return; }
        switch (key) {
            case 'life':
                if (g.lives >= 9) { toast(g, '生命已满', Color.fromArgb(200, 205, 220)); return; }
                Meta.spend(key, 1);
                g.lives = Math.min(9, g.lives + 1);
                Sfx.play('drop');
                toast(g, '生命 +1 · 当前 ' + g.lives + ' 层', Color.fromArgb(255, 120, 160));
                break;
            case 'shield':
                if (g.stats.shieldCharges >= 4) { toast(g, '护盾已满', Color.fromArgb(200, 205, 220)); return; }
                Meta.spend(key, 1);
                g.stats.shieldCharges = Math.min(4, g.stats.shieldCharges + 1);
                Sfx.play('drop');
                toast(g, '护盾 +1 · 当前 ' + g.stats.shieldCharges + ' 层', Color.fromArgb(190, 120, 255));
                break;
            case 'lucky':
                if (g.stats.dropBonus >= 0.75) { toast(g, '掉落率已达上限', Color.fromArgb(200, 205, 220)); return; }
                Meta.spend(key, 1);
                g.stats.dropBonus = Math.min(0.75, g.stats.dropBonus + 0.15);
                Sfx.play('drop');
                toast(g, '幸运符生效 · 掉落率 +15%', G.NeonYellow);
                break;
            case 'multi':
                if (g.balls.length >= 9) { toast(g, '球数已达上限', Color.fromArgb(200, 205, 220)); return; }
                Meta.spend(key, 1);
                var add = [];
                for (var i = 0; i < g.balls.length && g.balls.length + add.length < 9; i++) {
                    var src = g.balls[i];
                    if (src.stuck) continue;
                    for (var k = -1; k <= 1 && g.balls.length + add.length < 9; k += 2) {
                        var nb = new NB.Ball();
                        nb.x = src.x; nb.y = src.y; nb.r = src.r;
                        var ang = Math.atan2(src.vy, src.vx) + k * 0.42;
                        nb.vx = Math.cos(ang) * src.speed;
                        nb.vy = Math.sin(ang) * src.speed;
                        add.push(nb);
                    }
                }
                for (var a = 0; a < add.length; a++) g.balls.push(add[a]);
                Sfx.play('drop');
                toast(g, '多重球 +' + add.length, G.NeonGreen);
                break;
            case 'slow':
                Meta.spend(key, 1);
                g.slowT = Math.min(22, g.slowT + 13);
                Sfx.play('drop');
                toast(g, '时间缓速', G.NeonBlue);
                break;
            case 'laserkit':
                Meta.spend(key, 1);
                g.laserT = Math.max(g.laserT, 16);
                Sfx.play('drop');
                toast(g, '激光炮台 16 秒', G.NeonBlue);
                break;
            case 'widekit':
                Meta.spend(key, 1);
                g.wideT = Math.max(g.wideT, 15);
                Sfx.play('drop');
                toast(g, '挡板加宽 15 秒', G.NeonCyan);
                break;
            case 'magnetkit':
                Meta.spend(key, 1);
                g.stats.magnet = Math.min(0.9, g.stats.magnet + 0.35);
                Sfx.play('drop');
                toast(g, '磁力吸附 +35%', Color.fromArgb(120, 220, 255));
                break;
            case 'nukekit':
                Meta.spend(key, 1);
                // C# NovaBlast(G.W * 0.5f, G.H * 0.52f) —— 全屏爆破需对局对象，交由 game.js
                if (typeof hooks.novaBlast === 'function') hooks.novaBlast(G.W * 0.5, G.H * 0.52);
                Sfx.play('bomb');
                toast(g, '星爆核心 · 全屏爆破', Color.fromArgb(255, 140, 90));
                break;
            case 'freezekit':
                Meta.spend(key, 1);
                g.freezeT = Math.max(g.freezeT, 10);
                Sfx.play('drop');
                toast(g, '时空凝滞 10 秒', Color.fromArgb(140, 235, 255));
                break;
        }
        S.scroll = M.clamp(S.scroll, 0, Math.max(0, S.maxScroll));
    }

    // ===================== 导出 =====================
    NB.PauseItems = {
        // 常量（文档对照 / game.js 复用）
        PIT_CELL_W: PIT_CELL_W, PIT_CELL_H: PIT_CELL_H,
        PIT_GAP_X: PIT_GAP_X, PIT_GAP_Y: PIT_GAP_Y,
        PIT_KEYS: PIT_KEYS,

        // 布局
        pitPanelRect: pitPanelRect,
        pitCloseRect: pitCloseRect,
        pitListTop: pitListTop,
        pitListHeight: pitListHeight,
        pitCellRect: pitCellRect,

        // 数据
        pitOwned: pitOwned,
        pitName: pitName,
        pitTint: pitTint,

        // 状态与钩子
        st: S,
        hooks: hooks,

        // 绘制与交互
        draw: drawPauseItems,
        drawPauseItems: drawPauseItems,
        openPauseItems: openPauseItems,
        closePauseItems: closePauseItems,
        handlePauseItemsClick: handlePauseItemsClick,
        pauseItemsWheel: pauseItemsWheel,
        usePauseItem: usePauseItem
    };

})();
