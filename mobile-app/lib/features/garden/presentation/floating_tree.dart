import 'dart:async';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../auth/data/auth_models.dart';
import '../data/garden_api_service.dart';
import '../data/garden_models.dart';
import 'garden_widgets.dart';
import 'garden_screen.dart';

/// Whether the person's own tree floats over every screen. Set from the
/// garden, kept on the device, on by default.
class FloatingTreeSettings {
  static const _key = 'garden.floatingTree';
  static final enabled = ValueNotifier<bool>(true);
  static bool _loaded = false;

  static Future<void> load() async {
    if (_loaded) return;
    _loaded = true;
    try {
      final prefs = await SharedPreferences.getInstance();
      enabled.value = prefs.getBool(_key) ?? true;
    } catch (_) {
      // Stays on.
    }
  }

  static Future<void> set(bool value) async {
    enabled.value = value;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_key, value);
    } catch (_) {}
  }
}

/// The person's own tree, small, bobbing over the app. Drag it anywhere; it
/// settles at the nearest side with a bounce and remembers where it was
/// left. Tap it to open the tree. It is read again each time a screen
/// opens, so a flower given a minute ago is already on it.
class FloatingTree extends StatefulWidget {
  const FloatingTree({super.key, required this.session, required this.refreshKey, this.service});

  final AuthSession session;

  /// Changes when a screen opens; the tree reads itself again, at most once
  /// every twenty seconds.
  final Object refreshKey;
  final GardenApiService? service;

  @override
  State<FloatingTree> createState() => _FloatingTreeState();
}

class _FloatingTreeState extends State<FloatingTree> with TickerProviderStateMixin, WidgetsBindingObserver {
  static const _size = Size(96, 112);
  static const _posKey = 'garden.floatingTree.pos';

  late final GardenApiService _service = widget.service ?? GardenApiService(session: widget.session);
  late final AnimationController _bob = AnimationController(vsync: this, duration: const Duration(milliseconds: 1400))..repeat(reverse: true);

  /// A hop every few seconds: up with a stretch, down with a squash.
  late final AnimationController _hop = AnimationController(vsync: this, duration: const Duration(milliseconds: 700));
  Timer? _hopTimer;

  GardenView? _garden;
  DateTime? _lastLoad;

  /// Where the tree sits, as a fraction of the space it may move in.
  Offset _fraction = const Offset(1, 0.55);
  bool _dragging = false;
  Offset _dragPosition = Offset.zero;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    FloatingTreeSettings.load();
    _restorePosition();
    _load();
    _scheduleHop();
  }

  void _scheduleHop() {
    _hopTimer?.cancel();
    _hopTimer = Timer(Duration(milliseconds: 2200 + (DateTime.now().millisecond % 5) * 300), () {
      if (!mounted) return;
      if (!_dragging) _hop.forward(from: 0);
      _scheduleHop();
    });
  }

  @override
  void didUpdateWidget(covariant FloatingTree old) {
    super.didUpdateWidget(old);
    if (old.refreshKey != widget.refreshKey) _load();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _load(force: true);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _hopTimer?.cancel();
    _hop.dispose();
    _bob.dispose();
    super.dispose();
  }

  Future<void> _restorePosition() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getStringList(_posKey);
      if (raw != null && raw.length == 2 && mounted) {
        setState(() => _fraction = Offset(double.parse(raw[0]), double.parse(raw[1])));
      }
    } catch (_) {}
  }

  Future<void> _savePosition() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setStringList(_posKey, ['${_fraction.dx}', '${_fraction.dy}']);
    } catch (_) {}
  }

  Future<void> _load({bool force = false}) async {
    final last = _lastLoad;
    if (!force && last != null && DateTime.now().difference(last) < const Duration(seconds: 20)) return;
    _lastLoad = DateTime.now();
    try {
      final garden = await _service.garden();
      if (mounted) setState(() => _garden = garden);
    } catch (_) {
      // Keep what we had.
    }
  }

  GardenPerson? get _me => _garden?.people.where((p) => p.isMe).firstOrNull;

  /// Opens the whole garden, where their own tree is a tap away.
  Future<void> _open() async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => GardenScreen(session: widget.session, service: _service),
      ),
    );
    _load(force: true);
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.session.user.enabledTabs.contains('games')) return const SizedBox.shrink();
    return ValueListenableBuilder<bool>(
      valueListenable: FloatingTreeSettings.enabled,
      builder: (context, enabled, _) {
        if (!enabled) return const SizedBox.shrink();
        return LayoutBuilder(
          builder: (context, constraints) {
            // The room it may move in: under the header, above the bar.
            final top = MediaQuery.paddingOf(context).top + 64;
            final bottom = 96.0;
            final room = Size(constraints.maxWidth - _size.width, constraints.maxHeight - top - bottom - _size.height);
            final resting = Offset(_fraction.dx * room.width, top + _fraction.dy * room.height);
            final at = _dragging ? _dragPosition : resting;
            final sprites = _garden?.trees[_me?.userId ?? ''] ?? const <GardenSprite>[];
            return Stack(
              children: [
                AnimatedPositioned(
                  duration: _dragging ? Duration.zero : const Duration(milliseconds: 650),
                  curve: Curves.elasticOut,
                  left: at.dx,
                  top: at.dy,
                  child: GestureDetector(
                    onTap: _open,
                    onPanStart: (details) => setState(() {
                      _dragging = true;
                      _dragPosition = resting;
                    }),
                    onPanUpdate: (details) => setState(() {
                      _dragPosition = Offset(
                        (_dragPosition.dx + details.delta.dx).clamp(0, room.width),
                        (_dragPosition.dy + details.delta.dy).clamp(top, top + room.height),
                      );
                    }),
                    onPanEnd: (_) {
                      // Settle at the nearer side, at the height it was let go.
                      final side = _dragPosition.dx + _size.width / 2 < constraints.maxWidth / 2 ? 0.0 : 1.0;
                      setState(() {
                        _fraction = Offset(side, room.height <= 0 ? 0 : ((_dragPosition.dy - top) / room.height).clamp(0, 1));
                        _dragging = false;
                      });
                      _savePosition();
                    },
                    child: AnimatedBuilder(
                      animation: Listenable.merge([_bob, _hop]),
                      builder: (_, child) {
                        // The hop: a parabola up to 26 px, stretched tall on the way
                        // up and squashed flat on landing; a soft bob in between.
                        final h = _hop.value;
                        final hopUp = h == 0 || h == 1 ? 0.0 : 4 * h * (1 - h);
                        final squash = h > 0.85 ? 1 - 0.18 * ((1 - h) / 0.15) : h > 0 && h < 0.25 ? 1 + 0.10 * (1 - (h / 0.25)) : 1.0;
                        final bob = _dragging ? 0.0 : -5 * Curves.easeInOut.transform(_bob.value);
                        return Transform.translate(
                          offset: Offset(0, bob - 26 * hopUp),
                          child: Transform(
                            alignment: Alignment.bottomCenter,
                            transform: Matrix4.diagonal3Values(2 - squash, squash, 1),
                            child: child,
                          ),
                        );
                      },
                      child: Semantics(
                        button: true,
                        label: 'Your tree',
                        child: SizedBox(
                          width: _size.width,
                          height: _size.height,
                          child: Stack(
                            alignment: Alignment.bottomCenter,
                            children: [
                              Positioned(
                                bottom: 4,
                                child: Container(
                                  width: 58,
                                  height: 12,
                                  decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.10), borderRadius: BorderRadius.circular(22)),
                                ),
                              ),
                              Positioned(
                                bottom: 8,
                                child: GardenTree(width: 86, sprites: sprites, spriteSize: 14),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            );
          },
        );
      },
    );
  }
}
