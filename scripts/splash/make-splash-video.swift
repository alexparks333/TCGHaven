// Builds public/splash/splash.mp4 — the phone splash as a video (components/layout/SplashIntro.tsx)
// from its frames, public/splash/frame-00…20.webp. A video plays on the iPhone's video hardware, apart
// from the page, so the app loading underneath can't make it stutter (the stacked-picture version
// did, mid-animation, on the TestFlight app — 2026-11-21). macOS only (AVFoundation), no ffmpeg:
//   swiftc -O scripts/splash/make-splash-video.swift -o /tmp/make-splash-video && /tmp/make-splash-video public/splash
// Re-run after re-rendering the frames. Frame time = lib/logoFrames.ts LOGO_FRAME_MS (33 ms), 21 frames.
import Foundation
import AVFoundation
import CoreGraphics
import ImageIO

let dir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "public/splash"
let frames = 21, frameMs: Int64 = 33, size = 720
let out = URL(fileURLWithPath: "\(dir)/splash.mp4")
try? FileManager.default.removeItem(at: out)

let writer = try AVAssetWriter(outputURL: out, fileType: .mp4)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
  AVVideoCodecKey: AVVideoCodecType.h264,
  AVVideoWidthKey: size, AVVideoHeightKey: size,
  AVVideoCompressionPropertiesKey: [
    AVVideoAverageBitRateKey: 6_000_000,
    AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
    AVVideoAllowFrameReorderingKey: false,
  ],
  // Tagged sRGB-like BT.709 so the parchment comes out the same tan as the page around it
  AVVideoColorPropertiesKey: [
    AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
    AVVideoTransferFunctionKey: AVVideoTransferFunction_IEC_sRGB,
    AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
  ],
])
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
  kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
  kCVPixelBufferWidthKey as String: size, kCVPixelBufferHeightKey as String: size,
])
writer.add(input)
writer.startWriting()
writer.startSession(atSourceTime: .zero)

for i in 0..<frames {
  let url = URL(fileURLWithPath: String(format: "%@/frame-%02d.webp", dir, i))
  guard let src = CGImageSourceCreateWithURL(url as CFURL, nil), let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
    fatalError("can't read \(url.path)")
  }
  var pb: CVPixelBuffer?
  CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &pb)
  guard let buf = pb else { fatalError("no pixel buffer") }
  CVPixelBufferLockBaseAddress(buf, [])
  let ctx = CGContext(data: CVPixelBufferGetBaseAddress(buf), width: size, height: size, bitsPerComponent: 8,
                      bytesPerRow: CVPixelBufferGetBytesPerRow(buf), space: CGColorSpace(name: CGColorSpace.sRGB)!,
                      bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
  ctx.draw(img, in: CGRect(x: 0, y: 0, width: size, height: size))
  CVPixelBufferUnlockBaseAddress(buf, [])
  while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.01) }
  adaptor.append(buf, withPresentationTime: CMTime(value: Int64(i) * frameMs, timescale: 1000))
}
input.markAsFinished()
writer.endSession(atSourceTime: CMTime(value: Int64(frames) * frameMs, timescale: 1000))
let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()
if writer.status != .completed { fatalError("failed: \(String(describing: writer.error))") }
let bytes = (try? FileManager.default.attributesOfItem(atPath: out.path)[.size] as? Int) ?? 0
print("wrote \(out.path) — \(frames) frames, \(Int64(frames) * frameMs) ms, \(bytes / 1024) KB")
