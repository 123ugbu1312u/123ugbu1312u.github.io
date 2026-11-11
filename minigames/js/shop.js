/* =====================================================================
 * shop.js —— 商店 / 永久升级 / 设置（第二阶段：界面与商店层）
 * 1:1 移植自 Codes\Shop.cs（绘制）与 Codes\ShopInput.cs（交互）
 *
 * 依赖顺序：core.js → levels.js → audio.js → meta.js → render.js → draw.js → shop.js
 *   使用 render.js 的 NB.Draw / NB.UI 基元、meta.js 的 NB.Meta、
 *   core.js 的 NB.G / NB.M / NB.Color / NB.Profile / NB.Economy、
 *   audio.js 的 NB.Sfx / NB.Music。
 *
 * 职责边界（严格遵守）：
 *   - 只负责「绘制 + 命中区域（AddHot）+ 点击/滚轮/键盘处理」；
 *   - 不改动对局状态机：state 的切换（返回主菜单等）由 game.js 依据
 *     handleShopClick() 的返回值处理；对局内对象（球/砖/道具计时）不在此文件创建；
 *   - 外部副作用（重建背景、应用窗口模式、回放清理、选择本地音乐文件）
 *     通过 NB.Shop.hooks 注入，由 game.js 提供实现。
 *
 * 状态字段对照（C# GameForm 字段 → NB.Shop.st.*）：
 *   shopTab→st.tab, shopPage→st.page, upScroll→st.upScroll, setScroll→st.setScroll,
 *   invScroll→st.invScroll, invOpen→st.invOpen, qtyOpen→st.qtyOpen,
 *   qtyItemIdx→st.qtyItemIdx, qtyVal→st.qtyVal, qtyIsUpgrade→st.qtyIsUpgrade,
 *   shopFade→st.shopFade, qtyMode→st.qtyMode, qtyTitle→st.qtyTitle,
 *   qtyFresh→st.qtyFresh, wheelTick→st.wheelTick,
 *   qtyUnitPoints→st.qtyUnitPoints, qtyUnitCoins→st.qtyUnitCoins,
 *   replaySliderDrag→st.replaySliderDrag
 *   hoverT 复用 NB.UI.hoverT，tooltipTitle/tooltipBody 复用 NB.UI 同名字段（C# UiKit 字段）
 * ===================================================================== */
(function () {
    'use strict';

    var NB = globalThis.NB = globalThis.NB || {};
    var G = NB.G, M = NB.M, Color = NB.Color;
    var Profile = NB.Profile, Economy = NB.Economy, Meta = NB.Meta;
    var Sfx = NB.Sfx, Music = NB.Music;

    function DR() { return NB.Draw; }
    function UI() { return NB.UI; }

    // ===================== 布局常量（C# Shop.cs 原值，禁止改动） =====================
    var RTabs = { x: 150, y: 106, w: 600, h: 40 };
    var RBack = { x: 956, y: 106, w: 190, h: 40 };
    var RInvBtn = { x: 766, y: 106, w: 180, h: 40 };
    var UpView = { x: 120, y: 168, w: 1040, h: 536 };

    // 设置页：回放滑块 / 开关 / 窗口模式按钮的统一矩形（绘制与输入共用）
    var RSetReplayOn = { x: 510, y: 548, w: 96, h: 36 };
    var RSetReplaySlider = { x: 640, y: 554, w: 260, h: 22 };
    var RSetReplayValue = { x: 926, y: 548, w: 96, h: 36 };
    var RSetWinMode = [
        { x: 510, y: 606, w: 150, h: 36 },
        { x: 670, y: 606, w: 150, h: 36 },
        { x: 830, y: 606, w: 150, h: 36 }
    ];

    function exRect(i) { return { x: 150 + i * 500, y: 208, w: 480, h: 70 }; }
    function cardRect(col, row) { return { x: 150 + col * 332, y: 290 + row * 104, w: 316, h: 96 }; }
    function upRect(col, row) {
        return { x: 150 + col * 500, y: 176 + row * 104 - S.upScroll, w: 480, h: 96 };
    }

    // ===================== 模块状态 =====================
    var S = {
        tab: 0,                 // 0 商店 1 升级 2 设置
        page: 0,
        upScroll: 0, setScroll: 0, invScroll: 0,
        invOpen: false,
        qtyOpen: false,
        qtyItemIdx: -1,
        qtyVal: 1,
        qtyIsUpgrade: false,
        shopFade: 0,
        qtyMode: 0,             // 0 购买商品 1 积分->币 2 币->积分
        qtyTitle: '',
        qtyFresh: true,
        wheelTick: 0,
        qtyUnitPoints: 0, qtyUnitCoins: 0,
        replaySliderDrag: false
    };

    // 外部副作用钩子（由 game.js 注入；缺省时安全降级，不改变商店逻辑）
    var hooks = {
        rebuildBackdrop: null,   // C# RebuildBackdrop()
        applyWindowMode: null,   // C# ApplyWindowMode()
        replayStop: null,        // C# Replay.Stop()
        replayCleanup: null,     // C# Replay.Cleanup(Meta.ReplayKeep)
        pickMusicFile: null      // C# OpenFileDialog → cb(fileName|null)
    };

    // ===================== 工具（C# 同名方法） =====================
    function n0(n) {
        var s = String(Math.trunc(n));
        return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
    // C# ToString("0.##") / ("0.#")
    function trimFix(v, dec) {
        var s = v.toFixed(dec);
        if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
        return s;
    }
    // C# static string FmtNum(int n)
    function fmtNum(n) {
        n = Math.trunc(n);
        if (n >= 1000000) return trimFix(n / 1000000, 2) + 'M';
        if (n >= 10000) return trimFix(n / 1000, 1) + 'K';
        return n0(n);
    }
    // C# static string Clip(string s, int max)
    function clip(s, max) {
        s = (s === null || s === undefined) ? '' : String(s);
        if (s.length === 0) return '';
        return s.length <= max ? s : s.substring(0, max - 1) + '…';
    }
    // C# int UnitPrice(ShopDef d)
    function unitPrice(d) {
        if (d.qty <= 0) return d.price;
        return Math.max(1, M.roundInt(d.price / d.qty));
    }
    // C# int UnitCoin(ShopDef d)
    function unitCoin(d) {
        if (d.qty <= 0) return d.coinPrice;
        return Math.max(1, M.roundInt(d.coinPrice / d.qty));
    }
    // C# float UpMaxScroll()
    function upMaxScroll() {
        var rows = Math.trunc((Meta.ups.length + 1) / 2);
        return Math.max(0, rows * 104 - 8 - UpView.h);
    }
    function saveAll() { Meta.save(); Profile.save(); }
    function toast(g, text, c) { NB.DrawScene.showToast(g, text, c); }

    function clipRect(ctx, r) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x, r.y, r.w, r.h);
        ctx.clip();
    }

    // ===================== 入口 / 出场 =====================
    // C# GameForm 主菜单点击：state = State.Shop; shopTab = 0/1/2
    function openShop(g, tab) {
        S.tab = (tab === undefined || tab === null) ? 0 : Math.trunc(tab);
        if (S.tab < 0) S.tab = 0;
        if (S.tab > 2) S.tab = 2;
        S.shopFade = 0;
        S.invOpen = false;
        S.qtyOpen = false;
        return S.tab;
    }

    // ===================== 绘制入口（C# DrawShop） =====================
    function drawShop(ctx, g) {
        UI().begin();
        UI().mouse = { x: g.mousePos.x, y: g.mousePos.y };
        UI().uiDt = 0.016;
        S.shopFade = Math.min(1, S.shopFade + 0.08);
        UI().hoverT += 0.016;

        UI().glassPanel(ctx, { x: 110, y: 54, w: 1060, h: 712 }, G.NeonCyan);
        var title = S.tab === 0 ? '砖 块 商 店' : (S.tab === 1 ? '永 久 升 级' : '设 置');
        DR().GlowTextCenter(ctx, title, DR().UIFont(28), Color.White, G.NeonCyan, G.W * 0.5, 60, 3);

        // 页签
        UI().tabBar(ctx, RTabs, ['商 店', '升 级', '设 置'], S.tab, G.NeonCyan);
        UI().miniCapsule(ctx, RInvBtn, '查看我拥有的商品', G.NeonYellow, true, S.invOpen);
        UI().addHot(RInvBtn, 'inv:open');

        // 货币
        drawPill(ctx, { x: 150, y: 154, w: 226, h: 44 }, '积 分', Economy.fmt(Profile.points), G.NeonYellow, -1);
        drawPill(ctx, { x: 388, y: 154, w: 226, h: 44 }, '砖块币', n0(Profile.coins), G.NeonOrange, -1);
        drawPill(ctx, { x: 626, y: 154, w: 226, h: 44 }, '热度 Lv.' + Profile.heatLevel,
            '奖励 x' + Economy.bonusMul.toFixed(2), G.NeonPurple, Profile.heatProgress);

        if (S.tab === 0) drawShopGrid(ctx, g);
        else if (S.tab === 1) drawUpgradeTab(ctx, g);
        else drawSettingsTab(ctx, g);

        UI().miniCapsule(ctx, RBack, '返 回 主 菜 单', G.NeonCyan, true, false);
        UI().addHot(RBack, 'shop:back');

        if (S.invOpen) drawInvModal(ctx, g);
        if (S.qtyOpen) drawQtyModal(ctx, g);
        else UI().hoverT = 0;   // C# 原逻辑：数量弹窗关闭时空闲帧重置悬停计时
    }

    // ===================== 商店页（C# DrawShopGrid） =====================
    function drawShopGrid(ctx, g) {
        // 兑换区
        drawExchangeRow(ctx, g, 0, '积分 → 砖块币', '10 积分 = 1 币', G.NeonOrange, true);
        drawExchangeRow(ctx, g, 1, '砖块币 → 积分', '1 币 = 10 积分', G.NeonYellow, false);

        Meta.buildItems();
        var total = Meta.pageCount;
        if (S.page >= total) S.page = total - 1;
        if (S.page < 0) S.page = 0;

        for (var row = 0; row < 4; row++) {
            for (var col = 0; col < 3; col++) {
                var slot = row * 3 + col;
                var d = Meta.itemAt(S.page, slot);
                if (!d) continue;
                drawShopCard(ctx, g, d, cardRect(col, row));
            }
        }

        // 翻页
        UI().miniCapsule(ctx, { x: 150, y: 708, w: 96, h: 38 }, '< 上一页', G.NeonCyan, S.page > 0, false);
        UI().addHot({ x: 150, y: 708, w: 96, h: 38 }, 'page:prev');
        UI().miniCapsule(ctx, { x: 256, y: 708, w: 96, h: 38 }, '下一页 >', G.NeonCyan, S.page < total - 1, false);
        UI().addHot({ x: 256, y: 708, w: 96, h: 38 }, 'page:next');
        DR().TextLeft(ctx, '第 ' + (S.page + 1) + ' / ' + total + ' 页 · 滚轮一次一格',
            DR().UIFontLight(13), Color.fromArgb(150, 175, 215), 366, 718);
    }

    // C# DrawExchangeRow
    function drawExchangeRow(ctx, g, i, title, sub, tint, ptsToCoin) {
        var r = exRect(i);
        DR().FillRound(ctx, r, 18, Color.fromArgb(200, 12, 11, 26));
        DR().StrokeRound(ctx, r, 18, M.withAlpha(tint, 150), 1.4);
        DR().TextLeft(ctx, title, DR().UIFont(17), Color.White, r.x + 18, r.y + 10);
        DR().TextLeft(ctx, sub, DR().UIFontLight(12), M.withAlpha(G.TextDim, 220), r.x + 18, r.y + 36);

        var bw = 126, bh = 44;
        var by = r.y + (r.h - bh) * 0.5;
        var names = ['全部兑换', '自定义数量'];
        for (var k = 0; k < 2; k++) {
            var b = { x: (r.x + r.w) - 18 - (2 - k) * (bw + 10) + 10, y: by, w: bw, h: bh };
            UI().miniCapsule(ctx, b, names[k], tint, true, false);
            UI().addHot(b, 'ex:' + (ptsToCoin ? 'p2c:' : 'c2p:') + (k === 0 ? 0 : 2));
        }
    }

    // C# DrawShopCard
    function drawShopCard(ctx, g, d, r) {
        var hover = UI().hit(r, g.mousePos);
        var k = UI().ease(UI().anim('card' + r.x + '_' + r.y, hover));
        var rr = { x: r.x - k * 2, y: r.y - k * 2, w: r.w + k * 4, h: r.h + k * 4 };

        DR().FillRound(ctx, rr, 16, Color.fromArgb(Math.trunc(196 + 24 * k), 12, 11, 26));
        DR().StrokeRound(ctx, rr, 16, M.withAlpha(d.tint, Math.trunc(120 + 120 * k)), 1.2 + k * 1.2);
        DR().FillRound(ctx, { x: rr.x + 10, y: rr.y + 12, w: 4, h: 26 }, 2, d.tint);

        var own = Meta.count(d.key);
        DR().TextLeft(ctx, clip(d.name, 12), DR().UIFont(15), Color.White, rr.x + 20, rr.y + 4);
        DR().TextLeft(ctx, '持有 ' + own, DR().UIFontLight(11), M.withAlpha(G.TextDim, 220), (rr.x + rr.w) - 72, rr.y + 7);

        DR().TextLeft(ctx, clip(d.brief, 22), DR().UIFontLight(11), Color.fromArgb(170, 195, 225), rr.x + 20, rr.y + 24);

        DR().TextLeft(ctx, '积分 ' + fmtNum(unitPrice(d)), DR().UIFont(13), G.NeonYellow, rr.x + 20, rr.y + 40);
        DR().TextLeft(ctx, '币 ' + fmtNum(unitCoin(d)), DR().UIFont(13), G.NeonOrange, rr.x + 128, rr.y + 40);
        DR().TextLeft(ctx, '/ ' + d.unit, DR().UIFontLight(11), M.withAlpha(G.TextDim, 200), rr.x + 190, rr.y + 43);

        // 三个小按钮：全部兑换 / 兑换一个 / 自定义数量
        var bh = 24, by = rr.y + 66;
        var canPts = Profile.points >= unitPrice(d);
        var canCoin = Profile.coins >= unitCoin(d);
        UI().miniCapsule(ctx, { x: rr.x + 14, y: by, w: 80, h: bh }, '全部兑换', d.tint, canPts || canCoin, false);
        UI().miniCapsule(ctx, { x: rr.x + 100, y: by, w: 80, h: bh }, '兑换一个', d.tint, canPts || canCoin, false);
        UI().miniCapsule(ctx, { x: rr.x + 186, y: by, w: 112, h: bh }, '自定义数量', d.tint, canPts || canCoin, false);

        var idx = Meta.items.indexOf(d);
        UI().addHot(rr, 'card:' + idx);
        UI().addHot({ x: rr.x + 14, y: by, w: 80, h: bh }, 'buy:all:' + idx);
        UI().addHot({ x: rr.x + 100, y: by, w: 80, h: bh }, 'buy:one:' + idx);
        UI().addHot({ x: rr.x + 186, y: by, w: 112, h: bh }, 'buy:qty:' + idx);

        if (hover && UI().hoverT >= 1) {
            UI().tooltipTitle = d.name;
            UI().tooltipBody = d.detail + '\n单价：积分 ' + unitPrice(d) + ' / 币 ' + unitCoin(d) + '\n当前持有：' + own + ' ' + d.unit;
            UI().tooltipFrame(ctx, rr);
        }
    }

    // ===================== 升级页（C# DrawUpgradeTab） =====================
    function drawUpgradeTab(ctx, g) {
        var maxS = upMaxScroll();
        if (S.upScroll > maxS) S.upScroll = maxS;
        if (S.upScroll < 0) S.upScroll = 0;

        clipRect(ctx, UpView);
        for (var i = 0; i < Meta.ups.length; i++) {
            var u = Meta.ups[i];
            var col = i % 2, row = Math.trunc(i / 2);
            var r = upRect(col, row);
            var inView = (r.y + r.h) > UpView.y + 2 && r.y < (UpView.y + UpView.h) - 2;
            var hover = inView && UI().hit(r, g.mousePos);
            var k = UI().ease(UI().anim('up' + i, hover));
            var rr = { x: r.x - k * 2, y: r.y - k * 2, w: r.w + k * 4, h: r.h + k * 4 };

            DR().FillRound(ctx, rr, 18, Color.fromArgb(Math.trunc(196 + 24 * k), 12, 11, 26));
            DR().StrokeRound(ctx, rr, 18, M.withAlpha(u.tint, Math.trunc(120 + 120 * k)), 1.2 + k * 1.2);
            DR().FillRound(ctx, { x: rr.x + 10, y: rr.y + 12, w: 4, h: 30 }, 2, u.tint);

            DR().TextLeft(ctx, u.name, DR().UIFont(17), Color.White, rr.x + 22, rr.y + 8);
            DR().TextLeft(ctx, 'Lv.' + Meta.lv[i], DR().UIFont(17), u.tint, rr.x + 22 + 96, rr.y + 8);
            DR().TextLeft(ctx, u.desc, DR().UIFontLight(12), Color.fromArgb(165, 190, 222), rr.x + 22, rr.y + 36);
            DR().TextLeft(ctx, '每级 ' + u.unit + '      已获得 ' + Meta.lv[i] + ' 级', DR().UIFontLight(11),
                M.withAlpha(u.tint, 210), rr.x + 22, rr.y + 58);

            var costP = Meta.upCost(i), costC = Meta.upCoinCost(i);
            DR().TextLeft(ctx, '积分 ' + fmtNum(costP), DR().UIFont(13), G.NeonYellow, (rr.x + rr.w) - 236, rr.y + 10);
            DR().TextLeft(ctx, '币 ' + fmtNum(costC), DR().UIFont(13), G.NeonOrange, (rr.x + rr.w) - 236, rr.y + 34);

            var canP = Profile.points >= costP, canC = Profile.coins >= costC;
            UI().miniCapsule(ctx, { x: (rr.x + rr.w) - 132, y: rr.y + 8, w: 116, h: 32 }, '积分升级', u.tint, canP, false);
            UI().miniCapsule(ctx, { x: (rr.x + rr.w) - 132, y: rr.y + 48, w: 116, h: 32 }, '用币升级', G.NeonOrange, canC, false);
            if (inView) {
                UI().addHot(rr, 'upcard:' + i);
                UI().addHot({ x: (rr.x + rr.w) - 132, y: rr.y + 8, w: 116, h: 32 }, 'up:pts:' + i);
                UI().addHot({ x: (rr.x + rr.w) - 132, y: rr.y + 48, w: 116, h: 32 }, 'up:coin:' + i);
            }

            if (hover && UI().hoverT >= 1) {
                UI().tooltipTitle = u.name + '  Lv.' + Meta.lv[i];
                UI().tooltipBody = u.desc + '\n每级 ' + u.unit + '\n下一级需要：积分 ' + fmtNum(costP) + ' 或 币 ' + fmtNum(costC) + '\n等级无上限，价格随等级递增。';
                UI().tooltipFrame(ctx, rr);
            }
        }
        ctx.restore();

        // 滚动条
        if (maxS > 0) {
            var trackH = UpView.h;
            var thumbH = Math.max(60, trackH * (trackH / (trackH + maxS)));
            var thumbY = UpView.y + (trackH - thumbH) * (S.upScroll / maxS);
            DR().FillRound(ctx, { x: (UpView.x + UpView.w) - 8, y: UpView.y, w: 5, h: trackH }, 2.5, Color.fromArgb(90, 40, 60, 90));
            DR().FillRound(ctx, { x: (UpView.x + UpView.w) - 8, y: thumbY, w: 5, h: thumbH }, 2.5, M.withAlpha(G.NeonCyan, 200));
        }
        DR().TextLeft(ctx, '等级无上限 · 价格随等级递增 · 升级后下一局生效 · 滚轮可翻看更多升级', DR().UIFontLight(13), Color.fromArgb(150, 175, 215), 150, 712);
    }

    // ===================== 设置页（C# DrawSettingsTab） =====================
    function drawSettingsTab(ctx, g) {
        var x = 170, y = 210;

        // 图像品质
        DR().TextLeft(ctx, '图像品质', DR().UIFont(18), Color.White, x, y);
        DR().TextLeft(ctx, '低画质更省电，高画质更细腻（改动立即生效）', DR().UIFontLight(12), M.withAlpha(G.TextDim, 220), x + 110, y + 4);
        var qn = ['低', '中', '高'];
        for (var i = 0; i < 3; i++) {
            var b = { x: x + 470 + i * 118, y: y - 10, w: 106, h: 36 };
            UI().miniCapsule(ctx, b, qn[i], G.NeonCyan, true, Meta.quality === i);
            UI().addHot(b, 'set:q:' + i);
        }
        y += 58;

        // 背景音乐
        DR().TextLeft(ctx, '背景音乐', DR().UIFont(18), Color.White, x, y);
        DR().TextLeft(ctx, '开关 / 音量（拖动即听到变化）', DR().UIFontLight(12), M.withAlpha(G.TextDim, 220), x + 110, y + 4);
        UI().miniCapsule(ctx, { x: x + 340, y: y - 10, w: 96, h: 36 }, Meta.musicOn ? '开 启' : '关 闭', G.NeonGreen, true, Meta.musicOn);
        UI().addHot({ x: x + 340, y: y - 10, w: 96, h: 36 }, 'set:musicon');
        UI().miniCapsule(ctx, { x: x + 448, y: y - 10, w: 44, h: 36 }, '-', G.NeonCyan, Meta.musicVol > 0, false);
        UI().miniCapsule(ctx, { x: x + 594, y: y - 10, w: 44, h: 36 }, '+', G.NeonCyan, Meta.musicVol < 100, false);
        UI().addHot({ x: x + 448, y: y - 10, w: 44, h: 36 }, 'set:mv-');
        UI().addHot({ x: x + 594, y: y - 10, w: 44, h: 36 }, 'set:mv+');
        drawPill(ctx, { x: x + 498, y: y - 10, w: 88, h: 36 }, '', Meta.musicVol + '%', G.NeonCyan, Meta.musicVol / 100);
        y += 58;

        // 背景曲目
        DR().TextLeft(ctx, '背景曲目', DR().UIFont(18), Color.White, x, y);
        var tn = ['霓虹夜色', '脉冲街区', '深空漫游', '本地文件'];
        for (var t = 0; t < 4; t++) {
            var tb = { x: x + 340 + (t % 4) * 152, y: y - 10, w: 142, h: 36 };
            UI().miniCapsule(ctx, tb, tn[t], G.NeonPurple, true, Meta.musicTrack === t);
            UI().addHot(tb, 'set:track:' + t);
        }
        if (Meta.musicTrack === 3) {
            DR().TextLeft(ctx, '当前文件：' + ((Meta.musicFile === null || Meta.musicFile === undefined || Meta.musicFile === '') ? '未选择' : fileNameOf(Meta.musicFile)),
                DR().UIFontLight(11), M.withAlpha(G.TextDim, 220), x + 340, y + 26);
        }
        y += 58;

        // 音效
        DR().TextLeft(ctx, '音效', DR().UIFont(18), Color.White, x, y);
        DR().TextLeft(ctx, '按钮、击砖、爆炸等反馈音', DR().UIFontLight(12), M.withAlpha(G.TextDim, 220), x + 110, y + 4);
        UI().miniCapsule(ctx, { x: x + 340, y: y - 10, w: 96, h: 36 }, Meta.sfxOn ? '开 启' : '关 闭', G.NeonGreen, true, Meta.sfxOn);
        UI().addHot({ x: x + 340, y: y - 10, w: 96, h: 36 }, 'set:sfx');
        UI().miniCapsule(ctx, { x: x + 448, y: y - 10, w: 44, h: 36 }, '-', G.NeonCyan, Meta.sfxVol > 0, false);
        UI().miniCapsule(ctx, { x: x + 594, y: y - 10, w: 44, h: 36 }, '+', G.NeonCyan, Meta.sfxVol < 100, false);
        UI().addHot({ x: x + 448, y: y - 10, w: 44, h: 36 }, 'set:sv-');
        UI().addHot({ x: x + 594, y: y - 10, w: 44, h: 36 }, 'set:sv+');
        drawPill(ctx, { x: x + 498, y: y - 10, w: 88, h: 36 }, '', Meta.sfxVol + '%', G.NeonCyan, Meta.sfxVol / 100);
        UI().miniCapsule(ctx, { x: x + 740, y: y - 10, w: 96, h: 36 }, '试 听', G.NeonYellow, Meta.sfxOn, false);
        UI().addHot({ x: x + 740, y: y - 10, w: 96, h: 36 }, 'set:sfxtest');
        y += 58;

        // 屏幕震动
        DR().TextLeft(ctx, '屏幕震动', DR().UIFont(18), Color.White, x, y);
        DR().TextLeft(ctx, '爆炸与失球时的画面抖动', DR().UIFontLight(12), M.withAlpha(G.TextDim, 220), x + 110, y + 4);
        UI().miniCapsule(ctx, { x: x + 340, y: y - 10, w: 96, h: 36 }, Meta.shakeOn ? '开 启' : '关 闭', G.NeonPink, true, Meta.shakeOn);
        UI().addHot({ x: x + 340, y: y - 10, w: 96, h: 36 }, 'set:shake');
        y += 58;

        // 粒子特效
        DR().TextLeft(ctx, '粒子特效', DR().UIFont(18), Color.White, x, y);
        DR().TextLeft(ctx, '击碎砖块与掉落物的火花', DR().UIFontLight(12), M.withAlpha(G.TextDim, 220), x + 110, y + 4);
        UI().miniCapsule(ctx, { x: x + 340, y: y - 10, w: 96, h: 36 }, Meta.particleOn ? '开 启' : '关 闭', G.NeonPurple, true, Meta.particleOn);
        UI().addHot({ x: x + 340, y: y - 10, w: 96, h: 36 }, 'set:particle');
        y += 58;

        // 对局回放
        DR().TextLeft(ctx, '对局回放', DR().UIFont(18), Color.White, x, y);
        DR().TextLeft(ctx, '开启后自动录制 MP4，存于游戏目录', DR().UIFontLight(12), M.withAlpha(G.TextDim, 220), x + 110, y + 4);
        UI().miniCapsule(ctx, RSetReplayOn, Meta.replayOn ? '开 启' : '关 闭', G.NeonGreen, true, Meta.replayOn);
        UI().addHot(RSetReplayOn, 'set:replayon');
        drawSlider(ctx, RSetReplaySlider, (Meta.replayKeep - 2) / 28, Meta.replayOn ? G.NeonCyan : Color.fromArgb(90, 110, 130));
        UI().addHot(RSetReplaySlider, 'set:replaykeep');
        drawPill(ctx, RSetReplayValue, '', Meta.replayKeep + ' 个', G.NeonCyan, (Meta.replayKeep - 2) / 28);
        DR().TextLeft(ctx, '保留 2~30 个回放：超出数量的最旧回放会被永久删除，请提前备份重要录像', DR().UIFontLight(12),
            Meta.replayOn ? Color.fromArgb(240, 120, 130) : Color.fromArgb(120, 130, 150), x + 110, y + 25);
        y += 58;

        // 窗口模式
        DR().TextLeft(ctx, '窗口模式', DR().UIFont(18), Color.White, x, y);
        DR().TextLeft(ctx, '全屏兼容性一般，异常时请改用无边框窗口化全屏', DR().UIFontLight(12), M.withAlpha(G.TextDim, 220), x + 110, y + 4);
        var wn = ['无边框全屏', '全 屏', '普通窗口'];
        for (var w = 0; w < 3; w++) {
            UI().miniCapsule(ctx, RSetWinMode[w], wn[w], G.NeonCyan, true, Meta.windowMode === w);
            UI().addHot(RSetWinMode[w], 'set:win:' + w);
        }

        DR().TextLeft(ctx, '所有设置改动立即生效并自动保存，重开游戏保持一致', DR().UIFontLight(13), Color.fromArgb(150, 175, 215), x, 682);
    }

    // 仅用于显示：C# Path.GetFileName
    function fileNameOf(p) {
        var s = String(p);
        var i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
        return i >= 0 ? s.substring(i + 1) : s;
    }

    // C# DrawSlider
    function drawSlider(ctx, r, t, tint) {
        if (t < 0) t = 0;
        if (t > 1) t = 1;
        var cy = r.y + r.h * 0.5;
        DR().FillRound(ctx, { x: r.x, y: cy - 3, w: r.w, h: 6 }, 3, Color.fromArgb(120, 30, 45, 65));
        DR().FillRound(ctx, { x: r.x, y: cy - 3, w: Math.max(5, r.w * t), h: 6 }, 3, M.withAlpha(tint, 210));
        var hx = r.x + r.w * t;
        DR().FillRound(ctx, { x: hx - 9, y: cy - 9, w: 18, h: 18 }, 9, Color.White);
    }

    // C# DrawPill
    function drawPill(ctx, r, label, value, tint, progress) {
        DR().FillRound(ctx, r, r.h * 0.5, Color.fromArgb(190, 12, 11, 26));
        DR().StrokeRound(ctx, r, r.h * 0.5, M.withAlpha(tint, 150), 1.2);
        if (progress >= 0) {
            DR().FillRound(ctx, { x: r.x + 3, y: r.y + 3, w: Math.max(6, (r.w - 6) * Math.min(1, progress)), h: r.h - 6 },
                (r.h - 6) * 0.5, M.withAlpha(tint, 55));
        }
        if (label.length > 0) {
            DR().TextLeft(ctx, label, DR().UIFontLight(12), M.withAlpha(tint, 230), r.x + 16, r.y + 6);
        }
        DR().TextLeft(ctx, value, DR().UIFont(15), Color.White, r.x + (label.length > 0 ? 84 : 16), r.y + 4);
    }

    // ===================== 拥有物弹窗（C# DrawInvModal） =====================
    function drawInvModal(ctx, g) {
        ctx.fillStyle = Color.rgba(Color.fromArgb(226, 3, 2, 8));
        ctx.fillRect(0, 0, G.W, G.H);

        var panel = { x: 250, y: 90, w: 780, h: 560 };
        UI().glassPanel(ctx, panel, G.NeonYellow);
        DR().GlowTextCenter(ctx, '我 拥 有 的 商 品', DR().UIFont(26), Color.White, G.NeonYellow, panel.x + panel.w * 0.5, panel.y + 26, 2);

        var own = Meta.ownedList();
        var x0 = panel.x + 26, y0 = panel.y + 64;
        var cw = (panel.w - 52 - 16) / 2, ch = 62;
        var rows = Math.trunc((own.length + 1) / 2);
        var maxScroll = Math.max(0, rows * (ch + 10) - (panel.h - 130));
        if (S.invScroll > maxScroll) S.invScroll = maxScroll;
        if (S.invScroll < 0) S.invScroll = 0;

        clipRect(ctx, { x: panel.x + 14, y: y0 - 6, w: panel.w - 28, h: panel.h - 120 });
        for (var i = 0; i < own.length; i++) {
            var col = i % 2, row = Math.trunc(i / 2);
            var r = { x: x0 + col * (cw + 16), y: y0 + row * (ch + 10) - S.invScroll, w: cw, h: ch };
            DR().FillRound(ctx, r, 14, Color.fromArgb(210, 14, 13, 28));
            DR().StrokeRound(ctx, r, 14, Color.fromArgb(120, G.NeonYellow.r, G.NeonYellow.g, G.NeonYellow.b), 1.2);
            var s = own[i];
            var sp = s.indexOf(' ×');
            if (sp > 0) {
                DR().TextLeft(ctx, s.substring(0, sp), DR().UIFont(15), Color.White, r.x + 16, r.y + 12);
                DR().TextLeft(ctx, s.substring(sp + 1), DR().UIFont(15), G.NeonYellow, r.x + 16, r.y + 34);
            } else {
                DR().TextLeft(ctx, s, DR().UIFont(14), Color.White, r.x + 16, r.y + 20);
            }
        }
        ctx.restore();

        if (own.length === 0) {
            DR().TextCenter(ctx, '还没有任何商品，去商店逛逛吧', DR().UIFontLight(16), M.withAlpha(G.TextDim, 230),
                panel.x + panel.w * 0.5, panel.y + 200);
        }

        UI().scrollBar(ctx, { x: (panel.x + panel.w) - 14, y: y0, w: 6, h: panel.h - 130 }, maxScroll, S.invScroll, G.NeonYellow);

        var close = { x: panel.x + panel.w * 0.5 - 70, y: (panel.y + panel.h) - 56, w: 140, h: 40 };
        UI().miniCapsule(ctx, close, '关 闭', G.NeonCyan, true, false);
        UI().addHot(close, 'inv:close');
        DR().TextLeft(ctx, '共 ' + own.length + ' 项 · 滚轮滚动查看', DR().UIFontLight(12), M.withAlpha(G.TextDim, 220), panel.x + 24, (panel.y + panel.h) - 44);
    }

    // ===================== 数量弹窗（C# DrawQtyModal） =====================
    function drawQtyModal(ctx, g) {
        ctx.fillStyle = Color.rgba(Color.fromArgb(226, 3, 2, 8));
        ctx.fillRect(0, 0, G.W, G.H);

        var tint = S.qtyMode === 0 ? G.NeonCyan : (S.qtyMode === 1 ? G.NeonOrange : G.NeonYellow);
        var panel = { x: 400, y: 168, w: 480, h: 404 };
        UI().glassPanel(ctx, panel, tint);

        var isEx = S.qtyMode !== 0;
        var head = isEx ? (S.qtyMode === 1 ? '积分 换 砖块币' : '砖块币 换 积分') : clip(S.qtyTitle, 14);
        DR().GlowTextCenter(ctx, head, DR().UIFont(22), Color.White, tint, panel.x + panel.w * 0.5, panel.y + 18, 2);

        var sub;
        if (S.qtyMode === 0) sub = '单价  积分 ' + n0(S.qtyUnitPoints) + '  /  币 ' + n0(S.qtyUnitCoins);
        else if (S.qtyMode === 1) sub = '10 积分兑换 1 砖块币';
        else sub = '1 砖块币兑换 10 积分';
        DR().TextCenter(ctx, sub, DR().UIFontLight(14), M.withAlpha(tint, 235), panel.x + panel.w * 0.5, panel.y + 52);

        var hold;
        if (S.qtyMode === 0) {
            var hk = (S.qtyItemIdx >= 0 && S.qtyItemIdx < Meta.items.length) ? Meta.items[S.qtyItemIdx].key : '';
            hold = '持 有  ' + Meta.count(hk) + ' 件';
        } else {
            hold = '您的积分 ' + Economy.fmt(Profile.points) + '        您的砖块币 ' + n0(Profile.coins);
        }
        DR().TextCenter(ctx, hold, DR().UIFontLight(13), Color.fromArgb(165, 190, 222), panel.x + panel.w * 0.5, panel.y + 74);

        // 数量框
        var box = { x: panel.x + 34, y: panel.y + 96, w: panel.w - 68, h: 60 };
        DR().FillRound(ctx, box, 30, Color.fromArgb(215, 14, 13, 28));
        DR().StrokeRound(ctx, box, 30, M.withAlpha(tint, 180), 1.6);
        UI().miniCapsule(ctx, { x: panel.x + 46, y: panel.y + 108, w: 56, h: 36 }, '-', tint, S.qtyVal > 1, false);
        UI().miniCapsule(ctx, { x: panel.x + 378, y: panel.y + 108, w: 56, h: 36 }, '+', tint, true, false);
        UI().addHot({ x: panel.x + 46, y: panel.y + 108, w: 56, h: 36 }, 'qty:-');
        UI().addHot({ x: panel.x + 378, y: panel.y + 108, w: 56, h: 36 }, 'qty:+');
        DR().TextCenter(ctx, n0(S.qtyVal), DR().NumFont(30), Color.White, panel.x + panel.w * 0.5, panel.y + 112);

        // 鼠标数字键盘
        var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];
        for (var i = 0; i < keys.length; i++) {
            var col = i % 3, row = Math.trunc(i / 3);
            var b = { x: panel.x + 40 + col * 62, y: panel.y + 182 + row * 42, w: 56, h: 36 };
            var id = keys[i] === 'C' ? 'qty:clr' : (keys[i] === '⌫' ? 'qty:del' : 'qty:d' + keys[i]);
            UI().miniCapsule(ctx, b, keys[i], Color.fromArgb(120, 130, 190), true, false);
            UI().addHot(b, id);
        }

        // 快捷数量
        var quick = [1, 5, 10, 50];
        for (var q = 0; q < quick.length; q++) {
            var qb = { x: panel.x + 254 + (q % 2) * 116, y: panel.y + 182 + Math.trunc(q / 2) * 42, w: 108, h: 36 };
            UI().miniCapsule(ctx, qb, 'x' + quick[q], G.NeonPurple, true, S.qtyVal === quick[q]);
            UI().addHot(qb, 'qty:q' + quick[q]);
        }

        // 合计
        if (S.qtyMode === 0) {
            DR().TextLeft(ctx, '合计  积分 ' + n0(S.qtyUnitPoints * S.qtyVal), DR().UIFont(14), G.NeonYellow, panel.x + 254, panel.y + 268);
            DR().TextLeft(ctx, '      或  币 ' + n0(S.qtyUnitCoins * S.qtyVal), DR().UIFont(14), G.NeonOrange, panel.x + 254, panel.y + 292);
        } else if (S.qtyMode === 1) {
            DR().TextLeft(ctx, '消耗积分 ' + n0(S.qtyVal * 10), DR().UIFont(14), G.NeonYellow, panel.x + 254, panel.y + 268);
            DR().TextLeft(ctx, '获得砖块币 ' + n0(S.qtyVal), DR().UIFont(14), G.NeonOrange, panel.x + 254, panel.y + 292);
        } else {
            DR().TextLeft(ctx, '消耗砖块币 ' + n0(S.qtyVal), DR().UIFont(14), G.NeonOrange, panel.x + 254, panel.y + 268);
            DR().TextLeft(ctx, '获得积分 ' + n0(S.qtyVal * 10), DR().UIFont(14), G.NeonYellow, panel.x + 254, panel.y + 292);
        }

        // 确认按钮
        if (S.qtyMode === 0) {
            var canP = Profile.points >= S.qtyUnitPoints * S.qtyVal;
            var canC = Profile.coins >= S.qtyUnitCoins * S.qtyVal;
            UI().miniCapsule(ctx, { x: panel.x + 34, y: panel.y + 356, w: 200, h: 44 }, '用积分购买', G.NeonYellow, canP, false);
            UI().miniCapsule(ctx, { x: panel.x + 246, y: panel.y + 356, w: 200, h: 44 }, '用币购买', G.NeonOrange, canC, false);
            UI().addHot({ x: panel.x + 34, y: panel.y + 356, w: 200, h: 44 }, 'qty:buyP');
            UI().addHot({ x: panel.x + 246, y: panel.y + 356, w: 200, h: 44 }, 'qty:buyC');
        } else {
            var can = S.qtyMode === 1 ? Profile.points >= S.qtyVal * 10 : Profile.coins >= S.qtyVal;
            UI().miniCapsule(ctx, { x: panel.x + 34, y: panel.y + 356, w: 412, h: 44 }, '确 认 兑 换', tint, can, false);
            UI().addHot({ x: panel.x + 34, y: panel.y + 356, w: 412, h: 44 }, 'qty:ok');
        }

        UI().miniCapsule(ctx, { x: (panel.x + panel.w) - 84, y: panel.y + 16, w: 62, h: 30 }, '取消', Color.fromArgb(150, 130, 140, 180), true, false);
        UI().addHot({ x: (panel.x + panel.w) - 84, y: panel.y + 16, w: 62, h: 30 }, 'qty:cancel');
    }

    // ===================== 点击处理（C# HandleShopClick） =====================
    // 返回值：'' = 无状态切换；'menu' = 请求返回主菜单（由 game.js 改 state）
    function handleShopClick(g, p) {
        var id = UI().hitId(p);
        if (!id || id.length === 0) return '';

        if (S.invOpen) {
            if (id === 'inv:close') S.invOpen = false;
            return '';
        }
        if (S.qtyOpen) { qtyClick(g, id); return ''; }

        if (id === 'shop:back') { S.shopFade = 0; return 'menu'; }
        if (id === 'inv:open') { S.invOpen = true; S.invScroll = 0; return ''; }
        if (id.indexOf('tab:') === 0) {
            var t = parseInt(id.substring(4), 10);
            if (!isNaN(t)) { S.tab = t; UI().hoverT = 0; }
            return '';
        }
        if (id === 'page:prev' && S.page > 0) { S.page--; UI().hoverT = 0; return ''; }
        if (id === 'page:next' && S.page < Meta.pageCount - 1) { S.page++; UI().hoverT = 0; return ''; }

        if (id.indexOf('ex:') === 0) {
            var p2c = id.indexOf('ex:p2c:') === 0;
            var k = id.substring(id.lastIndexOf(':') + 1);
            if (k === '0') exchangeAll(g, p2c);
            else if (k === '1') exchangeOne(g, p2c);
            else openQtyExchange(p2c);   // 自定义数量
            return '';
        }

        if (id.indexOf('buy:') === 0) {
            var s = id.split(':');
            var idx = parseInt(s[2], 10);
            if (isNaN(idx)) return '';
            if (idx < 0 || idx >= Meta.items.length) return '';
            var d = Meta.items[idx];
            if (s[1] === 'all') buyMax(g, d);
            else if (s[1] === 'one') buy(g, d, 1);
            else openQtyBuy(d);
            return '';
        }

        if (id.indexOf('up:') === 0) {
            var su = id.split(':');
            var ui = parseInt(su[2], 10);
            if (isNaN(ui)) return '';
            upgradeWith(g, ui, su[1] === 'pts');
            return '';
        }

        if (id.indexOf('set:') === 0) { handleSetting(g, id.substring(4)); return ''; }
        return '';
    }

    // ---------- 兑换（C# ExchangeAll / ExchangeOne） ----------
    function exchangeAll(g, p2c) {
        if (p2c) {
            var n = Math.trunc(Profile.points / 10);
            if (n <= 0) { toast(g, '积分不足 10，无法兑换', G.NeonOrange); return; }
            Profile.points -= n * 10;
            Profile.coins += n;
            Profile.save();
            Sfx.play('buy');
            toast(g, '兑换成功：' + n + ' 砖块币', G.NeonGreen);
        } else {
            var m = Profile.coins;
            if (m <= 0) { toast(g, '没有砖块币可以兑换', G.NeonOrange); return; }
            Profile.coins = 0;
            Profile.points += m * 10;
            Profile.save();
            Sfx.play('buy');
            toast(g, '兑换成功：' + (m * 10) + ' 积分', G.NeonGreen);
        }
    }

    function exchangeOne(g, p2c) {
        if (p2c) {
            if (Profile.points < 10) { toast(g, '积分不足 10', G.NeonOrange); return; }
            Profile.points -= 10; Profile.coins += 1; Profile.save();
            Sfx.play('buy'); toast(g, '兑换成功：1 砖块币', G.NeonGreen);
        } else {
            if (Profile.coins < 1) { toast(g, '没有砖块币', G.NeonOrange); return; }
            Profile.coins -= 1; Profile.points += 10; Profile.save();
            Sfx.play('buy'); toast(g, '兑换成功：10 积分', G.NeonGreen);
        }
    }

    // C# OpenQtyExchange
    function openQtyExchange(p2c) {
        S.qtyOpen = true; S.qtyVal = 1; S.qtyFresh = true; S.qtyMode = p2c ? 1 : 2;
        S.qtyIsUpgrade = false;
        S.qtyTitle = p2c ? '积分 换 砖块币' : '砖块币 换 积分';
        S.qtyUnitPoints = p2c ? 10 : 0;
        S.qtyUnitCoins = p2c ? 0 : 1;
    }

    // C# OpenQtyBuy
    function openQtyBuy(d) {
        S.qtyOpen = true; S.qtyVal = Math.max(1, d.qty); S.qtyFresh = true; S.qtyMode = 0;
        S.qtyIsUpgrade = false;
        S.qtyItemIdx = Meta.items.indexOf(d);
        S.qtyTitle = d.name;
        S.qtyUnitPoints = unitPrice(d);
        S.qtyUnitCoins = unitCoin(d);
    }

    // C# int MaxAffordable(ShopDef d)
    function maxAffordable(d) {
        var byPts = Math.trunc(Profile.points / Math.max(1, unitPrice(d)));
        var byCoin = Math.trunc(Profile.coins / Math.max(1, unitCoin(d)));
        var m = Math.max(byPts, byCoin);
        if (d.key === 'startpaddle' || d.key === 'startdrop') return Math.max(0, Math.min(m, 9999));
        return Math.max(0, Math.min(m, 99));
    }

    function buyMax(g, d) {
        var n = maxAffordable(d);
        if (n <= 0) { toast(g, '余额不足', G.NeonOrange); return; }
        buy(g, d, n);
    }

    // C# Buy(ShopDef d, int n)
    function buy(g, d, n) {
        if (n <= 0) return;
        var costP = unitPrice(d) * n, costC = unitCoin(d) * n;
        var usePts = Profile.points >= costP;
        if (!usePts && Profile.coins < costC) { toast(g, '积分与币都不足', G.NeonOrange); return; }
        if (usePts) Profile.points -= costP; else Profile.coins -= costC;
        Profile.save();

        if (d.packId >= 0) {
            var s = Meta.openPack(d.packId);
            if (n > 1) {
                for (var i = 1; i < n; i++) Meta.openPack(d.packId);
            }
            Sfx.play('buy');
            toast(g, s, G.NeonYellow);
        } else {
            Meta.grant(d.key, n);
            Sfx.play('buy');
            toast(g, '购买成功：' + d.name + '（' + (usePts ? '积分 ' + n0(costP) : '币 ' + n0(costC)) + '）', d.tint);
        }
        saveAll();
    }

    // C# UpgradeWith(int idx, bool usePoints)
    function upgradeWith(g, idx, usePoints) {
        if (idx < 0 || idx >= Meta.ups.length) return;
        var cp = Meta.upCost(idx), cc = Meta.upCoinCost(idx);
        if (usePoints) {
            if (Profile.points < cp) { toast(g, '积分不足', G.NeonOrange); return; }
            Profile.points -= cp;
        } else {
            if (Profile.coins < cc) { toast(g, '砖块币不足', G.NeonOrange); return; }
            Profile.coins -= cc;
        }
        Meta.lv[idx]++;
        Profile.save();
        Meta.save();
        Sfx.play('buy');
        toast(g, Meta.ups[idx].name + ' 升到 Lv.' + Meta.lv[idx], Meta.ups[idx].tint);
    }

    // ---------- 数量弹窗交互（C# QtyType / QtyClick） ----------
    function qtyType(d) {
        if (S.qtyFresh) { S.qtyVal = Math.max(1, d); S.qtyFresh = false; return; }
        var v = S.qtyVal * 10 + d;
        if (v > 9999) v = 9999;
        S.qtyVal = Math.max(1, v);
        S.qtyFresh = false;
    }

    function qtyClick(g, id) {
        if (id === 'qty:cancel') { S.qtyOpen = false; return; }
        if (id === 'qty:-') { S.qtyVal = Math.max(1, S.qtyVal - 1); S.qtyFresh = false; return; }
        if (id === 'qty:+') { if (S.qtyVal < 9999) S.qtyVal++; S.qtyFresh = false; return; }
        if (id === 'qty:del') { S.qtyVal = Math.trunc(S.qtyVal / 10); if (S.qtyVal < 1) S.qtyVal = 1; S.qtyFresh = false; return; }
        if (id === 'qty:clr') { S.qtyVal = 1; S.qtyFresh = true; return; }
        if (id.indexOf('qty:d') === 0) {
            var dv = parseInt(id.substring(5), 10);
            if (!isNaN(dv)) qtyType(dv);
            return;
        }
        if (id.indexOf('qty:q') === 0) {
            var qv = parseInt(id.substring(5), 10);
            if (!isNaN(qv)) { S.qtyVal = Math.max(1, qv); S.qtyFresh = false; }
            return;
        }
        if (id === 'qty:ok') { qtyClick(g, 'qty:buyP'); return; }
        if (id === 'qty:buyP' || id === 'qty:buyC') {
            var usePts = id.lastIndexOf('buyP') === id.length - 4;
            if (S.qtyMode !== 0) {
                // 兑换
                if (S.qtyMode === 1) {
                    var n1 = S.qtyVal;
                    if (Profile.points < n1 * 10) { toast(g, '积分不足', G.NeonOrange); return; }
                    Profile.points -= n1 * 10; Profile.coins += n1; Profile.save();
                    toast(g, '兑换成功：' + n1 + ' 砖块币', G.NeonGreen);
                } else {
                    var n2 = S.qtyVal;
                    if (Profile.coins < n2) { toast(g, '砖块币不足', G.NeonOrange); return; }
                    Profile.coins -= n2; Profile.points += n2 * 10; Profile.save();
                    toast(g, '兑换成功：' + (n2 * 10) + ' 积分', G.NeonGreen);
                }
                Sfx.play('buy');
                S.qtyOpen = false;
                return;
            }
            if (S.qtyItemIdx >= 0 && S.qtyItemIdx < Meta.items.length) {
                var d = Meta.items[S.qtyItemIdx];
                var cost = usePts ? unitPrice(d) * S.qtyVal : unitCoin(d) * S.qtyVal;
                if (usePts && Profile.points < cost) { toast(g, '积分不足', G.NeonOrange); return; }
                if (!usePts && Profile.coins < cost) { toast(g, '砖块币不足', G.NeonOrange); return; }
                if (usePts) Profile.points -= cost; else Profile.coins -= cost;
                Profile.save();
                if (d.packId >= 0) {
                    var s = Meta.openPack(d.packId);
                    if (S.qtyVal > 1) for (var i = 1; i < S.qtyVal; i++) Meta.openPack(d.packId);
                    toast(g, s, G.NeonYellow);
                } else {
                    Meta.grant(d.key, S.qtyVal);
                    toast(g, '购买成功：' + d.name + ' ×' + S.qtyVal, d.tint);
                }
                Sfx.play('buy');
                S.qtyOpen = false;
                saveAll();
            }
        }
    }

    // C# QtyKey(KeyEventArgs e)：key 为 KeyboardEvent.key / KeyboardEvent.code
    function qtyKey(g, e) {
        if (!S.qtyOpen) return false;
        var code = (e && e.code) ? String(e.code) : '';
        if (code === 'Escape') { S.qtyOpen = false; return true; }
        if (code === 'Backspace') {
            S.qtyVal = Math.trunc(S.qtyVal / 10);
            if (S.qtyVal < 1) S.qtyVal = 1;
            return true;
        }
        if (code === 'Enter' || code === 'NumpadEnter') { qtyClick(g, 'qty:buyP'); return true; }
        var d = -1;
        if (/^Digit[0-9]$/.test(code)) d = parseInt(code.substring(5), 10);
        if (/^Numpad[0-9]$/.test(code)) d = parseInt(code.substring(6), 10);
        if (d >= 0) { qtyType(d); return true; }
        return false;
    }

    // ---------- 设置交互（C# HandleSetting） ----------
    function handleSetting(g, k) {
        if (k.indexOf('q:') === 0) {
            var v = parseInt(k.substring(2), 10);
            if (!isNaN(v)) {
                Meta.quality = Math.max(0, Math.min(2, v));
                if (typeof hooks.rebuildBackdrop === 'function') hooks.rebuildBackdrop(g);
                saveAll();
            }
            return;
        }
        if (k === 'musicon') { Meta.musicOn = !Meta.musicOn; Music.apply(); saveAll(); return; }
        if (k === 'mv-') {
            Meta.musicVol = Math.max(0, Meta.musicVol - 5);
            if (Meta.musicVol <= 0) Music.stop(); else Music.setVolume();
            saveAll(); return;
        }
        if (k === 'mv+') {
            Meta.musicVol = Math.min(100, Meta.musicVol + 5);
            if (Meta.musicOn) { if (Meta.musicVol === 5) Music.apply(); else Music.setVolume(); }
            saveAll(); return;
        }
        if (k.indexOf('track:') === 0) {
            var tv = parseInt(k.substring(6), 10);
            if (!isNaN(tv)) {
                Meta.musicTrack = tv;
                if (tv === 3) {
                    // C# OpenFileDialog："音频文件|*.mp3;*.wav;*.wma|所有文件|*.*"，取消则回落到曲目 0
                    if (typeof hooks.pickMusicFile === 'function') {
                        hooks.pickMusicFile(function (fileName) {
                            if (fileName) Meta.musicFile = fileName; else Meta.musicTrack = 0;
                            Music.apply();
                            saveAll();
                        });
                    } else {
                        Meta.musicTrack = 0;
                        Music.apply();
                        saveAll();
                    }
                    return;
                }
                Music.apply();
                saveAll();
            }
            return;
        }
        if (k === 'sfx') {
            Meta.sfxOn = !Meta.sfxOn;
            Sfx.muted = !Meta.sfxOn;
            Sfx.play('click');
            saveAll(); return;
        }
        if (k === 'sfxtest') { Sfx.play('brick'); return; }
        if (k === 'sv-') {
            Meta.sfxVol = Math.max(0, Meta.sfxVol - 5);
            Sfx.volume = Meta.sfxVol / 100;
            Sfx.play('click');
            saveAll(); return;
        }
        if (k === 'sv+') {
            Meta.sfxVol = Math.min(100, Meta.sfxVol + 5);
            Sfx.volume = Meta.sfxVol / 100;
            Sfx.play('click');
            saveAll(); return;
        }
        if (k === 'shake') { Meta.shakeOn = !Meta.shakeOn; saveAll(); return; }
        if (k === 'particle') { Meta.particleOn = !Meta.particleOn; saveAll(); return; }
        if (k === 'replayon') {
            Meta.replayOn = !Meta.replayOn;
            Sfx.play('click');
            if (!Meta.replayOn && typeof hooks.replayStop === 'function') hooks.replayStop();
            saveAll();
            return;
        }
        if (k === 'replaykeep') {
            // 按下时按点击位置立即设定，之后可拖动微调
            S.replaySliderDrag = true;
            setReplayKeepFromX(g.mousePos.x);
            return;
        }
        if (k.indexOf('win:') === 0) {
            var wv = parseInt(k.substring(4), 10);
            if (!isNaN(wv)) {
                Meta.windowMode = Math.max(0, Math.min(2, wv));
                if (typeof hooks.applyWindowMode === 'function') hooks.applyWindowMode();
                Sfx.play('click');
                saveAll();
            }
            return;
        }
    }

    // C# SetReplayKeepFromX(float x)
    function setReplayKeepFromX(x) {
        var t = (x - RSetReplaySlider.x) / RSetReplaySlider.w;
        if (t < 0) t = 0;
        if (t > 1) t = 1;
        var v = 2 + M.roundInt(t * 28);
        if (v < 2) v = 2;
        if (v > 30) v = 30;
        if (v !== Meta.replayKeep) {
            Meta.replayKeep = v;
            Meta.save();
        }
    }

    // C# UpdateReplaySliderDrag()：由 game.js 每帧（或鼠标移动/抬键时）调用
    // mouseDown 为当前左键是否按下
    function updateReplaySliderDrag(g, mouseDown) {
        if (!S.replaySliderDrag) return;
        if (!g || g.state !== NB.State.Shop) { S.replaySliderDrag = false; return; }
        if (mouseDown) setReplayKeepFromX(g.mousePos.x);
        else {
            S.replaySliderDrag = false;
            if (typeof hooks.replayCleanup === 'function') hooks.replayCleanup(Meta.replayKeep);
        }
    }

    // ---------- 滚轮（C# ShopWheel） ----------
    function shopWheel(g, delta) {
        var dir = delta > 0 ? -1 : 1;
        if (S.invOpen) {
            S.invScroll += dir * 46;
            if (S.invScroll < 0) S.invScroll = 0;
            return;
        }
        if (S.qtyOpen) return;
        var now = Date.now();
        if (now - S.wheelTick < 240) return;   // 同一格滚轮动作只翻一页
        S.wheelTick = now;
        if (S.tab === 0) {
            if (delta > 0 && S.page > 0) S.page--;
            else if (delta < 0 && S.page < Meta.pageCount - 1) S.page++;
            UI().hoverT = 0;
        } else if (S.tab === 1) {
            S.upScroll += dir * 60;
            var maxS = upMaxScroll();
            if (S.upScroll < 0) S.upScroll = 0;
            if (S.upScroll > maxS) S.upScroll = maxS;
            UI().hoverT = 0;
        }
    }

    // ===================== 导出 =====================
    NB.Shop = {
        // 布局常量（game.js / 文档对照用）
        RTabs: RTabs, RBack: RBack, RInvBtn: RInvBtn, UpView: UpView,
        RSetReplayOn: RSetReplayOn, RSetReplaySlider: RSetReplaySlider,
        RSetReplayValue: RSetReplayValue, RSetWinMode: RSetWinMode,
        exRect: exRect, cardRect: cardRect, upRect: upRect, upMaxScroll: upMaxScroll,

        // 状态与钩子
        st: S,
        hooks: hooks,

        // 绘制
        drawShop: drawShop,
        drawShopGrid: drawShopGrid,
        drawExchangeRow: drawExchangeRow,
        drawShopCard: drawShopCard,
        drawUpgradeTab: drawUpgradeTab,
        drawSettingsTab: drawSettingsTab,
        drawSlider: drawSlider,
        drawPill: drawPill,
        drawInvModal: drawInvModal,
        drawQtyModal: drawQtyModal,

        // 交互
        openShop: openShop,
        handleShopClick: handleShopClick,
        shopWheel: shopWheel,
        qtyClick: qtyClick,
        qtyKey: qtyKey,
        qtyType: qtyType,
        handleSetting: handleSetting,
        setReplayKeepFromX: setReplayKeepFromX,
        updateReplaySliderDrag: updateReplaySliderDrag,
        exchangeAll: exchangeAll,
        exchangeOne: exchangeOne,
        buy: buy,
        buyMax: buyMax,
        maxAffordable: maxAffordable,
        upgradeWith: upgradeWith,
        openQtyBuy: openQtyBuy,
        openQtyExchange: openQtyExchange,
        unitPrice: unitPrice,
        unitCoin: unitCoin,
        fmtNum: fmtNum,
        clip: clip,
        saveAll: saveAll
    };

})();
