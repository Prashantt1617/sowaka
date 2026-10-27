part of '../../quick_actions/presentation/quick_actions_screen.dart';

/// The blue of the Actions pages' buttons and links.
const _candBlue = Color(0xFF0571A6);

/// Sora, in the Actions pages' warm ink unless told otherwise.
TextStyle _candStyle(
  double size, {
  FontWeight weight = FontWeight.w400,
  Color color = _Q.ink,
  double? height,
}) => TextStyle(
  fontFamily: 'Sora',
  fontFamilyFallback: _soraFallback,
  fontSize: size,
  fontWeight: weight,
  color: color,
  height: height,
);

/// A section heading on a candidate's page, as the Actions pages set them,
/// with an optional action at its end.
class _CandidateSectionLabel extends StatelessWidget {
  const _CandidateSectionLabel(this.text, {this.trailing});

  final String text;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(
        child: Text(
          text.toUpperCase(),
          style: _QText.section.copyWith(
            fontFamily: 'Sora',
            fontFamilyFallback: _soraFallback,
          ),
        ),
      ),
      ?trailing,
    ],
  );
}

/// A white card on the page, as the Leave hub and its forms draw them.
class _CandidateCard extends StatelessWidget {
  const _CandidateCard({
    required this.child,
    this.onTap,
    this.padding = const EdgeInsets.all(16),
  });

  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(16),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0A000000),
            blurRadius: 2,
            offset: Offset(0, 1),
          ),
        ],
      ),
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(16),
          child: Padding(padding: padding, child: child),
        ),
      ),
    );
  }
}

/// My candidates: the ones the signed-in person added, newest first, with a
/// search, a filter by where each stands, and Add.
class CandidatesPage extends StatefulWidget {
  const CandidatesPage({super.key, required this.api});

  final PlacementsApiService api;

  @override
  State<CandidatesPage> createState() => _CandidatesPageState();
}

class _CandidatesPageState extends State<CandidatesPage> {
  static const _all = 'All';

  final _search = TextEditingController();
  List<PlacementCustomer>? _rows;
  String? _error;
  String _filter = _all;
  PlSort _sort = PlSort.lastAdded;

  @override
  void initState() {
    super.initState();
    _search.addListener(() => setState(() {}));
    unawaited(_load());
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final rows = await widget.api.fetchCustomers(mine: true);
      if (!mounted) return;
      setState(() {
        _rows = rows;
        _error = null;
      });
    } catch (error) {
      if (mounted) setState(() => _error = placementsErrorText(error));
    }
  }

  Future<void> _open(Widget page) async {
    await Navigator.of(
      context,
    ).push(MaterialPageRoute<void>(builder: (_) => page));
    if (mounted) unawaited(_load());
  }

  void _add() => _open(CandidateFormPage(api: widget.api));

  List<PlacementCustomer> get _shown {
    final q = _search.text.trim().toLowerCase();
    final rows = (_rows ?? const <PlacementCustomer>[]).where((c) {
      if (_filter != _all && c.stage.label != _filter) return false;
      if (q.isEmpty) return true;
      return c.name.toLowerCase().contains(q) ||
          c.phone.replaceAll(' ', '').contains(q.replaceAll(' ', '')) ||
          c.currentRole.toLowerCase().contains(q);
    }).toList();
    return _sort.apply(
      rows,
      added: (c) => c.createdAt,
      updated: (c) => c.updatedAt,
      name: (c) => c.name,
    );
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows;
    final shown = _shown;
    return PlPage(
      title: 'My candidates',
      subtitle: rows == null ? null : '${rows.length} candidates',
      actions: [PlAddButton(onTap: _add)],
      body: RefreshIndicator(
        color: _candBlue,
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
          children: [
            PlListControls(
              search: _search,
              hint: 'Search name, phone or designation',
              filters: [_all, for (final s in CandidateStage.values) s.label],
              filter: _filter,
              onFilter: (f) => setState(() => _filter = f),
              sort: _sort,
              onSort: (sort) => setState(() => _sort = sort),
              shown: _rows == null ? null : _shown.length,
              total: _rows?.length,
              noun: 'candidates',
            ),
            const SizedBox(height: 12),
            if (rows == null && _error == null)
              const PlState.loading()
            else if (rows == null)
              PlState.message(_error, onRetry: _load)
            else if (rows.isEmpty)
              _HubEmptyState(
                iconAsset: 'assets/icons/connect_icon_user.png',
                text: 'No candidates yet.\nAdd one to log your first.',
                buttonLabel: 'Add candidate',
                onTap: _add,
              )
            else if (shown.isEmpty)
              const _HubEmptyState(
                iconAsset: 'assets/icons/connect_icon_user.png',
                text: 'No candidates match.',
              )
            else
              for (final c in shown)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: _CandidateRow(
                    candidate: c,
                    onTap: () => _open(
                      CandidateDetailPage(api: widget.api, candidateId: c.id),
                    ),
                  ),
                ),
          ],
        ),
      ),
    );
  }
}

/// A candidate in the list, as the Leave hub draws a request: the name, what
/// they do, where they stand, and when they were added.
class _CandidateRow extends StatelessWidget {
  const _CandidateRow({required this.candidate, required this.onTap});

  final PlacementCustomer candidate;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = candidate;
    final colors = stageColors(c.stage);
    return _HubRequestCard(
      iconAsset: 'assets/icons/connect_icon_user.png',
      iconSize: 18,
      title: c.name,
      date: c.subtitle.isEmpty ? 'No designation yet' : c.subtitle,
      status: c.stage.label,
      statusColor: colors.text,
      statusTint: colors.background,
      footerIcon: _HubRequestCard.calendarIcon,
      footerText: c.createdAt == null
          ? 'Added'
          : 'Added ${plDate(c.createdAt)}',
      onTap: onTap,
    );
  }
}

/// One candidate: who they are, where they have been put forward, and what
/// happened, with Edit, Remove, Add placement and Update status.
class CandidateDetailPage extends StatefulWidget {
  const CandidateDetailPage({
    super.key,
    required this.api,
    required this.candidateId,
  });

  final PlacementsApiService api;
  final String candidateId;

  @override
  State<CandidateDetailPage> createState() => _CandidateDetailPageState();
}

class _CandidateDetailPageState extends State<CandidateDetailPage> {
  PlacementCandidatePage? _page;
  String? _error;

  String get _me => widget.api.session.user.id;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final page = await widget.api.fetchCandidate(widget.candidateId);
      if (!mounted) return;
      setState(() {
        _page = page;
        _error = null;
      });
    } catch (error) {
      if (mounted) setState(() => _error = placementsErrorText(error));
    }
  }

  Future<void> _open(Widget page) async {
    await Navigator.of(
      context,
    ).push(MaterialPageRoute<void>(builder: (_) => page));
    if (mounted) unawaited(_load());
  }

  Future<void> _remove(PlacementCustomer candidate) async {
    final removed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) =>
          RemoveCandidateSheet(api: widget.api, candidate: candidate),
    );
    if (removed == true && mounted) {
      plToast(context, '${candidate.name} was removed');
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final page = _page;
    final mine = page != null && page.candidate.createdByUserId == _me;
    return PlPage(
      title: 'Candidate',
      titleSize: 16,
      actions: [
        if (mine) ...[
          PlIconButton(
            label: 'Edit candidate',
            icon: Icons.edit_outlined,
            onTap: () => _open(
              CandidateFormPage(api: widget.api, existing: page.candidate),
            ),
          ),
          const SizedBox(width: 6),
          PlIconButton(
            label: 'Remove candidate',
            icon: Icons.delete_outline_rounded,
            color: const Color(0xFFB3261E),
            onTap: () => _remove(page.candidate),
          ),
        ],
      ],
      body: RefreshIndicator(
        color: _candBlue,
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
          children: [
            if (page == null && _error == null)
              const PlState.loading()
            else if (page == null)
              PlState.message(_error, onRetry: _load)
            else
              ..._content(page),
          ],
        ),
      ),
    );
  }

  List<Widget> _content(PlacementCandidatePage page) {
    final c = page.candidate;
    final byYou = c.createdByUserId == _me;
    final role = [
      c.currentRole,
      if (c.experienceYears != null)
        '${yearsLabel(c.experienceYears!)} experience',
    ].where((p) => p.isNotEmpty).join(' · ');
    return [
      _CandidateCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                PlInitials(c.name, size: 52, round: true, warm: true),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        c.name,
                        style: _candStyle(
                          18,
                          weight: FontWeight.w700,
                          height: 24 / 18,
                        ),
                      ),
                      if (role.isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(
                          role,
                          style: _candStyle(
                            12.5,
                            color: _Q.inkSoft,
                            height: 1.35,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
            if (c.phone.isNotEmpty || c.address.isNotEmpty) ...[
              const SizedBox(height: 14),
              const Divider(height: 1, thickness: 0.8, color: _Q.line),
              const SizedBox(height: 14),
              if (c.phone.isNotEmpty) _InfoLine(Icons.call_outlined, c.phone),
              if (c.address.isNotEmpty) ...[
                if (c.phone.isNotEmpty) const SizedBox(height: 10),
                _InfoLine(Icons.place_outlined, c.address),
              ],
            ],
            if (c.notes.isNotEmpty) ...[
              const SizedBox(height: 16),
              const _LeaveFieldLabel('Introduction'),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFF7F7F9),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  c.notes,
                  style: _candStyle(13, color: _Q.ink, height: 1.5),
                ),
              ),
            ],
            const SizedBox(height: 14),
            Text(
              [
                byYou ? 'Added by you' : 'Added',
                if (c.createdAt != null) plDate(c.createdAt),
              ].join(' · '),
              style: _candStyle(
                11.5,
                weight: FontWeight.w600,
                color: _Q.inkFaint,
              ),
            ),
          ],
        ),
      ),
      const SizedBox(height: 22),
      _CandidateSectionLabel(
        'Placements',
        trailing: PlAddButton(
          label: 'Add placement',
          outlined: true,
          onTap: () => _open(PlacementFormPage(api: widget.api, candidate: c)),
        ),
      ),
      const SizedBox(height: 12),
      if (page.placements.isEmpty)
        const _HubEmptyState(
          iconAsset: 'assets/icons/placements_briefcase.png',
          text: 'Not put forward anywhere yet.',
        )
      else
        for (final p in page.placements)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _PlacementCard(
              placement: p,
              client: page.clientOf(p),
              onClient: () => _open(
                ClientDetailPage(api: widget.api, clientId: p.clientId),
              ),
              // Only whoever logged the placement moves it along.
              onUpdate: p.createdByUserId == _me
                  ? () => _open(
                      PlacementFormPage(
                        api: widget.api,
                        candidate: c,
                        existing: p,
                      ),
                    )
                  : null,
            ),
          ),
      const SizedBox(height: 10),
      const _CandidateSectionLabel('Activity'),
      const SizedBox(height: 12),
      _CandidateCard(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        child: Column(children: _activity(page)),
      ),
    ];
  }

  List<Widget> _activity(PlacementCandidatePage page) {
    final items = <({DateTime? at, String what, String by, Color dot})>[];
    for (final p in page.placements) {
      for (final change in p.history) {
        items.add((
          at: change.at,
          what: '${change.status.label} · ${p.clientName}',
          by: change.byUserId,
          dot: statusColors(change.status).text,
        ));
      }
    }
    final c = page.candidate;
    items.add((
      at: c.createdAt,
      what: 'Candidate added',
      by: c.createdByUserId,
      dot: _candBlue,
    ));
    items.sort((a, b) => (b.at ?? DateTime(0)).compareTo(a.at ?? DateTime(0)));
    return [
      for (final (index, item) in items.indexed)
        Container(
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: index == 0
              ? null
              : const BoxDecoration(
                  border: Border(
                    top: BorderSide(color: Color(0xFFF3F4F6), width: 0.8),
                  ),
                ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 8,
                height: 8,
                margin: const EdgeInsets.only(top: 6),
                decoration: BoxDecoration(
                  color: item.dot,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.what,
                      style: _candStyle(
                        13,
                        weight: FontWeight.w600,
                        height: 20 / 13,
                      ),
                    ),
                    Text(
                      [
                        if (item.at != null) plDate(item.at),
                        if (item.by == _me) 'by you',
                      ].join(' · '),
                      style: _candStyle(
                        12,
                        color: _Q.inkFaint,
                        height: 16 / 12,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
    ];
  }
}

class _InfoLine extends StatelessWidget {
  const _InfoLine(this.icon, this.text);

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 16, color: _Q.inkFaint),
        const SizedBox(width: 10),
        Expanded(child: Text(text, style: _candStyle(13, height: 1.4))),
      ],
    );
  }
}

/// One placement on a candidate's page: the client (tap for its page), the
/// role and its budget, where it stands, its dates and, for whoever logged
/// it, Update status. A dropped one is one line.
class _PlacementCard extends StatelessWidget {
  const _PlacementCard({
    required this.placement,
    required this.client,
    required this.onClient,
    required this.onUpdate,
  });

  final Placement placement;
  final PlacementClient? client;
  final VoidCallback onClient;

  /// Null when someone else logged the placement: then it is read-only.
  final VoidCallback? onUpdate;

  @override
  Widget build(BuildContext context) {
    final p = placement;
    final dropped = p.status == PlacementStatus.dropped;
    final budget = client?.designationNamed(p.position)?.budgetLabel ?? '';
    final line = dropped
        ? [
            p.position,
            if (p.statusAt != null) 'Dropped on ${plDate(p.statusAt)}',
          ]
        : [p.position, if (budget.isNotEmpty) budget];
    final heading = Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              InkWell(
                onTap: onClient,
                borderRadius: BorderRadius.circular(6),
                child: Text(
                  p.clientName.isEmpty ? 'Client' : p.clientName,
                  style: _candStyle(
                    14,
                    weight: FontWeight.w600,
                    color: _candBlue,
                    height: 20 / 14,
                  ),
                ),
              ),
              const SizedBox(height: 4),
              Text(
                line.join(' · '),
                style: _candStyle(12, color: _Q.inkSoft, height: 16 / 12),
              ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        PlPill(p.status.label, statusColors(p.status)),
      ],
    );
    if (dropped) return _CandidateCard(onTap: onUpdate, child: heading);
    return _CandidateCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          heading,
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFFF7F7F9),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(
              children: [
                _DateCell('Interview', p.interviewDate),
                _DateCell('Joining', p.joiningDate),
              ],
            ),
          ),
          if (p.ctcRupees != null) ...[
            const SizedBox(height: 10),
            Text(
              'Offered ${rupees(p.ctcRupees!)}',
              style: _candStyle(12.5, weight: FontWeight.w600),
            ),
          ],
          if (onUpdate != null) ...[
            const SizedBox(height: 12),
            PlButton(label: 'Update status', outlined: true, onTap: onUpdate),
          ],
        ],
      ),
    );
  }
}

class _DateCell extends StatelessWidget {
  const _DateCell(this.label, this.day);

  final String label;
  final DateTime? day;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label.toUpperCase(),
            style: _candStyle(
              11,
              weight: FontWeight.w600,
              color: _Q.inkFaint,
            ).copyWith(letterSpacing: .3),
          ),
          const SizedBox(height: 2),
          Text(
            day == null ? 'Not set' : plDate(day),
            style: _candStyle(
              13,
              weight: FontWeight.w600,
              color: day == null ? _Q.inkFaint : _Q.ink,
            ),
          ),
        ],
      ),
    );
  }
}

/// A one-line field drawn like [_FormTextField], with an optional fixed
/// [prefix] ("+91") or [suffix] ("years") inside its border.
class _AffixedFormField extends StatelessWidget {
  const _AffixedFormField({
    required this.controller,
    required this.hintText,
    this.keyboardType,
    this.prefix,
    this.suffix,
    this.capitalization = TextCapitalization.none,
  });

  final TextEditingController controller;
  final String hintText;
  final TextInputType? keyboardType;
  final String? prefix;
  final String? suffix;
  final TextCapitalization capitalization;

  @override
  Widget build(BuildContext context) {
    final affixStyle = _candStyle(14, color: _Q.inkSoft);
    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: const Color(0xFFE5E7EB)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          if (prefix case final text?) ...[
            Padding(
              padding: const EdgeInsets.only(left: 12),
              child: Text(text, style: affixStyle),
            ),
            Container(
              width: 1,
              height: 20,
              margin: const EdgeInsets.only(left: 10),
              color: const Color(0xFFE5E7EB),
            ),
          ],
          Expanded(
            child: TextField(
              controller: controller,
              keyboardType: keyboardType,
              textCapitalization: capitalization,
              style: const TextStyle(fontSize: 14, color: Color(0xFF111827)),
              decoration: InputDecoration(
                hintText: hintText,
                hintStyle: const TextStyle(color: Color(0x80111827)),
                filled: false,
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                disabledBorder: InputBorder.none,
                errorBorder: InputBorder.none,
                focusedErrorBorder: InputBorder.none,
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 11,
                ),
              ),
            ),
          ),
          if (suffix case final text?)
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: Text(text, style: affixStyle),
            ),
        ],
      ),
    );
  }
}

/// Add or edit a candidate. Pops with the saved candidate.
class CandidateFormPage extends StatefulWidget {
  const CandidateFormPage({super.key, required this.api, this.existing});

  final PlacementsApiService api;
  final PlacementCustomer? existing;

  @override
  State<CandidateFormPage> createState() => _CandidateFormPageState();
}

class _CandidateFormPageState extends State<CandidateFormPage> {
  /// The number on file as the field first shows it: an Indian mobile
  /// without its +91, anything else as it was saved.
  late final String _initialPhone = (widget.existing?.phone ?? '')
      .replaceFirst(RegExp(r'^\+91\s*'), '')
      .trim();

  late final _name = TextEditingController(text: widget.existing?.name);
  late final _phone = TextEditingController(text: _initialPhone);
  late final _address = TextEditingController(
    text: widget.existing?.address.isNotEmpty == true
        ? widget.existing!.address
        : widget.existing?.city,
  );
  late final _experience = TextEditingController(
    text: widget.existing?.experienceYears == null
        ? ''
        : yearsLabel(widget.existing!.experienceYears!).split(' ').first,
  );
  late final _designation = TextEditingController(
    text: widget.existing?.currentRole,
  );
  late final _intro = TextEditingController(text: widget.existing?.notes);
  bool _saving = false;
  String? _problem;

  @override
  void initState() {
    super.initState();
    // The +91 in front follows what is typed: a number that already carries
    // its own country code goes without it.
    _phone.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    for (final c in [
      _name,
      _phone,
      _address,
      _experience,
      _designation,
      _intro,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  /// An edit that leaves the number on file alone keeps it as it was, even
  /// when it isn't a plain 10-digit Indian mobile.
  bool get _phoneUnchanged =>
      (widget.existing?.phone.trim() ?? '').isNotEmpty &&
      _phone.text.trim() == _initialPhone;

  Future<void> _save() async {
    final keepPhone = _phoneUnchanged;
    final digits = _phone.text.replaceAll(RegExp(r'\D'), '');
    final experience = _experience.text.trim();
    final years = experience.isEmpty ? null : double.tryParse(experience);
    final problem = _name.text.trim().isEmpty
        ? 'Enter their full name.'
        : !keepPhone && digits.length != 10
        ? 'Enter a 10-digit mobile number.'
        : experience.isNotEmpty && (years == null || years < 0)
        ? 'Enter work experience in years, 0 for a fresher.'
        : null;
    if (problem != null) {
      setState(() => _problem = problem);
      return;
    }
    setState(() {
      _saving = true;
      _problem = null;
    });
    try {
      final saved = await widget.api.saveCandidate(
        id: widget.existing?.id,
        name: _name.text,
        phone: keepPhone ? widget.existing!.phone.trim() : '+91 $digits',
        address: _address.text,
        experienceYears: years,
        designation: _designation.text,
        introduction: _intro.text,
      );
      if (mounted) Navigator.of(context).pop(saved);
    } catch (error) {
      if (mounted) {
        setState(() {
          _saving = false;
          _problem = placementsErrorText(error);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final editing = widget.existing != null;
    final ownCode = _phone.text.trimLeft().startsWith('+');
    return PlPage(
      title: editing ? 'Edit candidate' : 'Add candidate',
      subtitle: 'Candidate database',
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
              children: [
                _FormCard(
                  children: [
                    const _LeaveFieldLabel('Full name'),
                    _AffixedFormField(
                      controller: _name,
                      hintText: 'As on ID proof',
                      capitalization: TextCapitalization.words,
                    ),
                    const SizedBox(height: 16),
                    const _LeaveFieldLabel('Phone number'),
                    _AffixedFormField(
                      controller: _phone,
                      hintText: '10-digit mobile',
                      prefix: ownCode ? null : '+91',
                      keyboardType: TextInputType.phone,
                    ),
                    const SizedBox(height: 16),
                    const _LeaveFieldLabel('Address'),
                    _FormTextArea(
                      controller: _address,
                      hintText: 'House, street, area, city, PIN',
                    ),
                    const SizedBox(height: 16),
                    const _LeaveFieldLabel('Work experience'),
                    _AffixedFormField(
                      controller: _experience,
                      hintText: '0',
                      suffix: 'years',
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Enter 0 for a fresher.',
                      style: _candStyle(11.5, color: _Q.inkFaint),
                    ),
                    const SizedBox(height: 16),
                    const _LeaveFieldLabel('Designation'),
                    _FormTextField(
                      controller: _designation,
                      hintText: 'Current or preferred role',
                    ),
                    const SizedBox(height: 16),
                    const _LeaveFieldLabel('Introduction about the candidate'),
                    _FormTextArea(
                      controller: _intro,
                      height: 108,
                      hintText:
                          "A few lines on skills, strengths and what they're "
                          'looking for',
                    ),
                  ],
                ),
              ],
            ),
          ),
          // Under the form, where it is seen whichever field was last.
          if (_problem case final problem?)
            ColoredBox(
              color: const Color(0xFFF7F7F9),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFEE2E2),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    problem,
                    style: _candStyle(
                      12,
                      weight: FontWeight.w600,
                      color: const Color(0xFFB3261E),
                    ),
                  ),
                ),
              ),
            ),
          _FormSubmitBar(
            label: editing ? 'Save changes' : 'Save candidate',
            busy: _saving,
            onTap: _save,
          ),
        ],
      ),
    );
  }
}

/// Remove a candidate, with a reason. Pops true once removed.
class RemoveCandidateSheet extends StatefulWidget {
  const RemoveCandidateSheet({
    super.key,
    required this.api,
    required this.candidate,
  });

  final PlacementsApiService api;
  final PlacementCustomer candidate;

  static const reasons = [
    'Duplicate entry',
    'Added by mistake',
    'Not interested',
    'Other',
  ];

  @override
  State<RemoveCandidateSheet> createState() => _RemoveCandidateSheetState();
}

class _RemoveCandidateSheetState extends State<RemoveCandidateSheet> {
  String _reason = RemoveCandidateSheet.reasons.first;
  bool _busy = false;
  String? _problem;

  Future<void> _remove() async {
    setState(() {
      _busy = true;
      _problem = null;
    });
    try {
      await widget.api.removeCandidate(widget.candidate.id, _reason);
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (mounted) {
        setState(() {
          _busy = false;
          _problem = placementsErrorText(error);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      padding: EdgeInsets.fromLTRB(
        16,
        12,
        16,
        20 + MediaQuery.of(context).padding.bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: const Color(0xFFE5E7EB),
                borderRadius: BorderRadius.circular(4),
              ),
            ),
          ),
          const SizedBox(height: 18),
          Container(
            width: 48,
            height: 48,
            decoration: const BoxDecoration(
              color: Color(0xFFFEE2E2),
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.delete_outline_rounded,
              color: Color(0xFFB3261E),
            ),
          ),
          const SizedBox(height: 16),
          Text(
            'Remove ${widget.candidate.name}?',
            style: _candStyle(18, weight: FontWeight.w700, height: 24 / 18),
          ),
          const SizedBox(height: 6),
          Text(
            "They'll move to Removed and stop counting toward your performance "
            'incentive. Your admin can see removed candidates and restore them.',
            style: _candStyle(13, color: _Q.inkSoft, height: 1.5),
          ),
          const SizedBox(height: 18),
          const _LeaveFieldLabel('Reason'),
          const SizedBox(height: 4),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final reason in RemoveCandidateSheet.reasons)
                PlChoice(
                  label: reason,
                  selected: reason == _reason,
                  onTap: () => setState(() => _reason = reason),
                ),
            ],
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFFF7F7F9),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(
                  Icons.info_outline_rounded,
                  size: 16,
                  color: _Q.inkFaint,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    "A candidate with a Joined placement can't be removed. "
                    'Ask your admin.',
                    style: _candStyle(12, color: _Q.inkSoft, height: 1.5),
                  ),
                ),
              ],
            ),
          ),
          if (_problem case final problem?) ...[
            const SizedBox(height: 12),
            Text(
              problem,
              style: _candStyle(
                12,
                weight: FontWeight.w600,
                color: const Color(0xFFB3261E),
              ),
            ),
          ],
          const SizedBox(height: 18),
          PlButton(
            label: 'Remove candidate',
            danger: true,
            busy: _busy,
            onTap: _remove,
          ),
          const SizedBox(height: 10),
          PlButton(
            label: 'Cancel',
            outlined: true,
            onTap: _busy ? null : () => Navigator.of(context).pop(false),
          ),
        ],
      ),
    );
  }
}
