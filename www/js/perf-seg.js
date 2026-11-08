/* perf-seg.js — 홈 「성과」 안의 「실적 | 승진」 두 칸 알약과 쓰기 기록 (O-0782, v9.82)
 * 승진 점수판(promotion.js · promotion-calc.js)과 실적 화면(achievements.js)은 그대로 두 화면이고, 이 파일은 두 화면 머리줄 아래에 같은 알약을 하나씩 붙일 뿐이다.
 * 계산·서버·점수와 무관한 순수 DOM 이다. 모양은 건강 탭의 두 칸 알약(.hseg / .hseg-btn)을 그대로 쓴다(새 모양을 만들지 않는다).
 * 쓰기 기록(noteWrite/epoch): 실적 · 승진 화면이 서버에 「쓸」 때마다 숫자를 하나 올린다. 알약으로 화면을 바꿀 때 방금 읽은 자료가 그 사이 쓰기로 낡았는지 알아보는 데만 쓴다.
 * app.js 보다 앞에 불러와야 한다(없으면 app.js 가 옛 두 칸으로 둔다).
 * 쓰이는 곳: app.js(mount) · achievements.js · promotion.js(noteWrite · epoch). */
(function (global) {
  'use strict';
  var wn = 0;
  function noteWrite() { wn += 1; return wn; }
  function epoch() { return wn; }

  /* host 바로 앞(머리줄 아래)에 알약을 붙인다. active = 'ach' | 'promo' (그 화면이 지금 보여 주는 쪽), onPick(tab) = 다른 쪽을 눌렀을 때 */
  function mount(host, id, active, onPick) {
    if (!host || !host.parentNode || !id) return null;
    var old = document.getElementById(id); if (old && old.parentNode) old.parentNode.removeChild(old);
    var el = document.createElement('div');
    el.className = 'hseg perfseg'; el.id = id; el.setAttribute('role', 'tablist'); el.setAttribute('aria-label', '성과 보기');
    var spec = [['ach', '실적'], ['promo', '승진']], h = '', i;
    for (i = 0; i < spec.length; i++) {
      h += '<button type="button" class="hseg-btn' + (spec[i][0] === active ? ' on' : '') + '" data-perf="' + spec[i][0] + '" role="tab" aria-selected="' + (spec[i][0] === active ? 'true' : 'false') + '">' + spec[i][1] + '</button>';
    }
    el.innerHTML = h;
    el.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-perf]') : null; if (!b || !el.contains(b)) return;
      var t = b.getAttribute('data-perf');
      if (t === active) return;                      // 지금 보고 있는 쪽을 또 누르면 아무 일도 없다
      if (typeof onPick === 'function') onPick(t);
    });
    host.parentNode.insertBefore(el, host);
    return el;
  }
  global.PerfSeg = { mount: mount, noteWrite: noteWrite, epoch: epoch };
})(typeof window !== 'undefined' ? window : globalThis);
