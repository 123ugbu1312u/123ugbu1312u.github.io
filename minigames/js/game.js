/* =====================================================================
 * 霓虹破砖 Neon Breaker — game.js
 * 第三阶段：对局主逻辑（严格 1:1 移植 Codes\GameForm.cs，1595 行）
 *
 * 移植映射（C# → JS）
 *   GameForm 字段/状态机/主循环/缩放     → NB.Game（g 对象）
 *   StartGame / LoadLevel / BuildEndless → startGame / loadLevel / buildEndlessStart
 *   UpdatePlay / UpdateBalls / Collide   → updatePlay / updateBalls / collideBricks
 *   NovaBlast / ClearAllBricks / Explode → novaBlast / clearAllBricks / explodeAt
 *   SpawnDrop / ApplyDrop / UpdateDrops  → spawnDrop / applyDrop / updateDrops
 *   LoseLife / LevelClear / ShowUpgrade  → loseLife / levelClear / showUpgrade
 *   GameOver / WinGame / SettleRun       → gameOver / winGame / settleRun
 *   OnMouseDown / OnKeyDown / OnWheel    → onMouseDown / onKeyDown / onWheel
 *   绘制（DrawScene.OnPaint）             → NB.DrawScene.draw（draw.js）
 *   商店 / 道具面板                        → NB.Shop / NB.PauseItems
 *
 * 增量（仅控制方式适配，规则/数值不变）：
 *   - 桌面端：鼠标 X 跟随挡板、Y 锁 PaddleY、左键发球+拖拽、右键无尽刷 2 排、滚轮原逻辑、Esc 暂停
 *   - 移动端：pointer:coarse 或首次 touch 判定 → 左下虚拟摇杆 + 右下发球/刷砖钮 + 暂停钮
 *   - 触摸一律 preventDefault（禁页面滚动/双击缩放），坐标按 viewScale 反算
 *   - NB.Game.replayHook(canvas)：每帧交给 NB.Replay（未加载则静默跳过）
 * ===================================================================== */
(function (NB) {
    'use strict';

    var G = NB.G, M = NB.M, Color = NB.Color;
    var Profile = NB.Profile, Meta = NB.Meta, Sfx = NB.Sfx, Music = NB.Music;
    var Levels = NB.Levels, UpgradePool = NB.UpgradePool, Economy = NB.Economy;
    var BrickType = NB.BrickType, DropKind = NB.DropKind;

    var State = {
        Menu: 'menu',
        Play: 'play',
        Pause: 'pause',
        Upgrade: 'upgrade',
        GameOver: 'gameover',
        Win: 'win',
        Help: 'help',
        Shop: 'shop'
    };

    // C# class Laser { float X; float Life; float Width = 9f; }
    function Laser() {
        this.x = 0;
        this.life = 0;
        this.width = 9;
    }

    // ===================== 主状态对象（对应 GameForm 字段） =====================
    var g = {
        // 视口
        viewScale: 1,
        viewOffX: 0,
        viewOffY: 0,
        dt: 0.016,
        fps: 60,

        // 状态机
        state: State.Menu,
        endlessMode: false,
        levelIndex: 0,

        // 游戏对象
        bricks: [],
        balls: [],
        parts: [],
        drops: [],
        lasers: [],
        stats: null,

        paddleX: G.W / 2,
        paddleTarget: G.W / 2,
        paddleTargetVX: 0,
        paddlePrevX: G.W / 2,
        paddleW: 90,

        score: 0,
        displayScore: 0,
        combo: 0,
        bestCombo: 0,
        comboT: 0,
        lives: 3,
        bricksCleared: 0,

        laserT: 0, slowT: 0, wideT: 0,
        bigT: 0, rushT: 0, freezeT: 0,
        laserCd: 0,
        shake: 0,
        gameTime: 0,
        levelSpeedMul: 1,

        // 经济
        runTime: 0,
        heatMinutes: 0,
        lastReward: 0,
        lastRewardLucky: false,
        lastSettlePoints: 0,
        settledThisRun: false,
        settledBaseScore: 0,
        kitNotice: '',
        kitNoticeT: 0,

        // 无尽
        waveT: 0,
        wave: 0,
        shiftAnim: 0,
        shiftCd: 0,
        tntRespawnT: 0,

        // 升级
        offers: [],
        upgradeAnim: 0,
        upgradePick: -1,

        // 文本
        levelName: '',
        levelHint: '',
        hintT: 0,
        banner: '',
        bannerT: 0,
        bannerColor: '#ffffff',

        toast: '',
        toastT: 0,
        toastColor: '#ffffff',

        // 视觉
        backdrop: null,
        flashWhite: 0,
        mousePos: { x: G.W / 2, y: G.H / 2 },
        mouseInside: true,
        dragging: false,

        // 其他
        newRecord: false,
        shopTab: 0,
        pitOpen: false,   // 暂停道具面板是否展开（draw.js 依赖）

        // 输入适配（本移植新增）
        mobile: false,
        touchActive: false,
        touchPaddleX: G.W / 2,

        // 回放钩子（本轮不实现 replay.js）
        replayHook: null
    };

    // C# float PaddleW { get { return M.Clamp(stats.paddleW + (wideT>0?64:0), 90, 340); } }
    function paddleW() {
        var w = g.stats.paddleW + (g.wideT > 0 ? 64 : 0);
        return M.clamp(w, 90, 340);
    }

    // C# float TargetSpeed()
    function targetSpeed() {
        var sp = G.BaseSpeed * g.stats.speedMul * g.levelSpeedMul;
        if (g.endlessMode) sp *= 1 + Math.min(0.55, g.wave * 0.028);
        if (g.slowT > 0) sp *= 0.62;
        return M.clamp(sp, 260, 1180);
    }

    // ===================== 画布：逻辑 1280x800 + 等比居中 =====================
    var canvas = null, ctx = null, buf = null, bctx = null, dpr = 1;

    function setupCanvas(el) {
        canvas = el;
        ctx = canvas.getContext('2d');
        buf = document.createElement('canvas');
        buf.width = G.W;
        buf.height = G.H;
        bctx = buf.getContext('2d');
        if (!g.stats) g.stats = new NB.Stats();
        fitView();
        if (window.ResizeObserver) {
            new ResizeObserver(function () { fitView(); }).observe(canvas);
        }
        window.addEventListener('resize', fitView);
        bindInput();
    }

    // C# FitView：等比缩放并居中
    function fitView() {
        if (!canvas) return;
        var cw = canvas.clientWidth || canvas.width;
        var ch = canvas.clientHeight || canvas.height;
        if (cw <= 0 || ch <= 0) return;
        dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.max(1, Math.round(cw * dpr));
        canvas.height = Math.max(1, Math.round(ch * dpr));
        g.viewScale = Math.min(cw / G.W, ch / G.H);
        g.viewOffX = (cw - G.W * g.viewScale) * 0.5;
        g.viewOffY = (ch - G.H * g.viewScale) * 0.5;
    }

    // C# ToLogical：屏幕坐标 → 逻辑坐标（viewScale 反算）
    function toLogical(clientX, clientY) {
        var r = canvas.getBoundingClientRect();
        return {
            x: ((clientX - r.left) - g.viewOffX) / g.viewScale,
            y: ((clientY - r.top) - g.viewOffY) / g.viewScale
        };
    }

    // ===================== 游戏流程 =====================
    // C# StartGame(bool endless, int level)
    function startGame(endless, level) {
        g.endlessMode = endless;
        g.levelIndex = level;
        g.stats = new NB.Stats();
        Meta.applyToStats(g.stats);
        g.score = 0; g.displayScore = 0; g.combo = 0; g.bestCombo = 0; g.comboT = 0;
        g.lives = 3 + Meta.permLv('life');
        g.bricksCleared = 0;

        // 商店永久商品真实生效
        g.stats.startBalls += Meta.startBallBonus;
        g.stats.paddleW += Meta.startPaddleBonus;
        g.stats.dropBonus = Math.min(0.75, g.stats.dropBonus + Meta.startDropBonus * 0.01);
        g.stats.shieldCharges += Meta.count('startshield');
        g.stats.laserLevel += Meta.count('startlaser');
        g.stats.magnet = Math.min(0.9, g.stats.magnet + Meta.count('startmagnet') * 0.08);
        g.stats.critChance = Math.min(95, g.stats.critChance + Meta.count('startcrit') * 3);
        g.lives = Math.min(9, g.lives + Meta.count('startlife'));
        var startCoinBonus = Meta.count('startcoin') * 500;
        if (startCoinBonus > 0) { g.score = startCoinBonus; g.displayScore = startCoinBonus; }

        g.laserT = 0; g.slowT = 0; g.wideT = 0; g.laserCd = 0;
        g.wave = 0; g.waveT = 18; g.shiftAnim = 0; g.shiftCd = 0; g.tntRespawnT = 0;
        g.parts.length = 0; g.drops.length = 0; g.lasers.length = 0;
        g.bricks.length = 0; g.balls.length = 0;
        g.newRecord = false;
        g.bigT = 0; g.rushT = 0; g.freezeT = 0;

        Profile.playCount++;
        Profile.save();

        if (endless) {
            g.levelName = '无尽模式';
            g.levelHint = '砖块不断下压，坚持越久越好';
            g.levelSpeedMul = 1;
            buildEndlessStart();
        } else {
            loadLevel(level);
        }
        beginRunEconomy();
        applyPreGameKits();
        g.state = State.Play;
        g.hintT = 4.5;
        g.banner = endless ? '无尽模式' : ('第 ' + (level + 1) + ' 关  ' + g.levelName);
        g.bannerColor = endless ? G.NeonPurple : G.NeonCyan;
        g.bannerT = 1.8;
        spawnBall();
    }

    function beginRunEconomy() {
        g.runTime = 0;
        g.heatMinutes = 0;
        g.lastReward = 0;
        g.lastRewardLucky = false;
        g.lastSettlePoints = 0;
        g.settledThisRun = false;
        g.settledBaseScore = 0;
        g.kitNotice = '';
        g.kitNoticeT = 0;
    }

    // 开局类道具：购买后存库，每局开始自动消耗 1 个
    function applyPreGameKits() {
        var used = [];
        if (Profile.shieldKits > 0) { Profile.shieldKits--; g.stats.shieldCharges += 1; used.push('护盾'); }
        if (Profile.multiKits > 0) { Profile.multiKits--; g.stats.startBalls = Math.max(g.stats.startBalls, 3); used.push('三球'); }
        if (Profile.slowKits > 0) { Profile.slowKits--; g.slowT = 20; used.push('缓速'); }
        if (Profile.luckyKits > 0) { Profile.luckyKits--; g.stats.dropBonus += 0.15; used.push('幸运'); }
        if (used.length === 0) return;
        Profile.save();
        g.kitNotice = '开局携带：' + used.join(' · ');
        g.kitNoticeT = 6;
    }

    // C# LoadLevel(int idx)
    function loadLevel(idx) {
        g.bricks.length = 0;
        g.balls.length = 0;
        g.drops.length = 0;
        g.laserT = 0; g.slowT = 0; g.wideT = 0;
        var def = Levels.all[idx];
        g.levelName = def.name;
        g.levelHint = def.hint;
        g.levelSpeedMul = def.speedMul;
        g.paddleX = G.W / 2; g.paddleTarget = G.W / 2;

        for (var r = 0; r < def.rows.length; r++) {
            var row = def.rows[r];
            for (var c = 0; c < row.length && c < G.Cols; c++) {
                var ch = row.charAt(c);
                if (ch === '.') continue;
                var b = new NB.Brick();
                b.x = G.GridX + c * G.cellW;
                b.y = G.GridTop + r * G.rowH;
                b.w = G.BrickW;
                b.h = G.BrickH;
                b.baseX = b.x;
                b.spawn = 1;
                if (ch === 'X') { b.type = BrickType.Unbreak; b.hp = 999; b.tint = Color.fromArgb(96, 100, 128); }
                else if (ch === 'B') { b.type = BrickType.Bomb; b.hp = 1; b.maxHp = 1; b.tint = G.NeonYellow; }
                else if (ch === 'M') {
                    b.type = BrickType.Moving; b.hp = 2; b.maxHp = 2; b.tint = G.NeonBlue;
                    b.amp = 46; b.speed = 1.1 + (r % 3) * 0.25; b.phase = c * 0.7 + r;
                }
                else if (ch === 'G') { b.type = BrickType.Gift; b.hp = 1; b.maxHp = 1; b.tint = G.NeonGreen; b.ensureDrop = true; }
                else {
                    var hp = parseInt(ch, 10);
                    if (isNaN(hp)) hp = 1;
                    b.hp = hp; b.maxHp = hp; b.type = BrickType.Normal; b.tint = NB.Brick.colorForHp(hp);
                }
                b.scoreVal = 10 + Math.min(b.hp, 8) * 6;
                b.spawn = 0;
                g.bricks.push(b);
            }
        }
        // 出现动画错峰
        for (var i = 0; i < g.bricks.length; i++) g.bricks[i].spawn = -(i % 26) * 0.035;

        // 第 20 关起：顶部中央嵌一颗 TNT 砖
        if (idx >= 19) spawnTntBlock();
    }

    // C# SpawnTntBlock()
    function spawnTntBlock() {
        removeTnt();
        var col = Math.floor(G.Cols / 2);
        var x = G.GridX + col * G.cellW;
        var y = G.GridTop;

        for (var i = g.bricks.length - 1; i >= 0; i--) {
            var o = g.bricks[i];
            if (o.type === BrickType.Unbreak) continue;
            var oc = o.center;
            if (Math.abs(oc.x - x) < G.cellW * 1.45 && Math.abs(oc.y - y) < G.rowH * 1.45) g.bricks.splice(i, 1);
        }

        var wc = [col - 1, col + 1, col - 1, col, col + 1];
        var wr = [0, 0, 1, 1, 1];
        for (var k = 0; k < wc.length; k++) {
            if (wc[k] < 0 || wc[k] >= G.Cols) continue;
            var w = new NB.Brick();
            w.type = BrickType.Normal;
            w.hp = 1; w.maxHp = 1;
            w.x = G.GridX + wc[k] * G.cellW;
            w.y = y + wr[k] * G.rowH;
            w.w = G.BrickW; w.h = G.BrickH; w.baseX = w.x;
            w.tint = G.NeonCyan;
            w.scoreVal = 16;
            w.fixed = true;
            w.spawn = 1;
            g.bricks.push(w);
        }

        var t = new NB.Brick();
        t.type = BrickType.Nova;
        t.hp = 1; t.maxHp = 1;
        t.x = x; t.y = y; t.w = G.BrickW; t.h = G.BrickH; t.baseX = x;
        t.tint = Color.fromArgb(240, 74, 48);
        t.scoreVal = 80;
        t.fixed = true;
        t.spawn = 1;
        g.bricks.push(t);
    }

    function hasTnt() {
        for (var i = 0; i < g.bricks.length; i++)
            if (!g.bricks[i].dead && g.bricks[i].type === BrickType.Nova) return true;
        return false;
    }

    function removeTnt() {
        for (var i = g.bricks.length - 1; i >= 0; i--) {
            var b = g.bricks[i];
            if (b.type === BrickType.Nova || (b.fixed && b.type !== BrickType.Unbreak)) g.bricks.splice(i, 1);
        }
    }

    // C# BuildEndlessStart()：4 排 + TNT
    function buildEndlessStart() {
        g.bricks.length = 0;
        for (var r = 0; r < 4; r++) spawnEndlessRow(G.GridTop + r * G.rowH);
        spawnTntBlock();
    }

    // C# SpawnEndlessRow(float y)
    function spawnEndlessRow(y) {
        var count = 7 + M.randInt(6);
        var slots = [];
        var tntCol = Math.floor(G.Cols / 2);
        var guard = hasTnt();
        for (var i = 0; i < G.Cols; i++) {
            if (guard && Math.abs(i - tntCol) <= 1) continue;
            slots.push(i);
        }
        if (count > slots.length) count = slots.length;
        for (var n = 0; n < count; n++) {
            var k = M.randInt(slots.length);
            var c = slots[k];
            slots.splice(k, 1);
            var b = new NB.Brick();
            b.x = G.GridX + c * G.cellW;
            b.y = y;
            b.w = G.BrickW; b.h = G.BrickH;
            b.baseX = b.x; b.spawn = 0;
            var roll = Math.random();
            var hp = 1;
            if (g.wave > 6 && roll < 0.14) hp = 3;
            else if (g.wave > 2 && roll < 0.38) hp = 2;
            b.hp = hp; b.maxHp = hp;
            b.tint = NB.Brick.colorForHp(hp);
            if (roll > 0.93 && g.wave > 1) { b.type = BrickType.Bomb; b.tint = G.NeonYellow; }
            else if (roll > 0.86 && g.wave > 3) { b.type = BrickType.Moving; b.amp = 40; b.speed = 1.2; b.phase = c + g.wave; }
            b.scoreVal = 10 + Math.min(b.hp, 8) * 6;
            g.bricks.push(b);
        }
    }

    // C# SpawnBall()
    function spawnBall() {
        g.balls.length = 0;
        var n = Math.max(1, Math.min(4, g.stats.startBalls));
        for (var i = 0; i < n; i++) {
            var b = new NB.Ball();
            b.r = g.stats.ballRadius;
            b.x = g.paddleX;
            b.y = G.PaddleY - 24;
            b.stuck = true;
            b.stickOffset = (i - (n - 1) * 0.5) * 26;
            b.vx = 0; b.vy = 0;
            g.balls.push(b);
        }
        g.paddleTarget = g.paddleX;
    }

    // C# LaunchBalls()
    function launchBalls() {
        var any = false;
        for (var i = 0; i < g.balls.length; i++) {
            var b = g.balls[i];
            if (!b.stuck) continue;
            any = true;
            b.stuck = false;
            var ang = -70 + Math.random() * 40 + (g.balls.length > 1 ? (i - g.balls.length / 2) * 12 : 0);
            ang = M.clamp(ang, -140, -40);
            var rad = ang * Math.PI / 180;
            var sp = targetSpeed();
            b.vx = Math.cos(rad) * sp;
            b.vy = Math.sin(rad) * sp;
            if (b.vy > -60) b.vy = -sp * 0.8;
        }
        if (any) Sfx.play('paddle');
    }

    // ===================== 主更新 =====================
    // C# Update(float dt)
    function update(dt) {
        g.gameTime += dt;
        g.shake = Math.max(0, g.shake - dt * 42);
        g.flashWhite = Math.max(0, g.flashWhite - dt * 3.2);
        g.hintT = Math.max(0, g.hintT - dt);
        g.bannerT = Math.max(0, g.bannerT - dt);
        g.toastT = Math.max(0, g.toastT - dt);
        g.displayScore += (g.score - g.displayScore) * Math.min(1, dt * 9);
        if (Math.abs(g.displayScore - g.score) < 0.6) g.displayScore = g.score;

        // 暂停道具面板开关状态（供 draw.js 判定）
        g.pitOpen = !!(NB.PauseItems && NB.PauseItems.st && NB.PauseItems.st.open);

        if (g.state === State.Play) updatePlay(dt);
        else if (g.state === State.Upgrade) g.upgradeAnim = Math.min(1, g.upgradeAnim + dt * 5);
        else updateParticles(dt);

        updateReplayLifecycle();
    }

    // C# UpdatePlay(float dt)
    function updatePlay(dt) {
        // 游玩时长 → 热度：每满 1 分钟热度 +2
        g.runTime += dt;
        var mins = Math.floor(g.runTime / 60);
        if (mins > g.heatMinutes) {
            g.heatMinutes = mins;
            Economy.addHeat(2);
        }
        if (g.kitNoticeT > 0) g.kitNoticeT -= dt;

        // 挡板
        g.paddlePrevX = g.paddleX;
        var halfW = paddleW() * 0.5;
        if (g.touchActive) {
            g.paddleTarget = g.touchPaddleX;
        } else if (g.dragging || g.mouseInside) {
            g.paddleTarget = g.mousePos.x;
        }
        g.mousePos.y = G.PaddleY;
        g.paddleTarget = M.clamp(g.paddleTarget, halfW, G.W - halfW);
        var prev = g.paddleX;
        g.paddleX = M.lerp(g.paddleX, g.paddleTarget, Math.min(1, dt * 16));
        g.paddleX = M.clamp(g.paddleX, halfW, G.W - halfW);
        var pvx = (g.paddleX - prev) / Math.max(dt, 0.0001);

        // 计时器
        if (g.laserT > 0) g.laserT = Math.max(0, g.laserT - dt);
        if (g.slowT > 0) g.slowT = Math.max(0, g.slowT - dt);
        if (g.wideT > 0) g.wideT = Math.max(0, g.wideT - dt);
        if (g.comboT > 0) { g.comboT -= dt; if (g.comboT <= 0) g.combo = 0; }
        if (g.freezeT > 0) g.freezeT = Math.max(0, g.freezeT - dt);
        if (g.bigT > 0) {
            g.bigT = Math.max(0, g.bigT - dt);
            if (g.bigT <= 0) for (var i = 0; i < g.balls.length; i++) g.balls[i].r = g.stats.ballRadius;
        }
        if (g.rushT > 0) {
            g.rushT = Math.max(0, g.rushT - dt);
            if (g.rushT <= 0) for (var j = 0; j < g.balls.length; j++) g.balls[j].scaleSpeed(1 / 1.3);
        }

        // 砖块移动
        for (var k = 0; k < g.bricks.length; k++) {
            var b = g.bricks[k];
            if (b.spawn < 1) b.spawn = Math.min(1, b.spawn + dt * 3.2);
            if (b.flash > 0) b.flash = Math.max(0, b.flash - dt * 4.5);
            if (b.type === BrickType.Moving && !b.dead && g.freezeT <= 0) {
                var cx = b.baseX + Math.sin(g.gameTime * b.speed + b.phase) * b.amp;
                b.x = M.clamp(cx, 6, G.W - b.w - 6);
            }
        }
        g.shiftAnim = Math.max(0, g.shiftAnim - dt * 4);

        // 激光
        g.laserCd -= dt;
        var hasLaser = g.stats.laserLevel > 0 || g.laserT > 0;
        if (hasLaser && g.laserCd <= 0) {
            g.laserCd = 0.95 - Math.min(0.45, g.stats.laserLevel * 0.09);
            var lx1 = g.paddleX - paddleW() * 0.42;
            var lx2 = g.paddleX + paddleW() * 0.42;
            var l1 = new Laser(); l1.x = lx1; l1.life = 0.16; g.lasers.push(l1);
            var l2 = new Laser(); l2.x = lx2; l2.life = 0.16; g.lasers.push(l2);
            var dmg = 1 + Math.floor(g.stats.laserLevel / 2) + (g.laserT > 0 ? 1 : 0);
            fireLaser(lx1, dmg);
            fireLaser(lx2, dmg);
            Sfx.play('laser');
        }
        for (var m = g.lasers.length - 1; m >= 0; m--) {
            g.lasers[m].life -= dt;
            if (g.lasers[m].life <= 0) g.lasers.splice(m, 1);
        }

        updateBalls(dt, pvx);
        updateDrops(dt);
        updateParticles(dt);

        // 无尽下压
        if (g.endlessMode && g.freezeT <= 0) {
            if (g.shiftCd > 0) g.shiftCd = Math.max(0, g.shiftCd - dt);
            g.waveT -= dt;
            if (g.waveT <= 0 && g.shiftCd <= 0) {
                g.wave++;
                g.waveT = nextWaveInterval();
                g.shiftCd = 2.5;   // 硬性冷却
                shiftRowsDown();
                spawnEndlessRow(G.GridTop - G.rowH);
                g.shiftAnim = 1;
                g.shake = Math.max(g.shake, 5);

                var wr = Economy.waveReward(g.wave, Math.random);
                Profile.points += wr.pt;
                Economy.addHeat(3);
                Profile.save();
                showToast('第 ' + (g.wave + 1) + ' 波  +' + wr.pt + ' 积分' + (wr.lucky ? ' · 幸运' : ''), G.NeonPurple);

                if (!hasTnt()) spawnTntBlock();
            }

            if (g.tntRespawnT > 0) {
                g.tntRespawnT -= dt;
                if (g.tntRespawnT <= 0 && !hasTnt()) spawnTntBlock();
            }
            // 砖块越界判负（固定砖与 TNT 不计入）
            for (var n = 0; n < g.bricks.length; n++) {
                var bb = g.bricks[n];
                if (bb.dead || bb.fixed || bb.type === BrickType.Nova) continue;
                if (bb.y + bb.h > G.PaddleY - 34) { gameOver(); return; }
            }
        }

        // 过关判定
        if (!g.endlessMode) {
            var breakable = 0;
            for (var q = 0; q < g.bricks.length; q++)
                if (!g.bricks[q].dead && g.bricks[q].type !== BrickType.Unbreak) breakable++;
            if (breakable === 0) levelClear();
        }
    }

    // C# PushEndlessRows(int count)：右键手动刷砖
    function pushEndlessRows(count) {
        if (!g.endlessMode || g.freezeT > 0) return;
        for (var i = 0; i < count; i++) {
            shiftRowsDown();
            spawnEndlessRow(G.GridTop - G.rowH);
        }
        g.shiftAnim = 1;
        g.shake = Math.max(g.shake, 5);
        g.shiftCd = Math.max(g.shiftCd, 1.2);
        g.waveT = Math.max(g.waveT, 3);
    }

    function shiftRowsDown() {
        for (var i = 0; i < g.bricks.length; i++) {
            var b = g.bricks[i];
            if (b.dead) continue;
            if (b.fixed || b.type === BrickType.Nova) continue;
            b.y += G.rowH;
        }
    }

    // C# NextWaveInterval()
    function nextWaveInterval() {
        var alive = 0;
        for (var i = 0; i < g.bricks.length; i++) {
            var b = g.bricks[i];
            if (b.dead || b.fixed || b.type === BrickType.Nova) continue;
            alive++;
        }
        var iv = Math.max(8, 19 - g.wave * 0.55);
        if (alive <= 5) iv += 9;
        else if (alive <= 10) iv += 5;
        else if (alive <= 16) iv += 2;
        return M.clamp(iv, 7, 26);
    }

    // C# FireLaser(float x, int dmg)
    function fireLaser(x, dmg) {
        var top = G.PaddleY + 6;
        for (var i = 0; i < g.bricks.length; i++) {
            var b = g.bricks[i];
            if (b.dead) continue;
            if (x >= b.x && x <= b.x + b.w && b.y < top) {
                var c = b.center;
                damageBrick(b, dmg, c.x, c.y, true);
                addParticles(c.x, c.y, b.tint, 5, 130);
                break; // 只打最靠下的一块
            }
        }
    }

    // C# UpdateBalls(float dt, float pvx)
    function updateBalls(dt, pvx) {
        var speedTarget = targetSpeed();
        var halfW = paddleW() * 0.5;

        for (var i = g.balls.length - 1; i >= 0; i--) {
            var ball = g.balls[i];
            ball.glowPhase += dt * 4;
            if (ball.pierceCd > 0) ball.pierceCd -= dt;

            if (ball.stuck) {
                ball.x = g.paddleX + ball.stickOffset;
                ball.y = G.PaddleY - ball.r - 8;
                continue;
            }

            // 分步移动，避免高速穿砖
            var dist = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy) * dt;
            var steps = Math.max(1, Math.min(6, Math.floor(dist / 7) + 1));
            var sdt = dt / steps;
            var removed = false;
            for (var s = 0; s < steps; s++) {
                ball.x += ball.vx * sdt;
                ball.y += ball.vy * sdt;

                // 左右墙
                if (ball.x - ball.r < 6) {
                    ball.x = 6 + ball.r; ball.vx = Math.abs(ball.vx);
                    Sfx.play('wall'); addParticles(ball.x - ball.r, ball.y, G.NeonBlue, 4, 90);
                } else if (ball.x + ball.r > G.W - 6) {
                    ball.x = G.W - 6 - ball.r; ball.vx = -Math.abs(ball.vx);
                    Sfx.play('wall'); addParticles(ball.x + ball.r, ball.y, G.NeonBlue, 4, 90);
                }
                // 顶部
                if (ball.y - ball.r < 6) {
                    ball.y = 6 + ball.r; ball.vy = Math.abs(ball.vy);
                    Sfx.play('wall'); addParticles(ball.x, ball.y - ball.r, G.NeonBlue, 4, 90);
                }

                collideBricks(ball, speedTarget);

                // 挡板
                if (ball.vy > 0 && ball.y + ball.r >= G.PaddleY && ball.y + ball.r <= G.PaddleY + G.PaddleH + 14
                    && ball.x >= g.paddleX - halfW - ball.r * 0.6 && ball.x <= g.paddleX + halfW + ball.r * 0.6) {
                    var rel = M.clamp((ball.x - g.paddleX) / halfW, -1, 1);
                    var ang = rel * 62;
                    ang += M.clamp(pvx / 2600, -14, 14);
                    if (g.stats.magnet > 0) ang *= (1 - g.stats.magnet);
                    var rad = (ang - 90) * Math.PI / 180;
                    ball.vx = Math.cos(rad) * speedTarget;
                    ball.vy = Math.sin(rad) * speedTarget;
                    if (ball.vy > -120) ball.vy = -speedTarget * 0.7;
                    ball.y = G.PaddleY - ball.r - 0.5;
                    Sfx.play('paddle');
                    addParticles(ball.x, G.PaddleY, G.NeonCyan, 7, 150);
                    if (g.stats.sticky) { ball.stuck = true; ball.stickOffset = ball.x - g.paddleX; ball.vx = 0; ball.vy = 0; }
                }

                // 底部
                if (ball.y - ball.r > G.H + 10) {
                    g.balls.splice(i, 1);
                    removed = true;
                    break;
                }
            }

            if (!removed && i < g.balls.length && g.balls[i] === ball && !ball.stuck) ball.pushTrail();

            // 速度归一
            if (!ball.stuck) {
                var cur = ball.speed;
                if (cur > 1 && Math.abs(cur - speedTarget) > 6) {
                    var k = speedTarget / cur;
                    ball.vx *= k; ball.vy *= k;
                }
            }
        }

        if (g.balls.length === 0) loseLife();
    }

    // C# CollideBricks(Ball ball, float speedTarget)
    function collideBricks(ball, speedTarget) {
        for (var i = 0; i < g.bricks.length; i++) {
            var b = g.bricks[i];
            if (b.dead || b.spawn < 0.35) continue;

            var nx = M.clamp(ball.x, b.x, b.x + b.w);
            var ny = M.clamp(ball.y, b.y, b.y + b.h);
            var dx = ball.x - nx, dy = ball.y - ny;
            if (dx * dx + dy * dy > ball.r * ball.r) continue;

            // 判定反弹轴
            var bcx = b.x + b.w * 0.5, bcy = b.y + b.h * 0.5;
            var rdx = (ball.x - bcx) / (b.w * 0.5 + ball.r);
            var rdy = (ball.y - bcy) / (b.h * 0.5 + ball.r);

            var pierce = g.stats.pierceLevel > 0 && ball.pierceCd <= 0 && b.type !== BrickType.Unbreak;
            var crit = M.randInt(100) < g.stats.critChance;
            var dmg = g.stats.damage * (crit ? 2 : 1);

            damageBrick(b, dmg, ball.x, ball.y, false);
            if (g.stats.bombBall && ball.pierceCd <= 0) {
                explodeAt(ball.x, ball.y, 74, Math.max(1, g.stats.damage - 1), true);
                ball.pierceCd = Math.max(0.22, 0.6 - g.stats.pierceLevel * 0.1);
            }

            if (pierce) {
                ball.pierceCd = Math.max(0.18, 0.55 - g.stats.pierceLevel * 0.1);
                addParticles(ball.x, ball.y, G.NeonBlue, 4, 120);
                continue;
            }

            if (b.type === BrickType.Unbreak) {
                Sfx.play('brick2');
                addParticles((nx + ball.x) * 0.5, (ny + ball.y) * 0.5, Color.fromArgb(160, 170, 200), 5, 120);
            }

            if (Math.abs(rdx) > Math.abs(rdy)) {
                ball.vx = Math.abs(ball.vx) * (rdx > 0 ? 1 : -1);
                ball.x = rdx > 0 ? b.x + b.w + ball.r + 0.5 : b.x - ball.r - 0.5;
            } else {
                ball.vy = Math.abs(ball.vy) * (rdy > 0 ? 1 : -1);
                ball.y = rdy > 0 ? b.y + b.h + ball.r + 0.5 : b.y - ball.r - 0.5;
            }
            // 防止水平锁死
            if (Math.abs(ball.vy) < speedTarget * 0.18) {
                ball.vy = (ball.vy >= 0 ? 1 : -1) * speedTarget * 0.22;
                var r = Math.sqrt(Math.max(1, ball.vx * ball.vx + ball.vy * ball.vy));
                ball.vx *= speedTarget / r; ball.vy *= speedTarget / r;
            }
            break;
        }
    }

    // ===================== 伤害与破坏 =====================
    // C# DamageBrick(Brick b, int dmg, float hx, float hy, bool silent)
    function damageBrick(b, dmg, hx, hy, silent) {
        if (b.dead) return;
        if (b.type === BrickType.Unbreak) {
            b.flash = 0.6;
            return;
        }
        b.hp -= dmg;
        b.flash = 1;
        if (!silent) Sfx.play(b.hp > 0 ? 'brick2' : 'brick');
        addParticles(hx, hy, b.tint, 5, 150);

        if (b.hp <= 0) {
            b.dead = true;
            g.bricksCleared++;
            g.combo++;
            g.comboT = 2.6;
            if (g.combo > g.bestCombo) g.bestCombo = g.combo;
            if (g.combo > 0 && g.combo % 8 === 0) comboBonus();
            var mult = 1 + Math.min(2.0, g.combo * (0.04 + Meta.permLv('combo') * 0.04));
            g.score += Math.floor((b.scoreVal + g.stats.coinBonus) * mult);
            addParticles(b.x + b.w * 0.5, b.y + b.h * 0.5, b.tint, 14, 260);
            g.shake = Math.max(g.shake, 3.2);

            if (b.type === BrickType.Bomb) {
                Sfx.play('bomb');
                explodeAt(b.x + b.w * 0.5, b.y + b.h * 0.5, 118, 3, true);
                g.flashWhite = Math.max(g.flashWhite, 0.32);
                g.shake = Math.max(g.shake, 8);
            } else if (b.type === BrickType.Nova) {
                novaBlast(b.x + b.w * 0.5, b.y + b.h * 0.5, true);
                return;
            }

            var dropChance = 0.26 + g.stats.dropBonus + (g.endlessMode ? 0.04 : 0);
            if (b.ensureDrop || Math.random() < dropChance) spawnDrop(b.x + b.w * 0.5, b.y + b.h * 0.5);
        }
    }

    // TNT 爆破：整屏砖块清空
    function novaBlast(x, y, tntHit) {
        var n = clearAllBricks(true);
        Sfx.play('bomb');
        g.flashWhite = 1;
        g.shake = Math.max(g.shake, 20);
        for (var i = 0; i < 90; i++) {
            var a = Math.random() * Math.PI * 2;
            var sp = 120 + Math.random() * 620;
            var p = new NB.Particle();
            p.x = x; p.y = y;
            p.vx = Math.cos(a) * sp;
            p.vy = Math.sin(a) * sp;
            p.maxLife = 0.6 + Math.random() * 0.7;
            p.life = p.maxLife;
            p.size = 2.5 + Math.random() * 6;
            p.c = i % 4 === 0 ? '#ffffff' : (i % 4 === 1 ? G.NeonYellow : G.NeonOrange);
            g.parts.push(p);
        }
        // 无尽模式：TNT 本砖引爆额外给 100 分
        if (tntHit && g.endlessMode) {
            g.score += 100;
            Profile.save();
            g.tntRespawnT = 3;
            showToast('TNT 爆破 · 全屏清空 ' + n + ' 块  +100 分', G.NeonYellow);
        } else {
            showToast('TNT 爆破 · 全屏清空 ' + n + ' 块', G.NeonYellow);
        }
    }

    // C# int ClearAllBricks(bool countScore)
    function clearAllBricks(countScore) {
        var n = 0;
        var dropBudget = 8;   // 单次爆破最多掉 8 个道具
        for (var i = 0; i < g.bricks.length; i++) {
            var b = g.bricks[i];
            if (b.dead || b.type === BrickType.Unbreak) continue;
            b.dead = true;
            g.bricksCleared++;
            n++;
            if (countScore) {
                var mult = 1 + Math.min(2.0, g.combo * (0.04 + Meta.permLv('combo') * 0.04));
                g.score += Math.floor((b.scoreVal + g.stats.coinBonus) * mult);
                var c = b.center;
                addParticles(c.x, c.y, b.tint, 6, 200);
            }
            if (dropBudget > 0) {
                var dropChance = 0.26 + g.stats.dropBonus + (g.endlessMode ? 0.04 : 0);
                if (b.ensureDrop || Math.random() < dropChance) {
                    var cc = b.center;
                    spawnDrop(cc.x, cc.y);
                    dropBudget--;
                }
            }
        }
        if (countScore && n > 0) {
            g.combo++;
            g.comboT = 2.6;
            if (g.combo > g.bestCombo) g.bestCombo = g.combo;
        }
        return n;
    }

    // C# ExplodeAt(float x, float y, float radius, int dmg, bool chain)
    function explodeAt(x, y, radius, dmg, chain) {
        for (var i = 0; i < g.bricks.length; i++) {
            var b = g.bricks[i];
            if (b.dead) continue;
            var c = b.center;
            var dx = c.x - x, dy = c.y - y;
            if (dx * dx + dy * dy <= radius * radius) damageBrick(b, dmg, c.x, c.y, true);
        }
        for (var k = 0; k < 26; k++) {
            var a = Math.random() * Math.PI * 2;
            var sp = 90 + Math.random() * 320;
            var p = new NB.Particle();
            p.x = x; p.y = y;
            p.vx = Math.cos(a) * sp;
            p.vy = Math.sin(a) * sp;
            p.maxLife = 0.5 + Math.random() * 0.4;
            p.life = p.maxLife;
            p.size = 2 + Math.random() * 4;
            p.c = k % 3 === 0 ? '#ffffff' : G.NeonOrange;
            g.parts.push(p);
        }
    }

    // C# SpawnDrop(float x, float y)：11 种掉落概率分布
    function spawnDrop(x, y) {
        var d = new NB.Drop();
        d.x = x; d.y = y;
        var r = Math.random();
        if (r < 0.19) d.kind = DropKind.Multi;
        else if (r < 0.34) d.kind = DropKind.Wide;
        else if (r < 0.47) d.kind = DropKind.Laser;
        else if (r < 0.58) d.kind = DropKind.Slow;
        else if (r < 0.68) d.kind = DropKind.Shield;
        else if (r < 0.78) d.kind = DropKind.Coin;
        else if (r < 0.83) d.kind = DropKind.Life;
        else if (r < 0.88) d.kind = DropKind.Bomb;
        else if (r < 0.93) d.kind = DropKind.Freeze;
        else if (r < 0.97) d.kind = DropKind.BigBall;
        else d.kind = DropKind.Rush;
        g.drops.push(d);
    }

    function updateDrops(dt) {
        var halfW = paddleW() * 0.5;
        for (var i = g.drops.length - 1; i >= 0; i--) {
            var d = g.drops[i];
            d.y += d.vy * dt;
            d.phase += dt * 5;
            if (d.y > G.H + 30) { g.drops.splice(i, 1); continue; }
            if (d.y + 14 >= G.PaddleY && d.y - 14 <= G.PaddleY + G.PaddleH
                && d.x >= g.paddleX - halfW - 10 && d.x <= g.paddleX + halfW + 10) {
                applyDrop(d);
                g.drops.splice(i, 1);
            }
        }
    }

    // C# ApplyDrop(Drop d)：11 种道具效果与持续时间
    function applyDrop(d) {
        Sfx.play('drop');
        addParticles(d.x, d.y, NB.Drop.colorOf(d.kind), 16, 220);
        switch (d.kind) {
            case DropKind.Multi: {
                var add = [];
                for (var i = 0; i < g.balls.length && g.balls.length + add.length < 9; i++) {
                    var src = g.balls[i];
                    if (src.stuck) continue;
                    for (var k = -1; k <= 1; k += 2) {
                        var nb = new NB.Ball();
                        nb.x = src.x; nb.y = src.y; nb.r = src.r;
                        var ang = Math.atan2(src.vy, src.vx) + k * 0.42;
                        nb.vx = Math.cos(ang) * src.speed;
                        nb.vy = Math.sin(ang) * src.speed;
                        add.push(nb);
                    }
                }
                for (var a2 = 0; a2 < add.length; a2++) g.balls.push(add[a2]);
                showToast('三球分裂', G.NeonYellow);
                break;
            }
            case DropKind.Wide:
                g.wideT = Math.min(26, g.wideT + 16);
                showToast('挡板扩张', G.NeonGreen);
                break;
            case DropKind.Laser:
                g.laserT = Math.min(26, g.laserT + 16);
                showToast('激光炮台', G.NeonPink);
                break;
            case DropKind.Slow:
                g.slowT = Math.min(22, g.slowT + 13);
                showToast('时间缓速', G.NeonBlue);
                break;
            case DropKind.Shield:
                g.stats.shieldCharges = Math.min(4, g.stats.shieldCharges + 1);
                showToast('护盾 +1', G.NeonPurple);
                break;
            case DropKind.Life:
                g.lives = Math.min(9, g.lives + 1);
                showToast('生命 +1', Color.fromArgb(255, 120, 160));
                break;
            case DropKind.Coin: {
                g.score += 100;
                var gain = Economy.coinDropPoints();
                Profile.points += gain;
                Profile.save();
                showToast('+' + gain + ' 积分', G.NeonOrange);
                break;
            }
            case DropKind.Bomb:
                explodeAt(d.x, d.y, 132, 2, true);
                g.score += 160;
                g.flashWhite = Math.max(g.flashWhite, 0.26);
                g.shake = Math.max(g.shake, 7);
                Sfx.play('bomb');
                showToast('爆破冲击', NB.Drop.colorOf(DropKind.Bomb));
                break;
            case DropKind.Freeze:
                g.freezeT = Math.max(g.freezeT, 8);
                showToast('时间冻结 8 秒', NB.Drop.colorOf(DropKind.Freeze));
                break;
            case DropKind.BigBall:
                if (g.bigT <= 0) for (var b1 = 0; b1 < g.balls.length; b1++) g.balls[b1].r *= 1.45;
                g.bigT = Math.max(g.bigT, 12);
                showToast('巨型球 12 秒', NB.Drop.colorOf(DropKind.BigBall));
                break;
            case DropKind.Rush:
                if (g.rushT <= 0) for (var b2 = 0; b2 < g.balls.length; b2++) g.balls[b2].scaleSpeed(1.3);
                g.rushT = Math.max(g.rushT, 12);
                showToast('超速冲刺 12 秒', NB.Drop.colorOf(DropKind.Rush));
                break;
            default:
                g.score += 260;
                break;
        }
    }

    // 连击里程碑奖励
    function comboBonus() {
        var r = Math.random() * (1.0 + Profile.heatLevel * 0.06);
        if (r < 0.42) {
            var c = 20 + M.randRange(0, 481);
            Profile.coins += c;
            Profile.save();
            showToast('连击奖励 +' + c + ' 砖块币', G.NeonOrange);
        } else {
            var p = 100 + M.randRange(0, 4901);
            Profile.points += p;
            Profile.save();
            showToast('连击奖励 +' + p + ' 积分', G.NeonYellow);
        }
    }

    function addParticles(x, y, c, count, speed) {
        if (!Meta.particleOn) return;
        if (Meta.quality <= 0) count = Math.max(1, Math.floor(count / 2));
        if (g.parts.length > 900) return;
        for (var i = 0; i < count; i++) {
            var a = Math.random() * Math.PI * 2;
            var sp = speed * (0.25 + Math.random());
            var p = new NB.Particle();
            p.x = x; p.y = y;
            p.vx = Math.cos(a) * sp;
            p.vy = Math.sin(a) * sp;
            p.maxLife = 0.28 + Math.random() * 0.5;
            p.life = p.maxLife;
            p.size = 1.6 + Math.random() * 3.4;
            p.c = M.randInt(5) === 0 ? '#ffffff' : c;
            p.square = M.randInt(3) === 0;
            g.parts.push(p);
        }
    }

    function updateParticles(dt) {
        for (var i = g.parts.length - 1; i >= 0; i--) {
            var p = g.parts[i];
            p.life -= dt;
            if (p.life <= 0) { g.parts.splice(i, 1); continue; }
            var d = 1 - p.drag * dt;
            if (d < 0) d = 0;
            p.vx *= d; p.vy *= d;
            p.vy += 120 * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
        }
        if (g.parts.length > 1200) g.parts.splice(0, g.parts.length - 1200);
    }

    // C# LoseLife()
    function loseLife() {
        if (g.stats.shieldCharges > 0) {
            g.stats.shieldCharges--;
            Sfx.play('shield');
            g.shake = Math.max(g.shake, 10);
            g.flashWhite = Math.max(g.flashWhite, 0.22);
            spawnBall();
            showToast('护盾抵挡！', G.NeonPurple);
            return;
        }
        g.lives--;
        Sfx.play('lose');
        g.shake = Math.max(g.shake, 12);
        g.combo = 0;
        if (g.lives <= 0) { gameOver(); return; }
        spawnBall();
        showToast('剩余生命 ' + g.lives, G.NeonPink);
        if (g.endlessMode) { g.waveT = Math.max(g.waveT, 6); g.shiftCd = Math.max(g.shiftCd, 3); }
    }

    // C# LevelClear()
    function levelClear() {
        Sfx.play('win');
        g.flashWhite = Math.max(g.flashWhite, 0.25);
        g.score += 300;

        var rew = Economy.levelReward(g.levelIndex, Math.random);
        g.lastReward = rew.pt;
        g.lastRewardLucky = rew.lucky;
        Profile.points += g.lastReward;
        Economy.addHeat(8);
        Profile.save();

        for (var i = 0; i < 40; i++) {
            addParticles(M.rand(80, G.W - 80), M.rand(120, 500), i % 2 === 0 ? G.NeonCyan : G.NeonPurple, 2, 120);
        }
        if (g.levelIndex + 1 > Profile.bestCampaign) {
            Profile.bestCampaign = g.levelIndex + 1;
            Profile.save();
        }
        if (g.levelIndex >= Levels.count - 1) { winGame(); return; }
        showUpgrade();
    }

    // C# ShowUpgrade()
    function showUpgrade() {
        g.offers = UpgradePool.pick(3, g.stats, Math.random);
        g.upgradeAnim = 0;
        g.upgradePick = -1;
        g.state = State.Upgrade;
        Sfx.play('upgrade');
    }

    // C# NextLevel()
    function nextLevel() {
        g.levelIndex++;
        if (g.levelIndex >= Levels.count) { winGame(); return; }
        loadLevel(g.levelIndex);
        spawnBall();
        g.state = State.Play;
        g.hintT = 4;
        g.banner = '第 ' + (g.levelIndex + 1) + ' 关  ' + g.levelName;
        g.bannerColor = G.NeonCyan;
        g.bannerT = 1.8;
    }

    // C# GameOver()
    function gameOver() {
        Sfx.play('lose');
        g.state = State.GameOver;
        if (g.endlessMode) {
            if (g.score > Profile.bestEndless) { Profile.bestEndless = g.score; g.newRecord = true; }
            if (g.wave + 1 > Profile.bestEndlessWave) Profile.bestEndlessWave = g.wave + 1;
        }
        settleRun();
        g.shake = Math.max(g.shake, 14);
    }

    // C# WinGame()
    function winGame() {
        Profile.points += 300;
        Economy.addHeat(20);
        settleRun();
        g.state = State.Win;
    }

    // C# SettleRun()：本局 score 差值 gain 累加 TotalScore，并按比例转 Points
    function settleRun() {
        var gain = g.score - g.settledBaseScore;
        if (gain < 0) gain = 0;
        if (g.settledThisRun && gain === 0) return;

        var firstSettle = !g.settledThisRun;
        g.settledThisRun = true;
        g.settledBaseScore = g.score;

        g.lastSettlePoints = Economy.settlePoints(gain);
        Profile.points += g.lastSettlePoints;
        Profile.totalScore += gain;
        if (firstSettle) Profile.playCount++;
        Economy.addHeat(5 + Math.min(20, g.runTime / 60 * 2));
        Profile.save();
    }

    // C# UseReviveCard()
    function useReviveCard() {
        if (Profile.reviveCards <= 0) return;
        Profile.reviveCards--;
        Economy.revivePenalty();
        Profile.save();

        g.lives = 2;
        g.combo = 0;
        g.comboT = 0;
        g.settledThisRun = true;   // 本局已结算，复活后不再重复结算

        for (var i = 0; i < g.bricks.length; i++) {
            var b = g.bricks[i];
            if (b.dead) continue;
            if (b.y + b.h > G.PaddleY - 150) b.dead = true;
        }
        g.drops.length = 0;
        g.lasers.length = 0;
        g.parts.length = 0;
        spawnBall();
        g.state = State.Play;
        g.flashWhite = Math.max(g.flashWhite, 0.3);
        g.shake = Math.max(g.shake, 8);
        g.banner = '复 活';
        g.bannerColor = G.NeonGreen;
        g.bannerT = 1.4;
        Sfx.play('upgrade');
        showToast('复活成功 · 热度 -20%（剩余复活卡 ' + Profile.reviveCards + '）', G.NeonGreen);
    }

    // C# UseLifeCard()
    function useLifeCard() {
        if (Profile.lifeCards <= 0) {
            Sfx.play('lose');
            showToast('没有生命 +1 卡 · 去商店购买', G.NeonPink);
            return;
        }
        Profile.lifeCards--;
        g.lives = Math.min(9, g.lives + 1);
        Profile.save();
        Sfx.play('drop');
        showToast('生命 +1 · 当前 ' + g.lives + ' 条（剩余卡 ' + Profile.lifeCards + '）', Color.fromArgb(255, 120, 160));
    }

    function showToast(text, c) {
        g.toast = text;
        g.toastColor = c;
        g.toastT = 1.5;
    }

    // C# ChooseUpgrade(int idx)
    function chooseUpgrade(idx) {
        if (idx < 0 || idx >= g.offers.length) return;
        var u = g.offers[idx];
        u.apply(g.stats);
        if (u.extraLife > 0) g.lives = Math.min(9, g.lives + u.extraLife);
        Sfx.play('upgrade');
        g.flashWhite = Math.max(g.flashWhite, 0.18);
        showToast('已获得：' + u.name, u.tint);
        g.upgradePick = idx;
        nextLevel();
        for (var i = 0; i < g.balls.length; i++) g.balls[i].r = g.stats.ballRadius;
    }

    // ===================== 输入：桌面（鼠标语义，同 C#） =====================
    function hit(r, p) {
        return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    }

    function onMouseMove(e) {
        var p = toLogical(e.clientX, e.clientY);
        g.mousePos.x = p.x;
        g.mousePos.y = p.y;
        g.mouseInside = true;
        // 对局中 Y 轴与挡板同高
        if (g.state === State.Play) g.mousePos.y = G.PaddleY;
    }

    // C# OnMouseDown
    function onMouseDown(e) {
        var p = toLogical(e.clientX, e.clientY);
        g.mousePos.x = p.x; g.mousePos.y = p.y;
        Sfx.play('click');

        if (g.state === State.Play) {
            // 右键：无尽模式瞬间刷出 2 排
            if (e.button === 2) {
                if (g.endlessMode) pushEndlessRows(2);
                return;
            }
            launchBalls();
            g.dragging = true;
            return;
        }
        var DS = NB.DrawScene;
        if (g.state === State.Menu) {
            if (hit(DS.RMenuCampaign, p)) { startGame(false, Math.min(Profile.bestCampaign, Levels.count - 1)); return; }
            if (hit(DS.RMenuEndless, p)) { startGame(true, 0); return; }
            if (hit(DS.RMenuShop, p)) { g.state = State.Shop; g.shopTab = 0; NB.Shop.openShop(g, 0); return; }
            if (hit(DS.RMenuUpgrade, p)) { g.state = State.Shop; g.shopTab = 1; NB.Shop.openShop(g, 1); return; }
            if (hit(DS.RMenuSet, p)) { g.state = State.Shop; g.shopTab = 2; NB.Shop.openShop(g, 2); return; }
            if (hit(DS.RMenuHelp, p)) { g.state = State.Help; return; }
            if (hit(DS.RMenuQuit, p)) { quitToBlank(); return; }
            return;
        }
        if (g.state === State.Shop) {
            var ret = NB.Shop.handleShopClick(g, p);
            if (ret === 'menu') g.state = State.Menu;
            return;
        }
        if (g.state === State.Pause) {
            if (NB.PauseItems.st.open) { NB.PauseItems.handlePauseItemsClick(g, p); return; }
            if (hit(DS.RPauseResume, p)) { g.state = State.Play; return; }
            if (hit(DS.RPauseItems, p)) { NB.PauseItems.openPauseItems(g); return; }
            if (hit(DS.RPauseRestart, p)) { startGame(g.endlessMode, g.levelIndex); return; }
            if (hit(DS.RPauseMenu, p)) { g.state = State.Menu; return; }
            return;
        }
        if (g.state === State.Upgrade) {
            for (var i = 0; i < g.offers.length; i++) {
                if (hit(DS.cardRect(i), p)) { chooseUpgrade(i); return; }
            }
            return;
        }
        if (g.state === State.GameOver || g.state === State.Win) {
            if (g.state === State.GameOver && Profile.reviveCards > 0 && hit(DS.REndRevive, p)) { useReviveCard(); return; }
            if (hit(DS.REndRetry, p)) { startGame(g.endlessMode, g.endlessMode ? 0 : g.levelIndex); return; }
            if (hit(DS.REndMenu, p)) { g.state = State.Menu; return; }
            if (g.state === State.Win && hit(DS.REndNext, p)) { startGame(false, 0); return; }
            return;
        }
        if (g.state === State.Help) {
            if (hit(DS.RHelpBack, p)) { g.state = State.Menu; return; }
            return;
        }
    }

    // 浏览器无 Close()：退回主菜单（不关闭页面）
    function quitToBlank() {
        g.state = State.Menu;
        Sfx.play('click');
    }

    // C# OnKeyDown
    function onKeyDown(e) {
        var key = e.key;
        // 自定义数量输入框打开时优先接收数字
        var shopSt = NB.Shop.st || NB.Shop.S || null;
        if (shopSt && shopSt.qtyOpen) {
            NB.Shop.qtyKey(g, e);
            e.preventDefault();
            return;
        }
        if (key === 'Escape' || key === 'Esc') {
            if (NB.PauseItems.st.open) { NB.PauseItems.closePauseItems(g); e.preventDefault(); return; }
            if (g.state === State.Play) { g.state = State.Pause; g.dragging = false; e.preventDefault(); return; }
            if (g.state === State.Pause) { g.state = State.Play; e.preventDefault(); return; }
            if (g.state === State.Shop) { g.state = State.Menu; e.preventDefault(); return; }
        }
    }

    // C# OnMouseWheel
    function onWheel(e) {
        var delta = -e.deltaY;   // 与 WinForms e.Delta 同向
        var DS = NB.DrawScene;
        if (g.state === State.Help) { DS.helpWheel(delta); return; }
        if (g.state === State.Shop) { NB.Shop.shopWheel(g, delta); return; }
        if (g.state === State.Pause) { NB.PauseItems.pauseItemsWheel(delta); return; }
    }

    // ===================== 输入：移动端（虚拟摇杆 + 圆钮） =====================
    var joy = { baseX: 0, baseY: 0, r: 62, knobR: 26, knobX: 0, knobY: 0, active: false, startPaddle: G.W / 2, id: -1 };
    var btnServe = { x: 0, y: 0, r: 46 };
    var btnPause = { x: 0, y: 0, r: 26 };

    function touchUILayout() {
        var cw = canvas.clientWidth, ch = canvas.clientHeight;
        joy.baseX = 108; joy.baseY = ch - 108;
        joy.knobX = joy.baseX; joy.knobY = joy.baseY;
        btnServe.x = cw - 92; btnServe.y = ch - 150;
        btnPause.x = cw - 42; btnPause.y = 46;
    }

    function inCircle(cx, cy, r, x, y) {
        var dx = x - cx, dy = y - cy;
        return dx * dx + dy * dy <= r * r;
    }

    function onTouchStart(e) {
        if (e.touches.length === 0) return;
        g.mobile = true;
        var t = e.changedTouches[0];
        var r = canvas.getBoundingClientRect();
        var cx = t.clientX - r.left, cy = t.clientY - r.top;

        // 暂停钮
        if (inCircle(btnPause.x, btnPause.y, btnPause.r + 10, cx, cy)) {
            if (g.state === State.Play) { g.state = State.Pause; g.dragging = false; }
            else if (g.state === State.Pause) g.state = State.Play;
            e.preventDefault();
            return;
        }
        // 发球 / 刷砖钮
        if (inCircle(btnServe.x, btnServe.y, btnServe.r + 12, cx, cy)) {
            if (g.state === State.Play) {
                if (g.endlessMode) pushEndlessRows(2);
                else { launchBalls(); g.dragging = true; }
            }
            e.preventDefault();
            return;
        }
        // 摇杆区域
        if (inCircle(joy.baseX, joy.baseY, joy.r + 48, cx, cy)) {
            joy.active = true;
            joy.id = t.identifier;
            joy.startPaddle = g.paddleX;
            joy.knobX = joy.baseX; joy.knobY = joy.baseY;
            g.touchActive = true;
            g.touchPaddleX = g.paddleX;
            e.preventDefault();
            return;
        }
        // 其余区域视为点击：按状态分发（等价鼠标左键）
        handleTap(cx, cy, r);
        e.preventDefault();
    }

    function onTouchMove(e) {
        var t = null;
        for (var i = 0; i < e.touches.length; i++)
            if (e.touches[i].identifier === joy.id) { t = e.touches[i]; break; }
        if (joy.active && t) {
            var r = canvas.getBoundingClientRect();
            var dx = (t.clientX - r.left) - joy.baseX;
            var dy = (t.clientY - r.top) - joy.baseY;
            var len = Math.sqrt(dx * dx + dy * dy);
            var maxL = joy.r;
            if (len > maxL) { dx = dx / len * maxL; dy = dy / len * maxL; }
            joy.knobX = joy.baseX + dx;
            joy.knobY = joy.baseY + dy;
            // 拖动按比例映射挡板水平位移（满幅 = 半个屏幕宽）
            var ratio = dx / joy.r;
            g.touchPaddleX = M.clamp(joy.startPaddle + ratio * (G.W * 0.5), 0, G.W);
        }
        e.preventDefault();
    }

    function onTouchEnd(e) {
        if (joy.active) {
            var still = false;
            for (var i = 0; i < e.touches.length; i++)
                if (e.touches[i].identifier === joy.id) still = true;
            if (!still) {
                joy.active = false;
                joy.id = -1;
                joy.knobX = joy.baseX;
                joy.knobY = joy.baseY;
                g.touchActive = false;   // 松手回中
            }
        }
        g.dragging = false;
        e.preventDefault();
    }

    // 触摸点击：把屏幕坐标反算成逻辑坐标后走同一套命中逻辑
    function handleTap(cx, cy, rect) {
        var p = {
            x: (cx - g.viewOffX) / g.viewScale,
            y: (cy - g.viewOffY) / g.viewScale
        };
        g.mousePos.x = p.x; g.mousePos.y = p.y;
        g.mouseInside = true;
        Sfx.play('click');
        var DS = NB.DrawScene;
        if (g.state === State.Play) {
            launchBalls();
            g.dragging = true;
            return;
        }
        if (g.state === State.Menu) {
            if (hit(DS.RMenuCampaign, p)) return startGame(false, Math.min(Profile.bestCampaign, Levels.count - 1));
            if (hit(DS.RMenuEndless, p)) return startGame(true, 0);
            if (hit(DS.RMenuShop, p)) { g.state = State.Shop; g.shopTab = 0; return NB.Shop.openShop(g, 0); }
            if (hit(DS.RMenuUpgrade, p)) { g.state = State.Shop; g.shopTab = 1; return NB.Shop.openShop(g, 1); }
            if (hit(DS.RMenuSet, p)) { g.state = State.Shop; g.shopTab = 2; return NB.Shop.openShop(g, 2); }
            if (hit(DS.RMenuHelp, p)) { g.state = State.Help; return; }
            if (hit(DS.RMenuQuit, p)) return quitToBlank();
            return;
        }
        if (g.state === State.Shop) {
            var ret = NB.Shop.handleShopClick(g, p);
            if (ret === 'menu') g.state = State.Menu;
            return;
        }
        if (g.state === State.Pause) {
            if (NB.PauseItems.st.open) return NB.PauseItems.handlePauseItemsClick(g, p);
            if (hit(DS.RPauseResume, p)) { g.state = State.Play; return; }
            if (hit(DS.RPauseItems, p)) return NB.PauseItems.openPauseItems(g);
            if (hit(DS.RPauseRestart, p)) return startGame(g.endlessMode, g.levelIndex);
            if (hit(DS.RPauseMenu, p)) { g.state = State.Menu; return; }
            return;
        }
        if (g.state === State.Upgrade) {
            for (var i = 0; i < g.offers.length; i++)
                if (hit(DS.cardRect(i), p)) return chooseUpgrade(i);
            return;
        }
        if (g.state === State.GameOver || g.state === State.Win) {
            if (g.state === State.GameOver && Profile.reviveCards > 0 && hit(DS.REndRevive, p)) return useReviveCard();
            if (hit(DS.REndRetry, p)) return startGame(g.endlessMode, g.endlessMode ? 0 : g.levelIndex);
            if (hit(DS.REndMenu, p)) { g.state = State.Menu; return; }
            if (g.state === State.Win && hit(DS.REndNext, p)) return startGame(false, 0);
            return;
        }
        if (g.state === State.Help) {
            if (hit(DS.RHelpBack, p)) { g.state = State.Menu; return; }
            return;
        }
    }

    function bindInput() {
        // 桌面：精确指针
        canvas.addEventListener('pointermove', function (e) {
            if (e.pointerType === 'touch') return;
            onMouseMove(e);
        });
        canvas.addEventListener('pointerdown', function (e) {
            if (e.pointerType === 'touch') return;
            if (e.button === 2) e.preventDefault();
            onMouseDown(e);
        });
        window.addEventListener('pointerup', function (e) {
            if (e.pointerType === 'touch') return;
            g.dragging = false;
        });
        canvas.addEventListener('pointerleave', function () { g.mouseInside = false; });
        canvas.addEventListener('pointerenter', function () { g.mouseInside = true; });
        canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
        window.addEventListener('wheel', onWheel, { passive: true });
        window.addEventListener('keydown', onKeyDown);

        // 移动：触摸（一律 preventDefault，禁页面滚动/缩放）
        canvas.addEventListener('touchstart', onTouchStart, { passive: false });
        canvas.addEventListener('touchmove', onTouchMove, { passive: false });
        canvas.addEventListener('touchend', onTouchEnd, { passive: false });
        canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });
        document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, { passive: false });
        document.addEventListener('dblclick', function (e) { e.preventDefault(); }, { passive: false });

        // 首次 touch 事件即判定移动端
        window.addEventListener('touchstart', function () { g.mobile = true; touchUILayout(); }, { passive: true });
        if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) g.mobile = true;
    }

    // ===================== 绘制：逻辑层 → 显示层 =====================
    function drawTouchUI() {
        var cw = canvas.clientWidth, ch = canvas.clientHeight;
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        var showPlay = (g.state === State.Play);

        // 摇杆
        if (showPlay) {
            ctx.beginPath();
            ctx.arc(joy.baseX, joy.baseY, joy.r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(12,18,40,0.42)';
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgba(0,229,255,0.55)';
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(joy.knobX, joy.knobY, joy.knobR, 0, Math.PI * 2);
            ctx.fillStyle = joy.active ? 'rgba(0,229,255,0.42)' : 'rgba(0,229,255,0.24)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,229,255,0.9)';
            ctx.stroke();

            NB.Draw.TextCenter(ctx, '移动', NB.Draw.UIFontLight(13), 'rgba(140,190,240,0.85)', joy.baseX, joy.baseY + joy.r + 16);

            // 发球 / 刷砖
            ctx.beginPath();
            ctx.arc(btnServe.x, btnServe.y, btnServe.r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(12,18,40,0.42)';
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgba(255,70,160,0.75)';
            ctx.stroke();
            NB.Draw.TextCenter(ctx, g.endlessMode ? '刷砖' : '发球', NB.Draw.UIFont(15), '#ff5fae', btnServe.x, btnServe.y + 5);
        }

        // 暂停 / 继续
        if (g.state === State.Play || g.state === State.Pause) {
            ctx.beginPath();
            ctx.arc(btnPause.x, btnPause.y, btnPause.r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(12,18,40,0.42)';
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgba(160,110,255,0.8)';
            ctx.stroke();
            if (g.state === State.Play) {
                ctx.fillStyle = '#b48cff';
                ctx.fillRect(btnPause.x - 8, btnPause.y - 10, 5, 20);
                ctx.fillRect(btnPause.x + 3, btnPause.y - 10, 5, 20);
            } else {
                ctx.fillStyle = '#b48cff';
                ctx.beginPath();
                ctx.moveTo(btnPause.x - 6, btnPause.y - 11);
                ctx.lineTo(btnPause.x + 11, btnPause.y);
                ctx.lineTo(btnPause.x - 6, btnPause.y + 11);
                ctx.closePath();
                ctx.fill();
            }
        }
        ctx.restore();
    }

    function render() {
        if (!canvas || !bctx) return;
        // 1) 离屏绘制逻辑画面（1280x800）
        NB.DrawScene.draw(bctx, g);
        // 2) 等比缩放贴到显示画布（居中）
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = Color.rgba(G.BgTop);
        ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(buf, g.viewOffX, g.viewOffY, G.W * g.viewScale, G.H * g.viewScale);
        // 3) 移动端 UI 覆盖层
        if (g.mobile) drawTouchUI();
        // 4) 回放钩子
        replayHook(canvas);
    }

    // 每帧把 canvas 交给 NB.Replay；未加载则静默跳过
    function replayHook(c) {
        if (typeof g.replayHook === 'function') {
            try { g.replayHook(c); } catch (err) { /* 静默 */ }
            return;
        }
        if (NB.Replay && typeof NB.Replay.push === 'function') {
            try { NB.Replay.push(c); } catch (err2) { /* 静默 */ }
        }
    }

    // C# UpdateReplayLifecycle()
    function updateReplayLifecycle() {
        if (!NB.Replay) return;
        var inRun = g.state === State.Play || g.state === State.Pause || g.state === State.Upgrade;
        try {
            if (inRun && Meta.replayOn) {
                if (!NB.Replay.active && typeof NB.Replay.start === 'function') NB.Replay.start(Meta.replayKeep);
            } else if (!inRun && NB.Replay.active && typeof NB.Replay.stop === 'function') {
                NB.Replay.stop();
            }
        } catch (err) { /* 回放模块未就绪时静默 */ }
    }

    // ===================== 主循环 =====================
    var rafId = 0, lastTs = 0, fpsAcc = 0, fpsFrames = 0, running = false;

    function tick(now) {
        if (!running) return;
        var dt = (now - lastTs) / 1000;
        lastTs = now;
        if (!isFinite(dt) || dt < 0) dt = 0.016;

        fpsAcc += dt; fpsFrames++;
        if (fpsAcc >= 0.5) { g.fps = Math.floor(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }

        g.dt = Math.min(0.05, dt);   // C# OnTick 的 dt 上限
        update(g.dt);
        updateReplayLifecycle();     // 第四阶段补丁：C# 每帧调用 UpdateReplayLifecycle()（开局录制 / 结算停止）
        render();
        rafId = window.requestAnimationFrame(tick);
    }

    // ===================== 初始化（对应 GameForm 构造函数） =====================
    var inited = false;

    function init(canvasEl) {
        if (inited) return;
        inited = true;

        Profile.load();
        Meta.load();
        Sfx.volume = Math.max(0, Math.min(1, Meta.sfxVol / 100));
        Sfx.muted = !Meta.sfxOn;
        if (typeof Sfx.init === 'function') Sfx.init();
        Meta.buildItems();
        if (Music && typeof Music.apply === 'function') Music.apply();

        g.backdrop = NB.Draw.BuildBackdrop(G.W, G.H, Math.random, Meta.quality);
        g.stats = new NB.Stats();
        g.state = State.Menu;

        setupCanvas(canvasEl);
        touchUILayout();

        // 供 shop.js / pauseitems.js 回调（薄包装，不改其内部）
        if (NB.Shop && NB.Shop.hooks) {
            NB.Shop.hooks.rebuildBackdrop = function () {
                g.backdrop = NB.Draw.BuildBackdrop(G.W, G.H, Math.random, Meta.quality);
            };
            NB.Shop.hooks.applyWindowMode = function () { fitView(); };
            NB.Shop.hooks.replayStop = function () {
                if (NB.Replay && NB.Replay.active && typeof NB.Replay.stop === 'function') { try { NB.Replay.stop(); } catch (e) { } }
            };
            NB.Shop.hooks.replayCleanup = function (keep) {
                if (NB.Replay && typeof NB.Replay.cleanup === 'function') { try { NB.Replay.cleanup(keep); } catch (e) { } }
            };
            NB.Shop.hooks.pickMusicFile = function (cb) {
                var inp = document.createElement('input');
                inp.type = 'file';
                inp.accept = 'audio/*';
                inp.onchange = function () {
                    if (inp.files && inp.files.length > 0 && typeof cb === 'function') cb(inp.files[0].name);
                };
                inp.click();
            };
        }
        if (NB.PauseItems && NB.PauseItems.hooks) {
            NB.PauseItems.hooks.novaBlast = function (x, y) { novaBlast(x, y, false); };
        }

        running = true;
        lastTs = performance.now();
        rafId = window.requestAnimationFrame(tick);
    }

    function stop() {
        running = false;
        if (rafId) window.cancelAnimationFrame(rafId);
        rafId = 0;
    }

    // ===================== 导出 =====================
    g.init = init;
    g.startGame = startGame;
    g.loadLevel = loadLevel;
    g.spawnBall = spawnBall;
    g.launchBalls = launchBalls;
    g.pushEndlessRows = pushEndlessRows;
    g.novaBlast = novaBlast;
    g.settleRun = settleRun;
    g.useReviveCard = useReviveCard;
    g.useLifeCard = useLifeCard;
    g.showToast = showToast;
    g.chooseUpgrade = chooseUpgrade;
    g.fitView = fitView;
    g.stop = stop;
    g.stateNames = State;
    g.replayHook = null;

    Object.defineProperty(g, 'paddleW', {
        get: function () { return paddleW(); },
        enumerable: true,
        configurable: true
    });

    NB.Game = g;
})(window.NB = window.NB || {});
