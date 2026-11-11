/*
 * audio.js —— 移植自 Codes/Audio.cs（Sfx）与 Codes/Music.cs（Music）
 * ------------------------------------------------------------------
 * 加载方式：经典 <script>，非 ES Module；IIFE 包裹。
 * 依赖：core.js（NB.Profile 无强依赖）、meta.js（运行期读 NB.Meta 设置，缺失时用默认值）
 *
 * 实现方式说明：
 *   源码用 winmm PlaySound 播放内存 WAV，波形全部由 C# 代码逐采样合成。
 *   本移植保留完全相同的合成公式（采样率 22050、波形叠加、包络、时长、音高），
 *   只是把 float 采样写进 Web Audio 的 AudioBuffer，用 AudioBufferSourceNode + GainNode 播放。
 *   这样音色/音高/时长/包络与源码逐采样一致（比用 OscillatorNode 近似更贴近源码）。
 *
 * 平台差异（仅此两处，均属播放通道差异，不改变声音本身）：
 *   1) 源码 PlaySound(SND_ASYNC) 是单实例播放，新音效会打断上一个；
 *      网页端改为多声部并发（同时最多 12 个），否则连击时会让音效频繁截断。
 *   2) 源码把音量烘焙进 WAV；此处同样在合成时按 Sfx.volume 烘焙并保留重建逻辑，行为一致。
 *
 * 导出清单（挂在全局 NB 上）：
 *   NB.Sfx   { SAMPLE_RATE, muted, volume, init(), play(name), isReady(), dispose(),
 *              names() }  —— 与 C# Sfx.Muted / Sfx.Volume / Sfx.Init() / Sfx.Play(name) 对应
 *   NB.Music { apply(), setVolume(), stop(), get playing,
 *              genSamples(track) }  —— 与 C# Music.Apply()/SetVolume()/Stop() 对应
 *
 * 无音频环境（浏览器不支持 / 上下文被策略阻止）时全部方法静默返回，不抛错。
 */
(function () {
    'use strict';

    var NB = globalThis.NB = globalThis.NB || {};

    var SAMPLE_RATE = 22050;

    // ---------- AudioContext 惰性创建 ----------
    var ctx = null;
    var ctxFailed = false;

    function audioCtor() {
        if (typeof window === 'undefined') return null;
        return window.AudioContext || window.webkitAudioContext || null;
    }

    function ensureCtx() {
        if (ctx) return ctx;
        if (ctxFailed) return null;
        try {
            var AC = audioCtor();
            if (!AC) { ctxFailed = true; return null; }
            ctx = new AC();
        } catch (e) {
            ctxFailed = true;
            ctx = null;
        }
        return ctx;
    }

    function resumeCtx() {
        if (!ctx) return;
        try {
            if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
        } catch (e) { /* 静默 */ }
    }

    // ---------- 波形合成（与 C# 逐行对应） ----------

    // C# Blip(f0, f1, ms, wave, vol)
    function blip(f0, f1, ms, wave, vol) {
        var n = Math.max(1, Math.trunc(SAMPLE_RATE * ms / 1000));
        var buf = new Float32Array(n);
        var phase = 0;
        var attack = 0.012;
        for (var i = 0; i < n; i++) {
            var t = i / n;
            var f = f0 + (f1 - f0) * t;
            phase += 2 * Math.PI * f / SAMPLE_RATE;
            var v;
            if (wave === 0) v = Math.sin(phase);
            else if (wave === 1) v = Math.sin(phase) * 0.5 + Math.sin(phase * 3) * 0.22 + Math.sin(phase * 5) * 0.1;
            else if (wave === 2) v = Math.sin(phase) * 0.45 + Math.sin(phase * 2) * 0.3;
            else v = Math.sin(phase) * 0.6;
            var env = Math.min(1, t / attack) * Math.pow(1 - t, 1.6);
            buf[i] = v * env * vol;
        }
        return buf;
    }

    // C# Arp(freqs, noteMs, wave, vol)
    function arp(freqs, noteMs, wave, vol) {
        var per = Math.max(1, Math.trunc(SAMPLE_RATE * noteMs / 1000));
        var buf = new Float32Array(per * freqs.length + Math.trunc(per / 2));
        for (var k = 0; k < freqs.length; k++) {
            var off = Math.trunc(k * per / 2);
            var tone = blip(freqs[k], freqs[k], noteMs, wave, vol);
            for (var i = 0; i < tone.length && off + i < buf.length; i++) buf[off + i] += tone[i];
        }
        return buf;
    }

    // C# Boom(vol, ms)
    function boom(vol, ms) {
        var n = Math.trunc(SAMPLE_RATE * ms / 1000);
        var buf = new Float32Array(n);
        var phase = 0;
        for (var i = 0; i < n; i++) {
            var t = i / n;
            var f = 160 * (1 - t * 0.8);
            phase += 2 * Math.PI * f / SAMPLE_RATE;
            var noise = Math.random() * 2 - 1;
            var v = Math.sin(phase) * 0.45 + noise * 0.55 * (1 - t);
            buf[i] = v * Math.pow(1 - t, 2.0) * vol;
        }
        return buf;
    }

    // ===================== 音效 =====================
    var Sfx = {
        SAMPLE_RATE: SAMPLE_RATE,
        muted: false,        // 对应 C# Sfx.Muted
        volume: 0.8,         // 对应 C# Sfx.Volume

        _cache: {},          // name -> AudioBuffer
        _builtVol: -1,
        _ready: false,
        _voices: [],         // 正在播放的 source，用于并发上限控制
        _maxVoices: 12,

        // C# Sfx.Init()
        init: function () {
            if (this._ready) return;
            var ac = ensureCtx();
            if (!ac) return;
            this._ready = true;
            try {
                this._cache.brick = this._make(blip(760, 1180, 70, 1, 0.26));
                this._cache.brick2 = this._make(blip(430, 300, 80, 2, 0.24));
                this._cache.paddle = this._make(blip(300, 520, 70, 1, 0.28));
                this._cache.wall = this._make(blip(220, 200, 50, 0, 0.18));
                this._cache.bomb = this._make(boom(0.55, 300));
                this._cache.drop = this._make(arp([660, 880, 1180], 62, 0, 0.22));
                this._cache.upgrade = this._make(arp([523, 659, 784, 1046], 85, 1, 0.24));
                this._cache.lose = this._make(arp([520, 400, 310, 220], 130, 2, 0.3));
                this._cache.win = this._make(arp([659, 830, 988, 1318], 105, 0, 0.26));
                this._cache.laser = this._make(blip(1600, 420, 80, 2, 0.16));
                this._cache.shield = this._make(blip(180, 90, 220, 0, 0.3));
                this._cache.click = this._make(blip(900, 900, 34, 1, 0.14));
            } catch (e) { /* 静默 */ }
        },

        isReady: function () { return this._ready; },

        names: function () { return Object.keys(this._cache); },

        // float 采样 → AudioBuffer（含 C# Make() 中的音量烘焙与 ±32000 量化）
        _make: function (samples) {
            var ac = ensureCtx();
            if (!ac) return null;
            var n = samples.length;
            var buf;
            try {
                buf = ac.createBuffer(1, n, SAMPLE_RATE);
            } catch (e) { return null; }
            var ch = buf.getChannelData(0);
            var vol = this.volume;
            for (var i = 0; i < n; i++) {
                var s = samples[i] * vol;
                if (s > 1) s = 1; else if (s < -1) s = -1;
                // (short)(s * 32000) 的量化，再换算回 [-1,1] 浮点（/32768）
                var q = Math.trunc(s * 32000);
                if (q > 32767) q = 32767; else if (q < -32768) q = -32768;
                ch[i] = q / 32768;
            }
            return buf;
        },

        // C# Sfx.Play(string name)
        play: function (name) {
            if (this.muted) return;
            var ac = ensureCtx();
            if (!ac) return;
            if (!this._ready) this.init();
            if (Math.abs(this._builtVol - this.volume) > 0.03) {
                this._builtVol = this.volume;
                try { this._cache = {}; this._ready = false; this.init(); } catch (e) { }
            }
            var buf = this._cache[name];
            if (!buf) return;
            try {
                resumeCtx();
                // 回收已结束的声部
                for (var i = this._voices.length - 1; i >= 0; i--) {
                    if (this._voices[i]._done) this._voices.splice(i, 1);
                }
                if (this._voices.length >= this._maxVoices) {
                    var old = this._voices.shift();
                    try { old.stop(); } catch (e) { }
                }
                var src = ac.createBufferSource();
                src.buffer = buf;
                var gain = ac.createGain();
                gain.gain.value = 1;
                src.connect(gain);
                gain.connect(ac.destination);
                var self = this;
                src.onended = function () { src._done = true; try { gain.disconnect(); } catch (e) { } };
                src.start(0);
                this._voices.push(src);
            } catch (e) { /* 静默 */ }
        },

        // 释放资源（非源码接口，页面隐藏/销毁时使用）
        dispose: function () {
            for (var i = 0; i < this._voices.length; i++) {
                try { this._voices[i].stop(); } catch (e) { }
            }
            this._voices.length = 0;
            this._cache = {};
            this._ready = false;
        }
    };
    NB.Sfx = Sfx;

    // ===================== 背景音乐 =====================
    var SR = 22050;   // 对应 C# Music.Gen 内的 const int SR = 22050

    // C# Music.Gen 的纯采样部分（去掉写文件），返回 Float32Array
    function genSamples(track) {
        var bpm = track === 0 ? 104 : (track === 1 ? 138 : 84);
        var beat = 60.0 / bpm;
        var bars = 8;
        var total = bars * 4 * beat;
        var n = Math.trunc(total * SR);

        var buf = new Float32Array(n);
        var scale = track === 2
            ? [57, 60, 64, 67, 69, 72, 76, 79]
            : [57, 60, 62, 64, 67, 69, 72, 74];

        var stepDur = Math.trunc(beat * 0.5 * SR);
        var stepCount = Math.trunc(n / stepDur) + 1;

        for (var s = 0; s < stepCount; s++) {
            var note = scale[(s * 3 + Math.trunc(s / 4)) % scale.length];
            var f = 440.0 * Math.pow(2.0, (note - 69) / 12.0);
            var off = s * stepDur;
            var len = Math.trunc(stepDur * (track === 2 ? 2.2 : 1.1));
            var amp = track === 2 ? 0.16 : 0.13;
            for (var i = 0; i < len && off + i < n; i++) {
                var t = i / SR;
                var env = Math.min(1.0, i / (SR * 0.008));
                env *= Math.exp(-t * (track === 2 ? 1.4 : 4.2));
                var v = Math.sin(2 * Math.PI * f * t) * 0.7 + Math.sin(4 * Math.PI * f * t) * 0.18;
                if (track === 1) v += Math.sin(6 * Math.PI * f * t) * 0.12;
                buf[off + i] += v * env * amp;
            }

            // 低音
            if (s % 4 === 0) {
                var bf = 440.0 * Math.pow(2.0, (((s % 16 < 8) ? 45 : 41) - 69) / 12.0);
                var blen = Math.trunc(beat * 2 * SR);
                for (var j = 0; j < blen && off + j < n; j++) {
                    var bt = j / SR;
                    var benv = Math.exp(-bt * 2.2) * Math.min(1.0, j / (SR * 0.01));
                    buf[off + j] += Math.sin(2 * Math.PI * bf * bt) * benv * 0.16;
                }
            }

            // 鼓
            if (track !== 2 && s % 4 === 2) {
                var dlen = Math.trunc(SR * 0.09);
                for (var k = 0; k < dlen && off + k < n; k++) {
                    var dt = k / SR;
                    var denv = Math.exp(-dt * 42);
                    buf[off + k] += (Math.random() * 2 - 1) * denv * 0.07;
                }
            }
        }

        // 首尾淡入淡出，循环更顺滑
        var fade = Math.trunc(SR * 0.35);
        for (var m = 0; m < fade && m < n; m++) {
            var kk = m / fade;
            buf[m] *= kk;
            buf[n - 1 - m] *= kk;
        }

        // 源码写 WAV 时 (short)(v * 28000)，此处按同样量化再换算回浮点
        for (var p = 0; p < n; p++) {
            var vv = buf[p];
            if (vv > 1) vv = 1;
            if (vv < -1) vv = -1;
            var q = Math.trunc(vv * 28000);
            if (q > 32767) q = 32767; else if (q < -32768) q = -32768;
            buf[p] = q / 32768;
        }
        return buf;
    }

    var Music = {
        _src: null,
        _gain: null,
        _bufCache: {},     // track -> AudioBuffer
        _opened: false,    // 对应 C# opened
        _curVol: -1,       // 对应 C# curVol
        _loading: false,

        get playing() { return this._opened; },

        // C# Music.Apply()
        apply: function () {
            this.stop();
            var M = NB.Meta;
            var on = M ? M.musicOn : true;
            var vol100 = M ? M.musicVol : 55;
            var track = M ? M.musicTrack : 0;
            if (!on) return;
            if (vol100 <= 0) return;

            if (track === 3) {
                this._playLocalFile(M ? M.musicFile : '');
                return;
            }
            var buf = this._buffer(track);
            if (!buf) return;
            var ac = ensureCtx();
            if (!ac) return;
            try {
                resumeCtx();
                var src = ac.createBufferSource();
                src.buffer = buf;
                src.loop = true;
                var gain = ac.createGain();
                // C# 用 MCI volume 0..1000（MusicVol*10），此处置为线性增益
                var vol = Math.max(0, Math.min(1000, vol100 * 10));
                gain.gain.value = vol / 1000;
                src.connect(gain);
                gain.connect(ac.destination);
                src.start(0);
                this._src = src;
                this._gain = gain;
                this._opened = true;
                this._curVol = vol;
            } catch (e) { /* 静默 */ }
        },

        // C# Music.SetVolume()
        setVolume: function () {
            if (!this._opened) { this.apply(); return; }
            var M = NB.Meta;
            var vol100 = M ? M.musicVol : 55;
            var vol = Math.max(0, Math.min(1000, vol100 * 10));
            if (vol === this._curVol) return;
            try {
                if (this._gain) this._gain.gain.value = vol / 1000;
                this._curVol = vol;
            } catch (e) { /* 静默 */ }
        },

        // C# Music.Stop()
        stop: function () {
            if (this._src) {
                try { this._src.onended = null; this._src.stop(0); } catch (e) { }
                try { if (this._gain) this._gain.disconnect(); } catch (e) { }
            }
            this._src = null;
            this._gain = null;
            this._opened = false;
        },

        // 取得某条内置曲目的 AudioBuffer（125 BPM 等参数见 genSamples）
        _buffer: function (track) {
            var ac = ensureCtx();
            if (!ac) return null;
            var cached = this._bufCache[track];
            if (cached) return cached;
            var samples;
            try {
                samples = genSamples(track);
            } catch (e) { return null; }
            var buf;
            try {
                buf = ac.createBuffer(1, samples.length, SR);
            } catch (e) { return null; }
            try {
                buf.getChannelData(0).set(samples);
            } catch (e) { return null; }
            this._bufCache[track] = buf;
            return buf;
        },

        // 对应 C# MusicTrack == 3 时播放 Meta.MusicFile 指定的本地文件；
        // 网页端把 MusicFile 解释为可通过 network 访问的音频 URL，无法加载时静默。
        _playLocalFile: function (file) {
            if (!file) return;
            var ac = ensureCtx();
            if (!ac) return;
            var self = this;
            if (this._loading) return;
            this._loading = true;
            try {
                var xhr = new XMLHttpRequest();
                xhr.open('GET', file, true);
                xhr.responseType = 'arraybuffer';
                xhr.onload = function () {
                    self._loading = false;
                    if (xhr.status >= 400 && xhr.status !== 0) return;
                    try {
                        ac.decodeAudioData(xhr.response, function (decoded) {
                            try {
                                var M = NB.Meta;
                                var vol = Math.max(0, Math.min(1000, (M ? M.musicVol : 55) * 10));
                                var src = ac.createBufferSource();
                                src.buffer = decoded;
                                src.loop = true;
                                var gain = ac.createGain();
                                gain.gain.value = vol / 1000;
                                src.connect(gain);
                                gain.connect(ac.destination);
                                src.start(0);
                                self._src = src;
                                self._gain = gain;
                                self._opened = true;
                                self._curVol = vol;
                            } catch (e) { /* 静默 */ }
                        }, function () { /* 解码失败：静默 */ });
                    } catch (e) { /* 静默 */ }
                };
                xhr.onerror = function () { self._loading = false; };
                xhr.send();
            } catch (e) {
                this._loading = false;
            }
        },

        // 暴露合成入口，便于后续阶段（如在线试听）复用
        genSamples: genSamples
    };
    NB.Music = Music;

})();
