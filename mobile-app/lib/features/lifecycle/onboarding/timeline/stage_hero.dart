import 'package:flutter/material.dart';

import '../data/onboarding_models.dart';
import '../presentation/onboarding_kit.dart';
import '../presentation/plant.dart';
import 'stage_lens.dart';

/// The artifact's timeline colours that the kit has no name for (its done
/// green on the stage chips and the ticks, the amber "From Week 1" pill).
abstract final class LensColors {
  static const doneTint = Color(0xFFEAF9EE);
  static const doneText = Color(0xFF1F9D45);
  static const tick = Color(0xFF30D158);
  static const amberTint = Color(0xFFFFF4E5);
  static const amberText = Color(0xFFB45309);
  static const plantTile = Color(0xFFE8F4FA);
}

/// The onboarding hero (New joiner artifact, Main): the plant on its tile,
/// YOU ARE HERE and the stage, and under it the stage row. Tapping a stage
/// looks ahead or back ([onPick]); her own stage stays filled blue, the one
/// looked at gets a blue ring, and "Back to Week 1" returns her.
class StageHero extends StatefulWidget {
  const StageHero({super.key, required this.lens, required this.plant, required this.onPick, this.watering = false});

  final StageLens lens;
  final PlantState plant;

  /// A step's index; her own stage's to come back.
  final ValueChanged<int> onPick;

  /// The plant's watering after the first punch-in.
  final bool watering;

  @override
  State<StageHero> createState() => _StageHeroState();
}

class _StageHeroState extends State<StageHero> {
  final _scroll = ScrollController();
  final _keys = <int, GlobalKey>{};

  GlobalKey _keyOf(int i) => _keys.putIfAbsent(i, GlobalKey.new);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _reveal(animate: false));
  }

  @override
  void didUpdateWidget(StageHero old) {
    super.didUpdateWidget(old);
    if (old.lens.selected != widget.lens.selected) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _reveal(animate: true));
    }
  }

  /// Keeps the stage looked at in view (the artifact shifts the row along).
  void _reveal({required bool animate}) {
    final context = _keyOf(widget.lens.selected).currentContext;
    if (context == null || !mounted) return;
    final still = MediaQuery.disableAnimationsOf(this.context);
    Scrollable.ensureVisible(
      context,
      alignment: 0.5,
      duration: animate && !still ? const Duration(milliseconds: 250) : Duration.zero,
    );
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final lens = widget.lens;
    final now = lens.mode == LensMode.now;
    final confirmed = now && lens.isConfirmed;
    final eyebrowColor = now ? (confirmed ? LensColors.doneText : OnbColors.primary) : OnbColors.text3;
    return Container(
      key: const ValueKey('stage-hero'),
      padding: const EdgeInsets.symmetric(vertical: 14),
      decoration: BoxDecoration(
        color: confirmed ? LensColors.doneTint : Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: OnbColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                Container(
                  width: 60,
                  height: 68,
                  decoration: BoxDecoration(
                    color: confirmed ? Colors.white : LensColors.plantTile,
                    borderRadius: BorderRadius.circular(16),
                  ),
                  alignment: Alignment.bottomCenter,
                  child: Plant.of(_plantFor(lens, widget.plant), size: 54, showPill: false),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        lens.eyebrow,
                        key: const ValueKey('stage-eyebrow'),
                        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.1, color: eyebrowColor),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        lens.title,
                        key: const ValueKey('stage-title'),
                        style: const TextStyle(
                          fontSize: 28,
                          height: 1.1,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -0.56,
                          color: OnbColors.text,
                        ),
                      ),
                    ],
                  ),
                ),
                if (!now) _BackToNow(label: lens.backLabel, onTap: () => widget.onPick(lens.current)),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Semantics(
            container: true,
            label: 'Your onboarding stages',
            child: SingleChildScrollView(
              controller: _scroll,
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
              child: Row(
                children: [
                  for (final (i, step) in lens.steps.indexed) ...[
                    if (i > 0) const SizedBox(width: 6),
                    _StepChip(
                      key: _keyOf(i),
                      label: step,
                      done: i < lens.current,
                      current: i == lens.current,
                      selected: i == lens.selected,
                      onTap: () => widget.onPick(i),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Looking ahead or back shows the plant as it is at that stage.
  PlantState _plantFor(StageLens lens, PlantState plant) {
    if (lens.mode == LensMode.now) return plant;
    final months = lens.steps.length - 3;
    final at = lens.selected;
    final stage = at <= 1
        ? 1
        : at == 2
        ? 2
        : at == lens.steps.length - 1
        ? 5
        : at == months + 1
        ? 4
        : 3;
    return PlantState(stage: stage, leaves: plant.leaves);
  }
}

class _BackToNow extends StatelessWidget {
  const _BackToNow({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 36,
    child: OutlinedButton(
      key: const ValueKey('lens-back'),
      onPressed: onTap,
      style: OutlinedButton.styleFrom(
        foregroundColor: OnbColors.primary,
        backgroundColor: Colors.white,
        side: const BorderSide(color: OnbColors.lineDark),
        shape: const StadiumBorder(),
        padding: const EdgeInsets.symmetric(horizontal: 12),
        minimumSize: const Size(0, 36),
        textStyle: OnbText.button(context, size: 12, weight: FontWeight.w700),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.chevron_left_rounded, size: 16),
          const SizedBox(width: 2),
          Text(label),
        ],
      ),
    ),
  );
}

class _StepChip extends StatelessWidget {
  const _StepChip({
    super.key,
    required this.label,
    required this.done,
    required this.current,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool done;
  final bool current;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final bg = current ? OnbColors.primary : (done ? LensColors.doneTint : Colors.white);
    final fg = current ? Colors.white : (done ? LensColors.doneText : OnbColors.text3);
    final ring = selected && !current;
    return Semantics(
      button: true,
      selected: selected,
      label: '$label${current ? ', your stage' : done ? ', done' : ''}',
      excludeSemantics: true,
      child: DecoratedBox(
        // The ring sits outside the chip, as the artboard's box-shadow does.
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(999),
          boxShadow: ring ? const [BoxShadow(color: OnbColors.primary, spreadRadius: 2)] : null,
        ),
        child: Material(
          key: ValueKey('stage-step-$label'),
          color: bg,
          shape: StadiumBorder(side: current || done ? BorderSide.none : const BorderSide(color: OnbColors.lineDark)),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onTap,
            child: Container(
              height: 36,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              alignment: Alignment.center,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (done) ...[
                    const Icon(Icons.check_rounded, size: 12, color: LensColors.doneText),
                    const SizedBox(width: 4),
                  ],
                  Text(
                    label,
                    style: TextStyle(fontSize: 12, fontWeight: current ? FontWeight.w700 : FontWeight.w600, color: fg),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
