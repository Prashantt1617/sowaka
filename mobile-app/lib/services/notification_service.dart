import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../features/auth/data/auth_models.dart';
import '../firebase_options.dart';
import 'api_config.dart';
import 'notification_sounds.dart';

/// The channel a push that lands while the app is open is shown on: the one
/// the server named, if this phone made it, else the plain one.
String foregroundChannelFor(String? asked, Iterable<String> soundTags) {
  if (asked == null || asked.isEmpty) return plainChannelId;
  final made = soundTags.map((tag) {
    final at = tag.lastIndexOf('@');
    return at < 0
        ? ''
        : soundChannelId(tag.substring(0, at), int.tryParse(tag.substring(at + 1)) ?? 0);
  }).toSet();
  return made.contains(asked) ? asked : plainChannelId;
}

/// Every push before sounds could be chosen, and the fallback since.
const plainChannelId = 'sowaka_notifications';

@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
}

class AppNotificationService {
  AppNotificationService._();
  static final instance = AppNotificationService._();

  final _opened = StreamController<Map<String, dynamic>>.broadcast();
  final _local = FlutterLocalNotificationsPlugin();

  /// The notification sounds this phone has (`key@version`), as last synced.
  List<String> _soundTags = const [];
  late final _sounds = NotificationSoundSync(
    client: http.Client(),
    files: DeviceSoundFiles(),
    channels: kIsWeb ? null : DeviceSoundChannels(_local),
    platform: defaultTargetPlatform,
    baseUrl: ApiConfig.baseUrl,
  );
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
            plainChannelId,
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
        // Built-in and downloaded sounds first, so the registration says
        // which ones this phone can play. Never longer than the setup limit.
        await _syncSounds();
        // The same token, person and sounds were handed over lately: every
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

  /// Brings the phone's notification sounds in line with the server's list
  /// (never throws, never longer than [_setupLimit] twice over).
  Future<void> _syncSounds() async {
    if (kIsWeb) return;
    try {
      _soundTags = await _sounds
          .sync(token: _session?.token)
          .timeout(_setupLimit * 2);
    } catch (error) {
      debugPrint('Notification sounds not synced: $error');
    }
  }

  Future<bool> _registeredLately(String token, String userId) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_registeredKey);
      if (raw == null) return false;
      final kept = jsonDecode(raw) as Map<String, dynamic>;
      final at = DateTime.tryParse('${kept['at']}');
      return kept['token'] == token &&
          kept['userId'] == userId &&
          // A sound downloaded since is news for the server.
          kept['sounds'] == _soundTags.join(',') &&
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
          'sounds': _soundTags.join(','),
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

  /// A push that lands while the app is open, shown as the system would
  /// have: on the channel (sound) the server picked if this phone has it,
  /// with its picture when it carries one.
  Future<void> _showForeground(RemoteMessage message) async {
    final notification = message.notification;
    if (notification == null) return;
    if (kIsWeb) return;
    final imageUrl =
        '${message.data['imageUrl'] ?? notification.android?.imageUrl ?? notification.apple?.imageUrl ?? ''}';
    final picture = imageUrl.startsWith('https://')
        ? await _fetchPicture(imageUrl)
        : null;
    final channelId = foregroundChannelFor(
      notification.android?.channelId,
      _soundTags,
    );
    final iosSound = notification.apple?.sound?.name;
    final attachment = picture == null || defaultTargetPlatform != TargetPlatform.iOS
        ? null
        : await _pictureFile(picture);
    await _local.show(
      id: message.hashCode,
      title: notification.title,
      body: notification.body,
      notificationDetails: NotificationDetails(
        android: AndroidNotificationDetails(
          channelId,
          'Sowaka notifications',
          importance: Importance.high,
          priority: Priority.high,
          largeIcon: picture == null ? null : ByteArrayAndroidBitmap(picture),
          styleInformation: picture == null
              ? null
              : BigPictureStyleInformation(
                  ByteArrayAndroidBitmap(picture),
                  hideExpandedLargeIcon: true,
                ),
        ),
        iOS: DarwinNotificationDetails(
          sound: iosSound == null || iosSound == 'default' ? null : iosSound,
          attachments: attachment == null
              ? null
              : [DarwinNotificationAttachment(attachment)],
        ),
      ),
      payload: jsonEncode(message.data),
    );
  }

  /// A push's picture, small and quick, or nothing: the words go out anyway.
  Future<Uint8List?> _fetchPicture(String url) async {
    try {
      final response = await http
          .get(Uri.parse(url))
          .timeout(const Duration(seconds: 6));
      final type = response.headers['content-type'] ?? '';
      if (response.statusCode != 200 || !type.startsWith('image/')) return null;
      if (response.bodyBytes.length > 2 * 1024 * 1024) return null;
      return response.bodyBytes;
    } catch (_) {
      return null;
    }
  }

  /// iOS attaches a picture from a file, which it then moves into its store.
  Future<String?> _pictureFile(Uint8List bytes) async {
    try {
      final dir = await getTemporaryDirectory();
      // iOS goes by the extension: a PNG's own header, else a JPEG.
      final png = bytes.length > 4 && bytes[0] == 0x89 && bytes[1] == 0x50;
      final file = File(
        '${dir.path}/push-${DateTime.now().microsecondsSinceEpoch}.${png ? 'png' : 'jpg'}',
      );
      await file.writeAsBytes(bytes, flush: true);
      return file.path;
    } catch (_) {
      return null;
    }
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
            // The sounds this phone can play, so the server picks one it has.
            if (!kIsWeb) 'sounds': _soundTags,
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
