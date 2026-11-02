import SwiftUI

// The launch screen, in the studio's own look: the system font, the studio's
// dark ground, and DialKit rows (one quiet rounded row each, label on the
// left, value on the right). While the studio starts it shows only the
// studio's working mark and one line; logs stay out of sight.

enum Look {
    static let ground = Color(red: 0x0b / 255, green: 0x0b / 255, blue: 0x0b / 255)
    static let groundNS = NSColor(srgbRed: 0x0b / 255, green: 0x0b / 255, blue: 0x0b / 255, alpha: 1)
    static let row = Color.white.opacity(0.05)
    static let rowHover = Color.white.opacity(0.08)
    static let text = Color.white.opacity(0.9)
    static let label = Color.white.opacity(0.65)
    static let quiet = Color.white.opacity(0.4)
    static let ready = Color(red: 0.5, green: 0.83, blue: 0.63)
    static let missing = Color(red: 0.96, green: 0.64, blue: 0.35)
}

struct LaunchView: View {
    @ObservedObject var launcher: Launcher

    var body: some View {
        Group {
            if case let .working(line) = launcher.screen {
                WorkingLine(text: line)
                    .padding(.horizontal, 16)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                // A still page, like a native app's: no scrolling, no bounce.
                VStack(alignment: .leading, spacing: 6) { content }
                    .frame(maxWidth: 420, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 32)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Look.ground)
        .foregroundStyle(Look.text)
        .font(.system(size: 13))
    }

    @ViewBuilder private var content: some View {
        switch launcher.screen {
        case .working:
            EmptyView()

        case let .folder(error):
            Heading("Where is the Motion Studio folder?")
            Detail("The app opens the studio from its folder on this Mac, the one with your films in it. If you don't have it yet, ask whoever looks after the studio for a copy.")
            if let error {
                Text(error).font(.system(size: 12)).foregroundStyle(Look.missing)
                    .padding(.horizontal, 4).padding(.bottom, 10)
            }
            RowButton("Choose folder", primary: true) { launcher.chooseFolder() }

        case let .checks(report, folder):
            Heading(report.blocking ? "A few things to set up first" : "Some features need a few more things")
            Detail(report.blocking
                ? "The studio can open once these are on this Mac."
                : "The studio can open now. What's missing turns off only the features that need it.")
            VStack(alignment: .leading, spacing: 6) {
                ForEach(report.checks) { check in CheckRow(check: check, launcher: launcher) }
            }
            .padding(.bottom, 14)
            if report.canRunSetup {
                RowButton("Install what's missing", primary: true) { launcher.runSetup() }
            }
            RowButton("Check again", primary: !report.canRunSetup && report.blocking) { launcher.retry() }
            if !report.blocking {
                RowButton("Open the studio", primary: !report.canRunSetup) { launcher.openAnyway() }
            }
            Text("Studio folder: \(folder)")
                .font(.system(size: 11.5)).foregroundStyle(Look.quiet)
                .padding(.horizontal, 12).padding(.top, 8)
                .textSelection(.enabled)

        case let .problem(title, detail, log):
            Heading(title)
            Detail(detail)
            RowButton("Try again", primary: true) { launcher.retry() }
            Details(log: log, launcher: launcher)
        }
    }
}

// What went wrong in the tool's own words, folded away until asked for.
private struct Details: View {
    let log: String
    let launcher: Launcher
    @State private var open = false
    @State private var copied = false

    var body: some View {
        HStack(spacing: 16) {
            LinkButton(open ? "Hide details" : "Show details") { open.toggle() }
            if open {
                LinkButton(copied ? "Copied" : "Copy details") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(log, forType: .string)
                    copied = true
                }
                LinkButton("Open the logs folder") { launcher.showLogs() }
            }
        }
        .font(.system(size: 11.5))
        .padding(.horizontal, 4)
        .padding(.top, 8)
        if open {
            ScrollView {
                Text(log.isEmpty ? "Nothing was printed." : log)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(Look.quiet)
                    .lineSpacing(3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
                    .padding(.horizontal, 12).padding(.vertical, 10)
            }
            .scrollIndicators(.never)
            .scrollBounceBehavior(.basedOnSize)
            .frame(maxHeight: 220)
            .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .padding(.top, 6)
        }
    }
}

private struct Heading: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text).font(.system(size: 15, weight: .semibold)).padding(.horizontal, 4).padding(.bottom, 2)
    }
}

private struct Detail: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text).font(.system(size: 12.5)).foregroundStyle(Look.label)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 4).padding(.bottom, 14)
    }
}

private struct CheckRow: View {
    let check: Check
    let launcher: Launcher

    var body: some View {
        HStack(spacing: 12) {
            Text(check.label).foregroundStyle(Look.label)
            Spacer(minLength: 12)
            Text(check.ok ? (check.value ?? "Ready") : "Missing")
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(check.ok ? Look.ready : Look.missing)
        }
        .font(.system(size: 12))
        .padding(.horizontal, 12)
        .frame(minHeight: 36)
        .background(Look.row, in: RoundedRectangle(cornerRadius: 10, style: .continuous))

        if !check.ok {
            VStack(alignment: .leading, spacing: 4) {
                Text(check.help).fixedSize(horizontal: false, vertical: true)
                switch check.fix {
                case let .link(url):
                    LinkButton("Open the download page") { NSWorkspace.shared.open(url) }
                case .installTools:
                    LinkButton("Install tools") { launcher.installTools() }
                default:
                    EmptyView()
                }
            }
            .font(.system(size: 11.5))
            .foregroundStyle(Look.quiet)
            .padding(.horizontal, 12)
            .padding(.bottom, 4)
        }
    }
}

private struct LinkButton: View {
    let title: String
    let action: () -> Void
    init(_ title: String, action: @escaping () -> Void) {
        self.title = title
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Text(title).underline().foregroundStyle(Look.text)
        }
        .buttonStyle(.plain)
    }
}

private struct RowButton: View {
    let title: String
    var primary = false
    let action: () -> Void
    @State private var hover = false

    init(_ title: String, primary: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.primary = primary
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 12, weight: primary ? .medium : .regular))
                .foregroundStyle(primary ? Look.ground : Look.text)
                .frame(maxWidth: .infinity, minHeight: 36)
                .background(
                    primary ? Color.white.opacity(hover ? 1 : 0.9) : (hover ? Look.rowHover : Look.row),
                    in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .animation(.easeOut(duration: 0.15), value: hover)
    }
}
