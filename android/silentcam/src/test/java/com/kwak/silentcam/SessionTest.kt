package com.kwak.silentcam

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.nio.file.Files

/**
 * 설계안 v3 C 「앱 정리·접힘 복구 vs 3일 임시파일 청소」 규칙 시험(O-0607). 가짜 파일만 쓴다 — 폰·카메라 불필요.
 *  ① 복구 대기 파일이 3일 묵은 다른 파일과 섞여 있을 때 복구 파일만 남는가
 *  ② 복구 목록이 3일을 넘으면 목록·파일이 함께 사라지는가
 *  ③ 카메라가 열려 있으면 청소가 아무것도 안 지우는가
 *  ④ 복구 안내가 뜬 상태(선택 전)에서 청소가 여러 번 돌아도 파일이 그대로인가
 *  ⑥ 쪽 수가 100에 닿은 상태로 복구해도 상한이 지켜지는가
 */
class SessionTest {
    private val DAY = 86400000L
    private lateinit var dir: File
    private val now = 1_800_000_000_000L

    @Before
    fun setUp() {
        dir = Files.createTempDirectory("silentcam_test").toFile()
    }

    private fun jpg(name: String, ageMs: Long, bytes: Int = 1000): File {
        val f = File(dir, name)
        f.writeBytes(ByteArray(bytes))
        f.setLastModified(now - ageMs)
        return f
    }

    private fun session(updatedAgo: Long, vararg files: File, mode: String = "doc") {
        val st = Session.State(now - updatedAgo, mode, "tab", true, files.map { Session.Page(it.absolutePath, "sharp", 100, 100, it.length()) }.toMutableList())
        Session.write(dir, st)
    }

    @Test
    fun t1_recoveryFilesSurviveWhileOldUnlistedFilesAreRemoved() {
        val keep1 = jpg("scan_1.jpg", 5 * DAY)             // 파일 수정일은 오래됐지만 복구 목록에 있다
        val keep2 = jpg("scan_2.jpg", 4 * DAY)
        val oldOther = jpg("scan_old.jpg", 6 * DAY)        // 목록에 없고 3일 지남 → 지운다
        val freshOther = jpg("scan_fresh.jpg", 1 * 3600000L) // 목록에 없지만 3일 안 → 남긴다
        session(2 * 3600000L, keep1, keep2)                 // 목록 갱신은 2시간 전
        val removed = Session.sweep(dir, now, false)
        assertEquals(1, removed)
        assertTrue(keep1.exists()); assertTrue(keep2.exists()); assertTrue(freshOther.exists())
        assertFalse(oldOther.exists())
        assertEquals(2, Session.read(dir)!!.pages.size)
    }

    @Test
    fun t2_staleRecoveryListRemovesListAndFilesTogether() {
        val a = jpg("scan_1.jpg", 4 * DAY)
        val b = jpg("scan_2.jpg", 4 * DAY)
        session(4 * DAY, a, b)                              // 마지막 갱신이 3일을 넘음
        Session.sweep(dir, now, false)
        assertFalse(a.exists()); assertFalse(b.exists())
        assertFalse(File(dir, "session.json").exists())     // 둘 중 하나만 남지 않는다
        assertNull(Session.read(dir))
    }

    @Test
    fun t3_cameraOpenMeansNothingIsDeleted() {
        val old = jpg("scan_old.jpg", 9 * DAY)
        val a = jpg("scan_1.jpg", 9 * DAY)
        session(9 * DAY, a)
        assertEquals(0, Session.sweep(dir, now, true))
        assertTrue(old.exists()); assertTrue(a.exists()); assertNotNull(Session.read(dir))
    }

    @Test
    fun t4_repeatedSweepWhileRecoveryPromptIsUp_keepsFiles() {
        val a = jpg("scan_1.jpg", 2 * DAY)
        val b = jpg("scan_2.jpg", 2 * DAY)
        session(2 * DAY, a, b)                              // 3일 안
        repeat(5) { Session.sweep(dir, now + it * 60000L, false) }
        assertTrue(a.exists()); assertTrue(b.exists())
        assertEquals(2, Session.read(dir)!!.pages.size)
    }

    @Test
    fun t5_releaseRemovesOneFileAndListEntry_andIgnoresForeignPaths() {
        val a = jpg("scan_1.jpg", 1000)
        val b = jpg("scan_2.jpg", 1000)
        session(1000, a, b)
        Session.release(dir, a.absolutePath, now)
        assertFalse(a.exists()); assertTrue(b.exists())
        assertEquals(1, Session.read(dir)!!.pages.size)
        // 다른 폴더의 파일은 지우지 않는다
        val other = Files.createTempFile("foreign", ".jpg").toFile()
        Session.release(dir, other.absolutePath, now)
        assertTrue(other.exists())
        // 마지막 쪽까지 빼면 목록 파일도 사라진다
        Session.release(dir, b.absolutePath, now)
        assertFalse(File(dir, "session.json").exists())
        other.delete()
    }

    @Test
    fun t6_hundredPagesRecoveredStillRespectsLimit() {
        val files = (1..100).map { jpg("scan_$it.jpg", 1000, 10) }
        session(1000, *files.toTypedArray())
        val st = Session.read(dir)!!
        assertEquals(100, st.pages.size)
        // 이미 100쪽 → 더 담을 자리가 0 (카메라 화면의 «촬영 단추 흐려짐» 조건: 쪽 수 >= 상한)
        val cap = Session.cap("doc", Session.MAX_PAGES, false)
        assertEquals(100, cap)
        assertTrue(st.pages.size >= cap)
        // JS 쪽 DocScan 에 이미 60쪽이 있으면 left=40, 상한은 40
        assertEquals(40, Session.cap("doc", 40, false))
        // 저장 공간이 모자라면 20쪽까지만
        assertEquals(20, Session.cap("doc", 100, true))
        assertEquals(5, Session.cap("doc", 5, true))
        // 문서가 아니면 늘 한 장
        assertEquals(1, Session.cap("receipt", 100, false))
        assertEquals(1, Session.cap("photo", 100, false))
    }

    @Test
    fun t7_missingFilesAreDroppedFromList_andUsedBytesCounts() {
        val a = jpg("scan_1.jpg", 1000, 2000)
        val b = jpg("scan_2.jpg", 1000, 3000)
        session(1000, a, b)
        b.delete()
        val st = Session.read(dir)!!
        assertEquals(1, st.pages.size)
        assertEquals(2000L, Session.usedBytes(dir))
    }

    @Test
    fun t8_writingEmptyListDeletesSessionFile() {
        val a = jpg("scan_1.jpg", 1000)
        session(1000, a)
        assertTrue(File(dir, "session.json").exists())
        Session.write(dir, Session.State(now, "doc", "tab", true, mutableListOf()))
        assertFalse(File(dir, "session.json").exists())
    }

    @Test
    fun t9_discardAllClearsEverything() {
        val a = jpg("scan_1.jpg", 1000)
        session(1000, a)
        Session.discardAll(dir)
        assertEquals(0, dir.listFiles()!!.size)
    }
}
