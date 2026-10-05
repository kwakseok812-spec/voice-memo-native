package io.github.kwakseok812.glassmap.phone

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.os.Bundle
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import io.github.kwakseok812.glassmap.core.FrameBuilder
import io.github.kwakseok812.glassmap.core.Layout
import io.github.kwakseok812.glassmap.core.Scaler
import kotlin.math.abs
import kotlin.math.min

/**
 * "Set the area": the last screen frame is shown small and the user drags one box over it.
 * That box is what "the part I set" sends to the glasses.
 *
 *  show all : the box can have any shape. What is inside is shown completely on the lens;
 *             the unused part of the lens stays black.
 *  fill     : the box has the shape of the lens, so the lens is filled.
 *
 * Saved per screen size (folded / unfolded).
 */
class RegionActivity : Activity() {

    companion object {
        private const val REQ_PICK = 21
    }

    private lateinit var view: RegionView
    private lateinit var info: TextView
    private lateinit var fitInfo: TextView
    private lateinit var fitAll: Button
    private lateinit var fitFill: Button
    private var fit = FrameBuilder.FIT_CONTAIN

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        fit = Prefs.regionFit(this)
        val c = this
        val mp = ViewGroup.LayoutParams.MATCH_PARENT
        val wc = ViewGroup.LayoutParams.WRAP_CONTENT
        val pad = Ui.dp(c, 12)
        val g = Ui.dp(c, 8)

        val col = Ui.column(c)
        col.setPadding(pad, pad, pad, pad)
        col.addView(Ui.text(c, "영역 맞추기", 19f, Ui.TEXT, true))
        info = Ui.text(c, "", 13f, Ui.SUB)
        col.addView(info, Ui.lp(mp, wc, 0f, Ui.dp(c, 2)))

        val fitRow = Ui.row(c)
        fitAll = Ui.secondary(c, "전체 보이기")
        fitFill = Ui.secondary(c, "꽉 채우기")
        fitAll.setOnClickListener { setFit(FrameBuilder.FIT_CONTAIN) }
        fitFill.setOnClickListener { setFit(FrameBuilder.FIT_COVER) }
        fitRow.addView(fitAll, Ui.lp(0, wc, 1f))
        fitRow.addView(fitFill, Ui.lp(0, wc, 1f, 0, g))
        col.addView(fitRow, Ui.lp(mp, wc, 0f, g))
        fitInfo = Ui.text(c, "", 12f, Ui.SUB)
        col.addView(fitInfo, Ui.lp(mp, wc, 0f, Ui.dp(c, 2)))

        view = RegionView(c)
        col.addView(view, Ui.lp(mp, 0, 1f, g))

        val row1 = Ui.row(c)
        val whole = Ui.secondary(c, "화면 전체")
        whole.setOnClickListener { wholeScreen() }
        val pickBtn = Ui.secondary(c, "캡처 고르기")
        pickBtn.setOnClickListener { pickImage() }
        row1.addView(whole, Ui.lp(0, wc, 1f))
        row1.addView(pickBtn, Ui.lp(0, wc, 1f, 0, g))
        col.addView(row1, Ui.lp(mp, wc, 0f, g))
        val save = Ui.primary(c, "저장")
        save.setOnClickListener { save() }
        col.addView(save, Ui.lp(mp, wc, 0f, g))
        // The system bars are kept clear by a frame of its own, so the padding above stays as it is
        // (the assistant app is drawn edge to edge on Android 15 and later).
        val root = FrameLayout(c)
        root.fitsSystemWindows = true
        root.addView(col, ViewGroup.LayoutParams(mp, mp))
        setContentView(root)

        if (AppState.running) Shots.fromService()
        load()
    }

    override fun onStart() {
        super.onStart()
        AppState.onShown()
    }

    override fun onStop() {
        AppState.onHidden()
        super.onStop()
    }

    private fun load() {
        val b = Shots.current
        if (b == null) {
            info.text = "아직 화면 그림이 없습니다. 「시작」을 누르고 보려는 화면을 띄웠다가 돌아오거나, 「캡처 고르기」로 그 화면의 캡처 한 장을 골라 주세요."
            view.setPicture(null, null)
            refreshFit()
            return
        }
        val w = b.width
        val h = b.height
        val saved = Prefs.savedRegion(this, w, h) != null
        info.text = "초록 네모를 끌어 옮기고, 모서리를 끌어 크기를 바꾼 뒤 저장하세요. 화면 크기 " + w + "×" + h +
            (if (saved) " (저장된 값 있음)" else " (아직 저장된 값 없음)")
        view.lockShape = fit == FrameBuilder.FIT_COVER
        view.setPicture(b, Prefs.region(this, w, h))
        if (view.lockShape) view.trimToLensShape()
        refreshFit()
    }

    private fun refreshFit() {
        val all = fit == FrameBuilder.FIT_CONTAIN
        Ui.setSelected(this, fitAll, all)
        Ui.setSelected(this, fitFill, !all)
        fitInfo.text = if (all) "전체 보이기: 네모 안이 잘리지 않고 다 보입니다. 네모 모양은 자유이고, 안경 화면에서 남는 곳은 검게(투명하게) 둡니다."
        else "꽉 채우기: 네모 안으로 안경 화면을 꽉 채웁니다. 네모가 안경 화면 모양으로 고정됩니다."
    }

    private fun setFit(f: Int) {
        if (fit == f) return
        fit = f
        view.lockShape = f == FrameBuilder.FIT_COVER
        if (view.lockShape) view.trimToLensShape()
        view.invalidate()
        refreshFit()
    }

    /** The whole phone screen (with "fill": the largest part of it that has the lens shape). */
    private fun wholeScreen() {
        val b = Shots.current ?: return
        view.rect = Scaler.wholeScreen(b.width, b.height)
        if (view.lockShape) view.trimToLensShape()
        view.invalidate()
    }

    private fun save() {
        val b = Shots.current
        val r = view.rect
        Prefs.setRegionFit(this, fit)
        Prefs.setScope(this, Prefs.SCOPE_REGION)
        if (b != null && r != null) {
            Prefs.setRegion(this, b.width, b.height, r)
            Toast.makeText(this, "저장했습니다 (화면 크기 " + b.width + "×" + b.height + ").", Toast.LENGTH_SHORT).show()
        }
        AppState.service?.requestRerender()
        finish()
    }

    private fun pickImage() {
        val i = Intent(Intent.ACTION_GET_CONTENT)
        i.type = "image/*"
        i.addCategory(Intent.CATEGORY_OPENABLE)
        try {
            @Suppress("DEPRECATION")
            startActivityForResult(i, REQ_PICK)
        } catch (e: Exception) {
            Toast.makeText(this, "사진을 고를 수 없습니다.", Toast.LENGTH_SHORT).show()
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        val uri = data?.data
        if (requestCode == REQ_PICK && resultCode == RESULT_OK && uri != null) {
            if (Shots.fromUri(this, uri)) load()
            else Toast.makeText(this, "그림을 읽지 못했습니다.", Toast.LENGTH_SHORT).show()
        }
    }
}

/** Screen picture with one draggable box. Coordinates are kept in picture pixels. */
class RegionView(context: Context) : View(context) {
    var rect: IntArray? = null

    /** true = the box keeps the shape of the lens ("fill"); false = any shape ("show all") */
    var lockShape = false

    private var bmp: Bitmap? = null
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val dst = RectF()
    private var scale = 1f
    private var offX = 0f
    private var offY = 0f

    private var dragMode = 0          // 0 none, 1 move, 2 resize
    private var anchorX = 0f          // opposite corner while resizing (picture px)
    private var anchorY = 0f
    private var grabDX = 0f
    private var grabDY = 0f
    private val handle = 28f * resources.displayMetrics.density

    fun setPicture(b: Bitmap?, r: IntArray?) {
        bmp = b
        rect = r
        invalidate()
    }

    /** Make the box the lens shape: the largest such box inside the current one, same centre. */
    fun trimToLensShape() {
        val r = rect ?: return
        val c = FrameBuilder.coverCrop(r[2], r[3], Layout.W, Layout.H)
        rect = intArrayOf(r[0] + c[0], r[1] + c[1], c[2], c[3])
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.drawColor(0xFF202322.toInt())
        val b = bmp ?: return
        scale = min(width.toFloat() / b.width, height.toFloat() / b.height)
        offX = (width - b.width * scale) / 2f
        offY = (height - b.height * scale) / 2f
        dst.set(offX, offY, offX + b.width * scale, offY + b.height * scale)
        paint.style = Paint.Style.FILL
        paint.color = Color.WHITE
        paint.isFilterBitmap = true
        canvas.drawBitmap(b, null, dst, paint)
        // dim everything a little so the box stands out
        paint.color = 0x55000000
        canvas.drawRect(dst, paint)
        val r = rect ?: return
        val d = resources.displayMetrics.density
        val inset = 1.5f * d   // keep the outline visible when the box touches the picture edge
        val l = offX + r[0] * scale + inset
        val t = offY + r[1] * scale + inset
        val rr = offX + (r[0] + r[2]) * scale - inset
        val bb = offY + (r[1] + r[3]) * scale - inset
        paint.style = Paint.Style.FILL
        paint.color = 0x3339FF6A
        canvas.drawRect(l, t, rr, bb, paint)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 3f * d
        paint.color = 0xFF39FF6A.toInt()
        canvas.drawRect(l, t, rr, bb, paint)
        paint.style = Paint.Style.FILL
        val k = 7f * d
        for (p in arrayOf(floatArrayOf(l, t), floatArrayOf(rr, t), floatArrayOf(l, bb), floatArrayOf(rr, bb))) {
            canvas.drawCircle(p[0], p[1], k, paint)
        }
    }

    override fun onTouchEvent(e: MotionEvent): Boolean {
        val b = bmp ?: return false
        val r = rect ?: return false
        val px = (e.x - offX) / scale
        val py = (e.y - offY) / scale
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                parent?.requestDisallowInterceptTouchEvent(true)
                val hx = handle / scale
                val corners = arrayOf(
                    floatArrayOf(r[0].toFloat(), r[1].toFloat()),
                    floatArrayOf((r[0] + r[2]).toFloat(), r[1].toFloat()),
                    floatArrayOf(r[0].toFloat(), (r[1] + r[3]).toFloat()),
                    floatArrayOf((r[0] + r[2]).toFloat(), (r[1] + r[3]).toFloat())
                )
                dragMode = 0
                for (i in 0..3) {
                    if (abs(px - corners[i][0]) <= hx && abs(py - corners[i][1]) <= hx) {
                        val opp = corners[3 - i]
                        anchorX = opp[0]
                        anchorY = opp[1]
                        dragMode = 2
                        break
                    }
                }
                if (dragMode == 0 && px >= r[0] && px <= r[0] + r[2] && py >= r[1] && py <= r[1] + r[3]) {
                    dragMode = 1
                    grabDX = px - r[0]
                    grabDY = py - r[1]
                }
                return dragMode != 0
            }
            MotionEvent.ACTION_MOVE -> {
                if (dragMode == 1) {
                    val nx = (px - grabDX).toInt().coerceIn(0, b.width - r[2])
                    val ny = (py - grabDY).toInt().coerceIn(0, b.height - r[3])
                    rect = intArrayOf(nx, ny, r[2], r[3])
                    invalidate()
                } else if (dragMode == 2) {
                    val right = px >= anchorX
                    val down = py >= anchorY
                    // room available from the fixed corner towards the side the finger is on
                    val roomW = if (right) b.width - anchorX else anchorX
                    val roomH = if (down) b.height - anchorY else anchorY
                    val w: Float
                    val h: Float
                    if (lockShape) {
                        val aw = Layout.W
                        val ah = Layout.H
                        var ww = abs(px - anchorX)
                        val wFromH = abs(py - anchorY) * aw / ah
                        if (wFromH > ww) ww = wFromH
                        val maxW = min(roomW, roomH * aw / ah)
                        val minW = min(160f, maxW)
                        if (ww > maxW) ww = maxW
                        if (ww < minW) ww = minW
                        w = ww
                        h = ww * ah / aw
                    } else {
                        w = abs(px - anchorX).coerceIn(min(120f, roomW), roomW)
                        h = abs(py - anchorY).coerceIn(min(120f, roomH), roomH)
                    }
                    val x = if (right) anchorX else anchorX - w
                    val y = if (down) anchorY else anchorY - h
                    rect = Scaler.clampCrop(intArrayOf(Math.round(x), Math.round(y), Math.round(w), Math.round(h)), b.width, b.height)
                    invalidate()
                }
                return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                dragMode = 0
                parent?.requestDisallowInterceptTouchEvent(false)
                return true
            }
        }
        return true
    }
}
