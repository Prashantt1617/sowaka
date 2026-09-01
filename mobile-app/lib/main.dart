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
    const seedColor = Color(0xFFBE5A36);

    return MaterialApp(
      title: 'Sowaka Connect',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        fontFamily: 'Plus Jakarta Sans',
        colorScheme: ColorScheme.fromSeed(
          seedColor: seedColor,
          brightness: Brightness.light,
        ),
        scaffoldBackgroundColor: const Color(0xFFF6F2EC),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: Colors.white,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(18),
            borderSide: const BorderSide(color: Color(0xFFE7DED5)),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(18),
            borderSide: const BorderSide(color: Color(0xFFE7DED5)),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(18),
            borderSide: const BorderSide(color: seedColor, width: 1.5),
          ),
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
      home: const AuthGate(),
      routes: AppRoutes.routes,
    );
  }
}
