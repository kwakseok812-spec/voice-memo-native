package io.github.kwakseok812.glassmap.phone

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import io.github.kwakseok812.glassmap.core.Channel
import io.github.kwakseok812.glassmap.core.FrameBuilder
import io.github.kwakseok812.glassmap.core.Layout
import io.github.kwakseok812.glassmap.core.NetUtil
import io.github.kwakseok812.glassmap.core.PhoneLink
import io.github.kwakseok812.glassmap.core.Transform

/**
 * The mirroring screen: show the phone screen on the glasses. Opened from the assistant's
 * home ("도구" > "미러링"); until v0.4 this was the main screen of a stand-alone app, and the
 * controls are the same.
 * Controls, top to bottom: state + "what to do now", start / stop (and "close the glasses
 * app too"), a small preview with the two views and the brightness, what part of the
 * screen. Everything used less often sits in a fold at the bottom.
 */
class MirrorActivity : Activity() {

    companion object {
        private const val REQ_CAPTURE = 11
        private const val REQ_NOTIF = 12
        private const val REQ_BT = 13
    }

    private lateinit var status: TextView
    private lateinit var statusSub: TextView
    private lateinit var btPermBtn: Button
    private lateinit var trustBox: LinearLayout
    private lateinit var trustText: TextView
    private lateinit var startBtn: Button
    private lateinit var quitBtn: Button
    private lateinit var preview: ImageView
    private lateinit var previewHint: TextView
    private lateinit var viewBtns: Array<Button>
    private lateinit var brightRow: LinearLayout
    private lateinit var brightBtns: Array<Button>
    private lateinit var glareText: TextView
    private lateinit var scopeBtns: Array<Button>
    private lateinit var scopeText: TextView
    private lateinit var regionBtn: Button
    private lateinit var moreBtn: Button
    private lateinit var moreBox: LinearLayout
    private lateinit var hostEdit: EditText
    private lateinit var inputText: TextView
    private var previewBmp: Bitmap? = null
    private var askedPerms = false
    private var btPermAsks = 0
    private val refresher = Runnable { refresh() }
    private val ui = Handler(Looper.getMainLooper())

    /** Bluetooth can be switched on/off outside the app: look again every two seconds while visible. */
    private val ticker = object : Runnable {
        override fun run() {
            refresh()
            ui.postDelayed(this, 2000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Screen sharing as a foreground service needs Android 10. The assistant itself also
        // runs on older phones; there the home screen does not offer this screen at all.
        if (Build.VERSION.SDK_INT < 29) {
            Toast.makeText(this, "미러링은 안드로이드 10 이상에서 쓸 수 있습니다.", Toast.LENGTH_LONG).show()
            finish()
            return
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (!AppState.running) Prefs.loadInto(this)
        setContentView(buildUi())
        handleDebugIntent(intent)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        if (intent != null) handleDebugIntent(intent)
    }

    override fun onStart() {
        super.onStart()
        AppState.setMultiWindow(isInMultiWindowMode)
        AppState.onShown()
    }

    override fun onStop() {
        AppState.onHidden()
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        AppState.addListener(refresher)
        ui.removeCallbacks(ticker)
        ui.post(ticker)
    }

    override fun onPause() {
        ui.removeCallbacks(ticker)
        AppState.removeListener(refresher)
        super.onPause()
    }

    @Deprecated("Deprecated in Java")
    override fun onMultiWindowModeChanged(isInMultiWindowMode: Boolean) {
        @Suppress("DEPRECATION")
        super.onMultiWindowModeChanged(isInMultiWindowMode)
        AppState.setMultiWindow(isInMultiWindowMode)
    }

    // ---------------------------------------------------------------- screen

    private fun check(text: String, on: Boolean, onChange: (Boolean) -> Unit): CheckBox {
        val cb = CheckBox(this)
        cb.text = text
        cb.textSize = 14f
        cb.setTextColor(Ui.TEXT)
        cb.isChecked = on
        cb.setOnCheckedChangeListener { _, v -> onChange(v) }
        return cb
    }

    /** A row of equal buttons where exactly one is chosen. */
    private fun choiceRow(labels: Array<String>, heightDp: Int, onPick: (Int) -> Unit): Pair<LinearLayout, Array<Button>> {
        val row = Ui.row(this)
        val wc = ViewGroup.LayoutParams.WRAP_CONTENT
        val btns = Array(labels.size) { i ->
            val b = Ui.secondary(this, labels[i])
            b.textSize = 13f
            b.minHeight = Ui.dp(this, heightDp)
            b.minimumHeight = Ui.dp(this, heightDp)
            b.setPadding(0, 0, 0, 0)
            b.setOnClickListener { onPick(i) }
            row.addView(b, Ui.lp(0, wc, 1f, 0, if (i == 0) 0 else Ui.dp(this, 6)))
            b
        }
        return Pair(row, btns)
    }

    private fun buildUi(): View {
        val c = this
        val pad = Ui.dp(c, 16)
        val mp = ViewGroup.LayoutParams.MATCH_PARENT
        val wc = ViewGroup.LayoutParams.WRAP_CONTENT

        val col = Ui.column(c)
        col.setPadding(pad, Ui.dp(c, 12), pad, pad)

        val title = Ui.row(c)
        title.addView(Ui.text(c, "미러링", 22f, Ui.TEXT, true), Ui.lp(0, wc, 1f))
        title.addView(Ui.text(c, "스마트비서 v" + versionName(), 12f, Ui.SUB))
        col.addView(title, Ui.lp(mp, wc))

        // --- connection state + what to do now
        val stCard = Ui.card(c)
        status = Ui.text(c, "", 17f, Ui.TEXT, true)
        statusSub = Ui.text(c, "", 14f, Ui.ACCENT_TEXT, true)
        stCard.addView(status)
        stCard.addView(statusSub, Ui.lp(mp, wc, 0f, Ui.dp(c, 4)))
        btPermBtn = Ui.secondary(c, "블루투스 권한 허용")
        btPermBtn.setOnClickListener { askBtPermission() }
        btPermBtn.visibility = View.GONE
        stCard.addView(btPermBtn, Ui.lp(mp, wc, 0f, Ui.dp(c, 8)))
        trustBox = Ui.column(c)
        trustText = Ui.text(c, "", 14f, Ui.WARN, true)
        trustBox.addView(trustText, Ui.lp(mp, wc, 0f, Ui.dp(c, 8)))
        val trustBtn = Ui.secondary(c, "이 글래스와 연결")
        trustBtn.setOnClickListener {
            val id = AppState.pendingTrustId
            if (id != 0) {
                Prefs.setTrustedId(c, id)
                AppState.pendingTrustId = 0
                refresh()
            }
        }
        trustBox.addView(trustBtn, Ui.lp(mp, wc, 0f, Ui.dp(c, 6)))
        stCard.addView(trustBox)
        col.addView(stCard, Ui.lp(mp, wc, 0f, Ui.dp(c, 8)))

        // --- the honest line about what a screen share is
        col.addView(
            Ui.text(c, "보내는 동안에는 정한 범위 안에 보이는 것이 그대로 안경으로 갑니다(스마트비서의 다른 화면, 다른 앱 화면, 그 위에 뜨는 알림 팝업 포함). 저장·녹화는 하지 않습니다.", 12f, Ui.SUB),
            Ui.lp(mp, wc, 0f, Ui.dp(c, 6))
        )

        // --- start / stop, and "close the glasses app too"
        val act = Ui.row(c)
        startBtn = Ui.primary(c, "시작")
        startBtn.setOnClickListener { if (AppState.running) stopSharing() else startSharing() }
        act.addView(startBtn, Ui.lp(0, wc, 1f))
        quitBtn = Ui.secondary(c, "정지 + 안경 앱 끄기")
        quitBtn.textSize = 14f
        quitBtn.minHeight = Ui.dp(c, 52)
        quitBtn.minimumHeight = Ui.dp(c, 52)
        quitBtn.setOnClickListener { stopAndQuitGlasses() }
        act.addView(quitBtn, Ui.lp(0, wc, 1f, 0, Ui.dp(c, 8)))
        col.addView(act, Ui.lp(mp, wc, 0f, Ui.dp(c, 8)))

        // --- preview + the two views + brightness
        val pv = Ui.row(c)
        pv.gravity = Gravity.TOP
        preview = ImageView(c)
        preview.background = Ui.lensFrame(c)
        preview.setPadding(Ui.dp(c, 1), Ui.dp(c, 1), Ui.dp(c, 1), Ui.dp(c, 1))
        preview.scaleType = ImageView.ScaleType.FIT_CENTER
        pv.addView(preview, Ui.lp(Ui.dp(c, 150), Ui.dp(c, 200)))
        val side = Ui.column(c)
        side.addView(Ui.text(c, "안경에 보이는 그림", 13f, Ui.SUB))
        val labels = arrayOf("원본 그대로", "어두운 바탕")
        viewBtns = Array(2) { i ->
            val b = Ui.secondary(c, labels[i])
            b.setOnClickListener { setMode(Transform.VIEWS[i]) }
            side.addView(b, Ui.lp(mp, wc, 0f, Ui.dp(c, 6)))
            b
        }
        val br = choiceRow(arrayOf("밝게", "중간", "어둡게"), 40) { i ->
            Prefs.setBrightness(c, i)
            AppState.config.plainDim = Prefs.DIM[i]
            AppState.service?.requestRerender()
            refresh()
        }
        brightBtns = br.second
        brightRow = Ui.column(c)
        brightRow.addView(Ui.text(c, "밝기", 12f, Ui.SUB))
        brightRow.addView(br.first, Ui.lp(mp, wc, 0f, Ui.dp(c, 2)))
        side.addView(brightRow, Ui.lp(mp, wc, 0f, Ui.dp(c, 6)))
        pv.addView(side, Ui.lp(0, wc, 1f, 0, Ui.dp(c, 12)))
        col.addView(pv, Ui.lp(mp, wc, 0f, Ui.dp(c, 10)))
        glareText = Ui.text(c, "「원본 그대로」는 밝은 화면에서 렌즈 전체가 빛나 앞이 가려질 수 있습니다. 눈부시면 밝기를 낮추거나 「어두운 바탕」으로 바꾸세요.", 12f, Ui.WARN)
        col.addView(glareText, Ui.lp(mp, wc, 0f, Ui.dp(c, 6)))

        // --- what part of the screen: one tap
        val sc = choiceRow(arrayOf("화면 가득", "다 보이게", "정한 범위"), 44) { i ->
            Prefs.setScope(c, i)
            AppState.service?.requestRerender()
            refresh()
        }
        scopeBtns = sc.second
        val scRow = Ui.row(c)
        scRow.addView(Ui.text(c, "범위", 13f, Ui.SUB), Ui.lp(Ui.dp(c, 40), wc))
        scRow.addView(sc.first, Ui.lp(0, wc, 1f))
        col.addView(scRow, Ui.lp(mp, wc, 0f, Ui.dp(c, 8)))
        scopeText = Ui.text(c, "", 12f, Ui.SUB)
        col.addView(scopeText, Ui.lp(mp, wc, 0f, Ui.dp(c, 4)))
        regionBtn = Ui.secondary(c, "영역 맞추기")
        regionBtn.setOnClickListener { startActivity(Intent(c, RegionActivity::class.java)) }
        col.addView(regionBtn, Ui.lp(mp, wc, 0f, Ui.dp(c, 6)))

        previewHint = Ui.text(c, "", 13f, Ui.WARN)
        col.addView(previewHint, Ui.lp(mp, wc, 0f, Ui.dp(c, 6)))

        // --- the fold: things used less often
        moreBtn = Ui.secondary(c, "")
        moreBtn.setOnClickListener {
            Prefs.setMoreOpen(c, !Prefs.moreOpen(c))
            refresh()
        }
        col.addView(moreBtn, Ui.lp(mp, wc, 0f, Ui.dp(c, 8)))
        moreBox = Ui.column(c)

        moreBox.addView(check("보내는 동안 화면 켜 두기", Prefs.keepScreenOn(c)) { on ->
            Prefs.setKeepScreenOn(c, on)
            AppState.service?.applyKeepScreenOn()
        }, Ui.lp(mp, wc, 0f, Ui.dp(c, 6)))
        moreBox.addView(
            Ui.text(c, "폰 화면이 저절로 꺼지는 것을 막습니다(밝기는 어두워질 수 있음). 전원 버튼으로 끄면 화면이 그려지지 않아 멈추고, 다시 켜면 이어집니다.", 12f, Ui.SUB),
            Ui.lp(mp, wc, 0f, 0, Ui.dp(c, 32))
        )
        moreBox.addView(check("안경 화면 구석에 눌린 키 값 보이기(확인용)", Prefs.showKeys(c)) { on ->
            Prefs.setShowKeys(c, on)
            AppState.service?.setShowKeys(on)
        }, Ui.lp(mp, wc, 0f, Ui.dp(c, 8)))
        inputText = Ui.text(c, "", 12f, Ui.SUB)
        moreBox.addView(inputText, Ui.lp(mp, wc, 0f, 0, Ui.dp(c, 32)))

        val hostCard = Ui.card(c)
        hostCard.addView(Ui.text(c, "와이파이 주소로 직접 연결 (선택)", 14f, Ui.TEXT, true))
        hostCard.addView(Ui.text(c, "보통은 필요 없습니다(블루투스로 자동 연결). 안경이 와이파이에 붙어 있어 안경 화면에 「와이파이 주소」가 보일 때만, 그 숫자를 적고 연결을 누르세요.", 13f, Ui.SUB), Ui.lp(mp, wc, 0f, Ui.dp(c, 2)))
        val hostRow = Ui.row(c)
        hostEdit = EditText(c)
        hostEdit.hint = "예: 192.168.43.25"
        hostEdit.setSingleLine()
        hostEdit.inputType = InputType.TYPE_CLASS_PHONE
        hostEdit.textSize = 16f
        hostEdit.setText(Prefs.manualHost(c))
        hostRow.addView(hostEdit, Ui.lp(0, wc, 1f))
        val hostBtn = Ui.secondary(c, "연결")
        hostBtn.setOnClickListener { applyHost() }
        hostRow.addView(hostBtn, Ui.lp(Ui.dp(c, 84), wc, 0f, 0, Ui.dp(c, 8)))
        hostCard.addView(hostRow, Ui.lp(mp, wc, 0f, Ui.dp(c, 6)))
        moreBox.addView(hostCard, Ui.lp(mp, wc, 0f, Ui.dp(c, 12)))
        col.addView(moreBox, Ui.lp(mp, wc))

        col.addView(Ui.divider(c), Ui.lp(mp, Ui.dp(c, 1), 0f, Ui.dp(c, 12)))
        col.addView(
            Ui.text(c, "걸을 때는 렌즈 화면을 보지 말고, 멈춰 서서 보세요.\n그림은 폰에 블루투스로 등록된 안경(또는 같은 와이파이 안의 안경)으로만 갑니다. 화면 공유를 막아 둔 앱(일부 금융·영상 앱)은 검게 나옵니다.", 12f, Ui.SUB),
            Ui.lp(mp, wc, 0f, Ui.dp(c, 12))
        )
        // moved in from the stand-alone app: what does not come along, and that the old app can go
        col.addView(
            Ui.text(c, "예전의 별도 앱 「미러링」과 같은 기능입니다. 별도 앱에서 정해 둔 영역·설정은 넘어오지 않으니, 「정한 범위」를 쓰시면 「영역 맞추기」에서 한 번 다시 정해 주세요. 폰의 별도 앱 「미러링」은 지워도 됩니다(안경의 「미러링(안경)」 앱은 그대로 둡니다). 둘을 함께 「시작」하지는 마세요.", 12f, Ui.SUB),
            Ui.lp(mp, wc, 0f, Ui.dp(c, 8))
        )

        val scroll = ScrollView(c)
        scroll.isFillViewport = true
        scroll.addView(col, ViewGroup.LayoutParams(mp, wc))
        scroll.fitsSystemWindows = true
        return scroll
    }

    private fun versionName(): String = try {
        packageManager.getPackageInfo(packageName, 0).versionName ?: ""
    } catch (e: Exception) {
        ""
    }

    private fun refresh() {
        val running = AppState.running
        val connected = running && AppState.linkState == PhoneLink.ST_CONNECTED
        startBtn.text = if (running) "정지" else "시작"
        Ui.setDanger(this, startBtn, running)
        quitBtn.visibility = if (running) View.VISIBLE else View.GONE
        quitBtn.isEnabled = connected
        quitBtn.alpha = if (connected) 1f else 0.4f

        val trustId = AppState.pendingTrustId
        val bt = BtDialer.status(this)
        var needBtPerm = false
        val todo: String
        if (!running) {
            if (AppState.endedBySystem) {
                status.text = "멈춤 — 화면 공유가 끝났습니다"
                todo = "폰이 잠기면 안드로이드가 화면 공유를 끝냅니다. 「시작」을 다시 눌러 주세요."
            } else {
                status.text = "멈춤"
                todo = "안경에서 「미러링(안경)」 앱을 켜고, 여기서 「시작」을 누르세요."
            }
        } else when (AppState.linkState) {
            PhoneLink.ST_CONNECTED -> {
                val how = if (AppState.linkKind == Channel.KIND_BLUETOOTH) "블루투스" else "와이파이"
                status.text = "안경과 연결됨 ($how)"
                todo = if (AppState.built == null) "안경으로 볼 앱을 여세요(예: 지도 앱)."
                else "없음 — 안경으로 보내는 중입니다. 보려는 화면을 폰에 띄워 두세요."
            }
            PhoneLink.ST_WAIT_TRUST -> {
                status.text = "새 글래스를 찾았습니다"
                todo = "아래 번호가 안경 화면의 번호와 같으면 「이 글래스와 연결」을 누르세요."
            }
            else -> {
                status.text = "안경 찾는 중…"
                todo = when (bt) {
                    BtDialer.ST_NO_PERMISSION -> {
                        needBtPerm = true
                        "아래 「블루투스 권한 허용」을 눌러 주세요. (안경과 블루투스로 잇는 데 필요합니다)"
                    }
                    BtDialer.ST_OFF -> "폰의 블루투스를 켜 주세요."
                    BtDialer.ST_NO_PAIRED -> "폰에 블루투스로 등록된 기기가 없습니다. Hi Rokid 앱에서 안경을 먼저 연결해 주세요."
                    BtDialer.ST_NO_ADAPTER -> "이 폰에서는 블루투스를 쓸 수 없습니다. 「설정 더 보기」의 와이파이 주소 연결을 써 주세요."
                    else -> "안경에서 「미러링(안경)」 앱을 켜 주세요. 켜져 있으면 잠시 기다리세요." +
                        (if (AppState.trying.isEmpty()) "" else "\n(확인 중: " + AppState.trying + ")")
                }
            }
        }
        statusSub.text = "지금 할 일: $todo"
        btPermBtn.visibility = if (needBtPerm) View.VISIBLE else View.GONE

        val showTrust = running && trustId != 0 && AppState.linkState != PhoneLink.ST_CONNECTED
        trustBox.visibility = if (showTrust) View.VISIBLE else View.GONE
        if (showTrust) trustText.text = "글래스 번호 $trustId — 안경 화면의 번호와 같으면 누르세요."

        // the two views
        val plain = AppState.mode == Transform.MODE_PLAIN
        Ui.setSelected(this, viewBtns[0], plain)
        Ui.setSelected(this, viewBtns[1], !plain)
        brightRow.visibility = if (plain) View.VISIBLE else View.INVISIBLE
        glareText.visibility = if (plain) View.VISIBLE else View.GONE
        val bi = Prefs.brightness(this)
        for (i in brightBtns.indices) Ui.setSelected(this, brightBtns[i], i == bi)

        // what part of the screen
        val scope = Prefs.scope(this)
        for (i in scopeBtns.indices) Ui.setSelected(this, scopeBtns[i], i == scope)
        scopeText.text = when (scope) {
            Prefs.SCOPE_FILL -> "화면 가득: 안경 화면을 꽉 채웁니다. 폰 화면이 더 길어 위아래가 잘립니다."
            Prefs.SCOPE_ALL -> "다 보이게: 폰 화면 전체가 잘리지 않고 보입니다. 작아지고 양옆은 검게 남습니다."
            else -> "정한 범위: 「영역 맞추기」에서 정한 네모만 보냅니다(" +
                (if (Prefs.regionFit(this) == FrameBuilder.FIT_CONTAIN) "전체 보이기" else "꽉 채우기") + ")."
        }
        regionBtn.visibility = if (scope == Prefs.SCOPE_REGION) View.VISIBLE else View.GONE

        val built = AppState.built
        val hints = ArrayList<String>()
        if (built != null) {
            val b = Ui.grayToBitmap(built.gray, Layout.W, Layout.H, previewBmp)
            previewBmp = b
            preview.setImageBitmap(b)
            preview.invalidate()
            if (AppState.screenOff) hints.add(CaptureService.TEXT_SCREEN_OFF)
            if (AppState.quality > 0) hints.add("연결이 느려 그림을 덜 세밀하게 보내는 중입니다(" + AppState.quality + "단계/3). 빨라지면 저절로 돌아옵니다.")
            if (AppState.regionMissing) hints.add("이 화면 크기(" + AppState.frameW + "×" + AppState.frameH + ")에는 아직 정한 범위가 없어 화면 전체를 보냅니다. 「영역 맞추기」에서 정해 주세요.")
        } else {
            preview.setImageDrawable(null)
            if (running) hints.add("아직 그림이 없습니다. 다른 화면을 한 번 띄웠다가 돌아오면 여기에 보입니다(이 미러링 화면은 안경으로 보내지 않습니다).")
        }
        previewHint.text = hints.joinToString("\n")
        previewHint.visibility = if (hints.isEmpty()) View.GONE else View.VISIBLE

        val open = Prefs.moreOpen(this)
        moreBtn.text = if (open) "설정 접기 ▴" else "설정 더 보기 ▾"
        moreBox.visibility = if (open) View.VISIBLE else View.GONE
        inputText.text = (if (AppState.lastInput.isEmpty()) "안경에서 들어온 입력: 아직 없음" else "안경에서 들어온 입력: " + AppState.lastInput) +
            (if (AppState.lastDelivery.isEmpty()) "" else "\n최근 보낸 그림: " + AppState.lastDelivery)
    }

    // ---------------------------------------------------------------- actions

    private fun setMode(m: Int) {
        AppState.mode = m
        Prefs.setMode(this, m)
        AppState.service?.requestRerender()
        refresh()
    }

    private fun applyHost() {
        val h = hostEdit.text.toString().trim()
        if (h.isNotEmpty() && !NetUtil.isLocalHostString(h)) {
            Toast.makeText(this, "주소는 192.168.43.25 처럼 안경 화면에 보이는 숫자 그대로 적어 주세요.", Toast.LENGTH_LONG).show()
            return
        }
        Prefs.setManualHost(this, h)
        AppState.service?.reconnect()
        Toast.makeText(this, if (h.isEmpty()) "자동으로 찾습니다." else "$h 로 연결합니다.", Toast.LENGTH_SHORT).show()
    }

    private fun startSharing() {
        if (!askedPerms) {
            askedPerms = true
            val need = ArrayList<String>()
            if (Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) need.add(Manifest.permission.POST_NOTIFICATIONS)
            if (!BtDialer.hasPermission(this)) need.add(Manifest.permission.BLUETOOTH_CONNECT)
            if (need.isNotEmpty()) {
                requestPermissions(need.toTypedArray(), REQ_NOTIF)
                return
            }
        }
        val mpm = getSystemService(MediaProjectionManager::class.java)
        val intent = if (Build.VERSION.SDK_INT >= 34) {
            // whole screen only: fewer choices to get wrong
            mpm.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
        } else {
            mpm.createScreenCaptureIntent()
        }
        try {
            @Suppress("DEPRECATION")
            startActivityForResult(intent, REQ_CAPTURE)
        } catch (e: Exception) {
            Toast.makeText(this, "화면 공유를 시작하지 못했습니다.", Toast.LENGTH_LONG).show()
        }
    }

    /** Asks again; after two refusals Android stops showing the box, so the settings page of this app is opened instead. */
    private fun askBtPermission() {
        if (BtDialer.hasPermission(this)) {
            refresh()
            return
        }
        btPermAsks++
        if (btPermAsks <= 2 && Build.VERSION.SDK_INT >= 31) {
            requestPermissions(arrayOf(Manifest.permission.BLUETOOTH_CONNECT), REQ_BT)
        } else {
            try {
                startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
                Toast.makeText(this, "「권한」에서 「근처 기기」를 허용해 주세요.", Toast.LENGTH_LONG).show()
            } catch (e: Exception) {
            }
        }
    }

    /** Stop sending. The glasses app stays open and goes back to its waiting screen. */
    private fun stopSharing() {
        AppState.endedBySystem = false
        val s = AppState.service
        if (s != null) s.shutdown()
        refresh()
    }

    /** Stop sending and close the glasses app as well (it is told so over the open connection). */
    private fun stopAndQuitGlasses() {
        AppState.endedBySystem = false
        val s = AppState.service ?: return
        quitBtn.isEnabled = false
        quitBtn.alpha = 0.4f
        s.quitGlassesAndStop()
        Toast.makeText(this, "안경 앱을 끄고 정지합니다.", Toast.LENGTH_SHORT).show()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        // continue either way: without them only the notification / the Bluetooth route is missing
        if (requestCode == REQ_NOTIF) startSharing()
        if (requestCode == REQ_BT) {
            AppState.service?.reconnect()
            refresh()
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_CAPTURE) return
        if (resultCode == RESULT_OK && data != null) {
            val i = Intent(this, CaptureService::class.java)
                .setAction(CaptureService.ACTION_START)
                .putExtra(CaptureService.EXTRA_CODE, resultCode)
                .putExtra(CaptureService.EXTRA_DATA, data)
            startForegroundService(i)
            Toast.makeText(this, "이제 안경으로 볼 앱을 여세요.", Toast.LENGTH_LONG).show()
        } else {
            Toast.makeText(this, "화면 공유를 허용해야 보낼 수 있습니다.", Toast.LENGTH_LONG).show()
        }
    }

    /** Test hook for automated runs. Works in debug builds only; release builds ignore it. */
    private fun handleDebugIntent(intent: Intent) {
        val debuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        if (!debuggable) return
        val host = intent.getStringExtra("host")
        if (host != null && NetUtil.isLocalHostString(host)) {
            Prefs.setManualHost(this, host)
            hostEdit.setText(host)
        }
        val scope = intent.getIntExtra("scope", -1)
        if (scope in 0..2) {
            Prefs.setScope(this, scope)
            AppState.service?.requestRerender()
        }
        if (intent.hasExtra("more")) Prefs.setMoreOpen(this, intent.getBooleanExtra("more", false))
        if (intent.getBooleanExtra("autostart", false) && !AppState.running) {
            intent.removeExtra("autostart")
            startSharing()
        }
    }
}
