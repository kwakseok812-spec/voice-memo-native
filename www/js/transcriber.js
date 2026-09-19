/* ============================================================================
 * transcriber.js  —  음성→글자 변환 모듈 (TranscriberModule)
 * ----------------------------------------------------------------------------
 * [방식]  transformers.js 의 Whisper 모델을 "브라우저 안에서" 실행한다.
 *   - 서버·API 키·비용 0 (완전 무료). 모델은 처음 한 번만 내려받아 캐시된다.
 *   - WebGPU 가 있으면 GPU로 빠르게, 없으면 WASM(CPU)으로 동작.
 *   - 한국어 품질을 위해 whisper-base 사용(tiny 는 빠르지만 한국어가 약함).
 *
 * [바깥 인터페이스]
 *   transcribe(blob, onProgress) -> Promise<string(한국어 텍스트)>
 *     onProgress({phase, pct, device}) 로 진행상황 알림:
 *       phase: 'lib'|'model'|'download'|'decode'|'transcribe'
 *
 * [통합 대비]  변환 엔진을 서버 STT로 바꾸려면 이 파일의 transcribe() 내부만
 *   교체하면 된다(입력 blob → 출력 텍스트 계약은 동일).
 * ==========================================================================*/

(function (global) {
  'use strict';

  // 정확도 우선: small 먼저 시도 → 폰에서 무겁거나 로드 실패하면 base 로 자동 폴백.
  // (base 도 안 되면 tiny 까지 — 최악에도 앱이 죽지 않게)
  var MODELS = ['Xenova/whisper-small', 'Xenova/whisper-base', 'Xenova/whisper-tiny'];
  var TF_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.0';

  var _tf = null, _asr = null, _loading = null, _model = null;

  function _shortName(name) { return (name || '').split('/').pop().replace('whisper-', ''); }

  function _ensure(onProgress) {
    if (_asr) return Promise.resolve(_asr);
    if (_loading) return _loading;
    _loading = (async function () {
      onProgress && onProgress({ phase: 'lib' });
      _tf = await import(TF_URL);
      var device = ('gpu' in navigator) ? 'webgpu' : 'wasm';

      for (var i = 0; i < MODELS.length; i++) {
        var name = MODELS[i];
        try {
          onProgress && onProgress({ phase: 'model', device: device, model: _shortName(name) });
          var asr = await _tf.pipeline('automatic-speech-recognition', name, {
            device: device,
            progress_callback: function (x) {
              if (x && x.status === 'progress' && /\.onnx/.test(x.file || '')) {
                onProgress && onProgress({ phase: 'download', pct: Math.round(x.progress || 0), file: x.file, model: _shortName(name) });
              }
            }
          });
          // 워밍업 겸 건강검진: 무음 1초를 돌려본다.
          //  - WebGPU 첫 추론 공백 방지 + 이 모델이 이 기기에서 실제로 도는지 확인.
          //  - 여기서 실패(메모리 부족 등)하면 다음(더 가벼운) 모델로 폴백.
          onProgress && onProgress({ phase: 'model', device: device, model: _shortName(name) });
          await asr(new Float32Array(16000), { language: 'korean', task: 'transcribe' });
          _asr = asr; _model = name;
          if (global.console) console.log('[transcriber] 사용 모델:', name, '/ device:', device);
          return _asr;
        } catch (e) {
          if (global.console) console.warn('[transcriber] 모델 로드/워밍업 실패 → 폴백:', name, e);
          _asr = null;
          // 다음 모델로 계속
        }
      }
      throw new Error('음성 변환 모델을 불러오지 못했습니다.');
    })();
    return _loading;
  }

  // 녹음 Blob → 16kHz 모노 Float32 (Whisper 입력 형식)
  async function _decodeTo16kMono(blob) {
    var AC = global.AudioContext || global.webkitAudioContext;
    var buf = await blob.arrayBuffer();
    var ac = new AC();
    var decoded;
    try {
      decoded = await ac.decodeAudioData(buf);
    } finally {
      try { ac.close(); } catch (e) {}
    }
    var OAC = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    var frames = Math.max(1, Math.ceil(decoded.duration * 16000));
    var off = new OAC(1, frames, 16000);           // 1채널(모노)+16k → 다운믹스+리샘플 동시
    var src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start(0);
    var rendered = await off.startRendering();
    return rendered.getChannelData(0);
  }

  async function transcribe(blob, onProgress) {
    var asr = await _ensure(onProgress);
    onProgress && onProgress({ phase: 'decode' });
    var audio = await _decodeTo16kMono(blob);
    onProgress && onProgress({ phase: 'transcribe' });
    var out = await asr(audio, {
      // 한국어 고정(자동감지가 한국어를 놓치는 오인식 방지) + 받아쓰기 작업 명시
      language: 'korean',
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
      temperature: 0,                 // 그리디 디코딩(무작위성 제거 → 재현성·정확도)
      no_repeat_ngram_size: 3,        // 같은 말 반복 오류 억제
      condition_on_previous_text: true
    });
    return ((out && out.text) || '').trim();
  }

  // 앱이 시작될 때 미리 모델을 데워두고 싶을 때(선택). 실패해도 무시.
  function warmup(onProgress) { return _ensure(onProgress).catch(function () {}); }

  function currentModel() { return _model ? _shortName(_model) : null; }

  global.TranscriberModule = {
    transcribe: transcribe, warmup: warmup,
    MODELS: MODELS, currentModel: currentModel
  };
})(window);
