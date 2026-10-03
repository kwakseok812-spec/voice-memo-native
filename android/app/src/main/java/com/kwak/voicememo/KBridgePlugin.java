package com.kwak.voicememo;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * v8.2(O-0157) 웹(app.js·share-in.js) ↔ 네이티브 연결 창구 「KBridge」.
 *
 *  웹 → 네이티브
 *   - setContext({thread, url, key, pass}) : 알림 [답장]이 쓸 대화방(thread)·서버 주소·공개 키·연동 암호를 기억.
 *       공개(publishable) 키만 받는다(비밀 키 형태는 거절). 연동 암호(O-0158)는 KSecret 이 Keystore 로 암호화해 보관.
 *   - updateWidget({count, title, line, at, hide}) : 바탕화면 케이 위젯 내용 갱신.
 *   - takeOutbox() : 앱이 꺼져 있을 때 알림 [답장]으로 보낸 메시지 목록을 넘겨받고 비운다
 *       (app.js 가 채팅 목록에 「내 말풍선」으로 넣고 평소처럼 답을 기다림).
 *
 *  네이티브 → 웹 (이벤트, 웹이 듣기 전이면 붙들어 두었다가 듣는 순간 전달)
 *   - 'launch'  : {kind:'shortcut', name} / {kind:'open', screen}  — 아이콘 길게 누르기·위젯·내 알림 탭
 *   - 'shareIn' : {text, subject, files:[{name,mime,size,path}], skipped:[{name,reason}]} — 다른 앱 [공유]
 *   - 'shareBusy': {count} — 공유받은 파일을 복사하는 중(큰 파일이면 몇 초)
 *   - 'replySent': {} — 알림에서 답장을 보냈음(앱이 떠 있으면 바로 takeOutbox)
 */
@CapacitorPlugin(name = "KBridge")
public class KBridgePlugin extends Plugin {

    static final String PREFS = "kbridge";
    private static volatile KBridgePlugin instance;
    // 플러그인이 아직 안 만들어졌을 때(아주 이른 콜드 스타트) 생긴 이벤트를 잠시 보관
    private static final List<Object[]> early = new ArrayList<>();

    @Override
    public void load() {
        instance = this;
        synchronized (early) {
            for (Object[] e : early) notifyListeners((String) e[0], (JSObject) e[1], true);
            early.clear();
        }
    }

    /** 어디서든(액티비티·리시버·서비스) 웹으로 이벤트를 보낸다. 웹이 아직 안 들었으면 들을 때까지 보관. */
    static void emit(String event, JSObject data) {
        KBridgePlugin p = instance;
        if (p == null) {
            synchronized (early) { early.add(new Object[]{ event, data }); }
            return;
        }
        p.notifyListeners(event, data, true);
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void setContext(PluginCall call) {
        SharedPreferences.Editor ed = prefs(getContext()).edit();
        String thread = call.getString("thread", null);
        String url = call.getString("url", null);
        String key = call.getString("key", null);
        if (thread != null && thread.length() > 0 && thread.length() < 80) ed.putString("thread", thread);
        if (url != null && url.startsWith("https://")) ed.putString("url", url);
        // 공개 키만(비밀 키 실수 방지: service_role·sb_secret 형태는 거절)
        if (key != null && key.length() > 0 && key.indexOf("secret") < 0 && key.indexOf("service_role") < 0) ed.putString("key", key);
        ed.apply();
        // v8.2(O-0158) 연동 암호: 알림 [답장]이 연동 암호 확인 RPC(submit_memo)로 보내므로 Keystore 로 암호화해 보관.
        //   빈 값이면 지운다(앱에서 암호가 틀려 지웠을 때). 값은 어디에도 로그로 남기지 않는다.
        if (call.getData().has("pass")) KSecret.putPass(getContext(), call.getString("pass", ""));
        call.resolve();
    }

    @PluginMethod
    public void updateWidget(PluginCall call) {
        // 숫자는 JS 쪽에서 문자열로 넘긴다(JSON 숫자는 크기에 따라 Integer/Long/Double 로 갈려 읽기가 불안정).
        long at = 0L; int count = 0;
        try { at = Long.parseLong(call.getString("at", "0")); } catch (Exception ignored) {}
        try { count = Integer.parseInt(call.getString("count", "0")); } catch (Exception ignored) {}
        Boolean hide = call.getBoolean("hide", false);
        KWidgetProvider.saveState(getContext(), count,
                call.getString("title", ""),
                call.getString("line", ""),
                at, hide != null && hide);
        KWidgetProvider.refreshAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void takeOutbox(PluginCall call) {
        JSObject o = new JSObject();
        o.put("items", takeOutboxArray(getContext()));
        call.resolve(o);
    }

    // ---------------- 알림 답장 보낸 기록(outbox) ----------------
    // 앱 저장소(이 앱만 읽을 수 있는 공간)에 최근 30건만. 본문은 로그로 남기지 않는다.
    static synchronized void addOutbox(Context c, JSONObject item) {
        try {
            SharedPreferences sp = prefs(c);
            JSONArray a = new JSONArray(sp.getString("outbox", "[]"));
            a.put(item);
            while (a.length() > 30) a.remove(0);
            sp.edit().putString("outbox", a.toString()).apply();
        } catch (Exception ignored) {}
    }

    static synchronized JSArray takeOutboxArray(Context c) {
        JSArray out = new JSArray();
        try {
            SharedPreferences sp = prefs(c);
            JSONArray a = new JSONArray(sp.getString("outbox", "[]"));
            for (int i = 0; i < a.length(); i++) out.put(a.getJSONObject(i));
            sp.edit().remove("outbox").apply();
        } catch (Exception ignored) {}
        return out;
    }
}
