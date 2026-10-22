package com.kwak.silentcam

import android.Manifest
import android.animation.ValueAnimator
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.media.ExifInterface
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.MediaStore
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.OrientationEventListener
import android.view.Surface
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * 스마트비서의 «소리 없는 카메라» 화면 (O-0607, v9.29).
 *  - 앱이 내는 소리는 전혀 없다(MediaActionSound 등을 쓰지 않는다 — 시제품 camtest 와 같은 방식).
 *  - 한 화면이 세 입구를 받는다: 홈 「카메라」 칸(from=tab: 모드 3가지 고르기) · 스캔 화면의 「한 장 더/다시 찍기」 · 영수증 「다시 찍기」(from=scan: 모드 고정).
 *  - 모드: doc(문서·여러 장 이어 찍기 가능) / receipt(한 장) / photo(일반 사진 — 번쩍임과 진동을 끌 수 없음).
 *  - 사진은 쪽마다 filesDir/silentcam/ 에 JPEG 로 저장하고 복구 목록(session.json)에 바로 적는다. 결과는 경로 목록(JSON)만 돌려준다.
 *  - 화면 글은 케이 말투. «무음/소리 없이» 같은 낱말은 화면에 쓰지 않는다.
 */
class SilentCameraActivity : ComponentActivity() {

    companion object {
        @Volatile var isOpen = false
        const val X_MODE = "mode"           // doc | receipt | photo
        const val X_FROM = "from"           // tab | scan
        const val X_MULTI = "multi"
        const val X_LEFT = "left"           // 앞으로 더 담을 수 있는 쪽 수(문서)
        const val X_TITLE = "title"
        const val X_ENGINE = "engine"       // auto | quality | fast | frame
        const val X_RESUME = "resume"
        const val RESULT = "json"
        const val AUTO_MS = 2800L
        private const val PREFS = "silentcam"
    }

    // ───────── 상태 ─────────
    private lateinit var prefs: SharedPreferences
    private var mode = "doc"
    private var from = "tab"
    private var multi = true
    private var left = Session.MAX_PAGES
    private var customTitle: String? = null
    private var engine = "auto"
    private var lowDisk = false
    private val carried = ArrayList<Session.Page>()          // 이번 촬영 전부터 복구 목록에 있던 쪽(이 화면에서는 건드리지 않는다)
    private val pages = ArrayList<Session.Page>()            // 이번 촬영에서 찍은 쪽
    private val shook = HashSet<String>()                    // 찍는 순간 손떨림이 있었던 쪽
    private var flashMode = ImageCapture.FLASH_MODE_OFF
    private var busy = false                                 // 촬영 중 / 확인 화면 중
    private var closing = false
    private var darkLive = false
    private var shakeLevel = 0f
    private var lastTap: Pair<Float, Float>? = null

    private val main = Handler(Looper.getMainLooper())
    private val bg = Executors.newSingleThreadExecutor()
    private val camExec = Executors.newSingleThreadExecutor()
    private val thumbs = HashMap<String, Bitmap>()

    // 카메라
    private var camera: Camera? = null
    private var imageCapture: ImageCapture? = null
    private var analysis: ImageAnalysis? = null
    private val wantFrame = AtomicBoolean(false)
    private var frameTarget: File? = null
    private var orientation: OrientationEventListener? = null

    // 화면
    private lateinit var root: FrameLayout
    private lateinit var previewView: PreviewView
    private lateinit var guide: GuideView
    private lateinit var flashView: View
    private lateinit var ui: FrameLayout
    private lateinit var titleTv: TextView
    private lateinit var flashBtn: TextView
    private lateinit var modeRow: LinearLayout
    private lateinit var chipDoc: TextView
    private lateinit var chipRcpt: TextView
    private lateinit var chipPhoto: TextView
    private lateinit var multiRow: LinearLayout
    private lateinit var multiChip: TextView
    private lateinit var infoTv: TextView
    private lateinit var noticeTv: TextView
    private lateinit var hintTv: TextView
    private lateinit var strip: HorizontalScrollView
    private lateinit var stripBox: LinearLayout
    private lateinit var bottomBar: FrameLayout
    private lateinit var lastThumb: ImageView
    private lateinit var shutter: FrameLayout
    private lateinit var doneBtn: TextView
    private lateinit var focusRing: View
    private lateinit var layers: FrameLayout                // 확인·설정·대화상자(맨 위)
    private val insetViews = ArrayList<View>()
    private var inL = 0
    private var inT = 0
    private var inR = 0
    private var inB = 0
    private var autoAnim: ValueAnimator? = null
    private var guideReset: Runnable? = null

    private val permLauncher = registerForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) bindCamera() else { finishWith("denied") }
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density + 0.5f).toInt()
    private fun reduceMotion(): Boolean = try {
        Settings.Global.getFloat(contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    } catch (e: Exception) { false }

    // ───────── 시작 ─────────
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        isOpen = true
        prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        mode = intent.getStringExtra(X_MODE) ?: "doc"
        if (mode != "doc" && mode != "receipt" && mode != "photo") mode = "doc"
        from = intent.getStringExtra(X_FROM) ?: "tab"
        multi = intent.getBooleanExtra(X_MULTI, mode == "doc")
        left = intent.getIntExtra(X_LEFT, Session.MAX_PAGES).coerceIn(0, Session.MAX_PAGES)
        customTitle = intent.getStringExtra(X_TITLE)
        engine = intent.getStringExtra(X_ENGINE) ?: "auto"
        lowDisk = Session.freeBytes(this) < Session.LOW_DISK_BYTES
        if (from == "tab" && mode == "doc") multi = prefs.getBoolean("multiDoc", true)
        if (mode != "doc") multi = false

        val st = Session.read(this)
        if (st != null) {
            if (intent.getBooleanExtra(X_RESUME, false)) { pages.addAll(st.pages); mode = st.mode; from = st.from; multi = st.multi }
            else carried.addAll(st.pages)
        }

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        buildUi()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { onBack() }
        })

        orientation = object : OrientationEventListener(this) {
            override fun onOrientationChanged(o: Int) {
                if (o == ORIENTATION_UNKNOWN) return
                val r = when {
                    o in 45..134 -> Surface.ROTATION_270
                    o in 135..224 -> Surface.ROTATION_180
                    o in 225..314 -> Surface.ROTATION_90
                    else -> Surface.ROTATION_0
                }
                imageCapture?.targetRotation = r
                analysis?.targetRotation = r
            }
        }
        applyMode()
        for (p in pages) addThumb(p)
        refreshAll()

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) bindCamera()
        else permLauncher.launch(Manifest.permission.CAMERA)
    }

    override fun onResume() {
        super.onResume()
        orientation?.enable()
        val sm = getSystemService(Context.SENSOR_SERVICE) as? SensorManager
        sm?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)?.let { sm.registerListener(sensorL, it, SensorManager.SENSOR_DELAY_UI) }
        sm?.getDefaultSensor(Sensor.TYPE_LIGHT)?.let { sm.registerListener(sensorL, it, SensorManager.SENSOR_DELAY_NORMAL) }
        main.post(guideTick)
    }

    override fun onPause() {
        super.onPause()
        orientation?.disable()
        (getSystemService(Context.SENSOR_SERVICE) as? SensorManager)?.unregisterListener(sensorL)
        main.removeCallbacks(guideTick)
    }

    override fun onDestroy() {
        super.onDestroy()
        isOpen = false
        autoAnim?.cancel()
        main.removeCallbacksAndMessages(null)
        bg.shutdown()
        camExec.shutdown()
        try { camExec.awaitTermination(300, TimeUnit.MILLISECONDS) } catch (e: Exception) { }
    }

    override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
        super.onConfigurationChanged(newConfig)
        // 접기·펴기·돌리기: 화면 크기가 바뀌어도 이 화면은 다시 만들어지지 않는다. 카메라 방향만 맞춘다.
        val rot = previewView.display?.rotation ?: Surface.ROTATION_0
        analysis?.targetRotation = rot
    }

    // ───────── 센서(손떨림·어두움 안내) ─────────
    private val sensorL = object : SensorEventListener {
        override fun onSensorChanged(e: SensorEvent) {
            if (e.sensor.type == Sensor.TYPE_ACCELEROMETER) {
                val a = sqrt(e.values[0] * e.values[0] + e.values[1] * e.values[1] + e.values[2] * e.values[2])
                shakeLevel = 0.8f * shakeLevel + 0.2f * abs(a - 9.81f)
            } else if (e.sensor.type == Sensor.TYPE_LIGHT) {
                darkLive = e.values[0] < 10f
            }
        }
        override fun onAccuracyChanged(s: Sensor?, a: Int) { }
    }
    private val guideTick = object : Runnable {
        override fun run() { updateGuideText(); main.postDelayed(this, 400) }
    }

    // ───────── 화면 만들기 ─────────
    private fun tv(text: String, sp: Float = 15f, color: Int = Color.WHITE, bold: Boolean = false): TextView = TextView(this).apply {
        this.text = text
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
        setTextColor(color)
        if (bold) typeface = Typeface.DEFAULT_BOLD
        includeFontPadding = false
    }

    private fun round(color: Int, rDp: Int, stroke: Int? = null): GradientDrawable = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(rDp).toFloat()
        if (stroke != null) setStroke(dp(2), stroke)
    }

    private fun button(label: String, primary: Boolean, weight: Float = 0f, onClick: () -> Unit): TextView = tv(label, 16f, Color.WHITE, true).apply {
        gravity = Gravity.CENTER
        minHeight = dp(52)
        minimumHeight = dp(52)
        setPadding(dp(12), dp(8), dp(12), dp(8))
        background = if (primary) round(0xFF3B82F6.toInt(), 14) else round(0x33FFFFFF, 14, 0x66FFFFFF)
        isClickable = true
        isFocusable = true
        contentDescription = label
        setOnClickListener { onClick() }
        layoutParams = if (weight > 0f) LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, weight).apply { setMargins(dp(4), 0, dp(4), 0) }
        else LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    }

    private fun chip(label: String, onClick: () -> Unit): TextView = tv(label, 14f, Color.WHITE, true).apply {
        gravity = Gravity.CENTER
        minHeight = dp(44)
        minimumHeight = dp(44)
        setPadding(dp(14), dp(6), dp(14), dp(6))
        isClickable = true
        isFocusable = true
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { setMargins(dp(3), 0, dp(3), 0) }
    }

    private fun iconBtn(label: String, desc: String, onClick: () -> Unit): TextView = tv(label, 17f, Color.WHITE, true).apply {
        gravity = Gravity.CENTER
        minWidth = dp(48)
        minimumWidth = dp(48)
        minHeight = dp(48)
        minimumHeight = dp(48)
        setPadding(dp(8), 0, dp(8), 0)
        contentDescription = desc
        isClickable = true
        isFocusable = true
        setOnClickListener { onClick() }
    }

    private fun buildUi() {
        root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        previewView = PreviewView(this).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
            scaleType = PreviewView.ScaleType.FIT_CENTER
        }
        root.addView(previewView, FrameLayout.LayoutParams(-1, -1))
        guide = GuideView(this)
        root.addView(guide, FrameLayout.LayoutParams(-1, -1))
        flashView = View(this).apply { setBackgroundColor(Color.WHITE); alpha = 0f; isClickable = false }
        root.addView(flashView, FrameLayout.LayoutParams(-1, -1))

        // 초점 동그라미
        focusRing = View(this).apply {
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.TRANSPARENT); setStroke(dp(2), Color.WHITE) }
            alpha = 0f
            isClickable = false
        }
        root.addView(focusRing, FrameLayout.LayoutParams(dp(64), dp(64)))

        previewView.setOnTouchListener { v, ev ->
            if (ev.action == MotionEvent.ACTION_UP && !busy) {
                lastTap = Pair(ev.x, ev.y)
                val cam = camera
                if (cam != null) {
                    val p = previewView.meteringPointFactory.createPoint(ev.x, ev.y)
                    try { cam.cameraControl.startFocusAndMetering(FocusMeteringAction.Builder(p).build()) } catch (e: Exception) { }
                    showFocusRing(ev.x, ev.y)
                }
                v.performClick()
            }
            true
        }

        ui = FrameLayout(this)
        root.addView(ui, FrameLayout.LayoutParams(-1, -1))
        insetViews.add(ui)

        // 위 묶음: 윗줄 · 모드 칩 · 이어 찍기 칩 · 안내 · 알림
        val top = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(0x99000000.toInt()) }
        val bar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(4), dp(2), dp(4), dp(2)) }
        bar.addView(iconBtn("✕", "닫기") { onClose() })
        titleTv = tv("", 17f, Color.WHITE, true).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(dp(4), 0, dp(4), 0) }
        bar.addView(titleTv, LinearLayout.LayoutParams(0, dp(48), 1f))
        flashBtn = iconBtn("⚡ 끔", "불빛 바꾸기") { cycleFlash() }
        bar.addView(flashBtn)
        bar.addView(iconBtn("⚙", "카메라 설정") { openSettings() })
        top.addView(bar)

        modeRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER; setPadding(dp(8), dp(2), dp(8), dp(4)) }
        chipDoc = chip("문서") { setMode("doc") }
        chipRcpt = chip("영수증") { setMode("receipt") }
        chipPhoto = chip("일반 사진") { setMode("photo") }
        modeRow.addView(chipDoc); modeRow.addView(chipRcpt); modeRow.addView(chipPhoto)
        top.addView(modeRow)

        multiRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(8), 0, dp(8), dp(4)) }
        multiChip = chip("") { toggleMulti() }
        multiRow.addView(multiChip)
        top.addView(multiRow)

        infoTv = tv("", 13f, 0xFFD0D6E6.toInt()).apply { gravity = Gravity.CENTER; setPadding(dp(12), 0, dp(12), dp(6)) }
        top.addView(infoTv)
        noticeTv = tv("", 14f, 0xFF111111.toInt(), true).apply { gravity = Gravity.CENTER; setPadding(dp(12), dp(8), dp(12), dp(8)); setBackgroundColor(0xFFFBBF24.toInt()); visibility = View.GONE }
        top.addView(noticeTv)
        ui.addView(top, FrameLayout.LayoutParams(-1, -2, Gravity.TOP))

        // 아래 묶음: 안내 한 줄 · 썸네일 줄 · 촬영 줄
        val bottom = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(0x99000000.toInt()) }
        hintTv = tv("", 15f, Color.WHITE, true).apply { gravity = Gravity.CENTER; setPadding(dp(14), dp(8), dp(14), dp(6)) }
        bottom.addView(hintTv)
        strip = HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; visibility = View.GONE }
        stripBox = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(dp(8), dp(4), dp(8), dp(4)) }
        strip.addView(stripBox)
        bottom.addView(strip, LinearLayout.LayoutParams(-1, dp(72)))
        bottomBar = FrameLayout(this).apply { setPadding(dp(14), dp(6), dp(14), dp(10)) }
        lastThumb = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            background = round(0x33FFFFFF, 10, 0x66FFFFFF)
            clipToOutline = true
            visibility = View.INVISIBLE
            contentDescription = "방금 찍은 사진 보기"
            setOnClickListener { if (pages.isNotEmpty()) peek(pages.size - 1) }
        }
        bottomBar.addView(lastThumb, FrameLayout.LayoutParams(dp(56), dp(56), Gravity.START or Gravity.CENTER_VERTICAL))
        shutter = FrameLayout(this).apply {
            contentDescription = "찍기"
            isClickable = true
            isFocusable = true
            val ring = View(this@SilentCameraActivity).apply { background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.TRANSPARENT); setStroke(dp(4), Color.WHITE) } }
            val core = View(this@SilentCameraActivity).apply { background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.WHITE) } }
            addView(ring, FrameLayout.LayoutParams(-1, -1))
            addView(core, FrameLayout.LayoutParams(dp(56), dp(56), Gravity.CENTER))
            setOnTouchListener { v, ev ->
                if (!reduceMotion()) {
                    if (ev.action == MotionEvent.ACTION_DOWN) v.animate().scaleX(0.92f).scaleY(0.92f).setDuration(80).start()
                    else if (ev.action == MotionEvent.ACTION_UP || ev.action == MotionEvent.ACTION_CANCEL) v.animate().scaleX(1f).scaleY(1f).setDuration(80).start()
                }
                false
            }
            setOnClickListener { shoot() }
        }
        bottomBar.addView(shutter, FrameLayout.LayoutParams(dp(72), dp(72), Gravity.CENTER))
        doneBtn = button("완료", true) { onDone() }
        bottomBar.addView(doneBtn, FrameLayout.LayoutParams(-2, dp(52), Gravity.END or Gravity.CENTER_VERTICAL))
        bottom.addView(bottomBar)
        ui.addView(bottom, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))

        layers = FrameLayout(this)
        root.addView(layers, FrameLayout.LayoutParams(-1, -1))

        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val i = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            inL = i.left; inT = i.top; inR = i.right; inB = i.bottom
            for (v in insetViews) v.setPadding(inL, inT, inR, inB)
            insets
        }
    }

    /** 안전 영역(상태바·아래 제스처 띠·카메라 구멍)을 지키는 전체 화면 덮개를 만든다. */
    private fun layer(): FrameLayout {
        val l = FrameLayout(this).apply { setBackgroundColor(0xFF000000.toInt()); isClickable = true }
        l.setPadding(inL, inT, inR, inB)
        insetViews.add(l)
        layers.addView(l, FrameLayout.LayoutParams(-1, -1))
        return l
    }
    private fun removeLayer(l: View) {
        insetViews.remove(l)
        layers.removeView(l)
    }

    /** 가장자리 안내선: 화면 가장자리에서 6% 안쪽의 옅은 점선 사각형. 실시간 문서 인식은 하지 않는다(찍은 뒤 기존 자동 테두리가 한다). */
    class GuideView(ctx: Context) : View(ctx) {
        private val p = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            color = 0x99FFFFFF.toInt()
            strokeWidth = 3f * ctx.resources.displayMetrics.density
            pathEffect = DashPathEffect(floatArrayOf(18f, 14f), 0f)
        }
        var on = true
            set(v) { field = v; invalidate() }
        override fun onDraw(c: Canvas) {
            if (!on) return
            val mx = width * 0.06f
            val my = height * 0.20f
            val r = RectF(mx, my, width - mx, height - my)
            c.drawRoundRect(r, 24f, 24f, p)
        }
    }

    // ───────── 모드·글 ─────────
    private fun baseTitle(): String = customTitle ?: when (mode) {
        "receipt" -> "영수증 스캔"
        "photo" -> "일반 사진"
        else -> "문서 스캔"
    }

    private fun capPages(): Int {
        var c = if (mode == "doc") minOf(Session.MAX_PAGES, left) else 1
        if (lowDisk) c = minOf(c, Session.LOW_DISK_PAGES)
        return c
    }

    private fun setMode(m: String) {
        if (from != "tab" || pages.isNotEmpty() || busy) return
        mode = m
        multi = if (m == "doc") prefs.getBoolean("multiDoc", true) else false
        prefs.edit().putString("lastMode", m).apply()
        applyMode()
        refreshAll()
    }

    private fun toggleMulti() {
        if (from != "tab" || mode != "doc" || pages.isNotEmpty()) return
        multi = !multi
        prefs.edit().putBoolean("multiDoc", multi).apply()
        refreshAll()
    }

    private fun applyMode() {
        modeRow.visibility = if (from == "tab") View.VISIBLE else View.GONE
        guide.on = mode != "photo"
        fun paint(c: TextView, sel: Boolean) {
            c.background = if (sel) round(0xFF3B82F6.toInt(), 22) else round(0x33FFFFFF, 22, 0x55FFFFFF)
            c.alpha = if (!sel && pages.isNotEmpty()) 0.4f else 1f
            c.contentDescription = c.text.toString() + if (sel) " 선택됨" else ""
        }
        paint(chipDoc, mode == "doc")
        paint(chipRcpt, mode == "receipt")
        paint(chipPhoto, mode == "photo")
    }

    private fun refreshAll() {
        applyMode()
        val n = pages.size
        titleTv.text = when {
            from == "scan" && customTitle != null -> customTitle
            mode == "doc" && multi -> baseTitle() + " · " + (n + 1) + "쪽째"
            mode == "doc" -> baseTitle() + " · 한 장"
            else -> baseTitle()
        }
        // 이어 찍기 칩과 안내 줄
        val showMulti = from == "tab" && mode == "doc"
        multiRow.visibility = if (showMulti) View.VISIBLE else View.GONE
        if (showMulti) {
            multiChip.text = (if (multi) "✓ " else "") + "여러 장 이어 찍기"
            multiChip.background = if (multi) round(0xFF3B82F6.toInt(), 22) else round(0x33FFFFFF, 22, 0x55FFFFFF)
            multiChip.contentDescription = "여러 장 이어 찍기 " + if (multi) "켜짐" else "꺼짐"
        }
        val mb = Math.round(n * 1.2f)
        infoTv.text = when {
            mode == "doc" && multi -> n.toString() + "쪽 · 약 " + mb + "MB · 최대 " + capPages() + "쪽"
            mode == "doc" && from == "scan" -> "이 쪽만 다시 찍고 원래 자리에 넣어요"
            mode == "doc" -> "한 장씩 확인해요"
            mode == "receipt" -> "한 장 찍고 확인한 뒤 영수증 칸으로 이어져요"
            else -> "찍으면 먼저 미리보기가 나와요"
        }
        // 알림 띠(우선순위: 한도 → 저장 공간 → 일반 사진 표시)
        val cap = capPages()
        val full = mode == "doc" && multi && n >= cap
        val diskFull = Session.usedBytes(this) >= Session.DISK_CAP_BYTES
        val note = when {
            full && cap >= Session.MAX_PAGES -> "100쪽을 다 찍었어요. 오른쪽 아래 「완료」를 눌러 주세요."
            full -> "이번에는 " + cap + "쪽까지예요. 완료를 눌러 주세요"
            diskFull && n > 0 -> "저장 공간 한도(약 150MB)에 닿았어요. 오른쪽 아래 「완료」를 눌러 주세요."
            lowDisk && mode == "doc" && multi -> "저장 공간이 얼마 안 남았어요. 이번에는 " + Session.LOW_DISK_PAGES + "쪽까지만 찍을 수 있어요."
            lowDisk -> "저장 공간이 얼마 안 남았어요."
            mode == "doc" && multi && cap - n <= 20 && n > 0 -> "앞으로 " + (cap - n) + "쪽 더 찍을 수 있어요."
            mode == "photo" -> "찍을 때 화면이 번쩍이고 폰이 짧게 떨려요"
            else -> ""
        }
        noticeTv.text = note
        noticeTv.visibility = if (note.isEmpty()) View.GONE else View.VISIBLE
        // 촬영 줄
        val canShoot = !(mode == "doc" && multi && (n >= cap)) && !(diskFull && n > 0) && !(mode != "doc" && n >= 1)
        shutter.alpha = if (canShoot) 1f else 0.35f
        shutter.isEnabled = canShoot
        doneBtn.visibility = if (multi && mode == "doc") View.VISIBLE else View.INVISIBLE
        doneBtn.text = "완료 (" + n + ")"
        doneBtn.isEnabled = n > 0
        doneBtn.alpha = if (n > 0) 1f else 0.4f
        strip.visibility = if (multi && mode == "doc" && n > 0) View.VISIBLE else View.GONE
        if (n > 0) {
            lastThumb.visibility = View.VISIBLE
            thumbs[pages[n - 1].path]?.let { lastThumb.setImageBitmap(it) }
        } else lastThumb.visibility = View.INVISIBLE
        flashBtn.text = when (flashMode) { ImageCapture.FLASH_MODE_AUTO -> "⚡ 자동"; ImageCapture.FLASH_MODE_ON -> "⚡ 켬"; else -> "⚡ 끔" }
        updateGuideText()
    }

    private fun updateGuideText() {
        if (busy) return
        if (guideReset != null) return                       // 방금 찍은 뒤 안내가 떠 있는 동안은 바꾸지 않는다
        hintTv.text = when {
            shakeLevel > 1.6f -> "조금만 가만히 있어 주세요"
            darkLive && flashMode == ImageCapture.FLASH_MODE_OFF -> "조금 어두워요. 밝은 쪽으로 가거나 불빛을 켜 볼까요?"
            mode == "receipt" -> "영수증이 세로로 꽉 차게 비춰 주세요"
            mode == "photo" -> "찍을 장면을 비춰 주세요"
            else -> "문서 전체가 들어오게 비춰 주세요"
        }
    }

    private fun flashNote(msg: String, ms: Long = 2200) {
        hintTv.text = msg
        guideReset?.let { main.removeCallbacks(it) }
        val r = Runnable { guideReset = null; updateGuideText() }
        guideReset = r
        main.postDelayed(r, ms)
    }

    private fun cycleFlash() {
        flashMode = when (flashMode) {
            ImageCapture.FLASH_MODE_OFF -> ImageCapture.FLASH_MODE_AUTO
            ImageCapture.FLASH_MODE_AUTO -> ImageCapture.FLASH_MODE_ON
            else -> ImageCapture.FLASH_MODE_OFF
        }
        imageCapture?.flashMode = flashMode
        refreshAll()
    }

    // ───────── 카메라 ─────────
    private fun useEngine(): String {
        if (engine == "quality" || engine == "fast" || engine == "frame") return engine
        return if (mode == "doc" && multi) "fast" else "quality"       // 설계안: 글자 선명도 우선, 연속 촬영만 속도 우선
    }

    private fun bindCamera() {
        val f = ProcessCameraProvider.getInstance(this)
        f.addListener({
            val provider = try { f.get() } catch (e: Exception) { finishWith("error"); return@addListener }
            try {
                provider.unbindAll()
                val prevSel = ResolutionSelector.Builder().setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY).build()
                val preview = Preview.Builder().setResolutionSelector(prevSel).build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
                // 긴 변 약 4000px 이하(약 1,200만 화소): 글자 읽기에는 충분하고, 웹에서 읽어 줄일 때 메모리 부족을 막는다
                val capSel = ResolutionSelector.Builder()
                    .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
                    .setResolutionStrategy(ResolutionStrategy(android.util.Size(4000, 3000), ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER))
                    .build()
                imageCapture = null
                analysis = null
                if (useEngine() == "frame") {
                    val an = ImageAnalysis.Builder()
                        .setResolutionSelector(capSel)
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build()
                    an.setAnalyzer(camExec) { img -> onFrame(img) }
                    analysis = an
                    camera = provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, an)
                } else {
                    val ic = ImageCapture.Builder()
                        .setResolutionSelector(capSel)
                        .setCaptureMode(if (useEngine() == "fast") ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY else ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
                        .setFlashMode(flashMode)
                        .setJpegQuality(90)
                        .build()
                    imageCapture = ic
                    camera = provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, ic)
                }
                flashNote("카메라가 준비됐어요", 1200)
            } catch (e: Exception) {
                finishWith("error")
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun showFocusRing(x: Float, y: Float) {
        focusRing.x = x - dp(32)
        focusRing.y = y - dp(32)
        focusRing.alpha = 1f
        if (reduceMotion()) { focusRing.animate().alpha(0f).setStartDelay(500).setDuration(1).start(); return }
        focusRing.scaleX = 1.4f
        focusRing.scaleY = 1.4f
        focusRing.animate().scaleX(1f).scaleY(1f).setDuration(160).start()
        focusRing.animate().alpha(0f).setStartDelay(600).setDuration(200).start()
    }

    private fun vibrateNow() {
        val on = if (mode == "photo") true else prefs.getBoolean("vibrate", true)      // 일반 사진은 끌 수 없다
        if (!on) return
        try {
            val vib = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator ?: return
            if (!vib.hasVibrator()) return
            if (Build.VERSION.SDK_INT >= 26) vib.vibrate(VibrationEffect.createOneShot(40, VibrationEffect.DEFAULT_AMPLITUDE))
            else @Suppress("DEPRECATION") vib.vibrate(40)
        } catch (e: Exception) { }
    }

    private fun flashScreen() {
        val photo = mode == "photo"
        if (reduceMotion() && !photo) return                   // 움직임 줄이기: 문서·영수증은 깜빡임을 생략한다(일반 사진은 켜 둠)
        val peak = if (photo) 0.95f else 0.5f
        val dur = if (photo) 300L else 160L
        flashView.animate().cancel()
        flashView.alpha = peak
        flashView.animate().alpha(0f).setDuration(dur).start()
    }

    private fun newFile(prefix: String): File = File(Session.dir(this), prefix + "_" + System.currentTimeMillis() + ".jpg")

    private fun shoot() {
        if (busy || closing) return
        val n = pages.size
        if (mode == "doc" && multi && n >= capPages()) return
        if (mode != "doc" && n >= 1) return
        if (Session.usedBytes(this) >= Session.DISK_CAP_BYTES && n > 0) return
        if (Session.freeBytes(this) < 20L * 1024 * 1024) { flashNote("저장 공간이 거의 없어요. 공간을 비운 뒤 다시 찍어 주세요", 4000); return }
        val willShake = shakeLevel > 1.2f
        busy = true
        vibrateNow()
        flashScreen()
        val prefix = if (mode == "photo") "photo" else "scan"
        val file = newFile(prefix)
        if (useEngine() == "frame") {
            frameTarget = file
            wantFrame.set(true)
            // 프레임 저장은 분석기가 부른다(onFrame)
            main.postDelayed({ if (wantFrame.getAndSet(false)) { busy = false; flashNote("찍지 못했어요. 다시 눌러 주세요") } }, 4000)
            return
        }
        val ic = imageCapture ?: run { busy = false; flashNote("카메라가 아직 준비 안 됐어요"); return }
        focusThen {
            ic.takePicture(ImageCapture.OutputFileOptions.Builder(file).build(), ContextCompat.getMainExecutor(this),
                object : ImageCapture.OnImageSavedCallback {
                    override fun onImageSaved(r: ImageCapture.OutputFileResults) { afterSaved(file, willShake) }
                    override fun onError(e: ImageCaptureException) { busy = false; try { file.delete() } catch (x: Exception) { }; flashNote("찍지 못했어요. 다시 눌러 주세요", 3000) }
                })
        }
    }

    /** 초점이 잡히기를 최대 0.8초 기다린 뒤 찍는다(문서는 가까이서 찍어 초점이 늦으면 흐려진다). */
    private fun focusThen(go: () -> Unit) {
        val cam = camera
        if (cam == null) { go(); return }
        val fired = AtomicBoolean(false)
        fun once() { if (fired.compareAndSet(false, true)) go() }
        try {
            val (x, y) = lastTap ?: Pair(previewView.width / 2f, previewView.height / 2f)
            val p = previewView.meteringPointFactory.createPoint(x, y)
            val fut = cam.cameraControl.startFocusAndMetering(FocusMeteringAction.Builder(p).build())
            fut.addListener({ once() }, ContextCompat.getMainExecutor(this))
            main.postDelayed({ once() }, 800)
        } catch (e: Exception) { once() }
    }

    private fun onFrame(img: ImageProxy) {
        try {
            if (!wantFrame.getAndSet(false)) return
            val target = frameTarget ?: return
            var bmp = img.toBitmap()
            val rot = img.imageInfo.rotationDegrees
            if (rot != 0) {
                val m = Matrix().apply { postRotate(rot.toFloat()) }
                bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
            }
            FileOutputStream(target).use { bmp.compress(Bitmap.CompressFormat.JPEG, 92, it) }
            bmp.recycle()
            val shake = shakeLevel > 1.2f
            runOnUiThread { afterSaved(target, shake) }
        } catch (e: Exception) {
            runOnUiThread { busy = false; flashNote("찍지 못했어요. 다시 눌러 주세요", 3000) }
        } finally {
            img.close()
        }
    }

    /** 사진 파일이 저장된 직후: 선명도 힌트를 재고(백그라운드), 복구 목록에 바로 적고, 한 장 모드면 확인 화면을 연다. */
    private fun afterSaved(file: File, shake: Boolean) {
        bg.execute {
            val h = Hint.analyze(file.absolutePath)
            val thumb = loadBitmap(file.absolutePath, 256)
            runOnUiThread {
                if (closing || isFinishing) { try { file.delete() } catch (e: Exception) { }; return@runOnUiThread }
                val pg = Session.Page(file.absolutePath, h.q, h.w, h.h, file.length())
                pages.add(pg)
                if (shake) shook.add(pg.path)
                if (thumb != null) thumbs[pg.path] = thumb
                persist()
                busy = false
                if (mode == "doc" && multi) {
                    addThumb(pg)
                    refreshAll()
                    val extra = if (h.q == "blur") " · 조금 흐려요" else if (h.q == "dark") " · 조금 어두워요" else ""
                    flashNote(pages.size.toString() + "쪽 찍었어요" + extra)
                } else {
                    refreshAll()
                    showConfirm(pg)
                }
            }
        }
    }

    private fun persist() {
        val all = ArrayList<Session.Page>()
        all.addAll(carried); all.addAll(pages)
        Session.write(this, Session.State(System.currentTimeMillis(), mode, from, multi, all))
    }

    // ───────── 썸네일 줄 · 크게 보기 ─────────
    private fun loadBitmap(path: String, maxSide: Int): Bitmap? {
        return try {
            val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(path, o)
            if (o.outWidth <= 0) return null
            var ss = 1
            while (maxOf(o.outWidth, o.outHeight) / (ss * 2) >= maxSide) ss *= 2
            val bm = BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = ss }) ?: return null
            val deg = when (ExifInterface(path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90
                ExifInterface.ORIENTATION_ROTATE_180 -> 180
                ExifInterface.ORIENTATION_ROTATE_270 -> 270
                else -> 0
            }
            if (deg == 0) bm else {
                val r = Bitmap.createBitmap(bm, 0, 0, bm.width, bm.height, Matrix().apply { postRotate(deg.toFloat()) }, true)
                if (r !== bm) bm.recycle()
                r
            }
        } catch (e: Throwable) { null }
    }

    private fun addThumb(pg: Session.Page) {
        val cell = FrameLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(dp(60), dp(60)).apply { setMargins(dp(3), 0, dp(3), 0) }
            tag = pg.path
        }
        val iv = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            background = round(0x33FFFFFF, 8)
            clipToOutline = true
            setOnClickListener { val i = pages.indexOfFirst { it.path == pg.path }; if (i >= 0) peek(i) }
        }
        cell.addView(iv, FrameLayout.LayoutParams(-1, -1))
        val bad = pg.q != "sharp"
        if (bad) cell.addView(tv("!", 13f, Color.BLACK, true).apply {
            gravity = Gravity.CENTER
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(0xFFFBBF24.toInt()) }
        }, FrameLayout.LayoutParams(dp(20), dp(20), Gravity.TOP or Gravity.END))
        val i = pages.indexOfFirst { it.path == pg.path }
        cell.addView(tv((i + 1).toString(), 11f, Color.WHITE, true).apply {
            setPadding(dp(4), 0, dp(4), 0)
            setBackgroundColor(0x99000000.toInt())
        }, FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.START))
        cell.contentDescription = (i + 1).toString() + "쪽" + if (bad) ", 흐리거나 어두워요" else ""
        stripBox.addView(cell)
        val t = thumbs[pg.path]
        if (t != null) iv.setImageBitmap(t) else bg.execute {
            val b = loadBitmap(pg.path, 256)
            if (b != null) runOnUiThread { thumbs[pg.path] = b; iv.setImageBitmap(b) }
        }
        strip.post { strip.fullScroll(View.FOCUS_RIGHT) }
    }

    private fun rebuildStrip() {
        stripBox.removeAllViews()
        for (p in pages) addThumb(p)
    }

    private fun hintLine(q: String, shake: Boolean): Pair<String, Int> {
        val base = when (q) {
            "blur" -> "글자가 조금 흐려요. 다시 찍는 게 좋아요"
            "dark" -> "조금 어두워요. 불빛을 켜고 다시 찍어 볼까요?"
            else -> "선명해요. 글자가 잘 보여요"
        }
        val color = if (q == "sharp") 0xFF86EFAC.toInt() else 0xFFFCD34D.toInt()
        return Pair(if (shake) "$base · 손떨림이 있었어요" else base, color)
    }

    /** 이미 찍은 쪽을 크게 보고 지울 수 있다(연속 촬영의 썸네일을 눌렀을 때). */
    private fun peek(i: Int) {
        if (i < 0 || i >= pages.size || busy) return
        val pg = pages[i]
        val l = layer()
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        l.addView(col, FrameLayout.LayoutParams(-1, -1))
        col.addView(tv((i + 1).toString() + "쪽", 17f, Color.WHITE, true).apply { setPadding(dp(16), dp(10), dp(16), dp(6)) })
        val zv = ZoomImageView(this)
        col.addView(zv, LinearLayout.LayoutParams(-1, 0, 1f))
        val hl = hintLine(pg.q, shook.contains(pg.path))
        col.addView(tv(hl.first, 15f, hl.second, true).apply { gravity = Gravity.CENTER; setPadding(dp(14), dp(8), dp(14), dp(8)) })
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(dp(10), dp(4), dp(10), dp(12)) }
        row.addView(button("이 쪽 지우기", false, 1f) { removeLayer(l); deletePage(i) })
        row.addView(button("닫기", true, 1f) { removeLayer(l) })
        col.addView(row)
        bg.execute {
            val b = loadBitmap(pg.path, 2400)
            runOnUiThread { if (b != null) zv.setImageBitmap(b) }
        }
    }

    private fun deletePage(i: Int) {
        if (i < 0 || i >= pages.size) return
        val pg = pages.removeAt(i)
        shook.remove(pg.path)
        thumbs.remove(pg.path)?.let { }
        try { File(pg.path).delete() } catch (e: Exception) { }
        persist()
        rebuildStrip()
        refreshAll()
    }

    // ───────── 찍은 직후 확인 화면 ─────────
    private fun showConfirm(pg: Session.Page) {
        busy = true
        val l = layer()
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        l.addView(col, FrameLayout.LayoutParams(-1, -1))
        col.addView(tv(if (mode == "photo") "찍은 사진 · 일반 사진" else "찍은 사진 확인", 17f, Color.WHITE, true).apply { setPadding(dp(16), dp(10), dp(16), dp(6)) })
        val zv = ZoomImageView(this)
        col.addView(zv, LinearLayout.LayoutParams(-1, 0, 1f))
        bg.execute {
            val b = loadBitmap(pg.path, 2400)
            runOnUiThread { if (b != null) zv.setImageBitmap(b) else flashNote("사진을 화면에 못 불러왔어요") }
        }
        val warn = pg.q != "sharp"
        val hl = hintLine(pg.q, shook.contains(pg.path))
        val statusTv = if (mode == "photo") tv("이 사진은 아직 어디에도 저장되지 않았어요", 15f, 0xFFD0D6E6.toInt(), true).apply { gravity = Gravity.CENTER; setPadding(dp(14), dp(8), dp(14), dp(8)) }
            else tv(hl.first, 15f, hl.second, true).apply { gravity = Gravity.CENTER; setPadding(dp(14), dp(8), dp(14), dp(2)) }
        val bar = View(this).apply { setBackgroundColor(0xFF3B82F6.toInt()) }
        val autoNote = tv("", 13f, 0xFFD0D6E6.toInt()).apply { gravity = Gravity.CENTER }
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(dp(10), dp(4), dp(10), dp(12)) }

        if (mode == "photo") {
            col.addView(statusTv)
            var saved = false
            lateinit var saveBtn: TextView
            row.addView(button("다시 찍기", false, 1f) { removeLayer(l); retakeAfterConfirm(pg) })
            saveBtn = button("갤러리에 저장", false, 1f) {
                if (saved) return@button
                statusTv.text = "저장하는 중이에요…"
                saveToGallery(pg.path) { ok, msg ->
                    if (ok) { saved = true; saveBtn.text = "저장됨 ✓"; saveBtn.alpha = 0.6f; statusTv.text = "갤러리에 저장했어요" }
                    else statusTv.text = msg
                }
            }
            row.addView(saveBtn)
            row.addView(button("케이에게 보내기", true, 1f) { removeLayer(l); finishWith("send") })
            col.addView(row)
            l.tag = { removeLayer(l); retakeAfterConfirm(pg) }
            return
        }

        col.addView(statusTv)
        val useLabel = (if (warn) "그래도 " else "") + (if (mode == "receipt") "이 사진으로 계속" else "사용하기")
        val auto = prefs.getBoolean("auto", false) && !warn
        if (auto) {
            col.addView(autoNote)
            col.addView(bar, LinearLayout.LayoutParams(-1, dp(3)))
        }
        val retakeLabel = if (pg.q == "dark") "불빛 켜고 다시 찍기" else "다시 찍기"
        row.addView(button(retakeLabel, false, 1f) {
            autoAnim?.cancel()
            removeLayer(l)
            if (pg.q == "dark") { flashMode = ImageCapture.FLASH_MODE_ON; imageCapture?.flashMode = flashMode }
            retakeAfterConfirm(pg)
        })
        val useBtn = button(useLabel, true, 1f) { autoAnim?.cancel(); removeLayer(l); finishWith("done") }
        row.addView(useBtn)
        col.addView(row)
        l.tag = { autoAnim?.cancel(); autoAnim = null; removeLayer(l); retakeAfterConfirm(pg) }

        if (auto) {
            val secs = String.format("%.1f", AUTO_MS / 1000f)
            autoNote.text = secs + "초 뒤에 저절로 넘어가요 · 사진을 누르면 멈춰요"
            val full = resources.displayMetrics.widthPixels.toFloat()
            val anim = ValueAnimator.ofFloat(1f, 0f).setDuration(AUTO_MS)
            anim.addUpdateListener { a ->
                val lp = bar.layoutParams
                lp.width = (full * (a.animatedValue as Float)).toInt()
                bar.layoutParams = lp
            }
            anim.addListener(object : android.animation.AnimatorListenerAdapter() {
                var cancelled = false
                override fun onAnimationCancel(a: android.animation.Animator) { cancelled = true }
                override fun onAnimationEnd(a: android.animation.Animator) { if (!cancelled && !closing) { removeLayer(l); finishWith("done") } }
            })
            autoAnim = anim
            zv.onTouched = {
                if (autoAnim === anim && anim.isRunning) {
                    anim.cancel(); autoAnim = null
                    autoNote.text = "멈췄어요. 천천히 보세요"
                    bar.visibility = View.GONE
                }
            }
            anim.start()
        }
    }

    /** 확인 화면에서 «다시 찍기»: 방금 사진을 지우고 카메라로 돌아간다. */
    private fun retakeAfterConfirm(pg: Session.Page) {
        val i = pages.indexOfFirst { it.path == pg.path }
        if (i >= 0) {
            pages.removeAt(i)
            shook.remove(pg.path)
            thumbs.remove(pg.path)
        }
        try { File(pg.path).delete() } catch (e: Exception) { }
        persist()
        busy = false
        refreshAll()
    }

    // ───────── 갤러리에 저장 (일반 사진 모드만) ─────────
    private fun saveToGallery(path: String, done: (Boolean, String) -> Unit) {
        if (Build.VERSION.SDK_INT < 29) { done(false, "이 폰에서는 갤러리 저장을 지원하지 않아요"); return }
        bg.execute {
            var ok = false
            var msg = "갤러리에 저장하지 못했어요"
            try {
                val src = File(path)
                val v = ContentValues().apply {
                    put(MediaStore.Images.Media.DISPLAY_NAME, "스마트비서_" + System.currentTimeMillis() + ".jpg")
                    put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                    put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/스마트비서")
                    put(MediaStore.Images.Media.IS_PENDING, 1)
                }
                val uri = contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v)
                if (uri != null) {
                    var copied = 0L
                    contentResolver.openOutputStream(uri)?.use { out -> src.inputStream().use { copied = it.copyTo(out) } }
                    val upd = ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }
                    contentResolver.update(uri, upd, null, null)
                    // 저장이 끝난 것을 다시 읽어 확인한 뒤에야 «저장했어요»를 보인다
                    var size = -1L
                    contentResolver.openInputStream(uri)?.use { ins -> var t = 0L; val buf = ByteArray(65536); while (true) { val n = ins.read(buf); if (n < 0) break; t += n }; size = t }
                    ok = copied > 0 && size == src.length()
                    if (!ok) try { contentResolver.delete(uri, null, null) } catch (e: Exception) { }
                }
            } catch (e: Exception) { msg = "갤러리에 저장하지 못했어요" }
            runOnUiThread { done(ok, msg) }
        }
    }

    // ───────── 설정 ─────────
    private fun openSettings() {
        if (busy) return
        val l = layer()
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(14), dp(8), dp(14), dp(14)) }
        val sv = android.widget.ScrollView(this)
        sv.addView(col)
        l.addView(sv, FrameLayout.LayoutParams(-1, -1))
        val head = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        head.addView(iconBtn("‹", "뒤로") { removeLayer(l) })
        head.addView(tv("카메라 설정", 18f, Color.WHITE, true))
        col.addView(head)

        fun card(): LinearLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = round(0x1AFFFFFF, 14, 0x33FFFFFF)
            setPadding(dp(14), dp(12), dp(14), dp(12))
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { setMargins(0, dp(12), 0, 0) }
        }
        fun option(title: String, sub: String, selected: Boolean, onClick: () -> Unit): LinearLayout = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = dp(56)
            isClickable = true
            setPadding(0, dp(6), 0, dp(6))
            contentDescription = title + if (selected) " 선택됨" else ""
            setOnClickListener { onClick() }
            addView(tv(if (selected) "◉" else "○", 20f, if (selected) 0xFF60A5FA.toInt() else Color.WHITE).apply { setPadding(0, 0, dp(12), 0) })
            val t = LinearLayout(this@SilentCameraActivity).apply { orientation = LinearLayout.VERTICAL }
            t.addView(tv(title, 16f, Color.WHITE, true))
            t.addView(tv(sub, 13f, 0xFFC7CEE0.toInt()))
            addView(t, LinearLayout.LayoutParams(0, -2, 1f))
        }

        fun fill() {
            col.removeAllViews()
            col.addView(head)
            val auto = prefs.getBoolean("auto", false)
            val c1 = card()
            c1.addView(tv("찍은 뒤 확인 방식", 17f, Color.WHITE, true))
            c1.addView(option("항상 멈춰서 확인 (처음 설정)", "찍으면 사진이 크게 나오고 「다시 찍기」「사용하기」를 눌러요", !auto) { prefs.edit().putBoolean("auto", false).apply(); fill() })
            c1.addView(option("선명하면 저절로 넘어가기", "선명한 사진은 2.8초 뒤 저절로 넘어가요. 흐리거나 어두우면 늘 멈춰요", auto) { prefs.edit().putBoolean("auto", true).apply(); fill() })
            col.addView(c1)
            val vib = prefs.getBoolean("vibrate", true)
            val c2 = card()
            c2.addView(tv("찍을 때 진동", 17f, Color.WHITE, true))
            c2.addView(option("문서·영수증 찍을 때 짧게 진동", "찍혔는지 알려 줘요", vib) { prefs.edit().putBoolean("vibrate", !vib).apply(); fill() })
            c2.addView(tv("일반 사진은 항상 번쩍임과 진동", 15f, Color.WHITE, true).apply { setPadding(0, dp(8), 0, 0) })
            c2.addView(tv("사람이 있는 곳에서 찍는다는 걸 알 수 있게 꺼지지 않아요", 13f, 0xFFC7CEE0.toInt()))
            col.addView(c2)
            val c3 = card()
            c3.addView(tv("움직임 효과는 폰의 「움직임 줄이기」 설정을 따라가요.", 14f, 0xFFC7CEE0.toInt()))
            col.addView(c3)
        }
        fill()
    }

    // ───────── 닫기·완료 ─────────
    private fun onBack() {
        if (layers.childCount > 0) {
            val top = layers.getChildAt(layers.childCount - 1)
            val t = top.tag
            if (t is Function0<*>) { t.invoke(); return }     // 확인 화면의 뒤로가기 = 「다시 찍기」
            removeLayer(top); return
        }
        onClose()
    }

    private fun onClose() {
        if (busy && layers.childCount > 0) return
        if (pages.isNotEmpty()) {
            val l = layer()
            l.setBackgroundColor(0xCC000000.toInt())
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                background = round(0xFF1E2540.toInt(), 18)
                setPadding(dp(20), dp(18), dp(20), dp(16))
            }
            card.addView(tv("찍은 " + pages.size + "쪽을 버릴까요?", 18f, Color.WHITE, true))
            card.addView(tv("닫으면 찍은 사진이 사라져요.", 15f, 0xFFC7CEE0.toInt()).apply { setPadding(0, dp(6), 0, dp(14)) })
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            row.addView(button("계속 찍기", false, 1f) { removeLayer(l) })
            row.addView(button("버리기", true, 1f) { removeLayer(l); discardMineAndFinish() })
            card.addView(row)
            l.addView(card, FrameLayout.LayoutParams(-1, -2, Gravity.CENTER).apply { setMargins(dp(20), 0, dp(20), 0) })
            return
        }
        discardMineAndFinish()
    }

    private fun discardMineAndFinish() {
        for (p in pages) { try { File(p.path).delete() } catch (e: Exception) { } }
        pages.clear()
        persist()
        finishWith("cancel")
    }

    private fun onDone() {
        if (pages.isEmpty() || busy) return
        finishWith("done")
    }

    private fun finishWith(action: String) {
        if (closing) return
        closing = true
        autoAnim?.cancel()
        val j = JSONObject().put("action", action).put("mode", mode).put("from", from).put("multi", multi)
        val arr = JSONArray()
        if (action == "done" || action == "send") {
            for (p in pages) arr.put(JSONObject().put("path", p.path).put("q", p.q).put("w", p.w).put("h", p.h).put("size", File(p.path).length()).put("shake", shook.contains(p.path)))
        }
        j.put("pages", arr)
        setResult(RESULT_OK, Intent().putExtra(RESULT, j.toString()))
        finish()
    }
}
