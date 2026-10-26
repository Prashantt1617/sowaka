part of 'quick_actions_screen.dart';

/// Actions › Placements, for a recruitment company (`features.placements`):
/// the hub of the "Placements Quick Action" canvas. Two cards, My candidates
/// and My clients, each with its counts; their lists, pages and forms open as
/// pages of their own (lib/features/placements/presentation).
class PlacementsScreen extends StatefulWidget {
  const PlacementsScreen({
    super.key,
    required this.api,
    required this.onClose,
    required this.profileAction,
    required this.onNotifications,
    required this.onQuickCreate,
  });

  final PlacementsApiService api;

  /// Leaves Placements for the Actions home.
  final VoidCallback onClose;
  final Widget profileAction;
  final VoidCallback onNotifications;
  final VoidCallback onQuickCreate;

  @override
  State<PlacementsScreen> createState() => _PlacementsScreenState();
}

class _PlacementsScreenState extends State<PlacementsScreen> {
  List<PlacementCustomer>? _candidates;
  List<PlacementClient>? _clients;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  /// Back within Placements: its pages are routes of their own, so the hub
  /// has nothing to go back through.
  bool back() => false;

  Future<void> _load() async {
    try {
      final (candidates, clients) = await (
        widget.api.fetchCustomers(mine: true),
        widget.api.fetchClients(mine: true),
      ).wait;
      if (!mounted) return;
      setState(() {
        _candidates = candidates;
        _clients = clients;
        _error = null;
      });
    } on ParallelWaitError<dynamic, dynamic> catch (error) {
      if (!mounted) return;
      final first = error.errors.$1?.error ?? error.errors.$2?.error;
      setState(() => _error = placementsErrorText(first ?? error));
    } catch (error) {
      if (mounted) setState(() => _error = placementsErrorText(error));
    }
  }

  Future<void> _open(Widget page) async {
    await Navigator.of(
      context,
    ).push(MaterialPageRoute<void>(builder: (_) => page));
    if (mounted) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final candidates = _candidates;
    final clients = _clients;
    int stage(CandidateStage s) =>
        candidates?.where((c) => c.stage == s).length ?? 0;
    final openRoles =
        clients?.fold<int>(0, (sum, c) => sum + c.designations.length) ?? 0;
    final paid = clients?.where((c) => c.feePaid).length ?? 0;
    return _HubScaffold(
      key: const ValueKey('placements-hub'),
      title: 'Placements',
      onBack: widget.onClose,
      profileAction: widget.profileAction,
      onNotifications: widget.onNotifications,
      onQuickCreate: widget.onQuickCreate,
      backgroundColor: Pl.ground,
      children: [
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Pl.accentSoft,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Pl.accentTint),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Log your candidates, clients and placements.',
                style: Pl.text(
                  15,
                  weight: FontWeight.w700,
                  color: Pl.accentText,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                'Your performance incentive is connected to this.',
                style: Pl.text(13, color: Pl.accentText),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        if (_error != null && candidates == null)
          PlState.message(_error, onRetry: _load)
        else ...[
          _PlacementsHubCard(
            key: const ValueKey('placements-candidates'),
            icon: Icons.person_search_outlined,
            title: 'My candidates',
            count: candidates?.length,
            stats: [
              (stage(CandidateStage.notPlaced), 'Not placed'),
              (stage(CandidateStage.inProcess), 'In process'),
              (stage(CandidateStage.joined), 'Joined'),
            ],
            onTap: () => _open(CandidatesPage(api: widget.api)),
          ),
          const SizedBox(height: 12),
          _PlacementsHubCard(
            key: const ValueKey('placements-clients'),
            icon: Icons.apartment_outlined,
            title: 'My clients',
            count: clients?.length,
            stats: [
              (openRoles, 'Open roles'),
              (paid, 'Fee paid'),
              ((clients?.length ?? 0) - paid, 'Fee pending'),
            ],
            onTap: () => _open(ClientsPage(api: widget.api)),
          ),
          const SizedBox(height: 14),
          Text(
            'Open a list to add, edit or log a placement.',
            textAlign: TextAlign.center,
            style: Pl.text(13, color: Pl.muted),
          ),
        ],
      ],
    );
  }
}

class _PlacementsHubCard extends StatelessWidget {
  const _PlacementsHubCard({
    super.key,
    required this.icon,
    required this.title,
    required this.count,
    required this.stats,
    required this.onTap,
  });

  final IconData icon;
  final String title;

  /// Null while loading.
  final int? count;
  final List<(int, String)> stats;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return PlCard(
      radius: 20,
      padding: const EdgeInsets.all(16),
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: Pl.accentTint,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(icon, color: Pl.accent),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(title, style: Pl.text(17, weight: FontWeight.w700)),
              ),
              Text(
                count == null ? '…' : '$count',
                style: Pl.text(20, weight: FontWeight.w700),
              ),
              const SizedBox(width: 4),
              const Icon(Icons.chevron_right_rounded, color: Pl.icon),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              for (final (index, (n, label)) in stats.indexed) ...[
                if (index > 0) const SizedBox(width: 8),
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      vertical: 10,
                      horizontal: 8,
                    ),
                    decoration: BoxDecoration(
                      color: Pl.stone,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Column(
                      children: [
                        Text(
                          count == null ? '–' : '$n',
                          style: Pl.text(18, weight: FontWeight.w700),
                        ),
                        Text(
                          label,
                          textAlign: TextAlign.center,
                          style: Pl.text(12, color: Pl.muted),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}
