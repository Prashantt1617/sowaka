import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

/// The icon on the home screen.
///
/// iOS swaps between icons that ship inside the build, so a Convrse
/// employee's phone shows the Convrse mark. Android has no such API: there
/// the app enables a launcher alias carrying the company's icon and retires
/// the default one — once the app is in the background, since swapping the
/// component a running task came from closes that task. The launcher then
/// refreshes on its own schedule — usually seconds, sometimes after a reboot
/// — and an existing home-screen shortcut may need re-adding once.
class AppIcon {
  const AppIcon._();

  static const _channel = MethodChannel('sowaka/app_icon');

  /// Switches to [name], or back to the default icon when null.
  ///
  /// Never throws: an icon is decoration, and an older build that has no such
  /// icon bundled should carry on rather than fail at launch.
  static Future<void> use(String? name) async {
    if (Platform.isAndroid) {
      await WidgetsBinding.instance.endOfFrame;
      try {
        await _channel.invokeMethod<void>('use', {'name': name});
      } catch (error) {
        debugPrint('App icon not changed: $error');
      }
      return;
    }
    if (!Platform.isIOS) return;
    // Asked during launch, before the app is active, iOS cancels the change
    // ("The operation was cancelled" in the device log) and the old icon
    // stays. So this waits for the first frame and asks again a few seconds
    // on; the native side skips the call once the icon already matches, so
    // the second ask costs nothing.
    await WidgetsBinding.instance.endOfFrame;
    for (final wait in const [Duration(milliseconds: 600), Duration(seconds: 4)]) {
      await Future<void>.delayed(wait);
      try {
        await _channel.invokeMethod<void>('use', {'name': name});
      } catch (error) {
        debugPrint('App icon not changed: $error');
      }
    }
  }
}
