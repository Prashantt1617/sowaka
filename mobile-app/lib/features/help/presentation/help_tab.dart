import 'package:flutter/material.dart';

import '../../../services/linkified_text.dart';
import '../../auth/data/auth_models.dart';
import '../../care/data/care_api_service.dart';
import '../../care/data/care_models.dart';
import '../../care/presentation/care_theme.dart';
import '../../care/presentation/care_web_screen.dart';
import '../../manager_shell/presentation/app_home_header.dart';
import '../../shared/app_toast.dart';
import '../../talk/data/talk_api_service.dart';
import '../../talk/data/talk_models.dart';
import '../../talk/presentation/talk_format.dart';
import '../data/help_api_service.dart';
import '../data/help_models.dart';
import '../data/help_topics.dart';
import 'choose_someone_screen.dart';
import 'counsellor_profile_screen.dart';
import 'help_onboarding.dart';
import 'help_widgets.dart';
import 'session_details_screen.dart';
import 'topics/topic_router.dart';

/// Help: a matched counsellor first, chosen from the person's own answers on
/// the first open; the session coming up; ten topics to explore under it.
class HelpTab extends StatefulWidget {
  const HelpTab({
    super.key,
    required this.session,
    required this.profileAction,
    required this.onNotifications,
    this.service,
    this.careService,
  });

  final AuthSession session;
  final Widget profileAction;
  final VoidCallback onNotifications;

  /// Supplied by tests; the tab makes its own otherwise.
  final HelpApiService? service;
  final CareApiService? careService;

  @override
  State<HelpTab> createState() => _HelpTabState();
}

class _HelpTabState extends State<HelpTab> {
  late final HelpApiService _service =
      widget.service ?? HelpApiService(session: widget.session);
  late final CareApiService _care =
      widget.careService ?? CareApiService(session: widget.session);
  HelpHome? _home;

  /// The topics' text, from the server; the app's own copy until it arrives.
  List<HelpTopic> _topics = helpTopicList;
  CareCatalog _catalog = CareCatalog.empty;
  bool _loading = true;
  String? _error;

  /// Editing the answers from Help home.
  bool _editing = false;
  HelpIntake? _intakeForEdit;

  @override
  void initState() {
    super.initState();
    _load();
    _care
        .catalog()
        .then((catalog) {
          if (!mounted) return;
          setState(() {
            _catalog = catalog;
            if (catalog.topics.isNotEmpty) _topics = catalog.topics;
          });
        })
        .catchError((_) {});
  }

  Future<void> _load() async {
    try {
      final home = await _service.home();
      if (!mounted) return;
      setState(() {
        _home = home;
        _loading = false;
        _error = null;
      });
    } catch (error) {
      if (!mounted) return;
      debugPrint('Help home failed: $error');
      setState(() {
        _loading = false;
        _error = error is TalkApiException
            ? error.message
            : 'Could not load Help.';
      });
    }
  }

  /// A topic lives on the web when Sowaka has put the Care pages there; the
  /// token rides in the address fragment, which never leaves the browser, so
  /// the page can save the person's writing and show it again.
  Future<void> _openTopic(HelpTopic topic) {
    final base = _catalog.webBase;
    if (base.isEmpty) {
      return _push(
        topicScreenFor(
          topic: topic,
          care: _care,
          catalog: _catalog,
          session: widget.session,
          help: _service,
          match: _home?.match ?? _home?.noMatch,
        ),
      );
    }
    return _push(
      CareWebScreen(
        title: topic.name,
        url:
            '$base/topic/${topic.id}#token=${Uri.encodeComponent(widget.session.token)}',
      ),
    );
  }

  Future<void> _push(Widget screen) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));
    if (mounted) await _load();
  }

  Future<void> _editAnswers() async {
    try {
      final intake = await _service.intake();
      if (!mounted) return;
      setState(() {
        _intakeForEdit = intake ?? HelpIntake.empty;
        _editing = true;
      });
    } catch (error) {
      if (!mounted) return;
      showAppToast(
        context,
        error is TalkApiException
            ? error.message
            : 'Could not open your answers.',
      );
    }
  }

  Future<void> _join(TalkSession session) async {
    final url = session.joinUrl;
    if (url == null || url.isEmpty) return;
    final opened = await openExternalLink(url);
    if (!opened && mounted) showAppToast(context, 'Could not open the link');
  }

  Future<void> _accept(Counsellor counsellor) async {
    try {
      await _service.acceptCounsellor(counsellor.userId);
      await _load();
    } catch (error) {
      if (!mounted) return;
      showAppToast(
        context,
        error is TalkApiException
            ? error.message
            : 'Could not save that. Try again.',
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final home = _home;
    Widget body;
    if (_loading) {
      body = const CareSpinner();
    } else if (_error case final message?) {
      body = Padding(
        padding: const EdgeInsets.all(20),
        child: CareNotice(message, onRetry: _load),
      );
    } else if (home == null || !home.intakeDone || _editing) {
      body = HelpOnboarding(
        key: ValueKey(_editing ? 'edit' : 'first'),
        service: _service,
        initial: _editing ? _intakeForEdit : null,
        startOnReview: _editing,
        onCancel: _editing ? () => setState(() => _editing = false) : null,
        onDone: () {
          setState(() {
            _editing = false;
            _loading = true;
          });
          _load();
        },
      );
    } else {
      body = _homeView(home);
    }
    return ColoredBox(
      color: CareColors.bg,
      child: Column(
        children: [
          AppHomeHeader(
            profileAction: widget.profileAction,
            onNotifications: widget.onNotifications,
          ),
          Expanded(child: body),
        ],
      ),
    );
  }

  Widget _homeView(HelpHome home) {
    final match = home.match;
    final noMatch = home.noMatch;
    final upcoming = home.upcoming;
    return RefreshIndicator(
      color: CareColors.blue,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 22, 20, 32),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          const CareEyebrow('Help'),
          const SizedBox(height: 10),
          const CareHeading('A little support.\nA familiar face.', size: 36),
          const SizedBox(height: 12),
          const CareCopy(
            'Connect with your counsellor,\nor explore what’s on your mind.',
            size: 13.5,
          ),
          const SizedBox(height: 22),
          if (upcoming != null) ...[
            _UpcomingCard(
              session: upcoming,
              onJoin: () => _join(upcoming),
              onOpen: () => _push(
                SessionDetailsScreen(
                  session: upcoming,
                  service: _service,
                  backLabel: 'Help',
                ),
              ),
            ),
            const SizedBox(height: 14),
          ],
          if (match != null)
            _CounsellorCard(
              match: match,
              onProfile: () => _push(
                CounsellorProfileScreen(
                  service: _service,
                  counsellorId: match.counsellor.userId,
                  backLabel: 'Help',
                ),
              ),
              onChoose: () => _push(
                ChooseSomeoneScreen(
                  service: _service,
                  matchedId: match.counsellor.userId,
                ),
              ),
              onEdit: _editAnswers,
            )
          else if (noMatch != null)
            CareCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const CareEyebrow('Your preferences, in view'),
                  const SizedBox(height: 12),
                  const CareSectionTitle(
                    'Nobody fits every preference you set.',
                  ),
                  const SizedBox(height: 8),
                  CareCopy(
                    'The closest is ${noMatch.counsellor.name}. Your choices haven’t been changed.',
                    size: 13.5,
                  ),
                  const SizedBox(height: 14),
                  CounsellorPerson(counsellor: noMatch.counsellor),
                  const SizedBox(height: 12),
                  UnmetNote(noMatch.unmet),
                  const SizedBox(height: 16),
                  CarePrimaryButton(
                    'Show me who is available anyway',
                    onTap: () => _accept(noMatch.counsellor),
                  ),
                  const SizedBox(height: 4),
                  Center(
                    child: CareLink('Review my answers', onTap: _editAnswers),
                  ),
                ],
              ),
            )
          else
            CareCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const CareSectionTitle('No counsellor is available yet.'),
                  const SizedBox(height: 8),
                  const CareCopy(
                    'One will be suggested here as soon as there is.',
                  ),
                  const SizedBox(height: 10),
                  CareLink('Review my answers', onTap: _editAnswers),
                ],
              ),
            ),
          const SizedBox(height: 26),
          const CareSectionTitle('Explore a topic', size: 22),
          const SizedBox(height: 6),
          const CareCopy(
            'Understand it. Try something. Talk it through.',
            size: 13.5,
          ),
          const SizedBox(height: 14),
          GridView.builder(
            shrinkWrap: true,
            padding: EdgeInsets.zero,
            physics: const NeverScrollableScrollPhysics(),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              mainAxisSpacing: 10,
              crossAxisSpacing: 10,
              mainAxisExtent: 78,
            ),
            itemCount: _topics.length,
            itemBuilder: (_, i) {
              final topic = _topics[i];
              return Material(
                color: CareColors.paper,
                borderRadius: BorderRadius.circular(16),
                child: InkWell(
                  key: ValueKey('topic-${topic.id}'),
                  onTap: () => _openTopic(topic),
                  borderRadius: BorderRadius.circular(16),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 12,
                    ),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: CareColors.line),
                    ),
                    child: Row(
                      children: [
                        Icon(topic.icon, color: CareColors.blue, size: 22),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            topic.name,
                            style: const TextStyle(
                              fontFamily: careFont,
                              color: CareColors.ink,
                              fontSize: 13.5,
                              fontWeight: FontWeight.w500,
                              height: 1.3,
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
          if (home.history.isNotEmpty) ...[
            const SizedBox(height: 26),
            const CareSectionTitle('Your sessions', size: 17),
            const SizedBox(height: 10),
            for (final session in home.history)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: SessionRow(
                  session: session,
                  onTap: () => _push(
                    SessionDetailsScreen(
                      session: session,
                      service: _service,
                      backLabel: 'Help',
                    ),
                  ),
                ),
              ),
          ],
        ],
      ),
    );
  }
}

class _CounsellorCard extends StatelessWidget {
  const _CounsellorCard({
    required this.match,
    required this.onProfile,
    required this.onChoose,
    required this.onEdit,
  });

  final HelpMatch match;
  final VoidCallback onProfile;
  final VoidCallback onChoose;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) {
    final c = match.counsellor;
    return CareCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const CareEyebrow('Your counsellor'),
          const SizedBox(height: 18),
          CounsellorPerson(counsellor: c),
          if (c.focusLabels.isNotEmpty) ...[
            const SizedBox(height: 14),
            FocusChips(c.focusLabels.take(3).toList()),
          ],
          const SizedBox(height: 10),
          CareLink('View profile & sessions', onTap: onProfile, size: 14),
          const SizedBox(height: 8),
          const Divider(color: CareColors.line, height: 1),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: Text(
                  match.unmet.isEmpty ? 'Matched for you' : 'Chosen by you',
                  style: const TextStyle(
                    fontFamily: careFont,
                    color: CareColors.muted,
                    fontSize: 12.5,
                  ),
                ),
              ),
              CareLink('Edit answers', icon: null, onTap: onEdit, size: 12.5),
            ],
          ),
          Align(
            alignment: Alignment.centerRight,
            child: CareLink(
              'Choose someone else',
              icon: Icons.arrow_outward_rounded,
              onTap: onChoose,
              size: 12.5,
            ),
          ),
        ],
      ),
    );
  }
}

class _UpcomingCard extends StatelessWidget {
  const _UpcomingCard({
    required this.session,
    required this.onJoin,
    required this.onOpen,
  });

  final TalkSession session;
  final VoidCallback onJoin;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    return CareCard(
      color: CareColors.sage,
      onTap: onOpen,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const CareEyebrow('Your next session'),
          const SizedBox(height: 10),
          Text(
            '${talkDate(session.startsAt)} · ${talkRange(session.startsAt, session.endsAt)}',
            style: const TextStyle(
              fontFamily: careFont,
              color: CareColors.ink,
              fontSize: 17,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'With ${session.counsellorName} · Video call${session.placeholderLink ? ' · test link' : ''}',
            style: const TextStyle(
              fontFamily: careFont,
              color: CareColors.muted,
              fontSize: 13,
            ),
          ),
          if (session.joinUrl != null) ...[
            const SizedBox(height: 14),
            CarePrimaryButton(
              'Join session',
              icon: Icons.videocam_rounded,
              onTap: onJoin,
            ),
          ],
        ],
      ),
    );
  }
}
