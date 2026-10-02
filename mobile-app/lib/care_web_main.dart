import 'dart:convert';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_web_plugins/url_strategy.dart';
import 'package:http/http.dart' as http;
import 'package:web/web.dart' as web;

import 'features/auth/data/auth_models.dart';
import 'features/care/data/care_api_service.dart';
import 'features/care/data/care_models.dart';
import 'features/care/presentation/breathe_screen.dart';
import 'features/care/presentation/care_theme.dart';
import 'features/care/presentation/listen_screen.dart';
import 'features/care/presentation/move_screen.dart';
import 'features/care/presentation/sleep_screen.dart';
import 'features/help/data/help_api_service.dart';
import 'features/help/data/help_topics.dart';
import 'features/help/presentation/topics/topic_router.dart';
import 'services/api_config.dart';

/// The Care activities on the web: /move, /breathe, /listen, /sleep and
/// `/topic/<id>`, the same screens the app has, built for the browser. The app
/// opens these pages, so a changed clip, sound or line of text never needs a
/// release.
///
/// A topic saves the person's writing, so the app opens it with the session
/// token in the address fragment (`#token=…`), which the browser never sends
/// to any server. It is kept for the tab's life and taken off the address.
///
///   flutter build web --target lib/care_web_main.dart --dart-define=API_BASE_URL=https://api-host
void main() {
  usePathUrlStrategy();
  // These are the web pages: a page opened by its address draws no back row
  // of its own, because there is nothing underneath it.
  careWebPages = true;
  careHoldPing = _ping;
  careWheelWake = _wake;
  careWheelTick = _tick;
  careWheelChime = _chime;
  careShareImage = _shareImage;
  // The app's one back arrow asks the page first: a page within the page
  // goes back to the one before; at the first, the page says no and the app
  // takes the person home.
  globalContext['sowakaBack'] = (() {
    final nav = _navigator.currentState;
    if (nav == null || !nav.canPop()) return false.toJS;
    nav.pop();
    return true.toJS;
  }).toJS;
  runApp(CareWebApp(session: _sessionFromAddress()));
}

/// A soft bell, made here rather than fetched: 880 Hz fading over a little
/// under a second.
final String _pingSound = () {
  const rate = 22050;
  const samples = rate * 9 ~/ 10;
  final data = ByteData(44 + samples * 2);
  void text(int at, String s) {
    for (var i = 0; i < s.length; i++) {
      data.setUint8(at + i, s.codeUnitAt(i));
    }
  }

  text(0, 'RIFF');
  data.setUint32(4, 36 + samples * 2, Endian.little);
  text(8, 'WAVEfmt ');
  data.setUint32(16, 16, Endian.little);
  data.setUint16(20, 1, Endian.little);
  data.setUint16(22, 1, Endian.little);
  data.setUint32(24, rate, Endian.little);
  data.setUint32(28, rate * 2, Endian.little);
  data.setUint16(32, 2, Endian.little);
  data.setUint16(34, 16, Endian.little);
  text(36, 'data');
  data.setUint32(40, samples * 2, Endian.little);
  for (var i = 0; i < samples; i++) {
    final t = i / rate;
    final fade = math.exp(-5 * t) * math.min(1, t * 200);
    final v =
        fade *
        (0.8 * math.sin(2 * math.pi * 880 * t) +
            0.2 * math.sin(2 * math.pi * 1760 * t));
    data.setInt16(44 + i * 2, (v * 0.6 * 32767).round(), Endian.little);
  }
  return 'data:audio/wav;base64,${base64Encode(data.buffer.asUint8List())}';
}();

/// The life wheel's sounds, made here: a soft tick for each peg, a gentle
/// two-note chime where the wheel stops.
web.AudioContext? _audio;

web.AudioContext? _wake() {
  try {
    final audio = _audio ??= web.AudioContext();
    if (audio.state == 'suspended') audio.resume();
    return audio;
  } catch (_) {
    return null;
  }
}

void _tick(double strength) {
  final audio = _wake();
  if (audio == null) return;
  final now = audio.currentTime;
  final tone = audio.createOscillator()..type = 'triangle';
  tone.frequency
    ..setValueAtTime(1500, now)
    ..exponentialRampToValueAtTime(700, now + 0.03);
  final level = audio.createGain();
  level.gain
    ..setValueAtTime(0.0001, now)
    ..exponentialRampToValueAtTime(0.05 * strength + 0.015, now + 0.003)
    ..exponentialRampToValueAtTime(0.0001, now + 0.045);
  tone.connect(level);
  level.connect(audio.destination);
  tone.start(now);
  tone.stop(now + 0.05);
}

void _chime() {
  final audio = _wake();
  if (audio == null) return;
  final now = audio.currentTime;
  for (final (pitch, delay) in [(659.25, 0.0), (987.77, 0.09)]) {
    final tone = audio.createOscillator()..type = 'sine';
    tone.frequency.value = pitch;
    final level = audio.createGain();
    level.gain
      ..setValueAtTime(0.0001, now + delay)
      ..exponentialRampToValueAtTime(0.05, now + delay + 0.01)
      ..exponentialRampToValueAtTime(0.0001, now + delay + 0.9);
    tone.connect(level);
    level.connect(audio.destination);
    tone.start(now + delay);
    tone.stop(now + delay + 1);
  }
}

/// Hands a picture to the phone's share sheet. It has to be called straight
/// from a tap. False where the browser cannot share a file; true once shared,
/// or when the person closed the sheet themselves.
Future<bool> _shareImage(Uint8List png, String fileName, String title) async {
  try {
    final file = web.File(
      <web.BlobPart>[png.toJS].toJS,
      fileName,
      web.FilePropertyBag(type: 'image/png'),
    );
    final data = web.ShareData(files: <web.File>[file].toJS, title: title);
    if (!web.window.navigator.canShare(data)) return false;
    await web.window.navigator.share(data).toDart;
    return true;
  } catch (error) {
    return error.toString().contains('AbortError');
  }
}

void _ping() {
  final audio = web.HTMLAudioElement()..src = _pingSound;
  audio.play().toDart.catchError((_) => null);
}

final _navigator = GlobalKey<NavigatorState>();

/// The token from `#token=…`, remembered for this browser tab; and `top=…`,
/// the height of the phone's status bar when the app shows a page right up
/// to the top of the screen.
AuthSession? _sessionFromAddress() {
  String? token;
  try {
    final fragment = Uri.base.fragment;
    final params = Uri.splitQueryString(fragment);
    careTopInset = double.tryParse(params['top'] ?? '') ?? 0;
    final fromAddress = params['token'];
    if (fromAddress != null && fromAddress.isNotEmpty) {
      token = fromAddress;
      web.window.sessionStorage.setItem('sowaka.token', token);
    } else {
      token = web.window.sessionStorage.getItem('sowaka.token');
    }
    if (fragment.isNotEmpty) {
      web.window.history.replaceState(
        null,
        '',
        Uri.base.replace(fragment: '').toString(),
      );
    }
  } catch (_) {
    // No storage, no token: the pages that need none still open.
  }
  if (token == null || token.isEmpty) return null;
  return AuthSession(
    token: token,
    user: const AuthUser(
      id: '',
      email: '',
      name: '',
      role: 'employee',
      company: '',
    ),
  );
}

class CareWebApp extends StatefulWidget {
  const CareWebApp({super.key, this.session});

  /// Present when the app opened the page with the person's token.
  final AuthSession? session;

  @override
  State<CareWebApp> createState() => _CareWebAppState();
}

class _CareWebAppState extends State<CareWebApp> {
  final _catalog = ValueNotifier<CareCatalog?>(null);
  String? _error;
  late final CareApiService? _care = widget.session == null
      ? null
      : CareApiService(session: widget.session!);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      // Asked for fresh each time, so a changed line or a removed sound
      // shows at once, not after the minutes a browser may keep a copy.
      final response = await http.get(
        Uri.parse('${ApiConfig.baseUrl}/care/public-catalog').replace(
          queryParameters: {'at': '${DateTime.now().millisecondsSinceEpoch}'},
        ),
      );
      final json = jsonDecode(response.body) as Map<String, dynamic>;
      _catalog.value = CareCatalog.fromJson(
        json['catalog'] as Map<String, dynamic>? ?? const {},
      );
    } catch (_) {
      // The screens still open; what they play says it is on its way.
      setState(
        () => _error = 'Could not reach Sowaka. Some clips may not play.',
      );
      _catalog.value = CareCatalog.empty;
    }
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      navigatorKey: _navigator,
      title: 'Sowaka Care',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        fontFamily: careFont,
        scaffoldBackgroundColor: CareColors.bg,
        colorScheme: ColorScheme.fromSeed(seedColor: CareColors.blue),
        useMaterial3: true,
      ),
      // A page opened by its own address is the whole stack. Putting the
      // index underneath gave every page a back link to a copy of the app's
      // own Care tab, which is not a place anyone asked to go.
      onGenerateInitialRoutes: (initial) => [
        _route(RouteSettings(name: initial)),
      ],
      onGenerateRoute: _route,
    );
  }

  Route<dynamic> _route(RouteSettings settings) {
    {
      final path = Uri.parse(
        settings.name ?? '/',
      ).path.replaceAll(RegExp(r'/+$'), '');
      final topicMatch = RegExp(r'^/topic/([a-z-]+)$').firstMatch(path);
      Widget screen(CareCatalog catalog) {
        if (topicMatch != null) return _topic(catalog, topicMatch.group(1)!);
        return switch (path) {
          '/move' => MoveScreen(catalog: catalog),
          '/breathe' => BreatheScreen(catalog: catalog),
          '/listen' => ListenScreen(catalog: catalog),
          '/sleep' => SleepScreen(catalog: catalog),
          _ => _CareIndex(
            error: _error,
            topics: _care == null
                ? const []
                : (catalog.topics.isEmpty ? helpTopicList : catalog.topics),
          ),
        };
      }

      return MaterialPageRoute(
        settings: settings,
        builder: (_) => _PhoneFrame(
          child: ValueListenableBuilder<CareCatalog?>(
            valueListenable: _catalog,
            builder: (_, catalog, _) => catalog == null
                ? const Scaffold(
                    backgroundColor: CareColors.bg,
                    body: CareSpinner(),
                  )
                : screen(catalog),
          ),
        ),
      );
    }
  }
}

extension on _CareWebAppState {
  /// A topic page: reading, question, the reflection tool and Write, saving
  /// to the person's journal when the app handed over their token.
  Widget _topic(CareCatalog catalog, String id) {
    final topics = catalog.topics.isEmpty ? helpTopicList : catalog.topics;
    final topic = topics.where((t) => t.id == id).firstOrNull;
    final care = _care;
    final session = widget.session;
    if (topic == null)
      return _CareIndex(
        error: 'That topic is not here any more.',
        topics: topics,
      );
    if (care == null || session == null) {
      return const CarePage(
        children: [
          CareNotice(
            'Open this topic from the Sowaka app, so what you write is saved to you.',
          ),
        ],
      );
    }
    return topicScreenFor(
      topic: topic,
      care: care,
      catalog: catalog,
      session: session,
      // Booking and the counsellor's profile work here too, with the token.
      help: HelpApiService(session: session),
      showCounsellor: false,
      backLabel: 'Topics',
    );
  }
}

/// On a wide screen the page sits in a phone-width column; on a phone it is
/// the whole screen.
class _PhoneFrame extends StatelessWidget {
  const _PhoneFrame({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    if (width <= 560) return child;
    return ColoredBox(
      color: const Color(0xFFEDEEF1),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(0),
            child: child,
          ),
        ),
      ),
    );
  }
}

class _CareIndex extends StatelessWidget {
  const _CareIndex({this.error, this.topics = const []});

  final String? error;

  /// Shown when the page was opened with a token, so writing can be saved.
  final List<HelpTopic> topics;

  @override
  Widget build(BuildContext context) {
    return CarePage(
      children: [
        const CareEyebrow('Sowaka Care'),
        const SizedBox(height: 10),
        const CareHeading('A little space\nfor you.', size: 36),
        const SizedBox(height: 12),
        const CareCopy(
          'Choose what feels right.\nWhenever you need it.',
          size: 13.5,
        ),
        if (error case final message?) ...[
          const SizedBox(height: 14),
          CareNotice(message),
        ],
        const SizedBox(height: 24),
        for (final (path, name, sub, icon, color) in const [
          (
            '/move',
            'Move',
            'Choose a body area',
            Icons.accessibility_new_rounded,
            CareColors.sage,
          ),
          (
            '/breathe',
            'Breathe',
            'Start with how you feel',
            Icons.air_rounded,
            CareColors.sky,
          ),
          (
            '/listen',
            'Listen',
            'Meditations & affirmations',
            Icons.headphones_outlined,
            CareColors.lilac,
          ),
          (
            '/sleep',
            'Sleep',
            'Ease into rest',
            Icons.nightlight_outlined,
            CareColors.night,
          ),
        ])
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Material(
              color: color,
              borderRadius: BorderRadius.circular(22),
              child: InkWell(
                onTap: () => Navigator.of(context).pushNamed(path),
                borderRadius: BorderRadius.circular(22),
                child: Padding(
                  padding: const EdgeInsets.all(18),
                  child: Row(
                    children: [
                      Icon(icon, color: CareColors.blue, size: 26),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              name,
                              style: const TextStyle(
                                fontFamily: careFont,
                                color: CareColors.ink,
                                fontSize: 19,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            Text(
                              sub,
                              style: const TextStyle(
                                fontFamily: careFont,
                                color: CareColors.muted,
                                fontSize: 12.5,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const Icon(
                        Icons.arrow_outward_rounded,
                        color: CareColors.ink,
                        size: 18,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        if (topics.isNotEmpty) ...[
          const SizedBox(height: 14),
          const CareSectionTitle('Explore what’s on your mind', size: 20),
          const SizedBox(height: 12),
          for (final topic in topics)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: CareResourceRow(
                title: topic.name,
                meta: topic.intro,
                icon: topic.icon,
                onTap: () =>
                    Navigator.of(context).pushNamed('/topic/${topic.id}'),
              ),
            ),
        ],
      ],
    );
  }
}
