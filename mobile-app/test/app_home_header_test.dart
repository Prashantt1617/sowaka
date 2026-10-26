// The home header (company logo left; bell and avatar right) at a phone's
// width, in every state it can be caught in. A build that could not reach the
// API logged "A RenderFlex overflowed by 1981–2114 pixels on the right" here:
// a photo that failed to load drew Flutter's error box, its message on one
// line, in a row that gave it all the width it asked for.
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/manager/presentation/manager_screen.dart';
import 'package:mobile_app/features/manager_shell/presentation/app_home_header.dart';
import 'package:mobile_app/features/shared/org_branding.dart';

/// An iPhone 15/16 Pro: 393 pt wide, the status bar 59 pt tall.
const _phone = Size(393, 852);
const _statusBar = 59.0;

/// A wordmark ten times as wide as it is tall (400 x 20), like a company
/// whose logo is its name set out in full.
const _wideLogo = 'test/wide_logo.png';
final _wideLogoPng = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAZAAAAAUCAYAAACj6Wu2AAAAWElEQVR42u3VMQEAAAQAQRVUUEH/bGQwu+EK'
  '/PKR1QMAVyECAAYCgIEAYCAAGAgAGAgABgKAgQBgIAAYCAAYCAAGAoCBAGAgABgIABgIAAYCgIEAYCAA'
  'fLEBa5bGsLagXAAAAABJRU5ErkJggg==',
);

/// A logo the app was built without, so it fails to load.
const _missingLogo = 'assets/images/no_such_logo.png';

/// The app's own assets, plus the wide wordmark, and nothing for
/// [_missingLogo].
class _Bundle extends CachingAssetBundle {
  @override
  Future<ByteData> load(String key) async {
    if (key == _wideLogo) return ByteData.sublistView(_wideLogoPng);
    if (key == _missingLogo) throw FlutterError('Unable to load asset: "$key".');
    return rootBundle.load(key);
  }
}

/// A photo that never arrives, failing the way a phone with no route to the
/// API fails: with a long message naming the address and the URL.
class _UnreachablePhoto extends ImageProvider<_UnreachablePhoto> {
  const _UnreachablePhoto();

  @override
  Future<_UnreachablePhoto> obtainKey(ImageConfiguration configuration) =>
      SynchronousFuture(this);

  @override
  ImageStreamCompleter loadImage(
    _UnreachablePhoto key,
    ImageDecoderCallback decode,
  ) => OneFrameImageStreamCompleter(
    Future<ImageInfo>.error(
      Exception(
        'ClientException with SocketException: Connection failed (OS Error: '
        'No route to host, errno = 65), address = 192.168.1.42, port = 52114, '
        'uri=http://192.168.1.42:4000/media/avatars/68f0c1d2e3a4b5c6d7e8f901'
        '/profile-photo.jpg?w=256',
      ),
    ),
  );
}

/// The avatar as the shell draws it: the photo when there is one, the
/// initial in a circle when not, or while the photo is failing.
Widget _avatar({String initial = 'K', bool photoFails = false}) => SizedBox(
  key: const ValueKey('avatar'),
  child: photoFails
      ? ClipOval(
          child: Image(
            image: const _UnreachablePhoto(),
            width: 42,
            height: 42,
            fit: BoxFit.cover,
            errorBuilder: (_, _, _) =>
                AvatarBadge(initial: initial, index: 1, size: 42),
          ),
        )
      : AvatarBadge(initial: initial, index: 1, size: 42),
);

Future<void> _pumpHeader(
  WidgetTester tester, {
  required OrgBranding branding,
  Widget? profileAction,
}) async {
  tester.view
    ..devicePixelRatio = 3
    ..physicalSize = _phone * 3
    ..padding = const FakeViewPadding(top: _statusBar * 3);
  addTearDown(tester.view.reset);
  // Each case loads its images afresh.
  imageCache.clear();
  OrgBranding.current.value = branding;
  addTearDown(() => OrgBranding.current.value = OrgBranding.sowaka);

  await tester.pumpWidget(
    DefaultAssetBundle(
      bundle: _Bundle(),
      child: MaterialApp(
        home: Scaffold(
          body: Column(
            children: [
              AppHomeHeader(
                profileAction: profileAction ?? _avatar(),
                onNotifications: () {},
              ),
              const Expanded(child: SizedBox()),
            ],
          ),
        ),
      ),
    ),
  );
  // Logos are real PNGs: let them load and decode, off the fake clock.
  for (var i = 0; i < 3; i++) {
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 50)),
    );
    await tester.pump();
  }
}

Rect _rectOf(WidgetTester tester, Finder finder) => tester.getRect(finder);

Finder get _logo => find.byKey(const ValueKey('app-home-logo'));
Finder get _bell => find.bySemanticsLabel('Notifications');

/// Where everything sits when the data has loaded, as the header has always
/// drawn it: the logo 99 x 41 at the left margin, the bell and the avatar at
/// the right one, all centred on one line under the status bar.
void _expectUsualLayout(WidgetTester tester) {
  expect(tester.takeException(), isNull);
  expect(_rectOf(tester, _logo), const Rect.fromLTWH(16, 75.5, 99, 41));
  expect(_rectOf(tester, _bell), const Rect.fromLTWH(283, 76, 40, 40));
  expect(
    _rectOf(tester, find.byKey(const ValueKey('avatar'))),
    const Rect.fromLTWH(335, 75, 42, 42),
  );
  expect(
    tester.getSize(find.byType(AppHomeHeader)),
    const Size(393, _statusBar + 16 + 42 + 16),
  );
}

void main() {
  testWidgets('normal data: the org logo, the bell and the avatar', (
    tester,
  ) async {
    await _pumpHeader(tester, branding: OrgBranding.of('convrse'));
    _expectUsualLayout(tester);
    final logo = tester.widget<Image>(
      find.descendant(of: _logo, matching: find.byType(Image)).first,
    );
    expect((logo.image as AssetImage).assetName, 'assets/images/convrse_logo.png');
  });

  testWidgets('no company data yet: the default logo, an empty avatar', (
    tester,
  ) async {
    await _pumpHeader(
      tester,
      branding: OrgBranding.sowaka,
      // No dashboard: no initial to show.
      profileAction: _avatar(initial: ''),
    );
    _expectUsualLayout(tester);
  });

  testWidgets('a logo that fails to load leaves the slot as it was', (
    tester,
  ) async {
    await _pumpHeader(
      tester,
      branding: const OrgBranding(
        org: 'broken',
        wordmark: 'broken',
        tagline: '',
        homeLogoAsset: _missingLogo,
      ),
    );
    _expectUsualLayout(tester);
    // In its place, the default logo.
    expect(
      find.descendant(
        of: _logo,
        matching: find.image(const AssetImage('assets/images/convrse_logo.png')),
      ),
      findsOneWidget,
    );
  });

  testWidgets('a very wide logo is fitted inside the slot', (tester) async {
    await _pumpHeader(
      tester,
      branding: const OrgBranding(
        org: 'wide',
        wordmark: 'wide',
        tagline: '',
        homeLogoAsset: _wideLogo,
      ),
    );
    _expectUsualLayout(tester);
    final image = tester.renderObject<RenderImage>(
      find.descendant(of: _logo, matching: find.byType(RawImage)),
    );
    expect(image.image, isNotNull, reason: 'the wide logo did load');
    expect(image.size, const Size(99, 41));
    expect(image.fit, BoxFit.contain);
  });

  testWidgets("HR Organization's Solutions: the mark over the name, fitted", (
    tester,
  ) async {
    await _pumpHeader(tester, branding: OrgBranding.of('hrorgsol'));
    _expectUsualLayout(tester);
    final image = tester.renderObject<RenderImage>(
      find.descendant(of: _logo, matching: find.byType(RawImage)),
    );
    expect(image.image, isNotNull);
    expect(image.size, const Size(99, 41));
  });

  testWidgets('a long company name changes nothing', (tester) async {
    await _pumpHeader(
      tester,
      branding: const OrgBranding(
        org: 'long',
        wordmark:
            'HR Organization’s Solutions and Consulting Services Private '
            'Limited, Bengaluru, Karnataka, India',
        tagline: 'Your app is powered by',
      ),
    );
    _expectUsualLayout(tester);
  });

  testWidgets('a photo that fails to load falls back to the initial', (
    tester,
  ) async {
    await _pumpHeader(
      tester,
      branding: OrgBranding.of('convrse'),
      profileAction: _avatar(photoFails: true),
    );
    _expectUsualLayout(tester);
    expect(find.text('K'), findsOneWidget);
  });

  testWidgets('even a runaway avatar cannot push the row off the screen', (
    tester,
  ) async {
    // What the header was handed on the phone: a photo with no fallback,
    // drawn by Flutter as an error box with its message on one line.
    await _pumpHeader(
      tester,
      branding: OrgBranding.of('convrse'),
      profileAction: const ClipOval(
        child: Image(
          image: _UnreachablePhoto(),
          width: 42,
          height: 42,
          fit: BoxFit.cover,
        ),
      ),
    );
    // Flutter's error box is drawn, inside the avatar's room.
    expect(find.byType(Placeholder), findsOneWidget);
    expect(
      tester.getSize(find.byType(Placeholder)).width,
      lessThanOrEqualTo(48),
    );
    // The photo's own failure may be reported; an overflow must not be.
    expect('${tester.takeException()}', isNot(contains('overflowed')));
    // The error box fills the avatar's 48 x 48 at most: the logo keeps its
    // place and size, the bell sits beside the box, all on screen.
    expect(_rectOf(tester, _logo).left, 16);
    expect(tester.getSize(_logo), const Size(99, 41));
    expect(_rectOf(tester, _bell).right, 393 - 16 - 48 - 12);
  });
}
