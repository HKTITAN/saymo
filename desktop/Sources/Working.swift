import SwiftUI

// The studio's own "working" look, redrawn natively for the launch screen:
// Aerchain's ai mark (the orange swoosh with a light sweeping across it and
// the dot hopping) beside one line of text with a soft light passing over it.
// Same shapes, colours and timings as WorkingMark in
// src/components/studio/chat.tsx and .studio-shimmer in src/app/globals.css.
// With Reduce Motion on, nothing moves and the line is plain.

struct WorkingLine: View {
    let text: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { timeline in
            let t = reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate
            HStack(spacing: 14) {
                AiMark(time: t, still: reduceMotion)
                    .frame(width: 44, height: 44 * 34 / 46)
                ZStack(alignment: .leading) {
                    ShimmerText(text: text, time: t, still: reduceMotion)
                        .id(text)
                        .transition(reduceMotion
                            ? .opacity
                            : .opacity.combined(with: .offset(y: 4)))
                }
                .animation(.easeOut(duration: 0.2), value: text)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text)
        .accessibilityAddTraits(.updatesFrequently)
    }
}

// ─── The shimmering line ─────────────────────────────────────────────────

private struct ShimmerText: View {
    let text: String
    let time: Double
    let still: Bool

    var body: some View {
        let label = Text(text).font(.system(size: 14, weight: .medium))
        if still {
            label.foregroundStyle(Color.white.opacity(0.6))
        } else {
            // A gradient two and a half times the line's width slides across
            // it every 1.8 s: white at 35%, brightening to 85% in the middle.
            let phase = time.truncatingRemainder(dividingBy: 1.8) / 1.8
            let start = -1.5 * (1 - phase)
            let base = Color.white.opacity(0.35)
            label.foregroundStyle(LinearGradient(
                stops: [
                    .init(color: base, location: 0),
                    .init(color: base, location: 0.35),
                    .init(color: Color.white.opacity(0.85), location: 0.5),
                    .init(color: base, location: 0.65),
                    .init(color: base, location: 1),
                ],
                startPoint: UnitPoint(x: start, y: 0.5),
                endPoint: UnitPoint(x: start + 2.5, y: 0.5)))
        }
    }
}

// ─── The ai mark ─────────────────────────────────────────────────────────

private struct AiMark: View {
    let time: Double
    let still: Bool

    private static let orange = Color(red: 0xF5 / 255, green: 0x5A / 255, blue: 0)
    private static let light = Color(red: 1, green: 0xD2 / 255, blue: 0xB8 / 255)
    private static let swoosh = SVGPath.parse(AiMark.swooshPath)

    var body: some View {
        Canvas { context, size in
            // The mark's own units: the box 128, -4, 46 × 34.
            let scale = size.width / 46
            context.scaleBy(x: scale, y: scale)
            context.translateBy(x: -128, y: 4)

            var clipped = context
            clipped.clip(to: AiMark.swoosh)
            clipped.fill(Path(CGRect(x: 128, y: -4, width: 46, height: 34)), with: .color(AiMark.orange))
            if !still {
                // A light band sweeps across the swoosh every 1.6 s.
                let p = easeInOut(time.truncatingRemainder(dividingBy: 1.6) / 1.6)
                clipped.fill(
                    Path(CGRect(x: 110 + 80 * p, y: -4, width: 12, height: 34)),
                    with: .color(AiMark.light.opacity(0.75)))
            }

            // The dot hops every 0.8 s, squashing as it lands.
            let hop = still ? Hop(lift: 0, sx: 1, sy: 1) : Hop.at(time.truncatingRemainder(dividingBy: 0.8) / 0.8)
            let r = 2.4
            let foot = CGPoint(x: 169.4, y: 6.1 + r)
            var dot = context
            dot.translateBy(x: foot.x, y: foot.y + hop.lift)
            dot.scaleBy(x: hop.sx, y: hop.sy)
            dot.fill(Path(ellipseIn: CGRect(x: -r, y: -2 * r, width: 2 * r, height: 2 * r)), with: .color(AiMark.orange))
        }
    }

    private static let swooshPath =
        "M172.309 19.9259C172.411 14.5877 170.209 8.11491 164.449 11.7919C163.965 11.9834 163.689 11.9158 163.434 11.5498C162.707 10.2096 162.149 8.83849 161.458 7.43075C156.259 -6.19338 150.322 1.59707 144.051 9.66061C130.046 28.102 136.644 36.2697 158.719 20.0751C159.49 19.5176 161.035 18.352 161.591 18.3041C162.177 18.2084 162.42 18.6927 162.862 19.7063C163.291 20.7452 164.004 22.2177 164.656 23.2678C168.423 30.7148 172.597 28.9889 172.312 19.9568V19.9259H172.309ZM155.709 17.1498C152.931 18.9179 150.295 21.083 147.243 22.3753C145.914 22.9412 143.976 22.3162 143.498 21.221C142.956 19.5232 144.894 17.0203 145.845 15.2578C146.948 13.2504 148.41 11.4653 149.811 9.64653C151.171 7.85307 153.017 5.19244 155.576 6.35523C157.63 7.54337 158.473 10.829 159.648 12.8111C160.178 13.6699 160.162 14.278 159.233 14.7961C158.108 15.5253 156.889 16.3558 155.731 17.1385L155.709 17.1526V17.1498ZM170.761 20.6663C170.701 21.6884 170.51 25.554 169.23 23.7127C168.042 21.4378 166.737 18.6026 165.574 16.1785C165.12 14.9396 167.948 14.4385 168.683 14.6496C170.737 15.4211 170.808 18.7208 170.761 20.6494V20.6692V20.6663Z"
}

// The hop's keyframes, as the CSS has them (studio-mark-hop): the lift goes
// 0, up 5 at 45%, back to 0 at 80%; the squash goes 1 → 1.15 × 0.85 at 15%
// → 0.95 × 1.05 at 45% → 1.1 × 0.9 at 80% → 1. Each step eases in and out.
private struct Hop {
    var lift: Double
    var sx: Double
    var sy: Double

    static func at(_ p: Double) -> Hop {
        let lift = keyframes(p, [(0, 0), (0.45, -5), (0.8, 0), (1, 0)])
        let sx = keyframes(p, [(0, 1), (0.15, 1.15), (0.45, 0.95), (0.8, 1.1), (1, 1)])
        let sy = keyframes(p, [(0, 1), (0.15, 0.85), (0.45, 1.05), (0.8, 0.9), (1, 1)])
        return Hop(lift: lift, sx: sx, sy: sy)
    }

    private static func keyframes(_ p: Double, _ frames: [(Double, Double)]) -> Double {
        for i in 1..<frames.count where p <= frames[i].0 {
            let (t0, v0) = frames[i - 1]
            let (t1, v1) = frames[i]
            let local = t1 > t0 ? (p - t0) / (t1 - t0) : 1
            return v0 + (v1 - v0) * easeInOut(local)
        }
        return frames.last?.1 ?? 0
    }
}

// CSS's ease-in-out, cubic-bezier(0.42, 0, 0.58, 1).
private func easeInOut(_ x: Double) -> Double {
    let x = min(max(x, 0), 1)
    func bezier(_ t: Double, _ a: Double, _ b: Double) -> Double {
        let u = 1 - t
        return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t
    }
    var lo = 0.0, hi = 1.0, t = x
    for _ in 0..<24 {
        t = (lo + hi) / 2
        if bezier(t, 0.42, 0.58) < x { lo = t } else { hi = t }
    }
    return bezier(t, 0, 1)
}

// Reads an SVG path made of absolute M, L, H, V, C and Z commands, which is
// all the ai mark uses.
enum SVGPath {
    static func parse(_ d: String) -> Path {
        var path = Path()
        var tokens: [String] = []
        var number = ""
        func flush() {
            if !number.isEmpty { tokens.append(number); number = "" }
        }
        for ch in d {
            if ch.isLetter && ch != "e" {
                flush()
                tokens.append(String(ch))
            } else if ch == " " || ch == "," {
                flush()
            } else if ch == "-" && !number.isEmpty && !number.hasSuffix("e") {
                flush()
                number = "-"
            } else {
                number.append(ch)
            }
        }
        flush()

        var i = 0
        var command = "M"
        var current = CGPoint.zero
        func next() -> Double {
            defer { i += 1 }
            return Double(tokens[i]) ?? 0
        }
        while i < tokens.count {
            if let first = tokens[i].first, first.isLetter {
                command = tokens[i]
                i += 1
                if command == "Z" {
                    path.closeSubpath()
                    continue
                }
            }
            switch command {
            case "M":
                current = CGPoint(x: next(), y: next())
                path.move(to: current)
                command = "L"
            case "L":
                current = CGPoint(x: next(), y: next())
                path.addLine(to: current)
            case "H":
                current = CGPoint(x: next(), y: current.y)
                path.addLine(to: current)
            case "V":
                current = CGPoint(x: current.x, y: next())
                path.addLine(to: current)
            case "C":
                let c1 = CGPoint(x: next(), y: next())
                let c2 = CGPoint(x: next(), y: next())
                current = CGPoint(x: next(), y: next())
                path.addCurve(to: current, control1: c1, control2: c2)
            default:
                i += 1
            }
        }
        return path
    }
}
