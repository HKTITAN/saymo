import Foundation
#if canImport(Sparkle)
import Sparkle
#endif

// Updates for the app itself, with Sparkle, the usual Mac updater (the
// README says how to publish one). Off until a release exists: Sparkle only
// starts when the app was built with Sparkle (scripts/fetch-sparkle.sh) AND
// its Info.plist names a feed (SUFeedURL) and the key releases are signed
// with (SUPublicEDKey). scripts/build.sh fills those in from
// SAYMO_FEED_URL and SAYMO_ED_KEY; without them the app
// never checks.
@MainActor
final class Updates {
    static let shared = Updates()

    #if canImport(Sparkle)
    private var controller: SPUStandardUpdaterController?
    #endif

    private static func configured() -> Bool {
        let info = Bundle.main.infoDictionary ?? [:]
        let feed = (info["SUFeedURL"] as? String) ?? ""
        let key = (info["SUPublicEDKey"] as? String) ?? ""
        return !feed.isEmpty && !key.isEmpty && ProcessInfo.processInfo.environment["SAYMO_UPDATES"] != "off"
    }

    var available: Bool {
        #if canImport(Sparkle)
        return controller != nil
        #else
        return false
        #endif
    }

    func start() {
        #if canImport(Sparkle)
        guard Updates.configured() else { return }
        controller = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
        #endif
    }

    func checkNow() {
        #if canImport(Sparkle)
        controller?.checkForUpdates(nil)
        #endif
    }
}
