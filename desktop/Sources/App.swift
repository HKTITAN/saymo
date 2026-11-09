import AppKit

// Saymo for the Mac. A small native shell around the studio: at
// launch it finds the studio folder, checks the Mac has what the studio
// needs, builds the studio if its code changed, starts the studio's server
// on this Mac only and shows /studio in the window. Quitting stops the server
// and everything it started. See README.md.

@main
enum Main {
    @MainActor static let delegate = AppDelegate()

    static func main() {
        MainActor.assumeIsolated {
            let app = NSApplication.shared
            app.delegate = delegate
            app.setActivationPolicy(.regular)
            app.run()
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let launcher = Launcher()
    private var main: StudioWindow!
    private var stopping = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        // A copy is already open (started some other way than the Finder,
        // which would have switched to it): bring that one forward instead.
        let me = NSRunningApplication.current
        if let other = NSRunningApplication.runningApplications(withBundleIdentifier: Bundle.main.bundleIdentifier ?? "")
            .first(where: { $0.processIdentifier != me.processIdentifier }) {
            other.activate()
            NSApp.terminate(nil)
            return
        }

        AppPaths.ensure()
        main = StudioWindow(launcher: launcher)
        launcher.onShowLaunch = { [weak self] in self?.main.showLaunch() }
        launcher.onStudioReady = { [weak self] url in self?.main.showStudio(url) }
        Updates.shared.start()
        NSApp.mainMenu = buildMenu()
        main.window.makeKeyAndOrderFront(nil)
        NSApp.activate()
        Task { await launcher.launch() }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { main?.window.makeKeyAndOrderFront(nil) }
        return true
    }

    // Closing the window closes the app, and with it the studio's server.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard launcher.hasWork, !stopping else { return .terminateNow }
        stopping = true
        Task {
            await launcher.stopEverything()
            NSApp.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    // ─── Menu ─────────────────────────────────────────────────────────────

    private func item(_ title: String, _ action: Selector?, _ key: String = "",
                      _ modifiers: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.keyEquivalentModifierMask = modifiers
        item.target = target
        return item
    }

    private func menu(_ title: String, _ items: [NSMenuItem]) -> NSMenuItem {
        let top = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        let sub = NSMenu(title: title)
        items.forEach(sub.addItem)
        top.submenu = sub
        return top
    }

    private func buildMenu() -> NSMenu {
        let bar = NSMenu()
        let services = NSMenu(title: "Services")
        NSApp.servicesMenu = services
        let servicesItem = NSMenuItem(title: "Services", action: nil, keyEquivalent: "")
        servicesItem.submenu = services

        var appItems: [NSMenuItem] = [
            item("About Saymo", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
        ]
        if Updates.shared.available {
            appItems.append(item("Check for Updates…", #selector(checkForUpdates), target: self))
        }
        appItems += [
            .separator(), servicesItem, .separator(),
            item("Hide Saymo", #selector(NSApplication.hide(_:)), "h"),
            item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            item("Show All", #selector(NSApplication.unhideAllApplications(_:))),
            .separator(),
            item("Quit Saymo", #selector(NSApplication.terminate(_:)), "q"),
        ]
        bar.addItem(menu("Saymo", appItems))

        bar.addItem(menu("File", [
            item("Show Studio Folder", #selector(showFolder), target: self),
            item("Choose Studio Folder…", #selector(chooseFolder), target: self),
            .separator(),
            item("Restart the Studio", #selector(restart), target: self),
            item("Rebuild the Studio", #selector(rebuild), target: self),
            .separator(),
            item("Close Window", #selector(NSWindow.performClose(_:)), "w"),
        ]))

        bar.addItem(menu("Edit", [
            item("Undo", Selector(("undo:")), "z"),
            item("Redo", Selector(("redo:")), "z", [.command, .shift]),
            .separator(),
            item("Cut", #selector(NSText.cut(_:)), "x"),
            item("Copy", #selector(NSText.copy(_:)), "c"),
            item("Paste", #selector(NSText.paste(_:)), "v"),
            item("Paste and Match Style", #selector(NSTextView.pasteAsPlainText(_:)), "v", [.command, .option, .shift]),
            item("Delete", #selector(NSText.delete(_:))),
            item("Select All", #selector(NSText.selectAll(_:)), "a"),
        ]))

        bar.addItem(menu("View", [
            item("Reload", #selector(reload), "r", target: self),
            item("Back", #selector(goBack), "[", target: self),
            item("Forward", #selector(goForward), "]", target: self),
            .separator(),
            item("Actual Size", #selector(actualSize), "0", target: self),
            item("Zoom In", #selector(zoomIn), "=", target: self),
            item("Zoom Out", #selector(zoomOut), "-", target: self),
            .separator(),
            item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
        ]))

        let window = menu("Window", [
            item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
            item("Zoom", #selector(NSWindow.performZoom(_:))),
            .separator(),
            item("Bring All to Front", #selector(NSApplication.arrangeInFront(_:))),
        ])
        NSApp.windowsMenu = window.submenu
        bar.addItem(window)

        let help = menu("Help", [
            item("Show Logs", #selector(showLogs), target: self),
            item("Setup Guide", #selector(setupGuide), target: self),
        ])
        NSApp.helpMenu = help.submenu
        bar.addItem(help)
        return bar
    }

    @objc private func checkForUpdates() { Updates.shared.checkNow() }
    @objc private func showFolder() { launcher.showFolder() }
    @objc private func chooseFolder() { launcher.chooseFolder() }
    @objc private func restart() { launcher.restart() }
    @objc private func rebuild() { launcher.rebuild() }
    @objc private func showLogs() { launcher.showLogs() }
    @objc private func setupGuide() { launcher.openSetupGuide() }
    @objc private func reload() { main.currentWebView?.reload() }
    @objc private func goBack() { main.currentWebView?.goBack() }
    @objc private func goForward() { main.currentWebView?.goForward() }
    @objc private func actualSize() { main.currentWebView?.pageZoom = 1 }
    @objc private func zoomIn() { main.currentWebView.map { $0.pageZoom = min($0.pageZoom + 0.1, 3) } }
    @objc private func zoomOut() { main.currentWebView.map { $0.pageZoom = max($0.pageZoom - 0.1, 0.5) } }
}
