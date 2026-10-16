import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:http/http.dart' as http;

import '../../../services/api_config.dart';
import '../../../services/notification_service.dart';
import '../../auth/data/auth_models.dart';
import '../../manager_shell/presentation/app_home_header.dart';
import '../notification_badge.dart';
import '../notification_look.dart';

/// Everything the app has told this person, newest first, as the
/// Notifications design draws it (Sowaka Connect › Notifications, node
/// 3875:84049): amber alerts, purple priority cards, green game challenges
/// and plain white activity rows, under Today (the last 48 hours) and
/// Earlier. A tap marks the notification read and takes them to what it is
/// about — the post, the request, the review — through the same door a push
/// notification uses.
bool _inboxOpening = false;

/// The avatar the shell wears in its header, for the header over the inbox.
/// The shell registers it, so every bell that opens the inbox gets the same
/// face without having to pass it along. [closeInbox] leaves the inbox first,
/// for an avatar whose tap opens something under it.
typedef InboxProfileAction = Widget Function(VoidCallback closeInbox);

InboxProfileAction? _profileAction;

void registerInboxProfileAction(InboxProfileAction action) =>
    _profileAction = action;

void unregisterInboxProfileAction(InboxProfileAction action) {
  if (_profileAction == action) _profileAction = null;
}

/// Opens the inbox from a bell. Taps while it is opening or already open do
/// nothing, so a quick double tap can't stack copies of it.
Future<void> openNotificationInbox(
  BuildContext context,
  AuthSession session,
) async {
  if (_inboxOpening) return;
  _inboxOpening = true;
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

/// Whether a row still asks for attention: unread, and not overtaken by
/// events (the server marks `resolved` once whatever it was about is done).
bool notificationUnread(Map<String, dynamic> item) =>
    item['readAt'] == null && item['resolved'] != true;

/// Rows newer than this sit under Today; older ones under Earlier.
const _todayWindow = Duration(hours: 48);

class NotificationInboxScreen extends StatefulWidget {
  const NotificationInboxScreen({
    super.key,
    required this.session,
    this.client,
    this.now,
  });

  final AuthSession session;

  /// For tests; the app's own client otherwise.
  final http.Client? client;

  /// For tests; the clock otherwise.
  final DateTime Function()? now;

  @override
  State<NotificationInboxScreen> createState() =>
      _NotificationInboxScreenState();
}

class _NotificationInboxScreenState extends State<NotificationInboxScreen> {
  late Future<List<Map<String, dynamic>>> _items = _load();
  late final http.Client _client = widget.client ?? http.Client();

  Map<String, String> get headers => {
    'Authorization': 'Bearer ${widget.session.token}',
    'Content-Type': 'application/json',
  };

  DateTime _now() => widget.now?.call() ?? DateTime.now();

  @override
  void dispose() {
    if (widget.client == null) _client.close();
    super.dispose();
  }

  Future<List<Map<String, dynamic>>> _load() async {
    final response = await _client.get(
      Uri.parse('${ApiConfig.baseUrl}/notifications'),
      headers: headers,
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Could not load notifications');
    }
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    final items = (json['notifications'] as List<dynamic>? ?? const [])
        .map((item) => Map<String, dynamic>.from(item as Map))
        .toList();
    // A fresh read of the inbox is the truth about the bell's dot too.
    NotificationBadge.showUnread(items.any(notificationUnread));
    return items;
  }

  Future<void> _refresh() {
    final next = _load();
    setState(() => _items = next);
    return next.then((_) {}, onError: (_) {});
  }

  void _showBadge(List<Map<String, dynamic>> items) =>
      NotificationBadge.showUnread(items.any(notificationUnread));

  Future<void> _open(Map<String, dynamic> item) async {
    // Marked read in the background: the person is already on their way.
    unawaited(
      _client
          .patch(
            Uri.parse('${ApiConfig.baseUrl}/notifications/${item['id']}/read'),
            headers: headers,
          )
          .then((_) {}, onError: (_) {}),
    );
    // Read here at once, and the bell's dot goes with the last unread one.
    item['readAt'] ??= _now().toUtc().toIso8601String();
    unawaited(_items.then(_showBadge, onError: (_) {}));
    if (!mounted) return;
    Navigator.pop(context);
    AppNotificationService.instance.openDestination(
      Map<String, dynamic>.from(item['data'] as Map? ?? const {}),
    );
  }

  /// Everything unread reads at once, here and on the server. Should the
  /// server miss it, the next load shows the truth again.
  Future<void> _markAllRead(List<Map<String, dynamic>> items) async {
    if (!items.any(notificationUnread)) return;
    final stamp = _now().toUtc().toIso8601String();
    setState(() {
      for (final item in items) {
        item['readAt'] ??= stamp;
      }
    });
    NotificationBadge.showUnread(false);
    try {
      final response = await _client.patch(
        Uri.parse('${ApiConfig.baseUrl}/notifications/read-all'),
        headers: headers,
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception('Could not mark all as read');
      }
    } catch (_) {
      if (mounted) unawaited(_refresh());
    }
  }

  void _close() {
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final profileAction = _profileAction;
    return Scaffold(
      backgroundColor: const Color(0xFFF7F7F9),
      body: FutureBuilder<List<Map<String, dynamic>>>(
        future: _items,
        builder: (context, snapshot) {
          final items = snapshot.data;
          return Column(
            children: [
              if (profileAction != null)
                AppHomeHeader(
                  profileAction: profileAction(_close),
                  // Already here.
                  onNotifications: () {},
                ),
              _InboxHeader(
                insetTop: profileAction == null,
                unread: items?.where(notificationUnread).length ?? 0,
                onBack: _close,
                onMarkAllRead: items == null ? null : () => _markAllRead(items),
              ),
              Expanded(child: _body(snapshot)),
            ],
          );
        },
      ),
    );
  }

  Widget _body(AsyncSnapshot<List<Map<String, dynamic>>> snapshot) {
    if (snapshot.hasError) {
      return _InboxMessage(
        icon: Icons.cloud_off_rounded,
        title: 'Could not load notifications',
        body: 'Pull down to try again.',
        onRetry: _refresh,
      );
    }
    if (!snapshot.hasData) {
      return const Center(
        child: CircularProgressIndicator(color: Color(0xFF0571A6)),
      );
    }
    final items = snapshot.data!;
    if (items.isEmpty) {
      return _InboxMessage(
        icon: Icons.notifications_none_rounded,
        title: 'Nothing yet',
        body: 'Requests, reviews and posts that need you will show up here.',
        onRetry: _refresh,
      );
    }
    final now = _now();
    final today = <Map<String, dynamic>>[];
    final earlier = <Map<String, dynamic>>[];
    for (final item in items) {
      final when = _createdAt(item);
      (when == null || now.difference(when) < _todayWindow ? today : earlier)
          .add(item);
    }
    final sections = [
      if (today.isNotEmpty) ('Today', today),
      if (earlier.isNotEmpty) ('Earlier', earlier),
    ];
    return RefreshIndicator(
      color: const Color(0xFF0571A6),
      onRefresh: _refresh,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        // The design's 20px under the scroller and 40px under its content.
        padding: const EdgeInsets.only(bottom: 60),
        children: [
          Container(
            decoration: const BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
            ),
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (var s = 0; s < sections.length; s++)
                  _Section(
                    label: sections[s].$1,
                    items: sections[s].$2,
                    lastSection: s == sections.length - 1,
                    now: now,
                    onTap: _open,
                  ),
                const SizedBox(height: 24),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

DateTime? _createdAt(Map<String, dynamic> item) =>
    DateTime.tryParse('${item['createdAt'] ?? ''}')?.toLocal();

/// Sora, as the design sets every line of this screen. The rest of the app
/// defaults to Plus Jakarta Sans, so each style names its family.
TextStyle _sora(
  double size,
  FontWeight weight,
  Color color, {
  required double lineHeight,
  double spacing = 0,
}) => TextStyle(
  fontFamily: 'Sora',
  fontSize: size,
  fontWeight: weight,
  fontVariations: [FontVariation.weight(weight.value.toDouble())],
  color: color,
  height: lineHeight / size,
  letterSpacing: spacing,
);

/// "FormHeader" (node 3875:84055): back, the title with its unread count,
/// and Mark all as read.
class _InboxHeader extends StatelessWidget {
  const _InboxHeader({
    required this.insetTop,
    required this.unread,
    required this.onBack,
    required this.onMarkAllRead,
  });

  /// With no app header above it, the bar clears the status bar itself.
  final bool insetTop;
  final int unread;
  final VoidCallback onBack;
  final VoidCallback? onMarkAllRead;

  @override
  Widget build(BuildContext context) {
    final top = insetTop ? MediaQuery.paddingOf(context).top : 0.0;
    return Container(
      height: 60 + top,
      padding: EdgeInsets.fromLTRB(16, top, 16, 0),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(bottom: BorderSide(color: Color(0xFFF3F4F6))),
      ),
      child: Row(
        children: [
          Semantics(
            button: true,
            label: 'Back',
            child: Material(
              color: const Color(0xFFF7F7F9),
              shape: const CircleBorder(),
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                onTap: onBack,
                child: SizedBox(
                  width: 36,
                  height: 36,
                  child: Center(
                    child: SvgPicture.asset(
                      'assets/icons/chevron_left_small.svg',
                      width: 17.983,
                      height: 17.983,
                    ),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(width: 10),
          // The title gives way first on a narrow screen or large text, so
          // Mark all as read always fits.
          Expanded(
            child: Row(
              children: [
                Flexible(
                  child: Text(
                    'Notifications',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: _sora(
                      16,
                      FontWeight.w700,
                      const Color(0xFF222222),
                      lineHeight: 24,
                      spacing: -0.2,
                    ),
                  ),
                ),
                if (unread > 0) ...[
                  const SizedBox(width: 8),
                  Container(
                    key: const ValueKey('notifications-unread-count'),
                    height: 20,
                    constraints: const BoxConstraints(minWidth: 20),
                    padding: const EdgeInsets.symmetric(horizontal: 6),
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: const Color(0xFF0571A6),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      unread > 99 ? '99+' : '$unread',
                      style: _sora(
                        10,
                        FontWeight.w700,
                        Colors.white,
                        lineHeight: 10,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: 12),
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: unread > 0 ? onMarkAllRead : null,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(
                'Mark all as read',
                style: _sora(
                  12,
                  FontWeight.w600,
                  unread > 0
                      ? const Color(0xFF0571A6)
                      : const Color(0xFF9CA3AF),
                  lineHeight: 18,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// TODAY or EARLIER and its rows, 10px apart.
class _Section extends StatelessWidget {
  const _Section({
    required this.label,
    required this.items,
    required this.lastSection,
    required this.now,
    required this.onTap,
  });

  final String label;
  final List<Map<String, dynamic>> items;
  final bool lastSection;
  final DateTime now;
  final void Function(Map<String, dynamic>) onTap;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
          child: Text(
            label.toUpperCase(),
            style: _sora(
              11,
              FontWeight.w600,
              const Color(0xFF9CA3AF),
              lineHeight: 16.5,
              spacing: 0.6,
            ),
          ),
        ),
        for (var i = 0; i < items.length; i++) ...[
          const SizedBox(height: 10),
          NotificationRow(
            item: items[i],
            now: now,
            // White rows rule off from what follows, except at the foot of a
            // section with another under it (as the design draws Today).
            divider: i < items.length - 1 || lastSection,
            onTap: () => onTap(items[i]),
          ),
        ],
      ],
    );
  }
}

/// One notification: a coloured card for alerts, priority items and game
/// challenges ("NotifItem", 12px radius, a 1px border and a dot while
/// unread), or a plain white row for everything else.
class NotificationRow extends StatelessWidget {
  const NotificationRow({
    super.key,
    required this.item,
    required this.now,
    required this.onTap,
    this.divider = true,
  });

  final Map<String, dynamic> item;
  final DateTime now;
  final VoidCallback onTap;
  final bool divider;

  @override
  Widget build(BuildContext context) {
    final look = NotificationLook.of(item);
    final unread = notificationUnread(item);
    // Done is done: an alert that has cleared itself, or a request someone
    // already acted on, steps out of its colour into a plain row.
    final kind = item['resolved'] == true
        ? NotificationKind.activity
        : look.kind;
    final when = _createdAt(item);
    final ago = when == null ? '' : notificationAgo(when, now);
    final title = '${item['title'] ?? ''}';
    final body = '${item['body'] ?? ''}'.trim();
    final id = '${item['id'] ?? ''}';
    return Semantics(
      button: true,
      child: GestureDetector(
        key: ValueKey('notification-$id'),
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: kind == NotificationKind.activity
            ? _WhiteRow(
                look: look,
                title: title,
                body: _filler.contains(body) ? '' : body,
                ago: ago,
                unread: unread,
                divider: divider,
              )
            : _Card(
                look: look,
                palette: NotificationPalette.of(kind),
                title: title,
                // As the design: the message under the title, or the time
                // when there is no message ("9 min ago" on a challenge).
                subtitle: body.isNotEmpty ? body : ago,
                unread: unread,
              ),
      ),
    );
  }

  /// Bodies that only say "tap this"; a white row is tidier without them.
  static const _filler = {
    'See the post',
    'See what they said',
    'See what they shared',
    'See what they posted',
    'See the comment',
    'See the wishes',
    "See how it's shaping up",
    'See how the poll is shaping up',
    'See the results so far',
    'Say hello',
    'Tap to read the reply',
    'Tap to see the final reply',
    'Tap to read it',
    'Cast your vote',
  };
}

/// "9 min ago", "2h ago", "1D ago" — the design's own short forms — then a
/// date once it is a week old.
String notificationAgo(DateTime when, DateTime now) {
  final gap = now.difference(when);
  if (gap.inMinutes < 1) return 'Just now';
  if (gap.inMinutes < 60) return '${gap.inMinutes} min ago';
  if (gap.inHours < 24) return '${gap.inHours}h ago';
  if (gap.inDays < 7) return '${gap.inDays}D ago';
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return '${when.day} ${months[when.month - 1]}';
}

class _Card extends StatelessWidget {
  const _Card({
    required this.look,
    required this.palette,
    required this.title,
    required this.subtitle,
    required this.unread,
  });

  final NotificationLook look;
  final NotificationPalette palette;
  final String title;
  final String subtitle;
  final bool unread;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: BoxDecoration(
        color: palette.background,
        borderRadius: BorderRadius.circular(12),
        border: unread ? Border.all(color: palette.border) : null,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(left: 12),
            child: _Avatar(glyph: look.glyph, disc: palette.disc),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(right: 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    height: 24.895,
                    child: Row(
                      children: [
                        Expanded(
                          child: Align(
                            alignment: Alignment.topLeft,
                            child: Padding(
                              padding: const EdgeInsets.only(top: 8),
                              child: Text(
                                look.label,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: _sora(
                                  10,
                                  FontWeight.w700,
                                  palette.label,
                                  lineHeight: 15,
                                  spacing: 0.5,
                                ),
                              ),
                            ),
                          ),
                        ),
                        if (unread) _Dot(color: palette.dot),
                      ],
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    title,
                    style: _sora(
                      13,
                      FontWeight.w700,
                      const Color(0xFF111827),
                      lineHeight: 17.55,
                    ),
                  ),
                  if (subtitle.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(
                        subtitle,
                        style: _sora(
                          12,
                          FontWeight.w400,
                          const Color(0xFF6B7280),
                          lineHeight: 16.8,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _WhiteRow extends StatelessWidget {
  const _WhiteRow({
    required this.look,
    required this.title,
    required this.body,
    required this.ago,
    required this.unread,
    required this.divider,
  });

  final NotificationLook look;
  final String title;
  final String body;
  final String ago;
  final bool unread;
  final bool divider;

  @override
  Widget build(BuildContext context) {
    final titleText = Text(
      title,
      style: _sora(
        13,
        FontWeight.w700,
        const Color(0xFF374151),
        lineHeight: 17.55,
      ),
    );
    final agoText = Padding(
      padding: const EdgeInsets.only(top: 2),
      child: Text(
        ago,
        style: _sora(
          11,
          FontWeight.w400,
          const Color(0xFF9CA3AF),
          lineHeight: 16.5,
        ),
      ),
    );
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 14),
      decoration: BoxDecoration(
        border: divider
            ? const Border(
                bottom: BorderSide(color: Color(0xFFF3F4F6), width: 1.129),
              )
            : null,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(left: 12),
            child: _Avatar(glyph: look.glyph, disc: look.disc),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // With something to say under it, the time sits beside the
                // title; without, under it (the design's two white rows).
                if (body.isNotEmpty) ...[
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(child: titleText),
                      if (ago.isNotEmpty) ...[
                        const SizedBox(width: 8),
                        agoText,
                      ],
                    ],
                  ),
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      body,
                      style: _sora(
                        12,
                        FontWeight.w400,
                        const Color(0xFF6B7280),
                        lineHeight: 16.8,
                      ),
                    ),
                  ),
                ] else ...[
                  titleText,
                  if (ago.isNotEmpty) agoText,
                ],
              ],
            ),
          ),
          if (unread)
            const Padding(
              padding: EdgeInsets.only(top: 2, right: 1),
              child: SizedBox(
                width: 13,
                child: Align(
                  alignment: Alignment.topLeft,
                  child: _Dot(color: NotificationPalette.unreadOrange),
                ),
              ),
            )
          else
            const SizedBox(width: 12),
        ],
      ),
    );
  }
}

class _Dot extends StatelessWidget {
  const _Dot({required this.color});
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey('notification-unread-dot'),
      width: 6.987,
      height: 6.987,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}

/// The 40px disc. People get their initial on one of the profile discs'
/// gradients, as the design's comment row does.
class _Avatar extends StatelessWidget {
  const _Avatar({required this.glyph, required this.disc});

  final NotificationGlyph glyph;
  final Color disc;

  static const _gradients = [
    [Color(0xFF059669), Color(0xFF34D399)],
    [Color(0xFF0571A6), Color(0xFF38BDF8)],
    [Color(0xFF7C3AED), Color(0xFFA78BFA)],
    [Color(0xFFD97706), Color(0xFFFBBF24)],
    [Color(0xFFDB2777), Color(0xFFF472B6)],
  ];

  @override
  Widget build(BuildContext context) {
    final glyph = this.glyph;
    if (glyph is InitialGlyph) {
      final name = glyph.name.trim();
      final colors =
          _gradients[name.codeUnits.fold<int>(0, (a, b) => a + b) %
              _gradients.length];
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
          name.isEmpty ? '?' : name.characters.first.toUpperCase(),
          style: _sora(15, FontWeight.w600, Colors.white, lineHeight: 22.5),
        ),
      );
    }
    return Container(
      width: 40,
      height: 40,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: disc, shape: BoxShape.circle),
      child: switch (glyph) {
        AssetGlyph(:final asset, :final size, :final isSvg) =>
          isSvg
              ? SvgPicture.asset(asset, width: size, height: size)
              : Image.asset(
                  asset,
                  width: size,
                  height: size,
                  fit: BoxFit.cover,
                ),
        EmojiGlyph(:final emoji) => Text(
          emoji,
          style: const TextStyle(fontSize: 18, height: 1.5),
        ),
        IconGlyph(:final icon, :final color) => Icon(
          icon,
          size: 20,
          color: color,
        ),
        InitialGlyph() => const SizedBox.shrink(),
      },
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
      color: const Color(0xFF0571A6),
      onRefresh: onRetry,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(32, 96, 32, 32),
        children: [
          Icon(icon, size: 44, color: const Color(0xFF9CA3AF)),
          const SizedBox(height: 14),
          Text(
            title,
            textAlign: TextAlign.center,
            style: _sora(
              16,
              FontWeight.w700,
              const Color(0xFF222222),
              lineHeight: 24,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            body,
            textAlign: TextAlign.center,
            style: _sora(
              12,
              FontWeight.w400,
              const Color(0xFF6B7280),
              lineHeight: 16.8,
            ),
          ),
        ],
      ),
    );
  }
}
