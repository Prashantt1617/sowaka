// PayrollApiService against docs/payroll-employee-api.md: what each call
// sends and how the replies are read, with a MockClient for the server.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/payroll/data/payroll_api_service.dart';
import 'package:mobile_app/features/payroll/data/payroll_models.dart';

import 'payroll_test_server.dart';

PayrollApiService _service(http.Client client) => PayrollApiService(
  session: payrollSession,
  baseUrl: 'http://localhost:4000',
  client: client,
);

void main() {
  test('reads the Payroll home: salary, to-dos and missing punches', () async {
    final server = FakePayrollServer();
    final home = await _service(server.client).fetchHome();
    expect(server.calls.single, 'GET /payroll/home');
    final salary = home.salary!;
    expect(salary.isEstimate, isTrue);
    expect(salary.grossPaise, 9000000);
    expect(salary.lopDays, 2);
    expect(salary.deductions.map((d) => d.key), ['epf', 'income_tax', 'pt']);
    expect(salary.takeHomePaise, 7780000);
    expect(home.todo.map((t) => t.kind), [
      'missing_punches',
      'flexible_split',
      'tax_regime',
      'investment_proofs',
    ]);
    expect(home.todo.first.count, 12);
    expect(home.missingPunches!.count, 12);
    expect(home.todo[1].effectiveFrom, DateTime(2026, 11));
  });

  test('sends the bearer token and a period when asked', () async {
    late http.Request seen;
    final client = MockClient((request) async {
      seen = request;
      return payrollJson({'success': true, 'period': '2026-09', 'todo': []});
    });
    await _service(client).fetchHome(period: '2026-09');
    expect(seen.headers['Authorization'], 'Bearer token');
    expect(seen.url.queryParameters, {'period': '2026-09'});
  });

  test('reviews and saves a split with the amounts in paise', () async {
    final server = FakePayrollServer();
    final service = _service(server.client);
    final split = await service.fetchSplit();
    expect(split.available, isTrue);
    expect(split.poolPaise, 600000);
    expect(split.components.map((c) => c.code), [
      'FUEL',
      'INTERNET',
      'TELEPHONE',
      'BOOKS',
    ]);
    expect(split.components.first.bills.rejected, 2);
    expect(split.window.closesOn, DateTime(2026, 11, 15));

    final amounts = {
      'FUEL': 300000,
      'INTERNET': 100000,
      'TELEPHONE': 150000,
      'BOOKS': 50000,
    };
    final review = await service.reviewSplit(amounts);
    expect(server.bodies['/payroll/split/review'], {'amounts': amounts});
    expect(review.totalPaise, 600000);
    expect(review.lines.last.isNew, isTrue);
    expect(review.monthlyTaxSavingPaise, 94000);

    await service.saveSplit(amounts, effectiveFrom: review.effectiveFrom);
    expect(server.bodies['/payroll/split'], {
      'amounts': amounts,
      'acknowledged': true,
      'effectiveFrom': '2026-11',
    });

    // The window moved on since the review: a 409 the screen re-reviews on.
    server.windowMonth = '2026-12';
    await expectLater(
      service.saveSplit(amounts, effectiveFrom: review.effectiveFrom),
      throwsA(
        isA<PayrollApiException>().having(
          (e) => e.isConflict,
          'conflict',
          true,
        ),
      ),
    );
  });

  test('saves a declaration without the read-only PF', () async {
    final server = FakePayrollServer();
    final service = _service(server.client);
    final declaration = await service.fetchDeclaration();
    expect(declaration.isOld, isTrue);
    expect(declaration.sections.first.capPaise, 15000000);
    expect(declaration.sections.first.items.first.readOnly, isTrue);
    expect(declaration.sections[3].capPaise, isNull);

    await service.saveDeclaration(
      regime: 'old',
      items: {'epf': 1, 'ppf': 6000000},
      fy: '2026-27',
    );
    expect(server.calls.last, 'PUT /payroll/tax-declaration?fy=2026-27');
    expect(server.bodies['/payroll/tax-declaration'], {
      'regime': 'old',
      'items': {'ppf': 6000000},
      'submit': true,
    });
  });

  test('uploads a proof as multipart with the amount on it', () async {
    late http.Request seen;
    final client = MockClient((request) async {
      seen = request;
      return payrollJson({
        'success': true,
        'item': {
          'item': 'lifeInsurance',
          'label': 'Life insurance',
          'section': '80C',
          'declaredPaise': 2840000,
          'status': 'uploaded',
          'proof': {
            'id': 'p1',
            'fileName': 'lic.pdf',
            'amountPaise': 2840000,
            'uploadedAt': '2027-01-16T10:00:00.000Z',
          },
        },
      });
    });
    final item = await _service(client).uploadProof(
      item: 'lifeInsurance',
      file: PayrollUpload(
        name: 'lic.pdf',
        bytes: Uint8List.fromList(utf8.encode('%PDF-1.4 test')),
      ),
      amountPaise: 2840000,
      fy: '2026-27',
    );
    expect(seen.method, 'POST');
    expect(seen.url.path, '/payroll/investment-proofs/lifeInsurance');
    expect(seen.url.queryParameters, {'fy': '2026-27'});
    expect(seen.headers['content-type'], startsWith('multipart/form-data'));
    final body = latin1.decode(seen.bodyBytes);
    expect(body, contains('name="proof"; filename="lic.pdf"'));
    expect(body, contains('content-type: application/pdf'));
    expect(body, contains('name="amountPaise"'));
    expect(body, contains('2840000'));
    expect(item.status, ProofStatus.uploaded);
    expect(item.proof!.fileName, 'lic.pdf');
  });

  test('reads proofs and their states', () async {
    final proofs = await _service(FakePayrollServer().client).fetchProofs();
    expect(proofs.required, isTrue);
    expect(proofs.count(ProofStatus.notUploaded), 2);
    expect(proofs.count(ProofStatus.rejected), 1);
    final rejected = proofs.items.firstWhere(
      (i) => i.status == ProofStatus.rejected,
    );
    expect(rejected.proof!.reason, contains('FY 2026–27'));
  });

  test('asks for a year of payslips and reads when each was paid', () async {
    final server = FakePayrollServer();
    final (company, slips) = await _service(server.client).fetchPayslips();
    expect(server.calls.single, 'GET /payslips/mine?limit=12');
    expect(company.name, 'Sowaka');
    expect(slips.map((s) => s.period), ['2026-09', '2026-08']);
    expect(slips.first.paidAt, isNotNull);
    expect(slips.last.lopDays, 3);
  });

  test('shows the server\'s own words, and plain ones otherwise', () async {
    Future<Object> failWith(int status, Map<String, dynamic> body) async {
      final client = MockClient((_) async => payrollJson(body, status));
      try {
        await _service(client).fetchSplit();
      } catch (error) {
        return error;
      }
      fail('expected an error');
    }

    final closed = await failWith(409, {
      'success': false,
      'message': 'The split can only be changed until 15 Nov.',
    });
    expect(
      payrollErrorText(closed),
      'The split can only be changed until 15 Nov.',
    );
    expect((closed as PayrollApiException).statusCode, 409);

    final missing = await failWith(404, {
      'success': false,
      'message': 'Route not found: /payroll/split',
    });
    expect(payrollErrorText(missing), PayrollApiException.unavailable);

    final crash = await failWith(500, {});
    expect(payrollErrorText(crash), PayrollApiException.failed);
  });
}
