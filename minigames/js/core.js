/*
 * core.js —— 移植自 Codes/Core.cs（1:1 对照，未改动任何数值/配色/算法）
 * ------------------------------------------------------------------
 * 加载方式：经典 <script>，非 ES Module；IIFE 包裹。
 * 依赖：无（负责初始化 globalThis.NB）
 *
 * 导出清单（挂在全局 NB 上）：
 *   NB.Color        颜色工具：fromArgb(a,r,g,b | r,g,b) / rgba(c) / White / toCss
 *   NB.G            全局常量与霓虹配色（W,H,Cols,GridX,BrickW,BrickH,GapX,GapY,GridTop,
 *                   PaddleY,PaddleH,BaseSpeed, cellW(getter), rowH(getter),
 *                   BgTop,BgBottom,NeonCyan,NeonPurple,NeonOrange,NeonPink,NeonYellow,
 *                   NeonGreen,NeonBlue,TextMain,TextDim）
 *   NB.BrickType    枚举 {Normal:0,Unbreak:1,Bomb:2,Gift:3,Moving:4,Nova:5}
 *   NB.Brick        砖块类：x,y,w,h,hp,maxHp,type,tint,dead,flash,baseX,amp,speed,phase,
 *                   spawn,ensureDrop,fixed,scoreVal；get rect/center；Brick.colorForHp(hp)
 *   NB.Ball         球类：x,y,vx,vy,r,stuck,stickOffset,alive,trail,pierceCd,glowPhase,
 *                   comboOwner；get speed；scaleSpeed(k) / pushTrail()
 *   NB.Particle     粒子类：x,y,vx,vy,life,maxLife,size,c,drag,square
 *   NB.DropKind     枚举 {Multi:0,Wide:1,Laser:2,Slow:3,Shield:4,Life:5,Coin:6,Bomb:7,
 *                   Freeze:8,BigBall:9,Rush:10}
 *   NB.Drop         掉落物类：x,y,vy,phase,kind,dead；get rect；Drop.colorOf(k)/
 *                   Drop.glyphOf(k)/Drop.nameOf(k)
 *   NB.Stats        玩家本局属性
 *   NB.Statistics   只读快照（含构造函数 Statistics(stats)）
 *   NB.Upgrade      升级定义类
 *   NB.Profile      存档（localStorage 键 "NeonBreaker.profile"，key=value 行文本）
 *   NB.M            数学工具：clamp/clampI/lerp/rand/randInt/randRange/withAlpha/mix/
 *                   round(银行家舍入=Math.Round)/roundInt
 *   NB.Economy      经济系统（积分/砖块币/热度/结算）
 *   NB.ShopKind     枚举 {PointsToCoin:0,CoinToPoints:1,Revive:2,Life:3,Shield:4,
 *                   Lucky:5,Multi:6,Slow:7}
 *   NB.ShopItem     商店条目类：kind,name,desc,glyph,price,tint；get stock
 *
 * 约定：属性 camelCase；C# 的 get 属性 → JS getter；方法 → camelCase 方法。
 */
(function () {
    'use strict';

    var NB = globalThis.NB = globalThis.NB || {};

    // ===================== 颜色 =====================
    // C# System.Drawing.Color 用 ARGB 字节通道；此处以 {r,g,b,a} 等值表示，a 范围 0..255。
    var Color = {
        fromArgb: function (a, r, g, b) {
            if (b === undefined) { b = g; g = r; r = a; a = 255; }
            return { r: r & 255, g: g & 255, b: b & 255, a: a & 255 };
        },
        // 转 Canvas 可用的 CSS 字符串（保留 alpha）
        rgba: function (c) {
            return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + (c.a / 255) + ')';
        },
        White: { r: 255, g: 255, b: 255, a: 255 },
        Black: { r: 0, g: 0, b: 0, a: 255 }
    };
    NB.Color = Color;

    // ===================== 全局常量 =====================
    var G = {
        W: 1280,                // 逻辑画布宽
        H: 800,                 // 逻辑画布高
        Cols: 13,               // 砖块列数
        GridX: 62,              // 网格左边界
        BrickW: 84,
        BrickH: 30,
        GapX: 6,
        GapY: 6,
        GridTop: 108,
        PaddleY: 742,
        PaddleH: 16,
        BaseSpeed: 560,         // 基础球速 px/s

        // 霓虹配色（FromArgb 精确数值）
        BgTop: Color.fromArgb(11, 10, 26),
        BgBottom: Color.fromArgb(26, 16, 48),
        NeonCyan: Color.fromArgb(53, 224, 216),
        NeonPurple: Color.fromArgb(160, 108, 240),
        NeonOrange: Color.fromArgb(255, 154, 60),
        NeonPink: Color.fromArgb(255, 77, 109),
        NeonYellow: Color.fromArgb(255, 217, 61),
        NeonGreen: Color.fromArgb(92, 230, 138),
        NeonBlue: Color.fromArgb(74, 168, 255),
        TextMain: Color.fromArgb(232, 236, 255),
        TextDim: Color.fromArgb(140, 148, 190)
    };
    Object.defineProperty(G, 'cellW', { get: function () { return G.BrickW + G.GapX; }, enumerable: true });
    Object.defineProperty(G, 'rowH', { get: function () { return G.BrickH + G.GapY; }, enumerable: true });
    NB.G = G;

    // ===================== 数学辅助 =====================
    var M = {
        clamp: function (v, a, b) { return v < a ? a : (v > b ? b : v); },
        clampI: function (v, a, b) { return v < a ? a : (v > b ? b : v); },
        lerp: function (a, b, t) { return a + (b - a) * t; },
        // C# M.Rand(Random r, a, b)：r.NextDouble()
        rand: function (a, b) { return a + Math.random() * (b - a); },
        // C# Random.Next(n)：0..n-1
        randInt: function (n) { return Math.floor(Math.random() * n); },
        // C# Random.Next(min, max)：min..max-1
        randRange: function (a, b) { return a + Math.floor(Math.random() * (b - a)); },
        withAlpha: function (c, a) {
            var aa = M.clampI(a, 0, 255);
            return Color.fromArgb(aa, c.r, c.g, c.b);
        },
        mix: function (a, b, t) {
            return Color.fromArgb(
                Math.trunc(a.r + (b.r - a.r) * t),
                Math.trunc(a.g + (b.g - a.g) * t),
                Math.trunc(a.b + (b.b - a.b) * t));
        },
        // C# Math.Round(double)：银行家舍入（MidpointRounding.ToEven）
        round: function (v) {
            var f = Math.floor(v);
            var diff = v - f;
            if (diff > 0.5) return f + 1;
            if (diff < 0.5) return f;
            return (f % 2 === 0) ? f : f + 1;
        },
        // C# (int)Math.Round(v)
        roundInt: function (v) { return Math.trunc(M.round(v)); }
    };
    NB.M = M;

    // 数字格式化：C# ToString("N0") → 千分位整数
    function fmtN0(n) {
        var s = String(Math.trunc(n));
        var neg = s.charAt(0) === '-';
        if (neg) s = s.substring(1);
        s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return neg ? '-' + s : s;
    }

    // C# ToString("0.###") → 最多 3 位小数，去掉末尾 0
    function fmt03(v) {
        var s = Number(v).toFixed(3);
        s = s.replace(/0+$/, '').replace(/\.$/, '');
        if (s === '' || s === '-') s = '0';
        return s;
    }

    // C# int.TryParse / long.TryParse 严格整数字面量
    function tryParseInt(s) {
        if (!/^[+-]?\d+$/.test(s)) return null;
        var v = Number(s);
        if (!isFinite(v)) return null;
        return v;
    }
    function tryParseFloat(s) {
        if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
        var v = Number(s);
        return isFinite(v) ? v : null;
    }

    // ===================== 砖块 =====================
    var BrickType = { Normal: 0, Unbreak: 1, Bomb: 2, Gift: 3, Moving: 4, Nova: 5 };
    NB.BrickType = BrickType;

    function Brick() {
        this.x = 0; this.y = 0; this.w = 0; this.h = 0;
        this.hp = 1;
        this.maxHp = 1;
        this.type = BrickType.Normal;
        this.tint = G.NeonCyan;
        this.dead = false;
        this.flash = 0;         // 受击白闪 0..1
        this.baseX = 0;         // 移动砖基准
        this.amp = 0;
        this.speed = 0;
        this.phase = 0;
        this.spawn = 0;         // 出现动画进度
        this.ensureDrop = false; // 必掉道具
        this.fixed = false;     // 固定砖：不随无尽下压移动
        this.scoreVal = 10;
    }
    Object.defineProperty(Brick.prototype, 'rect', {
        get: function () { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
    });
    Object.defineProperty(Brick.prototype, 'center', {
        get: function () { return { x: this.x + this.w * 0.5, y: this.y + this.h * 0.5 }; }
    });
    Brick.colorForHp = function (hp) {
        if (hp <= 1) return G.NeonCyan;
        if (hp === 2) return G.NeonPurple;
        if (hp === 3) return G.NeonOrange;
        if (hp === 4) return G.NeonPink;
        return Color.fromArgb(255, 108, 220);
    };
    NB.Brick = Brick;

    // ===================== 球 =====================
    function Ball() {
        this.x = 0; this.y = 0; this.vx = 0; this.vy = 0; this.r = 8;
        this.stuck = false;      // 粘在挡板上
        this.stickOffset = 0;    // 相对挡板中心
        this.alive = true;
        this.trail = [];
        this.pierceCd = 0;
        this.glowPhase = 0;
        this.comboOwner = 0;
    }
    Object.defineProperty(Ball.prototype, 'speed', {
        get: function () { return Math.sqrt(this.vx * this.vx + this.vy * this.vy); }
    });
    Ball.prototype.scaleSpeed = function (k) { this.vx *= k; this.vy *= k; };
    Ball.prototype.pushTrail = function () {
        this.trail.push({ x: this.x, y: this.y });
        if (this.trail.length > 14) this.trail.shift();
    };
    NB.Ball = Ball;

    // ===================== 粒子 =====================
    function Particle() {
        this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
        this.life = 0; this.maxLife = 0; this.size = 0;
        this.c = Color.White;
        this.drag = 2.2;
        this.square = false;
    }
    NB.Particle = Particle;

    // ===================== 掉落道具 =====================
    var DropKind = {
        Multi: 0, Wide: 1, Laser: 2, Slow: 3, Shield: 4,
        Life: 5, Coin: 6, Bomb: 7, Freeze: 8, BigBall: 9, Rush: 10
    };
    NB.DropKind = DropKind;

    function Drop() {
        this.x = 0; this.y = 0; this.vy = 175;
        this.phase = 0;
        this.kind = DropKind.Coin;
        this.dead = false;
    }
    Object.defineProperty(Drop.prototype, 'rect', {
        get: function () { return { x: this.x - 17, y: this.y - 17, w: 34, h: 34 }; }
    });
    Drop.colorOf = function (k) {
        switch (k) {
            case DropKind.Multi: return G.NeonYellow;
            case DropKind.Wide: return G.NeonGreen;
            case DropKind.Laser: return G.NeonPink;
            case DropKind.Slow: return G.NeonBlue;
            case DropKind.Shield: return G.NeonPurple;
            case DropKind.Life: return Color.fromArgb(255, 120, 160);
            case DropKind.Bomb: return Color.fromArgb(255, 92, 92);
            case DropKind.Freeze: return Color.fromArgb(140, 235, 255);
            case DropKind.BigBall: return Color.fromArgb(168, 255, 120);
            case DropKind.Rush: return Color.fromArgb(255, 176, 255);
            default: return G.NeonOrange;
        }
    };
    Drop.glyphOf = function (k) {
        switch (k) {
            case DropKind.Multi: return '3';
            case DropKind.Wide: return 'W';
            case DropKind.Laser: return 'L';
            case DropKind.Slow: return 'S';
            case DropKind.Shield: return 'O';
            case DropKind.Life: return '+';
            case DropKind.Bomb: return 'B';
            case DropKind.Freeze: return 'F';
            case DropKind.BigBall: return 'G';
            case DropKind.Rush: return 'R';
            default: return '$';
        }
    };
    Drop.nameOf = function (k) {
        switch (k) {
            case DropKind.Multi: return '三球分裂';
            case DropKind.Wide: return '挡板扩张';
            case DropKind.Laser: return '激光炮台';
            case DropKind.Slow: return '时间缓速';
            case DropKind.Shield: return '底部护盾';
            case DropKind.Life: return '额外生命';
            case DropKind.Bomb: return '爆破冲击';
            case DropKind.Freeze: return '时间冻结';
            case DropKind.BigBall: return '巨型球';
            case DropKind.Rush: return '超速冲刺';
            default: return '能量结晶';
        }
    };
    NB.Drop = Drop;

    // ===================== 玩家属性 =====================
    function Stats() {
        this.damage = 1;
        this.speedMul = 1;
        this.paddleW = 140;
        this.dropBonus = 0;
        this.critChance = 0;     // 百分比
        this.startBalls = 1;
        this.laserLevel = 0;
        this.shieldCharges = 0;
        this.ballRadius = 8;
        this.bombBall = false;
        this.pierceLevel = 0;    // 每级减少穿透冷却
        this.magnet = 0;         // 0..1 球撞板后趋向竖直向上
        this.sticky = false;
        this.coinBonus = 0;      // 每块砖额外分
    }
    Stats.prototype.snapshot = function () { return new Statistics(this); };
    NB.Stats = Stats;

    // 用于展示的只读快照
    function Statistics(s) {
        this.damage = s.damage;
        this.critChance = s.critChance;
        this.startBalls = s.startBalls;
        this.laserLevel = s.laserLevel;
        this.shieldCharges = s.shieldCharges;
        this.pierceLevel = s.pierceLevel;
        this.coinBonus = s.coinBonus;
        this.speedMul = s.speedMul;
        this.paddleW = s.paddleW;
        this.dropBonus = s.dropBonus;
        this.ballRadius = s.ballRadius;
    }
    NB.Statistics = Statistics;

    // ===================== 升级定义 =====================
    function Upgrade(name, desc, tint, tag, apply) {
        this.name = name;
        this.desc = desc;
        this.tint = tint;
        this.apply = apply;       // function(stats)
        this.tag = tag;
        this.extraLife = 0;
    }
    NB.Upgrade = Upgrade;

    // ===================== 存档（localStorage） =====================
    // 键名：NeonBreaker.profile；格式沿用源码 key=value 行文本，字段名完全一致。
    var memoryStore = Object.create(null);

    function storageGet(key) {
        try {
            if (typeof localStorage !== 'undefined' && localStorage) {
                var v = localStorage.getItem(key);
                if (v !== null) return v;
            }
        } catch (e) { /* 隐私模式/无存储：静默降级 */ }
        return (key in memoryStore) ? memoryStore[key] : null;
    }
    function storageSet(key, val) {
        memoryStore[key] = val;
        try {
            if (typeof localStorage !== 'undefined' && localStorage) localStorage.setItem(key, val);
        } catch (e) { /* 静默 */ }
    }

    var PROFILE_KEY = 'NeonBreaker.profile';

    var Profile = {
        storageKey: PROFILE_KEY,

        bestEndless: 0,
        bestEndlessWave: 0,
        bestCampaign: 0,      // 已通关最高关（0 表示没通过第 1 关）
        playCount: 0,

        // ---------- 经济系统 ----------
        points: 0,            // 积分余额
        coins: 0,             // 砖块币余额
        totalScore: 0,        // 累计分数（所有局累加）
        heat: 0,              // 热度：玩得越久越高，提升积分奖励概率与数量

        reviveCards: 0,       // 复活卡
        lifeCards: 0,         // 生命 +1 卡
        shieldKits: 0,        // 开局护盾
        luckyKits: 0,         // 幸运符
        multiKits: 0,         // 三球模块
        slowKits: 0,          // 缓速核心

        heatPerLevel: 120,

        get heatLevel() {
            return 1 + Math.trunc(this.heat / this.heatPerLevel);
        },
        get heatProgress() {
            var lv = this.heatLevel;
            return M.clamp((this.heat - (lv - 1) * this.heatPerLevel) / this.heatPerLevel, 0, 1);
        },

        load: function () {
            try {
                var raw = storageGet(PROFILE_KEY);
                if (raw === null) {
                    // 首次游玩：新手礼包，方便立刻体验商店
                    this.points = 100; this.coins = 5;
                    return;
                }
                var lines = String(raw).split(/\r?\n/);
                for (var i = 0; i < lines.length; i++) {
                    var line = lines[i];
                    var eq = line.indexOf('=');
                    if (eq <= 0) continue;
                    var k = line.substring(0, eq).trim();
                    var v = line.substring(eq + 1).trim();
                    var iv, lv, fv;
                    switch (k) {
                        case 'bestEndless': iv = tryParseInt(v); if (iv !== null) this.bestEndless = iv; break;
                        case 'bestWave': iv = tryParseInt(v); if (iv !== null) this.bestEndlessWave = iv; break;
                        case 'bestCampaign': iv = tryParseInt(v); if (iv !== null) this.bestCampaign = iv; break;
                        case 'playCount': iv = tryParseInt(v); if (iv !== null) this.playCount = iv; break;
                        case 'points': lv = tryParseInt(v); if (lv !== null) this.points = lv; break;
                        case 'coins': iv = tryParseInt(v); if (iv !== null) this.coins = iv; break;
                        case 'totalScore': lv = tryParseInt(v); if (lv !== null) this.totalScore = lv; break;
                        case 'heat': fv = tryParseFloat(v); if (fv !== null) this.heat = fv; break;
                        case 'reviveCards': iv = tryParseInt(v); if (iv !== null) this.reviveCards = iv; break;
                        case 'lifeCards': iv = tryParseInt(v); if (iv !== null) this.lifeCards = iv; break;
                        case 'shieldKits': iv = tryParseInt(v); if (iv !== null) this.shieldKits = iv; break;
                        case 'luckyKits': iv = tryParseInt(v); if (iv !== null) this.luckyKits = iv; break;
                        case 'multiKits': iv = tryParseInt(v); if (iv !== null) this.multiKits = iv; break;
                        case 'slowKits': iv = tryParseInt(v); if (iv !== null) this.slowKits = iv; break;
                    }
                }
                // 旧版本存档（只有记录、没有货币）：补一份迁移礼包
                if ((this.points === 0 && this.coins === 0 && this.totalScore === 0) && this.playCount > 0) {
                    this.points = 100; this.coins = 10;
                }
            } catch (e) { /* 静默 */ }
        },

        save: function () {
            try {
                var lines = [
                    'bestEndless=' + this.bestEndless,
                    'bestWave=' + this.bestEndlessWave,
                    'bestCampaign=' + this.bestCampaign,
                    'playCount=' + this.playCount,
                    'points=' + this.points,
                    'coins=' + this.coins,
                    'totalScore=' + this.totalScore,
                    'heat=' + fmt03(this.heat),
                    'reviveCards=' + this.reviveCards,
                    'lifeCards=' + this.lifeCards,
                    'shieldKits=' + this.shieldKits,
                    'luckyKits=' + this.luckyKits,
                    'multiKits=' + this.multiKits,
                    'slowKits=' + this.slowKits
                ];
                storageSet(PROFILE_KEY, lines.join('\n'));
            } catch (e) { /* 静默 */ }
        },

        // 源码 FilePath 的语义等价：清空存档（非源码接口，供调试/重置使用）
        clear: function () {
            try {
                if (typeof localStorage !== 'undefined' && localStorage) localStorage.removeItem(PROFILE_KEY);
            } catch (e) { /* 静默 */ }
            delete memoryStore[PROFILE_KEY];
        }
    };
    NB.Profile = Profile;

    // ===================== 经济系统 =====================
    // 设计思路：
    //   积分（Points）是软通货，靠游玩产出；砖块币（Coins）是硬通货，靠积分兑换，用于购买道具。
    //   热度（Heat）承载"玩得越久，积分奖励越好"这条规则：概率与数量都随热度提升，但有上限避免失衡。
    var Economy = {
        pointsPerCoin: 10,          // 10 积分 = 1 砖块币（双向等价）

        chanceBase: 0.35,           // 基础幸运触发率
        chancePerHeat: 0.0015,      // 每点热度提升
        chanceCap: 0.85,

        mulBase: 1,
        mulPerHeat: 0.004,          // 500 热度约 3 倍
        mulCap: 3,

        settlePerHeat: 0.002,       // 局结算积分倍率
        settleCap: 2,

        get bonusChance() {
            return M.clamp(this.chanceBase + Profile.heat * this.chancePerHeat, this.chanceBase, this.chanceCap);
        },
        get bonusMul() {
            return M.clamp(this.mulBase + Profile.heat * this.mulPerHeat, this.mulBase, this.mulCap);
        },
        get settleMul() {
            return M.clamp(1 + Profile.heat * this.settlePerHeat, 1, this.settleCap);
        },

        // 局结算：分数 → 积分（20 分 = 1 积分，再乘热度倍率）
        settlePoints: function (score) {
            if (score <= 0) return 0;
            var perm = NB.Meta ? NB.Meta.permLv('settle') : 0;
            var up = 1 + perm * 0.04;
            return Math.max(1, M.roundInt(score / 20 * this.settleMul * up));
        },

        // 金币掉落：直接给积分（随热度小幅提升）
        coinDropPoints: function () {
            return M.roundInt((5 + Profile.heatLevel * 2) * this.bonusMul);
        },

        // 过关奖励：基础 40 + 关卡序号×6，乘热度倍率；命中幸运再额外给一份
        // C# 签名 LevelReward(int lvIndex, Random rnd, out bool lucky) → 返回 { pt, lucky }
        levelReward: function (lvIndex, rnd) {
            var r = rnd || Math.random;
            var basePt = 40 + lvIndex * 6;
            var lucky = r() < Economy.bonusChance;
            var pt = M.roundInt(basePt * Economy.bonusMul);
            if (lucky) pt += M.roundInt(basePt * 1.2 * Economy.bonusMul);
            return { pt: pt, lucky: lucky };
        },

        // 无尽波次奖励。C# 签名 WaveReward(int w, Random rnd, out bool lucky) → { pt, lucky }
        waveReward: function (w, rnd) {
            var r = rnd || Math.random;
            var basePt = 18 + w * 4;
            var lucky = r() < Economy.bonusChance;
            var pt = M.roundInt(basePt * Economy.bonusMul);
            if (lucky) pt += M.roundInt(basePt * Economy.bonusMul);
            return { pt: pt, lucky: lucky };
        },

        addHeat: function (v) {
            Profile.heat = M.clamp(Profile.heat + v, 0, 999999);
        },

        // 复活代价：热度衰减 20%，等价于削弱"玩得越久奖励越高"的加成
        revivePenalty: function () {
            Profile.heat = Math.max(0, Profile.heat * 0.8);
        },

        fmt: function (n) { return fmtN0(n); }
    };
    NB.Economy = Economy;

    // ===================== 商店条目 =====================
    var ShopKind = {
        PointsToCoin: 0, CoinToPoints: 1, Revive: 2, Life: 3,
        Shield: 4, Lucky: 5, Multi: 6, Slow: 7
    };
    NB.ShopKind = ShopKind;

    function ShopItem(kind, name, desc, glyph, price, tint) {
        this.kind = kind;
        this.name = name;
        this.desc = desc;
        this.glyph = glyph;
        this.price = price;   // 砖块币价格
        this.tint = tint;
    }
    Object.defineProperty(ShopItem.prototype, 'stock', {
        get: function () {
            switch (this.kind) {
                case ShopKind.Revive: return Profile.reviveCards;
                case ShopKind.Life: return Profile.lifeCards;
                case ShopKind.Shield: return Profile.shieldKits;
                case ShopKind.Lucky: return Profile.luckyKits;
                case ShopKind.Multi: return Profile.multiKits;
                case ShopKind.Slow: return Profile.slowKits;
                default: return 0;
            }
        }
    });
    NB.ShopItem = ShopItem;

})();
