// The Sowaka tour over the real shell: Profile › Help's App tour card starts
// it, and it walks the app's own widgets (the bottom bar, the Connect
// composer, Teams' Requests and Feedback, the Actions home, the header photo,
// the Help card) to the finish card. Stops whose widget this fake company
// does not draw are left out rather than stalling the tour.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';
import 'package:mobile_app/features/app_tour/app_tour.dart';
import 'package:mobile_app/features/manager/bloc/manager_bloc.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';
import 'package:mobile_app/features/manager/presentation/manager_screen.dart';

import 'profile_settings_test.dart' show ok, phone, session;

void main() {
  testWidgets('Profile › Help starts the tour over the real tabs, to the finish card', (tester) async {
    phone(tester);
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/manager/workspace')) {
        return ok({
          'team': <dynamic>[],
          'recognitionCandidates': <dynamic>[],
          'nominations': <dynamic>[],
          'myParameters': <dynamic>[],
          'growthHistory': <dynamic>[],
          'holidays': <dynamic>[],
          'myOrgChart': <dynamic>[],
          'weekoffDays': [0],
          'shift': <String, dynamic>{},
          'hasManager': true,
          'teamLevel': 2,
        });
      }
      return ok({
        'leaves': <dynamic>[],
        'overtime': <dynamic>[],
        'regularizations': <dynamic>[],
        'claims': <dynamic>[],
        'types': <dynamic>[],
        'records': <dynamic>[],
        'balance': <String, dynamic>{},
      });
    });
    final bloc = ManagerBloc(
      session: session,
      service: ManagerApiService(session: session, baseUrl: 'https://example.test', client: client),
    );
    await bloc.add(const LoadManagerDashboard());
    await tester.pumpWidget(MaterialApp(home: ManagerScreen(session: session, bloc: bloc)));
    await tester.pumpAndSettle(const Duration(seconds: 1));

    // Profile › Help: the App tour card.
    await tester.tap(
      find.byWidgetPredicate((widget) => widget.runtimeType.toString() == '_ProfileAvatarAction').first,
    );
    await tester.pumpAndSettle();
    await tester.dragUntilVisible(find.text('Help'), find.text('Work detail'), const Offset(-200, 0));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Help'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('app-tour-help-card')), findsOneWidget);
    expect(find.text('Start the app tour'), findsOneWidget);

    Future<void> settle() async {
      for (var i = 0; i < 50; i++) {
        await tester.pump(const Duration(milliseconds: 60));
      }
    }

    // Straight to the first stop (no start card), the profile closed.
    await tester.tap(find.byKey(const ValueKey('app-tour-help-start')));
    await settle();
    expect(find.byKey(const ValueKey('app-tour-start-card')), findsNothing);
    final titles = <String>[];
    for (var guard = 0; guard < 20 && find.byKey(const ValueKey('app-tour-title')).evaluate().isNotEmpty; guard++) {
      titles.add(tester.widget<Text>(find.byKey(const ValueKey('app-tour-title'))).data!);
      await tester.tap(find.byKey(const ValueKey('app-tour-next')));
      await settle();
      // Teams › Requests' "Team Requests" header is wider than the phone in
      // the test font (its squares), not in the app's: that one is let by.
      final error = tester.takeException();
      if (error != null) {
        expect('$error', contains('overflowed'));
        expect(titles.last, 'Your teammates, all in one place');
      }
    }
    // The bar's tabs, Connect's composer, Teams' sections (a manager), the
    // Actions home, the header photo and the Help card are all this shell's own.
    // (Connect's composer is drawn once the feed has loaded, which this fake
    // server does not answer: that stop is left out here.)
    expect(titles, containsAllInOrder([
      'Connect, your company Instagram',
      'Your teammates, all in one place',
      'Your approvals inbox',
      'Monthly feedback',
      'Actions, your HR remote',
      'Swipe to punch in',
      'Your HR speed dial',
      'Your digital ID card',
      'A help desk in your pocket',
    ]));
    expect(find.text('You’re all set, Pankaj'), findsOneWidget);
    expect(find.byKey(const ValueKey('profile-screen')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('app-tour-explore')));
    await tester.pump(const Duration(milliseconds: 300));
    expect(AppTour.isRunning, isFalse);

    await tester.pumpWidget(const SizedBox.shrink());
    bloc.dispose();
    await tester.pump(const Duration(seconds: 30));
  });
}
