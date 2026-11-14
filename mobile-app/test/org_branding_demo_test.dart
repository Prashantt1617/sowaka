// The Sowaka Demo company (org id `halcyon`) wears Sowaka's face: the Sowaka
// header logo and splash, never another client's logo.
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/shared/org_branding.dart';

void main() {
  test('Sowaka Demo is branded as Sowaka', () {
    final demo = OrgBranding.of('halcyon');
    expect(demo.isSowaka, isTrue);
    expect(demo.homeLogoAsset, 'assets/images/sowaka_header_logo.png');
    expect(demo.wordmark, 'sowaka');
    expect(demo.iosIconName, isNull);
    expect(demo.logoAsset, isNull);
  });

  test('a company with no brand here (a new one) gets Sowaka\'s face', () {
    for (final org in ['sowakahq', 'some-new-company', 'sowaka']) {
      final b = OrgBranding.of(org);
      expect(b.isSowaka, isTrue, reason: org);
      expect(b.homeLogoAsset, 'assets/images/sowaka_header_logo.png', reason: org);
      expect(b.iosIconName, isNull, reason: org);
      expect(b.logoAsset, isNull, reason: org);
    }
  });

  test('Convrse keeps its own face', () {
    final convrse = OrgBranding.of('convrse');
    expect(convrse.isSowaka, isFalse);
    expect(convrse.homeLogoAsset, 'assets/images/convrse_logo.png');
  });

  test('every company on production keeps its own header logo', () {
    const logos = {
      'convrse': 'assets/images/convrse_logo.png',
      'acmt': 'assets/images/acmt_logo.png',
      'toyota': 'assets/images/toyota_logo.png',
      'cde': 'assets/images/cde_logo.png',
      'hrorgsol': 'assets/images/hrorgsol_logo.png',
      // Sowaka's own companies: Sowaka Test, Sowaka Demo, SOWAKA, Sowaka Care.
      'sowaka': 'assets/images/sowaka_header_logo.png',
      'halcyon': 'assets/images/sowaka_header_logo.png',
      'sowakahq': 'assets/images/sowaka_header_logo.png',
      'sowaka-care': 'assets/images/sowaka_header_logo.png',
    };
    logos.forEach((org, logo) => expect(OrgBranding.of(org).homeLogoAsset, logo, reason: org));
  });
}
