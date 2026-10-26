part of 'quick_actions_screen.dart';

/// Actions › Placements, for a recruitment company (`features.placements`):
/// the clients it hires for, the customers (candidates) it places, and the
/// placements between them. Built from the Leave screens' pieces — the same
/// header, cards, fields and pickers — so it reads as one more action.
///
/// Its pages live here rather than in the Actions screen's own list: they
/// share their data with each other and with nothing else. The Actions
/// screen hands Back to [_PlacementsScreenState.back] first.
enum _PlacementsPage {
  hub,
  detail,
  addPlacement,
  addClient,
  addCustomer,
  saved,
}

class PlacementsScreen extends StatefulWidget {
  const PlacementsScreen({
    super.key,
    required this.api,
    required this.onClose,
    required this.profileAction,
    required this.onNotifications,
    required this.onQuickCreate,
  });

  final PlacementsApiService api;

  /// Leaves Placements for the Actions home.
  final VoidCallback onClose;
  final Widget profileAction;
  final VoidCallback onNotifications;
  final VoidCallback onQuickCreate;

  @override
  State<PlacementsScreen> createState() => _PlacementsScreenState();
}

/// How many placements the hub lists; the dashboard has the rest.
const _recentPlacementsShown = 20;

const _placementsIcon = 'assets/icons/placements_briefcase.png';
const _clientsIcon = 'assets/icons/placements_client_building.png';
const _customersIcon = 'assets/icons/filter_team.png';

class _PlacementsScreenState extends State<PlacementsScreen> {
  _PlacementsPage _page = _PlacementsPage.hub;

  // The hub's two parts load on their own, so one failing leaves the other.
  PlacementsSummary? _summary;
  String? _summaryError;
  bool _summaryLoading = false;
  List<Placement>? _placements;
  String? _placementsError;
  bool _placementsLoading = false;

  /// The placement open on the detail page, and the status picked for it.
  Placement? _open;
  PlacementStatus? _pickedStatus;

  /// What the saved page shows.
  RequestSummary? _saved;

  /// A client or customer form opened from the placement form's "Add new":
  /// saving it goes back there with the new one chosen.
  bool _addingForPlacement = false;

  bool _submitting = false;

  /// What the server said when it refused the form, until a field changes.
  String? _serverError;

  final _clientName = TextEditingController();
  final _clientContact = TextEditingController();
  final _clientPhone = TextEditingController();
  final _clientEmail = TextEditingController();
  final _clientIndustry = TextEditingController();
  final _clientCity = TextEditingController();
  final _clientNotes = TextEditingController();

  final _customerName = TextEditingController();
  final _customerPhone = TextEditingController();
  final _customerEmail = TextEditingController();
  final _customerRole = TextEditingController();
  final _customerExperience = TextEditingController();
  final _customerSkill = TextEditingController();
  final _customerCity = TextEditingController();
  final _customerNotes = TextEditingController();
  final List<String> _customerSkills = [];

  PlacementCustomer? _placementCustomer;
  PlacementClient? _placementClient;
  final _position = TextEditingController();
  PlacementStatus _placementStatus = PlacementStatus.shortlisted;
  DateTime? _interviewDate;
  DateTime? _joiningDate;
  final _ctc = TextEditingController();
  final _fee = TextEditingController();
  final _placementNotes = TextEditingController();

  late final List<TextEditingController> _fields = [
    _clientName,
    _clientContact,
    _clientPhone,
    _clientEmail,
    _clientIndustry,
    _clientCity,
    _clientNotes,
    _customerName,
    _customerPhone,
    _customerEmail,
    _customerRole,
    _customerExperience,
    _customerCity,
    _customerNotes,
    _position,
    _ctc,
    _fee,
    _placementNotes,
  ];

  @override
  void initState() {
    super.initState();
    // The Add buttons follow the form, so typing has to rebuild them.
    for (final field in _fields) {
      field.addListener(_onFieldChanged);
    }
    unawaited(_loadHub());
  }

  @override
  void dispose() {
    for (final field in _fields) {
      field
        ..removeListener(_onFieldChanged)
        ..dispose();
    }
    _customerSkill.dispose();
    super.dispose();
  }

  void _onFieldChanged() {
    if (!mounted) return;
    setState(() => _serverError = null);
  }

  /// Back within Placements. False on the hub, where Back leaves it.
  bool back() {
    if (_page == _PlacementsPage.hub) return false;
    _go(switch (_page) {
      _PlacementsPage.addClient || _PlacementsPage.addCustomer
          when _addingForPlacement =>
        _PlacementsPage.addPlacement,
      _ => _PlacementsPage.hub,
    });
    return true;
  }

  void _go(_PlacementsPage page) {
    final toHub = page == _PlacementsPage.hub && _page != _PlacementsPage.hub;
    setState(() {
      _page = page;
      _serverError = null;
      if (page != _PlacementsPage.addClient &&
          page != _PlacementsPage.addCustomer) {
        _addingForPlacement = false;
      }
    });
    // Back on the hub after a change: read it again, as the dashboard
    // would show it.
    if (toHub) unawaited(_loadHub());
  }

  Future<void> _loadHub() => Future.wait([_loadSummary(), _loadPlacements()]);

  Future<void> _loadSummary() async {
    if (_summaryLoading) return;
    setState(() => _summaryLoading = true);
    try {
      final summary = await widget.api.fetchSummary();
      if (!mounted) return;
      setState(() {
        _summary = summary;
        _summaryError = null;
      });
    } catch (error) {
      if (!mounted) return;
      // Whatever was shown stays; the line only stands in for nothing.
      setState(() => _summaryError = placementsErrorText(error));
    } finally {
      if (mounted) setState(() => _summaryLoading = false);
    }
  }

  Future<void> _loadPlacements() async {
    if (_placementsLoading) return;
    setState(() => _placementsLoading = true);
    try {
      final placements = await widget.api.fetchMyPlacements();
      if (!mounted) return;
      setState(() {
        _placements = placements;
        _placementsError = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _placementsError = placementsErrorText(error));
    } finally {
      if (mounted) setState(() => _placementsLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return switch (_page) {
      _PlacementsPage.hub => _hub(),
      _PlacementsPage.detail => _detail(),
      _PlacementsPage.addPlacement => _placementForm(),
      _PlacementsPage.addClient => _clientForm(),
      _PlacementsPage.addCustomer => _customerForm(),
      _PlacementsPage.saved => _savedPage(),
    };
  }

  // ---------------------------------------------------------------- hub

  Widget _hub() {
    return _HubScaffold(
      key: const ValueKey('placements-hub'),
      title: 'Placements',
      onBack: widget.onClose,
      profileAction: widget.profileAction,
      onNotifications: widget.onNotifications,
      onQuickCreate: widget.onQuickCreate,
      trailing: _LeaveHeaderButton(
        label: 'Add Placement',
        onTap: _openPlacementForm,
      ),
      backgroundColor: const Color(0xFFF7F7F9),
      children: [
        const _HomeSectionLabel('Summary'),
        const SizedBox(height: 12),
        _summarySection(),
        const SizedBox(height: 16),
        const _HomeSectionLabel('Add New'),
        const SizedBox(height: 12),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: _PlacementsAddTile(
                key: const ValueKey('placements-add-placement'),
                iconAsset: _placementsIcon,
                label: 'Placement',
                onTap: _openPlacementForm,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _PlacementsAddTile(
                key: const ValueKey('placements-add-client'),
                iconAsset: _clientsIcon,
                label: 'Client',
                onTap: () => _openClientForm(),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _PlacementsAddTile(
                key: const ValueKey('placements-add-customer'),
                iconAsset: _customersIcon,
                iconSize: 26,
                label: 'Customer',
                onTap: () => _openCustomerForm(),
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        const _HomeSectionLabel('Your Recent Placements'),
        const SizedBox(height: 12),
        ..._recentSection(),
      ],
    );
  }

  Widget _summarySection() {
    final summary = _summary;
    if (summary == null) {
      if (_summaryError case final error? when !_summaryLoading) {
        return _PlacementsSectionError(
          key: const ValueKey('placements-summary-error'),
          what: 'The summary',
          message: error,
          onRetry: _loadSummary,
        );
      }
      return const _PlacementsSectionLoading(height: 150);
    }
    return Column(
      children: [
        _PlacementStatusCard(summary: summary),
        const SizedBox(height: 12),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: _LeaveFigureCard(
                iconAsset: _clientsIcon,
                label: 'Clients',
                value: '${summary.clients}',
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _LeaveFigureCard(
                iconAsset: _customersIcon,
                iconSize: 26,
                label: 'Customers',
                value: '${summary.customers}',
              ),
            ),
          ],
        ),
      ],
    );
  }

  List<Widget> _recentSection() {
    final placements = _placements;
    if (placements == null) {
      if (_placementsError case final error? when !_placementsLoading) {
        return [
          _PlacementsSectionError(
            key: const ValueKey('placements-list-error'),
            what: 'Your placements',
            message: error,
            onRetry: _loadPlacements,
          ),
        ];
      }
      return const [_PlacementsSectionLoading(height: 96)];
    }
    if (placements.isEmpty) {
      return [
        _HubEmptyState(
          iconAsset: _placementsIcon,
          text: 'No placements yet.\nAdd one to start tracking it',
          buttonLabel: 'Add Placement',
          onTap: _openPlacementForm,
        ),
      ];
    }
    return [
      for (final placement in placements.take(_recentPlacementsShown))
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: _PlacementCard(
            placement: placement,
            onTap: () => _openDetail(placement),
          ),
        ),
    ];
  }

  // ------------------------------------------------------------- detail

  void _openDetail(Placement placement) {
    setState(() {
      _open = placement;
      _pickedStatus = null;
    });
    _go(_PlacementsPage.detail);
  }

  Widget _detail() {
    final placement = _open;
    if (placement == null) return const SizedBox.shrink();
    final picked = _pickedStatus ?? placement.status;
    return _HubScaffold(
      key: const ValueKey('placement-detail'),
      title: 'Placement',
      onBack: back,
      profileAction: widget.profileAction,
      onNotifications: widget.onNotifications,
      onQuickCreate: widget.onQuickCreate,
      footer: _PlacementsFormFooter(
        problem: _serverError,
        label: 'Update Status',
        enabled: picked != placement.status && !_submitting,
        busy: _submitting,
        onTap: _updateStatus,
      ),
      backgroundColor: const Color(0xFFF7F7F9),
      children: [
        _FormCard(
          children: [
            _LeaveFieldLabel('Status'),
            _LeaveDropdownField(
              key: const ValueKey('placement-status-field'),
              value: picked.label,
              filled: true,
              onTap: _pickDetailStatus,
            ),
          ],
        ),
        const SizedBox(height: 12),
        _FormCard(
          children: [
            RequestSummaryBody(
              summary: _placementSummary(placement, success: false),
              showSuccess: false,
            ),
          ],
        ),
      ],
    );
  }

  Future<void> _pickDetailStatus() async {
    final placement = _open;
    if (placement == null) return;
    final picked = await _pickStatus(_pickedStatus ?? placement.status);
    if (picked == null || !mounted) return;
    setState(() {
      _pickedStatus = picked;
      _serverError = null;
    });
  }

  Future<void> _updateStatus() async {
    final placement = _open;
    final status = _pickedStatus;
    if (_submitting || placement == null || status == null) return;
    setState(() {
      _submitting = true;
      _serverError = null;
    });
    try {
      final updated = await widget.api.updatePlacement(
        placement.id,
        status: status,
      );
      if (!mounted) return;
      setState(() {
        // An answer without the placement in it still changed the status.
        _open = updated.id.isEmpty ? placement : updated;
        _pickedStatus = null;
        _placements = [
          for (final item in _placements ?? const <Placement>[])
            item.id == placement.id ? _open! : item,
        ];
      });
      showAppToast(context, 'Status changed to ${status.label}');
      unawaited(_loadSummary());
    } catch (error) {
      if (!mounted) return;
      setState(() => _serverError = placementsErrorText(error));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  // --------------------------------------------------------- saved page

  void _showSaved(RequestSummary summary) {
    setState(() => _saved = summary);
    _go(_PlacementsPage.saved);
  }

  Widget _savedPage() {
    final summary = _saved;
    if (summary == null) return const SizedBox.shrink();
    return _HubScaffold(
      key: const ValueKey('placements-saved'),
      title: summary.screenTitle,
      onBack: back,
      closeIcon: true,
      profileAction: widget.profileAction,
      onNotifications: widget.onNotifications,
      onQuickCreate: widget.onQuickCreate,
      backgroundColor: const Color(0xFFF7F7F9),
      children: [RequestSummaryBody(summary: summary, showSuccess: true)],
    );
  }

  RequestSummary _placementSummary(
    Placement placement, {
    required bool success,
  }) {
    return RequestSummary(
      screenTitle: 'Placement',
      successTitle: 'Placement Added',
      successBody: 'Saved to your placements, and on the dashboard',
      rows: [
        SummaryRow('Customer', placement.customerName),
        SummaryRow('Client', placement.clientName),
        SummaryRow('Position', placement.position),
        SummaryRow('Status', placement.status.label),
        if (placement.interviewDate case final day?)
          SummaryRow('Interview Date', _placementDate(day)),
        if (placement.joiningDate case final day?)
          SummaryRow('Joining Date', _placementDate(day)),
        if (placement.ctcRupees case final ctc?) SummaryRow('CTC', _money(ctc)),
        if (placement.feeRupees case final fee?) SummaryRow('Fee', _money(fee)),
        if (!success && placement.createdAt != null)
          SummaryRow('Added On', _placementDate(placement.createdAt!)),
        if (placement.notes.isNotEmpty) SummaryRow('Notes', placement.notes),
      ],
    );
  }

  // ----------------------------------------------------- placement form

  void _openPlacementForm() {
    setState(() {
      _placementCustomer = null;
      _placementClient = null;
      _position.clear();
      _placementStatus = PlacementStatus.shortlisted;
      _interviewDate = null;
      _joiningDate = null;
      _ctc.clear();
      _fee.clear();
      _placementNotes.clear();
    });
    _go(_PlacementsPage.addPlacement);
  }

  bool get _placementComplete =>
      _placementCustomer != null &&
      _placementClient != null &&
      _position.text.trim().isNotEmpty;

  /// Why the placement cannot be added as it stands; null once it can.
  String? get _placementProblem {
    final interview = _interviewDate;
    final joining = _joiningDate;
    return _rupeesProblem(_ctc.text, 'CTC') ??
        _rupeesProblem(_fee.text, 'fee') ??
        (interview != null && joining != null && joining.isBefore(interview)
            ? 'The joining date can\'t be before the interview date.'
            : null);
  }

  Widget _placementForm() {
    final problem = _serverError ?? _placementProblem;
    return _HubScaffold(
      key: const ValueKey('placement-form'),
      title: 'Add Placement',
      onBack: back,
      profileAction: widget.profileAction,
      onNotifications: widget.onNotifications,
      onQuickCreate: widget.onQuickCreate,
      footer: _PlacementsFormFooter(
        problem: problem,
        label: 'Add Placement',
        enabled:
            _placementComplete && _placementProblem == null && !_submitting,
        busy: _submitting,
        onTap: _submitPlacement,
      ),
      backgroundColor: const Color(0xFFF7F7F9),
      children: [
        _FormCard(
          children: [
            _LeaveFieldLabel('Customer'),
            _LeaveDropdownField(
              key: const ValueKey('placement-customer-field'),
              value: _placementCustomer?.name ?? 'Select customer',
              filled: _placementCustomer != null,
              onTap: _pickCustomer,
            ),
            const SizedBox(height: 16),
            _LeaveFieldLabel('Client'),
            _LeaveDropdownField(
              key: const ValueKey('placement-client-field'),
              value: _placementClient?.name ?? 'Select client',
              filled: _placementClient != null,
              onTap: _pickClient,
            ),
            const SizedBox(height: 16),
            _LeaveFieldLabel('Position'),
            _FormTextField(
              key: const ValueKey('placement-position'),
              controller: _position,
              hintText: 'e.g. Sales Manager',
            ),
            const SizedBox(height: 16),
            _LeaveFieldLabel('Status'),
            _LeaveDropdownField(
              value: _placementStatus.label,
              filled: true,
              onTap: () async {
                final picked = await _pickStatus(_placementStatus);
                if (picked != null && mounted) {
                  setState(() => _placementStatus = picked);
                }
              },
            ),
            const SizedBox(height: 16),
            _LeaveFieldLabel('Interview Date (Optional)'),
            _LeaveDropdownField(
              value: _interviewDate == null
                  ? 'Select date'
                  : _placementDate(_interviewDate!),
              filled: _interviewDate != null,
              onTap: () => _pickPlacementDate(interview: true),
            ),
            const SizedBox(height: 16),
            _LeaveFieldLabel('Joining Date (Optional)'),
            _LeaveDropdownField(
              value: _joiningDate == null
                  ? 'Select date'
                  : _placementDate(_joiningDate!),
              filled: _joiningDate != null,
              onTap: () => _pickPlacementDate(interview: false),
            ),
            const SizedBox(height: 16),
            _LeaveFieldLabel('CTC ₹ (Optional)'),
            _FormTextField(
              key: const ValueKey('placement-ctc'),
              controller: _ctc,
              hintText: 'Yearly, e.g. 600000',
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
            ),
            const SizedBox(height: 16),
            _LeaveFieldLabel('Fee ₹ (Optional)'),
            _FormTextField(
              key: const ValueKey('placement-fee'),
              controller: _fee,
              hintText: 'e.g. 50000',
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
            ),
            const SizedBox(height: 16),
            _LeaveFieldLabel('Notes (Optional)'),
            _FormTextArea(
              controller: _placementNotes,
              hintText: 'Add a note...',
            ),
          ],
        ),
      ],
    );
  }

  Future<void> _pickCustomer() async {
    final result =
        await showModalBottomSheet<_SearchSheetResult<PlacementCustomer>>(
          context: context,
          isScrollControlled: true,
          backgroundColor: Colors.white,
          shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          builder: (sheetContext) => _PlacementsSearchSheet<PlacementCustomer>(
            hintText: 'Search customers',
            addLabel: 'Add new customer',
            emptyText: 'No customers yet.',
            search: (query) => widget.api.fetchCustomers(query: query),
            idOf: (customer) => customer.id,
            nameOf: (customer) => customer.name,
            subtitleOf: (customer) => customer.subtitle,
            selectedId: _placementCustomer?.id,
          ),
        );
    if (result == null || !mounted) return;
    if (result.addNew) {
      _openCustomerForm(forPlacement: true);
    } else if (result.item case final customer?) {
      setState(() => _placementCustomer = customer);
    }
  }

  Future<void> _pickClient() async {
    final result =
        await showModalBottomSheet<_SearchSheetResult<PlacementClient>>(
          context: context,
          isScrollControlled: true,
          backgroundColor: Colors.white,
          shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          builder: (sheetContext) => _PlacementsSearchSheet<PlacementClient>(
            hintText: 'Search clients',
            addLabel: 'Add new client',
            emptyText: 'No clients yet.',
            search: (query) => widget.api.fetchClients(query: query),
            idOf: (client) => client.id,
            nameOf: (client) => client.name,
            subtitleOf: (client) => client.subtitle,
            selectedId: _placementClient?.id,
          ),
        );
    if (result == null || !mounted) return;
    if (result.addNew) {
      _openClientForm(forPlacement: true);
    } else if (result.item case final client?) {
      setState(() => _placementClient = client);
    }
  }

  Future<PlacementStatus?> _pickStatus(PlacementStatus selected) async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) => _LeavePickerSheet(
        options: [for (final status in PlacementStatus.values) status.label],
        selected: selected.label,
      ),
    );
    if (picked == null) return null;
    return PlacementStatus.values.firstWhere(
      (status) => status.label == picked,
      orElse: () => selected,
    );
  }

  Future<void> _pickPlacementDate({required bool interview}) async {
    final today = _dateOnly(DateTime.now());
    // A year back, for one being written up late, and two ahead, for a
    // joining date fixed well in advance.
    final first = DateTime(today.year - 1, today.month, today.day);
    final last = DateTime(today.year + 2, today.month, today.day);
    final current =
        (interview ? _interviewDate : _joiningDate) ??
        (interview ? null : _interviewDate) ??
        today;
    final initial = current.isBefore(first)
        ? first
        : current.isAfter(last)
        ? last
        : current;
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: first,
      lastDate: last,
      builder: _pickerTheme,
    );
    if (picked == null || !mounted) return;
    setState(() {
      _serverError = null;
      if (interview) {
        _interviewDate = _dateOnly(picked);
      } else {
        _joiningDate = _dateOnly(picked);
      }
    });
  }

  Future<void> _submitPlacement() async {
    // One tap adds one placement: a second while the first is in flight
    // would add it twice.
    if (_submitting || !_placementComplete || _placementProblem != null) return;
    setState(() {
      _submitting = true;
      _serverError = null;
    });
    try {
      final customer = _placementCustomer!;
      final client = _placementClient!;
      final created = await widget.api.createPlacement(
        customerId: customer.id,
        clientId: client.id,
        position: _position.text.trim(),
        status: _placementStatus,
        interviewDate: _interviewDate,
        joiningDate: _joiningDate,
        ctcRupees: _rupees(_ctc.text),
        feeRupees: _rupees(_fee.text),
        notes: _placementNotes.text.trim(),
      );
      if (!mounted) return;
      // The summary shows what was sent, with the names as they were picked
      // should the server's answer leave any out.
      final shown = Placement(
        id: created.id,
        customerId: customer.id,
        customerName: created.customerName.isEmpty
            ? customer.name
            : created.customerName,
        clientId: client.id,
        clientName: created.clientName.isEmpty
            ? client.name
            : created.clientName,
        position: created.position.isEmpty
            ? _position.text.trim()
            : created.position,
        status: _placementStatus,
        interviewDate: _interviewDate,
        joiningDate: _joiningDate,
        ctcRupees: _rupees(_ctc.text),
        feeRupees: _rupees(_fee.text),
        notes: _placementNotes.text.trim(),
      );
      _showSaved(_placementSummary(shown, success: true));
    } catch (error) {
      if (!mounted) return;
      setState(() => _serverError = placementsErrorText(error));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  // -------------------------------------------------------- client form

  void _openClientForm({bool forPlacement = false}) {
    for (final field in [
      _clientName,
      _clientContact,
      _clientPhone,
      _clientEmail,
      _clientIndustry,
      _clientCity,
      _clientNotes,
    ]) {
      field.clear();
    }
    _go(_PlacementsPage.addClient);
    setState(() => _addingForPlacement = forPlacement);
  }

  String? get _clientProblem =>
      _phoneProblem(_clientPhone.text) ?? _emailProblem(_clientEmail.text);

  Widget _clientForm() {
    final problem = _serverError ?? _clientProblem;
    return _HubScaffold(
      key: const ValueKey('client-form'),
      title: 'Add Client',
      onBack: back,
      profileAction: widget.profileAction,
      onNotifications: widget.onNotifications,
      onQuickCreate: widget.onQuickCreate,
      footer: _PlacementsFormFooter(
        problem: problem,
        label: 'Add Client',
        enabled:
            _clientName.text.trim().isNotEmpty &&
            _clientProblem == null &&
            !_submitting,
        busy: _submitting,
        onTap: _submitClient,
      ),
      backgroundColor: const Color(0xFFF7F7F9),
      children: [
        _FormCard(
          children: [
            _LeaveFieldLabel('Company Name'),
            _FormTextField(
              key: const ValueKey('client-name'),
              controller: _clientName,
              hintText: 'e.g. Acme Industries',
            ),
            const SizedBox(height: 16),
            _LeaveFieldLabel('Contact Name (Optional)'),
            _FormTextField(
              controller: _clientContact,
              hintText: 'Who you deal with there',
            ),
            const SizedBox(height: 16),
            _LeaveFieldLabel('Phone (Optional)'),
            _FormTextField(
              key: const ValueKey('client-phone'),
              controller: _clientPhone,
              hintText: 'e.g. 98765 43210',
              keyboardType: TextInputType.phone,
            ),
            const SizedBox(height: 16),
            _LeaveFieldLabel('Email (Optional)'),
            _FormTextField(
              key: const ValueKey('client-email'),
              controller: _clientEmail,
              hintText: 'name@company.com',
              keyboardType: TextInputType.emailAddress,
            ),
            const SizedBox(height: 16),
            _LeaveFieldLabel('Industry (Optional)'),
            _FormTextField(
              controller: _clientIndustry,
              hintText: 'e.g. Manufacturing',
            ),
            const SizedBox(height: 16),
            _LeaveFieldLabel('City (Optional)'),
            _FormTextField(controller: _clientCity, hintText: 'e.g. Pune'),
            const SizedBox(height: 16),
            _LeaveFieldLabel('Notes (Optional)'),
            _FormTextArea(controller: _clientNotes, hintText: 'Add a note...'),
          ],
        ),
      ],
    );
  }

  Future<void> _submitClient() async {
    if (_submitting ||
        _clientName.text.trim().isEmpty ||
        _clientProblem != null) {
      return;
    }
    setState(() {
      _submitting = true;
      _serverError = null;
    });
    try {
      final sent = PlacementClient(
        id: '',
        name: _clientName.text.trim(),
        contactName: _clientContact.text.trim(),
        phone: _clientPhone.text.trim(),
        email: _clientEmail.text.trim(),
        industry: _clientIndustry.text.trim(),
        city: _clientCity.text.trim(),
        notes: _clientNotes.text.trim(),
      );
      final created = await widget.api.createClient(
        name: sent.name,
        contactName: sent.contactName,
        phone: sent.phone,
        email: sent.email,
        industry: sent.industry,
        city: sent.city,
        notes: sent.notes,
      );
      if (!mounted) return;
      final client = created.name.isEmpty
          ? PlacementClient(
              id: created.id,
              name: sent.name,
              contactName: sent.contactName,
              phone: sent.phone,
              email: sent.email,
              industry: sent.industry,
              city: sent.city,
              notes: sent.notes,
            )
          : created;
      if (_addingForPlacement) {
        setState(() => _placementClient = client);
        _go(_PlacementsPage.addPlacement);
        showAppToast(context, 'Client added');
        return;
      }
      _showSaved(
        RequestSummary(
          screenTitle: 'Client',
          successTitle: 'Client Added',
          successBody: 'Saved to your clients, and on the dashboard',
          rows: [
            SummaryRow('Company Name', client.name),
            if (client.contactName.isNotEmpty)
              SummaryRow('Contact Name', client.contactName),
            if (client.phone.isNotEmpty) SummaryRow('Phone', client.phone),
            if (client.email.isNotEmpty) SummaryRow('Email', client.email),
            if (client.industry.isNotEmpty)
              SummaryRow('Industry', client.industry),
            if (client.city.isNotEmpty) SummaryRow('City', client.city),
            if (client.notes.isNotEmpty) SummaryRow('Notes', client.notes),
          ],
        ),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _serverError = placementsErrorText(error));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  // ------------------------------------------------------ customer form

  void _openCustomerForm({bool forPlacement = false}) {
    for (final field in [
      _customerName,
      _customerPhone,
      _customerEmail,
      _customerRole,
      _customerExperience,
      _customerSkill,
      _customerCity,
      _customerNotes,
    ]) {
      field.clear();
    }
    _customerSkills.clear();
    _go(_PlacementsPage.addCustomer);
    setState(() => _addingForPlacement = forPlacement);
  }

  bool get _customerComplete =>
      _customerName.text.trim().isNotEmpty &&
      _customerPhone.text.trim().isNotEmpty;

  String? get _customerProblem =>
      _phoneProblem(_customerPhone.text) ??
      _emailProblem(_customerEmail.text) ??
      _experienceProblem(_customerExperience.text);

  /// Takes what is typed in the skill box as chips; commas split it.
  void _addSkills() {
    final typed = _customerSkill.text
        .split(',')
        .map((skill) => skill.trim())
        .where((skill) => skill.isNotEmpty);
    setState(() {
      for (final skill in typed) {
        final known = _customerSkills.any(
          (held) => held.toLowerCase() == skill.toLowerCase(),
        );
        if (!known) _customerSkills.add(skill);
      }
      _customerSkill.clear();
    });
  }

  Widget _customerForm() {
    final problem = _serverError ?? _customerProblem;
    return _HubScaffold(
      key: const ValueKey('customer-form'),
      title: 'Add Customer',
      onBack: back,
      profileAction: widget.profileAction,
      onNotifications: widget.onNotifications,
      onQuickCreate: widget.onQuickCreate,
      footer: _PlacementsFormFooter(
        problem: problem,
        label: 'Add Customer',
        enabled: _customerComplete && _customerProblem == null && !_submitting,
        busy: _submitting,
        onTap: _submitCustomer,
      ),
      backgroundColor: const Color(0xFFF7F7F9),
      children: [
        _FormCard(
          children: [
            _LeaveFieldLabel('Name'),
            _FormTextField(
              key: const ValueKey('customer-name'),
              controller: _customerName,
              hintText: 'Candidate\'s full name',
            ),
            const SizedBox(height: 16),
            _LeaveFieldLabel('Phone'),
            _FormTextField(
              key: const ValueKey('customer-phone'),
              controller: _customerPhone,
              hintText: 'e.g. 98765 43210',
              keyboardType: TextInputType.phone,
            ),
            const SizedBox(height: 16),
            _LeaveFieldLabel('Email (Optional)'),
            _FormTextField(
              key: const ValueKey('customer-email'),
              controller: _customerEmail,
              hintText: 'name@example.com',
              keyboardType: TextInputType.emailAddress,
            ),
            const SizedBox(height: 16),
            _LeaveFieldLabel('Current Role (Optional)'),
            _FormTextField(
              controller: _customerRole,
              hintText: 'e.g. Accountant',
            ),
            const SizedBox(height: 16),
            _LeaveFieldLabel('Years of Experience (Optional)'),
            _FormTextField(
              key: const ValueKey('customer-experience'),
              controller: _customerExperience,
              hintText: 'e.g. 3',
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
            ),
            const SizedBox(height: 16),
            _LeaveFieldLabel('Skills (Optional)'),
            Row(
              children: [
                Expanded(
                  child: _FormTextField(
                    key: const ValueKey('customer-skill'),
                    controller: _customerSkill,
                    hintText: 'e.g. Tally, Excel',
                  ),
                ),
                const SizedBox(width: 8),
                _LeaveHeaderButton(
                  key: const ValueKey('customer-skill-add'),
                  label: 'Add',
                  onTap: _addSkills,
                ),
              ],
            ),
            if (_customerSkills.isNotEmpty) ...[
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final skill in _customerSkills)
                    _SkillChip(
                      label: skill,
                      onRemove: () =>
                          setState(() => _customerSkills.remove(skill)),
                    ),
                ],
              ),
            ],
            const SizedBox(height: 16),
            _LeaveFieldLabel('City (Optional)'),
            _FormTextField(controller: _customerCity, hintText: 'e.g. Pune'),
            const SizedBox(height: 16),
            _LeaveFieldLabel('Notes (Optional)'),
            _FormTextArea(
              controller: _customerNotes,
              hintText: 'Add a note...',
            ),
          ],
        ),
      ],
    );
  }

  Future<void> _submitCustomer() async {
    if (_submitting || !_customerComplete || _customerProblem != null) return;
    // A skill typed but not added yet goes with the rest.
    if (_customerSkill.text.trim().isNotEmpty) _addSkills();
    setState(() {
      _submitting = true;
      _serverError = null;
    });
    try {
      final sent = PlacementCustomer(
        id: '',
        name: _customerName.text.trim(),
        phone: _customerPhone.text.trim(),
        email: _customerEmail.text.trim(),
        currentRole: _customerRole.text.trim(),
        experienceYears: double.tryParse(_customerExperience.text.trim()),
        skills: List.of(_customerSkills),
        city: _customerCity.text.trim(),
        notes: _customerNotes.text.trim(),
      );
      final created = await widget.api.createCustomer(
        name: sent.name,
        phone: sent.phone,
        email: sent.email,
        currentRole: sent.currentRole,
        experienceYears: sent.experienceYears,
        skills: sent.skills,
        city: sent.city,
        notes: sent.notes,
      );
      if (!mounted) return;
      final customer = created.name.isEmpty
          ? PlacementCustomer(
              id: created.id,
              name: sent.name,
              phone: sent.phone,
              email: sent.email,
              currentRole: sent.currentRole,
              experienceYears: sent.experienceYears,
              skills: sent.skills,
              city: sent.city,
              notes: sent.notes,
            )
          : created;
      if (_addingForPlacement) {
        setState(() => _placementCustomer = customer);
        _go(_PlacementsPage.addPlacement);
        showAppToast(context, 'Customer added');
        return;
      }
      _showSaved(
        RequestSummary(
          screenTitle: 'Customer',
          successTitle: 'Customer Added',
          successBody: 'Saved to your customers, and on the dashboard',
          rows: [
            SummaryRow('Name', customer.name),
            SummaryRow('Phone', customer.phone),
            if (customer.email.isNotEmpty) SummaryRow('Email', customer.email),
            if (customer.currentRole.isNotEmpty)
              SummaryRow('Current Role', customer.currentRole),
            if (customer.experienceYears case final years?)
              SummaryRow(
                'Experience',
                '${formatDays(years)} year${years == 1 ? '' : 's'}',
              ),
            if (customer.skills.isNotEmpty)
              SummaryRow('Skills', customer.skills.join(', ')),
            if (customer.city.isNotEmpty) SummaryRow('City', customer.city),
            if (customer.notes.isNotEmpty) SummaryRow('Notes', customer.notes),
          ],
        ),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _serverError = placementsErrorText(error));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }
}

// ----------------------------------------------------------- validation

final _emailPattern = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');

String? _emailProblem(String value) {
  final email = value.trim();
  if (email.isEmpty || _emailPattern.hasMatch(email)) return null;
  return 'Enter a valid email address.';
}

/// Ten digits at least, with a + and a country code allowed in front and
/// spaces or dashes anywhere, as people write them.
String? _phoneProblem(String value) {
  final phone = value.trim();
  if (phone.isEmpty) return null;
  final digits = phone.replaceAll(RegExp(r'[\s\-()]'), '');
  if (RegExp(r'^\+?\d{10,13}$').hasMatch(digits)) return null;
  return 'Enter a valid phone number, with at least 10 digits.';
}

String? _experienceProblem(String value) {
  final text = value.trim();
  if (text.isEmpty) return null;
  final years = double.tryParse(text);
  if (years != null && years >= 0 && years <= 60) return null;
  return 'Enter the years of experience as a number, like 3 or 4.5.';
}

/// Rupees as typed: digits, with commas allowed between them.
double? _rupees(String value) {
  final text = value.trim().replaceAll(',', '');
  return text.isEmpty ? null : double.tryParse(text);
}

String? _rupeesProblem(String value, String what) {
  if (value.trim().isEmpty) return null;
  final amount = _rupees(value);
  if (amount != null && amount >= 0) return null;
  return 'Enter the $what in rupees, digits only.';
}

/// "2 Nov 2026": these dates run a year either side, so the year is shown.
String _placementDate(DateTime day) => '${_short(day)} ${day.year}';

/// What a placement's card says under the rule: the next date that matters.
String _placementWhen(Placement placement) {
  final today = _dateOnly(DateTime.now());
  if (placement.joiningDate case final joining?
      when placement.status == PlacementStatus.joined ||
          placement.status == PlacementStatus.offered) {
    return joining.isAfter(today)
        ? 'Joins ${_placementDate(joining)}'
        : 'Joined ${_placementDate(joining)}';
  }
  if (placement.interviewDate case final interview?
      when placement.status != PlacementStatus.dropped) {
    return 'Interview ${_placementDate(interview)}';
  }
  if (placement.createdAt case final added?) {
    return 'Added ${_placementDate(added)}';
  }
  return placement.status.label;
}

/// The colour a status is written in, and the pill under it: blue for a
/// fresh shortlist, the app's gold and plum on the way, green once joined,
/// grey once dropped.
({Color fg, Color bg}) _placementStatusColors(PlacementStatus status) =>
    switch (status) {
      PlacementStatus.shortlisted => (
        fg: const Color(0xFF0571A6),
        bg: const Color(0xFFE0F2FE),
      ),
      PlacementStatus.interviewing => (
        fg: const Color(0xFFB7791F),
        bg: const Color(0xFFFEF3C7),
      ),
      PlacementStatus.offered => (
        fg: const Color(0xFF8A6AA0),
        bg: const Color(0xFFF3E8FF),
      ),
      PlacementStatus.joined => (
        fg: const Color(0xFF16A34A),
        bg: const Color(0xFFDCFCE7),
      ),
      PlacementStatus.dropped => (
        fg: const Color(0xFF6B7280),
        bg: const Color(0xFFF3F4F6),
      ),
    };

// -------------------------------------------------------------- widgets

/// A placement in the hub's list: the candidate over the role and client,
/// its status on a pill, and the next date under a rule.
class _PlacementCard extends StatelessWidget {
  const _PlacementCard({required this.placement, required this.onTap});

  final Placement placement;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = _placementStatusColors(placement.status);
    return _HubRequestCard(
      iconAsset: placement.status == PlacementStatus.joined
          ? 'assets/icons/placements_joined_handshake.png'
          : _placementsIcon,
      title: placement.customerName,
      date: [
        placement.position,
        placement.clientName,
      ].where((part) => part.isNotEmpty).join(' · '),
      status: placement.status.label,
      statusColor: colors.fg,
      statusTint: colors.bg,
      footerIcon: _HubRequestCard.calendarIcon,
      footerText: _placementWhen(placement),
      onTap: onTap,
    );
  }
}

/// Placements by status (in the style of the Reimbursement summary): the
/// total, one bar split by status, and each status's count under it.
class _PlacementStatusCard extends StatelessWidget {
  const _PlacementStatusCard({required this.summary});

  final PlacementsSummary summary;

  static const _caption = TextStyle(
    fontFamily: 'Sora',
    color: Color(0xFF9CA3AF),
    fontSize: 10,
    height: 15 / 10,
  );

  @override
  Widget build(BuildContext context) {
    final counted = [
      for (final status in PlacementStatus.values)
        if (summary.count(status) > 0) status,
    ];
    return _FormCard(
      children: [
        const Text(
          'PLACEMENTS',
          style: TextStyle(
            fontFamily: 'Sora',
            color: Color(0xFF9CA3AF),
            fontSize: 12,
            height: 16 / 12,
            fontWeight: FontWeight.w600,
            letterSpacing: .3,
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Padding(
                      padding: EdgeInsets.only(top: 2),
                      child: Text('Total', style: _caption),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${summary.total}',
                      style: const TextStyle(
                        fontFamily: 'Sora',
                        color: Color(0xFF111827),
                        fontSize: 14,
                        height: 20 / 14,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              const _IllustrationTile(asset: _placementsIcon),
            ],
          ),
        ),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: SizedBox(
            height: 8,
            child: counted.isEmpty
                // Nothing placed yet: an empty track.
                ? const ColoredBox(color: Color(0xFFEBEBEB))
                : Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      for (final status in counted)
                        Expanded(
                          flex: summary.count(status),
                          child: ColoredBox(
                            color: _placementStatusColors(status).fg,
                          ),
                        ),
                    ],
                  ),
          ),
        ),
        const SizedBox(height: 10),
        // Spread across the card, and onto a second line on a narrow phone
        // rather than cutting a name short.
        Wrap(
          alignment: WrapAlignment.spaceBetween,
          spacing: 12,
          runSpacing: 8,
          children: [
            for (final status in PlacementStatus.values)
              Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${summary.count(status)}',
                    style: TextStyle(
                      fontFamily: 'Sora',
                      color: _placementStatusColors(status).fg,
                      fontSize: 12,
                      height: 16.2 / 12,
                      letterSpacing: -0.16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(status.label, style: _caption),
                  ),
                ],
              ),
          ],
        ),
      ],
    );
  }
}

/// One of the hub's Add buttons, drawn as a small action card.
class _PlacementsAddTile extends StatelessWidget {
  const _PlacementsAddTile({
    super.key,
    required this.iconAsset,
    required this.label,
    required this.onTap,
    this.iconSize = 24,
  });

  final String iconAsset;
  final String label;
  final VoidCallback onTap;
  final double iconSize;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(16),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0F000000),
            blurRadius: 6,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _IllustrationTile(asset: iconAsset, size: iconSize),
                const SizedBox(height: 8),
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontFamily: 'Sora',
                    color: Color(0xFF222222),
                    fontSize: 12,
                    height: 16 / 12,
                    letterSpacing: -0.1,
                    fontWeight: FontWeight.w700,
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

/// A hub section still on its way.
class _PlacementsSectionLoading extends StatelessWidget {
  const _PlacementsSectionLoading({required this.height});

  final double height;

  @override
  Widget build(BuildContext context) {
    return _FormCard(
      children: [
        SizedBox(
          height: height - 32,
          width: double.infinity,
          child: const Center(
            child: SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: Color(0xFF0571A6),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// A hub section that could not be read: why, and a way to try again. The
/// rest of the hub carries on without it.
class _PlacementsSectionError extends StatelessWidget {
  const _PlacementsSectionError({
    super.key,
    required this.what,
    required this.message,
    required this.onRetry,
  });

  /// The section, to say what did not load when the server gave no reason.
  final String what;
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return _FormCard(
      children: [
        Text(
          // "Something went wrong. Try again." over a Try again link says it
          // twice; the section's name says more.
          message == PlacementsApiException.failed
              ? '$what didn\'t load.'
              : message,
          style: const TextStyle(
            fontFamily: 'Sora',
            color: Color(0xFF484848),
            fontSize: 12,
            height: 16.2 / 12,
            letterSpacing: -0.16,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 4),
        InkWell(
          onTap: onRetry,
          borderRadius: BorderRadius.circular(8),
          child: const Padding(
            padding: EdgeInsets.symmetric(vertical: 4),
            child: Text(
              'Try again',
              style: TextStyle(
                fontFamily: 'Sora',
                color: Color(0xFF0571A6),
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// The button under a form, with why it cannot go yet over it in the Leave
/// form's red line — down here rather than at the top, so it is in sight
/// whichever field is being typed in.
class _PlacementsFormFooter extends StatelessWidget {
  const _PlacementsFormFooter({
    required this.problem,
    required this.label,
    required this.onTap,
    required this.enabled,
    required this.busy,
  });

  final String? problem;
  final String label;
  final VoidCallback onTap;
  final bool enabled;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (problem case final problem?)
          ColoredBox(
            color: const Color(0xFFF7F7F9),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
              child: _FormProblem(problem),
            ),
          ),
        _FormSubmitBar(
          label: label,
          enabled: enabled,
          busy: busy,
          onTap: onTap,
        ),
      ],
    );
  }
}

class _FormProblem extends StatelessWidget {
  const _FormProblem(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFFEE2E2),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        text,
        style: const TextStyle(
          color: Color(0xFFB3261E),
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _SkillChip extends StatelessWidget {
  const _SkillChip({required this.label, required this.onRemove});

  final String label;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 6, 6, 6),
      decoration: BoxDecoration(
        color: const Color(0xFFDBEAFE),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label,
            style: const TextStyle(
              color: Color(0xFF2563EB),
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(width: 4),
          InkWell(
            onTap: onRemove,
            customBorder: const CircleBorder(),
            child: Semantics(
              button: true,
              label: 'Remove $label',
              child: const Padding(
                padding: EdgeInsets.all(2),
                child: Icon(
                  Icons.close_rounded,
                  size: 14,
                  color: Color(0xFF2563EB),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// What the search sheet ended on: one picked, or a new one to add.
class _SearchSheetResult<T> {
  const _SearchSheetResult.picked(T this.item) : addNew = false;
  const _SearchSheetResult.addNew() : item = null, addNew = true;

  final T? item;
  final bool addNew;
}

/// A customer or client picker: the Leave picker's sheet with a search box
/// over it, asking the server as the name is typed, and "Add new" first.
class _PlacementsSearchSheet<T> extends StatefulWidget {
  const _PlacementsSearchSheet({
    required this.hintText,
    required this.addLabel,
    required this.emptyText,
    required this.search,
    required this.idOf,
    required this.nameOf,
    required this.subtitleOf,
    this.selectedId,
  });

  final String hintText;
  final String addLabel;
  final String emptyText;
  final Future<List<T>> Function(String query) search;
  final String Function(T item) idOf;
  final String Function(T item) nameOf;
  final String Function(T item) subtitleOf;
  final String? selectedId;

  @override
  State<_PlacementsSearchSheet<T>> createState() =>
      _PlacementsSearchSheetState<T>();
}

class _PlacementsSearchSheetState<T> extends State<_PlacementsSearchSheet<T>> {
  final _query = TextEditingController();
  Timer? _debounce;
  List<T>? _results;
  String? _error;
  bool _loading = false;

  /// Only the newest search may answer: an older one landing late would put
  /// back results for what was typed before.
  int _searches = 0;

  @override
  void initState() {
    super.initState();
    _query.addListener(_onQueryChanged);
    unawaited(_search());
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _query
      ..removeListener(_onQueryChanged)
      ..dispose();
    super.dispose();
  }

  void _onQueryChanged() {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), _search);
  }

  Future<void> _search() async {
    final search = ++_searches;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await widget.search(_query.text.trim());
      if (!mounted || search != _searches) return;
      setState(() => _results = results);
    } catch (error) {
      if (!mounted || search != _searches) return;
      setState(() => _error = placementsErrorText(error));
    } finally {
      if (mounted && search == _searches) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final results = _results;
    return SafeArea(
      top: false,
      child: Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(context).height * .75,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SizedBox(height: 12),
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: const Color(0xFFD1D5DB),
                  borderRadius: BorderRadius.circular(99),
                ),
              ),
              const SizedBox(height: 12),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: _FormTextField(
                  key: const ValueKey('placements-search'),
                  controller: _query,
                  hintText: widget.hintText,
                ),
              ),
              const SizedBox(height: 4),
              InkWell(
                onTap: () =>
                    Navigator.of(context).pop(_SearchSheetResult<T>.addNew()),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 20,
                    vertical: 14,
                  ),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.add_circle_outline_rounded,
                        size: 20,
                        color: Color(0xFF0571A6),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        widget.addLabel,
                        style: const TextStyle(
                          color: Color(0xFF0571A6),
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const Divider(height: 1, color: Color(0xFFEBEBEB)),
              if (results == null && _loading)
                const Padding(
                  padding: EdgeInsets.all(24),
                  child: SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Color(0xFF0571A6),
                    ),
                  ),
                )
              else if (_error case final error?)
                Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    children: [
                      Text(
                        error,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: Color(0xFF6B7280),
                          fontSize: 14,
                        ),
                      ),
                      TextButton(
                        onPressed: _search,
                        style: TextButton.styleFrom(
                          foregroundColor: const Color(0xFF0571A6),
                        ),
                        child: const Text('Try again'),
                      ),
                    ],
                  ),
                )
              else if (results == null || results.isEmpty)
                Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text(
                    _query.text.trim().isEmpty
                        ? widget.emptyText
                        : 'Nothing matches "${_query.text.trim()}".',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Color(0xFF9CA3AF),
                      fontSize: 14,
                    ),
                  ),
                )
              else
                Flexible(
                  child: ListView.separated(
                    shrinkWrap: true,
                    padding: EdgeInsets.zero,
                    itemCount: results.length,
                    separatorBuilder: (_, _) =>
                        const Divider(height: 1, color: Color(0xFFEBEBEB)),
                    itemBuilder: (context, index) {
                      final item = results[index];
                      final subtitle = widget.subtitleOf(item);
                      final selected = widget.idOf(item) == widget.selectedId;
                      return InkWell(
                        onTap: () => Navigator.of(
                          context,
                        ).pop(_SearchSheetResult<T>.picked(item)),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 20,
                            vertical: 14,
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                widget.nameOf(item),
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
                      );
                    },
                  ),
                ),
              const SizedBox(height: 4),
            ],
          ),
        ),
      ),
    );
  }
}
