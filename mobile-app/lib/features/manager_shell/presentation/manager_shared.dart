part of '../../manager/presentation/manager_screen.dart';

class _TopBar extends StatelessWidget {
  const _TopBar({required this.title, this.sub, this.onBack});

  final String title;
  final String? sub;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 52, 16, 12),
      decoration: const BoxDecoration(
        color: MColors.bg,
        border: Border(bottom: BorderSide(color: MColors.line)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              if (onBack != null)
                RoundIconButton(
                  icon: Icons.chevron_left_rounded,
                  onTap: onBack!,
                )
              else
                const SizedBox(width: 38),
              const SizedBox(width: 38),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            title,
            style: const TextStyle(
              color: MColors.ink,
              fontSize: 30,
              fontWeight: FontWeight.w800,
              height: 1.08,
              letterSpacing: -0.6,
            ),
          ),
          if (sub != null) ...[
            const SizedBox(height: 5),
            Text(
              sub!,
              style: const TextStyle(color: MColors.inkSoft, fontSize: 14.5),
            ),
          ],
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title, this.trailing, this.onTap});

  final String title;
  final String? trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: Row(
        children: [
          Expanded(
            child: Text(
              title,
              style: const TextStyle(
                color: MColors.ink,
                fontSize: 19,
                fontWeight: FontWeight.w800,
                letterSpacing: -0.1,
              ),
            ),
          ),
          if (trailing != null)
            InkWell(
              borderRadius: BorderRadius.circular(8),
              onTap: onTap,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Text(
                  trailing!,
                  style: TextStyle(
                    color: onTap == null ? MColors.inkSoft : MColors.terra,
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class PressableCard extends StatelessWidget {
  const PressableCard({
    super.key,
    required this.child,
    this.onTap,
    this.padding = const EdgeInsets.all(16),
    this.color = Colors.white,
    this.borderColor = MColors.line,
    this.dashed = false,
  });

  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsetsGeometry padding;
  final Color color;
  final Color borderColor;
  final bool dashed;

  @override
  Widget build(BuildContext context) {
    final card = AnimatedContainer(
      duration: const Duration(milliseconds: 160),
      padding: padding,
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: borderColor, width: dashed ? 1.5 : 1),
        boxShadow: color == Colors.white
            ? [
                BoxShadow(
                  color: const Color(0xFF462D1C).withValues(alpha: .04),
                  blurRadius: 22,
                  offset: const Offset(0, 10),
                ),
              ]
            : null,
      ),
      child: child,
    );

    if (onTap == null) return card;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: card,
      ),
    );
  }
}

class IconBox extends StatelessWidget {
  const IconBox({
    super.key,
    required this.icon,
    required this.color,
    required this.tint,
    this.size = 44,
    this.iconSize = 22,
  });

  final IconData icon;
  final Color color;
  final Color tint;
  final double size;
  final double iconSize;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: tint,
        borderRadius: BorderRadius.circular(size * .3),
      ),
      child: Icon(icon, color: color, size: iconSize),
    );
  }
}

class AvatarBadge extends StatelessWidget {
  const AvatarBadge({
    super.key,
    required this.initial,
    required this.index,
    required this.size,
  });

  final String initial;
  final int index;
  final double size;

  @override
  Widget build(BuildContext context) {
    final color = avatarColors[index % avatarColors.length];
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      alignment: Alignment.center,
      child: Text(
        initial,
        style: TextStyle(
          color: Colors.white,
          fontSize: size * .42,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class RoundIconButton extends StatelessWidget {
  const RoundIconButton({
    super.key,
    this.icon,
    required this.onTap,
    this.child,
  });

  final IconData? icon;
  final VoidCallback onTap;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(99),
      onTap: onTap,
      child: Container(
        width: 38,
        height: 38,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(color: MColors.line),
          shape: BoxShape.circle,
        ),
        child: child ?? Icon(icon, color: MColors.ink),
      ),
    );
  }
}

class ActionButton extends StatelessWidget {
  const ActionButton({
    super.key,
    required this.label,
    required this.background,
    required this.foreground,
    this.onTap,
    this.icon,
    this.border,
  });

  final String label;
  final Color background;
  final Color foreground;
  final VoidCallback? onTap;
  final IconData? icon;
  final Color? border;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: background,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: border == null
                ? null
                : Border.all(color: border!, width: 1.5),
          ),
          alignment: Alignment.center,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (icon != null) ...[
                Icon(icon, color: foreground, size: 18),
                const SizedBox(width: 7),
              ],
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: foreground,
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

String shortDate(DateTime date) {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return '${months[date.month - 1]} ${date.day}';
}

String _periodLabel(String period) {
  final date = DateTime.tryParse('$period-01');
  return date == null ? period : _monthName(date.month).substring(0, 3);
}

String _periodTitle(String period) {
  final date = DateTime.tryParse('$period-01');
  return date == null ? period : '${_monthName(date.month)} ${date.year}';
}

String daysAgo(DateTime requestedOn) {
  final days = math.max(0, DateTime.now().difference(requestedOn).inDays);
  return days <= 1 ? '$days day' : '$days days';
}

String _managerDate(DateTime date) {
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return '${date.day} ${_monthName(date.month)} · ${weekdays[date.weekday - 1]}';
}

String _monthName(int month) {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return months[month - 1];
}

Color scoreColor(double score) {
  if (score >= 4.25) return MColors.sageDeep;
  if (score >= 3.5) return MColors.gold;
  if (score >= 2.5) return MColors.terra;
  return MColors.live;
}

/// Qualitative word shown under a parameter score, as in the feedback design.
String scoreLabel(double score) {
  if (score <= 0) return '-';
  if (score >= 4.25) return 'Excellent';
  if (score >= 3.5) return 'Strong';
  if (score >= 2.5) return 'On track';
  return 'Needs work';
}

(Color, Color) leavePalette(String type) {
  return switch (type) {
    'Sick' => (MColors.live, const Color(0xFFFBE6E3)),
    'Earned' => (MColors.teal, MColors.sageTint),
    'Personal' => (MColors.plum, MColors.plumTint),
    _ => (MColors.gold, MColors.goldTint),
  };
}

(Color, Color) awardPalette(String key) {
  return switch (key) {
    'artist' => (MColors.plum, MColors.plumTint),
    'mentor' => (MColors.teal, MColors.sageTint),
    'culture' => (MColors.terra, MColors.terraTint),
    _ => (MColors.gold, MColors.goldTint),
  };
}

IconData awardIcon(String icon) {
  return switch (icon) {
    'palette' => Icons.palette_outlined,
    'school' => Icons.school_outlined,
    'heart' => Icons.favorite_border_rounded,
    _ => Icons.star_border_rounded,
  };
}

/// One-line copy under each parameter name on the feedback form. Held here
/// rather than on the API: it is static presentation copy, not record data.
/// Falls back to an empty string so an unknown parameter simply shows no line.
String paramDescription(String name) {
  return switch (name) {
    'Performance' => 'Delivers quality work consistently and on time',
    'Collaboration' => 'Works well with teammates and cross-team',
    'Ownership' => 'Takes responsibility and follows through',
    'Communication' => 'Clarity and impact in interactions',
    _ => '',
  };
}

/// Longer guidance revealed by the info toggle on a parameter card.
String paramHelp(String name) {
  return switch (name) {
    'Ownership' =>
      'Takes responsibility end-to-end, unblocks themselves, and follows through without being chased.',
    'Communication' => 'Shares context clearly and on time so others can act.',
    'Performance' =>
      'Output is accurate, thorough and reliable, with few rework loops.',
    'Collaboration' =>
      'Works well across functions, gives and receives feedback, and lifts the team.',
    _ => 'How this person performed on this parameter this month.',
  };
}

const List<Color> avatarColors = [
  Color(0xFFBE5A36),
  Color(0xFF4F8C89),
  Color(0xFF8A6AA0),
  Color(0xFFC98A2E),
  Color(0xFF7E8B6E),
  Color(0xFFC0392B),
  Color(0xFF3563C4),
];

class MColors {
  static const bg = Color(0xFFF4EEE5);
  static const ink = Color(0xFF2A2420);
  static const inkSoft = Color(0xFF6E655C);
  static const inkFaint = Color(0xFFA79D92);
  static const line = Color(0xFFF0E8DD);
  static const terra = Color(0xFFBE5A36);
  static const terraDeep = Color(0xFF7C3318);
  static const terraTint = Color(0xFFF6E5DB);
  static const gold = Color(0xFFC98A2E);
  static const goldTint = Color(0xFFF4ECDD);
  static const sage = Color(0xFF7E8B6E);
  static const sageDeep = Color(0xFF4C5840);
  static const sageTint = Color(0xFFDEEBE9);
  static const live = Color(0xFFC0392B);
  static const plum = Color(0xFF8A6AA0);
  static const plumTint = Color(0xFFEEE6F0);
  static const teal = Color(0xFF4F8C89);
}

InputDecoration _fieldDecoration(
  String hint, {
  IconData? suffix,
  VoidCallback? onSuffixTap,
  bool suffixActive = false,
}) {
  return InputDecoration(
    hintText: hint,
    hintStyle: const TextStyle(color: MColors.inkFaint),
    suffixIcon: suffix == null
        ? null
        : IconButton(
            tooltip: suffixActive ? 'Stop listening' : 'Dictate feedback',
            onPressed: onSuffixTap,
            icon: Icon(
              suffix,
              color: suffixActive ? MColors.live : MColors.terra,
              size: 19,
            ),
          ),
    filled: true,
    fillColor: Colors.white,
    contentPadding: const EdgeInsets.all(13),
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(13),
      borderSide: const BorderSide(color: MColors.line, width: 1.5),
    ),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(13),
      borderSide: const BorderSide(color: MColors.line, width: 1.5),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(13),
      borderSide: const BorderSide(color: MColors.terra, width: 1.5),
    ),
  );
}

int _daysUntil(DateTime today, DateTime date) {
  final a = DateTime(today.year, today.month, today.day);
  final b = DateTime(date.year, date.month, date.day);
  return b.difference(a).inDays;
}
