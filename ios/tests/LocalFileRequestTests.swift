#if !RANGE_ONLY
import Foundation
#endif

@main
struct LocalFileRequestTests {
    static func main() throws {
        var count = 0
        func check(_ range: String?, size: UInt64 = 10, method: String = "GET", status: Int,
                   start: UInt64 = 0, length: UInt64, contentRange: String? = nil) {
            let result = LocalByteRange.select(size: size, range: range, method: method)
            precondition(result.status == status && result.start == start && result.length == length && result.contentRange == contentRange,
                         "Unexpected selection for \(range ?? "nil") at size \(size): \(result)")
            count += 1
        }
        check(nil, status: 200, length: 10)
        check(nil, size: 0, status: 200, length: 0)
        check("bytes=0-0", status: 206, length: 1, contentRange: "bytes 0-0/10")
        check("bytes=2-5", status: 206, start: 2, length: 4, contentRange: "bytes 2-5/10")
        check("bytes=8-999", status: 206, start: 8, length: 2, contentRange: "bytes 8-9/10")
        check("bytes=9-", status: 206, start: 9, length: 1, contentRange: "bytes 9-9/10")
        check("bytes=-4", status: 206, start: 6, length: 4, contentRange: "bytes 6-9/10")
        check("bytes=-99", status: 206, length: 10, contentRange: "bytes 0-9/10")
        check("bytes=10-", status: 416, length: 0, contentRange: "bytes */10")
        check("bytes=-0", status: 416, length: 0, contentRange: "bytes */10")
        check("bytes=0-", size: 0, status: 416, length: 0, contentRange: "bytes */0")
        check("bytes=0-1", method: "HEAD", status: 200, length: 10)
        for invalid in ["items=0-1", "bytes=abc-", "bytes=3-2", "bytes=+1-2", "bytes=1-2-3", "bytes=0-1,4-5", "bytes=-", "bytes=18446744073709551616-"] {
            check(invalid, status: 200, length: 10)
        }
        check("bytes=18446744073709551614-", size: UInt64.max, status: 206,
              start: UInt64.max - 1, length: 1, contentRange: "bytes 18446744073709551614-18446744073709551614/18446744073709551615")
        #if !RANGE_ONLY
        let fm = FileManager.default
        let temp = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let root = temp.appendingPathComponent("Content")
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: temp) }
        let ordinary = try LocalFileRequest.resolve(url: URL(string: "game://local/runtime/%E4%B8%AD%E6%96%87.js")!, root: root)
        precondition(ordinary.path == root.appendingPathComponent("runtime/中文.js").path)
        count += 1
        let outside = temp.appendingPathComponent("outside")
        try fm.createDirectory(at: outside, withIntermediateDirectories: true)
        try fm.createSymbolicLink(at: root.appendingPathComponent("escape"), withDestinationURL: outside)
        for invalid in ["game://else/runtime/index.html", "https://local/runtime/index.html", "game://local:8080/index.html", "game://user@local/index.html", "game://local/../outside/file", "game://local/%2E%2E/outside/file", "game://local/escape/file", "game://local/"] {
            do {
                _ = try LocalFileRequest.resolve(url: URL(string: invalid)!, root: root)
                preconditionFailure("Escaped Content with \(invalid)")
            } catch { count += 1 }
        }
        for (extensionName, type) in [("mjs", "text/javascript; charset=utf-8"), ("GZ", "application/gzip"), ("m4a", "audio/mp4"), ("mp4", "video/mp4"), ("wasm", "application/wasm")] {
            precondition(LocalFileRequest.mimeType(for: root.appendingPathComponent("test.\(extensionName)")) == type)
            count += 1
        }
        #endif
        print("Passed \(count) local request checks. UIKit/WebKit not compiled.")
    }
}
