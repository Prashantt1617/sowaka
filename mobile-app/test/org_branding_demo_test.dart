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

  test('a company with no brand here (a new one) gets Sowaka\'s face; the header logo only with the server\'s switch', () {
    for (final org in ['sowakahq', 'some-new-company']) {
      final on = OrgBranding.of(org, sowakaLogo: true);
      expect(on.isSowaka, isTrue, reason: org);
      expect(on.homeLogoAsset, 'assets/images/sowaka_header_logo.png', reason: org);
      expect(on.iosIconName, isNull, reason: org);
      expect(on.logoAsset, isNull, reason: org);
      // features.sowakaLogo off (or an older server): no logo of its own, the header's old default.
      expect(OrgBranding.of(org).homeLogoAsset, isNull, reason: org);
    }
    expect(OrgBranding.of('sowaka').homeLogoAsset, 'assets/images/sowaka_header_logo.png');
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
    };
    logos.forEach((org, logo) => expect(OrgBranding.of(org).homeLogoAsset, logo, reason: org));
    // The switch never changes a company that has its own logo here.
    logos.forEach((org, logo) => expect(OrgBranding.of(org, sowakaLogo: true).homeLogoAsset, logo, reason: org));
    // SOWAKA and Sowaka Care have none here: Sowaka's with the switch on.
    for (final org in ['sowakahq', 'sowaka-care']) {
      expect(OrgBranding.of(org, sowakaLogo: true).homeLogoAsset, 'assets/images/sowaka_header_logo.png', reason: org);
    }
  });
}
