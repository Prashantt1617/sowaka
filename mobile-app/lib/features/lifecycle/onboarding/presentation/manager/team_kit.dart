import 'package:flutter/material.dart';
import 'package:speech_to_text/speech_to_text.dart' as stt;

import '../../../../shared/app_toast.dart';
import '../../data/onboarding_models.dart';
import '../onboarding_kit.dart';
import '../plant.dart';

/// The team side's shared pieces (Teams › Joiners, Onboarding · Final designs,
/// prototype MgrTeamsProto): the pills over the Team tab, a joiner's row, the
/// person page's hero, its tasks card and two tiles, a task row, the reach-out
/// blocks, a list card with section heads and a notes box with voice typing.
/// The manager, head-of-department and buddy pages all draw with these.

// ─── Colours the design adds to the app's ───────────────────────────────────

abstract final class TeamColors {
  static const ink = Color(0xFF222222);
  static const viewAllBg = Color(0xFFF7FAFC);
  static const reachOut = Color(0xFFB23500);
  static const countRedBg = Color(0xFFFDECEC);
  static const countRedFg = Color(0xFFB23500);
  static const okBg = Color(0xFFEAF9EE);
  static const okFg = Color(0xFF15803D);
  static const warnBg = Color(0xFFFFF4E5);
  static const warnFg = Color(0xFFB45309);
  static const blueBg = Color(0xFFE8F4FA);
  static const plantBg = Color(0xFFEAF9EE);
  static const tickGreen = Color(0xFF30D158);
  static const joinersCount = Color(0xFF0571A6);
  static const sectionCount = Color(0xFFFF8A1F);
}

// ─── Task kinds: the icon tile each row wears ───────────────────────────────

/// What a team-side task is, for its icon tile (the design's ICON/TINT).
enum TeamTaskKind {
  help(Icons.help_outline_rounded, Color(0xFFFFF4E5), Color(0xFFB45309)),
  approve(Icons.verified_user_outlined, Color(0xFFEAF9EE), Color(0xFF15803D)),
  review(Icons.fact_check_outlined, Color(0xFFE8F4FA), Color(0xFF0571A6)),
  task(Icons.checklist_rounded, Color(0xFFF7F7F9), Color(0xFF484848)),
  meet(Icons.person_outline_rounded, Color(0xFFEAF9EE), Color(0xFF15803D)),
  team(Icons.groups_outlined, Color(0xFFF3EEFF), Color(0xFF6B4FBB)),
  goal(Icons.track_changes_rounded, Color(0xFFEAF1FE), Color(0xFF2563EB)),
  doc(Icons.description_outlined, Color(0xFFFFF4E5), Color(0xFFB45309)),
  chat(Icons.chat_bubble_outline_rounded, Color(0xFFFDECEC), Color(0xFFB23500));

  const TeamTaskKind(this.icon, this.tint, this.fg);
  final IconData icon;
  final Color tint;
  final Color fg;

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

// ─── Joiners: the list ──────────────────────────────────────────────────────

/// A 48 photo with the plant on a small green tile at its corner.
class TeamAvatarWithPlant extends StatelessWidget {
  const TeamAvatarWithPlant({super.key, required this.name, this.photoUrl, required this.plant, this.size = 48});

  final String name;
  final String? photoUrl;
  final PlantState plant;
  final double size;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: size,
    height: size,
    child: Stack(
      clipBehavior: Clip.none,
      children: [
        OnbAvatar(name: name, photoUrl: photoUrl, size: size),
        Positioned(
          right: -6,
          bottom: -6,
          child: Container(
            key: const ValueKey('joiner-plant-badge'),
            width: 24,
            height: 26,
            decoration: BoxDecoration(
              color: TeamColors.plantBg,
              borderRadius: BorderRadius.circular(9),
              border: Border.all(color: Colors.white, width: 2),
            ),
            alignment: Alignment.bottomCenter,
            clipBehavior: Clip.antiAlias,
            child: FittedBox(fit: BoxFit.contain, alignment: Alignment.bottomCenter, child: Plant.of(plant, size: 18, sway: false, showPill: false)),
          ),
        ),
      ],
    ),
  );
}

/// The white card the joiners (and every list) sit in: 20 radius, a hairline.
class TeamListCard extends StatelessWidget {
  const TeamListCard({super.key, required this.children, this.radius = 20});

  final List<Widget> children;
  final double radius;

  @override
  Widget build(BuildContext context) => Container(
    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(radius), border: Border.all(color: OnbColors.line)),
    clipBehavior: Clip.antiAlias,
    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
  );
}

/// A grey section head inside a list card ("COMING UP").
class TeamListHead extends StatelessWidget {
  const TeamListHead(this.label, {super.key});

  final String label;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
    decoration: const BoxDecoration(color: OnbColors.screen, border: Border(bottom: BorderSide(color: OnbColors.line))),
    child: Text(label.toUpperCase(), style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.88, color: OnbColors.text3)),
  );
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

/// A section title over a list, with its meta on the right ("3 to do").
class TeamSectionTitle extends StatelessWidget {
  const TeamSectionTitle(this.title, {super.key, this.meta, this.trailing});

  final String title;
  final String? meta;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.center,
    children: [
      Expanded(child: Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: TeamColors.ink))),
      if (meta != null) Text(meta!, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: OnbColors.text2)),
      ?trailing,
    ],
  );
}

/// The quiet line under a page ("Only you can see your notes.").
class TeamFootnote extends StatelessWidget {
  const TeamFootnote(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) =>
      Text(text, textAlign: TextAlign.center, style: const TextStyle(fontSize: 12, color: OnbColors.text3));
}

// ─── The person page ────────────────────────────────────────────────────────

/// Who they are (the person page's top): photo, name (both open their
/// profile), designation, who they report to, their buddy, and their stage
/// with the plant inside a blue pill on the right.
class TeamPersonHero extends StatelessWidget {
  const TeamPersonHero({
    super.key,
    required this.name,
    this.photoUrl,
    this.designation,
    required this.reportsLine,
    required this.buddyLine,
    this.buddyIsYou = false,
    required this.stage,
    required this.plant,
    this.onOpenProfile,
  });

  final String name;
  final String? photoUrl;
  final String? designation;
  final String reportsLine;
  final String buddyLine;
  final bool buddyIsYou;
  final String stage;
  final PlantState plant;
  final VoidCallback? onOpenProfile;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey('team-person-hero'),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), border: Border.all(color: OnbColors.line)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(
            button: onOpenProfile != null,
            label: 'Open $name’s profile',
            excludeSemantics: true,
            child: GestureDetector(onTap: onOpenProfile, child: OnbAvatar(name: name, photoUrl: photoUrl, size: 60)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                GestureDetector(
                  key: const ValueKey('team-person-name'),
                  onTap: onOpenProfile,
                  child: Text(name, style: const TextStyle(fontSize: 19, height: 1.2, fontWeight: FontWeight.w800, color: TeamColors.ink)),
                ),
                if (designation != null) ...[
                  const SizedBox(height: 3),
                  Text(designation!, style: const TextStyle(fontSize: 12, color: OnbColors.text2)),
                ],
                const SizedBox(height: 3),
                Text(reportsLine, style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
                const SizedBox(height: 3),
                Text(
                  buddyLine,
                  style: TextStyle(fontSize: 12, color: buddyIsYou ? TeamColors.reachOut : OnbColors.text3, fontWeight: buddyIsYou ? FontWeight.w600 : FontWeight.w400),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Container(
            key: const ValueKey('team-stage-pill'),
            height: 32,
            padding: const EdgeInsets.only(left: 4, right: 12),
            decoration: BoxDecoration(color: OnbColors.primary, borderRadius: BorderRadius.circular(999)),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 26,
                  height: 26,
                  decoration: const BoxDecoration(color: TeamColors.plantBg, shape: BoxShape.circle),
                  alignment: Alignment.bottomCenter,
                  clipBehavior: Clip.antiAlias,
                  child: FittedBox(fit: BoxFit.contain, alignment: Alignment.bottomCenter, child: Plant.of(plant, size: 20, sway: false, showPill: false)),
                ),
                const SizedBox(width: 4),
                Text(stage, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Colors.white)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// What a task row ends with.
enum TeamRowEnd { tick, chevron, locked, none }

/// One task on the team side (MgrTeamsProto's row): the kind's icon tile,
/// the title (struck through once done), what the joiner sees for it (a mini
/// avatar and its name) or a quiet line, a pill, and a tick box, a chevron
/// (opens its screen) or a lock.
class TeamTaskRow extends StatelessWidget {
  const TeamTaskRow({
    super.key,
    required this.kind,
    required this.title,
    this.pairName,
    this.pairPhotoUrl,
    this.pairLabel,
    this.sub,
    this.pill,
    this.pillBg = OnbColors.screen,
    this.pillFg = OnbColors.text2,
    this.end = TeamRowEnd.none,
    this.done = false,
    this.strike = true,
    this.busy = false,
    this.onOpen,
    this.onTick,
    this.divider = true,
  });

  final TeamTaskKind kind;
  final String title;

  /// The joiner, for the mini avatar in front of [pairLabel].
  final String? pairName;
  final String? pairPhotoUrl;

  /// What the joiner sees for this task ("Meet your manager").
  final String? pairLabel;
  final String? sub;
  final String? pill;
  final Color pillBg;
  final Color pillFg;
  final TeamRowEnd end;
  final bool done;

  /// Done rows are struck through (a review's "Reviewed" is not).
  final bool strike;
  final bool busy;
  final VoidCallback? onOpen;
  final VoidCallback? onTick;
  final bool divider;

  @override
  Widget build(BuildContext context) {
    final locked = end == TeamRowEnd.locked;
    final showPair = pairLabel != null && sub == null;
    return Opacity(
      opacity: locked ? 0.6 : 1,
      child: Container(
        constraints: const BoxConstraints(minHeight: 64),
        padding: const EdgeInsets.only(right: 6),
        decoration: BoxDecoration(border: divider ? const Border(bottom: BorderSide(color: OnbColors.line)) : null),
        child: Row(
          children: [
            Expanded(
              child: InkWell(
                onTap: locked ? null : onOpen,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(minHeight: 64),
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(12, 10, 6, 10),
                    child: Row(
                      children: [
                        Container(
                          width: 36,
                          height: 36,
                          decoration: BoxDecoration(color: kind.tint, borderRadius: BorderRadius.circular(10)),
                          child: Icon(kind.icon, size: 20, color: kind.fg),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                title,
                                style: TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w600,
                                  color: done ? OnbColors.text3 : TeamColors.ink,
                                  decoration: done && strike ? TextDecoration.lineThrough : null,
                                ),
                              ),
                              if (showPair) ...[
                                const SizedBox(height: 4),
                                Row(
                                  children: [
                                    OnbAvatar(name: pairName ?? '', photoUrl: pairPhotoUrl, size: 18),
                                    const SizedBox(width: 6),
                                    Flexible(child: Text(pairLabel!, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: OnbColors.text3))),
                                  ],
                                ),
                              ] else if (sub != null) ...[
                                const SizedBox(height: 4),
                                Text(sub!, style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
                              ],
                            ],
                          ),
                        ),
                        if (pill != null) ...[const SizedBox(width: 6), TeamPill(pill!, background: pillBg, foreground: pillFg)],
                      ],
                    ),
                  ),
                ),
              ),
            ),
            if (busy)
              const SizedBox(width: 40, height: 40, child: Center(child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))))
            else
              switch (end) {
                TeamRowEnd.locked => const SizedBox(
                  width: 40,
                  height: 40,
                  child: Icon(Icons.lock_outline_rounded, size: 18, color: OnbColors.icon, semanticLabel: 'Locked'),
                ),
                TeamRowEnd.chevron => const SizedBox(width: 40, height: 40, child: Icon(Icons.chevron_right_rounded, size: 20, color: OnbColors.icon)),
                TeamRowEnd.tick => Semantics(
                  checked: done,
                  label: 'Done: $title',
                  excludeSemantics: true,
                  child: InkResponse(
                    key: const ValueKey('team-tick'),
                    onTap: onTick,
                    radius: 22,
                    child: SizedBox(
                      width: 40,
                      height: 40,
                      child: Center(
                        child: Container(
                          width: 26,
                          height: 26,
                          decoration: BoxDecoration(
                            color: done ? TeamColors.tickGreen : Colors.white,
                            borderRadius: BorderRadius.circular(8),
                            border: done ? null : Border.all(color: OnbColors.lineDark, width: 2),
                          ),
                          child: done ? const Icon(Icons.check_rounded, size: 16, color: Colors.white) : null,
                        ),
                      ),
                    ),
                  ),
                ),
                TeamRowEnd.none => const SizedBox(width: 6),
              },
          ],
        ),
      ),
    );
  }
}

/// The main card: "Your tasks for Priya" (or "Help Priya with"), a blue
/// outline, the count in red ("2 to do", green "All done"), what is due now,
/// and "View all" along the bottom.
class TeamTasksCard extends StatelessWidget {
  const TeamTasksCard({super.key, required this.title, required this.openCount, required this.rows, this.emptyText, required this.onViewAll});

  final String title;
  final int openCount;
  final List<Widget> rows;
  final String? emptyText;
  final VoidCallback onViewAll;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey('team-tasks-card'),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: OnbColors.primary, width: 1.5),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 14, 14, 8),
            child: Row(
              children: [
                Expanded(child: Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: TeamColors.ink))),
                TeamPill(
                  openCount > 0 ? '$openCount to do' : 'All done',
                  key: const ValueKey('team-tasks-count'),
                  background: openCount > 0 ? TeamColors.countRedBg : TeamColors.okBg,
                  foreground: openCount > 0 ? TeamColors.countRedFg : TeamColors.okFg,
                  height: 26,
                ),
              ],
            ),
          ),
          if (rows.isNotEmpty)
            DecoratedBox(
              decoration: const BoxDecoration(border: Border(top: BorderSide(color: OnbColors.line))),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: rows),
            )
          else
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 4, 14, 12),
              child: Text(emptyText ?? 'Nothing due right now.', style: const TextStyle(fontSize: 13, color: OnbColors.text3)),
            ),
          Material(
            color: TeamColors.viewAllBg,
            child: InkWell(
              key: const ValueKey('team-view-all'),
              onTap: onViewAll,
              child: Container(
                height: 46,
                alignment: Alignment.center,
                decoration: const BoxDecoration(border: Border(top: BorderSide(color: OnbColors.line))),
                child: const Text('View all', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: OnbColors.primary)),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// One of the two smaller tiles under the tasks card: a label, the line
/// that matters (with a status dot when [dot]), and a link at the foot.
class TeamSmallTile extends StatelessWidget {
  const TeamSmallTile({super.key, required this.label, required this.line, this.dot, required this.link, this.linkColor = OnbColors.primary, required this.onTap});

  final String label;
  final String line;

  /// The line's colour and a dot before it (On track green, delayed amber).
  final Color? dot;
  final String link;
  final Color linkColor;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
    color: Colors.white,
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: const BorderSide(color: OnbColors.line)),
    clipBehavior: Clip.antiAlias,
    child: InkWell(
      onTap: onTap,
      child: Container(
        constraints: const BoxConstraints(minHeight: 96),
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: OnbColors.text2)),
            const SizedBox(height: 6),
            Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                if (dot != null) ...[
                  Container(width: 8, height: 8, decoration: BoxDecoration(color: dot, shape: BoxShape.circle)),
                  const SizedBox(width: 6),
                ],
                Flexible(
                  child: Text(line, style: TextStyle(fontSize: 14, height: 1.3, fontWeight: FontWeight.w700, color: dot ?? TeamColors.ink)),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(link, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: linkColor)),
          ],
        ),
      ),
    ),
  );
}

// ─── Reach out ──────────────────────────────────────────────────────────────

/// A way to reach out (a block on "Reach out to Priya").
class TeamReachOutWay {
  const TeamReachOutWay({required this.key, required this.title, required this.meta, required this.icon, required this.tint, required this.fg, required this.onTap});

  final String key;
  final String title;
  final String meta;
  final IconData icon;
  final Color tint;
  final Color fg;
  final VoidCallback onTap;
}

/// The ways to reach out, as blocks two to a row.
class TeamReachOutBlocks extends StatelessWidget {
  const TeamReachOutBlocks({super.key, required this.ways});

  final List<TeamReachOutWay> ways;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, box) {
      final w = (box.maxWidth - 10) / 2;
      return Wrap(
        spacing: 10,
        runSpacing: 10,
        children: [
          for (final way in ways)
            SizedBox(
              width: w,
              child: Material(
                key: ValueKey('reach-${way.key}'),
                color: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18), side: const BorderSide(color: OnbColors.line)),
                clipBehavior: Clip.antiAlias,
                child: InkWell(
                  onTap: way.onTap,
                  child: Container(
                    constraints: const BoxConstraints(minHeight: 120),
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Container(
                          width: 44,
                          height: 44,
                          decoration: BoxDecoration(color: way.tint, borderRadius: BorderRadius.circular(14)),
                          child: Icon(way.icon, size: 22, color: way.fg),
                        ),
                        const SizedBox(height: 10),
                        Text(way.title, style: const TextStyle(fontSize: 14, height: 1.25, fontWeight: FontWeight.w700, color: TeamColors.ink)),
                        const SizedBox(height: 2),
                        Text(way.meta, style: const TextStyle(fontSize: 11, height: 1.35, color: OnbColors.text3)),
                      ],
                    ),
                  ),
                ),
              ),
            ),
        ],
      );
    },
  );
}

/// The app's doors the reach-out blocks open, registered by the shell that
/// hosts the Team tab (a game, the Connect composer, a chat). Unset ones
/// fall back to what the onboarding screens can do on their own.
abstract final class TeamReachOutDoors {
  static void Function(BuildContext context)? openGames;
  static void Function(BuildContext context)? openComposer;
  static void Function(BuildContext context, String userId)? openChat;
}

// ─── View progress ──────────────────────────────────────────────────────────

/// A row on "Priya’s onboarding": what it is, "2/4 met", a bar, its flag
/// ("2 to go", "Done", "1 delayed") and a chevron to its list.
class TeamStatRow extends StatelessWidget {
  const TeamStatRow({
    super.key,
    required this.title,
    required this.value,
    required this.meta,
    required this.fraction,
    required this.bar,
    required this.flag,
    required this.flagBg,
    required this.flagFg,
    this.onTap,
    this.divider = true,
  });

  final String title;
  final String value;
  final String meta;
  final double fraction;
  final Color bar;
  final String flag;
  final Color flagBg;
  final Color flagFg;
  final VoidCallback? onTap;
  final bool divider;

  @override
  Widget build(BuildContext context) => Material(
    color: Colors.white,
    child: InkWell(
      onTap: onTap,
      child: Container(
        constraints: const BoxConstraints(minHeight: 68),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(border: divider ? const Border(bottom: BorderSide(color: OnbColors.line)) : null),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.baseline,
                    textBaseline: TextBaseline.alphabetic,
                    children: [
                      Expanded(child: Text(title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: TeamColors.ink))),
                      Text.rich(
                        TextSpan(
                          children: [
                            TextSpan(text: value, style: const TextStyle(fontWeight: FontWeight.w800)),
                            TextSpan(text: ' $meta'),
                          ],
                        ),
                        style: const TextStyle(fontSize: 12, color: OnbColors.text2),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(999),
                    child: LinearProgressIndicator(value: fraction.clamp(0.0, 1.0), minHeight: 5, backgroundColor: OnbColors.line, color: bar),
                  ),
                ],
              ),
            ),
            if (flag.isNotEmpty) ...[const SizedBox(width: 12), TeamPill(flag, background: flagBg, foreground: flagFg)],
            const SizedBox(width: 8),
            const Icon(Icons.chevron_right_rounded, size: 16, color: OnbColors.icon),
          ],
        ),
      ),
    ),
  );
}

/// A plain row in a progress list: its name, an optional line, a status pill.
class TeamStatusRow extends StatelessWidget {
  const TeamStatusRow({super.key, required this.title, this.meta, required this.status, required this.bg, required this.fg, this.divider = true});

  final String title;
  final String? meta;
  final String status;
  final Color bg;
  final Color fg;
  final bool divider;

  @override
  Widget build(BuildContext context) => Container(
    constraints: const BoxConstraints(minHeight: 58),
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
    decoration: BoxDecoration(border: divider ? const Border(bottom: BorderSide(color: OnbColors.line)) : null),
    child: Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: TeamColors.ink)),
              if (meta != null && meta!.isNotEmpty) ...[
                const SizedBox(height: 2),
                Text(meta!, style: const TextStyle(fontSize: 12, color: OnbColors.text3)),
              ],
            ],
          ),
        ),
        const SizedBox(width: 12),
        TeamPill(status, background: bg, foreground: fg),
      ],
    ),
  );
}

/// A banner over the progress list when something is held up.
class TeamDelayBanner extends StatelessWidget {
  const TeamDelayBanner(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
    decoration: BoxDecoration(color: TeamColors.warnBg, borderRadius: BorderRadius.circular(14)),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('DELAYED', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.88, color: TeamColors.warnFg)),
        const SizedBox(height: 2),
        Text(text, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: TeamColors.ink)),
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
