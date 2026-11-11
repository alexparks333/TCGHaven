// Finding the card — or a graded slab — in a camera frame, and flattening it to a straight-on
// picture (OpenCV). Android's version of the iPhone's Vision rectangle detection + perspective
// correction (CardScanner.swift detectCard / flatten).
//
// Edges (Canny) → outlines → the largest four-sided one shaped like a card (63 × 88 mm, short/long
// ≈ 0.72) or a slab (PSA ≈ 0.58); a rounded or partly hidden outline counts when it fills its
// rotated bounding box. Run on a small copy of the frame (~480 px) for speed; corners are in the
// full frame's pixels.

package com.alexhparks.tcghaven

import android.graphics.Bitmap
import android.graphics.PointF
import org.opencv.android.OpenCVLoader
import org.opencv.android.Utils
import org.opencv.core.Core
import org.opencv.core.Mat
import org.opencv.core.MatOfPoint
import org.opencv.core.MatOfPoint2f
import org.opencv.core.Point
import org.opencv.core.Size
import org.opencv.imgproc.Imgproc
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

object CardFinder {
    class Found(val corners: Array<PointF>, val slab: Boolean, val area: Float)

    private val ready: Boolean by lazy { runCatching { OpenCVLoader.initLocal() }.getOrDefault(false) }

    // short side / long side
    private const val CARD_MIN = 0.64f
    private const val CARD_MAX = 0.82f
    private const val SLAB_MIN = 0.50f

    /** The card or slab in the picture, or null. `minArea` = its smallest share of the picture. */
    fun find(image: Bitmap, minArea: Float = 0.10f, wantSlab: Boolean = true): Found? {
        if (!ready) return null
        val k = 480f / max(image.width, image.height)
        val small = if (k < 1f) Bitmap.createScaledBitmap(image, (image.width * k).toInt(), (image.height * k).toInt(), true) else image
        val scale = if (k < 1f) k else 1f
        val rgba = Mat(); val gray = Mat(); val edges = Mat(); val hierarchy = Mat()
        try {
            Utils.bitmapToMat(small, rgba)
            Imgproc.cvtColor(rgba, gray, Imgproc.COLOR_RGBA2GRAY)
            Imgproc.GaussianBlur(gray, gray, Size(5.0, 5.0), 0.0)
            // Edge thresholds from the picture's own brightness (dim rooms, bright tables)
            val median = Core.mean(gray).`val`[0]
            Imgproc.Canny(gray, edges, max(10.0, 0.5 * median), min(255.0, 1.2 * median + 30))
            Imgproc.dilate(edges, edges, Imgproc.getStructuringElement(Imgproc.MORPH_RECT, Size(3.0, 3.0)))
            val contours = ArrayList<MatOfPoint>()
            Imgproc.findContours(edges, contours, hierarchy, Imgproc.RETR_LIST, Imgproc.CHAIN_APPROX_SIMPLE)
            val total = (small.width * small.height).toFloat()
            var best: Found? = null
            for (c in contours) {
                val area = Imgproc.contourArea(c).toFloat()
                if (area < minArea * total) continue
                val c2 = MatOfPoint2f(*c.toArray())
                val peri = Imgproc.arcLength(c2, true)
                val approx = MatOfPoint2f()
                Imgproc.approxPolyDP(c2, approx, 0.02 * peri, true)
                val pts: Array<Point> = if (approx.total() == 4L && Imgproc.isContourConvex(MatOfPoint(*approx.toArray()))) {
                    approx.toArray()
                } else {
                    // Rounded corners, a finger over an edge: the rotated box, when the outline fills it
                    val box = Imgproc.minAreaRect(c2)
                    if (area < 0.86f * box.size.area()) continue
                    arrayOf(Point(), Point(), Point(), Point()).also { box.points(it) }
                }
                val ordered = order(pts)
                val wTop = dist(ordered[0], ordered[1]); val wBottom = dist(ordered[3], ordered[2])
                val hLeft = dist(ordered[0], ordered[3]); val hRight = dist(ordered[1], ordered[2])
                val w = (wTop + wBottom) / 2; val h = (hLeft + hRight) / 2
                // Opposite sides about equal (a straight-on-ish rectangle, not a trapezoid of clutter)
                if (min(wTop, wBottom) / max(wTop, wBottom) < 0.75 || min(hLeft, hRight) / max(hLeft, hRight) < 0.75) continue
                val aspect = (min(w, h) / max(w, h)).toFloat()
                val slab = aspect in SLAB_MIN..CARD_MIN
                if (!(aspect in CARD_MIN..CARD_MAX || (wantSlab && slab))) continue
                val share = area / total
                if (best == null || share > best.area) {
                    best = Found(ordered.map { PointF((it.x / scale).toFloat(), (it.y / scale).toFloat()) }.toTypedArray(), slab, share)
                }
            }
            return best
        } catch (_: Throwable) {
            return null
        } finally {
            rgba.release(); gray.release(); edges.release(); hierarchy.release()
        }
    }

    /** Top-left, top-right, bottom-right, bottom-left */
    private fun order(p: Array<Point>): Array<Point> {
        val tl = p.minByOrNull { it.x + it.y }!!
        val br = p.maxByOrNull { it.x + it.y }!!
        val tr = p.minByOrNull { it.y - it.x }!!
        val bl = p.maxByOrNull { it.y - it.x }!!
        return arrayOf(tl, tr, br, bl)
    }

    private fun dist(a: Point, b: Point) = hypot(a.x - b.x, a.y - b.y)

    /** The quadrilateral straightened into a rectangle, its long side at most `maxLong` pixels */
    fun flatten(image: Bitmap, c: Array<PointF>, maxLong: Int = 1600): Bitmap? {
        if (!ready) return null
        val w0 = max(hypot((c[1].x - c[0].x).toDouble(), (c[1].y - c[0].y).toDouble()), hypot((c[2].x - c[3].x).toDouble(), (c[2].y - c[3].y).toDouble()))
        val h0 = max(hypot((c[3].x - c[0].x).toDouble(), (c[3].y - c[0].y).toDouble()), hypot((c[2].x - c[1].x).toDouble(), (c[2].y - c[1].y).toDouble()))
        val k = min(1.0, maxLong / max(w0, h0))
        val w = max(16, (w0 * k).toInt()); val h = max(16, (h0 * k).toInt())
        val src = Mat(); val out = Mat()
        try {
            Utils.bitmapToMat(image, src)
            val from = MatOfPoint2f(*c.map { Point(it.x.toDouble(), it.y.toDouble()) }.toTypedArray())
            val to = MatOfPoint2f(Point(0.0, 0.0), Point(w - 1.0, 0.0), Point(w - 1.0, h - 1.0), Point(0.0, h - 1.0))
            val m = Imgproc.getPerspectiveTransform(from, to)
            Imgproc.warpPerspective(src, out, m, Size(w.toDouble(), h.toDouble()), Imgproc.INTER_LINEAR)
            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            Utils.matToBitmap(out, bmp)
            return bmp
        } catch (_: Throwable) {
            return null
        } finally {
            src.release(); out.release()
        }
    }

    /** The card inside a flattened slab: the largest card-shaped outline below the label, or — if
     *  the plastic hides its edges — the part of the slab a card sits in (labels take the top ~22%) */
    fun cardInsideSlab(slab: Bitmap): Bitmap {
        val top = (slab.height * 0.2f).toInt()
        val lower = Bitmap.createBitmap(slab, 0, top, slab.width, slab.height - top)
        find(lower, minArea = 0.35f, wantSlab = false)?.let { f -> flatten(lower, f.corners)?.let { return it } }
        val x0 = (slab.width * 0.07f).toInt(); val y0 = (slab.height * 0.27f).toInt()
        val x1 = (slab.width * 0.93f).toInt(); val y1 = (slab.height * 0.96f).toInt()
        return Bitmap.createBitmap(slab, x0, y0, x1 - x0, y1 - y0)
    }
}
