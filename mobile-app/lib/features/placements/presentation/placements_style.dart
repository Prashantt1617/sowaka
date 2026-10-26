import 'package:flutter/material.dart';

import '../data/placements_models.dart';

/// The Placements pages' look, as the "Placements Quick Action" canvas draws
/// it: warm greys, white cards on a stone ground, one orange accent, Plus
/// Jakarta Sans.
abstract final class Pl {
  static const font = 'Plus Jakarta Sans';

  static const ground = Color(0xFFF7F5F3);
  static const card = Colors.white;
  static const border = Color(0xFFE7E2DD);
  static const line = Color(0xFFEFEBE7);
  static const field = Color(0xFFD6D0CA);
  static const chip = Color(0xFFF0ECE8);
  static const stone = Color(0xFFF5F2EF);

  static const ink = Color(0xFF1C1917);
  static const ink2 = Color(0xFF44403C);
  static const muted = Color(0xFF57534E);
  static const faint = Color(0xFF6B635D);
  static const icon = Color(0xFF78716C);
  static const hint = Color(0xFF8A827C);

  static const accent = Color(0xFFEA580C);
  static const accentDeep = Color(0xFFC2410C);
  static const accentSoft = Color(0xFFFFF7ED);
  static const accentTint = Color(0xFFFFEDD5);
  static const accentText = Color(0xFF9A3412);
  static const accentDash = Color(0xFFFDBA74);

  static const danger = Color(0xFFB91C1C);
  static const dangerSoft = Color(0xFFFEE2E2);

  static TextStyle text(
    double size, {
    FontWeight weight = FontWeight.w500,
    Color color = ink,
    double? height,
  }) => TextStyle(
    fontFamily: font,
    fontSize: size,
    fontWeight: weight,
    color: color,
    height: height,
  );
}

/// The colours of a status pill.
typedef PillColors = ({Color background, Color text});

const _green = (background: Color(0xFFDCFCE7), text: Color(0xFF166534));
const _orange = (background: Pl.accentTint, text: Pl.accentText);
const _blue = (background: Color(0xFFDBEAFE), text: Color(0xFF1E40AF));
const _grey = (background: Pl.chip, text: Pl.ink2);
const _purple = (background: Color(0xFFEDE9FE), text: Color(0xFF5B21B6));

PillColors stageColors(CandidateStage stage) => switch (stage) {
  CandidateStage.joined => _green,
  CandidateStage.inProcess => _orange,
  CandidateStage.notPlaced => _grey,
};

PillColors statusColors(PlacementStatus status) => switch (status) {
  PlacementStatus.shortlisted => _orange,
  PlacementStatus.interviewing => _blue,
  PlacementStatus.offered => _purple,
  PlacementStatus.joined => _green,
  PlacementStatus.dropped => _grey,
};

PillColors feeColors(bool paid) => paid ? _green : _orange;

/// "Fee paid" or "Fee pending".
String feeLabel(bool paid) => paid ? 'Fee paid' : 'Fee pending';

const _months = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', //
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/// "24 Oct 2026".
String plDate(DateTime? day) =>
    day == null ? '' : '${day.day} ${_months[day.month - 1]} ${day.year}';

/// "24 Oct".
String plShortDate(DateTime? day) =>
    day == null ? '' : '${day.day} ${_months[day.month - 1]}';

/// Up to two letters of a name: "Arjun Bhati" → "AB".
String initialsOf(String name) {
  final words = name.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty);
  final letters = words.take(2).map((w) => w.characters.first.toUpperCase());
  return letters.isEmpty ? '?' : letters.join();
}

/// The page frame: a stone ground under the design's header (a round Back,
/// the title with an optional line under it, and the page's own actions).
class PlPage extends StatelessWidget {
  const PlPage({
    super.key,
    required this.title,
    this.subtitle,
    this.actions = const [],
    required this.body,
    this.onBack,
    this.titleSize = 20,
  });

  final String title;
  final String? subtitle;
  final List<Widget> actions;
  final Widget body;
  final VoidCallback? onBack;
  final double titleSize;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Pl.ground,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
              child: Row(
                children: [
                  PlIconButton(
                    label: 'Back',
                    icon: Icons.chevron_left_rounded,
                    plain: true,
                    onTap: onBack ?? () => Navigator.of(context).maybePop(),
                  ),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Pl.text(titleSize, weight: FontWeight.w700),
                        ),
                        if (subtitle != null)
                          Text(subtitle!, style: Pl.text(12, color: Pl.muted)),
                      ],
                    ),
                  ),
                  ...actions,
                ],
              ),
            ),
            Expanded(child: body),
          ],
        ),
      ),
    );
  }
}

/// A 44 px round button with an icon: white on a border, or [plain].
class PlIconButton extends StatelessWidget {
  const PlIconButton({
    super.key,
    required this.label,
    required this.icon,
    required this.onTap,
    this.plain = false,
    this.color = Pl.ink,
  });

  final String label;
  final IconData icon;
  final VoidCallback? onTap;
  final bool plain;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: label,
      child: Material(
        color: plain ? Colors.transparent : Pl.card,
        shape: CircleBorder(
          side: plain ? BorderSide.none : const BorderSide(color: Pl.border),
        ),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: SizedBox(
            width: 44,
            height: 44,
            child: Icon(icon, size: plain ? 26 : 19, color: color),
          ),
        ),
      ),
    );
  }
}

/// The orange "+ Add" pill: filled in a page header, outlined in a section.
class PlAddButton extends StatelessWidget {
  const PlAddButton({
    super.key,
    required this.onTap,
    this.label = 'Add',
    this.outlined = false,
  });

  final VoidCallback? onTap;
  final String label;
  final bool outlined;

  @override
  Widget build(BuildContext context) {
    final fg = outlined ? Pl.accentDeep : Colors.white;
    return Material(
      color: outlined ? Pl.accentSoft : Pl.accent,
      shape: StadiumBorder(
        side: outlined
            ? const BorderSide(color: Pl.accent, width: 1.5)
            : BorderSide.none,
      ),
      child: InkWell(
        customBorder: const StadiumBorder(),
        onTap: onTap,
        child: Container(
          height: 40,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.add_rounded,
                size: 18,
                color: outlined ? Pl.accent : fg,
              ),
              const SizedBox(width: 6),
              Text(
                label,
                style: Pl.text(14, weight: FontWeight.w700, color: fg),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A white card with the design's border.
class PlCard extends StatelessWidget {
  const PlCard({
    super.key,
    required this.child,
    this.onTap,
    this.padding = const EdgeInsets.all(14),
    this.radius = 16,
  });

  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsets padding;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(radius),
      side: const BorderSide(color: Pl.border),
    );
    return Material(
      color: Pl.card,
      shape: shape,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(padding: padding, child: child),
      ),
    );
  }
}

class PlPill extends StatelessWidget {
  const PlPill(this.label, this.colors, {super.key});

  final String label;
  final PillColors colors;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: colors.background,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        label,
        maxLines: 1,
        style: Pl.text(12, weight: FontWeight.w700, color: colors.text),
      ),
    );
  }
}

/// A person's or a company's initials in a tinted square or circle.
class PlInitials extends StatelessWidget {
  const PlInitials(
    this.name, {
    super.key,
    this.size = 42,
    this.round = false,
    this.warm = false,
  });

  final String name;
  final double size;
  final bool round;

  /// Candidates are orange; companies stone.
  final bool warm;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: warm ? Pl.accentTint : Pl.chip,
        borderRadius: BorderRadius.circular(round ? size / 2 : size * 0.29),
      ),
      child: Text(
        initialsOf(name),
        style: Pl.text(
          size * 0.33,
          weight: FontWeight.w700,
          color: warm ? Pl.accentText : Pl.ink2,
        ),
      ),
    );
  }
}

/// A choice chip in a row of filters or statuses.
class PlChoice extends StatelessWidget {
  const PlChoice({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? Pl.accentSoft : Pl.card,
      shape: StadiumBorder(
        side: BorderSide(
          color: selected ? Pl.accent : Pl.field,
          width: selected ? 1.5 : 1,
        ),
      ),
      child: InkWell(
        customBorder: const StadiumBorder(),
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: 40),
          padding: const EdgeInsets.symmetric(horizontal: 14),
          alignment: Alignment.center,
          child: Text(
            label,
            style: Pl.text(
              13,
              weight: selected ? FontWeight.w700 : FontWeight.w600,
              color: selected ? Pl.accentDeep : Pl.ink2,
            ),
          ),
        ),
      ),
    );
  }
}

/// The list pages' search box, filters and newest/oldest switch.
class PlListControls extends StatelessWidget {
  const PlListControls({
    super.key,
    required this.search,
    required this.hint,
    required this.filters,
    required this.filter,
    required this.onFilter,
    required this.newest,
    required this.onSort,
  });

  final TextEditingController search;
  final String hint;
  final List<String> filters;
  final String filter;
  final ValueChanged<String> onFilter;
  final bool newest;
  final VoidCallback onSort;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: search,
          textInputAction: TextInputAction.search,
          style: Pl.text(15),
          decoration: plInput(hint).copyWith(
            prefixIcon: const Icon(
              Icons.search_rounded,
              color: Pl.icon,
              size: 20,
            ),
          ),
        ),
        const SizedBox(height: 12),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              for (final label in filters) ...[
                PlChoice(
                  label: label,
                  selected: label == filter,
                  onTap: () => onFilter(label),
                ),
                const SizedBox(width: 8),
              ],
            ],
          ),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: Text(
                'Sorted by date added',
                style: Pl.text(13, color: Pl.muted),
              ),
            ),
            Material(
              color: Pl.card,
              shape: const StadiumBorder(side: BorderSide(color: Pl.field)),
              child: InkWell(
                customBorder: const StadiumBorder(),
                onTap: onSort,
                child: Container(
                  height: 40,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.swap_vert_rounded,
                        size: 18,
                        color: Pl.accent,
                      ),
                      const SizedBox(width: 6),
                      Text(
                        newest ? 'Newest first' : 'Oldest first',
                        style: Pl.text(13, weight: FontWeight.w700),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// A form field's box.
InputDecoration plInput(String hint) => InputDecoration(
  hintText: hint,
  hintStyle: Pl.text(15, color: Pl.hint),
  isDense: true,
  filled: true,
  fillColor: Pl.card,
  contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
  border: OutlineInputBorder(
    borderRadius: BorderRadius.circular(12),
    borderSide: const BorderSide(color: Pl.field),
  ),
  enabledBorder: OutlineInputBorder(
    borderRadius: BorderRadius.circular(12),
    borderSide: const BorderSide(color: Pl.field),
  ),
  focusedBorder: OutlineInputBorder(
    borderRadius: BorderRadius.circular(12),
    borderSide: const BorderSide(color: Pl.accent, width: 1.5),
  ),
);

/// A labelled field.
class PlField extends StatelessWidget {
  const PlField({
    super.key,
    required this.label,
    required this.controller,
    this.hint = '',
    this.lines = 1,
    this.keyboard,
    this.prefix,
    this.suffix,
    this.note,
    this.capitalization = TextCapitalization.sentences,
  });

  final String label;
  final TextEditingController controller;
  final String hint;
  final int lines;
  final TextInputType? keyboard;

  /// A fixed box before the field: "+91", "₹".
  final String? prefix;

  /// Words after the field: "years".
  final String? suffix;
  final String? note;
  final TextCapitalization capitalization;

  @override
  Widget build(BuildContext context) {
    final input = TextField(
      controller: controller,
      minLines: lines,
      maxLines: lines,
      keyboardType: keyboard ?? (lines > 1 ? TextInputType.multiline : null),
      textCapitalization: capitalization,
      style: Pl.text(15),
      decoration: plInput(hint),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          label,
          style: Pl.text(13, weight: FontWeight.w600, color: Pl.ink2),
        ),
        const SizedBox(height: 6),
        Row(
          children: [
            if (prefix != null) ...[
              Container(
                height: 48,
                padding: const EdgeInsets.symmetric(horizontal: 14),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: Pl.stone,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Pl.field),
                ),
                child: Text(
                  prefix!,
                  style: Pl.text(15, weight: FontWeight.w600, color: Pl.ink2),
                ),
              ),
              const SizedBox(width: 8),
            ],
            Expanded(child: input),
            if (suffix != null) ...[
              const SizedBox(width: 10),
              Text(suffix!, style: Pl.text(15, color: Pl.muted)),
            ],
          ],
        ),
        if (note != null) ...[
          const SizedBox(height: 6),
          Text(note!, style: Pl.text(12, color: Pl.faint)),
        ],
      ],
    );
  }
}

/// The page's main button: orange, or [danger] red, or [outlined].
class PlButton extends StatelessWidget {
  const PlButton({
    super.key,
    required this.label,
    required this.onTap,
    this.busy = false,
    this.danger = false,
    this.outlined = false,
  });

  final String label;
  final VoidCallback? onTap;
  final bool busy;
  final bool danger;
  final bool outlined;

  @override
  Widget build(BuildContext context) {
    final fill = outlined
        ? Colors.transparent
        : (danger ? Pl.danger : Pl.accent);
    return Opacity(
      opacity: onTap == null && !busy ? 0.5 : 1,
      child: Material(
        color: fill,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: outlined ? const BorderSide(color: Pl.field) : BorderSide.none,
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: busy ? null : onTap,
          child: SizedBox(
            height: 52,
            child: Center(
              child: busy
                  ? const SizedBox(
                      width: 22,
                      height: 22,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : Text(
                      label,
                      style: Pl.text(
                        16,
                        weight: FontWeight.w700,
                        color: outlined ? Pl.ink : Colors.white,
                      ),
                    ),
            ),
          ),
        ),
      ),
    );
  }
}

/// What a page shows while it loads, when it fails, or when a list is empty.
class PlState extends StatelessWidget {
  const PlState.loading({super.key})
    : message = null,
      onRetry = null,
      loading = true;
  const PlState.message(this.message, {super.key, this.onRetry})
    : loading = false;

  final String? message;
  final VoidCallback? onRetry;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 48),
        child: Center(
          child: CircularProgressIndicator(strokeWidth: 2.4, color: Pl.accent),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 12),
      child: Column(
        children: [
          Text(
            message ?? '',
            textAlign: TextAlign.center,
            style: Pl.text(14, color: Pl.muted, height: 1.5),
          ),
          if (onRetry != null) ...[
            const SizedBox(height: 12),
            TextButton(
              onPressed: onRetry,
              child: Text(
                'Try again',
                style: Pl.text(
                  14,
                  weight: FontWeight.w700,
                  color: Pl.accentDeep,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// A section's heading, with an optional action at its end.
class PlSectionHeading extends StatelessWidget {
  const PlSectionHeading(this.title, {super.key, this.trailing});

  final String title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text(title, style: Pl.text(16, weight: FontWeight.w700)),
        ),
        ?trailing,
      ],
    );
  }
}

void plToast(BuildContext context, String message) {
  ScaffoldMessenger.maybeOf(context)
    ?..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Text(message, style: Pl.text(14, color: Colors.white)),
      ),
    );
}
