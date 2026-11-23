import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../shared/app_toast.dart';
import '../data/onboarding_api.dart';
import '../data/onboarding_models.dart' show lifecycleYmd;
import '../presentation/onboarding_kit.dart';
import 'joiner_details_models.dart';
import 'joiner_parts.dart';

// ─── Your profile, one section (app build 90) ──────────────────────────────

/// One Employee profile section. Left empty before joining, it is filled
/// here once; filled before, saved here, or approved by HR, it reads only.
class JoinerProfileSectionScreen extends StatefulWidget {
  const JoinerProfileSectionScreen({super.key, required this.c, required this.section, required this.title});

  final JoinerController c;
  final String section;
  final String title;

  @override
  State<JoinerProfileSectionScreen> createState() => _JoinerProfileSectionScreenState();
}

class _JoinerProfileSectionScreenState extends State<JoinerProfileSectionScreen> {
  JoinerProfileDetails? _d;
  String? _error;
  bool _saving = false;
  final Map<String, TextEditingController> _text = {};
  final Map<String, String?> _pick = {};
  bool _permanentSame = true;
  bool _pfFirstJob = false;
  bool _firstJob = false;

  TextEditingController _t(String k) => _text.putIfAbsent(k, TextEditingController.new);
  String _v(String k) => _t(k).text.trim();

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    for (final t in _text.values) {
      t.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await widget.c.api.fetchProfileDetails();
      if (!mounted) return;
      setState(() {
        _d = d;
        _error = null;
      });
      _prefill(d);
    } catch (e) {
      if (mounted) setState(() => _error = onboardingErrorText(e));
    }
  }

  /// What pre-boarding kept of a half-filled section (the bank account without PF).
  void _prefill(JoinerProfileDetails d) {
    final bank = d.value('bank');
    for (final k in ['holderName', 'ifsc', 'bankName']) {
      if (bank[k] is String && _t(k).text.isEmpty) _t(k).text = bank[k] as String;
    }
    final pf = d.value('pf');
    if (pf['uan'] is String && _t('uan').text.isEmpty) _t('uan').text = pf['uan'] as String;
    _pfFirstJob = pf['firstJob'] == true;
  }

  Map<String, Object?> _body(JoinerProfileDetails d) {
    Map<String, Object?> address(String p) => {'line': _v('$p.line'), 'city': _v('$p.city'), 'state': _v('$p.state'), 'pin': _v('$p.pin')};
    return switch (widget.section) {
      'personal' => {
        'fullName': _v('fullName'),
        'preferredName': _v('preferredName'),
        'dob': _pick['dob'],
        'gender': _pick['gender'],
        'maritalStatus': _pick['maritalStatus'],
        'nationality': _v('nationality'),
      },
      'contact' => {
        'mobile': _v('mobile'),
        'current': address('current'),
        'permanentSame': _permanentSame,
        if (!_permanentSame) 'permanent': address('permanent'),
      },
      'emergency' => {'name': _v('ecName'), 'relation': _pick['ecRelation'], 'phone': _v('ecPhone')},
      'bank' => {
        'holderName': _v('holderName'),
        'accountNumber': _v('accountNumber'),
        'accountNumberAgain': _v('accountNumberAgain'),
        'ifsc': _v('ifsc'),
        'bankName': _v('bankName'),
        'pf': {'firstJob': _pfFirstJob, if (!_pfFirstJob) 'uan': _v('uan')},
      },
      'education' => {
        'qualification': _pick['qualification'],
        'institution': _v('institution'),
        'year': _v('year'),
        'firstJob': _firstJob,
        if (!_firstJob)
          'jobs': [
            {'company': _v('job.company'), 'role': _v('job.role'), 'from': _v('job.from'), 'to': _v('job.to')},
          ],
      },
      _ => {'aadhaar': _v('aadhaar'), 'pan': _v('pan')},
    };
  }

  Future<void> _save(JoinerProfileDetails d) async {
    setState(() => _saving = true);
    try {
      final next = await widget.c.api.saveProfileSection(widget.section, _body(d));
      if (mounted) setState(() => _d = next);
      unawaited(widget.c.load());
      if (mounted) showAppToast(context, 'Saved');
    } catch (e) {
      if (mounted) showAppToast(context, onboardingErrorText(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _pickDob() async {
    final now = DateTime.now();
    final day = await showDatePicker(
      context: context,
      initialDate: DateTime.tryParse(_pick['dob'] ?? '') ?? DateTime(now.year - 25),
      firstDate: DateTime(now.year - 90),
      lastDate: DateTime(now.year - 14),
    );
    if (day != null && mounted) setState(() => _pick['dob'] = lifecycleYmd(day));
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    final s = d?.section(widget.section);
    return OnbScaffold(
      shell: widget.c.shell,
      title: widget.title,
      body: d == null || s == null
          ? OnbLoadState(error: _error ?? (d == null ? null : 'This section is not on your profile'), onRetry: _load)
          : JPage(
              children: [
                if (s.editable) ...[
                  const DetailsNote(
                    key: ValueKey('profile-once'),
                    text: 'You can fill this in once. Check it before you save: after that, only HR can change it.',
                  ),
                  ..._form(d),
                  OnbPrimaryButton(key: const ValueKey('profile-save'), label: 'Save', busy: _saving, onTap: () => _save(d)),
                ] else ...[
                  if (s.locked)
                    const DetailsNote(key: ValueKey('profile-locked'), text: 'Approved by HR', tone: DetailsTone.done)
                  else
                    DetailsNote(
                      key: const ValueKey('profile-readonly'),
                      text: s.savedInApp
                          ? 'Saved. To change anything, ask HR.'
                          : 'Filled in before you joined. To change anything, ask HR.',
                    ),
                  DetailsCard(key: const ValueKey('profile-read'), rows: _readRows(d)),
                ],
                if (s.missingDocuments.isNotEmpty)
                  DetailsNote(
                    key: const ValueKey('profile-documents'),
                    text: 'HR still needs: ${s.missingDocuments.join(', ')}. Hand them to HR or upload them on the joining portal.',
                    tone: DetailsTone.amber,
                  ),
              ],
            ),
    );
  }

  List<Widget> _form(JoinerProfileDetails d) => switch (widget.section) {
    'personal' => [
      DetailsInput(label: 'Full name, as on your ID', controller: _t('fullName'), fieldKey: const ValueKey('in-fullName')),
      DetailsInput(label: 'Preferred name (optional)', controller: _t('preferredName')),
      DetailsPickField(label: 'Date of birth', value: _pick['dob'] == null ? null : _day(_pick['dob']!), icon: Icons.calendar_today_outlined, onTap: _pickDob),
      DetailsChips(label: 'Gender', options: d.genders, picked: _pick['gender'], onPick: (v) => setState(() => _pick['gender'] = v), keyPrefix: 'gender'),
      DetailsChips(label: 'Marital status (optional)', options: d.marital, picked: _pick['maritalStatus'], onPick: (v) => setState(() => _pick['maritalStatus'] = v), keyPrefix: 'marital'),
      DetailsInput(label: 'Nationality', controller: _t('nationality'), hint: 'Indian'),
    ],
    'contact' => [
      DetailsInput(label: 'Mobile number', controller: _t('mobile'), keyboard: TextInputType.phone, hint: '10 digits', fieldKey: const ValueKey('in-mobile')),
      ..._address('current', 'Current address'),
      DetailsSwitch(label: 'My permanent address is the same', value: _permanentSame, onChanged: (v) => setState(() => _permanentSame = v)),
      if (!_permanentSame) ..._address('permanent', 'Permanent address'),
    ],
    'emergency' => [
      DetailsInput(label: 'Name', controller: _t('ecName'), fieldKey: const ValueKey('in-ecName')),
      DetailsChips(label: 'Relation', options: d.relations, picked: _pick['ecRelation'], onPick: (v) => setState(() => _pick['ecRelation'] = v), keyPrefix: 'relation'),
      DetailsInput(label: 'Mobile number', controller: _t('ecPhone'), keyboard: TextInputType.phone, hint: '10 digits', fieldKey: const ValueKey('in-ecPhone')),
    ],
    'bank' => [
      DetailsInput(label: 'Account holder’s name', controller: _t('holderName')),
      DetailsInput(
        label: 'Account number',
        controller: _t('accountNumber'),
        keyboard: TextInputType.number,
        digitsOnly: true,
        hint: d.value('bank')['accountLast4'] is String ? 'Leave blank to keep the one ending ${d.value('bank')['accountLast4']}' : null,
      ),
      DetailsInput(label: 'Account number again', controller: _t('accountNumberAgain'), keyboard: TextInputType.number, digitsOnly: true),
      DetailsInput(label: 'IFSC', controller: _t('ifsc'), caps: true, hint: 'HDFC0001234'),
      DetailsInput(label: 'Bank name', controller: _t('bankName')),
      DetailsSwitch(label: 'This is my first job (no UAN)', value: _pfFirstJob, onChanged: (v) => setState(() => _pfFirstJob = v)),
      if (!_pfFirstJob) DetailsInput(label: 'UAN (optional)', controller: _t('uan'), keyboard: TextInputType.number, digitsOnly: true, hint: '12 digits'),
    ],
    'education' => [
      DetailsChips(label: 'Highest qualification', options: d.qualifications, picked: _pick['qualification'], onPick: (v) => setState(() => _pick['qualification'] = v), keyPrefix: 'qualification'),
      DetailsInput(label: 'College, university or school', controller: _t('institution')),
      DetailsInput(label: 'Year you passed', controller: _t('year'), keyboard: TextInputType.number, digitsOnly: true, hint: '2020'),
      DetailsSwitch(label: 'This is my first job', value: _firstJob, onChanged: (v) => setState(() => _firstJob = v)),
      if (!_firstJob) ...[
        DetailsInput(label: 'Last company', controller: _t('job.company')),
        DetailsInput(label: 'Your role there', controller: _t('job.role')),
        DetailsInput(label: 'Started (YYYY-MM)', controller: _t('job.from'), hint: '2021-06'),
        DetailsInput(label: 'Left (YYYY-MM, optional)', controller: _t('job.to'), hint: '2024-03'),
      ],
    ],
    _ => [
      DetailsInput(
        label: 'Aadhaar number',
        controller: _t('aadhaar'),
        keyboard: TextInputType.number,
        digitsOnly: true,
        hint: d.value('ids')['aadhaarLast4'] is String ? 'Leave blank to keep the one ending ${d.value('ids')['aadhaarLast4']}' : '12 digits',
      ),
      DetailsInput(
        label: 'PAN',
        controller: _t('pan'),
        caps: true,
        hint: d.value('ids')['panLast4'] is String ? 'Leave blank to keep the one ending ${d.value('ids')['panLast4']}' : 'ABCDE1234F',
      ),
    ],
  };

  List<Widget> _address(String p, String title) => [
    Text(title, style: OnbText.bodyStrong),
    DetailsInput(label: 'House, building and street', controller: _t('$p.line')),
    DetailsInput(label: 'City', controller: _t('$p.city')),
    DetailsInput(label: 'State', controller: _t('$p.state')),
    DetailsInput(label: 'PIN code', controller: _t('$p.pin'), keyboard: TextInputType.number, digitsOnly: true, hint: '6 digits'),
  ];

  List<(String, String?)> _readRows(JoinerProfileDetails d) {
    String? s(Map<String, dynamic> m, String k) => m[k] is String && (m[k] as String).isNotEmpty ? m[k] as String : null;
    String? address(Object? a) {
      if (a is! Map) return null;
      final parts = [a['line'], a['city'], [a['state'], a['pin']].whereType<String>().join(' ')].whereType<String>().where((x) => x.isNotEmpty);
      return parts.isEmpty ? null : parts.join(', ');
    }

    String? ending(Object? last4) => last4 is String ? '•••• $last4' : null;
    switch (widget.section) {
      case 'personal':
        final p = d.value('personal');
        return [
          ('Full name', s(p, 'fullName')),
          ('Preferred name', s(p, 'preferredName')),
          ('Date of birth', s(p, 'dob') == null ? null : _day(s(p, 'dob')!)),
          ('Gender', s(p, 'gender')),
          ('Marital status', s(p, 'maritalStatus')),
          ('Nationality', s(p, 'nationality')),
        ];
      case 'contact':
        final c = d.value('contact');
        return [
          ('Mobile', s(c, 'mobile')),
          ('Current address', address(c['current'])),
          ('Permanent address', c['permanentSame'] == true ? 'Same as current' : address(c['permanent'])),
        ];
      case 'emergency':
        final e = d.value('emergencyContact');
        return [('Name', s(e, 'name')), ('Relation', s(e, 'relation')), ('Mobile', s(e, 'phone'))];
      case 'bank':
        final b = d.value('bank');
        final pf = d.value('pf');
        return [
          ('Account holder', s(b, 'holderName')),
          ('Bank', s(b, 'bankName')),
          ('Account number', ending(b['accountLast4'])),
          ('IFSC', s(b, 'ifsc')),
          ('UAN', pf['firstJob'] == true ? 'First job' : (s(pf, 'uan') == null ? null : ending(s(pf, 'uan')!.substring(s(pf, 'uan')!.length - 4)))),
        ];
      case 'education':
        final e = d.value('education');
        final x = d.value('experience');
        final jobs = x['jobs'] is List ? (x['jobs'] as List).whereType<Map>().toList() : const <Map>[];
        return [
          ('Highest qualification', s(e, 'qualification')),
          ('Institution', s(e, 'institution')),
          ('Year', s(e, 'year')),
          ('Last job', x['firstJob'] == true ? 'First job' : jobs.isEmpty ? null : '${jobs.first['role'] ?? ''} at ${jobs.first['company'] ?? ''}'),
        ];
      default:
        final i = d.value('ids');
        return [('Aadhaar', ending(i['aadhaarLast4'])), ('PAN', ending(i['panLast4']))];
    }
  }
}

// ─── Complete your payroll details (app build 90) ──────────────────────────

class _NomineeInput {
  _NomineeInput({String name = '', this.relation, int? share})
    : name = TextEditingController(text: name),
      share = TextEditingController(text: share == null ? '' : '$share');

  final TextEditingController name;
  String? relation;
  final TextEditingController share;

  int get shareValue => int.tryParse(share.text.trim()) ?? 0;

  void dispose() {
    name.dispose();
    share.dispose();
  }
}

/// "Complete your payroll details": bank account, PF and nominees, prefilled
/// from pre-boarding. Sent to HR, who approve them into payroll; sending
/// finishes the task. Read-only while HR has them and once approved.
class JoinerPayrollScreen extends StatefulWidget {
  const JoinerPayrollScreen({super.key, required this.c});

  final JoinerController c;

  @override
  State<JoinerPayrollScreen> createState() => _JoinerPayrollScreenState();
}

class _JoinerPayrollScreenState extends State<JoinerPayrollScreen> {
  static const _maxNominees = 5;

  JoinerPayroll? _p;
  String? _error;
  bool _sending = false;
  final _holder = TextEditingController();
  final _bankName = TextEditingController();
  final _account = TextEditingController();
  final _accountAgain = TextEditingController();
  final _ifsc = TextEditingController();
  final _uan = TextEditingController();
  bool _firstJob = false;
  final List<_NomineeInput> _nominees = [];

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    for (final c in [_holder, _bankName, _account, _accountAgain, _ifsc, _uan]) {
      c.dispose();
    }
    for (final n in _nominees) {
      n.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final p = await widget.c.api.fetchPayroll();
      if (!mounted) return;
      _fill(p);
      setState(() {
        _p = p;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = onboardingErrorText(e));
    }
  }

  void _fill(JoinerPayroll p) {
    _holder.text = p.holderName ?? '';
    _bankName.text = p.bankName ?? '';
    _ifsc.text = p.ifsc ?? '';
    _uan.text = p.uan ?? '';
    _account.clear();
    _accountAgain.clear();
    _firstJob = p.firstJob;
    for (final n in _nominees) {
      n.dispose();
    }
    _nominees
      ..clear()
      ..addAll(p.nominees.isEmpty ? [_NomineeInput(share: 100)] : [for (final n in p.nominees) _NomineeInput(name: n.name, relation: n.relation, share: n.share)]);
  }

  int get _total => _nominees.fold(0, (sum, n) => sum + n.shareValue);

  Future<void> _send() async {
    setState(() => _sending = true);
    try {
      final p = await widget.c.api.sendPayroll({
        'bank': {
          'holderName': _holder.text.trim(),
          'bankName': _bankName.text.trim(),
          'ifsc': _ifsc.text.trim(),
          'accountNumber': _account.text.trim(),
          'accountNumberAgain': _accountAgain.text.trim(),
        },
        'pf': {'firstJob': _firstJob, if (!_firstJob) 'uan': _uan.text.trim()},
        'nominees': [
          for (final n in _nominees) {'name': n.name.text.trim(), 'relation': n.relation, 'share': n.shareValue},
        ],
      });
      if (mounted) setState(() => _p = p);
      unawaited(widget.c.load());
      if (mounted) showAppToast(context, 'Sent to HR');
    } catch (e) {
      if (mounted) showAppToast(context, onboardingErrorText(e));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = _p;
    return OnbScaffold(
      shell: widget.c.shell,
      title: 'Payroll details',
      body: p == null
          ? OnbLoadState(error: _error, onRetry: _load)
          : JPage(
              children: [
                if (p.state == 'pending')
                  const DetailsNote(key: ValueKey('payroll-pending'), text: 'With HR. They check your details, then add them to payroll.')
                else if (p.state == 'approved')
                  const DetailsNote(key: ValueKey('payroll-approved'), text: 'In payroll. To change anything, ask HR.', tone: DetailsTone.done)
                else if (p.state == 'declined')
                  DetailsNote(
                    key: const ValueKey('payroll-declined'),
                    text: 'HR sent these back${p.hrNote == null ? '' : ': ${p.hrNote}'}. Change them and send again.',
                    tone: DetailsTone.amber,
                  ),
                if (p.editable) ..._form(p) else _read(p),
              ],
            ),
    );
  }

  Widget _read(JoinerPayroll p) => DetailsCard(
    key: const ValueKey('payroll-read'),
    rows: [
      ('Account holder', p.holderName),
      ('Bank', p.bankName),
      ('Account number', p.accountLast4 == null ? null : '•••• ${p.accountLast4}'),
      ('IFSC', p.ifsc),
      ('UAN', p.firstJob ? 'First job' : p.uanLast4 != null ? '•••• ${p.uanLast4}' : p.uan),
      for (final (i, n) in p.nominees.indexed) ('Nominee ${i + 1}', '${n.name} · ${n.relation} · ${n.share}%'),
    ],
  );

  List<Widget> _form(JoinerPayroll p) {
    final total = _total;
    final relations = p.relations;
    return [
      Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: _gapped([
          const Text('Bank account', style: OnbText.h1),
          DetailsInput(label: 'Account holder’s name', controller: _holder, fieldKey: const ValueKey('pay-holder')),
          DetailsInput(
            label: 'Account number',
            controller: _account,
            keyboard: TextInputType.number,
            digitsOnly: true,
            fieldKey: const ValueKey('pay-account'),
            hint: p.accountLast4 == null ? '9 to 18 digits' : 'Leave blank to keep the one ending ${p.accountLast4}',
          ),
          DetailsInput(label: 'Account number again', controller: _accountAgain, keyboard: TextInputType.number, digitsOnly: true, fieldKey: const ValueKey('pay-account-again')),
          DetailsInput(label: 'IFSC', controller: _ifsc, caps: true, hint: 'HDFC0001234', fieldKey: const ValueKey('pay-ifsc')),
          DetailsInput(label: 'Bank name', controller: _bankName, fieldKey: const ValueKey('pay-bank')),
        ]),
      ),
      Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: _gapped([
          const Text('PF', style: OnbText.h1),
          DetailsSwitch(key: const ValueKey('pay-first-job'), label: 'This is my first job (no UAN)', value: _firstJob, onChanged: (v) => setState(() => _firstJob = v)),
          if (!_firstJob)
            DetailsInput(
              label: 'UAN',
              controller: _uan,
              keyboard: TextInputType.number,
              digitsOnly: true,
              fieldKey: const ValueKey('pay-uan'),
              hint: p.uanLast4 == null ? '12 digits' : 'Leave blank to keep the one ending ${p.uanLast4}',
            ),
        ]),
      ),
      Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: _gapped([
          const Text('Nominees', style: OnbText.h1),
          const Text('Who receives your PF. Their shares add up to 100%.', style: OnbText.label),
          for (final (i, n) in _nominees.indexed)
            Container(
              key: ValueKey('nominee-$i'),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: OnbColors.line)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: _gapped([
                  Row(
                    children: [
                      Expanded(child: Text('Nominee ${i + 1}', style: OnbText.bodyStrong)),
                      if (_nominees.length > 1)
                        OnbLink(
                          key: ValueKey('nominee-$i-remove'),
                          label: 'Remove',
                          onTap: () => setState(() => _nominees.removeAt(i).dispose()),
                        ),
                    ],
                  ),
                  DetailsInput(label: 'Name', controller: n.name, fieldKey: ValueKey('nominee-$i-name')),
                  DetailsChips(label: 'Relation', options: relations, picked: n.relation, onPick: (v) => setState(() => n.relation = v), keyPrefix: 'nominee-$i-relation'),
                  DetailsInput(
                    label: 'Share (%)',
                    controller: n.share,
                    keyboard: TextInputType.number,
                    digitsOnly: true,
                    fieldKey: ValueKey('nominee-$i-share'),
                    onChanged: (_) => setState(() {}),
                  ),
                ], gap: 10),
              ),
            ),
          if (_nominees.length < _maxNominees)
            OnbLink(
              key: const ValueKey('nominee-add'),
              label: 'Add a nominee',
              icon: Icons.add_rounded,
              onTap: () => setState(() => _nominees.add(_NomineeInput())),
            ),
          Text(
            'Shares: $total% of 100%',
            key: const ValueKey('nominee-total'),
            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: total == 100 ? OnbColors.successText : OnbColors.redText),
          ),
        ]),
      ),
      OnbPrimaryButton(
        key: const ValueKey('payroll-send'),
        label: 'Send to HR',
        busy: _sending,
        onTap: total == 100 ? _send : null,
      ),
    ];
  }
}

// ─── Pieces ────────────────────────────────────────────────────────────────

List<Widget> _gapped(List<Widget> children, {double gap = 12}) => [
  for (final (i, c) in children.indexed) ...[if (i > 0) SizedBox(height: gap), c],
];

/// YYYY-MM-DD as "2 Apr 1999".
String _day(String ymd) {
  final d = DateTime.tryParse(ymd);
  return d == null ? ymd : '${d.day} ${onbMonthYear(d)}';
}

enum DetailsTone { info, done, amber }

/// A line in a tinted box above the form: once only, approved, sent back.
class DetailsNote extends StatelessWidget {
  const DetailsNote({super.key, required this.text, this.tone = DetailsTone.info});

  final String text;
  final DetailsTone tone;

  @override
  Widget build(BuildContext context) {
    final (bg, fg, icon) = switch (tone) {
      DetailsTone.done => (OnbColors.successTint, OnbColors.successText, Icons.verified_outlined),
      DetailsTone.amber => (OnbColors.amberTint, OnbColors.amber, Icons.info_outline_rounded),
      DetailsTone.info => (OnbColors.blueTint, OnbColors.blue, Icons.info_outline_rounded),
    };
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(14)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: fg),
          const SizedBox(width: 8),
          Expanded(child: Text(text, style: TextStyle(fontSize: 13, height: 1.4, fontWeight: FontWeight.w600, color: fg))),
        ],
      ),
    );
  }
}

/// The answers, read-only: a label and its value per row ("—" when empty).
class DetailsCard extends StatelessWidget {
  const DetailsCard({super.key, required this.rows});

  final List<(String, String?)> rows;

  @override
  Widget build(BuildContext context) => JListCard(
    children: withLines([
      for (final (label, value) in rows)
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(flex: 2, child: Text(label, style: OnbText.label)),
              const SizedBox(width: 12),
              Expanded(flex: 3, child: Text(value == null || value.isEmpty ? '—' : value, style: OnbText.bodyStrong)),
            ],
          ),
        ),
    ]),
  );
}

/// A labelled text field in the kit's input style.
class DetailsInput extends StatelessWidget {
  const DetailsInput({
    super.key,
    required this.label,
    required this.controller,
    this.hint,
    this.keyboard,
    this.digitsOnly = false,
    this.caps = false,
    this.fieldKey,
    this.onChanged,
  });

  final String label;
  final TextEditingController controller;
  final String? hint;
  final TextInputType? keyboard;
  final bool digitsOnly;
  final bool caps;
  final Key? fieldKey;
  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Text(label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: OnbColors.text2)),
      const SizedBox(height: 6),
      TextField(
        key: fieldKey,
        controller: controller,
        keyboardType: keyboard,
        onChanged: onChanged,
        textCapitalization: caps ? TextCapitalization.characters : TextCapitalization.none,
        inputFormatters: digitsOnly ? [FilteringTextInputFormatter.digitsOnly] : null,
        style: const TextStyle(fontSize: 14, color: OnbColors.text),
        decoration: InputDecoration(
          hintText: hint,
          hintStyle: const TextStyle(fontSize: 14, color: OnbColors.icon),
          filled: true,
          fillColor: Colors.white,
          isDense: true,
          contentPadding: const EdgeInsets.all(14),
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: OnbColors.lineDark)),
          enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: OnbColors.lineDark)),
          focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: OnbColors.primary)),
        ),
      ),
    ],
  );
}

/// One of a few options, as pills.
class DetailsChips extends StatelessWidget {
  const DetailsChips({super.key, required this.label, required this.options, required this.picked, required this.onPick, required this.keyPrefix});

  final String label;
  final List<String> options;
  final String? picked;
  final ValueChanged<String> onPick;
  final String keyPrefix;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Text(label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: OnbColors.text2)),
      const SizedBox(height: 6),
      Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          for (final o in options)
            Semantics(
              button: true,
              selected: o == picked,
              child: InkWell(
                key: ValueKey('$keyPrefix-$o'),
                borderRadius: BorderRadius.circular(999),
                onTap: () => onPick(o),
                child: Container(
                  constraints: const BoxConstraints(minHeight: 40),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
                  decoration: BoxDecoration(
                    color: o == picked ? OnbColors.tint : Colors.white,
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(color: o == picked ? OnbColors.primary : OnbColors.lineDark),
                  ),
                  child: Text(o, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: o == picked ? OnbColors.primary : OnbColors.text2)),
                ),
              ),
            ),
        ],
      ),
    ],
  );
}

/// A yes/no line with a switch.
class DetailsSwitch extends StatelessWidget {
  const DetailsSwitch({super.key, required this.label, required this.value, required this.onChanged});

  final String label;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(child: Text(label, style: OnbText.body)),
      Switch.adaptive(value: value, onChanged: onChanged),
    ],
  );
}

/// A tappable field (the date of birth) in the input style.
class DetailsPickField extends StatelessWidget {
  const DetailsPickField({super.key, required this.label, required this.value, required this.icon, required this.onTap});

  final String label;
  final String? value;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Text(label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: OnbColors.text2)),
      const SizedBox(height: 6),
      Material(
        color: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: const BorderSide(color: OnbColors.lineDark)),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Container(
            constraints: const BoxConstraints(minHeight: 48),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            child: Row(
              children: [
                Expanded(child: Text(value ?? '', style: const TextStyle(fontSize: 14, color: OnbColors.text))),
                Icon(icon, size: 20, color: OnbColors.icon),
              ],
            ),
          ),
        ),
      ),
    ],
  );
}
