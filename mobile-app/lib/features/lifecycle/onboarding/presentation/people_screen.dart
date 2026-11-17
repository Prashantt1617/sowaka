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
    final look = _looks[_at % _looks.length];
    return OnbScaffold(
      shell: _shell,
      title: 'People to meet',
      showNav: false,
      background: Colors.white,
      body: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    _closed
                        ? 'People to meet closed'
                        : meetBy == null
                        ? 'Meet them this month'
                        : 'Meet them by ${onbDay(meetBy)}',
                    style: const TextStyle(fontFamily: 'Sora', fontSize: 12, fontWeight: FontWeight.w600, color: OnbColors.text3),
                  ),
                ),
                Text(
                  '$met of ${people.length} met',
                  key: const ValueKey('people-count'),
                  style: const TextStyle(fontFamily: 'Sora', fontSize: 12, fontWeight: FontWeight.w700, color: OnbColors.primary),
                ),
              ],
            ),
            if (_closed) ...[
              const SizedBox(height: 2),
              const Text('It closed at the end of month 1. You can still say hi to the ones you didn’t meet.', style: OnbText.label),
            ],
            const SizedBox(height: 14),
            // One tile per person: met ✓ green, this one outlined, the rest grey.
            Row(
              children: [
                for (var index = 0; index < people.length; index++) ...[
                  if (index > 0) const SizedBox(width: 6),
                  Expanded(child: _PersonTile(person: people[index], current: index == _at, onTap: () => setState(() => _at = index))),
                ],
              ],
            ),
            const SizedBox(height: 14),
            Expanded(
              child: OnbRise(
                key: ValueKey('person-${person.id}'),
                child: Container(
                  decoration: BoxDecoration(color: look.bg, borderRadius: BorderRadius.circular(28)),
                  padding: const EdgeInsets.fromLTRB(20, 24, 20, 18),
                  child: Column(
                    children: [
                      Expanded(
                        child: SingleChildScrollView(
                          child: Column(
                            children: [
                              person.photoUrl != null && person.photoUrl!.isNotEmpty
                                  ? OnbAvatar(name: person.name, photoUrl: person.photoUrl, size: 104)
                                  : Container(
                                      width: 104,
                                      height: 104,
                                      decoration: BoxDecoration(color: look.avatar, shape: BoxShape.circle),
                                      alignment: Alignment.center,
                                      child: Text(
                                        OnbAvatar.initials(person.name).substring(0, 1),
                                        style: const TextStyle(fontFamily: 'Sora', fontSize: 40, fontWeight: FontWeight.w800, color: Colors.white),
                                      ),
                                    ),
                              const SizedBox(height: 10),
                              Text(
                                person.name,
                                textAlign: TextAlign.center,
                                style: const TextStyle(fontFamily: 'Sora', fontSize: 26, fontWeight: FontWeight.w800, letterSpacing: -0.52, color: OnbColors.text),
                              ),
                              const SizedBox(height: 6),
                              Text(
                                [person.designation, meetingRoleLabel(person.role)].nonNulls.join(' · '),
                                textAlign: TextAlign.center,
                                style: const TextStyle(fontFamily: 'Sora', fontSize: 13, color: OnbColors.text2),
                              ),
                              if (person.why != null) ...[
                                const SizedBox(height: 16),
                                Container(
                                  width: double.infinity,
                                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                                  decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18)),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      const Text(
                                        'WHY MEET',
                                        style: TextStyle(fontFamily: 'Sora', fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: 0.9, color: OnbColors.primary),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(person.why!, style: const TextStyle(fontFamily: 'Sora', fontSize: 14, height: 1.5, color: OnbColors.text)),
                                    ],
                                  ),
                                ),
                              ],
                              if (person.met) ...[
                                const SizedBox(height: 12),
                                const OnbTag('Met', tone: OnbTone.done, icon: Icons.check_rounded),
                              ] else if (_closed) ...[
                                const SizedBox(height: 12),
                                const OnbTag('Not met', tone: OnbTone.locked, key: ValueKey('not-met')),
                              ],
                            ],
                          ),
                        ),
                      ),
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
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 14),
          ],
        ),
      ),
      footer: person.met || _closed
          ? null
          : OnbFooter(
              children: [
                Row(
                  children: [
                    // "Not yet" is the smaller choice, as drawn.
                    SizedBox(
                      width: 108,
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

  /// Each person's colours, in order, as the artboard paints them.
  static const _looks = [
    (avatar: OnbColors.primary, bg: OnbColors.tint),
    (avatar: OnbColors.green, bg: OnbColors.doneTint),
    (avatar: Color(0xFFFF6B6B), bg: Color(0xFFFFF0F0)),
    (avatar: Color(0xFF8A63D2), bg: Color(0xFFF3EEFF)),
    (avatar: Color(0xFFE39B17), bg: OnbColors.mustTint),
    (avatar: Color(0xFF0B8A8A), bg: Color(0xFFE6F6F6)),
  ];

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

/// A6's strip: a tile per person, ✓ on green once met, outlined while open.
class _PersonTile extends StatelessWidget {
  const _PersonTile({required this.person, required this.current, required this.onTap});

  final PersonToMeet person;
  final bool current;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final met = person.met;
    final bg = met ? OnbColors.green : (current ? OnbColors.tint : OnbColors.screen);
    final fg = met ? Colors.white : (current ? OnbColors.primary : OnbColors.icon);
    return Semantics(
      button: true,
      selected: current,
      label: '${person.name}${met ? ', met' : ''}',
      child: ExcludeSemantics(
        child: Material(
          color: bg,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: current && !met ? const BorderSide(color: OnbColors.primary, width: 2) : BorderSide.none,
          ),
          child: InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: onTap,
            child: SizedBox(
              height: 44,
              child: Center(
                child: met
                    ? const Icon(Icons.check_rounded, size: 18, color: Colors.white)
                    : Text(
                        OnbAvatar.initials(person.name).substring(0, 1),
                        style: TextStyle(fontFamily: 'Sora', fontSize: 13, fontWeight: FontWeight.w700, color: fg),
                      ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
