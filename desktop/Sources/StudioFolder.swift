import Foundation

// The studio folder: the Saymo repo on this Mac. The app runs the
// studio from it, so films, brand kits, sign-ins and .env.local stay exactly
// where they are today. The app never copies anything out of it.
enum StudioFolder {
    static func isStudio(_ path: String?) -> Bool {
        guard let path, !path.isEmpty else { return false }
        let pkg = URL(fileURLWithPath: path).appendingPathComponent("package.json")
        guard let data = try? Data(contentsOf: pkg),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              ["saymo", "motion-studio"].contains(json["name"] as? String ?? "") else { return false }
        return FileManager.default.fileExists(atPath: "\(path)/src/lib/studio/films/films.ts")
    }

    // The folder the app was built from (scripts/build.sh writes it into the
    // app). Only right on the Mac that built it; elsewhere the usual places
    // are tried.
    private static func builtFrom() -> String? {
        guard let url = Bundle.main.url(forResource: "built-from", withExtension: "txt"),
              let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func usualPlaces() -> [String] {
        let home = NSHomeDirectory()
        return [
            "Desktop/projects/saymo", "Desktop/saymo", "Documents/saymo", "Documents/GitHub/saymo",
            "Developer/saymo", "Projects/saymo", "projects/saymo", "saymo",
            "Desktop/projects/motion-studio", "Desktop/motion-studio", "Documents/motion-studio",
            "Documents/GitHub/motion-studio", "Developer/motion-studio", "Projects/motion-studio",
            "projects/motion-studio", "motion-studio",
        ].map { "\(home)/\($0)" }
    }

    static func find(saved: String?) -> String? {
        let candidates = [ProcessInfo.processInfo.environment["SAYMO_FOLDER"] ?? ProcessInfo.processInfo.environment["MOTION_STUDIO_FOLDER"], saved, builtFrom()]
            + usualPlaces().map(Optional.some)
        return candidates.compactMap { $0 }.first(where: isStudio)
    }
}
