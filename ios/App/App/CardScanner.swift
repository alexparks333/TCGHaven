// The TCGHaven card scanner — the native half. Plan, design and test results: docs/card-scanner.md.
//
// This screen owns the camera and does everything that needs the phone's hardware:
//   1. find the card in each video frame (Vision rectangle detection; the largest card-shaped one,
//      so the art box inside a card is never mistaken for the card), smoothed from frame to frame
//   2. fill a progress ring while it's genuinely held steady and in focus, then capture it
//   3. flatten it to a straight-on picture and read its text (Vision OCR, English + Japanese,
//      upside-down cards turned round; up to 3 frames when the number didn't read the first time)
//   4. hand the text to the site ("cardScanned") — lib/scan/scanner.ts matches it against the
//      catalog on the server and sends back the candidates ("update")
//   5. compare the scanned card's picture with candidate catalog photos ("compare" — PictureMatcher)
//      so look-alikes the text can't separate (One Piece parallels, reprints) are told apart; and
//      fingerprint it with the trained picture AI (CardFingerprinter, docs/scanner-ai.md) so the
//      server can search every catalog card by picture
//   6. a tray of everything scanned; "Add" returns the picks to the site, which saves them through
//      lib/firebase/db.ts like any other added card (ScanReviewDialog.tsx)
//
// Everything on screen reflects real work: the ring is the measured steadiness, the scan line runs
// only while the card is being read / matched / compared, and the stage label says which.
//
// Nothing here writes user data, and no photo leaves the phone — only the text that was read and
// the picture AI's 384-number fingerprint of the card.
// Test builds (Xcode ▶︎ Run) keep every scan on the phone for tuning: see "Debug scans" below.

import UIKit
import AVFoundation
import Vision
import CoreImage
import Capacitor
import WebKit
import CoreMotion
import CoreML

// MARK: - Registering the plugin

/// The app's web view controller (SceneDelegate creates it): Capacitor's own, plus our local plugin.
class TCGBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(CardScannerPlugin())
    }

    /// The card scanner's matching runs in the page while the scanner covers it. iOS slows an
    /// inactive page right down — results then waited for the next capture to wake it (seen on the
    /// phone 2026-11-09: old cards matched the instant a new one was captured). Keep it running.
    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let config = super.webViewConfiguration(for: instanceConfiguration)
        if #available(iOS 17.0, *) { config.preferences.inactiveSchedulingPolicy = .none }
        return config
    }
}

// MARK: - The plugin the site calls (lib/scan/scanner.ts)

@objc(CardScannerPlugin)
public class CardScannerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CardScannerPlugin"
    public let jsName = "CardScanner"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "compare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "searchResults", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prepareModel", returnType: CAPPluginReturnPromise),
    ]

    /// Have the picture AI model ready: { version, files: { path inside the .mlpackage: URL } }.
    /// Downloaded once per version and kept; resolves { ready } when it can be used.
    @objc func prepareModel(_ call: CAPPluginCall) {
        guard let version = call.getString("version"), let files = call.getObject("files") as? [String: String], !files.isEmpty else {
            call.resolve(["ready": false])
            return
        }
        CardFingerprinter.shared.prepare(version: version, files: files) { ready in call.resolve(["ready": ready]) }
    }

    private weak var scanner: ScannerViewController?

    /// Opens the scanner. Resolves once, when the person taps Add (their picks) or closes it (none).
    @objc func open(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, self.scanner == nil, let presenter = self.bridge?.viewController else {
                call.reject("The scanner is already open")
                return
            }
            let vc = ScannerViewController()
            vc.screenTitle = call.getString("title") ?? "Scan cards"
            vc.onScanned = { [weak self] scanId, lines, fingerprints in
                var data: [String: Any] = ["scanId": scanId, "lines": lines]
                if let fps = fingerprints, !fps.isEmpty { data["fingerprints"] = fps.map { $0.map { Double($0) } } }
                self?.notifyListeners("cardScanned", data: data)
            }
            vc.onSearch = { [weak self] requestId, query in
                self?.notifyListeners("searchCards", data: ["requestId": requestId, "query": query])
            }
            vc.onFinish = { [weak self] items in
                self?.scanner = nil
                call.resolve(["items": items])
            }
            // Over the page, not replacing it: the page stays on screen underneath, so iOS keeps it
            // running at full speed while it matches the scans
            vc.modalPresentationStyle = .overFullScreen
            vc.modalPresentationCapturesStatusBarAppearance = true
            self.scanner = vc
            presenter.present(vc, animated: true)
        }
    }

    /// How far each catalog photo is from the scanned card (smaller = more alike; null = no photo).
    @objc func compare(_ call: CAPPluginCall) {
        let scanId = call.getString("scanId") ?? ""
        let urls = call.getArray("imageUrls", String.self) ?? []
        DispatchQueue.main.async {
            guard let scanner = self.scanner, let signature = scanner.signature(for: scanId) else {
                call.resolve(["distances": urls.map { _ in NSNull() }])
                return
            }
            scanner.setStage("Comparing \(urls.count) picture\(urls.count == 1 ? "" : "s")…", for: scanId)
            PictureMatcher.distances(from: signature, to: urls) { distances in
                var out: [Any] = []
                for d in distances { out.append(d.map { NSNumber(value: $0) as Any } ?? NSNull()) }
                call.resolve(["distances": out])
            }
        }
    }

    private static func options(_ call: CAPPluginCall) -> [TrayOption] {
        (call.getArray("options") ?? []).compactMap { raw in
            guard let o = raw as? JSObject else { return nil }
            return TrayOption(
                key: o["key"] as? String ?? "",
                title: o["title"] as? String ?? "",
                subtitle: o["subtitle"] as? String ?? "",
                price: o["price"] as? String ?? "",
                imageUrl: o["imageUrl"] as? String ?? "",
                detail: o["detail"] as? String ?? "",
                printings: (o["printings"] as? JSArray ?? []).compactMap { raw in
                    guard let p = raw as? JSObject, let key = p["key"] as? String else { return nil }
                    return Printing(key: key, label: p["label"] as? String ?? key, price: p["price"] as? String ?? "")
                }
            )
        }
    }

    /// Cards found by the card sheet's search (the site runs Add Card's search)
    @objc func searchResults(_ call: CAPPluginCall) {
        let requestId = call.getString("requestId") ?? ""
        let options = Self.options(call)
        DispatchQueue.main.async {
            self.scanner?.deliverSearch(requestId: requestId, options: options)
            call.resolve()
        }
    }

    /// The site's answer for one scanned card: what it is (best first) and how sure.
    @objc func update(_ call: CAPPluginCall) {
        let scanId = call.getString("scanId") ?? ""
        let status = call.getString("status") ?? "none"
        let options = Self.options(call)
        let choice = call.getInt("choice") ?? 0
        let note = call.getString("note")
        let slabObj = call.getObject("slab")
        let slab = slabObj.flatMap { o -> SlabGrade? in
            guard let grade = o["grade"] as? String, !grade.isEmpty else { return nil }
            return SlabGrade(company: (o["company"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "PSA", grade: grade, cert: o["cert"] as? String ?? "")
        }
        DispatchQueue.main.async {
            self.scanner?.applyResult(scanId: scanId, status: status, options: options, choice: choice, note: note, slab: slab)
            call.resolve()
        }
    }
}

// MARK: - Data

struct Printing {
    let key: String     // "unlimited:reverse", "foil"
    let label: String   // "Reverse Holo", "1st Edition Holo", "Foil"
    let price: String
}

struct TrayOption {
    let key: String
    let title: String
    let subtitle: String
    let price: String
    let imageUrl: String
    let detail: String
    var printings: [Printing] = []
}

final class ScanItem {
    let id: String
    let thumbnail: UIImage           // the scanned card, small — shown until the catalog photo loads
    var fromSwap = false             // scanned without the last card leaving: dropped if it's the same card
    var slab: SlabGrade?             // a graded slab: drawn in its slab, grade showing
    var printing: String?            // the finish picked in the card sheet (reset when the card changes)
    var condition: String?           // picked in the card sheet: near_mint (default) / lightly_played / …

    /// The card's current finish: the one picked, else the card's first (default) printing
    var currentPrinting: Printing? {
        guard options.indices.contains(choice) else { return nil }
        let ps = options[choice].printings
        return ps.first { $0.key == printing } ?? ps.first
    }
    var photo: UIImage?              // the scanned card, bigger — "Your scan" in the card sheet
    var signature: PictureMatcher.Signature?
    var status = "matching"          // matching | matched | pick | none | error
    var options: [TrayOption] = []
    var choice = 0
    var confirmed = false            // the person picked it in the tray themselves
    var note: String?

    init(id: String, thumbnail: UIImage) {
        self.id = id
        self.thumbnail = thumbnail
    }
}

// MARK: - Picture comparison
//
// The scan and every catalog photo are the whole card, straight on, so they can be compared
// directly instead of through a general-purpose image fingerprint (Apple's Vision feature prints
// were tried first: only ~80% right on One Piece parallels, with thin margins). Both pictures are
// shrunk to a 40 × 56 grid; each colour channel and the edge strength are compared tile by tile
// (4 × 4 tiles) by normalized correlation — so exposure and white balance don't matter — the
// worst quarter of tiles is dropped (a glare spot or a thumb), and a shift of up to 2 cells is
// allowed for imperfect framing. 100% right on One Piece parallels in normal conditions, 87% under
// harsh glare + blur; only same-art reprints stay close, and the printed number separates those.
// Distances: 0 = identical; see lib/scan/decide.ts for how they're used.

enum PictureMatcher {
    static let gridW = 40, gridH = 56
    typealias Signature = [Float]

    private static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.requestCachePolicy = .returnCacheDataElseLoad
        config.urlCache = URLCache(memoryCapacity: 20 << 20, diskCapacity: 150 << 20)
        config.timeoutIntervalForRequest = 8
        config.httpMaximumConnectionsPerHost = 8
        return URLSession(configuration: config)
    }()
    private static let signatureCache = NSCache<NSString, NSArray>()
    private static let work = DispatchQueue(label: "tcghaven.scanner.pictures", qos: .userInitiated, attributes: .concurrent)

    /// R, G, B planes then the horizontal and vertical luminance gradients
    static func signature(of image: CGImage) -> Signature? {
        let w = gridW, h = gridH, n = w * h
        var px = [UInt8](repeating: 255, count: n * 4)
        let drawn: Bool = px.withUnsafeMutableBytes { buf in
            guard let c = CGContext(data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            c.setFillColor(UIColor.white.cgColor)   // transparent card corners → white, like a scan's light border
            c.fill(CGRect(x: 0, y: 0, width: w, height: h))
            c.interpolationQuality = .high
            c.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        guard drawn else { return nil }
        var out = [Float](repeating: 0, count: n * 5)
        for i in 0..<n {
            out[i] = Float(px[i * 4]); out[n + i] = Float(px[i * 4 + 1]); out[2 * n + i] = Float(px[i * 4 + 2])
        }
        var lum = [Float](repeating: 0, count: n)
        for i in 0..<n { lum[i] = 0.3 * out[i] + 0.59 * out[n + i] + 0.11 * out[2 * n + i] }
        for y in 1..<(h - 1) {
            for x in 1..<(w - 1) {
                let i = y * w + x
                out[3 * n + i] = lum[i + 1] - lum[i - 1]
                out[4 * n + i] = lum[i + w] - lum[i - w]
            }
        }
        return out
    }

    private static let planeWeights: [Float] = [1, 1, 1, 1.5, 1.5]

    private static func tileScore(_ a: Signature, _ b: Signature, dx: Int, dy: Int) -> Float {
        let w = gridW, h = gridH, n = w * h, tiles = 4
        var scores: [Float] = []
        scores.reserveCapacity(tiles * tiles)
        for ty in 0..<tiles {
            for tx in 0..<tiles {
                let x0 = max(1, tx * w / tiles), x1 = min(w - 1, (tx + 1) * w / tiles)
                let y0 = max(1, ty * h / tiles), y1 = min(h - 1, (ty + 1) * h / tiles)
                var total: Float = 0
                for p in 0..<5 {
                    var sa: Float = 0, sb: Float = 0, saa: Float = 0, sbb: Float = 0, sab: Float = 0, cnt: Float = 0
                    let off = p * n
                    for y in y0..<y1 {
                        let y2 = y + dy
                        if y2 < 1 || y2 >= h - 1 { continue }
                        for x in x0..<x1 {
                            let x2 = x + dx
                            if x2 < 1 || x2 >= w - 1 { continue }
                            let va = a[off + y * w + x], vb = b[off + y2 * w + x2]
                            sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb; cnt += 1
                        }
                    }
                    if cnt < 2 { continue }
                    let cov = sab / cnt - sa / cnt * sb / cnt
                    let v1 = saa / cnt - sa / cnt * sa / cnt, v2 = sbb / cnt - sb / cnt * sb / cnt
                    // A flat tile (plain border) says nothing either way
                    total += planeWeights[p] * ((v1 < 4 || v2 < 4) ? 0 : cov / (v1 * v2).squareRoot())
                }
                scores.append(total / 6)
            }
        }
        scores.sort()
        let kept = scores[(scores.count / 4)...]
        return kept.reduce(0, +) / Float(kept.count)
    }

    static func distance(_ a: Signature, _ b: Signature) -> Float {
        var best: Float = -2
        for dy in -2...2 { for dx in -2...2 { best = max(best, tileScore(a, b, dx: dx, dy: dy)) } }
        return 1 - best
    }

    static func distances(from scanned: Signature, to urls: [String], done: @escaping ([Float?]) -> Void) {
        var out = [Float?](repeating: nil, count: urls.count)
        let group = DispatchGroup()
        let lock = NSLock()
        for (i, s) in urls.enumerated() {
            guard let url = URL(string: s) else { continue }
            group.enter()
            let finish: (Signature?) -> Void = { sig in
                if let sig = sig {
                    let d = distance(scanned, sig)
                    lock.lock(); out[i] = d; lock.unlock()
                }
                group.leave()
            }
            if let cached = signatureCache.object(forKey: s as NSString) as? [Float] { work.async { finish(cached) }; continue }
            session.dataTask(with: url) { data, _, _ in
                work.async {
                    guard let data = data, let image = UIImage(data: data)?.cgImage, let sig = signature(of: image) else {
                        finish(nil); return
                    }
                    signatureCache.setObject(sig as NSArray, forKey: s as NSString)
                    finish(sig)
                }
            }.resume()
        }
        group.notify(queue: .main) { done(out) }
    }

    static func loadImage(_ s: String, into view: UIImageView, ifStill check: @escaping () -> Bool) {
        guard let url = URL(string: s) else { return }
        session.dataTask(with: url) { data, _, _ in
            guard let data = data, let image = UIImage(data: data) else { return }
            DispatchQueue.main.async { if check() { view.image = image } }
        }.resume()
    }
}

// MARK: - Debug scans (test builds only)
//
// Every scan from an Xcode ▶︎ Run build is kept on the phone: the flattened card (card.jpg), what
// was read from each frame (ocr.json) and what the site answered (result.json), in the app's
// Documents/scans/<time>-<id>/. Claude copies them off with
//   xcrun devicectl device copy from --device <id> --domain-type appDataContainer \
//     --domain-identifier com.alexhparks.tcghaven --source Documents/scans --destination <dir>
// and tunes the scanner against real phone scans. App Store builds (Release) never save anything.

enum DebugScans {
    #if DEBUG
    static let enabled = true
    #else
    static let enabled = false
    #endif
    private static let queue = DispatchQueue(label: "tcghaven.scanner.debug", qos: .utility)
    private static var folders: [String: URL] = [:]

    static func save(scanId: String, image: CGImage, info: [String: Any]) {
        guard enabled else { return }
        let jpeg = UIImage(cgImage: image).jpegData(compressionQuality: 0.85)
        queue.async {
            guard let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
            let f = DateFormatter(); f.dateFormat = "yyyyMMdd-HHmmss"
            let dir = docs.appendingPathComponent("scans/\(f.string(from: Date()))-\(scanId.prefix(8))")
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            folders[scanId] = dir
            try? jpeg?.write(to: dir.appendingPathComponent("card.jpg"))
            if let data = try? JSONSerialization.data(withJSONObject: info, options: [.prettyPrinted]) {
                try? data.write(to: dir.appendingPathComponent("ocr.json"))
            }
        }
    }

    static func saveResult(scanId: String, info: [String: Any]) {
        guard enabled else { return }
        queue.async {
            guard let dir = folders[scanId], let data = try? JSONSerialization.data(withJSONObject: info, options: [.prettyPrinted]) else { return }
            try? data.write(to: dir.appendingPathComponent("result.json"))
        }
    }

    static func log(_ s: @autoclosure () -> String) {
        if enabled { print("[scanner] \(s())") }
    }
}

// MARK: - The scanner screen

final class ScannerViewController: UIViewController, AVCaptureVideoDataOutputSampleBufferDelegate,
    UICollectionViewDataSource, UICollectionViewDelegate {

    var screenTitle = "Scan cards"
    var onScanned: ((String, [[String: Any]], [[Float]]?) -> Void)?
    var onFinish: (([[String: Any]]) -> Void)?
    var onSearch: ((String, String) -> Void)?
    private var searchWaiting: [String: ([TrayOption]) -> Void] = [:]

    // Phone movement — steadiness is the hands being still (the card outline itself jitters by a
    // few % between frames even when nothing moves, so it can't be the measure)
    private let motion = CMMotionManager()

    // Camera
    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "tcghaven.scanner.session")
    private let frameQueue = DispatchQueue(label: "tcghaven.scanner.frames", qos: .userInitiated)
    private var device: AVCaptureDevice?
    private let previewLayer = AVCaptureVideoPreviewLayer()
    private let ciContext = CIContext()

    // ── Frame state (frameQueue only) ──
    private enum Phase { case searching, reading, waitingForNext }
    private var phase = Phase.searching
    private var busy = false
    private var lastFrameAt: CFTimeInterval = 0
    private var smoothQuad: [CGPoint]?        // the outline shown, smoothed between frames
    private var rawQuad: [CGPoint]?           // the last detection, for measuring movement
    private var lastSeenAt: CFTimeInterval = 0
    private var steadiness: CGFloat = 0       // 0…1 — the progress ring
    private var manualCapture = false
    // reading: several frames of text for one card
    private var readingId = ""
    private var readingLines: [[[String: Any]]] = []
    private var readingImage: CGImage?
    private var readingStarted: CFTimeInterval = 0
    private var readingQuad: [CGPoint]?       // where the card was found for this read
    // Finish detection (measuring for now — docs/card-scanner.md "Finish detection"): small copies of
    // each flattened frame, a few extra frames after the number reads, the way up they were read
    private var finishGrids: [[Float]] = []
    private var codeReadAt: CFTimeInterval?
    private var readFlipped = false
    // waiting for the next card
    private var lastScanCenter = CGPoint.zero
    private var lastScanSignature: PictureMatcher.Signature?
    private var lastSwapCheckAt: CFTimeInterval = 0
    private var steadySince: CFTimeInterval = 0
    private var nextIsSwap = false            // the next scan came from a swap in place (no removal)
    // once-a-second numbers for the debug log
    private var statFrames = 0, statFound = 0, statFocusing = 0, statAt: CFTimeInterval = 0
    private var statMotion: [CGFloat] = []

    // UI (main thread)
    private let outlineLayer = CAShapeLayer()
    private let ringLayer = CAShapeLayer()
    private let flashLayer = CAShapeLayer()
    private let hintLabel = PaddedLabel()
    private var hintWanted = ""
    private var hintWantedSince: CFTimeInterval = 0
    private let doneButton = UIButton(type: .system)
    private let closeButton = UIButton(type: .system)
    private let torchButton = UIButton(type: .system)
    private let shutterButton = UIButton(type: .custom)
    private let titleLabel = UILabel()
    private let modeButton = UIButton(type: .system)
    // Auto scans a card once it's held still; Manual waits for the shutter. Remembered on this phone.
    private var autoScan = UserDefaults.standard.object(forKey: "scanner.autoScan") as? Bool ?? true
    private var autoScanOnFrames = true      // the frame queue's copy
    private var tray: UICollectionView!
    private let trayFade = CAGradientLayer()
    private var items: [ScanItem] = []
    private var finished = false
    // The card being worked on right now: its real captured picture, a scan line while work is
    // under way, and the stage
    private let activeCard = UIView()
    private let activeImage = UIImageView()
    private let activeBeam = CAGradientLayer()
    private let activeStage = UILabel()
    private var activeId: String?

    private let notify = UINotificationFeedbackGenerator()
    private let tap = UIImpactFeedbackGenerator(style: .medium)

    private static let gold = UIColor(red: 0.85, green: 0.70, blue: 0.35, alpha: 1)

    // Tuning — docs/card-scanner.md "Tuning"
    private static let cardAspect: (min: Float, max: Float) = (0.55, 0.9)  // 63 × 88 mm, tilted, sleeved
    private static let steadyMotion: CGFloat = 0.018     // corner movement per frame still counted as steady
    private static let steadyTime: CGFloat = 0.4         // seconds of still hands to fill the ring
    private static let holdOver: CFTimeInterval = 0.35   // keep a lost outline this long (missed frames)
    private static let goneAfter: CFTimeInterval = 0.4   // card gone this long → ready for the next
    private static let maxReadFrames = 3

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }
    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
    override var prefersHomeIndicatorAutoHidden: Bool { true }

    // MARK: Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        previewLayer.session = session
        previewLayer.videoGravity = .resizeAspectFill
        view.layer.addSublayer(previewLayer)

        outlineLayer.strokeColor = UIColor(white: 1, alpha: 0.85).cgColor
        outlineLayer.fillColor = UIColor(white: 1, alpha: 0.06).cgColor
        outlineLayer.lineWidth = 2
        outlineLayer.lineJoin = .round
        ringLayer.strokeColor = Self.gold.cgColor
        ringLayer.fillColor = UIColor.clear.cgColor
        ringLayer.lineWidth = 6
        ringLayer.lineJoin = .round
        ringLayer.lineCap = .round
        ringLayer.strokeEnd = 0
        flashLayer.fillColor = UIColor.white.cgColor
        flashLayer.opacity = 0
        for l in [outlineLayer, ringLayer, flashLayer] { view.layer.addSublayer(l) }

        buildControls()
        if motion.isDeviceMotionAvailable {
            motion.deviceMotionUpdateInterval = 1.0 / 30
            motion.startDeviceMotionUpdates()
        }
        notify.prepare()
        tap.prepare()
        checkCameraAccess()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer.frame = view.bounds
        for l in [outlineLayer, ringLayer, flashLayer] { l.frame = view.bounds }
        activeBeam.frame = CGRect(x: 0, y: -24, width: activeImage.bounds.width, height: 24)
        updateTrayFade()
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        if scrollView === tray { updateTrayFade() }
    }

    /// Edges fade only where there's more to see: the right while more cards are off to the right,
    /// the left once scrolled
    private func updateTrayFade() {
        guard let tray = tray else { return }
        CATransaction.begin(); CATransaction.setDisableActions(true)
        trayFade.frame = CGRect(origin: CGPoint(x: tray.contentOffset.x, y: 0), size: tray.bounds.size)
        let w = max(1, tray.bounds.width), fade: CGFloat = 56 / w
        let moreRight = tray.contentOffset.x + tray.bounds.width < tray.contentSize.width - 2
        let moreLeft = tray.contentOffset.x > 2
        trayFade.colors = [(moreLeft ? UIColor.clear : UIColor.black).cgColor, UIColor.black.cgColor,
                           UIColor.black.cgColor, (moreRight ? UIColor.clear : UIColor.black).cgColor]
        trayFade.locations = [0, NSNumber(value: Double(fade)), NSNumber(value: Double(1 - fade)), 1]
        CATransaction.commit()
    }

    // MARK: Card sheet search (the site runs the search)

    func search(_ query: String, done: @escaping ([TrayOption]) -> Void) {
        let id = UUID().uuidString
        searchWaiting[id] = done
        onSearch?(id, query)
    }

    func deliverSearch(requestId: String, options: [TrayOption]) {
        searchWaiting.removeValue(forKey: requestId)?(options)
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        setTorch(on: false)
        motion.stopDeviceMotionUpdates()
        sessionQueue.async { if self.session.isRunning { self.session.stopRunning() } }
    }

    // MARK: Controls

    private func roundButton(_ b: UIButton, symbol: String, label: String) {
        b.setImage(UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 17, weight: .semibold)), for: .normal)
        b.tintColor = .white
        b.backgroundColor = UIColor(white: 0, alpha: 0.45)
        b.layer.cornerRadius = 20
        b.accessibilityLabel = label
    }

    private func buildControls() {
        roundButton(closeButton, symbol: "xmark", label: "Close")
        closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        roundButton(torchButton, symbol: "flashlight.off.fill", label: "Light")
        torchButton.addTarget(self, action: #selector(torchTapped), for: .touchUpInside)

        modeButton.addTarget(self, action: #selector(modeTapped), for: .touchUpInside)
        modeButton.accessibilityLabel = "Auto scan"
        styleModeButton()
        frameQueue.async { self.autoScanOnFrames = self.autoScanSnapshot }
        titleLabel.text = screenTitle
        titleLabel.textColor = .white
        titleLabel.font = .systemFont(ofSize: 17, weight: .semibold)

        hintLabel.text = "Point at a card"
        hintLabel.textColor = .white
        hintLabel.font = .systemFont(ofSize: 15, weight: .medium)
        hintLabel.textAlignment = .center
        hintLabel.numberOfLines = 2
        hintLabel.backgroundColor = UIColor(white: 0, alpha: 0.55)
        hintLabel.layer.cornerRadius = 14
        hintLabel.clipsToBounds = true

        // The card being read: the actual captured picture
        activeCard.isHidden = true
        activeCard.backgroundColor = UIColor(white: 0, alpha: 0.6)
        activeCard.layer.cornerRadius = 14
        activeImage.contentMode = .scaleAspectFill
        activeImage.clipsToBounds = true
        activeImage.layer.cornerRadius = 6
        activeBeam.colors = [Self.gold.withAlphaComponent(0).cgColor, Self.gold.withAlphaComponent(0.9).cgColor, Self.gold.withAlphaComponent(0).cgColor]
        activeBeam.startPoint = CGPoint(x: 0.5, y: 0)
        activeBeam.endPoint = CGPoint(x: 0.5, y: 1)
        activeImage.layer.addSublayer(activeBeam)
        activeStage.textColor = .white
        activeStage.font = .systemFont(ofSize: 13, weight: .semibold)
        activeStage.numberOfLines = 3
        for v in [activeImage, activeStage] {
            v.translatesAutoresizingMaskIntoConstraints = false
            activeCard.addSubview(v)
        }

        shutterButton.backgroundColor = UIColor(white: 1, alpha: 0.9)
        shutterButton.layer.cornerRadius = 32
        shutterButton.layer.borderWidth = 4
        shutterButton.layer.borderColor = UIColor(white: 1, alpha: 0.4).cgColor
        shutterButton.accessibilityLabel = "Scan now"
        shutterButton.addTarget(self, action: #selector(shutterTapped), for: .touchUpInside)

        var done = UIButton.Configuration.filled()
        done.title = "Add"
        done.baseBackgroundColor = Self.gold
        done.baseForegroundColor = .black
        done.cornerStyle = .capsule
        done.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: 18, bottom: 0, trailing: 18)
        done.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attrs in
            var a = attrs
            a.font = .systemFont(ofSize: 16, weight: .bold)
            return a
        }
        doneButton.configuration = done
        doneButton.addTarget(self, action: #selector(doneTapped), for: .touchUpInside)
        doneButton.isEnabled = false
        doneButton.alpha = 0.6

        let layout = UICollectionViewFlowLayout()
        layout.scrollDirection = .horizontal
        layout.itemSize = CGSize(width: 86, height: 150)
        layout.minimumLineSpacing = 10
        layout.sectionInset = UIEdgeInsets(top: 0, left: 16, bottom: 0, right: 16)
        tray = UICollectionView(frame: .zero, collectionViewLayout: layout)
        tray.backgroundColor = .clear
        tray.showsHorizontalScrollIndicator = false
        tray.dataSource = self
        tray.delegate = self
        tray.register(TrayCell.self, forCellWithReuseIdentifier: "card")
        // Fade the edges when there are more cards to scroll to
        trayFade.colors = [UIColor.clear.cgColor, UIColor.black.cgColor, UIColor.black.cgColor, UIColor.clear.cgColor]
        trayFade.startPoint = CGPoint(x: 0, y: 0.5)
        trayFade.endPoint = CGPoint(x: 1, y: 0.5)
        tray.layer.mask = trayFade

        let trayBackground = UIView()
        trayBackground.backgroundColor = UIColor(white: 0, alpha: 0.6)

        for v in [trayBackground, closeButton, torchButton, titleLabel, modeButton, hintLabel, activeCard, shutterButton, doneButton, tray!] as [UIView] {
            v.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(v)
        }
        let safe = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            closeButton.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 16),
            closeButton.topAnchor.constraint(equalTo: safe.topAnchor, constant: 8),
            closeButton.widthAnchor.constraint(equalToConstant: 40),
            closeButton.heightAnchor.constraint(equalToConstant: 40),
            torchButton.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -16),
            torchButton.centerYAnchor.constraint(equalTo: closeButton.centerYAnchor),
            torchButton.widthAnchor.constraint(equalToConstant: 40),
            torchButton.heightAnchor.constraint(equalToConstant: 40),
            titleLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            titleLabel.centerYAnchor.constraint(equalTo: closeButton.centerYAnchor),
            modeButton.trailingAnchor.constraint(equalTo: torchButton.leadingAnchor, constant: -10),
            modeButton.centerYAnchor.constraint(equalTo: closeButton.centerYAnchor),
            modeButton.heightAnchor.constraint(equalToConstant: 34),
            hintLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            hintLabel.topAnchor.constraint(equalTo: closeButton.bottomAnchor, constant: 14),
            hintLabel.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, constant: -48),

            activeCard.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            activeCard.bottomAnchor.constraint(equalTo: trayBackground.topAnchor, constant: -14),
            activeCard.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, constant: -48),
            activeImage.leadingAnchor.constraint(equalTo: activeCard.leadingAnchor, constant: 10),
            activeImage.topAnchor.constraint(equalTo: activeCard.topAnchor, constant: 10),
            activeImage.bottomAnchor.constraint(equalTo: activeCard.bottomAnchor, constant: -10),
            activeImage.widthAnchor.constraint(equalToConstant: 64),
            activeImage.heightAnchor.constraint(equalToConstant: 89),
            activeStage.leadingAnchor.constraint(equalTo: activeImage.trailingAnchor, constant: 12),
            activeStage.trailingAnchor.constraint(equalTo: activeCard.trailingAnchor, constant: -14),
            activeStage.centerYAnchor.constraint(equalTo: activeCard.centerYAnchor),
            activeStage.widthAnchor.constraint(greaterThanOrEqualToConstant: 150),

            trayBackground.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            trayBackground.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            trayBackground.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            trayBackground.topAnchor.constraint(equalTo: tray.topAnchor, constant: -12),
            doneButton.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -16),
            doneButton.bottomAnchor.constraint(equalTo: safe.bottomAnchor, constant: -8),
            doneButton.heightAnchor.constraint(equalToConstant: 44),
            shutterButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            shutterButton.centerYAnchor.constraint(equalTo: doneButton.centerYAnchor),
            shutterButton.widthAnchor.constraint(equalToConstant: 64),
            shutterButton.heightAnchor.constraint(equalToConstant: 64),
            tray.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tray.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tray.bottomAnchor.constraint(equalTo: shutterButton.topAnchor, constant: -12),
            tray.heightAnchor.constraint(equalToConstant: 150),
        ])
    }

    /// The hint changes only once a new state has lasted a moment, so it never flickers between
    /// two messages; capture-time messages pass `now: true`
    private func wantHint(_ text: String, now: Bool = false) {
        let t = CACurrentMediaTime()
        if text != hintWanted { hintWanted = text; hintWantedSince = t }
        if now || t - hintWantedSince > 0.3 || hintLabel.text == nil {
            if hintLabel.text != text {
                UIView.transition(with: hintLabel, duration: 0.15, options: .transitionCrossDissolve) { self.hintLabel.text = text }
            }
        }
    }

    private func refreshDone() {
        let n = items.filter { $0.status == "matched" || $0.status == "pick" }.count
        doneButton.configuration?.title = n > 0 ? "Add \(n)" : "Add"
        doneButton.isEnabled = n > 0
        doneButton.alpha = n > 0 ? 1 : 0.6
    }

    @objc private func closeTapped() {
        let kept = items.filter { $0.status == "matched" || $0.status == "pick" }.count
        if kept == 0 { finish(with: []); return }
        let alert = UIAlertController(title: "Discard \(kept) scanned card\(kept == 1 ? "" : "s")?", message: nil, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Keep scanning", style: .cancel))
        alert.addAction(UIAlertAction(title: "Discard", style: .destructive) { _ in self.finish(with: []) })
        present(alert, animated: true)
    }

    @objc private func doneTapped() {
        let picks = items.filter { $0.status == "matched" || $0.status == "pick" }.reversed().map {
            ["scanId": $0.id, "choice": $0.choice, "confirmed": $0.confirmed,
             "key": $0.options.indices.contains($0.choice) ? $0.options[$0.choice].key : "",
             // the grading as left in the card sheet (null = ungraded)
             "slab": $0.slab.map { ["company": $0.company, "grade": $0.grade, "cert": $0.cert] as Any } ?? NSNull(),
             "printing": $0.printing ?? "",
             "condition": $0.condition ?? ""] as [String: Any]
        }
        finish(with: Array(picks))
    }

    private func finish(with picks: [[String: Any]]) {
        guard !finished else { return }
        finished = true
        dismiss(animated: true) { self.onFinish?(picks) }
    }

    private var autoScanSnapshot: Bool { autoScan }

    private func styleModeButton() {
        var c = UIButton.Configuration.filled()
        c.title = autoScan ? "Auto" : "Manual"
        c.image = UIImage(systemName: autoScan ? "bolt.fill" : "hand.tap.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 12, weight: .bold))
        c.imagePadding = 5
        c.cornerStyle = .capsule
        c.baseBackgroundColor = autoScan ? Self.gold : UIColor(white: 0, alpha: 0.45)
        c.baseForegroundColor = autoScan ? .black : .white
        c.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: 12, bottom: 0, trailing: 12)
        c.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { a in
            var b = a; b.font = .systemFont(ofSize: 13, weight: .bold); return b
        }
        modeButton.configuration = c
    }

    @objc private func modeTapped() {
        autoScan.toggle()
        UserDefaults.standard.set(autoScan, forKey: "scanner.autoScan")
        UISelectionFeedbackGenerator().selectionChanged()
        styleModeButton()
        let on = autoScan
        frameQueue.async { self.autoScanOnFrames = on; self.steadiness = 0 }
        wantHint(on ? "Auto: hold a card still to scan it" : "Manual: press the button to scan", now: true)
    }

    @objc private func torchTapped() {
        setTorch(on: !(device?.torchMode == .on))
    }

    private func setTorch(on: Bool) {
        guard let device = device, device.hasTorch else { return }
        do {
            try device.lockForConfiguration()
            device.torchMode = on ? .on : .off
            device.unlockForConfiguration()
            torchButton.setImage(UIImage(systemName: on ? "flashlight.on.fill" : "flashlight.off.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 17, weight: .semibold)), for: .normal)
            torchButton.tintColor = on ? Self.gold : .white
        } catch {}
    }

    @objc private func shutterTapped() {
        tap.impactOccurred()
        frameQueue.async {
            if self.phase == .waitingForNext { self.phase = .searching }
            self.manualCapture = true
        }
    }

    // MARK: Camera

    private func checkCameraAccess() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            configureSession()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async { granted ? self.configureSession() : self.showNoCamera() }
            }
        default:
            showNoCamera()
        }
    }

    private func showNoCamera() {
        wantHint("TCGHaven needs the camera to scan cards", now: true)
        let alert = UIAlertController(title: "Camera is off for TCGHaven",
                                      message: "Turn it on in Settings → TCGHaven → Camera to scan your cards.",
                                      preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Not now", style: .cancel))
        alert.addAction(UIAlertAction(title: "Open Settings", style: .default) { _ in
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
        })
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.present(alert, animated: true) }
    }

    private func configureSession() {
        sessionQueue.async {
            guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
                  let input = try? AVCaptureDeviceInput(device: device) else {
                DispatchQueue.main.async { self.wantHint("No camera found", now: true) }
                return
            }
            self.device = device
            self.session.beginConfiguration()
            // 4K frames: the number line at the bottom of a card is tiny — more pixels, better reads
            if self.session.canSetSessionPreset(.hd4K3840x2160) && device.supportsSessionPreset(.hd4K3840x2160) {
                self.session.sessionPreset = .hd4K3840x2160
            } else {
                self.session.sessionPreset = .hd1920x1080
            }
            if self.session.canAddInput(input) { self.session.addInput(input) }

            let output = AVCaptureVideoDataOutput()
            output.alwaysDiscardsLateVideoFrames = true
            output.setSampleBufferDelegate(self, queue: self.frameQueue)
            if self.session.canAddOutput(output) { self.session.addOutput(output) }
            self.session.commitConfiguration()

            self.tuneFocus(device)
            self.session.startRunning()
            DispatchQueue.main.async {
                if let connection = self.previewLayer.connection {
                    if #available(iOS 17.0, *) {
                        if connection.isVideoRotationAngleSupported(90) { connection.videoRotationAngle = 90 }
                    } else if connection.isVideoOrientationSupported {
                        connection.videoOrientation = .portrait
                    }
                }
            }
        }
    }

    /// Close-up focus. Newer Pro iPhones can't focus closer than ~15–20 cm with the main camera, so
    /// (Apple's own advice for scanning small things) zoom in just enough that a card fills the
    /// frame from that distance instead of the person moving in until it blurs.
    private func tuneFocus(_ device: AVCaptureDevice) {
        do {
            try device.lockForConfiguration()
            if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
            if device.isAutoFocusRangeRestrictionSupported { device.autoFocusRangeRestriction = .near }
            if device.isSmoothAutoFocusSupported { device.isSmoothAutoFocusEnabled = false }
            if device.isExposureModeSupported(.continuousAutoExposure) { device.exposureMode = .continuousAutoExposure }

            let minFocusMM = Float(device.minimumFocusDistance)
            if minFocusMM > 0 {
                // The card's long side (88 mm) should fill ~70% of the frame's long side
                let fov = device.activeFormat.videoFieldOfView * .pi / 180
                let filled: Float = 88 / 0.7
                let distanceForFill = filled / (2 * tan(fov / 2))
                if distanceForFill < minFocusMM {
                    let zoom = min(CGFloat(minFocusMM / distanceForFill), device.activeFormat.videoMaxZoomFactor, 3)
                    device.videoZoomFactor = max(1, zoom)
                }
            }
            DebugScans.log("camera \(device.localizedName) min focus \(minFocusMM) mm, zoom \(device.videoZoomFactor), preset \(session.sessionPreset.rawValue)")
            device.unlockForConfiguration()
        } catch {}
    }

    // MARK: Finding the card
    //
    // Measured on a real iPhone 17 Pro Max (2026-11-08): detecting rectangles afresh in every frame
    // found the card in only ~1 frame in 3, and jumped between the card, the table edge and
    // shadows (outline moving 6–30% of the screen per frame) — so it could never be "steady".
    // Now, like Apple's own document scanner: find the card (Vision's document detector, which is
    // learned, plus the rectangle detector as a fallback), confirm it on a second frame, then
    // *track* it (Vision's rectangle tracker) so the outline stays on the card as the hand moves.

    private let sequence = VNSequenceRequestHandler()
    private var tracker: VNTrackRectangleRequest?
    private var pendingQuad: [CGPoint]?     // a detection waiting for the next frame to confirm it
    private var frameSize = CGSize(width: 2160, height: 3840)

    private static func corners(_ r: VNRectangleObservation) -> [CGPoint] { [r.topLeft, r.topRight, r.bottomRight, r.bottomLeft] }

    /// Card-shaped (63 × 88, allowing for tilt and sleeves) and big enough to read, in real pixels
    private func cardShaped(_ q: [CGPoint]) -> Bool {
        let px = q.map { CGPoint(x: $0.x * frameSize.width, y: $0.y * frameSize.height) }
        let d = { (a: CGPoint, b: CGPoint) in hypot(a.x - b.x, a.y - b.y) }
        let w = (d(px[0], px[1]) + d(px[3], px[2])) / 2, h = (d(px[0], px[3]) + d(px[1], px[2])) / 2
        guard w > 0, h > 0 else { return false }
        let aspect = Float(min(w, h) / max(w, h))
        let areaShare = (w * h) / (frameSize.width * frameSize.height)
        return aspect >= Self.cardAspect.min && aspect <= Self.cardAspect.max && areaShare >= 0.05 && areaShare <= 0.97
    }

    private func detect(_ pixels: CVPixelBuffer) -> VNRectangleObservation? {
        let doc = VNDetectDocumentSegmentationRequest()
        let rect = VNDetectRectanglesRequest()
        rect.minimumAspectRatio = Self.cardAspect.min
        rect.maximumAspectRatio = Self.cardAspect.max
        rect.minimumSize = 0.2
        rect.quadratureTolerance = 25
        rect.minimumConfidence = 0.5
        rect.maximumObservations = 6
        let handler = VNImageRequestHandler(cvPixelBuffer: pixels, orientation: .right, options: [:])
        try? handler.perform([doc, rect])
        if let d = (doc.results ?? []).first(where: { $0.confidence >= 0.5 && cardShaped(Self.corners($0)) }) { return d }
        // The largest card-shaped rectangle — never the art box or text box inside a card
        return (rect.results ?? []).filter { cardShaped(Self.corners($0)) }.max { area($0) < area($1) }
    }

    /// The card in this frame: followed by the tracker once found
    private func detectCard(_ pixels: CVPixelBuffer) -> [CGPoint]? {
        frameSize = CGSize(width: CVPixelBufferGetHeight(pixels), height: CVPixelBufferGetWidth(pixels))
        if let t = tracker {
            if (try? sequence.perform([t], on: pixels, orientation: .right)) != nil,
               let obs = t.results?.first as? VNRectangleObservation, obs.confidence >= 0.3, cardShaped(Self.corners(obs)) {
                t.inputObservation = obs
                return Self.corners(obs)
            }
            tracker = nil   // lost it — find it again
        }
        guard let obs = detect(pixels) else { pendingQuad = nil; return nil }
        let q = Self.corners(obs)
        // Confirmed by a second frame in the same place → start following it
        if let p = pendingQuad, zip(p, q).allSatisfy({ hypot($0.0.x - $0.1.x, $0.0.y - $0.1.y) < 0.04 }) {
            let t = VNTrackRectangleRequest(rectangleObservation: obs)
            t.trackingLevel = .accurate
            tracker = t
            pendingQuad = nil
            return q
        }
        pendingQuad = q
        return nil
    }

    private func area(_ r: VNRectangleObservation) -> CGFloat {
        let p = Self.corners(r)
        var a: CGFloat = 0
        for i in 0..<4 { let j = (i + 1) % 4; a += p[i].x * p[j].y - p[j].x * p[i].y }
        return abs(a) / 2
    }

    private static func center(_ q: [CGPoint]) -> CGPoint {
        CGPoint(x: q.map(\.x).reduce(0, +) / 4, y: q.map(\.y).reduce(0, +) / 4)
    }

    // MARK: Frames

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        let now = CACurrentMediaTime()
        guard !busy, !finished, now - lastFrameAt > 0.06, let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let dt = CGFloat(min(0.2, now - lastFrameAt))
        lastFrameAt = now
        let imageSize = CGSize(width: CVPixelBufferGetHeight(pixels), height: CVPixelBufferGetWidth(pixels)) // upright

        // Shutter with no card outline found: read the middle of the picture
        let found = detectCard(pixels)
        if found == nil && manualCapture && phase == .searching {
            manualCapture = false
            beginReading(CIImage(cvPixelBuffer: pixels).oriented(.right), quad: nil, imageSize: imageSize, now: now)
            return
        }

        // Track: smooth the outline; ride over a few missed frames instead of resetting
        var motion: CGFloat = 1
        if let q = found {
            if let last = rawQuad { motion = zip(q, last).map { hypot($0.0.x - $0.1.x, $0.0.y - $0.1.y) }.max() ?? 1 }
            rawQuad = q
            lastSeenAt = now
            if let s = smoothQuad, motion < 0.08 {
                smoothQuad = zip(s, q).map { CGPoint(x: $0.0.x * 0.45 + $0.1.x * 0.55, y: $0.0.y * 0.45 + $0.1.y * 0.55) }
            } else {
                smoothQuad = q
            }
        } else if now - lastSeenAt > Self.holdOver {
            smoothQuad = nil
            rawQuad = nil
        }
        let present = smoothQuad != nil && now - lastSeenAt <= Self.holdOver

        switch phase {
        case .reading:
            // More frames of text for the card being read, while the hands stay still (the motion
            // sensor — the outline's own jitter made it wait ~1.3 s and give up). Without an
            // outline, the same part of the frame as the first read.
            let still = self.motion.deviceMotion.map { m in
                sqrt(m.rotationRate.x * m.rotationRate.x + m.rotationRate.y * m.rotationRate.y + m.rotationRate.z * m.rotationRate.z) < 0.3
            } ?? true
            if still, let q = found ?? readingQuad {
                readMore(CIImage(cvPixelBuffer: pixels).oriented(.right), quad: q, now: now)
            } else if now - readingStarted > 0.8 {
                finishReading()
            }
            showOutline(present ? smoothQuad : nil, imageSize: imageSize, ring: 1, locked: true)
            return

        case .waitingForNext:
            // Ready for the next card once this one is gone — or swapped in place for a different one
            if !present && now - lastSeenAt > Self.goneAfter {
                nextIsSwap = false
                phase = .searching
            } else if let q = found {
                let c = Self.center(q)
                if hypot(c.x - lastScanCenter.x, c.y - lastScanCenter.y) > 0.25 {
                    phase = .searching
                } else if motion < Self.steadyMotion {
                    if steadySince == 0 { steadySince = now }
                    if now - steadySince > 0.7, now - lastSwapCheckAt > 0.6, let last = lastScanSignature {
                        lastSwapCheckAt = now
                        if let flat = flatten(CIImage(cvPixelBuffer: pixels).oriented(.right), quad: q),
                           let sig = PictureMatcher.signature(of: flat), PictureMatcher.distance(sig, last) > 0.65 {
                            // Same card under different glare measured 0.4–0.6 on the phone — a swap
                            // has to be clearly different, and is still dropped if it turns out to be
                            // the same card (applyResult)
                            DebugScans.log("different card in place — scanning it")
                            nextIsSwap = true
                            phase = .searching
                        }
                    }
                } else {
                    steadySince = 0
                }
            }
            if phase == .waitingForNext {
                showOutline(present ? smoothQuad : nil, imageSize: imageSize, ring: 0, locked: false)
                DispatchQueue.main.async { self.wantHint("Next card") }
                return
            }
            steadiness = 0

        case .searching:
            break
        }

        // Searching: fill the ring while the card is held steady (and the camera has focused)
        guard present, let quad = smoothQuad else {
            steadiness = max(0, steadiness - dt / 0.3)
            showOutline(nil, imageSize: imageSize, ring: 0, locked: false)
            DispatchQueue.main.async { self.wantHint("Point at a card") }
            return
        }
        let focusing = device?.isAdjustingFocus ?? false
        // How fast the phone is turning (rad/s); a still hand is well under 0.1
        let turning = self.motion.deviceMotion.map { m in
            CGFloat(sqrt(m.rotationRate.x * m.rotationRate.x + m.rotationRate.y * m.rotationRate.y + m.rotationRate.z * m.rotationRate.z))
        }
        let handsStill = turning.map { $0 < 0.22 } ?? (motion < Self.steadyMotion * 2)
        if DebugScans.enabled { recordStats(found: found != nil, motion: turning ?? motion, focusing: focusing, now: now) }
        if handsStill && !focusing {
            steadiness = min(1, steadiness + dt / Self.steadyTime)
        } else if !handsStill {
            steadiness = max(0, steadiness - dt / 0.35)
        }
        if !autoScanOnFrames { steadiness = 0 }
        let ready = manualCapture || (autoScanOnFrames && steadiness >= 1)
        showOutline(quad, imageSize: imageSize, ring: steadiness, locked: ready)
        let auto = autoScanOnFrames
        DispatchQueue.main.async { self.wantHint(focusing ? "Focusing…" : auto ? "Hold steady" : "Press the button to scan") }
        guard ready else { return }

        manualCapture = false
        steadiness = 0
        beginReading(CIImage(cvPixelBuffer: pixels).oriented(.right), quad: rawQuad ?? quad, imageSize: imageSize, now: now)
    }

    private func recordStats(found: Bool, motion: CGFloat, focusing: Bool, now: CFTimeInterval) {
        statFrames += 1
        if found { statFound += 1; statMotion.append(motion) }
        if focusing { statFocusing += 1 }
        guard now - statAt >= 1 else { return }
        let m = statMotion.sorted()
        let med = m.isEmpty ? -1 : m[m.count / 2]
        DebugScans.log(String(format: "frames %d, card found %d, focusing %d, turning median %.4f max %.4f, steadiness %.2f, phase %@, tracking %@, zoom %.2f",
                              statFrames, statFound, statFocusing, med, m.last ?? -1, steadiness, "\(phase)", tracker == nil ? "no" : "yes", device?.videoZoomFactor ?? 0))
        statFrames = 0; statFound = 0; statFocusing = 0; statMotion = []; statAt = now
    }

    // MARK: Reading the card

    private func beginReading(_ frame: CIImage, quad: [CGPoint]?, imageSize: CGSize, now: CFTimeInterval) {
        let flat: CGImage?
        var usedQuad: [CGPoint]?
        if let q = quad {
            flat = refined(frame, around: q) ?? flatten(frame, quad: q)
        } else {
            // The shutter with no outline: look for the card (or slab) in the middle of the frame,
            // and only fall back to a fixed card-shaped crop when nothing is found
            let found = centerCard(frame)
            usedQuad = found
            if let q = found {
                flat = flatten(frame, quad: q)
            } else {
                let e = frame.extent
                let h = e.height * 0.6, w = h * 63 / 88
                var crop = frame.cropped(to: CGRect(x: e.midX - w / 2, y: e.midY - h / 2, width: w, height: h))
                crop = crop.transformed(by: CGAffineTransform(translationX: -crop.extent.minX, y: -crop.extent.minY))
                let k = min(1, 1400 / crop.extent.height)
                if k < 1 { crop = crop.transformed(by: CGAffineTransform(scaleX: k, y: k)) }
                flat = ciContext.createCGImage(crop, from: crop.extent)
            }
        }
        readingQuad = quad ?? usedQuad
        guard let card = flat else { return }
        busy = true
        phase = .reading
        readingId = UUID().uuidString
        readingLines = []
        readingImage = nil
        finishGrids = []
        codeReadAt = nil
        readFlipped = false
        readingStarted = now
        lastScanCenter = quad.map(Self.center) ?? CGPoint(x: 0.5, y: 0.5)
        let id = readingId
        let preview = UIImage(cgImage: card)
        DispatchQueue.main.async {
            self.tap.impactOccurred()
            self.flash()
            self.showActive(id: id, image: preview, stage: "Reading the card…")
            self.wantHint("Scanning…", now: true)
        }
        readFrame(card)
        busy = false
        maybeFinish(now)
    }

    /// Done reading once the number is in (plus a few quick frames for the finish), or after the
    /// last try
    private func maybeFinish(_ now: CFTimeInterval) {
        if codeReadAt == nil, Self.hasCode(readingLines.last ?? []) { codeReadAt = now }
        if let t = codeReadAt, finishGrids.count >= 3 || now - t > 0.4 { finishReading(); return }
        if codeReadAt == nil, readingLines.count >= Self.maxReadFrames { finishReading() }
    }

    private func readMore(_ frame: CIImage, quad: [CGPoint], now: CFTimeInterval) {
        guard let card = flatten(frame, quad: quad) else { return }
        busy = true
        if codeReadAt != nil {
            // The number's in: just a quick frame for the finish (no reading)
            if let g = FinishSensor.grid(card) { finishGrids.append(readFlipped ? FinishSensor.flipped(g) : g) }
        } else {
            readFrame(card)
        }
        busy = false
        maybeFinish(now)
    }

    /// OCR one flattened frame (turned the right way up), keeping the best-oriented picture
    private func readFrame(_ card: CGImage) {
        let t0 = CACurrentMediaTime()
        var lines = readText(card)
        var upright = card
        // Upright text reads as plenty of confident lines; only a poor read is worth trying the
        // other way up (cards are almost always held the right way)
        let confident = lines.filter { (($0["c"] as? Float) ?? 0) >= 0.5 }.count
        if !Self.hasCode(lines), confident < 6, let flipped = rotate180(card) {
            let other = readText(flipped)
            if Self.hasCode(other) || Self.chars(other) > Self.chars(lines) * 3 / 2 {
                lines = other
                upright = flipped
            }
        }
        if readingImage == nil || Self.hasCode(lines) { readingImage = upright; readFlipped = upright !== card }
        readingLines.append(lines)
        if let g = FinishSensor.grid(upright) { finishGrids.append(g) }
        DebugScans.log("frame \(readingLines.count): \(lines.count) lines, code \(Self.hasCode(lines)), \(Int((CACurrentMediaTime() - t0) * 1000)) ms")
    }

    private func finishReading() {
        guard phase == .reading, let image = readingImage else { return }
        let id = readingId
        // Everything read across the frames, once each (lines from the frame that read the number
        // come first — their positions are the most trustworthy)
        var seen = Set<String>()
        var merged: [[String: Any]] = []
        let ordered = readingLines.sorted { Self.hasCode($0) && !Self.hasCode($1) }
        for frame in ordered {
            for l in frame {
                let t = (l["text"] as? String ?? "").trimmingCharacters(in: .whitespaces)
                if t.isEmpty || seen.contains(t) { continue }
                seen.insert(t)
                merged.append(l)
            }
        }
        // A graded slab: the picture to compare is the card inside it, not the label and plastic
        let slab = Self.isSlab(merged)
        // Self-check: the card's number sits along its bottom edge. Read well above it, the crop has
        // extra below the card (a toploader's end, the table) — find the card's edges again inside
        // it so the picture comparison sees just the card (the text was read fine either way)
        let codeY = merged.compactMap { l -> CGFloat? in
            guard let t = l["text"] as? String, let y = l["y"] as? CGFloat,
                  Self.codePattern.firstMatch(in: t, range: NSRange(t.startIndex..., in: t)) != nil else { return nil }
            return y
        }.max()
        let loose = !slab && (codeY.map { $0 < 0.8 } ?? false)
        let cardOnly = slab ? (cardInsideSlab(image) ?? image) : loose ? (tighten(image) ?? image) : image
        if loose { DebugScans.log("number read at \(String(format: "%.2f", codeY ?? 0)) of the height — crop tightened for the picture check") }
        let signature = PictureMatcher.signature(of: cardOnly)
        let tFp = CACurrentMediaTime()
        let fingerprints = CardFingerprinter.shared.fingerprints(of: cardOnly)
        if let fps = fingerprints { DebugScans.log("picture AI: \(fps.count) fingerprint(s) in \(Int((CACurrentMediaTime() - tFp) * 1000)) ms") }
        let swap = nextIsSwap
        nextIsSwap = false
        let thumb = Self.thumbnail(image)
        let photo = Self.resized(image, height: 760)
        if slab { DebugScans.log("graded slab — comparing the card inside it (\(cardOnly.width)×\(cardOnly.height))") }
        lastScanSignature = signature
        lastSwapCheckAt = CACurrentMediaTime()
        steadySince = 0
        phase = .waitingForNext
        let finish = FinishSensor.measure(finishGrids)
        DebugScans.log("read in \(Int((CACurrentMediaTime() - readingStarted) * 1000)) ms over \(readingLines.count) frame(s); finish \(FinishSensor.summary(finish))")
        DebugScans.save(scanId: id, image: image, info: [
            "frames": readingLines, "merged": merged, "ms": Int((CACurrentMediaTime() - readingStarted) * 1000), "finish": finish,
        ])

        DispatchQueue.main.async {
            // Almost no text: not a card (a bed, a table, a sleeve on its own) — nothing to add
            let words = merged.reduce(0) { $0 + (($1["text"] as? String)?.count ?? 0) }
            if merged.count < 3 || words < 15 {
                DebugScans.log("not a card (\(merged.count) lines, \(words) characters) — ignored")
                self.endActive(id: id, result: "No card there")
                self.notify.notificationOccurred(.warning)
                return
            }
            let item = ScanItem(id: id, thumbnail: thumb)
            item.fromSwap = swap
            item.signature = signature
            item.photo = photo
            if merged.isEmpty {
                item.status = "none"
                item.note = "No text read — hold it flatter, out of the glare"
                self.notify.notificationOccurred(.error)
            }
            self.items.insert(item, at: 0)
            self.tray.insertItems(at: [IndexPath(item: 0, section: 0)])
            self.tray.scrollToItem(at: IndexPath(item: 0, section: 0), at: .left, animated: true)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { self.updateTrayFade() }
            if merged.isEmpty {
                self.endActive(id: id, result: "Couldn’t read that card — try again")
            } else {
                self.setStage("Finding the card…", for: id)
                self.onScanned?(id, merged, fingerprints)
            }
        }
    }

    /// At capture, find the card's exact edges again in a slightly bigger crop around the tracked
    /// outline: the tracker drifts (real scans came out with the top cut off and table showing), and
    /// a toploader's edge can stand in for the card's. Nil if nothing better is found.
    /// The frame shrunk so the card comes out no taller than it's needed (~1600 px): perspective
    /// correction on a full 4K frame cost several hundred ms a scan
    private func shrunk(_ frame: CIImage, quad: [CGPoint]) -> CIImage {
        let ys = quad.map(\.y), xs = quad.map(\.x)
        let tall = max((ys.max()! - ys.min()!) * frame.extent.height, (xs.max()! - xs.min()!) * frame.extent.width)
        let k = min(1, 1600 / max(tall, 1))
        guard k < 0.98 else { return frame }
        return frame.transformed(by: CGAffineTransform(scaleX: k, y: k))
    }

    private func refined(_ frame: CIImage, around quad: [CGPoint]) -> CGImage? {
        let frame = shrunk(frame, quad: quad)
        // A graded slab is taller and thinner than a card (PSA ≈ 0.58 wide-to-tall, a card 0.72):
        // keep it whole — its label names the card and the grade (the card inside is cut out later)
        if quadAspect(quad) < 0.64 { return nil }
        let c = Self.center(quad)
        let wide = quad.map { CGPoint(x: c.x + ($0.x - c.x) * 1.18, y: c.y + ($0.y - c.y) * 1.18) }
        guard let region = flattenExact(frame, quad: wide) else { return nil }
        let request = VNDetectRectanglesRequest()
        request.minimumAspectRatio = Self.cardAspect.min
        request.maximumAspectRatio = Self.cardAspect.max
        request.minimumSize = 0.5
        request.quadratureTolerance = 15
        request.maximumObservations = 6
        try? VNImageRequestHandler(cgImage: region, options: [:]).perform([request])
        // The card fills most of the enlarged crop (a card in a toploader ~75% of its height); a
        // card that fills much less is a card inside a slab — keep the slab
        let best = (request.results ?? []).filter { r in
            let b = r.boundingBox
            let share = b.width * b.height
            return share > 0.5 && share < 0.95 && b.height > 0.68
        }.max { area($0) < area($1) }
        guard let r = best else { return nil }
        return flatten(CIImage(cgImage: region), quad: Self.corners(r))
    }

    /// Width ÷ height of an outline in real pixels (≤ 1)
    private func quadAspect(_ q: [CGPoint]) -> CGFloat {
        let px = q.map { CGPoint(x: $0.x * frameSize.width, y: $0.y * frameSize.height) }
        let d = { (a: CGPoint, b: CGPoint) in hypot(a.x - b.x, a.y - b.y) }
        let w = (d(px[0], px[1]) + d(px[3], px[2])) / 2, h = (d(px[0], px[3]) + d(px[1], px[2])) / 2
        return min(w, h) / max(max(w, h), 1)
    }

    /// Perspective-corrects exactly the given outline (no margin, no rotation, no scaling)
    private func flattenExact(_ image: CIImage, quad: [CGPoint]) -> CGImage? {
        let size = image.extent.size
        let p = quad.map { CIVector(x: $0.x * size.width + image.extent.minX, y: $0.y * size.height + image.extent.minY) }
        guard let filter = CIFilter(name: "CIPerspectiveCorrection") else { return nil }
        filter.setValue(image, forKey: kCIInputImageKey)
        filter.setValue(p[0], forKey: "inputTopLeft")
        filter.setValue(p[1], forKey: "inputTopRight")
        filter.setValue(p[2], forKey: "inputBottomRight")
        filter.setValue(p[3], forKey: "inputBottomLeft")
        guard let out = filter.outputImage else { return nil }
        return ciContext.createCGImage(out, from: out.extent)
    }

    /// The card, straight on and upright, ~1400 px tall. The outline is pushed out 1.5% so a
    /// slightly tight detection doesn't clip the number line along the edge.
    private func flatten(_ image: CIImage, quad: [CGPoint]) -> CGImage? {
        let image = shrunk(image, quad: quad)
        let size = image.extent.size
        let c = Self.center(quad)
        let grown = quad.map { CGPoint(x: c.x + ($0.x - c.x) * 1.015, y: c.y + ($0.y - c.y) * 1.015) }
        // Vision's points are 0–1 from the bottom-left, the same corner Core Image measures from
        let p = grown.map { CIVector(x: $0.x * size.width + image.extent.minX, y: $0.y * size.height + image.extent.minY) }
        guard let filter = CIFilter(name: "CIPerspectiveCorrection") else { return nil }
        filter.setValue(image, forKey: kCIInputImageKey)
        filter.setValue(p[0], forKey: "inputTopLeft")
        filter.setValue(p[1], forKey: "inputTopRight")
        filter.setValue(p[2], forKey: "inputBottomRight")
        filter.setValue(p[3], forKey: "inputBottomLeft")
        guard var out = filter.outputImage else { return nil }
        // Held sideways → turn it to portrait (upside down is fixed after reading the text)
        if out.extent.width > out.extent.height { out = out.oriented(.right) }
        let scale = min(1, 1400 / out.extent.height)
        if scale < 1 { out = out.transformed(by: CGAffineTransform(scaleX: scale, y: scale)) }
        return ciContext.createCGImage(out, from: out.extent)
    }

    /// The shutter with no outline: the biggest card- or slab-shaped outline around the middle of
    /// the frame (looser than the live detector — the person has told us a card is there)
    private func centerCard(_ frame: CIImage) -> [CGPoint]? {
        guard let cg = ciContext.createCGImage(frame.transformed(by: CGAffineTransform(scaleX: 0.4, y: 0.4)), from: frame.transformed(by: CGAffineTransform(scaleX: 0.4, y: 0.4)).extent) else { return nil }
        let request = VNDetectRectanglesRequest()
        request.minimumAspectRatio = 0.5
        request.maximumAspectRatio = 0.9
        request.minimumSize = 0.15
        request.quadratureTolerance = 25
        request.minimumConfidence = 0.3
        request.maximumObservations = 8
        try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
        let best = (request.results ?? []).filter { r in
            let b = r.boundingBox
            return b.contains(CGPoint(x: 0.5, y: 0.5)) && b.width * b.height > 0.06
        }.max { area($0) < area($1) }
        return best.map { Self.corners($0) }
    }

    /// The card inside a crop that has extra around it: the largest card-shaped outline filling
    /// 35–92% of it. Nil when nothing better is found.
    private func tighten(_ image: CGImage) -> CGImage? {
        let request = VNDetectRectanglesRequest()
        request.minimumAspectRatio = Self.cardAspect.min
        request.maximumAspectRatio = Self.cardAspect.max
        request.minimumSize = 0.45
        request.quadratureTolerance = 15
        request.maximumObservations = 6
        try? VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        let best = (request.results ?? []).filter { r in
            let share = r.boundingBox.width * r.boundingBox.height
            return share > 0.35 && share < 0.92
        }.max { area($0) < area($1) }
        guard let r = best else { return nil }
        return flatten(CIImage(cgImage: image), quad: Self.corners(r))
    }

    /// A grading company's label along the top: a cert number or a grade word up there
    private static let slabPattern = try! NSRegularExpression(
        pattern: "^(\\d{7,10}|#\\s?[A-Z]{0,4}\\d{1,4}[a-z]?|GEM\\s?MT.*|GEM\\s?MINT.*|MINT.*|NM-MT.*|EX-MT.*|PRISTINE.*|AUTHENTIC.*)$", options: [.caseInsensitive])
    private static func isSlab(_ lines: [[String: Any]]) -> Bool {
        let hits = lines.filter { l in
            guard let t = (l["text"] as? String)?.trimmingCharacters(in: .whitespaces), let y = l["y"] as? CGFloat, y < 0.3 else { return false }
            return slabPattern.firstMatch(in: t, range: NSRange(t.startIndex..., in: t)) != nil
        }
        return hits.count >= 2
    }

    /// The card inside a flattened slab: the largest card-shaped outline below the label, or — if
    /// the plastic hides its edges — the part of the slab a card sits in (PSA / CGC / BGS slabs
    /// all put the label in the top ~22%)
    private func cardInsideSlab(_ slab: CGImage) -> CGImage? {
        let W = CGFloat(slab.width), H = CGFloat(slab.height)
        let request = VNDetectRectanglesRequest()
        request.minimumAspectRatio = Self.cardAspect.min
        request.maximumAspectRatio = Self.cardAspect.max
        request.minimumSize = 0.5
        request.quadratureTolerance = 15
        request.maximumObservations = 6
        try? VNImageRequestHandler(cgImage: slab, options: [:]).perform([request])
        let inside = (request.results ?? []).filter { r in
            let b = r.boundingBox  // bottom-left origin
            return b.maxY < 0.86 && b.height > 0.55 && b.height < 0.84
        }.max { $0.boundingBox.width * $0.boundingBox.height < $1.boundingBox.width * $1.boundingBox.height }
        let ci = CIImage(cgImage: slab)
        if let r = inside, let flat = flatten(ci, quad: Self.corners(r)) { return flat }
        let crop = CGRect(x: W * 0.03, y: H * 0.015, width: W * 0.94, height: H * 0.76)  // Core Image: bottom-left origin
        return ciContext.createCGImage(ci, from: crop)
    }

    private func readText(_ image: CGImage) -> [[String: Any]] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false   // card numbers and set codes aren't words
        request.minimumTextHeight = 0.008
        var languages = ["en-US"]
        if #available(iOS 16.0, *) {
            request.revision = VNRecognizeTextRequestRevision3
            if let supported = try? request.supportedRecognitionLanguages(), supported.contains("ja-JP") {
                languages.append("ja-JP")
            }
            // Without this, Japanese cards come back as nonsense Latin/Cyrillic (0 of 30 Japanese
            // cards read in testing; 30 of 30 with it), and English numbers read just as well
            request.automaticallyDetectsLanguage = true
        }
        request.recognitionLanguages = languages
        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        try? handler.perform([request])
        return (request.results ?? []).compactMap { obs in
            guard let top = obs.topCandidates(1).first, top.confidence >= 0.3 else { return nil }
            let b = obs.boundingBox  // 0–1 from the bottom-left
            return ["text": top.string, "x": b.minX, "y": 1 - b.maxY, "w": b.width, "h": b.height, "c": top.confidence]
        }
    }

    private static let codePattern = try! NSRegularExpression(
        pattern: "\\b[A-Z0-9]{2,5}-[A-Z]{0,2}[0-9O]{3}\\b|\\b[A-Z]{3}[0-9O]{3}\\b|\\b[A-Z]{2,3}[0-9]{1,2}-[0-9O]{2}\\b|\\d{1,3}\\s?/\\s?\\d{2,3}|\\b(OP|ST|EB|PRB)[0-9O]{2}\\s?-\\s?[0-9O]{3}|\\b[A-Z0-9]{3,4}\\s?[•·*]\\s?EN\\b|\\bSWSH\\d|\\bP-\\d{3}|\\d{3}/[A-Za-z]{1,4}-?P")
    private static func hasCode(_ lines: [[String: Any]]) -> Bool {
        lines.contains { l in
            guard let t = l["text"] as? String else { return false }
            return codePattern.firstMatch(in: t, range: NSRange(t.startIndex..., in: t)) != nil
        }
    }
    private static func chars(_ lines: [[String: Any]]) -> Int {
        lines.reduce(0) { $0 + (($1["text"] as? String)?.count ?? 0) }
    }

    private func rotate180(_ image: CGImage) -> CGImage? {
        let ci = CIImage(cgImage: image).oriented(.down)
        return ciContext.createCGImage(ci, from: ci.extent)
    }

    private static func resized(_ image: CGImage, height: CGFloat) -> UIImage {
        let full = UIImage(cgImage: image)
        let h = min(height, CGFloat(image.height)), w = h * CGFloat(image.width) / CGFloat(image.height)
        return UIGraphicsImageRenderer(size: CGSize(width: w, height: h)).image { _ in full.draw(in: CGRect(x: 0, y: 0, width: w, height: h)) }
    }

    private static func thumbnail(_ image: CGImage) -> UIImage {
        let full = UIImage(cgImage: image)
        let target = CGSize(width: 172, height: 240)
        return UIGraphicsImageRenderer(size: target).image { _ in full.draw(in: CGRect(origin: .zero, size: target)) }
    }

    // MARK: Results from the site

    func signature(for scanId: String) -> PictureMatcher.Signature? {
        items.first { $0.id == scanId }?.signature
    }

    func applyResult(scanId: String, status: String, options: [TrayOption], choice: Int, note: String?, slab: SlabGrade?) {
        guard let index = items.firstIndex(where: { $0.id == scanId }) else { return }
        let item = items[index]
        // Not sure enough to show — not added; ask for another scan
        if status == "reject" {
            DebugScans.saveResult(scanId: scanId, info: ["status": "reject", "options": options.prefix(5).map { ["title": $0.title, "detail": $0.detail] }])
            DebugScans.log("not sure — rejected: \(options.first.map { "\($0.title) [\($0.detail)]" } ?? "nothing")")
            items.remove(at: index)
            tray.deleteItems(at: [IndexPath(item: index, section: 0)])
            refreshDone()
            updateTrayFade()
            notify.notificationOccurred(.warning)
            endActive(id: scanId, result: "Not sure — scan again")
            wantHint("Not sure — scan again", now: true)
            frameQueue.async { if self.phase == .waitingForNext { self.phase = .searching } }
            return
        }
        item.slab = slab
        // A "swap" that turned out to be the card already scanned: not a second copy
        if item.fromSwap, let key = options.first?.key, !key.isEmpty, items.count > index + 1 {
            let previous = items[index + 1]
            if previous.options.indices.contains(previous.choice), previous.options[previous.choice].key == key {
                DebugScans.log("same card as the last scan — dropped")
                items.remove(at: index)
                tray.deleteItems(at: [IndexPath(item: index, section: 0)])
                endActive(id: scanId, result: "Same card — take it away to scan another copy")
                refreshDone()
                return
            }
        }
        item.status = options.isEmpty && status != "error" ? "none" : status
        item.options = options
        item.choice = max(0, min(choice, max(0, options.count - 1)))
        item.note = note
        tray.reloadItems(at: [IndexPath(item: index, section: 0)])
        refreshDone()
        let top = options.first
        switch item.status {
        case "matched":
            notify.notificationOccurred(.success)
            endActive(id: scanId, result: "✓ \(top?.title ?? "")\n\(top?.subtitle ?? "")")
        case "pick":
            notify.notificationOccurred(.warning)
            endActive(id: scanId, result: "Pick one — tap it in the tray\nBest guess: \(top?.title ?? "")")
        default:
            notify.notificationOccurred(.error)
            endActive(id: scanId, result: note ?? "Not found")
        }
        DebugScans.saveResult(scanId: scanId, info: [
            "status": item.status,
            "options": options.prefix(12).map { ["title": $0.title, "subtitle": $0.subtitle, "detail": $0.detail] },
        ])
        DebugScans.log("result \(item.status): \(top.map { "\($0.title) — \($0.subtitle) [\($0.detail)]" } ?? "nothing")")
    }

    // MARK: On-screen feedback

    /// The card outline (smoothed) and the steadiness ring around it
    private func showOutline(_ quad: [CGPoint]?, imageSize: CGSize, ring: CGFloat, locked: Bool) {
        DispatchQueue.main.async {
            guard let quad = quad else {
                self.outlineLayer.path = nil
                self.ringLayer.path = nil
                return
            }
            let path = self.path(for: quad, imageSize: imageSize)
            CATransaction.begin()
            CATransaction.setAnimationDuration(0.08)
            CATransaction.setAnimationTimingFunction(CAMediaTimingFunction(name: .linear))
            self.outlineLayer.path = path
            self.ringLayer.path = path
            self.ringLayer.strokeEnd = ring
            self.outlineLayer.strokeColor = (locked ? Self.gold : UIColor(white: 1, alpha: 0.85)).cgColor
            CATransaction.commit()
        }
    }

    private var lastPath: CGPath?
    private func path(for quad: [CGPoint], imageSize: CGSize) -> CGPath {
        let bounds = view.bounds
        let scale = max(bounds.width / imageSize.width, bounds.height / imageSize.height)
        let dx = (imageSize.width * scale - bounds.width) / 2
        let dy = (imageSize.height * scale - bounds.height) / 2
        let pts = quad.map { CGPoint(x: $0.x * imageSize.width * scale - dx, y: (1 - $0.y) * imageSize.height * scale - dy) }
        // Start at the top-left corner and go clockwise, so the ring fills like a clock
        let path = UIBezierPath()
        path.move(to: pts[0])
        for p in pts.dropFirst() { path.addLine(to: p) }
        path.close()
        lastPath = path.cgPath
        return path.cgPath
    }

    private func flash() {
        guard let p = lastPath else { return }
        flashLayer.path = p
        let a = CABasicAnimation(keyPath: "opacity")
        a.fromValue = 0.7
        a.toValue = 0
        a.duration = 0.35
        flashLayer.add(a, forKey: "flash")
    }

    private func showActive(id: String, image: UIImage, stage: String) {
        activeId = id
        activeImage.image = image
        activeStage.text = stage
        if activeCard.isHidden {
            activeCard.alpha = 0
            activeCard.isHidden = false
            UIView.animate(withDuration: 0.2) { self.activeCard.alpha = 1 }
        }
        activeBeam.frame = CGRect(x: 0, y: -24, width: 64, height: 24)
        let sweep = CABasicAnimation(keyPath: "position.y")
        sweep.fromValue = -12
        sweep.toValue = 89 + 12
        sweep.duration = 0.9
        sweep.repeatCount = .infinity
        activeBeam.isHidden = false
        activeBeam.add(sweep, forKey: "sweep")
    }

    func setStage(_ stage: String, for id: String) {
        guard activeId == id else { return }
        activeStage.text = stage
    }

    /// Work on this card is over: stop the scan line, show the answer briefly
    private func endActive(id: String, result: String) {
        guard activeId == id else { return }
        activeBeam.removeAnimation(forKey: "sweep")
        activeBeam.isHidden = true
        activeStage.text = result
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) {
            guard self.activeId == id else { return }
            UIView.animate(withDuration: 0.25, animations: { self.activeCard.alpha = 0 }) { _ in
                if self.activeId == id { self.activeCard.isHidden = true; self.activeId = nil }
            }
        }
    }

    // MARK: Tray

    func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int { items.count }

    func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
        let cell = collectionView.dequeueReusableCell(withReuseIdentifier: "card", for: indexPath) as! TrayCell
        cell.show(items[indexPath.item])
        return cell
    }

    /// Tapping a card in the tray: View Card (the card sheet) or Remove Card
    func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
        let item = items[indexPath.item]
        let o = item.options.indices.contains(item.choice) ? item.options[item.choice] : nil
        var lines = [o?.subtitle].compactMap { $0 }
        if let p = item.currentPrinting, (o?.printings.count ?? 0) > 1 {
            lines.append("Finish: \(p.label)\(p.price.isEmpty ? "" : " · \(p.price)")\(item.printing == nil ? " (default — change it in View Card)" : "")")
        }
        if item.slab == nil {
            let names = ["lightly_played": "Lightly Played", "moderately_played": "Moderately Played", "heavily_played": "Heavily Played"]
            lines.append("Condition: \(item.condition.flatMap { names[$0] } ?? "Near Mint")")
        }
        let menu = UIAlertController(title: o?.title ?? "Scanned card", message: lines.joined(separator: "\n"), preferredStyle: .actionSheet)
        menu.addAction(UIAlertAction(title: "View Card", style: .default) { _ in self.openSheet(for: item) })
        menu.addAction(UIAlertAction(title: "Remove Card", style: .destructive) { _ in self.remove(item) })
        menu.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        if let pop = menu.popoverPresentationController, let cell = collectionView.cellForItem(at: indexPath) {
            pop.sourceView = cell
            pop.sourceRect = cell.bounds
        }
        present(menu, animated: true)
    }

    private func remove(_ item: ScanItem) {
        guard let i = items.firstIndex(where: { $0 === item }) else { return }
        items.remove(at: i)
        tray.deleteItems(at: [IndexPath(item: i, section: 0)])
        refreshDone()
        updateTrayFade()
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    private func openSheet(for item: ScanItem) {
        let sheet = CardSheetViewController(item: item, scanner: self)
        sheet.onChange = { [weak self] in
            guard let self = self, let i = self.items.firstIndex(where: { $0 === item }) else { return }
            self.tray.reloadItems(at: [IndexPath(item: i, section: 0)])
            self.refreshDone()
        }
        sheet.onRemove = { [weak self] in self?.remove(item) }
        if let pres = sheet.sheetPresentationController {
            pres.detents = [.large()]
            pres.prefersGrabberVisible = true
            pres.preferredCornerRadius = 24
        }
        present(sheet, animated: true)
    }
}

// MARK: - Finish detection (measuring)
//
// Foil differs from printed ink in two ways a camera sees: fine rainbow speckle (colour texture,
// where ink only has light/dark texture) and shimmer — it catches the light differently from frame
// to frame as the hand moves, while ink stays put. Where the foil is names the finish: the picture
// (Holo), everywhere but the picture (Reverse Holo), the whole card (Foil). These numbers are
// measured on every scan and kept with it; the rules come from real scans of cards whose finish is
// known (docs/card-scanner.md "Finish detection").

enum FinishSensor {
    static let w = 96, h = 134

    /// RGB planes of a small copy of the flattened card
    static func grid(_ image: CGImage) -> [Float]? {
        let n = w * h
        var px = [UInt8](repeating: 0, count: n * 4)
        let ok: Bool = px.withUnsafeMutableBytes { buf in
            guard let c = CGContext(data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            c.interpolationQuality = .medium
            c.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        guard ok else { return nil }
        var out = [Float](repeating: 0, count: n * 3)
        for i in 0..<n { out[i] = Float(px[i * 4]); out[n + i] = Float(px[i * 4 + 1]); out[2 * n + i] = Float(px[i * 4 + 2]) }
        return out
    }

    /// The same grid turned upside down
    static func flipped(_ g: [Float]) -> [Float] {
        let n = w * h
        var out = g
        for p in 0..<3 { for i in 0..<n { out[p * n + i] = g[p * n + (n - 1 - i)] } }
        return out
    }

    /// Regions of the upright card: the picture window (Pokémon's sits in the top half), the text
    /// box, and the whole card inside its border — as (x0, y0, x1, y1) fractions, y from the top
    static let regions: [(String, (Float, Float, Float, Float))] = [
        ("art", (0.10, 0.12, 0.90, 0.48)),
        ("text", (0.08, 0.58, 0.92, 0.86)),
        ("whole", (0.05, 0.05, 0.95, 0.95)),
    ]

    static func measure(_ grids: [[Float]]) -> [String: Any] {
        guard let first = grids.first else { return [:] }
        let n = w * h
        // luminance and the two colour-difference channels
        func ycc(_ g: [Float]) -> ([Float], [Float], [Float]) {
            var y = [Float](repeating: 0, count: n), cb = y, cr = y
            for i in 0..<n {
                let r = g[i], gg = g[n + i], b = g[2 * n + i]
                y[i] = 0.299 * r + 0.587 * gg + 0.114 * b
                cb[i] = b - y[i]; cr[i] = r - y[i]
            }
            return (y, cb, cr)
        }
        let planes = grids.map(ycc)
        let (y0, cb0, cr0) = planes[0]
        _ = first
        var out: [String: Any] = ["frames": grids.count]
        for (name, (fx0, fy0, fx1, fy1)) in regions {
            let x0 = max(1, Int(fx0 * Float(w))), x1 = min(w - 1, Int(fx1 * Float(w)))
            let y0r = max(1, Int(fy0 * Float(h))), y1r = min(h - 1, Int(fy1 * Float(h)))
            var lumTex: Float = 0, chromaTex: Float = 0, sat: Float = 0, shimmer: Float = 0, lumShimmer: Float = 0, cnt: Float = 0
            for yy in y0r..<y1r {
                for xx in x0..<x1 {
                    let i = yy * w + xx
                    func lap(_ a: [Float]) -> Float { abs(4 * a[i] - a[i - 1] - a[i + 1] - a[i - w] - a[i + w]) }
                    lumTex += lap(y0); chromaTex += lap(cb0) + lap(cr0)
                    sat += (cb0[i] * cb0[i] + cr0[i] * cr0[i]).squareRoot()
                    if planes.count >= 2 {
                        // frame-to-frame change of colour (and of brightness, to tell shimmer from
                        // the whole picture shifting)
                        var mcb: Float = 0, mcr: Float = 0, my: Float = 0
                        for p in planes { mcb += p.1[i]; mcr += p.2[i]; my += p.0[i] }
                        let k = Float(planes.count); mcb /= k; mcr /= k; my /= k
                        var vc: Float = 0, vy: Float = 0
                        for p in planes { vc += (p.1[i] - mcb) * (p.1[i] - mcb) + (p.2[i] - mcr) * (p.2[i] - mcr); vy += (p.0[i] - my) * (p.0[i] - my) }
                        shimmer += (vc / k).squareRoot(); lumShimmer += (vy / k).squareRoot()
                    }
                    cnt += 1
                }
            }
            out[name] = [
                "lumTex": lumTex / cnt, "chromaTex": chromaTex / cnt, "sat": sat / cnt,
                "shimmer": shimmer / cnt, "lumShimmer": lumShimmer / cnt,
            ]
        }
        return out
    }

    static func summary(_ m: [String: Any]) -> String {
        func f(_ r: String, _ k: String) -> String {
            String(format: "%.1f", ((m[r] as? [String: Float])?[k]) ?? -1)
        }
        return "frames \(m["frames"] ?? 0) · colour texture art \(f("art", "chromaTex")) text \(f("text", "chromaTex")) · shimmer art \(f("art", "shimmer")) text \(f("text", "shimmer"))"
    }
}

// MARK: - Graded slabs (the same look as the Cardex — CardexPage.tsx SlabTileOverlay / FullSlab)

struct SlabGrade {
    var company: String
    var grade: String
    var cert: String = ""
}

/// Label colours roughly matching each grader's real label (CardexPage.tsx SLAB_LABEL)
enum SlabStyle {
    static func colors(_ company: String) -> (bg: UIColor, fg: UIColor, accent: UIColor) {
        func hex(_ h: UInt32) -> UIColor { UIColor(red: CGFloat((h >> 16) & 255) / 255, green: CGFloat((h >> 8) & 255) / 255, blue: CGFloat(h & 255) / 255, alpha: 1) }
        switch company.uppercased() {
        case "PSA": return (hex(0xffffff), hex(0x1a1a1a), hex(0xc8102e))
        case "BGS": return (hex(0xd9dce1), hex(0x111827), hex(0x9a7b2f))
        case "CGC": return (hex(0x1f3a68), hex(0xffffff), hex(0x8fb3e8))
        case "SGC": return (hex(0x141414), hex(0xffffff), hex(0xd4af37))
        case "TAG": return (hex(0x0b0b0b), hex(0xe5e5e5), hex(0x9ca3af))
        default: return (hex(0x374151), hex(0xffffff), hex(0x9ca3af))
        }
    }

    /// The word each grader prints next to the number ("MINT 9", "GEM MT 10") — CardexPage.tsx gradeWord
    static func word(_ company: String, _ grade: String) -> String {
        guard let n = Double(grade) else { return grade.uppercased() }
        if company.uppercased() == "PSA" {
            let psa: [Double: String] = [10: "GEM MT", 9: "MINT", 8: "NM-MT", 7: "NM", 6: "EX-MT", 5: "EX", 4: "VG-EX", 3: "VG", 2: "GOOD", 1.5: "FR", 1: "PR"]
            return psa[n] ?? ""
        }
        if n >= 10 { return "PRISTINE" }
        if n >= 9.5 { return "GEM MINT" }
        if n >= 9 { return "MINT" }
        if n >= 8 { return "NM-MT" }
        if n >= 7 { return "NM" }
        return ""
    }
}

/// The tray tile's slab: a clear acrylic rim, and the grade band across the top
final class SlabTileOverlay: UIView {
    private let band = UIView()
    private let company = UILabel()
    private let grade = UILabel()
    private let rim = CAShapeLayer()
    private let sheen = CAGradientLayer()

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        sheen.colors = [UIColor(white: 1, alpha: 0.28).cgColor, UIColor(white: 1, alpha: 0).cgColor, UIColor(white: 1, alpha: 0).cgColor, UIColor(white: 1, alpha: 0.14).cgColor]
        sheen.locations = [0, 0.32, 0.68, 1]
        sheen.startPoint = CGPoint(x: 0, y: 0); sheen.endPoint = CGPoint(x: 1, y: 1)
        layer.addSublayer(sheen)
        rim.fillColor = UIColor.clear.cgColor
        rim.strokeColor = UIColor(white: 1, alpha: 0.8).cgColor
        rim.lineWidth = 2
        layer.addSublayer(rim)
        company.font = .systemFont(ofSize: 10, weight: .black)
        grade.font = .systemFont(ofSize: 11, weight: .black)
        band.layer.cornerRadius = 4
        band.layer.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]
        for v in [company, grade] { v.translatesAutoresizingMaskIntoConstraints = false; band.addSubview(v) }
        band.translatesAutoresizingMaskIntoConstraints = false
        addSubview(band)
        NSLayoutConstraint.activate([
            band.topAnchor.constraint(equalTo: topAnchor, constant: 2),
            band.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 2),
            band.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -2),
            band.heightAnchor.constraint(equalTo: heightAnchor, multiplier: 0.15),
            company.leadingAnchor.constraint(equalTo: band.leadingAnchor, constant: 5),
            company.centerYAnchor.constraint(equalTo: band.centerYAnchor),
            grade.trailingAnchor.constraint(equalTo: band.trailingAnchor, constant: -5),
            grade.centerYAnchor.constraint(equalTo: band.centerYAnchor),
        ])
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func layoutSubviews() {
        super.layoutSubviews()
        sheen.frame = bounds
        rim.path = UIBezierPath(roundedRect: bounds.insetBy(dx: 1, dy: 1), cornerRadius: 5).cgPath
        band.layoutIfNeeded()
        band.layer.sublayers?.first { $0.name == "accent" }?.frame = CGRect(x: 0, y: band.bounds.height - 2, width: band.bounds.width, height: 2)
    }

    func show(_ slab: SlabGrade) {
        let c = SlabStyle.colors(slab.company)
        band.backgroundColor = c.bg.withAlphaComponent(0.92)
        band.layer.borderColor = c.accent.cgColor
        band.layer.borderWidth = 0
        company.text = slab.company.uppercased()
        company.textColor = c.accent
        grade.text = slab.grade
        grade.textColor = c.fg
        let bottom = band.layer.sublayers?.first { $0.name == "accent" } ?? {
            let l = CALayer(); l.name = "accent"; band.layer.addSublayer(l); return l
        }()
        bottom.backgroundColor = c.accent.cgColor
        bottom.frame = CGRect(x: 0, y: band.bounds.height - 2, width: band.bounds.width, height: 2)
        setNeedsLayout()
    }
}

/// The card sheet's slab: the whole graded case — clear acrylic shell, the grader's label with the
/// big grade number, and the card in its window below
final class FullSlabView: UIView {
    let cardWindow = UIView()
    private let label = UIView()
    private let setLine = UILabel()
    private let nameLine = UILabel()
    private let badge = PaddedLabel()
    private let numberLine = UILabel()
    private let word = UILabel()
    private let grade = UILabel()
    private let barcode = UIStackView()
    private let shell = CAGradientLayer()

    override init(frame: CGRect) {
        super.init(frame: frame)
        layer.cornerRadius = 18
        clipsToBounds = true
        shell.colors = [UIColor(red: 0.92, green: 0.96, blue: 1, alpha: 0.20).cgColor, UIColor(red: 0.86, green: 0.91, blue: 0.96, alpha: 0.07).cgColor,
                        UIColor(red: 0.86, green: 0.91, blue: 0.96, alpha: 0.04).cgColor, UIColor(red: 0.92, green: 0.96, blue: 1, alpha: 0.15).cgColor]
        shell.locations = [0, 0.32, 0.68, 1]
        shell.startPoint = CGPoint(x: 0.2, y: 0); shell.endPoint = CGPoint(x: 0.8, y: 1)
        layer.addSublayer(shell)
        layer.borderWidth = 2
        layer.borderColor = UIColor(white: 1, alpha: 0.75).cgColor

        label.layer.cornerRadius = 6
        label.clipsToBounds = true
        label.layer.borderWidth = 2
        setLine.font = .systemFont(ofSize: 10, weight: .semibold)
        nameLine.font = .systemFont(ofSize: 14, weight: .heavy)
        nameLine.adjustsFontSizeToFitWidth = true
        nameLine.minimumScaleFactor = 0.6
        badge.font = .italicSystemFont(ofSize: 11)
        badge.font = UIFont(descriptor: UIFont.systemFont(ofSize: 11, weight: .black).fontDescriptor.withSymbolicTraits(.traitItalic) ?? UIFont.systemFont(ofSize: 11).fontDescriptor, size: 11)
        badge.insets = UIEdgeInsets(top: 1, left: 4, bottom: 1, right: 4)
        badge.layer.cornerRadius = 2
        badge.clipsToBounds = true
        numberLine.font = .systemFont(ofSize: 10, weight: .semibold)
        word.font = .systemFont(ofSize: 11, weight: .heavy)
        word.textAlignment = .right
        grade.font = .systemFont(ofSize: 40, weight: .black)
        grade.textAlignment = .right
        barcode.axis = .horizontal
        barcode.spacing = 1
        barcode.alignment = .fill

        let badgeRow = UIStackView(arrangedSubviews: [badge, numberLine])
        badgeRow.spacing = 6
        badgeRow.alignment = .center
        let left = UIStackView(arrangedSubviews: [setLine, nameLine, badgeRow])
        left.axis = .vertical
        left.spacing = 2
        left.alignment = .leading
        let right = UIStackView(arrangedSubviews: [word, grade, barcode])
        right.axis = .vertical
        right.alignment = .trailing
        right.spacing = 0
        for v in [left, right] { v.translatesAutoresizingMaskIntoConstraints = false; label.addSubview(v) }

        cardWindow.layer.cornerRadius = 8
        cardWindow.layer.borderWidth = 1
        cardWindow.layer.borderColor = UIColor(white: 1, alpha: 0.45).cgColor
        cardWindow.backgroundColor = UIColor(red: 0.78, green: 0.84, blue: 0.91, alpha: 0.05)
        for v in [label, cardWindow] { v.translatesAutoresizingMaskIntoConstraints = false; addSubview(v) }
        NSLayoutConstraint.activate([
            label.topAnchor.constraint(equalTo: topAnchor, constant: 12),
            label.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12),
            label.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12),
            label.heightAnchor.constraint(equalTo: heightAnchor, multiplier: 0.17),
            left.leadingAnchor.constraint(equalTo: label.leadingAnchor, constant: 10),
            left.centerYAnchor.constraint(equalTo: label.centerYAnchor),
            left.trailingAnchor.constraint(lessThanOrEqualTo: right.leadingAnchor, constant: -6),
            right.trailingAnchor.constraint(equalTo: label.trailingAnchor, constant: -10),
            right.centerYAnchor.constraint(equalTo: label.centerYAnchor),
            barcode.heightAnchor.constraint(equalToConstant: 7),
            cardWindow.topAnchor.constraint(equalTo: label.bottomAnchor, constant: 10),
            cardWindow.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12),
            cardWindow.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12),
            cardWindow.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -12),
        ])
        right.setContentCompressionResistancePriority(.required, for: .horizontal)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func layoutSubviews() {
        super.layoutSubviews()
        shell.frame = bounds
    }

    func show(_ slab: SlabGrade, name: String, number: String, setName: String) {
        let c = SlabStyle.colors(slab.company)
        label.backgroundColor = c.bg
        label.layer.borderColor = c.accent.cgColor
        for l in [setLine, nameLine, numberLine, word, grade] { l.textColor = c.fg }
        setLine.alpha = 0.7; numberLine.alpha = 0.7
        setLine.text = setName.uppercased()
        nameLine.text = name.uppercased()
        badge.text = slab.company.uppercased()
        badge.backgroundColor = c.accent
        badge.textColor = c.bg
        numberLine.text = number.isEmpty ? nil : "#\(number)"
        let w = SlabStyle.word(slab.company, slab.grade)
        word.text = w.isEmpty ? nil : w
        word.isHidden = w.isEmpty
        grade.text = slab.grade
        barcode.arrangedSubviews.forEach { $0.removeFromSuperview() }
        for bw in [2, 1, 1, 3, 1, 2, 1, 1, 2, 3, 1, 1, 2, 1, 3, 1, 2] {
            let bar = UIView()
            bar.backgroundColor = c.fg.withAlphaComponent(0.7)
            bar.widthAnchor.constraint(equalToConstant: CGFloat(bw)).isActive = true
            barcode.addArrangedSubview(bar)
        }
    }
}

// MARK: - Card sheet (tap a card in the tray)
//
// The card big, like the Cardex shows it, with the scan itself one tap away; the other cards it
// could be, with their pictures; a search for when it's none of them; and Remove.

private let sheetGold = UIColor(red: 0.85, green: 0.70, blue: 0.35, alpha: 1)
private let sheetInk = UIColor(red: 0.96, green: 0.93, blue: 0.87, alpha: 1)
private let sheetMuted = UIColor(white: 1, alpha: 0.55)

final class CardSheetViewController: UIViewController, UICollectionViewDataSource, UICollectionViewDelegate, UISearchBarDelegate, UITextFieldDelegate {
    private let item: ScanItem
    private weak var scanner: ScannerViewController?
    var onChange: (() -> Void)?
    var onRemove: (() -> Void)?

    private let scroll = UIScrollView()
    private let stack = UIStackView()
    private let cardImage = UIImageView()
    private let slabView = FullSlabView()
    private let slabCardImage = UIImageView()
    private let viewToggle = UISegmentedControl(items: ["Match", "Your scan"])
    private let statusPill = PaddedLabel()
    private let nameLabel = UILabel()
    private let setLabel = UILabel()
    private let priceLabel = UILabel()
    private let detailLabel = UILabel()
    private let finishScroll = UIScrollView()
    private let finishRow = UIStackView()
    private var finishSection: [UIView] = []
    private let otherTitle = UILabel()
    private var others: UICollectionView!
    private let searchBar = UISearchBar()
    private var results: UICollectionView!
    private let searchSpinner = UIActivityIndicatorView(style: .medium)
    private let searchNote = UILabel()
    private let companyPicker = UISegmentedControl(items: ["Raw", "PSA", "CGC", "BGS", "SGC", "TAG"])
    // The card's condition, as the site saves it (lib/types.ts Condition) — a graded card has its grade instead
    private static let conditionKeys = ["near_mint", "lightly_played", "moderately_played", "heavily_played"]
    private let conditionPicker = UISegmentedControl(items: ["NM", "LP", "MP", "HP"])
    private var conditionSection: [UIView] = []
    private let gradeField = UITextField()
    private let certField = UITextField()
    private var gradeFields: UIView?
    private var found: [TrayOption] = []
    private var showing = ""

    init(item: ScanItem, scanner: ScannerViewController) {
        self.item = item
        self.scanner = scanner
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .pageSheet
        overrideUserInterfaceStyle = .dark
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private func optionStrip() -> UICollectionView {
        let layout = UICollectionViewFlowLayout()
        layout.scrollDirection = .horizontal
        layout.itemSize = CGSize(width: 104, height: 196)
        layout.minimumLineSpacing = 12
        layout.sectionInset = UIEdgeInsets(top: 0, left: 20, bottom: 0, right: 20)
        let c = UICollectionView(frame: .zero, collectionViewLayout: layout)
        c.backgroundColor = .clear
        c.showsHorizontalScrollIndicator = false
        c.dataSource = self
        c.delegate = self
        c.register(OptionCell.self, forCellWithReuseIdentifier: "option")
        c.heightAnchor.constraint(equalToConstant: 196).isActive = true
        return c
    }

    private func sectionTitle(_ l: UILabel, _ text: String) {
        l.text = text.uppercased()
        l.font = .systemFont(ofSize: 12, weight: .bold)
        l.textColor = sheetMuted
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.08, green: 0.07, blue: 0.06, alpha: 1)

        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.alwaysBounceVertical = true
        scroll.keyboardDismissMode = .interactive
        view.addSubview(scroll)
        stack.axis = .vertical
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(stack)

        // The card, big
        cardImage.contentMode = .scaleAspectFit
        cardImage.clipsToBounds = true
        cardImage.layer.cornerRadius = 12
        cardImage.layer.shadowColor = UIColor.black.cgColor
        let imageWrap = UIView()
        let host = UIView()   // room for a slab (taller than the card); the plain card sits centred in it
        host.translatesAutoresizingMaskIntoConstraints = false
        imageWrap.addSubview(host)
        host.addSubview(cardImage)
        host.addSubview(slabView)
        cardImage.translatesAutoresizingMaskIntoConstraints = false
        slabView.translatesAutoresizingMaskIntoConstraints = false
        slabCardImage.contentMode = .scaleAspectFit
        slabCardImage.clipsToBounds = true
        slabCardImage.layer.cornerRadius = 6
        slabCardImage.translatesAutoresizingMaskIntoConstraints = false
        slabView.cardWindow.addSubview(slabCardImage)
        slabView.isHidden = true
        viewToggle.selectedSegmentIndex = 0
        viewToggle.selectedSegmentTintColor = sheetGold
        viewToggle.setTitleTextAttributes([.foregroundColor: UIColor.black, .font: UIFont.systemFont(ofSize: 13, weight: .semibold)], for: .selected)
        viewToggle.setTitleTextAttributes([.foregroundColor: sheetInk, .font: UIFont.systemFont(ofSize: 13, weight: .medium)], for: .normal)
        viewToggle.addTarget(self, action: #selector(toggleView), for: .valueChanged)
        viewToggle.translatesAutoresizingMaskIntoConstraints = false
        imageWrap.addSubview(viewToggle)
        NSLayoutConstraint.activate([
            host.topAnchor.constraint(equalTo: imageWrap.topAnchor, constant: 8),
            host.centerXAnchor.constraint(equalTo: imageWrap.centerXAnchor),
            host.widthAnchor.constraint(equalTo: imageWrap.widthAnchor, multiplier: 0.72),
            host.heightAnchor.constraint(equalTo: host.widthAnchor, multiplier: 1.62),
            cardImage.centerXAnchor.constraint(equalTo: host.centerXAnchor),
            cardImage.centerYAnchor.constraint(equalTo: host.centerYAnchor),
            cardImage.widthAnchor.constraint(equalTo: host.widthAnchor, multiplier: 0.86),
            cardImage.heightAnchor.constraint(equalTo: cardImage.widthAnchor, multiplier: 88.0 / 63.0),
            slabView.topAnchor.constraint(equalTo: host.topAnchor),
            slabView.bottomAnchor.constraint(equalTo: host.bottomAnchor),
            slabView.centerXAnchor.constraint(equalTo: host.centerXAnchor),
            slabView.widthAnchor.constraint(equalTo: host.widthAnchor),
            slabCardImage.topAnchor.constraint(equalTo: slabView.cardWindow.topAnchor, constant: 6),
            slabCardImage.bottomAnchor.constraint(equalTo: slabView.cardWindow.bottomAnchor, constant: -6),
            slabCardImage.leadingAnchor.constraint(equalTo: slabView.cardWindow.leadingAnchor, constant: 6),
            slabCardImage.trailingAnchor.constraint(equalTo: slabView.cardWindow.trailingAnchor, constant: -6),
            viewToggle.topAnchor.constraint(equalTo: host.bottomAnchor, constant: 12),
            viewToggle.centerXAnchor.constraint(equalTo: imageWrap.centerXAnchor),
            viewToggle.widthAnchor.constraint(equalToConstant: 210),
            viewToggle.bottomAnchor.constraint(equalTo: imageWrap.bottomAnchor),
        ])
        stack.addArrangedSubview(imageWrap)

        // What it is
        let info = UIStackView()
        info.axis = .vertical
        info.spacing = 4
        info.alignment = .leading
        info.isLayoutMarginsRelativeArrangement = true
        info.layoutMargins = UIEdgeInsets(top: 0, left: 20, bottom: 0, right: 20)
        statusPill.font = .systemFont(ofSize: 12, weight: .bold)
        statusPill.layer.cornerRadius = 11
        statusPill.clipsToBounds = true
        statusPill.insets = UIEdgeInsets(top: 4, left: 10, bottom: 4, right: 10)
        nameLabel.font = .systemFont(ofSize: 24, weight: .bold)
        nameLabel.textColor = sheetInk
        nameLabel.numberOfLines = 2
        setLabel.font = .systemFont(ofSize: 15, weight: .medium)
        setLabel.textColor = sheetMuted
        setLabel.numberOfLines = 2
        priceLabel.font = .systemFont(ofSize: 20, weight: .bold)
        priceLabel.textColor = sheetGold
        detailLabel.font = .monospacedSystemFont(ofSize: 10, weight: .regular)
        detailLabel.textColor = UIColor(white: 1, alpha: 0.35)
        detailLabel.numberOfLines = 0
        for v in [statusPill, nameLabel, setLabel, priceLabel] { info.addArrangedSubview(v) }
        info.setCustomSpacing(10, after: statusPill)
        info.setCustomSpacing(8, after: setLabel)
        if DebugScans.enabled { info.addArrangedSubview(detailLabel) }
        stack.addArrangedSubview(info)

        // Finish: every printing this card comes in (Normal / Holo / Reverse Holo / 1st Edition, or
        // Normal / Foil), each with its price — the scanner can't tell them apart yet, so it's picked here
        let finishHeader = UIView()
        let finishTitle = UILabel()
        sectionTitle(finishTitle, "Finish")
        finishTitle.translatesAutoresizingMaskIntoConstraints = false
        finishHeader.addSubview(finishTitle)
        NSLayoutConstraint.activate([
            finishTitle.leadingAnchor.constraint(equalTo: finishHeader.leadingAnchor, constant: 20),
            finishTitle.topAnchor.constraint(equalTo: finishHeader.topAnchor, constant: 6),
            finishTitle.bottomAnchor.constraint(equalTo: finishHeader.bottomAnchor),
        ])
        finishScroll.showsHorizontalScrollIndicator = false
        finishScroll.translatesAutoresizingMaskIntoConstraints = false
        finishRow.axis = .horizontal
        finishRow.spacing = 8
        finishRow.translatesAutoresizingMaskIntoConstraints = false
        finishScroll.addSubview(finishRow)
        NSLayoutConstraint.activate([
            finishRow.leadingAnchor.constraint(equalTo: finishScroll.contentLayoutGuide.leadingAnchor, constant: 20),
            finishRow.trailingAnchor.constraint(equalTo: finishScroll.contentLayoutGuide.trailingAnchor, constant: -20),
            finishRow.topAnchor.constraint(equalTo: finishScroll.contentLayoutGuide.topAnchor),
            finishRow.bottomAnchor.constraint(equalTo: finishScroll.contentLayoutGuide.bottomAnchor),
            finishRow.heightAnchor.constraint(equalTo: finishScroll.frameLayoutGuide.heightAnchor),
            finishScroll.heightAnchor.constraint(equalToConstant: 54),
        ])
        stack.addArrangedSubview(finishHeader)
        stack.addArrangedSubview(finishScroll)
        finishSection = [finishHeader, finishScroll]

        // Condition: Near Mint / Lightly / Moderately / Heavily Played (the review screen can change it too)
        let conditionHeader = UIView()
        let conditionTitle = UILabel()
        sectionTitle(conditionTitle, "Condition")
        conditionTitle.translatesAutoresizingMaskIntoConstraints = false
        conditionHeader.addSubview(conditionTitle)
        NSLayoutConstraint.activate([
            conditionTitle.leadingAnchor.constraint(equalTo: conditionHeader.leadingAnchor, constant: 20),
            conditionTitle.topAnchor.constraint(equalTo: conditionHeader.topAnchor, constant: 10),
            conditionTitle.bottomAnchor.constraint(equalTo: conditionHeader.bottomAnchor),
        ])
        conditionPicker.selectedSegmentTintColor = sheetGold
        conditionPicker.setTitleTextAttributes([.foregroundColor: UIColor.black, .font: UIFont.systemFont(ofSize: 14, weight: .bold)], for: .selected)
        conditionPicker.setTitleTextAttributes([.foregroundColor: sheetInk, .font: UIFont.systemFont(ofSize: 14, weight: .medium)], for: .normal)
        conditionPicker.selectedSegmentIndex = Self.conditionKeys.firstIndex(of: item.condition ?? "") ?? 0
        conditionPicker.addAction(UIAction { [weak self] _ in
            guard let self = self else { return }
            let i = max(0, self.conditionPicker.selectedSegmentIndex)
            self.item.condition = i == 0 ? nil : Self.conditionKeys[i]
            UISelectionFeedbackGenerator().selectionChanged()
            self.onChange?()
        }, for: .valueChanged)
        let conditionBox = UIStackView(arrangedSubviews: [conditionPicker])
        conditionBox.isLayoutMarginsRelativeArrangement = true
        conditionBox.layoutMargins = UIEdgeInsets(top: 0, left: 20, bottom: 4, right: 20)
        conditionPicker.heightAnchor.constraint(equalToConstant: 36).isActive = true
        stack.addArrangedSubview(conditionHeader)
        stack.addArrangedSubview(conditionBox)
        conditionSection = [conditionHeader, conditionBox]
        conditionSection.forEach { $0.isHidden = item.slab != nil }

        // The other cards it could be
        let otherHeader = UIView()
        sectionTitle(otherTitle, "Other matches — tap to switch")
        otherTitle.translatesAutoresizingMaskIntoConstraints = false
        otherHeader.addSubview(otherTitle)
        NSLayoutConstraint.activate([
            otherTitle.leadingAnchor.constraint(equalTo: otherHeader.leadingAnchor, constant: 20),
            otherTitle.topAnchor.constraint(equalTo: otherHeader.topAnchor, constant: 10),
            otherTitle.bottomAnchor.constraint(equalTo: otherHeader.bottomAnchor),
        ])
        others = optionStrip()
        stack.addArrangedSubview(otherHeader)
        stack.addArrangedSubview(others)

        // Grading — what was read off the label, or set by hand (a raw card can be marked graded too)
        let gradeHeader = UIView()
        let gradeTitle = UILabel()
        sectionTitle(gradeTitle, "Grading")
        gradeTitle.translatesAutoresizingMaskIntoConstraints = false
        gradeHeader.addSubview(gradeTitle)
        NSLayoutConstraint.activate([
            gradeTitle.leadingAnchor.constraint(equalTo: gradeHeader.leadingAnchor, constant: 20),
            gradeTitle.topAnchor.constraint(equalTo: gradeHeader.topAnchor, constant: 10),
            gradeTitle.bottomAnchor.constraint(equalTo: gradeHeader.bottomAnchor),
        ])
        stack.addArrangedSubview(gradeHeader)
        companyPicker.selectedSegmentTintColor = sheetGold
        companyPicker.setTitleTextAttributes([.foregroundColor: UIColor.black, .font: UIFont.systemFont(ofSize: 13, weight: .bold)], for: .selected)
        companyPicker.setTitleTextAttributes([.foregroundColor: sheetInk, .font: UIFont.systemFont(ofSize: 13, weight: .medium)], for: .normal)
        companyPicker.addTarget(self, action: #selector(gradingChanged), for: .valueChanged)
        for (f, placeholder, kb) in [(gradeField, "Grade (e.g. 10, 9.5)", UIKeyboardType.decimalPad), (certField, "Cert number", UIKeyboardType.numberPad)] {
            f.placeholder = placeholder
            f.keyboardType = kb
            f.textColor = sheetInk
            f.tintColor = sheetGold
            f.font = .systemFont(ofSize: 16, weight: .semibold)
            f.backgroundColor = UIColor(white: 1, alpha: 0.07)
            f.layer.cornerRadius = 10
            f.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 1)); f.leftViewMode = .always
            f.heightAnchor.constraint(equalToConstant: 44).isActive = true
            f.addTarget(self, action: #selector(gradingChanged), for: .editingChanged)
        }
        let fields = UIStackView(arrangedSubviews: [gradeField, certField])
        fields.spacing = 10
        fields.distribution = .fillProportionally
        gradeField.widthAnchor.constraint(equalTo: certField.widthAnchor, multiplier: 0.7).isActive = true
        let gradeBox = UIStackView(arrangedSubviews: [companyPicker, fields])
        gradeBox.axis = .vertical
        gradeBox.spacing = 10
        gradeBox.isLayoutMarginsRelativeArrangement = true
        gradeBox.layoutMargins = UIEdgeInsets(top: 0, left: 20, bottom: 0, right: 20)
        stack.addArrangedSubview(gradeBox)
        gradeFields = fields
        let companies = ["Raw", "PSA", "CGC", "BGS", "SGC", "TAG"]
        companyPicker.selectedSegmentIndex = item.slab.flatMap { s in companies.firstIndex(of: s.company.uppercased()) } ?? 0
        gradeField.text = item.slab?.grade
        certField.text = item.slab?.cert
        fields.isHidden = item.slab == nil

        // Not any of them: search
        let searchHeader = UIView()
        let searchTitle = UILabel()
        sectionTitle(searchTitle, "Not right? Find the card")
        searchTitle.translatesAutoresizingMaskIntoConstraints = false
        searchHeader.addSubview(searchTitle)
        NSLayoutConstraint.activate([
            searchTitle.leadingAnchor.constraint(equalTo: searchHeader.leadingAnchor, constant: 20),
            searchTitle.topAnchor.constraint(equalTo: searchHeader.topAnchor, constant: 10),
            searchTitle.bottomAnchor.constraint(equalTo: searchHeader.bottomAnchor),
        ])
        stack.addArrangedSubview(searchHeader)
        searchBar.placeholder = "Card name, or name and number"
        searchBar.searchBarStyle = .minimal
        searchBar.delegate = self
        searchBar.returnKeyType = .search
        searchBar.tintColor = sheetGold
        let searchWrap = UIView()
        searchBar.translatesAutoresizingMaskIntoConstraints = false
        searchSpinner.translatesAutoresizingMaskIntoConstraints = false
        searchSpinner.color = sheetGold
        searchWrap.addSubview(searchBar)
        searchWrap.addSubview(searchSpinner)
        NSLayoutConstraint.activate([
            searchBar.leadingAnchor.constraint(equalTo: searchWrap.leadingAnchor, constant: 12),
            searchBar.trailingAnchor.constraint(equalTo: searchWrap.trailingAnchor, constant: -12),
            searchBar.topAnchor.constraint(equalTo: searchWrap.topAnchor),
            searchBar.bottomAnchor.constraint(equalTo: searchWrap.bottomAnchor),
            searchSpinner.trailingAnchor.constraint(equalTo: searchBar.trailingAnchor, constant: -44),
            searchSpinner.centerYAnchor.constraint(equalTo: searchBar.centerYAnchor),
        ])
        stack.addArrangedSubview(searchWrap)
        searchNote.font = .systemFont(ofSize: 13)
        searchNote.textColor = sheetMuted
        searchNote.textAlignment = .center
        searchNote.isHidden = true
        stack.addArrangedSubview(searchNote)
        results = optionStrip()
        results.isHidden = true
        stack.addArrangedSubview(results)

        // Done / Remove
        let buttons = UIStackView()
        buttons.axis = .vertical
        buttons.spacing = 10
        buttons.isLayoutMarginsRelativeArrangement = true
        buttons.layoutMargins = UIEdgeInsets(top: 12, left: 20, bottom: 24, right: 20)
        var done = UIButton.Configuration.filled()
        done.title = "Done"
        done.baseBackgroundColor = sheetGold
        done.baseForegroundColor = .black
        done.cornerStyle = .large
        done.buttonSize = .large
        let doneButton = UIButton(configuration: done, primaryAction: UIAction { [weak self] _ in self?.dismiss(animated: true) })
        var remove = UIButton.Configuration.plain()
        remove.title = "Remove from this scan"
        remove.baseForegroundColor = .systemRed
        let removeButton = UIButton(configuration: remove, primaryAction: UIAction { [weak self] _ in
            self?.dismiss(animated: true) { self?.onRemove?() }
        })
        buttons.addArrangedSubview(doneButton)
        buttons.addArrangedSubview(removeButton)
        stack.addArrangedSubview(buttons)

        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.topAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 20),
            stack.leadingAnchor.constraint(equalTo: scroll.frameLayoutGuide.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: scroll.frameLayoutGuide.trailingAnchor),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
        ])
        // Typing: a Done bar on every keyboard (the number pads have no return key), tap elsewhere
        // to close it, and the field being typed in scrolled into view
        let bar = UIToolbar(frame: CGRect(x: 0, y: 0, width: 320, height: 44))
        bar.items = [UIBarButtonItem(systemItem: .flexibleSpace),
                     UIBarButtonItem(title: "Done", style: .done, target: self, action: #selector(endTyping))]
        bar.tintColor = sheetGold
        gradeField.inputAccessoryView = bar
        certField.inputAccessoryView = bar
        searchBar.inputAccessoryView = bar
        gradeField.delegate = self
        certField.delegate = self
        let tapAway = UITapGestureRecognizer(target: self, action: #selector(endTyping))
        tapAway.cancelsTouchesInView = false
        view.addGestureRecognizer(tapAway)
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardMoved(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardMoved(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)
        refresh()
    }

    private weak var typingIn: UIView?

    /// The keyboard came up, moved or went away: leave exactly that much room at the bottom of the
    /// sheet, and keep the field being typed in just above it
    @objc private func keyboardMoved(_ note: Notification) {
        guard let end = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue else { return }
        let hiding = note.name == UIResponder.keyboardWillHideNotification
        // The keyboard's frame is in screen coordinates; the sheet sits lower than the screen top
        let inView = view.convert(end, from: nil)
        let covered = hiding ? 0 : max(0, view.bounds.maxY - inView.minY)
        let duration = (note.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double) ?? 0.25
        UIView.animate(withDuration: duration) {
            self.scroll.contentInset.bottom = covered
            self.scroll.verticalScrollIndicatorInsets.bottom = covered
            if !hiding, let v = self.typingIn { self.scrollIntoView(v, keyboardTop: self.view.bounds.maxY - covered) }
        }
    }

    private func scrollIntoView(_ v: UIView, keyboardTop: CGFloat) {
        // Where the field is in the sheet right now, and how far it must rise to sit 24 pt above the keyboard
        let r = v.convert(v.bounds, to: view)
        let overlap = r.maxY + 24 - keyboardTop
        let viewTopGap = r.minY - 60
        guard overlap > 0 else { return }
        let rise = min(overlap, max(0, viewTopGap) + overlap)
        let maxY = max(0, scroll.contentSize.height + scroll.contentInset.bottom - scroll.bounds.height)
        scroll.contentOffset.y = min(maxY, scroll.contentOffset.y + rise)
    }

    @objc private func endTyping() { view.endEditing(true) }

    func textFieldDidBeginEditing(_ field: UITextField) { reveal(field) }
    func textFieldShouldReturn(_ field: UITextField) -> Bool { field.resignFirstResponder(); return true }
    func searchBarTextDidBeginEditing(_ bar: UISearchBar) { reveal(bar) }

    /// Remember the field being typed in; if the keyboard is already up (switching fields), move now
    private func reveal(_ v: UIView) {
        typingIn = v
        if scroll.contentInset.bottom > 0 {
            UIView.animate(withDuration: 0.25) { self.scrollIntoView(v, keyboardTop: self.view.bounds.maxY - self.scroll.contentInset.bottom) }
        }
    }

    private var current: TrayOption? { item.options.indices.contains(item.choice) ? item.options[item.choice] : nil }

    private func refresh() {
        let o = current
        nameLabel.text = o?.title ?? (item.status == "matching" ? "Still matching…" : "Not found")
        setLabel.text = o?.subtitle ?? (item.note ?? "Search for it below")
        showPrice()
        detailLabel.text = o.map { "Test build — why: \($0.detail)" }
        switch item.status {
        case "matched":
            statusPill.text = item.confirmed ? "✓ You picked this" : "✓ Matched"
            statusPill.backgroundColor = sheetGold; statusPill.textColor = .black
        case "pick":
            statusPill.text = "? Not sure — check the other matches"
            statusPill.backgroundColor = .systemYellow; statusPill.textColor = .black
        case "matching":
            statusPill.text = "Matching…"
            statusPill.backgroundColor = UIColor(white: 1, alpha: 0.15); statusPill.textColor = sheetInk
        default:
            statusPill.text = "! Not found — search below"
            statusPill.backgroundColor = .systemRed; statusPill.textColor = .white
        }
        showFinishes()
        let multiple = item.options.count > 1
        otherTitle.superview?.isHidden = !multiple
        others.isHidden = !multiple
        others.reloadData()
        showImage()
    }

    private func showImage() {
        let inSlab = (item.slab.map { !$0.grade.isEmpty } ?? false) && current != nil && viewToggle.selectedSegmentIndex == 0
        slabView.isHidden = !inSlab
        cardImage.isHidden = inSlab
        if viewToggle.selectedSegmentIndex == 1 || current == nil {
            showing = "scan"
            cardImage.image = item.photo ?? item.thumbnail
            if current == nil { viewToggle.selectedSegmentIndex = 1 }
            return
        }
        guard let o = current else { return }
        // A graded card: shown in its slab — label, company, and the grade big
        if let slab = item.slab {
            let parts = o.subtitle.components(separatedBy: " · ")
            let number = parts.first { $0.hasPrefix("#") }.map { String($0.dropFirst()) } ?? ""
            slabView.show(slab, name: o.title, number: number, setName: parts.first ?? "")
        }
        let target = inSlab ? slabCardImage : cardImage
        guard showing != o.imageUrl + (inSlab ? "|slab" : "") else { return }
        showing = o.imageUrl + (inSlab ? "|slab" : "")
        let key = showing
        target.image = item.photo ?? item.thumbnail
        PictureMatcher.loadImage(o.imageUrl, into: target) { [weak self] in self?.showing == key && self?.viewToggle.selectedSegmentIndex == 0 }
    }

    @objc private func toggleView() { showing = ""; showImage() }

    /// The price under the name: the picked finish's own price, when the card comes in several
    private func showPrice() {
        let o = current
        if let p = item.currentPrinting, (o?.printings.count ?? 0) > 1, !p.price.isEmpty {
            priceLabel.text = "\(p.price) · \(p.label)"
        } else {
            priceLabel.text = o?.price.isEmpty == false ? o?.price : nil
        }
        priceLabel.isHidden = priceLabel.text == nil
    }

    /// The Finish row: one pill per printing, the picked one in gold (the first is the default)
    private func showFinishes() {
        showPrice()
        let printings = current?.printings ?? []
        finishSection.forEach { $0.isHidden = printings.count < 2 }
        finishRow.arrangedSubviews.forEach { $0.removeFromSuperview() }
        let picked = item.printing ?? printings.first?.key
        for p in printings {
            var c = UIButton.Configuration.filled()
            c.title = p.label
            c.subtitle = p.price.isEmpty ? nil : p.price
            c.titleAlignment = .center
            c.cornerStyle = .large
            let on = p.key == picked
            c.baseBackgroundColor = on ? sheetGold : UIColor(white: 1, alpha: 0.08)
            c.baseForegroundColor = on ? .black : sheetInk
            c.contentInsets = NSDirectionalEdgeInsets(top: 6, leading: 14, bottom: 6, trailing: 14)
            c.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { a in var b = a; b.font = .systemFont(ofSize: 14, weight: .bold); return b }
            c.subtitleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { a in var b = a; b.font = .systemFont(ofSize: 12, weight: .semibold); return b }
            let key = p.key
            let b = UIButton(configuration: c, primaryAction: UIAction { [weak self] _ in
                guard let self = self else { return }
                self.item.printing = key
                UISelectionFeedbackGenerator().selectionChanged()
                self.showFinishes()
                self.onChange?()
            })
            finishRow.addArrangedSubview(b)
        }
    }

    /// The person changed the grading: Raw clears it; a company + grade makes it a slab
    @objc private func gradingChanged() {
        let companies = ["Raw", "PSA", "CGC", "BGS", "SGC", "TAG"]
        let company = companies[max(0, companyPicker.selectedSegmentIndex)]
        gradeFields?.isHidden = company == "Raw"
        let grade = (gradeField.text ?? "").trimmingCharacters(in: .whitespaces)
        if company == "Raw" {
            item.slab = nil
        } else {
            item.slab = SlabGrade(company: company, grade: grade.isEmpty ? (item.slab?.grade ?? "") : grade,
                                  cert: (certField.text ?? "").trimmingCharacters(in: .whitespaces))
            if grade.isEmpty && gradeField.text?.isEmpty == true { item.slab?.grade = "" }
        }
        if item.slab?.grade.isEmpty == true { /* shown as a slab once it has a grade */ }
        conditionSection.forEach { $0.isHidden = item.slab != nil }
        showing = ""
        showImage()
        onChange?()
    }

    private func choose(_ option: TrayOption) {
        if let i = item.options.firstIndex(where: { $0.key == option.key && !option.key.isEmpty }) {
            item.choice = i
        } else {
            item.options.insert(option, at: 0)
            item.choice = 0
        }
        item.status = "matched"
        item.confirmed = true
        item.printing = nil
        UISelectionFeedbackGenerator().selectionChanged()
        showing = ""
        viewToggle.selectedSegmentIndex = 0
        refresh()
        onChange?()
        scroll.setContentOffset(.zero, animated: true)
    }

    // Search
    func searchBarSearchButtonClicked(_ bar: UISearchBar) {
        let q = (bar.text ?? "").trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else { return }
        bar.resignFirstResponder()
        searchSpinner.startAnimating()
        searchNote.isHidden = true
        scanner?.search(q) { [weak self] options in
            guard let self = self else { return }
            self.searchSpinner.stopAnimating()
            self.found = options
            self.results.isHidden = options.isEmpty
            self.searchNote.isHidden = !options.isEmpty
            self.searchNote.text = "No cards found for “\(q)”"
            self.results.reloadData()
            self.results.setContentOffset(.zero, animated: false)
        }
    }

    // Strips
    func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int {
        collectionView === others ? min(item.options.count, 12) : found.count
    }
    func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
        let cell = collectionView.dequeueReusableCell(withReuseIdentifier: "option", for: indexPath) as! OptionCell
        if collectionView === others {
            cell.show(item.options[indexPath.item], selected: indexPath.item == item.choice)
        } else {
            let o = found[indexPath.item]
            cell.show(o, selected: o.key == current?.key)
        }
        return cell
    }
    func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
        choose(collectionView === others ? item.options[indexPath.item] : found[indexPath.item])
    }
}

final class OptionCell: UICollectionViewCell {
    private let image = UIImageView()
    private let name = UILabel()
    private let set = UILabel()
    private let price = UILabel()
    private var url = ""

    override init(frame: CGRect) {
        super.init(frame: frame)
        image.contentMode = .scaleAspectFill
        image.clipsToBounds = true
        image.layer.cornerRadius = 7
        image.backgroundColor = UIColor(white: 1, alpha: 0.06)
        image.layer.borderColor = sheetGold.cgColor
        name.font = .systemFont(ofSize: 12, weight: .semibold)
        name.textColor = sheetInk
        name.numberOfLines = 2
        set.font = .systemFont(ofSize: 11)
        set.textColor = sheetMuted
        set.numberOfLines = 1
        price.font = .systemFont(ofSize: 12, weight: .bold)
        price.textColor = sheetGold
        let col = UIStackView(arrangedSubviews: [image, name, set, price])
        col.axis = .vertical
        col.spacing = 3
        col.setCustomSpacing(6, after: image)
        col.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(col)
        NSLayoutConstraint.activate([
            col.topAnchor.constraint(equalTo: contentView.topAnchor),
            col.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            col.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            image.heightAnchor.constraint(equalTo: image.widthAnchor, multiplier: 88.0 / 63.0),
        ])
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func show(_ o: TrayOption, selected: Bool) {
        name.text = o.title
        set.text = o.subtitle
        price.text = o.price
        image.layer.borderWidth = selected ? 3 : 0
        if url != o.imageUrl {
            url = o.imageUrl
            image.image = nil
            let want = o.imageUrl
            PictureMatcher.loadImage(want, into: image) { [weak self] in self?.url == want }
        }
    }
}

// MARK: - Tray cell

final class TrayCell: UICollectionViewCell {
    private let image = UIImageView()
    private let name = UILabel()
    private let price = UILabel()
    private let badge = UILabel()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private var showing: String?
    private let slabOverlay = SlabTileOverlay()

    override init(frame: CGRect) {
        super.init(frame: frame)
        image.contentMode = .scaleAspectFill
        image.clipsToBounds = true
        image.layer.cornerRadius = 5
        image.backgroundColor = UIColor(white: 1, alpha: 0.08)
        name.font = .systemFont(ofSize: 11, weight: .semibold)
        name.textColor = .white
        // One line, "…" when long — the finish and price line under it must always show
        name.numberOfLines = 1
        name.lineBreakMode = .byTruncatingTail
        price.font = .systemFont(ofSize: 11, weight: .regular)
        price.textColor = UIColor(red: 0.85, green: 0.70, blue: 0.35, alpha: 1)
        price.adjustsFontSizeToFitWidth = true
        price.minimumScaleFactor = 0.75
        badge.font = .systemFont(ofSize: 13, weight: .bold)
        badge.textAlignment = .center
        badge.layer.cornerRadius = 11
        badge.clipsToBounds = true
        spinner.color = .white
        for v in [image, slabOverlay, name, price, badge, spinner] as [UIView] {
            v.translatesAutoresizingMaskIntoConstraints = false
            contentView.addSubview(v)
        }
        slabOverlay.isHidden = true
        NSLayoutConstraint.activate([
            slabOverlay.topAnchor.constraint(equalTo: image.topAnchor),
            slabOverlay.leadingAnchor.constraint(equalTo: image.leadingAnchor),
            slabOverlay.trailingAnchor.constraint(equalTo: image.trailingAnchor),
            slabOverlay.bottomAnchor.constraint(equalTo: image.bottomAnchor),
        ])
        NSLayoutConstraint.activate([
            image.topAnchor.constraint(equalTo: contentView.topAnchor),
            image.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            image.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            image.heightAnchor.constraint(equalTo: image.widthAnchor, multiplier: 88.0 / 63.0),
            name.topAnchor.constraint(equalTo: image.bottomAnchor, constant: 3),
            name.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            name.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            price.topAnchor.constraint(equalTo: name.bottomAnchor, constant: 1),
            price.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            price.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            badge.bottomAnchor.constraint(equalTo: image.bottomAnchor, constant: -4),
            badge.trailingAnchor.constraint(equalTo: image.trailingAnchor, constant: -4),
            badge.widthAnchor.constraint(equalToConstant: 22),
            badge.heightAnchor.constraint(equalToConstant: 22),
            spinner.centerXAnchor.constraint(equalTo: image.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: image.centerYAnchor),
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func show(_ item: ScanItem) {
        let option = item.options.isEmpty ? nil : item.options[item.choice]
        let key = "\(item.id)|\(option?.imageUrl ?? "")"
        if showing != key {
            showing = key
            image.image = item.thumbnail
            if let url = option?.imageUrl, !url.isEmpty {
                PictureMatcher.loadImage(url, into: image) { [weak self] in self?.showing == key }
            }
        }
        // A graded slab: the card in its slab, grade on top (the status badge moves out of the way)
        if let slab = item.slab, !slab.grade.isEmpty {
            slabOverlay.isHidden = false
            slabOverlay.show(slab)
        } else {
            slabOverlay.isHidden = true
        }
        name.text = option?.title ?? (item.status == "matching" ? "Matching…" : "Not found")
        // The finish shown with its own price, when the card comes in more than one
        if let p = item.currentPrinting, (option?.printings.count ?? 0) > 1 {
            price.text = [p.label, p.price].filter { !$0.isEmpty }.joined(separator: " · ")
        } else {
            price.text = option?.price
        }
        item.status == "matching" ? spinner.startAnimating() : spinner.stopAnimating()
        switch item.status {
        case "matched":
            badge.isHidden = false; badge.text = "✓"; badge.textColor = .black
            badge.backgroundColor = UIColor(red: 0.85, green: 0.70, blue: 0.35, alpha: 1)
        case "pick":
            badge.isHidden = false; badge.text = "?"; badge.textColor = .black
            badge.backgroundColor = .systemYellow
        case "none", "error":
            badge.isHidden = false; badge.text = "!"; badge.textColor = .white
            badge.backgroundColor = .systemRed
        default:
            badge.isHidden = true
        }
        contentView.alpha = item.status == "none" || item.status == "error" ? 0.7 : 1
    }
}

// MARK: - A label with padding

final class PaddedLabel: UILabel {
    var insets = UIEdgeInsets(top: 8, left: 14, bottom: 8, right: 14)
    override func drawText(in rect: CGRect) { super.drawText(in: rect.inset(by: insets)) }
    override var intrinsicContentSize: CGSize {
        let s = super.intrinsicContentSize
        return CGSize(width: s.width + insets.left + insets.right, height: s.height + insets.top + insets.bottom)
    }
}


// MARK: - The picture AI (docs/scanner-ai.md)
//
// A DINOv2-small model (Apache-2.0, Meta) trained on TCGHaven's catalog cards on the RTX 4090
// (docs/training-ai.md), converted to Core ML. It turns the flattened card into 384 numbers — its
// "fingerprint" — that the server compares with every catalog card's (lib/scan/picture.ts). The
// model isn't in the app: the site names the current version (prepareModel), it's downloaded once
// (~41 MB) and kept, so a retrained model reaches phones without an app update. Until it's ready,
// scans simply go without a fingerprint and the text + tile comparison work as before.

final class CardFingerprinter {
    static let shared = CardFingerprinter()
    static let width = 224, height = 308

    private let lock = NSLock()
    private var model: MLModel?
    private var version: String?
    private var busy = false
    private let work = DispatchQueue(label: "tcghaven.scanner.fingerprinter", qos: .utility)

    private var folder: URL? {
        guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        var dir = base.appendingPathComponent("CardFingerprint", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true // downloaded again if ever needed — not the person's data
        try? dir.setResourceValues(values)
        return dir
    }

    var isReady: Bool { lock.lock(); defer { lock.unlock() }; return model != nil }

    func prepare(version: String, files: [String: String], done: @escaping (Bool) -> Void) {
        lock.lock()
        if self.version == version, model != nil { lock.unlock(); done(true); return }
        if busy { lock.unlock(); done(false); return }
        busy = true
        lock.unlock()
        work.async {
            let ok = self.load(version: version, files: files)
            self.lock.lock(); self.busy = false; self.lock.unlock()
            DispatchQueue.main.async { done(ok) }
        }
    }

    private func load(version: String, files: [String: String]) -> Bool {
        guard let dir = folder else { return false }
        let safe = version.replacingOccurrences(of: "[^A-Za-z0-9._-]", with: "_", options: .regularExpression)
        let compiled = dir.appendingPathComponent("\(safe).mlmodelc", isDirectory: true)
        let fm = FileManager.default
        if !fm.fileExists(atPath: compiled.path) {
            let t0 = CACurrentMediaTime()
            let download = dir.appendingPathComponent("\(safe).download", isDirectory: true)
            let package = download.appendingPathComponent("CardFingerprint.mlpackage", isDirectory: true)
            try? fm.removeItem(at: download)
            for (rel, url) in files {
                guard let u = URL(string: url), !rel.contains("..") else { return false }
                let dest = package.appendingPathComponent(rel)
                try? fm.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
                guard Self.fetch(u, to: dest) else {
                    DebugScans.log("picture AI: download failed (\(rel))")
                    try? fm.removeItem(at: download)
                    return false
                }
            }
            do {
                let built = try MLModel.compileModel(at: package)
                try? fm.removeItem(at: compiled)
                try fm.moveItem(at: built, to: compiled)
            } catch {
                DebugScans.log("picture AI: compile failed — \(error.localizedDescription)")
                try? fm.removeItem(at: download)
                return false
            }
            try? fm.removeItem(at: download)
            DebugScans.log("picture AI \(version): downloaded + compiled in \(Int((CACurrentMediaTime() - t0) * 1000)) ms")
        }
        let config = MLModelConfiguration()
        config.computeUnits = .all
        guard let m = try? MLModel(contentsOf: compiled, configuration: config) else {
            try? fm.removeItem(at: compiled) // damaged — fetched again next time
            return false
        }
        lock.lock(); model = m; self.version = version; lock.unlock()
        // The first prediction prepares the Neural Engine (slow once) — do it now, not on a scan
        if let blank = Self.blankImage() { _ = run(blank) }
        // Older versions' files
        for f in (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? [] where f.lastPathComponent != compiled.lastPathComponent {
            try? fm.removeItem(at: f)
        }
        DebugScans.log("picture AI \(version) ready")
        return true
    }

    private static func fetch(_ url: URL, to dest: URL) -> Bool {
        let done = DispatchSemaphore(value: 0)
        var ok = false
        let task = URLSession.shared.downloadTask(with: url) { tmp, response, _ in
            if let tmp = tmp, (response as? HTTPURLResponse)?.statusCode == 200 {
                try? FileManager.default.removeItem(at: dest)
                ok = (try? FileManager.default.moveItem(at: tmp, to: dest)) != nil
            }
            done.signal()
        }
        task.resume()
        _ = done.wait(timeout: .now() + 300)
        return ok
    }

    private static func blankImage() -> CGImage? {
        guard let c = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
        c.setFillColor(UIColor.gray.cgColor)
        c.fill(CGRect(x: 0, y: 0, width: width, height: height))
        return c.makeImage()
    }

    /// The card turned a quarter (counter-clockwise when `ccw`) — for landscape cards
    private static func turned(_ image: CGImage, ccw: Bool) -> CGImage? {
        let w = image.height, h = image.width
        guard let c = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
        // Core Graphics' y axis points up: a +90° rotation here turns the picture counter-clockwise
        c.translateBy(x: CGFloat(w) / 2, y: CGFloat(h) / 2)
        c.rotate(by: ccw ? .pi / 2 : -.pi / 2)
        c.draw(image, in: CGRect(x: -CGFloat(image.width) / 2, y: -CGFloat(image.height) / 2, width: CGFloat(image.width), height: CGFloat(image.height)))
        return c.makeImage()
    }

    private func run(_ image: CGImage) -> [Float]? {
        lock.lock(); let m = model; lock.unlock()
        guard let m = m else { return nil }
        // Squashed to 224 × 308, never cropped — the same as the catalog photos were fingerprinted
        let options: [MLFeatureValue.ImageOption: Any] = [.cropAndScale: VNImageCropAndScaleOption.scaleFill.rawValue]
        guard let input = try? MLFeatureValue(cgImage: image, pixelsWide: Self.width, pixelsHigh: Self.height,
                                              pixelFormatType: kCVPixelFormatType_32BGRA, options: options),
              let provider = try? MLDictionaryFeatureProvider(dictionary: ["image": input]),
              let out = try? m.prediction(from: provider).featureValue(for: "fingerprint")?.multiArrayValue else { return nil }
        let n = out.count
        guard n == 384 else { return nil }
        var v = [Float](repeating: 0, count: n)
        for i in 0..<n { v[i] = out[i].floatValue }
        return v
    }

    /// The scan's fingerprint(s): one for a portrait card; a landscape card (leaders, bases,
    /// battles, locations) as it is and turned each way, since its catalog photo may be stored either way
    func fingerprints(of image: CGImage) -> [[Float]]? {
        guard isReady else { return nil }
        var pictures = [image]
        if image.width > Int(Double(image.height) * 1.1) {
            if let a = Self.turned(image, ccw: true) { pictures.append(a) }
            if let b = Self.turned(image, ccw: false) { pictures.append(b) }
        }
        let out = pictures.compactMap { run($0) }
        return out.isEmpty ? nil : out
    }
}
