import CryptoKit
import Foundation

// The app runs a production build of the studio: quicker and steadier than
// `npm run dev`. It builds from the studio folder itself into
// .next/desktop/a or .next/desktop/b (STUDIO_DESKTOP_DIST in next.config.ts),
// so it never touches the dev server's files, and only when the folder's
// code changed since the last build. A new build goes into the slot not in
// use; if it fails, the last good one is still there to open.
enum Builder {
    // Bump to make every Mac rebuild once, after a change to how the app builds.
    private static let recipe = 1
    private static let slots = ["a", "b"]

    static func distDir(_ slot: String) -> String { ".next/desktop/\(slot)" }

    // What a build depends on. Only names, sizes and times are read, never
    // the files' contents (.env.local holds keys).
    private static let watchedFiles = [
        "next.config.ts", "package.json", "package-lock.json", "tsconfig.json", "postcss.config.mjs",
        "desktop/studio.tsconfig.json", ".env", ".env.local", ".env.production", ".env.production.local",
    ]

    static func fingerprint(_ folder: String) -> String {
        var hasher = SHA256()
        hasher.update(data: Data("recipe \(recipe)\n".utf8))
        let fm = FileManager.default
        func add(_ rel: String) {
            let attrs = try? fm.attributesOfItem(atPath: "\(folder)/\(rel)")
            if let attrs, let size = attrs[.size] as? Int, let date = attrs[.modificationDate] as? Date {
                hasher.update(data: Data("\(rel) \(size) \(Int(date.timeIntervalSince1970 * 1000))\n".utf8))
            } else {
                hasher.update(data: Data("\(rel) none\n".utf8))
            }
        }
        watchedFiles.forEach(add)
        let src = URL(fileURLWithPath: "\(folder)/src")
        let keys: [URLResourceKey] = [.isRegularFileKey]
        var files: [String] = []
        if let walker = fm.enumerator(at: src, includingPropertiesForKeys: keys) {
            for case let url as URL in walker where url.lastPathComponent != ".DS_Store" {
                if (try? url.resourceValues(forKeys: Set(keys)).isRegularFile) == true {
                    files.append("src" + url.path.dropFirst(src.path.count))
                }
            }
        }
        files.sorted().forEach(add)
        return hasher.finalize().prefix(8).map { String(format: "%02x", $0) }.joined()
    }

    static func hasBuild(_ folder: String, _ slot: String) -> Bool {
        FileManager.default.fileExists(atPath: "\(folder)/\(distDir(slot))/BUILD_ID")
    }

    static func records() -> [String: BuildRecord] {
        Store.read("builds.json", as: [String: BuildRecord].self) ?? [:]
    }

    static func lastGood(_ folder: String) -> BuildRecord? {
        guard let record = records()[folder], hasBuild(folder, record.slot) else { return nil }
        return record
    }

    static func isCurrent(_ folder: String) -> Bool {
        lastGood(folder)?.fingerprint == fingerprint(folder)
    }

    static func save(_ record: BuildRecord, for folder: String) {
        var all = records()
        all[folder] = record
        Store.write("builds.json", all)
    }

    // Builds into the free slot. Next rewrites next-env.d.ts for the build it
    // just made; the dev server's copy is put back afterwards so nothing in
    // the folder looks changed.
    static func build(folder: String, environment: StudioEnvironment, started: (Job) -> Void,
                      onLine: @escaping @Sendable (String) -> Void) async -> (record: BuildRecord?, lines: [String]) {
        guard let node = environment.node else { return (nil, ["Node.js isn't installed."]) }
        let slot = slots.first { $0 != lastGood(folder)?.slot } ?? "a"
        let print = fingerprint(folder)
        let envFile = "\(folder)/next-env.d.ts"
        let before = try? Data(contentsOf: URL(fileURLWithPath: envFile))

        var variables = environment.variables
        variables["STUDIO_DESKTOP_DIST"] = distDir(slot)
        let job = Job(
            node: node.path, command: [node.path, "\(folder)/node_modules/next/dist/bin/next", "build"],
            folder: folder, environment: variables, logName: "build.log", onLine: onLine)
        started(job)
        let status = job.start() ? await job.wait() : 127

        if let before, (try? Data(contentsOf: URL(fileURLWithPath: envFile))) != before {
            try? before.write(to: URL(fileURLWithPath: envFile))
        }
        guard status == 0, hasBuild(folder, slot) else { return (nil, job.lines) }
        let record = BuildRecord(slot: slot, fingerprint: print, at: ISO8601DateFormatter().string(from: Date()))
        return (record, job.lines)
    }
}
