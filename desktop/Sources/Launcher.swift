import AppKit
import Foundation

// What happens between opening the app and seeing the studio: find the
// studio folder, check the Mac, build the studio if its code changed, start
// its server, then hand the window the studio's address.
@MainActor
final class Launcher: ObservableObject {
    enum Screen {
        // One plain line saying what's happening, which changes in place.
        case working(String)
        case folder(error: String?)
        case checks(CheckReport, folder: String)
        // What went wrong, with the log kept out of sight under Show details.
        case problem(title: String, detail: String, log: String)
    }

    @Published private(set) var screen: Screen = .working(Stage.preparing)

    var onStudioReady: ((URL) -> Void)?
    var onShowLaunch: (() -> Void)?

    private(set) var settings: Settings = Store.read("settings.json", as: Settings.self) ?? Settings()
    private(set) var folder: String?
    private(set) var server: Server.Running?
    private var environment: StudioEnvironment?
    private var busy: Job?
    private var runs = 0
    private var quitting = false

    private func saveSettings(_ change: (inout Settings) -> Void) {
        change(&settings)
        Store.write("settings.json", settings)
    }

    private func show(_ next: Screen) {
        screen = next
    }

    // A build or setup prints a lot; people only see which stage it's at.
    private func stageSink(_ stage: @escaping @Sendable (String) -> String?) -> @Sendable (String) -> Void {
        { [weak self] line in
            guard let next = stage(line) else { return }
            Task { @MainActor in
                guard let self, case let .working(current) = self.screen, current != next else { return }
                self.screen = .working(next)
                LaunchLog.note("now showing: \(next)")
            }
        }
    }

    private static func log(_ lines: [String]) -> String {
        lines.suffix(80).joined(separator: "\n")
    }

    // ─── Launch ───────────────────────────────────────────────────────────

    func launch(rebuild: Bool = false, skipChecks: Bool = false) async {
        runs += 1
        let run = runs
        let stale = { [unowned self] in run != self.runs || self.quitting }
        LaunchLog.begin()
        LaunchLog.note("launch")
        await stopServer()
        onShowLaunch?()

        show(.working(Stage.preparing))
        if environment == nil {
            environment = await ShellEnvironment.load()
            LaunchLog.note(environment!.fromShell ? "read the login shell" : "couldn't read the login shell, using defaults")
        }
        guard !stale(), let environment else { return }

        // The first read of a folder on the Desktop or in Documents waits for
        // macOS to ask "Saymo would like to access files…". Look off
        // the main thread, and say what's happening if it takes a moment.
        let saved = settings.folder
        let search = Task.detached { StudioFolder.find(saved: saved) }
        let hint = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled, let self, case .working = self.screen else { return }
            self.show(.working(Stage.permission))
        }
        let found = await search.value
        hint.cancel()
        guard !stale() else { return }
        show(.working(Stage.preparing))
        guard let folder = found else {
            return show(.folder(error: nil))
        }
        self.folder = folder
        if settings.folder != folder { saveSettings { $0.folder = folder } }

        let report = await Checks.run(folder: folder, environment: environment)
        LaunchLog.note("checked this Mac")
        guard !stale() else { return }
        let dismissed = Set(settings.dismissed ?? [])
        let unseen = report.missing.contains { !dismissed.contains($0.id) }
        if report.blocking || (!skipChecks && unseen) {
            return show(.checks(report, folder: folder))
        }

        var good = Builder.lastGood(folder)
        if rebuild || !Builder.isCurrent(folder) {
            let first = good == nil
            show(.working(first ? Stage.firstBuild : Stage.update))
            let result = await Builder.build(
                folder: folder, environment: environment, started: { [weak self] in self?.busy = $0 },
                onLine: stageSink { Stage.forBuild($0) })
            busy = nil
            LaunchLog.note(result.record == nil ? "build failed" : "built the studio")
            guard !stale() else { return }
            if let record = result.record {
                Builder.save(record, for: folder)
                good = record
            } else if good == nil {
                return show(.problem(
                    title: "The studio couldn't be built",
                    detail: "Its code has an error. Fix it in the studio folder, or get the latest version, then try again.",
                    log: Launcher.log(result.lines)))
            }
            // A failed build with an older one to fall back on: open the older one.
        }
        guard let good else { return }

        show(.working(Stage.starting))
        let port = Server.pickPort(preferred: settings.port)
        let started = await Server.start(folder: folder, slot: good.slot, environment: environment, port: port)
        guard let running = started.running else {
            return show(.problem(
                title: "The studio didn't start",
                detail: "Try again. If it keeps happening, copy the details and send them to whoever looks after the studio.",
                log: Launcher.log(started.lines)))
        }
        if stale() {
            await running.job.stop()
            return
        }
        server = running
        LaunchLog.note("studio answering on port \(port)")
        watch(running)
        onStudioReady?(running.url.appendingPathComponent("studio"))
    }

    // If the server stops on its own, say so and offer to start it again.
    private func watch(_ running: Server.Running) {
        Task { [weak self] in
            _ = await running.job.wait()
            guard let self, self.server?.job === running.job, !self.quitting else { return }
            self.server = nil
            self.onShowLaunch?()
            self.show(.problem(
                title: "The studio stopped",
                detail: "Its server closed unexpectedly. Try again to carry on; your films are saved as you work.",
                log: Launcher.log(running.job.lines)))
        }
    }

    func stopServer() async {
        let current = server
        server = nil
        await current?.job.stop()
    }

    // Stops the server, and any build or setup in progress, before quitting.
    func stopEverything() async {
        quitting = true
        let job = busy
        busy = nil
        await stopServer()
        await job?.stop()
    }

    var hasWork: Bool { server != nil || busy != nil }

    // ─── Actions from the launch screen and the menu ──────────────────────

    func retry() { Task { await launch() } }
    func rebuild() { Task { await launch(rebuild: true, skipChecks: true) } }
    func restart() { Task { await launch(skipChecks: true) } }

    func openAnyway() {
        if case let .checks(report, _) = screen {
            saveSettings { $0.dismissed = report.missing.map(\.id) }
        }
        Task { await launch(skipChecks: true) }
    }

    func chooseFolder() {
        let panel = NSOpenPanel()
        panel.title = "Choose the Saymo folder"
        panel.prompt = "Use this folder"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        guard StudioFolder.isStudio(url.path) else {
            return show(.folder(error: "That folder isn't the Saymo folder. Choose the folder that holds package.json, src and films."))
        }
        saveSettings { $0.folder = url.path }
        Task { await launch() }
    }

    func runSetup() {
        guard let environment, let node = environment.node, let folder else { return }
        show(.working(Stage.setup))
        let job = Job(
            node: node.path, command: ["/bin/bash", "\(folder)/scripts/setup.sh"], folder: folder,
            environment: environment.variables, logName: "setup.log", onLine: stageSink { Stage.forSetup($0) })
        busy = job
        Task {
            let status = job.start() ? await job.wait() : 127
            busy = nil
            guard !quitting else { return }
            if status == 0 { return await launch() }
            show(.problem(
                title: "Setup stopped before the end",
                detail: "The last lines of its details say what it needs. Do that, then try again.",
                log: Launcher.log(job.lines)))
        }
    }

    func installTools() {
        Task { _ = await runQuick("/usr/bin/xcode-select", ["--install"]) }
    }

    func showLogs() {
        AppPaths.ensure()
        NSWorkspace.shared.open(AppPaths.logs)
    }

    func showFolder() {
        guard let folder else { return }
        NSWorkspace.shared.open(URL(fileURLWithPath: folder))
    }

    func openSetupGuide() {
        guard let folder else { return }
        NSWorkspace.shared.open(URL(fileURLWithPath: "\(folder)/docs/setup.md"))
    }
}

// The lines the launch screen shows, and which stage of a build or setup
// each of their printed lines means.
enum Stage {
    static let preparing = "Getting the studio ready"
    static let permission = "Waiting for you to let Saymo open the studio folder"
    static let firstBuild = "Building the studio. The first time takes a minute or two."
    static let update = "Updating the studio to its latest version"
    static let pages = "Putting the pages together"
    static let almost = "Almost there"
    static let starting = "Starting the studio"
    static let setup = "Installing what's missing. This can take several minutes."

    static func forBuild(_ line: String) -> String? {
        if line.contains("Compiled successfully") || line.contains("Collecting page data") { return pages }
        if line.contains("Generating static pages") || line.contains("Finalizing") || line.contains("Route (app)") {
            return almost
        }
        return nil
    }

    // scripts/setup.sh announces each step as "1. Checking this Mac" and so on.
    static func forSetup(_ line: String) -> String? {
        if line.hasPrefix("2. ") { return "Installing the video and audio tools" }
        if line.hasPrefix("3. ") { return "Installing the studio's packages" }
        if line.hasPrefix("4. ") { return "Installing the video engines" }
        if line.hasPrefix("5. ") { return "Installing the Rust engine" }
        if line.hasPrefix("Ready") { return almost }
        return nil
    }
}
