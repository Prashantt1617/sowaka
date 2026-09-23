import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    registerAppIconChannel(engineBridge.pluginRegistry)
  }

  /// Lets the app wear the signed-in company's icon.
  ///
  /// The alternate icons ship inside the build and are named in Info.plist;
  /// this only chooses between them. Asking for the icon already in use is
  /// ignored, so nothing flashes the system alert twice.
  private func registerAppIconChannel(_ registry: FlutterPluginRegistry) {
    guard let messenger = registry.registrar(forPlugin: "SowakaAppIcon")?.messenger() else { return }
    let channel = FlutterMethodChannel(name: "sowaka/app_icon", binaryMessenger: messenger)
    channel.setMethodCallHandler { call, result in
      guard call.method == "use" else {
        result(FlutterMethodNotImplemented)
        return
      }
      guard UIApplication.shared.supportsAlternateIcons else {
        result(nil)
        return
      }
      let requested = (call.arguments as? [String: Any])?["name"] as? String
      if UIApplication.shared.alternateIconName == requested {
        result(nil)
        return
      }
      UIApplication.shared.setAlternateIconName(requested) { error in
        if let error = error {
          NSLog("App icon not changed: \(error.localizedDescription)")
        }
        result(nil)
      }
    }
  }
}
