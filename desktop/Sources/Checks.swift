import Foundation

// What the studio needs on this Mac, checked at every launch. Each check
// says, in plain words, what it's for and how to get it. Required ones stop
// the studio from opening; the rest only turn off the features that need them.

struct Check: Identifiable {
    enum Fix { case none, setup, link(URL), installTools }

    let id: String
    let label: String
    let ok: Bool
    var value: String? = nil
    var required = false
    let help: String
    var fix: Fix = .none

    var fixedBySetup: Bool {
        if case .setup = fix { return true }
        return false
    }
}

struct CheckReport {
    let checks: [Check]
    let canRunSetup: Bool
    var missing: [Check] { checks.filter { !$0.ok } }
    var blocking: Bool { missing.contains { $0.required } }
}

enum Checks {
    static func run(folder: String, environment: StudioEnvironment) async -> CheckReport {
        let fm = FileManager.default
        let home = NSHomeDirectory()
        let path = environment.path
        let has = { (rel: String) in fm.fileExists(atPath: "\(folder)/\(rel)") }

        let node = environment.node
        let brew = which("brew", path: path) != nil
        let chrome = ["/Applications/Google Chrome.app", "\(home)/Applications/Google Chrome.app"]
            .contains { fm.fileExists(atPath: $0) }
        let swift = await runQuick("/usr/bin/xcrun", ["--find", "swiftc"], environment: environment.variables) != nil
        let claude = isExecutable("\(home)/.local/bin/claude") || which("claude", path: path) != nil
        let ffmpeg = which("ffmpeg", path: path) != nil
        let packages = has("node_modules/next/package.json")
        let engines = ["remotion", "hyperframes", "sound"].allSatisfy { has("studio/\($0)/node_modules") }

        var checks: [Check] = [
            Check(
                id: "node", label: "Node.js", ok: node?.ok ?? false,
                value: node.map { "Version \($0.version)" } ?? "Not found", required: true,
                help: node == nil
                    ? "Download the LTS version from nodejs.org, install it, then click Check again."
                    : "The studio needs Node.js 22 or newer. Download the LTS version from nodejs.org, install it, then click Check again.",
                fix: .link(URL(string: "https://nodejs.org")!)),
            Check(
                id: "packages", label: "Studio packages", ok: packages, required: true,
                help: "Click Install what's missing to add them. It takes a few minutes.", fix: .setup),
            Check(
                id: "engines", label: "Video engine packages", ok: engines,
                help: "Needed to preview and render films. Click Install what's missing to add them.", fix: .setup),
            Check(
                id: "ffmpeg", label: "ffmpeg", ok: ffmpeg,
                help: "Needed to render videos and sound. Click Install what's missing to add it.", fix: .setup),
            Check(
                id: "chrome", label: "Google Chrome", ok: chrome,
                help: "The studio draws your films' frames with Chrome. Download it, then click Check again.",
                fix: .link(URL(string: "https://www.google.com/chrome/")!)),
            Check(
                id: "claude", label: "Claude Code", ok: claude,
                help: "The studio's chat runs on Claude Code. Install it, open it once to sign in, then click Check again.",
                fix: .link(URL(string: "https://claude.com/claude-code")!)),
            Check(
                id: "swift", label: "Apple's command line tools", ok: swift,
                help: "Needed for the background remover and face finder. Click Install tools and follow Apple's window.",
                fix: .installTools),
        ]

        // Homebrew only matters while setup still has something to install.
        let setupNeeded = checks.contains { !$0.ok && $0.fixedBySetup }
        if setupNeeded {
            checks.append(Check(
                id: "brew", label: "Homebrew", ok: brew,
                help: "Used to install ffmpeg and the other video tools. Install it from brew.sh, then click Check again.",
                fix: .link(URL(string: "https://brew.sh")!)))
        }
        // scripts/setup.sh stops at once without these, so it's only offered
        // when they're here.
        let canRunSetup = setupNeeded && (node?.ok ?? false) && brew && chrome && swift
        return CheckReport(checks: checks, canRunSetup: canRunSetup)
    }
}
