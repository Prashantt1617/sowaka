part of '../../quick_actions/presentation/quick_actions_screen.dart';

/// The Placements pages' look: the Actions pages' own (Leave, Overtime,
/// Reimbursement). Sora on the grey ground of the Leave hub, white cards with
/// a hairline shadow, grey upper-case labels, the app's blue on what is
/// pressed, and the Actions terra for Placements' own touches.
abstract final class Pl {
  static const font = 'Sora';

  /// The Leave hub's and the Apply leave form's ground.
  static const ground = Color(0xFFF7F7F9);
  static const card = Colors.white;
  static const border = Color(0xFFF3F4F6);
  static const line = Color(0xFFF3F4F6);

  /// A field's outline, as [_FormTextField] draws it.
  static const field = Color(0xFFE5E7EB);
  static const chip = Color(0xFFF3F4F6);
  static const stone = Color(0xFFF7F7F9);

  static const ink = Color(0xFF111827);
  static const ink2 = Color(0xFF374151);
  static const muted = Color(0xFF6B7280);
  static const faint = Color(0xFF9CA3AF);
  static const icon = Color(0xFF6B7280);
  static const hint = Color(0x80111827);

  static const accent = Color(0xFF0571A6);
  static const accentDeep = Color(0xFF0571A6);
  static const accentSoft = Color(0xFFF0F9FF);
  static const accentTint = Color(0xFFE0F2FE);
  static const accentText = Color(0xFF075985);
  static const accentDash = Color(0xFF96B7C7);

  /// The app's blue: the Actions pages' buttons, picked chips and links.
  static const action = Color(0xFF0571A6);

  /// [action] on a button that is not ready yet.
  static const actionMuted = Color(0xFF96B7C7);
  static const actionTint = Color(0xFFE0F2FE);

  static const danger = Color(0xFFB3261E);
  static const dangerSoft = Color(0xFFFEE2E2);

  static TextStyle text(
    double size, {
    FontWeight weight = FontWeight.w500,
    Color color = ink,
    double? height,
  }) => TextStyle(
    fontFamily: font,
    fontFamilyFallback: _soraFallback,
    fontSize: size,
    fontWeight: weight,
    color: color,
    height: height,
  );
}

/// The colours of a status pill.
typedef PillColors = ({Color background, Color text});

// The decisions' colours on the Leave and Overtime hubs.
const _green = (background: Color(0xFFDCFCE7), text: Color(0xFF16A34A));
const _orange = (background: _Q.terraTint, text: _Q.terra);
const _blue = (background: Color(0xFFDBEAFE), text: Pl.action);
const _grey = (background: Pl.chip, text: Pl.muted);
const _purple = (background: _Q.plumTint, text: _Q.plum);

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

/// The page frame: the grey ground under the design's header (a round Back,
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
    final chrome = _PlacementsChrome.of(context);
    // The Actions pages' frame, as [_HubScaffold] draws it: the app's
    // header, a round Back and the title on white, then the page.
    return Material(
      color: Pl.ground,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (chrome != null)
            AppHomeHeader(
              profileAction: chrome.profileAction,
              onNotifications: chrome.onNotifications,
              onQuickCreate: chrome.onQuickCreate,
            )
          else
            SizedBox(height: MediaQuery.of(context).padding.top),
          Container(
            constraints: const BoxConstraints(minHeight: 60),
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
            decoration: const BoxDecoration(
              color: Colors.white,
              border: Border(bottom: BorderSide(color: Color(0xFFF3F4F6))),
            ),
            child: Row(
              children: [
                Material(
                  color: const Color(0xFFF7F7F9),
                  shape: const CircleBorder(),
                  child: InkWell(
                    onTap: onBack ?? () => Navigator.of(context).maybePop(),
                    customBorder: const CircleBorder(),
                    child: SizedBox(
                      width: 36,
                      height: 36,
                      child: Center(
                        child: SvgPicture.asset(
                          'assets/icons/chevron_left_small.svg',
                          width: 17.9833,
                          height: 17.9833,
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontFamily: 'Sora',
                          color: Color(0xFF222222),
                          fontSize: 16,
                          height: 24 / 16,
                          letterSpacing: -0.2,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      if (subtitle != null)
                        Text(
                          subtitle!,
                          style: const TextStyle(
                            fontFamily: 'Sora',
                            color: _Q.inkSoft,
                            fontSize: 12,
                          ),
                        ),
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
    );
  }
}

/// A round button with an icon: on the grey of the header's Back, or [plain].
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
        color: plain ? Colors.transparent : Pl.ground,
        shape: const CircleBorder(),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: SizedBox(
            width: plain ? 40 : 36,
            height: plain ? 40 : 36,
            child: Icon(icon, size: plain ? 22 : 18, color: color),
          ),
        ),
      ),
    );
  }
}

/// "Add", as the Leave hub's Apply Leave in the header ([_LeaveHeaderButton]);
/// [outlined], the same on white in a section.
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
    final live = onTap != null;
    final fg = outlined
        ? (live ? Pl.action : Pl.faint)
        : (live ? Colors.white : Pl.faint);
    return Material(
      color: outlined ? Pl.card : (live ? Pl.action : const Color(0xFFE5E7EB)),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: outlined ? const BorderSide(color: Pl.field) : BorderSide.none,
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.add_rounded, size: 14, color: fg),
              const SizedBox(width: 4),
              Text(
                label,
                style: TextStyle(
                  fontFamily: Pl.font,
                  color: fg,
                  fontSize: 12,
                  height: 16.2 / 12,
                  letterSpacing: -0.16,
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

/// A white card with the hairline shadow of [_FormCard] and the hubs'
/// request cards.
class PlCard extends StatelessWidget {
  const PlCard({
    super.key,
    required this.child,
    this.onTap,
    this.padding = const EdgeInsets.all(16),
    this.radius = 16,
  });

  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsets padding;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final corners = BorderRadius.circular(radius);
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: corners,
        boxShadow: const [
          BoxShadow(
            color: Color(0x0A000000),
            blurRadius: 2,
            offset: Offset(0, 1),
          ),
        ],
      ),
      child: Material(
        color: Pl.card,
        borderRadius: corners,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(padding: padding, child: child),
        ),
      ),
    );
  }
}

/// A status, as the hubs set a decision on a pill.
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
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        label,
        maxLines: 1,
        style: Pl.text(
          11,
          weight: FontWeight.w600,
          color: colors.text,
          height: 16.5 / 11,
        ),
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

  /// Candidates are terra; companies grey.
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
          size * 0.31,
          weight: FontWeight.w700,
          color: warm ? Pl.accentText : Pl.ink2,
        ),
      ),
    );
  }
}

/// A choice chip in a row of filters or statuses: the picked one in the
/// app's blue, as the Upcoming / History switch picks.
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
      color: selected ? Pl.actionTint : Pl.card,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: selected ? Pl.action : Pl.field),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: 36),
          padding: const EdgeInsets.symmetric(horizontal: 14),
          alignment: Alignment.center,
          child: Text(
            label,
            style: Pl.text(
              12,
              weight: FontWeight.w700,
              color: selected ? Pl.action : Pl.muted,
              height: 16 / 12,
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
          style: _plFieldText,
          decoration: plInput(hint).copyWith(
            prefixIcon: const Icon(
              Icons.search_rounded,
              color: Pl.faint,
              size: 18,
            ),
            prefixIconConstraints: const BoxConstraints(
              minWidth: 40,
              minHeight: 40,
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
            const Expanded(child: _HomeSectionLabel('Sorted by date added')),
            Material(
              color: Pl.card,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
                side: const BorderSide(color: Pl.field),
              ),
              child: InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap: onSort,
                child: Container(
                  height: 36,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.swap_vert_rounded,
                        size: 16,
                        color: Pl.action,
                      ),
                      const SizedBox(width: 6),
                      Text(
                        newest ? 'Newest first' : 'Oldest first',
                        style: Pl.text(
                          12,
                          weight: FontWeight.w600,
                          color: Pl.ink,
                        ),
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

/// What a field's words are set in, as [_FormTextField] sets them.
const _plFieldText = TextStyle(
  fontFamily: Pl.font,
  fontFamilyFallback: _soraFallback,
  fontSize: 14,
  color: Pl.ink,
);

/// A field's box, as [_FormTextField] draws it: a grey outline on white.
InputDecoration plInput(String hint) {
  final outline = OutlineInputBorder(
    borderRadius: BorderRadius.circular(12),
    borderSide: const BorderSide(color: Pl.field),
  );
  return InputDecoration(
    hintText: hint,
    hintStyle: Pl.text(14, weight: FontWeight.w400, color: Pl.hint),
    isDense: true,
    filled: true,
    fillColor: Pl.card,
    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
    border: outline,
    enabledBorder: outline,
    disabledBorder: outline,
    focusedBorder: outline,
  );
}

/// A labelled field: the form's grey upper-case label ([_LeaveFieldLabel])
/// over a [_FormTextField], or a [_FormTextArea] when it takes [lines].
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
      textAlignVertical: lines > 1 ? TextAlignVertical.top : null,
      style: _plFieldText,
      decoration: plInput(
        hint,
      ).copyWith(contentPadding: lines > 1 ? const EdgeInsets.all(12) : null),
    );
    Widget row = Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (prefix != null) ...[
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: Pl.stone,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Pl.field),
            ),
            child: Text(
              prefix!,
              style: Pl.text(14, weight: FontWeight.w600, color: Pl.ink2),
            ),
          ),
          const SizedBox(width: 8),
        ],
        Expanded(child: input),
        if (suffix != null) ...[
          const SizedBox(width: 10),
          Center(
            child: Text(suffix!, style: Pl.text(14, color: Pl.muted)),
          ),
        ],
      ],
    );
    if (prefix != null || suffix != null) row = IntrinsicHeight(child: row);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _LeaveFieldLabel(label),
        row,
        if (note != null) ...[
          const SizedBox(height: 6),
          Text(note!, style: Pl.text(11.5, color: Pl.faint, height: 1.4)),
        ],
      ],
    );
  }
}

/// The page's main button, as [_FormSubmitBar] draws it: the app's blue,
/// muted until it can be pressed; or [danger] red, or [outlined] on white.
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
    final live = onTap != null || busy;
    final fill = outlined
        ? Pl.card
        : danger
        ? (live ? Pl.danger : const Color(0xFFE3A9A5))
        : (live ? Pl.action : Pl.actionMuted);
    final fg = outlined ? (danger ? Pl.danger : Pl.ink) : Colors.white;
    return Opacity(
      opacity: outlined && !live ? 0.5 : 1,
      child: Material(
        color: fill,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: outlined ? const BorderSide(color: Pl.field) : BorderSide.none,
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: busy ? null : onTap,
          child: SizedBox(
            height: 49,
            child: Center(
              child: busy
                  ? SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: outlined ? Pl.action : Colors.white,
                      ),
                    )
                  : Text(
                      label,
                      style: TextStyle(
                        fontFamily: Pl.font,
                        color: fg,
                        fontSize: 16,
                        height: 16.2 / 16,
                        letterSpacing: -0.16,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
            ),
          ),
        ),
      ),
    );
  }
}

/// What a page shows while it loads, when it fails, or when a list is empty:
/// a spinner, or the hubs' empty state ([_HubEmptyState]) with its picture,
/// its line, and Try again.
class PlState extends StatelessWidget {
  const PlState.loading({super.key})
    : message = null,
      onRetry = null,
      iconAsset = _defaultIcon,
      loading = true;
  const PlState.message(
    this.message, {
    super.key,
    this.onRetry,
    this.iconAsset = _defaultIcon,
  }) : loading = false;

  static const _defaultIcon = 'assets/icons/placements_briefcase.png';

  final String? message;
  final VoidCallback? onRetry;

  /// The picture over the line.
  final String iconAsset;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 48),
        child: Center(
          child: SizedBox(
            width: 24,
            height: 24,
            child: CircularProgressIndicator(strokeWidth: 2, color: Pl.action),
          ),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 40, 16, 24),
      child: Column(
        children: [
          Image.asset(iconAsset, width: 46, height: 46, fit: BoxFit.contain),
          const SizedBox(height: 12),
          Text(
            message ?? '',
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontFamily: Pl.font,
              color: Color(0xFF484848),
              fontSize: 12,
              height: 16.2 / 12,
              letterSpacing: -0.16,
              fontWeight: FontWeight.w600,
            ),
          ),
          if (onRetry != null) ...[
            const SizedBox(height: 8),
            Material(
              color: Pl.action,
              borderRadius: BorderRadius.circular(16),
              child: InkWell(
                onTap: onRetry,
                borderRadius: BorderRadius.circular(16),
                child: const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  child: Text(
                    'Try again',
                    style: TextStyle(
                      fontFamily: Pl.font,
                      color: Colors.white,
                      fontSize: 12,
                      height: 16.2 / 12,
                      letterSpacing: -0.16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// A section's heading, with an optional action at its end: a card title's
/// weight, in the words given.
class PlSectionHeading extends StatelessWidget {
  const PlSectionHeading(this.title, {super.key, this.trailing});

  final String title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text(
            title,
            style: Pl.text(14, weight: FontWeight.w700, height: 20 / 14),
          ),
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
        content: Text(message, style: Pl.text(13, color: Colors.white)),
      ),
    );
}
