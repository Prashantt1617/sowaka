// PNGs of lane L4's screens of the new-joiner canvas (nj-1120): the Sowaka
// tour (OnbTour, TourLesson-<lesson>, TourLessonDone) and Policies
// (Policies, PolicyRead, PoliciesActions, PoliciesUpdated,
// PolicyUpdatedRead), each named after its canvas artboard.
//
// Drawn by Flutter's test renderer at 393 x 852 (PNGs at 2x) with the app's
// own fonts and theme, against fake answers in the server's shapes. Nothing
// here asserts; it only draws.
//
//   flutter test test/screenshots/nj_l4_screens_test.dart --tags screenshots \
//     --dart-define=SCREENS_OUT=<dir>
//
// Without SCREENS_OUT every test here is skipped.
@Tags(['screenshots'])
library;

import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/onboarding_api.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/onboarding_kit.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/onboarding_tiles.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/tour_lessons.dart';
import 'package:mobile_app/features/manager/data/manager_models.dart';
import 'package:mobile_app/features/policies/data/policies_models.dart';
import 'package:mobile_app/features/policies/presentation/policies_ack_screen.dart';
import 'package:mobile_app/main.dart' show sowakaTheme;

const _out = String.fromEnvironment('SCREENS_OUT');
const _skip = _out == '' ? 'Screenshots: pass --dart-define=SCREENS_OUT=<dir>' : null;

const _width = 393.0;
const _height = 852.0;
const _dpr = 2.0;
const _top = 59.0;
const _bottom = 34.0;

void _phone(WidgetTester tester) {
  tester.view.physicalSize = const Size(_width * _dpr, _height * _dpr);
  tester.view.devicePixelRatio = _dpr;
  final inset = FakeViewPadding(top: _top * _dpr, bottom: _bottom * _dpr);
  tester.view.padding = inset;
  tester.view.viewPadding = inset;
}

final _shotKey = GlobalKey();

/// The joiner's Week 1, as the canvas's Prototype · Week 1 has it.
final _today = DateTime(2026, 12, 16, 10);

class _NoApi implements OnboardingApi {
  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

OnboardingShell _shell() => OnboardingShell(
  api: _NoApi(),
  profileAction: const CircleAvatar(radius: 15, backgroundColor: Color(0xFFE8F4FA), child: Text('I', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Color(0xFF0571A6)))),
  onNotifications: () {},
  tabs: const [ManagerTab.connect, ManagerTab.manage, ManagerTab.quick, ManagerTab.grow, ManagerTab.games],
  selectedTab: ManagerTab.quick,
  onSelectTab: (_) {},
  viewerName: 'Isha Verma',
  now: () => _today,
);

const _body = '## Purpose\nWhy this policy exists and what it protects.\n\n'
    '## Who it applies to\nEveryone at the company, from their first day.\n\n'
    '## What you need to do\n- Read it once now\n- Ask HR if anything is unclear\n- Acknowledge it in the app';

PolicyDocument _p(String key, String title, {required int version, required int minutes, bool req = true, int? acked, String note = ''}) => PolicyDocument(
  key: key,
  title: title,
  body: _body,
  version: version,
  readMinutes: minutes,
  ackRequired: req,
  changeNote: note,
  textUpdatedAt: note.isEmpty ? null : DateTime(2027, 1, 2),
  acknowledgedVersion: acked,
  acknowledgedAt: acked == null ? null : DateTime(2026, 12, 15),
);

/// "new joiner": three to acknowledge, two to read.
List<PolicyDocument> _joinerPolicies() => [
  _p('conduct', 'Code of conduct', version: 2, minutes: 6),
  _p('leave', 'Leave policy', version: 2, minutes: 4),
  _p('hours', 'Working hours and attendance', version: 1, minutes: 3),
  _p('travel', 'Travel and expenses', version: 1, minutes: 3, req: false),
  _p('devices', 'Using company devices', version: 2, minutes: 2, req: false),
];

/// "policy updated": HR changed the leave policy after she acknowledged it.
List<PolicyDocument> _updatedPolicies() => [
  _p('leave', 'Leave policy', version: 3, minutes: 4, acked: 2, note: 'Casual leave goes up from 6 to 8 days a year. Unused casual leave no longer carries over.'),
  _p('conduct', 'Code of conduct', version: 2, minutes: 6, acked: 2),
  _p('hours', 'Working hours and attendance', version: 1, minutes: 3, acked: 1),
  _p('travel', 'Travel and expenses', version: 1, minutes: 3, acked: 1),
  _p('devices', 'Using company devices', version: 2, minutes: 2, acked: 2),
];

class _Source implements PoliciesSource {
  _Source(this.list);
  final List<PolicyDocument> list;
  @override
  Future<List<PolicyDocument>?> cached() async => list;
  @override
  Future<List<PolicyDocument>> load() async => list;
  @override
  Future<List<PolicyDocument>> acknowledge(String key, int version) async => list;
}

const _balance = LeaveBalance(
  year: 2026,
  casual: LeaveBalanceItem(remaining: 6, total: 12),
  sick: LeaveBalanceItem(remaining: 4, total: 6),
  earned: LeaveBalanceItem(remaining: 12, total: 15),
);

final _facts = TourFacts(today: _today, managerName: 'Meera Iyer', casual: 6, sick: 4, earned: 12);

Future<void> _show(WidgetTester tester, Widget page) async {
  await tester.pumpWidget(MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: sowakaTheme(),
    builder: (context, child) => RepaintBoundary(key: _shotKey, child: child),
    home: page,
  ));
  await tester.pumpAndSettle();
}

Future<void> _shot(WidgetTester tester, String name) async {
  await tester.pumpAndSettle();
  await tester.runAsync(() async {
    final boundary = _shotKey.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    final image = await boundary.toImage(pixelRatio: _dpr);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();
    File('$_out/$name.png').writeAsBytesSync(bytes!.buffer.asUint8List());
  });
  // ignore: avoid_print
  print('shot $name');
}

void _screen(String name, Future<void> Function(WidgetTester tester) body) {
  testWidgets(name, skip: _skip != null, (tester) async {
    _phone(tester);
    addTearDown(tester.view.reset);
    await body(tester);
  });
}

Future<void> _loadFonts() async {
  Future<ByteData> file(String path) async => ByteData.sublistView(File(path).readAsBytesSync());
  for (final (family, path) in [
    ('Plus Jakarta Sans', 'assets/fonts/plus_jakarta_sans/PlusJakartaSans-Variable.ttf'),
    ('Sora', 'assets/fonts/sora/Sora-Variable.ttf'),
    ('Manrope', 'assets/fonts/manrope/Manrope-Variable.ttf'),
    ('Figtree', 'assets/fonts/figtree/Figtree-Variable.ttf'),
  ]) {
    await (FontLoader(family)..addFont(rootBundle.load(path))).load();
  }
  final flutterRoot = Platform.environment['FLUTTER_ROOT'] ?? '/opt/homebrew/share/flutter';
  final material = '$flutterRoot/bin/cache/artifacts/material_fonts';
  await (FontLoader('MaterialIcons')..addFont(file('$material/MaterialIcons-Regular.otf'))).load();
  final roboto = FontLoader('Roboto');
  for (final weight in ['Regular', 'Medium', 'Bold', 'Light']) {
    roboto.addFont(file('$material/Roboto-$weight.ttf'));
  }
  await roboto.load();
}

void main() {
  setUpAll(() async {
    if (_skip != null) return;
    Directory(_out).createSync(recursive: true);
    await _loadFonts();
  });

  // ── The Sowaka tour ──
  _screen('OnbTour', (tester) async {
    await _show(tester, OnbTourScreen(shell: _shell(), done: const ['punch'], managerName: 'Meera Iyer', leaveBalance: () async => _balance));
    await _shot(tester, 'OnbTour');
  });
  _screen('OnbTour-manager', (tester) async {
    await _show(tester, OnbTourScreen(shell: _shell(), done: const ['punch'], forManager: true, managerName: 'Meera Iyer', leaveBalance: () async => _balance));
    await _shot(tester, 'OnbTour-manager');
  });
  for (final lesson in [...joinerTourLessons, ...managerTourLessons]) {
    _screen('TourLesson-${lesson.key}', (tester) async {
      await _show(tester, TourLessonScreen(lesson: lesson, facts: _facts));
      await _shot(tester, 'TourLesson-${lesson.key}');
      for (var i = 1; i < lesson.steps.length; i++) {
        await tester.tap(find.byKey(const ValueKey('lesson-next')));
        await _shot(tester, 'TourLesson-${lesson.key}-step${i + 1}');
      }
    });
  }
  _screen('TourLessonDone', (tester) async {
    final lesson = joinerTourLessons[1];
    await _show(tester, TourLessonScreen(lesson: lesson, facts: _facts));
    for (var i = 0; i < lesson.steps.length; i++) {
      await tester.tap(find.byKey(const ValueKey('lesson-next')));
      await tester.pumpAndSettle();
    }
    await _shot(tester, 'TourLessonDone');
  });

  // ── Policies ──
  _screen('Policies', (tester) async {
    await _show(tester, PoliciesAckScreen(source: _Source(_joinerPolicies()), shell: _shell()));
    await _shot(tester, 'Policies');
  });
  _screen('PolicyRead', (tester) async {
    await _show(tester, PoliciesAckScreen(source: _Source(_joinerPolicies()), shell: _shell(), openKey: 'conduct'));
    await _shot(tester, 'PolicyRead');
    await tester.tap(find.byKey(const ValueKey('policy-agree')));
    await _shot(tester, 'PolicyRead-ticked');
  });
  _screen('PoliciesActions', (tester) async {
    await _show(tester, PoliciesAckScreen(source: _Source(_joinerPolicies()), shell: _shell()));
    await _shot(tester, 'PoliciesActions');
  });
  _screen('PoliciesUpdated', (tester) async {
    await _show(tester, PoliciesAckScreen(source: _Source(_updatedPolicies()), shell: _shell()));
    await _shot(tester, 'PoliciesUpdated');
  });
  _screen('PolicyUpdatedRead', (tester) async {
    await _show(tester, PoliciesAckScreen(source: _Source(_updatedPolicies()), shell: _shell(), openKey: 'leave'));
    await _shot(tester, 'PolicyUpdatedRead');
  });
  _screen('PolicyAcknowledged', (tester) async {
    await _show(tester, PoliciesAckScreen(source: _Source(_updatedPolicies()), shell: _shell(), openKey: 'conduct'));
    await _shot(tester, 'PolicyAcknowledged');
  });
}
