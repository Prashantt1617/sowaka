// A small in-memory lifecycle server for the offboarding tests: the app
// endpoints of docs/lifecycle/CONTRACT.md "Offboarding", answering as the
// backend would. Every person is fictional; the org is sowaka.
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/lifecycle/offboarding/offboarding.dart';

const leaverSession = AuthSession(
  token: 'ravi-token',
  user: AuthUser(
    id: 'ravi',
    email: 'ravi.menon@sowaka.test',
    name: 'Ravi Menon',
    role: 'employee',
    company: 'Sowaka',
    org: 'sowaka',
    designation: 'Design Lead',
    department: 'Design',
    managerName: 'Meera Iyer',
  ),
);

const managerSession = AuthSession(
  token: 'meera-token',
  user: AuthUser(
    id: 'meera',
    email: 'meera.iyer@sowaka.test',
    name: 'Meera Iyer',
    role: 'manager',
    company: 'Sowaka',
    org: 'sowaka',
  ),
);

http.Response json(Object body, [int status = 200]) => http.Response.bytes(
  utf8.encode(jsonEncode(body)),
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

Map<String, dynamic> task(
  String key,
  String title, {
  String status = 'todo',
  String owner = 'employee',
  String phase = 'notice_period',
  String? helper,
  String? dueAt,
  String? opensAt,
}) => {
  'id': 'task-$key',
  'systemKey': key,
  'phase': phase,
  'title': title,
  'helper': ?helper,
  'ownerRole': owner,
  'kind': 'upload',
  'surface': 'app',
  'mustDo': false,
  'status': status,
  'dueAt': ?dueAt,
  'opensAt': ?opensAt,
  'late': false,
};

class FakeLifecycle {
  bool enabled = true;

  /// `/lifecycle/me` · `staff`: HR's or IT & admin's Actions › Onboarding tile.
  Map<String, dynamic>? staff;
  bool canResign = true;
  bool pageVisible = false;
  String? tl;
  Map<String, dynamic>? resignation;
  bool interviewOpen = false;
  bool interviewSent = false;
  bool handoverDone = false;
  String handoverNote =
      'Please share these by 24 Dec so Asha has a week with them before you go.';

  /// The checklist: id, title, upload.
  final handover = <Map<String, dynamic>>[
    {
      'id': 'h1',
      'title': 'Design system file and docs',
      'upload': {
        'kind': 'file',
        'fileId': 'f1',
        'name': 'ds-handover.pdf',
        'at': '2026-12-12T06:00:00.000Z',
      },
      'done': false,
    },
    {
      'id': 'h2',
      'title': 'Open projects, status and owners',
      'upload': {
        'kind': 'file',
        'fileId': 'f2',
        'name': 'projects-dec.xlsx',
        'at': '2026-12-12T06:00:00.000Z',
      },
      'done': false,
    },
    {'id': 'h3', 'title': 'Vendor and tool access list', 'done': false},
    {'id': 'h4', 'title': 'Walkthrough recording for Asha', 'done': false},
  ];

  /// The manager's reports' resignations.
  final managerResignations = <Map<String, dynamic>>[];

  /// The manager's reports with an exit under way (`/manager/leavers`).
  final managerLeavers = <Map<String, dynamic>>[];

  /// As the real server: a leaver's view needs an exit, so before HR accepts
  /// `GET /manager/leavers/:id` answers 404 "No exit for this person".
  bool leaverNeedsExit = false;

  /// An exit HR started (no resignation): its type on the page.
  String? exitType;

  /// The reasons `GET /lifecycle/resignation` offers (none by default).
  List<String>? reasons;

  final calls = <String>[];
  final bodies = <String, Object?>{};

  void onNotice({String lastDay = '2026-12-31', int daysLeft = 17}) {
    tl = lastDay;
    pageVisible = true;
    canResign = false;
    resignation = {
      ...?resignation,
      'id': 'res-1',
      'userId': 'ravi',
      'reason': resignation?['reason'] ?? 'Better opportunity',
      'noticeDays': 60,
      'submittedAt': '2026-11-01T05:00:00.000Z',
      'lastDayByNotice': '2026-12-31',
      'status': 'accepted',
      'managerName': 'Meera Iyer',
      'manager': {
        'action': 'accept',
        'at': '2026-11-02T05:00:00.000Z',
        'byName': 'Meera Iyer',
      },
      'hrAcceptedAt': '2026-11-04T05:00:00.000Z',
      'agreedLastDay': lastDay,
      'tl': lastDay,
      'daysLeft': daysLeft,
    };
  }

  Map<String, dynamic>? get _summary {
    final r = resignation;
    if (r == null && tl == null) return null;
    return {
      'status': r?['status'] ?? 'accepted',
      if (tl != null) 'journeyId': 'journey-1',
      'resignationId': ?r?['id'],
      'tl': ?tl,
      'pageVisible': pageVisible,
    };
  }

  Map<String, dynamic> get page => {
    'tl': tl,
    'daysLeft': 17,
    'exitType': ?exitType,
    // An exit HR started has no resignation to read these from.
    if (exitType != null) 'acceptedAt': '2026-11-04T05:00:00.000Z',
    if (exitType != null) 'noticeFrom': '2026-11-04',
    'managerName': 'Meera Iyer',
    'tasks': [
      task(
        'upload_handover',
        'Upload handover items',
        dueAt: '2026-12-24',
        status: handoverDone ? 'done' : 'todo',
      ),
      task(
        'return_assets',
        'Return laptop and ID card',
        owner: 'it',
        helper: 'IT desk, 2nd floor',
        dueAt: '2026-12-31',
      ),
      task(
        'exit_interview',
        'Exit interview',
        opensAt: '2026-12-26',
        status: interviewSent ? 'done' : 'todo',
      ),
      task('save_documents', 'Save your documents'),
      task(
        'send_resignation',
        'Send resignation',
        phase: 'resignation',
        status: 'done',
      ),
      task('stay_in_touch', 'Ask to stay in touch', phase: 'after_exit'),
    ],
    'handover': {
      'items': handover,
      'note': handoverNote,
      'addedAt': '2026-12-02',
      'dueAt': '2026-12-24',
      'done': handoverDone,
    },
    'interview': {
      'opensAt': '2026-12-26',
      'open': interviewOpen,
      'sent': interviewSent,
    },
    'documents': [
      {'kind': 'payslip', 'label': 'Payslips', 'url': '/payslips/mine'},
      {'kind': 'form16', 'label': 'Form 16', 'url': '/payroll/me/form16'},
    ],
  };

  Map<String, dynamic> leaver(String userId) => {
    'resignation': resignation,
    'status': exitType != null
        ? {
            'exitType': exitType,
            'tl': tl,
            'daysLeft': 17,
            'acceptedOn': '2026-11-04',
          }
        : resignation?['status'],
    'tl': tl,
    'daysLeft': 17,
    'acceptedAt': resignation?['hrAcceptedAt'],
    'handover': {
      'items': handover,
      'note': handoverNote,
      'addedAt': '2026-12-02',
      'dueAt': '2026-12-24',
      'done': handoverDone,
      if (handoverDone) 'doneAt': '2026-12-30',
    },
    'otherSteps': [
      task('return_assets', 'Return laptop and ID card', owner: 'it'),
    ],
  };

  Map<String, dynamic> _item(String id) =>
      handover.firstWhere((item) => item['id'] == id);

  http.Client get client => MockClient((request) async {
    final path = request.url.path;
    final method = request.method;
    calls.add('$method $path');
    final contentType = request.headers['content-type'] ?? '';
    Object? body;
    if (contentType.startsWith('application/json') && request.body.isNotEmpty) {
      body = jsonDecode(request.body);
    } else if (contentType.startsWith('multipart/')) {
      body = {
        'filename': RegExp(
          r'filename="([^"]+)"',
        ).firstMatch(request.body)?.group(1),
      };
    }
    bodies['$method $path'] = body;
    if (!enabled && path.startsWith('/lifecycle/') && path != '/lifecycle/me') {
      return json({'error': 'Not available'}, 404);
    }
    final handoverMatch = RegExp(
      r'^/lifecycle/offboarding/handover/([^/]+)$',
    ).firstMatch(path);
    final managerAction = RegExp(
      r'^/lifecycle/manager/resignations/([^/]+)$',
    ).firstMatch(path);
    final leaverMatch = RegExp(
      r'^/lifecycle/manager/leavers/([^/]+)(/handover(/done)?)?$',
    ).firstMatch(path);
    switch ((method, path)) {
      case ('GET', '/lifecycle/me'):
        return json({
          'enabled': enabled,
          if (enabled) 'offboarding': ?_summary,
          if (enabled) 'staff': ?staff,
        });
      case ('GET', '/lifecycle/resignation'):
        return json({
          'resignation': resignation,
          'noticeDays': 60,
          'lastDayByNotice': '2026-12-31',
          'canResign': canResign,
          'reasons': ?reasons,
        });
      case ('POST', '/lifecycle/resignation'):
        final input = body as Map<String, dynamic>;
        resignation = {
          'id': 'res-1',
          'userId': 'ravi',
          'reason': input['reason'],
          'note': input['note'],
          'noticeDays': 60,
          'submittedAt': '2026-11-01T05:00:00.000Z',
          'lastDayByNotice': '2026-12-31',
          'status': 'with_manager',
          'managerName': 'Meera Iyer',
        };
        canResign = false;
        return json({'resignation': resignation});
      case ('POST', '/lifecycle/resignation/withdraw'):
        resignation = {
          ...?resignation,
          'status': 'withdrawn',
          'withdrawnAt': '2026-11-03T05:00:00.000Z',
        };
        canResign = true;
        return json({'resignation': resignation});
      case ('GET', '/lifecycle/offboarding'):
        return json(page);
      case ('POST', '/lifecycle/offboarding/interview'):
        interviewSent = true;
        return json({'ok': true});
      case ('GET', '/lifecycle/manager/resignations'):
        return json({'resignations': managerResignations});
      case ('GET', '/lifecycle/manager/leavers'):
        return json({'leavers': managerLeavers});
    }
    final fileMatch = RegExp(
      r'^/lifecycle/offboarding/handover/([^/]+)/file$',
    ).firstMatch(path);
    if (fileMatch != null && method == 'GET') {
      final item = _item(fileMatch.group(1)!);
      return item['upload'] == null
          ? json({'error': 'No file on this item'}, 404)
          : json({'url': 'https://files.example.test/${item['id']}'});
    }
    if (handoverMatch != null) {
      final item = _item(handoverMatch.group(1)!);
      if (method == 'DELETE') {
        item.remove('upload');
        return json({'item': item});
      }
      final input = body as Map<String, dynamic>;
      item['upload'] = input.containsKey('url')
          ? {
              'kind': 'link',
              'url': input['url'],
              'at': '2026-12-14T06:00:00.000Z',
            }
          : {
              'kind': 'file',
              'fileId': 'f-new',
              'name': input['filename'],
              'at': '2026-12-14T06:00:00.000Z',
            };
      return json({'item': item});
    }
    if (managerAction != null && method == 'POST') {
      final input = body as Map<String, dynamic>;
      final row = managerResignations.firstWhere(
        (r) => r['id'] == managerAction.group(1),
      );
      row['status'] = 'with_hr';
      row['manager'] = {
        'action': input['action'],
        'date': ?input['date'],
        'at': '2026-11-02T05:00:00.000Z',
        'byName': 'Meera Iyer',
      };
      return json({'resignation': row});
    }
    if (leaverMatch != null) {
      if (method == 'GET' && leaverMatch.group(2) == null) {
        if (leaverNeedsExit &&
            resignation?['status'] != 'accepted' &&
            exitType == null) {
          return json({'error': 'No exit for this person'}, 404);
        }
        return json(leaver(leaverMatch.group(1)!));
      }
      if (method == 'PUT' && leaverMatch.group(2) == '/handover') {
        final input = body as Map<String, dynamic>;
        final titles = [for (final t in input['items'] as List) '$t'];
        final kept = [
          for (final title in titles)
            handover.where((item) => item['title'] == title).firstOrNull ??
                {
                  'id': 'h-${title.hashCode.abs()}',
                  'title': title,
                  'done': false,
                },
        ];
        handover
          ..clear()
          ..addAll(kept);
        handoverNote = input['note'] as String? ?? '';
        return json({'ok': true});
      }
      if (method == 'POST' && leaverMatch.group(3) != null) {
        handoverDone = true;
        return json({'ok': true});
      }
    }
    return json({'error': 'Route not found'}, 404);
  });

  /// Puts this server behind every offboarding store.
  void install() {
    OffboardingStore.reset();
    OffboardingApi.testOverride = (session) => OffboardingApi(
      session: session,
      baseUrl: 'https://example.test',
      client: client,
    );
  }

  static void uninstall() {
    OffboardingApi.testOverride = null;
    OffboardingStore.reset();
  }
}

/// A resignation on the manager's list.
Map<String, dynamic> reportResignation({
  String id = 'res-1',
  String userId = 'ravi',
  String name = 'Ravi Menon',
  String status = 'with_manager',
  String? note =
      'Thank you for the last five years. Happy to help brief whoever takes over the design system.',
}) => {
  'id': id,
  'userId': userId,
  'name': name,
  'designation': 'Design Lead',
  'reason': 'Better opportunity',
  'note': ?note,
  'noticeDays': 60,
  'submittedAt': '2026-11-01T05:00:00.000Z',
  'lastDayByNotice': '2026-12-31',
  'status': status,
  'managerName': 'Meera Iyer',
};
