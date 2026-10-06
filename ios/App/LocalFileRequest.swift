import Foundation

/// Foundation-only logic shared by the WebKit handler and the Mac smoke tests.
struct LocalFileRequest {
    static func resolve(url: URL, root: URL) throws -> URL {
        guard url.scheme == "game", url.host == "local", url.user == nil, url.password == nil,
              url.port == nil else { throw URLError(.badURL) }
        let base = root.standardizedFileURL.resolvingSymlinksInPath()
        let relative = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let components = relative.split(separator: "/", omittingEmptySubsequences: false)
        guard !relative.isEmpty, components.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." })
        else { throw URLError(.noPermissionsToReadFile) }
        // Foundation may leave a link unresolved when its final child does not
        // exist. Reject links in each component before considering that child.
        var candidate = base
        for component in components {
            candidate.appendPathComponent(String(component))
            guard (try? FileManager.default.destinationOfSymbolicLink(atPath: candidate.path)) == nil
            else { throw URLError(.noPermissionsToReadFile) }
        }
        let file = base.appendingPathComponent(relative).standardizedFileURL.resolvingSymlinksInPath()
        guard file.path.hasPrefix(base.path + "/") else { throw URLError(.noPermissionsToReadFile) }
        return file
    }

    static func mimeType(for file: URL) -> String {
        let types = ["html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8",
                     "mjs": "text/javascript; charset=utf-8", "css": "text/css; charset=utf-8",
                     "json": "application/json; charset=utf-8", "webp": "image/webp", "png": "image/png",
                     "jpg": "image/jpeg", "jpeg": "image/jpeg", "m4a": "audio/mp4",
                     "mp4": "video/mp4", "gz": "application/gzip", "wasm": "application/wasm"]
        return types[file.pathExtension.lowercased()] ?? "application/octet-stream"
    }
}
