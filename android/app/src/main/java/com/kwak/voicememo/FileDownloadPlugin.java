package com.kwak.voicememo;

import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.webkit.MimeTypeMap;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;

/**
 * 네이티브 파일 다운로드 플러그인 (v6.7, 2026-09-29, 지시대장 O-0088).
 *  - 왜: 안드로이드 WebView(Capacitor)는 <a download href="blob:..."> 를 받아 줄 DownloadListener 가 없어
 *    채팅·공유함 [⬇ 다운로드]가 "저장했어요"라고만 뜨고 실제 파일은 생기지 않았다(거짓 성공).
 *  - 어떻게: 안드로이드 시스템 DownloadManager 에 파일 주소(서명 URL·공개 URL)를 그대로 넘긴다
 *    → 폰의 「다운로드」 폴더에 실제 파일이 생기고, 알림창에 진행·완료가 뜬다.
 *    완료는 DownloadManager 상태를 직접 조회해 "성공 + 받은 바이트 = 전체 바이트"일 때만 성공으로 알린다.
 *  - 받은 뒤: open=true 면 바로 연다. APK 는 설치 화면으로 넘긴다
 *    (처음 한 번은 「이 출처 허용」 설정 화면을 연다 — 사용자가 켜고 돌아오면 JS 가 open()을 다시 부른다).
 *  - JS: Capacitor.Plugins.FileDownload.download({url, name, mime?, open?}) / open({id, mime?, askPermission?})
 *        이벤트 'progress' {id, name, pct}
 */
@CapacitorPlugin(name = "FileDownload")
public class FileDownloadPlugin extends Plugin {

    static final String APK_MIME = "application/vnd.android.package-archive";
    private static final long POLL_MS = 700;
    // v7.9: 멈춤 판정을 10분 → "진행이 전혀 없는 시간" 기준 두 단계로 줄였다(느리지만 받아지고 있으면 실패로 보지 않는다).
    //   - 첫 바이트도 못 받은 채(대기·일시정지) 45초 → WAITING_<사유> (인터넷 기다림·와이파이 대기 등)
    //   - 받다가 2분 동안 1바이트도 안 늘면 → STALLED
    //   둘 다 우리가 넣은 요청을 지우고(dm.remove) 실패로 알린다 → 다시 누르면 새로 받을 수 있다.
    private static final long FIRST_BYTE_MS = 45L * 1000;
    private static final long STALL_MS = 2L * 60 * 1000;

    private DownloadManager dm() {
        return (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
    }

    /** 윈도·안드로이드가 못 쓰는 글자만 '_'로. 한글·공백·괄호는 그대로. */
    private static String cleanName(String n) {
        if (n == null) n = "";
        n = n.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]", "_").trim();
        while (n.endsWith(".") || n.endsWith(" ")) n = n.substring(0, n.length() - 1);
        return n.isEmpty() ? "download" : n;
    }

    /** 확장자로 MIME 을 정한다. 서버가 octet-stream 으로 주는 APK 도 설치 가능한 형식으로 맞춘다. */
    private static String guessMime(String name, String given) {
        String ext = "";
        int dot = name.lastIndexOf('.');
        if (dot >= 0 && dot < name.length() - 1) ext = name.substring(dot + 1).toLowerCase(Locale.ROOT);
        if ("apk".equals(ext)) return APK_MIME;
        String m = ext.isEmpty() ? null : MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        if (m != null && !m.isEmpty()) return m;
        if (given != null && !given.isEmpty()) return given;
        return "application/octet-stream";
    }

    @PluginMethod
    public void download(final PluginCall call) {
        final String url = call.getString("url");
        final String name = cleanName(call.getString("name"));
        final String mime = guessMime(name, call.getString("mime"));
        final boolean open = call.getBoolean("open", Boolean.TRUE);
        final boolean ask = call.getBoolean("askPermission", Boolean.TRUE);
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
            call.reject("파일 주소가 올바르지 않습니다.", "BAD_URL");
            return;
        }
        final DownloadManager dm = dm();
        if (dm == null) { call.reject("이 폰에서 다운로드 기능을 쓸 수 없습니다.", "NO_DM"); return; }
        final long id;
        try {
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
            req.setTitle(name);
            req.setDescription("스마트비서");
            req.setMimeType(mime);
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // 안드로이드 10+ : 권한 없이 공용 「다운로드」 폴더에 저장(같은 이름이 있으면 시스템이 이름 뒤에 번호를 붙인다)
                req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            } else {
                // 안드로이드 9 이하 : 공용 폴더는 저장소 권한이 필요 → 앱 전용 다운로드 폴더(권한 불필요)
                req.setDestinationInExternalFilesDir(getContext(), Environment.DIRECTORY_DOWNLOADS, name);
            }
            id = dm.enqueue(req);
        } catch (Exception e) {
            call.reject("다운로드를 시작하지 못했습니다: " + e.getMessage(), "ENQUEUE_FAIL");
            return;
        }

        new Thread(new Runnable() {
            public void run() {
                long lastBytes = -1, lastChange = System.currentTimeMillis();
                int lastPct = -1;
                while (true) {
                    try { Thread.sleep(POLL_MS); } catch (InterruptedException ie) { break; }
                    int status; long got, total; int reason; String localUri;
                    Cursor c = null;
                    try {
                        c = dm.query(new DownloadManager.Query().setFilterById(id));
                        if (c == null || !c.moveToFirst()) {
                            call.reject("다운로드가 취소됐습니다.", "CANCELLED");   // 알림창에서 취소한 경우 등
                            return;
                        }
                        status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                        got = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                        total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                        reason = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                        localUri = c.getString(c.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI));
                    } catch (Exception e) {
                        call.reject("다운로드 상태를 확인하지 못했습니다: " + e.getMessage(), "QUERY_FAIL");
                        return;
                    } finally {
                        if (c != null) c.close();
                    }

                    if (status == DownloadManager.STATUS_SUCCESSFUL) {
                        // 성공은 "실제로 바이트가 있고, 전체 크기를 알면 그만큼 다 받았을 때"만 인정한다
                        if (got <= 0 || (total > 0 && got != total)) {
                            call.reject("파일이 다 받아지지 않았습니다(" + got + "/" + total + ").", "INCOMPLETE");
                            return;
                        }
                        String saved = name;
                        try {
                            if (localUri != null) {
                                String seg = Uri.parse(localUri).getLastPathSegment();
                                if (seg != null && !seg.isEmpty()) saved = seg;   // 같은 이름이 있어 "이름-1" 로 저장된 경우 반영
                            }
                        } catch (Exception ignore) { }
                        JSObject ret = new JSObject();
                        ret.put("id", id);
                        ret.put("name", saved);
                        ret.put("size", got);
                        ret.put("mime", mime);
                        ret.put("open", open ? openDownloaded(dm, id, mime, ask) : "skipped");
                        call.resolve(ret);
                        return;
                    }
                    if (status == DownloadManager.STATUS_FAILED) {
                        call.reject("다운로드에 실패했습니다(사유 " + reason + ").", "FAILED_" + reason);
                        return;
                    }
                    // 진행 중 / 대기(인터넷 기다림 등)
                    if (got != lastBytes) { lastBytes = got; lastChange = System.currentTimeMillis(); }
                    else {
                        long idle = System.currentTimeMillis() - lastChange;
                        if (got <= 0 && idle > FIRST_BYTE_MS) {
                            // 시작도 못 함: 일시정지면 사유(1 다시 시도 대기·2 인터넷 기다림·3 와이파이 대기·4 알 수 없음), 그냥 대기열이면 0
                            int why = (status == DownloadManager.STATUS_PAUSED) ? reason : 0;
                            try { dm.remove(id); } catch (Exception ignore) { }
                            call.reject("다운로드가 시작되지 않아 중단했습니다(대기 사유 " + why + ").", "WAITING_" + why);
                            return;
                        }
                        if (idle > STALL_MS) {
                            try { dm.remove(id); } catch (Exception ignore) { }   // 우리가 시작한 '받다 만' 조각만 정리
                            call.reject("다운로드가 오래 멈춰 있어 중단했습니다.", "STALLED");
                            return;
                        }
                    }
                    if (total > 0) {
                        int pct = (int) Math.min(99, (got * 100) / total);
                        if (pct >= lastPct + 5) {
                            lastPct = pct;
                            JSObject p = new JSObject();
                            p.put("id", id); p.put("name", name); p.put("pct", pct);
                            notifyListeners("progress", p);
                        }
                    }
                }
            }
        }).start();
    }

    /** 이미 받은 파일을 다시 연다(APK 설치 허용을 켜고 돌아왔을 때 등). */
    @PluginMethod
    public void open(PluginCall call) {
        // 주의: call.getLong 은 작은 수(JSON 이 Integer 로 읽음)면 null 을 준다 → Number/문자열 모두 직접 변환
        long id = -1;
        Object v = call.getData().opt("id");
        try {
            if (v instanceof Number) id = ((Number) v).longValue();
            else if (v != null) id = Long.parseLong(String.valueOf(v));
        } catch (Exception ignore) { id = -1; }
        if (id < 0) { call.reject("id 가 없습니다.", "BAD_ID"); return; }
        String mime = call.getString("mime");
        if (mime == null || mime.isEmpty()) mime = "application/octet-stream";
        DownloadManager dm = dm();
        if (dm == null) { call.reject("이 폰에서 다운로드 기능을 쓸 수 없습니다.", "NO_DM"); return; }
        JSObject ret = new JSObject();
        ret.put("open", openDownloaded(dm, id, mime, call.getBoolean("askPermission", Boolean.FALSE)));
        call.resolve(ret);
    }

    /**
     * 받은 파일을 연다. 반환: "opened" | "need_permission" | "no_app" | "no_uri" | "error"
     *  - APK: 안드로이드 8+ 는 앱별 「알 수 없는 앱 설치」 허용이 필요하다. 꺼져 있으면(ask=true일 때) 그 설정 화면을 연다.
     */
    private String openDownloaded(DownloadManager dm, long id, String mime, boolean ask) {
        Context ctx = getContext();
        Uri uri;
        try { uri = dm.getUriForDownloadedFile(id); } catch (Exception e) { uri = null; }
        if (uri == null) return "no_uri";
        if (APK_MIME.equals(mime) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !ctx.getPackageManager().canRequestPackageInstalls()) {
            if (ask) {
                try {
                    Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:" + ctx.getPackageName()));
                    s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    ctx.startActivity(s);
                } catch (Exception ignore) { }
            }
            return "need_permission";
        }
        try {
            Intent v = new Intent(Intent.ACTION_VIEW);
            v.setDataAndType(uri, mime);
            v.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(v);
            return "opened";
        } catch (ActivityNotFoundException e) {
            return "no_app";
        } catch (Exception e) {
            return "error";
        }
    }
}
