import UIKit
import WebKit
import GameController

/// WKWebView that can take first-responder status so hardware keyboard events reach the page.
final class GameWebView: WKWebView {
    override var canBecomeFirstResponder: Bool { true }
}

/// Full-screen WKWebView hosting the bundled web game at app://game/index.html.
final class GameViewController: UIViewController {
    private var webView: GameWebView!

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.setURLSchemeHandler(GameSchemeHandler(), forURLScheme: GameSchemeHandler.scheme)
        let script = WKUserScript(source: "window.__nativeApp = 'ios';",
                                  injectionTime: .atDocumentStart, forMainFrameOnly: false)
        config.userContentController.addUserScript(script)

        let web = GameWebView(frame: .zero, configuration: config)
        if #available(iOS 16.4, *) { web.isInspectable = true }
        web.isOpaque = true
        web.backgroundColor = .black
        web.scrollView.backgroundColor = .black
        web.scrollView.isScrollEnabled = false
        web.scrollView.bounces = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsBackForwardNavigationGestures = false
        webView = web
        view = web
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        NotificationCenter.default.addObserver(self, selector: #selector(becomeActive),
                                               name: UIApplication.didBecomeActiveNotification, object: nil)
        if let url = URL(string: "app://game/index.html?noshell") {
            webView.load(URLRequest(url: url))
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        setNeedsUpdateOfHomeIndicatorAutoHidden()
        setNeedsUpdateOfScreenEdgesDeferringSystemGestures()
        _ = webView.becomeFirstResponder()
    }

    @objc private func becomeActive() { _ = webView.becomeFirstResponder() }

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .all }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }
    override var shouldAutorotate: Bool { true }
}
