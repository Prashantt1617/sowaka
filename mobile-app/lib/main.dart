import 'package:flutter/material.dart';
import 'features/auth/presentation/auth_gate.dart';
import 'routes/app_routes.dart';
import 'services/notification_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await AppNotificationService.instance.initialize();
  runApp(const HrmsMobileApp());
}

class HrmsMobileApp extends StatelessWidget {
  const HrmsMobileApp({super.key});

  @override
  Widget build(BuildContext context) {
    // Brand primary. The old terracotta seed tinted every Material default
    // (switches, checkboxes, progress, selection) a dirty peach.
    const seedColor = Color(0xFF0571A6);

    return MaterialApp(
      title: 'Sowaka Connect',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        fontFamily: 'Plus Jakarta Sans',
        colorScheme: ColorScheme.fromSeed(
          seedColor: seedColor,
          brightness: Brightness.light,
        ),
        scaffoldBackgroundColor: const Color(0xFFF7F7F9),
        // Inputs follow the design system's neutral borders with the brand
        // blue on focus. The terracotta seed used to bleed through here, which
        // put a peach outline on every text field in the app.
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: Colors.white,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(16),
            borderSide: const BorderSide(color: Color(0xFFE8E8F0)),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(16),
            borderSide: const BorderSide(color: Color(0xFFE8E8F0)),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(16),
            borderSide: const BorderSide(color: Color(0xFF0571A6), width: 1.5),
          ),
        ),
        textSelectionTheme: const TextSelectionThemeData(
          cursorColor: Color(0xFF0571A6),
          selectionHandleColor: Color(0xFF0571A6),
          selectionColor: Color(0x330571A6),
        ),
        // Material 3's seed-derived tertiary color lands on purple for this
        // terracotta seed, which shows up as the selected AM/PM segment in
        // the system time picker — override it to the blue used everywhere
        // else in the app for a selected/interactive state.
        timePickerTheme: TimePickerThemeData(
          dayPeriodColor: WidgetStateColor.resolveWith(
            (states) => states.contains(WidgetState.selected)
                ? const Color(0xFF0571A6)
                : const Color(0xFFF7F7F9),
          ),
          dayPeriodTextColor: WidgetStateColor.resolveWith(
            (states) => states.contains(WidgetState.selected)
                ? Colors.white
                : const Color(0xFF717171),
          ),
        ),
        useMaterial3: true,
      ),
      // App-wide tap-to-dismiss: touching anywhere outside the focused field
      // drops focus and closes the keyboard.
      //
      // This is a Listener rather than a GestureDetector on purpose. A
      // GestureDetector has to win the gesture arena, so any card, InkWell or
      // scrollable that claims the tap first leaves the keyboard up — which is
      // most of this app. A Listener sees the pointer during hit-testing
      // regardless of who ultimately handles it.
      builder: (context, child) => Listener(
        onPointerDown: _dismissKeyboardUnlessOnField,
        child: child,
      ),
      home: const AuthGate(),
      routes: AppRoutes.routes,
    );
  }
}

/// Closes the keyboard on any touch that lands outside the field currently
/// being edited.
///
/// Touches on the field itself are ignored so tapping to reposition the caret
/// doesn't dismiss what you're typing into. Tapping a *different* field still
/// unfocuses here, then that field takes focus a moment later as its own tap
/// resolves — which is the behaviour you want anyway.
void _dismissKeyboardUnlessOnField(PointerDownEvent event) {
  final focus = FocusManager.instance.primaryFocus;
  final context = focus?.context;
  if (focus == null || context == null) return;

  // Only text entry raises a keyboard; leave any other focus alone so buttons
  // and other focusable widgets keep behaving normally.
  final isTextField =
      context.widget is EditableText ||
      context.findAncestorWidgetOfExactType<EditableText>() != null;
  if (!isTextField) return;

  // A touch on the field being edited is a caret placement, not a dismissal.
  final renderObject = context.findRenderObject();
  if (renderObject is RenderBox && renderObject.hasSize) {
    final bounds = renderObject.localToGlobal(Offset.zero) & renderObject.size;
    if (bounds.contains(event.position)) return;
  }

  focus.unfocus();
}
