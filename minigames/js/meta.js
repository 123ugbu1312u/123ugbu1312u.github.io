/*
 * meta.js —— 移植自 Codes/Meta.cs（永久升级数据、设置项、商店商品表、礼包开箱）
 * ------------------------------------------------------------------
 * 加载方式：经典 <script>，非 ES Module；IIFE 包裹。
 * 依赖：core.js（NB.G / NB.M / NB.Color / NB.Profile）
 *
 * 存档：源码 meta.dat → 本移植改为 localStorage 键 "NeonBreaker.meta"，
 *       内容格式完全沿用源码：key=value 逐行文本（UTF-8），
 *       永久升级写作 "lv.<upKey>=<等级>"，库存写作 "inv.<key>=<数量>"，其余键名保持原样。
 *
 * 导出清单（挂在全局 NB 上）：
 *   NB.UpDef   { key,name,desc,unit,tint,base,growth }（构造：UpDef(key,name,desc,unit,tint,b,g)）
 *   NB.ShopDef { key,name,brief,detail,unit,qty,price,coinPrice,tint,packId }
 *   NB.Meta    {
 *     STORAGE_KEY, UPGRADE_COUNT, ups: UpDef[15], lv: number[15], items: ShopDef[24],
 *     quality, musicVol, sfxVol, musicOn, shakeOn, particleOn, sfxOn,
 *     musicTrack, musicFile, replayOn, replayKeep, windowMode, inv,
 *     get pageCount, itemAt(page,slot),
 *     permLv(key), applyToStats(stats), upCost(idx), upCoinCost(idx),
 *     buildItems(), count(key), grant(key,n), spend(key,n),
 *     get startBallBonus / startPaddleBonus / startDropBonus,
 *     load(), save(), openPack(packId), ownedList()
 *   }
 */
(function () {
    'use strict';

    var NB = globalThis.NB = globalThis.NB || {};
    var G = NB.G;
    var M = NB.M;
    var Color = NB.Color;
    var Profile = NB.Profile;

    // ===================== 永久升级项 =====================
    function UpDef(key, name, desc, unit, tint, b, g) {
        this.key = key;       // 存档键
        this.name = name;
        this.desc = desc;
        this.unit = unit;
        this.tint = tint;
        this.base = b;        // 首级价格（积分）
        this.growth = g;      // 每级涨幅
    }
    NB.UpDef = UpDef;

    // ===================== 商店商品 =====================
    function ShopDef() {
        this.key = '';        // 库存键
        this.name = '';
        this.brief = '';      // 外观简介
        this.detail = '';     // 悬停 1s 详情
        this.unit = '';       // 张 / 个 / 级 / %
        this.qty = 1;
        this.price = 0;       // 积分价
        this.coinPrice = 0;   // 砖块币价
        this.tint = Color.White;
        this.packId = -1;     // 礼包编号，-1 表示普通商品
    }
    NB.ShopDef = ShopDef;

    // ===================== 存档读写（localStorage） =====================
    var META_KEY = 'NeonBreaker.meta';
    var memoryStore = Object.create(null);

    function storageGet(key) {
        try {
            if (typeof localStorage !== 'undefined' && localStorage) {
                var v = localStorage.getItem(key);
                if (v !== null) return v;
            }
        } catch (e) { /* 无存储环境：静默降级 */ }
        return (key in memoryStore) ? memoryStore[key] : null;
    }
    function storageSet(key, val) {
        memoryStore[key] = val;
        try {
            if (typeof localStorage !== 'undefined' && localStorage) localStorage.setItem(key, val);
        } catch (e) { /* 静默 */ }
    }

    function tryParseInt(s) {
        if (!/^[+-]?\d+$/.test(s)) return null;
        var v = Number(s);
        return isFinite(v) ? v : null;
    }

    // ===================== Meta =====================
    var UPGRADE_COUNT = 15;

    var Meta = {
        STORAGE_KEY: META_KEY,
        UPGRADE_COUNT: UPGRADE_COUNT,

        lv: new Array(UPGRADE_COUNT).fill(0),

        // ---------- 设置 ----------
        quality: 2,          // 0 低 / 1 中 / 2 高
        musicVol: 55,
        sfxVol: 80,
        musicOn: true,
        shakeOn: true,
        particleOn: true,
        sfxOn: true,
        musicTrack: 0,       // 0 霓虹 / 1 脉冲 / 2 深空 / 3 本地文件
        musicFile: '',
        replayOn: true,      // 对局回放录制开关
        replayKeep: 10,      // 回放保留数量 2~30
        windowMode: 0,       // 0 无边框窗口化全屏 / 1 独占全屏 / 2 普通窗口（网页端仅记录，见说明文档）

        // 扩展库存（卡片类库存仍走 Profile 原有字段）
        inv: Object.create(null),

        // ---------- 永久升级表 ----------
        ups: [
            new UpDef("pad", "挡板宽度", "挡板加宽，接球更从容", "+6 px", G.NeonCyan, 60, 1.14),
            new UpDef("speed", "球速", "球飞得更快，破坏效率更高", "+3%", G.NeonGreen, 90, 1.15),
            new UpDef("dmg", "破砖伤害", "每次撞击对砖块造成更多伤害", "+1", G.NeonPink, 300, 1.34),
            new UpDef("crit", "暴击率", "命中时有概率造成双倍伤害", "+2%", G.NeonYellow, 120, 1.17),
            new UpDef("ball", "开局球数", "每局开始时的球数", "+1", G.NeonPurple, 400, 1.45),
            new UpDef("drop", "掉落率", "砖块掉落道具的概率", "+2%", G.NeonOrange, 150, 1.16),
            new UpDef("laser", "激光等级", "自动炮台强度与射速", "+1", G.NeonBlue, 260, 1.28),
            new UpDef("life", "起始生命", "每局额外的生命数", "+1", Color.fromArgb(255, 120, 160), 500, 1.55),
            new UpDef("shield", "护盾容量", "可叠加的护盾层数", "+1", Color.fromArgb(190, 120, 255), 220, 1.30),
            new UpDef("coin", "砖块收益", "每块砖额外的结算分", "+1", Color.fromArgb(255, 200, 90), 180, 1.22),
            new UpDef("magnet", "磁力吸附", "接球后球更趋于竖直反弹", "+4%", Color.fromArgb(120, 220, 255), 140, 1.18),
            new UpDef("pierce", "穿透等级", "穿透冷却更短，可连续穿砖", "+1", Color.fromArgb(160, 255, 220), 380, 1.42),
            new UpDef("radius", "球体半径", "球变大，容错更高但略难穿缝", "-0.3px", Color.fromArgb(255, 170, 220), 240, 1.26),
            new UpDef("combo", "连击加成", "连击带来的分数倍率更高", "+4%", Color.fromArgb(255, 120, 90), 280, 1.25),
            new UpDef("settle", "结算转化", "局末积分转化率更高", "+4%", Color.fromArgb(120, 255, 180), 360, 1.32)
        ],

        items: [],

        // ---------- 永久升级 → 开局属性 ----------
        permLv: function (key) {
            for (var i = 0; i < this.ups.length; i++) if (this.ups[i].key === key) return this.lv[i];
            return 0;
        },

        applyToStats: function (s) {
            if (!s) return;
            var pad = this.permLv("pad"), spd = this.permLv("speed"), dmg = this.permLv("dmg"), crit = this.permLv("crit");
            var ball = this.permLv("ball"), drop = this.permLv("drop"), laser = this.permLv("laser"), shield = this.permLv("shield");
            var coin = this.permLv("coin"), magnet = this.permLv("magnet"), pierce = this.permLv("pierce"), radius = this.permLv("radius");

            s.paddleW += pad * 6;
            s.speedMul += spd * 0.03;
            s.damage += dmg;
            s.critChance = Math.min(95, s.critChance + crit * 2);
            s.startBalls += ball;
            s.dropBonus += drop * 0.02;
            s.laserLevel += laser;
            s.shieldCharges += shield;
            s.coinBonus += coin;
            s.magnet = Math.min(0.9, s.magnet + magnet * 0.04);
            s.pierceLevel += pierce;
            s.ballRadius = Math.max(5, s.ballRadius - radius * 0.3);
        },

        // ---------- 价格 ----------
        upCost: function (idx) {
            if (idx < 0 || idx >= this.ups.length) return 0;
            var u = this.ups[idx];
            var c = u.base * Math.pow(u.growth, this.lv[idx]);
            if (c > 4000000) c = 4000000;
            return Math.trunc(M.round(c));
        },

        upCoinCost: function (idx) {
            var c = this.upCost(idx);
            return Math.max(1, Math.trunc(M.round(c / 12.0)));
        },

        // ---------- 商品表 ----------
        _add: function (key, name, brief, detail, unit, qty, price, tint, packId) {
            var d = new ShopDef();
            d.key = key; d.name = name; d.brief = brief; d.detail = detail; d.unit = unit;
            d.qty = qty; d.price = price; d.coinPrice = Math.max(1, Math.trunc(M.round(price / 11.0)));
            d.tint = tint; d.packId = packId;
            this.items.push(d);
        },

        buildItems: function () {
            if (this.items.length > 0) return;
            var self = this;

            // 每类商品只展示一件，购买数量由玩家在弹窗里自选
            self._add("revive", "复活卡",
                "阵亡后原地复活，保留分数与砖块进度",
                "结束界面可直接消耗 1 张复活卡继续本局，复活后球速短暂放缓，砖块不会重置。持有上限 99 张。",
                "张", 1, 220, Color.fromArgb(255, 120, 160), -1);

            self._add("life", "生命 +1 卡",
                "增加 1 点生命，暂停界面即可使用",
                "在暂停界面点击「生命 +1 卡」立刻生效，生命上限 9。适合闯关后期与无尽高压阶段。",
                "张", 1, 120, G.NeonPink, -1);

            self._add("shield", "护盾套件",
                "抵挡一次漏球，最多叠加 4 层",
                "开局即携带护盾层数，漏球时自动消耗 1 层而不扣生命，层数显示在 HUD 左侧。",
                "个", 1, 160, Color.fromArgb(190, 120, 255), -1);

            self._add("lucky", "幸运符",
                "本局掉落率提升 15%",
                "开局自动消耗 1 个，掉落率 +15%，与升级项「掉落率」叠加，最高不超过 75%。",
                "个", 1, 90, G.NeonYellow, -1);

            self._add("multi", "多重球启动器",
                "开局额外获得 2 颗球",
                "开局立刻分裂出 2 颗额外的球，球速略低，适合快速清场与拆高血量砖。",
                "个", 1, 110, G.NeonGreen, -1);

            self._add("slow", "缓速器",
                "开局时间流速降低 13 秒",
                "开局进入缓速状态，球速下降 35%，持续 13 秒，可与掉落道具「时间缓速」叠加时长。",
                "个", 1, 100, G.NeonBlue, -1);

            self._add("startball", "起始球 +1",
                "永久提升每局开局球数",
                "永久属性，每购买 1 件开局球数 +1，立即生效于下一局，与升级项独立叠加。",
                "颗", 1, 350, G.NeonPurple, -1);

            self._add("startpaddle", "挡板加宽 +10px",
                "永久加宽挡板 10 px",
                "永久属性，每购买 1 件挡板宽度 +10 px，直接叠加到挡板宽度上，与升级项独立计算。",
                "件", 1, 300, G.NeonCyan, -1);

            self._add("startdrop", "掉落率 +1%",
                "永久提升掉落概率 1%",
                "永久属性，每购买 1 件掉落率 +1%，与幸运符、升级项共同生效。",
                "件", 1, 260, G.NeonOrange, -1);

            self._add("startshield", "起始护盾 +1",
                "永久提升每局开局护盾层数",
                "永久属性，每购买 1 件开局护盾 +1 层，最多 4 层，与升级项「护盾容量」独立叠加。",
                "件", 1, 320, Color.fromArgb(190, 120, 255), -1);

            self._add("startlife", "起始生命 +1",
                "永久提升每局开局生命数",
                "永久属性，每购买 1 件开局生命 +1（上限 9），与升级项「起始生命」独立叠加。",
                "件", 1, 520, Color.fromArgb(255, 120, 160), -1);

            self._add("laserkit", "激光组件",
                "暂停界面使用：激光炮台持续 16 秒",
                "在暂停界面点击使用，立即获得 16 秒激光炮台，与升级项「激光等级」叠加强度。",
                "个", 1, 150, G.NeonBlue, -1);

            self._add("widekit", "加宽组件",
                "暂停界面使用：挡板加宽 15 秒",
                "在暂停界面点击使用，挡板立刻加宽并在 15 秒内保持，可与永久挡板加宽叠加。",
                "个", 1, 130, G.NeonCyan, -1);

            self._add("magnetkit", "磁力组件",
                "暂停界面使用：接球角度更可控",
                "在暂停界面点击使用，本局磁力吸附 +35%（上限 100%），球从挡板反弹时更趋于竖直方向。",
                "个", 1, 140, Color.fromArgb(120, 220, 255), -1);

            self._add("startlaser", "开局激光 +1 级",
                "永久提升每局开局激光等级",
                "永久属性，每购买 1 件开局激光等级 +1，炮台自动开火更猛，与升级项「激光等级」独立叠加。",
                "件", 1, 460, G.NeonBlue, -1);

            self._add("startmagnet", "开局磁力 +8%",
                "永久提升每局磁力吸附",
                "永久属性，每购买 1 件开局磁力 +8%，接球后球更趋竖直，与升级项「磁力吸附」独立叠加。",
                "件", 1, 340, Color.fromArgb(120, 220, 255), -1);

            self._add("startcrit", "开局暴击 +3%",
                "永久提升每局暴击率",
                "永久属性，每购买 1 件开局暴击率 +3%，上限 95%，与升级项「暴击率」独立叠加。",
                "件", 1, 380, G.NeonYellow, -1);

            self._add("startcoin", "起始积分 +500",
                "每局开局直接得到 500 分",
                "永久属性，每购买 1 件开局分数 +500，直接计入本局得分与结算积分。",
                "件", 1, 620, Color.fromArgb(255, 200, 90), -1);

            self._add("nukekit", "星爆核心",
                "暂停界面使用：立刻全屏爆破",
                "在暂停界面点击使用，立刻引爆一枚新星，把当前屏幕上的砖块全部炸掉，适合关卡末尾收尾。",
                "个", 1, 280, Color.fromArgb(255, 140, 90), -1);

            self._add("freezekit", "时空凝滞",
                "暂停界面使用：砖块冻结 10 秒",
                "在暂停界面点击使用，全部砖块与下压暂停 10 秒，与掉落道具「时间冻结」叠加时长。",
                "个", 1, 170, Color.fromArgb(140, 235, 255), -1);

            // 礼包
            self._add("pack3", "深空补给", "中档随机奖励", "打开后随机获得：砖块币 20~70、随机卡片 1~3 张、小概率永久属性 +1。", "箱", 1, 1400, Color.fromArgb(140, 235, 255), 3);
            self._add("pack0", "霓虹福袋", "随机获得若干卡片与币", "打开后随机获得：复活卡 0~2 张、生命卡 0~3 张、护盾 0~2 个、砖块币 5~30。", "袋", 1, 800, G.NeonCyan, 0);
            self._add("pack1", "霓虹宝箱", "更高价值随机奖励", "打开后随机获得：砖块币 40~120、随机卡片 2~5 张、小概率永久属性。", "箱", 1, 2000, G.NeonPurple, 1);
            self._add("pack2", "传说核心", "最高价值随机奖励", "打开后随机获得：砖块币 150~400、卡片 5~10 张、较高概率永久属性 +1~+3。", "核", 1, 6000, G.NeonYellow, 2);
        },

        get pageCount() { return Math.trunc((this.items.length + 11) / 12); },

        itemAt: function (page, slot) {
            var i = page * 12 + slot;
            if (i < 0 || i >= this.items.length) return null;
            return this.items[i];
        },

        // ---------- 库存 ----------
        count: function (key) {
            switch (key) {
                case "revive": return Profile.reviveCards;
                case "life": return Profile.lifeCards;
                case "shield": return Profile.shieldKits;
                case "lucky": return Profile.luckyKits;
                case "multi": return Profile.multiKits;
                case "slow": return Profile.slowKits;
            }
            var v = this.inv[key];
            return (v === undefined) ? 0 : v;
        },

        grant: function (key, n) {
            switch (key) {
                case "revive": Profile.reviveCards += n; break;
                case "life": Profile.lifeCards += n; break;
                case "shield": Profile.shieldKits += n; break;
                case "lucky": Profile.luckyKits += n; break;
                case "multi": Profile.multiKits += n; break;
                case "slow": Profile.slowKits += n; break;
                case "startpaddle": this.inv[key] = this.count(key) + n * 10; break;
                case "startball": this.inv[key] = this.count(key) + n; break;
                case "startdrop": this.inv[key] = this.count(key) + n; break;
                default:
                    this.inv[key] = this.count(key) + n;
                    break;
            }
            Profile.save();
            this.save();
        },

        spend: function (key, n) {
            switch (key) {
                case "revive": Profile.reviveCards = Math.max(0, Profile.reviveCards - n); break;
                case "life": Profile.lifeCards = Math.max(0, Profile.lifeCards - n); break;
                case "shield": Profile.shieldKits = Math.max(0, Profile.shieldKits - n); break;
                case "lucky": Profile.luckyKits = Math.max(0, Profile.luckyKits - n); break;
                case "multi": Profile.multiKits = Math.max(0, Profile.multiKits - n); break;
                case "slow": Profile.slowKits = Math.max(0, Profile.slowKits - n); break;
                default: this.inv[key] = Math.max(0, this.count(key) - n); break;
            }
            Profile.save();
            this.save();
        },

        get startBallBonus() { return this.count("startball"); },
        get startPaddleBonus() { return this.count("startpaddle"); },
        get startDropBonus() { return this.count("startdrop"); },

        // ---------- 存档 ----------
        load: function () {
            this.buildItems();
            for (var i = 0; i < this.lv.length; i++) this.lv[i] = 0;
            this.inv = Object.create(null);
            try {
                var raw = storageGet(META_KEY);
                if (raw === null) return;
                var ls = String(raw).split(/\r?\n/);
                for (var n = 0; n < ls.length; n++) {
                    var s = ls[n];
                    var k = s.indexOf('=');
                    if (k <= 0) continue;
                    var key = s.substring(0, k).trim();
                    var val = s.substring(k + 1).trim();
                    var parsed = tryParseInt(val);
                    var iv = (parsed === null) ? 0 : parsed;   // 对应 int.TryParse 失败默认 0
                    if (key.indexOf("lv.") === 0) {
                        for (var u = 0; u < this.ups.length; u++) {
                            if (key === "lv." + this.ups[u].key) this.lv[u] = iv;
                        }
                        continue;
                    }
                    switch (key) {
                        case "quality": this.quality = iv; break;
                        case "musicvol": this.musicVol = iv; break;
                        case "sfxvol": this.sfxVol = iv; break;
                        case "musicon": this.musicOn = (val === "1"); break;
                        case "shake": this.shakeOn = (val === "1"); break;
                        case "particle": this.particleOn = (val === "1"); break;
                        case "sfx": this.sfxOn = (val === "1"); break;
                        case "track": this.musicTrack = iv; break;
                        case "musicfile": this.musicFile = val; break;
                        case "replay": this.replayOn = (val === "1"); break;
                        case "replaykeep": this.replayKeep = iv; break;
                        case "window": this.windowMode = iv; break;
                        default:
                            if (key.indexOf("inv.") === 0) this.inv[key.substring(4)] = iv;
                            break;
                    }
                }
            } catch (e) { /* 静默 */ }
        },

        save: function () {
            try {
                var lines = [];
                for (var u = 0; u < this.ups.length; u++) lines.push("lv." + this.ups[u].key + "=" + this.lv[u]);
                lines.push("quality=" + this.quality);
                lines.push("musicvol=" + this.musicVol);
                lines.push("sfxvol=" + this.sfxVol);
                lines.push("musicon=" + (this.musicOn ? 1 : 0));
                lines.push("shake=" + (this.shakeOn ? 1 : 0));
                lines.push("particle=" + (this.particleOn ? 1 : 0));
                lines.push("sfx=" + (this.sfxOn ? 1 : 0));
                lines.push("track=" + this.musicTrack);
                lines.push("musicfile=" + (this.musicFile === null || this.musicFile === undefined ? "" : this.musicFile));
                lines.push("replay=" + (this.replayOn ? 1 : 0));
                lines.push("replaykeep=" + this.replayKeep);
                lines.push("window=" + this.windowMode);
                for (var k in this.inv) {
                    if (Object.prototype.hasOwnProperty.call(this.inv, k) && this.inv[k] > 0) lines.push("inv." + k + "=" + this.inv[k]);
                }
                storageSet(META_KEY, lines.join('\n'));
            } catch (e) { /* 静默 */ }
        },

        // ---------- 礼包 ----------
        openPack: function (packId) {
            var r = Math.random;
            var rndRange = function (a, b) { return a + Math.floor(r() * (b - a)); };
            if (packId === 0) {
                var a = rndRange(0, 3), b = rndRange(0, 4), c = rndRange(0, 3), coin = rndRange(5, 31);
                if (a > 0) Profile.reviveCards += a;
                if (b > 0) Profile.lifeCards += b;
                if (c > 0) Profile.shieldKits += c;
                Profile.coins += coin;
                Profile.save();
                return "福袋：复活卡+" + a + " 生命卡+" + b + " 护盾+" + c + " 币+" + coin;
            }
            if (packId === 3) {
                var coin3 = rndRange(20, 71);
                var cards3 = rndRange(1, 4);
                Profile.coins += coin3;
                Profile.lifeCards += cards3;
                Profile.save();
                if (rndRange(0, 100) < 15) {
                    var idx3 = rndRange(0, this.ups.length);
                    this.lv[idx3]++;
                    this.save();
                    return "深空补给：币+" + coin3 + " 生命卡+" + cards3 + " 永久 " + this.ups[idx3].name + " 升 1 级";
                }
                return "深空补给：币+" + coin3 + " 生命卡+" + cards3;
            }
            if (packId === 1) {
                var coin1 = rndRange(40, 121);
                var cards1 = rndRange(2, 6);
                Profile.coins += coin1;
                var half = Math.trunc(cards1 / 2);
                Profile.reviveCards += half;
                Profile.lifeCards += cards1 - half;
                if (rndRange(0, 100) < 25) {
                    var idx1 = rndRange(0, this.ups.length);
                    this.lv[idx1]++;
                    this.save();
                    return "宝箱：币+" + coin1 + " 卡片+" + cards1 + " 永久 " + this.ups[idx1].name + " 升 1 级";
                }
                Profile.save();
                return "宝箱：币+" + coin1 + " 卡片+" + cards1;
            }
            var cn = rndRange(150, 401);
            Profile.coins += cn;
            var up = rndRange(1, 4);
            var order = [];
            for (var i = 0; i < this.lv.length; i++) order.push(i);
            for (var j = 0; j < order.length; j++) {
                var m = rndRange(j, order.length);
                var t = order[j]; order[j] = order[m]; order[m] = t;
            }
            var sb = "传说核心：币+" + cn;
            for (var p = 0; p < up; p++) {
                this.lv[order[p]]++;
                sb += " " + this.ups[order[p]].name + "+1";
            }
            Profile.save();
            this.save();
            return sb;
        },

        // ---------- 拥有物清单 ----------
        ownedList: function () {
            var ls = [];
            if (Profile.reviveCards > 0) ls.push("复活卡 ×" + Profile.reviveCards);
            if (Profile.lifeCards > 0) ls.push("生命 +1 卡 ×" + Profile.lifeCards);
            if (Profile.shieldKits > 0) ls.push("护盾套件 ×" + Profile.shieldKits);
            if (Profile.luckyKits > 0) ls.push("幸运符 ×" + Profile.luckyKits);
            if (Profile.multiKits > 0) ls.push("多重球启动器 ×" + Profile.multiKits);
            if (Profile.slowKits > 0) ls.push("缓速器 ×" + Profile.slowKits);
            if (this.count("startball") > 0) ls.push("起始球 +" + this.count("startball"));
            if (this.count("startpaddle") > 0) ls.push("挡板 +" + this.count("startpaddle") + " px");
            if (this.count("startdrop") > 0) ls.push("掉落率 +" + this.count("startdrop") + "%");
            for (var i = 0; i < this.ups.length; i++) {
                if (this.lv[i] > 0) ls.push(this.ups[i].name + " Lv." + this.lv[i]);
            }
            return ls;
        }
    };
    NB.Meta = Meta;

})();
