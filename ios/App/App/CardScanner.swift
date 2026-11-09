// The TCGHaven card scanner — the native half. Plan, design and test results: CardScanner.md.
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
//      so look-alikes the text can't separate (One Piece parallels, reprints) are told apart
//   6. a tray of everything scanned; "Add" returns the picks to the site, which saves them through
//      lib/firebase/db.ts like any other added card (ScanReviewDialog.tsx)
//
// Everything on screen reflects real work: the ring is the measured steadiness, the scan line runs
// only while the card is being read / matched / compared, and the stage label says which.
//
// Nothing here writes user data, and no photo leaves the phone — only the text that was read.
// Test builds (Xcode ▶︎ Run) keep every scan on the phone for tuning: see "Debug scans" below.

import UIKit
import AVFoundation
import Vision
import CoreImage
import Capacitor

// MARK: - Registering the plugin

/// The app's web view controller (SceneDelegate creates it): Capacitor's own, plus our local plugin.
class TCGBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(CardScannerPlugin())
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
    ]

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
            vc.onScanned = { [weak self] scanId, lines in
                self?.notifyListeners("cardScanned", data: ["scanId": scanId, "lines": lines])
            }
            vc.onFinish = { [weak self] items in
                self?.scanner = nil
                call.resolve(["items": items])
            }
            vc.modalPresentationStyle = .fullScreen
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

    /// The site's answer for one scanned card: what it is (best first) and how sure.
    @objc func update(_ call: CAPPluginCall) {
        let scanId = call.getString("scanId") ?? ""
        let status = call.getString("status") ?? "none"
        let options: [TrayOption] = (call.getArray("options") ?? []).compactMap { raw in
            guard let o = raw as? JSObject else { return nil }
            return TrayOption(
                title: o["title"] as? String ?? "",
                subtitle: o["subtitle"] as? String ?? "",
                price: o["price"] as? String ?? "",
                imageUrl: o["imageUrl"] as? String ?? "",
                detail: o["detail"] as? String ?? ""
            )
        }
        let choice = call.getInt("choice") ?? 0
        let note = call.getString("note")
        DispatchQueue.main.async {
            self.scanner?.applyResult(scanId: scanId, status: status, options: options, choice: choice, note: note)
            call.resolve()
        }
    }
}

// MARK: - Data

struct TrayOption {
    let title: String
    let subtitle: String
    let price: String
    let imageUrl: String
    let detail: String
}

final class ScanItem {
    let id: String
    let thumbnail: UIImage           // the scanned card, small — shown until the catalog photo loads
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
    var onScanned: ((String, [[String: Any]]) -> Void)?
    var onFinish: (([[String: Any]]) -> Void)?

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
    // waiting for the next card
    private var lastScanCenter = CGPoint.zero
    private var lastScanSignature: PictureMatcher.Signature?
    private var lastSwapCheckAt: CFTimeInterval = 0
    private var steadySince: CFTimeInterval = 0
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
    private var tray: UICollectionView!
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

    // Tuning — CardScanner.md "Tuning"
    private static let cardAspect: (min: Float, max: Float) = (0.55, 0.9)  // 63 × 88 mm, tilted, sleeved
    private static let steadyMotion: CGFloat = 0.018     // corner movement per frame still counted as steady
    private static let steadyTime: CGFloat = 0.45        // seconds of steadiness to fill the ring
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
        notify.prepare()
        tap.prepare()
        checkCameraAccess()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer.frame = view.bounds
        for l in [outlineLayer, ringLayer, flashLayer] { l.frame = view.bounds }
        activeBeam.frame = CGRect(x: 0, y: -24, width: activeImage.bounds.width, height: 24)
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        setTorch(on: false)
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

        let trayBackground = UIView()
        trayBackground.backgroundColor = UIColor(white: 0, alpha: 0.6)

        for v in [trayBackground, closeButton, torchButton, titleLabel, hintLabel, activeCard, shutterButton, doneButton, tray!] as [UIView] {
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
            ["scanId": $0.id, "choice": $0.choice, "confirmed": $0.confirmed] as [String: Any]
        }
        finish(with: Array(picks))
    }

    private func finish(with picks: [[String: Any]]) {
        guard !finished else { return }
        finished = true
        dismiss(animated: true) { self.onFinish?(picks) }
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
            // More frames of text for the card being read (only while it's still in place)
            if let q = found, motion < Self.steadyMotion * 2 {
                readMore(CIImage(cvPixelBuffer: pixels).oriented(.right), quad: q, now: now)
            } else if now - readingStarted > 1.2 {
                finishReading()
            }
            showOutline(present ? smoothQuad : nil, imageSize: imageSize, ring: 1, locked: true)
            return

        case .waitingForNext:
            // Ready for the next card once this one is gone — or swapped in place for a different one
            if !present && now - lastSeenAt > Self.goneAfter {
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
                           let sig = PictureMatcher.signature(of: flat), PictureMatcher.distance(sig, last) > 0.35 {
                            DebugScans.log("different card in place — scanning it")
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
        if DebugScans.enabled { recordStats(found: found != nil, motion: motion, focusing: focusing, now: now) }
        if found != nil && motion < Self.steadyMotion && !focusing {
            steadiness = min(1, steadiness + dt / Self.steadyTime)
        } else if found != nil && motion >= Self.steadyMotion * 2 {
            steadiness = max(0, steadiness - dt / 0.35)
        }
        let ready = manualCapture || steadiness >= 1
        showOutline(quad, imageSize: imageSize, ring: steadiness, locked: ready)
        DispatchQueue.main.async { self.wantHint(focusing ? "Focusing…" : "Hold steady") }
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
        DebugScans.log(String(format: "frames %d, card found %d, focusing %d, motion median %.4f max %.4f, steadiness %.2f, phase %@, tracking %@, zoom %.2f",
                              statFrames, statFound, statFocusing, med, m.last ?? -1, steadiness, "\(phase)", tracker == nil ? "no" : "yes", device?.videoZoomFactor ?? 0))
        statFrames = 0; statFound = 0; statFocusing = 0; statMotion = []; statAt = now
    }

    // MARK: Reading the card

    private func beginReading(_ frame: CIImage, quad: [CGPoint]?, imageSize: CGSize, now: CFTimeInterval) {
        let flat: CGImage?
        if let q = quad {
            flat = flatten(frame, quad: q)
        } else {
            let e = frame.extent
            let h = e.height * 0.6, w = h * 63 / 88
            let crop = frame.cropped(to: CGRect(x: e.midX - w / 2, y: e.midY - h / 2, width: w, height: h))
            flat = ciContext.createCGImage(crop, from: crop.extent)
        }
        guard let card = flat else { return }
        busy = true
        phase = .reading
        readingId = UUID().uuidString
        readingLines = []
        readingImage = nil
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
        if Self.hasCode(readingLines.last ?? []) || readingLines.count >= Self.maxReadFrames { finishReading() }
    }

    private func readMore(_ frame: CIImage, quad: [CGPoint], now: CFTimeInterval) {
        guard let card = flatten(frame, quad: quad) else { return }
        busy = true
        readFrame(card)
        busy = false
        if Self.hasCode(readingLines.last ?? []) || readingLines.count >= Self.maxReadFrames { finishReading() }
    }

    /// OCR one flattened frame (turned the right way up), keeping the best-oriented picture
    private func readFrame(_ card: CGImage) {
        let t0 = CACurrentMediaTime()
        var lines = readText(card)
        var upright = card
        if !Self.hasCode(lines), let flipped = rotate180(card) {
            let other = readText(flipped)
            if Self.hasCode(other) || Self.chars(other) > Self.chars(lines) * 3 / 2 {
                lines = other
                upright = flipped
            }
        }
        if readingImage == nil || Self.hasCode(lines) { readingImage = upright }
        readingLines.append(lines)
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
        let cardOnly = slab ? (cardInsideSlab(image) ?? image) : image
        let signature = PictureMatcher.signature(of: cardOnly)
        let thumb = Self.thumbnail(image)
        if slab { DebugScans.log("graded slab — comparing the card inside it (\(cardOnly.width)×\(cardOnly.height))") }
        lastScanSignature = signature
        lastSwapCheckAt = CACurrentMediaTime()
        steadySince = 0
        phase = .waitingForNext
        DebugScans.save(scanId: id, image: image, info: [
            "frames": readingLines, "merged": merged, "ms": Int((CACurrentMediaTime() - readingStarted) * 1000),
        ])

        DispatchQueue.main.async {
            let item = ScanItem(id: id, thumbnail: thumb)
            item.signature = signature
            if merged.isEmpty {
                item.status = "none"
                item.note = "No text read — hold it flatter, out of the glare"
                self.notify.notificationOccurred(.error)
            }
            self.items.insert(item, at: 0)
            self.tray.insertItems(at: [IndexPath(item: 0, section: 0)])
            self.tray.scrollToItem(at: IndexPath(item: 0, section: 0), at: .left, animated: true)
            if merged.isEmpty {
                self.endActive(id: id, result: "Couldn’t read that card — try again")
            } else {
                self.setStage("Finding the card…", for: id)
                self.onScanned?(id, merged)
            }
        }
    }

    /// The card, straight on and upright, ~1400 px tall. The outline is pushed out 1.5% so a
    /// slightly tight detection doesn't clip the number line along the edge.
    private func flatten(_ image: CIImage, quad: [CGPoint]) -> CGImage? {
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
        pattern: "\\d{1,3}\\s?/\\s?\\d{2,3}|\\b(OP|ST|EB|PRB)[0-9O]{2}\\s?-\\s?[0-9O]{3}|\\b[A-Z0-9]{3,4}\\s?[•·*]\\s?EN\\b|\\bSWSH\\d|\\bP-\\d{3}|\\d{3}/[A-Za-z]{1,4}-?P")
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

    private static func thumbnail(_ image: CGImage) -> UIImage {
        let full = UIImage(cgImage: image)
        let target = CGSize(width: 172, height: 240)
        return UIGraphicsImageRenderer(size: target).image { _ in full.draw(in: CGRect(origin: .zero, size: target)) }
    }

    // MARK: Results from the site

    func signature(for scanId: String) -> PictureMatcher.Signature? {
        items.first { $0.id == scanId }?.signature
    }

    func applyResult(scanId: String, status: String, options: [TrayOption], choice: Int, note: String?) {
        guard let index = items.firstIndex(where: { $0.id == scanId }) else { return }
        let item = items[index]
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

    func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
        let item = items[indexPath.item]
        let title = item.options.isEmpty ? "Not found" : "Which card is it?"
        var message = item.note
        if DebugScans.enabled, let d = item.options.first?.detail, !d.isEmpty { message = [message, "Test build: \(d)"].compactMap { $0 }.joined(separator: "\n") }
        let sheet = UIAlertController(title: title, message: message, preferredStyle: .actionSheet)
        for (i, o) in item.options.prefix(8).enumerated() {
            let mark = i == item.choice ? "✓ " : ""
            let price = o.price.isEmpty ? "" : " · \(o.price)"
            sheet.addAction(UIAlertAction(title: "\(mark)\(o.title) — \(o.subtitle)\(price)", style: .default) { _ in
                item.choice = i
                item.status = "matched"
                item.confirmed = true
                self.tray.reloadItems(at: [IndexPath(item: self.items.firstIndex { $0 === item } ?? 0, section: 0)])
                self.refreshDone()
            })
        }
        sheet.addAction(UIAlertAction(title: "Remove", style: .destructive) { _ in
            guard let i = self.items.firstIndex(where: { $0 === item }) else { return }
            self.items.remove(at: i)
            self.tray.deleteItems(at: [IndexPath(item: i, section: 0)])
            self.refreshDone()
        })
        sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        if let pop = sheet.popoverPresentationController, let cell = collectionView.cellForItem(at: indexPath) {
            pop.sourceView = cell
            pop.sourceRect = cell.bounds
        }
        present(sheet, animated: true)
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

    override init(frame: CGRect) {
        super.init(frame: frame)
        image.contentMode = .scaleAspectFill
        image.clipsToBounds = true
        image.layer.cornerRadius = 5
        image.backgroundColor = UIColor(white: 1, alpha: 0.08)
        name.font = .systemFont(ofSize: 11, weight: .semibold)
        name.textColor = .white
        name.numberOfLines = 2
        price.font = .systemFont(ofSize: 11, weight: .regular)
        price.textColor = UIColor(red: 0.85, green: 0.70, blue: 0.35, alpha: 1)
        badge.font = .systemFont(ofSize: 13, weight: .bold)
        badge.textAlignment = .center
        badge.layer.cornerRadius = 11
        badge.clipsToBounds = true
        spinner.color = .white
        for v in [image, name, price, badge, spinner] as [UIView] {
            v.translatesAutoresizingMaskIntoConstraints = false
            contentView.addSubview(v)
        }
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
            badge.topAnchor.constraint(equalTo: image.topAnchor, constant: 4),
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
        name.text = option?.title ?? (item.status == "matching" ? "Matching…" : "Not found")
        price.text = option?.price
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
