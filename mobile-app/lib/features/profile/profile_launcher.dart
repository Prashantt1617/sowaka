/// Opening someone's profile from anywhere in the app — a feed post's author,
/// a commenter, an org chart — by their userId.
///
/// The signed-in shell (`ManagerScreen`) is what knows how to build a profile:
/// it holds the dashboard, the bloc and the bottom tabs the page sits over. It
/// registers itself here while it is mounted, so code in another library can
/// open a profile without importing the shell.
library;

/// Where a profile was opened from, which decides the tab it opens on: from
/// the feed, their posts; from the Team tab or an org chart, their org chart;
/// from anywhere else, the profile's usual first tab.
enum ProfileEntry { feed, team, orgChart, elsewhere }

/// Opens the profile for [userId]: the viewer's own profile when it is them,
/// a report's full profile when they report to the viewer, and otherwise the
/// colleague view (Attendance, Work detail, Org chart, Rank). False when
/// nothing could be opened — no userId, or no signed-in shell on screen.
typedef PersonProfileOpener = bool Function(String userId, ProfileEntry from);

PersonProfileOpener? _opener;

/// Opens [userId]'s profile. Safe to call from any widget; does nothing and
/// returns false when no shell is listening.
bool openPersonProfile(String userId, {ProfileEntry from = ProfileEntry.elsewhere}) {
  final open = _opener;
  if (open == null || userId.trim().isEmpty) return false;
  return open(userId.trim(), from);
}

/// Whether a tap on a person can open their profile right now.
bool get canOpenPersonProfile => _opener != null;

/// Called by the shell when it mounts. Replaces any earlier registration.
void registerPersonProfileOpener(PersonProfileOpener opener) {
  _opener = opener;
}

/// Called by the shell when it goes. Only clears [opener]'s own registration,
/// so a shell disposed after a newer one mounted cannot unhook it.
void unregisterPersonProfileOpener(PersonProfileOpener opener) {
  // Equality, not identity: two tear-offs of one method on one object are
  // equal but need not be the same instance.
  if (_opener == opener) _opener = null;
}
