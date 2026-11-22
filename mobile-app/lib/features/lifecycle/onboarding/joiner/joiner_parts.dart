import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../data/onboarding_api.dart';
import '../presentation/onboarding_kit.dart';
import 'joiner_api.dart';
import 'joiner_models.dart';

/// One answer for the home and every screen it opens (FINAL-DESIGNS.md §4.2):
/// the screens read [data], a write replaces it with the server's answer.
/// [lens] is the step looked at from the strip; it holds across the screens.
class JoinerController extends ChangeNotifier {
  JoinerController({required this.shell, required this.api, JoinerOnboarding? initial}) : data = initial;

  final OnboardingShell shell;
  final JoinerApi api;
  JoinerOnboarding? data;
  String? error;
  String? lens;
  bool _disposed = false;

  Future<void> first() async {
    if (data == null) {
      try {
        final kept = await api.kept();
        if (kept != null && data == null) set(kept);
      } catch (_) {
        // Nothing kept on the device: the live read paints.
      }
    }
    await load();
  }

  Future<void> load() async {
    try {
      set(await api.fetch());
      error = null;
    } catch (e) {
      error = onboardingErrorText(e);
      _notify();
    }
  }

  void set(JoinerOnboarding value) {
    data = value;
    _notify();
  }

  void look(String? key) {
    lens = key;
    _notify();
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}

/// Opens [page] over the current one and reads the joiner's answer again after.
Future<void> pushJoiner(BuildContext context, JoinerController c, Widget page) async {
  await Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => page));
  unawaited(c.load());
}

// ─── Pieces drawn as the canvas draws them ─────────────────────────────────

const jGreenDark = Color(0xFF15803D);

/// "People to meet  ·  2 of 3 met".
class JSectionHead extends StatelessWidget {
  const JSectionHead({super.key, required this.title, this.meta = ''});

  final String title;
  final String meta;

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.baseline,
    textBaseline: TextBaseline.alphabetic,
    children: [
      Expanded(
        child: Semantics(header: true, child: Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: OnbColors.text))),
      ),
      if (meta.isNotEmpty) Text(meta, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: OnbColors.text2)),
    ],
  );
}

/// The white card the rows sit in.
class JListCard extends StatelessWidget {
  const JListCard({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Container(
    clipBehavior: Clip.antiAlias,
    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: OnbColors.line)),
    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
  );
}

/// The grey strip: COMING UP, IN MONTH 1, NOW · WEEK 1.
class JStrip extends StatelessWidget {
  const JStrip(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
    decoration: const BoxDecoration(color: OnbColors.screen, border: Border(bottom: BorderSide(color: OnbColors.line))),
    child: Semantics(
      header: true,
      child: Text(text, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.88, color: OnbColors.text3)),
    ),
  );
}

class JPill extends StatelessWidget {
  const JPill(this.text, {super.key, this.amber = false});

  final String text;
  final bool amber;

  @override
  Widget build(BuildContext context) => Container(
    height: 24,
    padding: const EdgeInsets.symmetric(horizontal: 8),
    alignment: Alignment.center,
    decoration: BoxDecoration(color: amber ? OnbColors.amberTint : OnbColors.screen, borderRadius: BorderRadius.circular(999)),
    child: Text(text, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: amber ? OnbColors.amber : OnbColors.text2)),
  );
}

class JIconChip extends StatelessWidget {
  const JIconChip({super.key, required this.icon, required this.tint, required this.color, this.size = 36, this.radius = 10, this.iconSize = 20, this.round = false});

  /// The canvas's round speech bubble (Check-ins, Say hi) in place of [icon].
  const JIconChip.chat({super.key, required this.tint, required this.color, this.size = 36, this.radius = 10, this.iconSize = 20})
    : icon = Icons.chat_bubble_outline_rounded,
      round = true;

  final IconData icon;
  final bool round;
  final Color tint;
  final Color color;
  final double size;
  final double radius;
  final double iconSize;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    decoration: BoxDecoration(color: tint, borderRadius: BorderRadius.circular(radius)),
    alignment: Alignment.center,
    child: round ? RoundChatIcon(size: iconSize, color: color) : Icon(icon, size: iconSize, color: color),
  );
}

/// The canvas's round speech bubble (an 8-radius circle with a tail, 1.8 stroke).
class RoundChatIcon extends StatelessWidget {
  const RoundChatIcon({super.key, this.size = 20, required this.color});

  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final hex = '#${(color.toARGB32() & 0xFFFFFF).toRadixString(16).padLeft(6, '0')}';
    return SvgPicture.string(
      '<svg viewBox="0 0 24 24" fill="none" stroke="$hex" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 1 3.5 6.6L4 20l1.4-3.5A8 8 0 0 1 4 12z"/></svg>',
      width: size,
      height: size,
    );
  }
}

/// A rounded pill at the row's end: the verb ("Start", "Review"), outlined;
/// [filled] for Check-ins' "Start".
class JVerbPill extends StatelessWidget {
  const JVerbPill(this.text, {super.key, this.filled = false});

  final String text;
  final bool filled;

  @override
  Widget build(BuildContext context) => Container(
    height: 32,
    padding: const EdgeInsets.symmetric(horizontal: 12),
    alignment: Alignment.center,
    decoration: BoxDecoration(
      color: filled ? OnbColors.primary : Colors.white,
      borderRadius: BorderRadius.circular(999),
      border: filled ? null : Border.all(color: OnbColors.lineDark),
    ),
    child: Text(text, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: filled ? Colors.white : OnbColors.primary)),
  );
}

/// The green done circle.
class JDoneDot extends StatelessWidget {
  const JDoneDot({super.key, this.size = 26});

  final double size;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    decoration: const BoxDecoration(color: OnbColors.successDot, shape: BoxShape.circle),
    child: Icon(Icons.check_rounded, size: size * 0.6, color: Colors.white),
  );
}

const jLock = Icon(Icons.lock_outline_rounded, size: 18, color: OnbColors.icon, semanticLabel: 'Locked');

class JBar extends StatelessWidget {
  const JBar({super.key, required this.value, required this.color, this.height = 6});

  final double value;
  final Color color;
  final double height;

  @override
  Widget build(BuildContext context) => ClipRRect(
    borderRadius: BorderRadius.circular(999),
    child: SizedBox(
      height: height,
      child: LinearProgressIndicator(value: value.clamp(0, 1).toDouble(), backgroundColor: OnbColors.line, color: color),
    ),
  );
}

/// The tint a person wears by who they are to the joiner.
(Color, Color) roleTint(String role) => switch (role) {
  'hr' => (OnbColors.blueTint, OnbColors.blue),
  'manager' => (OnbColors.successTint, jGreenDark),
  'buddy' => (OnbColors.amberTint, OnbColors.amber),
  'it' => (OnbColors.screen, OnbColors.text2),
  _ => (OnbColors.violetTint, OnbColors.violet),
};

/// A face: the photo, else the initials on the role's tint.
class JFace extends StatelessWidget {
  const JFace({super.key, required this.name, required this.role, this.photoUrl, this.size = 40, this.ring = false, this.initials});

  final String name;
  final String role;
  final String? photoUrl;
  final double size;
  final bool ring;
  final String? initials;

  @override
  Widget build(BuildContext context) {
    final url = photoUrl;
    if (url != null && url.isNotEmpty) {
      return Container(
        decoration: ring ? BoxDecoration(shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 2)) : null,
        child: OnbAvatar(name: name, photoUrl: url, size: size),
      );
    }
    final (tint, fg) = roleTint(role);
    return Semantics(
      image: true,
      label: name,
      child: Container(
        width: size,
        height: size,
        alignment: Alignment.center,
        decoration: BoxDecoration(color: tint, shape: BoxShape.circle, border: ring ? Border.all(color: Colors.white, width: 2) : null),
        child: Text(
          initials ?? OnbAvatar.initials(name),
          style: TextStyle(fontSize: size * 0.33, fontWeight: FontWeight.w700, color: fg),
        ),
      ),
    );
  }
}

/// A meeting's face: the person, else the role.
JFace meetingFace(JoinerMeeting m, {double size = 40, bool ring = false}) => JFace(
  name: m.person?.name ?? m.roleLabel,
  initials: m.person?.initials,
  photoUrl: m.person?.photoUrl,
  role: m.withRole,
  size: size,
  ring: ring,
);

/// Rows with the canvas's lines between them.
List<Widget> withLines(List<Widget> rows) => [
  for (final (i, r) in rows.indexed)
    i == rows.length - 1 ? r : DecoratedBox(decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: OnbColors.line))), child: r),
];

/// The page's list with the canvas's padding and 20 between sections.
class JPage extends StatelessWidget {
  const JPage({super.key, required this.children, this.onRefresh});

  final List<Widget> children;
  final Future<void> Function()? onRefresh;

  @override
  Widget build(BuildContext context) {
    final list = ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
      children: [
        for (final (i, c) in children.indexed) ...[if (i > 0) const SizedBox(height: 20), c],
      ],
    );
    final refresh = onRefresh;
    return refresh == null ? list : RefreshIndicator(onRefresh: refresh, child: list);
  }
}

/// A joiner screen over the controller: the app's header and tabs, the
/// title, and the body once the answer is in.
class JoinerScaffold extends StatelessWidget {
  const JoinerScaffold({super.key, required this.c, required this.title, required this.body, this.onBack});

  final JoinerController c;
  final String title;
  final Widget Function(JoinerOnboarding d) body;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: c,
    builder: (context, _) {
      final d = c.data;
      return OnbScaffold(
        shell: c.shell,
        title: title,
        onBack: onBack,
        offline: d != null && c.error != null,
        body: d == null ? OnbLoadState(error: c.error, onRetry: c.load) : body(d),
      );
    },
  );
}
