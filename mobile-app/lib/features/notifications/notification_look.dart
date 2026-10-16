import 'package:flutter/material.dart';

/// The four kinds of row the Notifications screen draws (Sowaka Connect ›
/// Notifications, node 3875:84049, and its four colour boards, which place
/// every row of Sowaka_notifications_final.xlsx):
///
/// * [alert] — amber. Something is wrong or due today; clears itself once
///   fixed (board 3865:83061).
/// * [priority] — purple. Something waiting on you or decided about you;
///   tap opens the screen to act (board 3865:83067).
/// * [game] — teal. Things to play or answer: challenges, lobbies, live
///   games, new contests. Results, votes and tags from games are white rows
///   with a teal disc.
/// * [activity] — a plain white row. Things that happened to you
///   (board 3863:83058).
enum NotificationKind { alert, priority, game, activity }

/// What sits in a row's 40px disc: one of the design's own assets, an emoji
/// as the screen draws one, a line icon from the boards, or the initial of
/// the person who did it.
sealed class NotificationGlyph {
  const NotificationGlyph();
}

class AssetGlyph extends NotificationGlyph {
  const AssetGlyph(this.asset, this.size);
  final String asset;
  final double size;
  bool get isSvg => asset.endsWith('.svg');
}

class EmojiGlyph extends NotificationGlyph {
  const EmojiGlyph(this.emoji);
  final String emoji;
}

class IconGlyph extends NotificationGlyph {
  const IconGlyph(this.icon, this.color);
  final IconData icon;
  final Color color;
}

class InitialGlyph extends NotificationGlyph {
  const InitialGlyph(this.name);
  final String name;
}

/// The colours of each kind, measured off the colour boards (3865:83061
/// alerts, games, 3865:83067 priority).
class NotificationPalette {
  const NotificationPalette({
    required this.background,
    required this.border,
    required this.label,
    required this.dot,
    required this.disc,
  });

  /// The card's fill.
  final Color background;

  /// The card's outline while it is unread.
  final Color border;

  /// The small capitals over the title.
  final Color label;

  /// The unread dot.
  final Color dot;

  /// The avatar disc behind the glyph.
  final Color disc;

  /// The orange dot on alerts and on every white row.
  static const unreadOrange = Color(0xFFDB6C2F);

  static const alert = NotificationPalette(
    background: Color(0xFFFEF7ED),
    border: Color(0xFFF3E3CC),
    label: Color(0xFF8F4420),
    dot: unreadOrange,
    disc: Color(0xFFF9E8D2),
  );
  static const game = NotificationPalette(
    background: Color(0xFFE9F6F3),
    border: Color(0xFFD3EBE6),
    label: Color(0xFF3E897A),
    dot: Color(0xFF3E897A),
    disc: Color(0xFFD3EBE6),
  );
  static const priority = NotificationPalette(
    background: Color(0xFFF0EDFB),
    border: Color(0xFFE2DCF6),
    label: Color(0xFF4B3C9F),
    dot: Color(0xFF4432A9),
    disc: Color(0xFFDED9F1),
  );

  /// White rows: no fill, the orange unread dot.
  static const activity = NotificationPalette(
    background: Colors.white,
    border: Colors.transparent,
    label: Color(0xFF6B7280),
    dot: unreadOrange,
    disc: Color(0xFFF3F4F6),
  );

  static NotificationPalette of(NotificationKind kind) => switch (kind) {
    NotificationKind.alert => alert,
    NotificationKind.priority => priority,
    NotificationKind.game => game,
    NotificationKind.activity => activity,
  };
}

/// How one inbox row looks: its kind, the small capitals over the title, and
/// its glyph on its disc. Worked out here from `scenario`, `title` and `data`
/// as the server writes them today, so rows already in people's inboxes read
/// the same as new ones.
class NotificationLook {
  const NotificationLook({
    required this.kind,
    required this.label,
    required this.glyph,
    required this.disc,
  });

  final NotificationKind kind;

  /// "ATTENDANCE ALERT", "PRIORITY · FROM MANAGER". Empty on white rows.
  final String label;
  final NotificationGlyph glyph;
  final Color disc;

  NotificationPalette get palette => NotificationPalette.of(kind);

  // The boards' icon tints, one per colour family.
  static const _amberInk = Color(0xFF8A5A12);
  static const _amberDisc = Color(0xFFFCF3E4);
  static const _blueInk = Color(0xFF2B4FA3);
  static const _blueDisc = Color(0xFFE7F1FB);
  static const _redInk = Color(0xFFA3263F);
  static const _redDisc = Color(0xFFFCECEC);
  static const _purpleInk = Color(0xFF5B3CC4);
  static const _purpleDisc = Color(0xFFF0ECFA);
  static const _greenInk = Color(0xFF2E7D4A);
  static const _greenDisc = Color(0xFFE8F3EB);
  static const _alertInk = Color(0xFF8F4420);
  static const _priorityInk = Color(0xFF4B3C9F);
  static const _gameInk = Color(0xFF3E897A);
  static const _gameDisc = Color(0xFFD3EBE6);

  static const alarmClock = 'assets/icons/attendance_review_clock.png';
  static const gameDie = 'assets/icons/notification_game_die.svg';

  static const _fromManager = 'FROM YOUR MANAGER';

  /// Scenarios the server wrote before the notifications spreadsheet (and
  /// the demo rows), read as the one that took their place, so a row already
  /// in someone's inbox wears the same colour as a new one.
  static const _formerly = {
    'pending_leave_reminder': 'pending_requests_reminder',
    'feedback_due': 'feedback_weekly',
    'feedback_received': 'feedback_shared',
    'feedback_submitted': 'leave_submitted',
    'comment_liked': 'post_liked',
    'support_ticket_new': 'support_staff',
    'support_employee_reply': 'support_staff',
    'attendance_summary': 'weekly_attendance_report',
    'birthday': 'post_published_birthday',
    'demo_leave_requested': 'leave_requested',
    'demo_leave_approved': 'leave_decided',
    'demo_leave_declined': 'leave_decided',
    'demo_leave_submitted': 'leave_submitted',
    'demo_ot_requested': 'overtime_requested',
    'demo_ot_approved': 'overtime_decided',
    'demo_ot_declined': 'overtime_decided',
    'demo_ot_submitted': 'overtime_submitted',
    'demo_present_requested': 'correction_requested',
    'demo_present_approved': 'correction_decided',
    'demo_present_declined': 'correction_decided',
    'demo_present_submitted': 'correction_submitted',
    'demo_punch_in': 'punch_in',
    'demo_punch_out': 'punch_out',
    'demo_punch_out_half': 'punch_out_half_day',
    'demo_post_commented': 'post_commented',
    'demo_post_liked': 'post_liked',
    'demo_poll_voted': 'poll_voted',
    'demo_birthday': 'post_published_birthday',
    'demo_anniversary': 'post_published_anniversary',
    'demo_post_leadership': 'post_published_leadership',
  };

  static NotificationLook of(Map<String, dynamic> item) {
    final written = '${item['scenario'] ?? ''}';
    final scenario = _formerly[written] ?? written;
    final title = '${item['title'] ?? ''}';
    final data = item['data'] is Map
        ? Map<String, dynamic>.from(item['data'] as Map)
        : const <String, dynamic>{};
    // Decisions carry no outcome of their own; their titles are fixed copy
    // ("Leave approved ✓" / "Leave not approved", "Attendance fixed ✓" /
    // "Attendance not changed"; before that "Leave request declined",
    // "Out of location request (…) rejected").
    final declined =
        title.contains('not approved') ||
        title.contains('not changed') ||
        title.contains('declined') ||
        title.contains('rejected');
    final punch =
        title.startsWith('Punch') || title.startsWith('Out of location');
    // Decisions say who made them; HR can decide in a manager's place.
    final from = data['from'] == 'hr' ? 'FROM HR' : _fromManager;

    switch (scenario) {
      case 'punch_in_reminder':
      case 'punch_out_half_day':
        return _alert('ATTENDANCE ALERT', const AssetGlyph(alarmClock, 30));
      case 'feedback_last_day':
        return _alert('DUE TODAY', const AssetGlyph(alarmClock, 30));
      case 'feedback_overdue':
        return _alert('FEEDBACK OVERDUE', const AssetGlyph(alarmClock, 30));
      case 'correction_decided':
        final icon = punch
            ? Icons.location_on_outlined
            : declined
            ? Icons.highlight_off_rounded
            : Icons.check_circle_outline_rounded;
        return declined
            ? _alert('ATTENDANCE ALERT', IconGlyph(icon, _alertInk))
            : _priority(from, icon);
      case 'leave_decided':
        return _priority(
          from,
          declined ? Icons.highlight_off_rounded : Icons.how_to_reg_outlined,
        );
      case 'overtime_decided':
        return _priority(
          from,
          declined ? Icons.highlight_off_rounded : Icons.schedule_rounded,
        );
      case 'feedback_shared':
        return _priority(_fromManager, Icons.chat_bubble_outline_rounded);
      case 'pending_requests_reminder':
      case 'leave_requested':
      case 'overtime_requested':
      case 'correction_requested':
        return _priority(
          'NEEDS YOUR APPROVAL',
          Icons.assignment_turned_in_outlined,
        );
      case 'feedback_cycle_open':
      case 'feedback_weekly':
        return _priority('FEEDBACK CYCLE', Icons.chat_bubble_outline_rounded);
      case 'support_reply':
        return _priority('SUPPORT DESK', Icons.headset_mic_outlined);
      case 'game_challenge_received':
      case 'scribble_invite':
        return _game('GAME CHALLENGE', Icons.sports_esports_outlined);
      case 'game_challenge_accepted':
        return _game('YOUR TURN', Icons.play_arrow_outlined);
      case 'game_challenge_lobby':
        return _game('LOBBY', Icons.sensor_door_outlined);
      case 'live_game_started':
        return _game('LIVE NOW', Icons.sports_esports_outlined);
      // What games tell you afterwards: white rows on a teal disc.
      case 'game_challenge_result':
        return _played(Icons.emoji_events_outlined);
      case 'contest_vote':
        return _played(
          title.contains('your photo')
              ? Icons.image_outlined
              : Icons.edit_outlined,
        );
      case 'most_likely_tagged':
        return _played(Icons.star_border_rounded);
      // "Secret Squad starts in 3 minutes": an office's lobby is open.
      case 'secret_squad_lobby':
        return secretSquad;
      case 'game_challenge_declined':
      case 'game_challenge_withdrawn':
      case 'game_challenge_cancelled':
        return const NotificationLook(
          kind: NotificationKind.activity,
          label: '',
          glyph: AssetGlyph(gameDie, 20),
          disc: _gameDisc,
        );
      case 'support_staff':
        return _activity(Icons.headset_mic_outlined, _blueInk, _blueDisc);
      case 'weekly_attendance_report':
        return _activity(Icons.insert_chart_outlined, _greenInk, _greenDisc);
      case 'nomination_received':
        return _activity(Icons.star_border_rounded, _amberInk, _amberDisc);
      case 'support_resolved':
        return _activity(
          Icons.check_circle_outline_rounded,
          _greenInk,
          _greenDisc,
        );
      case 'leave_planning':
        return _activity(Icons.calendar_today_outlined, _greenInk, _greenDisc);
      case 'new_joiner':
        return _activity(Icons.person_add_alt_outlined, _blueInk, _blueDisc);
      case 'comment_mention':
      case 'post_commented':
      case 'post_also_commented':
      case 'post_commented_inbox':
        return _activity(
          Icons.chat_bubble_outline_rounded,
          _blueInk,
          _blueDisc,
        );
      case 'post_liked':
      case 'post_liked_inbox':
        return _activity(Icons.favorite_border_rounded, _redInk, _redDisc);
      case 'poll_voted':
      case 'poll_voted_inbox':
        return _activity(Icons.bar_chart_rounded, _amberInk, _amberDisc);
      case 'card_wished_birthday':
      case 'card_wished_anniversary':
        return _activity(Icons.cake_outlined, _redInk, _redDisc);
      case 'leave_submitted':
      case 'overtime_submitted':
      case 'correction_submitted':
        return _activity(Icons.schedule_send_outlined, _blueInk, _blueDisc);
      case 'punch_in':
      case 'punch_out':
        return _activity(Icons.fingerprint_rounded, _greenInk, _greenDisc);
    }
    // Anything else Secret Squad sends reads as the game too.
    if (scenario.startsWith('secret_squad')) return secretSquad;
    if (scenario.startsWith('post_published_')) {
      final type = '${data['postType'] ?? ''}'.isNotEmpty
          ? '${data['postType']}'
          : scenario.substring('post_published_'.length);
      return _post(type, '${data['priority'] ?? ''}', title);
    }
    return _activity(
      Icons.notifications_none_rounded,
      const Color(0xFF6B7280),
      const Color(0xFFF3F4F6),
    );
  }

  /// A new post: what it is to this reader, from the copy they were sent
  /// (who it is from depends on the reader, so it lives in the title).
  static NotificationLook _post(String type, String priority, String title) {
    // A Secret Squad session announced on the feed.
    if (type == 'secret_squad') return secretSquad;
    if (type == 'caption_challenge' ||
        type == 'photo_story_challenge' ||
        type == 'photo_challenge' ||
        type == 'most_likely') {
      return _game('NEW CONTEST', Icons.image_outlined);
    }
    if (title.contains(' gave you kudos')) {
      return _activity(Icons.star_border_rounded, _amberInk, _amberDisc);
    }
    if (title.endsWith(' tagged you in a post')) {
      return _activity(Icons.sell_outlined, _blueInk, _blueDisc);
    }
    if (title.endsWith(' shared a post with you')) {
      return _activity(Icons.lock_outline_rounded, _purpleInk, _purpleDisc);
    }
    if (priority == 'must_read') {
      return _priority(
        _from('MUST READ', switch (title) {
          'Must read from HR' => 'HR',
          'Your manager recommends this' => 'YOUR MANAGER',
          _ when title.startsWith('A must-read from ') => 'LEADERSHIP',
          _ => '',
        }),
        Icons.campaign_outlined,
      );
    }
    if (priority == 'must_watch') {
      return _priority(
        _from('MUST WATCH', switch (title) {
          'Must watch from HR' => 'HR',
          'Your manager recommends this' => 'YOUR MANAGER',
          _ when title.endsWith(' recommends watching this') => 'LEADERSHIP',
          _ => '',
        }),
        Icons.videocam_outlined,
      );
    }
    if (title == 'New announcement from HR') {
      return _priority('ANNOUNCEMENT · FROM HR', Icons.campaign_outlined);
    }
    if (title.startsWith('An update from ')) {
      return _priority(
        'ANNOUNCEMENT · FROM LEADERSHIP',
        Icons.campaign_outlined,
      );
    }
    if (title == 'HR wants your opinion') {
      return _priority('POLL · FROM HR', Icons.bar_chart_rounded);
    }
    if (title == 'Your manager wants your opinion') {
      return _priority('POLL · FROM YOUR MANAGER', Icons.bar_chart_rounded);
    }
    if (type == 'survey' && title.endsWith(' wants your take')) {
      return _priority('POLL · FROM LEADERSHIP', Icons.bar_chart_rounded);
    }
    return switch (type) {
      'birthday' => _activity(Icons.cake_outlined, _redInk, _redDisc),
      'anniversary' => _activity(Icons.celebration_outlined, _redInk, _redDisc),
      'kudos' => _activity(Icons.star_border_rounded, _amberInk, _amberDisc),
      'survey' => _activity(Icons.bar_chart_rounded, _amberInk, _amberDisc),
      _ => _activity(Icons.article_outlined, _blueInk, _blueDisc),
    };
  }

  static String _from(String what, String who) =>
      who.isEmpty ? what : '$what · FROM $who';

  /// "Rahul and 3 others commented on your post" → "Rahul".
  static String actorOf(String title) {
    var end = title.length;
    for (final cut in const [
      ' and ',
      ' also commented',
      ' commented',
      ' mentioned',
      ' liked',
    ]) {
      final at = title.indexOf(cut);
      if (at > 0 && at < end) end = at;
    }
    return title.substring(0, end);
  }

  static NotificationLook _alert(String label, NotificationGlyph glyph) =>
      NotificationLook(
        kind: NotificationKind.alert,
        label: label,
        glyph: glyph,
        disc: NotificationPalette.alert.disc,
      );

  static NotificationLook _priority(String label, IconData icon) =>
      NotificationLook(
        kind: NotificationKind.priority,
        label: label,
        glyph: IconGlyph(icon, _priorityInk),
        disc: NotificationPalette.priority.disc,
      );

  /// Secret Squad's rows: a green GAME card with its top-secret envelope.
  static const secretSquad = NotificationLook(
    kind: NotificationKind.game,
    label: 'SECRET SQUAD',
    glyph: IconGlyph(Icons.drafts_outlined, _gameInk),
    disc: _gameDisc,
  );

  static NotificationLook _game(String label, IconData icon) =>
      NotificationLook(
        kind: NotificationKind.game,
        label: label,
        glyph: IconGlyph(icon, _gameInk),
        disc: _gameDisc,
      );

  /// A game's result, a vote on your entry, a tag: a white row, teal disc.
  static NotificationLook _played(IconData icon) =>
      _activity(icon, _gameInk, _gameDisc);

  static NotificationLook _activity(IconData icon, Color ink, Color disc) =>
      NotificationLook(
        kind: NotificationKind.activity,
        label: '',
        glyph: IconGlyph(icon, ink),
        disc: disc,
      );
}
