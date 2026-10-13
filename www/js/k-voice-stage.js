/* k-voice-stage.js — (O-0490) 케이 목소리 고르는 화면 「케이 무대」.
 *
 * 왜: 목소리가 24개(여자 12 · 남자 12)로 늘면 꾸미기 「설정」의 줄 목록이 화면 두 장 반이 된다. 그래서 「설정」에는 한 줄(지금 목소리)만 두고,
 *     누르면 이 화면이 열린다. 케이가 「지금 목소리」 카드를 손으로 소개하고, 아래 판의 번호를 누르면 그 목소리로 고르면서 예시를 들려준다.
 * 나눠 맡는 일:
 *   · app.js(「O-0490」 블록) — PC 가 내려 준 목록 읽기 · 고르기 요청 · 예시 소리 · 녹음 중 확인 · 미리 받기. 예전부터 있던 함수(kvTap · kvPick …)를 그대로 쓴다.
 *   · 이 파일 — 화면만 그린다. 자료는 api.state() 로 받고, 번호를 누르면 api.tap(열쇠)을 부른다. 글자는 지어내지 않는다:
 *       고른 목소리 아래 안내 한 줄 = PC 가 보낸 scope 글 그대로 · 예시 문장 = PC 가 보낸 sample_text · 못 쓰는 사유 = PC 가 보낸 why.
 * 화면 짜임: 꾸미기 화면 위에 덮는 한 장(문서 맨 바깥 · z-index 850 — 녹음 띠(900)·확인 창(1000~)·알림 글보다 아래).
 *   꾸미기 화면이 닫히면(녹음 띠 · 바로가기 · 알림으로 다른 화면에 갈 때) 스스로 닫힌다(MutationObserver). 닫을 때 예시 소리를 멈춘다.
 * 번호판: 「여자」「남자」 두 판을 늘 그린다(판마다 12칸). 목록에 없는 번호는 점선으로 「준비 중인 자리」. 13번째부터는 줄이 늘어난다.
 *   묶음·번호는 이름(「여자7」)에서 뽑는다. 이름이 그 모양이 아닌 줄은 맨 아래 「그 밖」 판에 이름으로 그린다(지금 PC 는 그런 줄을 보내지 않는다).
 * 케이 그림: KScene.figHtml('guide') — 그 옷의 「안내 손짓」 그림(KChar.poseUrl). 아직 못 받았거나 없는 옷이면 그 옷의 표정 사진을 액자처럼 세우고,
 *   받아지면 KScene.repaint 가 바꿔 끼운다(파일 이름을 여기서 조립하지 않는다).
 * 스위치(app.js): KV_UI 'list' 면 init 이 불리지 않는다 = 이 파일이 없는 것과 같다.
 */
(function () {
  'use strict';
  var api = null, root = null, el = {}, shown = false, closing = 0;
  var sig = '', lastShown = '', lastNote = '', seenJust = '', okOn = false, okT = 0, hint = null, hintT = 0, why = '', whyT = 0, badAck = '';
  var HOW = '번호를 누르면 예시를 들려 드리고 그 목소리로 바꿉니다. 다시 누르면 멈춥니다.';
  var AI = '모두 자비스 AI 음성입니다';
  var SAY = '안녕하세요, 케이입니다.';
  var OWN = '대표님';                        // 본인 목소리(tag self) 꼬리표에 적는 화면 글 — 이 한 곳에서만 정한다(번호판 · 카드 · 설정의 한 줄이 함께 쓴다)
  var PADS = ['여자', '남자'], SLOTS = 12, MAX_N = 36;   // 늘 그리는 두 판 · 판마다 자리 수(더 큰 번호가 오면 그만큼 늘어난다 · 36번까지 — 그 위는 「그 밖」 판)
  var OK_MS = 1500, HINT_MS = 2200, WHY_MS = 3200;

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function calm() { try { return !!(window.KScene && KScene.calm && KScene.calm()); } catch (e) { return false; } }
  function retrig(n, cls) { if (!n) return; n.classList.remove(cls); if (calm()) return; void n.offsetWidth; n.classList.add(cls); }
  var G = {
    bolt: '<path d="M13.5 2L4 14h6.2L9 22l10-12.5h-6.4z" fill="currentColor"/>',
    clock: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="M12 7v5.4l3.4 2" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
    mute: '<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M17 9.5l5 5M22 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    stop: '<rect x="4" y="4" width="16" height="16" rx="3.5" fill="currentColor"/>',
    ai: '<path d="M12 2l2.3 6.6L21 11l-6.7 2.4L12 20l-2.3-6.6L3 11l6.7-2.4z" fill="currentColor"/>',
    back: '<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'
  };
  function glyph(name, cls) { return '<svg' + (cls ? ' class="' + cls + '"' : '') + ' viewBox="0 0 24 24" aria-hidden="true">' + G[name] + '</svg>'; }
  // 빠름 / 느림 꼬리표(설정의 한 줄도 이 모양을 쓴다 — app.js 가 KVStage.spdHtml 로 부른다)
  function spdHtml(kind) {
    if (kind !== 'fast' && kind !== 'slow') return '';
    return '<span class="kv-spd ' + kind + '">' + glyph(kind === 'fast' ? 'bolt' : 'clock') + (kind === 'fast' ? '빠름' : '느림') + '</span>';
  }

  function ownHtml(long) { return '<span class="kv-spd own">' + OWN + (long ? ' 목소리' : '') + '</span>'; }   // 본인 목소리 꼬리표(설정의 한 줄은 「… 목소리」까지)

  /* ---- 목록 → 판 ---- */
  function parse(name) { var m = /^(.*?)\s*(\d{1,2})$/.exec(String(name || '')); return (m && m[1].trim() && +m[2] >= 1) ? { g: m[1].trim(), n: +m[2] } : null; }
  function padsOf(list) {
    var pads = PADS.map(function (g) { return { name: g, by: {}, max: SLOTS }; }), idx = {}, rest = [];
    pads.forEach(function (p) { idx[p.name] = p; });
    list.forEach(function (r) {
      var p = parse(r.name), pad = p ? idx[p.g] : null;
      if (p && !pad) { pad = idx[p.g] = { name: p.g, by: {}, max: 0 }; pads.push(pad); }     // 「여자」「남자」가 아닌 새 묶음이 오면 판을 하나 더
      if (pad && p.n <= MAX_N && !pad.by[p.n]) { pad.by[p.n] = r; if (p.n > pad.max) pad.max = p.n; return; }
      rest.push(r);
    });
    if (rest.length) pads.push({ name: '그 밖', rest: rest });
    return pads;
  }
  function chipHtml(r, label, textual) {
    var kind = (r.kind === 'fast' || r.kind === 'slow') ? r.kind : '';
    return '<button type="button" class="kvc' + (kind ? ' ' + kind : '') + (r.self ? ' own' : '') + '" data-kvs="' + esc(r.k) + '">' +
      '<span class="kvc-rp"></span><span class="kvc-n' + (textual ? ' tx' : '') + '">' + esc(label) + '</span>' +
      (kind ? glyph(kind === 'fast' ? 'bolt' : 'clock', 'kvc-g') : '') + glyph('stop', 'kvc-sp') +
      (r.sample ? '' : glyph('mute', 'kvc-x')) +
      '<span class="kvc-eq" aria-hidden="true"><i></i><i></i><i></i></span>' +
      (r.self ? '<span class="kvc-own">' + OWN + '</span>' : '') + '</button>';
  }
  function padsHtml(pads) {
    return pads.map(function (p) {
      if (p.rest) return '<div class="kvs-pad rest"><h4>' + esc(p.name) + '</h4><div class="kvs-pg">' + p.rest.map(function (r) { return chipHtml(r, r.name, true); }).join('') + '</div></div>';
      var out = [], n;
      for (n = 1; n <= p.max; n++) {
        if (p.by[n]) out.push(chipHtml(p.by[n], n, false));
        else out.push('<button type="button" class="kvc ghost" aria-disabled="true" data-kvghost="' + esc(p.name + n) + '" aria-label="' + esc(p.name + n) + ' · 준비 중인 자리"><span class="kvc-n">' + n + '</span></button>');
      }
      return '<div class="kvs-pad"><h4>' + esc(p.name) + '<small>1 – ' + p.max + '</small></h4><div class="kvs-pg">' + out.join('') + '</div></div>';
    }).join('');
  }
  function rowOf(blk, k) { for (var i = 0; i < blk.list.length; i++) if (blk.list[i].k === k) return blk.list[i]; return null; }

  /* ---- 화면 틀(처음 열 때 한 번) ---- */
  function build() {
    if (root) return true;
    if (!document.body) return false;
    root = document.createElement('div');
    root.id = 'kVoiceStage'; root.className = 'kvs'; root.tabIndex = -1;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', '케이 목소리 고르기');
    root.innerHTML =
      '<div class="kvs-in">' +
        '<div class="kvs-stage">' +
          '<div class="kvs-bar"><button type="button" class="kvs-back" data-kvs-back>' + glyph('back') + '뒤로</button><span class="kvs-title">케이 목소리</span><span class="kvs-sp"></span></div>' +
          '<div class="kvs-figw" aria-hidden="true"></div>' +
          '<div class="kvs-card" role="status" aria-live="polite">' +
            '<small class="kvs-lb">지금 목소리</small><span class="kvs-nm"></span>' +
            '<div class="kvs-row"><span class="kvs-tags"></span><span class="kvs-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span></div>' +
            '<div class="kvs-say"></div>' +
          '</div>' +
          '<span class="kvs-ai">' + glyph('ai') + '<span></span></span>' +
        '</div>' +
        '<div class="kvs-sheet">' +
          '<div class="kvs-grab"></div>' +
          '<div class="kvs-how">' + esc(HOW) + '</div>' +
          '<div class="kvs-pads"></div>' +
          '<div class="kvs-note" role="status"></div>' +
          '<div class="kvs-legend"></div>' +
          '<div class="kvs-more"></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);
    ['stage', 'figw', 'card', 'lb', 'nm', 'tags', 'say', 'pads', 'note', 'legend', 'more'].forEach(function (k) { el[k] = root.querySelector('.kvs-' + k); });
    el.ai = root.querySelector('.kvs-ai span');
    root.addEventListener('click', onClick);
    root.addEventListener('pointerdown', onDown);
    root.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && shown) { ev.preventDefault(); close(); } });
    // 꾸미기 화면이 다른 길로 닫히면(녹음 띠 · 바로가기 · 알림) 이 화면도 닫는다
    var view = document.getElementById('kWardrobeView');
    if (view && window.MutationObserver) {
      try { new MutationObserver(function () { if (shown && view.style.display === 'none') close(true); }).observe(view, { attributes: true, attributeFilter: ['style'] }); } catch (e) {}
    }
    document.addEventListener('visibilitychange', function () { if (document.hidden && shown && api) { try { api.stop(); } catch (e) {} paint(); } });   // 앱이 뒤로 가면 예시 소리를 멈춘다
    return true;
  }
  function paintFig() {
    if (!el.figw) return;
    var html = '';
    try { if (window.KScene && KScene.figHtml) html = KScene.figHtml('guide', 'kvs-k'); } catch (e) { html = ''; }
    el.figw.innerHTML = html;
  }

  /* ---- 그리기 ---- */
  function listSig(blk) { return blk.list.map(function (r) { return [r.k, r.name, r.kind || '', r.sample ? 1 : 0, r.self ? 1 : 0].join(':'); }).join('|'); }
  function paint() {
    if (!shown || !root || !api) return;
    var st = api.state(), cur = st && st.cur;
    if (!cur) { close(true); return; }                 // 목록이 사라졌다(연동 암호 지움 · PC 가 칸을 주지 않음) → 설정의 한 줄이 사실을 적는다
    var blk = cur.blk, chosen = rowOf(blk, blk.chosen) || blk.list[0];
    root.classList.toggle('calm', calm());
    // 번호판: 목록이 달라졌을 때만 새로 짠다(누를 때마다 다시 짜면 물결·튀는 움직임이 끊긴다)
    var s = listSig(blk), pads = null;
    if (s !== sig) { pads = padsOf(blk.list); el.pads.innerHTML = padsHtml(pads); sig = s; }
    el.pads.classList.toggle('down', !!cur.down);
    var hasGhost = false;
    Array.prototype.forEach.call(el.pads.querySelectorAll('.kvc'), function (b) {
      if (b.classList.contains('ghost')) { hasGhost = true; return; }
      var k = b.getAttribute('data-kvs'), r = rowOf(blk, k); if (!r) return;
      var on = k === blk.chosen, pv = k === st.pvKey, pend = k === st.pendKey;
      b.classList.toggle('on', on); b.classList.toggle('pv', pv); b.classList.toggle('pend', pend);
      b.classList.toggle('just', k === st.just && !calm());
      b.classList.toggle('bad', !r.ok && !on && !pend);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.setAttribute('aria-label', r.name + (r.self ? ' · ' + OWN + ' 목소리' : '') + (r.kind === 'fast' ? ' · 빠름' : (r.kind === 'slow' ? ' · 느림' : '')) +
        (r.ok ? '' : ' · 지금은 쓸 수 없습니다') + (r.sample ? '' : ' · 예시 준비 중') + (pend ? ' · 바꾸는 중' : '') + (pv ? ' · 예시를 들려 드리는 중 · 누르면 멈춥니다' : ''));
    });
    // 방금 확정됐다 → 「지금 목소리」 자리에 1.5초 동안 「바꿨습니다 ✓」(아래쪽 알림 글은 번호판을 가려서 쓰지 않는다)
    if (st.just && st.just !== seenJust) {
      okOn = true; clearTimeout(okT);
      okT = setTimeout(function () { okOn = false; paint(); }, OK_MS);
    }
    seenJust = st.just || '';
    // 「지금 목소리」 카드: 바꾸는 중이면 마지막에 누른 번호를 먼저 보인다
    var showK = st.pendKey || blk.chosen, sv = rowOf(blk, showK) || chosen, changed = showK !== lastShown;
    lastShown = showK;
    el.lb.textContent = st.pendKey ? (st.pendNote || '바꾸는 중…') : (okOn ? '바꿨습니다 ✓' : '지금 목소리');
    el.lb.classList.toggle('pend', !!st.pendKey); el.lb.classList.toggle('ok', !st.pendKey && okOn);
    if (el.nm.textContent !== sv.name) el.nm.textContent = sv.name;
    el.tags.innerHTML = spdHtml(sv.kind) + (sv.self ? ownHtml(false) : '');   // 번호판의 꼬리표와 같은 낱말(카드 폭에 한 줄로 들어가게)
    if (changed) { retrig(el.card, 'swap'); retrig(el.nm, 'swap'); }
    var pvRow = st.pvKey ? rowOf(blk, st.pvKey) : null, say = blk.say || SAY, sayHtml;
    if (hint && hint.ghost) sayHtml = esc(hint.ghost) + ' 자리는<small>아직 준비 중입니다</small>';
    else {
      var sr = pvRow || (hint && rowOf(blk, hint.k)) || sv;
      sayHtml = sr.sample ? '「' + esc(say) + '」' : '예시는 준비 중입니다<small>목소리는 고를 수 있습니다</small>';
    }
    if (el.say.innerHTML !== sayHtml) el.say.innerHTML = sayHtml;
    el.stage.classList.toggle('talk', !!st.pvKey);
    el.ai.textContent = blk.ai || AI;
    // 고른 목소리 아래 한 줄: PC 가 보낸 scope 글 그대로(느린 목소리면 주황 띠만 입힌다). 고르지 못하는 사정이 있으면 그 사실이 먼저
    var whyRow = why ? rowOf(blk, why) : null, note = '', cls = '';
    if (cur.down) { note = 'PC가 꺼져 있어 지금은 바꿀 수 없습니다. PC가 켜지면 바꿀 수 있습니다.'; cls = 'warn'; }
    else if (whyRow && !whyRow.ok) { note = whyRow.name + ' — ' + (whyRow.why || '지금은 쓸 수 없습니다'); cls = 'warn'; }
    else if (!chosen.ok) { note = '지금은 쓸 수 없습니다 — ' + (chosen.why || '잠시 쉬는 중입니다'); cls = 'warn'; }
    else if (st.pvBad && st.pvBad !== badAck && rowOf(blk, st.pvBad)) { note = '예시 소리를 받아 오지 못했습니다. 잠시 뒤 다시 눌러 주십시오.'; cls = 'warn'; }
    else { note = blk.scope; cls = chosen.kind === 'slow' ? 'slow' : ''; }
    var key = cls + '|' + note;
    el.note.style.display = note ? '' : 'none';
    if (key !== lastNote) {
      el.note.className = 'kvs-note' + (cls ? ' ' + cls : '');
      el.note.innerHTML = (cls === 'slow' ? glyph('clock') : '') + '<span>' + esc(note) + '</span>';
      if (lastNote) retrig(el.note, 'swap');
      lastNote = key;
    }
    // 범례(앱이 적는 고정 글) — 「한 문장 15~30초」는 PC 의 줄 설명(desc)과 같은 값이다: 바뀌면 두 곳을 함께 고친다
    var lg = '<span><i class="fast"></i>빠름 · 누르면 바로 읽음</span>' +
      '<span>' + glyph('mute') + '예시 준비 중 · 고르기는 됨</span>' +
      '<span><i class="slow"></i>느림 · 만드는 데 시간이 걸림(한 문장 15~30초)</span>' +
      (hasGhost ? '<span><i class="ghost"></i>점선 · 아직 준비 중인 자리</span>' : '');
    if (el.legend.innerHTML !== lg) el.legend.innerHTML = lg;
    var more = (blk.fb > 0 ? '<span>오늘 다른 목소리로 대신 읽은 것 ' + blk.fb + '번</span>' : '') +
      (blk.limit ? '<span>' + esc(blk.limit) + '</span>' : '') + (blk.note ? '<span>' + esc(blk.note) + '</span>' : '');
    if (el.more.innerHTML !== more) el.more.innerHTML = more;
  }

  /* ---- 누름 ---- */
  function setHint(h) { clearTimeout(hintT); hint = h; if (h) hintT = setTimeout(function () { hint = null; paint(); }, HINT_MS); }
  function setWhy(k) { clearTimeout(whyT); why = k || ''; if (why) whyT = setTimeout(function () { why = ''; paint(); }, WHY_MS); }
  function onClick(ev) {
    var t = ev.target; if (!t || !t.closest) return;
    if (t.closest('[data-kvs-back]')) { close(); return; }
    var gh = t.closest('[data-kvghost]');
    if (gh) { setWhy(''); setHint({ ghost: gh.getAttribute('data-kvghost') }); paint(); return; }
    var b = t.closest('[data-kvs]'); if (!b || !api) return;
    var k = b.getAttribute('data-kvs'), st = api.state(), r = (st && st.cur) ? rowOf(st.cur.blk, k) : null; if (!r) return;
    var stopping = st.pvKey === k;                     // 소리 나는 번호를 다시 눌렀다 = 멈춤
    setHint((!r.sample && !stopping) ? { k: k } : null);
    setWhy(r.ok ? '' : k);
    badAck = (st.pvBad && st.pvBad !== k) ? st.pvBad : '';   // 다른 번호를 누르면 앞 번호의 「예시를 받아 오지 못했습니다」는 내린다(그 번호를 다시 눌러 또 못 받으면 다시 적는다)
    api.tap(k);                                        // 고르기 + 예시(app.js kvTap — 녹음 중 확인 · 앞 소리 멈춤 · 연달아 누르기까지 그쪽이 맡는다)
    paint();
  }
  function onDown(ev) {                                // 누른 자리에서 번지는 물결(0.3초 · 움직임을 쉬는 때에는 없음)
    var b = ev.target && ev.target.closest && ev.target.closest('.kvc'); if (!b || b.classList.contains('ghost') || calm()) return;
    var box = b.querySelector('.kvc-rp'); if (!box) return;
    var r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2.2, s = document.createElement('i');
    s.style.width = s.style.height = d + 'px'; s.style.left = (ev.clientX - r.left - d / 2) + 'px'; s.style.top = (ev.clientY - r.top - d / 2) + 'px';
    box.appendChild(s); setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 360);
  }

  /* ---- 열고 닫기 ---- */
  function under(on) {                                 // 뒤에 깔린 화면은 읽어 주는 프로그램 · 키보드가 지나치게(inert)
    try { var a = document.querySelector('.app'); if (a) { if (on) a.setAttribute('inert', ''); else a.removeAttribute('inert'); } } catch (e) {}
  }
  function open() {
    if (!api || !build()) return false;
    var st = api.state(); if (!st || !st.cur) return false;
    clearTimeout(closing);
    if (shown) return true;
    shown = true; sig = ''; lastShown = st.pendKey || st.cur.blk.chosen; lastNote = ''; seenJust = st.just || ''; okOn = false; hint = null; why = ''; badAck = st.pvBad || '';
    paintFig();
    root.classList.toggle('calm', calm());
    root.classList.add('show'); root.scrollTop = 0;
    void root.offsetWidth;                             // 판이 아래에서 올라오는 움직임이 처음부터 보이게
    root.classList.add('open');
    under(true);
    try { root.focus({ preventScroll: true }); } catch (e) {}
    paint();
    try { api.opened(); } catch (e) {}                 // PC 상태 한 번 읽기 + 예시 소리 미리 받기(두 개씩)
    return true;
  }
  function close(now) {
    if (!shown) return;
    shown = false;
    clearTimeout(okT); clearTimeout(hintT); clearTimeout(whyT); okOn = false; hint = null; why = '';
    try { if (api) api.stop(); } catch (e) {}          // 화면을 떠나면 예시 소리를 멈춘다
    under(false);
    root.classList.remove('open');
    clearTimeout(closing);
    if (now || calm()) root.classList.remove('show');
    else closing = setTimeout(function () { if (!shown) root.classList.remove('show'); }, 200);
    try { if (api) api.closed(); } catch (e) {}        // 설정의 한 줄을 지금 값으로
    if (!now) { try { var o = document.querySelector('#kwVoices [data-kvopen]'); if (o) o.focus({ preventScroll: true }); } catch (e) {} }   // 키보드(PC판)로 쓰던 자리로 돌려 놓는다
  }

  window.KVStage = {
    init: function (a) { api = a || null; },
    open: open, close: close, paint: paint, spdHtml: spdHtml, ownHtml: ownHtml,
    isOpen: function () { return shown; }
  };
})();
