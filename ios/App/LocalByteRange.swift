/// Pure Swift byte-range selection, testable without UIKit or Foundation.
struct LocalByteRange {
    let start: UInt64
    let length: UInt64
    let status: Int
    let contentRange: String?

    static func select(size: UInt64, range: String?, method: String = "GET") -> LocalByteRange {
        let full = LocalByteRange(start: 0, length: size, status: 200, contentRange: nil)
        // HEAD describes the complete representation and never sends a body.
        guard method == "GET", let range = range, range.hasPrefix("bytes=") else { return full }
        let value = range.dropFirst(6)
        // Multipart and malformed ranges can be ignored; we implement one range.
        guard !value.contains(",") else { return full }
        let parts = value.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 2 else { return full }
        func unsigned(_ value: Substring) -> UInt64? {
            guard !value.isEmpty, value.allSatisfy({ $0 >= "0" && $0 <= "9" }) else { return nil }
            return UInt64(value)
        }
        func unsatisfiable() -> LocalByteRange {
            LocalByteRange(start: 0, length: 0, status: 416, contentRange: "bytes */\(size)")
        }
        let start: UInt64
        let end: UInt64
        if parts[0].isEmpty {
            guard let suffix = unsigned(parts[1]) else { return full }
            guard suffix > 0, size > 0 else { return unsatisfiable() }
            start = size > suffix ? size - suffix : 0
            end = size - 1
        } else {
            guard let requestedStart = unsigned(parts[0]) else { return full }
            var requestedEnd: UInt64? = nil
            if !parts[1].isEmpty {
                guard let parsed = unsigned(parts[1]) else { return full }
                guard requestedStart <= parsed else { return full }
                requestedEnd = parsed
            }
            guard size > 0, requestedStart < size else { return unsatisfiable() }
            start = requestedStart
            end = min(requestedEnd ?? (size - 1), size - 1)
        }
        return LocalByteRange(start: start, length: end - start + 1, status: 206,
                                contentRange: "bytes \(start)-\(end)/\(size)")
    }

}
