import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Which company's face the app wears.
///
/// Sowaka is the product; a company that has its own brand sees that instead,
/// down to the icon on the home screen (Figma 1887:27433). The
/// choice follows the signed-in person's org, and is remembered on the device
/// so the splash — which runs before anyone has signed in — already looks
/// right on the second launch.
class OrgBranding {
  const OrgBranding({
    required this.org,
    required this.wordmark,
    required this.tagline,
    this.logoAsset,
    this.iosIconName,
    this.light = false,
    this.homeLogoAsset,
    this.poweredByLogoAsset,
  });

  /// The company id this branding belongs to; empty for Sowaka's own.
  final String org;

  /// Set in Anton on the splash, lowercase as the design draws it — unless
  /// there is a [logoAsset], which is drawn in its place.
  final String wordmark;
  final String tagline;

  /// The company's own logo for the splash, in place of the wordmark.
  final String? logoAsset;

  /// The alternate app icon to ask iOS for; null leaves the Sowaka icon.
  final String? iosIconName;

  /// A white splash with dark type, for a logo that needs a light ground.
  final bool light;

  /// The logo the home header wears; Sowaka's own when null.
  final String? homeLogoAsset;

  /// Sowaka's logo drawn under "powered by" instead of the Anton wordmark.
  final String? poweredByLogoAsset;

  bool get isSowaka => org.isEmpty;

  /// Whose brand the app currently wears: the signed-in org's, or the one
  /// this device last saw. Widgets that show the brand listen to this, so a
  /// header built before sign-in changes face the moment the org is known.
  static final ValueNotifier<OrgBranding> current = ValueNotifier(sowaka);

  static const sowaka = OrgBranding(
    org: '',
    wordmark: 'sowaka',
    tagline: 'Your workplace, connected.',
  );

  static const _known = <String, OrgBranding>{
    'convrse': OrgBranding(
      org: 'convrse',
      wordmark: 'convrse.ai',
      // The design's own line, with its typo ("You company's") corrected.
      // The splash sets "sowaka" under it in the brand's own type.
      tagline: 'Your company’s app is powered by',
      logoAsset: 'assets/images/convrse_splash_logo.png',
      iosIconName: 'AppIconConvrse',
      homeLogoAsset: 'assets/images/convrse_logo.png',
    ),
    'acmt': OrgBranding(
      org: 'acmt',
      wordmark: 'ACMT',
      tagline: 'Your company’s app is powered by',
      // The crest is drawn for a white ground, so the splash goes light and
      // "sowaka" is set in dark type under "powered by".
      logoAsset: 'assets/images/acmt_logo.png',
      light: true,
      homeLogoAsset: 'assets/images/acmt_logo.png',
      iosIconName: 'AppIconAcmt',
    ),
  };

  /// The branding for an org id, or Sowaka's when there is none for it.
  static OrgBranding of(String? org) =>
      _known[(org ?? '').trim().toLowerCase()] ?? sowaka;

  static const _key = 'branding.org';

  /// What the last person to sign in on this device saw. Read before the first
  /// frame, so the splash does not flash the wrong brand.
  static Future<OrgBranding> remembered() async {
    try {
      final preferences = await SharedPreferences.getInstance();
      current.value = of(preferences.getString(_key));
      return current.value;
    } catch (_) {
      return sowaka;
    }
  }

  /// Remembers this org for the next launch.
  static Future<void> remember(String? org) async {
    try {
      final preferences = await SharedPreferences.getInstance();
      final branding = of(org);
      current.value = branding;
      if (branding.isSowaka) {
        await preferences.remove(_key);
      } else {
        await preferences.setString(_key, branding.org);
      }
    } catch (_) {
      // A device that cannot store this simply shows Sowaka's splash next time.
    }
  }
}
