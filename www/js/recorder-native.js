/* ============================================================================
 * recorder-native.js  —  네이티브(안드로이드) 백그라운드 녹음
 * ----------------------------------------------------------------------------
 * 녹음은 커스텀 네이티브 플러그인 "NativeRecorder" 가 한다.
 *   - NativeRecorder 는 포그라운드 서비스(type=microphone) 안에서 MediaRecorder 로
 *     파일에 녹음한다 → 화면이 꺼지거나 다른 앱을 써도 녹음이 계속된다.
 *   - WebView(JS)는 시작/정지만 호출하고, 정지 시 네이티브가 만든 오디오 파일을
 *     받아 기존 업로드(office-bridge)로 넘긴다.
 *
 * recorder.js 와 같은 인터페이스(start/stop/isRecording + onStatus/onLevel/onAudio/onError).
 * 네이티브가 아니면(=일반 브라우저) 손대지 않는다.
 * ==========================================================================*/
(function (global) {
  'use strict';
  var Cap = global.Capacitor;
  if (!Cap || typeof Cap.isNativePlatform !== 'function' || !Cap.isNativePlatform()) return;

  var NR = Cap.Plugins.NativeRecorder;

  function NativeRecorder(options) {
    options = options || {};
    var noop = function () {};
    this.onStatus = options.onStatus || noop;
    this.onLevel = options.onLevel || noop;
    this.onAudio = options.onAudio || noop;
    this.onError = options.onError || noop;
    this._active = false;
    this.lastDurationMs = 0;   // 정지 시 "실제 녹음된 길이"(진단용)
    this.kind = options.kind || '';   // v9.8: 녹음의 종류(meeting·chat·idea) — 서비스가 하나라, 다른 종류가 도는 중이면 네이티브가 시작을 거절한다
  }
  NativeRecorder.isSupported = function () { return !!NR; };
  NativeRecorder.prototype.isRecording = function () { return this._active; };

  /* v9.8(O-0442) 네이티브 녹음 서비스의 지금 상태.
   *   {known, on, elapsedMs, startedAt, kind, failed} — known=false 면 물어보지 못한 것(옛 앱·오류)이라 on 을 믿지 않는다.
   *   옛 앱(v9.7 이하)은 value 만 준다 → elapsedMs 등은 0·''. */
  NativeRecorder.status = function () {
    if (!NR || !NR.isRecording) return Promise.resolve({ known: false, on: false });
    return NR.isRecording().then(function (r) {
      r = r || {};
      return { known: true, on: !!r.value, elapsedMs: Number(r.elapsedMs) || 0, startedAt: Number(r.startedAt) || 0,
               kind: String(r.kind || ''), failed: !!r.failed, bytes: Number(r.bytes) || 0, rich: typeof r.startedAt !== 'undefined' };
    }).catch(function () { return { known: false, on: false }; });
  };
  NativeRecorder.prototype.alive = function () { return NativeRecorder.status(); };
  // 화면이 닫히며 주인을 잃은 녹음을 끝낸다(파일은 폰에 남는다). 돌고 있는 것이 없으면 아무 일도 없다.
  NativeRecorder.stopOrphan = function () { try { return NR.stop().catch(function () {}); } catch (e) { return Promise.resolve(); } };
  // 화면이 다시 만들어진 뒤, 네이티브에서 계속 돌고 있던 녹음을 이 녹음기의 것으로 삼는다(정지는 평소와 같은 길).
  NativeRecorder.prototype.adopt = function () { this._active = true; };

  // 현재 녹음의 최대 진폭을 0~1 로 정규화해 반환(무음 자동 감지용). 실패/미지원 시 0.
  NativeRecorder.prototype.getAmplitude = function () {
    if (!NR || !NR.getAmplitude) return Promise.resolve(0);
    return NR.getAmplitude().then(function (r) {
      var v = (r && typeof r.value === 'number') ? r.value : 0;
      return Math.max(0, Math.min(1, v / 32767));
    }).catch(function () { return 0; });
  };

  NativeRecorder.prototype.start = function () {
    var self = this;
    (async function () {
      try {
        if (!NR) { self.onError('녹음 플러그인을 찾지 못했습니다.'); self.onStatus('error'); return; }
        await NR.start({ kind: self.kind });   // 권한 요청 + 포그라운드 서비스 시작 + 네이티브 녹음 시작(v9.8: 종류를 함께 넘긴다)
        self._active = true;
        self.onStatus('recording');
      } catch (e) {
        self.onError((e && e.message) ? e.message : '녹음 시작 실패');
        self.onStatus('error');
      }
    })();
  };

  NativeRecorder.prototype.stop = function () {
    var self = this;
    self._active = false;
    self.onLevel(0);
    (async function () {
      try {
        var res = await NR.stop();      // { uri, durationMs }
        self.onStatus('stopped');
        self.lastDurationMs = (res && res.durationMs) || 0;
        if (!res || !res.uri) { self.onError('녹음 파일을 만들지 못했습니다.'); return; }
        var url = Cap.convertFileSrc(res.uri);
        var blob = await fetch(url).then(function (r) { return r.blob(); });
        // m4a/aac(MPEG-4) 형식. 서버(ffmpeg+faster-whisper)가 처리함.
        if (!blob.type) { try { blob = new Blob([blob], { type: 'audio/mp4' }); } catch (e) {} }
        self.onAudio(blob);
      } catch (e) {
        self.onStatus('stopped');
        self.onError((e && e.message) ? e.message : '녹음 정지 실패');
      }
    })();
  };

  global.RecordingModule = NativeRecorder;
  if (global.console) console.log('[recorder-native] 네이티브 포그라운드-서비스 녹음 활성화');
})(window);
