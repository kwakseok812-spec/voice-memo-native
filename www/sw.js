/* ============================================================================
 * sw.js — 최소 서비스워커 (PWA "설치" 요건 충족용)
 * ----------------------------------------------------------------------------
 * 목적: PC 크롬에서 이 웹앱을 "설치"(바탕화면 아이콘)할 수 있게 한다.
 *   크롬이 PWA를 설치 가능으로 판정하려면 (1) manifest.json (2) HTTPS
 *   (3) fetch 이벤트 핸들러가 있는 서비스워커 — 이 세 가지가 필요하다.
 *
 * ⚠️ 일부러 "공격적 캐시"를 하지 않는다.
 *   - 앱 껍데기를 캐시에 굳혀 두면 다음 배포/APK 업데이트 때 옛 화면이 남아
 *     "고쳤는데 안 바뀐다" 혼란이 난다(폰·PC 공용 소스라 더 위험).
 *   - 그래서 fetch 는 그냥 네트워크로 통과시킨다(항상 최신을 받음).
 *   - 오프라인 완전 지원(문서 캐시 등)은 필요해지면 그때 추가한다.
 * ==========================================================================*/
'use strict';

self.addEventListener('install', function () {
  self.skipWaiting();            // 새 SW 를 즉시 활성화(옛 SW 대기 없이 교체)
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());   // 열려 있는 탭들을 즉시 이 SW 가 제어
});

// fetch 핸들러는 "존재" 자체가 설치 요건. 캐시하지 않고 네트워크로 통과한다.
// v3.7: PC판이 "고쳤는데 안 바뀐다" 문제 해결 — 앱 셸(HTML·CSS·JS)은 브라우저 HTTP 캐시를
//   타지 않게 cache:'no-store' 로 받아 항상 최신을 반영한다(앱을 열거나 다시 열면 최신).
//   이미지·문서·기타/외부요청은 성능을 위해 지금처럼 그대로 통과한다.
//   폰(APK)은 www 를 번들로 담아 실행하므로 이 캐시 로직과 무관하다.
function offlineFallback() {
  return new Response('', { status: 504, statusText: 'offline' });
}
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;   // GET 외(POST 등)는 SW 개입 없이 브라우저 기본 처리

  var isSameOrigin = false, isShellFile = false;
  try {
    var url = new URL(req.url);
    isSameOrigin = (url.origin === self.location.origin);
    isShellFile = /\.(?:html|css|js)$/i.test(url.pathname);
  } catch (e) {}

  // 앱 셸 = 문서 네비게이션 이동 + 같은 출처의 .html/.css/.js → 항상 최신(no-store)
  var isShell = isSameOrigin && (req.mode === 'navigate' || isShellFile);
  if (isShell) {
    event.respondWith(fetch(req, { cache: 'no-store' }).catch(offlineFallback));
    return;
  }
  // 그 외(이미지·문서·외부 API 등)는 그대로 통과
  event.respondWith(fetch(req).catch(offlineFallback));
});
