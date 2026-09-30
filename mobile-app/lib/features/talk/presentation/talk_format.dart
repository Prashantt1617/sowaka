/// Dates and times as the Talk screens say them, in the phone's own zone.
const _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const _months = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

String weekdayShort(DateTime at) => _weekdays[at.weekday - 1];

/// 'Tue, 30 Sep'
String talkDate(DateTime at) {
  final local = at.toLocal();
  return '${weekdayShort(local)}, ${local.day} ${_months[local.month - 1]}';
}

/// '10:00 am'
String talkTime(DateTime at) {
  final local = at.toLocal();
  final hour12 = local.hour % 12 == 0 ? 12 : local.hour % 12;
  final minute = local.minute.toString().padLeft(2, '0');
  return '$hour12:$minute ${local.hour < 12 ? 'am' : 'pm'}';
}

/// '10:00 – 10:50 am'
String talkRange(DateTime start, DateTime end) {
  final s = start.toLocal();
  final e = end.toLocal();
  final sameHalf = (s.hour < 12) == (e.hour < 12);
  final startText = sameHalf
      ? '${s.hour % 12 == 0 ? 12 : s.hour % 12}:${s.minute.toString().padLeft(2, '0')}'
      : talkTime(s);
  return '$startText – ${talkTime(e)}';
}

/// 'YYYY-MM-DD' for the server, from a local calendar day.
String isoDay(DateTime at) {
  final local = at.toLocal();
  final month = local.month.toString().padLeft(2, '0');
  final day = local.day.toString().padLeft(2, '0');
  return '${local.year}-$month-$day';
}
