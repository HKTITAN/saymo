// Three small jobs for the tool, done by macOS's own Vision framework (the
// same one behind Finder's Remove Background), so nothing leaves the Mac.
// The tool compiles this file once, on first use.
//
// usage: vision cutout <in.png> <out.png>
//          lifts the subject out of a photo and writes it as a PNG on a
//          transparent background; exits with code 2 when there is no subject
//        vision face <in.png>
//          prints the largest face as {"x","y","width","height"} in the
//          photo's pixels, measured from the top-left, or null
//        vision matte <in.mp4> <out-dir>
//          the person in every frame of a video, as a grey mask at the
//          frame's size (white is them), one PNG per frame (m00001.png on);
//          prints how many frames. Vision follows them from frame to frame,
//          so the edge holds steady, and the edge is crisp: no fuzz, no rim
//          of the old background.

import AVFoundation
import CoreImage
import Foundation
import Vision

func fail(_ message: String, _ code: Int32 = 1) -> Never {
  FileHandle.standardError.write("\(message)\n".data(using: .utf8)!)
  exit(code)
}

let args = CommandLine.arguments
guard args.count >= 3 else { fail("usage: vision cutout <in> <out> | vision face <in>") }
let input = URL(fileURLWithPath: args[2])
let handler = VNImageRequestHandler(url: input)

do {
  switch args[1] {
  case "cutout":
    guard args.count == 4 else { fail("usage: vision cutout <in> <out>") }
    let request = VNGenerateForegroundInstanceMaskRequest()
    try handler.perform([request])
    guard let result = request.results?.first, !result.allInstances.isEmpty else {
      fail("no subject found", 2)
    }
    let buffer = try result.generateMaskedImage(
      ofInstances: result.allInstances, from: handler, croppedToInstancesExtent: false)
    try CIContext().writePNGRepresentation(
      of: CIImage(cvPixelBuffer: buffer), to: URL(fileURLWithPath: args[3]),
      format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)

  case "face":
    guard let size = CIImage(contentsOf: input)?.extent.size else { fail("cannot read \(args[2])") }
    let request = VNDetectFaceRectanglesRequest()
    try handler.perform([request])
    let faces = request.results ?? []
    guard let face = faces.max(by: { $0.boundingBox.width < $1.boundingBox.width }) else {
      print("null")
      exit(0)
    }
    // Vision measures from the bottom-left, as fractions of the photo.
    let box = face.boundingBox
    print(
      String(
        format: "{\"x\":%.1f,\"y\":%.1f,\"width\":%.1f,\"height\":%.1f}",
        box.minX * size.width, (1 - box.maxY) * size.height,
        box.width * size.width, box.height * size.height))

  case "matte":
    guard args.count == 4 else { fail("usage: vision matte <in-video> <out-dir>") }
    let asset = AVURLAsset(url: input)
    guard let track = asset.tracks(withMediaType: .video).first else { fail("no video in \(args[2])") }
    let reader = try AVAssetReader(asset: asset)
    let frames = AVAssetReaderTrackOutput(
      track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
    frames.alwaysCopiesSampleData = false
    reader.add(frames)
    guard reader.startReading() else { fail("cannot read \(args[2])") }
    // The person finder at its finest, with one handler for the whole run
    // so it carries what it saw from frame to frame (a steady edge).
    let person = VNGeneratePersonSegmentationRequest()
    person.qualityLevel = .accurate
    person.outputPixelFormat = kCVPixelFormatType_OneComponent8
    let sequence = VNSequenceRequestHandler()
    let context = CIContext()
    let grey = CGColorSpace(name: CGColorSpace.linearGray)!
    let folder = URL(fileURLWithPath: args[3])
    // The soft edge pulled in to about a pixel: no fuzz, still not jagged.
    let crisp: [String: Any] = [
      "inputPoint0": CIVector(x: 0, y: 0), "inputPoint1": CIVector(x: 0.3, y: 0.02),
      "inputPoint2": CIVector(x: 0.5, y: 0.5), "inputPoint3": CIVector(x: 0.7, y: 0.98),
      "inputPoint4": CIVector(x: 1, y: 1),
    ]
    var count = 0
    while let sample = frames.copyNextSampleBuffer() {
      guard let frame = CMSampleBufferGetImageBuffer(sample) else { continue }
      let picture = CIImage(cvPixelBuffer: frame)
      let full = picture.extent
      try sequence.perform([person], on: frame, orientation: .up)
      guard let small = person.results?.first?.pixelBuffer else { continue }
      // Enlarged with the frame itself as the guide, so the edge lands on
      // their real outline (hair, shoulders, fingers) instead of a blur;
      // then a hairline off the edge, so no rim of the old background
      // shows, and crisp.
      let mask = picture
        .applyingFilter(
          "CIEdgePreserveUpsampleFilter",
          parameters: ["inputSmallImage": CIImage(cvPixelBuffer: small), "inputSpatialSigma": 3, "inputLumaSigma": 0.1])
        .cropped(to: full).clampedToExtent()
        .applyingFilter("CIMorphologyMinimum", parameters: [kCIInputRadiusKey: 1])
        .applyingFilter("CIToneCurve", parameters: crisp)
        .cropped(to: full)
      count += 1
      try context.writePNGRepresentation(
        of: mask, to: folder.appendingPathComponent(String(format: "m%05d.png", count)), format: .L8, colorSpace: grey)
    }
    guard count > 0 else { fail("no frames in \(args[2])") }
    print(count)

  default:
    fail("unknown job \(args[1])")
  }
} catch {
  fail("\(error)")
}
