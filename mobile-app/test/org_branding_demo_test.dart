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

  test('Convrse keeps its own face', () {
    final convrse = OrgBranding.of('convrse');
    expect(convrse.isSowaka, isFalse);
    expect(convrse.homeLogoAsset, 'assets/images/convrse_logo.png');
  });
}
