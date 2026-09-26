import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/manager/data/manager_models.dart';
import 'package:mobile_app/features/quick_actions/data/payslip_pdf.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('a payslip renders to a PDF with its loss of pay on it', () async {
    final slip = Payslip.fromJson(
      {'period': '2026-08', 'status': 'draft'},
      {
        'id': 'x',
        'period': '2026-08',
        'employeeName': 'Aakash Arora',
        'employeeId': '304',
        'designation': 'Staff',
        'department': 'Not Specified',
        'joiningDate': '2024-10-07',
        'earnings': [
          {'name': 'Basic', 'fullPaise': 2500000, 'paidPaise': 1129000},
        ],
        'deductions': [],
        'netPayablePaise': 1129000,
        'reimbursementsPaise': 0,
        'inputs': {
          'workingDays': 31,
          'lopDays': 17,
          'payableDays': 14,
          'overtimePaise': 0,
          'paidLeaveDaysApplied': 1,
          'attendanceDeductions': [
            {
              'label': 'Absent days',
              'count': 12,
              'days': 12,
              'trigger': 'absent',
              'every': 1,
              'deductDays': 1,
            },
            {
              'label': 'Half days (single punch counts)',
              'count': 12,
              'days': 6,
              'trigger': 'half_day',
              'every': 2,
              'deductDays': 1,
            },
          ],
        },
      },
    );
    final bytes = await buildPayslipPdf(
      slip: slip,
      company: const PayslipCompany(
        name: 'ACMT Group of Colleges',
        address: '',
      ),
    );
    expect(String.fromCharCodes(bytes.take(5)), '%PDF-');
    expect(bytes.length, greaterThan(2000));
    expect(
      rupeesInWords(1129000),
      'Indian Rupees Eleven Thousand Two Hundred Ninety Only',
    );
    expect(slip.lines.map((l) => l.name), ['Absent days', 'Half days']);
  });
}
