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
  /// Placements' own pages stack here, inside the Actions tab, so the app's
  /// header and bottom bar stay on screen.
  final _nav = GlobalKey<NavigatorState>();
  List<PlacementCustomer>? _candidates;
  List<PlacementClient>? _clients;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  /// Back within Placements: one page back, or false on the hub, where Back
  /// leaves it.
  bool back() {
    final nav = _nav.currentState;
    if (nav == null || !nav.canPop()) return false;
    nav.pop();
    return true;
  }

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
    await _nav.currentState?.push(
      MaterialPageRoute<void>(builder: (_) => page),
    );
    if (mounted) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    return _PlacementsChrome(
      profileAction: widget.profileAction,
      onNotifications: widget.onNotifications,
      onQuickCreate: widget.onQuickCreate,
      child: Navigator(
        key: _nav,
        onGenerateRoute: (_) => MaterialPageRoute<void>(builder: (_) => _hub()),
      ),
    );
  }

  Widget _hub() {
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
        // A note at the top, as the Apply leave form sets one (node
        // 691:19752): what this is for, on a tint.
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: _Q.terraTint,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Log your candidates, clients and placements.',
                style: Pl.text(
                  12,
                  weight: FontWeight.w700,
                  color: _Q.terraDeep,
                  height: 16.2 / 12,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                'Your performance incentive is connected to this.',
                style: Pl.text(12, color: _Q.terraDeep, height: 16.2 / 12),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        if (_error != null && candidates == null)
          PlState.message(_error, onRetry: _load)
        else ...[
          const _HomeSectionLabel('Candidates'),
          const SizedBox(height: 12),
          _PlacementsHubCard(
            key: const ValueKey('placements-candidates'),
            iconAsset: 'assets/icons/connect_icon_user.png',
            title: 'My candidates',
            count: candidates?.length,
            stats: [
              (stage(CandidateStage.notPlaced), 'Not placed'),
              (stage(CandidateStage.inProcess), 'In process'),
              (stage(CandidateStage.joined), 'Joined'),
            ],
            onTap: () => _open(CandidatesPage(api: widget.api)),
          ),
          const SizedBox(height: 20),
          const _HomeSectionLabel('Clients'),
          const SizedBox(height: 12),
          _PlacementsHubCard(
            key: const ValueKey('placements-clients'),
            iconAsset: 'assets/icons/placements_client_building.png',
            title: 'My clients',
            count: clients?.length,
            stats: [
              (openRoles, 'Open roles'),
              (paid, 'Fee paid'),
              ((clients?.length ?? 0) - paid, 'Fee pending'),
            ],
            onTap: () => _open(ClientsPage(api: widget.api)),
          ),
          const SizedBox(height: 12),
          const Text(
            'Open a list to add, edit or log a placement.',
            style: TextStyle(
              fontFamily: Pl.font,
              color: Color(0xFF717171),
              fontSize: 10,
              height: 16.2 / 10,
              letterSpacing: -0.16,
            ),
          ),
        ],
      ],
    );
  }
}

/// A list's card on the hub, as the hubs' summary cards are drawn
/// ([_HubSummaryCard]): the list's picture and name with its count, then
/// its figures, each over its caption.
class _PlacementsHubCard extends StatelessWidget {
  const _PlacementsHubCard({
    super.key,
    required this.iconAsset,
    required this.title,
    required this.count,
    required this.stats,
    required this.onTap,
  });

  final String iconAsset;
  final String title;

  /// Null while loading.
  final int? count;
  final List<(int, String)> stats;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return PlCard(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Image.asset(iconAsset, width: 20, height: 20, fit: BoxFit.cover),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Pl.text(14, weight: FontWeight.w600, height: 20 / 14),
                ),
              ),
              Text(
                count == null ? '…' : '$count',
                style: Pl.text(14, weight: FontWeight.w700, height: 20 / 14),
              ),
              const SizedBox(width: 2),
              const Icon(
                Icons.chevron_right_rounded,
                size: 20,
                color: Pl.faint,
              ),
            ],
          ),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.only(top: 12),
            decoration: const BoxDecoration(
              border: Border(top: BorderSide(color: Pl.line, width: 0.8)),
            ),
            child: Row(
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
                            style: Pl.text(
                              14,
                              weight: FontWeight.w700,
                              height: 20 / 14,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            label,
                            textAlign: TextAlign.center,
                            style: Pl.text(
                              10,
                              weight: FontWeight.w400,
                              color: Pl.faint,
                              height: 15 / 10,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// What every Placements page needs for the app's header, handed down past
/// Placements' own navigator.
class _PlacementsChrome extends InheritedWidget {
  const _PlacementsChrome({
    required this.profileAction,
    required this.onNotifications,
    required this.onQuickCreate,
    required super.child,
  });

  final Widget profileAction;
  final VoidCallback onNotifications;
  final VoidCallback onQuickCreate;

  static _PlacementsChrome? of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<_PlacementsChrome>();

  @override
  bool updateShouldNotify(_PlacementsChrome old) =>
      profileAction != old.profileAction;
}
