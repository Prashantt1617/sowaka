// The new-joiner prototype's Meetings, a meeting, Your team and Tasks, as
// the server sends them (backend joinerMeetings.ts and onboardingHome):
// Day 1, Week 1 and Month 1 homes for the widget tests and the PNGs.
import 'package:mobile_app/features/lifecycle/onboarding/data/joiner_meetings_api.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/onboarding_models.dart';

/// Joining day Tue 1 Dec 2026.
final njTj = DateTime(2026, 12, 1);

const njJourney = [
  {'key': 'pre_boarding', 'label': 'Pre-boarding', 'state': 'done'},
  {'key': 'welcome_week1', 'label': 'Week 1', 'state': 'current'},
  {'key': 'settling_in', 'label': 'Month 1', 'state': 'todo'},
  {'key': 'growing_gains', 'label': 'Months 2–5', 'state': 'todo'},
  {'key': 'final_month', 'label': 'Final month', 'state': 'todo'},
  {'key': 'ready_to_perform', 'label': 'Confirmed', 'state': 'todo'},
];

Map<String, dynamic> njRow(
  String id,
  String title, {
  String kind = 'form',
  String ownerRole = 'employee',
  String phase = 'first_week',
  String status = 'todo',
  String? systemKey,
  String? helper,
  DateTime? dueAt,
  DateTime? opensAt,
  int? month,
  bool readOnly = false,
  String? withName,
  List<String>? agenda,
  bool? canTick,
  List<String>? myNotes,
  Map<String, int>? progress,
  String? opens,
}) => {
  'id': id,
  'title': title,
  'systemKey': ?systemKey,
  'phase': phase,
  'ownerRole': ownerRole,
  'kind': kind,
  'surface': 'app',
  'mustDo': false,
  'status': status,
  'late': false,
  'helper': ?helper,
  if (dueAt != null) 'dueAt': dueAt.toIso8601String(),
  if (opensAt != null) 'opensAt': opensAt.toIso8601String(),
  'month': ?month,
  if (readOnly) 'readOnly': true,
  'withName': ?withName,
  'agenda': ?agenda,
  'canTick': ?canTick,
  'myNotes': ?myNotes,
  'progress': ?progress,
  'opens': ?opens,
};

const _hrAgenda = ['Your ID card and documents', 'Working hours and attendance', 'Payroll and your tax declaration', 'Who to ask for what'];
const _mgrAgenda = ['What a good first month looks like', 'How you’ll work together', 'Your first goals', 'Who to meet first'];
const _buddyAgenda = ['How the team works day to day', 'Tools and shortcuts', 'Where people have lunch', 'Anything you’re unsure about'];
const _checkinAgenda = ['Progress on this month’s goals', 'Feedback both ways', 'Goals for next month'];

Map<String, dynamic> _hr({String status = 'todo'}) => njRow('ind', 'Welcome and induction', kind: 'meeting', ownerRole: 'hr', systemKey: 'welcome_induction', status: status, dueAt: njTj, readOnly: true, withName: 'Ritu Sharma', agenda: _hrAgenda, canTick: false);
Map<String, dynamic> _mgr({String status = 'todo', List<String>? notes}) => njRow('mm', 'Meet your manager', kind: 'meeting', ownerRole: 'manager_employee', systemKey: 'meet_manager', status: status, dueAt: njTj, withName: 'Sunny Kapoor', agenda: _mgrAgenda, canTick: status == 'todo', myNotes: notes);
Map<String, dynamic> _buddy({String status = 'todo'}) => njRow('team:buddy_meet', 'Your buddy', kind: 'meeting', ownerRole: 'buddy', status: status, dueAt: njTj, withName: 'Meera Joshi', agenda: _buddyAgenda, canTick: status == 'todo');
Map<String, dynamic> _it({String status = 'todo'}) => njRow('person:p-it', 'IT helpdesk', kind: 'meeting', status: status, dueAt: DateTime(2026, 12, 4), withName: 'Imran Khan', agenda: const ['Laptop and login problems', 'How to ask for a new access'], canTick: status == 'todo');
Map<String, dynamic> _payroll() => njRow('person:p-pay', 'Payroll', kind: 'meeting', dueAt: DateTime(2026, 12, 5), withName: 'Kiran Bisht', agenda: const ['Your salary structure', 'Tax regime and investment proofs'], canTick: true);
Map<String, dynamic> _chk1({String status = 'locked'}) => njRow('chk1', 'Month-1 check-in', kind: 'checkin', ownerRole: 'manager_employee', systemKey: 'monthly_checkin', phase: 'probation', month: 1, status: status, opensAt: DateTime(2026, 12, 25), withName: 'Sunny Kapoor', agenda: _checkinAgenda, canTick: false);

Map<String, dynamic> _tax({Map<String, int>? progress}) => njRow('tax', 'Declare your tax and investments', helper: 'Pick a tax regime first', dueAt: njTj, progress: progress);
Map<String, dynamic> _pol(int done) => njRow('policies', 'Acknowledge policies', kind: 'ack', dueAt: njTj, progress: {'done': done, 'total': 3}, opens: 'policies', status: done == 3 ? 'done' : 'todo');
Map<String, dynamic> _nominees() => njRow('nominees', 'Add your nominees', helper: 'Insurance and PF', dueAt: DateTime(2026, 12, 5));
Map<String, dynamic> _intro() => njRow('intro', 'Post your intro', systemKey: 'intro_post', kind: 'post', helper: 'On Connect', dueAt: DateTime(2026, 12, 4));
Map<String, dynamic> _posh({String status = 'todo'}) => njRow('posh', 'Complete POSH training', phase: 'probation', month: 1, helper: '20 min', status: status);

/// Day 1, morning: HR, the manager and the buddy to meet; IT later this week.
OnboardingHome njDay1({bool managerMet = false, List<String>? notes}) => OnboardingHome.fromJson({
  'journeyId': 'j1',
  'stage': 'welcome_week1',
  'dayLabel': 'Day 1',
  'tj': '2026-12-01',
  'plant': {'stage': 1},
  'today': [_hr(), if (!managerMet) _mgr(notes: notes), _buddy(), _it(), _tax(), _pol(0), _nominees(), _intro(), _posh()],
  'later': [_chk1()],
  'done': [if (managerMet) _mgr(status: 'done', notes: notes)],
  'journey': njJourney,
});

/// Week 1, day 3: IT met, Payroll to meet, Month 1 locked ahead.
OnboardingHome njWeek1() => OnboardingHome.fromJson({
  'journeyId': 'j1',
  'stage': 'welcome_week1',
  'dayLabel': 'Week 1',
  'tj': '2026-12-01',
  'plant': {'stage': 1},
  'today': [_payroll(), _tax(progress: {'done': 1, 'total': 2}), _pol(1), _intro(), _nominees(), _posh()],
  'later': [_chk1(), njRow('self1', 'Your self check-in', phase: 'probation', month: 1, helper: 'Before you meet Sunny', status: 'locked', opensAt: DateTime(2026, 12, 20))],
  'done': [_hr(status: 'done'), _mgr(status: 'done'), _buddy(status: 'done'), _it(status: 'done')],
  'journey': njJourney,
});

/// Month 1: nominees left over from Week 1, the month's goals and check-in.
OnboardingHome njMonth1() => OnboardingHome.fromJson({
  'journeyId': 'j1',
  'stage': 'settling_in',
  'dayLabel': 'Month 1',
  'tj': '2026-12-01',
  'plant': {'stage': 2},
  'today': [
    _nominees(),
    _chk1(status: 'todo'),
    njRow('crm', 'Handle 20 enquiries on your own', kind: 'assign', systemKey: 'starter_task', phase: 'probation', month: 1, progress: {'done': 12, 'total': 20}),
    njRow('tours', 'Shadow 3 campus tours', kind: 'assign', systemKey: 'starter_task', phase: 'probation', month: 1, progress: {'done': 1, 'total': 3}),
    njRow('self1', 'Your self check-in', phase: 'probation', month: 1, helper: 'Before you meet Sunny'),
    _posh(),
    njRow('s30', '30-day survey', kind: 'survey', phase: 'probation', month: 1, helper: '2 min'),
  ],
  'later': <Map<String, dynamic>>[],
  'done': [
    njRow('learn', 'Learn the admissions CRM', kind: 'assign', systemKey: 'starter_task', phase: 'probation', month: 1, status: 'done'),
    _hr(status: 'done'), _mgr(status: 'done'), _buddy(status: 'done'), _it(status: 'done'),
    _tax(), _pol(3), _intro(),
  ].map((r) => {...r, 'status': 'done'}).toList(),
  'journey': njJourney,
});

const njTeam = JoinerTeam(
  department: 'Admissions',
  people: [
    TeamPerson(userId: 'sk', name: 'Sunny Kapoor', designation: 'Admissions lead', tag: 'manager'),
    TeamPerson(userId: 'mj', name: 'Meera Joshi', designation: 'Senior counsellor', tag: 'buddy'),
    TeamPerson(userId: 'ro', name: 'Rohit Shah', designation: 'Counsellor'),
    TeamPerson(userId: 'nr', name: 'Nisha Rao', designation: 'Admissions coordinator'),
    TeamPerson(userId: 'fa', name: 'Farah Ansari', designation: 'Counsellor'),
    TeamPerson(userId: 'dv', name: 'Dev Varma', designation: 'Outreach executive'),
  ],
);

/// The Meetings writes and Your team, remembered.
class FakeMeetingsSource implements JoinerMeetingsSource {
  FakeMeetingsSource({this.team = njTeam, this.onMet});

  JoinerTeam team;
  void Function(String rowId)? onMet;
  final met = <String>[];
  final notes = <String, List<String>>{};

  @override
  Future<void> markMet(String rowId) async {
    met.add(rowId);
    onMet?.call(rowId);
  }

  @override
  Future<void> saveNotes(String rowId, List<String> list) async => notes[rowId] = list;

  @override
  Future<JoinerTeam> fetchTeam() async => team;

  @override
  Future<JoinerTeam?> keptTeam() async => null;
}
