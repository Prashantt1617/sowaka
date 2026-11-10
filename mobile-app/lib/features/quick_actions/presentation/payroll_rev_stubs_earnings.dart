part of 'quick_actions_screen.dart';

// A placeholder for the salary summary page another branch builds, so
// Earnings' estimate row has somewhere to go. Removed at merge.
class _SalarySummaryPage extends StatelessWidget {
  const _SalarySummaryPage();

  @override
  Widget build(BuildContext context) => _payrollPage(
    context,
    key: const ValueKey('payroll-salary-summary'),
    title: 'Salary summary',
    children: const [],
  );
}
