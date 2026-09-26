// The payslip as a PDF, built here rather than from HTML: the printing
// plugin's HTML path needs a window it cannot find in this app and aborts.
// Mirrors the dashboard's slip — earnings at the full monthly rate, loss of
// pay as a deduction line with the rules behind it, net payable in words.
import 'dart:typed_data';

import 'package:flutter/services.dart' show rootBundle;
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import '../../manager/data/manager_models.dart';

const _ink = PdfColor.fromInt(0xFF222222);
const _muted = PdfColor.fromInt(0xFF6B7280);
const _line = PdfColor.fromInt(0xFFE5E7EB);
const _greenBg = PdfColor.fromInt(0xFFECFDF5);
const _greenLine = PdfColor.fromInt(0xFFD1FAE5);
const _green = PdfColor.fromInt(0xFF047857);
const _grey = PdfColor.fromInt(0xFFF5F5F7);

const _months = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const _monthsShort = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

String _monthLabel(String period) {
  final parts = period.split('-');
  final m = int.tryParse(parts.length > 1 ? parts[1] : '') ?? 1;
  return '${_months[(m - 1).clamp(0, 11)]} ${parts.first}';
}

String _dateLabel(String iso) {
  final d = DateTime.tryParse(iso);
  if (d == null) return '—';
  return '${d.day.toString().padLeft(2, '0')} ${_monthsShort[d.month - 1]} ${d.year}';
}

String _lastDayOf(String period) {
  final parts = period.split('-');
  final y = int.tryParse(parts.first) ?? 2026;
  final m = int.tryParse(parts.length > 1 ? parts[1] : '') ?? 1;
  final last = DateTime(y, m + 1, 0);
  return '${last.year}-${last.month.toString().padLeft(2, '0')}-${last.day.toString().padLeft(2, '0')}';
}

String _group(int rupees) {
  final s = rupees.abs().toString();
  if (s.length <= 3) return s;
  final head = s.substring(0, s.length - 3);
  final tail = s.substring(s.length - 3);
  final headGrouped = head.replaceAllMapped(
    RegExp(r'(\d)(?=(\d{2})+$)'),
    (m) => '${m[1]},',
  );
  return '$headGrouped,$tail';
}

const _ones = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const _tens = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
];
String _belowHundred(int n) => n < 20
    ? _ones[n]
    : '${_tens[n ~/ 10]}${n % 10 != 0 ? '-${_ones[n % 10]}' : ''}';
String _belowThousand(int n) => [
  if (n ~/ 100 > 0) '${_ones[n ~/ 100]} Hundred',
  if (n % 100 > 0) _belowHundred(n % 100),
].join(' ');

/// Indian grouping: crores, lakhs, thousands.
String rupeesInWords(int paise) {
  var n = (paise / 100).round();
  if (n == 0) return 'Indian Rupees Zero Only';
  final parts = <String>[];
  final crore = n ~/ 10000000;
  n %= 10000000;
  final lakh = n ~/ 100000;
  n %= 100000;
  final thousand = n ~/ 1000;
  n %= 1000;
  if (crore > 0) parts.add('${_belowThousand(crore)} Crore');
  if (lakh > 0) parts.add('${_belowHundred(lakh)} Lakh');
  if (thousand > 0) parts.add('${_belowHundred(thousand)} Thousand');
  if (n > 0) parts.add(_belowThousand(n));
  return 'Indian Rupees ${parts.join(' ')} Only';
}

String _days(double days) => days == days.roundToDouble()
    ? days.round().toString()
    : days.toStringAsFixed(1);

Future<Uint8List> buildPayslipPdf({
  required Payslip slip,
  required PayslipCompany company,
}) async {
  // The app's own face, with a rupee sign; Helvetica and "Rs" if the font
  // cannot be read.
  pw.Font? regular;
  pw.Font? bold;
  try {
    final data = await rootBundle.load(
      'assets/fonts/plus_jakarta_sans/PlusJakartaSans-Variable.ttf',
    );
    regular = pw.Font.ttf(data);
    bold = regular;
  } catch (_) {
    regular = null;
    bold = null;
  }
  final rupee = regular == null ? 'Rs ' : '₹';
  String inr(int paise) => '$rupee${_group((paise / 100).round())}';

  final base = pw.TextStyle(font: regular, fontSize: 10.5, color: _ink);
  final mutedStyle = base.copyWith(color: _muted);
  final strong = pw.TextStyle(
    font: bold,
    fontSize: 10.5,
    color: _ink,
    fontWeight: pw.FontWeight.bold,
  );
  final label = pw.TextStyle(
    font: regular,
    fontSize: 8,
    color: _muted,
    letterSpacing: 1,
  );

  final lopPaise = slip.lossOfPayPaise;
  final docked = slip.lines
      .where((l) => l.days > 0)
      .map((l) => '${l.name} ${l.count} → ${_days(l.days)}d')
      .join(' · ');
  final covered = slip.paidLeaveDaysApplied;
  final deductions = <(String, String?, int)>[
    if (slip.lopDays > 0)
      (
        'Loss of pay · ${_days(slip.lopDays)} ${slip.lopDays == 1 ? 'day' : 'days'}',
        [
          if (docked.isNotEmpty) docked,
          if (covered > 0)
            '${_days(covered)} ${covered == 1 ? 'day' : 'days'} covered by paid leave',
        ].join(' · '),
        lopPaise,
      ),
    for (final d in slip.deductions) (d.name, null, d.fullPaise),
  ];
  final totalDeductions = deductions.fold<int>(0, (t, d) => t + d.$3);
  final gross =
      slip.monthlyPaise + slip.overtimePaise + slip.reimbursementsPaise;

  pw.Widget kv(String k, String v) => pw.Padding(
    padding: const pw.EdgeInsets.symmetric(vertical: 3),
    child: pw.Row(
      mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
      children: [
        pw.Text(k, style: mutedStyle),
        pw.Text(v, style: base),
      ],
    ),
  );
  pw.Widget amountRow(
    String name,
    String? sub,
    String amount, {
    bool total = false,
  }) => pw.Container(
    padding: pw.EdgeInsets.symmetric(
      vertical: total ? 8 : 6,
      horizontal: total ? 8 : 0,
    ),
    decoration: total
        ? const pw.BoxDecoration(color: _grey)
        : const pw.BoxDecoration(
            border: pw.Border(bottom: pw.BorderSide(color: _line, width: 0.5)),
          ),
    child: pw.Row(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        pw.Expanded(
          child: pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              pw.Text(name, style: total ? strong : base),
              if (sub != null && sub.isNotEmpty)
                pw.Text(sub, style: mutedStyle.copyWith(fontSize: 8.5)),
            ],
          ),
        ),
        pw.Text(amount, style: total ? strong : base),
      ],
    ),
  );
  pw.Widget column(String heading, List<pw.Widget> rows) => pw.Expanded(
    child: pw.Column(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        pw.Container(
          padding: const pw.EdgeInsets.only(bottom: 6),
          decoration: const pw.BoxDecoration(
            border: pw.Border(bottom: pw.BorderSide(color: _line, width: 0.5)),
          ),
          child: pw.Row(
            mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
            children: [
              pw.Text(heading, style: label),
              pw.Text('AMOUNT', style: label),
            ],
          ),
        ),
        ...rows,
      ],
    ),
  );

  final doc = pw.Document(
    title: 'Payslip · ${slip.employeeName} · ${_monthLabel(slip.period)}',
  );
  doc.addPage(
    pw.Page(
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.all(36),
      theme: regular != null
          ? pw.ThemeData.withFont(base: regular, bold: bold)
          : null,
      build: (context) => pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          pw.Container(
            padding: const pw.EdgeInsets.only(bottom: 16),
            decoration: const pw.BoxDecoration(
              border: pw.Border(
                bottom: pw.BorderSide(color: _line, width: 0.5),
              ),
            ),
            child: pw.Row(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: [
                pw.Expanded(
                  child: pw.Column(
                    crossAxisAlignment: pw.CrossAxisAlignment.start,
                    children: [
                      pw.Text(
                        company.name,
                        style: pw.TextStyle(
                          font: bold,
                          fontSize: 19,
                          fontWeight: pw.FontWeight.bold,
                          color: _ink,
                        ),
                      ),
                      if (company.address.isNotEmpty)
                        pw.Text(company.address, style: mutedStyle),
                    ],
                  ),
                ),
                pw.Column(
                  crossAxisAlignment: pw.CrossAxisAlignment.end,
                  children: [
                    pw.Text('Payslip for the month', style: mutedStyle),
                    pw.Text(
                      _monthLabel(slip.period),
                      style: pw.TextStyle(
                        font: regular,
                        fontSize: 15,
                        color: _ink,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          pw.SizedBox(height: 18),
          pw.Row(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              pw.Expanded(
                flex: 5,
                child: pw.Column(
                  crossAxisAlignment: pw.CrossAxisAlignment.start,
                  children: [
                    pw.Text('EMPLOYEE SUMMARY', style: label),
                    pw.SizedBox(height: 6),
                    kv('Employee name', slip.employeeName),
                    kv(
                      'Employee ID',
                      slip.employeeId.isEmpty ? '—' : slip.employeeId,
                    ),
                    kv(
                      'Designation',
                      slip.designation.isEmpty ? '—' : slip.designation,
                    ),
                    if (slip.department.isNotEmpty)
                      kv('Department', slip.department),
                    kv('Date of joining', _dateLabel(slip.joiningDate)),
                    kv('Pay date', _dateLabel(_lastDayOf(slip.period))),
                  ],
                ),
              ),
              pw.SizedBox(width: 24),
              pw.Expanded(
                flex: 4,
                child: pw.Container(
                  decoration: pw.BoxDecoration(
                    border: pw.Border.all(color: _greenLine),
                    borderRadius: pw.BorderRadius.circular(8),
                  ),
                  child: pw.Column(
                    crossAxisAlignment: pw.CrossAxisAlignment.start,
                    children: [
                      pw.Container(
                        width: double.infinity,
                        padding: const pw.EdgeInsets.all(14),
                        decoration: const pw.BoxDecoration(
                          color: _greenBg,
                          borderRadius: pw.BorderRadius.vertical(
                            top: pw.Radius.circular(8),
                          ),
                        ),
                        child: pw.Column(
                          crossAxisAlignment: pw.CrossAxisAlignment.start,
                          children: [
                            pw.Text(
                              inr(slip.netPayablePaise),
                              style: pw.TextStyle(
                                font: bold,
                                fontSize: 22,
                                fontWeight: pw.FontWeight.bold,
                                color: _ink,
                              ),
                            ),
                            pw.Text(
                              'Total net pay',
                              style: base.copyWith(color: _green),
                            ),
                          ],
                        ),
                      ),
                      pw.Padding(
                        padding: const pw.EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 6,
                        ),
                        child: pw.Column(
                          children: [
                            kv('Paid days', '${slip.payableDays}'),
                            kv('Loss of pay days', _days(slip.lopDays)),
                            if (covered > 0)
                              kv('Covered by paid leave', _days(covered)),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          pw.SizedBox(height: 18),
          pw.Container(
            padding: const pw.EdgeInsets.only(top: 14),
            decoration: const pw.BoxDecoration(
              border: pw.Border(top: pw.BorderSide(color: _line, width: 0.5)),
            ),
            child: pw.Row(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: [
                column('EARNINGS', [
                  for (final e in slip.earnings)
                    amountRow(
                      e.name,
                      e.fullPaise != e.paidPaise
                          ? 'Monthly rate: ${inr(e.fullPaise)}'
                          : null,
                      inr(e.fullPaise),
                    ),
                  if (slip.overtimePaise > 0)
                    amountRow('Overtime', null, inr(slip.overtimePaise)),
                  if (slip.reimbursementsPaise > 0)
                    amountRow(
                      'Reimbursements',
                      null,
                      inr(slip.reimbursementsPaise),
                    ),
                  amountRow('Gross earnings', null, inr(gross), total: true),
                ]),
                pw.SizedBox(width: 28),
                column('DEDUCTIONS', [
                  if (deductions.isEmpty) amountRow('No deductions', null, '—'),
                  for (final d in deductions) amountRow(d.$1, d.$2, inr(d.$3)),
                  amountRow(
                    'Total deductions',
                    null,
                    inr(totalDeductions),
                    total: true,
                  ),
                ]),
              ],
            ),
          ),
          pw.SizedBox(height: 18),
          pw.Container(
            padding: const pw.EdgeInsets.symmetric(
              horizontal: 16,
              vertical: 12,
            ),
            decoration: pw.BoxDecoration(
              color: _greenBg,
              border: pw.Border.all(color: _greenLine),
              borderRadius: pw.BorderRadius.circular(8),
            ),
            child: pw.Row(
              children: [
                pw.Expanded(
                  child: pw.Column(
                    crossAxisAlignment: pw.CrossAxisAlignment.start,
                    children: [
                      pw.Text(
                        'Total net payable',
                        style: pw.TextStyle(
                          font: regular,
                          fontSize: 12,
                          color: _ink,
                        ),
                      ),
                      pw.Text(
                        'Gross ${inr(gross)} − deductions ${inr(totalDeductions)}',
                        style: mutedStyle,
                      ),
                    ],
                  ),
                ),
                pw.Text(
                  inr(slip.netPayablePaise),
                  style: pw.TextStyle(
                    font: bold,
                    fontSize: 20,
                    fontWeight: pw.FontWeight.bold,
                    color: _ink,
                  ),
                ),
              ],
            ),
          ),
          pw.SizedBox(height: 10),
          pw.Align(
            alignment: pw.Alignment.centerRight,
            child: pw.RichText(
              text: pw.TextSpan(
                children: [
                  pw.TextSpan(text: 'Amount in words: ', style: mutedStyle),
                  pw.TextSpan(
                    text: rupeesInWords(slip.netPayablePaise),
                    style: base,
                  ),
                ],
              ),
            ),
          ),
          pw.Spacer(),
          pw.Container(
            width: double.infinity,
            padding: const pw.EdgeInsets.only(top: 12),
            decoration: const pw.BoxDecoration(
              border: pw.Border(top: pw.BorderSide(color: _line, width: 0.5)),
            ),
            child: pw.Text(
              'This is a system generated document and does not require a signature.',
              textAlign: pw.TextAlign.center,
              style: mutedStyle.copyWith(fontSize: 8.5),
            ),
          ),
        ],
      ),
    ),
  );
  return doc.save();
}
