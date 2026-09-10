import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/auth/presentation/splash_screen.dart';
import 'package:mobile_app/main.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('renders login screen', (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(const HrmsMobileApp());
    // Past the splash animation, which the gate deliberately waits out before
    // deciding between the login screen and a restored session.
    await tester.pump(SplashScreen.duration + const Duration(milliseconds: 400));
    await tester.pump();

    expect(find.text("Let's get you signed in"), findsOneWidget);
    expect(find.text('Your workplace, connected.'), findsOneWidget);
    expect(find.text('Work email'), findsOneWidget);
  });
}
