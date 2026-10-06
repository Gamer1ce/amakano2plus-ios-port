import UIKit
import WebKit
import AVFAudio

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = GameViewController()
        window.makeKeyAndVisible()
        self.window = window
        UIApplication.shared.isIdleTimerDisabled = true
        return true
    }
    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask { .landscape }
}

final class GameViewController: UIViewController, WKNavigationDelegate {
    private var webView: WKWebView!
    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        guard let root = Bundle.main.url(forResource: "Content", withExtension: nil) else {
            let label = UILabel(frame: view.bounds)
            label.text = "游戏资源缺失，请先运行 prepare-content.py。"
            label.textColor = .white; label.textAlignment = .center
            view.addSubview(label); return
        }
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(LocalGameFiles(root: root), forURLScheme: "game")
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.isOpaque = false; webView.backgroundColor = .black
        webView.scrollView.isScrollEnabled = false
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        let page = ProcessInfo.processInfo.arguments.contains("--diagnostics") ? "diagnostics/index.html" : "runtime/index.html"
        webView.load(URLRequest(url: URL(string: "game://local/\(page)")!))
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showNavigationError(error)
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showNavigationError(error)
    }
    private func showNavigationError(_ error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled, presentedViewController == nil else { return }
        let alert = UIAlertController(title: "游戏页面加载失败", message: error.localizedDescription, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "重新加载", style: .default) { [weak self] _ in self?.webView.reload() })
        present(alert, animated: true)
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // Do not silently reset the player's unsaved progress after an OOM.
        guard presentedViewController == nil else { return }
        let alert = UIAlertController(title: "游戏页面已停止", message: "WebKit 进程已退出，需要查看设备日志确认原因。重新加载后可恢复已保存的进度。", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "重新加载", style: .default) { _ in webView.reload() })
        present(alert, animated: true)
    }
}

/// Serves bundled files without opening a network port; supports AAC byte ranges.
final class LocalGameFiles: NSObject, WKURLSchemeHandler {
    private let root: URL
    private let lock = NSLock()
    private var active = Set<ObjectIdentifier>()
    private let queue = DispatchQueue(label: "game.bundle.files", qos: .userInitiated, attributes: .concurrent)
    init(root: URL) { self.root = root.standardizedFileURL.resolvingSymlinksInPath(); super.init() }
    private func onMain(_ action: () -> Void) {
        if Thread.isMainThread { action() } else { DispatchQueue.main.sync(execute: action) }
    }
    private func deliver(_ token: ObjectIdentifier, _ action: () -> Void) {
        onMain {
            self.lock.lock(); let valid = self.active.contains(token); self.lock.unlock()
            if valid { action() }
        }
    }
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let token = ObjectIdentifier(task as AnyObject)
        let request = task.request
        onMain { self.lock.lock(); self.active.insert(token); self.lock.unlock() }
        queue.async {
            do {
                guard let url = request.url else { throw URLError(.badURL) }
                let file = try LocalFileRequest.resolve(url: url, root: self.root)
                let method = request.httpMethod ?? "GET"
                guard method == "GET" || method == "HEAD" else {
                    self.sendEmpty(task, token: token, url: url, status: 405, extraHeaders: ["Allow": "GET, HEAD"])
                    self.finish(token); return
                }
                guard (try? file.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true else {
                    self.sendEmpty(task, token: token, url: url, status: 404)
                    self.finish(token); return
                }
                let handle = try FileHandle(forReadingFrom: file)
                defer { try? handle.close() }
                let size = try handle.seekToEnd()
                let selection = LocalByteRange.select(size: size, range: request.value(forHTTPHeaderField: "Range"), method: method)
                var headers = ["Content-Type": LocalFileRequest.mimeType(for: file), "Content-Length": String(selection.length), "Accept-Ranges": "bytes", "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges, Content-Length"]
                // The model loader decompresses .gz itself. Do not set Content-Encoding: gzip.
                if let contentRange = selection.contentRange { headers["Content-Range"] = contentRange }
                guard let response = HTTPURLResponse(url: url, statusCode: selection.status, httpVersion: "HTTP/1.1", headerFields: headers) else { throw URLError(.badServerResponse) }
                self.deliver(token) { task.didReceive(response) }
                try handle.seek(toOffset: selection.start)
                var remaining = method == "HEAD" ? 0 : selection.length
                while remaining > 0 {
                    self.lock.lock(); let valid = self.active.contains(token); self.lock.unlock()
                    if !valid { return }
                    let data = try handle.read(upToCount: Int(min(remaining, 256 * 1024))) ?? Data()
                    guard !data.isEmpty else { throw URLError(.cannotDecodeContentData) }
                    remaining -= UInt64(data.count)
                    self.deliver(token) { task.didReceive(data) }
                }
                self.deliver(token) { task.didFinish() }
            } catch { self.deliver(token) { task.didFailWithError(error) } }
            self.finish(token)
        }
    }
    private func sendEmpty(_ task: WKURLSchemeTask, token: ObjectIdentifier, url: URL, status: Int, extraHeaders: [String: String] = [:]) {
        var headers = ["Content-Length": "0", "Access-Control-Allow-Origin": "*"]
        headers.merge(extraHeaders) { _, new in new }
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else { return }
        deliver(token) { task.didReceive(response) }
        deliver(token) { task.didFinish() }
    }
    private func finish(_ token: ObjectIdentifier) {
        lock.lock(); active.remove(token); lock.unlock()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        // Serialize cancellation with task callbacks. Checking under the lock and
        // calling WebKit after unlocking is safe only if stop uses the same queue.
        // No lock is held while WebKit runs, so a reentrant stop can invalidate it.
        onMain {
            self.lock.lock(); self.active.remove(ObjectIdentifier(task as AnyObject)); self.lock.unlock()
        }
    }
}
