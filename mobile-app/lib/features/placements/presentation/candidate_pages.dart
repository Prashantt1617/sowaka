import 'dart:async';

import 'package:flutter/material.dart';

import '../data/placements_api_service.dart';
import '../data/placements_models.dart';
import 'client_pages.dart';
import 'placement_form_page.dart';
import 'placements_style.dart';

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

  List<PlacementCustomer> get _shown {
    final q = _search.text.trim().toLowerCase();
    final rows = (_rows ?? const <PlacementCustomer>[]).where((c) {
      if (_filter != _all && c.stage.label != _filter) return false;
      if (q.isEmpty) return true;
      return c.name.toLowerCase().contains(q) ||
          c.phone.replaceAll(' ', '').contains(q.replaceAll(' ', '')) ||
          c.currentRole.toLowerCase().contains(q);
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
      title: 'My candidates',
      subtitle: rows == null ? null : '${rows.length} candidates',
      actions: [
        PlAddButton(onTap: () => _open(CandidateFormPage(api: widget.api))),
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
              hint: 'Search name, phone or designation',
              filters: [_all, for (final s in CandidateStage.values) s.label],
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
                'No candidates yet. Tap Add to log your first one.',
              )
            else if (_shown.isEmpty)
              const PlState.message('No candidates match.')
            else
              for (final c in _shown) ...[
                _CandidateRow(
                  candidate: c,
                  onTap: () => _open(
                    CandidateDetailPage(api: widget.api, candidateId: c.id),
                  ),
                ),
                const SizedBox(height: 10),
              ],
          ],
        ),
      ),
    );
  }
}

class _CandidateRow extends StatelessWidget {
  const _CandidateRow({required this.candidate, required this.onTap});

  final PlacementCustomer candidate;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = candidate;
    return PlCard(
      onTap: onTap,
      child: Row(
        children: [
          PlInitials(c.name, round: true, warm: true),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(c.name, style: Pl.text(15, weight: FontWeight.w700)),
                if (c.subtitle.isNotEmpty)
                  Text(c.subtitle, style: Pl.text(13, color: Pl.muted)),
                if (c.createdAt != null)
                  Text(
                    'Added ${plDate(c.createdAt)}',
                    style: Pl.text(12, color: Pl.faint),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          PlPill(c.stage.label, stageColors(c.stage)),
        ],
      ),
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
            color: Pl.danger,
            onTap: () => _remove(page.candidate),
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
              ..._content(page),
          ],
        ),
      ),
    );
  }

  List<Widget> _content(PlacementCandidatePage page) {
    final c = page.candidate;
    final byYou = c.createdByUserId == _me;
    return [
      PlCard(
        radius: 20,
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                PlInitials(c.name, size: 56, round: true, warm: true),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(c.name, style: Pl.text(20, weight: FontWeight.w700)),
                      if (c.currentRole.isNotEmpty || c.experienceYears != null)
                        Text(
                          [
                            c.currentRole,
                            if (c.experienceYears != null)
                              '${yearsLabel(c.experienceYears!)} experience',
                          ].where((p) => p.isNotEmpty).join(' · '),
                          style: Pl.text(14, color: Pl.muted),
                        ),
                    ],
                  ),
                ),
              ],
            ),
            if (c.phone.isNotEmpty || c.address.isNotEmpty) ...[
              const SizedBox(height: 14),
              if (c.phone.isNotEmpty) _InfoLine(Icons.call_outlined, c.phone),
              if (c.address.isNotEmpty) ...[
                const SizedBox(height: 8),
                _InfoLine(Icons.place_outlined, c.address),
              ],
            ],
            if (c.notes.isNotEmpty) ...[
              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Pl.stone,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Introduction',
                      style: Pl.text(
                        12,
                        weight: FontWeight.w700,
                        color: Pl.faint,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      c.notes,
                      style: Pl.text(14, color: Pl.ink2, height: 1.5),
                    ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 14),
            Text(
              [
                byYou ? 'Added by you' : 'Added',
                if (c.createdAt != null) plDate(c.createdAt),
              ].join(' · '),
              style: Pl.text(12, color: Pl.faint),
            ),
          ],
        ),
      ),
      const SizedBox(height: 22),
      PlSectionHeading(
        'Placements',
        trailing: PlAddButton(
          label: 'Add placement',
          outlined: true,
          onTap: () => _open(PlacementFormPage(api: widget.api, candidate: c)),
        ),
      ),
      const SizedBox(height: 12),
      if (page.placements.isEmpty)
        const PlState.message('Not put forward anywhere yet.')
      else
        for (final p in page.placements) ...[
          _PlacementCard(
            placement: p,
            client: page.clientOf(p),
            onClient: () =>
                _open(ClientDetailPage(api: widget.api, clientId: p.clientId)),
            onUpdate: () => _open(
              PlacementFormPage(api: widget.api, candidate: c, existing: p),
            ),
          ),
          const SizedBox(height: 10),
        ],
      const SizedBox(height: 12),
      PlSectionHeading('Activity'),
      const SizedBox(height: 12),
      PlCard(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        child: Column(children: [for (final a in _activity(page)) a]),
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
      dot: Pl.accent,
    ));
    items.sort((a, b) => (b.at ?? DateTime(0)).compareTo(a.at ?? DateTime(0)));
    return [
      for (final item in items)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 10,
                height: 10,
                margin: const EdgeInsets.only(top: 5),
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
                      style: Pl.text(14, weight: FontWeight.w600),
                    ),
                    Text(
                      [
                        if (item.at != null) plDate(item.at),
                        if (item.by == _me) 'by you',
                      ].join(' · '),
                      style: Pl.text(12, color: Pl.faint),
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
        Icon(icon, size: 18, color: Pl.icon),
        const SizedBox(width: 10),
        Expanded(
          child: Text(text, style: Pl.text(14, color: Pl.ink2)),
        ),
      ],
    );
  }
}

/// One placement on a candidate's page: the client (tap for its page), the
/// role and its budget, where it stands, its dates and Update status. A
/// dropped one is one line.
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
  final VoidCallback onUpdate;

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
                child: Text(
                  p.clientName.isEmpty ? 'Client' : p.clientName,
                  style: Pl.text(
                    15,
                    weight: FontWeight.w700,
                    color: Pl.accentDeep,
                  ).copyWith(decoration: TextDecoration.underline),
                ),
              ),
              const SizedBox(height: 2),
              Text(line.join(' · '), style: Pl.text(13, color: Pl.muted)),
            ],
          ),
        ),
        const SizedBox(width: 8),
        PlPill(p.status.label, statusColors(p.status)),
      ],
    );
    if (dropped) return PlCard(onTap: onUpdate, child: heading);
    return PlCard(
      radius: 18,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          heading,
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Pl.stone,
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
              style: Pl.text(13, weight: FontWeight.w600, color: Pl.ink2),
            ),
          ],
          const SizedBox(height: 12),
          PlButton(label: 'Update status', outlined: true, onTap: onUpdate),
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
          Text(label, style: Pl.text(12, color: Pl.faint)),
          Text(
            day == null ? 'Not set' : plDate(day),
            style: Pl.text(
              14,
              weight: FontWeight.w700,
              color: day == null ? Pl.faint : Pl.ink,
            ),
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
  late final _name = TextEditingController(text: widget.existing?.name);
  late final _phone = TextEditingController(
    text: (widget.existing?.phone ?? '')
        .replaceFirst(RegExp(r'^\+91\s*'), '')
        .trim(),
  );
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

  Future<void> _save() async {
    final digits = _phone.text.replaceAll(RegExp(r'\D'), '');
    final experience = _experience.text.trim();
    final years = experience.isEmpty ? null : double.tryParse(experience);
    final problem = _name.text.trim().isEmpty
        ? 'Enter their full name.'
        : digits.length != 10
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
        phone: '+91 $digits',
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
    return PlPage(
      title: editing ? 'Edit candidate' : 'Add candidate',
      subtitle: 'Candidate database',
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
        children: [
          PlField(
            label: 'Full name',
            controller: _name,
            hint: 'As on ID proof',
            capitalization: TextCapitalization.words,
          ),
          const SizedBox(height: 18),
          PlField(
            label: 'Phone number',
            controller: _phone,
            hint: '10-digit mobile',
            prefix: '+91',
            keyboard: TextInputType.phone,
          ),
          const SizedBox(height: 18),
          PlField(
            label: 'Address',
            controller: _address,
            hint: 'House, street, area, city, PIN',
            lines: 3,
          ),
          const SizedBox(height: 18),
          PlField(
            label: 'Work experience',
            controller: _experience,
            hint: '0',
            suffix: 'years',
            keyboard: const TextInputType.numberWithOptions(decimal: true),
            note: 'Enter 0 for a fresher.',
          ),
          const SizedBox(height: 18),
          PlField(
            label: 'Designation',
            controller: _designation,
            hint: 'Current or preferred role',
          ),
          const SizedBox(height: 18),
          PlField(
            label: 'Introduction about the candidate',
            controller: _intro,
            hint:
                "A few lines on skills, strengths and what they're looking for",
            lines: 4,
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
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      padding: EdgeInsets.fromLTRB(
        20,
        12,
        20,
        24 + MediaQuery.of(context).padding.bottom,
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
                color: Pl.field,
                borderRadius: BorderRadius.circular(4),
              ),
            ),
          ),
          const SizedBox(height: 18),
          Container(
            width: 52,
            height: 52,
            decoration: const BoxDecoration(
              color: Pl.dangerSoft,
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.delete_outline_rounded, color: Pl.danger),
          ),
          const SizedBox(height: 18),
          Text(
            'Remove ${widget.candidate.name}?',
            style: Pl.text(20, weight: FontWeight.w700),
          ),
          const SizedBox(height: 6),
          Text(
            "They'll move to Removed and stop counting toward your performance "
            'incentive. Your admin can see removed candidates and restore them.',
            style: Pl.text(14, color: Pl.muted, height: 1.55),
          ),
          const SizedBox(height: 18),
          Text(
            'Reason',
            style: Pl.text(13, weight: FontWeight.w600, color: Pl.ink2),
          ),
          const SizedBox(height: 10),
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
          const SizedBox(height: 18),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              color: Pl.stone,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(
                  Icons.info_outline_rounded,
                  size: 18,
                  color: Pl.muted,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    "A candidate with a Joined placement can't be removed. Ask your admin.",
                    style: Pl.text(13, color: Pl.ink2, height: 1.5),
                  ),
                ),
              ],
            ),
          ),
          if (_problem != null) ...[
            const SizedBox(height: 12),
            Text(_problem!, style: Pl.text(13, color: Pl.danger)),
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
