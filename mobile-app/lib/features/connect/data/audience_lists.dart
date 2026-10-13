import 'dart:async';

import 'package:flutter/foundation.dart' show visibleForTesting;

import '../../auth/data/auth_models.dart';
import '../presentation/audience_lists_ui.dart';
import 'connect_api_service.dart';

/// Custom audience lists — saved shortcuts of people a Connect post can be
/// sent to, like Snapchat's — and the company directory they are picked from.
///
/// The lists live on the server, one owner each, so they follow the person
/// to any device. A post sent to one is seen only by the people on it when
/// it went out, and its author; to everyone else on it, it reads "Private".
///
/// This keeps both for the session: the composer opens the audience sheet
/// often, and the directory is the whole company.
class AudienceListsStore {
  AudienceListsStore({required this.session, required this.api});

  /// The store for this session, made once and kept by the session's token:
  /// a Connect tab opened afresh keeps the directory it already has. A new
  /// sign-in starts a fresh one.
  factory AudienceListsStore.forSession(
    AuthSession session, {
    ConnectApiService? api,
  }) {
    final kept = _current;
    if (kept != null && kept.session.token == session.token) return kept;
    return _current = AudienceListsStore(
      session: session,
      api: api ?? ConnectApiService(session: session),
    );
  }

  static AudienceListsStore? _current;

  /// Drops the kept store, so the next [forSession] starts afresh. For tests,
  /// which share one token across fake servers.
  @visibleForTesting
  static void forget() => _current = null;

  final AuthSession session;
  final ConnectApiService api;

  List<AudienceListSummary>? _lists;
  List<AudiencePerson>? _people;
  Future<List<AudienceListSummary>>? _loadingLists;
  Future<List<AudiencePerson>>? _loadingPeople;

  /// Null until the first load lands.
  List<AudienceListSummary>? get lists => _lists;

  AudienceListSummary? listById(String id) {
    for (final list in _lists ?? const <AudienceListSummary>[]) {
      if (list.id == id) return list;
    }
    return null;
  }

  /// The viewer's lists, A to Z. Asked for once; changes made here keep it
  /// current without asking again.
  Future<List<AudienceListSummary>> loadLists() {
    final lists = _lists;
    if (lists != null) return Future.value(lists);
    return _loadingLists ??= () async {
      try {
        return _lists = _sorted(await api.fetchAudienceLists());
      } finally {
        _loadingLists = null;
      }
    }();
  }

  /// The viewer's lists read again from the server, so a list made elsewhere
  /// (on another phone, or for them by an admin) shows the next time the sheet
  /// opens. If the read fails, the lists already held stand.
  Future<List<AudienceListSummary>> refreshLists() async {
    try {
      final fresh = _sorted(await api.fetchAudienceLists());
      return _lists = fresh;
    } catch (_) {
      final kept = _lists;
      if (kept != null) return kept;
      rethrow;
    }
  }

  /// The whole company, A to Z by name, without the viewer.
  Future<List<AudiencePerson>> loadPeople() {
    final people = _people;
    if (people != null) return Future.value(people);
    return _loadingPeople ??= () async {
      try {
        final everyone = await api.fetchAudiencePeople();
        final seen = <String>{};
        final rows = [
          for (final person in everyone)
            if (person.id.isNotEmpty &&
                person.id != session.user.id &&
                seen.add(person.id))
              person,
        ]..sort(_byName);
        return _people = rows;
      } finally {
        _loadingPeople = null;
      }
    }();
  }

  Future<AudienceListSummary> create(AudienceListDraft draft) async {
    final list = await api.createAudienceList(
      name: draft.name,
      memberUserIds: draft.memberIds,
    );
    // Only a list already loaded is kept current; one never loaded (the
    // read failed) stays unloaded, so the next open reads it whole.
    if (_lists case final lists?) _lists = _sorted([...lists, list]);
    return list;
  }

  Future<AudienceListSummary> update(String id, AudienceListDraft draft) async {
    final list = await api.updateAudienceList(
      id,
      name: draft.name,
      memberUserIds: draft.memberIds,
    );
    if (_lists case final lists?) {
      _lists = _sorted([
        for (final existing in lists)
          if (existing.id == id) list else existing,
      ]);
    }
    return list;
  }

  Future<void> delete(String id) async {
    await api.deleteAudienceList(id);
    if (_lists case final lists?) {
      _lists = [
        for (final existing in lists)
          if (existing.id != id) existing,
      ];
    }
  }

  static int _byName(AudiencePerson a, AudiencePerson b) {
    final byName = a.name.toLowerCase().compareTo(b.name.toLowerCase());
    return byName != 0 ? byName : a.id.compareTo(b.id);
  }

  static List<AudienceListSummary> _sorted(List<AudienceListSummary> lists) =>
      [...lists]
        ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
}

/// What the composer's header says for a choice.
String audienceChoiceLabel(AudienceChoice choice) => switch (choice) {
  PublicAudience() => 'Public',
  TeamAudience() => 'Team',
  ListAudience(:final list) => list.name,
};

/// The audience as a post body carries it: `sendTo`, and the list beside it
/// when there is one. The server copies the list's people onto the post.
Map<String, dynamic> audienceBodyFields(
  AudienceChoice choice, {
  String publicValue = 'all_company',
}) => switch (choice) {
  PublicAudience() => {'sendTo': publicValue},
  TeamAudience() => {'sendTo': 'my_team'},
  ListAudience(:final list) => {'sendTo': 'list', 'listId': list.id},
};
