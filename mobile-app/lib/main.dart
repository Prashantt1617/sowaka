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
      // App-wide tap-to-dismiss: tapping anywhere outside the focused field
      // drops focus and closes the keyboard. Translucent so the tap still
      // reaches whatever was actually pressed.
      builder: (context, child) => GestureDetector(
        behavior: HitTestBehavior.translucent,
        onTap: () => FocusManager.instance.primaryFocus?.unfocus(),
        child: child,
      ),
      home: const AuthGate(),
      routes: AppRoutes.routes,
    );
  }
}
