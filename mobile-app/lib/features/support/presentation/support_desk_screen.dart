import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../auth/data/auth_models.dart';
import '../data/support_api_service.dart';
import '../data/support_models.dart';
import '../data/support_socket_service.dart';
import 'support_request_screen.dart';
import 'support_ticket_screen.dart';
import 'support_ui.dart';

/// Opens the Support desk over the app. With [ticketId] the ticket opens on
/// top of it straight away (a tapped notification), so going back lands on
/// the list.
Future<void> openSupportDesk(
  BuildContext context, {
  required AuthSession session,
  required Widget profileAction,
  required VoidCallback onNotifications,
  String? ticketId,
}) {
  return Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (_) => SupportDeskScreen(
        shell: SupportShell(
          api: SupportApiService(session: session),
          profileAction: profileAction,
          onNotifications: onNotifications,
        ),
        realtimeFactory:
            SupportDeskScreen.testRealtime ??
            () => SupportSocketService(session: session),
        initialTicketId: ticketId,
      ),
    ),
  );
}

/// The person's tickets (node 2896:32383), or the invitation to raise one
/// when there are none yet (node 2913:35621).
class SupportDeskScreen extends StatefulWidget {
  const SupportDeskScreen({
    super.key,
    required this.shell,
    this.realtimeFactory,
    this.initialTicketId,
  });

  /// [SupportShell.realtime] when supplied is used as is and left open;
  /// otherwise [realtimeFactory] makes one that lives as long as the desk.
  final SupportShell shell;
  final SupportRealtime Function()? realtimeFactory;

  /// Stands in for the socket when a test opens the desk the way the app
  /// does, through [openSupportDesk].
  @visibleForTesting
  static SupportRealtime Function()? testRealtime;
  final String? initialTicketId;

  @override
  State<SupportDeskScreen> createState() => _SupportDeskScreenState();
}

class _SupportDeskScreenState extends State<SupportDeskScreen> {
  late SupportShell _shell = widget.shell;
  SupportRealtime? _ownedRealtime;
  StreamSubscription<SupportChange>? _changeSub;
  StreamSubscription<void>? _reconnectSub;

  List<SupportTicket>? _tickets;
  String? _error;
  bool _loading = false;
  bool _reloadAgain = false;

  @override
  void initState() {
    super.initState();
    var realtime = widget.shell.realtime;
    if (realtime == null && widget.realtimeFactory != null) {
      realtime = _ownedRealtime = widget.realtimeFactory!()..connect();
      _shell = widget.shell.withRealtime(realtime);
    }
    _changeSub = realtime?.changes.listen((_) => _load());
    _reconnectSub = realtime?.reconnects.listen((_) => _load());
    _load();
    final ticketId = widget.initialTicketId;
    if (ticketId != null && ticketId.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _openTicket(ticketId);
      });
    }
  }

  @override
  void dispose() {
    _changeSub?.cancel();
    _reconnectSub?.cancel();
    _ownedRealtime?.dispose();
    super.dispose();
  }

  /// Reads the list again. A change that lands while a read is on its way
  /// asks for one more, so the newest state is never missed.
  Future<void> _load() async {
    if (_loading) {
      _reloadAgain = true;
      return;
    }
    _loading = true;
    try {
      final tickets = await _shell.api.fetchTickets();
      if (!mounted) return;
      setState(() {
        _tickets = tickets;
        _error = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = supportErrorText(error));
    } finally {
      _loading = false;
      if (_reloadAgain && mounted) {
        _reloadAgain = false;
        unawaited(_load());
      }
    }
  }

  Future<void> _openTicket(String id) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => SupportTicketScreen(shell: _shell, ticketId: id),
      ),
    );
    if (mounted) unawaited(_load());
  }

  /// The form hands over to the new ticket's thread in place, and passes
  /// back when that thread closes, so the list is read again then.
  Future<void> _raise() async {
    final threadClosed = await Navigator.of(context).push<Future<void>>(
      MaterialPageRoute(builder: (_) => SupportRequestScreen(shell: _shell)),
    );
    if (!mounted) return;
    unawaited(_load());
    if (threadClosed != null) {
      await threadClosed;
      if (mounted) unawaited(_load());
    }
  }

  @override
  Widget build(BuildContext context) {
    final tickets = _tickets;
    return SupportScaffold(
      shell: _shell,
      title: 'Support desk',
      trailing: SupportPillButton(label: 'Raise Ticket', onTap: _raise),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 24, 16, 28),
          children: [
            const _SupportIntroBanner(),
            if (tickets == null && _error == null)
              const Padding(
                padding: EdgeInsets.only(top: 80),
                child: Center(
                  child: SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
              )
            else if (tickets == null)
              _SupportLoadError(message: _error!, onRetry: _load)
            else if (tickets.isEmpty)
              _SupportEmptyState(onRaise: _raise)
            else
              for (final ticket in tickets) ...[
                const SizedBox(height: 14),
                SupportTicketCard(
                  key: ValueKey('support-ticket-${ticket.id}'),
                  ticket: ticket,
                  onTap: () => _openTicket(ticket.id),
                ),
              ],
          ],
        ),
      ),
    );
  }
}

/// What the desk is for and how long a reply takes, above the list.
class _SupportIntroBanner extends StatelessWidget {
  const _SupportIntroBanner();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(15, 13, 15, 12),
      decoration: BoxDecoration(
        color: const Color(0xFFEEF0FF),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFEBEBEB)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 1),
            child: Image.asset(
              'assets/icons/support_headset.png',
              width: 20,
              height: 22,
              fit: BoxFit.contain,
            ),
          ),
          const SizedBox(width: 13),
          const Expanded(
            child: Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: 'Have a concern?\n',
                    style: TextStyle(
                      color: SupportStyle.ink,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  TextSpan(
                    text:
                        'Raise a ticket to HR for workplace, payroll, '
                        'manager-related, or other concerns. Your ticket '
                        'will be reviewed in 2-3 days and you can track its '
                        'status here.',
                  ),
                ],
              ),
              style: TextStyle(
                fontFamily: 'Sora',
                color: SupportStyle.body,
                fontSize: 12,
                height: 16 / 12,
                fontWeight: FontWeight.w500,
                letterSpacing: -0.16,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// One ticket: its topic, when it was raised, the last word on it and where
/// it stands.
class SupportTicketCard extends StatelessWidget {
  const SupportTicketCard({
    super.key,
    required this.ticket,
    required this.onTap,
  });

  final SupportTicket ticket;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final preview = ticket.lastMessagePreview.trim();
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(16),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0D000000),
            blurRadius: 3,
            offset: Offset(0, 1),
          ),
        ],
      ),
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(16),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 15, 16, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(
                        ticket.topicLabel,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontFamily: 'Sora',
                          color: SupportStyle.inkStrong,
                          fontSize: 14,
                          height: 20 / 14,
                          fontWeight: FontWeight.w600,
                          letterSpacing: -0.16,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    SupportStatusChip(ticket: ticket),
                  ],
                ),
                const SizedBox(height: 7),
                Text(
                  'Created on ${supportDayMonth(ticket.createdAt)}',
                  style: const TextStyle(
                    fontFamily: 'Sora',
                    color: SupportStyle.muted,
                    fontSize: 12,
                    height: 16 / 12,
                    letterSpacing: -0.16,
                  ),
                ),
                if (preview.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  const Divider(
                    height: 1,
                    thickness: 1,
                    color: Color(0xFFF3F4F6),
                  ),
                  const SizedBox(height: 9),
                  Row(
                    children: [
                      SvgPicture.asset(
                        'assets/icons/support_message.svg',
                        width: 16,
                        height: 16,
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          preview,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontFamily: 'Sora',
                            color: SupportStyle.muted,
                            fontSize: 12,
                            height: 16 / 12,
                            fontWeight: FontWeight.w600,
                            letterSpacing: -0.16,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// No tickets yet (node 2913:35621).
class _SupportEmptyState extends StatelessWidget {
  const _SupportEmptyState({required this.onRaise});

  final VoidCallback onRaise;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(40, 86, 40, 24),
      child: Column(
        children: [
          Image.asset(
            'assets/icons/support_headset.png',
            width: 34,
            height: 38,
            fit: BoxFit.contain,
          ),
          const SizedBox(height: 16),
          // Broken where the design breaks it (node 2913:35621).
          const Text(
            'You have not raised any\ncomplaint. Raise a ticket to HR\n'
            'for any complaint or support.',
            key: ValueKey('support-empty'),
            textAlign: TextAlign.center,
            style: TextStyle(
              fontFamily: 'Sora',
              color: SupportStyle.body,
              fontSize: 12,
              height: 16.2 / 12,
              letterSpacing: -0.16,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 8),
          SupportPillButton(label: 'Raise Ticket', onTap: onRaise),
        ],
      ),
    );
  }
}

class _SupportLoadError extends StatelessWidget {
  const _SupportLoadError({required this.message, required this.onRetry});

  final String message;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 72, 24, 24),
      child: Column(
        children: [
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontFamily: 'Sora',
              color: SupportStyle.body,
              fontSize: 13,
              height: 18 / 13,
            ),
          ),
          const SizedBox(height: 12),
          SupportPillButton(label: 'Try again', onTap: onRetry),
        ],
      ),
    );
  }
}
