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
  };
  static const _names = {
    'FUEL': 'Fuel & vehicle',
    'INTERNET': 'Internet',
    'TELEPHONE': 'Telephone',
    'BOOKS': 'Books & periodicals',
  };
  static const pool = 600000;
  bool splitOpen = true;

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
          'monthlyTaxSavingPaise': 94000,
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
      return payrollJson({'success': true, 'item': _proofItem(item)});
    }
    return handle(request as http.Request);
  }

  Map<String, dynamic> _home() => {
    'success': true,
    'period': period,
    'fy': '2026-27',
    'hasSalaryStructure': true,
    'salary': {
      'period': period,
      'status': 'estimate',
      'payslipId': null,
      'grossPaise': 9000000,
      'lopDays': 2,
      'lopPaise': 600000,
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
    'missingPunches': {
      'period': period,
      'count': missingCount,
      'fixBy': _monthEnd,
      'locked': false,
    },
    'split': null,
    'declaration': {
      'fy': '2026-27',
      'regime': 'new',
      'chosen': false,
      'status': 'not_started',
      'locked': false,
      'dueOn': '2026-11-30',
    },
  };

  Map<String, dynamic> _split() {
    final assigned = split.values.fold(0, (a, b) => a + b);
    return {
      'available': true,
      'poolPaise': pool,
      'assignedPaise': assigned,
      'unassignedPaise': pool - assigned,
      'components': [
        for (final code in split.keys)
          {
            'code': code,
            'name': _names[code],
            'limitPaise': _limits[code],
            'amountPaise': split[code],
            'stepPaise': 50000,
            'bills': code == 'FUEL'
                ? {'approved': 4, 'inReview': 1, 'rejected': 2}
                : {'approved': 7, 'inReview': 0, 'rejected': 0},
          },
      ],
      'current': {
        'effectiveFrom': '2026-04',
        'submittedAt': '2026-04-10T09:12:00.000Z',
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

  Map<String, dynamic> _proofItem(String key) {
    final (label, section, declared) = _proofLabels[key]!;
    final status = proofStatus[key]!;
    return {
      'item': key,
      'label': label,
      'section': section,
      'declaredPaise': declared,
      'status': status,
      'proof': status == 'not_uploaded'
          ? null
          : {
              'id': 'proof-$key',
              'fileName': '$key-proof.pdf',
              'contentType': 'application/pdf',
              'size': 182311,
              'amountPaise': declared,
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

  Map<String, dynamic> _proofs() => {
    'fy': '2026-27',
    'regime': regime,
    'required': regime == 'old',
    'dueOn': '2027-01-31',
    'locked': false,
    'summary': <String, dynamic>{},
    'items': regime == 'old'
        ? [for (final key in proofStatus.keys) _proofItem(key)]
        : <dynamic>[],
  };

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
