/* ============================================================================
 * vad.js — 음성 대화 「말 끝 기다림」 판정(O-0177 ③, 2026-10-03)
 * ----------------------------------------------------------------------------
 * 녹음→PC 전사 경로(폰 받아쓰기 미지원·실패, PC판)에서 마이크 진폭(0~1)을 일정 간격으로 받아
 * 「말이 시작됐나 / 말이 끝났나」를 정한다. app.js pollAmp 가 쓰고, 시험(vad_sim_test.js)은 node 에서 이 파일을 그대로 불러 쓴다.
 *   · 소음 적응: 시작 CALIB_MS(0.5초) 동안 잡음 진폭을 모아 상위 80% 값을 잡음으로 보고
 *               말 판정선 = max(THRESH, 잡음×NOISE_MUL + NOISE_ADD), 상한 THRESH_MAX.
 *               측정하는 동안에는 THRESH×4 이상인 「확실한 말」만 말로 센다(잡음이 측정 중 말로 세져 바로 끝나는 일 방지).
 *   · 말 끝: 말이 시작된(MIN_SPEECH_MS 이상 소리) 뒤 SILENCE_MS 동안 조용하면 끝.
 *            말한 시간이 LONG_AFTER_MS 를 넘으면 SILENCE_LONG_MS 로(긴 말 중간에 잠깐 생각하며 쉬어도 덜 끊기게).
 *   · cfg 에 CALIB_MS·SILENCE_LONG_MS 가 없으면(옛 설정) 예전 판정과 똑같다(고정 판정선·고정 무음 시간).
 * ==========================================================================*/
(function (g) {
  'use strict';
  function create(cfg, t0) {
    return { cfg: cfg, t0: t0, last: t0, speechMs: 0, spoke: false, calib: [], thr: cfg.THRESH,
             calibDone: !cfg.CALIB_MS, noise: null };
  }
  // 진폭 1개 반영. 반환: null(계속) | 'silence'(말 끝) | 'nospeech'(말 없음) | 'max'(최대 길이)
  function step(s, level, now) {
    var c = s.cfg, el = now - s.t0, loud;
    if (!s.calibDone && el >= c.CALIB_MS) {
      s.calibDone = true;
      if (s.calib.length) {
        var a = s.calib.slice().sort(function (x, y) { return x - y; });
        var nz = a[Math.floor(0.8 * (a.length - 1))];
        s.noise = nz;
        s.thr = Math.min(c.THRESH_MAX || 1, Math.max(c.THRESH, nz * (c.NOISE_MUL || 1) + (c.NOISE_ADD || 0)));
      }
    }
    if (!s.calibDone) {
      if (level < c.THRESH * 4) s.calib.push(level);
      loud = level >= c.THRESH * 4;              // 측정 중엔 확실한 말만
    } else {
      loud = level >= s.thr;
    }
    if (loud) { s.last = now; s.speechMs += c.POLL; if (s.speechMs >= c.MIN_SPEECH_MS) s.spoke = true; }
    var need = (c.SILENCE_LONG_MS && s.speechMs >= c.LONG_AFTER_MS) ? c.SILENCE_LONG_MS : c.SILENCE_MS;
    if (s.spoke && (now - s.last) >= need) return 'silence';
    if (!s.spoke && el >= c.NOSPEECH_MS) return 'nospeech';
    if (el >= c.MAX_TURN_MS) return s.spoke ? 'max' : 'nospeech';
    return null;
  }
  var KVad = { create: create, step: step };
  g.KVad = KVad;
  if (typeof module !== 'undefined' && module.exports) module.exports = KVad;
})(typeof window !== 'undefined' ? window : globalThis);
