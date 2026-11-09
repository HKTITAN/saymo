// Slides helper for Saymo, using the Mac's own frameworks, so
// turning a deck into slides works without any extra installs.
//
//   slides pdf <in.pdf> <out-dir> <width>   draws each page to
//       <out-dir>/page-001.png… at <width> px wide and prints, as JSON,
//       [{ "text": …, "width": …, "height": … }] with each page's own text
//   slides ocr <image>                      prints the words it reads in a
//       picture (for slides that arrive as images or scans)
//
// Built once on first use by src/lib/studio/slides.ts.

import AppKit
import Foundation
import PDFKit
import Vision

func fail(_ message: String) -> Never {
  FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
  exit(1)
}

func png(_ image: NSImage, width: Int, height: Int) -> Data? {
  guard let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8,
    samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
    bytesPerRow: 0, bitsPerPixel: 0)
  else { return nil }
  rep.size = NSSize(width: width, height: height)
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  NSColor.white.setFill()
  NSRect(x: 0, y: 0, width: width, height: height).fill()
  image.draw(in: NSRect(x: 0, y: 0, width: width, height: height))
  NSGraphicsContext.restoreGraphicsState()
  return rep.representation(using: .png, properties: [:])
}

func renderPdf(_ input: String, _ outDir: String, _ width: Int) {
  guard let doc = PDFDocument(url: URL(fileURLWithPath: input)) else { fail("Can't open the PDF.") }
  var pages: [[String: Any]] = []
  for i in 0..<doc.pageCount {
    guard let page = doc.page(at: i) else { continue }
    var box = page.bounds(for: .cropBox).size
    if page.rotation % 180 != 0 { box = NSSize(width: box.height, height: box.width) }
    let height = max(1, Int((Double(width) * Double(box.height) / Double(max(1, box.width))).rounded()))
    let thumb = page.thumbnail(of: NSSize(width: width, height: height), for: .cropBox)
    guard let data = png(thumb, width: width, height: height) else { fail("Can't draw page \(i + 1).") }
    let file = String(format: "%@/page-%03d.png", outDir, i + 1)
    do { try data.write(to: URL(fileURLWithPath: file)) } catch { fail("Can't save page \(i + 1).") }
    pages.append(["text": page.string ?? "", "width": width, "height": height])
  }
  let json = try! JSONSerialization.data(withJSONObject: pages, options: [])
  FileHandle.standardOutput.write(json)
}

func ocr(_ input: String) {
  guard let image = NSImage(contentsOfFile: input),
    let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
  else { fail("Can't open the picture.") }
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = true
  let handler = VNImageRequestHandler(cgImage: cg, options: [:])
  do { try handler.perform([request]) } catch { fail("Can't read the picture.") }
  // Top to bottom, then left to right, as a slide is read.
  let lines = (request.results ?? [])
    .sorted { a, b in
      abs(a.boundingBox.midY - b.boundingBox.midY) > 0.01
        ? a.boundingBox.midY > b.boundingBox.midY : a.boundingBox.minX < b.boundingBox.minX
    }
    .compactMap { $0.topCandidates(1).first?.string }
  print(lines.joined(separator: "\n"))
}

let args = CommandLine.arguments
guard args.count >= 3 else { fail("usage: slides pdf <in> <out-dir> <width> | slides ocr <image>") }
switch args[1] {
case "pdf":
  guard args.count == 5, let width = Int(args[4]), width > 0, width <= 8000 else { fail("usage: slides pdf <in> <out-dir> <width>") }
  renderPdf(args[2], args[3], width)
case "ocr":
  ocr(args[2])
default:
  fail("Unknown job \(args[1]).")
}
