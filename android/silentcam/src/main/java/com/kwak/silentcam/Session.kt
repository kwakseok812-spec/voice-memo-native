package com.kwak.silentcam

import android.content.Context
import android.os.StatFs
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * 찍어 둔 사진의 «복구 목록» (O-0607 설계안 v3 C).
 *  - 임시 폴더: filesDir/silentcam/  (시스템이 마음대로 비우지 않는 곳. 처리가 끝난 파일은 JS 가 바로 지운다)
 *  - 복구 목록: 같은 폴더의 session.json — 한 장 찍을 때마다 즉시 적고, 마지막 갱신 시각(updated)을 함께 적는다.
 *  - 3일 청소(sweep)는 앱을 켤 때 한 번만, 카메라 화면이 열려 있지 않을 때만, 「복구 목록에 없고 3일 지난 파일」만 지운다.
 *    복구 목록의 마지막 갱신이 3일을 넘으면 목록과 그 파일을 함께 지운다.
 *  - 규칙 본체는 폴더(File)와 시각만 받는 함수로 두어, 폰 없이 PC 에서 단위 시험(SessionTest)을 돌릴 수 있다. Context 를 받는 함수는 얇은 껍데기다.
 */
object Session {
    const val KEEP_DAYS = 3                    // doc-scan.js 의 DSC_KEEP_DAYS 와 같은 값
    const val MAX_PAGES = 100                  // doc-scan.js 의 DSC_MAX_PAGES 와 같은 값
    const val LOW_DISK_PAGES = 20
    const val DISK_CAP_BYTES = 150L * 1024 * 1024
    const val LOW_DISK_BYTES = 300L * 1024 * 1024
    private const val DAY_MS = 86400000L

    class Page(val path: String, val q: String, val w: Int, val h: Int, val size: Long)

    class State(var updated: Long, var mode: String, var from: String, var multi: Boolean, val pages: MutableList<Page>)

    // ───────── 규칙 본체(폴더만 받는다) ─────────
    private fun sessionFile(dir: File) = File(dir, "session.json")

    @Synchronized
    fun read(dir: File): State? {
        return try {
            val f = sessionFile(dir)
            if (!f.exists()) return null
            val o = JSONObject(f.readText())
            val arr = o.optJSONArray("pages") ?: JSONArray()
            val list = ArrayList<Page>()
            for (i in 0 until arr.length()) {
                val p = arr.getJSONObject(i)
                val pf = File(p.getString("path"))
                if (pf.exists()) list.add(Page(pf.absolutePath, p.optString("q", "sharp"), p.optInt("w"), p.optInt("h"), pf.length()))
            }
            State(o.optLong("updated", 0L), o.optString("mode", "doc"), o.optString("from", "tab"), o.optBoolean("multi", true), list)
        } catch (e: Exception) { null }
    }

    @Synchronized
    fun write(dir: File, st: State) {
        try {
            if (st.pages.isEmpty()) { sessionFile(dir).delete(); return }
            val arr = JSONArray()
            st.pages.forEach { p -> arr.put(JSONObject().put("path", p.path).put("q", p.q).put("w", p.w).put("h", p.h)) }
            val o = JSONObject().put("updated", st.updated).put("mode", st.mode).put("from", st.from).put("multi", st.multi).put("pages", arr)
            val tmp = File(dir, "session.json.tmp")
            tmp.writeText(o.toString())
            if (!tmp.renameTo(sessionFile(dir))) { sessionFile(dir).writeText(o.toString()); tmp.delete() }
        } catch (e: Exception) { /* 목록을 못 적어도 촬영은 계속된다 */ }
    }

    /** 복구 목록에서 한 쪽을 빼고 파일을 지운다(JS 가 «담기 성공»을 확인한 뒤 한 쪽씩 부른다). 이 폴더 밖의 파일은 지우지 않는다. */
    @Synchronized
    fun release(dir: File, path: String, now: Long) {
        val st = read(dir)
        try {
            val f = File(path)
            if (f.absoluteFile.parentFile?.absolutePath == dir.absolutePath) f.delete()
        } catch (e: Exception) { }
        if (st != null) {
            st.pages.removeAll { File(it.path).absolutePath == File(path).absolutePath }
            st.updated = now
            write(dir, st)
        }
    }

    @Synchronized
    fun discardAll(dir: File) {
        dir.listFiles()?.forEach { try { it.delete() } catch (e: Exception) { } }
    }

    /** 한 번의 촬영에서 더 담을 수 있는 최대 쪽 수. 문서가 아니면 한 장, 저장 공간이 모자라면 20쪽까지. */
    fun cap(mode: String, left: Int, lowDisk: Boolean): Int {
        var c = if (mode == "doc") minOf(MAX_PAGES, maxOf(0, left)) else 1
        if (lowDisk) c = minOf(c, LOW_DISK_PAGES)
        return c
    }

    fun usedBytes(dir: File): Long = dir.listFiles()?.filter { it.name.endsWith(".jpg") }?.sumOf { it.length() } ?: 0L

    /**
     * 앱을 켤 때 한 번. 카메라가 열려 있으면 아무것도 지우지 않는다.
     * ① 복구 목록의 마지막 갱신이 3일을 넘으면 목록과 그 파일을 함께 지운다.
     * ② 그렇지 않으면 «복구 목록에 없고 수정한 지 3일이 지난 파일»만 지운다(복구 대기 파일은 그대로).
     * 반환: 지운 파일 수.
     */
    @Synchronized
    fun sweep(dir: File, now: Long, cameraOpen: Boolean): Int {
        if (cameraOpen) return 0
        var removed = 0
        val st = read(dir)
        if (st != null && st.updated > 0 && now - st.updated > KEEP_DAYS * DAY_MS) {
            dir.listFiles()?.forEach { if (it.delete()) removed++ }
            return removed
        }
        val keep = HashSet<String>()
        st?.pages?.forEach { keep.add(File(it.path).absolutePath) }
        dir.listFiles()?.forEach {
            if (it.name == "session.json") return@forEach
            if (it.absolutePath in keep) return@forEach
            if (now - it.lastModified() > KEEP_DAYS * DAY_MS) { if (it.delete()) removed++ }
        }
        return removed
    }

    // ───────── Context 껍데기 ─────────
    fun dir(ctx: Context): File = File(ctx.filesDir, "silentcam").apply { mkdirs() }
    fun read(ctx: Context): State? = read(dir(ctx))
    fun write(ctx: Context, st: State) = write(dir(ctx), st)
    fun release(ctx: Context, path: String) = release(dir(ctx), path, System.currentTimeMillis())
    fun discardAll(ctx: Context) = discardAll(dir(ctx))
    fun usedBytes(ctx: Context): Long = usedBytes(dir(ctx))
    fun freeBytes(ctx: Context): Long = try { StatFs(ctx.filesDir.absolutePath).availableBytes } catch (e: Exception) { Long.MAX_VALUE }
    fun sweep(ctx: Context): Int = sweep(dir(ctx), System.currentTimeMillis(), SilentCameraActivity.isOpen)
}
