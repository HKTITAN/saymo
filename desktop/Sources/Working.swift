import SwiftUI

// The studio's own "working" look, redrawn natively for the launch screen:
// a small hopping dot beside one line of text with a soft light passing over
// it. Same shapes and timings as WorkingMark in
// src/components/studio/chat/chat.tsx and .studio-shimmer in src/app/globals.css.
// With Reduce Motion on, nothing moves and the line is plain.

struct WorkingLine: View {
    let text: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { timeline in
            let t = reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate
            HStack(spacing: 14) {
                HopDot(time: t, still: reduceMotion)
                    .frame(width: 12, height: 18)
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

// ─── The hopping dot ─────────────────────────────────────────────────────

private struct HopDot: View {
    let time: Double
    let still: Bool

    var body: some View {
        Canvas { context, size in
            // The dot hops every 0.8 s, squashing as it lands.
            let hop = still ? Hop(lift: 0, sx: 1, sy: 1) : Hop.at(time.truncatingRemainder(dividingBy: 0.8) / 0.8)
            let r = 3.0
            var dot = context
            dot.translateBy(x: size.width / 2, y: size.height + hop.lift)
            dot.scaleBy(x: hop.sx, y: hop.sy)
            dot.fill(Path(ellipseIn: CGRect(x: -r, y: -2 * r, width: 2 * r, height: 2 * r)), with: .color(.primary.opacity(0.7)))
        }
    }
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
