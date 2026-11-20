// The onboarding home in each of the new-joiner prototype's phases (Main ·
// day1 … confirmed), as the server's GET /lifecycle/onboarding/home sends
// it: the shapes of backend/src/services/lifecycle/appOnboarding.ts, with
// placeholder people. Shared by lifecycle_home_tiles_test.dart and the
// screenshots in test/screenshots/nj_l2_screens_test.dart.
import 'package:mobile_app/features/lifecycle/onboarding/data/onboarding_models.dart';

/// Tj: Tue 1 Dec 2026, as the prototype's demo.
final njTj = DateTime(2026, 12, 1);

enum NjPhase { day1, day1Later, week1, month1, months, last, confirmed }

/// "Now" in each phase.
DateTime njNow(NjPhase p) => switch (p) {
  NjPhase.day1 => DateTime(2026, 12, 1, 9, 30),
  NjPhase.day1Later => DateTime(2026, 12, 1, 11, 0),
  NjPhase.week1 => DateTime(2026, 12, 3, 10),
  NjPhase.month1 => DateTime(2026, 12, 15, 10),
  NjPhase.months => DateTime(2027, 2, 10, 10),
  NjPhase.last => DateTime(2027, 5, 10, 10),
  NjPhase.confirmed => DateTime(2027, 6, 2, 10),
};

Map<String, dynamic> _row(
  String id,
  String title, {
  String? systemKey,
  String phase = 'first_week',
  String status = 'todo',
  String ownerRole = 'employee',
  String? ownerName,
  String kind = 'form',
  int? month,
  DateTime? dueAt,
  DateTime? opensAt,
  bool readOnly = false,
  Map<String, int>? progress,
}) => {
  'id': id,
  'title': title,
  'systemKey': ?systemKey,
  'phase': phase,
  'ownerRole': ownerRole,
  'ownerName': ?ownerName,
  'kind': kind,
  'surface': 'app',
  'mustDo': false,
  'status': status,
  'late': false,
  'month': ?month,
  if (dueAt != null) 'dueAt': dueAt.toIso8601String(),
  if (opensAt != null) 'opensAt': opensAt.toIso8601String(),
  if (status == 'done') 'doneAt': njTj.toIso8601String(),
  if (readOnly) 'readOnly': true,
  'progress': ?progress,
};

const _journey = [
  {'key': 'pre_boarding', 'label': 'Pre-boarding', 'state': 'done'},
  {'key': 'welcome_week1', 'label': 'Week 1', 'state': 'current'},
  {'key': 'settling_in', 'label': 'Month 1', 'state': 'todo'},
  {'key': 'growing_gains', 'label': 'Months 2–5', 'state': 'todo'},
  {'key': 'final_month', 'label': 'Final month', 'state': 'todo'},
  {'key': 'ready_to_perform', 'label': 'Confirmed', 'state': 'todo'},
];

/// The home's JSON in [p]. [profileDone]: the portal's sections done (of 7).
Map<String, dynamic> njHomeJson(NjPhase p, {int? profileDone}) {
  DateTime day(int n, [int hour = 0]) => njTj.add(Duration(days: n, hours: hour));
  final after = p.index;
  bool past(NjPhase q) => after > q.index;
  String st(NjPhase doneBy, {bool locked = false}) => past(doneBy) ? 'done' : (locked ? 'locked' : 'todo');
  final rows = <Map<String, dynamic>>[
    // Day 1's meetings.
    _row('welcome', 'Welcome and induction', systemKey: 'welcome_induction', kind: 'meeting', ownerRole: 'hr', ownerName: 'Hema Kapoor', readOnly: true,
        dueAt: day(0, 10), status: p == NjPhase.day1 ? 'todo' : 'done'),
    _row('mgr', 'Meet your manager', systemKey: 'meet_manager', kind: 'meeting', ownerRole: 'manager_employee', ownerName: 'Meera Iyer', dueAt: day(0, 11), status: st(NjPhase.day1Later)),
    _row('buddy', 'Meet your buddy', kind: 'meeting', ownerName: 'Arjun Shah', dueAt: day(0, 15), status: st(NjPhase.day1Later)),
    // Week 1's.
    _row('it', 'IT helpdesk', kind: 'meeting', ownerName: 'Imran Khan', dueAt: day(2, 11), status: st(NjPhase.week1)),
    _row('payroll', 'Payroll', kind: 'meeting', ownerName: 'Kiran Bisht', dueAt: day(3, 12), status: st(NjPhase.week1)),
    // Tasks.
    _row('tax', 'Declare your tax and investments', systemKey: 'week1_reels', dueAt: day(5), status: st(NjPhase.week1), progress: p == NjPhase.week1 ? {'done': 2, 'total': 4} : null),
    _row('intro', 'Post your intro', systemKey: 'intro_post', kind: 'post', dueAt: day(3), status: st(NjPhase.week1)),
    _row('nominees', 'Add your nominees', dueAt: day(5), status: st(NjPhase.month1)),
    _row('day7', 'Day-7 survey', systemKey: 'day7_survey', kind: 'survey', opensAt: day(6), dueAt: day(7), status: past(NjPhase.week1) ? 'done' : 'locked'),
    // Month 1.
    _row('posh', 'Complete POSH training', phase: 'probation', month: 1, dueAt: day(25), status: past(NjPhase.month1) ? 'done' : 'todo'),
    _row('self1', 'Your self check-in', phase: 'probation', month: 1, opensAt: day(20), dueAt: day(29), status: past(NjPhase.month1) ? 'done' : (after >= NjPhase.month1.index ? 'todo' : 'locked')),
    _row('chk1', 'Month-1 check-in', systemKey: 'monthly_checkin', phase: 'probation', month: 1, kind: 'checkin', ownerRole: 'manager_employee', ownerName: 'Meera Iyer',
        opensAt: day(24), dueAt: day(30), status: past(NjPhase.month1) ? 'done' : (after >= NjPhase.month1.index ? 'todo' : 'locked')),
    // Months 2–5.
    _row('chk3', 'Month-3 check-in', systemKey: 'monthly_checkin', phase: 'probation', month: 3, kind: 'checkin', ownerRole: 'manager_employee', ownerName: 'Meera Iyer',
        opensAt: DateTime(2027, 2, 22), dueAt: DateTime(2027, 2, 28), status: past(NjPhase.months) ? 'done' : (after >= NjPhase.months.index ? 'todo' : 'locked')),
    _row('pulse', 'Month-3 pulse survey', systemKey: 'pulse_survey', phase: 'probation', month: 3, kind: 'survey',
        opensAt: DateTime(2027, 2, 1), status: past(NjPhase.months) ? 'done' : (after >= NjPhase.months.index ? 'todo' : 'locked')),
    // The final month.
    _row('review', 'Your self-review', phase: 'probation', month: 6, opensAt: DateTime(2027, 5, 1), status: past(NjPhase.last) ? 'done' : (after >= NjPhase.last.index ? 'todo' : 'locked')),
    _row('confirm', 'Confirmation discussion', systemKey: 'confirmation_discussion', phase: 'probation', month: 6, kind: 'review', ownerRole: 'hr_manager', ownerName: 'Meera Iyer',
        opensAt: DateTime(2027, 5, 1), dueAt: DateTime(2027, 5, 31), status: past(NjPhase.last) ? 'done' : (after >= NjPhase.last.index ? 'todo' : 'locked')),
    if (p == NjPhase.confirmed)
      _row('letter', 'Read your confirmation letter', systemKey: 'confirmation_reveal', phase: 'probation', ownerRole: 'automatic', status: 'todo'),
  ];
  final done = [for (final r in rows) if (r['status'] == 'done') r];
  final locked = [for (final r in rows) if (r['status'] == 'locked') r];
  final open = [for (final r in rows) if (r['status'] == 'todo') r];
  final day1 = p == NjPhase.day1 || p == NjPhase.day1Later;
  final sections = [
    ('personal', 'Personal details'),
    ('contact', 'Contact and address'),
    ('emergency', 'Emergency contact'),
    ('bank', 'Bank account and PF'),
    ('education', 'Education and experience'),
    ('ids', 'ID documents (Aadhaar, PAN)'),
    ('photo', 'Photo'),
  ];
  final pDone = profileDone ?? (day1 ? 2 : 4);
  return {
    'journeyId': 'j1',
    'stage': switch (p) {
      NjPhase.day1 || NjPhase.day1Later || NjPhase.week1 => 'welcome_week1',
      NjPhase.month1 => 'settling_in',
      NjPhase.months => 'growing_gains',
      NjPhase.last => 'final_month',
      NjPhase.confirmed => 'ready_to_perform',
    },
    if (p == NjPhase.months) 'dayLabel': 'Month 3',
    'tj': '2026-12-01',
    'plant': {'stage': switch (p) { NjPhase.month1 => 2, NjPhase.months => 3, NjPhase.last => 4, NjPhase.confirmed => 5, _ => 1 }, 'leaves': 0},
    'today': [...open, ...locked.where((r) => r['phase'] == 'first_week')],
    'later': [...locked.where((r) => r['phase'] != 'first_week')],
    'done': done,
    'journey': _journey,
    'firstPunch': {if (p != NjPhase.day1) 'at': day(0, 9).toIso8601String(), 'faceEnrolled': true},
    'tour': {
      'lessons': ['punch', 'missed', 'leave', 'overtime'],
      'done': switch (p) {
        NjPhase.day1 => <String>[],
        NjPhase.day1Later => ['punch'],
        NjPhase.week1 => ['punch', 'missed'],
        _ => ['punch', 'missed', 'leave', 'overtime'],
      },
    },
    'devices': [
      {'key': 'laptop', 'title': 'Laptop', 'ready': true},
      {'key': 'email', 'title': 'Email', 'ready': p != NjPhase.day1},
      {'key': 'app', 'title': 'Sowaka Connect', 'ready': true},
      {'key': 'access', 'title': 'Admissions CRM access', 'ready': !day1},
    ],
    'companyName': 'Sowaka',
    'watch': [
      {'id': 'manager_note', 'title': 'A hello from Meera Iyer', 'videoUrl': '/portal/media/x.y', 'seen': false},
      {'id': 'company_video', 'title': 'Life at Sowaka', 'videoUrl': 'https://videos.sowaka.test/life.mp4', 'seen': false},
    ],
    'profile': {
      'sections': [for (final (i, (k, t)) in sections.indexed) {'key': k, 'title': t, 'done': i < pDone}],
      'done': pDone,
      'total': 7,
    },
  };
}

OnboardingHome njHome(NjPhase p, {int? profileDone}) => OnboardingHome.fromJson(njHomeJson(p, profileDone: profileDone));
