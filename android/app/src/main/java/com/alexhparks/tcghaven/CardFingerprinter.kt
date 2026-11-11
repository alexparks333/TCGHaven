// The picture AI on Android (docs/scanner-ai.md): the same trained model as the iPhone's, as ONNX,
// run with ONNX Runtime. Not in the app: the site names the version (prepareModel), it's
// downloaded once and kept in the app's files, so a retrained model needs no app update. Until
// it's ready, scans go without a fingerprint and the text decides, as before.
//
// Input: the flattened card squashed to 224 × 308 (never cropped — how the catalog photos were
// fingerprinted), RGB 0–255, channels first. Output: 384 numbers, unit length.

package com.alexhparks.tcghaven

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.nio.FloatBuffer
import java.util.concurrent.Executors

object CardFingerprinter {
    private const val TAG = "CardFingerprinter"
    private const val W = 224
    private const val H = 308
    private const val DIM = 384

    private val work = Executors.newSingleThreadExecutor()
    private val lock = Any()
    private var env: OrtEnvironment? = null
    private var session: OrtSession? = null
    private var version: String? = null
    @Volatile private var busy = false

    val isReady: Boolean get() = synchronized(lock) { session != null }

    fun prepare(context: Context, version: String, files: Map<String, String>, done: (Boolean) -> Unit) {
        val main = Handler(Looper.getMainLooper())
        synchronized(lock) {
            if (this.version == version && session != null) { main.post { done(true) }; return }
            if (busy) { main.post { done(false) }; return }
            busy = true
        }
        work.execute {
            val ok = try { load(context, version, files) } catch (e: Throwable) { Log.w(TAG, "model not ready", e); false }
            busy = false
            main.post { done(ok) }
        }
    }

    private fun load(context: Context, version: String, files: Map<String, String>): Boolean {
        val url = files["model.onnx"] ?: return false
        val safe = version.replace(Regex("[^A-Za-z0-9._-]"), "_")
        val dir = File(context.filesDir, "CardFingerprint").apply { mkdirs() }
        val model = File(dir, "$safe.onnx")
        if (!model.exists()) {
            val t0 = System.currentTimeMillis()
            val tmp = File(dir, "$safe.download")
            val conn = URL(url).openConnection() as HttpURLConnection
            conn.connectTimeout = 15000
            conn.readTimeout = 60000
            try {
                if (conn.responseCode != 200) return false
                conn.inputStream.use { input -> tmp.outputStream().use { input.copyTo(it, 1 shl 16) } }
            } finally { conn.disconnect() }
            if (!tmp.renameTo(model)) return false
            Log.i(TAG, "picture AI $version downloaded in ${System.currentTimeMillis() - t0} ms")
        }
        val e = OrtEnvironment.getEnvironment()
        val opts = OrtSession.SessionOptions().apply {
            setIntraOpNumThreads(4)
            setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
        }
        val s = try { e.createSession(model.absolutePath, opts) } catch (t: Throwable) { model.delete(); throw t }
        synchronized(lock) { session?.close(); env = e; session = s; this.version = version }
        // Older versions' files
        dir.listFiles()?.forEach { if (it.name != model.name) it.delete() }
        // The first run sets things up (slow once) — now, not on a scan
        run(Bitmap.createBitmap(W, H, Bitmap.Config.ARGB_8888))
        Log.i(TAG, "picture AI $version ready")
        return true
    }

    private fun run(image: Bitmap): FloatArray? {
        val (e, s) = synchronized(lock) { Pair(env, session) }
        if (e == null || s == null) return null
        val small = Bitmap.createScaledBitmap(image, W, H, true)
        val px = IntArray(W * H)
        small.getPixels(px, 0, W, 0, 0, W, H)
        val buf = FloatBuffer.allocate(3 * W * H)
        val plane = W * H
        for (i in 0 until plane) {
            val c = px[i]
            buf.put(i, ((c shr 16) and 0xff).toFloat())
            buf.put(plane + i, ((c shr 8) and 0xff).toFloat())
            buf.put(2 * plane + i, (c and 0xff).toFloat())
        }
        OnnxTensor.createTensor(e, buf, longArrayOf(1, 3, H.toLong(), W.toLong())).use { input ->
            s.run(mapOf("image" to input)).use { out ->
                @Suppress("UNCHECKED_CAST")
                val v = (out[0].value as Array<FloatArray>)[0]
                return if (v.size == DIM) v else null
            }
        }
    }

    private fun turned(image: Bitmap, degrees: Float): Bitmap =
        Bitmap.createBitmap(image, 0, 0, image.width, image.height, Matrix().apply { postRotate(degrees) }, true)

    /** The scan's fingerprint(s): one for a portrait card; a landscape card as it is and turned
     *  each way, since its catalog photo may be stored either way. Null until the model is ready. */
    fun fingerprints(image: Bitmap): List<FloatArray>? {
        if (!isReady) return null
        val pictures = mutableListOf(image)
        if (image.width > image.height * 1.1) {
            pictures += turned(image, -90f)
            pictures += turned(image, 90f)
        }
        val out = pictures.mapNotNull { p -> runCatching { run(p) }.onFailure { Log.w(TAG, "fingerprint failed", it) }.getOrNull() }
        return out.ifEmpty { null }
    }
}
