package com.kwak.voicememo;

import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 미러링 열기 플러그인 (v9.3, 2026-10-05, 지시대장 O-0247 — 홈 「도구」 > 「미러링」).
 *  - 무엇: 폰 화면을 로키드 안경에 비추는 「미러링」 화면(네이티브, android/mirror 모듈의 MirrorActivity)을 연다.
 *    별도 앱 「미러링」 v0.4 의 폰 쪽을 그대로 옮긴 것이라 화면·기능·통신 규약이 같다(안경 앱은 그대로 쓴다).
 *  - 이 플러그인이 하는 일은 「열기」와 「이 폰에서 쓸 수 있나」 둘뿐이다. 화면 공유·블루투스·알림 허용 창은
 *    미러링 화면에서 「시작」을 누를 때 그 화면이 요청한다 → 스마트비서의 다른 기능을 쓸 때는 새 허용 창이 뜨지 않는다.
 *  - 화면 공유(진행 중 서비스)는 안드로이드 10(API 29)부터라, 그보다 낮으면 supported=false 를 돌려주고 홈 칸은 숨긴 채로 둔다.
 *  - JS: Capacitor.Plugins.Mirror.status() → {supported: true|false, sdk}
 *        Capacitor.Plugins.Mirror.open()   → {opened: true|false, reason?: 'old_android'|'error'}
 */
@CapacitorPlugin(name = "Mirror")
public class MirrorPlugin extends Plugin {

    private static final int MIN_SDK = 29;

    @PluginMethod
    public void status(final PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("supported", Build.VERSION.SDK_INT >= MIN_SDK);
        ret.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(ret);
    }

    @PluginMethod
    public void open(final PluginCall call) {
        JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT < MIN_SDK) {
            ret.put("opened", false); ret.put("reason", "old_android"); call.resolve(ret); return;
        }
        try {
            Intent it = new Intent(getContext(), io.github.kwakseok812.glassmap.phone.MirrorActivity.class);
            getActivity().startActivity(it);
            ret.put("opened", true);
        } catch (Exception e) {
            ret.put("opened", false); ret.put("reason", "error");
        }
        call.resolve(ret);
    }
}
