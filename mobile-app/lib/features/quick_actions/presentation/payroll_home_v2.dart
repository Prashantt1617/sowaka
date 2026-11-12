part of 'quick_actions_screen.dart';

// The Payroll home (R1 "Payroll home (revamp)"): a carousel of three summary
// cards — last pay period's salary, this FY's tax, the flexible split — that
// moves on by itself every 4 s and by swipe, with dots to pick one; then the
// to-dos, three quick actions and the Support Desk. Laid out as the design
// draws it (sizes, spacing, radii, order) in the Payroll pages' own type and
// colours.

/// The carousel card's step: the gap between two cards.
const double _prCardGap = 16;

/// The gross split into what reaches the bank, what is deducted and what
/// was lost to unpaid days.
const _prDeductionsBlue = Color(0xFF8CC3DE);
const _prDonutGrey = Color(0xFFD4D4DA);

/// Shades of the brand blue for the flexible heads, darkest first.
const _prHeadShades = [
  _prBlue,
  Color(0xFF4F9DC4),
  Color(0xFF9CCAE0),
  Color(0xFF6FB3D3),
  Color(0xFFC4E0EE),
];

const _prInk = Color(0xFF1F1F22);
const _prInkSoft = Color(0xFF55555C);
const _prInkFaint = Color(0xFF8E8E95);

/// "2026-27" → "2026–27".
String _fySpan(String fy) => fy.replaceAll('-', '–');

/// "April", or "April to October".
String _monthsLabel(DateTime? from, DateTime? to) {
  if (from == null) return '';
  if (to == null || (to.year == from.year && to.month == from.month)) {
    return _monthName(from.month);
  }
  return '${_monthName(from.month)} to ${_monthName(to.month)}';
}

extension _PayrollHomeV2 on _PayrollHomePageState {
  /// Everything under the hub header once the home has loaded.
  List<Widget> _homeV2(PayrollHome home) {
    final cards = home.cards;
    final salary = cards.salary;
    final tax = cards.tax;
    final fbp = cards.fbp;
    final summaries = <_PrSummary>[
      if (salary != null)
        _PrSummary(
          name: 'Salary',
          card: _PrSalarySummaryCard(
            card: salary,
            onTap: salary.notConfigured
                ? null
                : () => _open(const _SalarySummaryPage()),
          ),
        ),
      if (tax != null)
        _PrSummary(
          name: 'Tax',
          card: _PrTaxSummaryCard(
            card: tax,
            onTap: () => _open(const _TaxSummaryPage()),
          ),
        ),
      if (fbp != null)
        _PrSummary(
          name: 'FBP',
          card: _PrFbpSummaryCard(
            card: fbp,
            onTap: () => _open(const _FbpPage()),
          ),
        ),
    ];
    // Setting up isn't finished: the checklist, and only the to-dos it does
    // not already hold (the regime and the FBP split are rows of it).
    final setup = home.setup?.pending == true ? home.setup : null;
    final todos = setup == null
        ? home.todo
        : [
            for (final todo in home.todo)
              if (todo.kind != 'tax_regime' && todo.kind != 'flexible_split')
                todo,
          ];
    return [
      if (summaries.isNotEmpty)
        _PrSummaryCarousel(summaries: summaries)
      // Nothing to sum up yet: the words the home always had for it.
      else if (home.salaryNotSetUp case final notSetUp?)
        _SalaryNotSetUpCard(period: home.period, notSetUp: notSetUp)
      else
        const _HubEmptyState(
          iconAsset: 'assets/icons/request_reimbursement_money.png',
          text: 'Your salary shows here once HR sets up your pay.',
        ),
      if (setup != null) ...[
        const SizedBox(height: 24),
        _PrSectionHead(
          'Set up your payroll',
          count: setup.total - setup.done,
          countKey: const ValueKey('payroll-setup-count'),
        ),
        const SizedBox(height: 14),
        _PrSetupProgress(setup: setup),
        const SizedBox(height: 12),
        _PrTodoCard(
          key: const ValueKey('payroll-setup'),
          rows: [for (final item in setup.items) _setupRow(item, home)],
        ),
      ],
      if (todos.isNotEmpty) ...[
        const SizedBox(height: 24),
        _PrSectionHead(
          'To do',
          count: todos.length,
          countKey: const ValueKey('payroll-todo-count'),
        ),
        const SizedBox(height: 12),
        _PrTodoCard(rows: [for (final todo in todos) _todoRow(todo)]),
      ],
      const SizedBox(height: 24),
      const _HomeSectionLabel('Quick actions'),
      const SizedBox(height: 12),
      Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: _PrQuickTile(
              key: const ValueKey('payroll-qa-earnings'),
              asset: 'assets/icons/payroll_qa_earnings.png',
              title: 'Earnings',
              subtitle: 'Annual',
              onTap: () => _open(const _EarningsPage()),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: _PrQuickTile(
              key: const ValueKey('payroll-qa-downloads'),
              emoji: '📥',
              title: 'Downloads',
              // Form 16 only where the company shows it in the app.
              subtitle: home.form16Enabled ? 'Payslips, F-16' : 'Payslips',
              onTap: () => _open(_DownloadsPage(form16: home.form16Enabled)),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: _PrQuickTile(
              key: const ValueKey('payroll-qa-epf'),
              asset: 'assets/icons/payroll_qa_epf.png',
              title: 'EPF',
              subtitle: 'PF balance',
              onTap: () => _open(const _EpfPage()),
            ),
          ),
        ],
      ),
      const SizedBox(height: 24),
      _PrSupportCard(onRaise: _raiseTicket),
    ];
  }

  /// A new Support Desk ticket (the shell's own flow), else the desk.
  void _raiseTicket({String? about}) {
    if (!raiseSupportTicket(about: about)) {
      _PayrollScope.of(context).onRaiseTicket?.call();
    }
  }

  /// One row of "Set up your payroll", tapping to where it is done. Bank,
  /// PAN and UAN are kept by HR (the profile's Payment and tax IDs; the app
  /// has no screen to change them), so those rows ask HR in a ticket.
  Widget _setupRow(PayrollSetupItem item, PayrollHome home) {
    final pool = home.cards.fbp?.poolPaise;
    final (
      String? asset,
      String? emoji,
      String title,
      String subtitle,
      VoidCallback onTap,
    ) = switch (item.key) {
      'bank' => (
        'assets/icons/payroll_setup_bank.png',
        null,
        'Add bank account',
        'Needed to pay your salary',
        () => _raiseTicket(
          about:
              'Please add my bank account for payroll so my salary can be '
              'paid.',
        ),
      ),
      'pan' => (
        'assets/icons/payroll_setup_pan.png',
        null,
        'Add PAN',
        'Tax is cut at 20% without it',
        () => _raiseTicket(about: 'Please add my PAN for payroll.'),
      ),
      'regime' => (
        'assets/icons/payroll_setup_regime.png',
        null,
        'Choose tax regime',
        'New regime applies if you skip',
        () => _open(const _DeclarationPage()),
      ),
      'fbp' => (
        'assets/icons/payroll_setup_fbp.png',
        null,
        'Declare your FBP',
        pool != null && pool > 0
            ? 'Save tax on ${_rupees(pool)} a month'
            : 'Save tax on part of your salary',
        () => _open(const _SplitPage()),
      ),
      'uan' => (
        null,
        '🔗',
        'Link PF account (UAN)',
        'So your PF reaches your account',
        () =>
            _raiseTicket(about: 'Please link my PF account (UAN) for payroll.'),
      ),
      _ => (
        'assets/icons/request_reimbursement_money.png',
        null,
        item.key,
        '',
        () {},
      ),
    };
    return _PrSetupRow(
      key: ValueKey('payroll-setup-${item.key}'),
      asset: asset,
      emoji: emoji,
      title: title,
      subtitle: subtitle,
      done: item.done,
      dueOn: item.dueOn,
      tone: item.required
          ? _PrPillTone.urgent
          : item.key == 'fbp'
          ? _PrPillTone.info
          : _PrPillTone.soon,
      onTap: onTap,
    );
  }
}

// ---------------------------------------------------------------- carousel

class _PrSummary {
  const _PrSummary({required this.name, required this.card});

  /// "Salary", "Tax", "FBP": what its dot is called.
  final String name;
  final Widget card;
}

/// The summary cards side by side, one in view: they move on every 4 s, by a
/// swipe, or to the dot tapped. A card is the list's width; the next one
/// waits a gap's width past the screen's edge, as the design has it.
class _PrSummaryCarousel extends StatefulWidget {
  const _PrSummaryCarousel({required this.summaries});

  final List<_PrSummary> summaries;

  static const interval = Duration(seconds: 4);
  static const slide = Duration(milliseconds: 450);

  @override
  State<_PrSummaryCarousel> createState() => _PrSummaryCarouselState();
}

class _PrSummaryCarouselState extends State<_PrSummaryCarousel> {
  final _scroll = ScrollController();
  Timer? _timer;
  int _index = 0;
  double _step = 0;
  double _dragFrom = 0;

  int get _count => widget.summaries.length;

  /// Read in [didChangeDependencies], for the timer to consult.
  ModalRoute<Object?>? _route;
  bool _noMotion = false;
  bool _stillOnly = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _route = ModalRoute.of(context);
    _noMotion = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    _stillOnly =
        _noMotion || (MediaQuery.maybeAccessibleNavigationOf(context) ?? false);
  }

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_follow);
    _restart();
  }

  @override
  void didUpdateWidget(_PrSummaryCarousel old) {
    super.didUpdateWidget(old);
    if (_index >= _count) {
      _index = 0;
      if (_scroll.hasClients) _scroll.jumpTo(0);
    }
    _restart();
  }

  @override
  void dispose() {
    _timer?.cancel();
    _scroll.dispose();
    super.dispose();
  }

  /// The dot follows the card in view, however it got there.
  void _follow() {
    if (_step <= 0 || !_scroll.hasClients) return;
    final at = (_scroll.offset / _step).round().clamp(0, _count - 1);
    if (at != _index) setState(() => _index = at);
  }

  /// The 4 s count starts again after every move the person makes.
  void _restart() {
    _timer?.cancel();
    _timer = _count < 2
        ? null
        : Timer.periodic(_PrSummaryCarousel.interval, (_) => _autoAdvance());
  }

  void _autoAdvance() {
    if (!mounted) return;
    // Not while another Payroll page covers the home, nor for someone who
    // asked for less motion or navigates by accessibility services.
    if (_route?.isCurrent == false || _stillOnly) return;
    _go((_index + 1) % _count);
  }

  void _go(int index) {
    final target = index.clamp(0, _count - 1);
    setState(() => _index = target);
    if (!_scroll.hasClients) return;
    final offset = (target * _step).clamp(
      0.0,
      _scroll.position.maxScrollExtent,
    );
    if (_noMotion) {
      _scroll.jumpTo(offset);
    } else {
      unawaited(
        _scroll.animateTo(
          offset,
          duration: _PrSummaryCarousel.slide,
          curve: Curves.ease,
        ),
      );
    }
  }

  void _dragStart(DragStartDetails _) {
    _timer?.cancel();
    _dragFrom = _scroll.hasClients ? _scroll.offset : 0;
  }

  void _dragUpdate(DragUpdateDetails details) {
    if (!_scroll.hasClients) return;
    final max = _scroll.position.maxScrollExtent;
    _scroll.jumpTo((_scroll.offset - details.delta.dx).clamp(0.0, max));
  }

  /// A swipe of 40 px or a flick moves one card; less springs back.
  void _dragEnd(DragEndDetails details) {
    final from = _step <= 0 ? 0 : (_dragFrom / _step).round();
    final moved = _scroll.hasClients ? _scroll.offset - _dragFrom : 0.0;
    final velocity = details.primaryVelocity ?? 0;
    var target = from;
    if (moved > 40 || velocity < -300) {
      target = from + 1;
    } else if (moved < -40 || velocity > 300) {
      target = from - 1;
    }
    _go(target);
    _restart();
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        _step = width + _prCardGap;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(
              container: true,
              label: 'Summaries',
              child: GestureDetector(
                key: const ValueKey('payroll-carousel'),
                behavior: HitTestBehavior.translucent,
                onHorizontalDragStart: _dragStart,
                onHorizontalDragUpdate: _dragUpdate,
                onHorizontalDragEnd: _dragEnd,
                child: SingleChildScrollView(
                  controller: _scroll,
                  scrollDirection: Axis.horizontal,
                  physics: const NeverScrollableScrollPhysics(),
                  // The cards beside slide in over the list's side margins.
                  clipBehavior: Clip.none,
                  child: IntrinsicHeight(
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        for (final (i, summary)
                            in widget.summaries.indexed) ...[
                          if (i > 0) const SizedBox(width: _prCardGap),
                          SizedBox(width: width, child: summary.card),
                        ],
                      ],
                    ),
                  ),
                ),
              ),
            ),
            if (_count > 1) ...[
              const SizedBox(height: 12),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  for (final (i, summary) in widget.summaries.indexed) ...[
                    if (i > 0) const SizedBox(width: 6),
                    _PrDot(
                      key: ValueKey('payroll-dot-$i'),
                      on: i == _index,
                      label: '${summary.name} summary',
                      onTap: () {
                        _go(i);
                        _restart();
                      },
                    ),
                  ],
                ],
              ),
            ],
          ],
        );
      },
    );
  }
}

/// A dot under the carousel: wide and blue for the card in view.
class _PrDot extends StatelessWidget {
  const _PrDot({
    super.key,
    required this.on,
    required this.label,
    required this.onTap,
  });

  final bool on;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    selected: on,
    label: label,
    child: GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      // A finger-sized target round the 6 px dot.
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          width: on ? 18 : 6,
          height: 6,
          decoration: BoxDecoration(
            color: on ? _prBlue : _prDonutGrey,
            borderRadius: BorderRadius.circular(99),
          ),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------- cards

/// A summary card's frame: white, 22 radius, its title and tag on top and a
/// "See …" line at the foot that the whole card answers to.
class _PrSummaryFrame extends StatelessWidget {
  const _PrSummaryFrame({
    super.key,
    required this.title,
    required this.children,
    required this.semanticsLabel,
    this.tag,
    this.more,
    this.onTap,
  });

  final String title;
  final Widget? tag;
  final List<Widget> children;

  /// The foot's words ("See breakdown"); none for a card with nowhere to go.
  final String? more;
  final VoidCallback? onTap;
  final String semanticsLabel;

  @override
  Widget build(BuildContext context) {
    final more = this.more;
    return Semantics(
      button: onTap != null,
      label: semanticsLabel,
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        shadowColor: Colors.black.withValues(alpha: .03),
        elevation: .5,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(22),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(18, 18, 18, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        title.toUpperCase(),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontFamily: 'Sora',
                          fontFamilyFallback: _soraFallback,
                          color: _prInkFaint,
                          fontSize: 13,
                          height: 18 / 13,
                          fontWeight: FontWeight.w600,
                          letterSpacing: .8,
                        ),
                      ),
                    ),
                    if (tag case final tag?) ...[const SizedBox(width: 8), tag],
                  ],
                ),
                ...children,
                if (more != null) ...[
                  const Spacer(),
                  const SizedBox(height: 14),
                  const Divider(
                    height: 1,
                    thickness: 1,
                    color: Color(0xFFF1F1F4),
                  ),
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          more,
                          style: const TextStyle(
                            fontFamily: 'Sora',
                            color: _prBlue,
                            fontSize: 13.5,
                            height: 18 / 13.5,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      const Icon(
                        Icons.chevron_right_rounded,
                        size: 18,
                        color: _prBlue,
                      ),
                    ],
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

/// A card's tag: "Estimate", "New regime", "Your split", "Not set up".
class _PrTag extends StatelessWidget {
  const _PrTag(this.text, {required this.color, required this.tint});

  const _PrTag.neutral(this.text)
    : color = _prInkSoft,
      tint = const Color(0xFFEDEDF0);

  final String text;
  final Color color;
  final Color tint;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
    decoration: BoxDecoration(
      color: tint,
      borderRadius: BorderRadius.circular(99),
    ),
    child: Text(
      text,
      maxLines: 1,
      style: TextStyle(
        fontFamily: 'Sora',
        color: color,
        fontSize: 12,
        height: 16 / 12,
        fontWeight: FontWeight.w700,
      ),
    ),
  );
}

/// What HR still has to set up, in a card's body: the server's words and
/// the way to a ticket.
class _PrCardNotSetUp extends StatelessWidget {
  const _PrCardNotSetUp(this.message, {this.textKey});

  final String message;
  final Key? textKey;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      const SizedBox(height: 12),
      Text(
        message,
        key: textKey,
        style: _PrText.sub.copyWith(fontSize: 13, height: 1.45),
      ),
      if (mentionsHrOrSupport(message)) RaiseTicketLink(about: message),
    ],
  );
}

/// One line of a card's legend: its colour, what it is, how much.
class _PrLegendRow extends StatelessWidget {
  const _PrLegendRow({
    required this.color,
    required this.label,
    required this.value,
    this.key_ = false,
  });

  final Color color;
  final String label;
  final String value;

  /// The line that matters most (take-home): darker and larger.
  final bool key_;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Container(
        width: 9,
        height: 9,
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(3),
        ),
      ),
      const SizedBox(width: 7),
      Expanded(
        child: Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontFamily: 'Sora',
            fontFamilyFallback: _soraFallback,
            color: key_ ? _prInk : _prInkSoft,
            fontSize: 12.5,
            height: 16 / 12.5,
            fontWeight: key_ ? FontWeight.w700 : FontWeight.w600,
          ),
        ),
      ),
      const SizedBox(width: 8),
      Text(
        value,
        maxLines: 1,
        style: TextStyle(
          fontFamily: 'Sora',
          fontFamilyFallback: _soraFallback,
          color: _prInk,
          fontSize: key_ ? 15 : 13,
          height: 18 / 13,
          fontWeight: key_ ? FontWeight.w800 : FontWeight.w700,
          fontFeatures: const [FontFeature.tabularFigures()],
        ),
      ),
    ],
  );
}

/// A donut of [segments] beside its legend, the total in the middle.
class _PrDonutRow extends StatelessWidget {
  const _PrDonutRow({
    required this.segments,
    required this.centre,
    required this.caption,
    required this.legend,
    required this.semanticsLabel,
  });

  final List<(Color, int)> segments;
  final String centre;
  final String caption;
  final List<Widget> legend;
  final String semanticsLabel;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 14),
    child: Row(
      children: [
        Semantics(
          label: semanticsLabel,
          image: true,
          child: SizedBox.square(
            dimension: 108,
            child: CustomPaint(
              painter: _PrDonutPainter(segments),
              child: Center(
                child: SizedBox(
                  width: 64,
                  child: ExcludeSemantics(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        FittedBox(
                          fit: BoxFit.scaleDown,
                          child: Text(
                            centre,
                            style: const TextStyle(
                              fontFamily: 'Sora',
                              fontFamilyFallback: _soraFallback,
                              color: _prInk,
                              fontSize: 12,
                              height: 16 / 12,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                        Text(
                          caption,
                          maxLines: 1,
                          style: const TextStyle(
                            fontFamily: 'Sora',
                            color: _prInkFaint,
                            fontSize: 9.5,
                            height: 13 / 9.5,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final (i, row) in legend.indexed) ...[
                if (i > 0) const SizedBox(height: 9),
                row,
              ],
            ],
          ),
        ),
      ],
    ),
  );
}

/// The ring: r 38 of 100, 15 thick, from twelve o'clock, a hairline gap
/// between segments.
class _PrDonutPainter extends CustomPainter {
  _PrDonutPainter(this.segments);

  final List<(Color, int)> segments;

  static const _tau = 6.283185307179586;

  @override
  void paint(Canvas canvas, Size size) {
    final scale = size.width / 100;
    final stroke = 15 * scale;
    final rect = Rect.fromCircle(
      center: size.center(Offset.zero),
      radius: 38 * scale,
    );
    final total = segments.fold<int>(
      0,
      (sum, s) => sum + (s.$2 > 0 ? s.$2 : 0),
    );
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke;
    if (total <= 0) {
      canvas.drawArc(rect, 0, _tau, false, paint..color = _prDonutGrey);
      return;
    }
    final shown = segments.where((s) => s.$2 > 0).toList();
    // 1.6 of the ring's 238.76 units between segments, as drawn.
    final gap = shown.length > 1 ? _tau * 1.6 / 238.76 : 0.0;
    var start = -_tau / 4;
    for (final (color, value) in shown) {
      final sweep = _tau * value / total;
      canvas.drawArc(
        rect,
        start,
        (sweep - gap).clamp(0.0, _tau),
        false,
        paint..color = color,
      );
      start += sweep;
    }
  }

  @override
  bool shouldRepaint(_PrDonutPainter old) =>
      old.segments.length != segments.length ||
      [for (var i = 0; i < segments.length; i++) old.segments[i] != segments[i]]
          .any((changed) => changed);
}

/// Card 1: the last pay period's salary, its gross as a donut of take-home,
/// deductions and loss of pay.
class _PrSalarySummaryCard extends StatelessWidget {
  const _PrSalarySummaryCard({required this.card, required this.onTap});

  final PayrollSalaryCard card;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final title = '${card.label.isEmpty ? 'Last month' : card.label} salary';
    if (card.notConfigured) {
      return _PrSummaryFrame(
        key: const ValueKey('payroll-card-salary'),
        title: title,
        semanticsLabel: title,
        tag: const _PrTag('Not set up', color: _Q.gold, tint: _Q.goldTint),
        children: [
          _PrCardNotSetUp(
            card.message ?? PayrollSalaryNotSetUp.fallback,
            textKey: const ValueKey('payroll-salary-not-set-up'),
          ),
        ],
      );
    }
    final lopDays = card.lopDays;
    final total = card.takeHomePaise + card.deductionsPaise + card.lopPaise;
    final days = card.daysInPeriod;
    final paid = card.daysPaid;
    return _PrSummaryFrame(
      key: const ValueKey('payroll-card-salary'),
      title: title,
      semanticsLabel: '${card.label} salary summary',
      tag: card.released
          ? null
          : const _PrTag('Estimate', color: _prBlue, tint: _prBlueTint),
      more: 'See breakdown',
      onTap: onTap,
      children: [
        if (days != null && paid != null)
          Align(
            alignment: Alignment.centerLeft,
            child: Padding(
              padding: const EdgeInsets.only(top: 12),
              child: _PrTag(
                '${_payDays(paid)} of $days days paid',
                color: _prGreen,
                tint: _prGreenTint,
              ),
            ),
          ),
        _PrDonutRow(
          segments: [
            (_prBlue, card.takeHomePaise),
            (_prDeductionsBlue, card.deductionsPaise),
            (_Q.gold, card.lopPaise),
          ],
          centre: _rupees(total),
          // Overtime and reimbursements are paid on top of the gross.
          caption: card.extrasPaise > 0 ? 'total pay' : 'gross',
          semanticsLabel:
              '${card.label} ${card.extrasPaise > 0 ? 'total pay' : 'gross'} '
              '${_rupees(total)}: take-home ${_rupees(card.takeHomePaise)}, '
              'deductions ${_rupees(card.deductionsPaise)}, loss of pay '
              '${_rupees(card.lopPaise)}',
          legend: [
            _PrLegendRow(
              color: _prBlue,
              label: 'Take-home',
              value: _rupees(card.takeHomePaise),
              key_: true,
            ),
            _PrLegendRow(
              color: _prDeductionsBlue,
              label: 'Deductions',
              value: _rupees(card.deductionsPaise),
            ),
            _PrLegendRow(
              color: _Q.gold,
              label: lopDays > 0
                  ? 'Loss of pay · ${_payDays(lopDays)} '
                        '${lopDays == 1 ? 'day' : 'days'}'
                  : 'Loss of pay',
              value: _rupees(card.lopPaise),
            ),
          ],
        ),
      ],
    );
  }
}

/// Card 2: income tax withheld this FY, earlier months against this one.
class _PrTaxSummaryCard extends StatelessWidget {
  const _PrTaxSummaryCard({required this.card, required this.onTap});

  final PayrollTaxCard card;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final title = 'Tax · FY ${_fySpan(card.fy)}';
    if (card.notConfigured) {
      return _PrSummaryFrame(
        key: const ValueKey('payroll-card-tax'),
        title: title,
        semanticsLabel: 'Tax summary',
        tag: const _PrTag('Not set up', color: _Q.gold, tint: _Q.goldTint),
        more: 'See tax details',
        onTap: onTap,
        children: [
          _PrCardNotSetUp(
            card.message ??
                'The income tax rules for this year are not set up yet. Ask HR.',
          ),
        ],
      );
    }
    final thisMonth = card.thisMonth;
    final thisPaise = card.thisMonthPaise;
    final before = card.paidBeforeThisMonthPaise;
    final from = card.fromMonth;
    // The months before this one, when this one is not the FY's first.
    final hasBefore =
        from != null &&
        thisMonth != null &&
        (thisMonth.year * 12 + thisMonth.month) > (from.year * 12 + from.month);
    final beforeLabel = hasBefore
        ? _monthsLabel(from, DateTime(thisMonth.year, thisMonth.month - 1))
        : '';
    const thisShade = _prDeductionsBlue;
    return _PrSummaryFrame(
      key: const ValueKey('payroll-card-tax'),
      title: title,
      semanticsLabel: 'Tax summary',
      tag: card.regime == null
          ? null
          : _PrTag.neutral(card.regime == 'old' ? 'Old regime' : 'New regime'),
      more: 'See tax details',
      onTap: onTap,
      children: [
        const SizedBox(height: 10),
        Row(
          crossAxisAlignment: CrossAxisAlignment.baseline,
          textBaseline: TextBaseline.alphabetic,
          children: [
            Flexible(
              child: FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: Text(
                  _rupees(card.paidSoFarPaise),
                  style: const TextStyle(
                    fontFamily: 'Sora',
                    fontFamilyFallback: _soraFallback,
                    color: _prInk,
                    fontSize: 32,
                    height: 1.1,
                    letterSpacing: -0.6,
                    fontWeight: FontWeight.w800,
                    fontFeatures: [FontFeature.tabularFigures()],
                  ),
                ),
              ),
            ),
            const SizedBox(width: 6),
            const Text(
              'paid so far',
              style: TextStyle(
                fontFamily: 'Sora',
                color: _prInkSoft,
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
        const SizedBox(height: 6),
        Text(
          _monthsLabel(card.fromMonth, card.toMonth),
          style: const TextStyle(
            fontFamily: 'Sora',
            color: _prInkSoft,
            fontSize: 13,
            height: 17 / 13,
            fontWeight: FontWeight.w500,
          ),
        ),
        const SizedBox(height: 16),
        Semantics(
          image: true,
          label:
              'Tax paid so far ${_rupees(card.paidSoFarPaise)}'
              '${hasBefore ? ': ${_rupees(before)} from $beforeLabel' : ''}'
              '${thisPaise != null ? ' and ${_rupees(thisPaise)} this month' : ''}',
          child: SizedBox(
            height: 12,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (card.paidSoFarPaise <= 0)
                  Expanded(child: _barPiece(_prDonutGrey))
                else ...[
                  if (before > 0)
                    Expanded(flex: before, child: _barPiece(_prBlue)),
                  if (before > 0 && (thisPaise ?? 0) > 0)
                    const SizedBox(width: 3),
                  if ((thisPaise ?? 0) > 0)
                    Expanded(flex: thisPaise!, child: _barPiece(thisShade)),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 14),
        if (hasBefore)
          _PrLegendRow(
            color: _prBlue,
            label: beforeLabel,
            value: _rupees(before),
          ),
        if (hasBefore && thisPaise != null) const SizedBox(height: 9),
        if (thisPaise != null && thisMonth != null)
          _PrLegendRow(
            color: thisShade,
            label: 'This month (${_monthName(thisMonth.month)})',
            value: _rupees(thisPaise),
          ),
      ],
    );
  }

  static Widget _barPiece(Color color) => DecoratedBox(
    decoration: BoxDecoration(
      color: color,
      borderRadius: BorderRadius.circular(4),
    ),
  );
}

/// Card 3: the monthly flexible pool, head by head, and what is not
/// assigned.
class _PrFbpSummaryCard extends StatelessWidget {
  const _PrFbpSummaryCard({required this.card, required this.onTap});

  final PayrollFbpCard card;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final unassigned = card.unassignedPaise ?? 0;
    final rows = [
      for (final (i, head) in card.heads.indexed)
        (_prHeadShades[i % _prHeadShades.length], head.name, head.amountPaise),
      if (unassigned > 0) (_prDonutGrey, 'Not assigned', unassigned),
    ];
    return _PrSummaryFrame(
      // The key the home's FBP entry has always had.
      key: const ValueKey('payroll-fbp'),
      title: 'FBP',
      semanticsLabel: 'FBP summary',
      tag: const _PrTag.neutral('Your split'),
      more: 'Upload bills',
      onTap: onTap,
      children: [
        _PrDonutRow(
          segments: [for (final r in rows) (r.$1, r.$3)],
          centre: _rupees(card.totalPaise),
          caption: 'a month',
          semanticsLabel:
              'FBP ${_rupees(card.totalPaise)} a month: '
              '${rows.map((r) => '${r.$2} ${_rupees(r.$3)}').join(', ')}',
          legend: rows.isEmpty
              ? [Text('Nothing split yet', style: _PrText.sub)]
              : [
                  for (final r in rows)
                    _PrLegendRow(
                      color: r.$1,
                      label: r.$2,
                      value: _rupees(r.$3),
                    ),
                ],
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------- below

/// The to-dos on amber, one row each, hairlines between.
class _PrTodoCard extends StatelessWidget {
  const _PrTodoCard({super.key, required this.rows});

  final List<Widget> rows;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
    decoration: BoxDecoration(
      color: const Color(0xFFFFF7E8),
      borderRadius: BorderRadius.circular(18),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final (i, row) in rows.indexed) ...[
          if (i > 0)
            const Divider(height: 1, thickness: 1, color: Color(0xFFF3E6CC)),
          row,
        ],
      ],
    ),
  );
}

/// One to-do: its picture, what to do, the line under it, by when.
class _PrTodoRow extends StatelessWidget {
  const _PrTodoRow({
    super.key,
    required this.asset,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.dueOn,
  });

  final String asset;
  final String title;
  final String subtitle;
  final DateTime? dueOn;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final due = dueOn;
    final today = _dateOnly(DateTime.now());
    // Three days or less to go: red, as before.
    final urgent = due != null && due.difference(today).inDays <= 3;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 14),
        child: Row(
          children: [
            _PrIconTile(asset: asset),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: _PrText.title.copyWith(
                      color: _prInk,
                      fontSize: 15,
                      height: 20 / 15,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  if (subtitle.isNotEmpty) ...[
                    const SizedBox(height: 3),
                    Text(
                      subtitle,
                      style: _PrText.sub.copyWith(
                        color: _prInkSoft,
                        fontSize: 12.5,
                        height: 1.35,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            if (due != null) ...[
              const SizedBox(width: 12),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 5,
                ),
                decoration: BoxDecoration(
                  color: urgent ? _prRedTint : Colors.white,
                  borderRadius: BorderRadius.circular(99),
                  border: Border.all(
                    color: urgent ? _prRedTint : const Color(0xFFF0DDB8),
                  ),
                ),
                child: Text(
                  'by ${_short(due)}',
                  style: TextStyle(
                    fontFamily: 'Sora',
                    color: urgent ? _prRed : const Color(0xFF8A4B00),
                    fontSize: 12,
                    height: 16 / 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
            const SizedBox(width: 12),
            const Icon(
              Icons.chevron_right_rounded,
              size: 18,
              color: Color(0xFFA0A0A8),
            ),
          ],
        ),
      ),
    );
  }
}

/// A section's label with a red count beside it ("TO DO  3").
class _PrSectionHead extends StatelessWidget {
  const _PrSectionHead(this.text, {required this.count, this.countKey});

  final String text;
  final int count;
  final Key? countKey;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      _HomeSectionLabel(text),
      if (count > 0) ...[
        const SizedBox(width: 6),
        Container(
          key: countKey,
          constraints: const BoxConstraints(minWidth: 20),
          height: 20,
          padding: const EdgeInsets.symmetric(horizontal: 6),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: const Color(0xFFFF383C),
            borderRadius: BorderRadius.circular(99),
          ),
          child: Text(
            '$count',
            style: const TextStyle(
              fontFamily: 'Sora',
              color: Colors.white,
              fontSize: 11,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ],
    ],
  );
}

/// "1 of 5 done · Before your first payroll" over a thin blue bar.
class _PrSetupProgress extends StatelessWidget {
  const _PrSetupProgress({required this.setup});

  final PayrollSetup setup;

  @override
  Widget build(BuildContext context) {
    const style = TextStyle(
      fontFamily: 'Sora',
      color: _prInkSoft,
      fontSize: 12.5,
      height: 16 / 12.5,
      fontWeight: FontWeight.w600,
    );
    final share = setup.total == 0 ? 0.0 : setup.done / setup.total;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Text(
              '${setup.done} of ${setup.total} done',
              key: const ValueKey('payroll-setup-progress'),
              style: style,
            ),
            const Spacer(),
            if (setup.beforeFirstPayroll)
              const Text('Before your first payroll', style: style),
          ],
        ),
        const SizedBox(height: 6),
        ClipRRect(
          borderRadius: BorderRadius.circular(3),
          child: SizedBox(
            height: 6,
            child: Stack(
              fit: StackFit.expand,
              children: [
                const ColoredBox(color: Color(0xFFEDEDF0)),
                FractionallySizedBox(
                  alignment: Alignment.centerLeft,
                  widthFactor: share.clamp(0.0, 1.0),
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: const Color(0xFF1E8BF5),
                      borderRadius: BorderRadius.circular(3),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// How a setup row's date reads: red when pay needs it, amber for a
/// deadline with a default, blue for a saving.
enum _PrPillTone { urgent, soon, info }

/// One row of "Set up your payroll": to do (what, why, by when, ›) or done
/// (struck through, a green tick).
class _PrSetupRow extends StatelessWidget {
  const _PrSetupRow({
    super.key,
    required this.title,
    required this.subtitle,
    required this.done,
    required this.tone,
    required this.onTap,
    this.asset,
    this.emoji,
    this.dueOn,
  });

  final String? asset;
  final String? emoji;
  final String title;
  final String subtitle;
  final bool done;
  final DateTime? dueOn;
  final _PrPillTone tone;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final due = dueOn;
    final (Color tint, Color ink) = switch (tone) {
      _PrPillTone.urgent => (const Color(0xFFFDECEC), const Color(0xFFB42318)),
      _PrPillTone.soon => (const Color(0xFFFFF1D6), const Color(0xFF8A4B00)),
      _PrPillTone.info => (const Color(0xFFE8F2F8), const Color(0xFF05608D)),
    };
    final row = Padding(
      padding: const EdgeInsets.symmetric(vertical: 14),
      child: Row(
        children: [
          _PrIconTile(asset: asset, emoji: emoji),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontFamily: 'Sora',
                    color: done ? const Color(0xFF6B6B72) : _prInk,
                    fontSize: 15,
                    height: 20 / 15,
                    fontWeight: FontWeight.w700,
                    decoration: done ? TextDecoration.lineThrough : null,
                    decorationColor: const Color(0xFF6B6B72),
                  ),
                ),
                if (!done && subtitle.isNotEmpty) ...[
                  const SizedBox(height: 3),
                  Text(
                    subtitle,
                    style: const TextStyle(
                      fontFamily: 'Sora',
                      color: _prInkSoft,
                      fontSize: 12.5,
                      height: 16.88 / 12.5,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (done)
            Container(
              key: const ValueKey('payroll-setup-done'),
              width: 22,
              height: 22,
              decoration: const BoxDecoration(
                color: Color(0xFF34C759),
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.check_rounded,
                size: 14,
                color: Colors.white,
              ),
            )
          else ...[
            if (due != null) ...[
              const SizedBox(width: 12),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                decoration: BoxDecoration(
                  color: tint,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  _short(due),
                  style: TextStyle(
                    fontFamily: 'Sora',
                    color: ink,
                    fontSize: 11.5,
                    height: 15 / 11.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
            const SizedBox(width: 12),
            const Icon(
              Icons.chevron_right_rounded,
              size: 18,
              color: Color(0xFFA0A0A8),
            ),
          ],
        ],
      ),
    );
    return Semantics(
      button: !done,
      label: done ? '$title, done' : null,
      child: done ? row : InkWell(onTap: onTap, child: row),
    );
  }
}

/// The 40 px white tile a picture sits on (11 radius, hairline, soft shadow).
/// An [emoji] stands in where the design draws one.
class _PrIconTile extends StatelessWidget {
  const _PrIconTile({this.asset, this.emoji});

  final String? asset;
  final String? emoji;

  @override
  Widget build(BuildContext context) => Container(
    width: 40,
    height: 40,
    alignment: Alignment.center,
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(11),
      border: Border.all(color: const Color(0xFFF0F0F2)),
      boxShadow: const [
        BoxShadow(
          color: Color(0x0F000000),
          blurRadius: 6,
          offset: Offset(0, 2),
        ),
      ],
    ),
    child: switch ((asset, emoji)) {
      (final String a, _) when a.endsWith('.svg') => SvgPicture.asset(
        a,
        width: 22,
        height: 22,
      ),
      (final String a, _) => Image.asset(
        a,
        width: 24,
        height: 24,
        fit: BoxFit.contain,
      ),
      (_, final String e) => Text(
        e,
        style: const TextStyle(fontSize: 20, height: 1),
      ),
      _ => const SizedBox.shrink(),
    },
  );
}

/// A quick action: picture, name, what is in it.
class _PrQuickTile extends StatelessWidget {
  const _PrQuickTile({
    super.key,
    this.asset,
    this.emoji,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final String? asset;
  final String? emoji;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: '$title, $subtitle',
    excludeSemantics: true,
    child: Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(18),
      shadowColor: Colors.black.withValues(alpha: .03),
      elevation: .5,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 112),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _PrIconTile(asset: asset, emoji: emoji),
                const SizedBox(height: 14),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(
                    title,
                    maxLines: 1,
                    style: const TextStyle(
                      fontFamily: 'Sora',
                      color: _prInk,
                      fontSize: 15,
                      height: 20 / 15,
                      letterSpacing: -0.2,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontFamily: 'Sora',
                    color: Color(0xFF6B6B72),
                    fontSize: 12,
                    height: 16 / 12,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

/// "Support desk · Ask about pay, tax or FBP", and a ticket.
class _PrSupportCard extends StatelessWidget {
  const _PrSupportCard({required this.onRaise});

  final VoidCallback onRaise;

  @override
  Widget build(BuildContext context) => Material(
    color: Colors.white,
    borderRadius: BorderRadius.circular(18),
    child: InkWell(
      onTap: onRaise,
      borderRadius: BorderRadius.circular(18),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            const _PrIconTile(asset: 'assets/icons/support_headset.png'),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Support desk',
                    style: _PrText.title.copyWith(
                      color: _prInk,
                      fontSize: 15,
                      height: 20 / 15,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    'Ask about pay, tax or FBP',
                    style: _PrText.sub.copyWith(
                      color: _prInkSoft,
                      fontSize: 12.5,
                      height: 1.35,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Semantics(
              button: true,
              child: InkWell(
                key: const ValueKey('payroll-raise-ticket'),
                onTap: onRaise,
                borderRadius: BorderRadius.circular(11),
                child: Container(
                  height: 38,
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(11),
                    border: Border.all(color: _prBlue, width: 1.5),
                  ),
                  child: const Text(
                    'Raise a ticket',
                    style: TextStyle(
                      fontFamily: 'Sora',
                      color: _prBlue,
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}
