import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../auth/data/auth_models.dart';
import 'offboarding_api.dart';
import 'offboarding_models.dart';

/// Where this person stands in leaving, for the surfaces that show it: the
/// profile's Resign row and Resignation tab, the Action tab's Off-boarding
/// tile, and — for a manager — the resignations in Team › Requests and the
/// Resignation tab on a report's profile.
///
/// One per signed-in session ([of]). Loaded on first use, and read again
/// whenever what it says may have moved on elsewhere: the app coming back to
/// the front, a lifecycle push arriving or being opened, a pull to refresh,
/// opening the profile, the Requests or the Action tab ([revalidate]), and
/// after anything this person does ([refresh]). HR accepting, the manager
/// acting or a report resigning shows without a restart. Everything stays
/// hidden until `/lifecycle/me` says the lifecycle is on.
class OffboardingStore extends ChangeNotifier {
  OffboardingStore._(this.session) : api = OffboardingApi.forSession(session);

  static final _bySession = <String, OffboardingStore>{};

  static OffboardingStore of(AuthSession session) =>
      _bySession.putIfAbsent(session.token, () => OffboardingStore._(session));

  /// Forgets every session's store (sign-out, tests).
  @visibleForTesting
  static void reset() {
    _bySession.clear();
    OffboardingApi.forgetKept();
  }

  /// How long a load is taken as current when a screen opens ([revalidate]).
  static const freshFor = Duration(seconds: 20);

  final AuthSession session;
  final OffboardingApi api;

  LifecycleMe _me = LifecycleMe.off;
  ResignationState _resignation = ResignationState.none;
  List<ResignationView> _managerResignations = const [];
  List<LeaverSummary> _managerLeavers = const [];
  bool _loaded = false;
  DateTime? _loadedAt;
  Future<void>? _loading;
  bool _again = false;
  String? _focusResignationId;

  bool get loaded => _loaded;
  LifecycleMe get me => _me;
  bool get enabled => _me.enabled;
  ResignationState get resignationState => _resignation;

  /// The reasons R1 offers: the server's list, else the app's own.
  List<String> get reasons => _resignation.reasons;

  /// This person's open resignation (not withdrawn), when the lifecycle is on.
  ResignationView? get resignation {
    final value = _resignation.resignation;
    if (!enabled || value == null || value.withdrawn) return null;
    return value;
  }

  /// R0: the Resign row at the bottom of Work detail.
  bool get canResign =>
      enabled && _resignation.canResign && resignation == null && !onNotice;

  /// An exit is under way for this person (HR accepted, or HR started it).
  bool get onNotice {
    final off = _me.offboarding;
    return enabled &&
        off != null &&
        !off.withdrawn &&
        !off.closed &&
        (off.status == 'accepted' || off.journeyId != null);
  }

  /// An exit HR started (retirement, end of contract): no resignation, but
  /// the notice runs all the same and its page is on.
  bool get exitWithoutResignation =>
      resignation == null && onNotice && showsOffboardingPage;

  /// R2a/R2b: the tab on one's own profile — the resignation's, or the
  /// countdown of an exit HR started (R2b, "countdown in R2b").
  bool get showsResignationTab => resignation != null || exitWithoutResignation;

  /// The tab's name: "Resignation", or "Exit" when HR started it.
  String get resignationTabLabel =>
      resignation == null && exitWithoutResignation ? 'Exit' : 'Resignation';

  /// R3: the Off-boarding tile and page in the Action tab.
  bool get showsOffboardingPage {
    final off = _me.offboarding;
    return enabled &&
        off != null &&
        off.pageVisible &&
        !off.withdrawn &&
        !off.closed;
  }

  /// The resignations of the manager's reports that are still open.
  List<ResignationView> get managerResignations => enabled
      ? _managerResignations.where((r) => !r.withdrawn).toList()
      : const [];

  /// The manager's reports with an exit under way (HR-started ones too).
  List<LeaverSummary> get managerLeavers =>
      enabled ? _managerLeavers : const [];

  /// The ones waiting on the manager (R7's actionable cards).
  int get pendingForManager =>
      managerResignations.where((r) => r.withManager).length;

  /// R8b: a report has an open resignation, so their profile gets the tab.
  ResignationView? resignationOf(String userId) =>
      managerResignations.where((r) => r.userId == userId).firstOrNull;

  /// A report whose exit is under way (accepted, or started by HR).
  LeaverSummary? leaverOf(String userId) =>
      managerLeavers.where((l) => l.userId == userId).firstOrNull;

  /// R8b: whether a report's profile carries the Resignation tab — an open
  /// or accepted resignation, or an exit HR started.
  bool hasLeaverTab(String userId) =>
      resignationOf(userId) != null || leaverOf(userId) != null;

  /// The resignation card Team › Requests should bring into view (a push
  /// about it was opened). Cleared once shown ([takeFocus]).
  String? get focusResignationId => _focusResignationId;

  void focusResignation(String? id) {
    if (id == null || id.isEmpty) return;
    _focusResignationId = id;
    notifyListeners();
  }

  /// The card to scroll to, once: true for [id] the first time it is asked.
  bool takeFocus(String id) {
    if (_focusResignationId != id) return false;
    _focusResignationId = null;
    return true;
  }

  /// Loads once; later calls wait on the same load.
  Future<void> ensureLoaded() =>
      _loaded ? Future.value() : (_loading ??= _load());

  /// Reads everything again (after resigning, withdrawing, a manager action,
  /// a push, a pull to refresh). A call during a load waits for it and then
  /// reads once more, so what it returns to is never older than the call.
  Future<void> refresh() {
    final running = _loading;
    if (running == null) return _loading = _load();
    _again = true;
    return running;
  }

  /// A screen opening: loads when nothing is loaded yet, and reads again
  /// when what is loaded is older than [maxAge].
  Future<void> revalidate({Duration maxAge = freshFor}) {
    if (!_loaded) return ensureLoaded();
    final at = _loadedAt;
    if (at != null && DateTime.now().difference(at) < maxAge) {
      return _loading ?? Future.value();
    }
    return refresh();
  }

  Future<void> _load() async {
    // The last copy from the device first: the tabs, tiles and Requests show
    // at once, and the live read below corrects them.
    if (!_loaded) {
      final kept = await api.fromDevice((a) => _readFrom(a, keep: false));
      if (kept != null && !_loaded) {
        _apply(kept);
        _loaded = true;
        _readAhead = true;
        notifyListeners();
      }
    }
    do {
      _again = false;
      await _read();
    } while (_again);
    _loaded = true;
    _loadedAt = DateTime.now();
    _loading = null;
    notifyListeners();
  }

  Future<void> _read() async {
    _apply(await _readFrom(api, keep: true));
    if (_me.enabled) unawaited(_rememberForClosedAccount());
  }

  void _apply(_Read r) {
    _me = r.me;
    _resignation = r.resignation;
    _managerResignations = r.managerResignations;
    _managerLeavers = r.managerLeavers;
  }

  /// Everything at once: `/lifecycle/me`, the resignation and the manager's
  /// lists together (not one after the other), and each known leaver's tab
  /// read alongside the lists, so opening it is instant. Off → nothing shows.
  Future<_Read> _readFrom(OffboardingApi a, {required bool keep}) async {
    Future<T> safe<T>(Future<T> Function() f, T fallback) async {
      try {
        return await f();
      } catch (_) {
        return fallback;
      }
    }

    // A replay (keep false) must fail when /me was never kept, so nothing is painted from nothing.
    final meFuture = keep ? safe(a.fetchMe, LifecycleMe.off) : a.fetchMe();
    Future<ResignationState> resignation() => safe(a.fetchResignation, ResignationState.none);
    Future<List<ResignationView>> resignations() => safe(a.fetchManagerResignations, const <ResignationView>[]);
    Future<List<LeaverSummary>> leavers() => safe(a.fetchManagerLeavers, const <LeaverSummary>[]);
    // On last time (the device copy or the previous read): the lists go out
    // with /lifecycle/me, not after it. Off (a company without it): only /me.
    final wasOn = !keep || _me.enabled;
    final early = wasOn ? (resignation(), resignations(), leavers()) : null;
    if (keep && _readAhead) {
      _readAhead = false;
      for (final leaver in _managerLeavers) {
        unawaited(leaverView(leaver.userId).then<void>((_) {}, onError: (Object _) {}));
      }
    }
    final me = await meFuture;
    if (!me.enabled) {
      return (me: me, resignation: ResignationState.none, managerResignations: const <ResignationView>[], managerLeavers: const <LeaverSummary>[]);
    }
    final (r, rs, ls) = early ?? (resignation(), resignations(), leavers());
    return (me: me, resignation: await r, managerResignations: await rs, managerLeavers: await ls);
  }

  /// The cold start, painted from the device: each known leaver's tab is read
  /// alongside the lists (once), so opening it is instant.
  bool _readAhead = false;

  final Map<String, Future<LeaverView>> _readAheads = {};

  /// Reads a report's leaver tab ahead (cold start), for the tab to pick up.
  Future<LeaverView> leaverView(String userId) => _readAheads[userId] = api.fetchLeaver(userId);

  /// The tab's first read: the one already on its way (read ahead with the
  /// lists), else a fresh one. Taken once, so a later read is never older
  /// than a save before it.
  Future<LeaverView> firstLeaverRead(String userId) => _readAheads.remove(userId) ?? api.fetchLeaver(userId);

  /// The tab as the device last had it, without the network.
  Future<LeaverView?> keptLeaverView(String userId) => api.fromDevice((a) => a.fetchLeaver(userId));

  /// Whether a push (as it arrives or is opened) is about leaving: a
  /// resignation, the off-boarding, a handover, the exit interview.
  static bool isOffboardingPush(Map<String, dynamic> data) {
    final type = '${data['type'] ?? ''}';
    final destination = '${data['destination'] ?? ''}';
    return type == 'lifecycle_offboarding' ||
        type == 'lifecycle_resignation' ||
        offboardingPushDestinations.contains(destination);
  }

  /// Someone serving notice: what the account-closed screen (R6) should say
  /// once their account ends, kept on the device, since a closed account
  /// can no longer ask.
  Future<void> _rememberForClosedAccount() async {
    final off = _me.offboarding;
    final email = session.user.email;
    if (email.isEmpty) return;
    if (off == null || off.withdrawn) {
      await AccountClosedHints.forget(email);
      return;
    }
    await AccountClosedHints.remember(
      email,
      AccountClosedInfo(
        companyName: session.user.company.isEmpty ? null : session.user.company,
        lastDay: off.tl ?? resignation?.lastDay,
      ),
    );
  }
}

/// The `data.destination` of every offboarding push (backend
/// services/lifecycle/offboarding.ts `OffboardingDestination`); where the
/// app takes each is `openOffboardingDestination`.
const offboardingPushDestinations = {
  'lifecycle_resignation_request',
  'lifecycle_resignation',
  'lifecycle_offboarding',
  'lifecycle_handover',
  'lifecycle_exit_interview',
  'lifecycle_leaver',
  'lifecycle_clearance',
};

/// What a closed account's screen says, remembered per email on this device
/// while the person is on notice in a company with the lifecycle on.
abstract final class AccountClosedHints {
  static String _key(String email) =>
      'lifecycle.closed.${email.trim().toLowerCase()}';

  static Future<void> remember(String email, AccountClosedInfo info) async {
    try {
      final preferences = await SharedPreferences.getInstance();
      await preferences.setString(_key(email), jsonEncode(info.toJson()));
    } catch (_) {}
  }

  static Future<void> forget(String email) async {
    try {
      final preferences = await SharedPreferences.getInstance();
      await preferences.remove(_key(email));
    } catch (_) {}
  }

  static Future<AccountClosedInfo?> read(String email) async {
    if (email.trim().isEmpty) return null;
    try {
      final preferences = await SharedPreferences.getInstance();
      final raw = preferences.getString(_key(email));
      if (raw == null) return null;
      final json = jsonDecode(raw);
      return json is Map
          ? AccountClosedInfo.fromJson(json.cast<String, dynamic>())
          : null;
    } catch (_) {
      return null;
    }
  }
}

/// Whether a refused sign-in or profile check means the account has closed,
/// and what to show for it (R6).
///
/// The server already refuses an ended account: `/auth/request-otp` with 403
/// "This employee account is not active", and every signed-in call (with
/// `/auth/me`) with 401 "User is not active". The account-closed screen is
/// shown only where the lifecycle is on: when the refusal carries an
/// `accountClosed` object (a lifecycle server's), or when this device
/// remembered that [email] was on notice ([AccountClosedHints]). Anyone else
/// keeps today's behaviour.
Future<AccountClosedInfo?> accountClosedFor({
  required int? statusCode,
  required String message,
  Map<String, dynamic>? body,
  String? email,
}) async {
  if (statusCode != 401 && statusCode != 403) return null;
  final closed = body?['accountClosed'];
  if (closed is Map) {
    return AccountClosedInfo.fromJson(closed.cast<String, dynamic>());
  }
  if (closed == true) return AccountClosedInfo.fromJson(body ?? const {});
  final inactive = RegExp(
    r'not active',
    caseSensitive: false,
  ).hasMatch(message);
  if (!inactive || email == null) return null;
  return AccountClosedHints.read(email);
}

typedef _Read = ({
  LifecycleMe me,
  ResignationState resignation,
  List<ResignationView> managerResignations,
  List<LeaverSummary> managerLeavers,
});
