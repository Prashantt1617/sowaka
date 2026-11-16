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
/// One per signed-in session ([of]), loaded once on first use and again
/// after anything changes it ([refresh]). Everything stays hidden until
/// `/lifecycle/me` says the lifecycle is on.
class OffboardingStore extends ChangeNotifier {
  OffboardingStore._(this.session) : api = OffboardingApi.forSession(session);

  static final _bySession = <String, OffboardingStore>{};

  static OffboardingStore of(AuthSession session) =>
      _bySession.putIfAbsent(session.token, () => OffboardingStore._(session));

  /// Forgets every session's store (sign-out, tests).
  @visibleForTesting
  static void reset() => _bySession.clear();

  final AuthSession session;
  final OffboardingApi api;

  LifecycleMe _me = LifecycleMe.off;
  ResignationState _resignation = ResignationState.none;
  List<ResignationView> _managerResignations = const [];
  bool _loaded = false;
  Future<void>? _loading;

  bool get loaded => _loaded;
  LifecycleMe get me => _me;
  bool get enabled => _me.enabled;
  ResignationState get resignationState => _resignation;

  /// This person's open resignation (not withdrawn), when the lifecycle is on.
  ResignationView? get resignation {
    final value = _resignation.resignation;
    if (!enabled || value == null || value.withdrawn) return null;
    return value;
  }

  /// R0: the Resign row at the bottom of Work detail.
  bool get canResign =>
      enabled && _resignation.canResign && resignation == null;

  /// R2a/R2b: the Resignation tab on one's own profile.
  bool get showsResignationTab => resignation != null;

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

  /// The ones waiting on the manager (R7's actionable cards).
  int get pendingForManager =>
      managerResignations.where((r) => r.withManager).length;

  /// R8b: a report has an open resignation, so their profile gets the tab.
  ResignationView? resignationOf(String userId) =>
      managerResignations.where((r) => r.userId == userId).firstOrNull;

  /// Loads once; later calls wait on the same load.
  Future<void> ensureLoaded() =>
      _loaded ? Future.value() : (_loading ??= _load());

  /// Reads everything again (after resigning, withdrawing, a manager action).
  Future<void> refresh() => _loading = _load();

  Future<void> _load() async {
    try {
      _me = await api.fetchMe();
    } catch (_) {
      _me = LifecycleMe.off;
    }
    if (_me.enabled) {
      await Future.wait([
        () async {
          try {
            _resignation = await api.fetchResignation();
          } catch (_) {
            _resignation = ResignationState.none;
          }
        }(),
        () async {
          try {
            _managerResignations = await api.fetchManagerResignations();
          } catch (_) {
            _managerResignations = const [];
          }
        }(),
      ]);
      unawaited(_rememberForClosedAccount());
    } else {
      _resignation = ResignationState.none;
      _managerResignations = const [];
    }
    _loaded = true;
    _loading = null;
    notifyListeners();
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
