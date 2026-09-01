part of '../../manager/presentation/manager_screen.dart';

class _AwardCard extends StatelessWidget {
  const _AwardCard({
    required this.award,
    required this.team,
    required this.onNominate,
    this.titleOverride,
  });

  final AwardNomination award;
  final List<TeamMember> team;
  final VoidCallback onNominate;

  /// "Employee of the Month" is shown regardless of which underlying award
  /// category backs this card for now — see call site.
  final String? titleOverride;

  @override
  Widget build(BuildContext context) {
    final nominee = award.nomineeId == null
        ? null
        : team.where((item) => item.id == award.nomineeId).firstOrNull;
    const gold = Color(0xFFFFBF1B);
    const goldTint = Color(0xFFFFF8E6);
    const goldBorder = Color(0xFFFFCC00);
    const goldBadgeBorder = Color(0xFFFFDF8D);
    const goldButton = Color(0xFFFBC04B);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(17),
      decoration: BoxDecoration(
        color: goldTint,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: goldBorder),
        boxShadow: const [
          BoxShadow(
            color: Color(0x1A000000),
            blurRadius: 1.5,
            offset: Offset(0, 1),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Image.asset(
            'assets/icons/award_trophy_3d.png',
            width: 43,
            height: 43,
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: goldTint,
              borderRadius: BorderRadius.circular(99),
              border: Border.all(color: goldBadgeBorder),
            ),
            child: Text(
              titleOverride ?? award.title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: gold,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          if (nominee != null) ...[
            const SizedBox(height: 16),
            Row(
              children: [
                AvatarBadge(
                  initial: nominee.initial,
                  index: nominee.avatarIndex,
                  size: 35,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        nominee.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: MColors.ink,
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      Text(
                        nominee.team,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Color(0xFF717171),
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                // Backend only supports (re)submitting a nomination today, not
                // clearing one — so this re-opens the picker to reassign,
                // matching the design's remove affordance without a real
                // clear endpoint behind it.
                Semantics(
                  button: true,
                  label: 'Change nomination for ${titleOverride ?? award.title}',
                  child: InkWell(
                    borderRadius: BorderRadius.circular(99),
                    onTap: onNominate,
                    child: const Padding(
                      padding: EdgeInsets.all(4),
                      child: Icon(
                        Icons.close_rounded,
                        size: 20,
                        color: Color(0xFF717171),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ],
          const SizedBox(height: 16),
          Semantics(
            button: true,
            label: nominee == null
                ? 'Nominate someone for ${titleOverride ?? award.title}'
                : 'Change nomination for ${titleOverride ?? award.title}',
            child: SizedBox(
              width: double.infinity,
              child: Material(
                color: goldButton,
                borderRadius: BorderRadius.circular(8),
                child: InkWell(
                  borderRadius: BorderRadius.circular(8),
                  onTap: onNominate,
                  child: const Padding(
                    padding: EdgeInsets.symmetric(vertical: 10),
                    child: Text(
                      'Add',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: goldTint,
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _AwardPicker extends StatefulWidget {
  const _AwardPicker({required this.state, required this.bloc});

  final ManagerState state;
  final ManagerBloc bloc;

  @override
  State<_AwardPicker> createState() => _AwardPickerState();
}

class _AwardPickerState extends State<_AwardPicker> {
  void _close() => widget.bloc.add(const CloseAwardPicker());

  void _nominate(AwardNomination award, TeamMember member) {
    // No reason-writing step — picking a teammate nominates them directly.
    // The backend still requires a non-empty reason (HR-side review, not
    // yet surfaced anywhere in the app), so send a generic placeholder.
    widget.bloc.add(
      NominateAward(award.key, member.id, 'Employee of the Month nominee'),
    );
    _close();
  }

  @override
  Widget build(BuildContext context) {
    final data = widget.state.dashboard!;
    final award = data.awards.firstWhere(
      (item) => item.key == widget.state.awardPickerKey,
    );
    return Positioned.fill(
      child: GestureDetector(
        onTap: _close,
        child: Container(
          color: MColors.ink.withValues(alpha: .44),
          alignment: Alignment.bottomCenter,
          child: GestureDetector(
            onTap: () {},
            child: SafeArea(
              top: false,
              child: Padding(
                padding: EdgeInsets.only(
                  bottom: MediaQuery.of(context).viewInsets.bottom,
                ),
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.fromLTRB(18, 10, 18, 24),
                  decoration: const BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.vertical(
                      top: Radius.circular(24),
                    ),
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Center(
                        child: Container(
                          width: 38,
                          height: 4,
                          decoration: BoxDecoration(
                            color: MColors.line,
                            borderRadius: BorderRadius.circular(99),
                          ),
                        ),
                      ),
                      const SizedBox(height: 18),
                      const Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            // Only "Employee of the Month" is nominatable
                            // right now — see _AwardCard.
                            'Employee of the Month',
                            style: TextStyle(
                              color: MColors.ink,
                              fontSize: 20,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          SizedBox(height: 4),
                          Text(
                            'Choose one teammate for this recognition.',
                            style: TextStyle(
                              color: MColors.inkSoft,
                              fontSize: 13.5,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 14),
                      _pickList(data, award),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _pickList(ManagerDashboard data, AwardNomination award) {
    if (data.recognitionCandidates.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 26),
        child: Text(
          'You have no direct reports to nominate yet.',
          style: TextStyle(color: MColors.inkSoft, fontSize: 13.5),
        ),
      );
    }
    return ConstrainedBox(
      constraints: const BoxConstraints(maxHeight: 360),
      child: ListView.separated(
        shrinkWrap: true,
        itemCount: data.recognitionCandidates.length,
        separatorBuilder: (context, index) =>
            const Divider(height: 1, color: MColors.line),
        itemBuilder: (context, index) {
          final member = data.recognitionCandidates[index];
          return ListTile(
            contentPadding: EdgeInsets.zero,
            leading: AvatarBadge(
              initial: member.initial,
              index: member.avatarIndex,
              size: 38,
            ),
            title: Text(
              member.name,
              style: const TextStyle(
                fontWeight: FontWeight.w800,
                color: MColors.ink,
              ),
            ),
            subtitle: Text(member.team),
            trailing: const Icon(Icons.chevron_right_rounded),
            onTap: () => _nominate(award, member),
          );
        },
      ),
    );
  }

}

