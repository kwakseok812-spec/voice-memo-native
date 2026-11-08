package com.kwak.voicememo;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 다른 앱 열기 플러그인 (v7.6, 2026-10-01, 지시대장 O-0133 — 홈 「오늘 한눈에」 일정 [길찾기]).
 *  - 왜: WebView 에서 location.href = 'nmap://…' 로 넘기면 Capacitor 가 대신 열어 주긴 하지만,
 *    네이버 지도 앱이 없을 때 조용히 아무 일도 안 일어나고 JS 는 실패를 알 수 없다(대체 경로를 못 탄다).
 *  - 어떻게: ACTION_VIEW + (선택) 패키지 지정으로 startActivity 를 직접 시도하고
 *    ActivityNotFoundException 이면 {opened:false} 를 돌려준다 → JS 가 웹 지도로 대신 연다.
 *  - 설치 여부를 미리 조회(resolveActivity·queryIntentActivities)하지 않으므로 Android 11+
 *    패키지 가시성(<queries>) 선언이 필요 없다. startActivity 는 가시성 제한을 받지 않는다.
 *  - JS: Capacitor.Plugins.ExternalApp.openUri({uri, pkg?}) → {opened: true|false}
 *  - 받은 주소는 nmap:// 만 허용한다(다른 앱·임의 주소를 여는 통로로 쓰이지 않게).
 */
@CapacitorPlugin(name = "ExternalApp")
public class ExternalAppPlugin extends Plugin {

    /* O-0171(2026-10-03) PC에서 편집하기 — [원격 화면 열기]가 「크롬 원격 데스크톱」 앱을 띄운다.
     *  - 허용 목록의 앱만(다른 앱을 아무거나 여는 통로가 되지 않게).
     *  - 그 앱의 런처 인텐트(getLaunchIntentForPackage)로 연다 → 이미 원격 접속 중이면 그 화면(작업)이 그대로 앞으로 온다.
     *    (크롬 원격 데스크톱은 「특정 PC로 바로 들어가기」 주소·인텐트를 공개하지 않는다 — 앱을 연 뒤 PC를 한 번 누른다.)
     *  - 설치 여부 확인을 위해 AndroidManifest 의 <queries> 에 이 패키지를 적어 두었다(Android 11+ 패키지 가시성).
     *  - JS: Capacitor.Plugins.ExternalApp.launchApp({pkg}) → {opened, reason?:'not_installed'|'not_allowed'|'error'}
     *        Capacitor.Plugins.ExternalApp.openStore({pkg})  → 플레이 스토어 그 앱 화면(market://, 없으면 웹) */
    /* v9.80 (O-0781) 홈 「영상」 칸 + 업무 앱 「포인트 앱 바로 열기」 — 열 수 있는 앱을 11개 더했다(영상 4: 넷플릭스·웨이브·티빙·디즈니+ / 걷기 포인트 7: 캐시워크·손목닥터·머니워크(에이헬스)·야핏무브·캐시슬라이드·토스·KB스타뱅킹).
     *  - 이 목록 ⇔ AndroidManifest.xml 의 <queries><package> ⇔ www/js/phone-apps.js 의 패키지 집합은 같아야 한다(어긋나면 시험 phone_apps_test.py 의 일치 검사가 잡는다). 앱을 하나 더 넣으려면 세 곳을 함께 고친다.
     *  - 호출은 패키지 이름 하나만 받는다(주소·추가 데이터 없음). 앱의 첫 화면만 연다 — 로그인·계좌·포인트 값은 읽지도 입력하지도 않는다(금융 앱 토스·KB스타뱅킹 포함). */
    private static final java.util.Set<String> LAUNCH_ALLOWED =
        new java.util.HashSet<>(java.util.Arrays.asList(
            "com.google.chromeremotedesktop",
            "com.netflix.mediaclient", "kr.co.captv.pooqV2", "net.cj.cjhv.gs.tving", "com.disney.disneyplus",
            "com.cashwalk.cashwalk", "kr.go.seoul.healthcare", "com.tracerofficial", "kr.co.openit.openrider",
            "com.cashslide", "viva.republica.toss", "com.kbstar.kbbank"));

    @PluginMethod
    public void launchApp(final PluginCall call) {
        final String pkg = call.getString("pkg");
        JSObject ret = new JSObject();
        if (pkg == null || !LAUNCH_ALLOWED.contains(pkg)) {
            ret.put("opened", false); ret.put("reason", "not_allowed"); call.resolve(ret); return;
        }
        try {
            Intent it = getContext().getPackageManager().getLaunchIntentForPackage(pkg);
            if (it == null) {
                /* v9.80 보험: 런처 인텐트를 못 얻었다 = 미설치이거나 <queries> 선언이 빠졌다. 선언이 빠져도 「설치돼 있는데 앱이 없다」고 나오지 않게 명시 인텐트로 한 번 더 연다
                 * (startActivity 는 패키지 가시성 제한을 받지 않는다 — developer.android.com 「URL 열기」 절). 정말 없으면 ActivityNotFoundException → 아래에서 not_installed. */
                it = new Intent(Intent.ACTION_MAIN);
                it.addCategory(Intent.CATEGORY_LAUNCHER);
                it.setPackage(pkg);
            }
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
            getActivity().startActivity(it);
            ret.put("opened", true);
        } catch (ActivityNotFoundException e) {
            ret.put("opened", false); ret.put("reason", "not_installed");
        } catch (Exception e) {
            ret.put("opened", false); ret.put("reason", "error");
        }
        call.resolve(ret);
    }

    /* v9.78 (O-0779) 홈 「유튜브」 칸(Brave로 열기) — 스토어로 보낼 수 있는 앱 = 크롬 원격 데스크톱 + Brave. (Brave 는 openInApp 으로만 연다 — launchApp 허용 목록에 없다)
     * v9.80 (O-0781) + 위 LAUNCH_ALLOWED 의 새 11개(미설치일 때 「스토어 열기」). 즉 STORE_ALLOWED = LAUNCH_ALLOWED + Brave. */
    private static final java.util.Set<String> STORE_ALLOWED =
        new java.util.HashSet<>(java.util.Arrays.asList(
            "com.google.chromeremotedesktop", "com.brave.browser",
            "com.netflix.mediaclient", "kr.co.captv.pooqV2", "net.cj.cjhv.gs.tving", "com.disney.disneyplus",
            "com.cashwalk.cashwalk", "kr.go.seoul.healthcare", "com.tracerofficial", "kr.co.openit.openrider",
            "com.cashslide", "viva.republica.toss", "com.kbstar.kbbank"));

    @PluginMethod
    public void openStore(final PluginCall call) {
        final String pkg = call.getString("pkg");
        JSObject ret = new JSObject();
        if (pkg == null || !STORE_ALLOWED.contains(pkg)) {
            ret.put("opened", false); ret.put("reason", "not_allowed"); call.resolve(ret); return;
        }
        try {
            Intent it = new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + pkg));
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(it);
            ret.put("opened", true);
        } catch (ActivityNotFoundException e) {
            try {
                Intent web = new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + pkg));
                web.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(web);
                ret.put("opened", true);
            } catch (Exception e2) {
                ret.put("opened", false); ret.put("reason", "error");
            }
        } catch (Exception e) {
            ret.put("opened", false); ret.put("reason", "error");
        }
        call.resolve(ret);
    }

    /* v9.76 「업무 앱」·「규정 도우미」 — 웹 주소를 크롬 맞춤 탭(Custom Tabs)으로 연다.
     *  - 앱 위에 크롬이 살짝 얹히고(상단 색 띠 = 앱 배경색, 제목 표시), ✕ 또는 뒤로 가기 = 바로 스마트비서로 돌아온다. 로그인·쿠키·저장소는 크롬 것이라 한 번 로그인하면 유지된다.
     *  - https:// 주소만 허용(다른 앱·임의 스킴을 여는 통로가 되지 않게). 주소는 연동 암호로 받아 온 목록의 것만 JS 가 넘긴다.
     *  - 맞춤 탭을 못 열면(맞춤 탭을 지원하는 브라우저가 없음 등) 평범한 보기(ACTION_VIEW)로 자동 전환 → 그것도 안 되면 {opened:false}.
     *  - 새 권한 없음. androidx.browser 라이브러리만 더했다.
     *  - JS: Capacitor.Plugins.ExternalApp.openTab({url}) → {opened: true|false, mode?: 'tab'|'view', reason?: 'not_allowed'|'error'} */
    @PluginMethod
    public void openTab(final PluginCall call) {
        final String url = call.getString("url");
        JSObject ret = new JSObject();
        if (url == null || !url.startsWith("https://") || url.length() > 2000) {
            ret.put("opened", false); ret.put("reason", "not_allowed"); call.resolve(ret); return;
        }
        final Uri uri = Uri.parse(url);
        try {
            androidx.browser.customtabs.CustomTabColorSchemeParams cs = new androidx.browser.customtabs.CustomTabColorSchemeParams.Builder()
                .setToolbarColor(0xFF070B1D).build();
            androidx.browser.customtabs.CustomTabsIntent tab = new androidx.browser.customtabs.CustomTabsIntent.Builder()
                .setShowTitle(true)
                .setDefaultColorSchemeParams(cs)
                .build();
            tab.launchUrl(getActivity(), uri);
            ret.put("opened", true); ret.put("mode", "tab");
            call.resolve(ret); return;
        } catch (Exception e) {
            // 맞춤 탭 실패 → 아래 평범한 보기로
        }
        try {
            Intent it = new Intent(Intent.ACTION_VIEW, uri);
            it.addCategory(Intent.CATEGORY_BROWSABLE);
            getActivity().startActivity(it);
            ret.put("opened", true); ret.put("mode", "view");
        } catch (ActivityNotFoundException e) {
            ret.put("opened", false); ret.put("reason", "error");
        } catch (Exception e) {
            ret.put("opened", false); ret.put("reason", "error");
        }
        call.resolve(ret);
    }

    /* v9.78 (O-0779) 홈 「유튜브」 칸(Brave로 열기, v9.79 에서 칸 이름만 바뀜) — 웹 주소를 지정한 앱(Brave)으로 연다.
     *  - Intent(ACTION_VIEW, https주소) + setPackage(pkg) → 그 앱의 화면만 후보라서 유튜브 앱·「어느 앱으로 열까요」 선택창이 끼어들 수 없다.
     *  - 허용 패키지 = Brave 정식판 하나(다른 앱을 아무거나 여는 통로가 되지 않게). 주소는 https:// 만, 공백·제어문자 없음, 2000자 이하.
     *  - 미설치 판단 = 실제로 열어 보고 ActivityNotFoundException 이면 not_installed (미리 조회하지 않으므로 <queries> 선언이 필요 없다 — startActivity 는 패키지 가시성 제한을 받지 않는다).
     *  - 새 권한·새 라이브러리 없음.
     *  - JS: Capacitor.Plugins.ExternalApp.openInApp({pkg, url}) → {opened:true} | {opened:false, reason:'not_allowed'|'not_installed'|'error'} */
    private static final java.util.Set<String> OPEN_IN_APP_ALLOWED =
        new java.util.HashSet<>(java.util.Arrays.asList("com.brave.browser"));

    @PluginMethod
    public void openInApp(final PluginCall call) {
        final String pkg = call.getString("pkg");
        final String url = call.getString("url");
        JSObject ret = new JSObject();
        if (pkg == null || !OPEN_IN_APP_ALLOWED.contains(pkg)
                || url == null || !url.startsWith("https://") || url.length() > 2000 || !url.matches("[^\\x00-\\x20\\x7F]+")) {
            ret.put("opened", false); ret.put("reason", "not_allowed"); call.resolve(ret); return;
        }
        try {
            Intent it = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            it.addCategory(Intent.CATEGORY_BROWSABLE);
            it.setPackage(pkg);
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(it);
            ret.put("opened", true);
        } catch (ActivityNotFoundException e) {
            ret.put("opened", false); ret.put("reason", "not_installed");
        } catch (Exception e) {
            ret.put("opened", false); ret.put("reason", "error");
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void openUri(final PluginCall call) {
        final String uri = call.getString("uri");
        final String pkg = call.getString("pkg");
        JSObject ret = new JSObject();
        if (uri == null || !uri.startsWith("nmap://")) {
            ret.put("opened", false);
            ret.put("reason", "not_allowed");
            call.resolve(ret);
            return;
        }
        try {
            Intent it = new Intent(Intent.ACTION_VIEW, Uri.parse(uri));
            it.addCategory(Intent.CATEGORY_BROWSABLE);
            if (pkg != null && !pkg.isEmpty()) it.setPackage(pkg);
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(it);
            ret.put("opened", true);
        } catch (ActivityNotFoundException e) {
            ret.put("opened", false);
            ret.put("reason", "not_installed");
        } catch (Exception e) {
            ret.put("opened", false);
            ret.put("reason", "error");
        }
        call.resolve(ret);
    }
}
