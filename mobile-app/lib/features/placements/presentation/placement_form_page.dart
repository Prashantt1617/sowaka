part of '../../quick_actions/presentation/quick_actions_screen.dart';

/// Put a candidate forward to a client's role, or ([existing]) update where
/// it stands. Opened from the candidate's page, so the candidate is fixed;
/// an existing placement keeps its client and role (HR moves those on the
/// dashboard).
class PlacementFormPage extends StatefulWidget {
  const PlacementFormPage({
    super.key,
    required this.api,
    required this.candidate,
    this.existing,
  });

  final PlacementsApiService api;
  final PlacementCustomer candidate;
  final Placement? existing;

  @override
  State<PlacementFormPage> createState() => _PlacementFormPageState();
}

class _PlacementFormPageState extends State<PlacementFormPage> {
  PlacementClient? _client;
  PlacementDesignation? _role;
  final _roleText = TextEditingController();
  late PlacementStatus _status =
      widget.existing?.status ?? PlacementStatus.shortlisted;
  late DateTime? _interview = widget.existing?.interviewDate;
  late DateTime? _joining = widget.existing?.joiningDate;
  late final _salary = TextEditingController(
    text: widget.existing?.ctcRupees == null
        ? ''
        : widget.existing!.ctcRupees!.round().toString(),
  );
  late final _remarks = TextEditingController(text: widget.existing?.notes);
  bool _saving = false;
  String? _problem;

  @override
  void dispose() {
    _roleText.dispose();
    _salary.dispose();
    _remarks.dispose();
    super.dispose();
  }

  Future<void> _pickClient() async {
    final picked = await showModalBottomSheet<PlacementClient>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _ClientPicker(api: widget.api),
    );
    if (picked == null || !mounted) return;
    setState(() {
      _client = picked;
      _role = null;
      _roleText.clear();
      _problem = null;
    });
  }

  Future<void> _pickRole() async {
    final client = _client;
    if (client == null) {
      setState(() => _problem = 'Select the client first.');
      return;
    }
    final picked = await showModalBottomSheet<PlacementDesignation>(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) => _Sheet(
        title: 'Designation at ${client.name}',
        children: [
          for (final role in client.designations)
            ListTile(
              contentPadding: const EdgeInsets.symmetric(horizontal: 4),
              title: Text(
                role.title,
                style: Pl.text(15, weight: FontWeight.w700),
              ),
              subtitle: role.budgetLabel.isEmpty
                  ? null
                  : Text(role.budgetLabel, style: Pl.text(13, color: Pl.muted)),
              trailing: role.id == _role?.id
                  ? const Icon(Icons.check_rounded, color: Pl.accent)
                  : null,
              onTap: () => Navigator.of(context).pop(role),
            ),
        ],
      ),
    );
    if (picked != null && mounted) setState(() => _role = picked);
  }

  Future<void> _pickDay({required bool interview}) async {
    final now = DateTime.now();
    final current = interview ? _interview : _joining;
    final picked = await showDatePicker(
      context: context,
      initialDate: current ?? now,
      firstDate: DateTime(now.year - 2),
      lastDate: DateTime(now.year + 3),
    );
    if (picked == null || !mounted) return;
    setState(() => interview ? _interview = picked : _joining = picked);
  }

  Future<void> _save() async {
    final existing = widget.existing;
    final client = _client;
    final position = client == null
        ? ''
        : client.designations.isEmpty
        ? _roleText.text.trim()
        : (_role?.title ?? '');
    final salaryText = _salary.text.replaceAll(',', '').trim();
    final salary = salaryText.isEmpty ? null : double.tryParse(salaryText);
    final problem = existing == null && client == null
        ? 'Select the client company.'
        : existing == null && position.isEmpty
        ? 'Choose the designation.'
        : salaryText.isNotEmpty && (salary == null || salary < 0)
        ? 'Enter the offered salary as an amount.'
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
      if (existing == null) {
        await widget.api.createPlacement(
          customerId: widget.candidate.id,
          clientId: client!.id,
          position: position,
          status: _status,
          interviewDate: _interview,
          joiningDate: _joining,
          ctcRupees: salary,
          notes: _remarks.text,
        );
      } else {
        await widget.api.savePlacement(
          existing.id,
          status: _status,
          interviewDate: _interview,
          joiningDate: _joining,
          ctcRupees: salary,
          notes: _remarks.text,
        );
      }
      if (mounted) Navigator.of(context).pop(true);
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
    final c = widget.candidate;
    return PlPage(
      title: existing == null ? 'Add placement' : 'Update placement',
      subtitle: "Opened from the candidate's profile",
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
        children: [
          PlCard(
            radius: 18,
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _label('Candidate'),
                const SizedBox(height: 8),
                Row(
                  children: [
                    PlInitials(c.name, size: 40, round: true, warm: true),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            c.name,
                            style: Pl.text(15, weight: FontWeight.w700),
                          ),
                          if (c.subtitle.isNotEmpty)
                            Text(
                              c.subtitle,
                              style: Pl.text(13, color: Pl.muted),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                Row(
                  children: [
                    const Expanded(child: Divider(color: Pl.line)),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 10),
                      child: Text(
                        'placed at',
                        style: Pl.text(12, color: Pl.faint),
                      ),
                    ),
                    const Expanded(child: Divider(color: Pl.line)),
                  ],
                ),
                const SizedBox(height: 14),
                _label('Client company'),
                const SizedBox(height: 6),
                existing == null
                    ? _PickerBox(
                        text: _client?.name ?? 'Select client',
                        empty: _client == null,
                        onTap: _pickClient,
                      )
                    : _FixedBox(existing.clientName),
                const SizedBox(height: 14),
                _label('Designation'),
                const SizedBox(height: 6),
                if (existing != null)
                  _FixedBox(existing.position)
                else if (_client != null && _client!.designations.isEmpty)
                  TextField(
                    controller: _roleText,
                    style: Pl.text(15),
                    decoration: plInput(
                      'This client has no roles yet: type one',
                    ),
                  )
                else
                  _PickerBox(
                    text: _role == null
                        ? "Choose from the client's roles"
                        : [
                            _role!.title,
                            _role!.budgetLabel,
                          ].where((s) => s.isNotEmpty).join(' · '),
                    empty: _role == null,
                    onTap: _pickRole,
                  ),
                if (existing == null) ...[
                  const SizedBox(height: 6),
                  Text(
                    'Shows the roles added for this client, with their budget.',
                    style: Pl.text(12, color: Pl.faint),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 20),
          _label('Status'),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final status in PlacementStatus.values)
                PlChoice(
                  label: status.label,
                  selected: status == _status,
                  onTap: () => setState(() => _status = status),
                ),
            ],
          ),
          const SizedBox(height: 20),
          Row(
            children: [
              Expanded(
                child: _DayField(
                  label: 'Interview date',
                  day: _interview,
                  onTap: () => _pickDay(interview: true),
                  onClear: () => setState(() => _interview = null),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _DayField(
                  label: 'Joining date',
                  day: _joining,
                  onTap: () => _pickDay(interview: false),
                  onClear: () => setState(() => _joining = null),
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          PlField(
            label: 'Offered salary',
            controller: _salary,
            hint: 'Fill once selected',
            prefix: '₹',
            keyboard: TextInputType.number,
          ),
          const SizedBox(height: 18),
          PlField(
            label: 'Remarks',
            controller: _remarks,
            hint: 'Feedback from the client or candidate',
            lines: 3,
          ),
          const SizedBox(height: 18),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              color: Pl.accentSoft,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(
              children: [
                const Icon(
                  Icons.verified_outlined,
                  size: 18,
                  color: Pl.accentDeep,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text.rich(
                    TextSpan(
                      children: [
                        TextSpan(
                          text:
                              existing == null ||
                                  existing.createdByUserId ==
                                      widget.api.session.user.id
                              ? 'Placed by you. '
                              : '',
                          style: Pl.text(
                            13,
                            weight: FontWeight.w700,
                            color: Pl.accentText,
                          ),
                        ),
                        TextSpan(
                          text:
                              'Your performance incentive is connected to this.',
                          style: Pl.text(13, color: Pl.accentText),
                        ),
                      ],
                    ),
                  ),
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
            label: existing == null ? 'Save placement' : 'Save changes',
            busy: _saving,
            onTap: _save,
          ),
        ],
      ),
    );
  }

  Widget _label(String text) => Text(
    text,
    style: Pl.text(13, weight: FontWeight.w600, color: Pl.ink2),
  );
}

class _PickerBox extends StatelessWidget {
  const _PickerBox({
    required this.text,
    required this.empty,
    required this.onTap,
  });

  final String text;
  final bool empty;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Pl.card,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: Pl.field),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: 48),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  text,
                  style: Pl.text(
                    15,
                    weight: empty ? FontWeight.w500 : FontWeight.w600,
                    color: empty ? Pl.hint : Pl.ink,
                  ),
                ),
              ),
              const Icon(Icons.expand_more_rounded, color: Pl.icon),
            ],
          ),
        ),
      ),
    );
  }
}

class _FixedBox extends StatelessWidget {
  const _FixedBox(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minHeight: 48),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: Pl.stone,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Pl.field),
      ),
      child: Text(text, style: Pl.text(15, weight: FontWeight.w600)),
    );
  }
}

class _DayField extends StatelessWidget {
  const _DayField({
    required this.label,
    required this.day,
    required this.onTap,
    required this.onClear,
  });

  final String label;
  final DateTime? day;
  final VoidCallback onTap;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          label,
          style: Pl.text(13, weight: FontWeight.w600, color: Pl.ink2),
        ),
        const SizedBox(height: 6),
        Material(
          color: Pl.card,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: const BorderSide(color: Pl.field),
          ),
          child: InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: onTap,
            child: Container(
              height: 48,
              padding: const EdgeInsets.only(left: 14, right: 4),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      day == null ? 'DD/MM/YYYY' : plDate(day),
                      style: Pl.text(15, color: day == null ? Pl.hint : Pl.ink),
                    ),
                  ),
                  if (day != null)
                    IconButton(
                      tooltip: 'Clear $label',
                      onPressed: onClear,
                      icon: const Icon(
                        Icons.close_rounded,
                        size: 18,
                        color: Pl.icon,
                      ),
                    )
                  else
                    const Padding(
                      padding: EdgeInsets.only(right: 10),
                      child: Icon(
                        Icons.calendar_today_outlined,
                        size: 18,
                        color: Pl.icon,
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// A bottom sheet with a title and a list.
class _Sheet extends StatelessWidget {
  const _Sheet({required this.title, required this.children, this.top});

  final String title;
  final List<Widget> children;
  final Widget? top;

  @override
  Widget build(BuildContext context) {
    // A Material, not a coloured box: the rows' ink shows on it.
    final media = MediaQuery.of(context);
    return Material(
      color: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      child: Container(
        constraints: BoxConstraints(maxHeight: media.size.height * 0.8),
        padding: EdgeInsets.fromLTRB(
          20,
          12,
          20,
          16 + media.viewInsets.bottom + media.padding.bottom,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: Pl.field,
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text(title, style: Pl.text(18, weight: FontWeight.w700)),
            const SizedBox(height: 12),
            ?top,
            Flexible(child: ListView(shrinkWrap: true, children: children)),
          ],
        ),
      ),
    );
  }
}

/// Every client of the company, with a search: a candidate can be put
/// forward to a colleague's client too.
class _ClientPicker extends StatefulWidget {
  const _ClientPicker({required this.api});

  final PlacementsApiService api;

  @override
  State<_ClientPicker> createState() => _ClientPickerState();
}

class _ClientPickerState extends State<_ClientPicker> {
  final _search = TextEditingController();
  List<PlacementClient>? _clients;
  String? _error;

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
      final clients = await widget.api.fetchClients();
      if (mounted) setState(() => _clients = clients);
    } catch (error) {
      if (mounted) setState(() => _error = placementsErrorText(error));
    }
  }

  @override
  Widget build(BuildContext context) {
    final q = _search.text.trim().toLowerCase();
    final clients = (_clients ?? const <PlacementClient>[])
        .where(
          (c) =>
              q.isEmpty ||
              c.name.toLowerCase().contains(q) ||
              c.city.toLowerCase().contains(q),
        )
        .toList();
    return _Sheet(
      title: 'Select client',
      top: Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: TextField(
          controller: _search,
          style: Pl.text(15),
          decoration: plInput('Search company or location').copyWith(
            prefixIcon: const Icon(
              Icons.search_rounded,
              color: Pl.icon,
              size: 20,
            ),
          ),
        ),
      ),
      children: [
        if (_clients == null && _error == null)
          const PlState.loading()
        else if (_clients == null)
          PlState.message(_error, onRetry: _load)
        else if (clients.isEmpty)
          const PlState.message(
            'No clients found. Add the company under My clients first.',
          )
        else
          for (final c in clients)
            ListTile(
              contentPadding: const EdgeInsets.symmetric(horizontal: 4),
              leading: PlInitials(c.name, size: 40),
              title: Text(c.name, style: Pl.text(15, weight: FontWeight.w700)),
              subtitle: Text(
                [
                  if (c.city.isNotEmpty) c.city,
                  '${c.designations.length} ${c.designations.length == 1 ? 'role' : 'roles'}',
                ].join(' · '),
                style: Pl.text(13, color: Pl.muted),
              ),
              onTap: () => Navigator.of(context).pop(c),
            ),
      ],
    );
  }
}
