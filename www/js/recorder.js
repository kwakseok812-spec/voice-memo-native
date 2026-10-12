/* ============================================================================
 * recorder.js  —  녹음 모듈 (RecordingModule)
 * ----------------------------------------------------------------------------
 * [현재 방식 · 2026-09-19 교체]  MediaRecorder 로 "조용히" 녹음한다.
 *   - 실시간 받아쓰기(SpeechRecognition)는 안드로이드에서 재시작마다 "삑" 소리가
 *     나고 인식이 끊기는 문제가 있어 폐기했다(아래에 비활성 보존).
 *   - 이제 정지하면 녹음된 오디오 전체를 한 번에 글자로 바꾼다(transcriber.js).
 *
 * [바깥이 아는 인터페이스]  (통합 대비 — 이 인터페이스만 지키면 됨)
 *   start()            : 녹음 시작
 *   stop()             : 녹음 정지 → onAudio(blob) 로 결과 전달
 *   isRecording()      : 녹음 중 여부
 *   콜백:
 *     onStatus(state)  : 'idle' | 'recording' | 'stopped' | 'error'
 *     onLevel(0~1)     : 마이크 세기(막대용)
 *     onAudio(blob)    : 정지 시 녹음된 오디오(Blob) 전달
 *     onError(msg)     : 사람이 읽을 오류(한국어)
 * ==========================================================================*/

(function (global) {
  'use strict';

  function RecordingModule(options) {
    options = options || {};
    var noop = function () {};
    this.onStatus = options.onStatus || noop;
    this.onLevel = options.onLevel || noop;
    this.onAudio = options.onAudio || noop;
    this.onError = options.onError || noop;

    this._rec = null;
    this._chunks = [];
    this._stream = null;
    this._active = false;
    this._audioCtx = null;
    this._levelRAF = null;
    this._mime = '';
    this._lastLevel = 0;   // 무음 자동 감지용(0~1) — 레벨미터 tick 이 갱신
    this.kind = options.kind || '';   // v9.8: 네이티브 녹음기와 같은 인터페이스(웹에서는 쓰지 않는다)
    this._failed = false;             // v9.8: 녹음기가 오류를 알렸다
  }

  /* v9.8(O-0442) 네이티브 녹음기와 같은 인터페이스.
   *   status(): 웹에서는 페이지를 새로 열면 녹음도 사라지므로 되찾을 것이 없다 → known:false.
   *   alive() : 이 녹음기가 지금 실제로 적고 있는가(녹음기 상태 + 마이크 선이 살아 있는가). */
  RecordingModule.status = function () { return Promise.resolve({ known: false, on: false }); };
  RecordingModule.stopOrphan = function () { return Promise.resolve(); };
  RecordingModule.prototype.alive = function () {
    if (!this._rec) return Promise.resolve({ known: false, on: false });   // 아직 녹음기를 만들기 전(마이크 허용을 기다리는 중)
    var on = false;
    try {
      on = !!(this._active && this._rec && this._rec.state === 'recording' && this._stream &&
              this._stream.getAudioTracks().some(function (t) { return t.readyState === 'live'; }));
    } catch (e) { on = false; }
    return Promise.resolve({ known: true, on: on, failed: !!this._failed, elapsedMs: 0, startedAt: 0, kind: this.kind });
  };
  RecordingModule.prototype.adopt = function () {};

  // 최근 마이크 세기(0~1). 네이티브 recorder-native 와 인터페이스 일치.
  RecordingModule.prototype.getAmplitude = function () { return Promise.resolve(this._lastLevel || 0); };

  RecordingModule.isSupported = function () {
    return !!(global.navigator && navigator.mediaDevices &&
              navigator.mediaDevices.getUserMedia && global.MediaRecorder);
  };

  RecordingModule.prototype.isRecording = function () { return this._active; };

  RecordingModule.prototype.start = function () {
    var self = this;
    if (this._active) return;
    this._rec = null;                 // v9.8: 새로 시작하는 동안에는 지난 녹음기를 가리키지 않는다(alive 가 「모름」을 돌려주게)

    if (!RecordingModule.isSupported()) {
      this.onError('이 브라우저는 녹음을 지원하지 않습니다. 갤럭시/안드로이드의 Chrome에서 열어 주세요.');
      this.onStatus('error');
      return;
    }

    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(function (stream) {
        self._stream = stream;
        self._chunks = [];
        // 브라우저가 지원하는 오디오 형식 선택
        var mime = '';
        var cand = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
        for (var i = 0; i < cand.length; i++) {
          if (global.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(cand[i])) { mime = cand[i]; break; }
        }
        self._mime = mime;
        try {
          self._rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        } catch (e) {
          self._rec = new MediaRecorder(stream);
        }
        self._rec.ondataavailable = function (e) {
          if (e.data && e.data.size > 0) self._chunks.push(e.data);
        };
        self._failed = false;
        self._rec.onerror = function () { self._failed = true; };   // v9.8: 표시만 한다(녹음기는 건드리지 않는다)
        self._rec.onstop = function () {
          var type = self._mime || (self._chunks[0] && self._chunks[0].type) || 'audio/webm';
          var blob = new Blob(self._chunks, { type: type });
          self._stopLevelMeter();
          self._releaseStream();
          self.onStatus('stopped');
          self.onAudio(blob);
        };
        self._rec.start();
        self._active = true;
        self._startLevelMeter(stream);
        self.onStatus('recording');
      })
      .catch(function (err) {
        var msg = '마이크를 사용할 수 없습니다.';
        if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
          msg = '마이크 사용이 차단되었습니다. 주소창의 자물쇠(권한) 설정에서 마이크를 "허용"으로 바꿔 주세요.';
        } else if (err && err.name === 'NotFoundError') {
          msg = '마이크를 찾을 수 없습니다. 기기 마이크를 확인해 주세요.';
        }
        self.onError(msg);
        self.onStatus('error');
      });
  };

  RecordingModule.prototype.stop = function () {
    if (!this._active) return;
    this._active = false;
    try { this._rec.stop(); } catch (e) { /* onstop 처리 */ }
  };

  /* --- 마이크 세기 막대 --- */
  RecordingModule.prototype._startLevelMeter = function (stream) {
    var self = this;
    try {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      this._audioCtx = new AC();
      var source = this._audioCtx.createMediaStreamSource(stream);
      var analyser = this._audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      var data = new Uint8Array(analyser.frequencyBinCount);
      var tick = function () {
        analyser.getByteTimeDomainData(data);
        var sum = 0;
        for (var i = 0; i < data.length; i++) { var v = (data[i] - 128) / 128; sum += v * v; }
        var lvl = Math.min(1, Math.sqrt(sum / data.length) * 3);
        self._lastLevel = lvl;
        self.onLevel(lvl);
        self._levelRAF = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) { /* 막대만 실패 — 녹음엔 영향 없음 */ }
  };

  RecordingModule.prototype._stopLevelMeter = function () {
    if (this._levelRAF) cancelAnimationFrame(this._levelRAF);
    this._levelRAF = null;
    this._lastLevel = 0;
    this.onLevel(0);
    if (this._audioCtx) { try { this._audioCtx.close(); } catch (e) {} this._audioCtx = null; }
  };

  RecordingModule.prototype._releaseStream = function () {
    if (this._stream) {
      this._stream.getTracks().forEach(function (t) { t.stop(); });
      this._stream = null;
    }
  };

  global.RecordingModule = RecordingModule;

  /* ==========================================================================
   * [비활성 보존]  옛 실시간 받아쓰기(SpeechRecognition) 방식.
   * 2026-09-19 폐기(삑소리·끊김 문제). 되살릴 때 참고용으로만 남긴다.
   * 사용하지 않는다 — 어디서도 호출하지 않음.
   * --------------------------------------------------------------------------
   * function LegacyRealtimeRecognition(opts){
   *   var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
   *   var rec = new SR();
   *   rec.lang='ko-KR'; rec.continuous=true; rec.interimResults=true;
   *   rec.onresult = function(ev){ ... 확정/임시 텍스트 누적 ... };
   *   // 안드로이드는 onend 가 자주 발생 → 자동 재시작으로 이어붙였는데,
   *   // 이 재시작이 "삑" 인식음을 반복시키는 원인이었다.
   *   rec.onend = function(){ if(active) rec.start(); };
   * }
   * ========================================================================== */
})(window);
