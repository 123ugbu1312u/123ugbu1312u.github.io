/*
 * levels.js —— 移植自 Codes/Levels.cs（1:1 逐关逐格照搬，未自行设计任何关卡）
 * ------------------------------------------------------------------
 * 加载方式：经典 <script>，非 ES Module；IIFE 包裹。
 * 依赖：core.js（NB.G 配色）
 *
 * 导出清单（挂在全局 NB 上）：
 *   NB.LevelDef   关卡定义类：name,hint,speedMul,rows（LevelDef(name,hint,speed,mul,rows)）
 *   NB.Levels     { all: LevelDef[]（30 关，顺序与源码一致）, get count }
 *   NB.UpgradePool { get all（懒构建 16 项）, build(), pick(count, stats, rnd?) }
 *
 * 布局字符含义（沿用源码）：
 *   '1'-'9' = 血量砖   '.' = 空   'X' = 不可破坏   'B' = 爆炸砖
 *   'M' = 移动砖       'G' = 必掉道具（布局中未使用，逻辑保留于下一阶段）
 */
(function () {
    'use strict';

    var NB = globalThis.NB = globalThis.NB || {};
    var G = NB.G;

    function LevelDef(name, hint, speed, rows) {
        this.name = name;
        this.hint = hint;
        this.rows = rows;
        this.speedMul = speed;
    }
    NB.LevelDef = LevelDef;

    var All = [
        new LevelDef("初识霓虹", "移动鼠标控制挡板，点击或空格发射", 1.00, [
            "1111111111111",
            "1111111111111",
            "1111111111111"]),

        new LevelDef("棋盘律动", "球的角度由挡板命中点决定", 1.00, [
            "1.1.1.1.1.1.1",
            ".1.1.1.1.1.1.",
            "1.1.1.1.1.1.1",
            ".1.1.1.1.1.1."]),

        new LevelDef("双层壁垒", "紫色砖需要两次撞击", 1.02, [
            "2222222222222",
            "1111111111111",
            "1111111111111"]),

        new LevelDef("金字塔", "由外向内层层剥开", 1.04, [
            "......1......",
            ".....121.....",
            "....12321....",
            "...1233321...",
            "..123333321.."]),

        new LevelDef("爆裂前奏", "黄色爆炸砖会波及周围", 1.04, [
            "1B11B11B11B11",
            "1111111111111",
            "2222222222222"]),

        new LevelDef("钢铁栅栏", "灰色砖无法破坏，绕开它", 1.05, [
            "1111111111111",
            "X.X.X.X.X.X.X",
            "1111111111111",
            "X.X.X.X.X.X.X"]),

        new LevelDef("斜线脉冲", "连续的斜向弹射", 1.06, [
            "...1111111...",
            "..111111111..",
            ".11111111111.",
            "1111111111111"]),

        new LevelDef("心之壁", "层层深入", 1.06, [
            "..11.....11..",
            ".1111...1111.",
            "1111111111111",
            "1111111111111",
            ".11111111111.",
            "..111111111..",
            "...1111111...",
            "....11111....",
            ".....111.....",
            "......1......"]),

        new LevelDef("双爆阵", "连锁爆炸能一次清屏", 1.07, [
            "B1111111111B",
            "1B11111111B1",
            "1111111111111",
            "2222222222222"]),

        new LevelDef("移动要塞", "蓝色砖块左右游走", 1.08, [
            "M1111111111M",
            "1M11111111M1",
            "1111111111111",
            "2222222222222",
            "3333333333333"]),

        new LevelDef("三色堑壕", "橙砖需要三次撞击", 1.08, [
            "1111111111111",
            "3333333333333",
            "2222222222222",
            "1111111111111"]),

        new LevelDef("夹心", "中间夹着一层钢栅", 1.09, [
            "2222222222222",
            "1111111111111",
            "X.X.X.X.X.X.X",
            "1111111111111",
            "2222222222222"]),

        new LevelDef("血脉迷宫", "钢栅把战场切成多条通道", 1.09, [
            "1111111111111",
            "1X1X1X1X1X1X1",
            "1111111111111",
            "1X1X1X1X1X1X1",
            "2222222222222"]),

        new LevelDef("齿轮", "环形结构", 1.10, [
            ".11111111111.",
            "11.1111111.11",
            "111.11111.111",
            "1111111111111",
            "111.11111.111",
            "11.1111111.11",
            ".11111111111."]),

        new LevelDef("星环", "中心是双层核心", 1.10, [
            "....11111....",
            "..111111111..",
            ".11.11111.11.",
            "1111.111.1111",
            ".11.11111.11.",
            "..111111111..",
            "....11111...."]),

        new LevelDef("三重铁壁", "三层防护，逐层击穿", 1.11, [
            "3333333333333",
            "1111111111111",
            "X.X.X.X.X.X.X",
            "1111111111111",
            "3333333333333"]),

        new LevelDef("爆裂回廊", "斜向排列的爆炸砖", 1.12, [
            "B1111111111B",
            "1B11111111B1",
            "11B111111B11",
            "111B1111B111",
            "1111111111111"]),

        new LevelDef("双子塔", "中间留出高速通道", 1.12, [
            "1111111111111",
            "1.111111111.1",
            "1..1111111..1",
            "1...11111...1",
            "1....111....1",
            "1.....1.....1"]),

        new LevelDef("血砖之宴", "粉色四血砖登场", 1.13, [
            "4444444444444",
            "2222222222222",
            "1111111111111",
            "2222222222222",
            "4444444444444"]),

        new LevelDef("移动之墙", "大量移动砖", 1.14, [
            "MM111111111MM",
            "1MM1111111MM1",
            "111M11111M111",
            "4444444444444",
            "3333333333333"]),

        new LevelDef("迷宫回廊", "找到钢栅的缺口", 1.14, [
            "1111X1111X111",
            "1111X1111X111",
            "1111111111111",
            "X111111111111",
            "111111111111X"]),

        new LevelDef("碎星", "稀疏散点，考验角度", 1.15, [
            "1.1.111.1.1.1",
            ".2.2.222.2.2.",
            "1.1.111.1.1.1",
            ".2.2.222.2.2.",
            "3333333333333"]),

        new LevelDef("爆炸核心", "核心连环引爆", 1.16, [
            "1B33333333B11",
            "1111111111111",
            "1111111111111",
            "2222222222222"]),

        new LevelDef("心跳", "起伏的节奏", 1.16, [
            ".1111...1111.",
            "1111111111111",
            ".11111111111.",
            "..111111111..",
            "...1111111...",
            "....11111....",
            ".....111.....",
            "......1......"]),

        new LevelDef("尖刺王座", "五血砖坐镇中央", 1.18, [
            "5....111....5",
            ".5...111...5.",
            "..5..111..5..",
            "...5.111.5...",
            "....51115....",
            "3333333333333"]),

        new LevelDef("钢铁潮汐", "密集钢栅，只有窄缝", 1.18, [
            "1111111111111",
            "X1X1X1X1X1X1X",
            "1111111111111",
            "X1X1X1X1X1X1X",
            "1111111111111",
            "4444444444444"]),

        new LevelDef("双爆迷宫", "爆炸砖与钢栅交替", 1.20, [
            "B11X11B11X11B",
            "1111111111111",
            "B11X11B11X11B",
            "2222222222222"]),

        new LevelDef("深红领域", "整面血砖墙", 1.20, [
            "4444444444444",
            "4444444444444",
            "3333333333333",
            "2222222222222",
            "1111111111111"]),

        new LevelDef("终末回廊", "六血砖封锁上层", 1.22, [
            "5555555555555",
            "X1111111111X1",
            "X1111111111X1",
            "1111111111111",
            "B333333333333",
            "1111111111111"]),

        new LevelDef("霓虹之王", "最终试炼，尽情破坏", 1.25, [
            "6666666666666",
            "55X55X55X55X5",
            "1111111111111",
            "M1111111111M",
            "B11B11B11B11B"])
    ];

    var Levels = {
        all: All,
        get count() { return All.length; }
    };
    NB.Levels = Levels;

    // ===================== 升级池 =====================
    var Upgrade = NB.Upgrade;

    var UpgradePool = {
        _all: null,

        get all() {
            if (this._all === null) this.build();
            return this._all;
        },

        build: function () {
            var list = [];
            list.push(new Upgrade("强化弹头", "每颗球伤害 +1", G.NeonPurple, "DMG", function (s) { s.damage += 1; }));
            list.push(new Upgrade("加速引擎", "球速 +9%", G.NeonCyan, "SPD", function (s) { s.speedMul += 0.09; }));
            list.push(new Upgrade("宽幅挡板", "挡板宽度 +22", G.NeonGreen, "PAD", function (s) { s.paddleW += 22; }));
            list.push(new Upgrade("暴击核心", "暴击率 +12%", G.NeonYellow, "CRT", function (s) { s.critChance += 12; }));
            list.push(new Upgrade("增援球体", "开局球数 +1", G.NeonYellow, "BAL", function (s) { s.startBalls += 1; }));
            list.push(new Upgrade("激光炮台", "挡板激光等级 +1", G.NeonPink, "LSR", function (s) { s.laserLevel += 1; }));
            list.push(new Upgrade("穿透谐振", "穿透冷却缩短", G.NeonBlue, "PRC", function (s) { s.pierceLevel += 1; }));
            list.push(new Upgrade("磁力场", "球撞板后更趋于竖直", G.NeonPurple, "MAG", function (s) { s.magnet = Math.min(0.8, s.magnet + 0.3); }));
            list.push(new Upgrade("能量护盾", "底部护盾 +1 层", G.NeonPurple, "SHD", function (s) { s.shieldCharges += 1; }));
            list.push(new Upgrade("幸运掉落", "道具掉落率 +7%", G.NeonGreen, "LCK", function (s) { s.dropBonus += 0.07; }));
            var lifeUp = new Upgrade("生命回路", "生命 +1", G.NeonPink, "LIF", function (s) { });
            lifeUp.extraLife = 1;
            list.push(lifeUp);
            list.push(new Upgrade("微型球体", "球半径 -1（更灵活）", G.NeonCyan, "RAD", function (s) { s.ballRadius = Math.max(5, s.ballRadius - 1); }));
            list.push(new Upgrade("爆裂球心", "球撞击时产生小范围爆炸", G.NeonOrange, "BMB", function (s) { s.bombBall = true; }));
            list.push(new Upgrade("战术缓速", "球速 -10%（更易控制）", G.NeonBlue, "SLW", function (s) { s.speedMul = Math.max(0.72, s.speedMul - 0.10); }));
            list.push(new Upgrade("能量晶体", "每块砖额外 +5 分", G.NeonOrange, "GOLD", function (s) { s.coinBonus += 5; }));
            list.push(new Upgrade("粘性涂层", "球撞板后粘住，可再次瞄准", G.NeonGreen, "STK", function (s) { s.sticky = true; }));
            this._all = list;
        },

        // C# Pick(Random r, int count, Stats s) → pick(count, stats, rnd?)
        // rnd 为 0..1 随机源，缺省 Math.random
        pick: function (count, s, rnd) {
            var r = rnd || Math.random;
            var pool = this.all.slice(0);
            for (var i = pool.length - 1; i >= 0; i--) {
                var u = pool[i];
                if (u.tag === "BAL" && s.startBalls >= 4) pool.splice(i, 1);
                else if (u.tag === "RAD" && s.ballRadius <= 5.2) pool.splice(i, 1);
                else if (u.tag === "BMB" && s.bombBall) pool.splice(i, 1);
                else if (u.tag === "STK" && s.sticky) pool.splice(i, 1);
                else if (u.tag === "SPD" && s.speedMul >= 1.8) pool.splice(i, 1);
                else if (u.tag === "PAD" && s.paddleW >= 300) pool.splice(i, 1);
                else if (u.tag === "MAG" && s.magnet >= 0.79) pool.splice(i, 1);
            }
            var res = [];
            for (var k = 0; k < count && pool.length > 0; k++) {
                var idx = Math.floor(r() * pool.length);
                res.push(pool[idx]);
                pool.splice(idx, 1);
            }
            return res;
        }
    };
    NB.UpgradePool = UpgradePool;

})();
