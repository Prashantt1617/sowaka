/// The employee's side of the Support desk: the topics a concern can be about,
/// their own tickets, and the thread on each.
///
/// Shapes follow the phase 1 contract (`/support` routes). The server decides
/// what the employee may see — staff are always "HR team", never a name — so
/// these classes only read what they are given.
library;

/// One of the fixed topics a request can be raised under (node 2896:32710).
/// The server owns the list; [key] is what is stored on the ticket.
class SupportTopic {
  const SupportTopic({required this.key, required this.label});

  factory SupportTopic.fromJson(Map<String, dynamic> json) => SupportTopic(
    key: '${json['key'] ?? ''}',
    label: '${json['label'] ?? json['key'] ?? ''}',
  );

  final String key;
  final String label;
}

/// Where a ticket is. `open` is waiting in the Support head's queue; once
/// someone has it, it is `assigned`; `resolved` is final in phase 1.
enum SupportStatus {
  open,
  assigned,
  resolved;

  static SupportStatus parse(Object? value) => switch ('$value') {
    'resolved' || 'closed' => SupportStatus.resolved,
    'open' => SupportStatus.open,
    _ => SupportStatus.assigned,
  };
}

/// One of the employee's own tickets, as the list and the thread header show
/// it (`TicketForEmployee`).
class SupportTicket {
  const SupportTicket({
    required this.id,
    this.ticketNo = 0,
    required this.topic,
    required this.topicLabel,
    required this.status,
    required this.chip,
    required this.createdAt,
    required this.lastMessageAt,
    required this.lastMessagePreview,
    required this.unread,
  });

  factory SupportTicket.fromJson(Map<String, dynamic> json) {
    final created = _date(json['createdAt']) ?? DateTime.now();
    return SupportTicket(
      id: '${json['id'] ?? ''}',
      ticketNo: (json['ticketNo'] as num?)?.toInt() ?? 0,
      topic: '${json['topic'] ?? ''}',
      topicLabel: '${json['topicLabel'] ?? json['topic'] ?? ''}',
      status: SupportStatus.parse(json['status']),
      chip: '${json['chip'] ?? ''}',
      createdAt: created,
      lastMessageAt: _date(json['lastMessageAt']) ?? created,
      lastMessagePreview: '${json['lastMessagePreview'] ?? ''}',
      unread: (json['unread'] as num?)?.toInt() ?? 0,
    );
  }

  final String id;

  /// The company's running number for the ticket. The designs show no
  /// ticket number to the employee, so it is carried but not shown.
  final int ticketNo;
  final String topic;
  final String topicLabel;
  final SupportStatus status;

  /// The server's wording for the status: "Submitted", "In-process" or
  /// "Resolved". Unread replies are counted by the app from [unread].
  final String chip;
  final DateTime createdAt;
  final DateTime lastMessageAt;
  final String lastMessagePreview;

  /// HR team messages the employee has not opened yet.
  final int unread;

  bool get resolved => status == SupportStatus.resolved;
}

/// Who wrote a message: the employee, the HR team, or the desk itself (the
/// automatic reply).
enum SupportSide {
  employee,
  staff,
  system;

  static SupportSide parse(Object? value) => switch ('$value') {
    'employee' => SupportSide.employee,
    'staff' => SupportSide.staff,
    _ => SupportSide.system,
  };
}

/// A file on a message, with a short-lived signed link to open it.
class SupportAttachment {
  const SupportAttachment({
    required this.name,
    required this.contentType,
    required this.size,
    required this.url,
  });

  factory SupportAttachment.fromJson(Map<String, dynamic> json) =>
      SupportAttachment(
        name: '${json['name'] ?? 'Document'}',
        contentType: '${json['contentType'] ?? ''}',
        size: (json['size'] as num?)?.toInt() ?? 0,
        url: '${json['url'] ?? ''}',
      );

  final String name;
  final String contentType;
  final int size;
  final String url;

  bool get isImage => contentType.startsWith('image/');
}

class SupportMessage {
  const SupportMessage({
    required this.id,
    required this.side,
    required this.senderLabel,
    required this.text,
    required this.attachments,
    required this.createdAt,
  });

  factory SupportMessage.fromJson(Map<String, dynamic> json) => SupportMessage(
    id: '${json['id'] ?? ''}',
    side: SupportSide.parse(json['side']),
    senderLabel: '${json['senderLabel'] ?? ''}',
    text: '${json['text'] ?? ''}',
    attachments: [
      for (final item in json['attachments'] as List<dynamic>? ?? const [])
        if (item is Map<String, dynamic>) SupportAttachment.fromJson(item),
    ],
    createdAt: _date(json['createdAt']) ?? DateTime.now(),
  );

  final String id;
  final SupportSide side;

  /// 'You', 'HR team' or empty for the desk's own messages.
  final String senderLabel;
  final String text;
  final List<SupportAttachment> attachments;
  final DateTime createdAt;
}

/// Something that happened to the ticket that the employee is allowed to
/// know about. Phase 1 shows these through the system messages the server
/// posts alongside them, so they are only carried here.
class SupportEvent {
  const SupportEvent({
    required this.id,
    required this.type,
    required this.createdAt,
  });

  factory SupportEvent.fromJson(Map<String, dynamic> json) => SupportEvent(
    id: '${json['id'] ?? ''}',
    type: '${json['type'] ?? ''}',
    createdAt: _date(json['createdAt']) ?? DateTime.now(),
  );

  final String id;
  final String type;
  final DateTime createdAt;
}

/// A ticket with its whole thread, as `GET /support/tickets/:id` returns it.
class SupportThread {
  const SupportThread({
    required this.ticket,
    required this.messages,
    this.events = const [],
  });

  factory SupportThread.fromJson(Map<String, dynamic> json) => SupportThread(
    ticket: SupportTicket.fromJson(
      json['ticket'] as Map<String, dynamic>? ?? const {},
    ),
    messages: parseSupportMessages(json['messages']),
    events: [
      for (final item in json['events'] as List<dynamic>? ?? const [])
        if (item is Map<String, dynamic>) SupportEvent.fromJson(item),
    ],
  );

  final SupportTicket ticket;
  final List<SupportMessage> messages;
  final List<SupportEvent> events;
}

/// What the live channel says: which ticket changed and how. It carries no
/// ticket body; the screens read the ticket again with their own rights.
class SupportChange {
  const SupportChange({required this.ticketId, required this.kind});

  final String ticketId;

  /// created, message, assigned, sent_back or resolved.
  final String kind;
}

/// Oldest first. The server already sends them in order; the sort only keeps
/// a late arrival in its place, and ties keep the server's order (a request
/// and its automatic reply can share a timestamp).
List<SupportMessage> parseSupportMessages(Object? value) {
  final messages = [
    for (final item in value as List<dynamic>? ?? const [])
      if (item is Map<String, dynamic>) SupportMessage.fromJson(item),
  ];
  final order = {for (final (i, m) in messages.indexed) m: i};
  return messages..sort((a, b) {
    final byTime = a.createdAt.compareTo(b.createdAt);
    return byTime != 0 ? byTime : order[a]!.compareTo(order[b]!);
  });
}

DateTime? _date(Object? value) {
  if (value is! String || value.isEmpty) return null;
  return DateTime.tryParse(value)?.toLocal();
}
