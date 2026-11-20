import 'package:flutter/foundation.dart';

/// The stage the joiner is looking at through the timeline (an index into
/// StageLens.steps; null: her own stage). The home writes it; the Meetings and
/// Tasks screens read it, so the lens holds across tabs as the prototype does.
final onbLensSelection = ValueNotifier<int?>(null);
