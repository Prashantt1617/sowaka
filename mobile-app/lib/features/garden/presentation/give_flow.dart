import 'package:flutter/material.dart';

import '../../manager/presentation/manager_screen.dart';
import '../../shared/app_toast.dart';
import '../data/garden_api_service.dart';
import '../data/garden_models.dart';
import 'garden_widgets.dart';
import 'give_success.dart';

/// Adding to someone's tree: a flower, then the words. Hands back the note
/// once the server has it and the success page has been seen. Only flowers
/// are given; the fruit that grows back is the server's doing.
class GiveFlowScreen extends StatefulWidget {
  const GiveFlowScreen({
    super.key,
    required this.service,
    required this.to,
    required this.companyName,
    required this.leftToday,
    this.dailyLimit = 5,
  });

  final GardenApiService service;
  final GardenPerson to;
  final String companyName;
  final int leftToday;
  final int dailyLimit;

  @override
  State<GiveFlowScreen> createState() => _GiveFlowScreenState();
}

class _GiveFlowScreenState extends State<GiveFlowScreen> {
  GardenKind? _kind;
  int _step = 0;
  final _note = TextEditingController();
  bool _sending = false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  String get _who => widget.to.isMe ? 'yourself' : widget.to.firstName;
  String get _tree => widget.to.isMe ? 'your tree' : "${widget.to.firstName}'s tree";

  Future<void> _send() async {
    final kind = _kind;
    final text = _note.text.trim();
    if (kind == null || text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      final gift = await widget.service.give(toUserId: widget.to.userId, kind: kind.key, note: text);
      if (!mounted) return;
      // Both trees, with the flower landing and the fruit growing, before
      // the flow hands the note back.
      await Navigator.of(context).push<void>(
        MaterialPageRoute(
          builder: (_) => GiveSuccessScreen(service: widget.service, to: widget.to, gift: gift, companyName: widget.companyName),
        ),
      );
      if (!mounted) return;
      Navigator.of(context).pop(gift.note);
    } catch (error) {
      if (!mounted) return;
      showAppToast(context, error is GardenApiException ? error.message : 'Could not add it. Try again.');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  void _back() {
    if (_step == 1) {
      setState(() => _step = 0);
      return;
    }
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final kinds = [for (final k in gardenKinds) if (k.isFlower) k];
    return PopScope(
      canPop: _step == 0,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: Scaffold(
        backgroundColor: MColors.bg,
        resizeToAvoidBottomInset: true,
        body: Column(
          children: [
            GardenTopBar(
              title: widget.to.isMe ? 'A note to yourself' : 'For ${widget.to.firstName}',
              subtitle: 'Step ${_step + 1} of 2',
              onBack: _back,
            ),
            Expanded(
              child: _step == 0 ? _pickStep(kinds) : _writeStep(),
            ),
          ],
        ),
      ),
    );
  }

  Widget _pickStep(List<GardenKind> kinds) {
    final chosen = _kind;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 18, 16, 32),
      children: [
        const Text('Pick a flower', style: TextStyle(fontFamily: 'Sora', color: MColors.ink, fontSize: 16, fontWeight: FontWeight.w700)),
        const SizedBox(height: 4),
        Text(
          widget.to.isMe ? 'What it means shows before you go on.' : 'What it means shows before you go on. When it lands, a fruit grows on your own tree.',
          style: const TextStyle(color: MColors.inkSoft, fontSize: 13, height: 1.4),
        ),
        const SizedBox(height: 14),
        GridView.count(
          crossAxisCount: 4,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 8,
          crossAxisSpacing: 8,
          childAspectRatio: .92,
          children: [
            for (final kind in kinds)
              Material(
                color: chosen == kind ? GardenColors.blueTint : Colors.white,
                borderRadius: BorderRadius.circular(14),
                child: InkWell(
                  borderRadius: BorderRadius.circular(14),
                  onTap: () => setState(() => _kind = kind),
                  child: Container(
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: chosen == kind ? GardenColors.blue : MColors.line),
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        KindIcon(kind.key, size: 30),
                        const SizedBox(height: 6),
                        Text(
                          kind.name,
                          style: TextStyle(color: MColors.ink, fontSize: 11, fontWeight: chosen == kind ? FontWeight.w800 : FontWeight.w600),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(height: 16),
        AnimatedSwitcher(
          duration: const Duration(milliseconds: 180),
          child: chosen == null
              ? const Padding(
                  key: ValueKey('none'),
                  padding: EdgeInsets.symmetric(vertical: 6),
                  child: Text('Pick one to see what it says.', textAlign: TextAlign.center, style: TextStyle(color: MColors.inkFaint, fontSize: 13)),
                )
              : Container(
                  key: ValueKey(chosen.key),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  decoration: BoxDecoration(color: MColors.goldTint, borderRadius: BorderRadius.circular(14)),
                  child: Row(
                    children: [
                      KindIcon(chosen.key, size: 26),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text.rich(
                          TextSpan(children: [
                            TextSpan(text: '${chosen.name} · ', style: const TextStyle(fontWeight: FontWeight.w800)),
                            TextSpan(text: chosen.meaning),
                          ]),
                          style: const TextStyle(color: MColors.ink, fontSize: 13.5, height: 1.35),
                        ),
                      ),
                    ],
                  ),
                ),
        ),
        const SizedBox(height: 18),
        ActionButton(
          label: 'Next',
          background: chosen == null ? MColors.line : GardenColors.blue,
          foreground: chosen == null ? MColors.inkFaint : Colors.white,
          onTap: chosen == null ? null : () => setState(() => _step = 1),
        ),
      ],
    );
  }

  Widget _writeStep() {
    final kind = _kind!;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 18, 16, 32),
      children: [
        Row(
          children: [
            KindIcon(kind.key, size: 36),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(kind.name, style: const TextStyle(fontFamily: 'Sora', color: MColors.ink, fontSize: 16, fontWeight: FontWeight.w700)),
                  Text(kind.meaning, style: const TextStyle(color: MColors.inkSoft, fontSize: 13)),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        TextField(
          controller: _note,
          autofocus: true,
          maxLength: 200,
          maxLines: 5,
          minLines: 4,
          textCapitalization: TextCapitalization.sentences,
          onChanged: (_) => setState(() {}),
          style: const TextStyle(color: MColors.ink, fontSize: 14.5, height: 1.4),
          decoration: InputDecoration(
            hintText: widget.to.isMe ? 'What do you want to remember about this week?' : 'What did $_who do?',
            hintStyle: const TextStyle(color: MColors.inkFaint),
            filled: true,
            fillColor: Colors.white,
            contentPadding: const EdgeInsets.all(14),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: MColors.line)),
            enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: MColors.line)),
            focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: GardenColors.blue)),
          ),
        ),
        const SizedBox(height: 6),
        // How many are left today sits beside the garden's Give button; here
        // the only thing worth saying is who will see it.
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [_Chip('Everyone at ${widget.companyName} will see this')],
        ),
        const SizedBox(height: 20),
        _sending
            ? const Center(child: Padding(padding: EdgeInsets.all(8), child: CircularProgressIndicator(color: GardenColors.blue)))
            : ActionButton(
                label: 'Add to $_tree',
                background: _note.text.trim().isEmpty ? MColors.line : GardenColors.blue,
                foreground: _note.text.trim().isEmpty ? MColors.inkFaint : Colors.white,
                onTap: _note.text.trim().isEmpty ? null : _send,
              ),
      ],
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(999), border: Border.all(color: MColors.line)),
      child: Text(text, style: const TextStyle(color: MColors.inkSoft, fontSize: 11.5, fontWeight: FontWeight.w600)),
    );
  }
}
