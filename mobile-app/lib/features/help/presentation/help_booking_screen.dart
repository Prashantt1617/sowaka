import 'package:flutter/material.dart';

import '../../../services/linkified_text.dart';
import '../../care/presentation/care_theme.dart';
import '../../shared/app_toast.dart';
import '../../talk/data/talk_api_service.dart';
import '../../talk/data/talk_models.dart';
import '../../talk/presentation/talk_format.dart';
import '../data/help_api_service.dart';
import 'choose_someone_screen.dart';
import 'counsellor_profile_screen.dart';
import 'help_widgets.dart';

/// Which door the person came in by.
enum HelpBookingMode { sameCounsellor, counsellorFirst, timeFirst }

enum _Stage { counsellors, slots, whoIsFree, review, booked }

/// How far ahead the day strip runs. Matches the server's horizon.
const _horizonDays = 14;

/// Booking: dates across, times below, Continue once a slot is chosen; then
/// Review with Change on the counsellor and the time; then Confirm, which
/// creates the meeting and shows the booked screen.
class HelpBookingScreen extends StatefulWidget {
  const HelpBookingScreen({
    super.key,
    required this.service,
    this.counsellor,
    this.mode,
    this.matchedId,
  }) : assert(counsellor != null || mode != null, 'A counsellor or a mode');

  final HelpApiService service;

  /// Booking with this counsellor: the same-counsellor route.
  final Counsellor? counsellor;
  final HelpBookingMode? mode;

  /// Left out of the counsellor lists.
  final String? matchedId;

  @override
  State<HelpBookingScreen> createState() => _HelpBookingScreenState();
}

class _HelpBookingScreenState extends State<HelpBookingScreen> {
  HelpBookingMode get _mode =>
      widget.counsellor != null ? HelpBookingMode.sameCounsellor : widget.mode!;

  List<Counsellor>? _counsellors;
  String? _counsellorsError;
  final _slotsByDay = <String, List<TalkSlot>>{};
  final _loadingDays = <String>{};
  late final List<DateTime> _days = [
    for (var i = 1; i <= _horizonDays; i++)
      DateTime.now().add(Duration(days: i)),
  ];
  late String _day = isoDay(_days.first);

  Counsellor? _counsellor;
  TalkSlot? _slot;
  late _Stage _stage = switch (_mode) {
    HelpBookingMode.sameCounsellor => _Stage.slots,
    HelpBookingMode.counsellorFirst => _Stage.counsellors,
    HelpBookingMode.timeFirst => _Stage.slots,
  };
  bool _booking = false;
  TalkSession? _booked;

  @override
  void initState() {
    super.initState();
    _counsellor = widget.counsellor;
    _loadCounsellors();
    _loadDay(_day);
  }

  Future<void> _loadCounsellors() async {
    try {
      final rows = await widget.service.talk.counsellors();
      if (!mounted) return;
      setState(
        () => _counsellors = [
          for (final c in rows)
            if (c.userId != widget.matchedId ||
                _mode == HelpBookingMode.sameCounsellor)
              c,
        ],
      );
    } catch (error) {
      if (!mounted) return;
      setState(
        () => _counsellorsError = error is TalkApiException
            ? error.message
            : 'Could not load counsellors.',
      );
    }
  }

  Future<void> _loadDay(String day) async {
    if (_slotsByDay.containsKey(day) || _loadingDays.contains(day)) return;
    setState(() => _loadingDays.add(day));
    try {
      final slots = await widget.service.talk.availability(day);
      if (!mounted) return;
      setState(() => _slotsByDay[day] = slots);
    } catch (error) {
      if (!mounted) return;
      showAppToast(
        context,
        error is TalkApiException ? error.message : 'Could not load slots.',
      );
    } finally {
      if (mounted) setState(() => _loadingDays.remove(day));
    }
  }

  void _pickDay(DateTime day) {
    final key = isoDay(day);
    setState(() {
      _day = key;
      // Changing the date clears the slot.
      _slot = null;
    });
    _loadDay(key);
  }

  List<TalkSlot> get _visibleSlots {
    final all = _slotsByDay[_day] ?? const [];
    final chosen = _counsellor;
    if (chosen == null) return all;
    return [
      for (final slot in all)
        if (slot.counsellorIds.contains(chosen.userId)) slot,
    ];
  }

  List<Counsellor> get _counsellorsForSlot {
    final slot = _slot;
    final all = _counsellors ?? const [];
    if (slot == null) return all;
    return [
      for (final c in all)
        if (slot.counsellorIds.contains(c.userId)) c,
    ];
  }

  Future<void> _openProfile(Counsellor c) async {
    final chooseForTime = _mode == HelpBookingMode.timeFirst && _slot != null;
    final chosen = await Navigator.of(context).push<Counsellor>(
      MaterialPageRoute(
        builder: (_) => CounsellorProfileScreen(
          service: widget.service,
          counsellorId: c.userId,
          backLabel: chooseForTime ? 'Who is free' : 'Counsellors',
          action: chooseForTime
              ? ProfileAction.chooseForTime
              : ProfileAction.bookBack,
          fixedSlot: chooseForTime ? _slot : null,
        ),
      ),
    );
    if (chosen == null || !mounted) return;
    setState(() {
      _counsellor = chosen;
      _stage = chooseForTime ? _Stage.review : _Stage.slots;
      if (!chooseForTime) _slot = null;
    });
  }

  void _continue() {
    if (_slot == null) return;
    setState(
      () => _stage = _mode == HelpBookingMode.timeFirst && _counsellor == null
          ? _Stage.whoIsFree
          : _Stage.review,
    );
  }

  Future<void> _confirm() async {
    final counsellor = _counsellor;
    final slot = _slot;
    if (counsellor == null || slot == null) return;
    setState(() => _booking = true);
    try {
      final booked = await widget.service.talk.book(
        counsellorId: counsellor.userId,
        startsAt: slot.startsAt,
      );
      if (!mounted) return;
      setState(() {
        _booked = booked;
        _stage = _Stage.booked;
      });
    } catch (error) {
      if (!mounted) return;
      showAppToast(
        context,
        error is TalkApiException
            ? error.message
            : 'Could not book. Try again.',
      );
      _slotsByDay.remove(_day);
      setState(() {
        _slot = null;
        _stage = _Stage.slots;
      });
      _loadDay(_day);
    } finally {
      if (mounted) setState(() => _booking = false);
    }
  }

  void _changeCounsellor() {
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(
        builder: (_) => ChooseSomeoneScreen(
          service: widget.service,
          matchedId: widget.matchedId,
        ),
      ),
    );
  }

  void _changeTime() {
    // Change time keeps the counsellor.
    setState(() {
      _slot = null;
      _stage = _Stage.slots;
    });
  }

  void _back() {
    switch (_stage) {
      case _Stage.whoIsFree:
        setState(() => _stage = _Stage.slots);
      case _Stage.review:
        setState(
          () => _stage = _mode == HelpBookingMode.timeFirst
              ? _Stage.whoIsFree
              : _Stage.slots,
        );
      case _Stage.slots when _mode == HelpBookingMode.counsellorFirst:
        setState(() {
          _stage = _Stage.counsellors;
          _counsellor = null;
          _slot = null;
        });
      case _Stage.booked:
        Navigator.of(context).popUntil((route) => route.isFirst);
      default:
        Navigator.of(context).pop();
    }
  }

  String get _backLabel => switch (_stage) {
    _Stage.counsellors => 'Choose someone else',
    _Stage.slots =>
      _mode == HelpBookingMode.counsellorFirst
          ? 'Counsellors'
          : _mode == HelpBookingMode.timeFirst
          ? 'Choose someone else'
          : 'Back',
    _Stage.whoIsFree => 'Date & time',
    _Stage.review =>
      _mode == HelpBookingMode.timeFirst ? 'Who is free' : 'Date & time',
    _Stage.booked => 'Help',
  };

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: Stack(
        children: [
          switch (_stage) {
            _Stage.counsellors => _counsellorList(
              _counsellors,
              eyebrow: 'A counsellor',
              heading: 'Someone whose\napproach feels right.',
              copy: 'Choose a person, then a time that suits you both.',
            ),
            _Stage.slots => _dayAndSlots(),
            _Stage.whoIsFree => _counsellorList(
              _counsellorsForSlot,
              eyebrow: 'A time',
              heading: 'Who is free then.',
              copy: _slot == null
                  ? ''
                  : 'Free on ${talkDate(_slot!.startsAt)} at ${talkTime(_slot!.startsAt)}.',
            ),
            _Stage.review => _review(),
            _Stage.booked => _bookedView(),
          },
          if (_booking)
            const Positioned.fill(
              child: ColoredBox(
                color: Color(0x66FFFFFF),
                child: Center(
                  child: CircularProgressIndicator(color: CareColors.blue),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _counsellorList(
    List<Counsellor>? rows, {
    required String eyebrow,
    required String heading,
    required String copy,
  }) {
    return CarePage(
      backLabel: _backLabel,
      onBack: _back,
      children: [
        CareEyebrow(eyebrow),
        const SizedBox(height: 10),
        CareHeading(heading, size: 28),
        if (copy.isNotEmpty) ...[const SizedBox(height: 10), CareCopy(copy)],
        const SizedBox(height: 20),
        if (_counsellorsError case final message?)
          CareNotice(message, onRetry: _loadCounsellors)
        else if (rows == null)
          const CareSpinner()
        else if (rows.isEmpty)
          const CareNotice('No counsellor is free then. Try another time.')
        else
          for (final c in rows)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: CareCard(
                key: ValueKey('counsellor-${c.userId}'),
                onTap: () => _openProfile(c),
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    CounsellorPerson(counsellor: c),
                    if (c.focusLabels.isNotEmpty) ...[
                      const SizedBox(height: 10),
                      CareCopy(c.focusLabels.join(' · '), size: 12.5),
                    ],
                    const SizedBox(height: 6),
                    CareLink('View profile', onTap: () => _openProfile(c)),
                  ],
                ),
              ),
            ),
      ],
    );
  }

  Widget _dayAndSlots() {
    final chosen = _counsellor;
    final loading = _loadingDays.contains(_day);
    final slots = _visibleSlots;
    return CarePage(
      backLabel: _backLabel,
      onBack: _back,
      padding: const EdgeInsets.fromLTRB(0, 8, 0, 32),
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              CareEyebrow(
                chosen == null ? 'A time' : 'Book with ${chosen.firstName}',
              ),
              const SizedBox(height: 10),
              CareHeading(
                chosen == null
                    ? 'When would\nsuit you?'
                    : 'A time that\nsuits you both.',
                size: 28,
              ),
              const SizedBox(height: 10),
              CareCopy(
                chosen == null
                    ? 'Choose a day and a time, then see who is free.'
                    : 'Choose a day and a time.',
              ),
              const SizedBox(height: 18),
              if (chosen != null) ...[
                CounsellorPerson(counsellor: chosen),
                const SizedBox(height: 18),
              ],
              const CareSectionTitle('Pick a day', size: 14),
            ],
          ),
        ),
        const SizedBox(height: 10),
        SizedBox(
          height: 74,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 20),
            itemCount: _days.length,
            separatorBuilder: (_, _) => const SizedBox(width: 8),
            itemBuilder: (_, index) => _DayChip(
              day: _days[index],
              selected: isoDay(_days[index]) == _day,
              onTap: () => _pickDay(_days[index]),
            ),
          ),
        ),
        const SizedBox(height: 20),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const CareSectionTitle('Pick a time', size: 14),
              const SizedBox(height: 10),
              if (loading)
                const CareSpinner()
              else if (slots.isEmpty)
                CareNotice(
                  chosen == null
                      ? 'Nobody is free that day. Try another.'
                      : '${chosen.firstName} is not free that day. Try another.',
                )
              else
                Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  children: [
                    for (final slot in slots)
                      _SlotChip(
                        slot: slot,
                        showCount: chosen == null,
                        selected: _slot?.startsAt == slot.startsAt,
                        onTap: () => setState(() => _slot = slot),
                      ),
                  ],
                ),
              const SizedBox(height: 24),
              CarePrimaryButton(
                'Continue',
                icon: Icons.arrow_forward_rounded,
                onTap: _slot == null ? null : _continue,
              ),
              const SizedBox(height: 8),
              const CareMicro(
                'Times are shown in your own time zone. Sessions are 50 minutes, on video.',
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _review() {
    final c = _counsellor!;
    final slot = _slot!;
    return CarePage(
      backLabel: _backLabel,
      onBack: _back,
      children: [
        const CareEyebrow('Review your session'),
        const SizedBox(height: 10),
        const CareHeading('A little time\nto talk it through.', size: 28),
        const SizedBox(height: 10),
        const CareCopy('Check the details before booking.'),
        const SizedBox(height: 20),
        _ReviewRow(
          label: 'Counsellor',
          value: c.name,
          onChange: _changeCounsellor,
        ),
        _ReviewRow(
          label: 'Date & time',
          value:
              '${talkDate(slot.startsAt)}\n${talkRange(slot.startsAt, slot.endsAt)} · your time',
          onChange: _changeTime,
        ),
        SummaryLine('Session', '${c.slotMinutes} min · Video call'),
        const SizedBox(height: 24),
        CarePrimaryButton(
          'Confirm session',
          icon: Icons.check_rounded,
          onTap: _confirm,
        ),
        const SizedBox(height: 8),
        const CareMicro('A Zoom link is created for you and shows on Help.'),
      ],
    );
  }

  Widget _bookedView() {
    final booked = _booked!;
    return CarePage(
      backLabel: 'Help',
      onBack: _back,
      children: [
        const CareEyebrow('Booked'),
        const SizedBox(height: 10),
        const CareHeading('You’re booked.', size: 30),
        const SizedBox(height: 10),
        CareCopy(
          '${talkDate(booked.startsAt)} · ${talkRange(booked.startsAt, booked.endsAt)} with ${booked.counsellorName}.',
        ),
        const SizedBox(height: 20),
        if (booked.joinUrl case final url?) ...[
          CarePrimaryButton(
            'Open the Zoom link',
            icon: Icons.videocam_rounded,
            onTap: () async {
              final opened = await openExternalLink(url);
              if (!opened && mounted)
                showAppToast(context, 'Could not open the link');
            },
          ),
          const SizedBox(height: 8),
          const CareMicro(
            'The link stays on Help until the session, on your next session card.',
          ),
          const SizedBox(height: 16),
        ],
        CareLink('Back to Help', onTap: _back),
      ],
    );
  }
}

class _ReviewRow extends StatelessWidget {
  const _ReviewRow({
    required this.label,
    required this.value,
    required this.onChange,
  });

  final String label;
  final String value;
  final VoidCallback onChange;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(vertical: 12),
    decoration: const BoxDecoration(
      border: Border(bottom: BorderSide(color: CareColors.line)),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: const TextStyle(
                  fontFamily: careFont,
                  color: CareColors.muted,
                  fontSize: 12,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                value,
                style: const TextStyle(
                  fontFamily: careFont,
                  color: CareColors.ink,
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                  height: 1.4,
                ),
              ),
            ],
          ),
        ),
        CareLink('Change', icon: null, onTap: onChange),
      ],
    ),
  );
}

class _DayChip extends StatelessWidget {
  const _DayChip({
    required this.day,
    required this.selected,
    required this.onTap,
  });

  final DateTime day;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? CareColors.blue : CareColors.paper,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          width: 58,
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: selected ? CareColors.blue : CareColors.line,
            ),
          ),
          child: Column(
            children: [
              Text(
                weekdayShort(day),
                style: TextStyle(
                  fontFamily: careFont,
                  color: selected ? Colors.white : CareColors.muted,
                  fontSize: 11.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                '${day.day}',
                style: TextStyle(
                  fontFamily: careFont,
                  color: selected ? Colors.white : CareColors.ink,
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                  height: 1.1,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SlotChip extends StatelessWidget {
  const _SlotChip({
    required this.slot,
    required this.selected,
    required this.showCount,
    required this.onTap,
  });

  final TalkSlot slot;
  final bool selected;
  final bool showCount;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final count = slot.counsellorIds.length;
    return Material(
      color: selected ? CareColors.blue : CareColors.paper,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: selected ? CareColors.blue : CareColors.line,
            ),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                talkTime(slot.startsAt),
                style: TextStyle(
                  fontFamily: careFont,
                  color: selected ? Colors.white : CareColors.ink,
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (showCount)
                Text(
                  count == 1 ? '1 free' : '$count free',
                  style: TextStyle(
                    fontFamily: careFont,
                    color: selected ? Colors.white70 : CareColors.muted,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
