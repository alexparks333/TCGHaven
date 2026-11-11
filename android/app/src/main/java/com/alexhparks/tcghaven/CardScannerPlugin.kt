// The TCGHaven card scanner — Android's native half. The site's side (lib/scan/scanner.ts) talks to
// it exactly as it talks to the iPhone's (ios/App/App/CardScanner.swift): the same plugin name,
// methods and events, so matching, deciding and saving are shared. Plan: docs/android-app.md;
// design: docs/card-scanner.md, docs/scanner-ai.md.
//
//   open({ title })                  → the scanner screen; resolves { items } when the person taps
//                                       Add (their picks) or closes it (none)
//   update({ scanId, status, options, choice, note, slab })  the site's answer for a scanned card
//   searchResults({ requestId, options })                    answers a "searchCards" event
//   compare({ scanId, imageUrls })   → { distances } — no tile comparison on Android: all null,
//                                       the picture AI's similarity decides instead
//   prepareModel({ version, files }) → { ready } — downloads the picture AI (ONNX) once per version
//   events: cardScanned { scanId, lines, fingerprints? }, searchCards { requestId, query }
//
// No photo leaves the phone: only the text that was read and the AI's 384-number fingerprint.

package com.alexhparks.tcghaven

import android.Manifest
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONArray
import org.json.JSONObject

@CapacitorPlugin(
    name = "CardScanner",
    permissions = [Permission(strings = [Manifest.permission.CAMERA], alias = "camera")],
)
class CardScannerPlugin : Plugin() {
    private var scanner: ScannerDialog? = null

    @PluginMethod
    fun open(call: PluginCall) {
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            requestPermissionForAlias("camera", call, "cameraPermission")
            return
        }
        show(call)
    }

    @PermissionCallback
    private fun cameraPermission(call: PluginCall) {
        if (getPermissionState("camera") == PermissionState.GRANTED) show(call)
        else call.reject("Camera access is off — turn it on for TCGHaven in Settings → Apps → TCGHaven → Permissions")
    }

    private fun show(call: PluginCall) {
        val activity = activity ?: return call.reject("No screen to show the scanner on")
        activity.runOnUiThread {
            if (scanner != null) return@runOnUiThread call.reject("The scanner is already open")
            val dialog = ScannerDialog(
                activity = activity,
                title = call.getString("title") ?: "Scan cards",
                onScanned = { scanId, lines, fingerprints ->
                    val data = JSObject()
                    data.put("scanId", scanId)
                    data.put("lines", lines)
                    if (!fingerprints.isNullOrEmpty()) {
                        val fps = JSONArray()
                        for (fp in fingerprints) fps.put(JSONArray().apply { for (v in fp) put(v.toDouble()) })
                        data.put("fingerprints", fps)
                    }
                    notifyListeners("cardScanned", data)
                },
                onSearch = { requestId, query ->
                    val data = JSObject()
                    data.put("requestId", requestId)
                    data.put("query", query)
                    notifyListeners("searchCards", data)
                },
                onFinish = { items ->
                    scanner = null
                    val res = JSObject()
                    res.put("items", items)
                    call.resolve(res)
                },
            )
            scanner = dialog
            dialog.show()
        }
    }

    @PluginMethod
    fun update(call: PluginCall) {
        val scanId = call.getString("scanId") ?: return call.resolve()
        val status = call.getString("status") ?: "none"
        val options = TrayOption.list(call.getArray("options"))
        val choice = call.getInt("choice") ?: 0
        val note = call.getString("note")
        val slab = call.getObject("slab")?.let { SlabGrade.from(it) }
        activity?.runOnUiThread { scanner?.update(scanId, status, options, choice, note, slab) }
        call.resolve()
    }

    @PluginMethod
    fun searchResults(call: PluginCall) {
        val requestId = call.getString("requestId") ?: return call.resolve()
        val options = TrayOption.list(call.getArray("options"))
        activity?.runOnUiThread { scanner?.deliverSearch(requestId, options) }
        call.resolve()
    }

    @PluginMethod
    fun compare(call: PluginCall) {
        val n = call.getArray("imageUrls")?.length() ?: 0
        val out = JSArray()
        repeat(n) { out.put(JSONObject.NULL) }
        call.resolve(JSObject().put("distances", out))
    }

    @PluginMethod
    fun prepareModel(call: PluginCall) {
        val version = call.getString("version")
        val files = call.getObject("files")
        if (version.isNullOrEmpty() || files == null) return call.resolve(JSObject().put("ready", false))
        val map = HashMap<String, String>()
        for (k in files.keys()) map[k] = files.getString(k) ?: continue
        CardFingerprinter.prepare(context, version, map) { ready -> call.resolve(JSObject().put("ready", ready)) }
    }
}

