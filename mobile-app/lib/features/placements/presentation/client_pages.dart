part of '../../quick_actions/presentation/quick_actions_screen.dart';

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
  bool _newest = true;

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
    rows.sort((a, b) {
      final at = a.createdAt ?? DateTime(0);
      final bt = b.createdAt ?? DateTime(0);
      return _newest ? bt.compareTo(at) : at.compareTo(bt);
    });
    return rows;
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows;
    return PlPage(
      title: 'My clients',
      subtitle: rows == null ? null : '${rows.length} companies',
      actions: [
        PlAddButton(onTap: () => _open(ClientFormPage(api: widget.api))),
        const SizedBox(width: 8),
      ],
      body: RefreshIndicator(
        color: Pl.accent,
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
          children: [
            PlListControls(
              search: _search,
              hint: 'Search company or location',
              filters: [_all, feeLabel(true), feeLabel(false)],
              filter: _filter,
              onFilter: (f) => setState(() => _filter = f),
              newest: _newest,
              onSort: () => setState(() => _newest = !_newest),
            ),
            const SizedBox(height: 14),
            if (rows == null && _error == null)
              const PlState.loading()
            else if (rows == null)
              PlState.message(_error, onRetry: _load)
            else if (rows.isEmpty)
              const PlState.message(
                'No clients yet. Tap Add to log your first company.',
              )
            else if (_shown.isEmpty)
              const PlState.message('No clients match.')
            else
              for (final c in _shown) ...[
                _ClientRow(
                  client: c,
                  onTap: () =>
                      _open(ClientDetailPage(api: widget.api, clientId: c.id)),
                ),
                const SizedBox(height: 10),
              ],
          ],
        ),
      ),
    );
  }
}

class _ClientRow extends StatelessWidget {
  const _ClientRow({required this.client, required this.onTap});

  final PlacementClient client;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = client;
    final roles = c.designations.map((d) => d.title).join(', ');
    return PlCard(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              PlInitials(c.name),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(c.name, style: Pl.text(15, weight: FontWeight.w700)),
                    if (c.city.isNotEmpty)
                      Text(c.city, style: Pl.text(13, color: Pl.muted)),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              PlPill(feeLabel(c.feePaid), feeColors(c.feePaid)),
            ],
          ),
          const SizedBox(height: 10),
          const Divider(height: 1, color: Pl.line),
          const SizedBox(height: 10),
          Row(
            children: [
              const Icon(Icons.work_outline_rounded, size: 16, color: Pl.icon),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  roles.isEmpty ? 'No roles added' : roles,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Pl.text(13, color: roles.isEmpty ? Pl.faint : Pl.ink2),
                ),
              ),
              if (c.createdAt != null)
                Text(
                  'Added ${plShortDate(c.createdAt)}',
                  style: Pl.text(12, color: Pl.faint),
                ),
            ],
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
        title: Text(
          'Remove ${client.name}?',
          style: Pl.text(18, weight: FontWeight.w700),
        ),
        content: Text(
          'The client and its roles are deleted. A client with placements '
          "can't be removed.",
          style: Pl.text(14, color: Pl.muted, height: 1.5),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text('Cancel', style: Pl.text(14, weight: FontWeight.w700)),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(
              'Remove',
              style: Pl.text(14, weight: FontWeight.w700, color: Pl.danger),
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
            color: Pl.danger,
            onTap: () => _remove(page.client),
          ),
        ],
      ],
      body: RefreshIndicator(
        color: Pl.accent,
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
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
      PlCard(
        radius: 20,
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                PlInitials(c.name, size: 56),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(c.name, style: Pl.text(20, weight: FontWeight.w700)),
                      if (c.city.isNotEmpty)
                        Text(c.city, style: Pl.text(14, color: Pl.muted)),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            const Divider(height: 1, color: Pl.line),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Onboarding fee',
                        style: Pl.text(12, color: Pl.faint),
                      ),
                      Text(
                        c.feeRupees == null ? '—' : rupees(c.feeRupees!),
                        style: Pl.text(16, weight: FontWeight.w700),
                      ),
                      if (c.feeReference.isNotEmpty)
                        Text(
                          'Ref ${c.feeReference}',
                          style: Pl.text(12, color: Pl.faint),
                        ),
                    ],
                  ),
                ),
                PlPill(feeLabel(c.feePaid), feeColors(c.feePaid)),
              ],
            ),
            const SizedBox(height: 14),
            Text(
              [
                c.createdByUserId == _me ? 'Added by you' : 'Added',
                if (c.createdAt != null) plDate(c.createdAt),
              ].join(' · '),
              style: Pl.text(12, color: Pl.faint),
            ),
          ],
        ),
      ),
      const SizedBox(height: 22),
      PlSectionHeading(
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
        const PlState.message('No roles added for this client yet.')
      else
        for (final role in c.designations) ...[
          _RoleCard(role: role, placements: page.placements),
          const SizedBox(height: 10),
        ],
      const SizedBox(height: 12),
      PlSectionHeading('Candidates at this client'),
      const SizedBox(height: 12),
      if (page.placements.isEmpty)
        const PlState.message('No candidates put forward here yet.')
      else
        for (final p in page.placements) ...[
          PlCard(
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
                        style: Pl.text(15, weight: FontWeight.w700),
                      ),
                      Text(
                        _placementLine(p),
                        style: Pl.text(13, color: Pl.muted),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                PlPill(p.status.label, statusColors(p.status)),
              ],
            ),
          ),
          const SizedBox(height: 10),
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
    return PlCard(
      radius: 18,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  role.title,
                  style: Pl.text(15, weight: FontWeight.w700),
                ),
              ),
              if (role.budgetLabel.isNotEmpty)
                Text(
                  role.budgetLabel,
                  style: Pl.text(14, weight: FontWeight.w600, color: Pl.ink2),
                ),
            ],
          ),
          if (role.description.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              role.description,
              style: Pl.text(13, color: Pl.muted, height: 1.5),
            ),
          ],
          if (counts.isNotEmpty) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 12,
              children: [
                for (final entry in words.entries)
                  if ((counts[entry.key] ?? 0) > 0)
                    Text(
                      '${counts[entry.key]} ${entry.value}',
                      style: Pl.text(
                        12,
                        weight: FontWeight.w600,
                        color: statusColors(entry.key).text,
                      ),
                    ),
              ],
            ),
          ],
        ],
      ),
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
    final editing = widget.existing != null;
    final fee = widget.existing?.feeRupees ?? 2500;
    return PlPage(
      title: editing ? 'Edit client' : 'Add client',
      subtitle: 'Company database',
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
        children: [
          PlField(
            label: 'Company name',
            controller: _name,
            hint: 'Registered or trade name',
            capitalization: TextCapitalization.words,
          ),
          const SizedBox(height: 18),
          PlField(
            label: 'Company location',
            controller: _location,
            hint: 'City or full address',
          ),
          const SizedBox(height: 24),
          Row(
            children: [
              Expanded(
                child: Text(
                  'Designations',
                  style: Pl.text(16, weight: FontWeight.w700),
                ),
              ),
              Text(
                'Open roles at this client',
                style: Pl.text(12, color: Pl.muted),
              ),
            ],
          ),
          const SizedBox(height: 10),
          for (final (index, role) in _roles.indexed) ...[
            _roleCard(index, role),
            const SizedBox(height: 10),
          ],
          _AddRoleButton(
            onTap: () => setState(() => _roles.add(_RoleFields())),
          ),
          const SizedBox(height: 24),
          Text('Onboarding fee', style: Pl.text(16, weight: FontWeight.w700)),
          const SizedBox(height: 10),
          PlCard(
            radius: 18,
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(rupees(fee), style: Pl.text(28, weight: FontWeight.w700)),
                const SizedBox(height: 4),
                Text(
                  'Collect the one-time onboarding fee from the client.',
                  style: Pl.text(13, color: Pl.muted, height: 1.45),
                ),
                const SizedBox(height: 12),
                const Divider(height: 1, color: Pl.line),
                CheckboxListTile(
                  value: _paid,
                  onChanged: (v) => setState(() => _paid = v ?? false),
                  contentPadding: EdgeInsets.zero,
                  activeColor: Pl.accentDeep,
                  title: Text(
                    'Payment received',
                    style: Pl.text(15, weight: FontWeight.w600),
                  ),
                ),
                PlField(
                  label: 'UPI / transaction reference',
                  controller: _reference,
                  hint: 'Optional',
                  capitalization: TextCapitalization.characters,
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          if (_problem != null) ...[
            Text(
              _problem!,
              textAlign: TextAlign.center,
              style: Pl.text(13, color: Pl.danger),
            ),
            const SizedBox(height: 12),
          ],
          PlButton(
            label: editing ? 'Save changes' : 'Save client',
            busy: _saving,
            onTap: _save,
          ),
        ],
      ),
    );
  }

  Widget _roleCard(int index, _RoleFields role) {
    return PlCard(
      radius: 18,
      padding: const EdgeInsets.fromLTRB(16, 6, 6, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'ROLE ${index + 1}',
                  style: Pl.text(
                    12,
                    weight: FontWeight.w700,
                    color: Pl.accentDeep,
                  ),
                ),
              ),
              PlIconButton(
                label: 'Remove role',
                icon: Icons.delete_outline_rounded,
                plain: true,
                color: Pl.icon,
                onTap: () => setState(() {
                  _roles.removeAt(index).dispose();
                }),
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.only(right: 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                PlField(
                  label: 'Designation',
                  controller: role.title,
                  hint: 'e.g. Store manager',
                ),
                const SizedBox(height: 14),
                Text(
                  'Budget',
                  style: Pl.text(13, weight: FontWeight.w600, color: Pl.ink2),
                ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: role.budget,
                        keyboardType: TextInputType.number,
                        style: Pl.text(15),
                        decoration: plInput('Amount').copyWith(
                          prefixText: '₹ ',
                          prefixStyle: Pl.text(
                            15,
                            weight: FontWeight.w600,
                            color: Pl.ink2,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      height: 48,
                      padding: const EdgeInsets.symmetric(horizontal: 10),
                      decoration: BoxDecoration(
                        color: Pl.card,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: Pl.field),
                      ),
                      child: DropdownButtonHideUnderline(
                        child: DropdownButton<bool>(
                          value: role.perYear,
                          style: Pl.text(14),
                          onChanged: (v) =>
                              setState(() => role.perYear = v ?? false),
                          items: const [
                            DropdownMenuItem(
                              value: false,
                              child: Text('/ month'),
                            ),
                            DropdownMenuItem(
                              value: true,
                              child: Text('/ year'),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                PlField(
                  label: 'Description about the job',
                  controller: role.description,
                  hint: 'Responsibilities, timings, skills needed',
                  lines: 4,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _AddRoleButton extends StatelessWidget {
  const _AddRoleButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Pl.accentSoft,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: Pl.accentDash, width: 1.5),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: SizedBox(
          height: 52,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.add_rounded, color: Pl.accent, size: 20),
              const SizedBox(width: 8),
              Text(
                'Add another designation',
                style: Pl.text(
                  15,
                  weight: FontWeight.w700,
                  color: Pl.accentDeep,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
