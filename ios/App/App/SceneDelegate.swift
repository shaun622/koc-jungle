import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        // One bridge/window, created here rather than also loading Main.storyboard.
        // Keep the existing single-window app and normal iPad screen mirroring.
        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = CAPBridgeViewController()
        window?.makeKeyAndVisible()
        // Diagnostic branch only: inspect the blank, signed-out test launch.
        for seconds in [10.0, 25.0] {
            DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { [weak self] in
                guard let controller = self?.window?.rootViewController as? CAPBridgeViewController else { return }
                NSLog("PAD_LAUNCH URL=%@", controller.webView?.url?.absoluteString ?? "nil")
                controller.webView?.evaluateJavaScript("JSON.stringify({href:location.href,ready:document.readyState,title:document.title,text:document.body?.innerText.slice(0,800),scripts:Array.from(document.scripts).map(s=>s.src)})") { value, error in
                    NSLog("PAD_LAUNCH DOM=%@ ERROR=%@", String(describing: value), String(describing: error))
                }
            }
        }

        // Capacitor defers cold-start links until the bridge plugins are ready.
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
