// A fake Payroll server for the Payroll tests: the routes of
// docs/payroll-employee-api.md, answered from memory, keeping what is saved
// so a later read sees it. Every figure is invented; the org is sowaka.
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';

final payrollSession = AuthSession(
  token: 'token',
  user: const AuthUser(
    id: 'tanvi',
    email: 'tanvi@example.test',
    name: 'Tanvi',
    role: 'employee',
    company: 'Sowaka',
    org: 'sowaka',
  ),
);

http.Response payrollJson(Object body, [int status = 200]) =>
    http.Response.bytes(
      utf8.encode(jsonEncode(body)),
      status,
      headers: {'content-type': 'application/json; charset=utf-8'},
    );

String _day(DateTime day) =>
    '${day.year.toString().padLeft(4, '0')}-'
    '${day.month.toString().padLeft(2, '0')}-'
    '${day.day.toString().padLeft(2, '0')}';

class FakePayrollServer {
  FakePayrollServer();

  /// Days this month with a punch missing, as the home counts them.
  int missingCount = 12;

  /// The salary has flexible (FBP) heads; off, the home sends no split.
  bool hasSplit = true;

  /// Every request, as "METHOD /path?query".
  final calls = <String>[];

  /// The last JSON body sent to a path.
  final bodies = <String, Map<String, dynamic>>{};

  /// The last multipart upload: its fields and file names.
  Map<String, String>? uploadFields;
  String? uploadFileName;
  String? uploadFileField;

  final now = DateTime.now();
  String get period => '${now.year}-${now.month.toString().padLeft(2, '0')}';
  String get _monthEnd => _day(DateTime(now.year, now.month + 1, 0));

  // ------------------------------------------------------------ split state
  final split = <String, int>{
    'FUEL': 250000,
    'INTERNET': 100000,
    'TELEPHONE': 100000,
    'BOOKS': 0,
  };
  static const _limits = {
    'FUEL': 300000,
    'INTERNET': 100000,
    'TELEPHONE': 150000,
    'BOOKS': 50000,
    'LTA': 200000,
  };
  static const _names = {
    'FUEL': 'Fuel & vehicle',
    'INTERNET': 'Internet',
    'TELEPHONE': 'Telephone',
    'BOOKS': 'Books & periodicals',
    'LTA': 'Leave travel (LTA)',
  };
  static const pool = 600000;
  bool splitOpen = true;

  /// The − / + step HR set (Payroll in the app); 0 sends none, as a company
  /// that has not set it: the split then says it is not set up.
  int splitStepPaise = 50000;

  /// Review's tax saving; null: the FY's tax rules are not set up.
  int? reviewSavingPaise = 94000;

  /// The fifth head of Figma 4473:68656, Leave travel (LTA) at ₹0 of
  /// ₹2,000; off by default so the totals other tests read stay the same.
  void addLeaveTravel() => split['LTA'] = 0;

  /// Overtime on the payslips and on Home's salary; 0 leaves it off Home.
  int overtimePaise = 0;

  /// False: the declaration answers 409 tax_rules_not_set_up ("… Ask HR.").
  bool taxRulesSetUp = true;

  /// False: the FY's statutory settings are missing, so Home has no salary
  /// and says it is not set up (salaryNotSetUp), the rest as usual.
  bool statutorySetUp = true;

  /// The pay period's base days on Home's salary; null leaves them (and the
  /// period's dates) out, as an older server does.
  int? baseDays = 30;

  /// The first month a change made now applies to; moving it between Review
  /// and Submit makes the save a 409.
  String windowMonth = '2026-11';

  // ------------------------------------------------------------ declaration
  String regime = 'old';
  final items = <String, int>{
    'ppf': 5000000,
    'elss': 5000000,
    'lifeInsurance': 2840000,
    'other80C': 0,
    'nps': 0,
    'healthSelf': 2500000,
    'healthParents': 0,
    'rentMonthly': 1500000,
    'homeLoanInterest': 0,
  };

  // ------------------------------------------------------------ proofs
  final proofStatus = <String, String>{
    'ppf': 'approved',
    'elss': 'uploaded',
    'lifeInsurance': 'not_uploaded',
    'healthSelf': 'approved',
    'rentMonthly': 'not_uploaded',
    'homeLoanInterest': 'rejected',
  };

  /// The amount on each proof sent from the app ("amount on proof").
  final proofAmounts = <String, int>{};

  /// The landlord PAN sent with a rent proof.
  final landlordPans = <String, String>{};

  /// Past the proofs due date: the closed state, uploads refused.
  bool proofsClosed = false;

  /// False: HR has not set the proofs due date (dueOn null, not set up).
  bool proofsDueSet = true;

  MockClient get client => MockClient(handle);

  Future<http.Response> handle(http.Request request) async {
    final path = request.url.path;
    final query = request.url.query;
    calls.add('${request.method} $path${query.isEmpty ? '' : '?$query'}');
    final isJson =
        request.headers['content-type']?.startsWith('application/json') ??
        false;
    if (isJson && request.body.isNotEmpty) {
      bodies[path] = jsonDecode(request.body) as Map<String, dynamic>;
    }

    if (path == '/payroll/home') return payrollJson(_home());
    if (path == '/payroll/missing-punches') {
      return payrollJson({
        'success': true,
        'period': period,
        'fixBy': _monthEnd,
        'locked': false,
        'count': missingCount,
        'days': <dynamic>[],
      });
    }
    if (path == '/payroll/split' && request.method == 'GET') {
      return payrollJson({'success': true, 'split': _split()});
    }
    if (path == '/payroll/split/review') {
      final amounts = (bodies[path]!['amounts'] as Map<String, dynamic>)
          .cast<String, num>();
      final lines = [
        for (final code in split.keys)
          {
            'code': code,
            'name': _names[code],
            'previousPaise': split[code],
            'amountPaise': amounts[code] ?? split[code],
            'changePaise': (amounts[code] ?? split[code]!) - split[code]!,
            'isNew': split[code] == 0 && (amounts[code] ?? 0) > 0,
          },
      ];
      final total = lines.fold<num>(0, (t, l) => t + (l['amountPaise'] as num));
      // As the server: a split that changes nothing is not a new one.
      if (lines.every((l) => l['changePaise'] == 0)) {
        return payrollJson({
          'success': false,
          'message':
              'Nothing has changed in your split. Change at least one head '
              'before you submit it',
        }, 400);
      }
      return payrollJson({
        'success': true,
        'review': {
          'effectiveFrom': windowMonth,
          'effectiveTo': '2027-03',
          'closesOn': '2026-11-15',
          'lines': lines,
          'totalPaise': total,
          'poolPaise': pool,
          'unassignedPaise': pool - total,
          'monthlyTaxSavingPaise': reviewSavingPaise,
          'billsDueOn': '2027-03-31',
        },
      });
    }
    if (path == '/payroll/split' && request.method == 'PUT') {
      final from = bodies[path]!['effectiveFrom'];
      if (from != null && from != windowMonth) {
        return payrollJson({
          'success': false,
          'message': 'The split now starts from a later month.',
        }, 409);
      }
      final amounts = (bodies[path]!['amounts'] as Map<String, dynamic>)
          .cast<String, num>();
      amounts.forEach((code, value) => split[code] = value.toInt());
      return payrollJson({'success': true, 'split': _split()});
    }
    if (path == '/payroll/tax-declaration' && request.method == 'GET') {
      if (!taxRulesSetUp) {
        return payrollJson({
          'success': false,
          'message':
              'The income tax rules for FY 2026-27 are not set up yet. Ask HR.',
          'details': {'reason': 'tax_rules_not_set_up', 'fy': '2026-27'},
        }, 409);
      }
      return payrollJson({'success': true, 'declaration': _declaration()});
    }
    if (path == '/payroll/tax-declaration' && request.method == 'PUT') {
      final body = bodies[path]!;
      regime = body['regime'] as String;
      (body['items'] as Map<String, dynamic>).forEach(
        (key, value) => items[key] = (value as num).toInt(),
      );
      return payrollJson({
        'success': true,
        'declaration': _declaration(status: 'submitted'),
      });
    }
    if (path == '/payroll/investment-proofs') {
      return payrollJson({'success': true, 'proofs': _proofs()});
    }
    if (path.startsWith('/payroll/investment-proofs/') &&
        path.endsWith('/file')) {
      return payrollJson({
        'success': true,
        'url': 'https://files.example.test/proof.pdf',
      });
    }
    if (path.startsWith('/payroll/investment-proofs/') &&
        request.method == 'POST') {
      throw StateError('multipart goes through handleMultipart');
    }
    if (path == '/payslips/mine') return payrollJson(_payslips());
    return payrollJson({
      'success': false,
      'message': 'Route not found: $path',
    }, 404);
  }

  /// MockClient hands multipart requests over as a plain [http.Request] with
  /// the encoded body; this reads the parts back out.
  Future<http.Response> handleStreamed(http.BaseRequest request) async {
    if (request is http.MultipartRequest) {
      final path = request.url.path;
      calls.add('POST $path');
      uploadFields = Map.of(request.fields);
      uploadFileName = request.files.single.filename;
      uploadFileField = request.files.single.field;
      final item = path.split('/')[3];
      proofStatus[item] = 'uploaded';
      proofAmounts[item] = int.parse(request.fields['amountPaise'] ?? '0');
      if (request.fields['landlordPan'] case final pan?) {
        landlordPans[item] = pan;
      }
      return payrollJson({'success': true, 'item': _proofItem(item)});
    }
    return handle(request as http.Request);
  }

  Map<String, dynamic> _home() => {
    'success': true,
    'period': period,
    'fy': '2026-27',
    'hasSalaryStructure': true,
    if (!statutorySetUp) 'salary': null,
    if (!statutorySetUp)
      'salaryNotSetUp': {
        'notConfigured': true,
        'reason': 'statutory_not_set_up',
        'fy': '2026-27',
        'message':
            'Your pay can\'t be worked out yet: the statutory settings (PF, '
            'ESI, professional tax) for FY 2026-27 are not set up. Ask HR.',
      },
    if (statutorySetUp)
      'salary': {
        'period': period,
        'status': 'estimate',
        'payslipId': null,
        if (baseDays != null) ...{
          'periodFrom': '2026-10-26',
          'periodTo': '2026-11-25',
          'baseDays': baseDays,
        },
        'grossPaise': 9000000,
        'lopDays': 2,
        'lopPaise': 600000,
        if (overtimePaise > 0) 'overtimePaise': overtimePaise,
        'deductions': [
          {'key': 'epf', 'label': 'Provident fund', 'amountPaise': 180000},
          {
            'key': 'income_tax',
            'label': 'Income tax (TDS)',
            'amountPaise': 420000,
          },
          {'key': 'pt', 'label': 'Professional tax', 'amountPaise': 20000},
        ],
        'netPaise': 7780000,
        'reimbursementsPaise': 0,
        'takeHomePaise': 7780000,
      },
    'todo': [
      {
        'kind': 'missing_punches',
        'count': missingCount,
        'dueOn': _monthEnd,
        'period': period,
      },
      {
        'kind': 'flexible_split',
        'dueOn': '2026-11-15',
        'effectiveFrom': '2026-11',
        'submitted': false,
      },
      {
        'kind': 'tax_regime',
        'regime': 'new',
        'chosen': false,
        'dueOn': '2026-11-30',
      },
      {
        'kind': 'investment_proofs',
        'notUploaded': 2,
        'rejected': 1,
        'dueOn': '2027-01-31',
      },
    ],
    'cards': _cards(),
    'missingPunches': {
      'period': period,
      'count': missingCount,
      'fixBy': _monthEnd,
      'locked': false,
    },
    // The server sends a split summary only when the salary has flexible
    // heads; this person has, so the FBP card shows.
    'split': !hasSplit
        ? null
        : {
            'open': true,
            'poolPaise': pool,
            'assignedPaise': split.values.fold(0, (a, b) => a + b),
            'unassignedPaise': pool - split.values.fold(0, (a, b) => a + b),
            'bills': {'approved': 0, 'inReview': 0, 'rejected': 0},
          },
    'declaration': {
      'fy': '2026-27',
      'regime': 'new',
      'chosen': false,
      'status': 'not_started',
      'locked': false,
      'dueOn': '2026-11-30',
    },
  };

  // ------------------------------------------------------------ home cards
  /// Last pay period's payslip is out: the salary card has no Estimate tag.
  bool lastSalaryReleased = false;

  /// The carousel's cards, with the figures the R1 design draws: October's
  /// salary, the FY's tax to October, and the split ([split]) by head.
  Map<String, dynamic> _cards() {
    final assigned = split.values.fold(0, (a, b) => a + b);
    return {
      'salary': !statutorySetUp
          ? {
              'period': '2026-10',
              'label': 'October',
              'notConfigured': true,
              'reason': 'statutory_not_set_up',
              'fy': '2026-27',
              'message':
                  'Your October 2026 pay can\'t be worked out yet: the statutory '
                  'settings (PF, ESI, professional tax) for FY 2026-27 are not '
                  'set up. Ask HR.',
            }
          : {
              'period': '2026-10',
              'label': 'October',
              'notConfigured': false,
              'released': lastSalaryReleased,
              'payslipId': lastSalaryReleased ? 'slip-oct' : null,
              'daysPaid': 29,
              'daysInPeriod': 31,
              'grossPaise': 12400000,
              'takeHomePaise': 10640000,
              'deductionsPaise': 960000,
              'lopPaise': 800000,
              'lopDays': 2,
              'overtimePaise': 0,
              'reimbursementsPaise': 0,
            },
      'tax': !taxRulesSetUp
          ? {
              'fy': '2026-27',
              'notConfigured': true,
              'reason': 'tax_rules_not_set_up',
              'message':
                  'The income tax rules for FY 2026-27 are not set up yet. Ask HR.',
            }
          : {
              'fy': '2026-27',
              'notConfigured': false,
              'regime': 'new',
              'regimeChosen': false,
              'paidSoFarPaise': 5840000,
              'paidBeforeThisMonthPaise': 5080000,
              'thisMonthPaise': 760000,
              'thisMonthReleased': false,
              'fromMonth': '2026-04',
              'toMonth': '2026-10',
              'thisMonth': '2026-10',
            },
      'fbp': !hasSplit
          ? null
          : {
              'poolPaise': pool,
              'heads': [
                for (final code in split.keys)
                  if (split[code]! > 0)
                    {
                      'code': code,
                      'name': _names[code],
                      'amountPaise': split[code],
                    },
              ],
              'assignedPaise': assigned,
              'unassignedPaise': pool - assigned,
              'notConfigured': false,
              'missing': <String>[],
            },
    };
  }

  Map<String, dynamic> _split() {
    final assigned = split.values.fold(0, (a, b) => a + b);
    return {
      'available': true,
      'poolPaise': pool,
      'assignedPaise': assigned,
      'unassignedPaise': pool - assigned,
      'notConfigured': splitStepPaise <= 0,
      'missing': [if (splitStepPaise <= 0) 'splitStepPaise'],
      'stepPaise': splitStepPaise <= 0 ? null : splitStepPaise,
      'components': [
        for (final code in split.keys)
          {
            'code': code,
            'name': _names[code],
            'limitPaise': _limits[code],
            'amountPaise': split[code],
            'stepPaise': splitStepPaise <= 0 ? null : splitStepPaise,
            'bills': code == 'FUEL'
                ? {'approved': 4, 'inReview': 1, 'rejected': 2}
                : {'approved': 7, 'inReview': 0, 'rejected': 0},
          },
      ],
      'current': {
        'effectiveFrom': '2026-04',
        'submittedAt': '2026-04-10T09:12:00.000Z',
        'billsAcknowledgedAt': '2026-04-10T09:12:00.000Z',
      },
      'window': {
        'open': splitOpen,
        'effectiveFrom': windowMonth,
        'effectiveTo': '2027-03',
        'closesOn': '2026-11-15',
        'reason': splitOpen ? null : 'This year\'s payroll is closed',
      },
      'billsDueOn': '2027-03-31',
    };
  }

  Map<String, dynamic> _declaration({String status = 'saved'}) {
    final old = regime == 'old';
    Map<String, dynamic> item(String key, String label, {bool ro = false}) => {
      'key': key,
      'label': label,
      'amountPaise': key == 'epf' ? 2160000 : items[key],
      'readOnly': ro,
      'proofNeeded': !ro,
    };
    Map<String, dynamic> section(
      String key,
      String label,
      int? cap,
      List<Map<String, dynamic>> sectionItems,
    ) {
      final declared = sectionItems.fold<int>(
        0,
        (sum, i) => sum + (i['amountPaise'] as int),
      );
      return {
        'key': key,
        'label': label,
        'capPaise': cap,
        'declaredPaise': declared,
        'countedPaise': !old
            ? 0
            : cap == null
            ? declared
            : declared.clamp(0, cap),
        'applicable': old,
        'note': old ? null : 'Not needed on the new regime',
        'items': sectionItems,
      };
    }

    return {
      'fy': '2026-27',
      'regime': regime,
      'chosen': true,
      'status': status,
      'locked': false,
      'dueOn': '2026-11-30',
      'proofsDueOn': '2027-01-31',
      'submittedAt': null,
      'metro': false,
      'selfSenior': false,
      'parentsSenior': false,
      'sections': [
        section('80C', '80C investments', 15000000, [
          item('epf', 'Provident fund (from payroll)', ro: true),
          item('ppf', 'PPF'),
          item('elss', 'ELSS mutual funds'),
          item('lifeInsurance', 'Life insurance'),
          item('other80C', 'Other 80C (tuition, NSC, FD, home loan principal)'),
        ]),
        section('80CCD1B', 'NPS (80CCD 1B)', 5000000, [
          item('nps', 'Your own contribution'),
        ]),
        section('80D', '80D health insurance', 5000000, [
          item('healthSelf', 'Self and family'),
          item('healthParents', 'Parents'),
        ]),
        section('HRA', 'Rent (HRA)', null, [
          item('rentMonthly', 'Rent a month'),
        ]),
        section('24B', 'Home loan interest', 20000000, [
          item('homeLoanInterest', 'Interest this year'),
        ]),
      ],
      'regimes': [
        {'regime': 'new', 'configStatus': 'confirmed'},
        {'regime': 'old', 'configStatus': 'confirmed'},
      ],
    };
  }

  static const _proofLabels = {
    'ppf': ('PPF', '80C', 5000000),
    'elss': ('ELSS mutual funds', '80C', 5000000),
    'lifeInsurance': ('Life insurance', '80C', 2840000),
    'healthSelf': ('Health insurance · self and family', '80D', 2500000),
    'rentMonthly': ('Rent', 'HRA', 1500000),
    'homeLoanInterest': ('Home loan interest', '24B', 20000000),
  };

  static const _proofDocuments = {
    'ppf': 'PPF passbook or statement',
    'elss': 'ELSS statement from the fund',
    'lifeInsurance': 'Premium receipt from the insurer',
    'healthSelf': 'Premium receipt from the insurer',
    'rentMonthly': 'Rent receipts or the rent agreement',
    'homeLoanInterest': 'Interest certificate from the bank',
  };

  static const _proofSections = [
    {'key': '80C', 'label': '80C'},
    {'key': '80CCD1B', 'label': 'NPS (80CCD 1B)'},
    {'key': '80D', 'label': '80D'},
    {'key': 'HRA', 'label': 'Rent (HRA)'},
    {'key': '24B', 'label': 'Home loan'},
  ];

  Map<String, dynamic> _proofItem(String key) {
    final (label, section, declared) = _proofLabels[key]!;
    final status = proofStatus[key]!;
    final year = key == 'rentMonthly' ? declared * 12 : declared;
    return {
      'item': key,
      'label': label,
      'section': section,
      'declaredPaise': declared,
      'yearPaise': year,
      'perMonth': key == 'rentMonthly',
      'months': key == 'rentMonthly'
          ? {'from': '2026-04', 'to': '2027-03'}
          : null,
      'document': _proofDocuments[key],
      'status': status,
      'proof': status == 'not_uploaded'
          ? null
          : {
              'id': 'proof-$key',
              'fileName': '$key-proof.pdf',
              'contentType': 'application/pdf',
              'size': 182311,
              'amountPaise': proofAmounts[key] ?? year,
              'landlordPan': landlordPans[key],
              'uploadedAt': '2027-01-16T10:00:00.000Z',
              'decidedAt': status == 'approved' || status == 'rejected'
                  ? '2027-01-19T10:00:00.000Z'
                  : null,
              'reason': status == 'rejected'
                  ? 'This certificate is for FY 2025–26. Upload the one for '
                        'FY 2026–27.'
                  : null,
            },
    };
  }

  static const _countedLabels = {
    'ppf': 'PPF',
    'elss': 'ELSS',
    'lifeInsurance': 'Life insurance',
    'healthSelf': 'Health insurance',
    'rentMonthly': 'Rent (HRA)',
    'homeLoanInterest': 'Home loan interest',
  };

  /// "What counted", as the server works it out: a sent proof up to the
  /// amount on it, the rest not proved.
  Map<String, dynamic> _counted(List<Map<String, dynamic>> items) {
    final rows = [
      for (final i in items)
        () {
          final year = i['yearPaise'] as int;
          final sent = i['status'] == 'uploaded' || i['status'] == 'approved';
          final amount = (i['proof'] as Map?)?['amountPaise'] as int? ?? 0;
          final proved = sent ? (amount < year ? amount : year) : 0;
          return {
            'item': i['item'],
            'label': _countedLabels[i['item']],
            'provedPaise': proved,
            'notProvedPaise': year - proved,
          };
        }(),
    ];
    int sum(String key) => rows.fold(0, (t, r) => t + (r[key] as int));
    return {
      'rows': rows,
      'provedPaise': sum('provedPaise'),
      'notProvedPaise': sum('notProvedPaise'),
      'pfPaise': 2160000,
    };
  }

  Map<String, dynamic> _proofs() {
    final items = regime == 'old'
        ? [for (final key in proofStatus.keys) _proofItem(key)]
        : <Map<String, dynamic>>[];
    final submitted = items
        .where((i) => i['status'] == 'uploaded' || i['status'] == 'approved')
        .length;
    final locked = proofsDueSet && proofsClosed;
    return {
      'fy': '2026-27',
      'regime': regime,
      'required': items.isNotEmpty,
      'dueOn': proofsDueSet ? '2027-01-31' : null,
      'notConfigured': !proofsDueSet,
      'missing': proofsDueSet ? <String>[] : ['proofsDue'],
      'locked': locked,
      'closed': locked
          ? {
              'closedOn': '2027-01-31',
              'submitted': submitted,
              'notSubmitted': items.length - submitted,
              'total': items.length,
              'lastPayPeriod': '2027-03',
              'itrDueOn': '2027-07-31',
              'counted': _counted(items),
            }
          : null,
      'itrDueOn': '2027-07-31',
      'summary': <String, dynamic>{},
      'sections': [
        for (final section in _proofSections)
          if (items.any((i) => i['section'] == section['key']))
            {
              ...section,
              'items': [
                for (final i in items)
                  if (i['section'] == section['key']) i,
              ],
            },
      ],
      'items': items,
    };
  }

  Map<String, dynamic> _payslips() {
    Map<String, dynamic> slip(
      String period,
      String paidAt,
      int lopDays,
      int net,
    ) => {
      'run': {
        'id': 'run-$period',
        'period': period,
        'status': 'paid',
        'paidAt': paidAt,
      },
      'payslip': {
        'id': 'slip-$period',
        'period': period,
        'employeeName': 'Tanvi',
        'employeeId': 'SW001',
        'designation': 'Designer',
        'department': 'Product',
        'earnings': [
          {
            'code': 'BASIC',
            'name': 'Basic',
            'fullPaise': 3600000,
            'paidPaise': lopDays > 0 ? 3360000 : 3600000,
          },
          {
            'code': 'HRA',
            'name': 'House rent allowance',
            'fullPaise': 1800000,
            'paidPaise': lopDays > 0 ? 1680000 : 1800000,
          },
          {
            'code': 'SPECIAL',
            'name': 'Special allowance',
            'fullPaise': 3600000,
            'paidPaise': lopDays > 0 ? 3360000 : 3600000,
          },
        ],
        'deductions': [
          {'key': 'epf', 'name': 'Provident fund', 'amountPaise': 180000},
          {
            'key': 'income_tax',
            'name': 'Income tax (TDS)',
            'amountPaise': 420000,
          },
          {'key': 'pt', 'name': 'Professional tax', 'amountPaise': 20000},
        ],
        'netPayablePaise': net,
        'reimbursementsPaise': 0,
        'inputs': {
          'workingDays': 31,
          'payableDays': 31 - lopDays,
          'lopDays': lopDays,
          'overtimePaise': overtimePaise,
          'attendanceDeductions': lopDays > 0
              ? [
                  {
                    'label': 'Missed punches',
                    'trigger': 'missed_punch',
                    'count': lopDays,
                    'days': lopDays,
                  },
                ]
              : <dynamic>[],
        },
      },
    };
    return {
      'success': true,
      'company': {'name': 'Sowaka', 'address': 'Bengaluru', 'org': 'sowaka'},
      'payslips': [
        slip('2026-09', '2026-09-30T12:00:00.000Z', 0, 8380000),
        slip('2026-08', '2026-08-31T12:00:00.000Z', 3, 7660000),
      ],
    };
  }
}

/// A client that sends multipart uploads to the fake server's own reader and
/// everything else through [MockClient].
class FakePayrollClient extends http.BaseClient {
  FakePayrollClient(this.server);

  final FakePayrollServer server;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final response = request is http.MultipartRequest
        ? await server.handleStreamed(request)
        : await server.client.send(request).then(http.Response.fromStream);
    return http.StreamedResponse(
      Stream.value(response.bodyBytes),
      response.statusCode,
      headers: response.headers,
      request: request,
    );
  }
}
