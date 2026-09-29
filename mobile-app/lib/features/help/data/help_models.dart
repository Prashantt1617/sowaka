import 'package:flutter/material.dart';

import '../../talk/data/talk_models.dart';

/// Help: the four questions, the match they lead to, and what Help home
/// shows. The option ids match the server's; it validates what it is sent.
class HelpOption {
  const HelpOption(this.id, this.label, this.icon);

  final String id;
  final String label;
  final IconData icon;
}

const helpTopics = [
  HelpOption('work', 'Work & career', Icons.work_outline_rounded),
  HelpOption('relationships', 'Relationships', Icons.handshake_outlined),
  HelpOption('family', 'Family', Icons.home_outlined),
  HelpOption('parenting', 'Parenting', Icons.child_care_rounded),
  HelpOption('money', 'Money', Icons.account_balance_wallet_outlined),
  HelpOption('grief', 'Loss or grief', Icons.local_florist_outlined),
  HelpOption('change', 'A life change', Icons.eco_outlined),
  HelpOption('self', 'Myself & my feelings', Icons.favorite_border_rounded),
  HelpOption('other', 'Something else', Icons.more_horiz_rounded),
  HelpOption('unsure', 'I’m not sure yet', Icons.cloud_outlined),
];

const helpBaseNeeds = [
  HelpOption('overwhelmed', 'Feeling overwhelmed', Icons.water_drop_outlined),
  HelpOption('drained', 'Feeling drained', Icons.battery_2_bar_rounded),
  HelpOption('low', 'Feeling low', Icons.cloud_outlined),
  HelpOption('disconnected', 'Feeling disconnected', Icons.power_off_outlined),
  HelpOption('conflict', 'Handling conflict', Icons.forum_outlined),
  HelpOption('decision', 'Making a decision', Icons.signpost_outlined),
];

const helpContextNeeds = <String, List<HelpOption>>{
  'work': [
    HelpOption('switch-off', 'Switching off after work', Icons.wb_twilight_rounded),
    HelpOption('expectations', 'Managing expectations', Icons.checklist_rounded),
  ],
  'relationships': [
    HelpOption('express', 'Saying what I need', Icons.chat_bubble_outline_rounded),
    HelpOption('boundaries', 'Setting boundaries', Icons.fence_rounded),
  ],
  'family': [
    HelpOption('boundaries', 'Setting boundaries', Icons.fence_rounded),
    HelpOption('express', 'Saying what I need', Icons.chat_bubble_outline_rounded),
  ],
  'parenting': [
    HelpOption('me-time', 'Finding time for myself', Icons.coffee_outlined),
    HelpOption('responsibility', 'New responsibilities', Icons.volunteer_activism_outlined),
  ],
  'money': [HelpOption('uncertainty', 'Worrying about uncertainty', Icons.help_outline_rounded)],
  'grief': [HelpOption('missing', 'Living with a loss', Icons.local_florist_outlined)],
  'change': [HelpOption('adjusting', 'Finding my footing', Icons.directions_walk_rounded)],
};

const helpNeedExtras = [
  HelpOption('other', 'Something else', Icons.more_horiz_rounded),
  HelpOption('unsure', 'I’m not sure yet', Icons.cloud_outlined),
];

const helpGoals = [
  HelpOption('heard', 'Feeling heard', Icons.hearing_rounded),
  HelpOption('understand', 'Understanding myself', Icons.psychology_outlined),
  HelpOption('settled', 'Feeling more settled', Icons.spa_outlined),
  HelpOption('forward', 'Finding practical ways forward', Icons.route_outlined),
  HelpOption('relationship', 'Improving a relationship', Icons.handshake_outlined),
  HelpOption('unsure', 'Working it out together', Icons.forum_outlined),
];

const helpLanguages = ['English', 'Hindi', 'Marathi', 'Tamil', 'Gujarati'];

const helpAgeRanges = [
  HelpOption('young', 'Under 35', Icons.person_outline),
  HelpOption('mid', '35–49', Icons.person_outline),
  HelpOption('older', '50+', Icons.person_outline),
];

const helpGenders = [
  HelpOption('woman', 'Woman', Icons.person_outline),
  HelpOption('man', 'Man', Icons.person_outline),
  HelpOption('nonbinary', 'Non-binary', Icons.person_outline),
];

/// Every difficulty there is, for labelling an id wherever it came from.
final helpAllNeeds = <String, HelpOption>{
  for (final option in [...helpBaseNeeds, ...helpContextNeeds.values.expand((list) => list), ...helpNeedExtras]) option.id: option,
};

HelpOption? helpTopicById(String id) => helpTopics.where((t) => t.id == id).firstOrNull;
HelpOption? helpGoalById(String id) => helpGoals.where((g) => g.id == id).firstOrNull;
String helpAgeLabel(String id) => helpAgeRanges.where((a) => a.id == id).firstOrNull?.label ?? '';
String helpGenderLabel(String id) => helpGenders.where((g) => g.id == id).firstOrNull?.label ?? '';

/// What someone answered. A skipped question is an empty list or ''.
class HelpIntake {
  const HelpIntake({
    this.topics = const [],
    this.needs = const [],
    this.goal = '',
    this.languages = const [],
    this.ageRange = '',
    this.gender = '',
  });

  final List<String> topics;
  final List<String> needs;
  final String goal;
  final List<String> languages;
  final String ageRange;
  final String gender;

  static const empty = HelpIntake();

  bool get isBlank => topics.isEmpty && needs.isEmpty && goal.isEmpty && languages.isEmpty && ageRange.isEmpty && gender.isEmpty;

  HelpIntake copyWith({List<String>? topics, List<String>? needs, String? goal, List<String>? languages, String? ageRange, String? gender}) =>
      HelpIntake(
        topics: topics ?? this.topics,
        needs: needs ?? this.needs,
        goal: goal ?? this.goal,
        languages: languages ?? this.languages,
        ageRange: ageRange ?? this.ageRange,
        gender: gender ?? this.gender,
      );

  Map<String, dynamic> toJson() => {
    'topics': topics,
    'needs': needs,
    'goal': goal,
    'languages': languages,
    'ageRange': ageRange,
    'gender': gender,
  };

  factory HelpIntake.fromJson(Map<String, dynamic> json) => HelpIntake(
    topics: [for (final id in (json['topics'] as List<dynamic>? ?? const [])) '$id'],
    needs: [for (final id in (json['needs'] as List<dynamic>? ?? const [])) '$id'],
    goal: json['goal'] as String? ?? '',
    languages: [for (final id in (json['languages'] as List<dynamic>? ?? const [])) '$id'],
    ageRange: json['ageRange'] as String? ?? '',
    gender: json['gender'] as String? ?? '',
  );

  /// The difficulties offered for these topics: the first contextual one per
  /// topic, the rest when only one topic, any still-chosen ones, then the
  /// general ones, then the two quiet options.
  List<HelpOption> needsOffered() {
    final specific = <HelpOption>[];
    for (final id in topics) {
      final list = helpContextNeeds[id];
      if (list != null && list.isNotEmpty) specific.add(list.first);
    }
    final extra = topics.length == 1 ? (helpContextNeeds[topics.first] ?? const []).skip(1).toList() : const <HelpOption>[];
    final stillValid = [
      for (final id in topics)
        for (final option in (helpContextNeeds[id] ?? const <HelpOption>[]))
          if (needs.contains(option.id)) option,
    ];
    final seen = <String>{};
    final out = <HelpOption>[];
    for (final option in [...specific, ...extra, ...stillValid, ...helpBaseNeeds]) {
      if (seen.add(option.id)) out.add(option);
    }
    return [...out, ...helpNeedExtras];
  }

  /// Drops difficulties that no longer have a topic behind them.
  HelpIntake reconciled() {
    final offered = needsOffered().map((o) => o.id).toSet();
    return copyWith(needs: [for (final id in needs) if (offered.contains(id)) id]);
  }
}

/// A matched counsellor, with why.
class HelpMatch {
  const HelpMatch({required this.counsellor, required this.reasons, required this.unmet, required this.source});

  final Counsellor counsellor;
  final List<String> reasons;

  /// Preferences this counsellor does not meet; empty on a true match.
  final List<String> unmet;

  /// 'intake', 'fallback' or 'dashboard'.
  final String source;

  factory HelpMatch.fromJson(Map<String, dynamic> json) => HelpMatch(
    counsellor: Counsellor.fromJson(json['counsellor'] as Map<String, dynamic>),
    reasons: [for (final r in (json['reasons'] as List<dynamic>? ?? const [])) '$r'],
    unmet: [for (final r in (json['unmet'] as List<dynamic>? ?? const [])) '$r'],
    source: json['source'] as String? ?? 'intake',
  );
}

class HelpHome {
  const HelpHome({required this.intakeDone, this.match, this.noMatch, this.upcoming, this.history = const []});

  final bool intakeDone;
  final HelpMatch? match;

  /// When the answers fit nobody: the closest, with what they do not meet.
  final HelpMatch? noMatch;
  final TalkSession? upcoming;
  final List<TalkSession> history;

  factory HelpHome.fromJson(Map<String, dynamic> json) => HelpHome(
    intakeDone: json['intakeDone'] == true,
    match: json['match'] is Map<String, dynamic> ? HelpMatch.fromJson(json['match'] as Map<String, dynamic>) : null,
    noMatch: json['noMatch'] is Map<String, dynamic>
        ? HelpMatch.fromJson({...json['noMatch'] as Map<String, dynamic>, 'source': 'fallback'})
        : null,
    upcoming: json['upcoming'] is Map<String, dynamic> ? TalkSession.fromJson(json['upcoming'] as Map<String, dynamic>) : null,
    history: [for (final row in (json['history'] as List<dynamic>? ?? const [])) TalkSession.fromJson(row as Map<String, dynamic>)],
  );
}

/// What the intake save returns: the match, or the closest when none.
class HelpMatchResult {
  const HelpMatchResult({this.match, this.noMatch});

  final HelpMatch? match;
  final HelpMatch? noMatch;

  factory HelpMatchResult.fromJson(Map<String, dynamic> json) => HelpMatchResult(
    match: json['match'] is Map<String, dynamic> ? HelpMatch.fromJson(json['match'] as Map<String, dynamic>) : null,
    noMatch: json['noMatch'] is Map<String, dynamic>
        ? HelpMatch.fromJson({...json['noMatch'] as Map<String, dynamic>, 'source': 'fallback'})
        : null,
  );
}

class CounsellorDetail {
  const CounsellorDetail({required this.counsellor, required this.matched, required this.reasons, required this.unmet, required this.upcoming, required this.past});

  final Counsellor counsellor;
  final bool matched;
  final List<String> reasons;
  final List<String> unmet;
  final List<TalkSession> upcoming;
  final List<TalkSession> past;

  factory CounsellorDetail.fromJson(Map<String, dynamic> json) {
    final sessions = json['sessions'] as Map<String, dynamic>? ?? const <String, dynamic>{};
    return CounsellorDetail(
      counsellor: Counsellor.fromJson(json['counsellor'] as Map<String, dynamic>),
      matched: json['matched'] == true,
      reasons: [for (final r in (json['reasons'] as List<dynamic>? ?? const [])) '$r'],
      unmet: [for (final r in (json['unmet'] as List<dynamic>? ?? const [])) '$r'],
      upcoming: [for (final row in (sessions['upcoming'] as List<dynamic>? ?? const [])) TalkSession.fromJson(row as Map<String, dynamic>)],
      past: [for (final row in (sessions['past'] as List<dynamic>? ?? const [])) TalkSession.fromJson(row as Map<String, dynamic>)],
    );
  }
}
