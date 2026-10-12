package com.kwak.voicememo;

import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMuxer;

import java.io.File;
import java.nio.ByteBuffer;
import java.util.List;

/**
 * v9.10(O-0449) 끊겼다가 「이어서 녹음」한 부분들(m4a 여러 개)을 한 파일로 이어 담는다.
 *
 *  - 재압축하지 않는다. 각 파일의 압축된 소리 틀을 꺼내(MediaExtractor) 순서대로 새 m4a 에 옮겨 적는다(MediaMuxer).
 *  - 부분 사이의 빠진 시간에는 아무것도 넣지 않는다(무음을 만들어 넣지 않는다) — 빠진 구간은 화면에 글로 적는다.
 *  - 평소 녹음(한 번에 시작해서 정지)에서는 이 코드가 돌지 않는다. 끊긴 뒤 이어 녹음한 경우에만 돈다.
 *  - 원본 파일은 읽기만 한다. 실패하면 만들다 만 결과물만 지우고 false — 부르는 쪽이 「뒷부분만」 넘긴다(잃는 것은 없다).
 */
final class RecJoin {

    private RecJoin() {}

    /**
     * @param parts    이어 담을 파일들(시간 순서). 모두 읽히는 것만 넘길 것.
     * @param out      결과 파일(있으면 덮어쓴다)
     * @param expectMs 부분들의 길이 합(ms) — 결과 길이가 이 값과 크게 다르면 실패로 본다
     */
    static boolean join(List<File> parts, File out, long expectMs) {
        MediaMuxer mux = null;
        boolean started = false, ok = false;
        try {
            if (parts == null || parts.size() < 2) return false;
            if (out.exists() && !out.delete()) return false;
            mux = new MediaMuxer(out.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            int dst = -1;
            MediaFormat first = null;
            long offsetUs = 0;
            long frames = 0;
            ByteBuffer buf = ByteBuffer.allocate(512 * 1024);
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();

            for (File p : parts) {
                MediaExtractor ex = new MediaExtractor();
                try {
                    ex.setDataSource(p.getAbsolutePath());
                    int tr = -1;
                    MediaFormat fmt = null;
                    for (int i = 0; i < ex.getTrackCount(); i++) {
                        MediaFormat f = ex.getTrackFormat(i);
                        String m = f.getString(MediaFormat.KEY_MIME);
                        if (m != null && m.startsWith("audio/")) { tr = i; fmt = f; break; }
                    }
                    if (tr < 0 || fmt == null) return false;
                    if (first == null) {
                        first = fmt;
                        dst = mux.addTrack(fmt);
                        mux.start();
                        started = true;
                    } else if (!same(first, fmt)) {
                        return false;                 // 형식이 다른 부분은 이어 붙이지 않는다
                    }
                    int sr = fmt.containsKey(MediaFormat.KEY_SAMPLE_RATE) ? fmt.getInteger(MediaFormat.KEY_SAMPLE_RATE) : 44100;
                    if (sr <= 0) sr = 44100;
                    long frameUs = 1024L * 1000000L / sr;     // AAC 한 틀 = 표본 1024개
                    ex.selectTrack(tr);
                    long lastUs = -1;
                    while (true) {
                        buf.clear();
                        int n = ex.readSampleData(buf, 0);
                        if (n < 0) break;
                        long t = ex.getSampleTime();
                        if (t < 0 || t <= lastUs) t = lastUs + frameUs;   // 시각이 뒤로 가지 않게
                        info.offset = 0;
                        info.size = n;
                        info.presentationTimeUs = offsetUs + t;
                        info.flags = MediaCodec.BUFFER_FLAG_KEY_FRAME;
                        mux.writeSampleData(dst, buf, info);
                        lastUs = t;
                        frames++;
                        if (!ex.advance()) break;
                    }
                    if (lastUs >= 0) offsetUs += lastUs + frameUs;
                } finally {
                    try { ex.release(); } catch (Throwable ignored) {}
                }
            }
            if (!started || frames == 0) return false;
            mux.stop();
            started = false;
            mux.release();
            mux = null;

            // 검증: 결과가 읽히고, 길이가 부분들의 합과 맞는가(부분마다 0.5초 + 1초까지 봐준다)
            long got = RecJournal.probeMs(out);
            long tol = 1000L + 500L * parts.size();
            ok = got > 0 && (expectMs <= 0 || Math.abs(got - expectMs) <= tol);
            return ok;
        } catch (Throwable e) {
            return false;
        } finally {
            try { if (mux != null) { if (started) mux.stop(); mux.release(); } } catch (Throwable ignored) {}
            if (!ok) { try { if (out.exists()) out.delete(); } catch (Throwable ignored) {} }   // 만들다 만 결과물만 지운다(원본은 그대로)
        }
    }

    /** 두 부분의 소리 형식이 같은가(종류 · 표본율 · 채널 수 · 압축기 설정값). */
    private static boolean same(MediaFormat a, MediaFormat b) {
        try {
            String ma = a.getString(MediaFormat.KEY_MIME), mb = b.getString(MediaFormat.KEY_MIME);
            if (ma == null || !ma.equals(mb)) return false;
            if (intOf(a, MediaFormat.KEY_SAMPLE_RATE) != intOf(b, MediaFormat.KEY_SAMPLE_RATE)) return false;
            if (intOf(a, MediaFormat.KEY_CHANNEL_COUNT) != intOf(b, MediaFormat.KEY_CHANNEL_COUNT)) return false;
            ByteBuffer ca = a.containsKey("csd-0") ? a.getByteBuffer("csd-0") : null;
            ByteBuffer cb = b.containsKey("csd-0") ? b.getByteBuffer("csd-0") : null;
            if (ca != null && cb != null) {
                ByteBuffer x = ca.duplicate(), y = cb.duplicate();
                x.rewind();
                y.rewind();
                if (!x.equals(y)) return false;
            }
            return true;
        } catch (Throwable e) {
            return false;
        }
    }

    private static int intOf(MediaFormat f, String key) {
        try { return f.containsKey(key) ? f.getInteger(key) : -1; } catch (Throwable e) { return -1; }
    }
}
