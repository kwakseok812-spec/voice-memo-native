package com.kwak.voicememo;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.media.MediaMetadataRetriever;
import android.os.BatteryManager;
import android.os.Build;
import android.os.PowerManager;
import android.os.StatFs;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * v9.10(O-0449) 회의 녹음 일지 — 「끊긴 녹음 찾기」의 바탕.
 *
 * 왜: 녹음 파일의 이름은 녹음 서비스의 메모리 변수에만 있어서, 앱이 죽으면 그 파일을 찾을 길이 없었다.
 *     녹음이 「시작됐을 때」와 「정지했을 때」 한 번씩, 작은 글 파일(files/rec/r<시작시각>.json)에 적어 둔다.
 *
 * 지키는 것
 *  - 녹음하는 길(녹음기 설정 · 시작 · 정지)은 건드리지 않는다. 일지는 녹음기가 시작된 「뒤」, 정지한 「뒤」에만 쓴다.
 *  - 녹음하는 동안에는 아무것도 하지 않는다(주기적으로 도는 것이 없다).
 *  - 일지 쓰기가 실패해도 녹음은 그대로 간다(모든 예외를 삼키고 실패 수만 센다).
 *  - 어떤 녹음 파일도 지우지 않는다. 지우는 것은 이어 담다 실패한 임시 결과물뿐이다(RecJoin).
 *  - 회의 녹음(kind=meeting)만 적는다. 음성 대화 한 마디 · 아이디어 녹음은 적지 않는다(그 길에는 아무것도 더하지 않는다).
 *
 * 한 건 = { sid, kind, file(파일 이름), startedAt, group(이어 녹음이면 첫 부분의 sid), state, stoppedAt, durMs, bytes, s0 · s1(폰 상태), ... }
 * state : rec(녹음 중이라고 적힌 채) → stopped(정지함) → handed(임시저장 · 보내기로 넘김) / dropped(버림 · 목록에서 뺌) / joined(뒷부분과 한 파일로 이어짐)
 */
final class RecJournal {

    static final String DIR = "rec";
    static final String ST_REC = "rec";
    static final String ST_STOPPED = "stopped";
    static final String ST_HANDED = "handed";
    static final String ST_DROPPED = "dropped";
    static final String ST_JOINED = "joined";

    private static final Object LOCK = new Object();
    static volatile int writeFails = 0;          // 일지를 쓰지 못한 횟수(진단 값으로 나간다)

    private RecJournal() {}

    static String sidOf(long startedAt) { return "r" + startedAt; }

    static File dir(Context c) {
        File d = new File(c.getFilesDir(), DIR);
        if (!d.exists()) d.mkdirs();
        return d;
    }

    private static File fileOf(Context c, String sid) { return new File(dir(c), sid + ".json"); }

    // ───────────────────────── 읽기 · 쓰기 ─────────────────────────

    private static JSONObject read(File f) {
        FileInputStream in = null;
        try {
            if (!f.exists() || f.length() <= 0 || f.length() > 64 * 1024) return null;
            byte[] b = new byte[(int) f.length()];
            in = new FileInputStream(f);
            int off = 0;
            while (off < b.length) {
                int n = in.read(b, off, b.length - off);
                if (n < 0) break;
                off += n;
            }
            return new JSONObject(new String(b, 0, off, StandardCharsets.UTF_8));
        } catch (Throwable e) {
            return null;                          // 쓰다 만 일지 · 깨진 일지 = 없는 것으로 본다
        } finally {
            try { if (in != null) in.close(); } catch (Throwable ignored) {}
        }
    }

    /** 임시 파일에 다 쓴 뒤 이름을 바꿔 놓는다(쓰는 도중 앱이 죽어도 반쯤 쓴 일지가 남지 않게). */
    private static boolean write(Context c, JSONObject o) {
        FileOutputStream out = null;
        try {
            String sid = o.optString("sid", "");
            if (sid.length() == 0) return false;
            File tmp = new File(dir(c), sid + ".json.tmp");
            out = new FileOutputStream(tmp);
            out.write(o.toString().getBytes(StandardCharsets.UTF_8));
            out.flush();
            try { out.getFD().sync(); } catch (Throwable ignored) {}
            out.close();
            out = null;
            if (!tmp.renameTo(fileOf(c, sid))) { writeFails++; return false; }
            return true;
        } catch (Throwable e) {
            writeFails++;
            return false;
        } finally {
            try { if (out != null) out.close(); } catch (Throwable ignored) {}
        }
    }

    private static List<JSONObject> all(Context c) {
        List<JSONObject> out = new ArrayList<JSONObject>();
        try {
            File[] fs = dir(c).listFiles();
            if (fs == null) return out;
            for (File f : fs) {
                String n = f.getName();
                if (!n.endsWith(".json")) continue;
                JSONObject o = read(f);
                if (o != null && o.optString("sid", "").length() > 0) out.add(o);
            }
            Collections.sort(out, new Comparator<JSONObject>() {
                @Override
                public int compare(JSONObject a, JSONObject b) {
                    long x = a.optLong("startedAt", 0), y = b.optLong("startedAt", 0);
                    return x < y ? -1 : (x > y ? 1 : 0);
                }
            });
        } catch (Throwable ignored) {}
        return out;
    }

    private static String gidOf(JSONObject o) {
        String g = o.optString("group", "");
        return g.length() > 0 ? g : o.optString("sid", "");
    }

    // ───────────────────────── 적기(시작 · 정지 · 표시) ─────────────────────────

    /** 녹음기가 시작된 뒤에 부른다(다른 스레드). 이미 같은 건이 적혀 있으면(정지가 먼저 적힌 경우) 상태는 건드리지 않는다. */
    static void started(Context c, long startedAt, String fileName, String kind, String group) {
        try {
            synchronized (LOCK) {
                String sid = sidOf(startedAt);
                JSONObject o = read(fileOf(c, sid));
                if (o == null) {
                    o = new JSONObject();
                    o.put("sid", sid);
                    o.put("state", ST_REC);
                }
                o.put("kind", kind == null ? "" : kind);
                o.put("file", fileName == null ? "" : fileName);
                o.put("startedAt", startedAt);
                o.put("group", group == null ? "" : group);
                if (!o.has("s0")) o.put("s0", snap(c));
                write(c, o);
            }
        } catch (Throwable e) {
            writeFails++;
        }
    }

    /** 녹음기가 정지한 뒤에 부른다. drop=true 면 「녹음 취소」로 버린 것. */
    static void stopped(Context c, long startedAt, String fileName, String kind, String group, long durMs, long bytes, boolean drop) {
        try {
            synchronized (LOCK) {
                String sid = sidOf(startedAt);
                JSONObject o = read(fileOf(c, sid));
                if (o == null) {
                    o = new JSONObject();
                    o.put("sid", sid);
                    o.put("kind", kind == null ? "" : kind);
                    o.put("file", fileName == null ? "" : fileName);
                    o.put("startedAt", startedAt);
                    o.put("group", group == null ? "" : group);
                }
                o.put("state", drop ? ST_DROPPED : ST_STOPPED);
                o.put("stoppedAt", System.currentTimeMillis());
                o.put("durMs", durMs);
                o.put("bytes", bytes);
                o.put("s1", snap(c));
                write(c, o);
            }
        } catch (Throwable e) {
            writeFails++;
        }
    }

    /** 묶음(이어 녹음한 부분들) 전체에 상태를 적는다. 아직 처리되지 않은 부분(rec · stopped)만 바꾼다. */
    static boolean markGroup(Context c, String gid, String state, String how) {
        boolean any = false;
        try {
            synchronized (LOCK) {
                for (JSONObject o : all(c)) {
                    if (!gid.equals(gidOf(o))) continue;
                    String st = o.optString("state", "");
                    if (!(ST_REC.equals(st) || ST_STOPPED.equals(st))) continue;
                    o.put("state", state);
                    o.put("markedAt", System.currentTimeMillis());
                    if (how != null && how.length() > 0) o.put("how", how);
                    if (write(c, o)) any = true;
                }
            }
        } catch (Throwable e) {
            writeFails++;
        }
        return any;
    }

    /** 「한 번 여쭸다 / 나중에」 같은 표시(상태는 그대로). */
    static void flagGroup(Context c, String gid, String key, String val) {
        try {
            synchronized (LOCK) {
                for (JSONObject o : all(c)) {
                    if (!gid.equals(gidOf(o))) continue;
                    String st = o.optString("state", "");
                    if (!(ST_REC.equals(st) || ST_STOPPED.equals(st))) continue;
                    o.put(key, val);
                    write(c, o);
                }
            }
        } catch (Throwable e) {
            writeFails++;
        }
    }

    // ───────────────────────── 찾기 ─────────────────────────

    /** 파일이 읽히는가 — 길이(ms)를 돌려준다. 못 읽으면 0. */
    static long probeMs(File f) {
        MediaMetadataRetriever r = null;
        try {
            if (f == null || !f.exists() || f.length() <= 0) return 0;
            r = new MediaMetadataRetriever();
            r.setDataSource(f.getAbsolutePath());
            String d = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            return d != null ? Long.parseLong(d) : 0;
        } catch (Throwable e) {
            return 0;
        } finally {
            try { if (r != null) r.release(); } catch (Throwable ignored) {}
        }
    }

    private static File audioOf(Context c, JSONObject o) {
        String j = o.optString("joined", "");
        if (j.length() > 0) {
            File jf = new File(dir(c), j);
            if (jf.exists() && jf.length() > 0) return jf;
        }
        return new File(c.getFilesDir(), o.optString("file", ""));
    }

    private static long endOf(JSONObject o, File f) {
        long s = o.optLong("stoppedAt", 0);
        if (s > 0) return s;
        long m = (f != null && f.exists()) ? f.lastModified() : 0;   // 끊긴 시각 = 파일이 마지막으로 고쳐진 시각
        return m > 0 ? m : o.optLong("startedAt", 0);
    }

    private static Map<String, List<JSONObject>> openGroups(Context c, String liveFile) {
        Map<String, List<JSONObject>> g = new LinkedHashMap<String, List<JSONObject>>();
        Set<String> liveGroups = new HashSet<String>();
        for (JSONObject o : all(c)) {
            if (!RecordingService.KIND_MEETING.equals(o.optString("kind", ""))) continue;
            String gid = gidOf(o);
            if (liveFile != null && liveFile.length() > 0 && liveFile.equals(o.optString("file", ""))) { liveGroups.add(gid); continue; }
            String st = o.optString("state", "");
            if (!(ST_REC.equals(st) || ST_STOPPED.equals(st))) continue;
            List<JSONObject> l = g.get(gid);
            if (l == null) { l = new ArrayList<JSONObject>(); g.put(gid, l); }
            l.add(o);
        }
        for (String gid : liveGroups) g.remove(gid);      // 지금 이어 녹음하고 있는 묶음은 「끊긴 녹음」이 아니다
        // 이어 담은 파일을 가진 부분이 「이 앞부분들을 담았다」(absorbed)고 적어 둔 것은 뺀다.
        // (이어 담은 직후, 앞부분의 표시를 다 적기 전에 앱이 꺼진 경우 — 같은 소리가 두 번 잡히지 않게. 이어 담은 파일이 없으면 빼지 않는다.)
        for (List<JSONObject> l : g.values()) {
            Set<String> gone = null;
            for (JSONObject o : l) {
                JSONArray ab = o.optJSONArray("absorbed");
                String j = o.optString("joined", "");
                if (ab == null || ab.length() == 0 || j.length() == 0) continue;
                File jf = new File(dir(c), j);
                if (!(jf.exists() && jf.length() > 0)) continue;
                if (gone == null) gone = new HashSet<String>();
                for (int i = 0; i < ab.length(); i++) {
                    String s = ab.optString(i, "");
                    if (s.length() > 0) gone.add(s);
                }
            }
            if (gone == null) continue;
            List<JSONObject> keep = new ArrayList<JSONObject>();
            for (JSONObject o : l) if (!gone.contains(o.optString("sid", ""))) keep.add(o);
            l.clear();
            l.addAll(keep);
        }
        return g;
    }

    /**
     * 끊긴 녹음(일지에 「녹음 중」으로 남았는데 지금 돌고 있지 않은 것)과 보내지 않은 녹음(「정지」인데 넘김 표시가 없는 것).
     * 묶음 단위로 돌려준다. type: "cut"(끊김) | "unsent"(정지했으나 보내지 않음).
     */
    static JSONArray lost(Context c, String liveFile) {
        JSONArray out = new JSONArray();
        try {
            Map<String, List<JSONObject>> groups;
            synchronized (LOCK) { groups = openGroups(c, liveFile); }
            for (Map.Entry<String, List<JSONObject>> en : groups.entrySet()) {
                List<JSONObject> parts = en.getValue();
                if (parts.isEmpty()) continue;
                long dur = 0, bytes = 0, first = 0, end = 0;
                int ok = 0, bad = 0;
                boolean cut = false, asked = false, legacy = false;
                for (JSONObject o : parts) {
                    File f = audioOf(c, o);
                    long d = o.optLong("durMs", 0);
                    // 「녹음 중」으로 남은 것 · 길이를 모르는 것 · 앞부분과 이어 담은 것은 파일에서 길이를 읽는다
                    if (ST_REC.equals(o.optString("state", "")) || d <= 0 || !f.exists() || o.optString("joined", "").length() > 0) d = probeMs(f);
                    if (d > 0) { ok++; dur += d; } else bad++;
                    bytes += f.exists() ? f.length() : 0;
                    long s = o.optLong("firstAt", o.optLong("startedAt", 0));   // 이어 담은 녹음이면 첫 부분의 시작 시각
                    if (first == 0 || s < first) first = s;
                    long e = endOf(o, f);
                    if (e > end) end = e;
                    if (ST_REC.equals(o.optString("state", ""))) cut = true;
                    if (o.optString("asked", "").length() > 0) asked = true;
                    if (o.optBoolean("legacy", false)) legacy = true;
                }
                JSONObject it = new JSONObject();
                it.put("gid", en.getKey());
                it.put("type", cut ? "cut" : "unsent");
                it.put("startedAt", first);
                it.put("endedAt", end);
                it.put("durMs", dur);
                it.put("bytes", bytes);
                it.put("parts", parts.size());
                it.put("readable", ok > 0);
                it.put("unreadable", bad);
                it.put("asked", asked);
                it.put("legacy", legacy);
                out.put(it);
            }
        } catch (Throwable ignored) {}
        return out;
    }

    /**
     * 예전 판(v9.8 · v9.9)에서 끊긴 녹음 — 일지는 없지만 화면이 「시작 시각」 표식을 남겨 둔 경우.
     * 그 시각 가까이에 만들어진 memo_<시각>.m4a 가 있고 일지에 없으면, 그 파일을 「끊긴 녹음」으로 일지에 올린다.
     * (표식이 없는 옛 파일은 이미 보낸 녹음과 가릴 수 없어 올리지 않는다 — 진단 값으로 수만 센다.)
     */
    static void adoptLegacy(Context c, long sessAt, String liveFile) {
        try {
            if (sessAt <= 0) return;
            synchronized (LOCK) {
                Set<String> known = new HashSet<String>();
                for (JSONObject o : all(c)) {
                    known.add(o.optString("file", ""));
                    long s = o.optLong("startedAt", 0);
                    if (Math.abs(s - sessAt) < 30000L) return;          // 그 녹음은 이미 일지에 있다
                }
                File[] fs = c.getFilesDir().listFiles();
                if (fs == null) return;
                File best = null;
                long bestTs = 0, bestGap = Long.MAX_VALUE;
                for (File f : fs) {
                    long ts = memoTs(f.getName());
                    if (ts <= 0 || known.contains(f.getName())) continue;
                    if (liveFile != null && liveFile.equals(f.getName())) continue;
                    if (ts < sessAt - 20000L || ts > sessAt + 30000L) continue;
                    long gap = Math.abs(ts - sessAt);
                    if (gap < bestGap) { best = f; bestTs = ts; bestGap = gap; }
                }
                if (best == null) return;
                JSONObject o = new JSONObject();
                o.put("sid", sidOf(bestTs));
                o.put("state", ST_REC);
                o.put("kind", RecordingService.KIND_MEETING);
                o.put("file", best.getName());
                o.put("startedAt", bestTs);
                o.put("group", "");
                o.put("legacy", true);
                write(c, o);
            }
        } catch (Throwable e) {
            writeFails++;
        }
    }

    /** memo_<시각>.m4a → 시각(ms). 아니면 0. */
    private static long memoTs(String name) {
        try {
            if (name == null || !name.startsWith("memo_") || !name.endsWith(".m4a")) return 0;
            return Long.parseLong(name.substring(5, name.length() - 4));
        } catch (Throwable e) {
            return 0;
        }
    }

    // ───────────────────────── 꺼내기(여기까지 저장 · 이어 녹음 뒤 정지) ─────────────────────────

    /**
     * 묶음의 녹음을 한 파일로 내준다.
     *  - 부분이 하나면 그 파일 그대로.
     *  - 여러 부분이면 이어 담는다(RecJoin — 재압축 없음). 성공하면 앞부분들은 joined 로, 마지막 부분에 이어 담은 파일 이름을 적는다.
     *  - 이어 담기가 실패하면 「마지막 부분만」 내주고 그 부분을 묶음에서 떼어 낸다 → 앞부분은 끊긴 녹음으로 목록에 남는다(잃지 않는다).
     * 돌려주는 값: { ok, path, durMs, startedAt, endedAt, joined, parts, skipped, gaps:[{a,b}], code }
     */
    static JSONObject assemble(Context c, String gid, String liveFile) {
        JSONObject res = new JSONObject();
        try {
            res.put("ok", false);
            List<JSONObject> parts;
            synchronized (LOCK) {
                parts = openGroups(c, liveFile).get(gid);
            }
            if (parts == null || parts.isEmpty()) { res.put("code", "none"); return res; }
            List<JSONObject> good = new ArrayList<JSONObject>();
            List<File> files = new ArrayList<File>();
            List<Long> durs = new ArrayList<Long>();
            int skipped = 0;
            for (JSONObject o : parts) {
                File f = audioOf(c, o);
                long d = probeMs(f);
                if (d > 0) { good.add(o); files.add(f); durs.add(d); } else skipped++;
            }
            res.put("skipped", skipped);
            if (good.isEmpty()) { res.put("code", "unreadable"); return res; }

            File outFile = files.get(0);
            long total = durs.get(0);
            boolean joined = false;
            int used = 1;
            int lastIdx = good.size() - 1;
            if (good.size() > 1) {
                long sum = 0;
                for (Long d : durs) sum += d;
                File jf = new File(dir(c), "joined_" + gid + "_" + good.get(lastIdx).optString("sid", "x") + ".m4a");
                long t0 = System.currentTimeMillis();
                boolean okJoin = RecJoin.join(files, jf, sum);
                res.put("joinMs", System.currentTimeMillis() - t0);
                if (okJoin) {
                    joined = true; used = good.size(); outFile = jf; total = probeMs(jf);
                } else {
                    // 뒷부분만 내준다. 그 부분은 제 이름의 묶음으로 떼어 내, 앞부분이 따로 남게 한다.
                    outFile = files.get(lastIdx); total = durs.get(lastIdx); used = 1;
                    res.put("code", "join_failed");
                }
            }
            long now = System.currentTimeMillis();
            JSONArray gaps = new JSONArray();
            synchronized (LOCK) {
                if (joined || good.size() == 1) {
                    // 어느 순간에 앱이 꺼져도 목록에서 사라지는 녹음이 없게, 적는 순서를 지킨다.
                    //  ① 마지막 부분 한 건을 먼저 적는다(임시 파일 → 이름 바꾸기 한 번). 여기에 이어 담은 파일 이름과 「담은 앞부분」(absorbed)이 함께 들어간다.
                    //  ② 그것이 적힌 뒤에만 앞부분을 joined 로 표시한다.
                    //  ① 전에 꺼지면: 모든 부분이 그대로 남아 다음에 다시 이어 담는다. ①과 ② 사이에 꺼지면: openGroups 가 absorbed 를 보고 앞부분을 뺀다.
                    JSONArray absorbed = new JSONArray();
                    for (int i = 0; i < lastIdx; i++) {
                        long endI = endOf(good.get(i), files.get(i));
                        long nextStart = good.get(i + 1).optLong("startedAt", 0);
                        if (nextStart > endI) { JSONObject g = new JSONObject(); g.put("a", endI); g.put("b", nextStart); gaps.put(g); }
                        absorbed.put(good.get(i).optString("sid", ""));
                    }
                    JSONObject o = good.get(lastIdx);
                    long end = endOf(o, files.get(lastIdx));
                    if (ST_REC.equals(o.optString("state", ""))) { o.put("stoppedAt", end); o.put("durMs", durs.get(lastIdx)); }
                    o.put("state", ST_STOPPED);
                    if (joined) {
                        o.put("joined", outFile.getName());
                        o.put("firstAt", good.get(0).optLong("firstAt", good.get(0).optLong("startedAt", 0)));
                        o.put("gaps", gaps);          // 빠진 구간(다시 열 때도 같은 글을 보여 주게)
                        o.put("nparts", used);
                        o.put("absorbed", absorbed);
                    } else if (o.optJSONArray("gaps") != null) {
                        gaps = o.optJSONArray("gaps"); // 앞서 이어 담아 둔 녹음을 다시 여는 경우
                        used = o.optInt("nparts", 1);
                        joined = true;
                    }
                    boolean lastOk = write(c, o);                         // ①
                    if (lastOk) {
                        for (int i = 0; i < lastIdx; i++) {               // ②
                            JSONObject p = good.get(i);
                            p.put("state", ST_JOINED);
                            p.put("markedAt", now);
                            write(c, p);
                        }
                    }
                } else {
                    JSONObject o = good.get(lastIdx);
                    if (ST_REC.equals(o.optString("state", ""))) { o.put("stoppedAt", endOf(o, files.get(lastIdx))); o.put("durMs", durs.get(lastIdx)); }
                    o.put("state", ST_STOPPED);
                    o.put("group", "");                 // 떼어 냄: 이제 이 부분의 묶음 번호는 제 sid
                    write(c, o);
                }
            }
            JSONObject firstUsed = (joined || good.size() == 1) ? good.get(0) : good.get(lastIdx);
            JSONObject lastUsed = good.get(lastIdx);
            res.put("ok", true);
            res.put("path", outFile.getAbsolutePath());
            res.put("durMs", total);
            res.put("startedAt", firstUsed.optLong("firstAt", firstUsed.optLong("startedAt", 0)));
            res.put("endedAt", endOf(lastUsed, files.get(lastIdx)));
            res.put("joined", joined);
            res.put("parts", used);
            res.put("gaps", gaps);
            res.put("gid", (joined || good.size() == 1) ? gid : lastUsed.optString("sid", gid));
        } catch (Throwable e) {
            try { res.put("ok", false); res.put("code", "error"); } catch (Throwable ignored) {}
        }
        return res;
    }

    // ───────────────────────── 진단 값 ─────────────────────────

    /** 폰 상태 한 장: 배터리(%) · 충전 중 · 온도 단계 · 남은 공간(MB). 모르는 값은 -1. */
    static JSONObject snap(Context c) {
        JSONObject o = new JSONObject();
        try {
            int b = -1, chg = -1, th = -1;
            try {
                BatteryManager bm = (BatteryManager) c.getSystemService(Context.BATTERY_SERVICE);
                if (bm != null) {
                    b = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
                    if (Build.VERSION.SDK_INT >= 23) chg = bm.isCharging() ? 1 : 0;
                }
            } catch (Throwable ignored) {}
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
                    if (pm != null) th = pm.getCurrentThermalStatus();
                }
            } catch (Throwable ignored) {}
            o.put("b", b);
            o.put("c", chg);
            o.put("th", th);
            o.put("f", freeMb(c));
            o.put("t", System.currentTimeMillis());
        } catch (Throwable ignored) {}
        return o;
    }

    static long freeMb(Context c) {
        try {
            StatFs s = new StatFs(c.getFilesDir().getAbsolutePath());
            return s.getAvailableBytes() / (1024L * 1024L);
        } catch (Throwable e) {
            return -1;
        }
    }

    /** 앱이 지난 몇 번 왜 끝났는지(안드로이드 11 이상이 적어 둔 값을 읽기만 한다). r = 사유 번호, t = 그 시각, i = 그때의 중요도. */
    static JSONArray exits(Context c) {
        JSONArray out = new JSONArray();
        try {
            if (Build.VERSION.SDK_INT < 30) return out;
            ActivityManager am = (ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
            if (am == null) return out;
            List<ApplicationExitInfo> l = am.getHistoricalProcessExitReasons(null, 0, 5);
            if (l == null) return out;
            for (ApplicationExitInfo x : l) {
                JSONObject o = new JSONObject();
                o.put("r", x.getReason());
                o.put("t", x.getTimestamp());
                o.put("i", x.getImportance());
                String d = x.getDescription();
                if (d != null) o.put("d", d.length() > 60 ? d.substring(0, 60) : d);
                out.put(o);
            }
        } catch (Throwable ignored) {}
        return out;
    }

    /** 일지에 없는 옛 원본(memo_*.m4a)의 수 · 합계 용량 · 가장 오래된 날 · 최근 5개가 읽히는지. 지우지 않는다 — 세기만 한다. */
    static JSONObject legacyStats(Context c) {
        JSONObject o = new JSONObject();
        try {
            Set<String> known = new HashSet<String>();
            synchronized (LOCK) {
                for (JSONObject j : all(c)) known.add(j.optString("file", ""));
            }
            File[] fs = c.getFilesDir().listFiles();
            int n = 0;
            long bytes = 0, oldest = 0;
            List<File> memo = new ArrayList<File>();
            if (fs != null) {
                for (File f : fs) {
                    long ts = memoTs(f.getName());
                    if (ts <= 0 || known.contains(f.getName())) continue;
                    n++;
                    bytes += f.length();
                    if (oldest == 0 || ts < oldest) oldest = ts;
                    memo.add(f);
                }
            }
            Collections.sort(memo, new Comparator<File>() {
                @Override
                public int compare(File a, File b) {
                    long x = memoTs(a.getName()), y = memoTs(b.getName());
                    return x > y ? -1 : (x < y ? 1 : 0);
                }
            });
            JSONArray last = new JSONArray();
            for (int i = 0; i < memo.size() && i < 5; i++) {
                File f = memo.get(i);
                JSONObject x = new JSONObject();
                x.put("t", memoTs(f.getName()));
                x.put("kb", f.length() / 1024L);
                x.put("s", probeMs(f) / 1000L);          // 0 이면 읽히지 않는 파일
                last.put(x);
            }
            o.put("n", n);
            o.put("mb", bytes / (1024L * 1024L));
            o.put("old", oldest);
            o.put("last", last);
        } catch (Throwable ignored) {}
        return o;
    }

    /** 일지 요약(상태별 건수) — 진단 값. */
    static JSONObject counts(Context c) {
        JSONObject o = new JSONObject();
        try {
            int rec = 0, stopped = 0, handed = 0, dropped = 0, joined = 0;
            synchronized (LOCK) {
                for (JSONObject j : all(c)) {
                    String st = j.optString("state", "");
                    if (ST_REC.equals(st)) rec++;
                    else if (ST_STOPPED.equals(st)) stopped++;
                    else if (ST_HANDED.equals(st)) handed++;
                    else if (ST_DROPPED.equals(st)) dropped++;
                    else if (ST_JOINED.equals(st)) joined++;
                }
            }
            o.put("rec", rec);
            o.put("stopped", stopped);
            o.put("handed", handed);
            o.put("dropped", dropped);
            o.put("joined", joined);
            o.put("wf", writeFails);
        } catch (Throwable ignored) {}
        return o;
    }

    /** 한 건의 일지(진단 · 정지 응답용). 없으면 null. */
    static JSONObject get(Context c, String sid) {
        try {
            synchronized (LOCK) { return read(fileOf(c, sid)); }
        } catch (Throwable e) {
            return null;
        }
    }
}
