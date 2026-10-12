/* k-wardrobe-follow.js — (O-0471) 케이 꾸미기: 옷 목록을 아래로 내려도 「지금 모습」(상반신 + 전신)이 따라온다.
 *
 * 왜: 옷이 20벌로 늘어 목록이 길다. 입힐 때마다 맨 위로 올려 확인하지 않아도, 누른 자리에서 바뀐 모습이 보이게 한다.
 * 어떻게(대표님이 시안 세 가지 가운데 고르신 「가안」):
 *   「옷」 탭에서 화면을 내리면 위 사진(#kwHero)이 줄어들며 [뒤로] 줄 밑에 붙는다. 맨 위로 올리면 원래 크기로 돌아온다.
 *   새 사진 칸을 만들지 않고 그 사진 그 자체를 붙인다 → 갈아입는 효과(KMotion.outfitSwap) · 전신 인사(O-0464)가 붙은 자리에서 그대로 돈다.
 *   넓은 화면(폭 700 이상 = 홈이 2단이 되는 폭과 같다)은 왼쪽에 사진을 붙여 두고 오른쪽에서 고른다(opt.wide — 따로 끌 수 있다).
 *   「설정」 탭은 예전 짜임 그대로. 다만 올렸을 때 사진이 [뒤로] 줄 뒤로 비치던 것은 서서히 사라지게 한다(opt.setFade).
 *
 * 줄어드는 움직임은 누가 돌리나 — 폰에서 떨리지 않게:
 *   스크롤은 폰이 따로(화면 합성 쪽에서) 돌리고 스크립트는 그 뒤를 한 박자 늦게 따라간다. 스크롤마다 스크립트가 크기를 고치면 빠르게 튕겨 내릴 때 사진 아래 끝이 떨릴 수 있다.
 *   그래서 줄어듦 · 옅어짐은 CSS 「스크롤에 붙여 도는 움직임」(animation-timeline: scroll())에 맡긴다 — 스크롤과 같은 곳에서 돌아 늦지 않는다.
 *   스크립트는 「어디서부터 어디까지 줄어드는지」(--kwf-a · --kwf-b)와 크기 값만 적어 두고, 스크롤 중에는 문턱을 넘을 때 표시(html.kwf-docked) 하나만 붙였다 뗀다.
 *   그 CSS 가 없는 옛 웹뷰 · 폰 「움직임 줄이기」(앱이 CSS 움직임을 모두 끈다)에서만 예전처럼 스크립트가 스크롤마다 한 번(requestAnimationFrame) 값을 적는다.
 *
 * app.js 가 부르는 곳은 init 한 번뿐이다 — 화면이 열리고 닫히는 것 · 탭 · 옷 바뀜 · 녹음 띠 · 글자 크기는 여기서 지켜본다(MutationObserver).
 * 스위치(app.js): KW_FOLLOW 'off' 면 init 이 아무것도 만들지 않는다 = 이 파일이 없는 것과 같다.
 */
(function () {
  'use strict';
  var de = document.documentElement;
  var mode = 'off', opt = {}, state = '', built = false, queued = false, wideMQ = null, calmMQ = null, cssOk = false;
  var view, hero, seg, paneOutfit, grid, dock, card, lab, labName, labTip;
  var geoKey = '', aPx = 0, bPx = 1, lastP = -1, lastFade = -1, labKey = '', waitId = '', waitTimer = null;
  var TIP = '전신 · 눌러 보세요';

  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function shown(el) { return !!el && el.style.display !== 'none'; }
  function calm() { try { return !!(window.KMotion && KMotion.calm && KMotion.calm()); } catch (e) { return false; } }
  function mq(m) { return !!(m && m.matches); }
  function listen(m) { if (m) try { (m.addEventListener ? m.addEventListener('change', req) : m.addListener(req)); } catch (e) {} }

  function build() {
    view = $('kWardrobeView'); hero = $('kwHero');
    if (!view || !hero) return false;
    seg = view.querySelector('.kw-seg'); paneOutfit = $('kwOutfitPane'); grid = $('kwGrid');
    // 줄어든 사진 뒤에 까는 판 + 옷 이름(사진 안의 작은 글자는 줄어들면 읽히지 않으므로 제 크기 글자로 한 번 더). 읽어 주는 프로그램에는 숨긴다(사진 쪽에 같은 이름이 있다)
    dock = document.createElement('div'); dock.className = 'kwf-dock'; dock.setAttribute('aria-hidden', 'true');
    dock.innerHTML = '<div class="kwf-card"><div class="kwf-lab"><small>지금 모습</small><b></b><span class="kwf-tip"></span></div></div>';
    hero.parentNode.insertBefore(dock, hero);
    card = dock.firstChild; lab = card.firstChild; labName = lab.querySelector('b'); labTip = lab.querySelector('.kwf-tip');
    try { wideMQ = window.matchMedia('(min-width:700px)'); calmMQ = window.matchMedia('(prefers-reduced-motion: reduce)'); } catch (e) {}
    listen(wideMQ); listen(calmMQ);
    try { cssOk = !!(window.CSS && CSS.supports && CSS.supports('animation-timeline: scroll()')); } catch (e) { cssOk = false; }
    window.addEventListener('scroll', req, { passive: true });
    window.addEventListener('resize', req, { passive: true });
    if (window.MutationObserver) {
      var mo = new MutationObserver(req);
      mo.observe(view, { attributes: true, attributeFilter: ['style'] });                         // 화면이 열리고 닫힘
      if (paneOutfit) mo.observe(paneOutfit, { attributes: true, attributeFilter: ['style'] });   // 「옷 / 설정」 탭
      mo.observe(hero, { attributes: true, attributeFilter: ['class'] });                         // 전신이 있는 옷 / 없는 옷
      if ($('kwCurName')) mo.observe($('kwCurName'), { childList: true, characterData: true, subtree: true });   // 옷이 바뀜
      if ($('kwFullTip')) mo.observe($('kwFullTip'), { attributes: true, attributeFilter: ['style'] });           // 인사를 틀 수 있는 옷인가
      mo.observe(de, { attributes: true, attributeFilter: ['class', 'data-fs'] });                // 녹음 띠(html.rec-band) · 글자 크기
    }
    // 서버에서 받는 옷을 처음 눌렀을 때: 다 받을 때까지는 입고 있던 옷이 그대로 보인다 → 누른 칸과 판에 「받는 중」을 적어 둔다(app.js 의 누름 처리가 끝난 뒤에 본다)
    if (grid) grid.addEventListener('click', function (ev) {
      var it = ev.target && ev.target.closest ? ev.target.closest('[data-outfit]') : null; if (!it) return;
      var id = it.getAttribute('data-outfit'), before = '';
      try { before = window.KChar ? KChar.outfit().id : ''; } catch (e) {}
      setTimeout(function () { try { markWait(id, before); } catch (e) {} }, 0);
    });
    built = true;
    return true;
  }
  function req() { if (!queued) { queued = true; requestAnimationFrame(sync); } }

  /* ---------- 서버 옷 「받는 중」 ---------- */
  function outfitById(id) { var l = (window.KChar && KChar.outfits) ? KChar.outfits() : []; for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
  function markWait(id, before) {
    if (mode === 'off' || !window.KChar) return;
    var o = outfitById(id), cur = KChar.outfit().id;
    if (!o || !o.pending || cur === id) {                  // 받는 옷이 아니다: 이 누름으로 다른 옷을 입었으면(받던 옷은 접힌다) 표시를 거둔다
      if (waitId && cur !== before) clearWait();
      return;
    }
    waitId = id;
    if (waitTimer) clearTimeout(waitTimer);
    waitTimer = setTimeout(clearWait, 30000);            // 끝내 못 받으면(연결 끊김) 표시를 거둔다 — 옷은 그대로다
    paintWait(); req();
  }
  function clearWait() { waitId = ''; if (waitTimer) { clearTimeout(waitTimer); waitTimer = null; } paintWait(); req(); }
  function paintWait() {
    if (!grid) return;
    Array.prototype.forEach.call(grid.querySelectorAll('.kw-item.kwf-wait'), function (e) { if (e.getAttribute('data-outfit') !== waitId) e.classList.remove('kwf-wait'); });
    if (waitId) { var it = grid.querySelector('[data-outfit="' + waitId.replace(/"/g, '') + '"]'); if (it && !it.classList.contains('kwf-wait')) it.classList.add('kwf-wait'); }
  }

  function clearInline() {
    ['--kwf-a', '--kwf-b', '--kwf-smin', '--kwf-h', '--kwf-w', '--kwf-s', '--kwf-p', '--kwf-l'].forEach(function (k) { view.style.removeProperty(k); });
    hero.style.opacity = '';
    if (de.classList.contains('kwf-docked')) de.classList.remove('kwf-docked');
    geoKey = ''; lastP = -1; lastFade = -1; labKey = '';
  }
  function apply(st) {
    state = st;
    clearInline();
    de.classList.toggle('kwf-on', !!st);
    de.classList.toggle('kwfm-dock', st === 'dock');
    de.classList.toggle('kwf-wide', st === 'wide');
    if (!st && de.classList.contains('kwf-css')) de.classList.remove('kwf-css');   // 닫히면 표시를 모두 거둔다
    if (st) { setTimeout(req, 400); setTimeout(req, 900); }   // 여는 효과(탭 줄 · 목록이 잠깐 밀려 들어온다)가 끝난 뒤 자리를 한 번 더 잰다
  }
  function sync() {
    queued = false;
    if (!built) return;
    var isOpen = shown(view) && mode !== 'off';
    var tab = (paneOutfit && !shown(paneOutfit)) ? 'set' : 'outfit', ih = window.innerHeight;
    // 넓은 화면 = 왼쪽에 붙여 두기 · 그 밖의 「옷」 탭 = 줄어들며 붙기 · 「설정」 탭 = 예전 짜임(+ 사진 옅어짐) · 화면이 아주 낮으면(가로로 눕힌 폰) 예전 그대로(plain)
    var st = !isOpen ? '' : (opt.wide !== false && mq(wideMQ) && ih >= 420) ? 'wide' : tab === 'set' ? 'set' : ih >= 560 ? 'dock' : 'plain';
    if (st !== state) apply(st);
    if (!st) { if (waitId) clearWait(); return; }
    // CSS 가 돌릴 수 있으면 CSS 에 맡긴다(폰 「움직임 줄이기」에서는 앱이 CSS 움직임을 모두 끄므로 스크립트가 맡는다)
    var useCss = cssOk && opt.css !== false && !mq(calmMQ);
    if (de.classList.contains('kwf-css') !== useCss) { de.classList.toggle('kwf-css', useCss); lastP = -1; }
    paint();
    measure();
  }

  // 옷 이름 · 안내를 판에 옮겨 적는다(값은 app.js 가 그린 것을 그대로 읽는다 — 따로 정하지 않는다)
  function paint() {
    var nm = $('kwCurName') ? $('kwCurName').textContent : '';
    if (waitId && window.KChar && KChar.outfit().id === waitId) { waitId = ''; if (waitTimer) { clearTimeout(waitTimer); waitTimer = null; } }   // 다 받아 입혔다
    paintWait();
    if (labName.textContent !== nm) {
      var first = !labName.textContent; labName.textContent = nm;
      if (!first && state === 'dock' && lastP > .5 && !calm() && labName.animate) {
        try { labName.animate([{ transform: 'translateY(6px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' }); } catch (e) {}
      }
    }
    var tip = $('kwFullTip'), w = waitId ? outfitById(waitId) : null;
    var tx = w ? ('「' + w.name + '」 받는 중…') : ((hero.classList.contains('has-fb') && tip && tip.style.display !== 'none') ? TIP : '');
    if (labTip.textContent !== tx) labTip.textContent = tx;
    lab.classList.toggle('wait', !!w);
  }
  // 판의 글자가 넘치면(글자 크기 「아주 크게」 · 낮은 화면 · 긴 옷 이름) 덜 중요한 줄부터 접는다: 「지금 모습」 → 안내. 옷 이름은 끝까지 남긴다
  function fitLab() {
    var key = labName.textContent + '|' + labTip.textContent + '|' + (de.getAttribute('data-fs') || '') + '|' + geoKey;
    if (key === labKey) return;
    labKey = key;
    lab.classList.remove('t1'); lab.classList.remove('t2');
    if (lab.scrollHeight > lab.clientHeight + 1) { lab.classList.add('t1'); if (lab.scrollHeight > lab.clientHeight + 1) lab.classList.add('t2'); }
  }

  function headBottom() {                                // 붙어 있는 [뒤로] 줄의 아래 끝(상태바 + 녹음 띠 + 줄 높이)
    var sb = view.querySelector('.subbar'), t = sb ? parseFloat(getComputedStyle(sb).top) : 0;
    return (isNaN(t) ? 0 : t) + (sb ? sb.offsetHeight : 56);
  }
  function measure() {
    var r, hb, sy = window.pageYOffset || de.scrollTop || 0;
    if (state === 'dock') {
      var H = hero.offsetHeight, W = hero.offsetWidth; if (!H || !seg) return;
      var T = parseFloat(getComputedStyle(hero).top); if (isNaN(T)) T = headBottom() + 4;
      var size = +opt.size > 0 ? +opt.size : .2;          // 붙은 사진의 높이 = 화면 높이 × size (app.js KW_FOLLOW_SIZE)
      var hmin = Math.round(Math.min(clamp(window.innerHeight * size, 132, 260), H * .9));
      // 붙지 않았다면 사진이 있을 자리(문서 기준) — 바로 아래 탭 줄에서 거꾸로 잰다(사진은 붙어 있어도 탭 줄은 제자리에서 흐른다)
      var natTop = seg.getBoundingClientRect().top + sy - (parseFloat(getComputedStyle(seg).marginTop) || 0) - H;
      var a = Math.round(natTop - T), b = a + (H - hmin);
      var key = [H, W, hmin, a, b].join('/');
      if (key !== geoKey) {                               // 자리가 바뀔 때만 적는다(화면이 열림 · 돌림 · 녹음 띠 · 전신 없는 옷) — 스크롤 중에는 적지 않는다
        geoKey = key; aPx = a; bPx = Math.max(b, a + 1); lastP = -1;
        view.style.setProperty('--kwf-a', a + 'px'); view.style.setProperty('--kwf-b', bPx + 'px');
        view.style.setProperty('--kwf-smin', (hmin / H).toFixed(4));
        view.style.setProperty('--kwf-h', hmin + 'px'); view.style.setProperty('--kwf-w', Math.round(W * hmin / H) + 'px');
      }
      fitLab();
      var p = clamp((sy - aPx) / (bPx - aPx), 0, 1);
      if (Math.abs(p - lastP) < .002 && lastP >= 0) return;
      var was = lastP; lastP = p;
      if ((p > .02) !== (was > .02) || was < 0) de.classList.toggle('kwf-docked', p > .02);     // [뒤로] 줄 뒤 덮개(문턱에서 한 번)
      if (de.classList.contains('kwf-css')) return;       // 줄어듦 · 옅어짐은 CSS 가 스크롤에 붙여 돌린다
      view.style.setProperty('--kwf-s', (1 - p * (1 - hmin / H)).toFixed(4));
      view.style.setProperty('--kwf-p', p.toFixed(3));
      view.style.setProperty('--kwf-l', clamp((p - .78) / .22, 0, 1).toFixed(3));
    } else if (state === 'set' && opt.setFade !== false) {
      r = hero.getBoundingClientRect(); hb = headBottom();
      var o = clamp((r.bottom - hb + 6) / 70, 0, 1);      // 사진 아래 끝이 [뒤로] 줄에 닿기 70px 전부터 옅어져, 줄 뒤로는 비치지 않는다(자리는 움직이지 않는다)
      if (Math.abs(o - lastFade) < .01) return;
      lastFade = o; hero.style.opacity = o >= 1 ? '' : o.toFixed(2);
    }
  }

  window.KWFollow = {
    // opt: { size: 붙은 사진 높이(화면 높이의 몇 배 · 기본 0.2), wide: 넓은 화면 배치(기본 켬), setFade: 「설정」 탭 사진 옅어짐(기본 켬), css: false 면 CSS 방식을 쓰지 않고 스크립트가 값을 적는다(app.js KW_FOLLOW_CSS) }
    init: function (m, o) {
      mode = m === 'dock' ? 'dock' : 'off'; opt = o || {};
      if (!built && mode === 'off') return;                // 꺼 두면 요소도 만들지 않는다 = v9.9 그대로
      if (!built && !build()) return;
      sync();
    },
    mode: function () { return mode; },
    state: function () { return state; },
    sync: sync
  };
})();
