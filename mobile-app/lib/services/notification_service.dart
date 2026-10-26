import 'dart:async';
import 'dart:convert';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../features/auth/data/auth_models.dart';
import '../firebase_options.dart';
import 'api_config.dart';

@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
}

class AppNotificationService {
  AppNotificationService._();
  static final instance = AppNotificationService._();

  final _opened = StreamController<Map<String, dynamic>>.broadcast();
  final _local = FlutterLocalNotificationsPlugin();
  Stream<Map<String, dynamic>> get opened => _opened.stream;

  /// A notification that arrived while the app was open. Whatever it is
  /// about may have changed on screen, so listeners read it again.
  final _received = StreamController<Map<String, dynamic>>.broadcast();
  Stream<Map<String, dynamic>> get received => _received.stream;
  Map<String, dynamic>? pendingDestination;
  AuthSession? _session;

  /// Done once [initialize] has run, whether or not it worked. The app no
  /// longer waits for it before drawing; what needs Firebase waits here, and
  /// never for long: a setup that hangs leaves pushes off, nothing else.
  Future<void> get ready => _ready.future.timeout(
    _setupLimit,
    onTimeout: () =>
        debugPrint('Notification setup still not done; going on without it'),
  );
  final _ready = Completer<void>();

  /// How long any one step of push setup, or a device registration, may take.
  static const _setupLimit = Duration(seconds: 10);

  Future<void> initialize() async {
    try {
      await _initializeFirebase().timeout(_setupLimit);
      FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
      // The channel and the push that opened the app are independent, and
      // either failing leaves the other.
      final initialFuture = FirebaseMessaging.instance
          .getInitialMessage()
          .timeout(_setupLimit)
          .catchError((Object error) {
            debugPrint('Opening push not read: $error');
            return null;
          });
      if (!kIsWeb) {
        try {
          await _initializeLocalNotifications().timeout(_setupLimit);
        } catch (error) {
          debugPrint('Local notifications not set up: $error');
        }
      }
      FirebaseMessaging.onMessage.listen((message) {
        if (!_received.isClosed) {
          _received.add(Map<String, dynamic>.from(message.data));
        }
        _showForeground(message);
      });
      FirebaseMessaging.onMessageOpenedApp.listen(
        (message) => _emit(message.data),
      );
      final initial = await initialFuture;
      // A push tapped meanwhile is newer than the one that opened the app.
      if (initial != null && pendingDestination == null) {
        pendingDestination = Map<String, dynamic>.from(initial.data);
      }
      FirebaseMessaging.instance.onTokenRefresh.listen(
        (token) => _register(token).catchError(
          (Object error) =>
              debugPrint('FCM token refresh not registered: $error'),
        ),
      );
    } catch (error, stackTrace) {
      debugPrint('Notification initialization failed: $error');
      debugPrintStack(stackTrace: stackTrace);
    } finally {
      if (!_ready.isCompleted) _ready.complete();
    }
  }

  /// No-op where Firebase never came up — macOS has no entry in
  /// [DefaultFirebaseOptions], so touching `FirebaseMessaging.instance` there
  /// throws `[core/no-app]`. Sign-in calls this before anything else, so an
  /// unguarded throw here surfaces as an unhandled exception on every launch.
  Future<void> requestPermission() async {
    await ready;
    if (Firebase.apps.isEmpty) return;
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      await _local
          .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin
          >()
          ?.requestNotificationsPermission();
    }
    final settings = await FirebaseMessaging.instance.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );
    debugPrint(
      'Notification permission status: ${settings.authorizationStatus.name}',
    );
    if (settings.authorizationStatus == AuthorizationStatus.authorized ||
        settings.authorizationStatus == AuthorizationStatus.provisional) {
      await _registerCurrentToken();
    }
  }

  Future<void> _initializeLocalNotifications() async {
    await _local.initialize(
      settings: const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        iOS: DarwinInitializationSettings(),
      ),
      onDidReceiveNotificationResponse: (response) {
        if (response.payload != null) {
          _emit(jsonDecode(response.payload!) as Map<String, dynamic>);
        }
      },
    );
    await _local
        .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin
        >()
        ?.createNotificationChannel(
          const AndroidNotificationChannel(
            'sowaka_notifications',
            'Sowaka notifications',
            description: 'Company activity, approvals and reminders',
            importance: Importance.high,
          ),
        );
  }

  Future<void> _initializeFirebase() async {
    if (Firebase.apps.isNotEmpty) return;
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
  }

  /// Never throws and never holds anyone up: the home screen calls this
  /// without waiting, and a push that cannot be set up is no reason to stop.
  Future<void> attachSession(AuthSession session) async {
    _session = session;
    try {
      await requestPermission();
    } catch (error) {
      debugPrint('Notification permission or registration failed: $error');
    }
  }

  /// Signing out: the device stops standing for this account, so pushes for
  /// it no longer land here once someone else signs in, or nobody does.
  /// Best effort — a phone offline still signs out.
  Future<void> detachSession() async {
    final session = _session;
    _session = null;
    if (session == null) return;
    await _forgetRegistration();
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token == null) return;
      final response = await http.delete(
        Uri.parse('${ApiConfig.baseUrl}/notifications/devices'),
        headers: {
          'Authorization': 'Bearer ${session.token}',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({'token': token}),
      );
      debugPrint('FCM device token unregistered (${response.statusCode})');
    } catch (error) {
      debugPrint('FCM device token unregister failed: $error');
    }
  }

  Future<void> _registerCurrentToken() async {
    if (_session == null) return;
    try {
      const webVapidKey = String.fromEnvironment(
        'FIREBASE_WEB_VAPID_KEY',
        defaultValue:
            'BHqyJO-motjY5x1ouLWFjMGNdLp-nLTQRNUPa0XynKJxQ_XpMUla_IcUE9qeqNdPwCoOjwYj88Ag1ebVmwfWRvM',
      );
      final token = await FirebaseMessaging.instance
          .getToken(
            vapidKey: kIsWeb && webVapidKey.isNotEmpty ? webVapidKey : null,
          )
          .timeout(_setupLimit);
      if (token != null) {
        // The same token for the same person was handed over lately: every
        // launch used to post it again.
        if (await _registeredLately(token, _session!.user.id)) return;
        debugPrint('Registering ${kIsWeb ? 'web' : 'native'} FCM token');
        await _register(token);
      } else {
        debugPrint('Firebase Messaging returned no registration token');
      }
    } catch (error, stackTrace) {
      debugPrint('FCM token registration failed: $error');
      debugPrintStack(stackTrace: stackTrace);
    }
  }

  /// Opens the push the app was launched from, once [initialize] has found
  /// it: the home screen asks on its first frame, which may now come first.
  Future<void> consumePending() async {
    await ready;
    final pending = pendingDestination;
    pendingDestination = null;
    if (pending != null) _opened.add(pending);
  }

  static const _registeredKey = 'notifications.registered_device';

  /// How long a registration stands before the launch hands the token over
  /// again anyway, in case the server has let it go.
  static const _registrationLasts = Duration(days: 7);

  Future<bool> _registeredLately(String token, String userId) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_registeredKey);
      if (raw == null) return false;
      final kept = jsonDecode(raw) as Map<String, dynamic>;
      final at = DateTime.tryParse('${kept['at']}');
      return kept['token'] == token &&
          kept['userId'] == userId &&
          at != null &&
          DateTime.now().difference(at) < _registrationLasts;
    } catch (_) {
      return false;
    }
  }

  Future<void> _rememberRegistration(String token, String userId) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _registeredKey,
        jsonEncode({
          'token': token,
          'userId': userId,
          'at': DateTime.now().toIso8601String(),
        }),
      );
    } catch (_) {
      // Not remembered: the next launch registers once more, nothing worse.
    }
  }

  Future<void> _forgetRegistration() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_registeredKey);
    } catch (_) {}
  }

  void openDestination(Map<String, dynamic> data) => _emit(data);

  void _emit(Map<String, dynamic> data) {
    pendingDestination = Map<String, dynamic>.from(data);
    _opened.add(Map<String, dynamic>.from(data));
  }

  Future<void> _showForeground(RemoteMessage message) async {
    final notification = message.notification;
    if (notification == null) return;
    if (kIsWeb) return;
    await _local.show(
      id: message.hashCode,
      title: notification.title,
      body: notification.body,
      notificationDetails: const NotificationDetails(
        android: AndroidNotificationDetails(
          'sowaka_notifications',
          'Sowaka notifications',
          importance: Importance.high,
          priority: Priority.high,
        ),
        iOS: DarwinNotificationDetails(),
      ),
      payload: jsonEncode(message.data),
    );
  }

  Future<void> _register(String token) async {
    final session = _session;
    if (session == null) return;
    final response = await http
        .post(
          Uri.parse('${ApiConfig.baseUrl}/notifications/devices'),
          headers: {
            'Authorization': 'Bearer ${session.token}',
            'Content-Type': 'application/json',
          },
          body: jsonEncode({
            'token': token,
            'platform': kIsWeb
                ? 'web'
                : defaultTargetPlatform == TargetPlatform.iOS
                ? 'ios'
                : 'android',
          }),
        )
        .timeout(_setupLimit);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError(
        'Device registration failed (${response.statusCode}): ${response.body}',
      );
    }
    await _rememberRegistration(token, session.user.id);
    debugPrint('FCM device token registered');
  }
}
