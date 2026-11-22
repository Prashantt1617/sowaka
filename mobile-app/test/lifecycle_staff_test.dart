import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/onboarding_models.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/staff_api.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/staff/staff_screens.dart';
import 'package:mobile_app/features/lifecycle/onboarding/presentation/staff/staff_task_screens.dart';

/// HR and IT & admin in the app (Onboarding · Final designs, canvas page 4:
/// HRProto / ITProto, HROnboarding, HRAll, HRPerson, HRProfile, HRPayroll,
/// HRForm, HRKit, HRLetter, ITOnboarding, ITPerson, ITAccess). The fixtures
/// are the shapes `/lifecycle/staff/*` answers (FINAL-DESIGNS.md §4.4).

Map<String, dynamic> _person(String id, String name, String step, String pill, String tone) => {
  'journeyId': id, 'name': name, 'initials': name.split(' ').map((p) => p[0]).join(), 'stepLabel': step, 'pill': {'text': pill, 'tone': tone},
};

Map<String, dynamic> _onboarding({String as = 'hr'}) {
  final priya = _person('j1', 'Priya Shah', 'Week 1', '3 late', 'red');
  final sana = _person('j2', 'Sana Khan', 'Month 2', 'Due today', 'amber');
  return {
    'viewingAs': as,
    'canSwitch': false,
    'cards': [
      {'key': 'joining_soon', 'title': 'Joining soon', 'count': 0, 'late': 0, 'people': []},
      {'key': 'week1', 'title': 'Week 1', 'count': 1, 'late': 1, 'people': [priya]},
      {'key': 'month1', 'title': 'Month 1', 'count': 0, 'late': 0, 'people': []},
      {'key': 'probation', 'title': 'Probation', 'count': 1, 'late': 0, 'people': [sana]},
    ],
    'everyone': [priya, sana],
  };
}

Map<String, dynamic> _row(String id, String title, String kind, int step, String stepLabel, {bool done = false, bool locked = false, String? opens, String? pair, String? due, String dueTone = 'grey', String? pill, String? how, List<String>? agenda}) => {
  'id': id, 'title': title, 'kind': kind, 'step': step, 'stepLabel': stepLabel, 'early': kind != 'meet', 'done': done, 'locked': locked,
  'opens': ?opens, 'pair': ?pair, 'how': ?how, 'agenda': ?agenda, 'canTick': false,
  if (due != null) 'due': {'text': due, 'tone': dueTone},
  if (pill != null) 'pill': {'text': pill, 'tone': 'grey'},
};

Map<String, dynamic> _page({Set<String> done = const {}, String as = 'hr'}) => {
  'joiner': {
    'journeyId': 'j1', 'userId': 'u1', 'name': 'Priya Shah', 'first': 'Priya', 'initials': 'PS', 'designation': 'Operations executive', 'department': 'Operations',
    'reportsTo': 'Sunny Kapoor', 'buddy': 'Rohan Das', 'stepLabel': 'Day 1', 'plantStage': 1, 'preboarding': false, 'status': {'label': 'On track', 'warn': false},
  },
  'viewingAs': as,
  'step': 1,
  'card': {'title': 'Your tasks for Priya', 'toDo': 3 - done.length},
  'tasks': as == 'it'
      ? [
          _row('it_laptop_help', 'Laptop and login help', 'meet', 2, 'Week 1', locked: true, opens: 'meeting', agenda: ['Laptop and accessories handover']),
          _row('it_accesses', 'Set up Priya’s accesses', 'task', 2, 'Week 1', opens: 'accesses', pair: 'Devices and accesses', due: 'Due Thu', done: done.contains('it_accesses')),
        ]
      : [
          _row('hr_prepare_kit', 'Prepare Priya’s onboarding kit', 'task', 0, 'Before Day 1', opens: 'kit', due: '2 days late', dueTone: 'red', how: 'ID card, welcome kit, notebook and pen.', done: done.contains('hr_prepare_kit')),
          _row('hr_welcome', 'Welcome and documents', 'meet', 1, 'Day 1', opens: 'meeting', due: 'Due today', dueTone: 'amber', agenda: ['Welcome and a quick office round', 'Original documents checked'], done: done.contains('hr_welcome')),
          _row('hr_hand_kit', 'Hand over the onboarding kit', 'task', 1, 'Day 1', opens: 'handover', due: 'Due today', dueTone: 'amber', done: done.contains('hr_hand_kit')),
          _row('hr_salary_tax', 'Salary and tax', 'meet', 2, 'Week 1', locked: true, opens: 'meeting'),
          _row('hr_check_payroll', 'Check Priya’s payroll details', 'review', 2, 'Week 1', opens: 'payroll', pair: 'Complete your payroll details', pill: 'Week 1', done: done.contains('hr_check_payroll')),
          _row('hr_check_form', 'Check Priya’s joining form', 'doc', 2, 'Week 1', opens: 'form', pair: 'Fill in the joining form', pill: 'Week 1'),
          _row('hr_confirmation_letter', 'Issue Priya’s confirmation letter', 'doc', 8, 'Month 6', opens: 'letter', pill: 'Month 6'),
        ],
  'onboarding': {
    'status': 'On track',
    'rows': [
      {'key': 'prof', 'title': 'Profile', 'done': 86, 'total': 100, 'unit': 'complete', 'flag': {'text': '14% to go', 'tone': 'warn'}},
      {'key': 'meet', 'title': 'Meetings', 'done': 1, 'total': 15, 'unit': 'met', 'flag': {'text': '2 pending', 'tone': 'warn'}},
      {'key': 'tasks', 'title': 'Tasks', 'done': 3, 'total': 10, 'unit': 'done', 'flag': {'text': 'On track', 'tone': 'ok'}},
      {'key': 'ci', 'title': 'Check-ins', 'done': 0, 'total': 3, 'unit': 'sent', 'flag': {'text': 'On track', 'tone': 'ok'}},
      {'key': 'tour', 'title': 'Sowaka tour', 'done': 1, 'total': 4, 'unit': 'lessons', 'flag': {'text': '3 pending', 'tone': 'warn'}},
      {'key': 'watch', 'title': 'Watch list', 'done': 1, 'total': 8, 'unit': 'watched', 'flag': {'text': 'On track', 'tone': 'ok'}},
      {'key': 'dev', 'title': 'Devices and accesses', 'done': 3, 'total': 4, 'unit': 'ready', 'flag': {'text': '1 pending', 'tone': 'warn'}},
    ],
  },
  'lists': {
    'meet': [
      {'title': 'Welcome and documents', 'meta': 'Ritu Sharma', 'status': 'Met', 'tone': 'ok', 'comingUp': false},
      {'title': 'First goals', 'meta': 'Sunny Kapoor', 'status': 'Not yet', 'tone': 'todo', 'comingUp': false},
      {'title': 'Salary and tax', 'status': 'Week 1', 'tone': 'soon', 'comingUp': true},
    ],
    'dev': [
      {'title': 'Laptop', 'status': 'Ready', 'tone': 'ok', 'comingUp': false},
      {'title': 'Office Wi-Fi', 'status': 'Setting up', 'tone': 'warn', 'comingUp': false},
    ],
  },
};

Map<String, dynamic> _section(String key, String title, List<List<String?>> rows, {String? meta}) => {
  'key': key, 'title': title, 'missing': rows.where((r) => r[1] == null).length, 'meta': ?meta,
  'rows': [for (final r in rows) {'label': r[0], 'value': ?r[1]}],
};

final _bank = _section('bank', 'Bank account', [['Account holder', 'Priya Shah'], ['Bank', 'HDFC Bank'], ['Account number', 'XXXX XXXX 4417'], ['IFSC', 'HDFC0001234']]);
final _pf = _section('pf', 'PF and UAN', [['UAN', null]]);
final _tax = _section('tax', 'Tax and investments', [['Tax regime', 'New regime']], meta: 'FY 2026–27');

class _FakeStaff implements StaffApi {
  _FakeStaff({this.as = 'hr'});

  final String as;
  final done = <String>{};
  final calls = <String>[];
  Map<String, String>? lastChecks;
  Map<String, bool>? lastAccesses;
  String? lastCard;
  List<String>? lastNotes;

  @override
  Future<StaffOnboarding> fetchOnboarding({StaffRole? as}) async => StaffOnboarding.fromJson(_onboarding(as: this.as));

  @override
  Future<StaffJoinerPage> fetchJoiner(String journeyId, {StaffRole? as}) async => StaffJoinerPage.fromJson(_page(done: done, as: this.as));

  @override
  Future<StaffProfile> fetchProfile(String journeyId, {StaffRole? as}) async => StaffProfile.fromJson({
    'name': 'Priya Shah',
    'pct': 86,
    'sections': [
      _section('personal', 'Personal details', [['Full name', 'Priya Shah'], ['Blood group', null]]),
      if (this.as == 'hr') _bank,
    ],
  });

  @override
  Future<StaffTaskScreen> fetchTask(String journeyId, String key, {StaffRole? as}) async => StaffTaskScreen.fromJson({
    'key': key,
    'done': done.contains(key),
    'possessive': 'her',
    if (key == 'hr_prepare_kit' || key == 'hr_hand_kit')
      'idCard': {'company': 'Sowaka Test', 'name': 'Priya Shah', 'designation': 'Operations executive', 'department': 'Operations', 'employeeId': 'ST-1042', 'photo': 'missing'},
    if (key == 'hr_check_payroll') ...{'sections': [_bank, _pf, _tax], 'cheque': {'uploaded': true}},
    if (key == 'hr_confirmation_letter') ...{
      'facts': [{'label': 'Approved by', 'value': 'Waiting for the head of department'}],
      'preview': {'head': 'Sowaka Test · Pune', 'title': 'Confirmation of employment', 'paragraphs': ['Dear Priya Shah,', 'We are pleased to confirm your employment.', 'Ritu Sharma · Human Resources · Sowaka Test']},
    },
    if (key == 'it_accesses')
      'accesses': [
        {'id': 'a1', 'title': 'Laptop', 'ready': true, 'details': []},
        {'id': 'a2', 'title': 'Work email', 'ready': false, 'details': [{'label': 'Address', 'value': 'priya.shah@sowakatest.example'}]},
      ],
    if (key == 'hr_welcome') 'meeting': {'agenda': ['Welcome and a quick office round', 'Original documents checked'], 'notes': ['Bring the PAN original']},
  });

  @override
  Future<StaffJoinerPage> taskAction(String journeyId, String key, {String? action, Map<String, String>? checks, String? accessCardNo, Map<String, bool>? accesses, StaffRole? as}) async {
    calls.add('${action ?? 'save'}:$key');
    lastChecks = checks;
    lastAccesses = accesses;
    lastCard = accessCardNo;
    if (action == 'done') done.add(key);
    if (action == 'undo') done.remove(key);
    return StaffJoinerPage.fromJson(_page(done: done, as: this.as));
  }

  @override
  Future<void> saveNotes(String journeyId, String key, List<String> notes, {StaffRole? as}) async => lastNotes = notes;
}

Future<void> _pump(WidgetTester tester, Widget screen) async {
  tester.view.physicalSize = const Size(393 * 3, 1700 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(home: screen));
  await tester.pumpAndSettle();
}

Future<void> _openPriya(WidgetTester tester, _FakeStaff api) async {
  await _pump(tester, StaffPersonScreen(api: api, journeyId: 'j1', name: 'Priya Shah'));
}

void main() {
  group('Actions › Onboarding (HROnboarding, ITOnboarding, HRAll)', () {
    testWidgets('Viewing as HR, the four cards with counts and a late pill, View all employees', (tester) async {
      await _pump(tester, StaffOnboardingScreen(api: _FakeStaff()));
      expect(find.text('Viewing as HR'), findsOneWidget);
      for (final t in ['Joining soon', 'Week 1', 'Month 1', 'Probation']) {
        expect(find.text(t), findsOneWidget);
      }
      expect(find.text('No one right now'), findsNWidgets(2));
      expect(find.text('1 employee'), findsNWidgets(2));
      expect(find.text('1 late'), findsOneWidget);
      // A card opens to its people: name, stage, worst pill.
      expect(find.text('Priya Shah'), findsNothing);
      await tester.tap(find.text('Week 1'));
      await tester.pumpAndSettle();
      expect(find.text('Priya Shah'), findsOneWidget);
      expect(find.text('3 late'), findsOneWidget);
      // View all employees.
      await tester.tap(find.text('View all employees'));
      await tester.pumpAndSettle();
      expect(find.text('All employees'), findsOneWidget);
      expect(find.text('Everyone in onboarding'), findsOneWidget);
      expect(find.text('2 employees'), findsOneWidget);
      expect(find.text('Sana Khan'), findsOneWidget);
      expect(find.text('Due today'), findsOneWidget);
    });

    testWidgets('IT & admin sees "Viewing as IT & admin"', (tester) async {
      await _pump(tester, StaffOnboardingScreen(api: _FakeStaff(as: 'it')));
      expect(find.text('Viewing as IT & admin'), findsOneWidget);
    });

    test('The Actions tile: tasks for new joiners, highlighted while open; red when late', () {
      final me = LifecycleMe(enabled: true, staff: const {'role': 'hr', 'open': 4, 'late': 3, 'dueToday': 0, 'pill': '3 late'});
      final tile = staffTileOf(me)!;
      expect(staffTileSubtitle(tile), '4 tasks for new joiners');
      expect(tile.pill, '3 late');
      expect(staffTilePillColors(tile).$2, const Color(0xFFB23500));
      expect(staffTileSubtitle(staffTileOf(const LifecycleMe(enabled: true, staff: {'role': 'it', 'open': 0, 'late': 0, 'dueToday': 0}))!), 'All done');
      expect(staffTileOf(const LifecycleMe(enabled: true)), isNull);
    });
  });

  group('A person’s page (HRPerson, ITPerson)', () {
    testWidgets('hero, my tasks with due pills, then her whole onboarding', (tester) async {
      final api = _FakeStaff();
      await _openPriya(tester, api);
      expect(find.text('Reports to Sunny Kapoor'), findsOneWidget);
      expect(find.text('Buddy: Rohan Das'), findsOneWidget);
      expect(find.text('Your tasks for Priya'), findsOneWidget);
      expect(find.text('3 to do'), findsOneWidget);
      // The first three open now, late first; never a tick (every row opens a screen).
      expect(find.text('Prepare Priya’s onboarding kit'), findsOneWidget);
      expect(find.text('2 days late'), findsOneWidget);
      expect(find.text('Due today'), findsNWidgets(2));
      expect(find.text('Salary and tax'), findsNothing);
      expect(find.byKey(const ValueKey('team-tick')), findsNothing);
      // Her onboarding: status and the seven stats.
      expect(find.text('Priya’s onboarding'), findsOneWidget);
      expect(find.text('On track'), findsWidgets);
      for (final t in ['Profile', 'Meetings', 'Tasks', 'Check-ins', 'Sowaka tour', 'Watch list', 'Devices and accesses']) {
        expect(find.text(t), findsOneWidget);
      }
      expect(find.textContaining('86% complete', findRichText: true), findsOneWidget);
      expect(find.text('14% to go'), findsOneWidget);
    });

    testWidgets('View all: COMING UP with meetings locked till their step, other tasks open early', (tester) async {
      await _openPriya(tester, _FakeStaff());
      await tester.tap(find.byKey(const ValueKey('team-view-all')));
      await tester.pumpAndSettle();
      expect(find.text('COMING UP'), findsOneWidget);
      expect(find.text('Opens in Week 1'), findsOneWidget);
      expect(find.text('Complete your payroll details'), findsOneWidget);
      expect(find.text('Week 1'), findsNWidgets(2));
      expect(find.text('Issue Priya’s confirmation letter'), findsNothing);
    });

    testWidgets('a stat opens its list; Profile opens the full profile with missing in amber', (tester) async {
      await _openPriya(tester, _FakeStaff());
      await tester.tap(find.byKey(const ValueKey('staff-stat-meet')));
      await tester.pumpAndSettle();
      expect(find.text('1 of 2 met'), findsOneWidget);
      expect(find.text('COMING UP'), findsOneWidget);
      expect(find.text('Meeting notes stay private to Priya.'), findsOneWidget);
      await tester.pageBack();
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('staff-stat-prof')));
      await tester.pumpAndSettle();
      expect(find.text('Priya’s profile'), findsOneWidget);
      expect(find.text('86% complete'), findsOneWidget);
      expect(find.text('1 missing'), findsOneWidget);
      expect(find.text('Complete'), findsOneWidget);
      await tester.tap(find.text('Personal details'));
      await tester.pumpAndSettle();
      expect(find.text('Not filled yet'), findsOneWidget);
    });
  });

  group('Task screens', () {
    testWidgets('payroll check reads her profile; Looks right / Ask; Done goes back with a toast', (tester) async {
      final api = _FakeStaff();
      await _openPriya(tester, api);
      await tester.tap(find.byKey(const ValueKey('team-view-all')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Check Priya’s payroll details'));
      await tester.pumpAndSettle();
      expect(find.text('All tasks'), findsOneWidget);
      expect(find.text('For Priya Shah · Day 1'), findsOneWidget);
      expect(find.text('BANK ACCOUNT'), findsOneWidget);
      expect(find.text('HDFC Bank'), findsOneWidget);
      expect(find.text('Cancelled cheque'), findsOneWidget);
      expect(find.text('Uploaded with her bank details'), findsOneWidget);
      expect(find.text('1 missing'), findsOneWidget);
      expect(find.text('FY 2026–27'), findsOneWidget);
      expect(find.text('Not filled yet'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('choice-Bank account-looks_right')));
      await tester.tap(find.byKey(const ValueKey('choice-PF and UAN-ask')));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const ValueKey('staff-task-button')));
      await tester.tap(find.byKey(const ValueKey('staff-task-button')));
      await tester.pumpAndSettle();
      expect(api.calls, ['done:hr_check_payroll']);
      expect(api.lastChecks, {'bank': 'looks_right', 'pf': 'ask'});
      expect(find.text('Payroll details checked'), findsOneWidget);
    });

    testWidgets('the kit shows the ID card to print; Kit ready', (tester) async {
      final api = _FakeStaff();
      await _openPriya(tester, api);
      await tester.tap(find.text('Prepare Priya’s onboarding kit'));
      await tester.pumpAndSettle();
      expect(find.text('ID card, welcome kit, notebook and pen.'), findsOneWidget);
      expect(find.text('From her profile'), findsOneWidget);
      expect(find.text('Ready to print'), findsOneWidget);
      await tester.tap(find.text('ID card to print'));
      await tester.pumpAndSettle();
      expect(find.text('SOWAKA TEST · EMPLOYEE ID'), findsOneWidget);
      expect(find.text('ST-1042'), findsOneWidget);
      expect(find.text('Not uploaded yet'), findsOneWidget);
      for (final t in ['T-shirt', 'Mug and bottle', 'Notebook and pen', 'Laptop bag', 'Access card']) {
        expect(find.text(t), findsOneWidget);
      }
      await tester.ensureVisible(find.text('Kit ready'));
      await tester.tap(find.text('Kit ready'));
      await tester.pumpAndSettle();
      expect(api.calls, ['done:hr_prepare_kit']);
      expect(find.text('Onboarding kit ready for Priya'), findsOneWidget);
    });

    testWidgets('hand over keeps the access card number', (tester) async {
      final api = _FakeStaff();
      await _openPriya(tester, api);
      await tester.tap(find.text('Hand over the onboarding kit'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('staff-access-card')), 'AC-77');
      await tester.ensureVisible(find.text('Handed over'));
      await tester.tap(find.text('Handed over'));
      await tester.pumpAndSettle();
      expect(api.lastCard, 'AC-77');
      expect(find.text('Kit handed over to Priya'), findsOneWidget);
    });

    testWidgets('a meeting: agenda with my own notes; Mark as done toggles', (tester) async {
      final api = _FakeStaff();
      await _openPriya(tester, api);
      await tester.tap(find.text('Welcome and documents'));
      await tester.pumpAndSettle();
      expect(find.text('With Priya Shah'), findsOneWidget);
      expect(find.text('2 things to talk about'), findsOneWidget);
      expect(find.text('Bring the PAN original'), findsOneWidget);
      expect(find.text('Only you can see your notes. Priya keeps their own.'), findsOneWidget);
      await tester.enterText(find.byType(TextField).last, 'Seen the Aadhaar');
      await tester.pump(const Duration(seconds: 1));
      expect(api.lastNotes, ['Bring the PAN original', 'Seen the Aadhaar']);
      await tester.ensureVisible(find.text('Mark as done'));
      await tester.tap(find.text('Mark as done'));
      await tester.pumpAndSettle();
      expect(find.text('Done'), findsWidgets);
      expect(api.calls, ['done:hr_welcome']);
      await tester.tap(find.byKey(const ValueKey('staff-meeting-done')));
      await tester.pumpAndSettle();
      expect(api.calls, ['done:hr_welcome', 'undo:hr_welcome']);
    });

    testWidgets('the letter shows the facts and a preview, no send from the app', (tester) async {
      final api = _FakeStaff();
      await _pump(tester, StaffTaskPage(
        api: api,
        page: StaffJoinerPage.fromJson(_page()),
        row: StaffTaskRow.fromJson(_row('hr_confirmation_letter', 'Issue Priya’s confirmation letter', 'doc', 8, 'Month 6', opens: 'letter', pill: 'Month 6')),
      ));
      expect(find.text('Waiting for the head of department'), findsOneWidget);
      expect(find.text('LETTER PREVIEW'), findsOneWidget);
      expect(find.text('From Document templates'), findsOneWidget);
      expect(find.text('Confirmation of employment'), findsOneWidget);
      expect(find.byKey(const ValueKey('staff-task-button')), findsNothing);
    });

    testWidgets('IT & admin: each access opens to its setup details; Save', (tester) async {
      final api = _FakeStaff(as: 'it');
      await _openPriya(tester, api);
      expect(find.text('Set up Priya’s accesses'), findsOneWidget);
      await tester.tap(find.text('Set up Priya’s accesses'));
      await tester.pumpAndSettle();
      expect(find.text('1 of 2 ready'), findsOneWidget);
      expect(find.text('Setting up'), findsOneWidget);
      await tester.tap(find.text('Work email'));
      await tester.pumpAndSettle();
      expect(find.text('priya.shah@sowakatest.example'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('choice-Work email-ok')));
      await tester.pumpAndSettle();
      expect(find.text('2 of 2 ready'), findsOneWidget);
      await tester.ensureVisible(find.text('Save'));
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();
      expect(api.calls, ['save:it_accesses']);
      expect(api.lastAccesses, {'a1': true, 'a2': true});
      expect(find.text('Saved. Priya sees what’s ready.'), findsOneWidget);
    });
  });
}
