part of '../../manager/presentation/manager_screen.dart';

class _ParamCard extends StatefulWidget {
  const _ParamCard({
    super.key,
    required this.param,
    required this.locked,
    required this.listening,
    required this.onScore,
    required this.onNote,
    required this.onVoice,
  });

  final FeedbackParam param;
  final bool locked;
  final bool listening;
  final ValueChanged<double> onScore;
  final ValueChanged<String> onNote;
  final VoidCallback onVoice;

  @override
  State<_ParamCard> createState() => _ParamCardState();
}

class _ParamCardState extends State<_ParamCard> {
  final FocusNode _noteFocusNode = FocusNode();
  late final TextEditingController _noteController;

  @override
  void initState() {
    super.initState();
    _noteController = TextEditingController(text: widget.param.note);
    _noteFocusNode.addListener(_commitNoteOnBlur);
  }

  @override
  void didUpdateWidget(covariant _ParamCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!_noteFocusNode.hasFocus && widget.param.note != _noteController.text) {
      _noteController.value = TextEditingValue(
        text: widget.param.note,
        selection: TextSelection.collapsed(offset: widget.param.note.length),
      );
    }
  }

  @override
  void dispose() {
    _commitNote();
    _noteFocusNode.removeListener(_commitNoteOnBlur);
    _noteFocusNode.dispose();
    _noteController.dispose();
    super.dispose();
  }

  void _commitNoteOnBlur() {
    if (!_noteFocusNode.hasFocus) _commitNote();
  }

  void _commitNote() {
    final text = _noteController.text;
    if (text != widget.param.note) widget.onNote(text);
  }

  @override
  Widget build(BuildContext context) {
    final color = scoreColor(widget.param.score <= 0 ? 1 : widget.param.score);
    final rated = widget.param.score > 0;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: MColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      widget.param.name,
                      style: const TextStyle(
                        color: Color(0xFF101828),
                        fontSize: 14.5,
                        height: 17.4 / 14.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    if (paramDescription(widget.param.name)
                        case final description when description.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        description,
                        style: const TextStyle(
                          color: Color(0xFF717171),
                          fontSize: 11.5,
                          height: 14.95 / 11.5,
                          fontWeight: FontWeight.w400,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                decoration: BoxDecoration(
                  color: const Color(0x17675AFF),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Column(
                  children: [
                    Text(
                      widget.param.score.toStringAsFixed(1),
                      style: const TextStyle(
                        color: Color(0xFF717171),
                        fontSize: 14,
                        height: 1,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Opacity(
                      opacity: .8,
                      child: Text(
                        scoreLabel(widget.param.score),
                        style: TextStyle(
                          color: rated ? color : const Color(0xFF9CA3AF),
                          fontSize: 9,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              for (var star = 1; star <= 5; star++)
                Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: Semantics(
                    button: true,
                    label: 'Rate ${widget.param.name} $star out of 5',
                    child: InkWell(
                      borderRadius: BorderRadius.circular(99),
                      onTap: widget.locked
                          ? null
                          : () => widget.onScore(star.toDouble()),
                      child: Icon(
                        star <= widget.param.score.round()
                            ? Icons.star_rounded
                            : Icons.star_outline_rounded,
                        size: 30,
                        color: star <= widget.param.score.round()
                            ? const Color(0xFF0571A6)
                            : const Color(0xFFD1D5DB),
                      ),
                    ),
                  ),
                ),
              if (rated) ...[
                const SizedBox(width: 4),
                Text(
                  scoreLabel(widget.param.score),
                  style: const TextStyle(
                    color: Color(0xFF0571A6),
                    fontSize: 13.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: 12),
          TextFormField(
            controller: _noteController,
            focusNode: _noteFocusNode,
            enabled: !widget.locked,
            maxLines: 3,
            minLines: 2,
            scrollPadding: const EdgeInsets.only(bottom: 24),
            style: const TextStyle(fontSize: 13, color: Color(0xFF2A2A2A)),
            decoration: InputDecoration(
              hintText: 'Add supporting feedback...',
              hintStyle: const TextStyle(
                color: Color(0xFF929292),
                fontSize: 13,
              ),
              filled: true,
              fillColor: const Color(0xFFFAFAFA),
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 14,
                vertical: 12,
              ),
              suffixIcon: IconButton(
                tooltip: widget.listening ? 'Stop listening' : 'Dictate',
                onPressed: widget.locked ? null : widget.onVoice,
                icon: Icon(
                  widget.listening ? Icons.mic_rounded : Icons.mic_none_rounded,
                  size: 19,
                  color: widget.listening
                      ? MColors.live
                      : const Color(0xFF6A7282),
                ),
              ),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: const BorderSide(color: Color(0xFFEBEBEB)),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: const BorderSide(color: Color(0xFFEBEBEB)),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: const BorderSide(
                  color: Color(0xFF0571A6),
                  width: 1.4,
                ),
              ),
            ),
          ),
          const SizedBox(height: 8),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('💡', style: TextStyle(fontSize: 11)),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  paramHelp(widget.param.name),
                  style: const TextStyle(
                    color: Color(0xFF929292),
                    fontSize: 11,
                    height: 1.45,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ConfirmSendSheet extends StatelessWidget {
  const _ConfirmSendSheet({required this.member, required this.onSend});

  final TeamMember member;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    final first = member.name.split(' ').first;
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(20, 10, 20, 20),
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
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
            Row(
              children: [
                const IconBox(
                  icon: Icons.send_rounded,
                  color: MColors.terra,
                  tint: MColors.terraTint,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Send to $first?',
                        style: const TextStyle(
                          color: MColors.ink,
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 2),
                      const Text(
                        'This locks the feedback — no further edits.',
                        style: TextStyle(
                          color: MColors.inkSoft,
                          fontSize: 12.5,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 18),
            Row(
              children: [
                Expanded(
                  child: ActionButton(
                    label: 'Cancel',
                    background: Colors.white,
                    foreground: MColors.ink,
                    border: MColors.line,
                    onTap: () => Navigator.of(context).pop(),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: ActionButton(
                    label: 'Send now',
                    icon: Icons.send_rounded,
                    background: MColors.terra,
                    foreground: Colors.white,
                    onTap: onSend,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
