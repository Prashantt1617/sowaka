part of 'quick_actions_screen.dart';

// Stand-ins for the pages the revamped Payroll home opens, built on their own
// branches (R2–R6). Each shows only its title; delete this file when they land.

class _PayrollRevStub extends StatelessWidget {
  const _PayrollRevStub({required this.title, required this.stubKey});

  final String title;
  final String stubKey;

  @override
  Widget build(BuildContext context) => _payrollPage(
    context,
    key: ValueKey(stubKey),
    title: title,
    children: const [],
  );
}

/// R2 · Salary summary.
class _SalarySummaryPage extends StatelessWidget {
  const _SalarySummaryPage();

  @override
  Widget build(BuildContext context) =>
      const _PayrollRevStub(title: 'Salary summary', stubKey: 'payroll-r2');
}

/// R3 · Tax summary.
class _TaxSummaryPage extends StatelessWidget {
  const _TaxSummaryPage();

  @override
  Widget build(BuildContext context) =>
      const _PayrollRevStub(title: 'Tax summary', stubKey: 'payroll-r3');
}

/// R4 · Earnings.
class _EarningsPage extends StatelessWidget {
  const _EarningsPage();

  @override
  Widget build(BuildContext context) =>
      const _PayrollRevStub(title: 'Earnings', stubKey: 'payroll-r4');
}

/// R5 · Downloads.
class _DownloadsPage extends StatelessWidget {
  const _DownloadsPage();

  @override
  Widget build(BuildContext context) =>
      const _PayrollRevStub(title: 'Downloads', stubKey: 'payroll-r5');
}

/// R6 · EPF.
class _EpfPage extends StatelessWidget {
  const _EpfPage();

  @override
  Widget build(BuildContext context) =>
      const _PayrollRevStub(title: 'EPF', stubKey: 'payroll-r6');
}
