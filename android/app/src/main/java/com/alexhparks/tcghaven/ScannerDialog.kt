// The scanner screen on Android (CardScannerPlugin.open). Full screen over the page — the page
// keeps running underneath, matching each card on the site (lib/scan/scanner.ts).
//
//   1. the camera, with a card-shaped outline to line the card up in (the part inside the outline
//      is the card: no edge finding needed — the picture AI copes with a little background)
//   2. every ~quarter second: the text inside the outline (ML Kit, on the phone). When the phone is
//      held still and a card's worth of text is there, it's captured — once per card: the next
//      capture waits for different text (the next card) or an empty outline
//   3. the capture: the text again, English + Japanese; the picture AI's fingerprint; then
//      "cardScanned" to the site, which answers with update()
//   4. a tray of everything scanned; tap one for its card sheet (other matches, finish, condition,
//      search); "Add N" sends the picks back
//
// The iPhone's version is ios/App/App/CardScanner.swift — keep the two doing the same things.

package com.alexhparks.tcghaven

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.app.Dialog
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.util.LruCache
import android.util.Size
import android.util.TypedValue
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

class ScannerDialog(
    private val activity: AppCompatActivity,
    private val title: String,
    private val onScanned: (String, JSONArray, List<FloatArray>?) -> Unit,
    private val onSearch: (String, String) -> Unit,
    private val onFinish: (JSONArray) -> Unit,
) : Dialog(activity, android.R.style.Theme_Black_NoTitleBar), SensorEventListener {

    // ── Look: the iPhone scanner's dark glass and TCG Haven gold ──
    private val gold = Color.parseColor("#D4A24C")
    private val ink = Color.parseColor("#F5ECD9")
    private val muted = Color.parseColor("#B9AC94")
    private val sheetBg = Color.parseColor("#1C1712")

    // ── Camera + text reading ──
    private lateinit var preview: PreviewView
    private lateinit var guide: GuideOverlay
    private var camera: Camera? = null
    private var cameraProvider: ProcessCameraProvider? = null
    private val analysisThread = Executors.newSingleThreadExecutor()
    private val captureThread = Executors.newSingleThreadExecutor()
    private val latin = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    private val japanese = TextRecognition.getClient(JapaneseTextRecognizerOptions.Builder().build())
    private val main = Handler(Looper.getMainLooper())

    @Volatile private var busy = false
    @Volatile private var lastTick = 0L
    @Volatile private var forceCapture = false
    @Volatile private var finished = false
    private var lastSignature: Set<String>? = null   // the last captured card's words
    private var emptyTicks = 0

    // Steadiness: the phone's rotation rate, from the gyroscope
    private var sensors: SensorManager? = null
    @Volatile private var lastShakeAt = System.currentTimeMillis()

    // ── Tray ──
    private val items = mutableListOf<ScanItem>()
    private lateinit var tray: LinearLayout
    private lateinit var trayScroll: HorizontalScrollView
    private lateinit var addButton: Button
    private lateinit var hint: TextView
    private lateinit var torchButton: Button
    private var torchOn = false
    private var sheet: CardSheet? = null
    private val searchWaiting = HashMap<String, (List<TrayOption>) -> Unit>()

    private fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, context.resources.displayMetrics)
    private fun dpi(v: Float) = dp(v).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window?.apply {
            setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            statusBarColor = Color.BLACK
            navigationBarColor = Color.BLACK
        }
        setCancelable(false)
        setContentView(build())
        sensors = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
        sensors?.getDefaultSensor(Sensor.TYPE_GYROSCOPE)?.let { sensors?.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
        startCamera()
        refreshAdd()
    }

    // ── Layout (built in code: no XML to keep in step) ──

    private fun build(): View {
        val root = FrameLayout(context).apply { setBackgroundColor(Color.BLACK) }
        preview = PreviewView(context).apply {
            scaleType = PreviewView.ScaleType.FILL_CENTER
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        }
        root.addView(preview, FrameLayout.LayoutParams(-1, -1))
        guide = GuideOverlay(context)
        root.addView(guide, FrameLayout.LayoutParams(-1, -1))

        // Top bar: close · title · light
        val top = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dpi(12f), dpi(8f), dpi(12f), dpi(8f))
        }
        val close = roundButton("✕") { closeTapped() }
        val titleView = TextView(context).apply {
            text = title
            setTextColor(ink)
            textSize = 17f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
        }
        torchButton = roundButton("💡") { toggleTorch() }
        top.addView(close, LinearLayout.LayoutParams(dpi(44f), dpi(44f)))
        top.addView(titleView, LinearLayout.LayoutParams(0, -2, 1f))
        top.addView(torchButton, LinearLayout.LayoutParams(dpi(44f), dpi(44f)))
        root.addView(top, FrameLayout.LayoutParams(-1, -2, Gravity.TOP))

        hint = TextView(context).apply {
            setTextColor(Color.WHITE)
            textSize = 14f
            gravity = Gravity.CENTER
            setPadding(dpi(14f), dpi(6f), dpi(14f), dpi(6f))
            background = rounded(Color.argb(150, 0, 0, 0), dp(16f))
            text = "Line the card up inside the outline"
        }
        root.addView(hint, FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply { topMargin = dpi(64f) })

        // Bottom: the tray, then shutter + Add
        val bottom = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.argb(200, 12, 10, 8))
            setPadding(0, dpi(8f), 0, dpi(12f))
        }
        trayScroll = HorizontalScrollView(context).apply { isHorizontalScrollBarEnabled = false }
        tray = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dpi(12f), 0, dpi(12f), 0)
        }
        trayScroll.addView(tray)
        bottom.addView(trayScroll, LinearLayout.LayoutParams(-1, dpi(118f)))
        val controls = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dpi(16f), dpi(8f), dpi(16f), 0)
        }
        val spacer = View(context)
        val shutter = View(context).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.WHITE)
                setStroke(dpi(4f), gold)
            }
            contentDescription = "Scan now"
            setOnClickListener { forceCapture = true; performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY) }
        }
        addButton = Button(context).apply {
            isAllCaps = false
            textSize = 15f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.BLACK)
            background = rounded(gold, dp(22f))
            setPadding(dpi(18f), 0, dpi(18f), 0)
            setOnClickListener { doneTapped() }
        }
        controls.addView(spacer, LinearLayout.LayoutParams(0, 1, 1f))
        controls.addView(shutter, LinearLayout.LayoutParams(dpi(68f), dpi(68f)))
        val right = FrameLayout(context)
        right.addView(addButton, FrameLayout.LayoutParams(-2, dpi(44f), Gravity.END or Gravity.CENTER_VERTICAL))
        controls.addView(right, LinearLayout.LayoutParams(0, dpi(68f), 1f))
        bottom.addView(controls)
        root.addView(bottom, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))

        // Keep clear of the status and navigation bars
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            (top.layoutParams as FrameLayout.LayoutParams).topMargin = bars.top
            (hint.layoutParams as FrameLayout.LayoutParams).topMargin = bars.top + dpi(64f)
            bottom.setPadding(0, dpi(8f), 0, dpi(12f) + bars.bottom)
            guide.insetTop = bars.top + dpi(110f)
            root.requestLayout()
            insets
        }
        // The outline sits between the hint and the tray
        bottom.addOnLayoutChangeListener { _, _, t, _, _, _, _, _, _ -> guide.insetBottom = root.height - t + dpi(12f); guide.invalidate() }
        return root
    }

    private fun roundButton(label: String, onTap: () -> Unit) = Button(context).apply {
        text = label
        textSize = 18f
        setTextColor(Color.WHITE)
        setPadding(0, 0, 0, 0)
        background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.argb(120, 0, 0, 0)) }
        setOnClickListener { onTap() }
    }

    private fun rounded(color: Int, radius: Float, stroke: Int = 0, strokeColor: Int = 0) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = radius
        if (stroke > 0) setStroke(stroke, strokeColor)
    }

    // ── Camera ──

    private fun startCamera() {
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            val provider = future.get()
            cameraProvider = provider
            val previewUse = Preview.Builder().build().also { it.surfaceProvider = preview.surfaceProvider }
            // Big enough frames for the small printed numbers
            val selector = ResolutionSelector.Builder()
                .setResolutionStrategy(ResolutionStrategy(Size(1920, 1080), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
                .build()
            val analysis = ImageAnalysis.Builder()
                .setResolutionSelector(selector)
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
                .build()
            analysis.setAnalyzer(analysisThread) { analyze(it) }
            try {
                provider.unbindAll()
                camera = provider.bindToLifecycle(activity, CameraSelector.DEFAULT_BACK_CAMERA, previewUse, analysis)
            } catch (e: Exception) {
                setHint("The camera couldn’t start")
            }
        }, ContextCompat.getMainExecutor(context))
    }

    private fun toggleTorch() {
        torchOn = !torchOn
        camera?.cameraControl?.enableTorch(torchOn)
        torchButton.alpha = if (torchOn) 1f else 0.75f
        torchButton.background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(if (torchOn) gold else Color.argb(120, 0, 0, 0)) }
    }

    /** The upright camera frame cropped to the outline (with a little margin round the card) */
    private fun cardCrop(proxy: ImageProxy): Bitmap? {
        val raw = proxy.toBitmap()
        val rotation = proxy.imageInfo.rotationDegrees
        val frame = if (rotation == 0) raw else Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, Matrix().apply { postRotate(rotation.toFloat()) }, true)
        val vw = preview.width.toFloat()
        val vh = preview.height.toFloat()
        val g = guide.cardRect ?: return null
        if (vw <= 0 || vh <= 0) return null
        // FILL_CENTER: the frame is scaled to cover the view and centred
        val scale = max(vw / frame.width, vh / frame.height)
        val dx = (vw - frame.width * scale) / 2
        val dy = (vh - frame.height * scale) / 2
        val m = g.width() * 0.04f
        val left = ((g.left - m - dx) / scale).toInt().coerceIn(0, frame.width - 1)
        val top = ((g.top - m - dy) / scale).toInt().coerceIn(0, frame.height - 1)
        val right = ((g.right + m - dx) / scale).toInt().coerceIn(left + 1, frame.width)
        val bottom = ((g.bottom + m - dy) / scale).toInt().coerceIn(top + 1, frame.height)
        return Bitmap.createBitmap(frame, left, top, right - left, bottom - top)
    }

    private fun analyze(proxy: ImageProxy) {
        val now = System.currentTimeMillis()
        if (finished || busy || (now - lastTick < 250 && !forceCapture)) { proxy.close(); return }
        lastTick = now
        busy = true
        val crop = try { cardCrop(proxy) } catch (e: Throwable) { null } finally { proxy.close() }
        if (crop == null) { busy = false; return }
        latin.process(InputImage.fromBitmap(crop, 0))
            .addOnSuccessListener { text -> onRead(crop, text) }
            .addOnFailureListener { busy = false }
    }

    private fun words(text: Text): Set<String> =
        text.text.lowercase().split(Regex("[^a-z0-9\\u3040-\\u30ff\\u4e00-\\u9faf]+")).filter { it.length >= 3 }.toSet()

    private fun differs(a: Set<String>, b: Set<String>): Boolean {
        if (a.isEmpty() || b.isEmpty()) return true
        val shared = a.intersect(b).size.toFloat()
        return shared / a.union(b).size < 0.4f
    }

    /** One look inside the outline: capture it when a card is there, still, and new */
    private fun onRead(crop: Bitmap, text: Text) {
        val lines = text.textBlocks.sumOf { it.lines.size }
        val chars = text.text.count { !it.isWhitespace() }
        val sig = words(text)
        val steady = System.currentTimeMillis() - lastShakeAt > 450
        val force = forceCapture
        if (chars < 8) emptyTicks++ else emptyTicks = 0
        // The last card left the outline: the next one may be the same card again (a second copy)
        if (emptyTicks >= 2) lastSignature = null
        val fresh = lastSignature?.let { differs(sig, it) } ?: true
        when {
            force && chars > 0 -> { forceCapture = false; capture(crop, text, sig) }
            lines >= 3 && chars >= 15 && fresh && steady -> capture(crop, text, sig)
            else -> {
                if (force) forceCapture = false
                busy = false
                main.post {
                    guide.state = if (lines >= 3 && fresh) GuideOverlay.State.SEEN else GuideOverlay.State.IDLE
                    setHint(when {
                        lines >= 3 && fresh && !steady -> "Hold still…"
                        lines >= 3 && !fresh -> "Got it — next card"
                        else -> "Line the card up inside the outline"
                    })
                }
            }
        }
    }

    private fun capture(crop: Bitmap, latinText: Text, sig: Set<String>) {
        lastSignature = sig
        main.post { guide.state = GuideOverlay.State.READING; setHint("Reading…"); guide.performHapticFeedback(HapticFeedbackConstants.CONFIRM) }
        // Japanese too, on the captured picture only (it reads Latin as well, a little slower)
        japanese.process(InputImage.fromBitmap(crop, 0))
            .addOnCompleteListener { jp -> captureThread.execute { finishCapture(crop, latinText, jp.result) } }
    }

    private fun finishCapture(crop: Bitmap, latinText: Text, jpText: Text?) {
        try {
            val w = crop.width.toFloat()
            val h = crop.height.toFloat()
            val seen = HashSet<String>()
            val lines = JSONArray()
            fun add(line: Text.Line) {
                val t = line.text.trim()
                val box: Rect = line.boundingBox ?: return
                if (t.isEmpty() || !seen.add(t)) return
                lines.put(JSONObject()
                    .put("text", t)
                    .put("x", (box.left / w).coerceIn(0f, 1f).toDouble())
                    .put("y", (box.top / h).coerceIn(0f, 1f).toDouble())
                    .put("w", (box.width() / w).coerceIn(0f, 1f).toDouble())
                    .put("h", (box.height() / h).coerceIn(0f, 1f).toDouble()))
            }
            latinText.textBlocks.forEach { b -> b.lines.forEach(::add) }
            val japaneseRead = jpText?.text?.any { it in '぀'..'ヿ' || it in '一'..'龯' } == true
            if (japaneseRead) jpText?.textBlocks?.forEach { b -> b.lines.forEach(::add) }
            val chars = (0 until lines.length()).sumOf { lines.getJSONObject(it).getString("text").length }
            if (lines.length() < 3 || chars < 15) {
                main.post { setHint("No card there"); guide.state = GuideOverlay.State.IDLE }
                return
            }
            val fingerprints = CardFingerprinter.fingerprints(crop)
            val id = UUID.randomUUID().toString()
            val thumb = scaled(crop, 240)
            val photo = scaled(crop, 760)
            main.post {
                if (finished) return@post
                val item = ScanItem(id, thumb, photo)
                items.add(0, item)
                redrawTray()
                trayScroll.smoothScrollTo(0, 0)
                guide.state = GuideOverlay.State.IDLE
                setHint("Finding the card…")
                onScanned(id, lines, fingerprints)
            }
        } finally {
            busy = false
        }
    }

    private fun scaled(b: Bitmap, height: Int): Bitmap =
        if (b.height <= height) b else Bitmap.createScaledBitmap(b, (b.width * height.toFloat() / b.height).toInt(), height, true)

    private fun setHint(s: String) { hint.text = s }

    // ── Steadiness ──

    override fun onSensorChanged(e: SensorEvent) {
        val r = sqrt(e.values[0] * e.values[0] + e.values[1] * e.values[1] + e.values[2] * e.values[2])
        if (r > 0.12f) lastShakeAt = System.currentTimeMillis()
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    // ── The site's answers ──

    fun update(scanId: String, status: String, options: List<TrayOption>, choice: Int, note: String?, slab: SlabGrade?) {
        val item = items.firstOrNull { it.id == scanId } ?: return
        if (status == "reject") {
            // Not sure enough to show (a word on a screen, a loose guess): dropped, scan again
            items.remove(item)
            lastSignature = null
            redrawTray()
            Toast.makeText(context, note ?: "Couldn’t tell which card that was — try again", Toast.LENGTH_SHORT).show()
            return
        }
        item.status = status
        item.note = note
        if (status != "error") {
            item.options = options
            item.choice = choice.coerceIn(0, max(0, options.size - 1))
            if (slab != null) item.slab = slab
        }
        if (status == "matched") guide.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
        setHint(when (status) {
            "matched" -> "✓ ${item.current?.title ?: "Added"}"
            "pick" -> "? Not sure — tap it to check"
            "error" -> note ?: "Couldn’t reach TCGHaven"
            else -> note ?: "Not found — try again"
        })
        redrawTray()
        sheet?.takeIf { it.item === item }?.refresh()
    }

    fun deliverSearch(requestId: String, options: List<TrayOption>) {
        searchWaiting.remove(requestId)?.invoke(options)
    }

    // ── Tray ──

    private fun redrawTray() {
        tray.removeAllViews()
        for (item in items) tray.addView(trayCell(item), LinearLayout.LayoutParams(dpi(74f), -1).apply { rightMargin = dpi(8f) })
        refreshAdd()
    }

    private fun statusColor(item: ScanItem) = when (item.status) {
        "matched" -> gold
        "pick" -> Color.parseColor("#F2C94C")
        "matching" -> Color.argb(160, 255, 255, 255)
        else -> Color.parseColor("#E5484D")
    }

    private fun trayCell(item: ScanItem): View {
        val cell = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL }
        val img = ImageView(context).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            setImageBitmap(item.thumbnail)
            background = rounded(Color.DKGRAY, dp(6f), dpi(2f), statusColor(item))
            setPadding(dpi(2f), dpi(2f), dpi(2f), dpi(2f))
            clipToOutline = true
        }
        item.current?.imageUrl?.takeIf { it.isNotEmpty() }?.let { url -> ImageLoader.load(url, img) }
        cell.addView(img, LinearLayout.LayoutParams(dpi(64f), dpi(88f)))
        val label = TextView(context).apply {
            text = when (item.status) {
                "matching" -> "Matching…"
                "matched" -> item.current?.title ?: ""
                "pick" -> "? ${item.current?.title ?: ""}"
                else -> "! Not found"
            }
            setTextColor(if (item.status == "matched") ink else statusColor(item))
            textSize = 10f
            maxLines = 1
            gravity = Gravity.CENTER
            ellipsize = android.text.TextUtils.TruncateAt.END
        }
        cell.addView(label, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dpi(4f) })
        cell.setOnClickListener { openSheet(item) }
        return cell
    }

    private fun picks() = items.filter { it.status == "matched" || it.status == "pick" }

    private fun refreshAdd() {
        val n = picks().size
        addButton.text = if (n == 0) "Add" else "Add $n"
        addButton.isEnabled = n > 0
        addButton.alpha = if (n > 0) 1f else 0.4f
    }

    private fun doneTapped() {
        val out = JSONArray()
        for (item in picks().reversed()) out.put(item.toPick())
        finish(out)
    }

    private fun closeTapped() {
        val n = picks().size
        if (n == 0) return finish(JSONArray())
        AlertDialog.Builder(context)
            .setTitle("Discard $n scanned card${if (n == 1) "" else "s"}?")
            .setMessage("They haven’t been added to your inventory yet.")
            .setNegativeButton("Keep scanning", null)
            .setPositiveButton("Discard") { _, _ -> finish(JSONArray()) }
            .show()
    }

    @Deprecated("Back closes the scanner, asking first if cards would be lost")
    override fun onBackPressed() { closeTapped() }

    private fun finish(picks: JSONArray) {
        if (finished) return
        finished = true
        sensors?.unregisterListener(this)
        try { cameraProvider?.unbindAll() } catch (_: Throwable) {}
        dismiss()
        onFinish(picks)
    }

    private fun openSheet(item: ScanItem) {
        sheet?.dismiss()
        sheet = CardSheet(item).also { it.show() }
    }

    // ── The card sheet: the card, its finish and condition, other matches, search ──

    private inner class CardSheet(val item: ScanItem) : Dialog(activity, android.R.style.Theme_Black_NoTitleBar) {
        private val body = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setPadding(dpi(20f), dpi(16f), dpi(20f), dpi(32f)) }
        private var showScan = false
        private var results: List<TrayOption> = emptyList()
        private var searching = false

        override fun onCreate(savedInstanceState: Bundle?) {
            super.onCreate(savedInstanceState)
            window?.setLayout(-1, -1)
            window?.statusBarColor = sheetBg
            val scroll = ScrollView(context).apply { setBackgroundColor(sheetBg); addView(body) }
            ViewCompat.setOnApplyWindowInsetsListener(scroll) { v, insets ->
                val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
                v.setPadding(0, bars.top, 0, bars.bottom); insets
            }
            setContentView(scroll)
            setOnDismissListener { if (sheet === this) sheet = null }
            refresh()
        }

        private fun section(label: String) = TextView(context).apply {
            text = label.uppercase()
            setTextColor(muted)
            textSize = 11f
            letterSpacing = 0.08f
            typeface = Typeface.DEFAULT_BOLD
            setPadding(0, dpi(18f), 0, dpi(8f))
        }

        private fun chip(label: String, on: Boolean, sub: String? = null, onTap: () -> Unit) = TextView(context).apply {
            text = if (sub.isNullOrEmpty()) label else "$label\n$sub"
            gravity = Gravity.CENTER
            textSize = 14f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(if (on) Color.BLACK else ink)
            background = rounded(if (on) gold else Color.argb(22, 255, 255, 255), dp(12f))
            setPadding(dpi(14f), dpi(8f), dpi(14f), dpi(8f))
            setOnClickListener { onTap(); performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY) }
        }

        private fun row(vararg views: View) = HorizontalScrollView(context).apply {
            isHorizontalScrollBarEnabled = false
            val l = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
            for (v in views) l.addView(v, LinearLayout.LayoutParams(-2, -2).apply { rightMargin = dpi(8f) })
            addView(l)
        }

        fun refresh() {
            body.removeAllViews()
            val o = item.current
            // Close
            val bar = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            val pill = TextView(context).apply {
                text = when (item.status) {
                    "matched" -> if (item.confirmed) "✓ You picked this" else "✓ Matched"
                    "pick" -> "? Not sure — check the other matches"
                    "matching" -> "Matching…"
                    else -> "! Not found — search below"
                }
                setTextColor(if (item.status == "matched") Color.BLACK else ink)
                textSize = 12f
                typeface = Typeface.DEFAULT_BOLD
                setPadding(dpi(10f), dpi(4f), dpi(10f), dpi(4f))
                background = rounded(if (item.status == "matched") gold else if (item.status == "pick") Color.parseColor("#B8860B") else Color.argb(40, 255, 255, 255), dp(11f))
            }
            val done = TextView(context).apply {
                text = "Done"; setTextColor(gold); textSize = 16f; typeface = Typeface.DEFAULT_BOLD
                setPadding(dpi(12f), dpi(8f), 0, dpi(8f))
                setOnClickListener { dismiss() }
            }
            bar.addView(pill)
            bar.addView(View(context), LinearLayout.LayoutParams(0, 1, 1f))
            bar.addView(done)
            body.addView(bar)

            // The card: its catalog photo, or the scan
            val img = ImageView(context).apply { scaleType = ImageView.ScaleType.FIT_CENTER; adjustViewBounds = true }
            if (!showScan && o != null && o.imageUrl.isNotEmpty()) { img.setImageBitmap(item.photo); ImageLoader.load(o.imageUrl, img) } else img.setImageBitmap(item.photo)
            body.addView(img, LinearLayout.LayoutParams(-1, dpi(300f)).apply { topMargin = dpi(14f) })
            body.addView(row(
                chip("Catalog photo", !showScan) { showScan = false; refresh() },
                chip("Your scan", showScan) { showScan = true; refresh() },
            ).also { it.setPadding(0, dpi(10f), 0, 0) })

            if (o != null) {
                body.addView(TextView(context).apply { text = o.title; setTextColor(ink); textSize = 22f; typeface = Typeface.DEFAULT_BOLD; setPadding(0, dpi(12f), 0, 0) })
                body.addView(TextView(context).apply { text = o.subtitle; setTextColor(muted); textSize = 14f })
                val p = item.currentPrinting
                val price = if (p != null && o.printings.size > 1 && p.price.isNotEmpty()) "${p.price} · ${p.label}" else o.price
                if (price.isNotEmpty()) body.addView(TextView(context).apply { text = price; setTextColor(gold); textSize = 19f; typeface = Typeface.DEFAULT_BOLD; setPadding(0, dpi(6f), 0, 0) })

                // Finish: every printing, with its price
                if (o.printings.size > 1) {
                    body.addView(section("Finish"))
                    val picked = item.printing ?: o.printings.first().key
                    body.addView(row(*o.printings.map { pr -> chip(pr.label, pr.key == picked, pr.price) { item.printing = pr.key; refresh() } }.toTypedArray()))
                }
            }

            // Condition (a graded card has its grade instead)
            if (item.slab == null) {
                body.addView(section("Condition"))
                val keys = listOf("near_mint" to "NM", "lightly_played" to "LP", "moderately_played" to "MP", "heavily_played" to "HP")
                val current = item.condition ?: "near_mint"
                body.addView(row(*keys.map { (k, label) -> chip(label, k == current) { item.condition = if (k == "near_mint") null else k; refresh() } }.toTypedArray()))
            } else {
                body.addView(section("Graded"))
                body.addView(TextView(context).apply { text = "${item.slab!!.company} ${item.slab!!.grade}${if (item.slab!!.cert.isNotEmpty()) " · cert ${item.slab!!.cert}" else ""}"; setTextColor(ink); textSize = 15f })
            }

            // Other matches
            if (item.options.size > 1) {
                body.addView(section("Other matches — tap to switch"))
                item.options.forEachIndexed { i, opt -> if (i != item.choice) body.addView(optionRow(opt) { choose(opt) }) }
            }

            // Search
            body.addView(section("Not right? Find the card"))
            val field = EditText(context).apply {
                hint = "Card name, or name and number"
                setHintTextColor(muted)
                setTextColor(ink)
                inputType = InputType.TYPE_CLASS_TEXT
                imeOptions = EditorInfo.IME_ACTION_SEARCH
                background = rounded(Color.argb(22, 255, 255, 255), dp(10f))
                setPadding(dpi(12f), dpi(10f), dpi(12f), dpi(10f))
                setSingleLine()
                setOnEditorActionListener { v, _, _ -> search(v.text.toString()); true }
            }
            body.addView(field, LinearLayout.LayoutParams(-1, -2))
            if (searching) body.addView(TextView(context).apply { text = "Searching…"; setTextColor(muted); setPadding(0, dpi(8f), 0, 0) })
            for (opt in results) body.addView(optionRow(opt) { choose(opt) })

            // Remove
            body.addView(TextView(context).apply {
                text = "Remove card"
                setTextColor(Color.parseColor("#E5484D"))
                textSize = 15f
                typeface = Typeface.DEFAULT_BOLD
                gravity = Gravity.CENTER
                setPadding(0, dpi(28f), 0, dpi(8f))
                setOnClickListener {
                    items.remove(item)
                    redrawTray()
                    dismiss()
                }
            })
        }

        private fun optionRow(o: TrayOption, onTap: () -> Unit): View {
            val r = LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, dpi(6f), 0, dpi(6f))
                setOnClickListener { onTap() }
            }
            val img = ImageView(context).apply { scaleType = ImageView.ScaleType.FIT_CENTER }
            if (o.imageUrl.isNotEmpty()) ImageLoader.load(o.imageUrl, img)
            r.addView(img, LinearLayout.LayoutParams(dpi(44f), dpi(62f)))
            val text = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setPadding(dpi(12f), 0, 0, 0) }
            text.addView(TextView(context).apply { this.text = o.title; setTextColor(ink); textSize = 15f; typeface = Typeface.DEFAULT_BOLD })
            text.addView(TextView(context).apply { this.text = o.subtitle; setTextColor(muted); textSize = 12f })
            if (o.price.isNotEmpty()) text.addView(TextView(context).apply { this.text = o.price; setTextColor(gold); textSize = 12f })
            r.addView(text, LinearLayout.LayoutParams(0, -2, 1f))
            return r
        }

        private fun choose(o: TrayOption) {
            val i = item.options.indexOfFirst { it.key == o.key && o.key.isNotEmpty() }
            if (i >= 0) item.choice = i else { item.options = listOf(o) + item.options; item.choice = 0 }
            item.status = "matched"
            item.confirmed = true
            item.printing = null
            showScan = false
            redrawTray()
            refresh()
        }

        private fun search(q: String) {
            val query = q.trim()
            if (query.isEmpty()) return
            val requestId = UUID.randomUUID().toString()
            searching = true
            results = emptyList()
            refresh()
            searchWaiting[requestId] = { found -> searching = false; results = found; if (isShowing) refresh() }
            onSearch(requestId, query)
        }
    }
}

/** The card-shaped outline, with the rest of the picture dimmed */
@SuppressLint("ViewConstructor")
class GuideOverlay(context: Context) : View(context) {
    enum class State { IDLE, SEEN, READING }
    var state = State.IDLE
        set(v) { if (field != v) { field = v; invalidate() } }
    var insetTop = 0
    var insetBottom = 0
    var cardRect: RectF? = null
        private set

    private val dim = Paint().apply { color = Color.argb(140, 0, 0, 0) }
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 6f }

    override fun onDraw(canvas: Canvas) {
        val w = width.toFloat()
        val h = height.toFloat()
        val top = max(insetTop.toFloat(), h * 0.12f)
        val bottom = h - max(insetBottom.toFloat(), h * 0.2f)
        val room = bottom - top
        // A card: 63 × 88 mm
        var cw = w * 0.82f
        var ch = cw * 88f / 63f
        if (ch > room) { ch = room; cw = ch * 63f / 88f }
        val left = (w - cw) / 2
        val t = top + (room - ch) / 2
        val r = RectF(left, t, left + cw, t + ch)
        cardRect = r
        val radius = cw * 0.05f
        val path = Path().apply {
            fillType = Path.FillType.EVEN_ODD
            addRect(0f, 0f, w, h, Path.Direction.CW)
            addRoundRect(r, radius, radius, Path.Direction.CW)
        }
        canvas.drawPath(path, dim)
        line.color = when (state) {
            State.IDLE -> Color.argb(220, 255, 255, 255)
            State.SEEN -> Color.parseColor("#F2C94C")
            State.READING -> Color.parseColor("#D4A24C")
        }
        line.strokeWidth = if (state == State.IDLE) 5f else 9f
        canvas.drawRoundRect(r, radius, radius, line)
    }
}

/** Card photos for the tray and the card sheet: small, cached, off the main thread */
object ImageLoader {
    private val cache = object : LruCache<String, Bitmap>(24 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount
    }
    private val pool = Executors.newFixedThreadPool(4)
    private val main = Handler(Looper.getMainLooper())

    fun load(url: String, into: ImageView) {
        into.tag = url
        cache.get(url)?.let { into.setImageBitmap(it); return }
        pool.execute {
            val bmp = try {
                val c = URL(url).openConnection() as HttpURLConnection
                c.connectTimeout = 8000; c.readTimeout = 15000
                c.inputStream.use { BitmapFactory.decodeStream(it) }
            } catch (_: Throwable) { null } ?: return@execute
            cache.put(url, bmp)
            main.post { if (into.tag == url) into.setImageBitmap(bmp) }
        }
    }
}
