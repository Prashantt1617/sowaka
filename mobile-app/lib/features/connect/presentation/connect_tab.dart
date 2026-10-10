part of '../../manager/presentation/manager_screen.dart';

class _ConnectTab extends StatelessWidget {
  const _ConnectTab({
    super.key,
    required this.session,
    required this.profileAction,
    required this.recognitionCandidates,
    required this.composerController,
    required this.data,
    required this.bloc,
    required this.onOpenProfile,
  });

  final AuthSession session;
  final Widget profileAction;
  final List<TeamMember> recognitionCandidates;
  final ConnectComposerController composerController;
  final ManagerDashboard data;
  final ManagerBloc bloc;

  /// Opens the signed-in person's own profile — the one the top-right photo
  /// opens.
  final VoidCallback onOpenProfile;

  /// A name or face tapped in the feed — an author, a commenter (in the
  /// full comments or the two previews under a post), an entrant, someone
  /// tagged. It goes through the same opener as a Team row or the org chart:
  /// your own name opens your own profile, a report opens their full profile,
  /// and anyone else in the company opens the colleague view.
  void _openPerson(BuildContext context, String userId) {
    if (userId.isEmpty) return;
    openPersonProfile(userId);
  }

  @override
  Widget build(BuildContext context) {
    return ConnectFeedScreen(
      key: const ValueKey('connect-feed-screen'),
      session: session,
      profileAction: profileAction,
      composerController: composerController,
      onOpenPerson: (userId) => _openPerson(context, userId),
      // The people who can be tagged, and recognised: the same team the Team
      // tab lists.
      recognitionCandidates:
          {
                for (final member in [...recognitionCandidates, ...data.team])
                  member.userId: member,
              }.values
              .map(
                (member) => ConnectTeammate(
                  userId: member.userId,
                  name: member.name,
                  initials: member.initial,
                  department: member.team,
                  photoUrl: member.photoUrl,
                ),
              )
              .toList(),
    );
  }
}

class _ProfileAvatarAction extends StatelessWidget {
  const _ProfileAvatarAction({
    super.key,
    required this.initial,
    required this.onTap,
    this.photoUrl,
    this.size = 42,
    this.label = 'Open profile',
  });

  final String initial;
  final VoidCallback onTap;
  final String? photoUrl;
  final double size;
  final String label;

  @override
  Widget build(BuildContext context) {
    final url = photoUrl;
    return Semantics(
      button: true,
      label: label,
      child: InkWell(
        borderRadius: BorderRadius.circular(99),
        onTap: onTap,
        child: url == null || url.isEmpty
            ? AvatarBadge(initial: initial, index: 1, size: size)
            : ClipOval(
                child: Image(
                  image: _profileImage(url),
                  width: size,
                  height: size,
                  fit: BoxFit.cover,
                ),
              ),
      ),
    );
  }
}
