import 'dart:convert';

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
  runApp(CareWebApp(session: _sessionFromAddress()));
}

/// The token from `#token=…`, remembered for this browser tab. The same
/// fragment carries `embed=1` when the app's own web view opened the page,
/// which hides the page's back row (the app's bar is the way back) and is
/// remembered the same way so a reload inside the app stays embedded.
AuthSession? _sessionFromAddress() {
  String? token;
  try {
    final fragment = Uri.base.fragment;
    final params = Uri.splitQueryString(fragment);
    final fromAddress = params['token'];
    // The app's web view says so in the address, and older app builds say
    // so by their browser: an iOS web view carries no "Safari" in its agent
    // string, and an Android one carries "; wv".
    final agent = web.window.navigator.userAgent;
    final inAppView =
        (RegExp(r'iPhone|iPad').hasMatch(agent) && !agent.contains('Safari')) ||
        agent.contains('; wv');
    if (params['embed'] == '1' || inAppView) {
      careEmbedded = true;
      web.window.sessionStorage.setItem('sowaka.embed', '1');
    } else if (web.window.sessionStorage.getItem('sowaka.embed') == '1') {
      careEmbedded = true;
    }
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
      final response = await http.get(
        Uri.parse('${ApiConfig.baseUrl}/care/public-catalog'),
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
      title: 'Sowaka Care',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        fontFamily: careFont,
        scaffoldBackgroundColor: CareColors.bg,
        colorScheme: ColorScheme.fromSeed(seedColor: CareColors.blue),
        useMaterial3: true,
      ),
      // Inside the app a deep link such as /move is the whole stack: the
      // app's own bar is the way back, and the index would only duplicate
      // the app's Care tab. In a plain browser the index sits underneath,
      // so the page's back link has somewhere to go.
      onGenerateInitialRoutes: (initial) => [
        if (!careEmbedded && initial != '/')
          _route(const RouteSettings(name: '/')),
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
