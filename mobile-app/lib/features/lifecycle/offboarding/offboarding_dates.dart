/// How the offboarding screens write dates: "Sun, 1 Nov 2026", "Thu, 31 Dec",
/// "1 Nov", and the notice countdown.
library;

const _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const _months = [
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

DateTime dayOnly(DateTime value) =>
    DateTime(value.year, value.month, value.day);

/// "1 Nov".
String shortDay(DateTime day) => '${day.day} ${_months[day.month - 1]}';

/// "Thu, 31 Dec".
String weekdayDay(DateTime day) =>
    '${_weekdays[day.weekday - 1]}, ${shortDay(day)}';

/// "Sun, 1 Nov 2026".
String fullDay(DateTime day) => '${weekdayDay(day)} ${day.year}';

/// "31 Dec 2026".
String dayMonthYear(DateTime day) => '${shortDay(day)} ${day.year}';

/// 'YYYY-MM-DD'.
String dateKey(DateTime day) =>
    '${day.year.toString().padLeft(4, '0')}-'
    '${day.month.toString().padLeft(2, '0')}-'
    '${day.day.toString().padLeft(2, '0')}';

/// Whole days from [from] to [to], by the calendar.
int daysBetween(DateTime from, DateTime to) => DateTime.utc(
  to.year,
  to.month,
  to.day,
).difference(DateTime.utc(from.year, from.month, from.day)).inDays;

/// "17 days to go", "1 day to go", "Last day today".
String daysToGoLabel(int days) => switch (days) {
  <= 0 => 'Last day today',
  1 => '1 day to go',
  _ => '$days days to go',
};

/// How far through the notice today is, 0 to 1.
double noticeProgress(DateTime? from, DateTime? to, DateTime today) {
  if (from == null || to == null) return 0;
  final total = daysBetween(from, to);
  if (total <= 0) return 1;
  return (daysBetween(from, today) / total).clamp(0.0, 1.0);
}
