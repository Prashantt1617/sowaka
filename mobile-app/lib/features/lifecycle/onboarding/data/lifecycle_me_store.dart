import 'package:flutter/foundation.dart';

import 'onboarding_api.dart';
import 'onboarding_models.dart';

/// What `/lifecycle/me` last said, for the places that only show while the
/// lifecycle is on: the Action tab's Onboarding tile, the profile's
/// Onboarding tab and the Team tab's New joiners. The signed-in shell reads
/// it at start and whenever the app comes back to the front; until then (and
/// when the company has it off) it is [LifecycleMe.off] and nothing shows.
class LifecycleMeStore extends ValueNotifier<LifecycleMe> {
  LifecycleMeStore() : super(LifecycleMe.off);

  static final instance = LifecycleMeStore();

  Future<void>? _inFlight;

  /// Reads `/lifecycle/me` again (one read at a time). While onboarding is
  /// on and the server did not count the steps, the onboarding home's counts
  /// fill the tile's "2 of 9 steps done". A failed read keeps what was known.
  Future<void> refresh(OnboardingApi api) => _inFlight ??= _read(api).whenComplete(() => _inFlight = null);

  Future<void> _read(OnboardingApi api) async {
    // What it said last time, from the device, first: the tile, the tab and
    // the Team tab's joiners show at once, and the live read corrects them.
    if (!_seeded) {
      _seeded = true;
      final kept = await api.fromDevice(_meOf);
      if (kept != null && !value.enabled) value = kept;
    }
    try {
      value = await _meOf(api);
    } catch (_) {
      // Offline or a hiccup: what was there stays.
    }
  }

  bool _seeded = false;

  static Future<LifecycleMe> _meOf(OnboardingApi api) async {
    var me = await api.fetchMe();
    if (me.showsOnboarding && me.onboarding!.progress == null) {
      try {
        final home = await api.fetchHome();
        me = me.withProgress(home.progress);
      } catch (_) {}
    }
    return me;
  }

  /// Signed out: nothing of theirs is left showing.
  void clear() {
    _seeded = false;
    value = LifecycleMe.off;
  }
}

/// The Action tile's subtitle, following the stage (6Zs §5.3 A1): the
/// server's words ("2 of 9 steps done" in week 1, then the next probation
/// step), else the steps counted, else the day and stage.
String onboardingTileSubtitle(LifecycleMe me) {
  final onboarding = me.onboarding;
  if (onboarding == null) return '';
  final said = onboarding.subtitle;
  if (said != null) return said;
  final progress = onboarding.progress;
  if (progress != null) return '${progress.done} of ${progress.total} steps done';
  final day = onboarding.dayLabel;
  final stage = onboardingStageLabel(onboarding.stage);
  return day == null ? stage : '$day · $stage';
}
