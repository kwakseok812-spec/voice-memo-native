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
    private static final java.util.Set<String> LAUNCH_ALLOWED =
        new java.util.HashSet<>(java.util.Arrays.asList("com.google.chromeremotedesktop"));

    @PluginMethod
    public void launchApp(final PluginCall call) {
        final String pkg = call.getString("pkg");
        JSObject ret = new JSObject();
        if (pkg == null || !LAUNCH_ALLOWED.contains(pkg)) {
            ret.put("opened", false); ret.put("reason", "not_allowed"); call.resolve(ret); return;
        }
        try {
            Intent it = getContext().getPackageManager().getLaunchIntentForPackage(pkg);
            if (it == null) { ret.put("opened", false); ret.put("reason", "not_installed"); call.resolve(ret); return; }
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

    /* v9.78 (O-0779) 홈 「유튜브」 칸(Brave로 열기, v9.79 에서 칸 이름만 바뀜) — 스토어로 보낼 수 있는 앱 = 크롬 원격 데스크톱 + Brave. (launchApp 허용 목록은 그대로 — Brave 는 openInApp 으로만 연다) */
    private static final java.util.Set<String> STORE_ALLOWED =
        new java.util.HashSet<>(java.util.Arrays.asList("com.google.chromeremotedesktop", "com.brave.browser"));

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
