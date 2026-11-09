import AppKit
import SwiftUI
import WebKit

// The app's window: the launch screen while the studio starts, then the
// studio itself in a web view. Pages the studio opens in a new tab get a
// window of their own.
@MainActor
final class StudioWindow: NSObject, NSWindowDelegate {
    let window: NSWindow
    private let launcher: Launcher
    private let web: StudioWeb
    private var webView: WKWebView?
    private var titleWatch: NSKeyValueObservation?

    init(launcher: Launcher) {
        self.launcher = launcher
        web = StudioWeb(launcher: launcher)
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        super.init()
        window.title = "Saymo"
        window.minSize = NSSize(width: 900, height: 600)
        window.backgroundColor = Look.groundNS
        window.appearance = NSAppearance(named: .darkAqua)
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.tabbingMode = .disallowed
        if !window.setFrameUsingName("SaymoMain") { window.center() }
        window.setFrameAutosaveName("SaymoMain")
        showLaunch()
    }

    func showLaunch() {
        guard !(window.contentView is NSHostingView<LaunchView>) else { return }
        titleWatch = nil
        webView?.stopLoading()
        webView = nil
        let hosting = NSHostingView(rootView: LaunchView(launcher: launcher))
        // The window keeps its size; the launch screen fits itself inside.
        hosting.sizingOptions = []
        window.contentView = hosting
        window.title = "Saymo"
    }

    func showStudio(_ url: URL) {
        let view = web.makeWebView(configuration: StudioWeb.configuration())
        webView = view
        titleWatch = view.observe(\.title, options: [.new]) { [weak self] view, _ in
            Task { @MainActor in
                let title = view.title ?? ""
                self?.window.title = title.isEmpty ? "Saymo" : title
            }
        }
        window.contentView = view
        view.load(URLRequest(url: url))
        window.makeFirstResponder(view)
    }

    var currentWebView: WKWebView? {
        (NSApp.keyWindow?.contentView as? WKWebView) ?? webView
    }
}

// Everything the web view needs to behave like the studio in Chrome: links
// that leave the studio open in the person's browser, downloads land in
// Downloads, the mic works for dictation, file pickers and new windows work.
@MainActor
final class StudioWeb: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private let launcher: Launcher
    private var popups: [NSWindow] = []

    init(launcher: Launcher) { self.launcher = launcher }

    static func configuration() -> WKWebViewConfiguration {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        config.preferences.isElementFullscreenEnabled = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.applicationNameForUserAgent = "Saymo"
        // Feels like a native app, not a web page: the page never bounces
        // past its top or bottom. In every frame, so a film's stage too.
        // Panels inside the page still scroll as before.
        let noBounce = """
        (() => {
          const style = document.createElement("style");
          style.textContent = "html, body { overscroll-behavior: none; }";
          (document.head || document.documentElement).appendChild(style);
        })();
        """
        config.userContentController.addUserScript(
            WKUserScript(source: noBounce, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        return config
    }

    func makeWebView(configuration: WKWebViewConfiguration) -> WKWebView {
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self
        view.uiDelegate = self
        // No swiping back and forward between pages, and no pinch zoom: the
        // View menu zooms instead.
        view.allowsBackForwardNavigationGestures = false
        view.allowsMagnification = false
        view.underPageBackgroundColor = Look.groundNS
        // Lets Safari's Web Inspector look inside (Develop menu), for fixing things.
        view.isInspectable = true
        return view
    }

    private func isStudio(_ url: URL?) -> Bool {
        guard let url, let server = launcher.server else { return false }
        return url.scheme == "http" && url.host == "127.0.0.1" && url.port == server.port
    }

    private func openOutside(_ url: URL?) {
        guard let url, ["http", "https", "mailto"].contains(url.scheme ?? "") else { return }
        NSWorkspace.shared.open(url)
    }

    // ─── Navigation ───────────────────────────────────────────────────────

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        if action.shouldPerformDownload { return decisionHandler(.download) }
        let url = action.request.url
        let scheme = url?.scheme ?? ""
        if ["about", "blob", "data"].contains(scheme) || isStudio(url) { return decisionHandler(.allow) }
        // A film's preview may show outside pages inside it; only the page
        // itself leaving the studio goes to the browser.
        if action.targetFrame?.isMainFrame == false { return decisionHandler(.allow) }
        openOutside(url)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void) {
        let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
        if !response.canShowMIMEType || disposition.lowercased().hasPrefix("attachment") {
            return decisionHandler(.download)
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    // ─── Downloads: into Downloads, as Safari and Chrome do ────────────────

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping @MainActor (URL?) -> Void) {
        let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
        let name = suggestedFilename.isEmpty ? "download" : suggestedFilename
        let base = (name as NSString).deletingPathExtension
        let ext = (name as NSString).pathExtension
        var target = folder.appendingPathComponent(name)
        var n = 2
        while FileManager.default.fileExists(atPath: target.path) {
            target = folder.appendingPathComponent(ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)")
            n += 1
        }
        completionHandler(target)
    }

    func downloadDidFinish(_ download: WKDownload) {
        // Bounces the Downloads stack in the Dock.
        if let path = download.progress.fileURL?.path {
            DistributedNotificationCenter.default().post(
                name: Notification.Name("com.apple.DownloadFileFinished"), object: path)
        }
    }

    // ─── New windows, file pickers, the mic, alerts ────────────────────────

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        let url = action.request.url
        if let url, !url.absoluteString.isEmpty, url.scheme != "about", !isStudio(url) {
            openOutside(url)
            return nil
        }
        let view = makeWebView(configuration: configuration)
        let popup = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 800),
            styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        popup.contentView = view
        popup.backgroundColor = Look.groundNS
        popup.appearance = NSAppearance(named: .darkAqua)
        popup.isReleasedWhenClosed = false
        popup.title = "Saymo"
        popup.cascadeTopLeft(from: NSApp.keyWindow?.frame.origin ?? .zero)
        popup.makeKeyAndOrderFront(nil)
        popups.append(popup)
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: popup, queue: .main) {
            [weak self] note in
            Task { @MainActor in self?.popups.removeAll { $0 === note.object as? NSWindow } }
        }
        return view
    }

    func webViewDidClose(_ webView: WKWebView) {
        webView.window?.close()
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        if let window = webView.window {
            panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.urls : nil) }
        } else {
            completionHandler(panel.runModal() == .OK ? panel.urls : nil)
        }
    }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping @MainActor (WKPermissionDecision) -> Void) {
        let local = origin.protocol == "http" && origin.host == "127.0.0.1" && origin.port == launcher.server?.port
        decisionHandler(local ? .grant : .deny)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.runModal()
        completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor (String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = prompt
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24))
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        completionHandler(alert.runModal() == .alertFirstButtonReturn ? field.stringValue : nil)
    }

    // If the web view's own process stops (it can, under memory pressure),
    // load the studio again rather than leave a blank window.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }
}
