/// Raising a Support Desk ticket from anywhere in the app: every "ask HR",
/// "contact HR" or "speak to HR" goes here, rather than to an email address
/// or nowhere.
///
/// The signed-in shell (`ManagerScreen`) knows how to open the desk over the
/// app (the session, the header, the tabs under it). It registers itself here
/// while it is mounted, as `profile_launcher.dart` does for profiles, so any
/// screen can raise a ticket without importing the shell.
library;

import 'package:flutter/material.dart';

/// Opens the Support Desk on a new ticket, its message started with [about].
typedef SupportTicketOpener = void Function({String? about});

SupportTicketOpener? _opener;

/// Opens the Support Desk on a new ticket. False when no signed-in shell is
/// listening (a test, or before sign-in), so a caller can fall back.
bool raiseSupportTicket({String? about}) {
  final open = _opener;
  if (open == null) return false;
  open(about: about);
  return true;
}

/// Whether a ticket can be raised from here right now.
bool get canRaiseSupportTicket => _opener != null;

void registerSupportTicketOpener(SupportTicketOpener opener) => _opener = opener;

/// Only clears [opener]'s own registration.
void unregisterSupportTicketOpener(SupportTicketOpener opener) {
  if (_opener == opener) _opener = null;
}

/// Whether [message] sends the person to HR or support, so the toast showing
/// it should offer "Raise ticket" (server messages such as "Ask HR to assign
/// them", "Speak to HR", "contact support").
bool mentionsHrOrSupport(String message) => RegExp(
  r'\b(ask|contact|speak to|talk to|email|reach out to|check with|tell)\s+(your\s+)?(hr|support|the hr team)\b|\bhr team\b|\bsupport team\b',
  caseSensitive: false,
).hasMatch(message);

/// "Raise a ticket at the Support Desk ›": the line that sits under any text
/// that tells the person to go to HR. Hidden when nothing can open the desk.
class RaiseTicketLink extends StatelessWidget {
  const RaiseTicketLink({super.key, this.about, this.label = 'Raise a ticket at the Support Desk', this.center = false});

  /// What the new ticket's message starts with.
  final String? about;
  final String label;
  final bool center;

  @override
  Widget build(BuildContext context) {
    if (!canRaiseSupportTicket) return const SizedBox.shrink();
    return Align(
      alignment: center ? Alignment.center : Alignment.centerLeft,
      child: Semantics(
        button: true,
        child: InkWell(
          key: const ValueKey('raise-ticket-link'),
          borderRadius: BorderRadius.circular(8),
          onTap: () => raiseSupportTicket(about: about),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 2),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.support_agent_rounded, size: 17, color: Color(0xFF0571A6)),
                const SizedBox(width: 6),
                Flexible(
                  child: Text(
                    '$label ›',
                    style: const TextStyle(
                      fontFamily: 'Sora',
                      color: Color(0xFF0571A6),
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      height: 1.4,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
