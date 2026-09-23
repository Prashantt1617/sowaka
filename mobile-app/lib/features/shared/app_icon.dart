import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// The icon on the home screen.
///
/// iOS lets an app swap between icons that ship inside the build, so a
/// Convrse employee's phone shows the Convrse mark. Android has no supported
/// way to do this — the usual activity-alias trick drops the app out of
/// recents and can break home-screen shortcuts — so there the company's brand
/// stops at the app's own screens.
class AppIcon {
  const AppIcon._();

  static const _channel = MethodChannel('sowaka/app_icon');

  /// Switches to [name], or back to the default icon when null.
  ///
  /// Never throws: an icon is decoration, and an older build that has no such
  /// icon bundled should carry on rather than fail at launch.
  static Future<void> use(String? name) async {
    if (!Platform.isIOS) return;
    try {
      await _channel.invokeMethod<void>('use', {'name': name});
    } catch (error) {
      debugPrint('App icon not changed: $error');
    }
  }
}
