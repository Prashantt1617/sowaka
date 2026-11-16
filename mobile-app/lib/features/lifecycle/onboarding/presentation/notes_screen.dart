import 'dart:async';

import 'package:flutter/material.dart';

import '../../../shared/app_toast.dart';
import '../data/onboarding_api.dart';
import '../data/onboarding_models.dart';
import 'onboarding_kit.dart';

/// A10 · notes from the 1:1 the manager chose to share (6Zs §5.3): reply,
/// or "Got it" (seen is recorded). Unshared notes never reach this screen.
class NotesScreen extends StatefulWidget {
  const NotesScreen({super.key, required this.shell});

  final OnboardingShell shell;

  @override
  State<NotesScreen> createState() => _NotesScreenState();
}

class _NotesScreenState extends State<NotesScreen> {
  List<OneOnOneNote>? _notes;
  String? _error;
  final _reply = TextEditingController();
  bool _busy = false;

  OnboardingShell get _shell => widget.shell;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _reply.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final notes = await _shell.api.fetchNotes();
      if (mounted) {
        setState(() {
          _notes = notes;
          _error = null;
        });
      }
    } catch (error) {
      if (mounted) setState(() => _error = onboardingErrorText(error));
    }
  }

  Future<void> _act(OneOnOneNote note, String action, {String? text}) async {
    setState(() => _busy = true);
    try {
      await _shell.api.noteAction(note.id, action, text: text);
      if (action == 'reply') _reply.clear();
      await _load();
    } catch (error) {
      if (mounted) showAppToast(context, onboardingErrorText(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final notes = _notes;
    final latest = notes == null || notes.isEmpty ? null : notes.first;
    final who = latest?.authorName?.split(' ').first;
    final whoOr = who ?? 'your manager';
    return OnbScaffold(
      shell: _shell,
      title: who == null ? 'Notes from your 1:1' : 'Notes from $who',
      body: notes == null
          ? OnbLoadState(error: _error, onRetry: _load)
          : notes.isEmpty
          ? const Padding(
              padding: EdgeInsets.all(24),
              child: Text('No shared notes yet. When your manager shares notes from your 1:1, they show here.', style: OnbText.body),
            )
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 18, 16, 24),
              children: [
                Text('From your 1:1 with $whoOr', style: OnbText.h1),
                if ((latest!.sharedAt ?? latest.createdAt) case final at?)
                  Text('${onbDay(at)} · ${who ?? 'They'} chose to share these with you', style: OnbText.label),
                const SizedBox(height: 14),
                for (final note in notes) ...[
                  _NoteCard(note: note),
                  const SizedBox(height: 12),
                ],
                const Text('Your reply', style: OnbText.bodyStrong),
                const SizedBox(height: 4),
                for (final reply in latest.replies.where((r) => r.mine))
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: OnbCard(
                      color: OnbColors.tint,
                      borderColor: OnbColors.tint,
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(reply.text, style: OnbText.body),
                          if (reply.at != null) Text(onbDayTime(reply.at!), style: OnbText.label),
                        ],
                      ),
                    ),
                  ),
                if (latest.replies.where((r) => r.mine).isEmpty)
                  Text(
                    'Add anything you’d like $whoOr to know. Only the two of you and HR see this.',
                    style: OnbText.label,
                  ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: Semantics(
                        label: 'Reply to $whoOr',
                        child: OnbTextArea(
                          fieldKey: const ValueKey('note-reply'),
                          controller: _reply,
                          hint: 'Write a reply',
                          minLines: 1,
                          onChanged: (_) => setState(() {}),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    IconButton.filled(
                      key: const ValueKey('note-send'),
                      tooltip: 'Send reply',
                      style: IconButton.styleFrom(backgroundColor: OnbColors.primary),
                      onPressed: _busy || _reply.text.trim().isEmpty
                          ? null
                          : () => _act(latest, 'reply', text: _reply.text.trim()),
                      icon: const Icon(Icons.send_rounded, color: Colors.white),
                    ),
                  ],
                ),
              ],
            ),
      footer: latest == null
          ? null
          : OnbFooter(
              children: [
                if (notes!.every((n) => n.seen))
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 16),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.check_rounded, color: OnbColors.doneText),
                        SizedBox(width: 6),
                        Text('Marked as read', style: TextStyle(fontFamily: 'Sora', color: OnbColors.doneText, fontWeight: FontWeight.w600)),
                      ],
                    ),
                  )
                else
                  OnbPrimaryButton(
                    key: const ValueKey('notes-got-it'),
                    label: 'Got it',
                    busy: _busy,
                    onTap: () async {
                      for (final note in notes.where((n) => !n.seen)) {
                        await _act(note, 'seen');
                      }
                    },
                  ),
              ],
            ),
    );
  }
}

class _NoteCard extends StatelessWidget {
  const _NoteCard({required this.note});

  final OneOnOneNote note;

  @override
  Widget build(BuildContext context) {
    final author = note.authorName ?? 'Your manager';
    final at = note.sharedAt ?? note.createdAt;
    return OnbCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              OnbAvatar(name: author, size: 32),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  [author, if (at != null) 'Shared ${onbDayTime(at)}'].join(' · '),
                  style: OnbText.label,
                ),
              ),
              if (!note.seen) const OnbTag('New', tone: OnbTone.count),
            ],
          ),
          const SizedBox(height: 10),
          Text(note.text, style: OnbText.body.copyWith(color: OnbColors.text)),
          for (final reply in note.replies.where((r) => !r.mine)) ...[
            const SizedBox(height: 8),
            Text('${reply.byName ?? author}: ${reply.text}', style: OnbText.label),
          ],
        ],
      ),
    );
  }
}
