import Foundation

// The Mac gives an app opened from the Dock almost no PATH: no Homebrew, no
// Node from fnm or nvm, no Claude Code. So the app asks the person's own login
// shell for its environment once at launch, the same one a new Terminal
// window gets, and runs the studio with it. Nothing here is ever logged.

struct NodeInfo {
    let path: String
    let version: String
    var ok: Bool { (Int(version.split(separator: ".").first ?? "") ?? 0) >= 22 }
}

struct StudioEnvironment {
    var variables: [String: String]
    var node: NodeInfo?
    var fromShell: Bool
    var path: String { variables["PATH"] ?? "" }
}

enum ShellEnvironment {
    private static let mark = "__SAYMO_ENV__"
    private static let basics = ["HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL"]

    private static func basicVariables() -> [String: String] {
        let current = ProcessInfo.processInfo.environment
        var env: [String: String] = [:]
        for key in basics { if let value = current[key] { env[key] = value } }
        return env
    }

    private static func readLoginShell() async -> [String: String]? {
        let shell = ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
        var start = basicVariables()
        start["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin"
        // oh-my-zsh and tmux plugins sometimes wait for an answer otherwise.
        start["DISABLE_AUTO_UPDATE"] = "true"
        start["ZSH_TMUX_AUTOSTART"] = "false"
        guard let text = await runQuick(
            shell, ["-ilc", "printf '\(mark)'; /usr/bin/env -0; printf '\(mark)'"],
            environment: start, timeout: 15
        ) else { return nil }
        let parts = text.components(separatedBy: mark)
        guard parts.count >= 3 else { return nil }
        var env: [String: String] = [:]
        for entry in parts[1].split(separator: "\0") {
            guard let eq = entry.firstIndex(of: "="), eq != entry.startIndex else { continue }
            env[String(entry[..<eq])] = String(entry[entry.index(after: eq)...])
        }
        return env
    }

    private static func versionDirs(_ dir: String, _ inner: String) -> [String] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: dir)) ?? []
        return names
            .sorted { $0.compare($1, options: .numeric) == .orderedDescending }
            .map { "\(dir)/\($0)/\(inner)" }
    }

    // Node installs that may not be on the PATH at all (fnm, nvm, Volta).
    private static func nodeInstallDirs() -> [String] {
        let home = NSHomeDirectory()
        return versionDirs("\(home)/.local/share/fnm/node-versions", "installation/bin")
            + versionDirs("\(home)/Library/Application Support/fnm/node-versions", "installation/bin")
            + versionDirs("\(home)/.nvm/versions/node", "bin")
            + ["\(home)/.volta/bin"]
    }

    // The first Node of version 22 or newer, looked for on the shell's PATH
    // first. Its real folder goes first on the PATH so npm and npx match it.
    private static func findNode(path: String) async -> NodeInfo? {
        var candidates: [String] = []
        if let onPath = which("node", path: path) { candidates.append(onPath) }
        candidates += nodeInstallDirs().map { "\($0)/node" }.filter(isExecutable)
        var older: NodeInfo?
        for file in candidates {
            let real = URL(fileURLWithPath: file).resolvingSymlinksInPath().path
            guard let version = await runQuick(real, ["-p", "process.versions.node"])?
                .trimmingCharacters(in: .whitespacesAndNewlines), !version.isEmpty else { continue }
            let info = NodeInfo(path: real, version: version)
            if info.ok { return info }
            if older == nil { older = info }
        }
        return older
    }

    static func load() async -> StudioEnvironment {
        let login = await readLoginShell()
        var env = login ?? basicVariables().merging(
            ["PATH": ProcessInfo.processInfo.environment["PATH"] ?? ""], uniquingKeysWith: { a, _ in a })
        // Variables that belong to the shell that printed them, not the studio.
        for key in ["_", "SHLVL", "PWD", "OLDPWD", "NODE_ENV", "NODE_OPTIONS"] { env[key] = nil }

        let home = NSHomeDirectory()
        let extra = ["\(home)/.local/bin", "/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin",
                     "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
        var seen = Set<String>()
        let dirs = ((env["PATH"] ?? "").split(separator: ":").map(String.init) + extra)
            .filter { !$0.isEmpty && seen.insert($0).inserted }
        env["PATH"] = dirs.joined(separator: ":")

        let node = await findNode(path: env["PATH"] ?? "")
        if let node, node.ok {
            let dir = (node.path as NSString).deletingLastPathComponent
            env["PATH"] = "\(dir):\(env["PATH"] ?? "")"
        }
        env["NEXT_TELEMETRY_DISABLED"] = "1"
        return StudioEnvironment(variables: env, node: node, fromShell: login != nil)
    }
}
