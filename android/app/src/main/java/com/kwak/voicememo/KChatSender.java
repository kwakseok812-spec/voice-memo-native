package com.kwak.voicememo;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.UUID;

/**
 * v8.2(O-0157) 알림 [답장] 글을 「평소 채팅 메시지」로 보낸다.
 *
 * 앱의 OfficeBridge.sendChat() 과 완전히 같은 서버 경로·같은 모양:
 *   POST {url}/rest/v1/voice_memos  (공개 키, Prefer: return=minimal)
 *   { id, title:'채팅', status:'pending', kind:'chat', note:<글>, client_token, meta:{app:'voice-memo-test', thread, speak:false, from:'phone', via:'notif_reply'} }
 * → PC 케이(chat_responder)가 앱에서 보낸 것과 똑같이 받아 처리한다.
 * ⚠️ 연동 암호는 쓰지 않는다(원래 채팅 보내기는 공개 키 insert 라 암호가 필요 없음 — 앱도 같음).
 *    본문·토큰은 로그에 남기지 않는다.
 */
final class KChatSender {

    // office-bridge.js 의 CONFIG 와 같은 값(공개 키 — 저장소에도 이미 공개). 웹이 setContext 로 넘긴 값이 있으면 그걸 쓴다.
    private static final String DEF_URL = "https://nasizwclypmaojvwfxnn.supabase.co";
    private static final String DEF_KEY = "sb_publishable_H92J8-9eQB-bE4DQEUnHvw_jku33h7S";

    private KChatSender() {}

    /** 성공하면 {id, token, text, ts} (앱이 나중에 답을 이어 받을 때 씀), 실패하면 null. 네트워크 — 백그라운드 스레드에서만. */
    static JSONObject send(Context c, String text, String threadHint) {
        SharedPreferences p = KBridgePlugin.prefs(c);
        String base = p.getString("url", DEF_URL);
        String key = p.getString("key", DEF_KEY);
        String thread = (threadHint != null && threadHint.length() > 0) ? threadHint : p.getString("thread", "");
        if (thread == null || thread.length() == 0) thread = "th_notifreply";

        String id = UUID.randomUUID().toString();
        String token = randomHex(16);
        HttpURLConnection con = null;
        try {
            JSONObject meta = new JSONObject();
            meta.put("app", "voice-memo-test");
            meta.put("thread", thread);
            meta.put("speak", false);
            meta.put("from", "phone");
            meta.put("via", "notif_reply");
            JSONObject body = new JSONObject();
            body.put("id", id);
            body.put("title", "채팅");
            body.put("status", "pending");
            body.put("kind", "chat");
            body.put("note", text);
            body.put("client_token", token);
            body.put("meta", meta);

            con = (HttpURLConnection) new URL(base + "/rest/v1/voice_memos").openConnection();
            con.setRequestMethod("POST");
            con.setConnectTimeout(10000);
            con.setReadTimeout(15000);
            con.setDoOutput(true);
            con.setRequestProperty("apikey", key);
            con.setRequestProperty("Authorization", "Bearer " + key);
            con.setRequestProperty("Content-Type", "application/json");
            con.setRequestProperty("Prefer", "return=minimal");
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            OutputStream os = con.getOutputStream();
            os.write(bytes);
            os.close();
            int code = con.getResponseCode();
            // 409 = 같은 id 가 이미 있음(재시도) → 성공으로 본다(앱의 _insertRow 와 같은 규칙)
            if ((code >= 200 && code < 300) || code == 409) {
                JSONObject item = new JSONObject();
                item.put("id", id);
                item.put("token", token);
                item.put("text", text);
                item.put("ts", System.currentTimeMillis());
                return item;
            }
            return null;
        } catch (Exception e) {
            return null;
        } finally {
            if (con != null) try { con.disconnect(); } catch (Exception ignored) {}
        }
    }

    private static String randomHex(int nBytes) {
        byte[] b = new byte[nBytes];
        new SecureRandom().nextBytes(b);
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x & 0xff));
        return sb.toString();
    }
}
