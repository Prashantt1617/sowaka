part of '../../quick_actions/presentation/quick_actions_screen.dart';

/// The Actions pages' look (Leave, Reimbursement, Apply leave) for the client
/// pages: Sora on white cards over the light grey ground.
class _ClientLook {
  static const ink = Color(0xFF111827);
  static const soft = Color(0xFF6B7280);
  static const faint = Color(0xFF9CA3AF);
  static const rule = Color(0xFFF3F4F6);
  static const blue = Color(0xFF0571A6);
  static const danger = Color(0xFFB3261E);
  static const paid = Color(0xFF16A34A);

  static TextStyle text(
    double size, {
    FontWeight weight = FontWeight.w400,
    Color color = ink,
    double? height,
  }) => TextStyle(
    fontFamily: 'Sora',
    fontFamilyFallback: _soraFallback,
    fontSize: size,
    fontWeight: weight,
    color: color,
    height: height,
  );

  /// The section label between cards, as the hubs set theirs.
  static final section = _QText.section.copyWith(
    fontFamily: 'Sora',
    fontFamilyFallback: _soraFallback,
  );
}

/// A section label over a group of cards, with an optional action.
class _ClientSectionLabel extends StatelessWidget {
  const _ClientSectionLabel(this.text, {this.trailing});

  final String text;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(child: Text(text, style: _ClientLook.section)),
        ?trailing,
      ],
    );
  }
}

/// A white hub card, as [_HubRequestCard] and [_FormCard] draw theirs.
class _ClientHubCard extends StatelessWidget {
  const _ClientHubCard({required this.child, this.onTap});

  final Widget child;
  final VoidCallback? onTap;

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
          child: Padding(padding: const EdgeInsets.all(16), child: child),
        ),
      ),
    );
  }
}

/// The fee as the hubs show a status: green once paid, amber until then.
Widget _feeStatus(bool paid) => Container(
  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
  decoration: BoxDecoration(
    color: paid ? const Color(0xFFDCFCE7) : _Q.goldTint,
    borderRadius: BorderRadius.circular(99),
  ),
  child: Text(
    feeLabel(paid),
    style: _ClientLook.text(
      11,
      weight: FontWeight.w600,
      color: paid ? _ClientLook.paid : _Q.gold,
      height: 16.5 / 11,
    ),
  ),
);

/// My clients: the companies the signed-in person added, with a search, a
/// filter by onboarding fee, and Add.
class ClientsPage extends StatefulWidget {
  const ClientsPage({super.key, required this.api});

  final PlacementsApiService api;

  @override
  State<ClientsPage> createState() => _ClientsPageState();
}

class _ClientsPageState extends State<ClientsPage> {
  static const _all = 'All';

  final _search = TextEditingController();
  List<PlacementClient>? _rows;
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
      final rows = await widget.api.fetchClients(mine: true);
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

  List<PlacementClient> get _shown {
    final q = _search.text.trim().toLowerCase();
    final rows = (_rows ?? const <PlacementClient>[]).where((c) {
      if (_filter != _all && feeLabel(c.feePaid) != _filter) return false;
      return q.isEmpty ||
          c.name.toLowerCase().contains(q) ||
          c.city.toLowerCase().contains(q);
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
    return PlPage(
      title: 'My clients',
      subtitle: rows == null ? null : '${rows.length} companies',
      actions: [
        PlAddButton(onTap: () => _open(ClientFormPage(api: widget.api))),
      ],
      body: RefreshIndicator(
        color: _ClientLook.blue,
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
          children: [
            PlListControls(
              search: _search,
              hint: 'Search company or location',
              filters: [_all, feeLabel(true), feeLabel(false)],
              filter: _filter,
              onFilter: (f) => setState(() => _filter = f),
              sort: _sort,
              onSort: (sort) => setState(() => _sort = sort),
              shown: _rows == null ? null : _shown.length,
              total: _rows?.length,
              noun: 'clients',
            ),
            const SizedBox(height: 12),
            if (rows == null && _error == null)
              const PlState.loading()
            else if (rows == null)
              PlState.message(_error, onRetry: _load)
            else if (rows.isEmpty)
              _HubEmptyState(
                iconAsset: 'assets/icons/placements_client_building.png',
                text: 'No clients yet.\nAdd your first company to start.',
                buttonLabel: 'Add client',
                onTap: () => _open(ClientFormPage(api: widget.api)),
              )
            else if (_shown.isEmpty)
              const _HubEmptyState(
                iconAsset: 'assets/icons/placements_client_building.png',
                text: 'No clients match.',
              )
            else
              for (final c in _shown) ...[
                _ClientRow(
                  client: c,
                  onTap: () =>
                      _open(ClientDetailPage(api: widget.api, clientId: c.id)),
                ),
                const SizedBox(height: 12),
              ],
          ],
        ),
      ),
    );
  }
}

/// A client in the list, laid out like the hubs' request cards: the company
/// and its location over the fee, then its roles under a rule.
class _ClientRow extends StatelessWidget {
  const _ClientRow({required this.client, required this.onTap});

  final PlacementClient client;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = client;
    final roles = c.designations.map((d) => d.title).join(', ');
    return _ClientHubCard(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Image.asset(
                          'assets/icons/placements_client_building.png',
                          width: 16,
                          height: 16,
                          fit: BoxFit.cover,
                        ),
                        const SizedBox(width: 5),
                        Flexible(
                          child: Text(
                            c.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: _ClientLook.text(
                              14,
                              weight: FontWeight.w600,
                              height: 20 / 14,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      [
                        if (c.city.isNotEmpty) c.city,
                        if (c.createdAt != null)
                          'Added ${plShortDate(c.createdAt)}',
                      ].join(' · '),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: _ClientLook.text(
                        12,
                        color: _ClientLook.soft,
                        height: 16 / 12,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              _feeStatus(c.feePaid),
            ],
          ),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.only(top: 8),
            decoration: const BoxDecoration(
              border: Border(
                top: BorderSide(color: _ClientLook.rule, width: 0.8),
              ),
            ),
            child: Row(
              children: [
                SvgPicture.asset(
                  'assets/icons/work_grade.svg',
                  width: 14,
                  height: 14,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    roles.isEmpty ? 'No roles added' : roles,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: _ClientLook.text(
                      12,
                      weight: FontWeight.w600,
                      color: roles.isEmpty
                          ? _ClientLook.faint
                          : _ClientLook.soft,
                      height: 16 / 12,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// One client: the company, its onboarding fee, its roles with how many are
/// in each, and the candidates put forward there.
class ClientDetailPage extends StatefulWidget {
  const ClientDetailPage({
    super.key,
    required this.api,
    required this.clientId,
  });

  final PlacementsApiService api;
  final String clientId;

  @override
  State<ClientDetailPage> createState() => _ClientDetailPageState();
}

class _ClientDetailPageState extends State<ClientDetailPage> {
  PlacementClientPage? _page;
  String? _error;

  String get _me => widget.api.session.user.id;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final page = await widget.api.fetchClient(widget.clientId);
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

  Future<void> _remove(PlacementClient client) async {
    final sure = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text(
          'Remove ${client.name}?',
          style: _ClientLook.text(16, weight: FontWeight.w700),
        ),
        content: Text(
          'The client and its roles are deleted. A client with placements '
          "can't be removed.",
          style: _ClientLook.text(13, color: _ClientLook.soft, height: 1.5),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(
              'Cancel',
              style: _ClientLook.text(14, weight: FontWeight.w600),
            ),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(
              'Remove',
              style: _ClientLook.text(
                14,
                weight: FontWeight.w600,
                color: _ClientLook.danger,
              ),
            ),
          ),
        ],
      ),
    );
    if (sure != true || !mounted) return;
    try {
      await widget.api.deleteClient(client.id);
      if (!mounted) return;
      plToast(context, '${client.name} was removed');
      Navigator.of(context).pop();
    } catch (error) {
      if (mounted) plToast(context, placementsErrorText(error));
    }
  }

  @override
  Widget build(BuildContext context) {
    final page = _page;
    final mine = page != null && page.client.createdByUserId == _me;
    return PlPage(
      title: 'Client',
      titleSize: 16,
      actions: [
        if (mine) ...[
          PlIconButton(
            label: 'Edit client',
            icon: Icons.edit_outlined,
            onTap: () =>
                _open(ClientFormPage(api: widget.api, existing: page.client)),
          ),
          const SizedBox(width: 6),
          PlIconButton(
            label: 'Remove client',
            icon: Icons.delete_outline_rounded,
            color: _ClientLook.danger,
            onTap: () => _remove(page.client),
          ),
        ],
      ],
      body: RefreshIndicator(
        color: _ClientLook.blue,
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
          children: [
            if (page == null && _error == null)
              const PlState.loading()
            else if (page == null)
              PlState.message(_error, onRetry: _load)
            else
              ..._content(page, mine),
          ],
        ),
      ),
    );
  }

  List<Widget> _content(PlacementClientPage page, bool mine) {
    final c = page.client;
    return [
      _FormCard(
        children: [
          Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: const Color(0xFFF7F7F9),
                  borderRadius: BorderRadius.circular(12),
                ),
                alignment: Alignment.center,
                child: Image.asset(
                  'assets/icons/placements_client_building.png',
                  width: 24,
                  height: 24,
                  fit: BoxFit.contain,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      c.name,
                      style: _ClientLook.text(
                        16,
                        weight: FontWeight.w700,
                        height: 22 / 16,
                      ),
                    ),
                    if (c.city.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        c.city,
                        style: _ClientLook.text(12, color: _ClientLook.soft),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          const Divider(height: 1, thickness: 0.8, color: _ClientLook.rule),
          const SizedBox(height: 12),
          const _LeaveFieldLabel('Onboarding fee'),
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      c.feeRupees == null ? '—' : rupees(c.feeRupees!),
                      style: _ClientLook.text(18, weight: FontWeight.w700),
                    ),
                    if (c.feeReference.isNotEmpty)
                      Text(
                        'Ref ${c.feeReference}',
                        style: _ClientLook.text(12, color: _ClientLook.faint),
                      ),
                  ],
                ),
              ),
              _feeStatus(c.feePaid),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            [
              c.createdByUserId == _me ? 'Added by you' : 'Added',
              if (c.createdAt != null) plDate(c.createdAt),
            ].join(' · '),
            style: _ClientLook.text(11, color: _ClientLook.faint),
          ),
        ],
      ),
      const SizedBox(height: 20),
      _ClientSectionLabel(
        'Designations',
        trailing: mine
            ? PlAddButton(
                outlined: true,
                onTap: () => _open(
                  ClientFormPage(api: widget.api, existing: c, addRole: true),
                ),
              )
            : null,
      ),
      const SizedBox(height: 12),
      if (c.designations.isEmpty)
        const _HubEmptyState(
          iconAsset: 'assets/icons/placements_briefcase.png',
          text: 'No roles added for this client yet.',
        )
      else
        for (final role in c.designations) ...[
          _RoleCard(role: role, placements: page.placements),
          const SizedBox(height: 12),
        ],
      const SizedBox(height: 8),
      const _ClientSectionLabel('Candidates at this client'),
      const SizedBox(height: 12),
      if (page.placements.isEmpty)
        const _HubEmptyState(
          iconAsset: 'assets/icons/connect_icon_user.png',
          text: 'No candidates put forward here yet.',
        )
      else
        for (final p in page.placements) ...[
          _ClientHubCard(
            onTap: () => _open(
              CandidateDetailPage(api: widget.api, candidateId: p.customerId),
            ),
            child: Row(
              children: [
                PlInitials(p.customerName, size: 40, round: true, warm: true),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        p.customerName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: _ClientLook.text(
                          14,
                          weight: FontWeight.w600,
                          height: 20 / 14,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        _placementLine(p),
                        style: _ClientLook.text(12, color: _ClientLook.soft),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                PlPill(p.status.label, statusColors(p.status)),
              ],
            ),
          ),
          const SizedBox(height: 12),
        ],
    ];
  }

  /// "Store manager · joined 14 Oct", "Sales executive · interview 28 Oct".
  String _placementLine(Placement p) {
    final when = switch (p.status) {
      PlacementStatus.joined when p.joiningDate != null =>
        'joined ${plShortDate(p.joiningDate)}',
      PlacementStatus.interviewing when p.interviewDate != null =>
        'interview ${plShortDate(p.interviewDate)}',
      _ => '',
    };
    return [p.position, when].where((s) => s.isNotEmpty).join(' · ');
  }
}

/// A role's card: title, budget, description, and how many candidates are
/// where in it.
class _RoleCard extends StatelessWidget {
  const _RoleCard({required this.role, required this.placements});

  final PlacementDesignation role;
  final List<Placement> placements;

  @override
  Widget build(BuildContext context) {
    final key = role.title.trim().toLowerCase();
    final counts = <PlacementStatus, int>{};
    for (final p in placements) {
      if (p.position.trim().toLowerCase() != key) continue;
      counts[p.status] = (counts[p.status] ?? 0) + 1;
    }
    final words = {
      PlacementStatus.joined: 'joined',
      PlacementStatus.offered: 'selected',
      PlacementStatus.interviewing: 'in interview',
      PlacementStatus.shortlisted: 'profile shared',
    };
    return _FormCard(
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Text(
                role.title,
                style: _ClientLook.text(
                  14,
                  weight: FontWeight.w600,
                  height: 20 / 14,
                ),
              ),
            ),
            if (role.budgetLabel.isNotEmpty) ...[
              const SizedBox(width: 8),
              Text(
                role.budgetLabel,
                style: _ClientLook.text(
                  13,
                  weight: FontWeight.w600,
                  color: _ClientLook.blue,
                  height: 20 / 13,
                ),
              ),
            ],
          ],
        ),
        if (role.description.isNotEmpty) ...[
          const SizedBox(height: 6),
          Text(
            role.description,
            style: _ClientLook.text(12, color: _ClientLook.soft, height: 1.5),
          ),
        ],
        if (counts.isNotEmpty) ...[
          const SizedBox(height: 8),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.only(top: 8),
            decoration: const BoxDecoration(
              border: Border(
                top: BorderSide(color: _ClientLook.rule, width: 0.8),
              ),
            ),
            child: Wrap(
              spacing: 12,
              children: [
                for (final entry in words.entries)
                  if ((counts[entry.key] ?? 0) > 0)
                    Text(
                      '${counts[entry.key]} ${entry.value}',
                      style: _ClientLook.text(
                        12,
                        weight: FontWeight.w600,
                        color: statusColors(entry.key).text,
                      ),
                    ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

/// The controllers for one role in the client form.
class _RoleFields {
  _RoleFields([PlacementDesignation? role])
    : id = role?.id ?? '',
      title = TextEditingController(text: role?.title),
      budget = TextEditingController(
        text: role?.budgetRupees == null
            ? ''
            : role!.budgetRupees! == role.budgetRupees!.roundToDouble()
            ? role.budgetRupees!.round().toString()
            : role.budgetRupees!.toString(),
      ),
      description = TextEditingController(text: role?.description),
      perYear = role?.perYear ?? false;

  final String id;
  final TextEditingController title;
  final TextEditingController budget;
  final TextEditingController description;
  bool perYear;

  bool get blank =>
      title.text.trim().isEmpty &&
      budget.text.trim().isEmpty &&
      description.text.trim().isEmpty;

  void dispose() {
    title.dispose();
    budget.dispose();
    description.dispose();
  }
}

/// Add or edit a client: the company, its roles and the onboarding fee.
/// [addRole] opens an existing one with a new empty role at the end.
class ClientFormPage extends StatefulWidget {
  const ClientFormPage({
    super.key,
    required this.api,
    this.existing,
    this.addRole = false,
  });

  final PlacementsApiService api;
  final PlacementClient? existing;
  final bool addRole;

  @override
  State<ClientFormPage> createState() => _ClientFormPageState();
}

class _ClientFormPageState extends State<ClientFormPage> {
  /// The fee a new client is asked for; an existing one shows its own.
  static const _newClientFee = 2500.0;

  late final _name = TextEditingController(text: widget.existing?.name);
  late final _location = TextEditingController(text: widget.existing?.city);
  late final _reference = TextEditingController(
    text: widget.existing?.feeReference,
  );
  late final List<_RoleFields> _roles = [
    for (final role
        in widget.existing?.designations ?? const <PlacementDesignation>[])
      _RoleFields(role),
    if (widget.existing == null ||
        widget.addRole ||
        widget.existing!.designations.isEmpty)
      _RoleFields(),
  ];
  late bool _paid = widget.existing?.feePaid ?? false;
  bool _saving = false;
  String? _problem;

  @override
  void dispose() {
    _name.dispose();
    _location.dispose();
    _reference.dispose();
    for (final role in _roles) {
      role.dispose();
    }
    super.dispose();
  }

  /// Takes a role out of the form. Its fields are still in the tree until
  /// the next frame, so their controllers are let go after it.
  void _removeRole(_RoleFields role) {
    setState(() => _roles.remove(role));
    WidgetsBinding.instance.addPostFrameCallback((_) => role.dispose());
  }

  Future<void> _pickPeriod(_RoleFields role) async {
    const month = 'Per month';
    const year = 'Per year';
    final picked = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => _LeavePickerSheet(
        options: const [month, year],
        selected: role.perYear ? year : month,
      ),
    );
    if (picked == null || !mounted) return;
    setState(() => role.perYear = picked == year);
  }

  Future<void> _save() async {
    final roles = <PlacementDesignation>[];
    String? problem;
    for (final (index, role) in _roles.indexed) {
      if (role.blank) continue;
      final budgetText = role.budget.text.replaceAll(',', '').trim();
      final budget = budgetText.isEmpty ? null : double.tryParse(budgetText);
      if (role.title.text.trim().isEmpty) {
        problem = 'Enter a designation for role ${index + 1}.';
        break;
      }
      if (budgetText.isNotEmpty && (budget == null || budget < 0)) {
        problem = 'Enter the budget for role ${index + 1} as an amount.';
        break;
      }
      roles.add(
        PlacementDesignation(
          id: role.id,
          title: role.title.text.trim(),
          budgetRupees: budget,
          perYear: role.perYear,
          description: role.description.text.trim(),
        ),
      );
    }
    if (_name.text.trim().isEmpty) problem = 'Enter the company name.';
    if (problem != null) {
      setState(() => _problem = problem);
      return;
    }
    setState(() {
      _saving = true;
      _problem = null;
    });
    try {
      final saved = await widget.api.saveClient(
        id: widget.existing?.id,
        name: _name.text,
        location: _location.text,
        designations: roles,
        feePaid: _paid,
        feeReference: _reference.text,
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
    final existing = widget.existing;
    final editing = existing != null;
    // A client saved before fees were recorded has none: say so, rather than
    // showing the new-client amount as though it had been agreed.
    final fee = editing
        ? (existing.feeRupees == null ? 'Not set' : rupees(existing.feeRupees!))
        : rupees(_newClientFee);
    return PlPage(
      title: editing ? 'Edit client' : 'Add client',
      subtitle: 'Company database',
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
              children: [
                _FormCard(
                  children: [
                    const _LeaveFieldLabel('Company name'),
                    _FormTextField(
                      controller: _name,
                      hintText: 'Registered or trade name',
                    ),
                    const SizedBox(height: 16),
                    const _LeaveFieldLabel('Company location'),
                    _FormTextField(
                      controller: _location,
                      hintText: 'City or full address',
                    ),
                  ],
                ),
                const SizedBox(height: 20),
                const _ClientSectionLabel('Designations'),
                const SizedBox(height: 4),
                Text(
                  'Open roles at this client',
                  style: _ClientLook.text(12, color: _ClientLook.soft),
                ),
                const SizedBox(height: 12),
                for (final (index, role) in _roles.indexed) ...[
                  _roleCard(index, role),
                  const SizedBox(height: 12),
                ],
                _AddRoleButton(
                  onTap: () => setState(() => _roles.add(_RoleFields())),
                ),
                const SizedBox(height: 20),
                const _ClientSectionLabel('Onboarding fee'),
                const SizedBox(height: 12),
                _FormCard(
                  children: [
                    Text(
                      fee,
                      style: _ClientLook.text(
                        22,
                        weight: FontWeight.w700,
                        color: existing?.feeRupees == null && editing
                            ? _ClientLook.faint
                            : _ClientLook.ink,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Collect the one-time onboarding fee from the client.',
                      style: _ClientLook.text(
                        12,
                        color: _ClientLook.soft,
                        height: 1.45,
                      ),
                    ),
                    const SizedBox(height: 12),
                    const Divider(
                      height: 1,
                      thickness: 0.8,
                      color: _ClientLook.rule,
                    ),
                    InkWell(
                      onTap: () => setState(() => _paid = !_paid),
                      borderRadius: BorderRadius.circular(12),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        child: Row(
                          children: [
                            Expanded(
                              child: Text(
                                'Payment received',
                                style: _ClientLook.text(
                                  14,
                                  weight: FontWeight.w600,
                                ),
                              ),
                            ),
                            Checkbox(
                              value: _paid,
                              onChanged: (v) =>
                                  setState(() => _paid = v ?? false),
                              activeColor: _ClientLook.blue,
                              side: const BorderSide(
                                color: Color(0xFFD1D5DB),
                                width: 1.5,
                              ),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(4),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const _LeaveFieldLabel('UPI / transaction reference'),
                    _FormTextField(
                      controller: _reference,
                      hintText: 'Optional',
                    ),
                  ],
                ),
              ],
            ),
          ),
          if (_problem != null)
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
                    _problem!,
                    style: _ClientLook.text(
                      12,
                      weight: FontWeight.w600,
                      color: _ClientLook.danger,
                    ),
                  ),
                ),
              ),
            ),
          _FormSubmitBar(
            label: editing ? 'Save changes' : 'Save client',
            busy: _saving,
            onTap: _save,
          ),
        ],
      ),
    );
  }

  Widget _roleCard(int index, _RoleFields role) {
    // Keyed by the role itself, so taking one out never hands its text to
    // the card that moves up into its place.
    return KeyedSubtree(
      key: ObjectKey(role),
      child: _FormCard(
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'ROLE ${index + 1}',
                  style: _ClientLook.text(
                    12,
                    weight: FontWeight.w700,
                    color: _ClientLook.blue,
                  ).copyWith(letterSpacing: .6),
                ),
              ),
              PlIconButton(
                label: 'Remove role',
                icon: Icons.delete_outline_rounded,
                plain: true,
                color: _ClientLook.faint,
                onTap: () => _removeRole(role),
              ),
            ],
          ),
          const SizedBox(height: 4),
          const _LeaveFieldLabel('Designation'),
          _FormTextField(
            controller: role.title,
            hintText: 'e.g. Store manager',
          ),
          const SizedBox(height: 16),
          const _LeaveFieldLabel('Budget (₹)'),
          Row(
            children: [
              Expanded(
                child: _FormTextField(
                  controller: role.budget,
                  hintText: 'Amount',
                  keyboardType: TextInputType.number,
                ),
              ),
              const SizedBox(width: 8),
              SizedBox(
                width: 124,
                child: _LeaveDropdownField(
                  value: role.perYear ? 'Per year' : 'Per month',
                  filled: true,
                  onTap: () => _pickPeriod(role),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          const _LeaveFieldLabel('Description about the job'),
          _FormTextArea(
            controller: role.description,
            hintText: 'Responsibilities, timings, skills needed',
          ),
        ],
      ),
    );
  }
}

/// "Add another designation": a dashed outline like the receipt upload.
class _AddRoleButton extends StatelessWidget {
  const _AddRoleButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: CustomPaint(
          foregroundPainter: const _DashedRoundRectPainter(
            color: Color(0xFFBFD7E4),
            radius: 12,
          ),
          child: SizedBox(
            height: 48,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(
                  Icons.add_rounded,
                  color: _ClientLook.blue,
                  size: 18,
                ),
                const SizedBox(width: 6),
                Text(
                  'Add another designation',
                  style: _ClientLook.text(
                    13,
                    weight: FontWeight.w600,
                    color: _ClientLook.blue,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
