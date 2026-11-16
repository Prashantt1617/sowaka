import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../shared/app_toast.dart';
import '../../data/onboarding_api.dart';
import '../../data/onboarding_models.dart';
import '../onboarding_kit.dart';

/// The manager's set-up of a joiner (CONTRACT decision 10, the fields of
/// 6Zs §10): six people to meet, each with why; a buddy; a welcome note; the
/// probation goals — editable until Tj + 7, then locked and read-only.
class JoinerSetupScreen extends StatefulWidget {
  const JoinerSetupScreen({super.key, required this.shell, required this.journeyId, required this.detail});

  final OnboardingShell shell;
  final String journeyId;
  final JoinerDetail detail;

  static const maxGoals = 5;

  @override
  State<JoinerSetupScreen> createState() => _JoinerSetupScreenState();
}

class _JoinerSetupScreenState extends State<JoinerSetupScreen> {
  List<DirectoryPerson>? _directory;
  late final List<SetupPerson> _people = [...widget.detail.setup.people];
  late final Map<String, TextEditingController> _why = {
    for (final person in widget.detail.setup.people) person.userId: TextEditingController(text: person.why ?? ''),
  };
  late SetupPerson? _buddy = widget.detail.setup.buddy;
  late final _note = TextEditingController(text: widget.detail.setup.welcomeNote ?? '');
  late final List<TextEditingController> _goals = [
    for (final goal in widget.detail.setup.goals) TextEditingController(text: goal),
    if (widget.detail.setup.goals.isEmpty) TextEditingController(),
  ];
  bool _busy = false;

  OnboardingShell get _shell => widget.shell;
  JoinerSummary get _joiner => widget.detail.joiner;
  bool get _locked => widget.detail.goalsLockedOn(_shell.now());

  @override
  void initState() {
    super.initState();
    unawaited(_loadDirectory());
  }

  @override
  void dispose() {
    for (final c in _why.values) {
      c.dispose();
    }
    for (final c in _goals) {
      c.dispose();
    }
    _note.dispose();
    super.dispose();
  }

  Future<void> _loadDirectory() async {
    try {
      final people = await _shell.api.fetchDirectory();
      if (mounted) setState(() => _directory = people.where((p) => p.userId != _joiner.userId).toList());
    } catch (_) {
      if (mounted) setState(() => _directory = const []);
    }
  }

  String _nameOf(SetupPerson person) =>
      person.name ?? _directory?.where((p) => p.userId == person.userId).firstOrNull?.name ?? 'Someone';

  Future<DirectoryPerson?> _choose({required String title, Set<String> exclude = const {}}) =>
      showOnbSheet<DirectoryPerson>(
        context,
        builder: (_) => _PeoplePicker(
          title: title,
          people: [for (final p in _directory ?? const <DirectoryPerson>[]) if (!exclude.contains(p.userId)) p],
        ),
      );

  Future<void> _addPerson() async {
    final picked = await _choose(title: 'Someone to meet', exclude: {for (final p in _people) p.userId});
    if (picked == null || !mounted) return;
    setState(() {
      _people.add(SetupPerson(userId: picked.userId, name: picked.name, designation: picked.designation, photoUrl: picked.photoUrl));
      _why[picked.userId] = TextEditingController();
    });
  }

  Future<void> _chooseBuddy() async {
    final picked = await _choose(title: 'Choose a buddy');
    if (picked == null || !mounted) return;
    setState(() => _buddy = SetupPerson(userId: picked.userId, name: picked.name, designation: picked.designation));
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    try {
      await _shell.api.saveSetup(
        widget.journeyId,
        people: [
          for (final person in _people)
            SetupPerson(userId: person.userId, name: person.name, why: _why[person.userId]?.text.trim()),
        ],
        buddyUserId: _buddy?.userId,
        welcomeNote: _note.text.trim().isEmpty ? null : _note.text.trim(),
        // Locked goals are never sent: the server refuses them.
        goals: _locked ? null : [for (final c in _goals) if (c.text.trim().isNotEmpty) c.text.trim()],
      );
      if (!mounted) return;
      showAppToast(context, 'Saved');
      Navigator.of(context).pop();
    } catch (error) {
      if (mounted) showAppToast(context, onboardingErrorText(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final first = _joiner.firstName;
    final lockOn = probationGoalsLockDate(_joiner.tj);
    return OnbScaffold(
      shell: _shell,
      title: 'Set up $first',
      showNav: false,
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 18, 16, 24),
        children: [
          // People to meet.
          Row(
            children: [
              const Expanded(child: Text('People to meet', style: OnbText.h1)),
              Text('${_people.length} of ${JoinerSetup.peopleCount}', key: const ValueKey('setup-people-count'), style: OnbText.label),
            ],
          ),
          const SizedBox(height: 4),
          Text('They show up as cards in $first’s app. Say why each is worth meeting.', style: OnbText.label),
          const SizedBox(height: 10),
          for (final person in _people)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: OnbCard(
                radius: 16,
                padding: const EdgeInsets.all(12),
                child: Column(
                  children: [
                    Row(
                      children: [
                        OnbAvatar(name: _nameOf(person), photoUrl: person.photoUrl, size: 36),
                        const SizedBox(width: 10),
                        Expanded(child: Text(_nameOf(person), style: OnbText.bodyStrong)),
                        IconButton(
                          tooltip: 'Remove ${_nameOf(person)}',
                          icon: const Icon(Icons.close_rounded, color: OnbColors.icon),
                          onPressed: () => setState(() {
                            _people.removeWhere((p) => p.userId == person.userId);
                            _why.remove(person.userId)?.dispose();
                          }),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    OnbTextArea(controller: _why[person.userId]!, hint: 'Why meet (optional)', minLines: 1),
                  ],
                ),
              ),
            ),
          if (_people.length < JoinerSetup.peopleCount)
            OnbLink(
              key: const ValueKey('setup-add-person'),
              label: 'Add someone',
              icon: Icons.person_add_alt_outlined,
              onTap: _directory == null ? null : _addPerson,
            ),
          const SizedBox(height: 22),
          // Buddy.
          const Text('Buddy', style: OnbText.h1),
          const SizedBox(height: 4),
          const Text('Someone friendly, not their manager. Their go-to for “how do we do this here?”', style: OnbText.label),
          const SizedBox(height: 10),
          OnbCard(
            radius: 16,
            padding: const EdgeInsets.all(12),
            onTap: _directory == null ? null : _chooseBuddy,
            child: Row(
              children: [
                if (_buddy != null) ...[OnbAvatar(name: _nameOf(_buddy!), size: 36), const SizedBox(width: 10)],
                Expanded(child: Text(_buddy == null ? 'Choose a buddy' : _nameOf(_buddy!), style: OnbText.bodyStrong)),
                const Icon(Icons.chevron_right_rounded, color: OnbColors.icon),
              ],
            ),
          ),
          const SizedBox(height: 22),
          // Welcome note.
          const Text('Welcome note', style: OnbText.h1),
          const SizedBox(height: 4),
          Text('A few lines $first reads before joining.', style: OnbText.label),
          const SizedBox(height: 10),
          OnbTextArea(fieldKey: const ValueKey('setup-note'), controller: _note, hint: 'Looking forward to working with you…'),
          const SizedBox(height: 22),
          // Probation goals.
          Row(
            children: [
              const Expanded(child: Text('Probation goals', style: OnbText.h1)),
              if (_locked) const OnbTag('Locked', tone: OnbTone.locked, icon: Icons.lock_outline_rounded),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            _locked
                ? 'These locked a week after joining. Change next month’s goals in the monthly review instead.'
                : 'What good looks like by the end of probation.${lockOn == null ? '' : ' You can change them until ${onbDay(lockOn)}.'}',
            key: const ValueKey('setup-goals-note'),
            style: OnbText.label,
          ),
          const SizedBox(height: 10),
          if (_locked)
            for (final (index, controller) in _goals.indexed)
              if (controller.text.trim().isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Text('${index + 1}. ${controller.text}', style: OnbText.body.copyWith(color: OnbColors.text)),
                )
              else
                const SizedBox.shrink()
          else ...[
            for (final (index, controller) in _goals.indexed)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: OnbTextArea(
                  fieldKey: ValueKey('setup-goal-$index'),
                  controller: controller,
                  hint: 'Goal ${index + 1}',
                  minLines: 1,
                ),
              ),
            if (_goals.length < JoinerSetupScreen.maxGoals)
              OnbLink(label: 'Add a goal', icon: Icons.add_rounded, onTap: () => setState(() => _goals.add(TextEditingController()))),
          ],
        ],
      ),
      footer: OnbFooter(
        children: [OnbPrimaryButton(key: const ValueKey('setup-save'), label: 'Save', busy: _busy, onTap: _save)],
      ),
    );
  }
}

/// Picks one colleague from the company directory, by name.
class _PeoplePicker extends StatefulWidget {
  const _PeoplePicker({required this.title, required this.people});

  final String title;
  final List<DirectoryPerson> people;

  @override
  State<_PeoplePicker> createState() => _PeoplePickerState();
}

class _PeoplePickerState extends State<_PeoplePicker> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final query = _query.toLowerCase();
    final shown = widget.people
        .where((p) => query.isEmpty || p.name.toLowerCase().contains(query) || (p.designation ?? '').toLowerCase().contains(query))
        .take(50)
        .toList();
    return SizedBox(
      height: MediaQuery.sizeOf(context).height * 0.7,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 14, 20, 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(widget.title, style: OnbText.h1),
                const SizedBox(height: 10),
                TextField(
                  key: const ValueKey('picker-search'),
                  autofocus: false,
                  onChanged: (value) => setState(() => _query = value.trim()),
                  decoration: InputDecoration(
                    hintText: 'Search by name',
                    prefixIcon: const Icon(Icons.search_rounded),
                    filled: true,
                    fillColor: OnbColors.screen,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: shown.isEmpty
                ? const Center(child: Text('No one matches', style: OnbText.label))
                : ListView.builder(
                    itemCount: shown.length,
                    itemBuilder: (context, index) {
                      final person = shown[index];
                      return ListTile(
                        key: ValueKey('pick-${person.userId}'),
                        leading: OnbAvatar(name: person.name, photoUrl: person.photoUrl, size: 36),
                        title: Text(person.name, style: OnbText.bodyStrong),
                        subtitle: Text([person.designation, person.department].nonNulls.join(' · '), style: OnbText.label),
                        onTap: () => Navigator.of(context).pop(person),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
