import Foundation
import WebKit

/// Serves files from the bundle's "game" folder for app://game/... URLs.
final class GameSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "app"

    private static let mime: [String: String] = [
        "html": "text/html; charset=utf-8", "htm": "text/html; charset=utf-8",
        "js": "text/javascript; charset=utf-8", "mjs": "text/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8", "json": "application/json; charset=utf-8",
        "webmanifest": "application/manifest+json", "wasm": "application/wasm",
        "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp",
        "svg": "image/svg+xml", "ico": "image/x-icon", "gif": "image/gif",
        "mp3": "audio/mpeg", "ogg": "audio/ogg", "wav": "audio/wav", "m4a": "audio/mp4",
        "glb": "model/gltf-binary", "gltf": "model/gltf+json", "bin": "application/octet-stream",
        "woff2": "font/woff2", "woff": "font/woff", "ttf": "font/ttf",
        "txt": "text/plain; charset=utf-8",
    ]

    private let root: URL? = Bundle.main.resourceURL?.appendingPathComponent("game", isDirectory: true)

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(NSError(domain: NSURLErrorDomain, code: NSURLErrorBadURL))
            return
        }
        var path = url.path.removingPercentEncoding ?? url.path
        if path.isEmpty || path.hasSuffix("/") { path += "index.html" }
        let parts = path.split(separator: "/").map(String.init)
        guard let root = root, !parts.contains("..") else { return respond(urlSchemeTask, url, 404, "text/plain", Data()) }
        let file = parts.reduce(root) { $0.appendingPathComponent($1) }
        guard let data = try? Data(contentsOf: file, options: .mappedIfSafe) else {
            return respond(urlSchemeTask, url, 404, "text/plain", Data())
        }
        let type = Self.mime[file.pathExtension.lowercased()] ?? "application/octet-stream"
        respond(urlSchemeTask, url, 200, type, data)
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private func respond(_ task: WKURLSchemeTask, _ url: URL, _ status: Int, _ type: String, _ data: Data) {
        let headers = [
            "Content-Type": type,
            "Content-Length": String(data.count),
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache",
        ]
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else {
            task.didFailWithError(NSError(domain: NSURLErrorDomain, code: NSURLErrorUnknown))
            return
        }
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }
}
