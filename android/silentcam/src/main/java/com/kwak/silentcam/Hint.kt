package com.kwak.silentcam

import android.graphics.Bitmap
import android.graphics.BitmapFactory

/**
 * 찍은 직후 «글자 선명도·밝기» 힌트(O-0607). 막지 않고 알려 주기만 한다 — 틀려도 피해가 없다.
 * 계산 방법(합성 문서로 같은 식을 먼저 돌려 값을 정했다): 긴 변 1000px 회색 그림 → 라플라시안(4방향) → 32px 블록별 분산 →
 * 분산이 큰 위쪽 10% 블록의 평균 = 선명도. 밝기 = 회색 평균(0~255).
 * 문턱값은 글자가 있는 합성 문서로 정한 «처음 값»이며 실제 폴드8 사진으로 다시 맞춰야 한다(실기기 확인 대기).
 */
object Hint {
    const val BLUR_BELOW = 400f
    const val DARK_BELOW = 70f
    private const val SIDE = 1000
    private const val BLOCK = 32

    class Result(val q: String, val sharp: Float, val mean: Float, val w: Int, val h: Int)

    fun analyze(path: String): Result {
        var w = 0
        var h = 0
        try {
            val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(path, o)
            w = o.outWidth
            h = o.outHeight
            if (w <= 0 || h <= 0) return Result("sharp", 0f, 128f, 0, 0)
            var ss = 1
            while (maxOf(w, h) / (ss * 2) >= SIDE) ss *= 2
            val o2 = BitmapFactory.Options().apply { inSampleSize = ss; inPreferredConfig = Bitmap.Config.ARGB_8888 }
            val big = BitmapFactory.decodeFile(path, o2) ?: return Result("sharp", 0f, 128f, w, h)
            val sc = SIDE.toFloat() / maxOf(big.width, big.height)
            val small = if (sc < 1f) Bitmap.createScaledBitmap(big, maxOf(1, (big.width * sc).toInt()), maxOf(1, (big.height * sc).toInt()), true) else big
            if (small !== big) big.recycle()
            val bw = small.width
            val bh = small.height
            val px = IntArray(bw * bh)
            small.getPixels(px, 0, bw, 0, 0, bw, bh)
            small.recycle()
            val g = IntArray(bw * bh)
            var sum = 0L
            for (i in px.indices) {
                val c = px[i]
                val v = (77 * ((c shr 16) and 255) + 150 * ((c shr 8) and 255) + 29 * (c and 255)) shr 8
                g[i] = v
                sum += v
            }
            val mean = sum.toFloat() / g.size
            val vars = ArrayList<Float>()
            var by = 1
            while (by + BLOCK <= bh - 1) {
                var bx = 1
                while (bx + BLOCK <= bw - 1) {
                    var s = 0L
                    var s2 = 0L
                    for (y in by until by + BLOCK) {
                        val row = y * bw
                        for (x in bx until bx + BLOCK) {
                            val l = 4 * g[row + x] - g[row - bw + x] - g[row + bw + x] - g[row + x - 1] - g[row + x + 1]
                            s += l
                            s2 += l.toLong() * l
                        }
                    }
                    val n = (BLOCK * BLOCK).toFloat()
                    vars.add(s2 / n - (s / n) * (s / n))
                    bx += BLOCK
                }
                by += BLOCK
            }
            if (vars.isEmpty()) return Result("sharp", 0f, mean, w, h)
            vars.sortDescending()
            val k = maxOf(1, vars.size / 10)
            var t = 0f
            for (i in 0 until k) t += vars[i]
            val sharp = t / k
            val q = if (mean < DARK_BELOW) "dark" else if (sharp < BLUR_BELOW) "blur" else "sharp"
            return Result(q, sharp, mean, w, h)
        } catch (e: Throwable) {
            return Result("sharp", 0f, 128f, w, h)     // 못 재면 «문제 없음»으로 두고 막지 않는다
        }
    }
}
