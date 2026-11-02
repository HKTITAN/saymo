import Foundation

// One command the app runs (the studio's server, a build, setup), started
// through guard.mjs on the Mac's own Node. What it prints goes to a log file
// in ~/Library/Logs/Motion Studio. The app keeps the guard's stdin open; when
// the app quits or crashes it closes, and the guard stops the command and
// everything it started.
final class Job: @unchecked Sendable {
    private let process = Process()
    private let input = Pipe()
    private let output = Pipe()
    private let lock = NSLock()
    private var recent: [String] = []
    private var partial = ""
    private var exitStatus: Int32?
    private var waiters: [CheckedContinuation<Int32, Never>] = []
    private var log: FileHandle?
    private let onLine: (@Sendable (String) -> Void)?

    init(node: String, command: [String], folder: String, environment: [String: String],
         logName: String, onLine: (@Sendable (String) -> Void)? = nil) {
        self.onLine = onLine
        let guardScript = Bundle.main.path(forResource: "guard", ofType: "mjs") ?? "guard.mjs"
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [guardScript] + command
        process.currentDirectoryURL = URL(fileURLWithPath: folder)
        process.environment = environment
        process.standardInput = input
        process.standardOutput = output
        process.standardError = output

        AppPaths.ensure()
        let url = AppPaths.log(logName)
        FileManager.default.createFile(atPath: url.path, contents: nil)
        log = try? FileHandle(forWritingTo: url)
    }

    var lines: [String] { lock.withLock { recent } }
    var pid: pid_t { process.processIdentifier }
    var hasExited: Bool { lock.withLock { exitStatus != nil } }

    func start() -> Bool {
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard let self, !data.isEmpty else { return }
            self.take(data)
        }
        process.terminationHandler = { [weak self] process in
            guard let self else { return }
            self.output.fileHandleForReading.readabilityHandler = nil
            let rest = self.output.fileHandleForReading.readDataToEndOfFile()
            if !rest.isEmpty { self.take(rest) }
            let waiting: [CheckedContinuation<Int32, Never>] = self.lock.withLock {
                self.exitStatus = process.terminationStatus
                try? self.log?.close()
                self.log = nil
                defer { self.waiters = [] }
                return self.waiters
            }
            waiting.forEach { $0.resume(returning: process.terminationStatus) }
        }
        do {
            try process.run()
            return true
        } catch {
            take(Data("Couldn't start: \(error.localizedDescription)\n".utf8))
            lock.withLock { exitStatus = 127 }
            return false
        }
    }

    private static let ansi = try! NSRegularExpression(pattern: "\u{1B}\\[[0-9;]*[A-Za-z]")

    private func take(_ data: Data) {
        var fresh: [String] = []
        lock.withLock {
            log?.write(data)
            let text = partial + String(decoding: data, as: UTF8.self)
            let clean = Job.ansi.stringByReplacingMatches(
                in: text, range: NSRange(text.startIndex..., in: text), withTemplate: "")
            var parts = clean.components(separatedBy: CharacterSet(charactersIn: "\r\n"))
            partial = parts.removeLast()
            for line in parts where !line.trimmingCharacters(in: .whitespaces).isEmpty {
                recent.append(line)
                fresh.append(line)
            }
            if recent.count > 200 { recent.removeFirst(recent.count - 200) }
        }
        fresh.forEach { onLine?($0) }
    }

    // Waits for the command to end and returns its exit status.
    func wait() async -> Int32 {
        await withCheckedContinuation { continuation in
            let done: Int32? = lock.withLock {
                if let exitStatus { return exitStatus }
                waiters.append(continuation)
                return nil
            }
            if let done { continuation.resume(returning: done) }
        }
    }

    // Asks the guard to stop everything, and makes sure of it after 8 seconds.
    func stop() async {
        if hasExited { return }
        try? input.fileHandleForWriting.close()
        let finished: Bool = await withCheckedContinuation { continuation in
            let once = Once()
            Task {
                _ = await self.wait()
                if once.claim() { continuation.resume(returning: true) }
            }
            Task {
                try? await Task.sleep(for: .seconds(8))
                if once.claim() { continuation.resume(returning: false) }
            }
        }
        if !finished {
            for child in descendants(of: pid) { kill(child, SIGKILL) }
            kill(pid, SIGKILL)
            _ = await wait()
        }
    }
}

// True for the first caller only, from any thread.
final class Once: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false

    func claim() -> Bool {
        lock.withLock {
            if done { return false }
            done = true
            return true
        }
    }
}
