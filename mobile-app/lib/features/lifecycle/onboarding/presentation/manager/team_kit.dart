import 'package:flutter/material.dart';
import 'package:speech_to_text/speech_to_text.dart' as stt;

import '../../../../shared/app_toast.dart';
import '../onboarding_kit.dart';

/// The team side's shared pieces: the pills over the Team tab (My Team,
/// Requests, Feedback, New joiners), a round pill, and a notes box with voice
/// typing (the joiner's meeting notes, the head of department's comments on a
/// confirmation). The old Teams › Joiners task pages are gone (24 Nov).

// ─── Colours the design adds to the app's ───────────────────────────────────

abstract final class TeamColors {
  static const ink = Color(0xFF222222);
  static const reachOut = Color(0xFFB23500);
  static const okBg = Color(0xFFEAF9EE);
  static const okFg = Color(0xFF15803D);
  static const warnBg = Color(0xFFFFF4E5);
  static const warnFg = Color(0xFFB45309);
  static const blueBg = Color(0xFFE8F4FA);
  static const sectionCount = Color(0xFFFF8A1F);
}

// ─── Teams: the pill row ────────────────────────────────────────────────────

/// One pill over the Team tab.
class TeamPillSpec {
  const TeamPillSpec({required this.key, required this.label, this.count = 0, this.countColor = TeamColors.sectionCount});

  final String key;
  final String label;
  final int count;

  /// The count's colour while the pill is off (orange; blue on Joiners).
  final Color countColor;
}

/// Teams' row of pills that scrolls sideways (MgrTeamsProto): My Team,
/// Requests, Feedback, Joiners last. The open one is black; a count sits in
/// each pill while something is waiting. With [endFirst] (the last pill
/// open) the row starts scrolled to its end, the fade on the left.
class TeamSectionPills extends StatefulWidget {
  const TeamSectionPills({super.key, required this.pills, required this.selected, required this.onSelect});

  final List<TeamPillSpec> pills;
  final String selected;
  final ValueChanged<String> onSelect;

  @override
  State<TeamSectionPills> createState() => _TeamSectionPillsState();
}

class _TeamSectionPillsState extends State<TeamSectionPills> {
  final _scroll = ScrollController();

  bool get _atEnd => widget.pills.isNotEmpty && widget.selected == widget.pills.last.key;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _follow());
  }

  @override
  void didUpdateWidget(covariant TeamSectionPills oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.selected != widget.selected) WidgetsBinding.instance.addPostFrameCallback((_) => _follow());
  }

  void _follow() {
    if (!mounted || !_scroll.hasClients) return;
    final to = _atEnd ? _scroll.position.maxScrollExtent : 0.0;
    if ((_scroll.offset - to).abs() > 1) {
      _scroll.animateTo(to, duration: const Duration(milliseconds: 220), curve: Curves.easeOut);
    }
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey('team-pills'),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(bottom: BorderSide(color: OnbColors.line)),
      ),
      child: Stack(
        children: [
          SingleChildScrollView(
            controller: _scroll,
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: Row(
              children: [
                for (final (i, pill) in widget.pills.indexed) ...[
                  if (i > 0) const SizedBox(width: 8),
                  _TeamPill(spec: pill, selected: pill.key == widget.selected, onTap: () => widget.onSelect(pill.key)),
                ],
              ],
            ),
          ),
          // The row trails off the edge: a white fade on the far side.
          Positioned(
            top: 0,
            bottom: 0,
            left: _atEnd ? 0 : null,
            right: _atEnd ? null : 0,
            width: 36,
            child: IgnorePointer(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: _atEnd ? Alignment.centerRight : Alignment.centerLeft,
                    end: _atEnd ? Alignment.centerLeft : Alignment.centerRight,
                    colors: const [Color(0x00FFFFFF), Colors.white],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _TeamPill extends StatelessWidget {
  const _TeamPill({required this.spec, required this.selected, required this.onTap});

  final TeamPillSpec spec;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final fg = selected ? Colors.white : OnbColors.text2;
    return Semantics(
      button: true,
      selected: selected,
      label: spec.count > 0 ? '${spec.label}, ${spec.count}' : spec.label,
      excludeSemantics: true,
      child: Material(
        key: ValueKey('team-pill-${spec.key}'),
        color: selected ? TeamColors.ink : Colors.white,
        shape: StadiumBorder(side: selected ? BorderSide.none : const BorderSide(color: OnbColors.lineDark)),
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: onTap,
          child: Container(
            height: 38,
            padding: const EdgeInsets.symmetric(horizontal: 14),
            alignment: Alignment.center,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  spec.label,
                  style: TextStyle(fontSize: 14, fontWeight: selected ? FontWeight.w700 : FontWeight.w600, color: fg),
                ),
                if (spec.count > 0) ...[
                  const SizedBox(width: 6),
                  Container(
                    constraints: const BoxConstraints(minWidth: 20),
                    height: 20,
                    padding: const EdgeInsets.symmetric(horizontal: 5),
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: selected ? Colors.white : spec.countColor,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      spec.count > 99 ? '99+' : '${spec.count}',
                      style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: selected ? TeamColors.ink : Colors.white),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ─── Small pieces ───────────────────────────────────────────────────────────

/// A round pill: a stage, a count, a status.
class TeamPill extends StatelessWidget {
  const TeamPill(this.label, {super.key, required this.background, required this.foreground, this.height = 24, this.leading});

  final String label;
  final Color background;
  final Color foreground;
  final double height;
  final Widget? leading;

  @override
  Widget build(BuildContext context) => Container(
    height: height,
    padding: EdgeInsets.only(left: leading == null ? (height >= 26 ? 10 : 8) : 4, right: height >= 26 ? 10 : 8),
    decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(999)),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (leading != null) ...[leading!, const SizedBox(width: 4)],
        Text(label, maxLines: 1, style: TextStyle(fontSize: height >= 26 ? 12 : 11, fontWeight: FontWeight.w700, color: foreground)),
      ],
    ),
  );
}

// ─── Notes with voice typing ────────────────────────────────────────────────

/// One speech recogniser for every notes box on a page: only one listens.
class TeamVoice extends ChangeNotifier {
  final stt.SpeechToText _speech = stt.SpeechToText();
  bool _ready = false;

  /// Which box is listening.
  String? listening;

  Future<void> toggle(BuildContext context, String field, TextEditingController controller) async {
    if (listening == field) {
      listening = null;
      notifyListeners();
      await _speech.stop();
      return;
    }
    if (_speech.isListening) await _speech.cancel();
    if (!_ready) {
      try {
        _ready = await _speech.initialize(
          onStatus: (status) {
            if (status == 'done' || status == 'notListening') {
              listening = null;
              notifyListeners();
            }
          },
          onError: (_) {
            listening = null;
            notifyListeners();
          },
        );
      } catch (_) {
        // No speech engine on this phone: the mic still answers, with the line below.
        _ready = false;
      }
    }
    if (!_ready) {
      if (context.mounted) showAppToast(context, 'Voice typing is unavailable or microphone access was denied.');
      return;
    }
    final prefix = controller.text.trim();
    listening = field;
    notifyListeners();
    await _speech.listen(
      onResult: (result) {
        final words = result.recognizedWords.trim();
        if (words.isNotEmpty) controller.text = prefix.isEmpty ? words : '$prefix $words';
        if (result.finalResult) {
          listening = null;
          notifyListeners();
        }
      },
    );
  }

  @override
  void dispose() {
    _speech.cancel();
    super.dispose();
  }
}

/// A notes box with the mic in its corner ("Type or tap the mic"); red
/// while it listens, with "Listening… tap the mic to stop" under it.
class TeamNotesField extends StatelessWidget {
  const TeamNotesField({
    super.key,
    required this.field,
    required this.controller,
    required this.voice,
    required this.label,
    this.hint = 'Type or tap the mic',
    this.minLines = 2,
    this.filled = true,
  });

  final String field;
  final TextEditingController controller;
  final TeamVoice voice;
  final String label;
  final String hint;
  final int minLines;

  /// Grey inside (an agenda point) or white with a darker line (comments).
  final bool filled;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: voice,
    builder: (context, _) {
      final rec = voice.listening == field;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Stack(
            children: [
              TextField(
                controller: controller,
                minLines: minLines,
                maxLines: 8,
                style: const TextStyle(fontSize: 13, height: 1.45, color: TeamColors.ink),
                decoration: InputDecoration(
                  labelText: null,
                  hintText: rec ? 'Speak now…' : hint,
                  hintStyle: const TextStyle(fontSize: 13, color: OnbColors.text3),
                  filled: true,
                  fillColor: filled ? OnbColors.screen : Colors.white,
                  isDense: true,
                  contentPadding: const EdgeInsets.fromLTRB(12, 10, 52, 10),
                  enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: filled ? OnbColors.line : OnbColors.lineDark)),
                  focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: OnbColors.primary)),
                ),
                textCapitalization: TextCapitalization.sentences,
              ),
              Positioned(
                right: 8,
                bottom: 8,
                child: Semantics(
                  button: true,
                  toggled: rec,
                  label: rec ? 'Stop voice typing' : 'Voice typing',
                  excludeSemantics: true,
                  child: Material(
                    color: rec ? OnbColors.redText : (filled ? Colors.white : OnbColors.screen),
                    shape: const CircleBorder(),
                    child: InkWell(
                      key: ValueKey('mic-$field'),
                      customBorder: const CircleBorder(),
                      onTap: () => voice.toggle(context, field, controller),
                      child: SizedBox(width: 36, height: 36, child: Icon(Icons.mic_none_rounded, size: 18, color: rec ? Colors.white : OnbColors.primary)),
                    ),
                  ),
                ),
              ),
            ],
          ),
          if (rec) ...[
            const SizedBox(height: 6),
            const Text('Listening… tap the mic to stop', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: TeamColors.reachOut)),
          ],
        ],
      );
    },
  );
}
