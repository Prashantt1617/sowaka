import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../manager/presentation/manager_screen.dart';
import '../../shared/app_toast.dart';
import '../data/garden_api_service.dart';
import '../data/garden_models.dart';
import 'garden_layout.dart';
import 'garden_painters.dart';
import 'garden_widgets.dart';
import 'give_flow.dart';

/// One person's tree, big. Every flower and fruit is a tap target that opens
/// its note; the button at the bottom adds to it, and the new one arrives
/// with a burst. Hands back true when something changed, so the garden
/// behind reloads.
class TreeScreen extends StatefulWidget {
  const TreeScreen({
    super.key,
    required this.service,
    required this.person,
    required this.companyName,
    required this.leftToday,
    this.dailyLimit = 5,
  });

  final GardenApiService service;
  final GardenPerson person;
  final String companyName;
  final int leftToday;
  final int dailyLimit;

  @override
  State<TreeScreen> createState() => _TreeScreenState();
}

class _TreeScreenState extends State<TreeScreen> with SingleTickerProviderStateMixin {
  TreeView? _tree;
  String? _error;
  String? _selectedId;
  bool _changed = false;
  late int _leftToday = widget.leftToday;

  /// The note that just arrived, while its burst plays.
  String? _arrivingId;
  late final AnimationController _burst = AnimationController(vsync: this, duration: const Duration(milliseconds: 950));

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _burst.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final tree = await widget.service.tree(widget.person.userId);
      if (!mounted) return;
      setState(() {
        _tree = tree;
        _error = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error is GardenApiException ? error.message : 'Could not load the tree.');
    }
  }

  Future<void> _give() async {
    final note = await Navigator.of(context).push<GardenNote>(
      MaterialPageRoute(
        builder: (_) => GiveFlowScreen(
          service: widget.service,
          to: widget.person,
          companyName: widget.companyName,
          leftToday: _leftToday,
          dailyLimit: widget.dailyLimit,
        ),
      ),
    );
    if (note == null || !mounted) return;
    final tree = _tree;
    setState(() {
      _changed = true;
      _leftToday = (_leftToday - 1).clamp(0, widget.dailyLimit);
      if (tree != null) _tree = TreeView(person: tree.person, notes: [...tree.notes, note]);
      _arrivingId = note.id;
      _selectedId = null;
    });
    _burst.forward(from: 0).whenComplete(() {
      if (mounted) setState(() => _arrivingId = null);
    });
    showAppToast(context, 'You added a ${note.kindInfo.name.toLowerCase()} to ${widget.person.isMe ? 'your' : "${widget.person.firstName}'s"} tree');
  }

  Future<void> _open(GardenNote note) async {
    setState(() => _selectedId = note.id);
    final removed = await showModalBottomSheet<bool>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (_) => _NoteSheet(note: note, service: widget.service),
    );
    if (!mounted) return;
    if (removed == true) {
      final tree = _tree;
      setState(() {
        _changed = true;
        _selectedId = null;
        if (tree != null) _tree = TreeView(person: tree.person, notes: [for (final n in tree.notes) if (n.id != note.id) n]);
      });
      showAppToast(context, 'Taken off your tree');
    } else {
      setState(() => _selectedId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tree = _tree;
    final person = widget.person;
    final width = MediaQuery.sizeOf(context).width;
    final treeW = (width * 0.78).clamp(220.0, 320.0);
    final treeH = treeW * GardenTree.aspect;
    final groundY = MediaQuery.paddingOf(context).top + 100 + treeH + 6;
    final notes = tree?.notes ?? const <GardenNote>[];
    final sprites = [for (final n in notes) GardenSprite(id: n.id, kind: n.kind, fromUserId: n.fromUserId)];
    final arriving = notes.where((n) => n.id == _arrivingId).firstOrNull;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.of(context).pop(_changed);
      },
      child: Scaffold(
        body: Stack(
          children: [
            Positioned.fill(child: CustomPaint(painter: SkyPainter(groundY: groundY))),
            Positioned(
              left: (width - treeW) / 2,
              top: groundY - treeH,
              child: tree == null
                  ? SizedBox(width: treeW, height: treeH, child: Center(child: _error == null ? const CircularProgressIndicator(color: GardenColors.blue) : Text(_error!, style: const TextStyle(color: MColors.inkSoft))))
                  : GardenTree(
                      width: treeW,
                      sprites: sprites,
                      spriteSize: 34,
                      highlightId: _selectedId,
                      onSpriteTap: (sprite) => _open(notes.firstWhere((n) => n.id == sprite.id)),
                    ),
            ),
            if (arriving != null)
              AnimatedBuilder(
                animation: _burst,
                builder: (_, _) {
                  final place = spritePlace(arriving.id);
                  final cx = (width - treeW) / 2 + treeW * GardenTree.canopyCx + place.dx * treeW * GardenTree.canopyRx;
                  final cy = groundY - treeH + treeH * GardenTree.canopyCy + place.dy * treeH * GardenTree.canopyRy;
                  final pop = Curves.elasticOut.transform(_burst.value.clamp(0, 1));
                  return Stack(
                    children: [
                      Positioned(
                        left: cx - 50,
                        top: cy - 50,
                        child: IgnorePointer(child: CustomPaint(size: const Size(100, 100), painter: BurstPainter(t: _burst.value, isFruit: !arriving.kindInfo.isFlower))),
                      ),
                      Positioned(
                        left: cx - 15,
                        top: cy - 15,
                        child: IgnorePointer(child: Transform.scale(scale: pop, child: KindIcon(arriving.kind, size: 30))),
                      ),
                      Positioned(
                        left: cx + 8,
                        top: cy - 34 - _burst.value * 16,
                        child: IgnorePointer(child: Opacity(opacity: (1 - _burst.value).clamp(0, 1), child: SvgPicture.asset('assets/garden/sparkles.svg', width: 22, height: 22))),
                      ),
                    ],
                  );
                },
              ),
            Positioned(
              left: 0,
              right: 0,
              top: 0,
              child: GardenTopBar(
                title: person.isMe ? 'My tree' : "${person.firstName}'s tree",
                subtitle: person.isMe ? '${notes.length} this season' : person.department,
                onBack: () => Navigator.of(context).pop(_changed),
                transparent: true,
              ),
            ),
            Positioned(
              left: 16,
              right: 16,
              bottom: MediaQuery.paddingOf(context).bottom + 16,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (tree != null && notes.isEmpty)
                    Container(
                      margin: const EdgeInsets.only(bottom: 10),
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
                      decoration: BoxDecoration(color: Colors.white.withValues(alpha: .9), borderRadius: BorderRadius.circular(12)),
                      child: Text(
                        person.isMe ? 'Nothing on your tree yet this month.' : 'Be the first to thank ${person.firstName} this month.',
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: MColors.ink, fontSize: 12.5, fontWeight: FontWeight.w600),
                      ),
                    ),
                  ActionButton(
                    label: person.isMe ? 'Add a note to yourself' : "Add to ${person.firstName}'s tree",
                    icon: Icons.local_florist_rounded,
                    background: _leftToday == 0 ? MColors.line : GardenColors.blue,
                    foreground: _leftToday == 0 ? MColors.inkFaint : Colors.white,
                    onTap: _leftToday == 0 ? null : _give,
                  ),
                  if (_leftToday == 0)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text('That is ${widget.dailyLimit} for today. The garden opens again tomorrow.', textAlign: TextAlign.center, style: const TextStyle(color: MColors.inkSoft, fontSize: 12)),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _NoteSheet extends StatefulWidget {
  const _NoteSheet({required this.note, required this.service});

  final GardenNote note;
  final GardenApiService service;

  @override
  State<_NoteSheet> createState() => _NoteSheetState();
}

class _NoteSheetState extends State<_NoteSheet> {
  bool _removing = false;

  Future<void> _remove() async {
    setState(() => _removing = true);
    try {
      await widget.service.remove(widget.note.id);
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() => _removing = false);
      showAppToast(context, error is GardenApiException ? error.message : 'Could not remove it.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final note = widget.note;
    final kind = note.kindInfo;
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 14, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(child: Container(width: 36, height: 4, decoration: BoxDecoration(color: MColors.line, borderRadius: BorderRadius.circular(2)))),
            const SizedBox(height: 14),
            Row(
              children: [
                PersonFace(initial: note.fromName.isEmpty ? '?' : note.fromName[0], photoUrl: note.fromPhotoUrl, size: 40, index: note.fromName.length % 7),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(note.fromUserId == note.toUserId ? '${note.fromName}, to themselves' : note.fromName, style: const TextStyle(fontFamily: 'Sora', color: MColors.ink, fontSize: 15, fontWeight: FontWeight.w700)),
                      Text('${kind.name} · ${kind.meaning}', style: const TextStyle(color: MColors.inkSoft, fontSize: 12.5)),
                    ],
                  ),
                ),
                KindIcon(kind.key, size: 34),
              ],
            ),
            const SizedBox(height: 14),
            Text('"${note.note}"', style: const TextStyle(color: MColors.ink, fontSize: 15, height: 1.45)),
            const SizedBox(height: 10),
            Text(_when(note.createdAt), style: const TextStyle(color: MColors.inkFaint, fontSize: 12, fontWeight: FontWeight.w600)),
            if (note.removable) ...[
              const SizedBox(height: 16),
              _removing
                  ? const Center(child: CircularProgressIndicator(color: GardenColors.blue))
                  : ActionButton(label: 'Take it off my tree', background: Colors.white, foreground: MColors.inkSoft, border: MColors.line, onTap: _remove),
            ],
          ],
        ),
      ),
    );
  }

  static String _when(DateTime at) {
    final local = at.toLocal();
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return '${days[local.weekday - 1]}, ${local.day} ${months[local.month - 1]}';
  }
}
