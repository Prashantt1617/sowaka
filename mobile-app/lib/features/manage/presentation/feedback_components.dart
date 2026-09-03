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
    final rated = widget.param.score > 0;
    final filled = widget.param.score.round();
    return Container(
      // Node 733:13379.
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFF0EEF8), width: 1.114),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0D000000),
            blurRadius: 6,
            offset: Offset(0, 2),
          ),
        ],
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
              // Score chip — violet on a 9% violet wash, both lines.
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
                        color: Color(0xFF675AFF),
                        fontSize: 14,
                        height: 1,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Opacity(
                      opacity: .8,
                      child: Text(
                        rated ? scoreLabel(widget.param.score) : '-',
                        style: const TextStyle(
                          color: Color(0xFF675AFF),
                          fontSize: 9.5,
                          height: 14.25 / 9.5,
                          fontWeight: FontWeight.w400,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          SizedBox(
            height: 46,
            child: Row(
              children: [
                for (var star = 1; star <= 5; star++)
                  Padding(
                    padding: EdgeInsets.only(right: star == 5 ? 0 : 8),
                    child: Semantics(
                      button: true,
                      label: 'Rate ${widget.param.name} $star out of 5',
                      child: InkWell(
                        borderRadius: BorderRadius.circular(99),
                        onTap: widget.locked
                            ? null
                            : () => widget.onScore(star.toDouble()),
                        // The star at the current rating is drawn larger, the
                        // way the design calls out the active value.
                        child: SizedBox(
                          width: 34,
                          height: 34,
                          child: Center(
                            child: SvgPicture.asset(
                              star <= filled
                                  ? (star == filled
                                        ? 'assets/icons/grow_star_active.svg'
                                        : 'assets/icons/grow_star_filled.svg')
                                  : 'assets/icons/grow_star_empty.svg',
                              width: star == filled ? 40.1 : 34,
                              height: star == filled ? 40.1 : 34,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                if (rated) ...[
                  const SizedBox(width: 8),
                  Text(
                    scoreLabel(widget.param.score),
                    style: const TextStyle(
                      color: Color(0xFF0571A6),
                      fontSize: 12,
                      height: 18 / 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 14),
          // Framed note field: the container owns the border, so the field
          // itself is drawn borderless inside it.
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: const Color(0xFFFAFAFA),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: const Color(0xFFEBEBEB), width: 1.114),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: TextFormField(
                    controller: _noteController,
                    focusNode: _noteFocusNode,
                    enabled: !widget.locked,
                    maxLines: 3,
                    minLines: 2,
                    scrollPadding: const EdgeInsets.only(bottom: 24),
                    style: const TextStyle(
                      fontSize: 12.5,
                      height: 18.75 / 12.5,
                      color: Color(0xFF101828),
                    ),
                    decoration: const InputDecoration(
                      isCollapsed: true,
                      filled: false,
                      hintText: 'Add supporting feedback...',
                      hintStyle: TextStyle(
                        color: Color(0x80101828),
                        fontSize: 12.5,
                        height: 18.75 / 12.5,
                        fontWeight: FontWeight.w400,
                      ),
                      border: InputBorder.none,
                      enabledBorder: InputBorder.none,
                      focusedBorder: InputBorder.none,
                      disabledBorder: InputBorder.none,
                      errorBorder: InputBorder.none,
                      focusedErrorBorder: InputBorder.none,
                      contentPadding: EdgeInsets.zero,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Semantics(
                  button: true,
                  label: widget.listening ? 'Stop listening' : 'Dictate',
                  child: InkWell(
                    borderRadius: BorderRadius.circular(8),
                    onTap: widget.locked ? null : widget.onVoice,
                    child: Padding(
                      padding: const EdgeInsets.all(4),
                      child: widget.listening
                          ? const Icon(
                              Icons.mic_rounded,
                              size: 17,
                              color: MColors.live,
                            )
                          : SvgPicture.asset(
                              'assets/icons/grow_mic.svg',
                              width: 17,
                              height: 17,
                            ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Padding(
            padding: const EdgeInsets.only(left: 2),
            child: Text(
              '💡 ${paramHelp(widget.param.name)}',
              style: const TextStyle(
                color: Color(0xFFA0A4B0),
                fontSize: 11,
                height: 15.95 / 11,
                fontWeight: FontWeight.w400,
              ),
            ),
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
