import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:http/http.dart' as http;

import '../../../services/api_config.dart';
import '../../../services/notification_service.dart';
import '../../auth/data/auth_models.dart';
import '../../manager/presentation/manager_screen.dart';

/// Everything the app has told this person, newest first. A tap marks the
/// notification read and takes them to what it is about — the post, the
/// request, the review — through the same door a push notification uses.
class NotificationInboxScreen extends StatefulWidget {
  const NotificationInboxScreen({super.key, required this.session});
  final AuthSession session;
  @override
  State<NotificationInboxScreen> createState() =>
      _NotificationInboxScreenState();
}

class _NotificationInboxScreenState extends State<NotificationInboxScreen> {
  late Future<List<Map<String, dynamic>>> _items = _load();
  Map<String, String> get headers => {
    'Authorization': 'Bearer ${widget.session.token}',
    'Content-Type': 'application/json',
  };
  Future<List<Map<String, dynamic>>> _load() async {
    final response = await http.get(
      Uri.parse('${ApiConfig.baseUrl}/notifications'),
      headers: headers,
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Could not load notifications');
    }
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    return (json['notifications'] as List<dynamic>? ?? const [])
        .map((item) => Map<String, dynamic>.from(item as Map))
        .toList();
  }

  Future<void> _refresh() {
    final next = _load();
    setState(() => _items = next);
    return next.then((_) {}, onError: (_) {});
  }

  Future<void> _open(Map<String, dynamic> item) async {
    // Marked read in the background: the person is already on their way.
    unawaited(
      http.patch(
        Uri.parse('${ApiConfig.baseUrl}/notifications/${item['id']}/read'),
        headers: headers,
      ),
    );
    if (!mounted) return;
    Navigator.pop(context);
    AppNotificationService.instance.openDestination(
      Map<String, dynamic>.from(item['data'] as Map? ?? const {}),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: MColors.bg,
      body: Column(
        children: [
          _InboxTopBar(onBack: () => Navigator.of(context).pop()),
          Expanded(
            child: FutureBuilder<List<Map<String, dynamic>>>(
              future: _items,
              builder: (context, snapshot) {
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
                    child: CircularProgressIndicator(color: MColors.terra),
                  );
                }
                final items = snapshot.data!;
                if (items.isEmpty) {
                  return _InboxMessage(
                    icon: Icons.notifications_none_rounded,
                    title: 'Nothing yet',
                    body: 'Requests, reviews and posts that need you will '
                        'show up here.',
                    onRetry: _refresh,
                  );
                }
                return RefreshIndicator(
                  color: MColors.terra,
                  onRefresh: _refresh,
                  child: ListView.separated(
                    padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
                    physics: const AlwaysScrollableScrollPhysics(),
                    itemCount: items.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 10),
                    itemBuilder: (_, index) => _NotificationCard(
                      item: items[index],
                      onTap: () => _open(items[index]),
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _InboxTopBar extends StatelessWidget {
  const _InboxTopBar({required this.onBack});

  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    // The row every pushed screen wears — Leave, Overtime, Reimbursements:
    // a square tile with the back chevron, then the title.
    return Container(
      padding: EdgeInsets.fromLTRB(
        16,
        MediaQuery.paddingOf(context).top + 8,
        18,
        12,
      ),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(bottom: BorderSide(color: Color(0xFFF3F4F6))),
      ),
      child: Row(
        children: [
          Material(
            color: MColors.bg,
            borderRadius: BorderRadius.circular(12),
            child: InkWell(
              onTap: onBack,
              borderRadius: BorderRadius.circular(12),
              child: SizedBox(
                width: 38,
                height: 38,
                child: Center(
                  child: SvgPicture.asset(
                    'assets/icons/chevron_back.svg',
                    width: 20,
                    height: 20,
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(width: 10),
          const Expanded(
            child: Text(
              'Notifications',
              style: TextStyle(
                color: MColors.ink,
                fontSize: 19,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _NotificationCard extends StatelessWidget {
  const _NotificationCard({required this.item, required this.onTap});

  final Map<String, dynamic> item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final unread = item['readAt'] == null;
    final look = _NotificationLook.of('${item['scenario'] ?? ''}');
    final when = DateTime.tryParse('${item['createdAt'] ?? ''}')?.toLocal();
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: MColors.line),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: look.tint,
                  borderRadius: BorderRadius.circular(13),
                ),
                child: Icon(look.icon, color: look.ink, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Text(
                            '${item['title'] ?? ''}',
                            style: TextStyle(
                              color: MColors.ink,
                              fontSize: 15,
                              fontWeight: unread
                                  ? FontWeight.w800
                                  : FontWeight.w700,
                              height: 1.25,
                            ),
                          ),
                        ),
                        if (unread) ...[
                          const SizedBox(width: 8),
                          Container(
                            margin: const EdgeInsets.only(top: 6),
                            width: 8,
                            height: 8,
                            decoration: const BoxDecoration(
                              color: MColors.terra,
                              shape: BoxShape.circle,
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 3),
                    Text(
                      '${item['body'] ?? ''}',
                      style: const TextStyle(
                        color: MColors.inkSoft,
                        fontSize: 13.5,
                        height: 1.35,
                      ),
                    ),
                    if (when != null) ...[
                      const SizedBox(height: 7),
                      Text(
                        _ago(when),
                        style: const TextStyle(
                          color: MColors.inkFaint,
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  static String _ago(DateTime when) {
    final gap = DateTime.now().difference(when);
    if (gap.inMinutes < 1) return 'Just now';
    if (gap.inMinutes < 60) return '${gap.inMinutes} min ago';
    if (gap.inHours < 24) return '${gap.inHours}h ago';
    if (gap.inDays < 7) return '${gap.inDays}d ago';
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${when.day} ${months[when.month - 1]}';
  }
}

/// Which icon and tint a notification wears, from what it is about. Each
/// pair is one of the app's colour families, tint and ink together, the
/// way the action cards are coloured.
class _NotificationLook {
  const _NotificationLook(this.icon, this.tint, this.ink);

  final IconData icon;
  final Color tint;
  final Color ink;

  static const _teal = Color(0xFF4F8C89);
  static const _tealTint = Color(0xFFDEEBE9);
  static const _sage = Color(0xFF4C5840);
  static const _sageTint = Color(0xFFE7EFE4);

  static _NotificationLook of(String scenario) {
    if (scenario.startsWith('leave')) {
      return const _NotificationLook(
        Icons.calendar_month_rounded,
        MColors.terraTint,
        MColors.terra,
      );
    }
    if (scenario.startsWith('overtime')) {
      return const _NotificationLook(
        Icons.schedule_rounded,
        MColors.goldTint,
        MColors.gold,
      );
    }
    if (scenario.startsWith('correction') ||
        scenario.startsWith('punch') ||
        scenario.contains('attendance')) {
      return const _NotificationLook(
        Icons.fingerprint_rounded,
        _sageTint,
        _sage,
      );
    }
    if (scenario.startsWith('feedback')) {
      return const _NotificationLook(
        Icons.rate_review_rounded,
        MColors.plumTint,
        MColors.plum,
      );
    }
    if (scenario.startsWith('nomination')) {
      return const _NotificationLook(
        Icons.emoji_events_rounded,
        MColors.goldTint,
        MColors.gold,
      );
    }
    if (scenario == 'new_joiner' ||
        scenario.contains('birthday') ||
        scenario.contains('anniversary')) {
      return const _NotificationLook(
        Icons.celebration_rounded,
        MColors.terraTint,
        MColors.terra,
      );
    }
    if (scenario.startsWith('post') ||
        scenario.startsWith('poll') ||
        scenario.startsWith('comment') ||
        scenario.startsWith('connect')) {
      return const _NotificationLook(Icons.forum_rounded, _tealTint, _teal);
    }
    return const _NotificationLook(
      Icons.notifications_rounded,
      MColors.terraTint,
      MColors.terra,
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
            style: const TextStyle(
              color: MColors.ink,
              fontSize: 17,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            body,
            textAlign: TextAlign.center,
            style: const TextStyle(color: MColors.inkSoft, fontSize: 14),
          ),
        ],
      ),
    );
  }
}
