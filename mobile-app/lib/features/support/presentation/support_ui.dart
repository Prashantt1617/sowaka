import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../manager_shell/presentation/app_home_header.dart';
import '../data/support_api_service.dart';
import '../data/support_models.dart';
import '../data/support_socket_service.dart';

/// What every Support screen needs from the app around it: the API, the live
/// channel, and the header's avatar and bell.
class SupportShell {
  const SupportShell({
    required this.api,
    required this.profileAction,
    required this.onNotifications,
    this.realtime,
    this.bottomNav,
  });

  final SupportApiService api;
  final Widget profileAction;
  final VoidCallback onNotifications;

  /// The app's tabs, under every page of the desk as under Leave and
  /// Overtime. Picking one leaves the desk first.
  final Widget? bottomNav;

  /// Shared by the desk and the thread opened from it. Null until the desk
  /// has made one (or a test supplied it).
  final SupportRealtime? realtime;

  SupportShell withRealtime(SupportRealtime realtime) => SupportShell(
    api: api,
    profileAction: profileAction,
    onNotifications: onNotifications,
    realtime: realtime,
    bottomNav: bottomNav,
  );
}

/// The Support desk's palette and type: the app's own font at the sizes the
/// Leave and Overtime pages use, so the desk reads as one of them.
abstract final class SupportStyle {
  static const ink = Color(0xFF222222);
  static const inkStrong = Color(0xFF111827);
  static const body = Color(0xFF484848);
  static const muted = Color(0xFF6B7280);
  static const faint = Color(0xFF9CA3AF);
  static const line = Color(0xFFE5E7EB);
  static const page = Color(0xFFF7F7F9);
  static const brand = Color(0xFF0571A6);
  static const brandMuted = Color(0xFF96B7C7);
  static const bubbleMine = Color(0xFF2B7FFF);
  static const bubbleTheirs = Color(0xFFE5E7EB);
  static const time = Color(0xFF6A7282);

  /// The top bar's title, as "Leave" and "Overtime" are set.
  static const title = TextStyle(
    color: Color(0xFF2A2420),
    fontSize: 19,
    fontWeight: FontWeight.w800,
  );

  /// The pill in the top bar, as "Apply Leave" is set.
  static const button = TextStyle(
    color: Colors.white,
    fontSize: 12,
    fontWeight: FontWeight.w700,
  );
}

/// A page of the Support desk, laid out as Leave and Overtime are: the app
/// header, a top bar with the back button, a title and an optional action,
/// the page itself, and the app's tabs under it.
class SupportScaffold extends StatelessWidget {
  const SupportScaffold({
    super.key,
    required this.shell,
    required this.title,
    required this.body,
    this.trailing,
    this.footer,
    this.background = SupportStyle.page,
    this.onBack,
    this.confirmLeave,
  });

  final SupportShell shell;
  final String title;
  final Widget body;
  final Widget? trailing;
  final Widget? footer;
  final Color background;
  final VoidCallback? onBack;

  /// Set while the page holds something unsent: the avatar then asks this
  /// before it leaves the desk, and leaves only on true.
  final Future<bool> Function()? confirmLeave;

  @override
  Widget build(BuildContext context) {
    final confirm = confirmLeave;
    void leaveDesk() =>
        Navigator.of(context).popUntil((route) => route.isFirst);
    // The tabs step aside for the keyboard, as they do in the shell. While
    // they show they hold the home-indicator inset, so the footer above them
    // does not pad for it again.
    final nav = MediaQuery.viewInsetsOf(context).bottom > 0
        ? null
        : shell.bottomNav;
    final footer = this.footer;
    return Scaffold(
      backgroundColor: background,
      body: Column(
        children: [
          AppHomeHeader(
            // Opening the profile from here leaves the desk: the profile
            // opens under it, so the desk's pages step aside first. A
            // listener rather than a tap handler, so the avatar's own tap
            // still runs. With something unsent the avatar's own tap is held
            // back and the question asked instead: on leaving, the desk
            // steps aside without the profile.
            profileAction: confirm == null
                ? Listener(
                    onPointerUp: (_) => leaveDesk(),
                    child: shell.profileAction,
                  )
                : GestureDetector(
                    key: const ValueKey('support-avatar-held'),
                    behavior: HitTestBehavior.opaque,
                    onTap: () async {
                      if (await confirm() && context.mounted) leaveDesk();
                    },
                    child: AbsorbPointer(child: shell.profileAction),
                  ),
            onNotifications: shell.onNotifications,
          ),
          Container(
            padding: const EdgeInsets.fromLTRB(16, 8, 18, 12),
            decoration: const BoxDecoration(
              color: Colors.white,
              border: Border(bottom: BorderSide(color: Color(0xFFF3F4F6))),
            ),
            child: Row(
              children: [
                SupportBackButton(
                  onTap: onBack ?? () => Navigator.of(context).maybePop(),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: SupportStyle.title,
                  ),
                ),
                ?trailing,
              ],
            ),
          ),
          Expanded(child: body),
          if (footer != null)
            nav == null
                ? footer
                : MediaQuery.removePadding(
                    context: context,
                    removeBottom: true,
                    child: footer,
                  ),
          ?nav,
        ],
      ),
    );
  }
}

class SupportBackButton extends StatelessWidget {
  const SupportBackButton({super.key, required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Back',
      child: Material(
        color: SupportStyle.page,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          onTap: onTap,
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
    );
  }
}

/// The blue pill in the top bar and under the empty state: "Raise Request".
class SupportPillButton extends StatelessWidget {
  const SupportPillButton({
    super.key,
    required this.label,
    required this.onTap,
  });

  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: SupportStyle.brand,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Text(label, style: SupportStyle.button),
        ),
      ),
    );
  }
}

/// A ticket's status as the list shows it (node 2896:32383): unread replies
/// first, in red, then where the ticket is. "Submitted" is not in the design;
/// it is set like its neighbours.
class SupportStatusChip extends StatelessWidget {
  const SupportStatusChip({super.key, required this.ticket});

  final SupportTicket ticket;

  static String labelFor(SupportTicket ticket) {
    // A resolved ticket says so, even with a last reply unread: the thread
    // itself shows the reply.
    if (ticket.unread > 0 && ticket.status != SupportStatus.resolved) {
      return '${ticket.unread} new message${ticket.unread == 1 ? '' : 's'}';
    }
    // The server names the status; the design's words stand in if not.
    if (ticket.chip.trim().isNotEmpty) return ticket.chip.trim();
    return switch (ticket.status) {
      SupportStatus.open => 'Submitted',
      SupportStatus.assigned => 'In-process',
      SupportStatus.resolved => 'Resolved',
    };
  }

  @override
  Widget build(BuildContext context) {
    final unread = ticket.unread > 0;
    final color = unread
        ? Colors.white
        : switch (ticket.status) {
            SupportStatus.open => const Color(0xFFD08700),
            SupportStatus.assigned => SupportStyle.brand,
            SupportStatus.resolved => const Color(0xFF34C759),
          };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 1),
      decoration: BoxDecoration(
        color: unread ? const Color(0xFFFF383C) : null,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        labelFor(ticket),
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

const _months = [
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

/// "24 Sep".
String supportDayMonth(DateTime date) =>
    '${date.day} ${_months[date.month - 1]}';

/// "10:32 AM".
String supportTime(DateTime time) {
  final hour = time.hour % 12 == 0 ? 12 : time.hour % 12;
  final minute = time.minute.toString().padLeft(2, '0');
  return '$hour:$minute ${time.hour < 12 ? 'AM' : 'PM'}';
}

/// "30/1/2023", the thread's day divider.
String supportDivider(DateTime date) =>
    '${date.day}/${date.month}/${date.year}';
