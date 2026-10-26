part of '../../quick_actions/presentation/quick_actions_screen.dart';

/// Put a candidate forward to a client's role, or ([existing]) update where
/// it stands. Opened from the candidate's page, so the candidate is fixed;
/// an existing placement keeps its client and role (HR moves those on the
/// dashboard).
///
/// Drawn like Apply leave: white [_FormCard] sections on the Actions grey,
/// [_LeaveFieldLabel] captions, [_LeaveDropdownField]-style pickers that open
/// [_LeavePickerSheet]-style sheets, and a [_FormSubmitBar] at the foot.
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

/// Sora for the form's own text, as the Actions pages set it.
const _plFormFont = TextStyle(
  fontFamily: 'Sora',
  fontFamilyFallback: _soraFallback,
);

/// "28 Oct 2026": placements run across years, so the year stays.
String _plFormDay(DateTime day) => '${_short(day)} ${day.year}';

/// An amount as it was saved: whole rupees without decimals, paise kept.
String _plFormAmount(double? rupees) {
  if (rupees == null) return '';
  return rupees == rupees.roundToDouble()
      ? rupees.round().toString()
      : rupees.toStringAsFixed(2);
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
    text: _plFormAmount(widget.existing?.ctcRupees),
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

  Future<T?> _sheet<T>(WidgetBuilder builder) => showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: builder,
  );

  Future<void> _pickClient() async {
    final picked = await _sheet<PlacementClient>(
      (_) => _ClientPicker(api: widget.api, selectedId: _client?.id),
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
    final picked = await _sheet<PlacementDesignation>(
      (context) => _PlacementPickerSheet(
        title: 'Designation at ${client.name}',
        children: [
          for (final role in client.designations)
            _PlacementPickerRow(
              title: role.title,
              trailing: role.budgetLabel,
              selected: role.id == _role?.id,
              last: role == client.designations.last,
              onTap: () => Navigator.of(context).pop(role),
            ),
        ],
      ),
    );
    if (picked != null && mounted) {
      setState(() {
        _role = picked;
        _problem = null;
      });
    }
  }

  Future<void> _pickStatus() async {
    final picked = await _sheet<PlacementStatus>(
      (context) => _PlacementPickerSheet(
        title: 'Status',
        children: [
          for (final status in PlacementStatus.values)
            _PlacementPickerRow(
              title: status.label,
              selected: status == _status,
              last: status == PlacementStatus.values.last,
              onTap: () => Navigator.of(context).pop(status),
            ),
        ],
      ),
    );
    if (picked != null && mounted) setState(() => _status = picked);
  }

  /// As Apply leave picks a day: the app's date picker in its blue theme.
  /// The window reaches back two years, or further when the saved day is
  /// older, so an existing date always opens.
  Future<void> _pickDay({required bool interview}) async {
    final today = _dateOnly(DateTime.now());
    final current = interview ? _interview : _joining;
    final twoYearsBack = DateTime(today.year - 2, today.month, today.day);
    final first = current != null && current.isBefore(twoYearsBack)
        ? _dateOnly(current)
        : twoYearsBack;
    final threeYearsOn = DateTime(today.year + 3, today.month, today.day);
    final last = current != null && current.isAfter(threeYearsOn)
        ? _dateOnly(current)
        : threeYearsOn;
    final picked = await showDatePicker(
      context: context,
      initialDate: current ?? today,
      firstDate: first,
      lastDate: last,
      builder: _pickerTheme,
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
    final placedByMe =
        existing == null ||
        existing.createdByUserId == widget.api.session.user.id;
    return PlPage(
      title: existing == null ? 'Add placement' : 'Update placement',
      subtitle: "Opened from the candidate's profile",
      body: ColoredBox(
        color: const Color(0xFFF7F7F9),
        child: DefaultTextStyle.merge(
          style: _plFormFont,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                  children: [
                    _FormCard(
                      children: [
                        _LeaveFieldLabel('Candidate'),
                        Row(
                          children: [
                            _PlacementInitials(c.name),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(c.name, style: _QText.cardTitle),
                                  if (c.subtitle.isNotEmpty)
                                    Text(
                                      c.subtitle,
                                      style: _QText.cardSubtitle,
                                    ),
                                ],
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 16),
                        _LeaveFieldLabel('Client company'),
                        existing == null
                            ? _PlacementSelectField(
                                key: const ValueKey('placement-client'),
                                value: _client?.name ?? 'Select client',
                                filled: _client != null,
                                onTap: _pickClient,
                              )
                            : _PlacementFixedField(existing.clientName),
                        const SizedBox(height: 16),
                        _LeaveFieldLabel('Designation'),
                        if (existing != null)
                          _PlacementFixedField(existing.position)
                        else if (_client != null &&
                            _client!.designations.isEmpty)
                          _FormTextField(
                            key: const ValueKey('placement-role-text'),
                            controller: _roleText,
                            hintText: 'This client has no roles yet: type one',
                          )
                        else
                          _PlacementSelectField(
                            key: const ValueKey('placement-role'),
                            value: _role == null
                                ? "Choose from the client's roles"
                                : [
                                    _role!.title,
                                    _role!.budgetLabel,
                                  ].where((s) => s.isNotEmpty).join(' · '),
                            filled: _role != null,
                            onTap: _pickRole,
                          ),
                        if (existing == null) ...[
                          const SizedBox(height: 6),
                          const Text(
                            'Shows the roles added for this client, with '
                            'their budget.',
                            style: _QText.cardSubtitleFaint,
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 12),
                    _FormCard(
                      children: [
                        _LeaveFieldLabel('Status'),
                        _PlacementSelectField(
                          key: const ValueKey('placement-status'),
                          value: _status.label,
                          filled: true,
                          onTap: _pickStatus,
                        ),
                        const SizedBox(height: 16),
                        _PlacementDayField(
                          label: 'Interview date',
                          day: _interview,
                          onTap: () => _pickDay(interview: true),
                          onClear: () => setState(() => _interview = null),
                        ),
                        const SizedBox(height: 16),
                        _PlacementDayField(
                          label: 'Joining date',
                          day: _joining,
                          onTap: () => _pickDay(interview: false),
                          onClear: () => setState(() => _joining = null),
                        ),
                        const SizedBox(height: 16),
                        _LeaveFieldLabel('Offered salary (₹)'),
                        _FormTextField(
                          key: const ValueKey('placement-salary'),
                          controller: _salary,
                          hintText: 'Fill once selected',
                          keyboardType: const TextInputType.numberWithOptions(
                            decimal: true,
                          ),
                        ),
                        const SizedBox(height: 16),
                        _LeaveFieldLabel('Remarks'),
                        _FormTextArea(
                          controller: _remarks,
                          hintText: 'Feedback from the client or candidate',
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: _Q.goldTint,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text.rich(
                        TextSpan(
                          children: [
                            if (placedByMe)
                              const TextSpan(
                                text: 'Placed by you. ',
                                style: TextStyle(fontWeight: FontWeight.w700),
                              ),
                            const TextSpan(
                              text:
                                  'Your performance incentive is connected '
                                  'to this.',
                            ),
                          ],
                        ),
                        style: const TextStyle(
                          color: _Q.ink,
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                          height: 1.4,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              if (_problem != null)
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                  child: Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFEE2E2),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      _problem!,
                      style: const TextStyle(
                        color: Color(0xFFB3261E),
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
              _FormSubmitBar(
                label: existing == null ? 'Save placement' : 'Save changes',
                busy: _saving,
                onTap: _save,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The candidate's initials in a round terracotta tint.
class _PlacementInitials extends StatelessWidget {
  const _PlacementInitials(this.name);

  final String name;

  @override
  Widget build(BuildContext context) {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty);
    final letters = parts.take(2).map((p) => p[0].toUpperCase()).join();
    return Container(
      width: 40,
      height: 40,
      alignment: Alignment.center,
      decoration: const BoxDecoration(
        color: _Q.terraTint,
        shape: BoxShape.circle,
      ),
      child: Text(
        letters.isEmpty ? '?' : letters,
        style: const TextStyle(
          color: _Q.terraDeep,
          fontSize: 14,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

/// [_LeaveDropdownField] with the chevron a picker needs.
class _PlacementSelectField extends StatelessWidget {
  const _PlacementSelectField({
    super.key,
    required this.value,
    required this.filled,
    required this.onTap,
  });

  final String value;
  final bool filled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        width: double.infinity,
        constraints: const BoxConstraints(minHeight: 41.6),
        padding: const EdgeInsets.only(left: 12, right: 8),
        decoration: BoxDecoration(
          border: Border.all(color: const Color(0xFFE5E7EB)),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 10),
                child: Text(
                  value,
                  style: TextStyle(
                    color: filled
                        ? const Color(0xFF111827)
                        : const Color(0xFF9CA3AF),
                    fontSize: 14,
                  ),
                ),
              ),
            ),
            const Icon(
              Icons.keyboard_arrow_down_rounded,
              size: 20,
              color: Color(0xFF9CA3AF),
            ),
          ],
        ),
      ),
    );
  }
}

/// What the form shows but cannot change: the field, greyed.
class _PlacementFixedField extends StatelessWidget {
  const _PlacementFixedField(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      constraints: const BoxConstraints(minHeight: 41.6),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFFF7F7F9),
        border: Border.all(color: const Color(0xFFE5E7EB)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        text,
        style: const TextStyle(color: Color(0xFF6B7280), fontSize: 14),
      ),
    );
  }
}

/// A date as Apply leave shows one ("Select date", then "28 Oct 2026"),
/// with a clear button once it is set.
class _PlacementDayField extends StatelessWidget {
  const _PlacementDayField({
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
    final day = this.day;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _LeaveFieldLabel(label),
        InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: Container(
            height: 41.6,
            padding: EdgeInsets.only(left: 12, right: day == null ? 12 : 2),
            decoration: BoxDecoration(
              border: Border.all(color: const Color(0xFFE5E7EB)),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    day == null ? 'Select date' : _plFormDay(day),
                    style: TextStyle(
                      color: day == null
                          ? const Color(0xFF9CA3AF)
                          : const Color(0xFF111827),
                      fontSize: 14,
                    ),
                  ),
                ),
                if (day != null)
                  IconButton(
                    tooltip: 'Clear $label',
                    onPressed: onClear,
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints.tightFor(
                      width: 36,
                      height: 36,
                    ),
                    icon: const Icon(
                      Icons.close_rounded,
                      size: 18,
                      color: Color(0xFF9CA3AF),
                    ),
                  )
                else
                  const Icon(
                    Icons.calendar_today_outlined,
                    size: 16,
                    color: Color(0xFF9CA3AF),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// [_LeavePickerSheet]'s look — the handle, full-width rows, hairlines —
/// with a title, an optional [top] (the client search) and a list that
/// scrolls when it is long.
class _PlacementPickerSheet extends StatelessWidget {
  const _PlacementPickerSheet({
    required this.title,
    required this.children,
    this.top,
  });

  final String title;
  final List<Widget> children;
  final Widget? top;

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    return DefaultTextStyle.merge(
      style: _plFormFont,
      child: Padding(
        padding: EdgeInsets.only(bottom: media.viewInsets.bottom),
        child: SafeArea(
          top: false,
          child: ConstrainedBox(
            constraints: BoxConstraints(maxHeight: media.size.height * 0.8),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(0, 12, 0, 4),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Center(
                    child: Container(
                      width: 40,
                      height: 4,
                      decoration: BoxDecoration(
                        color: const Color(0xFFD1D5DB),
                        borderRadius: BorderRadius.circular(99),
                      ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 14, 20, 6),
                    child: Text(
                      title,
                      style: const TextStyle(
                        color: Color(0xFF222222),
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.2,
                      ),
                    ),
                  ),
                  if (top case final top?)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
                      child: top,
                    ),
                  Flexible(
                    child: ListView(shrinkWrap: true, children: children),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// One row of a [_PlacementPickerSheet], as [_LeavePickerSheet] draws it:
/// the choice in bold when it is the current one, a grey note on the right.
class _PlacementPickerRow extends StatelessWidget {
  const _PlacementPickerRow({
    required this.title,
    required this.onTap,
    this.subtitle = '',
    this.trailing = '',
    this.selected = false,
    this.last = false,
  });

  final String title;
  final String subtitle;
  final String trailing;
  final bool selected;
  final bool last;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: TextStyle(
                          color: const Color(0xFF222222),
                          fontSize: 16,
                          fontWeight: selected
                              ? FontWeight.w700
                              : FontWeight.w400,
                        ),
                      ),
                      if (subtitle.isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(
                          subtitle,
                          style: const TextStyle(
                            color: Color(0xFF9CA3AF),
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                if (trailing.isNotEmpty) ...[
                  const SizedBox(width: 12),
                  Text(
                    trailing,
                    style: const TextStyle(
                      color: Color(0xFF6B7280),
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
                if (selected) ...[
                  const SizedBox(width: 8),
                  const Icon(
                    Icons.check_rounded,
                    size: 20,
                    color: Color(0xFF0571A6),
                  ),
                ],
              ],
            ),
          ),
        ),
        if (!last) const Divider(height: 1, color: Color(0xFFEBEBEB)),
      ],
    );
  }
}

/// Every client of the company, with a search: a candidate can be put
/// forward to a colleague's client too.
class _ClientPicker extends StatefulWidget {
  const _ClientPicker({required this.api, this.selectedId});

  final PlacementsApiService api;
  final String? selectedId;

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
    setState(() => _error = null);
    try {
      final clients = await widget.api.fetchClients();
      if (mounted) setState(() => _clients = clients);
    } catch (error) {
      if (mounted) setState(() => _error = placementsErrorText(error));
    }
  }

  Widget _note(String text, {VoidCallback? onRetry}) => Padding(
    padding: const EdgeInsets.fromLTRB(20, 20, 20, 20),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          text,
          textAlign: TextAlign.center,
          style: const TextStyle(color: Color(0xFF6B7280), fontSize: 13),
        ),
        if (onRetry != null)
          TextButton(
            onPressed: onRetry,
            style: TextButton.styleFrom(
              foregroundColor: const Color(0xFF0571A6),
            ),
            child: const Text('Try again'),
          ),
      ],
    ),
  );

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
    return _PlacementPickerSheet(
      title: 'Select client',
      top: _FormTextField(
        key: const ValueKey('placement-client-search'),
        controller: _search,
        hintText: 'Search company or location',
      ),
      children: [
        if (_clients == null && _error == null)
          const Padding(
            padding: EdgeInsets.all(24),
            child: Center(
              child: SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: Color(0xFF0571A6),
                ),
              ),
            ),
          )
        else if (_clients == null)
          _note(_error ?? 'Could not load the clients.', onRetry: _load)
        else if (clients.isEmpty)
          _note('No clients found. Add the company under My clients first.')
        else
          for (final c in clients)
            _PlacementPickerRow(
              title: c.name,
              subtitle: c.city,
              trailing:
                  '${c.designations.length} '
                  '${c.designations.length == 1 ? 'role' : 'roles'}',
              selected: c.id == widget.selectedId,
              last: c == clients.last,
              onTap: () => Navigator.of(context).pop(c),
            ),
      ],
    );
  }
}
