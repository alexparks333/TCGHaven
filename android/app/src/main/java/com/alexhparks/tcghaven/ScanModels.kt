// What the scanner holds for each scanned card, and the site's options for it — the same shapes
// as the iPhone's (CardScanner.swift TrayOption / ScanItem) and lib/scan/scanner.ts TrayOption.

package com.alexhparks.tcghaven

import android.graphics.Bitmap
import org.json.JSONArray
import org.json.JSONObject

data class Printing(val key: String, val label: String, val price: String)

data class TrayOption(
    val key: String,
    val title: String,
    val subtitle: String,
    val price: String,
    val imageUrl: String,
    val detail: String,
    val printings: List<Printing>,
) {
    companion object {
        fun from(o: JSONObject): TrayOption {
            val ps = o.optJSONArray("printings") ?: JSONArray()
            return TrayOption(
                key = o.optString("key"),
                title = o.optString("title"),
                subtitle = o.optString("subtitle"),
                price = o.optString("price"),
                imageUrl = o.optString("imageUrl"),
                detail = o.optString("detail"),
                printings = (0 until ps.length()).mapNotNull { i ->
                    ps.optJSONObject(i)?.let { Printing(it.optString("key"), it.optString("label"), it.optString("price")) }
                },
            )
        }

        fun list(a: JSONArray?): List<TrayOption> =
            if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONObject(it)?.let(::from) }
    }
}

/** A graded slab: company, grade and cert read off its label */
data class SlabGrade(val company: String, val grade: String, val cert: String) {
    fun toJson(): JSONObject = JSONObject().put("company", company).put("grade", grade).put("cert", cert)

    companion object {
        fun from(o: JSONObject): SlabGrade? {
            val company = o.optString("company")
            val grade = o.optString("grade")
            return if (company.isEmpty() && grade.isEmpty()) null else SlabGrade(company, grade, o.optString("cert"))
        }
    }
}

class ScanItem(val id: String, val thumbnail: Bitmap, val photo: Bitmap) {
    var status = "matching"          // matching | matched | pick | none | error
    var options: List<TrayOption> = emptyList()
    var choice = 0
    var confirmed = false            // picked by the person in the card sheet
    var printing: String? = null     // the finish picked in the card sheet
    var condition: String? = null    // near_mint (default) / lightly_played / moderately_played / heavily_played
    var slab: SlabGrade? = null
    var note: String? = null

    val current: TrayOption? get() = options.getOrNull(choice)
    val currentPrinting: Printing? get() = current?.printings?.let { ps -> ps.firstOrNull { it.key == printing } ?: ps.firstOrNull() }

    /** What goes back to the site when the person taps Add (lib/scan/scanner.ts scanCards) */
    fun toPick(): JSONObject = JSONObject()
        .put("scanId", id)
        .put("choice", choice)
        .put("confirmed", confirmed)
        .put("key", current?.key ?: "")
        .put("slab", slab?.toJson() ?: JSONObject.NULL)
        .put("printing", printing ?: "")
        .put("condition", condition ?: "")
}
