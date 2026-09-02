part of '../../manager/presentation/manager_screen.dart';

class _ConnectTab extends StatelessWidget {
  const _ConnectTab({
    super.key,
    required this.session,
    required this.profileAction,
    required this.recognitionCandidates,
    required this.composerController,
  });

  final AuthSession session;
  final Widget profileAction;
  final List<TeamMember> recognitionCandidates;
  final ConnectComposerController composerController;

  @override
  Widget build(BuildContext context) {
    return ConnectFeedScreen(
      key: const ValueKey('connect-feed-screen'),
      session: session,
      profileAction: profileAction,
      composerController: composerController,
      recognitionCandidates: recognitionCandidates
          .map(
            (member) => ConnectTeammate(
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
