import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Slide, rather than tap.
///
/// A punch is the one action in the app that cannot be undone by the person who
/// took it, so it asks for a deliberate gesture rather than a tap someone makes
/// with a phone in their pocket.
///
/// Shared by every surface that starts a punch — the Actions card, the profile
/// card and the punch screen itself — so the gesture, the travel it takes and
/// the point it commits at are the same wherever it is met.
class SlideToPunch extends StatefulWidget {
  const SlideToPunch({
    super.key,
    required this.label,
    required this.onComplete,
    this.track = const Color(0xFFE8F3FA),
    this.fill = const Color(0xFFCDE6F5),
    this.knob = const Color(0xFF0571A6),
    this.labelColor = const Color(0xFF0571A6),
    this.height = 60,
    this.enabled = true,
    this.reversed = false,
  });

  /// Punching out is the filled control of nodes 2303:53902 and 2303:54154: the
  /// day is under way, so the track carries the colour, the knob is the light
  /// one, and it starts at the right — the day is being closed, not opened.
  SlideToPunch.filled({
    super.key,
    required this.label,
    required this.onComplete,
    required Color color,
    this.height = 60,
    this.enabled = true,
  }) : track = color,
       fill = Color.alphaBlend(Colors.black.withValues(alpha: .12), color),
       knob = Colors.white,
       labelColor = Colors.white,
       reversed = true;

  final String label;
  final VoidCallback onComplete;

  /// The bar at rest, and the colour the travelled part takes as it is dragged.
  final Color track;
  final Color fill;
  final Color knob;
  final Color labelColor;
  final double height;

  /// A control that is visible but not yet usable — the day is already closed,
  /// or a punch is already in flight.
  final bool enabled;

  /// Right to left, for closing the day.
  final bool reversed;

  @override
  State<SlideToPunch> createState() => _SlideToPunchState();
}

class _SlideToPunchState extends State<SlideToPunch>
    with SingleTickerProviderStateMixin {
  /// How far along the travel the knob is, 0 at rest and 1 at the far end.
  double _progress = 0;
  bool _dragging = false;

  /// Most of the way counts. Asking for the last few pixels fails people who
  /// let go early and makes the control feel broken.
  static const _commitAt = 0.82;

  void _settle(double span) {
    if (_progress >= _commitAt) {
      HapticFeedback.mediumImpact();
      widget.onComplete();
    }
    setState(() {
      _dragging = false;
      _progress = 0;
    });
  }

  @override
  Widget build(BuildContext context) {
    final knobSize = widget.height - 10;
    final committing = _progress >= _commitAt;
    return Opacity(
      opacity: widget.enabled ? 1 : .55,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final span = constraints.maxWidth - knobSize - 10;
          final travelled = span * _progress;
          return Semantics(
            button: true,
            enabled: widget.enabled,
            label: widget.label,
            onTap: widget.enabled ? widget.onComplete : null,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(999),
              child: SizedBox(
                height: widget.height,
                child: Stack(
                  children: [
                    Positioned.fill(child: ColoredBox(color: widget.track)),
                    // The part already travelled, so the gesture shows its own
                    // progress rather than only moving a circle.
                    Positioned(
                      left: widget.reversed ? null : 0,
                      right: widget.reversed ? 0 : null,
                      top: 0,
                      bottom: 0,
                      child: AnimatedContainer(
                        duration: Duration(milliseconds: _dragging ? 0 : 220),
                        curve: Curves.easeOut,
                        width: travelled + knobSize / 2,
                        color: widget.fill,
                      ),
                    ),
                    Center(
                      child: AnimatedOpacity(
                        duration: const Duration(milliseconds: 120),
                        // Fades out of the knob's way as it crosses the label.
                        opacity: 1 - (_progress * 1.6).clamp(0.0, 1.0),
                        child: Text(
                          widget.label,
                          style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                            color: widget.labelColor,
                          ),
                        ),
                      ),
                    ),
                    AnimatedPositioned(
                      duration: Duration(milliseconds: _dragging ? 0 : 260),
                      curve: Curves.easeOutBack,
                      left: widget.reversed ? null : 5 + travelled,
                      right: widget.reversed ? 5 + travelled : null,
                      top: 5,
                      child: GestureDetector(
                        behavior: HitTestBehavior.opaque,
                        onHorizontalDragStart: widget.enabled
                            ? (_) => setState(() => _dragging = true)
                            : null,
                        onHorizontalDragUpdate: widget.enabled
                            ? (details) {
                                final delta = widget.reversed
                                    ? -details.delta.dx
                                    : details.delta.dx;
                                setState(() {
                                  _progress = (_progress + delta / span).clamp(
                                    0.0,
                                    1.0,
                                  );
                                });
                              }
                            : null,
                        onHorizontalDragEnd: widget.enabled
                            ? (_) => _settle(span)
                            : null,
                        onHorizontalDragCancel: widget.enabled
                            ? () => _settle(span)
                            : null,
                        child: Container(
                          width: knobSize,
                          height: knobSize,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: widget.knob,
                            shape: BoxShape.circle,
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withValues(alpha: .18),
                                blurRadius: 6,
                                offset: const Offset(0, 2),
                              ),
                            ],
                          ),
                          child: Icon(
                            // Says what the release will do: still an arrow
                            // while it could be let go, a tick once it counts.
                            committing
                                ? Icons.check_rounded
                                : widget.reversed
                                ? Icons.arrow_back_rounded
                                : Icons.arrow_forward_rounded,
                            color: widget.knob == Colors.white
                                ? widget.track
                                : Colors.white,
                            size: 21,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
