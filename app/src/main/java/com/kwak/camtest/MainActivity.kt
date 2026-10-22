package com.kwak.camtest

import android.Manifest
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.MediaStore
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

// 소리가 나는지 시험하는 최소 앱. 이 앱은 소리를 내는 코드를 전혀 넣지 않았다
// (MediaActionSound 등 사용 안 함). 소리가 난다면 시스템이 낸 것이다.
class MainActivity : ComponentActivity() {

    private lateinit var previewView: PreviewView
    private lateinit var info: TextView
    private lateinit var flashView: View
    private lateinit var btnMode: Button
    private lateinit var btnVib: Button
    private lateinit var btnFlash: Button

    private var mode = 0 // 0=A 빠름(MINIMIZE_LATENCY) 1=A 고화질(MAXIMIZE_QUALITY) 2=B 프레임 저장
    private var vibrateOn = true
    private var flashOn = true
    private var camera: Camera? = null
    private var imageCapture: ImageCapture? = null
    private var analysis: ImageAnalysis? = null
    private val wantFrame = AtomicBoolean(false)
    private var shotStart = 0L
    private val camExec = Executors.newSingleThreadExecutor()
    private var count = 0
    private var lastLine = "아직 찍은 사진이 없어요"

    private val photoDir: File by lazy {
        File(getExternalFilesDir(null), "photos").apply { mkdirs() }
    }

    private val permLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) startCamera() else info.text = "카메라 권한이 필요해요. 앱 정보에서 카메라를 허용해 주세요."
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            startCamera()
        } else {
            permLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    private fun smallBtn(label: String, onClick: () -> Unit): Button = Button(this).apply {
        text = label
        textSize = 13f
        isAllCaps = false
        minHeight = dp(40); minimumHeight = dp(40)
        setPadding(dp(10), 0, dp(10), 0)
        setOnClickListener { onClick() }
    }

    private fun buildUi() {
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        previewView = PreviewView(this).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
            scaleType = PreviewView.ScaleType.FIT_CENTER
        }
        root.addView(previewView, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)

        flashView = View(this).apply { setBackgroundColor(Color.WHITE); alpha = 0f }
        root.addView(flashView, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        flashView.isClickable = false

        // 안내 글: 위쪽, 글이 길어도 줄바꿈되고 화면 폭을 넘지 않게
        info = TextView(this).apply {
            setTextColor(Color.WHITE); textSize = 13f
            typeface = Typeface.MONOSPACE
            setBackgroundColor(0x99000000.toInt())
            setPadding(dp(10), dp(8), dp(10), dp(8))
        }
        val topLp = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP)
        root.addView(info, topLp)

        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0x99000000.toInt())
            setPadding(dp(8), dp(6), dp(8), dp(10))
            gravity = Gravity.CENTER_HORIZONTAL
        }
        val row1 = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        btnMode = smallBtn("") { mode = (mode + 1) % 3; refreshLabels(); bindUseCases() }
        btnVib = smallBtn("") { vibrateOn = !vibrateOn; refreshLabels() }
        btnFlash = smallBtn("") { flashOn = !flashOn; refreshLabels() }
        row1.addView(btnMode); row1.addView(btnVib); row1.addView(btnFlash)
        panel.addView(row1)

        val row2 = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val export = smallBtn("갤러리로 내보내기") { exportAll() }
        val shutter = Button(this).apply {
            text = "촬영"; textSize = 18f
            setOnClickListener { shoot() }
        }
        row2.addView(export)
        row2.addView(shutter, LinearLayout.LayoutParams(dp(120), dp(64)).apply { setMargins(dp(12), dp(4), dp(12), dp(4)) })
        val clear = smallBtn("사진 지우기") { photoDir.listFiles()?.forEach { it.delete() }; count = 0; lastLine = "지웠어요"; refreshInfo() }
        row2.addView(clear)
        panel.addView(row2)

        root.addView(panel, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
        setContentView(root)
        refreshLabels()

        // 화면을 톡 누르면 그 자리로 초점(초점 속도 확인용)
        previewView.setOnTouchListener { v, ev ->
            if (ev.action == MotionEvent.ACTION_UP) {
                val cam = camera
                if (cam != null) {
                    val p = previewView.meteringPointFactory.createPoint(ev.x, ev.y)
                    cam.cameraControl.startFocusAndMetering(FocusMeteringAction.Builder(p).build())
                }
                v.performClick()
            }
            true
        }
    }

    private fun modeName() = when (mode) {
        0 -> "A 빠름"
        1 -> "A 고화질"
        else -> "B 프레임"
    }

    private fun refreshLabels() {
        btnMode.text = "방식: ${modeName()}"
        btnVib.text = "진동 ${if (vibrateOn) "켬" else "끔"}"
        btnFlash.text = "깜빡임 ${if (flashOn) "켬" else "끔"}"
        refreshInfo()
    }

    private fun refreshInfo() {
        info.text = "카메라 시험 (소리 내는 코드 없음)\n방식 ${modeName()} · 저장 ${count}장\n$lastLine"
    }

    private fun startCamera() {
        val f = ProcessCameraProvider.getInstance(this)
        f.addListener({ bindUseCases() }, ContextCompat.getMainExecutor(this))
    }

    private fun bindUseCases() {
        val provider = try { ProcessCameraProvider.getInstance(this).get() } catch (e: Exception) {
            info.text = "카메라 연결 실패: ${e.message}"; return
        }
        val best = ResolutionSelector.Builder()
            .setResolutionStrategy(ResolutionStrategy.HIGHEST_AVAILABLE_STRATEGY).build()
        val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
        provider.unbindAll()
        imageCapture = null; analysis = null
        try {
            if (mode == 2) {
                val an = ImageAnalysis.Builder()
                    .setResolutionSelector(best)
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                an.setAnalyzer(camExec) { img -> onFrame(img) }
                analysis = an
                camera = provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, an)
            } else {
                val ic = ImageCapture.Builder()
                    .setResolutionSelector(best)
                    .setCaptureMode(if (mode == 0) ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY else ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
                    .setFlashMode(ImageCapture.FLASH_MODE_OFF)
                    .build()
                imageCapture = ic
                camera = provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, ic)
            }
            refreshInfo()
        } catch (e: Exception) {
            info.text = "카메라 연결 실패: ${e.message}"
        }
    }

    private fun feedback() {
        if (vibrateOn) {
            val vib = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            if (vib != null && vib.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= 26) vib.vibrate(VibrationEffect.createOneShot(40, VibrationEffect.DEFAULT_AMPLITUDE))
                else @Suppress("DEPRECATION") vib.vibrate(40)
            }
        }
        if (flashOn) {
            flashView.alpha = 0.7f
            flashView.animate().alpha(0f).setDuration(150).start()
        }
    }

    private fun newFile(tag: String): File {
        val n = System.currentTimeMillis()
        return File(photoDir, "cam_${tag}_$n.jpg")
    }

    private fun shoot() {
        shotStart = SystemClock.elapsedRealtime()
        feedback()
        if (mode == 2) {
            wantFrame.set(true)
            return
        }
        val ic = imageCapture ?: run { lastLine = "카메라가 아직 준비 안 됨"; refreshInfo(); return }
        val file = newFile(if (mode == 0) "A1" else "A2")
        ic.takePicture(ImageCapture.OutputFileOptions.Builder(file).build(), ContextCompat.getMainExecutor(this),
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(r: ImageCapture.OutputFileResults) { saved(file) }
                override fun onError(e: ImageCaptureException) { lastLine = "촬영 실패: ${e.message}"; refreshInfo() }
            })
    }

    private fun onFrame(img: ImageProxy) {
        try {
            if (!wantFrame.getAndSet(false)) return
            var bmp = img.toBitmap()
            val rot = img.imageInfo.rotationDegrees
            if (rot != 0) {
                val m = Matrix().apply { postRotate(rot.toFloat()) }
                bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
            }
            val file = newFile("B")
            FileOutputStream(file).use { bmp.compress(Bitmap.CompressFormat.JPEG, 95, it) }
            runOnUiThread { saved(file) }
        } catch (e: Exception) {
            runOnUiThread { lastLine = "프레임 저장 실패: ${e.message}"; refreshInfo() }
        } finally {
            img.close()
        }
    }

    private fun saved(file: File) {
        val ms = SystemClock.elapsedRealtime() - shotStart
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, o)
        count = photoDir.listFiles()?.size ?: count
        lastLine = "방금: ${o.outWidth}x${o.outHeight}px · ${file.length() / 1024}KB · 저장까지 ${ms}ms\n(가로x세로, 사진 속 회전 정보 별도)"
        refreshInfo()
    }

    private fun exportAll() {
        val files = photoDir.listFiles()?.filter { it.name.endsWith(".jpg") } ?: emptyList()
        if (files.isEmpty()) { Toast.makeText(this, "내보낼 사진이 없어요", Toast.LENGTH_SHORT).show(); return }
        if (Build.VERSION.SDK_INT < 29) { Toast.makeText(this, "이 폰은 내보내기를 지원하지 않아요", Toast.LENGTH_LONG).show(); return }
        var n = 0
        for (f in files) {
            val v = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, f.name)
                put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/CameraTest")
            }
            val uri = contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v) ?: continue
            contentResolver.openOutputStream(uri)?.use { out -> f.inputStream().use { it.copyTo(out) } }
            n++
        }
        Toast.makeText(this, "${n}장을 갤러리의 'CameraTest' 앨범(Pictures/CameraTest)에 넣었어요", Toast.LENGTH_LONG).show()
    }

    override fun onDestroy() {
        super.onDestroy()
        camExec.shutdown()
        camExec.awaitTermination(500, TimeUnit.MILLISECONDS)
    }
}
