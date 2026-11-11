/*
 * render.js —— 移植自 Codes/Render.cs（Draw 绘制基元）与 Codes/UiKit.cs（即时模式 UI 组件）
 * ------------------------------------------------------------------
 * 加载方式：经典 <script>，非 ES Module；IIFE 包裹。
 * 依赖：core.js（NB.G / NB.M / NB.Color）；meta.js（运行期读 NB.Meta.quality，缺失时默认 2）
 *
 * 全部基于 Canvas2D。C# 的 Graphics 参数 → 本模块的第一个参数 ctx（CanvasRenderingContext2D）；
 * C# 的 RectangleF → JS 矩形对象 {x,y,w,h}；C# 的 Color → core.js 的 {r,g,b,a}。
 *
 * 导出清单（挂在全局 NB 上）：
 *   NB.Draw = {
 *     F(family,size,style)            字体串（带缓存）
 *     TitleFont(size)                 Impact
 *     UIFont(size)                    "Microsoft YaHei UI" Bold
 *     UIFontLight(size)               "Microsoft YaHei UI" Regular
 *     NumFont(size)                   Consolas Bold
 *     Quality(ctx)                    按 NB.Meta.quality 设置插值/平滑
 *     RoundRect(ctx,r,radius)         构建圆角矩路径（不描边不填充）
 *     FillRound(ctx,r,radius,c)
 *     StrokeRound(ctx,r,radius,c,width)
 *     GlowRound(ctx,r,radius,c,glowLayers)
 *     FillRoundGradient(ctx,r,radius,top,bottom)
 *     TextLeft(ctx,s,font,c,x,y)
 *     TextCenter(ctx,s,font,c,cx,y)
 *     Measure(ctx,s,font)             → {width,height}
 *     GlowTextCenter(ctx,s,font,c,glow,cx,y,strength)
 *     HeartPath(ctx,cx,cy,size)       构建心形路径
 *     Sparkle(ctx,cx,cy,r,c)
 *     BuildBackdrop(w,h,rnd?,quality?) → 离屏 canvas（渐变 + 光晕 + 网格 + 星点）
 *     fontHeight(size)                近似字号行高（f.Height 等价物）
 *   }
 *   NB.UI = {
 *     mouse:{x,y}, uiDt, hoverT, hoverId, tooltipTitle, tooltipBody,
 *     begin(), addHot(r,id), hitId(p), anim(id,on), ease(k),
 *     capsule(ctx,r,text,sub,tint,enabled,selected),
 *     glassPanel(ctx,r,tint),
 *     miniCapsule(ctx,r,text,tint,enabled,selected),
 *     scrollBar(ctx,track,maxScroll,pos,tint),
 *     tooltipFrame(ctx,card),
 *     tabBar(ctx,area,names,cur,tint)
 *   }
 */
(function () {
    'use strict';

    var NB = globalThis.NB = globalThis.NB || {};
    var G = NB.G;
    var M = NB.M;
    var Color = NB.Color;

    // ===================== 字体 =====================
    var FONT_CACHE = Object.create(null);

    function styleFlags(style) {
        if (typeof style === 'string') {
            var s = style.toLowerCase();
            return { bold: s.indexOf('bold') >= 0, italic: s.indexOf('italic') >= 0 };
        }
        var n = Number(style) || 0;
        // C# FontStyle: Regular=0, Bold=1, Italic=2, Underline=4, Strikeout=8
        return { bold: (n & 1) !== 0, italic: (n & 2) !== 0 };
    }

    function familyStack(family) {
        switch (family) {
            case 'Impact': return 'Impact, Haettenschweiler, "Arial Black", sans-serif';
            case 'Microsoft YaHei UI':
            case 'Microsoft YaHei': return '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif';
            case 'Consolas': return 'Consolas, "Courier New", monospace';
            default: return '"' + family + '", sans-serif';
        }
    }

    function F(family, size, style) {
        var fl = styleFlags(style);
        var key = family + '|' + size + '|' + (fl.bold ? 'b' : '') + (fl.italic ? 'i' : '');
        var cached = FONT_CACHE[key];
        if (cached) return cached;
        var font = (fl.italic ? 'italic ' : '') + (fl.bold ? 'bold ' : '') + size + 'px ' + familyStack(family);
        FONT_CACHE[key] = font;
        return font;
    }

    // C# Font.Height 近似：像素字体单位下约为 1.32 倍字号
    function fontHeight(size) { return size * 1.32; }

    var Draw = {
        F: F,
        fontHeight: fontHeight,

        TitleFont: function (size) { return F('Impact', size, 0); },
        UIFont: function (size) { return F('Microsoft YaHei UI', size, 1); },
        UIFontLight: function (size) { return F('Microsoft YaHei UI', size, 0); },
        NumFont: function (size) { return F('Consolas', size, 1); },

        qualityOf: function () {
            var M2 = NB.Meta;
            if (!M2) return 2;
            return typeof M2.quality === 'number' ? M2.quality : 2;
        },

        // C# Draw.Quality(Graphics g)
        Quality: function (ctx) {
            if (!ctx) return;
            var q = this.qualityOf();
            try {
                if (q <= 0) {
                    ctx.imageSmoothingEnabled = false;
                    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'low';
                } else if (q === 1) {
                    ctx.imageSmoothingEnabled = true;
                    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'low';
                } else {
                    ctx.imageSmoothingEnabled = true;
                    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
                }
            } catch (e) { /* 静默 */ }
        },

        // C# Draw.RoundRect：先 AddArc(直径 d) 四角 → canvas 用 arcTo(半径 d/2)
        RoundRect: function (ctx, r, radius) {
            var d = Math.min(radius * 2, Math.min(r.w, r.h));
            ctx.beginPath();
            if (d <= 0.5) {
                ctx.rect(r.x, r.y, r.w, r.h);
                return;
            }
            var x = r.x, y = r.y, w = r.w, h = r.h, rad = d / 2;
            ctx.moveTo(x + rad, y);
            ctx.arcTo(x + w, y, x + w, y + h, rad);
            ctx.arcTo(x + w, y + h, x, y + h, rad);
            ctx.arcTo(x, y + h, x, y, rad);
            ctx.arcTo(x, y, x + w, y, rad);
            ctx.closePath();
        },

        FillRound: function (ctx, r, radius, c) {
            if (r.w <= 0 || r.h <= 0) return;
            this.RoundRect(ctx, r, radius);
            ctx.fillStyle = Color.rgba(c);
            ctx.fill();
        },

        StrokeRound: function (ctx, r, radius, c, width) {
            if (r.w <= 0 || r.h <= 0) return;
            this.RoundRect(ctx, r, radius);
            ctx.strokeStyle = Color.rgba(c);
            ctx.lineWidth = width;
            ctx.stroke();
        },

        // C# Draw.GlowRound：多层半透明外扩描边模拟辉光
        GlowRound: function (ctx, r, radius, c, glowLayers) {
            var q = this.qualityOf();
            if (q <= 0) glowLayers = 1;
            else if (q === 1 && glowLayers > 2) glowLayers = 2;
            for (var i = glowLayers; i >= 1; i--) {
                var pad = i * 2.2;
                var a = Math.trunc(60 / i);
                this.StrokeRound(ctx,
                    { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 },
                    radius + pad,
                    Color.fromArgb(a, c.r, c.g, c.b), 2);
            }
            this.StrokeRound(ctx, r, radius, Color.fromArgb(190, c.r, c.g, c.b), 1.4);
        },

        // C# Draw.FillRoundGradient：垂直线性渐变
        FillRoundGradient: function (ctx, r, radius, top, bottom) {
            if (r.w <= 0 || r.h <= 0) return;
            var grad;
            try {
                grad = ctx.createLinearGradient(0, r.y - 1, 0, r.y + r.h + 1);
            } catch (e) { return; }
            grad.addColorStop(0, Color.rgba(top));
            grad.addColorStop(1, Color.rgba(bottom));
            this.RoundRect(ctx, r, radius);
            ctx.fillStyle = grad;
            ctx.fill();
        },

        TextLeft: function (ctx, s, font, c, x, y) {
            ctx.font = font;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillStyle = Color.rgba(c);
            ctx.fillText(String(s), x, y);
        },

        // C# Draw.TextCenter：水平居中、垂直顶部对齐（矩形 cx-600, y, 1200, f.Height+8）
        TextCenter: function (ctx, s, font, c, cx, y) {
            ctx.font = font;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillStyle = Color.rgba(c);
            ctx.fillText(String(s), cx, y);
        },

        // C# Draw.Measure → SizeF
        Measure: function (ctx, s, font) {
            var prev = ctx.font;
            ctx.font = font;
            var m = ctx.measureText(String(s));
            ctx.font = prev;
            var h = (m.actualBoundingBoxAscent !== undefined && m.fontBoundingBoxAscent !== undefined)
                ? (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)
                : fontHeight(parseFloat(/(\d+(\.\d+)?)px/.exec(font) ? /(\d+(\.\d+)?)px/.exec(font)[1] : '16'));
            if (!isFinite(h) || h <= 0) h = 16;
            return { width: m.width, height: h };
        },

        // C# Draw.GlowTextCenter：多重偏移叠加外发光
        GlowTextCenter: function (ctx, s, font, c, glow, cx, y, strength) {
            if (this.qualityOf() <= 0) strength = 0;
            var box = { x: cx - 700, y: y, w: 1400, h: fontHeight(parseFloat(/(\d+(\.\d+)?)px/.exec(font) ? /(\d+(\.\d+)?)px/.exec(font)[1] : '16')) + 10 };
            ctx.font = font;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            for (var i = strength; i >= 1; i--) {
                var a = Math.trunc(46 / i);
                ctx.fillStyle = Color.rgba(Color.fromArgb(a, glow.r, glow.g, glow.b));
                ctx.fillText(String(s), cx, box.y + i * 0.8);
            }
            ctx.fillStyle = Color.rgba(c);
            ctx.fillText(String(s), cx, box.y);
        },

        // C# Draw.HeartPath（两段三次贝塞尔）
        HeartPath: function (ctx, cx, cy, size) {
            var s = size;
            ctx.beginPath();
            ctx.moveTo(cx, cy + s * 0.75);
            ctx.bezierCurveTo(cx - s * 1.05, cy - s * 0.15, cx - s * 0.5, cy - s * 0.95, cx, cy - s * 0.35);
            ctx.bezierCurveTo(cx + s * 0.5, cy - s * 0.95, cx + s * 1.05, cy - s * 0.15, cx, cy + s * 0.75);
            ctx.closePath();
        },

        Sparkle: function (ctx, cx, cy, r, c) {
            ctx.strokeStyle = Color.rgba(c);
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
            ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
            ctx.stroke();
            ctx.beginPath();
            ctx.fillStyle = Color.rgba(M.withAlpha(c, 160));
            ctx.arc(cx, cy, r * 0.28, 0, Math.PI * 2);
            ctx.fill();
        },

        // C# Draw.BuildBackdrop(w, h, Random rnd, int quality) → Bitmap
        // Web 端返回离屏 canvas，由主循环 drawImage 铺底。
        BuildBackdrop: function (w, h, rnd, quality) {
            var r = rnd || Math.random;
            var q = (typeof quality === 'number') ? quality : this.qualityOf();
            var bmp = null;
            try {
                if (typeof document !== 'undefined' && document.createElement) {
                    bmp = document.createElement('canvas');
                    bmp.width = Math.max(1, Math.trunc(w));
                    bmp.height = Math.max(1, Math.trunc(h));
                } else if (typeof OffscreenCanvas !== 'undefined') {
                    bmp = new OffscreenCanvas(Math.max(1, Math.trunc(w)), Math.max(1, Math.trunc(h)));
                }
            } catch (e) { bmp = null; }
            if (!bmp) return null;
            var ctx = bmp.getContext ? bmp.getContext('2d') : null;
            if (!ctx) return null;

            if (q >= 2) {
                this.Quality(ctx);
            } else {
                ctx.imageSmoothingEnabled = false;
            }

            // 深色渐变底（源码用 90 度的垂直线性渐变）
            var grad = ctx.createLinearGradient(0, 0, 0, h);
            grad.addColorStop(0, Color.rgba(G.BgTop));
            grad.addColorStop(1, Color.rgba(G.BgBottom));
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, w, h);

            // 光晕（PathGradientBrush 中心色 38 → 边缘 0）
            var glows = (q <= 0 ? 0 : 3);
            for (var i = 0; i < glows; i++) {
                var gx = r() * w;
                var gy = r() * h;
                var rad = 260 + r() * 260;
                var gc = i === 0 ? G.NeonPurple : (i === 1 ? G.NeonCyan : G.NeonPink);
                var rg;
                try {
                    rg = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.max(1, rad));
                } catch (e) { continue; }
                rg.addColorStop(0, Color.rgba(Color.fromArgb(38, gc.r, gc.g, gc.b)));
                rg.addColorStop(1, Color.rgba(Color.fromArgb(0, gc.r, gc.g, gc.b)));
                ctx.fillStyle = rg;
                ctx.beginPath();
                ctx.arc(gx, gy, Math.max(1, rad), 0, Math.PI * 2);
                ctx.fill();
            }

            // 网格
            var step = q <= 0 ? 80 : 40;
            ctx.strokeStyle = Color.rgba(Color.fromArgb(13, 120, 140, 220));
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (var x = 0; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
            for (var y = 0; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
            ctx.stroke();

            // 星点
            var stars = q <= 0 ? 60 : (q === 1 ? 110 : 170);
            ctx.fillStyle = '#dcebff';
            for (var k = 0; k < stars; k++) {
                var sx = r() * w;
                var sy = r() * h;
                var a = 20 + Math.trunc(r() * 90);
                var s = 1 + r() * 1.4;
                ctx.fillStyle = Color.rgba(Color.fromArgb(a, 220, 235, 255));
                ctx.beginPath();
                ctx.arc(sx, sy, Math.max(0.5, s * 0.5), 0, Math.PI * 2);
                ctx.fill();
            }

            return bmp;
        }
    };
    NB.Draw = Draw;

    // ===================== 即时模式 UI（UiKit.cs） =====================
    function rectContains(r, p) {
        return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    }

    var UI = {
        hot: [],
        animK: Object.create(null),
        hoverId: '',
        hoverT: 0,
        uiDt: 0.016,
        mouse: { x: -999, y: -999 },
        tooltipTitle: '',
        tooltipBody: '',

        // C# BeginUI()
        begin: function () {
            this.hot.length = 0;
        },

        // C# AddHot(r, id)
        addHot: function (r, id) {
            this.hot.push({ r: { x: r.x, y: r.y, w: r.w, h: r.h }, id: id });
        },

        // C# HitId(PointF p) —— 后加入者优先
        hitId: function (p) {
            for (var i = this.hot.length - 1; i >= 0; i--) {
                if (rectContains(this.hot[i].r, p)) return this.hot[i].id;
            }
            return '';
        },

        // C# 内部 Hit(r, p)：命中检测
        hit: function (r, p) { return rectContains(r, p); },

        // C# Anim(id, on)：指数趋近 + 死区吸附
        anim: function (id, on) {
            var v = this.animK[id];
            if (v === undefined) v = on ? 1 : 0;
            var target = on ? 1 : 0;
            v += (target - v) * Math.min(1, this.uiDt * 14);
            if (Math.abs(v - target) < 0.002) v = target;
            this.animK[id] = v;
            return v;
        },

        // C# Ease(k)：smoothstep
        ease: function (k) { return k * k * (3 - 2 * k); },

        // ---------- 胶囊按钮（C# Capsule） ----------
        capsule: function (ctx, r, text, sub, tint, enabled, selected) {
            var hover = this.hit(r, this.mouse) && enabled;
            var k = this.ease(this.anim('cap' + r.x + '_' + r.y + '_' + r.w, hover));
            var tint2 = enabled ? tint : Color.fromArgb(110, 110, 128);

            var rr = { x: r.x - k * 2.5, y: r.y - k * 1.5, w: r.w + k * 5, h: r.h + k * 3 };
            var rad = rr.h * 0.5;

            Draw.FillRound(ctx, rr, rad, Color.fromArgb(enabled ? Math.trunc(34 + 40 * k) : 18, tint2.r, tint2.g, tint2.b));
            Draw.FillRound(ctx, rr, rad, Color.fromArgb(selected ? 240 : 210, 10, 9, 22));

            if (k > 0.02) {
                for (var i = 3; i >= 1; i--) {
                    Draw.StrokeRound(ctx,
                        { x: rr.x - i * 2.2, y: rr.y - i * 2.2, w: rr.w + i * 4.4, h: rr.h + i * 4.4 },
                        rad + i * 2.2,
                        Color.fromArgb(Math.trunc((selected ? 60 : 44) * k / i), tint2.r, tint2.g, tint2.b), 2);
                }
            }

            Draw.StrokeRound(ctx, rr, rad,
                M.withAlpha(tint2, enabled ? Math.trunc(150 + 105 * k) : 90),
                selected ? 2.6 : 1.4 + k * 0.9);

            if (!sub) {
                Draw.TextCenter(ctx, text, Draw.UIFont(r.h > 60 ? 26 : 19),
                    M.withAlpha(Color.White, enabled ? 235 : 130),
                    rr.x + rr.w * 0.5, rr.y + rr.h * 0.5 - (r.h > 60 ? 14 : 10));
            } else {
                Draw.TextCenter(ctx, text, Draw.UIFont(r.h > 70 ? 27 : 21),
                    M.withAlpha(Color.White, enabled ? 240 : 130),
                    rr.x + rr.w * 0.5, rr.y + rr.h * 0.5 - 15);
                Draw.TextCenter(ctx, sub, Draw.UIFontLight(13),
                    M.withAlpha(tint2, 205),
                    rr.x + rr.w * 0.5, rr.y + rr.h * 0.5 + 13);
            }
            this.addHot(r, 'cap:' + r.x + '_' + r.y);
        },

        // ---------- 玻璃面板（C# GlassPanel） ----------
        glassPanel: function (ctx, r, tint) {
            Draw.FillRound(ctx, r, 20, Color.fromArgb(232, 9, 8, 20));
            Draw.GlowRound(ctx, r, 20, tint, 2);
        },

        // ---------- 迷你胶囊（C# MiniCapsule） ----------
        miniCapsule: function (ctx, r, text, tint, enabled, selected) {
            var hover = this.hit(r, this.mouse) && enabled;
            var k = this.ease(this.anim('mini' + r.x + '_' + r.y, hover));
            var t2 = enabled ? tint : Color.fromArgb(105, 105, 122);
            var rr = { x: r.x, y: r.y - k * 1.5, w: r.w, h: r.h + k * 3 };
            var rad = rr.h * 0.5;
            Draw.FillRound(ctx, rr, rad, Color.fromArgb(selected ? 70 : Math.trunc(26 + 40 * k), t2.r, t2.g, t2.b));
            Draw.StrokeRound(ctx, rr, rad, M.withAlpha(t2, enabled ? Math.trunc(140 + 100 * k) : 80), selected ? 2.2 : 1.2);
            Draw.TextCenter(ctx, text, Draw.UIFont(14), M.withAlpha(Color.White, enabled ? 232 : 120),
                rr.x + rr.w * 0.5, rr.y + rr.h * 0.5 - 7);
            this.addHot(r, 'mini:' + r.x + '_' + r.y);
        },

        // ---------- 滚动条（C# ScrollBar） ----------
        scrollBar: function (ctx, track, maxScroll, pos, tint) {
            Draw.FillRound(ctx, track, track.w * 0.5, Color.fromArgb(90, 40, 40, 60));
            if (maxScroll <= 0) return;
            var frac = Math.min(1, track.h / (track.h + maxScroll));
            var hh = Math.max(36, track.h * frac);
            var y = track.y + (track.h - hh) * (pos / maxScroll);
            Draw.FillRound(ctx, { x: track.x, y: y, w: track.w, h: hh }, track.w * 0.5, M.withAlpha(tint, 200));
        },

        // ---------- 悬停详情浮层（C# TooltipFrame） ----------
        tooltipFrame: function (ctx, card) {
            if (this.hoverT < 1) return;
            var a = Math.min(1, (this.hoverT - 1) * 4);
            var w = 300, h = 190;
            var x = card.x + card.w + 14;
            if (x + w > G.W - 24) x = card.x - w - 14;
            var y = Math.min(Math.max(90, card.y - 20), G.H - h - 30);
            var box = { x: x, y: y, w: w, h: h };

            Draw.FillRound(ctx, box, 16, Color.fromArgb(Math.trunc(238 * a), 6, 6, 16));
            Draw.GlowRound(ctx, box, 16, M.withAlpha(G.NeonCyan, Math.trunc(220 * a)), 2);

            Draw.TextLeft(ctx, this.tooltipTitle, Draw.UIFont(17),
                M.withAlpha(Color.White, Math.trunc(240 * a)), box.x + 16, box.y + 14);

            var f = Draw.UIFontLight(13);
            var ty = box.y + 46;
            var line = '';
            var body = String(this.tooltipBody);
            for (var i = 0; i < body.length; i++) {
                var ch = body.charAt(i);
                if (ch === '\n') {
                    Draw.TextLeft(ctx, line, f, M.withAlpha(G.TextMain, Math.trunc(225 * a)), box.x + 16, ty);
                    ty += 21; line = '';
                    continue;
                }
                line += ch;
                if (Draw.Measure(ctx, line, f).width > box.w - 32) {
                    Draw.TextLeft(ctx, line, f, M.withAlpha(G.TextMain, Math.trunc(225 * a)), box.x + 16, ty);
                    ty += 21; line = '';
                }
                if (ty > box.y + box.h - 26) break;
            }
            if (line.length > 0) {
                Draw.TextLeft(ctx, line, f, M.withAlpha(G.TextMain, Math.trunc(225 * a)), box.x + 16, ty);
            }
        },

        // ---------- 页签（C# TabBar） ----------
        tabBar: function (ctx, area, names, cur, tint) {
            var gap = 12;
            var w = (area.w - gap * (names.length - 1)) / names.length;
            for (var i = 0; i < names.length; i++) {
                var r = { x: area.x + i * (w + gap), y: area.y, w: w, h: area.h };
                this.miniCapsule(ctx, r, names[i], tint, true, cur === i);
                if (cur === i) {
                    Draw.FillRound(ctx, { x: r.x + r.w * 0.28, y: r.y + r.h + 5, w: r.w * 0.44, h: 3 }, 1.5, tint);
                }
                this.addHot(r, 'tab:' + i);
            }
        }
    };
    NB.UI = UI;

})();
