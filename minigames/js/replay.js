/*
 * replay.js —— 移植自 Codes/Replay.cs（对局回放录制 + 保留最近 keep 份）
 * ------------------------------------------------------------------
 * 加载方式：经典 <script>，非 ES Module；IIFE 包裹。必须在 game.js 之前加载。
 * 依赖：core.js（NB.Meta 提供 replayOn / replayKeep，缺失时用默认值）；可选 Meta。
 *
 * 平台差异（C# → 浏览器）：
 *   C# 用 ffmpeg（rawvideo BGRA 管道 → libx264 → MP4）把每帧位图编码成
 *   「yyyyMMdd-HHmmss游戏回放.mp4」并写入 DataDir，只保留最近 keep 份。
 *   浏览器无法调用 ffmpeg，改用 MediaRecorder 录制 canvas.captureStream(30) 生成 WebM，
 *   文件命名沿用源码格式，后缀改为 .webm，仍为「yyyyMMdd-HHmmss游戏回放.webm」。
 *
 *   源码参数对照：
 *     Replay.FPS = 20，Push 里按 1/20 秒节流（now - lastPushTicks < gap 即丢帧）→ 本文件同样 FPS=20 节流。
 *     源码 ffmpeg 帧率 -framerate 20 → 这里 captureStream(30) 取更高采样，再由 push 节流决定"有效推帧"。
 *     Stop(bool cleanup) → 本文件 stop() 后自动 cleanup(Meta.replayKeep)。
 *     Cleanup(int keep) 只保留最近 keep 份 → 本文件按录制时间倒序保留 keep 条记录。
 *   源码"删除旧文件"在浏览器里等价为：释放早期录制的 Blob、从保留清单移除；
 *   当前文件落盘方式为触发浏览器下载（a[download]），被拦截时可用 saveLast() 重试。
 *
 * 导出清单（挂在全局 NB 上）：
 *   NB.Replay = {
 *     FPS, MIME_CANDIDATES,
 *     active, lastFile, lastError, keep, saved,
 *     start(keep)          开始录制（对应 C# Replay.Start(int keep)）
 *     push(canvas)         每帧推帧（对应 C# Replay.Push(Bitmap)），按 FPS 节流
 *     stop()               结束录制并落盘（对应 C# Replay.Stop()）
 *     cleanup(keep)        只保留最近 keep 份（对应 C# Replay.Cleanup(int keep)）
 *     saveLast()           重新触发下载上一段回放（浏览器策略拦截时的兜底）
 *     list()               当前保留的回放记录 [{name, time, size}]
 *     isSupported()        当前环境是否支持录制
 *     dispose()            释放资源（停止 + 撤销 URL）
 *   }
 *
 * 录制失败（浏览器不支持 / 权限问题 / 编码器异常）一律静默降级：
 *   只写 lastError，不弹阻塞对话框，不影响对局。
 */
(function () {
    'use strict';

    var NB = globalThis.NB = globalThis.NB || {};

    var FPS = 20;                                  // C# Replay.FPS
    var PUSH_GAP = 1 / FPS;                        // C#：1/20 秒节流
    var CAPTURE_FPS = 30;                          // captureStream 采样率
    var BITRATE = 4000000;                         // 约 4 Mbps，保证 1280x800 清晰度
    var DEFAULT_KEEP = 10;                         // Meta.ReplayKeep 的源码默认值

    var MIME_CANDIDATES = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm'
    ];

    function now() {
        if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') return performance.now();
        return Date.now();
    }

    // C# DateTime.Now.ToString("yyyyMMdd-HHmmss") + "游戏回放"
    function stampName(d) {
        function p2(n) { return (n < 10 ? '0' : '') + n; }
        return String(d.getFullYear()) + p2(d.getMonth() + 1) + p2(d.getDate()) +
            '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
    }

    function pickMime() {
        if (typeof MediaRecorder === 'undefined') return '';
        if (typeof MediaRecorder.isTypeSupported !== 'function') return 'video/webm';
        for (var i = 0; i < MIME_CANDIDATES.length; i++) {
            try {
                if (MediaRecorder.isTypeSupported(MIME_CANDIDATES[i])) return MIME_CANDIDATES[i];
            } catch (e) { /* 静默 */ }
        }
        return '';
    }

    var Replay = {
        FPS: FPS,
        MIME_CANDIDATES: MIME_CANDIDATES,

        active: false,
        lastFile: '',
        lastError: '',
        keep: DEFAULT_KEEP,
        saved: false,
        _needSave: false,   // 自动下载被拦截时为 true（index.html 据此显示兜底按钮）

        _rec: null,
        _stream: null,
        _mime: '',
        _chunks: [],
        _fileName: '',
        _startTime: 0,
        _lastPush: 0,
        _frames: 0,
        _blob: null,
        _url: '',
        _files: [],
        _unsupported: false,

        // 当前环境是否可录制
        isSupported: function () {
            try {
                if (typeof MediaRecorder === 'undefined') return false;
                if (typeof HTMLCanvasElement === 'undefined') return false;
                return typeof HTMLCanvasElement.prototype.captureStream === 'function' ||
                    typeof HTMLCanvasElement.prototype.mozCaptureStream === 'function';
            } catch (e) {
                return false;
            }
        },

        // C# Replay.Start(int keep)
        // 浏览器侧：MediaRecorder 需要 canvas 才能建流，故此处只登记录制意图与文件名，
        // 真正的流在第一次 push(canvas) 时惰性建立（帧时刻与源码一致：开局即 start）。
        start: function (keep) {
            if (this.active) return false;
            this.keep = (typeof keep === 'number' && keep > 0) ? Math.trunc(keep) : DEFAULT_KEEP;
            this.lastError = '';
            this.saved = false;
            this._needSave = false;
            this._chunks = [];
            this._frames = 0;
            this._lastPush = 0;
            this._blob = null;
            this._fileName = stampName(new Date()) + '游戏回放.webm';
            this._startTime = Date.now();

            if (!this.isSupported()) {
                this._unsupported = true;
                this.lastError = '当前浏览器不支持 MediaRecorder / canvas.captureStream，已跳过录制';
                return false;
            }
            this._mime = pickMime();
            this.active = true;
            return true;
        },

        // 惰性建立录制器（首次拿到 canvas 时）
        _ensureRecorder: function (canvas) {
            if (this._rec) return true;
            if (!canvas) return false;
            var stream = null;
            try {
                if (typeof canvas.captureStream === 'function') stream = canvas.captureStream(CAPTURE_FPS);
                else if (typeof canvas.mozCaptureStream === 'function') stream = canvas.mozCaptureStream(CAPTURE_FPS);
            } catch (e) {
                this.lastError = 'captureStream 失败：' + (e && e.message ? e.message : e);
                return false;
            }
            if (!stream) {
                this.lastError = '无法从 canvas 取得视频流';
                return false;
            }
            this._stream = stream;

            var opts = { videoBitsPerSecond: BITRATE };
            if (this._mime) opts.mimeType = this._mime;

            var rec = null;
            try {
                rec = new MediaRecorder(stream, opts);
            } catch (e1) {
                try {
                    rec = new MediaRecorder(stream);   // 退化为浏览器默认编码
                } catch (e2) {
                    this.lastError = 'MediaRecorder 创建失败：' + (e2 && e2.message ? e2.message : e2);
                    return false;
                }
            }

            var self = this;
            rec.ondataavailable = function (ev) {
                if (ev && ev.data && ev.data.size > 0) self._chunks.push(ev.data);
            };
            rec.onerror = function (ev) {
                var msg = (ev && ev.error && ev.error.name) ? ev.error.name : 'unknown';
                self.lastError = '录制异常：' + msg;
            };
            rec.onstop = function () { self._finalize(); };

            try {
                rec.start(1000);   // 每秒切一个 chunk，避免长录制内存暴涨
            } catch (e3) {
                this.lastError = 'MediaRecorder 启动失败：' + (e3 && e3.message ? e3.message : e3);
                return false;
            }
            this._rec = rec;
            return true;
        },

        // C# Replay.Push(Bitmap bmp)
        push: function (canvas) {
            if (!this.active) return false;
            if (!this._ensureRecorder(canvas)) return false;

            // 源码节流：距上次推帧不足 1/20 秒则丢弃本帧
            var t = now();
            if (this._lastPush > 0 && (t - this._lastPush) / 1000 < PUSH_GAP) return false;
            this._lastPush = t;
            this._frames++;

            // 画布实时流由浏览器自动采样，无需逐帧喂图；
            // 若底层实现未自动采样（个别实现），requestFrame 可补一帧。
            try {
                var trk = this._stream && this._stream.getVideoTracks ? this._stream.getVideoTracks() : null;
                if (trk) {
                    for (var i = 0; i < trk.length; i++) {
                        if (typeof trk[i].requestFrame === 'function') trk[i].requestFrame();
                    }
                }
            } catch (e) { /* 静默 */ }

            return true;
        },

        // C# Replay.Stop()（+ Cleanup(Meta.ReplayKeep)）
        stop: function () {
            if (!this.active) return false;
            this.active = false;
            var rec = this._rec;
            this._rec = null;
            if (rec && rec.state !== 'inactive') {
                try { rec.stop(); } catch (e) { /* 静默 */ }
                return true;
            }
            this._finalize();
            return true;
        },

        _finalize: function () {
            var chunks = this._chunks;
            this._chunks = [];
            try {
                if (this._stream) {
                    var tracks = this._stream.getTracks ? this._stream.getTracks() : [];
                    for (var i = 0; i < tracks.length; i++) { try { tracks[i].stop(); } catch (e) { } }
                }
            } catch (e) { /* 静默 */ }
            this._stream = null;

            if (!chunks.length) {
                if (!this.lastError) this.lastError = '未采集到视频帧，回放文件为空';
                return;
            }

            var blob = null;
            try {
                blob = new Blob(chunks, { type: this._mime || 'video/webm' });
            } catch (e) {
                this.lastError = '生成回放文件失败：' + (e && e.message ? e.message : e);
                return;
            }
            if (!blob || blob.size === 0) {
                if (!this.lastError) this.lastError = '回放文件为空';
                return;
            }

            this._blob = blob;
            this.lastFile = this._fileName;
            this._files.push({
                name: this._fileName,
                time: this._startTime,
                size: blob.size
            });

            this._download(blob, this._fileName);

            // C# Stop() 末尾的 Cleanup(Meta.ReplayKeep)
            var keep = this.keep;
            try {
                if (NB.Meta && typeof NB.Meta.replayKeep === 'number' && NB.Meta.replayKeep > 0) keep = NB.Meta.replayKeep;
            } catch (e2) { /* 静默 */ }
            this.cleanup(keep);
        },

        _download: function (blob, name) {
            try {
                if (this._url) { try { URL.revokeObjectURL(this._url); } catch (e) { } this._url = ''; }
                this._url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = this._url;
                a.download = name;
                a.rel = 'noopener';
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                setTimeout(function () { try { if (a.parentNode) a.parentNode.removeChild(a); } catch (e) { } }, 0);
                this.saved = true;
                this._needSave = false;
                return true;
            } catch (e) {
                this.saved = false;
                this._needSave = true;
                this.lastError = '自动下载被拦截，请点击「保存回放」按钮：' + (e && e.message ? e.message : e);
                return false;
            }
        },

        // 重新触发上一段回放的下载（自动下载被浏览器拦截时使用）
        saveLast: function () {
            if (!this._blob || !this.lastFile) return false;
            return this._download(this._blob, this.lastFile);
        },

        // C# Replay.Cleanup(int keep)：只保留最近 keep 份
        cleanup: function (keep) {
            var k = (typeof keep === 'number' && keep > 0) ? Math.trunc(keep) : DEFAULT_KEEP;
            this.keep = k;
            if (!this._files.length) return 0;
            this._files.sort(function (a, b) { return b.time - a.time; });
            var removed = 0;
            while (this._files.length > k) {
                var item = this._files.pop();
                removed++;
                // 源码删除旧文件；浏览器侧等价为释放其 Blob（仅保留内存中的最新一份）
                if (item && item.name !== this.lastFile) item.blob = null;
            }
            return removed;
        },

        list: function () {
            var out = [];
            for (var i = 0; i < this._files.length; i++) {
                out.push({ name: this._files[i].name, time: this._files[i].time, size: this._files[i].size });
            }
            return out;
        },

        dispose: function () {
            try { if (this.active) this.stop(); } catch (e) { }
            if (this._url) { try { URL.revokeObjectURL(this._url); } catch (e) { } this._url = ''; }
            this._blob = null;
            this._chunks = [];
        }
    };

    NB.Replay = Replay;
})();
