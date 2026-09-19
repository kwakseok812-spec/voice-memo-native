/* ============================================================================
 * recorder-native.js  —  네이티브(안드로이드) 백그라운드 녹음
 * ----------------------------------------------------------------------------
 * Capacitor 네이티브 앱에서만 동작. 웹(브라우저)에서는 아무것도 안 하고
 * 기존 recorder.js(MediaRecorder)를 그대로 쓴다.
 *
 * 화면을 꺼도/다른 앱을 써도 녹음이 계속되게:
 *   1) 마이크 권한 요청
 *   2) "포그라운드 서비스(마이크 타입)" 시작 → OS가 프로세스를 안 죽임 + 알림 표시
 *   3) 네이티브 오디오 녹음 시작
 *   정지: 녹음 정지 → 오디오(Blob) 회수 → 포그라운드 서비스 종료 → onAudio(blob)
 *
 * recorder.js 와 같은 인터페이스(start/stop/isRecording + onStatus/onLevel/onAudio/onError)
 * 를 구현해 window.RecordingModule 을 교체한다. app.js 는 바뀔 필요 없다.
 * ==========================================================================*/
(function (global) {
  'use strict';
  var Cap = global.Capacitor;
  // 네이티브가 아니면(=일반 브라우저) 손대지 않는다 → 기존 MediaRecorder 사용.
  if (!Cap || typeof Cap.isNativePlatform !== 'function' || !Cap.isNativePlatform()) return;

  var AR = Cap.Plugins.CapacitorAudioRecorder;
  var FGS = Cap.Plugins.ForegroundService;
  var SERVICE_TYPE_MICROPHONE = 128;

  function NativeRecorder(options) {
    options = options || {};
    var noop = function () {};
    this.onStatus = options.onStatus || noop;
    this.onLevel = options.onLevel || noop;
    this.onAudio = options.onAudio || noop;
    this.onError = options.onError || noop;
    this._active = false;
    this._levelTimer = null;
  }
  NativeRecorder.isSupported = function () { return !!(AR && FGS); };
  NativeRecorder.prototype.isRecording = function () { return this._active; };

  NativeRecorder.prototype.start = function () {
    var self = this;
    (async function () {
      try {
        if (!AR || !FGS) { self.onError('녹음 플러그인을 찾지 못했어요.'); self.onStatus('error'); return; }
        // 1) 마이크 권한
        var perm = await AR.requestPermissions();
        if (perm && perm.recordAudio && perm.recordAudio !== 'granted') {
          self.onError('마이크 권한이 필요해요. 설정에서 허용해 주세요.'); self.onStatus('error'); return;
        }
        // 2) 알림 권한(있으면) + 포그라운드 서비스(마이크) 시작 → 화면 꺼져도 유지
        try { await FGS.requestPermissions(); } catch (e) {}
        await FGS.startForegroundService({
          id: 1,
          title: '음성 메모 녹음 중',
          body: '화면을 꺼도 녹음이 계속돼요. 끝나면 앱에서 정지를 누르세요.',
          smallIcon: 'ic_stat_mic',
          serviceType: SERVICE_TYPE_MICROPHONE
        });
        // 3) 녹음 시작
        await AR.startRecording();
        self._active = true;
        self.onStatus('recording');
        // 레벨 막대(진폭 폴링)
        self._levelTimer = setInterval(async function () {
          try { var a = await AR.getCurrentAmplitude(); self.onLevel(Math.min(1, (a && a.value) || 0)); }
          catch (e) {}
        }, 200);
      } catch (e) {
        self.onError('녹음 시작 실패: ' + (e && e.message || e));
        self.onStatus('error');
        try { await FGS.stopForegroundService(); } catch (e2) {}
      }
    })();
  };

  NativeRecorder.prototype.stop = function () {
    var self = this;
    self._active = false;
    if (self._levelTimer) { clearInterval(self._levelTimer); self._levelTimer = null; }
    self.onLevel(0);
    (async function () {
      var res = null;
      try { res = await AR.stopRecording(); }
      catch (e) { self.onError('녹음 정지 실패: ' + (e && e.message || e)); }
      try { await FGS.stopForegroundService(); } catch (e) {}
      self.onStatus('stopped');
      try {
        var blob = res && res.blob;
        if (!blob && res && res.uri) {
          var url = Cap.convertFileSrc(res.uri);
          blob = await fetch(url).then(function (r) { return r.blob(); });
        }
        if (blob) self.onAudio(blob);
        else self.onError('녹음 파일을 읽지 못했어요.');
      } catch (e) { self.onError('녹음 파일 처리 실패: ' + (e && e.message || e)); }
    })();
  };

  // 웹용 RecordingModule 을 네이티브 구현으로 교체
  global.RecordingModule = NativeRecorder;
  if (global.console) console.log('[recorder-native] 네이티브 백그라운드 녹음 활성화');
})(window);
