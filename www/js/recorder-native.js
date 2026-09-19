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
  }
  NativeRecorder.isSupported = function () { return !!NR; };
  NativeRecorder.prototype.isRecording = function () { return this._active; };

  NativeRecorder.prototype.start = function () {
    var self = this;
    (async function () {
      try {
        if (!NR) { self.onError('녹음 플러그인을 찾지 못했어요.'); self.onStatus('error'); return; }
        await NR.start();               // 권한 요청 + 포그라운드 서비스 시작 + 네이티브 녹음 시작
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
        if (!res || !res.uri) { self.onError('녹음 파일을 만들지 못했어요.'); return; }
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
