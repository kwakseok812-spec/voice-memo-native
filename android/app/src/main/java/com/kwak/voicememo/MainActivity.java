package com.kwak.voicememo;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {

    // 공유/열기로 받은 문서를 뷰어로 넘길 수 있는 최대 크기(그 이상은 base64 주입이 무거워 안내만 한다)
    private static final long MAX_DOC_BYTES = 60L * 1024 * 1024; // 60MB
    // v8.2(O-0157) [공유]로 받은 파일 한 개의 최대 크기. 웹이 파일을 메모리로 읽으므로 NativeInput.pickFiles 와 같은 300MB.
    //   더 큰 파일은 건너뛰고 「채팅의 ＋로 직접 고르면 5GB까지」라고 안내한다.
    private static final long MAX_SHARE_BYTES = 300L * 1024 * 1024;
    private static final int MAX_SHARE_FILES = 20;
    private static final int MAX_SHARE_TEXT = 20000;

    // v8.2(O-0157) 앱이 지금 화면에 떠 있나(떠 있으면 케이 답장 알림을 따로 띄우지 않는다 — 앱 화면이 바로 보여 줌)
    private static volatile boolean sForeground = false;
    static boolean isInForeground() { return sForeground; }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 커스텀 네이티브 녹음 플러그인 등록(포그라운드 서비스 기반 백그라운드 녹음)
        registerPlugin(NativeRecorderPlugin.class);
        // 커스텀 네이티브 채팅 입력 플러그인 등록(한글 IME 씹힘 회피 — 하단 네이티브 입력 바)
        registerPlugin(NativeInputPlugin.class);
        // v6.7: 네이티브 파일 다운로드(채팅·공유함 [다운로드] → 폰 「다운로드」 폴더, APK 는 설치 화면으로)
        registerPlugin(FileDownloadPlugin.class);
        // v7.6(O-0133): 홈 일정 [길찾기] → 네이버 지도 앱 열기(없으면 JS 가 웹 지도로)
        registerPlugin(ExternalAppPlugin.class);
        // v8.2(O-0157): 공유 받기·알림 답장·바로가기·위젯 ↔ 웹 연결 창구
        registerPlugin(KBridgePlugin.class);
        // O-0177: 음성 대화 — 폰에서 바로 받아쓰기(SpeechRecognizer, 기기 내 인식 우선). 실패하면 JS 가 녹음→PC 전사로
        registerPlugin(KSpeechPlugin.class);
        // v9.3(O-0247): 홈 「도구」 > 「미러링」 — 미러링 화면(android/mirror 모듈) 열기
        registerPlugin(MirrorPlugin.class);
        super.onCreate(savedInstanceState);
        // 앱이 꺼진 상태에서 "열기/공유 → 스마트비서"(또는 바로가기·위젯·알림)로 시작된 경우.
        //   v8.2: 화면이 다시 만들어지는 경우(savedInstanceState 있음)엔 같은 공유를 두 번 처리하지 않게 건너뛴다.
        if (savedInstanceState == null) handleIncoming(getIntent());
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // 앱이 이미 떠 있는 상태에서 문서가 넘어온 경우(launchMode=singleTask)
        handleIncoming(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        sForeground = true;
        // 앱을 보고 계시면 케이 답장 알림(우리가 띄운 것)과 그 안의 짧은 기록은 정리
        try { KNotify.cancel(this); KNotify.resetHist(this); } catch (Exception ignored) {}
    }

    @Override
    public void onPause() {
        sForeground = false;
        super.onPause();
    }

    // v8.2(O-0157): 들어온 인텐트 분류
    //   · VIEW(「열기 → 스마트비서」)              → 예전 그대로 문서 뷰어(handleIncomingDoc, 60MB)
    //   · SEND / SEND_MULTIPLE(「공유 → 스마트비서」) → 새 공유 받기(handleShare): 글·링크·사진·파일 → 웹에서 채팅 또는 뷰어 고르기
    //   · k_shortcut(아이콘 길게 누르기) / k_open(위젯·내 알림) → 웹에 'launch'
    private void handleIncoming(Intent intent) {
        if (intent == null) return;
        try {
            String sc = intent.getStringExtra("k_shortcut");
            if (sc != null && sc.length() > 0) {
                JSObject o = new JSObject(); o.put("kind", "shortcut"); o.put("name", sc);
                KBridgePlugin.emit("launch", o);
                return;
            }
            String open = intent.getStringExtra("k_open");
            if (open != null && open.length() > 0) {
                try { KNotify.cancel(this); KNotify.resetHist(this); } catch (Exception ignored) {}
                JSObject o = new JSObject(); o.put("kind", "open"); o.put("screen", open);
                KBridgePlugin.emit("launch", o);
                return;
            }
        } catch (Exception ignored) {}
        String action = intent.getAction();
        if (action == null) return;
        if (Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            handleShare(intent);
            return;
        }
        handleIncomingDoc(intent);
    }

    // 다른 앱에서 「열기」로 넘어온 문서(ACTION_VIEW) → 문서 뷰어(예전 그대로).
    //   v8.2: 「공유(SEND)」로 온 문서는 handleShare 로 간다(웹에서 [문서 뷰어로 열기]/[케이에게 보내기] 고르기).
    private void handleIncomingDoc(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (action == null) return;
        Uri uri = null;
        try {
            if (Intent.ACTION_VIEW.equals(action)) {
                uri = intent.getData();
            }
        } catch (Exception e) {
            return;
        }
        if (uri == null) return;
        deliverToWeb(uri);
    }

    /* ---------------- v8.2(O-0157) 어디서든 [공유] → 케이 ----------------
     * 글(EXTRA_TEXT·EXTRA_SUBJECT)과 파일(EXTRA_STREAM 1개·여러 개, ClipData)을 모은다.
     * 파일은 앱 캐시(share_in/b<시각>/)에 복사해 두고 경로만 웹에 넘긴다 → 웹이 Capacitor.convertFileSrc 로 읽어 File 로 만든다
     * (예전 base64 주입보다 가볍다 — 사진 여러 장도 문제 없음). 1시간 지난 복사본은 다음 공유 때 지운다.
     * 웹으로는 KBridge 'shareIn' 이벤트(웹이 듣기 전이면 들을 때까지 보관). 본문은 로그에 남기지 않는다. */
    private void handleShare(final Intent intent) {
        String tx = "", sj = "";
        final List<Uri> uris = new ArrayList<>();
        try {
            CharSequence t = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            tx = t == null ? "" : t.toString();
            if (tx.length() > MAX_SHARE_TEXT) tx = tx.substring(0, MAX_SHARE_TEXT) + "…";
            String s0 = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            sj = s0 == null ? "" : s0;
            if (Intent.ACTION_SEND.equals(intent.getAction())) {
                Uri u = (Uri) intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (u != null) uris.add(u);
            } else {
                ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (list != null) for (Uri u : list) if (u != null) uris.add(u);
            }
            if (uris.isEmpty() && intent.getClipData() != null) {
                android.content.ClipData cd = intent.getClipData();
                for (int i = 0; i < cd.getItemCount(); i++) {
                    Uri u = cd.getItemAt(i).getUri();
                    if (u != null) uris.add(u);
                }
            }
        } catch (Exception e) {
            JSObject o = new JSObject(); o.put("error", "공유된 내용을 읽지 못했습니다.");
            KBridgePlugin.emit("shareIn", o);
            return;
        }
        final String text = tx, subject = sj;
        final String intentType = intent.getType();
        if (text.length() == 0 && subject.length() == 0 && uris.isEmpty()) return;
        if (!uris.isEmpty()) {
            JSObject busy = new JSObject(); busy.put("count", uris.size());
            KBridgePlugin.emit("shareBusy", busy);
        }
        new Thread(new Runnable() {
            public void run() {
                JSArray files = new JSArray();
                JSArray skipped = new JSArray();
                try {
                    File root = new File(getCacheDir(), "share_in");
                    cleanOldShares(root);
                    File dir = new File(root, "b" + System.currentTimeMillis());
                    if (!uris.isEmpty()) dir.mkdirs();
                    ContentResolver cr = getContentResolver();
                    int n = 0;
                    for (Uri u : uris) {
                        String name = queryName(cr, u);
                        if (n >= MAX_SHARE_FILES) { skipped.put(skip(name, "too_many")); continue; }
                        String mime = null;
                        try { mime = cr.getType(u); } catch (Exception ignored) {}
                        if (mime == null || mime.length() == 0) mime = intentType;
                        if (mime == null || mime.contains("*")) mime = "";
                        String ext = "";
                        int dot = name.lastIndexOf('.');
                        if (dot >= 0 && dot < name.length() - 1) {
                            String e2 = name.substring(dot + 1).replaceAll("[^A-Za-z0-9]", "");
                            if (e2.length() > 0 && e2.length() <= 8) ext = "." + e2;
                        }
                        // 임시 사본 이름은 영문·숫자만(한글·공백 경로 문제 회피). 원래 이름은 name 으로 따로 넘긴다.
                        File out = new File(dir, "s" + (n++) + ext);
                        long size = 0;
                        String why = null;
                        InputStream in = null;
                        OutputStream os = null;
                        try {
                            in = cr.openInputStream(u);
                            if (in == null) why = "unreadable";
                            else {
                                os = new FileOutputStream(out);
                                byte[] buf = new byte[65536];
                                int r;
                                while ((r = in.read(buf)) != -1) {
                                    size += r;
                                    if (size > MAX_SHARE_BYTES) { why = "too_big"; break; }
                                    os.write(buf, 0, r);
                                }
                            }
                        } catch (Exception copyErr) {
                            why = "unreadable";
                        } finally {
                            try { if (in != null) in.close(); } catch (Exception ignored) {}
                            try { if (os != null) os.close(); } catch (Exception ignored) {}
                        }
                        if (why != null) { try { out.delete(); } catch (Exception ignored) {} skipped.put(skip(name, why)); continue; }
                        JSObject f = new JSObject();
                        f.put("path", out.getAbsolutePath());
                        f.put("name", name);
                        f.put("mime", mime);
                        f.put("size", size);
                        files.put(f);
                    }
                } catch (Exception e) {
                    // 일부라도 모은 것은 넘긴다
                }
                JSObject o = new JSObject();
                o.put("text", text);
                o.put("subject", subject);
                o.put("files", files);
                o.put("skipped", skipped);
                KBridgePlugin.emit("shareIn", o);
            }
        }).start();
    }

    private static JSObject skip(String name, String reason) {
        JSObject s = new JSObject(); s.put("name", name); s.put("reason", reason); return s;
    }

    // 지난 공유 복사본 중 1시간 지난 묶음만 지운다(방금 것·아직 웹이 안 읽은 것은 남김)
    private static void cleanOldShares(File root) {
        try {
            File[] olds = root.listFiles();
            if (olds == null) return;
            long cut = System.currentTimeMillis() - 3600 * 1000L;
            for (File b : olds) {
                if (b.lastModified() > cut) continue;
                File[] fs = b.listFiles();
                if (fs != null) for (File x : fs) { try { x.delete(); } catch (Exception ignored) {} }
                try { b.delete(); } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {}
    }

    // 백그라운드 스레드에서 content:// / file:// URI의 바이트를 읽어 base64로 웹에 주입한다.
    private void deliverToWeb(final Uri uri) {
        new Thread(new Runnable() {
            public void run() {
                String name = "document";
                try {
                    ContentResolver cr = getContentResolver();
                    name = queryName(cr, uri);
                    String mime = cr.getType(uri);
                    if (mime == null || mime.length() == 0) mime = "application/octet-stream";
                    InputStream is = cr.openInputStream(uri);
                    if (is == null) { postError("문서를 읽을 수 없습니다.", name); return; }
                    ByteArrayOutputStream bos = new ByteArrayOutputStream();
                    byte[] buf = new byte[8192];
                    int n; long total = 0;
                    while ((n = is.read(buf)) != -1) {
                        total += n;
                        if (total > MAX_DOC_BYTES) { try { is.close(); } catch (Exception ig) {} postError("파일이 너무 커서 이 방식으로는 열 수 없습니다(60MB 초과).", name); return; }
                        bos.write(buf, 0, n);
                    }
                    try { is.close(); } catch (Exception ig) {}
                    String b64 = Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP);
                    postToWeb(name, mime, b64);
                } catch (Exception e) {
                    postError("문서를 여는 데 실패했습니다.", name);
                }
            }
        }).start();
    }

    // content:// URI에서 사람이 읽는 파일명을 얻는다(없으면 마지막 경로 조각).
    private String queryName(ContentResolver cr, Uri uri) {
        String name = null;
        try {
            if ("content".equals(uri.getScheme())) {
                Cursor c = cr.query(uri, null, null, null, null);
                if (c != null) {
                    try {
                        int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                        if (idx >= 0 && c.moveToFirst()) name = c.getString(idx);
                    } finally {
                        c.close();
                    }
                }
            }
        } catch (Exception e) {}
        if (name == null || name.length() == 0) {
            String p = uri.getLastPathSegment();
            name = (p != null && p.length() > 0) ? p : "document";
        }
        return name;
    }

    // 웹(app.js)의 window.__smartSharedDoc(name, mime, b64)로 넘긴다.
    // 콜드 스타트 시 웹 로드 전일 수 있어 함수가 준비될 때까지 재시도한다.
    private void postToWeb(final String name, final String mime, final String b64) {
        deliverWithRetry("window.__smartSharedDoc(" + jsStr(name) + "," + jsStr(mime) + "," + jsStr(b64) + ");", 0);
    }

    private void postError(final String msg, final String name) {
        deliverWithRetry("window.__smartSharedDocError(" + jsStr(msg) + "," + jsStr(name) + ");", 0);
    }

    private void deliverWithRetry(final String innerCall, final int attempt) {
        final WebView wv = (getBridge() != null) ? getBridge().getWebView() : null;
        if (wv == null) {
            if (attempt < 60) new Handler(Looper.getMainLooper()).postDelayed(new Runnable() { public void run() { deliverWithRetry(innerCall, attempt + 1); } }, 400);
            return;
        }
        wv.post(new Runnable() {
            public void run() {
                // 웹의 훅(큐 스텁 포함)이 준비됐는지 확인하고, 준비됐을 때만 호출한다.
                String probe = "(function(){ if(typeof window.__smartSharedDoc==='function'){ try{" + innerCall + "}catch(e){} return 'ok'; } return 'wait'; })();";
                wv.evaluateJavascript(probe, new android.webkit.ValueCallback<String>() {
                    public void onReceiveValue(String value) {
                        boolean ok = value != null && value.indexOf("ok") >= 0;
                        if (!ok && attempt < 60) {
                            new Handler(Looper.getMainLooper()).postDelayed(new Runnable() { public void run() { deliverWithRetry(innerCall, attempt + 1); } }, 400);
                        }
                    }
                });
            }
        });
    }

    // 자바 문자열을 JS 문자열 리터럴로 안전하게 변환(따옴표/역슬래시/개행 이스케이프).
    private String jsStr(String s) {
        if (s == null) return "\"\"";
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '\\': sb.append("\\\\"); break;
                case '"': sb.append("\\\""); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                case ' ': sb.append("\\u2028"); break;
                case ' ': sb.append("\\u2029"); break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        sb.append("\"");
        return sb.toString();
    }
}
