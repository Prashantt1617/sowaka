import 'dart:async';

import 'package:flutter/material.dart';

import '../../../profile/profile_launcher.dart';
import '../../../shared/app_toast.dart';
import '../data/onboarding_api.dart';
import '../data/onboarding_models.dart';
import 'links.dart';
import 'onboarding_kit.dart';

/// A3 · a joining-week meeting (6Zs §5.3): when, where, who, what to
/// expect and "Add to calendar"; once its time has come (A3b), "Did you
/// meet?" — Yes ticks it, "It moved" asks for the new time.
class MeetingScreen extends StatefulWidget {
  const MeetingScreen({super.key, required this.shell, required this.meetingId, this.task});

  final OnboardingShell shell;
  final String meetingId;
  final TaskView? task;

  @override
  State<MeetingScreen> createState() => _MeetingScreenState();
}

class _MeetingScreenState extends State<MeetingScreen> {
  Meeting? _meeting;
  String? _error;
  bool _busy = false;

  OnboardingShell get _shell => widget.shell;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final meeting = await _shell.api.fetchMeeting(widget.meetingId);
      if (mounted) {
        setState(() {
          _meeting = meeting;
          _error = null;
        });
      }
    } catch (error) {
      if (mounted) setState(() => _error = onboardingErrorText(error));
    }
  }

  Future<void> _answer(String met, {DateTime? newTime}) async {
    setState(() => _busy = true);
    try {
      final updated = await _shell.api.answerMeeting(widget.meetingId, met, newTime: newTime);
      if (!mounted) return;
      if (updated != null) {
        setState(() => _meeting = updated);
      } else {
        await _load();
      }
      if (met == 'moved' && mounted) showAppToast(context, 'New time saved');
    } catch (error) {
      if (mounted) showAppToast(context, onboardingErrorText(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _moved() async {
    final now = _shell.now();
    final day = await showDatePicker(
      context: context,
      initialDate: now,
      firstDate: dateOnly(now),
      lastDate: now.add(const Duration(days: 60)),
      helpText: 'When is it now?',
    );
    if (day == null || !mounted) return;
    final time = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(now));
    if (time == null || !mounted) return;
    await _answer('moved', newTime: DateTime(day.year, day.month, day.day, time.hour, time.minute));
  }

  @override
  Widget build(BuildContext context) {
    final meeting = _meeting;
    return OnbScaffold(
      shell: _shell,
      title: 'Meeting',
      body: meeting == null ? OnbLoadState(error: _error, onRetry: _load) : _body(meeting),
      footer: meeting == null || _started(meeting)
          ? null
          : OnbFooter(
              children: [
                OnbPrimaryButton(
                  label: 'Add to calendar',
                  onTap: () => openExternalLink(
                    context,
                    calendarEventUri(
                      title: meeting.title,
                      start: meeting.newTime ?? meeting.startsAt,
                      end: meeting.newTime == null ? meeting.endsAt : null,
                      place: meeting.place ?? meeting.link,
                    ).toString(),
                  ),
                ),
              ],
            ),
    );
  }

  bool _started(Meeting meeting) {
    final start = meeting.newTime ?? meeting.startsAt;
    return start != null && !_shell.now().isBefore(start);
  }

  String _eyebrow(Meeting meeting) {
    final now = _shell.now();
    final start = meeting.newTime ?? meeting.startsAt;
    final mustDo = meeting.mustDo || (widget.task?.mustDo ?? false);
    final parts = <String>[];
    if (start == null) {
      parts.add('ANY TIME');
    } else {
      final day = onbRelativeDay(start, now).toUpperCase();
      parts.add(day);
      final minutes = start.difference(now).inMinutes;
      if (minutes > 0 && minutes <= 120) {
        parts.add(minutes < 60 ? 'IN $minutes MIN' : 'IN ${(minutes / 60).floor()} H ${minutes % 60} MIN');
      } else if (minutes <= 0 && calendarDaysBetween(start, now) == 0) {
        parts.add('STARTED ${onbTime(start)}');
      }
    }
    if (mustDo) parts.add('MUST-DO');
    return parts.join(' · ');
  }

  Widget _body(Meeting meeting) {
    final start = meeting.newTime ?? meeting.startsAt;
    final end = meeting.newTime == null ? meeting.endsAt : null;
    final viewer = _shell.api.viewerId;
    final people = meeting.attendees.where((p) => p.userId != viewer && p.role != 'joiner').toList();
    final firstName = people.isEmpty ? null : people.first.name.split(' ').first;
    final expect = meeting.expect.isNotEmpty ? meeting.expect : _defaultExpect(meeting.systemKey ?? widget.task?.systemKey);
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 18, 16, 24),
      children: [
        Text(_eyebrow(meeting), style: OnbText.eyebrow),
        const SizedBox(height: 6),
        Text(meeting.title, style: OnbText.display),
        const SizedBox(height: 16),
        OnbCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Fact(
                label: 'WHEN',
                value: start == null ? 'Any time' : (end == null ? onbTime(start) : '${onbTime(start)} – ${onbTime(end)}'),
              ),
              if (meeting.place != null || meeting.link != null) ...[
                const Divider(height: 24, color: OnbColors.line),
                _Fact(label: 'WHERE', value: meeting.place ?? 'Online'),
                if (meeting.withWho != null && people.isEmpty) ...[
                  const SizedBox(height: 6),
                  Text('With ${meeting.withWho}', style: OnbText.label),
                ],
                if (meeting.link != null)
                  OnbLink(label: 'Join the call', icon: Icons.videocam_outlined, onTap: () => openExternalLink(context, meeting.link!)),
              ],
              for (final person in people) ...[
                const Divider(height: 24, color: OnbColors.line),
                Row(
                  children: [
                    _Avatar(name: person.name, photoUrl: person.photoUrl),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(person.name, style: OnbText.bodyStrong),
                          Text(
                            [person.designation, meetingRoleLabel(person.role)].nonNulls.join(' · '),
                            style: OnbText.label,
                          ),
                        ],
                      ),
                    ),
                    if (canOpenPersonProfile && person.userId.isNotEmpty)
                      OnbLink(label: 'Profile', onTap: () => openPersonProfile(person.userId)),
                  ],
                ),
              ],
            ],
          ),
        ),
        if (expect.isNotEmpty) ...[
          const SizedBox(height: 18),
          const Text('What to expect', style: OnbText.bodyStrong),
          const SizedBox(height: 8),
          for (final line in expect)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Padding(
                    padding: EdgeInsets.only(top: 7, right: 10),
                    child: CircleAvatar(radius: 3, backgroundColor: OnbColors.primary),
                  ),
                  Expanded(child: Text(line, style: OnbText.body)),
                ],
              ),
            ),
        ],
        if (_started(meeting)) ...[
          const SizedBox(height: 18),
          if (meeting.canConfirm)
            _didYouMeet(meeting, firstName)
          else
            OnbCard(
              key: const ValueKey('meeting-not-yours'),
              color: OnbColors.screen,
              child: Text(
                '${widget.task?.doneBy ?? 'HR'} marks this one done. Nothing for you to tick.',
                style: OnbText.body,
              ),
            ),
        ],
      ],
    );
  }

  Widget _didYouMeet(Meeting meeting, String? name) {
    if (meeting.met == 'yes') {
      return OnbCard(
        key: const ValueKey('meeting-done'),
        color: OnbColors.doneTint,
        borderColor: OnbColors.doneTint,
        child: Row(
          children: [
            const Icon(Icons.check_circle_rounded, color: OnbColors.doneText),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                name == null ? 'Done · Notes will show here if they’re shared' : 'Done · $name’s notes will show here if they share them',
                style: OnbText.bodyStrong.copyWith(color: OnbColors.doneText),
              ),
            ),
          ],
        ),
      );
    }
    return OnbCard(
      key: const ValueKey('did-you-meet'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(name == null ? 'Did you meet?' : 'Did you meet $name?', style: OnbText.h1),
          if (meeting.met == 'moved' && meeting.newTime != null) ...[
            const SizedBox(height: 4),
            Text('Moved to ${onbDayTime(meeting.newTime!)}', style: OnbText.label),
          ],
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(child: OnbSecondaryButton(label: 'It moved', height: 48, onTap: _busy ? null : _moved)),
              const SizedBox(width: 10),
              Expanded(
                child: SizedBox(
                  height: 48,
                  child: FilledButton(
                    key: const ValueKey('meeting-yes'),
                    onPressed: _busy ? null : () => _answer('yes'),
                    style: FilledButton.styleFrom(
                      backgroundColor: OnbColors.primary,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    ),
                    child: const Text('Yes, done'),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  static List<String> _defaultExpect(String? systemKey) => switch (systemKey) {
    'meet_manager' => const [
      'How your first week will go and who to meet',
      'Your probation goals, and what good looks like by month 1',
      'Bring any questions, nothing to prepare',
    ],
    'meet_team' => const ['Say hello to the people you’ll work with', 'Nothing to prepare'],
    'welcome_induction' => const ['Your first morning: the company, the office and the tools', 'Bring your ID'],
    'vision_culture' => const ['Where the company is going and how we work'],
    _ => const [],
  };
}

class _Fact extends StatelessWidget {
  const _Fact({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(label, style: OnbText.eyebrow),
      const SizedBox(height: 4),
      Text(value, style: OnbText.bodyStrong),
    ],
  );
}

class _Avatar extends StatelessWidget {
  const _Avatar({required this.name, this.photoUrl});

  final String name;
  final String? photoUrl;

  @override
  Widget build(BuildContext context) => OnbAvatar(name: name, photoUrl: photoUrl, size: 40);
}
