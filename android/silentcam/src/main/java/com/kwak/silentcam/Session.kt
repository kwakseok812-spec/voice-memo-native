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

    fun dir(ctx: Context): File = File(ctx.filesDir, "silentcam").apply { mkdirs() }
    private fun file(ctx: Context) = File(dir(ctx), "session.json")

    @Synchronized
    fun read(ctx: Context): State? {
        return try {
            val f = file(ctx)
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
    fun write(ctx: Context, st: State) {
        try {
            if (st.pages.isEmpty()) { file(ctx).delete(); return }
            val arr = JSONArray()
            st.pages.forEach { p -> arr.put(JSONObject().put("path", p.path).put("q", p.q).put("w", p.w).put("h", p.h)) }
            val o = JSONObject().put("updated", st.updated).put("mode", st.mode).put("from", st.from).put("multi", st.multi).put("pages", arr)
            val tmp = File(dir(ctx), "session.json.tmp")
            tmp.writeText(o.toString())
            if (!tmp.renameTo(file(ctx))) { file(ctx).writeText(o.toString()); tmp.delete() }
        } catch (e: Exception) { /* 목록을 못 적어도 촬영은 계속된다 */ }
    }

    /** 복구 목록에서 한 쪽을 빼고 파일을 지운다(JS 가 «담기 성공»을 확인한 뒤 한 쪽씩 부른다). */
    @Synchronized
    fun release(ctx: Context, path: String) {
        val st = read(ctx)
        try {
            val f = File(path)
            if (f.parentFile?.absolutePath == dir(ctx).absolutePath) f.delete()
        } catch (e: Exception) { }
        if (st != null) {
            st.pages.removeAll { it.path == path }
            st.updated = System.currentTimeMillis()
            write(ctx, st)
        }
    }

    /** 목록과 파일을 통째로 버린다. */
    @Synchronized
    fun discardAll(ctx: Context) {
        dir(ctx).listFiles()?.forEach { try { it.delete() } catch (e: Exception) { } }
    }

    fun usedBytes(ctx: Context): Long = dir(ctx).listFiles()?.filter { it.name.endsWith(".jpg") }?.sumOf { it.length() } ?: 0L

    fun freeBytes(ctx: Context): Long = try { StatFs(ctx.filesDir.absolutePath).availableBytes } catch (e: Exception) { Long.MAX_VALUE }

    /**
     * 앱을 켤 때 한 번. 카메라가 열려 있으면 아무것도 지우지 않는다.
     * ① 복구 목록의 마지막 갱신이 3일을 넘으면 목록과 그 파일을 함께 지운다.
     * ② 그렇지 않으면 «복구 목록에 없고 수정한 지 3일이 지난 파일»만 지운다(복구 대기 파일은 그대로).
     */
    @Synchronized
    fun sweep(ctx: Context): Int {
        if (SilentCameraActivity.isOpen) return 0
        var removed = 0
        val now = System.currentTimeMillis()
        val st = read(ctx)
        val d = dir(ctx)
        if (st != null && st.updated > 0 && now - st.updated > KEEP_DAYS * DAY_MS) {
            d.listFiles()?.forEach { if (it.delete()) removed++ }
            return removed
        }
        val keep = HashSet<String>()
        st?.pages?.forEach { keep.add(File(it.path).absolutePath) }
        d.listFiles()?.forEach {
            if (it.name == "session.json") return@forEach
            if (it.absolutePath in keep) return@forEach
            if (now - it.lastModified() > KEEP_DAYS * DAY_MS) { if (it.delete()) removed++ }
        }
        return removed
    }
}
