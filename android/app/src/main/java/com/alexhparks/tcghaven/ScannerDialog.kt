// The scanner screen on Android (CardScannerPlugin.open). Full screen over the page — the page
// keeps running underneath, matching each card on the site (lib/scan/scanner.ts).
//
//   1. the camera; each frame, the card's — or a graded slab's — edges are found (CardFinder,
//      OpenCV) and outlined on screen. Nothing is read until a card is actually there.
//   2. Auto: once the card has sat still (its corners and the phone's gyroscope) it's flattened and
//      its text read (ML Kit, on the phone); a card's worth of new text → captured. Once per card:
//      the next capture waits for different text (the next card) or the card leaving.
//      Manual: the shutter button captures (the found card, else the faint outline's area).
//   3. the capture: the text again, English + Japanese; a slab's label barcode (its cert); the
//      picture AI's fingerprint (a slab: of the card inside it); then "cardScanned" to the site,
//      which answers with update()
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
    private val onScanned: (String, JSONArray, List<FloatArray>?, List<String>) -> Unit,
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
    private var lastCorners: Array<android.graphics.PointF>? = null
    private var stableFrames = 0
    private val prefs = activity.getSharedPreferences("scanner", Context.MODE_PRIVATE)
    @Volatile private var autoScan = prefs.getBoolean("autoScan", true)
    private lateinit var modeButton: TextView
    private val barcodeReader = com.google.mlkit.vision.barcode.BarcodeScanning.getClient()

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
        bottom.addView(trayScroll, LinearLayout.LayoutParams(-1, dpi(158f)))
        val controls = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dpi(16f), dpi(8f), dpi(16f), 0)
        }
        val left = FrameLayout(context)
        modeButton = TextView(context).apply {
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setPadding(dpi(14f), 0, dpi(14f), 0)
            setOnClickListener { toggleMode() }
        }
        left.addView(modeButton, FrameLayout.LayoutParams(-2, dpi(36f), Gravity.START or Gravity.CENTER_VERTICAL))
        styleMode()
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
        controls.addView(left, LinearLayout.LayoutParams(0, dpi(68f), 1f))
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

    private fun styleMode() {
        modeButton.text = if (autoScan) "⚡ Auto" else "✋ Manual"
        modeButton.setTextColor(if (autoScan) Color.BLACK else Color.WHITE)
        modeButton.background = rounded(if (autoScan) gold else Color.argb(115, 0, 0, 0), dp(18f), if (autoScan) 0 else dpi(1f), Color.argb(90, 255, 255, 255))
    }

    private fun toggleMode() {
        autoScan = !autoScan
        prefs.edit().putBoolean("autoScan", autoScan).apply()
        styleMode()
        stableFrames = 0
        modeButton.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
        setHint(if (autoScan) "Auto: hold a card still to scan it" else "Manual: press the button to scan")
    }

    /** The camera frame, upright */
    private fun uprightFrame(proxy: ImageProxy): Bitmap {
        val raw = proxy.toBitmap()
        val rotation = proxy.imageInfo.rotationDegrees
        return if (rotation == 0) raw else Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, Matrix().apply { postRotate(rotation.toFloat()) }, true)
    }

    /** How the frame sits in the preview (FILL_CENTER: scaled to cover, centred) */
    private fun frameToView(frame: Bitmap): Triple<Float, Float, Float>? {
        val vw = preview.width.toFloat(); val vh = preview.height.toFloat()
        if (vw <= 0 || vh <= 0) return null
        val scale = max(vw / frame.width, vh / frame.height)
        return Triple(scale, (vw - frame.width * scale) / 2, (vh - frame.height * scale) / 2)
    }

    /** Manual mode with no card found: the area inside the faint outline (with a little margin) */
    private fun guideCrop(frame: Bitmap): Bitmap? {
        val vw = preview.width.toFloat()
        val vh = preview.height.toFloat()
        val g = guide.cardRect ?: return null
        if (vw <= 0 || vh <= 0) return null
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
        if (finished || busy || (now - lastTick < 140 && !forceCapture)) { proxy.close(); return }
        lastTick = now
        busy = true
        val frame = try { uprightFrame(proxy) } catch (e: Throwable) { null } finally { proxy.close() }
        if (frame == null) { busy = false; return }
        val found = CardFinder.find(frame)
        // Still: the card's corners barely moved since the last look (and the phone isn't turning)
        val moved = found?.let { f -> lastCorners?.let { prev -> f.corners.indices.maxOf { i -> kotlin.math.hypot((f.corners[i].x - prev[i].x).toDouble(), (f.corners[i].y - prev[i].y).toDouble()) } / frame.width } }
        stableFrames = if (found != null && moved != null && moved < 0.025) stableFrames + 1 else 0
        lastCorners = found?.corners
        val steady = System.currentTimeMillis() - lastShakeAt > 400 && stableFrames >= 3
        // Show the edges found
        val placement = frameToView(frame)
        main.post {
            guide.quad = if (found != null && placement != null) FloatArray(8) { i -> val p = found.corners[i / 2]; if (i % 2 == 0) p.x * placement.first + placement.second else p.y * placement.first + placement.third } else null
            guide.locked = steady
            guide.slab = found?.slab == true
        }
        if (found == null) {
            emptyTicks++
            if (emptyTicks >= 3) lastSignature = null // the last card left: the same card again is a second copy
        } else emptyTicks = 0

        if (forceCapture) {
            forceCapture = false
            val pic = found?.let { CardFinder.flatten(frame, it.corners) } ?: guideCrop(frame)
            if (pic == null) { busy = false; return }
            val slab = found?.slab ?: (pic.height > pic.width * 1.55)
            latin.process(InputImage.fromBitmap(pic, 0))
                .addOnSuccessListener { text -> if (text.text.isBlank()) { busy = false; main.post { setHint("No text there — closer, and out of the glare") } } else capture(pic, text, words(text), slab) }
                .addOnFailureListener { busy = false }
            return
        }
        if (!autoScan || found == null || !steady) {
            busy = false
            main.post {
                setHint(when {
                    found == null -> if (autoScan) "Hold a card up — it scans by itself" else "Manual: press the button to scan"
                    !autoScan -> "Press the button to scan"
                    else -> "Hold still…"
                })
            }
            return
        }
        val pic = CardFinder.flatten(frame, found.corners)
        if (pic == null) { busy = false; return }
        latin.process(InputImage.fromBitmap(pic, 0))
            .addOnSuccessListener { text -> onRead(pic, text, found.slab) }
            .addOnFailureListener { busy = false }
    }

    private fun words(text: Text): Set<String> =
        text.text.lowercase().split(Regex("[^a-z0-9\\u3040-\\u30ff\\u4e00-\\u9faf]+")).filter { it.length >= 3 }.toSet()

    private fun differs(a: Set<String>, b: Set<String>): Boolean {
        if (a.isEmpty() || b.isEmpty()) return true
        val shared = a.intersect(b).size.toFloat()
        return shared / a.union(b).size < 0.4f
    }

    /** Auto: a still card's text — capture it when there's a card's worth and it's a new card */
    private fun onRead(pic: Bitmap, text: Text, slab: Boolean) {
        val lines = text.textBlocks.sumOf { it.lines.size }
        val chars = text.text.count { !it.isWhitespace() }
        val sig = words(text)
        val fresh = lastSignature?.let { differs(sig, it) } ?: true
        if (lines >= 3 && chars >= 15 && fresh) return capture(pic, text, sig, slab)
        busy = false
        main.post { setHint(if (!fresh) "Got it — next card" else "Can’t read it yet — closer, or out of the glare") }
    }

    private fun capture(pic: Bitmap, latinText: Text, sig: Set<String>, slab: Boolean) {
        lastSignature = sig
        stableFrames = 0
        main.post { guide.locked = false; setHint("Reading…"); guide.performHapticFeedback(HapticFeedbackConstants.CONFIRM) }
        // Japanese too, on the captured picture only (it reads Latin as well, a little slower); a
        // slab's label barcode (its cert number)
        japanese.process(InputImage.fromBitmap(pic, 0)).addOnCompleteListener { jp ->
            val jpText = if (jp.isSuccessful) jp.result else null
            if (!slab) return@addOnCompleteListener captureThread.execute { finishCapture(pic, latinText, jpText, slab, emptyList()) }
            barcodeReader.process(InputImage.fromBitmap(pic, 0)).addOnCompleteListener { bc ->
                val codes = if (bc.isSuccessful) bc.result.mapNotNull { it.rawValue?.trim()?.takeIf { v -> v.isNotEmpty() } }.distinct().take(6) else emptyList()
                captureThread.execute { finishCapture(pic, latinText, jpText, slab, codes) }
            }
        }
    }

    private fun finishCapture(crop: Bitmap, latinText: Text, jpText: Text?, slab: Boolean, barcodes: List<String>) {
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
            // A slab: the picture AI looks at the card inside it, not the label and plastic
            val fingerprints = CardFingerprinter.fingerprints(if (slab) CardFinder.cardInsideSlab(crop) else crop)
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
                onScanned(id, lines, fingerprints, barcodes)
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
            // (the same view isn't scanned again until something different is in front of the camera)
            items.remove(item)
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
        for (item in items) tray.addView(trayCell(item), LinearLayout.LayoutParams(dpi(86f), -2).apply { rightMargin = dpi(10f) })
        refreshAdd()
    }

    /** One scanned card in the tray, like the iPhone's (CardScanner.swift TrayCell): the card's
     *  photo (the scan until the catalog photo loads) with a status badge, its name, and its finish
     *  and price; a slab's grade on top; a spinner while it's being matched */
    private fun trayCell(item: ScanItem): View {
        val o = item.current
        val cell = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            alpha = if (item.status == "none" || item.status == "error") 0.7f else 1f
        }
        val frame = FrameLayout(context)
        val img = ImageView(context).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            setImageBitmap(item.thumbnail)
            background = rounded(Color.argb(20, 255, 255, 255), dp(5f))
            clipToOutline = true
        }
        o?.imageUrl?.takeIf { it.isNotEmpty() }?.let { url -> ImageLoader.load(url, img) }
        frame.addView(img, FrameLayout.LayoutParams(-1, -1))
        // A graded slab: its company and grade across the top
        item.slab?.takeIf { it.grade.isNotEmpty() }?.let { slab ->
            frame.addView(TextView(context).apply {
                text = "${slab.company} ${slab.grade}"
                textSize = 10f
                typeface = Typeface.DEFAULT_BOLD
                gravity = Gravity.CENTER
                setTextColor(Color.parseColor("#1A1A1A"))
                background = rounded(Color.WHITE, dp(3f), dpi(1f), Color.parseColor("#C8102E"))
                setPadding(dpi(4f), dpi(1f), dpi(4f), dpi(1f))
            }, FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply { topMargin = dpi(4f) })
        }
        if (item.status == "matching") {
            frame.addView(android.widget.ProgressBar(context).apply {
                indeterminateTintList = android.content.res.ColorStateList.valueOf(Color.WHITE)
            }, FrameLayout.LayoutParams(dpi(26f), dpi(26f), Gravity.CENTER))
        }
        val badge = when (item.status) {
            "matched" -> Triple("✓", gold, Color.BLACK)
            "pick" -> Triple("?", Color.parseColor("#FFCC00"), Color.BLACK)
            "none", "error" -> Triple("!", Color.parseColor("#FF3B30"), Color.WHITE)
            else -> null
        }
        badge?.let { (t, bg, fg) ->
            frame.addView(TextView(context).apply {
                text = t
                textSize = 13f
                typeface = Typeface.DEFAULT_BOLD
                gravity = Gravity.CENTER
                setTextColor(fg)
                background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(bg) }
            }, FrameLayout.LayoutParams(dpi(22f), dpi(22f), Gravity.BOTTOM or Gravity.END).apply { rightMargin = dpi(4f); bottomMargin = dpi(4f) })
        }
        cell.addView(frame, LinearLayout.LayoutParams(dpi(86f), dpi(86f * 88f / 63f)))
        cell.addView(TextView(context).apply {
            text = o?.title ?: if (item.status == "matching") "Matching…" else "Not found"
            setTextColor(Color.WHITE)
            textSize = 11f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
        }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dpi(3f) })
        // The finish with its own price, when the card comes in more than one
        val p = item.currentPrinting
        val priceLine = if (p != null && (o?.printings?.size ?: 0) > 1) listOf(p.label, p.price).filter { it.isNotEmpty() }.joinToString(" · ") else o?.price ?: ""
        cell.addView(TextView(context).apply {
            text = priceLine
            setTextColor(Color.rgb(217, 179, 89))
            textSize = 11f
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
        }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dpi(1f) })
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

    // ── The card sheet — laid out like the iPhone's (CardScanner.swift CardSheetController):
    //    the card big (Card / Your scan), what it is, Finish, Condition, other matches (a sideways
    //    strip, the current one outlined), Grading (company, grade, cert), search, Done / Remove ──

    private inner class CardSheet(val item: ScanItem) : Dialog(activity, android.R.style.Theme_Black_NoTitleBar) {
        private val body = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setPadding(0, dpi(16f), 0, dpi(24f)) }
        private val pad = dpi(20f)
        private var showScan = false
        private var results: List<TrayOption> = emptyList()
        private var searching = false
        private var searchNote: String? = null
        private var lastQuery = ""
        private val companies = listOf("Raw", "PSA", "CGC", "BGS", "SGC", "TAG")

        override fun onCreate(savedInstanceState: Bundle?) {
            super.onCreate(savedInstanceState)
            window?.setLayout(-1, -1)
            window?.statusBarColor = sheetBg
            window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
            window?.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.TRANSPARENT))
            val scroll = ScrollView(context).apply { addView(body); isVerticalScrollBarEnabled = false }
            // The top bar: a grab handle to swipe the sheet down, and ✕ — like an iPhone sheet
            val header = FrameLayout(context).apply { setPadding(0, dpi(8f), 0, dpi(4f)) }
            header.addView(View(context).apply { background = rounded(Color.argb(90, 255, 255, 255), dp(3f)) },
                FrameLayout.LayoutParams(dpi(40f), dpi(5f), Gravity.TOP or Gravity.CENTER_HORIZONTAL))
            header.addView(TextView(context).apply {
                text = "✕"
                gravity = Gravity.CENTER
                textSize = 16f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(ink)
                background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.argb(40, 255, 255, 255)) }
                contentDescription = "Close"
                setOnClickListener { close() }
            }, FrameLayout.LayoutParams(dpi(32f), dpi(32f), Gravity.END or Gravity.CENTER_VERTICAL).apply { rightMargin = dpi(14f); topMargin = dpi(6f) })
            val panel = SwipeDownLayout(context, scroll) { close() }.apply {
                orientation = LinearLayout.VERTICAL
                background = GradientDrawable().apply {
                    setColor(sheetBg)
                    cornerRadii = floatArrayOf(dp(16f), dp(16f), dp(16f), dp(16f), 0f, 0f, 0f, 0f)
                }
                addView(header, LinearLayout.LayoutParams(-1, dpi(48f)))
                addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
            }
            val root = FrameLayout(context).apply { setBackgroundColor(Color.argb(150, 0, 0, 0)) }
            root.addView(panel, FrameLayout.LayoutParams(-1, -1))
            ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
                val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
                (panel.layoutParams as FrameLayout.LayoutParams).topMargin = bars.top + dpi(10f)
                scroll.setPadding(0, 0, 0, bars.bottom)
                panel.requestLayout(); insets
            }
            setContentView(root)
            setOnDismissListener { if (sheet === this) sheet = null }
            // Slides up as it opens
            panel.translationY = context.resources.displayMetrics.heightPixels.toFloat()
            panel.animate().translationY(0f).setDuration(260).setInterpolator(android.view.animation.DecelerateInterpolator()).start()
            sheetPanel = panel
            refresh()
        }

        private var sheetPanel: View? = null

        /** Slides the sheet away, then closes it (✕, a swipe down, the Back button) */
        fun close() {
            val panel = sheetPanel ?: return dismiss()
            panel.animate().translationY(panel.height.toFloat().coerceAtLeast(1f)).setDuration(200)
                .withEndAction { dismiss() }.start()
        }

        @Deprecated("Back slides the sheet away")
        override fun onBackPressed() { close() }

        private fun padded(v: View, top: Int = 0, into: LinearLayout = body): View = v.also {
            into.addView(it, LinearLayout.LayoutParams(-1, -2).apply { leftMargin = pad; rightMargin = pad; topMargin = top })
        }

        private fun section(label: String, into: LinearLayout = body) {
            padded(into = into, top = dpi(22f), v = TextView(context).apply {
                text = label.uppercase()
                setTextColor(muted)
                textSize = 12f
                letterSpacing = 0.04f
                typeface = Typeface.DEFAULT_BOLD
            })
        }

        private fun box() = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }

        /** A segmented row of choices, like the iPhone's segmented controls */
        private fun segmented(labels: List<String>, selected: Int, onPick: (Int) -> Unit): View {
            val row = LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                background = rounded(Color.argb(30, 255, 255, 255), dp(9f))
                setPadding(dpi(2f), dpi(2f), dpi(2f), dpi(2f))
            }
            labels.forEachIndexed { i, label ->
                row.addView(TextView(context).apply {
                    text = label
                    gravity = Gravity.CENTER
                    textSize = 13f
                    typeface = if (i == selected) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
                    setTextColor(if (i == selected) Color.BLACK else ink)
                    background = if (i == selected) rounded(gold, dp(7f)) else null
                    setOnClickListener { if (i != selected) { onPick(i); performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY) } }
                }, LinearLayout.LayoutParams(0, dpi(34f), 1f))
            }
            return row
        }

        private fun field(hintText: String, value: String, numeric: Boolean, onChange: (String) -> Unit) = EditText(context).apply {
            hint = hintText
            setText(value)
            setHintTextColor(muted)
            setTextColor(ink)
            textSize = 16f
            typeface = Typeface.DEFAULT_BOLD
            inputType = if (numeric) InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL else InputType.TYPE_CLASS_TEXT
            setSingleLine()
            background = rounded(Color.argb(18, 255, 255, 255), dp(10f))
            setPadding(dpi(12f), 0, dpi(12f), 0)
            addTextChangedListener(object : android.text.TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun afterTextChanged(s: android.text.Editable?) { onChange(s?.toString() ?: "") }
            })
        }

        /** A sideways strip of cards (other matches, search results) — the iPhone's option strip */
        private fun strip(options: List<TrayOption>, selectedKey: String?, into: LinearLayout = body, onTap: (TrayOption) -> Unit): View {
            val scroll = HorizontalScrollView(context).apply { isHorizontalScrollBarEnabled = false; clipToPadding = false; setPadding(pad, 0, pad, 0) }
            val row = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
            for (o in options) {
                val col = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setOnClickListener { onTap(o) } }
                val img = ImageView(context).apply {
                    scaleType = ImageView.ScaleType.CENTER_CROP
                    clipToOutline = true
                    val on = o.key == selectedKey && o.key.isNotEmpty()
                    background = rounded(Color.argb(15, 255, 255, 255), dp(7f), if (on) dpi(3f) else 0, gold)
                    if (on) setPadding(dpi(3f), dpi(3f), dpi(3f), dpi(3f))
                }
                if (o.imageUrl.isNotEmpty()) ImageLoader.load(o.imageUrl, img)
                col.addView(img, LinearLayout.LayoutParams(dpi(104f), dpi(104f * 88f / 63f)))
                col.addView(TextView(context).apply { text = o.title; setTextColor(ink); textSize = 12f; typeface = Typeface.DEFAULT_BOLD; maxLines = 2; ellipsize = android.text.TextUtils.TruncateAt.END }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dpi(6f) })
                col.addView(TextView(context).apply { text = o.subtitle; setTextColor(muted); textSize = 11f; maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dpi(2f) })
                if (o.price.isNotEmpty()) col.addView(TextView(context).apply { text = o.price; setTextColor(gold); textSize = 12f; typeface = Typeface.DEFAULT_BOLD }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dpi(2f) })
                row.addView(col, LinearLayout.LayoutParams(dpi(104f), -2).apply { rightMargin = dpi(12f) })
            }
            scroll.addView(row)
            into.addView(scroll, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dpi(10f) })
            return scroll
        }

        // Each part of the sheet draws itself, so a tap redraws only what it changes (picking PSA
        // mustn't reload the other matches' photos)
        private val imageBox = box()
        private val infoBox = box()
        private val finishBox = box()
        private val conditionBox = box()
        private val matchesBox = box()
        private val gradingBox = box()
        private val searchBox = box()
        private val resultsBox = box()

        /** Everything — on opening, and when the card itself changes */
        fun refresh() {
            if (body.childCount == 0) {
                for (b in listOf(imageBox, infoBox, finishBox, conditionBox, matchesBox, gradingBox, searchBox, resultsBox)) body.addView(b, LinearLayout.LayoutParams(-1, -2))
                drawSearch()
                drawButtons()
            }
            drawImage(); drawInfo(); drawFinish(); drawCondition(); drawMatches(); drawGrading(); drawResults()
        }

        private fun drawImage() {
            imageBox.removeAllViews()
            val o = item.current
            val host = FrameLayout(context)
            val img = ImageView(context).apply {
                scaleType = ImageView.ScaleType.FIT_CENTER
                clipToOutline = true
                background = rounded(Color.TRANSPARENT, dp(12f))
            }
            if (!showScan && o != null && o.imageUrl.isNotEmpty()) { img.setImageBitmap(item.photo); ImageLoader.load(o.imageUrl, img) } else img.setImageBitmap(item.photo)
            host.addView(img, FrameLayout.LayoutParams(-1, -1))
            item.slab?.takeIf { it.grade.isNotEmpty() }?.let { slab ->
                host.addView(TextView(context).apply {
                    text = "${slab.company} ${slab.grade}"
                    textSize = 14f
                    typeface = Typeface.DEFAULT_BOLD
                    setTextColor(Color.parseColor("#1A1A1A"))
                    background = rounded(Color.WHITE, dp(5f), dpi(2f), Color.parseColor("#C8102E"))
                    setPadding(dpi(10f), dpi(3f), dpi(10f), dpi(3f))
                }, FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply { topMargin = dpi(6f) })
            }
            val screenW = context.resources.displayMetrics.widthPixels
            val cardW = (screenW * 0.62f).toInt()
            imageBox.addView(host, LinearLayout.LayoutParams(cardW, (cardW * 88f / 63f).toInt()).apply { gravity = Gravity.CENTER_HORIZONTAL; topMargin = dpi(4f) })
            imageBox.addView(segmented(listOf("Card", "Your scan"), if (showScan) 1 else 0) { showScan = it == 1; drawImage() },
                LinearLayout.LayoutParams(dpi(210f), -2).apply { gravity = Gravity.CENTER_HORIZONTAL; topMargin = dpi(12f) })
        }

        private fun drawInfo() {
            infoBox.removeAllViews()
            val o = item.current
            padded(into = infoBox, top = dpi(18f), v = LinearLayout(context).apply { addView(TextView(context).apply {
                text = when (item.status) {
                    "matched" -> if (item.confirmed) "✓ You picked this" else "✓ Matched"
                    "pick" -> "? Not sure — check the other matches"
                    "matching" -> "Matching…"
                    else -> "! Not found — search below"
                }
                setTextColor(if (item.status == "matched" || item.status == "pick") Color.BLACK else if (item.status == "matching") ink else Color.WHITE)
                textSize = 12f
                typeface = Typeface.DEFAULT_BOLD
                setPadding(dpi(10f), dpi(4f), dpi(10f), dpi(4f))
                background = rounded(when (item.status) { "matched" -> gold; "pick" -> Color.parseColor("#FFCC00"); "matching" -> Color.argb(38, 255, 255, 255); else -> Color.parseColor("#FF3B30") }, dp(11f))
            }) })
            padded(into = infoBox, top = dpi(10f), v = TextView(context).apply { text = o?.title ?: "Not found"; setTextColor(ink); textSize = 24f; typeface = Typeface.DEFAULT_BOLD; maxLines = 2 })
            if (o == null) return
            padded(into = infoBox, top = dpi(2f), v = TextView(context).apply { text = o.subtitle; setTextColor(muted); textSize = 15f; maxLines = 2 })
            val p = item.currentPrinting
            val price = if (p != null && o.printings.size > 1 && p.price.isNotEmpty()) "${p.price} · ${p.label}" else o.price
            if (price.isNotEmpty()) padded(into = infoBox, top = dpi(8f), v = TextView(context).apply { text = price; setTextColor(gold); textSize = 20f; typeface = Typeface.DEFAULT_BOLD })
        }

        // Finish: every printing, with its price
        private fun drawFinish() {
            finishBox.removeAllViews()
            val o = item.current ?: return
            if (o.printings.size < 2) return
            section("Finish", finishBox)
            val picked = item.printing ?: o.printings.first().key
            val scroll = HorizontalScrollView(context).apply { isHorizontalScrollBarEnabled = false; clipToPadding = false; setPadding(pad, 0, pad, 0) }
            val row = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
            for (pr in o.printings) {
                val on = pr.key == picked
                row.addView(TextView(context).apply {
                    text = if (pr.price.isEmpty()) pr.label else "${pr.label}\n${pr.price}"
                    gravity = Gravity.CENTER
                    textSize = 14f
                    typeface = Typeface.DEFAULT_BOLD
                    setTextColor(if (on) Color.BLACK else ink)
                    background = rounded(if (on) gold else Color.argb(20, 255, 255, 255), dp(14f))
                    setPadding(dpi(14f), dpi(6f), dpi(14f), dpi(6f))
                    setOnClickListener { item.printing = pr.key; redrawTray(); drawFinish(); drawInfo() }
                }, LinearLayout.LayoutParams(-2, dpi(54f)).apply { rightMargin = dpi(8f) })
            }
            scroll.addView(row)
            finishBox.addView(scroll, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dpi(10f) })
        }

        // Condition (a graded card has its grade instead)
        private fun drawCondition() {
            conditionBox.removeAllViews()
            if (item.slab != null) return
            section("Condition", conditionBox)
            val keys = listOf("near_mint", "lightly_played", "moderately_played", "heavily_played")
            val current = keys.indexOf(item.condition ?: "near_mint").coerceAtLeast(0)
            padded(into = conditionBox, top = dpi(10f), v = segmented(listOf("NM", "LP", "MP", "HP"), current) { i -> item.condition = if (i == 0) null else keys[i]; drawCondition() })
        }

        // Other matches — a sideways strip, the current one outlined
        private fun drawMatches() {
            matchesBox.removeAllViews()
            if (item.options.size < 2) return
            section("Other matches — tap to switch", matchesBox)
            strip(item.options, item.current?.key, matchesBox) { choose(it) }
        }

        // Grading — what was read off the label, or set by hand (a raw card can be marked graded too)
        private fun drawGrading() {
            gradingBox.removeAllViews()
            section("Grading", gradingBox)
            val slab = item.slab
            val company = companies.indexOf(slab?.company?.uppercase() ?: "Raw").let { if (it < 0) 0 else it }
            padded(into = gradingBox, top = dpi(10f), v = segmented(companies, company) { i ->
                val wasGraded = item.slab != null
                item.slab = if (i == 0) null else SlabGrade(companies[i], item.slab?.grade ?: "", item.slab?.cert ?: "")
                redrawTray()
                drawGrading()
                drawImage()
                if (wasGraded != (item.slab != null)) drawCondition()
            })
            if (slab == null) return
            val fields = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
            fields.addView(field("Grade (e.g. 10, 9.5)", slab.grade, true) { g ->
                item.slab = item.slab?.copy(grade = g.trim()); redrawTray(); drawImage()
            }, LinearLayout.LayoutParams(0, dpi(46f), 0.42f).apply { rightMargin = dpi(10f) })
            fields.addView(field("Cert number", slab.cert, true) { c ->
                item.slab = item.slab?.copy(cert = c.replace(Regex("[^0-9A-Za-z]"), ""))
            }, LinearLayout.LayoutParams(0, dpi(46f), 0.58f))
            padded(into = gradingBox, top = dpi(10f), v = fields)
            if (slab.cert.isNotEmpty()) padded(into = gradingBox, top = dpi(6f), v = TextView(context).apply { text = "Cert read from the label — check it matches the slab"; setTextColor(muted); textSize = 12f })
        }

        // Not right? Find the card (drawn once — typing must keep its field)
        private fun drawSearch() {
            section("Not right? Find the card", searchBox)
            val search = field("Card name, or name and number", lastQuery, false) { lastQuery = it }.apply {
                imeOptions = EditorInfo.IME_ACTION_SEARCH
                setOnEditorActionListener { v, _, _ -> search(v.text.toString()); true }
            }
            searchBox.addView(search, LinearLayout.LayoutParams(-1, dpi(46f)).apply { leftMargin = pad; rightMargin = pad; topMargin = dpi(10f) })
        }

        private fun drawResults() {
            resultsBox.removeAllViews()
            val note = if (searching) "Searching…" else searchNote
            if (note != null) padded(into = resultsBox, top = dpi(10f), v = TextView(context).apply { text = note; setTextColor(muted); textSize = 13f; gravity = Gravity.CENTER })
            if (results.isNotEmpty()) strip(results, item.current?.key, resultsBox) { choose(it) }
        }

        // Done / Remove (drawn once)
        private fun drawButtons() {
            body.addView(TextView(context).apply {
                text = "Done"
                gravity = Gravity.CENTER
                textSize = 17f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Color.BLACK)
                background = rounded(gold, dp(14f))
                setOnClickListener { close() }
            }, LinearLayout.LayoutParams(-1, dpi(52f)).apply { leftMargin = pad; rightMargin = pad; topMargin = dpi(28f) })
            body.addView(TextView(context).apply {
                text = "Remove from this scan"
                gravity = Gravity.CENTER
                textSize = 15f
                setTextColor(Color.parseColor("#FF3B30"))
                setPadding(0, dpi(14f), 0, dpi(8f))
                setOnClickListener {
                    items.remove(item)
                    redrawTray()
                    dismiss()
                }
            }, LinearLayout.LayoutParams(-1, -2).apply { leftMargin = pad; rightMargin = pad; topMargin = dpi(4f) })
        }

        private fun choose(o: TrayOption) {
            val i = item.options.indexOfFirst { it.key == o.key && o.key.isNotEmpty() }
            if (i >= 0) item.choice = i else { item.options = listOf(o) + item.options; item.choice = 0 }
            item.status = "matched"
            item.confirmed = true
            item.printing = null
            showScan = false
            performHapticFeedback()
            redrawTray()
            refresh()
        }

        private fun performHapticFeedback() { body.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY) }

        private fun search(q: String) {
            val query = q.trim()
            if (query.isEmpty()) return
            lastQuery = query
            val requestId = UUID.randomUUID().toString()
            searching = true
            searchNote = null
            results = emptyList()
            drawResults()
            searchWaiting[requestId] = { found ->
                searching = false
                results = found
                searchNote = if (found.isEmpty()) "No cards found for “$query”" else null
                if (isShowing) drawResults()
            }
            onSearch(requestId, query)
        }
    }
}

/** A sheet that follows the finger down and closes when pulled far enough (or flicked) — from
 *  anywhere on it while its scroll view is at the top, like an iPhone sheet */
@SuppressLint("ViewConstructor", "ClickableViewAccessibility")
class SwipeDownLayout(context: Context, private val scroll: ScrollView, private val onClose: () -> Unit) : LinearLayout(context) {
    private val slop = android.view.ViewConfiguration.get(context).scaledTouchSlop
    private var startY = 0f
    private var startX = 0f
    private var dragging = false
    private var tracker: android.view.VelocityTracker? = null

    override fun onInterceptTouchEvent(e: android.view.MotionEvent): Boolean {
        when (e.actionMasked) {
            android.view.MotionEvent.ACTION_DOWN -> { startY = e.rawY; startX = e.rawX; dragging = false }
            android.view.MotionEvent.ACTION_MOVE -> {
                val dy = e.rawY - startY
                val dx = kotlin.math.abs(e.rawX - startX)
                // Downwards, mostly vertical, and nothing above to scroll back to
                if (dy > slop && dy > dx * 1.5f && !scroll.canScrollVertically(-1)) {
                    dragging = true
                    tracker = android.view.VelocityTracker.obtain()
                    return true
                }
            }
        }
        return false
    }

    override fun onTouchEvent(e: android.view.MotionEvent): Boolean {
        if (!dragging) return e.actionMasked == android.view.MotionEvent.ACTION_DOWN
        tracker?.addMovement(e)
        val dy = (e.rawY - startY).coerceAtLeast(0f)
        when (e.actionMasked) {
            android.view.MotionEvent.ACTION_MOVE -> translationY = dy
            android.view.MotionEvent.ACTION_UP, android.view.MotionEvent.ACTION_CANCEL -> {
                tracker?.computeCurrentVelocity(1000)
                val fling = (tracker?.yVelocity ?: 0f) > 1400f
                tracker?.recycle(); tracker = null
                dragging = false
                if (dy > height * 0.22f || fling) onClose()
                else animate().translationY(0f).setDuration(180).start()
            }
        }
        return true
    }
}

/** The card's edges as found (gold once it's still enough to read), over a faint card-shaped
 *  outline that shows where to hold it; the rest of the picture dimmed */
@SuppressLint("ViewConstructor")
class GuideOverlay(context: Context) : View(context) {
    enum class State { IDLE, SEEN, READING }
    var state = State.IDLE
        set(v) { if (field != v) { field = v; invalidate() } }
    /** The found card's corners in view pixels (x0, y0 … x3, y3: top-left, top-right, bottom-right, bottom-left) */
    var quad: FloatArray? = null
        set(v) { field = v; invalidate() }
    var locked = false
        set(v) { if (field != v) { field = v; invalidate() } }
    var slab = false
    var insetTop = 0
    var insetBottom = 0
    var cardRect: RectF? = null
        private set

    private val dim = Paint().apply { color = Color.argb(110, 0, 0, 0) }
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeJoin = Paint.Join.ROUND }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }

    override fun onDraw(canvas: Canvas) {
        val w = width.toFloat()
        val h = height.toFloat()
        val top = max(insetTop.toFloat(), h * 0.12f)
        val bottom = h - max(insetBottom.toFloat(), h * 0.2f)
        val room = bottom - top
        // Where to hold a card: 63 × 88 mm
        var cw = w * 0.82f
        var ch = cw * 88f / 63f
        if (ch > room) { ch = room; cw = ch * 63f / 88f }
        val left = (w - cw) / 2
        val t = top + (room - ch) / 2
        val r = RectF(left, t, left + cw, t + ch)
        cardRect = r
        val radius = cw * 0.05f
        val q = quad
        if (q == null) {
            // No card yet: dim around the outline
            val path = Path().apply {
                fillType = Path.FillType.EVEN_ODD
                addRect(0f, 0f, w, h, Path.Direction.CW)
                addRoundRect(r, radius, radius, Path.Direction.CW)
            }
            canvas.drawPath(path, dim)
            line.color = Color.argb(200, 255, 255, 255)
            line.strokeWidth = 5f
            canvas.drawRoundRect(r, radius, radius, line)
            return
        }
        // The card (or slab) found: its own edges
        val edge = Path().apply {
            moveTo(q[0], q[1]); lineTo(q[2], q[3]); lineTo(q[4], q[5]); lineTo(q[6], q[7]); close()
        }
        val goldColor = Color.parseColor("#D4A24C")
        fill.color = if (locked) Color.argb(60, 212, 162, 76) else Color.argb(28, 255, 255, 255)
        canvas.drawPath(edge, fill)
        line.color = if (locked) goldColor else Color.argb(235, 255, 255, 255)
        line.strokeWidth = if (locked) 10f else 6f
        canvas.drawPath(edge, line)
        // Corner marks
        fill.color = line.color
        for (i in 0 until 4) canvas.drawCircle(q[i * 2], q[i * 2 + 1], if (locked) 11f else 8f, fill)
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
