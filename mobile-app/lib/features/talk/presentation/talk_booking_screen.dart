import 'package:flutter/material.dart';

import '../../../services/api_config.dart';
import '../../auth/data/auth_models.dart';
import '../../manager/presentation/manager_screen.dart';
import '../../shared/app_toast.dart';
import '../data/talk_api_service.dart';
import '../data/talk_models.dart';
import 'talk_format.dart';
import 'talk_tab.dart';

/// Which door the person came in by. The two differ only in what is chosen
/// first; from the confirmation onward the path is the same.
enum TalkBookingMode { byCounsellor, bySlot }

/// How far ahead the day strip runs. Matches the server's horizon.
const _horizonDays = 14;

class TalkBookingScreen extends StatefulWidget {
  const TalkBookingScreen({
    super.key,
    required this.session,
    required this.mode,
    this.service,
  });

  final AuthSession session;
  final TalkBookingMode mode;
  final TalkApiService? service;

  @override
  State<TalkBookingScreen> createState() => _TalkBookingScreenState();
}

class _TalkBookingScreenState extends State<TalkBookingScreen> {
  late final TalkApiService _service =
      widget.service ?? TalkApiService(session: widget.session);

  List<Counsellor>? _counsellors;
  String? _counsellorsError;

  /// Slots per day, fetched once per day and kept for the screen's life.
  final _slotsByDay = <String, List<TalkSlot>>{};
  final _loadingDays = <String>{};

  late final List<DateTime> _days = [
    for (var i = 1; i <= _horizonDays; i++)
      DateTime.now().add(Duration(days: i)),
  ];
  late String _day = isoDay(_days.first);

  Counsellor? _counsellor;
  TalkSlot? _slot;

  /// 0 is the first choice, 1 the second; the confirm sheet sits over 1.
  int _step = 0;
  bool _booking = false;

  @override
  void initState() {
    super.initState();
    _loadCounsellors();
    _loadDay(_day);
  }

  Future<void> _loadCounsellors() async {
    try {
      final rows = await _service.counsellors();
      if (!mounted) return;
      setState(() => _counsellors = rows);
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
      final slots = await _service.availability(day);
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
      _slot = null;
    });
    _loadDay(key);
  }

  /// The slots on the chosen day, narrowed to the chosen counsellor when
  /// there is one.
  List<TalkSlot> get _visibleSlots {
    final all = _slotsByDay[_day] ?? const [];
    final chosen = _counsellor;
    if (chosen == null) return all;
    return [
      for (final slot in all)
        if (slot.counsellorIds.contains(chosen.userId)) slot,
    ];
  }

  /// The counsellors free at the chosen slot.
  List<Counsellor> get _counsellorsForSlot {
    final slot = _slot;
    final all = _counsellors ?? const [];
    if (slot == null) return all;
    return [
      for (final counsellor in all)
        if (slot.counsellorIds.contains(counsellor.userId)) counsellor,
    ];
  }

  void _onCounsellor(Counsellor counsellor) {
    setState(() => _counsellor = counsellor);
    if (widget.mode == TalkBookingMode.byCounsellor) {
      setState(() => _step = 1);
    } else {
      _confirm();
    }
  }

  void _onSlot(TalkSlot slot) {
    setState(() => _slot = slot);
    if (widget.mode == TalkBookingMode.bySlot) {
      setState(() => _step = 1);
    } else {
      _confirm();
    }
  }

  Future<void> _confirm() async {
    final counsellor = _counsellor;
    final slot = _slot;
    if (counsellor == null || slot == null) return;
    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (_) => _ConfirmSheet(counsellor: counsellor, slot: slot),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _booking = true);
    try {
      final booked = await _service.book(
        counsellorId: counsellor.userId,
        startsAt: slot.startsAt,
      );
      if (!mounted) return;
      Navigator.of(context).pop(booked);
    } catch (error) {
      if (!mounted) return;
      showAppToast(
        context,
        error is TalkApiException ? error.message : 'Could not book. Try again.',
      );
      // The slot may have gone; read the day again.
      _slotsByDay.remove(_day);
      _loadDay(_day);
    } finally {
      if (mounted) setState(() => _booking = false);
    }
  }

  void _back() {
    if (_step > 0) {
      setState(() {
        _step = 0;
        if (widget.mode == TalkBookingMode.byCounsellor) {
          _counsellor = null;
        } else {
          _slot = null;
        }
      });
      return;
    }
    Navigator.of(context).pop();
  }

  String get _title => switch ((widget.mode, _step)) {
    (TalkBookingMode.byCounsellor, 0) => 'Choose a counsellor',
    (TalkBookingMode.byCounsellor, _) => 'Pick a slot',
    (TalkBookingMode.bySlot, 0) => 'Book a slot',
    (TalkBookingMode.bySlot, _) => 'Who is free',
  };

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: _step == 0,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: Scaffold(
        backgroundColor: MColors.bg,
        body: Column(
          children: [
            TalkTopBar(title: _title, onBack: _back),
            Expanded(
              child: Stack(
                children: [
                  switch ((widget.mode, _step)) {
                    (TalkBookingMode.byCounsellor, 0) => _counsellorList(
                      _counsellors,
                      heading: 'Who would you like to talk to?',
                    ),
                    (TalkBookingMode.byCounsellor, _) => _dayAndSlots(),
                    (TalkBookingMode.bySlot, 0) => _dayAndSlots(),
                    (TalkBookingMode.bySlot, _) => _counsellorList(
                      _counsellorsForSlot,
                      heading: _slot == null
                          ? ''
                          : 'Free on ${talkDate(_slot!.startsAt)} at '
                                '${talkTime(_slot!.startsAt)}',
                    ),
                  },
                  if (_booking)
                    const ColoredBox(
                      color: Color(0x66FFFFFF),
                      child: Center(
                        child: CircularProgressIndicator(color: MColors.terra),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _counsellorList(List<Counsellor>? rows, {required String heading}) {
    if (_counsellorsError case final message?) {
      return _message(message);
    }
    if (rows == null) {
      return const Center(
        child: CircularProgressIndicator(color: MColors.terra),
      );
    }
    if (rows.isEmpty) {
      return _message('No counsellor is free then. Try another slot.');
    }
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 18, 16, 32),
      children: [
        if (heading.isNotEmpty) ...[
          Text(
            heading,
            style: const TextStyle(
              fontFamily: 'Sora',
              color: MColors.ink,
              fontSize: 17,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 14),
        ],
        for (final counsellor in rows)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _CounsellorTile(
              counsellor: counsellor,
              onTap: () => _onCounsellor(counsellor),
            ),
          ),
      ],
    );
  }

  Widget _dayAndSlots() {
    final chosen = _counsellor;
    final loading = _loadingDays.contains(_day);
    final slots = _visibleSlots;
    return ListView(
      padding: const EdgeInsets.fromLTRB(0, 18, 0, 32),
      children: [
        if (chosen != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: _CounsellorTile(counsellor: chosen, compact: true),
          ),
        const Padding(
          padding: EdgeInsets.fromLTRB(16, 0, 16, 10),
          child: Text(
            'Pick a day',
            style: TextStyle(
              fontFamily: 'Sora',
              color: MColors.ink,
              fontSize: 15,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        SizedBox(
          height: 74,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            itemCount: _days.length,
            separatorBuilder: (_, _) => const SizedBox(width: 8),
            itemBuilder: (_, index) {
              final day = _days[index];
              return _DayChip(
                day: day,
                selected: isoDay(day) == _day,
                onTap: () => _pickDay(day),
              );
            },
          ),
        ),
        const SizedBox(height: 20),
        const Padding(
          padding: EdgeInsets.fromLTRB(16, 0, 16, 10),
          child: Text(
            'Pick a time',
            style: TextStyle(
              fontFamily: 'Sora',
              color: MColors.ink,
              fontSize: 15,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        if (loading)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 28),
            child: Center(
              child: CircularProgressIndicator(color: MColors.terra),
            ),
          )
        else if (slots.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: _message(
              chosen == null
                  ? 'Nobody is free that day. Try another.'
                  : '${chosen.name} is not free that day. Try another.',
              inline: true,
            ),
          )
        else
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                for (final slot in slots)
                  _SlotChip(
                    slot: slot,
                    showCount: chosen == null,
                    selected: _slot?.startsAt == slot.startsAt,
                    onTap: () => _onSlot(slot),
                  ),
              ],
            ),
          ),
      ],
    );
  }

  Widget _message(String text, {bool inline = false}) {
    final box = Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: MColors.line),
      ),
      child: Text(
        text,
        style: const TextStyle(
          color: MColors.inkSoft,
          fontSize: 13.5,
          height: 1.4,
        ),
      ),
    );
    if (inline) return box;
    return Padding(padding: const EdgeInsets.all(16), child: box);
  }
}

class _CounsellorTile extends StatelessWidget {
  const _CounsellorTile({
    required this.counsellor,
    this.onTap,
    this.compact = false,
  });

  final Counsellor counsellor;
  final VoidCallback? onTap;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final size = compact ? 40.0 : 52.0;
    final url = counsellor.photoUrl;
    return PressableCard(
      onTap: onTap,
      padding: EdgeInsets.all(compact ? 12 : 16),
      child: Row(
        children: [
          if (url == null || url.isEmpty)
            AvatarBadge(initial: counsellor.initial, index: 3, size: size)
          else
            ClipOval(
              child: Image(
                image: avatarImageProvider(url),
                width: size,
                height: size,
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) =>
                    AvatarBadge(initial: counsellor.initial, index: 3, size: size),
              ),
            ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  counsellor.name,
                  style: TextStyle(
                    fontFamily: 'Sora',
                    color: MColors.ink,
                    fontSize: compact ? 14.5 : 16,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                if (counsellor.headline.isNotEmpty)
                  Text(
                    counsellor.headline,
                    style: const TextStyle(color: MColors.inkSoft, fontSize: 13),
                  ),
                if (!compact)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      '${counsellor.slotMinutes} min sessions',
                      style: const TextStyle(
                        color: MColors.inkFaint,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          if (onTap != null)
            const Icon(Icons.chevron_right_rounded, color: MColors.inkFaint),
        ],
      ),
    );
  }
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
      color: selected ? MColors.terra : Colors.white,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          width: 58,
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: selected ? MColors.terra : MColors.line),
          ),
          child: Column(
            children: [
              Text(
                weekdayShort(day),
                style: TextStyle(
                  color: selected ? Colors.white : MColors.inkSoft,
                  fontSize: 11.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                '${day.day}',
                style: TextStyle(
                  fontFamily: 'Sora',
                  color: selected ? Colors.white : MColors.ink,
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

  /// With no counsellor chosen yet, how many are free at this time.
  final bool showCount;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final count = slot.counsellorIds.length;
    return Material(
      color: selected ? MColors.terra : Colors.white,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: selected ? MColors.terra : MColors.line),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                talkTime(slot.startsAt),
                style: TextStyle(
                  color: selected ? Colors.white : MColors.ink,
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (showCount)
                Text(
                  count == 1 ? '1 free' : '$count free',
                  style: TextStyle(
                    color: selected ? Colors.white70 : MColors.inkFaint,
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

class _ConfirmSheet extends StatelessWidget {
  const _ConfirmSheet({required this.counsellor, required this.slot});

  final Counsellor counsellor;
  final TalkSlot slot;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Confirm your session',
              style: TextStyle(
                fontFamily: 'Sora',
                color: MColors.ink,
                fontSize: 18,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 14),
            _ConfirmRow(label: 'With', value: counsellor.name),
            _ConfirmRow(label: 'On', value: talkDate(slot.startsAt)),
            _ConfirmRow(label: 'At', value: talkRange(slot.startsAt, slot.endsAt)),
            const SizedBox(height: 8),
            const Text(
              'A Zoom link is created for you and shows on the Talk tab.',
              style: TextStyle(color: MColors.inkSoft, fontSize: 13, height: 1.4),
            ),
            const SizedBox(height: 18),
            ActionButton(
              label: 'Confirm booking',
              background: MColors.terra,
              foreground: Colors.white,
              onTap: () => Navigator.of(context).pop(true),
            ),
            const SizedBox(height: 8),
            ActionButton(
              label: 'Not now',
              background: Colors.white,
              foreground: MColors.inkSoft,
              border: MColors.line,
              onTap: () => Navigator.of(context).pop(false),
            ),
          ],
        ),
      ),
    );
  }
}

class _ConfirmRow extends StatelessWidget {
  const _ConfirmRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          SizedBox(
            width: 52,
            child: Text(
              label,
              style: const TextStyle(
                color: MColors.inkFaint,
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                color: MColors.ink,
                fontSize: 15,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
