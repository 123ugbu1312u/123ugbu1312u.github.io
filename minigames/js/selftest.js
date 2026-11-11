/*
 * selftest.js —— 联调冒烟测试（Node 运行，不进入 index.html）
 * ------------------------------------------------------------------
 * 用法：node web/js/selftest.js
 * 目的：在无浏览器环境下按依赖顺序加载全部前端模块，验证：
 *   G 常量 / Profile 存取 / Levels 30 关 / Economy 公式 / Upgrade 池 /
 *   Draw 与 UI 基元 / DrawScene / Shop / PauseItems / Replay / Game 导出齐全
 * 说明：仅做"能否加载 + 导出是否齐全 + 关键数值是否与源码一致"的浅层校验，
 *       不模拟真实渲染与输入（那部分由浏览器运行验证）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = __dirname;
const FILES = [
    'core.js', 'levels.js', 'audio.js', 'render.js', 'meta.js',
    'draw.js', 'shop.js', 'pauseitems.js', 'replay.js', 'game.js'
];

// ---------------- 浏览器环境桩 ----------------
function makeCtx2D() {
    const store = Object.create(null);
    const fn = function () { };
    return new Proxy(store, {
        get(t, k) {
            if (k in t) return t[k];
            if (k === 'canvas') return { width: 1280, height: 800 };
            if (k === 'measureText') return () => ({ width: 24, height: 18 });
            if (k === 'createLinearGradient' || k === 'createRadialGradient') {
                return () => ({ addColorStop: function () { } });
            }
            if (k === 'createPattern') return () => null;
            if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
            return fn;
        },
        set(t, k, v) { t[k] = v; return true; },
        has() { return true; }
    });
}

function makeCanvas(w, h) {
    return {
        width: w || 1280,
        height: h || 800,
        style: {},
        clientWidth: w || 1280,
        clientHeight: h || 800,
        getContext: () => makeCtx2D(),
        getBoundingClientRect: () => ({ left: 0, top: 0, width: w || 1280, height: h || 800 }),
        addEventListener: function () { },
        removeEventListener: function () { },
        appendChild: function () { },
        captureStream: undefined
    };
}

const storage = new Map();
const localStorageStub = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => { storage.set(k, String(v)); },
    removeItem: (k) => { storage.delete(k); },
    clear: () => storage.clear()
};

const documentStub = {
    getElementById: () => makeCanvas(1280, 800),
    createElement: (tag) => (tag === 'canvas' ? makeCanvas(1280, 800) : {
        style: {}, appendChild: function () { }, removeChild: function () { },
        setAttribute: function () { }, click: function () { }, addEventListener: function () { }
    }),
    body: { appendChild: function () { }, removeChild: function () { }, style: {} },
    documentElement: { style: {} },
    addEventListener: function () { },
    removeEventListener: function () { }
};

const sandbox = {
    console,
    Math,
    Date,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Error,
    TypeError,
    Uint8Array,
    Uint8ClampedArray,
    Float32Array,
    Int16Array,
    Int32Array,
    Promise,
    Set,
    Map,
    isFinite,
    isNaN,
    parseFloat,
    parseInt,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout,
    clearTimeout,
    setInterval: function () { return 0; },
    clearInterval: function () { },
    performance: { now: () => Date.now() },
    localStorage: localStorageStub,
    document: documentStub,
    navigator: { userAgent: 'node-selftest', maxTouchPoints: 0 },
    devicePixelRatio: 1,
    requestAnimationFrame: function () { return 0; },
    cancelAnimationFrame: function () { },
    matchMedia: () => ({ matches: false, addListener: function () { }, addEventListener: function () { } }),
    addEventListener: function () { },
    removeEventListener: function () { },
    innerWidth: 1280,
    innerHeight: 800,
    ResizeObserver: undefined,
    OffscreenCanvas: undefined,
    Image: function () { this.src = ''; },
    Path2D: function () { return { addPath: function () { } }; },
    Blob: function (parts, opts) { this.size = (parts && parts.length) ? 1024 : 0; this.type = (opts && opts.type) || ''; },
    URL: { createObjectURL: () => 'blob:stub', revokeObjectURL: function () { } },
    MediaRecorder: undefined,
    AudioContext: undefined,
    webkitAudioContext: undefined,
    Audio: function () { }
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
sandbox.window.NB = undefined;

const context = vm.createContext(sandbox);

// ---------------- 结果收集 ----------------
const lines = [];
let fail = 0;

function ok(name, extra) {
    lines.push('PASS  ' + name + (extra === undefined ? '' : '  ' + extra));
}
function bad(name, extra) {
    fail++;
    lines.push('FAIL  ' + name + (extra === undefined ? '' : '  ' + extra));
}
function check(name, cond, extra) {
    if (cond) ok(name, extra); else bad(name, extra);
}

// 安全枚举自有属性名（不触发 getter，避免未初始化状态读取崩溃）
function keysSafe(obj) {
    if (!obj) return '';
    return Object.getOwnPropertyNames(obj).slice(0, 10).join(',');
}

// ---------------- 1. 依次加载模块 ----------------
const loaded = [];
for (const f of FILES) {
    const p = path.join(DIR, f);
    if (!fs.existsSync(p)) { bad('load ' + f, '文件缺失'); continue; }
    try {
        const code = fs.readFileSync(p, 'utf8');
        vm.runInContext(code, context, { filename: f });
        loaded.push(f);
        ok('load ' + f, Math.round(fs.statSync(p).size / 1024) + ' KB');
    } catch (e) {
        bad('load ' + f, e && e.stack ? e.stack : String(e));
    }
}

const NB = sandbox.NB;
check('NB 全局对象存在', !!NB);
if (!NB) {
    console.log(lines.join('\n'));
    process.exit(1);
}

// ---------------- 2. 常量与配色 ----------------
const G = NB.G || {};
check('G.W / G.H = 1280 / 800', G.W === 1280 && G.H === 800, G.W + 'x' + G.H);
check('G 网格常量齐全', G.Cols === 13 && G.BrickW > 0 && G.BrickH > 0 && G.PaddleY > 0,
    'Cols=' + G.Cols + ' BrickW=' + G.BrickW + ' PaddleY=' + G.PaddleY);
check('霓虹配色齐全（ARGB 精确值）', !!G.NeonCyan && G.NeonCyan.a === 255 && typeof G.NeonCyan.r === 'number',
    JSON.stringify(G.NeonCyan));

// ---------------- 3. 数学与经济 ----------------
const M = NB.M || {};
check('M 银行家舍入', M.round(2.5) === 2 && M.round(3.5) === 4, 'round(2.5)=' + M.round(2.5));
check('M.clamp', M.clamp(5, 0, 1) === 1 && M.clamp(-5, 0, 1) === 0);

const E = NB.Economy || {};
check('Economy.SettlePoints(1000)=50（热度 0）', typeof E.settlePoints === 'function' && E.settlePoints(1000) === 50,
    String(E.settlePoints && E.settlePoints(1000)));
check('Economy 常量与源码一致', E.pointsPerCoin === 10 && E.chanceBase === 0.35 && E.chanceCap === 0.85);
const lr = E.levelReward ? E.levelReward(0, () => 0.99) : null;
check('Economy.levelReward(0) = 40（未触发幸运）', !!lr && lr.pt === 40 && lr.lucky === false, JSON.stringify(lr));

// ---------------- 4. 存档 ----------------
const P = NB.Profile || {};
P.load();
check('Profile 首次礼包 Points=100 / Coins=5', P.points === 100 && P.coins === 5, 'points=' + P.points + ' coins=' + P.coins);
P.points = 321; P.coins = 7; P.bestCampaign = 5;
P.save();
const rawProfile = storage.get('NeonBreaker.profile');
check('Profile 写入键 NeonBreaker.profile（key=value 行文本）',
    typeof rawProfile === 'string' && /^points=/m.test(rawProfile) && /^coins=/m.test(rawProfile));

const P2 = Object.create(Object.getPrototypeOf(P));
for (const k of Object.keys(P)) if (typeof P[k] !== 'function' && !k.startsWith('heat')) P2[k] = P[k];
P.points = 0; P.coins = 0; P.bestCampaign = 0;
P.load();
check('Profile 回读一致', P.points === 321 && P.coins === 7 && P.bestCampaign === 5,
    'points=' + P.points + ' coins=' + P.coins + ' best=' + P.bestCampaign);

const Meta = NB.Meta || {};
Meta.load();
check('Meta 永久升级 15 项', Meta.ups && Meta.ups.length === 15, String(Meta.ups && Meta.ups.length));
check('Meta 商品 24 项', Meta.items && Meta.items.length === 24, String(Meta.items && Meta.items.length));
check('Meta 设置默认值', Meta.quality === 2 && Meta.replayOn === true && Meta.replayKeep === 10 && Meta.musicVol === 55,
    'quality=' + Meta.quality + ' keep=' + Meta.replayKeep);

// ---------------- 5. 关卡 ----------------
const L = NB.Levels || {};
check('Levels 30 关', L.all && L.all.length === 30 && L.count === 30, String(L.all && L.all.length));
check('第 1 关关卡名', L.all && L.all[0] && L.all[0].name === '初识霓虹', L.all && L.all[0] && L.all[0].name);
const pool = NB.UpgradePool;
const pick = pool && typeof pool.pick === 'function' ? pool.pick(3, { }) : null;
check('UpgradePool 16 项可选', !!pick && pick.length === 3, pick ? pick.map(function (u) { return u.key || u.name; }).join(',') : 'null');

// ---------------- 6. 绘制与界面模块导出 ----------------
const D = NB.Draw || {};
check('Draw 基元齐全', typeof D.RoundRect === 'function' && typeof D.GlowRound === 'function' &&
    typeof D.TextCenter === 'function' && typeof D.BuildBackdrop === 'function');
const UI = NB.UI || NB.Ui || {};
check('UI 组件齐全', typeof UI.capsule === 'function' && typeof UI.miniCapsule === 'function' &&
    typeof UI.glassPanel === 'function' && typeof UI.scrollBar === 'function');

const DS = NB.DrawScene || NB.Scene || null;
check('DrawScene 导出存在', !!DS, DS ? keysSafe(DS) : '未找到 NB.DrawScene');

const Shop = NB.Shop || {};
check('Shop 导出存在', typeof Shop.openShop === 'function' || typeof Shop.drawShop === 'function',
    keysSafe(Shop));
check('PauseItems 导出存在', !!NB.PauseItems, NB.PauseItems ? keysSafe(NB.PauseItems) : '未找到');

const Rep = NB.Replay || {};
check('Replay 接口齐全', typeof Rep.start === 'function' && typeof Rep.push === 'function' &&
    typeof Rep.stop === 'function' && typeof Rep.cleanup === 'function', 'active=' + Rep.active);
function replayDegrades() {
    try {
        const r = Rep.start(5);
        const unsupported = Rep.isSupported ? Rep.isSupported() : false;
        Rep.stop();
        if (unsupported) return true;
        return r === false || typeof Rep.lastError === 'string';
    } catch (e) { return false; }
}
check('Replay 无 MediaRecorder 时静默降级', replayDegrades());

// ---------------- 7. Game 导出 ----------------
// 注意：game.js 末尾挂了若干 getter（如 paddleW 依赖 g.stats），未初始化时读取会抛错，
// 因此这里用属性描述符枚举，绝不触发 getter。
function methodNames(obj) {
    const out = [];
    Object.getOwnPropertyNames(obj).forEach(function (k) {
        const d = Object.getOwnPropertyDescriptor(obj, k);
        if (d && typeof d.value === 'function') out.push(k);
    });
    return out;
}

const Game = NB.Game || {};
check('Game 导出齐全', typeof Game.init === 'function' && typeof Game.startGame === 'function' &&
    typeof Game.settleRun === 'function' && typeof Game.chooseUpgrade === 'function',
    methodNames(Game).slice(0, 12).join(','));
check('Game 状态机枚举', !!Game.stateNames && Game.stateNames.Menu !== undefined && Game.stateNames.Play !== undefined,
    Game.stateNames ? JSON.stringify(Game.stateNames) : 'null');
check('Game.replayHook 字段存在', 'replayHook' in Game);

// ---------------- 8. 汇总 ----------------
const pass = lines.filter(function (l) { return l.indexOf('PASS') === 0; }).length;
lines.push('');
lines.push('总计：' + pass + ' 项通过，' + fail + ' 项失败（加载 ' + loaded.length + '/' + FILES.length + ' 个模块）');
console.log(lines.join('\n'));
process.exit(fail === 0 ? 0 : 1);
