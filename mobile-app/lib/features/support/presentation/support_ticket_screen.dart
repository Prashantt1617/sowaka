import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../shared/app_toast.dart';
import '../data/support_api_service.dart';
import '../data/support_models.dart';
import 'support_attachments.dart';
import 'support_ui.dart';

/// A ticket being raised: what the form held. The thread opens on it at once
/// while the server creates the ticket behind it.
class SupportDraft {
  const SupportDraft({
    required this.topic,
    required this.text,
    this.files = const [],
  });

  final SupportTopic topic;
  final String text;
  final List<SupportUpload> files;
}

/// One ticket as a conversation with the HR team (nodes 3459:62206,
/// 2901:33094, 2901:33415).
///
/// The ticket opens the thread, then the desk's automatic reply, then the
/// back and forth. A resolved ticket is read only: the composer gives way to
/// the note asking for a new ticket.
///
/// Nothing waits on the network: a message shows as sent the moment it is
/// sent, and goes out behind it. One that does not get through stays, marked
/// "Not sent · Tap to retry"; a long press offers to delete it.
class SupportTicketScreen extends StatefulWidget {
  const SupportTicketScreen({
    super.key,
    required this.shell,
    this.ticketId,
    this.draft,
  }) : assert(ticketId != null || draft != null);

  final SupportShell shell;

  /// The ticket to open. Null while [draft] is still being created.
  final String? ticketId;

  /// A ticket just raised from the form, created from here.
  final SupportDraft? draft;

  @override
  State<SupportTicketScreen> createState() => _SupportTicketScreenState();
}

enum _Delivery { waiting, sending, failed }

/// A message of the person's own that the server has not confirmed yet.
class _Pending {
  _Pending({
    required this.tempId,
    required this.text,
    required this.files,
    required this.at,
  });

  final String tempId;
  final String text;
  final List<SupportUpload> files;
  final DateTime at;
  _Delivery delivery = _Delivery.waiting;

  /// The person's messages already on the thread when this one went out:
  /// the server's copy of it is the one that is not among them.
  Set<String> knownIds = const {};
}

class _SupportTicketScreenState extends State<SupportTicketScreen> {
  final _text = TextEditingController();
  final _scroll = ScrollController();
  final List<SupportUpload> _files = [];
  final List<_Pending> _pending = [];
  StreamSubscription<SupportChange>? _changeSub;
  StreamSubscription<void>? _reconnectSub;

  late String? _ticketId = widget.ticketId;
  SupportThread? _thread;

  /// The ticket being raised, until the server has it.
  late SupportDraft? _draft = widget.draft;
  bool _draftFailed = false;
  late final DateTime _draftAt = DateTime.now();

  int _nextTempId = 0;
  String? _error;
  bool _loading = false;
  bool _reloadAgain = false;

  @override
  void initState() {
    super.initState();
    _text.addListener(_onTextChanged);
    final realtime = widget.shell.realtime;
    _changeSub = realtime?.changes.listen((change) {
      if (_ticketId != null && change.ticketId == _ticketId) _load();
    });
    _reconnectSub = realtime?.reconnects.listen((_) => _load());
    if (_draft != null) {
      unawaited(_create());
    } else {
      _load();
    }
  }

  @override
  void dispose() {
    _changeSub?.cancel();
    _reconnectSub?.cancel();
    _text
      ..removeListener(_onTextChanged)
      ..dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _onTextChanged() => setState(() {});

  /// Raises the draft. On success the thread becomes the server's and any
  /// replies written meanwhile go out; on failure the request stays on
  /// screen with the retry marker.
  Future<void> _create() async {
    final draft = _draft;
    if (draft == null) return;
    setState(() {
      _draftFailed = false;
      // Replies written while it failed go again with it.
      for (final pending in _pending) {
        pending.delivery = _Delivery.waiting;
      }
    });
    try {
      final thread = await widget.shell.api.createTicket(
        topic: draft.topic.key,
        text: draft.text,
        files: draft.files,
      );
      if (!mounted) return;
      setState(() {
        _ticketId = thread.ticket.id;
        _thread = thread;
        _draft = null;
      });
      for (final pending in List.of(_pending)) {
        if (pending.delivery == _Delivery.waiting) unawaited(_deliver(pending));
      }
      _scrollToEnd(animate: true);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _draftFailed = true;
        for (final pending in _pending) {
          pending.delivery = _Delivery.failed;
        }
      });
      // The day's allowance of new tickets is used up: say so kindly, as
      // retrying will not help today.
      if (error is SupportApiException && error.statusCode == 429) {
        showAppToast(
          context,
          'You have raised a lot of tickets today. Please continue in one '
          'of your open tickets.',
        );
      }
    }
  }

  Future<void> _load() async {
    final id = _ticketId;
    if (id == null) return;
    if (_loading) {
      _reloadAgain = true;
      return;
    }
    _loading = true;
    try {
      final thread = await widget.shell.api.fetchTicket(id);
      if (!mounted) return;
      final before = _thread?.messages.length ?? 0;
      setState(() {
        _thread = thread;
        _error = null;
        _dropConfirmed(thread);
      });
      if (thread.messages.length != before) {
        _scrollToEnd(animate: before > 0);
      }
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = '$error');
    } finally {
      _loading = false;
      if (_reloadAgain && mounted) {
        _reloadAgain = false;
        unawaited(_load());
      }
    }
  }

  /// A refetch can bring the server's copy of a message still on its way:
  /// the local one then goes, so it never shows twice.
  void _dropConfirmed(SupportThread thread) {
    final claimed = <String>{};
    _pending.removeWhere((pending) {
      if (pending.delivery == _Delivery.waiting) return false;
      for (final message in thread.messages) {
        if (message.side != SupportSide.employee ||
            claimed.contains(message.id) ||
            pending.knownIds.contains(message.id) ||
            message.text.trim() != pending.text ||
            !_sameNames(message.attachments, pending.files)) {
          continue;
        }
        claimed.add(message.id);
        return true;
      }
      return false;
    });
  }

  static bool _sameNames(
    List<SupportAttachment> sent,
    List<SupportUpload> local,
  ) {
    if (sent.length != local.length) return false;
    for (var i = 0; i < sent.length; i++) {
      if (sent[i].name != local[i].name) return false;
    }
    return true;
  }

  void _scrollToEnd({required bool animate}) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scroll.hasClients) return;
      final end = _scroll.position.maxScrollExtent;
      if (animate) {
        _scroll.animateTo(
          end,
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeOut,
        );
      } else {
        _scroll.jumpTo(end);
      }
    });
  }

  bool get _canSend => _text.text.trim().isNotEmpty || _files.isNotEmpty;

  Future<void> _addFiles() async {
    final picked = await pickSupportFiles(
      context,
      alreadyChosen: _files.length,
    );
    if (picked.isNotEmpty && mounted) setState(() => _files.addAll(picked));
  }

  /// Shows the message as sent straight away and sends it behind.
  void _send() {
    if (!_canSend) return;
    final pending = _Pending(
      tempId: 'local-${_nextTempId++}',
      text: _text.text.trim(),
      files: List.of(_files),
      at: DateTime.now(),
    );
    setState(() {
      _pending.add(pending);
      _text.clear();
      _files.clear();
    });
    _scrollToEnd(animate: true);
    unawaited(_deliver(pending));
  }

  Future<void> _deliver(_Pending pending) async {
    final id = _ticketId;
    // Still being raised: it goes once the ticket exists.
    if (id == null) return;
    setState(() {
      pending
        ..delivery = _Delivery.sending
        ..knownIds = {
          for (final message in _thread?.messages ?? const <SupportMessage>[])
            if (message.side == SupportSide.employee) message.id,
        };
    });
    try {
      final message = await widget.shell.api.sendMessage(
        id,
        text: pending.text,
        files: pending.files,
      );
      if (!mounted) return;
      setState(() {
        _pending.remove(pending);
        final current = _thread;
        if (current != null &&
            !current.messages.any((m) => m.id == message.id)) {
          _thread = SupportThread(
            ticket: current.ticket,
            messages: [...current.messages, message],
            events: current.events,
          );
        }
      });
    } catch (error) {
      if (!mounted || !_pending.contains(pending)) return;
      setState(() => pending.delivery = _Delivery.failed);
      // A ticket resolved meanwhile refuses replies; reading it again brings
      // the resolved note in place of the composer.
      final status = error is SupportApiException ? error.statusCode : null;
      if (status != null && status >= 400 && status < 500) {
        unawaited(_load());
      }
    }
  }

  void _retry(_Pending pending) {
    if (pending.delivery != _Delivery.failed) return;
    if (_ticketId == null) {
      setState(() => pending.delivery = _Delivery.waiting);
      if (_draftFailed) unawaited(_create());
      return;
    }
    unawaited(_deliver(pending));
  }

  Future<void> _offerDelete({_Pending? pending}) async {
    final draft = pending == null;
    final remove = await showModalBottomSheet<bool>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) => SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: ListTile(
            key: const ValueKey('support-delete-message'),
            leading: const Icon(
              Icons.delete_outline_rounded,
              color: Color(0xFFFB2C36),
            ),
            title: Text(
              draft ? 'Delete ticket' : 'Delete message',
              style: const TextStyle(
                fontFamily: 'Sora',
                color: Color(0xFFFB2C36),
                fontSize: 15,
                fontWeight: FontWeight.w600,
              ),
            ),
            onTap: () => Navigator.of(sheetContext).pop(true),
          ),
        ),
      ),
    );
    if (remove != true || !mounted) return;
    if (draft) {
      // Nothing reached the server: leaving is the whole of deleting it.
      Navigator.of(context).maybePop();
      return;
    }
    setState(() => _pending.remove(pending));
  }

  /// What the top bar and footer go by: the server's ticket, or the draft's
  /// stand-in while it is being raised.
  SupportTicket? get _ticket {
    final thread = _thread;
    if (thread != null) return thread.ticket;
    final draft = _draft;
    if (draft == null) return null;
    return SupportTicket(
      id: '',
      topic: draft.topic.key,
      topicLabel: draft.topic.label,
      status: SupportStatus.open,
      chip: 'Submitted',
      createdAt: _draftAt,
      lastMessageAt: _draftAt,
      lastMessagePreview: draft.text,
      unread: 0,
    );
  }

  @override
  Widget build(BuildContext context) {
    final ticket = _ticket;
    final draft = _draft;
    final ready = _thread != null || draft != null;
    return SupportScaffold(
      shell: widget.shell,
      title: 'Chat',
      compactBar: true,
      background: Colors.white,
      body: !ready
          ? _error == null
                ? const Center(
                    child: SizedBox(
                      width: 22,
                      height: 22,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  )
                : _ThreadError(message: _error!, onRetry: _load)
          : _ThreadList(
              topicLabel: ticket!.topicLabel,
              messages: _thread?.messages ?? const [],
              draft: draft == null
                  ? null
                  : _PendingView(
                      text: draft.text,
                      files: draft.files,
                      at: _draftAt,
                      failed: _draftFailed,
                      onRetry: _draftFailed ? _create : null,
                      onDelete: _draftFailed ? () => _offerDelete() : null,
                    ),
              pending: [
                for (final pending in _pending)
                  _PendingView(
                    key: ValueKey('support-pending-${pending.tempId}'),
                    text: pending.text,
                    files: pending.files,
                    at: pending.at,
                    failed: pending.delivery == _Delivery.failed,
                    onRetry: () => _retry(pending),
                    onDelete: () => _offerDelete(pending: pending),
                  ),
              ],
              controller: _scroll,
            ),
      footer: ticket == null
          ? null
          : ticket.resolved
          ? const _ResolvedNote()
          : _Composer(
              controller: _text,
              files: _files,
              canSend: _canSend,
              onAdd: _addFiles,
              onSend: _send,
              onRemoveFile: (index) => setState(() => _files.removeAt(index)),
            ),
    );
  }
}

/// A message of the person's own not yet confirmed by the server: shown as
/// sent, or with the retry marker once it has failed.
class _PendingView {
  const _PendingView({
    this.key,
    required this.text,
    required this.files,
    required this.at,
    required this.failed,
    required this.onRetry,
    required this.onDelete,
  });

  final Key? key;
  final String text;
  final List<SupportUpload> files;
  final DateTime at;
  final bool failed;
  final VoidCallback? onRetry;
  final VoidCallback? onDelete;
}

class _ThreadList extends StatelessWidget {
  const _ThreadList({
    required this.topicLabel,
    required this.messages,
    required this.pending,
    required this.controller,
    this.draft,
  });

  final String topicLabel;
  final List<SupportMessage> messages;

  /// The ticket's opening request while it is still being raised.
  final _PendingView? draft;
  final List<_PendingView> pending;
  final ScrollController controller;

  @override
  Widget build(BuildContext context) {
    final requestIndex = messages.indexWhere(
      (m) => m.side == SupportSide.employee,
    );
    final maxBubble = math.min(
      254.0,
      (MediaQuery.sizeOf(context).width - 32) * .72,
    );
    final children = <Widget>[];
    DateTime? previous;
    void divider(DateTime at) {
      if (previous != null && !_sameDay(previous!, at)) {
        children.add(_DayDivider(date: at));
      }
      previous = at;
    }

    Widget pendingBubble(_PendingView view, {required bool request}) {
      final body = request
          ? _RequestText(
              topic: topicLabel,
              text: view.text,
              attachments: view.files.isEmpty
                  ? null
                  : _LocalAttachments(files: view.files),
            )
          : _PendingBody(text: view.text, files: view.files);
      return KeyedSubtree(
        key: view.key,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: view.failed ? view.onRetry : null,
          onLongPress: view.failed ? view.onDelete : null,
          child: _Bubble(
            mine: true,
            maxWidth: maxBubble,
            time: supportTime(view.at),
            failed: view.failed,
            padding: request
                ? const EdgeInsets.all(16)
                : const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: body,
          ),
        ),
      );
    }

    if (draft case final request?) {
      divider(request.at);
      children.add(pendingBubble(request, request: true));
    }
    for (final (index, message) in messages.indexed) {
      divider(message.createdAt);
      final Widget item = switch (message.side) {
        SupportSide.employee => _Bubble(
          mine: true,
          maxWidth: maxBubble,
          time: supportTime(message.createdAt),
          padding: index == requestIndex
              ? const EdgeInsets.all(16)
              : const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: index == requestIndex
              ? _RequestText(
                  topic: topicLabel,
                  text: message.text,
                  attachments: message.attachments.isEmpty
                      ? null
                      : _AttachmentChips(
                          attachments: message.attachments,
                          mine: true,
                        ),
                )
              : _MessageBody(message: message, mine: true),
        ),
        SupportSide.staff => _Bubble(
          mine: false,
          maxWidth: maxBubble,
          time:
              '${message.senderLabel.isEmpty ? 'HR team' : message.senderLabel}'
              ' · ${supportTime(message.createdAt)}',
          child: _MessageBody(message: message, mine: false),
        ),
        // The desk's automatic reply.
        SupportSide.system => _Bubble(
          mine: false,
          maxWidth: maxBubble,
          time: supportTime(message.createdAt),
          child: _MessageBody(message: message, mine: false),
        ),
      };
      children.add(
        KeyedSubtree(
          key: ValueKey('support-message-${message.id}'),
          child: item,
        ),
      );
    }
    for (final view in pending) {
      divider(view.at);
      children.add(pendingBubble(view, request: false));
    }
    return ListView(
      controller: controller,
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 20),
      children: children,
    );
  }
}

bool _sameDay(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;

const _bubbleText = TextStyle(
  fontFamily: 'Sora',
  fontSize: 16,
  height: 24 / 16,
  letterSpacing: -0.16,
);

class _Bubble extends StatelessWidget {
  const _Bubble({
    required this.mine,
    required this.maxWidth,
    required this.time,
    required this.child,
    this.padding = const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
    this.failed = false,
  });

  final bool mine;
  final double maxWidth;
  final String time;
  final Widget child;
  final EdgeInsets padding;

  /// Did not reach the server: the time gives way to the retry marker.
  final bool failed;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 9),
      child: Column(
        crossAxisAlignment: mine
            ? CrossAxisAlignment.end
            : CrossAxisAlignment.start,
        children: [
          ConstrainedBox(
            constraints: BoxConstraints(maxWidth: maxWidth),
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: mine
                    ? SupportStyle.bubbleMine
                    : SupportStyle.bubbleTheirs,
                borderRadius: BorderRadius.circular(20),
              ),
              child: Padding(padding: padding, child: child),
            ),
          ),
          const SizedBox(height: 5),
          Padding(
            padding: EdgeInsets.only(left: mine ? 0 : 8, right: mine ? 8 : 0),
            child: failed
                ? const Row(
                    key: ValueKey('support-not-sent'),
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.error_outline_rounded,
                        size: 13,
                        color: Color(0xFFFB2C36),
                      ),
                      SizedBox(width: 4),
                      Text(
                        'Not sent · Tap to retry',
                        style: TextStyle(
                          fontFamily: 'Sora',
                          color: Color(0xFFFB2C36),
                          fontSize: 12,
                          height: 16 / 12,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  )
                : Text(
                    time,
                    style: const TextStyle(
                      fontFamily: 'Sora',
                      color: SupportStyle.time,
                      fontSize: 12,
                      height: 16 / 12,
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

/// The ticket as it was raised: Type, Comment and any Attachment.
class _RequestText extends StatelessWidget {
  const _RequestText({
    required this.topic,
    required this.text,
    required this.attachments,
  });

  final String topic;
  final String text;

  /// The files under "Attachment:", or null when there are none.
  final Widget? attachments;

  @override
  Widget build(BuildContext context) {
    const bold = TextStyle(fontWeight: FontWeight.w600);
    final files = attachments;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text.rich(
          TextSpan(
            children: [
              const TextSpan(text: 'Type: ', style: bold),
              TextSpan(text: topic),
              const TextSpan(text: '\nComment: ', style: bold),
              TextSpan(text: text),
              if (files != null)
                const TextSpan(text: '\nAttachment:', style: bold),
            ],
          ),
          style: _bubbleText.copyWith(color: Colors.white),
        ),
        if (files != null) ...[const SizedBox(height: 12), files],
      ],
    );
  }
}

/// A reply of the person's own on its way: the text, and the files as they
/// are on the phone.
class _PendingBody extends StatelessWidget {
  const _PendingBody({required this.text, required this.files});

  final String text;
  final List<SupportUpload> files;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (text.isNotEmpty)
          Text(text, style: _bubbleText.copyWith(color: Colors.white)),
        if (files.isNotEmpty) ...[
          if (text.isNotEmpty) const SizedBox(height: 8),
          Padding(
            padding: EdgeInsets.symmetric(vertical: text.isEmpty ? 4 : 0),
            child: _LocalAttachments(files: files),
          ),
        ],
      ],
    );
  }
}

/// Files not yet on the server: photos as thumbnails from the phone, other
/// documents as the same chip the thread uses.
class _LocalAttachments extends StatelessWidget {
  const _LocalAttachments({required this.files});

  final List<SupportUpload> files;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final file in files)
          if (_isImage(file))
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: SizedBox(width: 64, height: 64, child: _thumbnail(file)),
            )
          else
            _FileChip(name: file.name, image: false, mine: true),
      ],
    );
  }

  static bool _isImage(SupportUpload file) =>
      file.mediaType.type == 'image' &&
      (file.bytes != null || file.path != null);

  static Widget _thumbnail(SupportUpload file) {
    Widget fallback(BuildContext context, Object error, StackTrace? stack) =>
        const ColoredBox(
          color: Color(0xFF0750C0),
          child: Icon(Icons.image_outlined, color: Colors.white, size: 22),
        );
    final bytes = file.bytes;
    if (bytes != null) {
      return Image.memory(
        bytes,
        fit: BoxFit.cover,
        cacheWidth: 192,
        errorBuilder: fallback,
      );
    }
    return Image.file(
      File(file.path!),
      fit: BoxFit.cover,
      cacheWidth: 192,
      errorBuilder: fallback,
    );
  }
}

class _MessageBody extends StatelessWidget {
  const _MessageBody({required this.message, required this.mine});

  final SupportMessage message;
  final bool mine;

  @override
  Widget build(BuildContext context) {
    final text = message.text.trim();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (text.isNotEmpty)
          Text(
            text,
            style: _bubbleText.copyWith(
              color: mine ? Colors.white : const Color(0xFF101828),
            ),
          ),
        if (message.attachments.isNotEmpty) ...[
          if (text.isNotEmpty) const SizedBox(height: 8),
          Padding(
            padding: EdgeInsets.symmetric(vertical: text.isEmpty ? 4 : 0),
            child: _AttachmentChips(
              attachments: message.attachments,
              mine: mine,
            ),
          ),
        ],
      ],
    );
  }
}

class _AttachmentChips extends StatelessWidget {
  const _AttachmentChips({required this.attachments, required this.mine});

  final List<SupportAttachment> attachments;
  final bool mine;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final attachment in attachments)
          _FileChip(
            name: attachment.name,
            image: attachment.isImage,
            mine: mine,
            onTap: () => openSupportAttachment(context, attachment),
          ),
      ],
    );
  }
}

/// A file on a message, as the design's "Document Name" chip.
class _FileChip extends StatelessWidget {
  const _FileChip({
    required this.name,
    required this.image,
    required this.mine,
    this.onTap,
  });

  final String name;
  final bool image;
  final bool mine;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final foreground = mine ? Colors.white : const Color(0xFF101828);
    return Material(
      color: mine ? const Color(0xFF0750C0) : const Color(0xFFD1D5DB),
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          height: 32,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              SvgPicture.asset(
                image
                    ? 'assets/icons/post_type_media.svg'
                    : 'assets/icons/document_file.svg',
                width: 16,
                height: 16,
                colorFilter: ColorFilter.mode(foreground, BlendMode.srcIn),
              ),
              const SizedBox(width: 8),
              Flexible(
                child: Text(
                  name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontFamily: 'Sora',
                    color: foreground,
                    fontSize: 12,
                    height: 16 / 12,
                    fontWeight: FontWeight.w500,
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

class _DayDivider extends StatelessWidget {
  const _DayDivider({required this.date});

  final DateTime date;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 6, bottom: 18),
      child: Row(
        children: [
          const Expanded(
            child: Divider(thickness: 2, color: Color(0xFFE7E7E7)),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Text(
              supportDivider(date),
              style: const TextStyle(
                fontFamily: 'Sora',
                color: Color(0xFF331E36),
                fontSize: 10,
                height: 15 / 10,
              ),
            ),
          ),
          const Expanded(
            child: Divider(thickness: 2, color: Color(0xFFE7E7E7)),
          ),
        ],
      ),
    );
  }
}

class _Composer extends StatelessWidget {
  const _Composer({
    required this.controller,
    required this.files,
    required this.canSend,
    required this.onAdd,
    required this.onSend,
    required this.onRemoveFile,
  });

  final TextEditingController controller;
  final List<SupportUpload> files;
  final bool canSend;
  final VoidCallback onAdd;
  final VoidCallback onSend;
  final ValueChanged<int> onRemoveFile;

  @override
  Widget build(BuildContext context) {
    final bottom = math.max(18.0, MediaQuery.paddingOf(context).bottom);
    return Container(
      padding: EdgeInsets.fromLTRB(16, 18, 16, bottom),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: SupportStyle.line)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final (index, file) in files.indexed) ...[
            SupportFileRow(file: file, onRemove: () => onRemoveFile(index)),
            const SizedBox(height: 8),
          ],
          Container(
            constraints: const BoxConstraints(minHeight: 52),
            padding: const EdgeInsets.only(left: 16, right: 18),
            decoration: BoxDecoration(
              color: const Color(0xFFF3F4F6),
              borderRadius: BorderRadius.circular(26),
            ),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    key: const ValueKey('support-composer'),
                    controller: controller,
                    minLines: 1,
                    maxLines: 5,
                    textCapitalization: TextCapitalization.sentences,
                    style: _bubbleText.copyWith(color: const Color(0xFF101828)),
                    decoration: InputDecoration(
                      hintText: 'Type your message',
                      hintStyle: _bubbleText.copyWith(color: SupportStyle.time),
                      filled: false,
                      isCollapsed: true,
                      border: InputBorder.none,
                      enabledBorder: InputBorder.none,
                      focusedBorder: InputBorder.none,
                      contentPadding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                _ComposerIcon(
                  key: const ValueKey('support-attach'),
                  tooltip: 'Add a photo or document',
                  onTap: onAdd,
                  child: SvgPicture.asset(
                    'assets/icons/composer_add.svg',
                    width: 22,
                    height: 22,
                    colorFilter: const ColorFilter.mode(
                      SupportStyle.time,
                      BlendMode.srcIn,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                // Where the design has a microphone: voice notes are not in
                // phase 1, and the send button takes its place.
                _ComposerIcon(
                  key: const ValueKey('support-send'),
                  tooltip: 'Send',
                  onTap: canSend ? onSend : null,
                  child: Icon(
                    Icons.send_rounded,
                    size: 20,
                    color: canSend
                        ? SupportStyle.brand
                        : const Color(0xFFB4B9C2),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ComposerIcon extends StatelessWidget {
  const _ComposerIcon({
    super.key,
    required this.tooltip,
    required this.onTap,
    required this.child,
  });

  final String tooltip;
  final VoidCallback? onTap;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: InkResponse(
        onTap: onTap,
        radius: 20,
        child: SizedBox(width: 32, height: 32, child: Center(child: child)),
      ),
    );
  }
}

/// Resolved and read only (node 2901:33415).
class _ResolvedNote extends StatelessWidget {
  const _ResolvedNote();

  @override
  Widget build(BuildContext context) {
    final bottom = math.max(20.0, MediaQuery.paddingOf(context).bottom);
    return Container(
      padding: EdgeInsets.fromLTRB(16, 20, 16, bottom),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: Color(0xFFE8EAED))),
      ),
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 14, 16, 14),
        decoration: BoxDecoration(
          color: const Color(0xFFFFF2D4),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0xFFEBEBEB)),
        ),
        child: Row(
          children: [
            Image.asset(
              'assets/icons/support_resolved_check.png',
              width: 30,
              height: 34,
              fit: BoxFit.contain,
            ),
            const SizedBox(width: 10),
            const Expanded(
              child: Text(
                'This ticket has been marked as resolved by the support '
                'team. Please start a new ticket if you’d like to continue.',
                style: TextStyle(
                  fontFamily: 'Sora',
                  color: SupportStyle.body,
                  fontSize: 12,
                  height: 16 / 12,
                  fontWeight: FontWeight.w600,
                  letterSpacing: -0.16,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ThreadError extends StatelessWidget {
  const _ThreadError({required this.message, required this.onRetry});

  final String message;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
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
      ),
    );
  }
}
