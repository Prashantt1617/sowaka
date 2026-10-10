import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:http/http.dart' as http;

import '../../../services/api_config.dart';
import '../../../services/notification_service.dart';
import '../../auth/data/auth_models.dart';
import '../../manager/presentation/manager_screen.dart';
import '../../manager_shell/presentation/app_home_header.dart';
import '../../profile/presentation/profile_style.dart';
import '../notification_badge.dart';

/// Everything the app has told this person, newest first. A tap marks the
/// notification read and takes them to what it is about — the post, the
/// request, the review — through the same door a push notification uses.
bool _inboxOpening = false;

/// Opens the inbox from a bell. Taps while it is opening or already open do
/// nothing, so a quick double tap can't stack copies of it.
Future<void> openNotificationInbox(
  BuildContext context,
  AuthSession session,
) async {
  if (_inboxOpening) return;
  _inboxOpening = true;
  // Looked at: the bell's dot goes until something new arrives.
  unawaited(NotificationBadge.markSeen(session.user.id));
  try {
    await AppNotificationService.instance.requestPermission();
    if (!context.mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => NotificationInboxScreen(session: session),
      ),
    );
  } finally {
    _inboxOpening = false;
  }
}

class NotificationInboxScreen extends StatefulWidget {
  const NotificationInboxScreen({super.key, required this.session, this.client});
  final AuthSession session;

  /// Supplied only by tests; the app talks to the network.
  final http.Client? client;

  @override
  State<NotificationInboxScreen> createState() =>
      _NotificationInboxScreenState();
}

/// The kinds the filter chips sort notifications into (node 2303:54424).
enum _Kind { social, people, announcements, requests, recognition }

const _kindLabels = {
  _Kind.social: 'Social',
  _Kind.people: 'People',
  _Kind.announcements: 'Announcements',
  _Kind.requests: 'Requests',
  _Kind.recognition: 'Recognition',
};

/// One notification as the inbox reads it.
class _Item {
  _Item(this.json)
    : scenario = '${json['scenario'] ?? ''}',
      title = '${json['title'] ?? ''}',
      body = '${json['body'] ?? ''}',
      when = DateTime.tryParse('${json['createdAt'] ?? ''}')?.toLocal(),
      data = Map<String, dynamic>.from(json['data'] as Map? ?? const {});

  final Map<String, dynamic> json;
  final String scenario;
  final String title;
  final String body;
  final DateTime? when;
  final Map<String, dynamic> data;

  bool read = false;
  bool get unread => json['readAt'] == null && !read;
  String get id => '${json['id']}';

  /// A comment on the reader's own birthday or anniversary card: a wish, and
  /// gathered with the others under "Wishes Flowing" (node 3561:48559).
  String? get wishKind {
    if (scenario != 'post_commented') return null;
    if (title.contains('wished you a happy birthday')) return 'birthday';
    if (title.contains('congratulated you on your work anniversary')) {
      return 'anniversary';
    }
    return null;
  }

  /// Who it is from, when the title starts with a name.
  String get actor {
    for (final verb in const [
      ' wished you',
      ' congratulated you',
      ' commented',
      ' replied',
      ' liked',
      ' mentioned',
      ' voted',
      ' joined',
      ' shared',
      ' posted',
    ]) {
      final at = title.indexOf(verb);
      if (at > 0) return title.substring(0, at);
    }
    final dot = title.indexOf(' · ');
    if (dot > 0) return title.substring(dot + 3);
    return title;
  }

  String get postType => scenario.startsWith('post_published_')
      ? scenario.substring('post_published_'.length)
      : '${data['postType'] ?? ''}';

  _Kind get kind {
    if (scenario.startsWith('leave') ||
        scenario.startsWith('overtime') ||
        scenario.startsWith('correction') ||
        scenario.startsWith('punch') ||
        scenario.contains('attendance') ||
        scenario.contains('reimbursement') ||
        scenario == 'pending_leave_reminder' ||
        data['destination'] == 'manage_leave') {
      return _Kind.requests;
    }
    if (scenario.startsWith('nomination') ||
        scenario.startsWith('feedback') ||
        postType == 'award' ||
        postType == 'kudos') {
      return _Kind.recognition;
    }
    if (postType == 'hr_announcement' ||
        postType == 'leadership' ||
        data['priority'] == 'must_read') {
      return _Kind.announcements;
    }
    if (wishKind != null ||
        scenario == 'new_joiner' ||
        const ['birthday', 'anniversary', 'new_joinee'].contains(postType)) {
      return _Kind.people;
    }
    return _Kind.social;
  }
}

class _NotificationInboxScreenState extends State<NotificationInboxScreen> {
  late final http.Client _client = widget.client ?? http.Client();
  late Future<List<_Item>> _items = _load();
  bool _unreadOnly = false;
  _Kind? _kind;

  Map<String, String> get headers => {
    'Authorization': 'Bearer ${widget.session.token}',
    'Content-Type': 'application/json',
  };

  Future<List<_Item>> _load() async {
    final response = await _client.get(
      Uri.parse('${ApiConfig.baseUrl}/notifications'),
      headers: headers,
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Could not load notifications');
    }
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    return (json['notifications'] as List<dynamic>? ?? const [])
        .map((item) => _Item(Map<String, dynamic>.from(item as Map)))
        .toList();
  }

  Future<void> _refresh() {
    final next = _load();
    setState(() => _items = next);
    return next.then((_) {}, onError: (_) {});
  }

  void _markRead(_Item item) => unawaited(
    _client
        .patch(
          Uri.parse('${ApiConfig.baseUrl}/notifications/${item.id}/read'),
          headers: headers,
        )
        .then((_) {}, onError: (_) {}),
  );

  Future<void> _open(_Item item) async {
    // Marked read in the background: the person is already on their way.
    _markRead(item);
    if (!mounted) return;
    Navigator.pop(context);
    AppNotificationService.instance.openDestination(item.data);
  }

  /// Every unread one marked read, here at once and on the server behind it.
  /// There is no single call for it, so it is one per notification.
  Future<void> _markAllRead(List<_Item> items) async {
    final unread = items.where((item) => item.unread).toList();
    if (unread.isEmpty) return;
    setState(() {
      for (final item in unread) {
        item.read = true;
      }
    });
    for (final item in unread) {
      _markRead(item);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = widget.session.user;
    return Scaffold(
      backgroundColor: const Color(0xFFF7F7F9),
      body: FutureBuilder<List<_Item>>(
        future: _items,
        builder: (context, snapshot) {
          final items = snapshot.data ?? const <_Item>[];
          final unreadCount = items.where((item) => item.unread).length;
          return Column(
            children: [
              AppHomeHeader(
                profileAction: GestureDetector(
                  onTap: () => Navigator.of(context).pop(),
                  child: ProfilePhoto(
                    name: user.name,
                    url: user.profilePhotoUrl,
                    size: 30,
                  ),
                ),
                // Already here.
                onNotifications: () {},
              ),
              _InboxTopBar(
                unread: unreadCount,
                onBack: () => Navigator.of(context).pop(),
                onMarkAllRead: unreadCount == 0
                    ? null
                    : () => _markAllRead(items),
              ),
              Expanded(child: _body(snapshot, items)),
            ],
          );
        },
      ),
    );
  }

  Widget _body(AsyncSnapshot<List<_Item>> snapshot, List<_Item> items) {
    if (snapshot.hasError) {
      return _InboxMessage(
        icon: Icons.cloud_off_rounded,
        title: 'Could not load notifications',
        body: 'Pull down to try again.',
        onRetry: _refresh,
      );
    }
    if (!snapshot.hasData) {
      return const Center(child: CircularProgressIndicator(color: MColors.terra));
    }
    final shown = items
        .where((item) => !_unreadOnly || item.unread)
        .where((item) => _kind == null || item.kind == _kind)
        .toList();
    final sections = _sections(shown);
    return RefreshIndicator(
      color: MColors.terra,
      onRefresh: _refresh,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: EdgeInsets.zero,
        children: [
          _Filters(
            unreadOnly: _unreadOnly,
            kind: _kind,
            onUnreadOnly: (value) => setState(() => _unreadOnly = value),
            onKind: (kind) => setState(() => _kind = kind),
          ),
          Container(
            constraints: BoxConstraints(
              minHeight: MediaQuery.sizeOf(context).height * .5,
            ),
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
            decoration: const BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (shown.isEmpty)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 48, 16, 0),
                    child: Text(
                      items.isEmpty
                          ? 'Nothing yet. Requests, reviews and posts that '
                                'need you will show up here.'
                          : 'Nothing here under this filter.',
                      textAlign: TextAlign.center,
                      style: ProfileStyle.sora(
                        13,
                        color: ProfileStyle.muted,
                        height: 19.5,
                      ),
                    ),
                  ),
                for (final (label, list) in sections) ...[
                  _SectionLabel(label),
                  ..._sectionChildren(list),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// A day's notifications, with the wishes on one's own card gathered into a
  /// card of their own at the top of the day they came.
  List<Widget> _sectionChildren(List<_Item> list) {
    final wishes = <String, List<_Item>>{};
    final rest = <_Item>[];
    for (final item in list) {
      final kind = item.wishKind;
      if (kind == null) {
        rest.add(item);
      } else {
        (wishes[kind] ??= []).add(item);
      }
    }
    return [
      for (final MapEntry(key: kind, value: group) in wishes.entries)
        Padding(
          padding: const EdgeInsets.only(bottom: 16),
          child: _WishesCard(kind: kind, wishes: group, onOpen: _open),
        ),
      for (final (index, item) in rest.indexed)
        _NotificationRow(
          item: item,
          divider: index < rest.length - 1,
          onTap: () => _open(item),
        ),
    ];
  }

  /// Today, Yesterday, Earlier — newest first within each.
  static List<(String, List<_Item>)> _sections(List<_Item> items) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final yesterday = today.subtract(const Duration(days: 1));
    final groups = <String, List<_Item>>{
      'Today': [],
      'Yesterday': [],
      'Earlier': [],
    };
    for (final item in items) {
      final when = item.when;
      final day = when == null ? null : DateTime(when.year, when.month, when.day);
      final key = day == today
          ? 'Today'
          : day == yesterday
          ? 'Yesterday'
          : 'Earlier';
      groups[key]!.add(item);
    }
    return [
      for (final MapEntry(:key, :value) in groups.entries)
        if (value.isNotEmpty) (key, value),
    ];
  }
}

/// The bar under the app header (node 2303:54399): back, the title with how
/// many are unread, and "Mark all as read".
class _InboxTopBar extends StatelessWidget {
  const _InboxTopBar({
    required this.unread,
    required this.onBack,
    required this.onMarkAllRead,
  });

  final int unread;
  final VoidCallback onBack;
  final VoidCallback? onMarkAllRead;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 60,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(
          bottom: BorderSide(color: Color(0xFFF3F4F6), width: 1.114),
        ),
      ),
      child: Row(
        children: [
          Material(
            color: const Color(0xFFF7F7F9),
            shape: const CircleBorder(),
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: onBack,
              child: SizedBox(
                width: 36,
                height: 36,
                child: Center(
                  child: SvgPicture.asset(
                    'assets/icons/chevron_left_small.svg',
                    width: 18,
                    height: 18,
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(width: 10),
          Text(
            'Notifications',
            style: ProfileStyle.sora(
              16,
              weight: FontWeight.w700,
              height: 24,
              spacing: -0.2,
            ),
          ),
          if (unread > 0) ...[
            const SizedBox(width: 8),
            Container(
              height: 20,
              constraints: const BoxConstraints(minWidth: 20),
              padding: const EdgeInsets.symmetric(horizontal: 6),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: ProfileStyle.brand,
                borderRadius: BorderRadius.circular(999),
              ),
              child: Text(
                unread > 99 ? '99+' : '$unread',
                style: ProfileStyle.sora(
                  10,
                  weight: FontWeight.w700,
                  color: Colors.white,
                  height: 10,
                ),
              ),
            ),
          ],
          const Spacer(),
          if (onMarkAllRead case final markAll?)
            GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: markAll,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text(
                  'Mark all as read',
                  style: ProfileStyle.sora(
                    12,
                    weight: FontWeight.w600,
                    color: ProfileStyle.brand,
                    height: 18,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// All · Unread, then the kinds (nodes 2303:54418, 2303:54424).
class _Filters extends StatelessWidget {
  const _Filters({
    required this.unreadOnly,
    required this.kind,
    required this.onUnreadOnly,
    required this.onKind,
  });

  final bool unreadOnly;
  final _Kind? kind;
  final ValueChanged<bool> onUnreadOnly;
  final ValueChanged<_Kind?> onKind;

  @override
  Widget build(BuildContext context) {
    Widget segment(String label, bool selected, VoidCallback onTap) => Expanded(
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 8),
          alignment: Alignment.center,
          decoration: selected
              ? BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(8),
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x1A000000),
                      blurRadius: 1.5,
                      offset: Offset(0, 1),
                    ),
                  ],
                )
              : null,
          child: Text(
            label,
            style: ProfileStyle.sora(
              12,
              weight: FontWeight.w700,
              color: selected ? ProfileStyle.brand : ProfileStyle.faint,
              height: 18,
            ),
          ),
        ),
      ),
    );
    Widget chip(String label, bool selected, VoidCallback onTap) => Padding(
      padding: const EdgeInsets.only(right: 8),
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: selected
              ? const EdgeInsets.symmetric(
                  horizontal: 12 + 1.129,
                  vertical: 6 + 1.129,
                )
              : const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: selected ? ProfileStyle.brand : Colors.white,
            borderRadius: BorderRadius.circular(999),
            border: selected
                ? null
                : Border.all(color: ProfileStyle.line, width: 1.129),
          ),
          child: Text(
            label,
            style: ProfileStyle.sora(
              12,
              weight: FontWeight.w600,
              color: selected ? Colors.white : ProfileStyle.muted,
              height: 18,
            ),
          ),
        ),
      ),
    );
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(
          bottom: BorderSide(color: Color(0xFFF3F4F6), width: 1.129),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Container(
              padding: const EdgeInsets.all(4),
              decoration: BoxDecoration(
                color: const Color(0xFFF3F4F6),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  segment('All', !unreadOnly, () => onUnreadOnly(false)),
                  const SizedBox(width: 4),
                  segment('Unread', unreadOnly, () => onUnreadOnly(true)),
                ],
              ),
            ),
          ),
          SizedBox(
            height: 56,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
              children: [
                chip('All', kind == null, () => onKind(null)),
                for (final entry in _kindLabels.entries)
                  chip(entry.value, kind == entry.key, () => onKind(entry.key)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
    child: Text(
      text.toUpperCase(),
      style: ProfileStyle.sora(
        11,
        weight: FontWeight.w600,
        color: ProfileStyle.faint,
        height: 16.5,
        spacing: 0.6,
      ),
    ),
  );
}

String _ago(DateTime? when) {
  if (when == null) return '';
  final gap = DateTime.now().difference(when);
  if (gap.inMinutes < 1) return 'Just now';
  if (gap.inMinutes < 60) return '${gap.inMinutes}m ago';
  if (gap.inHours < 24) return '${gap.inHours}h ago';
  if (gap.inDays < 7) return '${gap.inDays}d ago';
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return '${when.day} ${months[when.month - 1]}';
}

/// The avatar gradients the design gives people (node 2303:54466 and its
/// siblings), picked by name so someone keeps theirs.
const _personGradients = [
  [Color(0xFF0571A6), Color(0xFF38BDF8)],
  [Color(0xFF7C3AED), Color(0xFFA78BFA)],
  [Color(0xFF059669), Color(0xFF34D399)],
  [Color(0xFFD97706), Color(0xFFFBBF24)],
  [Color(0xFFDB2777), Color(0xFFF472B6)],
];

/// The wishes card's own run of discs (node 3561:48573): blue, mint with a
/// dark letter, violet.
const _wishGradients = [
  ([Color(0xFF0571A6), Color(0xFF38BDF8)], Colors.white),
  ([Color(0xFF43E97B), Color(0xFF38F9D7)], Color(0xFF222222)),
  ([Color(0xFF7C3AED), Color(0xFFA78BFA)], Colors.white),
];

class _PersonDisc extends StatelessWidget {
  const _PersonDisc({required this.name, this.fontSize = 15, this.wishIndex});

  final String name;
  final double fontSize;

  /// Where it falls in a wishes card, which colours it in turn.
  final int? wishIndex;

  @override
  Widget build(BuildContext context) {
    final wish = wishIndex == null
        ? null
        : _wishGradients[wishIndex! % _wishGradients.length];
    final colors =
        wish?.$1 ??
        _personGradients[name.hashCode.abs() % _personGradients.length];
    final initial = name.trim().isEmpty ? '?' : name.trim()[0].toUpperCase();
    return Container(
      width: 40,
      height: 40,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: colors,
        ),
      ),
      child: Text(
        initial,
        style: ProfileStyle.sora(
          fontSize,
          weight: wish == null ? FontWeight.w600 : FontWeight.w700,
          color: wish?.$2 ?? Colors.white,
        ),
      ),
    );
  }
}

/// What a notification wears on its left, and the button under it: an emoji
/// on a tint for what is about the company, the sender's initial for what a
/// person did (node 2303:54441).
class _Look {
  const _Look({this.emoji, this.tint, this.action, this.eyebrow});

  final String? emoji;
  final Color? tint;
  final String? action;

  /// A small coloured line above the title, for what must be read.
  final String? eyebrow;

  static _Look of(_Item item) {
    final type = item.postType;
    final first = item.actor.trim().split(' ').first;
    if (item.data['priority'] == 'must_read' || type == 'hr_announcement') {
      return const _Look(
        emoji: '📢',
        tint: Color(0xFFFEF3C7),
        action: 'View Announcement',
        eyebrow: '⚠ Important HR Update',
      );
    }
    switch (type) {
      case 'birthday':
        return _Look(
          emoji: '🎂',
          tint: const Color(0xFFFCE7F3),
          action: first.isEmpty ? 'Send wishes' : 'Wish $first',
        );
      case 'anniversary':
        return const _Look(
          emoji: '🎉',
          tint: Color(0xFFEDE9FE),
          action: 'Congratulate',
        );
      case 'new_joinee':
        return const _Look(action: 'Say Hi');
      case 'leadership':
        return const _Look(action: 'Read Post');
      case 'event':
        return const _Look(
          emoji: '📅',
          tint: Color(0xFFDBEAFE),
          action: 'View Event',
        );
      case 'award' || 'kudos':
        return const _Look(emoji: '🏆', tint: Color(0xFFFEF9C3));
    }
    if (item.scenario.startsWith('nomination')) {
      return const _Look(emoji: '🏆', tint: Color(0xFFFEF9C3));
    }
    if (item.scenario == 'post_liked' || item.scenario == 'comment_liked') {
      return const _Look(emoji: '❤️', tint: Color(0xFFFEE2E2));
    }
    if (item.scenario.endsWith('_requested') ||
        item.scenario == 'pending_leave_reminder') {
      return const _Look(action: 'View');
    }
    return const _Look();
  }
}

/// One notification (node 2303:54441): unread ones on a blue wash with a
/// dot, the time on the right, and the action it leads to.
class _NotificationRow extends StatelessWidget {
  const _NotificationRow({
    required this.item,
    required this.divider,
    required this.onTap,
  });

  final _Item item;
  final bool divider;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final look = _Look.of(item);
    final unread = item.unread;
    final status = switch (item.scenario) {
      final s when s.endsWith('_decided') => item.body,
      _ => null,
    };
    return Material(
      color: unread ? const Color(0xFFF0F8FF) : Colors.white,
      child: InkWell(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 14),
          decoration: BoxDecoration(
            border: divider
                ? const Border(
                    bottom: BorderSide(color: Color(0xFFF3F4F6), width: 1.129),
                  )
                : null,
          ),
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(left: 12, right: 12),
                    child: look.emoji == null
                        ? _PersonDisc(name: item.actor)
                        : Container(
                            width: 40,
                            height: 40,
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              color: look.tint,
                              shape: BoxShape.circle,
                            ),
                            child: Text(
                              look.emoji!,
                              style: const TextStyle(fontSize: 18, height: 1.5),
                            ),
                          ),
                  ),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.only(right: 12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (look.eyebrow case final eyebrow?)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 4),
                              child: Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                      eyebrow.toUpperCase(),
                                      style: ProfileStyle.sora(
                                        10,
                                        weight: FontWeight.w700,
                                        color: const Color(0xFFD97706),
                                        height: 15,
                                        spacing: 0.5,
                                      ),
                                    ),
                                  ),
                                  _Time(item.when),
                                ],
                              ),
                            ),
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Expanded(
                                child: Text(
                                  item.title,
                                  style: ProfileStyle.sora(
                                    13,
                                    weight: FontWeight.w700,
                                    color: unread
                                        ? ProfileStyle.inkStrong
                                        : const Color(0xFF374151),
                                    height: 17.55,
                                  ),
                                ),
                              ),
                              if (look.eyebrow == null)
                                Padding(
                                  padding: const EdgeInsets.only(left: 8, top: 1),
                                  child: _Time(item.when),
                                )
                              else
                                Padding(
                                  padding: const EdgeInsets.only(left: 8),
                                  child: SvgPicture.asset(
                                    'assets/icons/notification_row_chevron.svg',
                                    width: 16,
                                    height: 16,
                                  ),
                                ),
                            ],
                          ),
                          if (item.body.isNotEmpty && status == null)
                            Padding(
                              padding: const EdgeInsets.only(top: 2),
                              child: Text(
                                item.body,
                                style: ProfileStyle.sora(
                                  12,
                                  color: ProfileStyle.muted,
                                  height: 16.8,
                                ),
                              ),
                            ),
                          if (status != null)
                            Padding(
                              padding: const EdgeInsets.only(top: 8),
                              child: Text(
                                status,
                                style: ProfileStyle.sora(
                                  11,
                                  weight: FontWeight.w600,
                                  color: status.toLowerCase().contains('declin')
                                      ? ProfileStyle.red
                                      : const Color(0xFF16A34A),
                                  height: 16.5,
                                ),
                              ),
                            ),
                          if (look.action case final action?)
                            Padding(
                              padding: const EdgeInsets.only(top: 10),
                              child: GestureDetector(
                                onTap: onTap,
                                child: Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 15,
                                    vertical: 5,
                                  ),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFE8F4FC),
                                    borderRadius: BorderRadius.circular(999),
                                    border: Border.all(color: ProfileStyle.brand),
                                  ),
                                  child: Text(
                                    action,
                                    style: ProfileStyle.sora(
                                      12,
                                      weight: FontWeight.w600,
                                      color: ProfileStyle.brand,
                                      height: 18,
                                    ),
                                  ),
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
              if (unread)
                Positioned(
                  left: 13,
                  top: 4.64,
                  child: Container(
                    width: 7,
                    height: 7,
                    decoration: const BoxDecoration(
                      color: ProfileStyle.brand,
                      shape: BoxShape.circle,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Time extends StatelessWidget {
  const _Time(this.when);

  final DateTime? when;

  @override
  Widget build(BuildContext context) => Text(
    _ago(when),
    style: ProfileStyle.sora(11, color: ProfileStyle.faint, height: 16.5),
  );
}

/// Wishes on one's own birthday or anniversary card, gathered (node
/// 3561:48559): the bunting, then each wish and who sent it.
class _WishesCard extends StatelessWidget {
  const _WishesCard({
    required this.kind,
    required this.wishes,
    required this.onOpen,
  });

  final String kind;
  final List<_Item> wishes;
  final ValueChanged<_Item> onOpen;

  @override
  Widget build(BuildContext context) {
    final birthday = kind == 'birthday';
    final fresh = wishes.where((item) => item.unread).length;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFFCED9F),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 24,
                height: 24,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: const Color(0xFFFCE7F3),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: birthday
                    ? const Text('🎂', style: TextStyle(fontSize: 14, height: 1.5))
                    : SvgPicture.asset(
                        'assets/icons/notification_confetti_ball.svg',
                        width: 14,
                        height: 14,
                      ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  birthday ? 'Birthday wishes' : 'Anniversary wishes',
                  style: ProfileStyle.sora(
                    16,
                    weight: FontWeight.w700,
                    color: ProfileStyle.inkStrong,
                    height: 24,
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: const Color(0xFFE8F4FC),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  fresh > 0 ? '$fresh new' : '${wishes.length}',
                  style: ProfileStyle.sora(
                    11,
                    weight: FontWeight.w700,
                    color: ProfileStyle.brand,
                    height: 16.5,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          // The bunting and "Wishes Flowing", exported from the design as the
          // one illustration it is.
          Image.asset(
            'assets/images/wishes_flowing.png',
            height: 100,
            fit: BoxFit.contain,
          ),
          const SizedBox(height: 16),
          for (final (index, wish) in wishes.indexed) ...[
            if (index > 0) const SizedBox(height: 12),
            Material(
              color: Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
                side: const BorderSide(color: Color(0xFFE8F4FC)),
              ),
              child: InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap: () => onOpen(wish),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _PersonDisc(
                        name: wish.actor,
                        fontSize: 14,
                        wishIndex: index,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    '${wish.actor.split(' ').first} '
                                    '${birthday ? 'wished you' : 'congratulated you'}',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: ProfileStyle.sora(
                                      13,
                                      weight: FontWeight.w700,
                                      color: ProfileStyle.inkStrong,
                                      height: 19.5,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                _Time(wish.when),
                              ],
                            ),
                            const SizedBox(height: 4),
                            Text(
                              wish.body,
                              style: ProfileStyle.sora(
                                13,
                                color: ProfileStyle.muted,
                                height: 18,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _InboxMessage extends StatelessWidget {
  const _InboxMessage({
    required this.icon,
    required this.title,
    required this.body,
    required this.onRetry,
  });

  final IconData icon;
  final String title;
  final String body;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      color: MColors.terra,
      onRefresh: onRetry,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(32, 96, 32, 32),
        children: [
          Icon(icon, size: 44, color: MColors.inkFaint),
          const SizedBox(height: 14),
          Text(
            title,
            textAlign: TextAlign.center,
            style: ProfileStyle.sora(17, weight: FontWeight.w800),
          ),
          const SizedBox(height: 6),
          Text(
            body,
            textAlign: TextAlign.center,
            style: ProfileStyle.sora(14, color: ProfileStyle.tertiary),
          ),
        ],
      ),
    );
  }
}
