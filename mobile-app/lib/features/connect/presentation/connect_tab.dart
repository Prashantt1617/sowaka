part of '../../manager/presentation/manager_screen.dart';

class _ConnectTab extends StatelessWidget {
  const _ConnectTab({
    super.key,
    required this.session,
    required this.profileAction,
    required this.recognitionCandidates,
    required this.composerController,
    required this.data,
  });

  final AuthSession session;
  final Widget profileAction;
  final List<TeamMember> recognitionCandidates;
  final ConnectComposerController composerController;
  final ManagerDashboard data;

  @override
  Widget build(BuildContext context) {
    return ConnectFeedScreen(
      key: const ValueKey('connect-feed-screen'),
      session: session,
      profileAction: profileAction,
      composerController: composerController,
      // The people who can be tagged, and recognised: the same team the Team
      // tab lists. Tags render as labels only for now — `onOpenPerson` is
      // deliberately left unset, so the chips aren't tappable.
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
