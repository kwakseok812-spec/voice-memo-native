package com.kwak.silentcam

import android.content.Context
import android.graphics.Matrix
import android.graphics.RectF
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.widget.ImageView

/**
 * 찍은 사진을 크게 보여 주는 화면(O-0607). 두 손가락으로 확대·축소, 한 손가락으로 끌기, 두 번 누르면 확대/되돌리기.
 * 글자가 읽히는지 확대해서 확인하는 것이 목적이다(시험 앱에서 가장 아쉬웠던 부분).
 */
class ZoomImageView(ctx: Context) : ImageView(ctx) {
    private val m = Matrix()
    private val vals = FloatArray(9)
    private var baseScale = 1f
    private var scale = 1f              // baseScale 에 대한 배율(1 = 화면에 꽉)
    private var lastX = 0f
    private var lastY = 0f
    private var dragging = false
    /** 사진이나 사진 밖을 누르는 순간(자동으로 넘어가는 중이면 멈추는 데 쓴다). */
    var onTouched: (() -> Unit)? = null

    private val scaleDetector = ScaleGestureDetector(ctx, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScale(d: ScaleGestureDetector): Boolean {
            val target = (scale * d.scaleFactor).coerceIn(1f, 6f)
            val f = target / scale
            m.postScale(f, f, d.focusX, d.focusY)
            scale = target
            fix()
            imageMatrix = m
            return true
        }
    })
    private val tapDetector = GestureDetector(ctx, object : GestureDetector.SimpleOnGestureListener() {
        override fun onDoubleTap(e: MotionEvent): Boolean {
            val target = if (scale > 1.5f) 1f else 2.5f
            val f = target / scale
            m.postScale(f, f, e.x, e.y)
            scale = target
            fix()
            imageMatrix = m
            return true
        }
    })

    init {
        scaleType = ScaleType.MATRIX
        setBackgroundColor(0xFF000000.toInt())
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        reset()
    }

    override fun setImageBitmap(bm: android.graphics.Bitmap?) {
        super.setImageBitmap(bm)
        reset()
    }

    private fun reset() {
        val d = drawable ?: return
        val vw = width.toFloat()
        val vh = height.toFloat()
        if (vw <= 0 || vh <= 0) return
        val dw = d.intrinsicWidth.toFloat()
        val dh = d.intrinsicHeight.toFloat()
        if (dw <= 0 || dh <= 0) return
        baseScale = minOf(vw / dw, vh / dh)
        scale = 1f
        m.reset()
        m.postScale(baseScale, baseScale)
        m.postTranslate((vw - dw * baseScale) / 2f, (vh - dh * baseScale) / 2f)
        imageMatrix = m
    }

    private fun rect(): RectF {
        val d = drawable ?: return RectF()
        val r = RectF(0f, 0f, d.intrinsicWidth.toFloat(), d.intrinsicHeight.toFloat())
        m.mapRect(r)
        return r
    }

    /** 사진이 화면 밖으로 너무 나가지 않게 붙잡는다(작을 때는 가운데). */
    private fun fix() {
        val r = rect()
        val vw = width.toFloat()
        val vh = height.toFloat()
        var dx = 0f
        var dy = 0f
        if (r.width() <= vw) dx = (vw - r.width()) / 2f - r.left else {
            if (r.left > 0) dx = -r.left
            if (r.right < vw) dx = vw - r.right
        }
        if (r.height() <= vh) dy = (vh - r.height()) / 2f - r.top else {
            if (r.top > 0) dy = -r.top
            if (r.bottom < vh) dy = vh - r.bottom
        }
        m.postTranslate(dx, dy)
    }

    override fun onTouchEvent(ev: MotionEvent): Boolean {
        if (ev.actionMasked == MotionEvent.ACTION_DOWN) onTouched?.invoke()
        scaleDetector.onTouchEvent(ev)
        tapDetector.onTouchEvent(ev)
        when (ev.actionMasked) {
            MotionEvent.ACTION_DOWN -> { lastX = ev.x; lastY = ev.y; dragging = true }
            MotionEvent.ACTION_MOVE -> if (dragging && !scaleDetector.isInProgress && scale > 1.01f) {
                m.postTranslate(ev.x - lastX, ev.y - lastY)
                fix()
                imageMatrix = m
                lastX = ev.x
                lastY = ev.y
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> dragging = false
            MotionEvent.ACTION_POINTER_UP -> {
                val i = if (ev.actionIndex == 0) 1 else 0
                if (i < ev.pointerCount) { lastX = ev.getX(i); lastY = ev.getY(i) }
            }
        }
        return true
    }

    override fun performClick(): Boolean = super.performClick()

    @Suppress("unused")
    private fun scaleValue(): Float { m.getValues(vals); return vals[Matrix.MSCALE_X] }
}
