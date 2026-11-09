import Darwin
import Foundation

// The studio's server: `next start` on this Mac only (127.0.0.1), from the
// studio folder, so it finds its films, engines and .env.local just as it
// does under `npm run dev`.
enum Server {
    // The app's own port, so it never takes 3200 from `npm run dev`. If it's
    // busy, any free port is used instead.
    static let appPort = 3201

    // Binds the port on 127.0.0.1 for a moment; 0 asks the Mac for any free
    // one. Returns the port, or nil if it's taken.
    private static func bind(_ port: Int) -> Int? {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return nil }
        defer { close(fd) }
        // As Node does, so a port the studio just let go of counts as free.
        var on: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &on, socklen_t(MemoryLayout<Int32>.size))
        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = in_port_t(UInt16(port).bigEndian)
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        let bound = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bound == 0 else { return nil }
        var out = sockaddr_in()
        var len = socklen_t(MemoryLayout<sockaddr_in>.size)
        _ = withUnsafeMutablePointer(to: &out) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &len) }
        }
        return Int(UInt16(bigEndian: out.sin_port))
    }

    static func pickPort(preferred: Int?) -> Int {
        let env = Int(ProcessInfo.processInfo.environment["SAYMO_PORT"] ?? ProcessInfo.processInfo.environment["MOTION_STUDIO_PORT"] ?? "")
        let wanted = env ?? preferred ?? appPort
        return bind(wanted) ?? bind(0) ?? wanted
    }

    private static func answers(_ url: URL) async -> Bool {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 5)
        request.httpMethod = "GET"
        guard let (_, response) = try? await URLSession.shared.data(for: request) else { return false }
        return (response as? HTTPURLResponse)?.statusCode == 200
    }

    struct Running {
        let job: Job
        let url: URL
        let port: Int
    }

    static func start(folder: String, slot: String, environment: StudioEnvironment, port: Int) async
        -> (running: Running?, lines: [String]) {
        guard let node = environment.node else { return (nil, []) }
        var variables = environment.variables
        variables["STUDIO_DESKTOP_DIST"] = Builder.distDir(slot)
        variables["PORT"] = String(port)
        let job = Job(
            node: node.path,
            command: [node.path, "\(folder)/node_modules/next/dist/bin/next", "start",
                      "--port", String(port), "--hostname", "127.0.0.1"],
            folder: folder, environment: variables, logName: "server.log")
        guard job.start() else { return (nil, job.lines) }
        let url = URL(string: "http://127.0.0.1:\(port)")!
        let until = Date().addingTimeInterval(90)
        while Date() < until, !job.hasExited {
            if await answers(url.appendingPathComponent("studio")) {
                return (Running(job: job, url: url, port: port), job.lines)
            }
            try? await Task.sleep(for: .milliseconds(300))
        }
        await job.stop()
        return (nil, job.lines)
    }
}
