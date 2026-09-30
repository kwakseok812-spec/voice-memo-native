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
