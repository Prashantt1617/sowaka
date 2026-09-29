import 'package:flutter/material.dart';

import '../../auth/data/auth_models.dart';
import '../../manager_shell/presentation/app_home_header.dart';
import '../data/care_api_service.dart';
import '../data/care_models.dart';
import 'breathe_screen.dart';
import 'care_theme.dart';
import 'listen_screen.dart';
import 'move_screen.dart';
import 'sleep_screen.dart';
import 'write_screen.dart';

/// Care: anytime activities. Write leads; Move, Breathe, Listen and Sleep
/// sit in a grid under it. No daily requirement, nothing to complete.
class CareTab extends StatefulWidget {
  const CareTab({
    super.key,
    required this.session,
    required this.profileAction,
    required this.onNotifications,
    this.onOpenHelp,
    this.service,
  });

  final AuthSession session;
  final Widget profileAction;
  final VoidCallback onNotifications;

  /// Switches to the Help tab, for the link at the foot of the page.
  final VoidCallback? onOpenHelp;

  /// Supplied by tests; the tab makes its own otherwise.
  final CareApiService? service;

  @override
  State<CareTab> createState() => _CareTabState();
}

class _CareTabState extends State<CareTab> {
  late final CareApiService _service = widget.service ?? CareApiService(session: widget.session);

  /// Read once; the screens under the tab take it as it is.
  CareCatalog _catalog = CareCatalog.empty;

  @override
  void initState() {
    super.initState();
    _service.catalog().then((catalog) {
      if (mounted) setState(() => _catalog = catalog);
    }).catchError((_) {
      // The activities still open; they say a file is on its way.
    });
  }

  void _open(Widget screen) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));
  }

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: CareColors.bg,
      child: Column(
        children: [
          AppHomeHeader(profileAction: widget.profileAction, onNotifications: widget.onNotifications),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 22, 20, 32),
              children: [
                Stack(
                  children: [
                    Positioned(
                      right: 0,
                      top: 0,
                      child: Container(
                        width: 110,
                        height: 118,
                        decoration: const BoxDecoration(
                          color: CareColors.sage,
                          borderRadius: BorderRadius.only(
                            topLeft: Radius.circular(60),
                            topRight: Radius.circular(40),
                            bottomLeft: Radius.circular(48),
                            bottomRight: Radius.circular(72),
                          ),
                        ),
                        child: const Icon(Icons.eco_outlined, color: CareColors.blue, size: 34),
                      ),
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: const [
                        CareEyebrow('Care'),
                        SizedBox(height: 10),
                        CareHeading('A little space\nfor you.', size: 36),
                        SizedBox(height: 12),
                        CareCopy('Choose what feels right.\nWhenever you need it.', size: 13.5),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 26),
                _WriteCard(onTap: () => _open(WriteScreen(session: widget.session, service: _service, prompts: _catalog.prompts))),
                const SizedBox(height: 12),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: _ActivityCard(
                        key: const ValueKey('care-move'),
                        name: 'Move',
                        subtitle: 'Choose a body area',
                        icon: Icons.accessibility_new_rounded,
                        color: CareColors.sage,
                        onTap: () => _open(MoveScreen(catalog: _catalog)),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _ActivityCard(
                        key: const ValueKey('care-breathe'),
                        name: 'Breathe',
                        subtitle: 'Start with how you feel',
                        icon: Icons.air_rounded,
                        color: CareColors.sky,
                        onTap: () => _open(const BreatheScreen()),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: _ActivityCard(
                        key: const ValueKey('care-listen'),
                        name: 'Listen',
                        subtitle: 'Meditations & affirmations',
                        icon: Icons.headphones_outlined,
                        color: CareColors.lilac,
                        onTap: () => _open(ListenScreen(catalog: _catalog)),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _ActivityCard(
                        key: const ValueKey('care-sleep'),
                        name: 'Sleep',
                        subtitle: 'Ease into rest',
                        icon: Icons.nightlight_outlined,
                        color: CareColors.night,
                        onTap: () => _open(SleepScreen(catalog: _catalog)),
                      ),
                    ),
                  ],
                ),
                if (widget.onOpenHelp != null) ...[
                  const SizedBox(height: 22),
                  InkWell(
                    onTap: widget.onOpenHelp,
                    borderRadius: BorderRadius.circular(12),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Row(
                        children: const [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('Something on your mind?', style: TextStyle(fontFamily: careFont, color: CareColors.ink, fontSize: 14)),
                                SizedBox(height: 2),
                                Text('Explore it in Help', style: TextStyle(fontFamily: careFont, color: CareColors.blue, fontSize: 14, fontWeight: FontWeight.w700)),
                              ],
                            ),
                          ),
                          Icon(Icons.arrow_forward_rounded, color: CareColors.blue),
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

class _WriteCard extends StatelessWidget {
  const _WriteCard({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: CareColors.peach,
      borderRadius: BorderRadius.circular(24),
      child: InkWell(
        key: const ValueKey('care-write'),
        onTap: onTap,
        borderRadius: BorderRadius.circular(24),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(22, 22, 22, 22),
          child: Stack(
            children: [
              Positioned(
                right: 0,
                bottom: 0,
                child: Container(
                  width: 64,
                  height: 64,
                  decoration: const BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.only(
                      topLeft: Radius.circular(36),
                      topRight: Radius.circular(28),
                      bottomLeft: Radius.circular(30),
                      bottomRight: Radius.circular(40),
                    ),
                  ),
                  child: const Icon(Icons.edit_outlined, color: CareColors.blue, size: 26),
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: const [
                  Text('Write', style: TextStyle(fontFamily: careFont, color: CareColors.ink, fontSize: 20, fontWeight: FontWeight.w700)),
                  SizedBox(height: 12),
                  Text(
                    'What’s taking up space\nin your mind?',
                    style: TextStyle(fontFamily: careFont, color: CareColors.ink, fontSize: 24, fontWeight: FontWeight.w500, height: 1.2, letterSpacing: -0.4),
                  ),
                  SizedBox(height: 16),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text('Find a prompt', style: TextStyle(fontFamily: careFont, color: CareColors.clay, fontSize: 13, fontWeight: FontWeight.w600)),
                      SizedBox(width: 6),
                      Icon(Icons.arrow_forward_rounded, size: 16, color: CareColors.clay),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ActivityCard extends StatelessWidget {
  const _ActivityCard({super.key, required this.name, required this.subtitle, required this.icon, required this.color, required this.onTap});

  final String name;
  final String subtitle;
  final IconData icon;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: color,
      borderRadius: BorderRadius.circular(22),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(22),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 18, 18, 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(icon, color: CareColors.blue, size: 26),
                  const Spacer(),
                  const Icon(Icons.arrow_outward_rounded, color: CareColors.ink, size: 18),
                ],
              ),
              const SizedBox(height: 22),
              Text(name, style: const TextStyle(fontFamily: careFont, color: CareColors.ink, fontSize: 19, fontWeight: FontWeight.w700)),
              const SizedBox(height: 4),
              Text(subtitle, style: const TextStyle(fontFamily: careFont, color: CareColors.muted, fontSize: 12.5, height: 1.4)),
            ],
          ),
        ),
      ),
    );
  }
}
