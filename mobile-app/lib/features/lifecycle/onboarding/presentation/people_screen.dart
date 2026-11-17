import 'dart:async';

import 'package:flutter/material.dart';

import '../../../shared/app_toast.dart';
import '../data/onboarding_api.dart';
import '../data/onboarding_models.dart';
import 'links.dart';
import 'onboarding_kit.dart';
import 'plant.dart';

/// A6 · People to meet (6Zs §5.3): the six the manager picked, one card at
/// a time — who, role, why meet, Book 15 minutes. "We met" fills the card,
/// "Not yet" moves on; all six met is a leaf.
class PeopleToMeetScreen extends StatefulWidget {
  const PeopleToMeetScreen({super.key, required this.shell, this.dueAt});

  final OnboardingShell shell;
  final DateTime? dueAt;

  @override
  State<PeopleToMeetScreen> createState() => _PeopleToMeetScreenState();
}

class _PeopleToMeetScreenState extends State<PeopleToMeetScreen> {
  List<PersonToMeet>? _people;
  DateTime? _meetBy;
  bool _closed = false;
  String? _managerName;
  String? _error;
  int _at = 0;
  bool _busy = false;

  OnboardingShell get _shell => widget.shell;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final view = await _shell.api.fetchPeopleView();
      final people = view.people;
      if (!mounted) return;
      setState(() {
        _people = people;
        // The server's day, so it holds when this opens from a push too.
        _meetBy = view.meetBy;
        _closed = view.closed;
        _managerName = view.managerName;
        _error = null;
        final first = people.indexWhere((p) => !p.met);
        _at = first < 0 ? 0 : first;
      });
    } catch (error) {
      if (mounted) setState(() => _error = onboardingErrorText(error));
    }
  }

  /// The next one not yet met after [from], wrapping round; [from] itself
  /// when it is the only one left.
  int _nextUnmet(List<PersonToMeet> people, int from) {
    for (var step = 1; step <= people.length; step++) {
      final index = (from + step) % people.length;
      if (!people[index].met) return index;
    }
    return from;
  }

  Future<void> _mark(String action) async {
    final people = _people!;
    final person = people[_at];
    setState(() => _busy = true);
    try {
      var updated = await _shell.api.markPerson(person.id, action);
      updated ??= action == 'met'
          ? [
              for (final p in people)
                p.id == person.id
                    ? PersonToMeet(
                        id: p.id,
                        userId: p.userId,
                        name: p.name,
                        designation: p.designation,
                        photoUrl: p.photoUrl,
                        why: p.why,
                        role: p.role,
                        metAt: _shell.now(),
                      )
                    : p,
            ]
          : people;
      if (!mounted) return;
      setState(() {
        _people = updated;
        _at = _nextUnmet(updated!, _at);
      });
    } catch (error) {
      if (mounted) showAppToast(context, onboardingErrorText(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final people = _people;
    if (people == null) {
      return OnbScaffold(shell: _shell, title: 'People to meet', body: OnbLoadState(error: _error, onRetry: _load));
    }
    final met = people.where((p) => p.met).length;
    final allMet = people.isNotEmpty && met == people.length;
    if (people.isEmpty) {
      return OnbScaffold(
        shell: _shell,
        title: 'People to meet',
        body: const Padding(
          padding: EdgeInsets.all(24),
          child: Text('Your manager is picking the people you’ll meet. They’ll show here.', style: OnbText.body),
        ),
      );
    }
    if (allMet) return _done(people.length);
    final person = people[_at];
    final meetBy = _meetBy ?? widget.dueAt;
    return OnbScaffold(
      shell: _shell,
      title: 'People to meet',
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 18, 16, 24),
        children: [
          Text(
            _closed
                ? 'People to meet closed'
                : meetBy == null
                ? 'Meet them this month'
                : 'Meet them by ${onbDay(meetBy)}',
            style: OnbText.h1,
          ),
          if (_closed) ...[
            const SizedBox(height: 2),
            const Text('It closed at the end of month 1. You can still say hi to the ones you didn’t meet.', style: OnbText.label),
          ],
          const SizedBox(height: 2),
          Text('$met of ${people.length} met', key: const ValueKey('people-count'), style: OnbText.label),
          const SizedBox(height: 14),
          SizedBox(
            height: 48,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: people.length,
              separatorBuilder: (_, _) => const SizedBox(width: 8),
              itemBuilder: (context, index) {
                final p = people[index];
                return GestureDetector(
                  onTap: () => setState(() => _at = index),
                  child: Stack(
                    clipBehavior: Clip.none,
                    children: [
                      OnbAvatar(
                        name: p.name,
                        photoUrl: p.photoUrl,
                        size: 44,
                        ring: index == _at ? OnbColors.primary : (p.met ? OnbColors.green : null),
                      ),
                      if (p.met)
                        const Positioned(
                          right: -2,
                          bottom: -2,
                          child: CircleAvatar(
                            radius: 9,
                            backgroundColor: OnbColors.green,
                            child: Icon(Icons.check_rounded, size: 12, color: Colors.white),
                          ),
                        ),
                    ],
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 16),
          OnbRise(
            key: ValueKey('person-${person.id}'),
            child: OnbCard(
              radius: 24,
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  OnbAvatar(name: person.name, photoUrl: person.photoUrl, size: 64),
                  const SizedBox(height: 12),
                  Text(person.name, style: OnbText.display),
                  Text([person.designation, meetingRoleLabel(person.role)].nonNulls.join(' · '), style: OnbText.label),
                  if (person.why != null) ...[
                    const SizedBox(height: 16),
                    const Text('WHY MEET', style: OnbText.eyebrow),
                    const SizedBox(height: 4),
                    Text(person.why!, style: OnbText.body),
                  ],
                  const SizedBox(height: 12),
                  OnbLink(
                    label: '📅 Book 15 minutes',
                    onTap: () => openExternalLink(
                      context,
                      calendarEventUri(
                        title: 'Meet ${person.name}',
                        start: null,
                        details: '15 minutes with ${person.name}',
                      ).toString(),
                    ),
                  ),
                  if (person.met) ...[
                    const SizedBox(height: 8),
                    const OnbTag('Met', tone: OnbTone.done, icon: Icons.check_rounded),
                  ] else if (_closed) ...[
                    const SizedBox(height: 8),
                    const OnbTag('Not met', tone: OnbTone.locked, key: ValueKey('not-met')),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
      footer: person.met || _closed
          ? null
          : OnbFooter(
              children: [
                Row(
                  children: [
                    Expanded(
                      child: OnbSecondaryButton(
                        key: const ValueKey('not-yet'),
                        label: 'Not yet',
                        onTap: _busy ? null : () => _mark('not_yet'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: OnbPrimaryButton(key: const ValueKey('we-met'), label: 'We met', busy: _busy, onTap: () => _mark('met')),
                    ),
                  ],
                ),
              ],
            ),
    );
  }

  Widget _done(int count) => OnbScaffold(
    shell: _shell,
    title: 'People to meet',
    body: ListView(
      key: const ValueKey('people-done'),
      padding: const EdgeInsets.fromLTRB(20, 40, 20, 24),
      children: [
        const Center(child: Plant(stage: 1, size: 120, leaves: 2)),
        const SizedBox(height: 12),
        Text('$count/$count', style: OnbText.displayXl(48), textAlign: TextAlign.center),
        const SizedBox(height: 6),
        const Text('You’ve met everyone', style: OnbText.display, textAlign: TextAlign.center),
        const SizedBox(height: 8),
        Text(
          'Your plant grew a leaf. ${_managerName?.split(' ').first ?? 'Your manager'} can see you’ve made the rounds.',
          style: OnbText.body,
          textAlign: TextAlign.center,
        ),
      ],
    ),
    footer: OnbFooter(children: [OnbPrimaryButton(label: 'Back to onboarding', onTap: () => Navigator.of(context).pop())]),
  );
}
