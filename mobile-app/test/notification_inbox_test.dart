// The Notifications screen (Sowaka Connect › Notifications, node 3875:84049):
// every scenario the server writes lands in one of four looks — amber alert,
// purple priority, green game challenge, white activity row — under Today
// (the last 48 hours) or Earlier, with the unread count, Mark all as read,
// and a tap that reads the row and goes where a push would.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/notifications/notification_badge.dart';
import 'package:mobile_app/features/notifications/notification_look.dart';
import 'package:mobile_app/features/notifications/presentation/notification_inbox_screen.dart';
import 'package:mobile_app/services/notification_service.dart';

const _session = AuthSession(
  token: 'token',
  user: AuthUser(
    id: 'u-asha',
    email: 'asha@getsowaka.com',
    name: 'Asha',
    role: 'employee',
    company: 'Sowaka',
    org: 'sowaka',
    enabledTabs: [],
    interests: [],
  ),
);

final _now = DateTime.utc(2026, 10, 15, 12);

Map<String, dynamic> _row(
  String id,
  String scenario,
  String title, {
  String body = '',
  Map<String, dynamic> data = const {},
  Duration age = const Duration(minutes: 5),
  bool read = false,
  bool resolved = false,
}) => {
  'id': id,
  'scenario': scenario,
  'title': title,
  'body': body,
  'data': data,
  'createdAt': _now.subtract(age).toIso8601String(),
  if (read) 'readAt': _now.toIso8601String(),
  if (resolved) 'resolved': true,
};

NotificationLook _look(
  String scenario,
  String title, {
  Map<String, dynamic> data = const {},
}) => NotificationLook.of(_row('x', scenario, title, data: data));

class _Server {
  _Server(this.items);
  final List<Map<String, dynamic>> items;
  final requests = <String>[];

  late final client = MockClient((request) async {
    requests.add('${request.method} ${request.url.path}');
    if (request.method == 'GET') {
      return http.Response.bytes(
        utf8.encode(jsonEncode({'success': true, 'notifications': items})),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    }
    return http.Response('{"success":true}', 200);
  });
}

Future<void> _pump(WidgetTester tester, _Server server) async {
  tester.view.physicalSize = const Size(1179, 6000);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  // Pushed over a home, as the bell does, so a tap can leave it.
  await tester.pumpWidget(
    MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => NotificationInboxScreen(
                  session: _session,
                  client: server.client,
                  now: () => _now,
                ),
              ),
            ),
            child: const Text('home'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('home'));
  await tester.pumpAndSettle();
}

Finder _unreadCount(String count) => find.descendant(
  of: find.byKey(const ValueKey('notifications-unread-count')),
  matching: find.text(count),
);

void main() {
  group('each scenario wears its board’s look', () {
    test('alerts are amber', () {
      for (final (scenario, title, label) in [
        ('punch_in_reminder', 'You haven’t punched in yet', 'ATTENDANCE ALERT'),
        (
          'punch_out_half_day',
          'Today counts as a half day',
          'ATTENDANCE ALERT',
        ),
        ('correction_decided', 'Attendance not changed', 'ATTENDANCE ALERT'),
        ('correction_decided', 'Punch not approved', 'ATTENDANCE ALERT'),
        ('feedback_last_day', 'Last day for October feedback', 'DUE TODAY'),
      ]) {
        final look = _look(scenario, title);
        expect(look.kind, NotificationKind.alert, reason: '$scenario $title');
        expect(look.label, label, reason: scenario);
      }
      expect(
        (_look('correction_decided', 'Punch not approved').glyph as IconGlyph)
            .icon,
        Icons.location_on_outlined,
      );
      expect(
        (_look('punch_in_reminder', '').glyph as AssetGlyph).asset,
        NotificationLook.alarmClock,
      );
    });

    test('priority items are purple, labelled by who and why', () {
      for (final (scenario, title, data, label) in [
        (
          'leave_decided',
          'Leave approved ✓',
          <String, dynamic>{},
          'FROM YOUR MANAGER',
        ),
        (
          'leave_decided',
          'Leave not approved',
          <String, dynamic>{},
          'FROM YOUR MANAGER',
        ),
        (
          'overtime_decided',
          'Overtime approved ✓',
          <String, dynamic>{},
          'FROM YOUR MANAGER',
        ),
        (
          'correction_decided',
          'Attendance fixed ✓',
          <String, dynamic>{},
          'FROM YOUR MANAGER',
        ),
        (
          'correction_decided',
          'Punch approved ✓',
          <String, dynamic>{},
          'FROM YOUR MANAGER',
        ),
        (
          'leave_decided',
          'Leave approved ✓',
          <String, dynamic>{'from': 'hr'},
          'FROM HR',
        ),
        (
          'feedback_shared',
          'Your manager shared your October feedback',
          <String, dynamic>{},
          'FROM YOUR MANAGER',
        ),
        (
          'pending_requests_reminder',
          '3 requests waiting on you',
          <String, dynamic>{},
          'NEEDS YOUR APPROVAL',
        ),
        (
          'leave_requested',
          'Bala · Casual leave',
          <String, dynamic>{},
          'NEEDS YOUR APPROVAL',
        ),
        (
          'feedback_cycle_open',
          'October feedback is open',
          <String, dynamic>{},
          'FEEDBACK CYCLE',
        ),
        (
          'feedback_weekly',
          'October feedback: 3 still to go',
          <String, dynamic>{},
          'FEEDBACK CYCLE',
        ),
        (
          'support_reply',
          'HR replied on your Payroll ticket',
          <String, dynamic>{},
          'SUPPORT DESK',
        ),
        (
          'post_published_new_post',
          'Must read from HR',
          {'postType': 'new_post', 'priority': 'must_read'},
          'MUST READ · FROM HR',
        ),
        (
          'post_published_new_post',
          'A must-read from Kritik',
          {'postType': 'new_post', 'priority': 'must_read'},
          'MUST READ · FROM LEADERSHIP',
        ),
        (
          'post_published_new_post',
          'Your manager recommends this',
          {'postType': 'new_post', 'priority': 'must_watch'},
          'MUST WATCH · FROM YOUR MANAGER',
        ),
        (
          'post_published_hr_announcement',
          'New announcement from HR',
          {'postType': 'hr_announcement', 'priority': 'normal'},
          'ANNOUNCEMENT · FROM HR',
        ),
        (
          'post_published_leadership',
          'An update from Kritik',
          {'postType': 'leadership', 'priority': 'normal'},
          'ANNOUNCEMENT · FROM LEADERSHIP',
        ),
        (
          'post_published_survey',
          'Your manager wants your opinion',
          {'postType': 'survey', 'priority': 'normal'},
          'POLL · FROM YOUR MANAGER',
        ),
        (
          'post_published_survey',
          'HR wants your opinion',
          {'postType': 'survey', 'priority': 'normal'},
          'POLL · FROM HR',
        ),
      ]) {
        final look = _look(scenario, title, data: data);
        expect(
          look.kind,
          NotificationKind.priority,
          reason: '$scenario $title',
        );
        expect(look.label, label, reason: '$scenario $title');
      }
      expect(
        (_look('leave_decided', 'Leave not approved').glyph as IconGlyph).icon,
        Icons.highlight_off_rounded,
      );
    });

    test('rows written before the spreadsheet keep their board colour', () {
      for (final (scenario, title, kind, label) in [
        (
          'pending_leave_reminder',
          'Leave approvals',
          NotificationKind.priority,
          'NEEDS YOUR APPROVAL',
        ),
        (
          'leave_decided',
          'Leave request declined',
          NotificationKind.priority,
          'FROM YOUR MANAGER',
        ),
        (
          'correction_decided',
          'Marked Present ✓',
          NotificationKind.priority,
          'FROM YOUR MANAGER',
        ),
        (
          'correction_decided',
          'Out of location request (Working from home) rejected',
          NotificationKind.alert,
          'ATTENDANCE ALERT',
        ),
        (
          'feedback_due',
          'Feedback due in 2 days',
          NotificationKind.priority,
          'FEEDBACK CYCLE',
        ),
        (
          'feedback_received',
          'Tanvi shared performance feedback with you',
          NotificationKind.priority,
          'FROM YOUR MANAGER',
        ),
        (
          'demo_leave_requested',
          'Leave request from Sneha Kulkarni',
          NotificationKind.priority,
          'NEEDS YOUR APPROVAL',
        ),
      ]) {
        final look = _look(scenario, title);
        expect(look.kind, kind, reason: '$scenario $title');
        expect(look.label, label, reason: '$scenario $title');
      }
      expect(
        (_look('leave_decided', 'Leave request declined').glyph as IconGlyph)
            .icon,
        Icons.highlight_off_rounded,
      );
      expect(
        (_look(
                  'correction_decided',
                  'Out of location request (Site survey) rejected',
                ).glyph
                as IconGlyph)
            .icon,
        Icons.location_on_outlined,
      );
    });

    test('things to play or answer are teal cards', () {
      for (final (scenario, title, label) in [
        (
          'game_challenge_received',
          'Rahul challenged you to Word Trip',
          'GAME CHALLENGE',
        ),
        ('scribble_invite', 'Rahul invited you to Scribble', 'GAME CHALLENGE'),
        (
          'game_challenge_accepted',
          'Asha accepted your challenge',
          'YOUR TURN',
        ),
        (
          'game_challenge_lobby',
          'Asha is waiting in the Word Trip lobby',
          'LOBBY',
        ),
        ('live_game_started', 'Live Word Trip starting now', 'LIVE NOW'),
      ]) {
        final look = _look(scenario, title);
        expect(look.kind, NotificationKind.game, reason: scenario);
        expect(look.label, label, reason: scenario);
        expect(look.palette, NotificationPalette.game);
      }
      final contest = _look(
        'post_published_caption_challenge',
        'New contest: Monday mood',
        data: {'postType': 'caption_challenge'},
      );
      expect(contest.kind, NotificationKind.game);
      expect(contest.label, 'NEW CONTEST');
    });

    test('results, votes and tags from games are white rows, teal disc', () {
      for (final (scenario, title, icon) in [
        (
          'game_challenge_result',
          'You beat Asha 420 to 380',
          Icons.emoji_events_outlined,
        ),
        ('contest_vote', 'Asha voted for your caption', Icons.edit_outlined),
        ('contest_vote', 'Rahul voted for your photo', Icons.image_outlined),
        (
          'most_likely_tagged',
          'Someone thinks you’re most likely to win a bake-off',
          Icons.star_border_rounded,
        ),
      ]) {
        final look = _look(scenario, title);
        expect(look.kind, NotificationKind.activity, reason: title);
        expect(look.disc, NotificationPalette.game.disc, reason: title);
        expect((look.glyph as IconGlyph).icon, icon, reason: title);
      }
    });

    test('everything else is a white activity row', () {
      for (final (scenario, title, data) in [
        (
          'post_published_kudos',
          'Neha gave you kudos 🎉',
          {'postType': 'kudos'},
        ),
        (
          'post_published_new_post',
          'Vikram tagged you in a post',
          {'postType': 'new_post'},
        ),
        (
          'post_published_new_post',
          'Ravi shared a post with you',
          {'postType': 'new_post'},
        ),
        ('post_published_new_post', 'New post', {'postType': 'new_post'}),
        ('post_published_survey', 'New poll from Bala', {'postType': 'survey'}),
        (
          'comment_mention',
          'Vikram mentioned you in a comment',
          <String, dynamic>{},
        ),
        (
          'post_commented',
          'Arjun and 3 others commented on your post',
          <String, dynamic>{},
        ),
        (
          'post_also_commented',
          'Asha and 2 others also commented',
          <String, dynamic>{},
        ),
        (
          'post_liked',
          'Neha and 11 others liked your post',
          <String, dynamic>{},
        ),
        ('poll_voted', '14 people voted on your poll', <String, dynamic>{}),
        (
          'card_wished_birthday',
          'Asha and 6 others wished you 🎂',
          <String, dynamic>{},
        ),
        ('new_joiner', 'Kavya joined your team today 👋', <String, dynamic>{}),
        ('leave_planning', 'Leave next week', <String, dynamic>{}),
        (
          'support_resolved',
          'Your Payroll ticket is resolved ✓',
          <String, dynamic>{},
        ),
        (
          'game_challenge_declined',
          'Rahul declined your challenge',
          <String, dynamic>{},
        ),
        ('leave_submitted', 'Leave request sent', <String, dynamic>{}),
      ]) {
        final look = _look(scenario, title, data: data);
        expect(
          look.kind,
          NotificationKind.activity,
          reason: '$scenario $title',
        );
        expect(look.label, isEmpty);
      }
      final comment = _look(
        'post_also_commented',
        'Manav Manager also commented',
      );
      expect(
        (comment.glyph as IconGlyph).icon,
        Icons.chat_bubble_outline_rounded,
      );
      expect(
        (_look('post_published_kudos', 'Neha gave you kudos 🎉').glyph
                as IconGlyph)
            .icon,
        Icons.star_border_rounded,
      );
    });
  });

  testWidgets('Today holds the last 48 hours, Earlier the rest', (
    tester,
  ) async {
    final server = _Server([
      _row(
        'a',
        'leave_decided',
        'Leave approved ✓',
        age: const Duration(hours: 1),
      ),
      _row(
        'b',
        'new_joiner',
        'Kavya joined your team today 👋',
        age: const Duration(hours: 47),
      ),
      _row(
        'c',
        'post_liked',
        'Neha liked your post',
        age: const Duration(hours: 49),
      ),
    ]);
    await _pump(tester, server);

    expect(find.text('TODAY'), findsOneWidget);
    expect(find.text('EARLIER'), findsOneWidget);
    final earlierY = tester.getTopLeft(find.text('EARLIER')).dy;
    expect(
      tester.getTopLeft(find.text('Leave approved ✓')).dy,
      lessThan(earlierY),
    );
    expect(
      tester.getTopLeft(find.text('Kavya joined your team today 👋')).dy,
      lessThan(earlierY),
    );
    expect(
      tester.getTopLeft(find.text('Neha liked your post')).dy,
      greaterThan(earlierY),
    );
    expect(find.text('FROM YOUR MANAGER'), findsOneWidget);
    expect(find.text('1h ago'), findsOneWidget);
    expect(find.text('2D ago'), findsOneWidget);
  });

  testWidgets(
    'the count is what still asks for attention; done rows lose their colour',
    (tester) async {
      final server = _Server([
        _row('a', 'punch_in_reminder', 'You haven’t punched in yet'),
        _row(
          'b',
          'game_challenge_received',
          'Rahul challenged you to Word Trip',
        ),
        _row(
          'c',
          'feedback_cycle_open',
          'October feedback is open',
          read: true,
        ),
        _row(
          'd',
          'pending_requests_reminder',
          '2 requests waiting on you',
          resolved: true,
        ),
      ]);
      await _pump(tester, server);

      expect(_unreadCount('2'), findsOneWidget);
      expect(find.text('ATTENDANCE ALERT'), findsOneWidget);
      expect(find.text('GAME CHALLENGE'), findsOneWidget);
      // Read, the priority card keeps its colour and label but loses its dot.
      expect(find.text('FEEDBACK CYCLE'), findsOneWidget);
      // Done with — nothing waits any more — it is a plain row.
      expect(find.text('NEEDS YOUR APPROVAL'), findsNothing);
      expect(find.text('2 requests waiting on you'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('notification-unread-dot')),
        findsNWidgets(2),
      );
    },
  );

  testWidgets('Mark all as read reads everything, here and on the server', (
    tester,
  ) async {
    final server = _Server([
      _row('a', 'punch_in_reminder', 'You haven’t punched in yet'),
      _row('b', 'post_liked', 'Neha liked your post'),
      _row('c', 'support_reply', 'HR replied on your Payroll ticket'),
    ]);
    await _pump(tester, server);
    expect(_unreadCount('3'), findsOneWidget);
    expect(NotificationBadge.hasNew.value, isTrue);

    await tester.tap(find.text('Mark all as read'));
    await tester.pumpAndSettle();

    expect(server.requests, contains('PATCH /notifications/read-all'));
    expect(
      find.byKey(const ValueKey('notifications-unread-count')),
      findsNothing,
    );
    expect(find.byKey(const ValueKey('notification-unread-dot')), findsNothing);
    expect(NotificationBadge.hasNew.value, isFalse);
    // The cards stay, without their borders and dots.
    expect(find.text('SUPPORT DESK'), findsOneWidget);
  });

  testWidgets(
    'a tap reads the row, leaves the inbox and goes where a push would',
    (tester) async {
      final data = {
        'destination': 'connect_post',
        'postId': 'p-1',
        'postType': 'kudos',
      };
      final server = _Server([
        _row(
          'n-7',
          'post_published_kudos',
          'Neha gave you kudos 🎉',
          body: 'Shipped it',
          data: data,
        ),
        _row(
          'n-8',
          'leave_decided',
          'Leave approved ✓',
          data: const {'type': 'leave', 'view': 'mine', 'requestId': 'r-1'},
        ),
      ]);
      final opened = <Map<String, dynamic>>[];
      final subscription = AppNotificationService.instance.opened.listen(
        opened.add,
      );
      addTearDown(subscription.cancel);
      await _pump(tester, server);

      await tester.tap(find.text('Neha gave you kudos 🎉'));
      await tester.pumpAndSettle();

      expect(server.requests, contains('PATCH /notifications/n-7/read'));
      expect(find.byType(NotificationInboxScreen), findsNothing);
      expect(opened.single, data);

      // A request decision carries no destination; it goes on as it came.
      await tester.tap(find.text('home'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Leave approved ✓'));
      await tester.pumpAndSettle();
      expect(server.requests, contains('PATCH /notifications/n-8/read'));
      expect(opened.last, {
        'type': 'leave',
        'view': 'mine',
        'requestId': 'r-1',
      });
      AppNotificationService.instance.pendingDestination = null;
    },
  );

  testWidgets('nothing to show says so', (tester) async {
    await _pump(tester, _Server([]));
    expect(find.text('Nothing yet'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('notifications-unread-count')),
      findsNothing,
    );
  });
}
