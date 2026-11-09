import Foundation

// The app's own files. Never films or keys: those stay in the studio folder.
//
//   ~/Library/Application Support/Saymo/
//       settings.json   which studio folder, which port, what you've dismissed
//       builds.json     which build of the studio is ready to open
//   ~/Library/Logs/Saymo/
//       launch.log, build.log, server.log, setup.log
// The app was called Motion Studio; its old folders move to the new names
// the first time Saymo opens.
enum AppPaths {
    static let support: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return moved(from: base.appendingPathComponent("Motion Studio", isDirectory: true), to: base.appendingPathComponent("Saymo", isDirectory: true))
    }()

    static let logs: URL = {
        let base = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
        return moved(from: base.appendingPathComponent("Logs/Motion Studio", isDirectory: true), to: base.appendingPathComponent("Logs/Saymo", isDirectory: true))
    }()

    private static func moved(from old: URL, to new: URL) -> URL {
        let fm = FileManager.default
        if !fm.fileExists(atPath: new.path), fm.fileExists(atPath: old.path) { try? fm.moveItem(at: old, to: new) }
        return new
    }

    static func log(_ name: String) -> URL { logs.appendingPathComponent(name) }

    static func ensure() {
        try? FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
    }
}

struct Settings: Codable {
    var folder: String?
    var port: Int?
    var dismissed: [String]?
}

struct BuildRecord: Codable {
    var slot: String
    var fingerprint: String
    var at: String
}

enum Store {
    static func read<T: Decodable>(_ name: String, as type: T.Type) -> T? {
        guard let data = try? Data(contentsOf: AppPaths.support.appendingPathComponent(name)) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    static func write<T: Encodable>(_ name: String, _ value: T) {
        AppPaths.ensure()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(value) else { return }
        try? data.write(to: AppPaths.support.appendingPathComponent(name), options: .atomic)
    }
}

// launch.log: when each launch step happened, to see where time goes.
enum LaunchLog {
    private static var started = Date()

    static func begin() { started = Date() }

    static func note(_ step: String) {
        AppPaths.ensure()
        let secs = String(format: "%.1f", Date().timeIntervalSince(started))
        let line = "\(ISO8601DateFormatter().string(from: Date())) +\(secs)s \(step)\n"
        let url = AppPaths.log("launch.log")
        if let handle = try? FileHandle(forWritingTo: url) {
            handle.seekToEndOfFile()
            handle.write(Data(line.utf8))
            try? handle.close()
        } else {
            try? Data(line.utf8).write(to: url)
        }
    }
}

// Runs a short command and hands back what it printed, or nil if it failed
// or took longer than `timeout` seconds.
func runQuick(_ executable: String, _ arguments: [String], environment: [String: String]? = nil,
              timeout: TimeInterval = 10) async -> String? {
    await withCheckedContinuation { continuation in
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        if let environment { process.environment = environment }
        let out = Pipe()
        process.standardOutput = out
        process.standardError = FileHandle.nullDevice
        process.standardInput = FileHandle.nullDevice
        do {
            try process.run()
        } catch {
            continuation.resume(returning: nil)
            return
        }
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout) {
            if process.isRunning { process.terminate() }
        }
        DispatchQueue.global().async {
            let data = out.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            let text = String(decoding: data, as: UTF8.self)
            continuation.resume(returning: process.terminationStatus == 0 ? text : nil)
        }
    }
}

func isExecutable(_ path: String) -> Bool {
    var isDir: ObjCBool = false
    return FileManager.default.fileExists(atPath: path, isDirectory: &isDir) && !isDir.boolValue
        && FileManager.default.isExecutableFile(atPath: path)
}

func which(_ name: String, path: String?, extra: [String] = []) -> String? {
    let dirs = (path ?? "").split(separator: ":").map(String.init) + extra
    for dir in dirs where !dir.isEmpty {
        let file = (dir as NSString).appendingPathComponent(name)
        if isExecutable(file) { return file }
    }
    return nil
}

// Every process below `pid`, deepest first, from `ps`.
func descendants(of pid: pid_t) -> [pid_t] {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/ps")
    process.arguments = ["-A", "-o", "pid=,ppid="]
    let out = Pipe()
    process.standardOutput = out
    process.standardError = FileHandle.nullDevice
    guard (try? process.run()) != nil else { return [] }
    let data = out.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    var kids: [pid_t: [pid_t]] = [:]
    for line in String(decoding: data, as: UTF8.self).split(separator: "\n") {
        let parts = line.split(separator: " ", omittingEmptySubsequences: true)
        guard parts.count == 2, let child = pid_t(parts[0]), let parent = pid_t(parts[1]) else { continue }
        kids[parent, default: []].append(child)
    }
    var result: [pid_t] = []
    func walk(_ p: pid_t) {
        for kid in kids[p] ?? [] {
            walk(kid)
            result.append(kid)
        }
    }
    walk(pid)
    return result
}
