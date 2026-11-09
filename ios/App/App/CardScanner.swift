// The TCGHaven card scanner — the native half. Plan and research: CardScanner.md.
//
// This screen owns the camera and does everything that needs the phone's hardware:
//   1. find the card in each video frame (Vision rectangle detection, card-shaped)
//   2. wait until it's held still, then flatten it to a straight-on picture (perspective correction)
//   3. read its text (Vision OCR — English + Japanese; upside-down cards are turned the right way)
//   4. hand the text to the site (the "cardScanned" event) — lib/scan/scanner.ts matches it against
//      the catalog on the server and sends back the candidates ("update")
//   5. compare the scanned card's picture with candidate catalog photos ("compare" — PictureMatcher)
//      so look-alikes the text can't separate (One Piece parallels, reprints) are told apart
//   6. a tray of everything scanned; "Add" returns the picks to the site, which saves them through
//      lib/firebase/db.ts like any other added card (ScanReviewDialog.tsx)
//
// Nothing here writes user data, and no photo leaves the phone — only the text that was read.

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
            guard let signature = self.scanner?.signature(for: scanId) else {
                call.resolve(["distances": urls.map { _ in NSNull() }])
                return
            }
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
                imageUrl: o["imageUrl"] as? String ?? ""
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

    // Frame state (frameQueue only)
    private var busy = false
    private var lastFrameAt: CFTimeInterval = 0
    private var lastQuad: [CGPoint]?
    private var stableFrames = 0
    private var waitingForRemoval = false
    private var lastCardSeenAt: CFTimeInterval = 0
    private var manualCapture = false

    // UI (main thread)
    private let quadLayer = CAShapeLayer()
    private let hintLabel = PaddedLabel()
    private let doneButton = UIButton(type: .system)
    private let closeButton = UIButton(type: .system)
    private let torchButton = UIButton(type: .system)
    private let shutterButton = UIButton(type: .custom)
    private var tray: UICollectionView!
    private var items: [ScanItem] = []
    private var finished = false

    private let successHaptic = UINotificationFeedbackGenerator()
    private let tapHaptic = UIImpactFeedbackGenerator(style: .light)

    // Card proportions: 63 × 88 mm. Allow for tilt and sleeves/toploaders.
    private static let cardAspect: (min: Float, max: Float) = (0.55, 0.9)
    private static let stableNeeded = 4            // frames in a row with the card held still
    private static let stillness: CGFloat = 0.012  // max corner movement between frames (fraction of the frame)
    private static let goneAfter: CFTimeInterval = 0.5

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

        quadLayer.strokeColor = UIColor(red: 0.85, green: 0.70, blue: 0.35, alpha: 1).cgColor
        quadLayer.fillColor = UIColor(red: 0.85, green: 0.70, blue: 0.35, alpha: 0.12).cgColor
        quadLayer.lineWidth = 3
        quadLayer.lineJoin = .round
        view.layer.addSublayer(quadLayer)

        buildControls()
        successHaptic.prepare()
        checkCameraAccess()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer.frame = view.bounds
        quadLayer.frame = view.bounds
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        setTorch(on: false)
        sessionQueue.async { if self.session.isRunning { self.session.stopRunning() } }
    }

    // MARK: Controls

    private func buildControls() {
        let gold = UIColor(red: 0.85, green: 0.70, blue: 0.35, alpha: 1)

        closeButton.setImage(UIImage(systemName: "xmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 17, weight: .semibold)), for: .normal)
        closeButton.tintColor = .white
        closeButton.backgroundColor = UIColor(white: 0, alpha: 0.45)
        closeButton.layer.cornerRadius = 20
        closeButton.accessibilityLabel = "Close"
        closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)

        torchButton.setImage(UIImage(systemName: "flashlight.off.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 17, weight: .semibold)), for: .normal)
        torchButton.tintColor = .white
        torchButton.backgroundColor = UIColor(white: 0, alpha: 0.45)
        torchButton.layer.cornerRadius = 20
        torchButton.accessibilityLabel = "Light"
        torchButton.addTarget(self, action: #selector(torchTapped), for: .touchUpInside)

        let title = UILabel()
        title.text = screenTitle
        title.textColor = .white
        title.font = .systemFont(ofSize: 17, weight: .semibold)

        hintLabel.text = "Point at a card"
        hintLabel.textColor = .white
        hintLabel.font = .systemFont(ofSize: 15, weight: .medium)
        hintLabel.textAlignment = .center
        hintLabel.numberOfLines = 2
        hintLabel.backgroundColor = UIColor(white: 0, alpha: 0.55)
        hintLabel.layer.cornerRadius = 14
        hintLabel.clipsToBounds = true

        shutterButton.backgroundColor = UIColor(white: 1, alpha: 0.9)
        shutterButton.layer.cornerRadius = 32
        shutterButton.layer.borderWidth = 4
        shutterButton.layer.borderColor = UIColor(white: 1, alpha: 0.4).cgColor
        shutterButton.accessibilityLabel = "Scan now"
        shutterButton.addTarget(self, action: #selector(shutterTapped), for: .touchUpInside)

        var done = UIButton.Configuration.filled()
        done.title = "Add"
        done.baseBackgroundColor = gold
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

        for v in [trayBackground, closeButton, torchButton, title, hintLabel, shutterButton, doneButton, tray!] as [UIView] {
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
            title.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            title.centerYAnchor.constraint(equalTo: closeButton.centerYAnchor),
            hintLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            hintLabel.topAnchor.constraint(equalTo: closeButton.bottomAnchor, constant: 14),
            hintLabel.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, constant: -48),

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

    private func setHint(_ text: String) {
        if hintLabel.text != text { hintLabel.text = text }
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
        let picks = items.filter { $0.status == "matched" || $0.status == "pick" }.map {
            ["scanId": $0.id, "choice": $0.choice, "confirmed": $0.confirmed] as [String: Any]
        }
        finish(with: picks)
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
            torchButton.tintColor = on ? UIColor(red: 0.85, green: 0.70, blue: 0.35, alpha: 1) : .white
        } catch {}
    }

    @objc private func shutterTapped() {
        tapHaptic.impactOccurred()
        frameQueue.async {
            self.waitingForRemoval = false
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
        setHint("TCGHaven needs the camera to scan cards")
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
                DispatchQueue.main.async { self.setHint("No camera found") }
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
            device.unlockForConfiguration()
        } catch {}
    }

    // MARK: Frames

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        let now = CACurrentMediaTime()
        guard !busy, !finished, now - lastFrameAt > 0.07, let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        lastFrameAt = now

        // The sensor is landscape; .right is the upright portrait picture the person sees
        let request = VNDetectRectanglesRequest()
        request.minimumAspectRatio = Self.cardAspect.min
        request.maximumAspectRatio = Self.cardAspect.max
        request.minimumSize = 0.3
        request.quadratureTolerance = 22
        request.minimumConfidence = 0.6
        request.maximumObservations = 1
        let handler = VNImageRequestHandler(cvPixelBuffer: pixels, orientation: .right, options: [:])
        try? handler.perform([request])
        let rect = request.results?.first

        let imageSize = CGSize(width: CVPixelBufferGetHeight(pixels), height: CVPixelBufferGetWidth(pixels)) // upright
        guard let card = rect else {
            if now - lastCardSeenAt > Self.goneAfter { waitingForRemoval = false }
            lastQuad = nil
            stableFrames = 0
            if manualCapture {
                manualCapture = false
                captureWhole(pixels)
                return
            }
            let waiting = waitingForRemoval
            DispatchQueue.main.async {
                self.drawQuad(nil, imageSize: imageSize)
                if !waiting { self.setHint("Point at a card") }
            }
            return
        }
        lastCardSeenAt = now

        let quad = [card.topLeft, card.topRight, card.bottomRight, card.bottomLeft]
        if let last = lastQuad, zip(quad, last).allSatisfy({ hypot($0.0.x - $0.1.x, $0.0.y - $0.1.y) < Self.stillness }) {
            stableFrames += 1
        } else {
            stableFrames = 0
        }
        lastQuad = quad
        let waiting = waitingForRemoval
        let ready = manualCapture || (!waitingForRemoval && stableFrames >= Self.stableNeeded)
        DispatchQueue.main.async {
            self.drawQuad(quad, imageSize: imageSize, locked: ready)
            if !waiting && !ready { self.setHint("Hold still…") }
        }
        guard ready else { return }

        manualCapture = false
        waitingForRemoval = true
        stableFrames = 0
        busy = true
        let upright = CIImage(cvPixelBuffer: pixels).oriented(.right)
        guard let flat = flatten(upright, quad: quad) else { busy = false; return }
        process(flat)
    }

    /// The shutter with no card outline found: use the middle of the picture
    private func captureWhole(_ pixels: CVPixelBuffer) {
        busy = true
        waitingForRemoval = true
        let upright = CIImage(cvPixelBuffer: pixels).oriented(.right)
        let e = upright.extent
        let h = e.height * 0.6, w = h * 63 / 88
        let crop = upright.cropped(to: CGRect(x: e.midX - w / 2, y: e.midY - h / 2, width: w, height: h))
        guard let cg = ciContext.createCGImage(crop, from: crop.extent) else { busy = false; return }
        process(cg)
    }

    /// The card, straight on and upright, ~1400 px tall
    private func flatten(_ image: CIImage, quad: [CGPoint]) -> CGImage? {
        let size = image.extent.size
        // Vision's points are 0–1 from the bottom-left, the same corner Core Image measures from
        let p = quad.map { CIVector(x: $0.x * size.width + image.extent.minX, y: $0.y * size.height + image.extent.minY) }
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

    // MARK: Reading the card

    private func process(_ card: CGImage) {
        DispatchQueue.main.async {
            self.tapHaptic.impactOccurred()
            self.setHint("Reading…")
        }
        var lines = readText(card)
        var upright = card
        if !Self.hasCode(lines), let flipped = rotate180(card) {
            let other = readText(flipped)
            if Self.hasCode(other) || Self.chars(other) > Self.chars(lines) * 3 / 2 {
                lines = other
                upright = flipped
            }
        }
        let signature = PictureMatcher.signature(of: upright)
        let thumb = Self.thumbnail(upright)
        let id = UUID().uuidString

        DispatchQueue.main.async {
            let item = ScanItem(id: id, thumbnail: thumb)
            item.signature = signature
            if lines.isEmpty {
                item.status = "none"
                item.note = "No text read — hold it flatter, out of the glare"
                self.successHaptic.notificationOccurred(.error)
            }
            self.items.insert(item, at: 0)
            self.tray.insertItems(at: [IndexPath(item: 0, section: 0)])
            self.tray.scrollToItem(at: IndexPath(item: 0, section: 0), at: .left, animated: true)
            self.setHint(lines.isEmpty ? "Couldn’t read that one — try again" : "Got it — next card")
            if !lines.isEmpty { self.onScanned?(id, lines) }
            self.frameQueue.async { self.busy = false }
        }
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
        pattern: "\\d{1,3}\\s?/\\s?\\d{2,3}|\\b(OP|ST|EB|PRB)\\d{2}-\\d{3}|\\b[A-Z0-9]{3,4}\\s?[•·]\\s?EN\\b|\\bSWSH\\d|\\bP-\\d{3}")
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
        switch item.status {
        case "matched": successHaptic.notificationOccurred(.success)
        case "pick": successHaptic.notificationOccurred(.warning)
        default: successHaptic.notificationOccurred(.error)
        }
    }

    // MARK: Card outline

    private func drawQuad(_ quad: [CGPoint]?, imageSize: CGSize, locked: Bool = false) {
        guard let quad = quad else { quadLayer.path = nil; return }
        let bounds = view.bounds
        let scale = max(bounds.width / imageSize.width, bounds.height / imageSize.height)
        let dx = (imageSize.width * scale - bounds.width) / 2
        let dy = (imageSize.height * scale - bounds.height) / 2
        let pts = quad.map { CGPoint(x: $0.x * imageSize.width * scale - dx, y: (1 - $0.y) * imageSize.height * scale - dy) }
        let path = UIBezierPath()
        path.move(to: pts[0])
        for p in pts.dropFirst() { path.addLine(to: p) }
        path.close()
        quadLayer.path = path.cgPath
        quadLayer.lineWidth = locked ? 5 : 3
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
        let sheet = UIAlertController(title: title, message: item.note, preferredStyle: .actionSheet)
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
