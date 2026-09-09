import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';

import '../../shared/image_crop_sheet.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../auth/data/auth_api_service.dart';
import '../../manager/data/manager_api_service.dart';
import '../../auth/data/auth_models.dart';
import '../bloc/connect_bloc.dart';
import '../data/connect_models.dart';
import 'game_play_screen.dart';
import '../../manager_shell/presentation/app_home_header.dart';
import '../../notifications/presentation/notification_inbox_screen.dart';
import '../../../services/api_config.dart';
import '../../../services/linkified_text.dart';
import '../../../services/notification_service.dart';

/// Lets any screen in the app open the Connect post composer, not just the
/// Connect tab itself — the composer's `showModalBottomSheet`/`Navigator.push`
/// calls run against `_ConnectFeedScreenState`'s own context, which stays
/// valid regardless of which tab is currently visible since `IndexedStack`
/// keeps every tab mounted.
class ConnectComposerController {
  _ConnectFeedScreenState? _state;

  void _attach(_ConnectFeedScreenState state) => _state = state;

  void _detach(_ConnectFeedScreenState state) {
    if (identical(_state, state)) _state = null;
  }

  void openComposer() => _state?._openPostTypePicker();
}

class ConnectFeedScreen extends StatefulWidget {
  const ConnectFeedScreen({
    super.key,
    required this.session,
    required this.profileAction,
    this.recognitionCandidates = const [],
    this.composerController,
    this.onOpenPerson,
  });

  final AuthSession session;
  final Widget profileAction;
  final List<ConnectTeammate> recognitionCandidates;
  final ConnectComposerController? composerController;

  /// Opens a tagged person's profile — supplied by the shell, which owns the
  /// team data and the profile route.
  final ValueChanged<String>? onOpenPerson;

  @override
  State<ConnectFeedScreen> createState() => _ConnectFeedScreenState();
}

class _ConnectFeedScreenState extends State<ConnectFeedScreen> {
  late final ConnectBloc _bloc;

  // AuthUser carries no initials/avatarColor fields of its own, so the
  // signed-in viewer's comment-composer avatar is derived the same way the
  // backend derives author avatars (see `initialsFor`/`avatarColorFor` in
  // connect.service.ts): initials from the name, color hashed from a stable
  // id.
  String get _viewerInitials => _initials(widget.session.user.name);
  Color get _viewerColor => _avatarColorFor(widget.session.user.id);
  String get _viewerPhotoUrl => widget.session.user.profilePhotoUrl ?? '';

  /// Everyone in the company, for the tag picker. Anyone can be tagged, not
  /// only the viewer's own team, so this comes from the org-wide directory
  /// rather than the team data the shell already holds.
  List<ConnectTeammate> _taggablePeople = const [];

  @override
  void initState() {
    super.initState();
    _bloc = ConnectBloc(session: widget.session)..load();
    widget.composerController?._attach(this);
    _loadTaggablePeople();
  }

  Future<void> _loadTaggablePeople() async {
    try {
      final result = await AuthApiService().fetchTeammates(
        widget.session.token,
        limit: 500,
      );
      if (!mounted) return;
      setState(() {
        _taggablePeople = result.teammates
            .map(
              (person) => ConnectTeammate(
                userId: person.userId,
                name: person.name,
                initials: person.initials,
                department: person.roleLine,
                photoUrl: person.photoUrl,
              ),
            )
            .toList();
      });
    } catch (_) {
      // Tagging is optional: if the directory can't be reached the composer
      // simply shows no tag field rather than blocking the post.
    }
  }

  @override
  void dispose() {
    widget.composerController?._detach(this);
    _bloc.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<ConnectState>(
      stream: _bloc.stream,
      initialData: _bloc.state,
      builder: (context, snapshot) {
        final state = snapshot.data ?? _bloc.state;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          final message = state.message;
          if (!mounted || message == null) return;
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(message),
              behavior: SnackBarBehavior.floating,
              backgroundColor: _ConnectColors.ink,
            ),
          );
          _bloc.clearMessage();
        });
        return Container(
          color: _ConnectColors.bg,
          child: SafeArea(
            // AppHomeHeader below already wraps itself in a SafeArea, so a
            // second one here (this Container/SafeArea and AppHomeHeader are
            // siblings, not nested) double-pads under the notch on iPhone —
            // same class of bug as the earlier quick-actions header fix.
            top: false,
            bottom: false,
            child: Column(
              children: [
                AppHomeHeader(
                  profileAction: widget.profileAction,
                  onNotifications: () async {
                    await AppNotificationService.instance.requestPermission();
                    if (!context.mounted) return;
                    await Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) =>
                            NotificationInboxScreen(session: widget.session),
                      ),
                    );
                  },
                  onQuickCreate: _openPostTypePicker,
                ),
                Expanded(child: _buildBody(state)),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildBody(ConnectState state) {
    if (state.status == ConnectLoadStatus.loading ||
        state.status == ConnectLoadStatus.initial) {
      return const Center(
        child: CircularProgressIndicator(color: _ConnectColors.terra),
      );
    }
    if (state.status == ConnectLoadStatus.failure) {
      return _ConnectEmptyState(
        icon: Icons.wifi_off_rounded,
        title: 'Connect is unavailable',
        body: state.error ?? 'Could not load the company feed.',
        actionLabel: 'Try again',
        onAction: _bloc.load,
      );
    }
    if (state.posts.isEmpty) {
      return _ConnectEmptyState(
        icon: Icons.forum_rounded,
        title: 'No posts yet',
        body: 'Company updates, kudos and events will appear here.',
        actionLabel: 'Refresh',
        onAction: _bloc.refresh,
        illustrationAsset: 'assets/icons/connect_empty_state_illustration.png',
      );
    }
    final posts = state.posts;
    return RefreshIndicator(
      color: _ConnectColors.terra,
      onRefresh: _bloc.refresh,
      child: ListView.separated(
        padding: const EdgeInsets.fromLTRB(16, 6, 16, 24),
        itemCount: posts.length + 1,
        separatorBuilder: (_, _) => const SizedBox(height: 16),
        itemBuilder: (context, index) {
          // The composer entry point, now that the nav has no Post tab
          // (node 2002:39114).
          if (index == 0) {
            return _StartAPostCard(
              initials: _viewerInitials,
              color: _viewerColor,
              photoUrl: _viewerPhotoUrl,
              onTap: _openPostTypePicker,
            );
          }
          final post = posts[index - 1];
          return _ConnectPostCard(
            key: ValueKey(post.id),
            post: post,
            busy: state.busyPostId == post.id,
            canManage:
                post.author.userId.isNotEmpty &&
                post.author.userId == widget.session.user.id,
            onLike: () => _bloc.toggleReaction(post.id),
            onComment: (text) => _bloc.addComment(post.id, text),
            onAction: ({optionId}) =>
                _bloc.performAction(post.id, optionId: optionId),
            onPlayGame: () => _openGame(post),
            onEdit: () => _openComposer(post.type, existing: post),
            onDelete: () => _confirmDelete(post),
            onOpenComments: () => _openComments(post.id),
            viewerInitials: _viewerInitials,
            viewerColor: _viewerColor,
            viewerPhotoUrl: _viewerPhotoUrl,
            onOpenPerson: widget.onOpenPerson,
          );
        },
      ),
    );
  }

  bool get _isAdmin => widget.session.user.role.toLowerCase() == 'manager';

  /// Entry point for the "Start a post" card at the top of the feed: the
  /// quick composer opens with its type chips (node 2028:53056), which is
  /// where the post type is chosen now that the nav has no Post tab.
  Future<void> _openPostTypePicker() async {
    final result = await Navigator.of(context).push<_QuickPostResult>(
      MaterialPageRoute(
        builder: (_) => _QuickPostPage(
          viewerInitials: _viewerInitials,
          viewerColor: _viewerColor,
          viewerPhotoUrl: _viewerPhotoUrl,
          department: widget.session.user.department,
          teammates: _taggablePeople,
          isAdmin: _isAdmin,
        ),
      ),
    );
    if (!mounted || result == null) return;
    final draft = result.draft;
    if (draft != null) {
      await _bloc.createPost(draft);
      return;
    }
    final type = result.type;
    if (type != null) await _openComposer(type);
  }

  Future<void> _openComposer(
    ConnectPostType type, {
    ConnectPost? existing,
  }) async {
    _PollDraft? initialPoll;
    if (type == ConnectPostType.survey) {
      initialPoll = await Navigator.of(context).push<_PollDraft>(
        MaterialPageRoute(
          builder: (_) =>
              _PollEditorPage(initial: _PollDraft.fromPost(existing)),
        ),
      );
      if (!mounted || initialPoll == null) return;
    }
    final draft = await Navigator.of(context).push<ConnectPostDraft>(
      MaterialPageRoute(
        builder: (_) => _PostComposerPage(
          type: type,
          existing: existing,
          department: widget.session.user.department,
          recognitionCandidates: widget.recognitionCandidates,
          taggablePeople: _taggablePeople,
          initialPoll: initialPoll,
          viewerInitials: _viewerInitials,
          viewerColor: _viewerColor,
          viewerPhotoUrl: _viewerPhotoUrl,
          resolveLinkPreview: (url) =>
              ManagerApiService(session: widget.session).fetchLinkPreview(url),
        ),
      ),
    );
    if (!mounted || draft == null) return;
    if (existing == null) {
      await _bloc.createPost(draft);
    } else {
      await _bloc.updatePost(existing.id, draft);
    }
  }

  Future<void> _confirmDelete(ConnectPost post) async {
    final confirmed = await showDialog<bool>(
      context: context,
      barrierColor: const Color(0x76000000),
      builder: (_) => _DeletePostSheet(
        title: 'Delete post?',
        body:
            'This will remove your ${post.tag.toLowerCase()} post from the company feed.',
      ),
    );
    if (confirmed == true) await _bloc.deletePost(post.id);
  }

  Future<void> _openComments(String postId) {
    return showModalBottomSheet<void>(
      context: context,
      useSafeArea: true,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _CommentsSheet(
        bloc: _bloc,
        postId: postId,
        viewerInitials: _viewerInitials,
        viewerColor: _viewerColor,
        viewerPhotoUrl: _viewerPhotoUrl,
      ),
    );
  }

  Future<void> _openGame(ConnectPost post) async {
    final gameId = _bodyString(post, 'gameId');
    final hostedUrl = _bodyString(post, 'hostedUrl');
    if (gameId.isEmpty || hostedUrl.isEmpty) return;
    await _bloc.performAction(post.id);
    if (!mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => GamePlayScreen(
          session: widget.session,
          gameId: gameId,
          title: _bodyString(post, 'title'),
          hostedUrl: hostedUrl,
        ),
      ),
    );
  }
}

class _ConnectPostCard extends StatefulWidget {
  const _ConnectPostCard({
    super.key,
    required this.post,
    required this.busy,
    required this.canManage,
    required this.onLike,
    required this.onComment,
    required this.onAction,
    required this.onPlayGame,
    required this.onEdit,
    required this.onDelete,
    required this.onOpenComments,
    required this.viewerInitials,
    required this.viewerColor,
    this.viewerPhotoUrl = '',
    this.onOpenPerson,
  });

  final ConnectPost post;
  final bool busy;
  final bool canManage;
  final VoidCallback onLike;
  final ValueChanged<String> onComment;
  final Future<void> Function({String? optionId}) onAction;
  final VoidCallback onPlayGame;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final VoidCallback onOpenComments;
  final String viewerInitials;
  final Color viewerColor;
  final String viewerPhotoUrl;

  /// Opens a tagged person's profile.
  final ValueChanged<String>? onOpenPerson;

  @override
  State<_ConnectPostCard> createState() => _ConnectPostCardState();
}

class _ConnectPostCardState extends State<_ConnectPostCard> {
  final _commentController = TextEditingController();

  @override
  void dispose() {
    _commentController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final post = widget.post;
    final showHeader = _postShowsHeader(post.type);
    final cardGradient = _celebrationCardGradient(post.type);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: cardGradient == null
            ? (_celebrationCardTint(post.type) ?? Colors.white)
            : null,
        gradient: cardGradient,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: _ConnectColors.cardBorder),
        boxShadow: const [
          BoxShadow(
            color: Color(0x08000000),
            blurRadius: 6,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (showHeader)
              _PostHeader(
                post: post,
                canManage: widget.canManage,
                onEdit: widget.onEdit,
                onDelete: widget.onDelete,
              ),
            // Exactly one type pill per post, sitting between the author row
            // and the content at the card's left edge (nodes 496:20866,
            // 352:1500) rather than indented inside the header column.
            if (showHeader && _typeBadgeFor(post.type) != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: _typeBadgeFor(post.type)!,
                ),
              ),
            _PostBody(
              post: post,
              onAction: widget.onAction,
              onPlayGame: widget.onPlayGame,
              canManage: widget.canManage,
              onEdit: widget.onEdit,
              onDelete: widget.onDelete,
              onCommentPrefill: (text) =>
                  setState(() => _commentController.text = text),
              onOpenPerson: widget.onOpenPerson,
            ),
            _PostFooter(
              post: post,
              busy: widget.busy,
              controller: _commentController,
              onLike: widget.onLike,
              onComment: () {
                final text = _commentController.text.trim();
                if (text.isEmpty) return;
                widget.onComment(text);
                _commentController.clear();
              },
              onOpenComments: widget.onOpenComments,
              viewerInitials: widget.viewerInitials,
              viewerColor: widget.viewerColor,
              viewerPhotoUrl: widget.viewerPhotoUrl,
            ),
          ],
        ),
      ),
    );
  }
}

/// Types that keep the standard author header (avatar, name, audience badge).
/// System-generated post types render their own compact top strip inside the
/// body widget instead (see `_BodyTopStrip`).
bool _postShowsHeader(ConnectPostType type) {
  switch (type) {
    case ConnectPostType.newPost:
    case ConnectPostType.leadership:
    case ConnectPostType.survey:
    case ConnectPostType.hrAnnouncement:
    case ConnectPostType.recommendation:
      return true;
    case ConnectPostType.birthday:
    case ConnectPostType.anniversary:
    case ConnectPostType.kudos:
    case ConnectPostType.award:
    case ConnectPostType.event:
    case ConnectPostType.newJoinee:
    case ConnectPostType.liveGame:
      return false;
  }
}

/// These types render a full-bleed tinted content block (see `_BirthdayBody`,
/// `_AwardBody`, `_AnniversaryBody`) rather than a boxed/inset card, so the
/// tint has to span the *whole* card — header strip through the footer —
/// or the top strip and footer read as a jarring plain-white band around a
/// colored middle. Everything else keeps the default white card.
Color? _celebrationCardTint(ConnectPostType type) {
  return switch (type) {
    ConnectPostType.award => _ConnectColors.goldTint,
    _ => null,
  };
}

/// Birthday and anniversary posts use this exact soft pink-to-lavender
/// diagonal gradient across the whole card per nodes 436:482 and 436:599 —
/// not a flat tint like the other celebration types.
const _celebrationGradient = LinearGradient(
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
  colors: [
    Color(0xFFFFFAFA),
    Color(0xFFF8FAFF),
    Color(0xFFF7F7FF),
    Color(0xFFF5F7FF),
    Color(0xFFF3F5FF),
    Color(0xFFF9F2FF),
    Color(0xFFF5F0FF),
  ],
  stops: [0.02, 0.18, 0.33, 0.5, 0.66, 0.82, 0.98],
);

Gradient? _celebrationCardGradient(ConnectPostType type) {
  return switch (type) {
    ConnectPostType.birthday ||
    ConnectPostType.anniversary => _celebrationGradient,
    _ => null,
  };
}

/// The pill shown for each post type, or null for types whose body renders its
/// own heading (celebrations, kudos, events…).
_TypeBadge? _typeBadgeFor(ConnectPostType type) => switch (type) {
  ConnectPostType.hrAnnouncement => const _TypeBadge(
    label: 'HR Notice',
    asset: 'assets/icons/post_type_announcement.png',
  ),
  ConnectPostType.survey => const _TypeBadge(
    label: 'Poll',
    asset: 'assets/icons/post_type_poll.png',
    iconWidth: 30,
    iconHeight: 20,
  ),
  ConnectPostType.recommendation => const _TypeBadge(
    label: 'Recommendation',
    asset: 'assets/icons/post_type_recommend.png',
  ),
  _ => null,
};

class _PostHeader extends StatelessWidget {
  const _PostHeader({
    required this.post,
    required this.canManage,
    required this.onEdit,
    required this.onDelete,
  });

  final ConnectPost post;
  final bool canManage;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final audienceLabel = post.audience.label;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 12, 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _InitialAvatar(
            initials: post.author.initials,
            color: _hexColor(post.author.avatarColor, _ConnectColors.terra),
            size: 48,
            photoUrl: post.author.photoUrl ?? '',
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(
                  spacing: 7,
                  runSpacing: 5,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text(
                      post.author.name,
                      style: const TextStyle(
                        color: _ConnectColors.ink,
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    if (audienceLabel.isNotEmpty)
                      _AudienceBadge(
                        label: audienceLabel,
                        color: _audienceBadgeColor(audienceLabel),
                      ),
                  ],
                ),
                const SizedBox(height: 3),
                Wrap(
                  spacing: 5,
                  runSpacing: 3,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text(post.author.designation),
                    const Text('·'),
                    Text(_timeAgo(post.publishedAt)),
                  ],
                ).withDefaultTextStyle(
                  const TextStyle(
                    color: _ConnectColors.faint,
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
          _PostMenuButton(
            canManage: canManage,
            onEdit: onEdit,
            onDelete: onDelete,
          ),
        ],
      ),
    );
  }
}

/// Maps a `ConnectAudience.label` to an accent color for `_AudienceBadge`.
/// Today the backend only ever sends "Company" or "Team" (see
/// connect.service.ts), but this also handles "Public"/"Priority" style
/// labels generically so it stays correct if more audiences are added.
Color _audienceBadgeColor(String label) {
  final normalized = label.toLowerCase();
  if (normalized.contains('team')) return _ConnectColors.inkSoft;
  if (normalized.contains('priority')) return _ConnectColors.teal;
  return _ConnectColors.blue;
}

class _AudienceBadge extends StatelessWidget {
  const _AudienceBadge({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(99),
        border: Border.all(color: color, width: 1),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

/// The pill above a post's content ("POLL", "HR NOTICE", …) — node 352:1500.
/// Takes either an exported asset or, for types without one yet, an emoji.
class _TypeBadge extends StatelessWidget {
  const _TypeBadge({
    required this.label,
    this.icon = '',
    this.asset,
    this.iconWidth = 20,
    this.iconHeight = 20,
  });

  final String label;
  final String icon;
  final String? asset;
  final double iconWidth;
  final double iconHeight;

  @override
  Widget build(BuildContext context) {
    final assetPath = asset;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 6),
      decoration: BoxDecoration(
        color: const Color(0xFFF7F7F9),
        border: Border.all(color: const Color(0xFFEBEBEB), width: 1.114),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (assetPath != null) ...[
            Image.asset(
              assetPath,
              width: iconWidth,
              height: iconHeight,
              fit: BoxFit.contain,
            ),
            const SizedBox(width: 10),
          ] else if (icon.isNotEmpty) ...[
            Text(icon, style: const TextStyle(fontSize: 12)),
            const SizedBox(width: 6),
          ],
          Text(
            label.toUpperCase(),
            style: const TextStyle(
              color: Color(0xFF484848),
              fontSize: 12,
              height: 18 / 12,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.3,
            ),
          ),
        ],
      ),
    );
  }
}

/// Shared edit/delete popup trigger used both by `_PostHeader` (for post
/// types that show the standard author header) and by `_BodyTopStrip` (for
/// system-generated post types that render their own compact header inside
/// the body widget).
class _PostMenuButton extends StatelessWidget {
  const _PostMenuButton({
    required this.canManage,
    required this.onEdit,
    required this.onDelete,
  });

  final bool canManage;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    if (!canManage) {
      return const Icon(Icons.more_vert_rounded, color: _ConnectColors.faint);
    }
    return PopupMenuButton<_PostMenuAction>(
      icon: const Icon(Icons.more_vert_rounded, color: _ConnectColors.faint),
      color: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      onSelected: (action) {
        switch (action) {
          case _PostMenuAction.edit:
            onEdit();
          case _PostMenuAction.delete:
            onDelete();
        }
      },
      itemBuilder: (context) => const [
        PopupMenuItem(
          value: _PostMenuAction.edit,
          child: Row(
            children: [
              Icon(Icons.edit_rounded, size: 18),
              SizedBox(width: 10),
              Text('Edit post'),
            ],
          ),
        ),
        PopupMenuItem(
          value: _PostMenuAction.delete,
          child: Row(
            children: [
              Icon(Icons.delete_outline_rounded, size: 18),
              SizedBox(width: 10),
              Text('Delete post'),
            ],
          ),
        ),
      ],
    );
  }
}

/// Compact replacement for `_PostHeader` used inside body widgets for
/// system-generated post types (birthday, anniversary, kudos, award, event,
/// new joinee, live game) — these have no human "author" to show, just a
/// category icon, a short label, a timestamp, and the manage menu.
class _BodyTopStrip extends StatelessWidget {
  const _BodyTopStrip({
    required this.icon,
    required this.iconBg,
    required this.label,
    required this.timestamp,
    required this.canManage,
    required this.onEdit,
    required this.onDelete,
  });

  final String icon;
  final Color iconBg;
  final String label;
  final String timestamp;
  final bool canManage;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 12, 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            width: 44,
            height: 44,
            alignment: Alignment.center,
            decoration: BoxDecoration(color: iconBg, shape: BoxShape.circle),
            child: Text(icon, style: const TextStyle(fontSize: 20)),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    color: _ConnectColors.ink,
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  timestamp,
                  style: const TextStyle(
                    color: _ConnectColors.faint,
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
          _PostMenuButton(
            canManage: canManage,
            onEdit: onEdit,
            onDelete: onDelete,
          ),
        ],
      ),
    );
  }
}

enum _PostMenuAction { edit, delete }

class _PostBody extends StatelessWidget {
  const _PostBody({
    required this.post,
    required this.onAction,
    required this.onPlayGame,
    required this.canManage,
    required this.onEdit,
    required this.onDelete,
    required this.onCommentPrefill,
    this.onOpenPerson,
  });

  final ConnectPost post;
  final Future<void> Function({String? optionId}) onAction;
  final VoidCallback onPlayGame;
  final bool canManage;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final ValueChanged<String> onCommentPrefill;

  /// Opens a tagged person's profile. Null where the host can't navigate.
  final ValueChanged<String>? onOpenPerson;

  @override
  Widget build(BuildContext context) {
    return switch (post.type) {
      ConnectPostType.leadership => _MediaPostBody(post: post),
      ConnectPostType.recommendation => _RecommendationBody(post: post),
      ConnectPostType.newPost => _TextPostBody(
        post: post,
        onOpenPerson: onOpenPerson,
      ),
      ConnectPostType.hrAnnouncement => _AnnouncementBody(post: post),
      ConnectPostType.birthday => _BirthdayBody(
        post: post,
        onAction: onAction,
        canManage: canManage,
        onEdit: onEdit,
        onDelete: onDelete,
        onCommentPrefill: onCommentPrefill,
      ),
      ConnectPostType.anniversary => _AnniversaryBody(
        post: post,
        onAction: onAction,
        canManage: canManage,
        onEdit: onEdit,
        onDelete: onDelete,
        onCommentPrefill: onCommentPrefill,
      ),
      ConnectPostType.kudos => _KudosBody(
        post: post,
        canManage: canManage,
        onEdit: onEdit,
        onDelete: onDelete,
      ),
      ConnectPostType.award => _AwardBody(
        post: post,
        canManage: canManage,
        onEdit: onEdit,
        onDelete: onDelete,
      ),
      ConnectPostType.survey => _SurveyBody(post: post, onAction: onAction),
      ConnectPostType.event => _EventBody(
        post: post,
        onAction: onAction,
        canManage: canManage,
        onEdit: onEdit,
        onDelete: onDelete,
      ),
      ConnectPostType.liveGame => _LiveGameBody(
        post: post,
        onPlayGame: onPlayGame,
        canManage: canManage,
        onEdit: onEdit,
        onDelete: onDelete,
      ),
      ConnectPostType.newJoinee => _NewJoineeBody(
        post: post,
        onAction: onAction,
        canManage: canManage,
        onEdit: onEdit,
        onDelete: onDelete,
      ),
    };
  }
}

class _MediaPostBody extends StatelessWidget {
  const _MediaPostBody({required this.post});

  final ConnectPost post;

  @override
  Widget build(BuildContext context) {
    final mediaKind = _bodyString(post, 'mediaKind');
    final hasMedia = mediaKind == 'image' || mediaKind == 'video';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _BodyText(text: _bodyString(post, 'text')),
        if (hasMedia) _MediaPreview(post: post),
      ],
    );
  }
}

/// Horizontal link-preview card for "Must Watch/Read" recommendation posts.
/// Unlike `_MediaPostBody` (which is text-then-media), this renders the
/// media preview first and the post's own commentary below it.
class _RecommendationBody extends StatelessWidget {
  const _RecommendationBody({required this.post});

  final ConnectPost post;

  @override
  Widget build(BuildContext context) {
    // The thumbnail comes from the link's own preview metadata, resolved
    // server-side — authors never attach one. `mediaUrl` is only a fallback
    // for older posts created while the picker still existed.
    final linkImageUrl = _bodyString(post, 'linkImageUrl');
    final mediaUrl = linkImageUrl.isNotEmpty
        ? linkImageUrl
        : _bodyString(post, 'mediaUrl');
    final hasThumb = mediaUrl.isNotEmpty;
    // Prefer an explicit byline if one's ever set; otherwise fall back to
    // the link's domain, which the composer always captures — so a
    // recommendation with a link but no separate byline still shows where
    // it came from instead of a blank line.
    final byline = _bodyString(post, 'mediaByline').isNotEmpty
        ? _bodyString(post, 'mediaByline')
        : (_bodyString(post, 'sourceByline').isNotEmpty
              ? _bodyString(post, 'sourceByline')
              : _bodyString(post, 'linkDomain'));
    // The whole preview is the link's affordance — tapping anywhere on it
    // opens the recommended page.
    final linkUrl = _bodyString(post, 'linkUrl');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          child: _LinkTapTarget(
            url: linkUrl,
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFFF7F7F9),
                border: Border.all(color: const Color(0xFFEBEBEB)),
                borderRadius: BorderRadius.circular(16),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: SizedBox(
                      width: 80,
                      height: 80,
                      child: hasThumb
                          ? Stack(
                              fit: StackFit.expand,
                              children: [
                                Image(
                                  image: _remoteImage(mediaUrl),
                                  fit: BoxFit.cover,
                                ),
                                DecoratedBox(
                                  decoration: BoxDecoration(
                                    color: Colors.black.withValues(alpha: 0.28),
                                  ),
                                ),
                                const Center(
                                  child: Icon(
                                    Icons.play_circle_fill_rounded,
                                    color: Colors.white,
                                    size: 30,
                                  ),
                                ),
                              ],
                            )
                          : Container(color: _ConnectColors.sand),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _bodyString(post, 'mediaTitle'),
                          style: const TextStyle(
                            color: _ConnectColors.ink,
                            fontSize: 14,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        if (byline.isNotEmpty) ...[
                          const SizedBox(height: 4),
                          Text(
                            byline,
                            style: const TextStyle(
                              color: _ConnectColors.faint,
                              fontSize: 12,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        _BodyText(text: _bodyString(post, 'text')),
      ],
    );
  }
}

/// Wraps a widget so tapping it opens [url]. A blank or unusable URL leaves
/// the child inert rather than showing a dead tap target.
class _LinkTapTarget extends StatelessWidget {
  const _LinkTapTarget({required this.url, required this.child});

  final String url;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (url.trim().isEmpty) return child;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () async {
          final opened = await openExternalLink(url);
          if (!opened && context.mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text("Couldn't open $url"),
                behavior: SnackBarBehavior.floating,
              ),
            );
          }
        },
        child: child,
      ),
    );
  }
}

class _TextPostBody extends StatelessWidget {
  const _TextPostBody({required this.post, this.onOpenPerson});

  final ConnectPost post;
  final ValueChanged<String>? onOpenPerson;

  @override
  Widget build(BuildContext context) {
    final mediaKind = _bodyString(post, 'mediaKind');
    final hasMedia = mediaKind == 'image' || mediaKind == 'video';
    final tagged = _taggedPeople(post);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _BodyText(text: _bodyString(post, 'text')),
        if (tagged.isNotEmpty)
          _TaggedPeopleRow(people: tagged, onOpenPerson: onOpenPerson),
        if (hasMedia) _MediaPreview(post: post),
      ],
    );
  }
}

/// "with @Ananya Rao, @Priya Nair" under a media post. Each name opens that
/// person's profile.
class _TaggedPeopleRow extends StatelessWidget {
  const _TaggedPeopleRow({required this.people, this.onOpenPerson});

  final List<ConnectTaggedPerson> people;
  final ValueChanged<String>? onOpenPerson;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          const Text(
            'with',
            style: TextStyle(
              color: _ConnectColors.faint,
              fontSize: 13,
              fontWeight: FontWeight.w500,
            ),
          ),
          ...people.map(
            (person) => _TaggedPersonChip(
              person: person,
              onTap: onOpenPerson == null
                  ? null
                  : () => onOpenPerson!(person.userId),
            ),
          ),
        ],
      ),
    );
  }
}

class _TaggedPersonChip extends StatelessWidget {
  const _TaggedPersonChip({required this.person, this.onTap});

  final ConnectTaggedPerson person;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final photo = person.photoUrl;
    return Material(
      color: const Color(0xFFEAF4FA),
      borderRadius: BorderRadius.circular(99),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(99),
        child: Padding(
          padding: EdgeInsets.fromLTRB(photo == null ? 10 : 4, 4, 10, 4),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (photo != null) ...[
                ClipOval(
                  child: Image(
                    image: _remoteImage(photo),
                    width: 20,
                    height: 20,
                    fit: BoxFit.cover,
                  ),
                ),
                const SizedBox(width: 6),
              ],
              Text(
                person.name,
                style: const TextStyle(
                  color: Color(0xFF0571A6),
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MediaPreview extends StatelessWidget {
  const _MediaPreview({required this.post});

  final ConnectPost post;

  @override
  Widget build(BuildContext context) {
    final mediaKind = _bodyString(post, 'mediaKind');
    final mediaUrl = _bodyString(post, 'mediaUrl');
    final mediaUrls = _bodyStringList(post, 'mediaUrls');
    if (mediaKind == 'image' && mediaUrls.length > 1) {
      return _MediaGallery(urls: mediaUrls);
    }
    final isImage = mediaKind == 'image' && mediaUrl.isNotEmpty;
    // A photo keeps its own shape. Everything else — video posters, the
    // gradient placeholder — stays on the fixed frame it was designed for.
    if (isImage) {
      return _AdaptiveImage(url: mediaUrl);
    }
    return Container(
      height: 200,
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      decoration: const BoxDecoration(color: _ConnectColors.sand),
      child: Stack(
        children: [
          if (!isImage)
            Positioned.fill(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [
                      _ConnectColors.sand,
                      _ConnectColors.bg,
                      _ConnectColors.sand.withValues(alpha: 0.82),
                    ],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                ),
              ),
            ),
          if (mediaKind == 'video')
            Center(
              child: Container(
                width: 56,
                height: 56,
                decoration: const BoxDecoration(
                  color: Colors.white,
                  shape: BoxShape.circle,
                  boxShadow: [
                    BoxShadow(
                      color: Color(0x33000000),
                      blurRadius: 20,
                      offset: Offset(0, 8),
                    ),
                  ],
                ),
                child: const Icon(Icons.play_arrow_rounded, size: 34),
              ),
            ),
          // The media title is the uploaded file's name, which is worth showing
          // over a video poster and never over a photo.
          if (mediaKind == 'video' && _bodyString(post, 'mediaTitle').isNotEmpty)
            Positioned(
              left: 12,
              top: 12,
              child: _DarkChip(label: _bodyString(post, 'mediaTitle')),
            ),
          if (_bodyString(post, 'mediaDuration').isNotEmpty)
            Positioned(
              right: 12,
              bottom: 12,
              child: _DarkChip(label: _bodyString(post, 'mediaDuration')),
            ),
        ],
      ),
    );
  }
}

/// A photo is shown at the shape it was uploaded at. The crop step is where an
/// author decides the framing, so second-guessing it here would only undo that
/// choice — the one bound left is a sanity clamp for a degenerate file.
const double _minAspect = 0.2;
const double _maxAspect = 5.0;

/// Resolves an image to learn its shape, then frames it at that aspect ratio.
///
/// The feed used to draw every photo into a fixed 200px landscape box with
/// `BoxFit.cover`, so a portrait shot had its top and bottom cut off. Nothing
/// tells us the dimensions up front, so they are read off the decoded image and
/// the frame settles once they arrive.
class _AspectFrame extends StatefulWidget {
  const _AspectFrame({required this.provider, required this.child});

  /// Local file or remote URL — the frame only needs something it can decode.
  final ImageProvider provider;
  final Widget child;

  @override
  State<_AspectFrame> createState() => _AspectFrameState();
}

class _AspectFrameState extends State<_AspectFrame> {
  double? _aspect;
  ImageStream? _stream;
  ImageStreamListener? _listener;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _resolve();
  }

  @override
  void didUpdateWidget(_AspectFrame old) {
    super.didUpdateWidget(old);
    if (old.provider != widget.provider) {
      _aspect = null;
      _resolve();
    }
  }

  void _resolve() {
    _detach();
    final stream = widget.provider.resolve(createLocalImageConfiguration(context));
    final listener = ImageStreamListener((info, _) {
      if (!mounted) return;
      final ratio = info.image.width / info.image.height;
      setState(() => _aspect = ratio.clamp(_minAspect, _maxAspect));
    }, onError: (error, stack) {
      if (mounted) setState(() => _aspect = 16 / 9);
    });
    _stream = stream;
    _listener = listener;
    stream.addListener(listener);
  }

  void _detach() {
    if (_stream != null && _listener != null) _stream!.removeListener(_listener!);
    _stream = null;
    _listener = null;
  }

  @override
  void dispose() {
    _detach();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Before the size is known the card holds the old fixed height, so the
    // feed does not jump as images resolve above the fold.
    if (_aspect == null) {
      return Container(height: 200, color: _ConnectColors.sand, child: widget.child);
    }
    return AspectRatio(
      aspectRatio: _aspect!,
      child: Container(
        clipBehavior: Clip.antiAlias,
        decoration: const BoxDecoration(color: _ConnectColors.sand),
        child: widget.child,
      ),
    );
  }
}

/// One photo at its own shape, filling the frame it just sized.
class _AdaptiveImage extends StatelessWidget {
  const _AdaptiveImage({required this.url});

  final String url;

  @override
  Widget build(BuildContext context) {
    return _AspectFrame(
      provider: _remoteImage(url),
      child: Image(
        image: _remoteImage(url),
        fit: BoxFit.cover,
        width: double.infinity,
        height: double.infinity,
      ),
    );
  }
}

/// One picked file, previewed at the shape it was cropped to. Video keeps the
/// fixed frame — there is no still to take a shape from.
class _LocalMediaPreview extends StatelessWidget {
  const _LocalMediaPreview({required this.attachment});

  final ConnectMediaAttachment attachment;

  @override
  Widget build(BuildContext context) {
    if (!attachment.mimeType.startsWith('image/')) {
      return SizedBox(
        height: 200,
        width: double.infinity,
        child: _LocalMediaThumb(attachment: attachment),
      );
    }
    return _AspectFrame(
      provider: FileImage(File(attachment.path)),
      child: _LocalMediaThumb(attachment: attachment),
    );
  }
}

/// A multi-image post's feed-card display — a swipeable gallery with a page
/// dot indicator, matching the single-image `_MediaPreview` frame.
class _MediaGallery extends StatefulWidget {
  const _MediaGallery({required this.urls});

  final List<String> urls;

  @override
  State<_MediaGallery> createState() => _MediaGalleryState();
}

class _MediaGalleryState extends State<_MediaGallery> {
  final _controller = PageController();
  int _page = 0;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return _AspectFrame(
      provider: _remoteImage(widget.urls.first),
      child: Stack(
        children: [
          Positioned.fill(
            child: PageView.builder(
              controller: _controller,
              itemCount: widget.urls.length,
              onPageChanged: (index) => setState(() => _page = index),
              // Contain, not cover: the frame already matches the first image,
              // and a set can mix shapes. Cropping the odd one out is worse
              // than letting it sit inside the frame whole.
              itemBuilder: (context, index) => Image(
                image: _remoteImage(widget.urls[index]),
                fit: BoxFit.contain,
                width: double.infinity,
              ),
            ),
          ),
          Positioned(
            right: 12,
            top: 12,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
              decoration: BoxDecoration(
                color: const Color(0x99000000),
                borderRadius: BorderRadius.circular(99),
              ),
              child: Text(
                '${_page + 1}/${widget.urls.length}',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
          Positioned(
            bottom: 10,
            left: 0,
            right: 0,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (final (index, _) in widget.urls.indexed)
                  Container(
                    width: index == _page ? 16 : 6,
                    height: 6,
                    margin: const EdgeInsets.symmetric(horizontal: 2),
                    decoration: BoxDecoration(
                      color: index == _page
                          ? Colors.white
                          : const Color(0x99FFFFFF),
                      borderRadius: BorderRadius.circular(99),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _AnnouncementBody extends StatelessWidget {
  const _AnnouncementBody({required this.post});

  final ConnectPost post;

  @override
  Widget build(BuildContext context) {
    final title = _bodyString(post, 'title');
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (title.isNotEmpty) ...[
            Text(
              title,
              style: const TextStyle(
                color: Color(0xFF222222),
                fontSize: 18,
                height: 24 / 18,
                letterSpacing: -0.16,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
          ],
          LinkifiedText(
            _bodyString(post, 'text'),
            style: const TextStyle(
              color: Color(0xFF484848),
              fontSize: 15,
              height: 22 / 15,
              fontWeight: FontWeight.w400,
            ),
          ),
        ],
      ),
    );
  }
}

/// Both celebration action buttons (Wish / Congratulations) share this:
/// tapping fires the backend action, plays the exact celebration GIF Figma
/// uses for that post's "already celebrated" state (nodes 353:1601 for
/// birthday, 356:3313 for anniversary — real animated GIF fills, extracted
/// via Figma's asset export, not a generic particle-effect package), and
/// drops a suggested message into the comment box below — left for the
/// user to review/edit and send themselves, never auto-posted.
class _CelebrationGifOverlay extends StatelessWidget {
  const _CelebrationGifOverlay({
    required this.visible,
    required this.assetPath,
    required this.size,
  });

  final bool visible;
  final String assetPath;
  final double size;

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: AnimatedOpacity(
        opacity: visible ? 1 : 0,
        duration: const Duration(milliseconds: 200),
        child: Container(
          alignment: Alignment.center,
          color: visible ? const Color(0x36AEAEAE) : Colors.transparent,
          child: Image.asset(assetPath, width: size, height: size),
        ),
      ),
    );
  }
}

class _BirthdayBody extends StatefulWidget {
  const _BirthdayBody({
    required this.post,
    required this.onAction,
    required this.canManage,
    required this.onEdit,
    required this.onDelete,
    required this.onCommentPrefill,
  });

  final ConnectPost post;
  final Future<void> Function({String? optionId}) onAction;
  final bool canManage;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final ValueChanged<String> onCommentPrefill;

  @override
  State<_BirthdayBody> createState() => _BirthdayBodyState();
}

class _BirthdayBodyState extends State<_BirthdayBody> {
  bool _celebrating = false;
  Timer? _hideTimer;

  @override
  void dispose() {
    _hideTimer?.cancel();
    super.dispose();
  }

  Future<void> _wish() async {
    await widget.onAction();
    if (!mounted) return;
    setState(() => _celebrating = true);
    _hideTimer?.cancel();
    _hideTimer = Timer(const Duration(seconds: 3), () {
      if (mounted) setState(() => _celebrating = false);
    });
    final firstName = _bodyString(widget.post, 'personName').split(' ').first;
    widget.onCommentPrefill(
      'Happy Birthday, $firstName! 🎂 Hope you have an amazing day!',
    );
  }

  @override
  Widget build(BuildContext context) {
    final post = widget.post;
    final done = post.actionValue != null;
    return Stack(
      clipBehavior: Clip.none,
      children: [
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _BodyTopStrip(
              icon: post.tagIcon,
              iconBg: const Color(0xFFF7F7F9),
              label: 'Celebration',
              timestamp: _timeAgo(post.publishedAt),
              canManage: widget.canManage,
              onEdit: widget.onEdit,
              onDelete: widget.onDelete,
            ),
            Container(
              padding: const EdgeInsets.fromLTRB(16, 22, 16, 20),
              child: Column(
                children: [
                  Container(
                    padding: const EdgeInsets.all(2.2),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      shape: BoxShape.circle,
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: .1),
                          blurRadius: 6,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: _InitialAvatar(
                      initials: _bodyString(post, 'personInitials'),
                      color: _ConnectColors.gold,
                      size: 80,
                      photoUrl: _bodyString(post, 'photoUrl'),
                    ),
                  ),
                  const SizedBox(height: 14),
                  Text(
                    'Happy Birthday, ${_bodyString(post, 'personName')}!',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: _ConnectColors.ink,
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _bodyString(post, 'subtitle'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: _ConnectColors.inkSoft,
                      fontSize: 13.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  if (!done) ...[
                    const SizedBox(height: 16),
                    _ActionButton(
                      label:
                          '🎂 Wish ${_bodyString(post, 'personName').split(' ').first}',
                      onTap: _wish,
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
        Positioned.fill(
          child: _CelebrationGifOverlay(
            visible: _celebrating,
            assetPath: 'assets/icons/birthday_celebration.gif',
            size: 200,
          ),
        ),
      ],
    );
  }
}

class _AnniversaryBody extends StatefulWidget {
  const _AnniversaryBody({
    required this.post,
    required this.onAction,
    required this.canManage,
    required this.onEdit,
    required this.onDelete,
    required this.onCommentPrefill,
  });

  final ConnectPost post;
  final Future<void> Function({String? optionId}) onAction;
  final bool canManage;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final ValueChanged<String> onCommentPrefill;

  @override
  State<_AnniversaryBody> createState() => _AnniversaryBodyState();
}

class _AnniversaryBodyState extends State<_AnniversaryBody> {
  bool _celebrating = false;
  Timer? _hideTimer;

  @override
  void dispose() {
    _hideTimer?.cancel();
    super.dispose();
  }

  Future<void> _congratulate(int years) async {
    await widget.onAction();
    if (!mounted) return;
    setState(() => _celebrating = true);
    _hideTimer?.cancel();
    _hideTimer = Timer(const Duration(seconds: 3), () {
      if (mounted) setState(() => _celebrating = false);
    });
    final firstName = _bodyString(widget.post, 'personName').split(' ').first;
    final yearWord = years == 1 ? 'year' : 'years';
    widget.onCommentPrefill(
      'Congratulations on $years $yearWord with Sowaka, $firstName! 🎉',
    );
  }

  @override
  Widget build(BuildContext context) {
    final post = widget.post;
    final years = (post.body['years'] as num?)?.toInt() ?? 1;
    final done = post.actionValue != null;
    final actionLabel = _bodyString(post, 'actionLabel');
    return Stack(
      clipBehavior: Clip.none,
      children: [
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _BodyTopStrip(
              icon: post.tagIcon,
              iconBg: Colors.white,
              label: 'Celebration',
              timestamp: _timeAgo(post.publishedAt),
              canManage: widget.canManage,
              onEdit: widget.onEdit,
              onDelete: widget.onDelete,
            ),
            Container(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
              child: Column(
                children: [
                  Stack(
                    clipBehavior: Clip.none,
                    children: [
                      Container(
                        padding: const EdgeInsets.all(3),
                        decoration: const BoxDecoration(
                          color: Colors.white,
                          shape: BoxShape.circle,
                        ),
                        child: _InitialAvatar(
                          initials: _bodyString(post, 'personInitials'),
                          color: _ConnectColors.plum,
                          size: 80,
                          photoUrl: _bodyString(post, 'photoUrl'),
                        ),
                      ),
                      Positioned(
                        right: -4,
                        bottom: -4,
                        child: Container(
                          width: 32,
                          height: 32,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: _ConnectColors.sage,
                            shape: BoxShape.circle,
                            border: Border.all(color: Colors.white, width: 2.5),
                          ),
                          child: Text(
                            '${years}y',
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 11,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  Text(
                    '${_bodyString(post, 'personName')} has been with Sowaka for $years years!',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: _ConnectColors.ink,
                      fontSize: 17,
                      height: 1.25,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    _bodyString(post, 'subtitle'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: _ConnectColors.inkSoft,
                      fontSize: 12.5,
                    ),
                  ),
                  const SizedBox(height: 16),
                  _ActionButton(
                    label: done
                        ? _bodyString(post, 'actionDoneLabel')
                        : (actionLabel.isEmpty
                              ? '🎉 Congratulations'
                              : actionLabel),
                    icon: done
                        ? Icons.check_rounded
                        : Icons.celebration_rounded,
                    onTap: () => _congratulate(years),
                  ),
                ],
              ),
            ),
          ],
        ),
        Positioned.fill(
          child: _CelebrationGifOverlay(
            visible: _celebrating,
            assetPath: 'assets/icons/anniversary_celebration.gif',
            size: 200,
          ),
        ),
      ],
    );
  }
}

class _KudosBody extends StatelessWidget {
  const _KudosBody({
    required this.post,
    required this.canManage,
    required this.onEdit,
    required this.onDelete,
  });

  final ConnectPost post;
  final bool canManage;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _BodyTopStrip(
          icon: post.tagIcon,
          iconBg: const Color(0xFFF5F3FF),
          label: post.tag,
          timestamp: _timeAgo(post.publishedAt),
          canManage: canManage,
          onEdit: onEdit,
          onDelete: onDelete,
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0xFFF5F3FF),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: const Color(0xFFD2CEFF)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        children: [
                          _InitialAvatar(
                            initials: post.author.initials,
                            color: _hexColor(
                              post.author.avatarColor,
                              _ConnectColors.terra,
                            ),
                            size: 56,
                            photoUrl: post.author.photoUrl ?? '',
                          ),
                          const SizedBox(height: 6),
                          Text(
                            post.author.name,
                            textAlign: TextAlign.center,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: _ConnectColors.ink,
                              fontSize: 12.5,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const Padding(
                      padding: EdgeInsets.only(top: 16),
                      child: Icon(
                        Icons.emoji_events_rounded,
                        color: _ConnectColors.plum,
                        size: 22,
                      ),
                    ),
                    Expanded(
                      child: Column(
                        children: [
                          _InitialAvatar(
                            initials: _bodyString(post, 'personInitials'),
                            color: _ConnectColors.teal,
                            size: 56,
                          ),
                          const SizedBox(height: 6),
                          Text(
                            _bodyString(post, 'personName'),
                            textAlign: TextAlign.center,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: _ConnectColors.ink,
                              fontSize: 12.5,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: const Color(0xFFD2CEFF)),
                  ),
                  child: Text(
                    _bodyString(post, 'text'),
                    style: const TextStyle(
                      color: _ConnectColors.inkSoft,
                      fontSize: 13.5,
                      height: 1.5,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _AwardBody extends StatelessWidget {
  const _AwardBody({
    required this.post,
    required this.canManage,
    required this.onEdit,
    required this.onDelete,
  });

  final ConnectPost post;
  final bool canManage;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final personName = _bodyString(post, 'personName');
    final rawInitials = _bodyString(post, 'personInitials');
    final initials = rawInitials.isNotEmpty
        ? rawInitials
        : _initials(personName);
    // `nominatedBy`/`nominator` never appear in the award body schema —
    // connect.service.ts's normalizePostBody has no dedicated `award` case
    // (it falls through to a raw pass-through) and the composer has no UI
    // for creating award posts at all (award is system/seed-generated only,
    // and the seed data only ever sets personName/title/reason). So there is
    // intentionally no "Nominated by" line here — see final report.
    final department = _bodyString(post, 'department');
    final month = _bodyString(post, 'month');
    final departmentLine = [
      department,
      month,
    ].where((value) => value.isNotEmpty).join(' · ');
    final nominatedBy = _bodyString(post, 'nominatedBy');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 12, 8),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 7,
                ),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(99),
                  border: Border.all(color: const Color(0xFFE9D7B8)),
                ),
                child: const Text(
                  '🏆 AWARD',
                  style: TextStyle(
                    color: _ConnectColors.inkSoft,
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.3,
                  ),
                ),
              ),
              const Spacer(),
              _PostMenuButton(
                canManage: canManage,
                onEdit: onEdit,
                onDelete: onDelete,
              ),
            ],
          ),
        ),
        Container(
          margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            color: _ConnectColors.goldTint,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: const Color(0xFFE9D7B8)),
          ),
          child: Column(
            children: [
              Stack(
                clipBehavior: Clip.none,
                children: [
                  Container(
                    padding: const EdgeInsets.all(4),
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: const Color(0xFFFFD700),
                        width: 3,
                      ),
                    ),
                    child: _InitialAvatar(
                      initials: initials,
                      color: _ConnectColors.gold,
                      size: 88,
                      photoUrl: _bodyString(post, 'photoUrl'),
                    ),
                  ),
                  Positioned(
                    right: -2,
                    bottom: -2,
                    child: Container(
                      width: 28,
                      height: 28,
                      alignment: Alignment.center,
                      decoration: const BoxDecoration(
                        color: Color(0xFFFFD700),
                        shape: BoxShape.circle,
                        border: Border.fromBorderSide(
                          BorderSide(color: Colors.white, width: 2),
                        ),
                      ),
                      child: const Icon(
                        Icons.emoji_events_rounded,
                        size: 16,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                _bodyString(post, 'title'),
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: _ConnectColors.ink,
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                personName,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: _ConnectColors.ink,
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                ),
              ),
              if (departmentLine.isNotEmpty) ...[
                const SizedBox(height: 2),
                Text(
                  departmentLine,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: _ConnectColors.faint,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
              if (nominatedBy.isNotEmpty) ...[
                const SizedBox(height: 12),
                RichText(
                  textAlign: TextAlign.center,
                  text: TextSpan(
                    style: const TextStyle(
                      color: _ConnectColors.faint,
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                    ),
                    children: [
                      const TextSpan(text: 'Nominated by '),
                      TextSpan(
                        text: nominatedBy,
                        style: const TextStyle(
                          color: _ConnectColors.ink,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 10),
              Text(
                _bodyString(post, 'reason'),
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: _ConnectColors.inkSoft,
                  fontSize: 13.5,
                  height: 1.45,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _SurveyBody extends StatelessWidget {
  const _SurveyBody({required this.post, required this.onAction});

  final ConnectPost post;
  final Future<void> Function({String? optionId}) onAction;

  @override
  Widget build(BuildContext context) {
    final total = post.totalVotes == 0 ? 1 : post.totalVotes;
    final hasVoted = post.selectedPollOptionId != null;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            _bodyString(post, 'title'),
            style: const TextStyle(
              color: Color(0xFF222222),
              fontSize: 20,
              height: 24 / 20,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.4,
            ),
          ),
          const SizedBox(height: 16),
          ...post.pollOptions.map((option) {
            final selected = post.selectedPollOptionId == option.id;
            final pct = ((option.votes / total) * 100).round();
            final hasImage = (option.imageUrl ?? '').isNotEmpty;
            return Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap: () => onAction(optionId: option.id),
                child: Container(
                  height: 48,
                  clipBehavior: Clip.antiAlias,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: selected && hasVoted
                          ? const Color(0xF7CCFCFF)
                          : const Color(0xFFEBEBEB),
                      width: 1.114,
                    ),
                  ),
                  child: Stack(
                    children: [
                      // The result bar fills proportionally to the share of
                      // votes rather than washing the whole row in colour.
                      if (hasVoted)
                        Positioned.fill(
                          child: FractionallySizedBox(
                            alignment: Alignment.centerLeft,
                            widthFactor: (pct / 100).clamp(0.0, 1.0),
                            child: ColoredBox(
                              color: selected
                                  ? const Color(0xF7CCFCFF)
                                  : const Color(0xFFEBEBEB),
                            ),
                          ),
                        ),
                      Padding(
                        padding: EdgeInsets.symmetric(
                          horizontal: hasImage ? 8 : 16,
                        ),
                        child: Row(
                          children: [
                            if (hasImage) ...[
                              ClipRRect(
                                borderRadius: BorderRadius.circular(8),
                                child: Image(
                                  image: _remoteImage(option.imageUrl!),
                                  width: 32,
                                  height: 32,
                                  fit: BoxFit.cover,
                                ),
                              ),
                              const SizedBox(width: 10),
                            ],
                            Expanded(
                              child: Text(
                                option.label,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: hasVoted && selected
                                      ? const Color(0xFF0571A6)
                                      : const Color(0xFF484848),
                                  fontSize: 15,
                                  height: 22.5 / 15,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                            if (hasVoted)
                              Text(
                                '$pct%',
                                style: TextStyle(
                                  color: selected
                                      ? const Color(0xFF0571A6)
                                      : const Color(0xFF484848),
                                  fontSize: 16,
                                  height: 24 / 16,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            );
          }),
          const SizedBox(height: 4),
          Text(
            '${post.totalVotes} total votes',
            style: const TextStyle(
              color: Color(0xFF9197A2),
              fontSize: 14,
              height: 21 / 14,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}

class _EventBody extends StatelessWidget {
  const _EventBody({
    required this.post,
    required this.onAction,
    required this.canManage,
    required this.onEdit,
    required this.onDelete,
  });

  final ConnectPost post;
  final Future<void> Function({String? optionId}) onAction;
  final bool canManage;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final done = post.actionValue != null;
    final mediaUrl = _bodyString(post, 'mediaUrl');
    final hasImage =
        mediaUrl.isNotEmpty && _bodyString(post, 'mediaKind') == 'image';
    // `allowRegistration` is a real bool set by the backend (see
    // connect.service.ts normalizePostBody's 'event' case), not a string.
    final allowRegistration = post.body['allowRegistration'] as bool? ?? true;
    // `registeredCount` never appears in the event body schema today — seed
    // events instead carry `baseCount`/`countLabel`, and composer-created
    // events carry neither. Per spec, check the literal `registeredCount`
    // key and fall back to an em dash rather than fabricating a number from
    // the differently-named seed fields — see final report.
    final registeredRaw = post.body['registeredCount'];
    final registeredLabel = registeredRaw == null
        ? '—'
        : registeredRaw.toString();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _BodyTopStrip(
          icon: post.tagIcon,
          iconBg: _ConnectColors.terraTint,
          label: post.tag,
          timestamp: _timeAgo(post.publishedAt),
          canManage: canManage,
          onEdit: onEdit,
          onDelete: onDelete,
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(18),
                child: SizedBox(
                  height: 143,
                  child: hasImage
                      ? Stack(
                          fit: StackFit.expand,
                          children: [
                            Image(
                              image: _remoteImage(mediaUrl),
                              fit: BoxFit.cover,
                            ),
                            DecoratedBox(
                              decoration: BoxDecoration(
                                gradient: LinearGradient(
                                  begin: Alignment.topCenter,
                                  end: Alignment.bottomCenter,
                                  colors: [
                                    Colors.transparent,
                                    Colors.black.withValues(alpha: 0.68),
                                  ],
                                ),
                              ),
                            ),
                            Positioned(
                              left: 14,
                              right: 14,
                              bottom: 12,
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Text(
                                    _bodyString(post, 'title'),
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 16,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                  if (_bodyString(post, 'location').isNotEmpty)
                                    Text(
                                      _bodyString(post, 'location'),
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontSize: 12.5,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                ],
                              ),
                            ),
                          ],
                        )
                      : Container(
                          color: _ConnectColors.terraTint,
                          alignment: Alignment.center,
                          padding: const EdgeInsets.symmetric(horizontal: 16),
                          child: Text(
                            _bodyString(post, 'title'),
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              color: _ConnectColors.ink,
                              fontSize: 17,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                ),
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: _EventStat(
                      value: _bodyString(post, 'date'),
                      label: 'Date',
                    ),
                  ),
                  Container(
                    width: 1,
                    height: 34,
                    color: const Color(0xFFEBEBEB),
                  ),
                  Expanded(
                    child: _EventStat(
                      value: _bodyString(post, 'time'),
                      label: 'Time',
                    ),
                  ),
                  Container(
                    width: 1,
                    height: 34,
                    color: const Color(0xFFEBEBEB),
                  ),
                  Expanded(
                    child: _EventStat(
                      value: registeredLabel,
                      label: 'Registered',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              if (!allowRegistration)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: const Color(0xFF96B7C7),
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: const Text(
                    'Registration Closed',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                )
              else
                _ActionButton(
                  label: done
                      ? _bodyString(post, 'actionDoneLabel')
                      : _bodyString(post, 'actionLabel'),
                  icon: done
                      ? Icons.check_rounded
                      : Icons.confirmation_number_rounded,
                  onTap: () => onAction(),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _EventStat extends StatelessWidget {
  const _EventStat({required this.value, required this.label});

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          value.isEmpty ? '—' : value,
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: _ConnectColors.ink,
            fontSize: 18,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 3),
        Text(
          label,
          style: const TextStyle(
            color: _ConnectColors.faint,
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}

class _LiveGameBody extends StatelessWidget {
  const _LiveGameBody({
    required this.post,
    required this.onPlayGame,
    required this.canManage,
    required this.onEdit,
    required this.onDelete,
  });

  final ConnectPost post;
  final VoidCallback onPlayGame;
  final bool canManage;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final done = post.actionValue != null;
    final leaders = (post.body['leaderboard'] as List<dynamic>? ?? const [])
        .map((entry) => Map<String, dynamic>.from(entry as Map))
        .toList();
    return Column(
      children: [
        _BodyTopStrip(
          icon: post.tagIcon,
          iconBg: _ConnectColors.sand,
          label: post.tag,
          timestamp: _timeAgo(post.publishedAt),
          canManage: canManage,
          onEdit: onEdit,
          onDelete: onDelete,
        ),
        _ActionPanel(
          icon: Icons.sports_esports_rounded,
          iconColor: _ConnectColors.live,
          title: _bodyString(post, 'title'),
          subtitle:
              '${_bodyString(post, 'subtitle')}\n${_bodyString(post, 'startsAtLabel')}',
          buttonLabel: done
              ? _bodyString(post, 'actionDoneLabel')
              : _bodyString(post, 'actionLabel'),
          onTap: onPlayGame,
        ),
        if (leaders.isNotEmpty)
          Container(
            margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            padding: const EdgeInsets.all(13),
            decoration: BoxDecoration(
              color: _ConnectColors.sand,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text(
                  '🏆 LEADERBOARD',
                  style: TextStyle(
                    color: _ConnectColors.inkSoft,
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 7),
                ...leaders.map(
                  (entry) => Padding(
                    padding: const EdgeInsets.symmetric(vertical: 3),
                    child: Row(
                      children: [
                        SizedBox(
                          width: 28,
                          child: Text(
                            '#${entry['rank']}',
                            style: const TextStyle(fontWeight: FontWeight.w800),
                          ),
                        ),
                        Expanded(child: Text('${entry['playerName']}')),
                        Text(
                          '${entry['score']}',
                          style: const TextStyle(fontWeight: FontWeight.w800),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

class _NewJoineeBody extends StatelessWidget {
  const _NewJoineeBody({
    required this.post,
    required this.onAction,
    required this.canManage,
    required this.onEdit,
    required this.onDelete,
  });

  final ConnectPost post;
  final Future<void> Function({String? optionId}) onAction;
  final bool canManage;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final done = post.actionValue != null;
    final subtitle = _bodyString(post, 'subtitle');
    final splitIndex = subtitle.indexOf('·');
    final roleLine = splitIndex >= 0
        ? subtitle.substring(0, splitIndex).trim()
        : '';
    final restLine = splitIndex >= 0
        ? subtitle.substring(splitIndex + 1).trim()
        : subtitle;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _BodyTopStrip(
          icon: post.tagIcon,
          iconBg: const Color(0xFFEAF6FF),
          label: post.tag,
          timestamp: _timeAgo(post.publishedAt),
          canManage: canManage,
          onEdit: onEdit,
          onDelete: onDelete,
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0xFFEAF6FF),
              borderRadius: BorderRadius.circular(18),
            ),
            child: Column(
              children: [
                _InitialAvatar(
                  initials: _bodyString(post, 'personInitials'),
                  color: _ConnectColors.rose,
                  size: 88,
                  photoUrl: _bodyString(post, 'photoUrl'),
                ),
                const SizedBox(height: 12),
                Text(
                  _bodyString(post, 'personName'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: _ConnectColors.ink,
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 4),
                if (roleLine.isNotEmpty)
                  Text(
                    roleLine,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: _ConnectColors.blue,
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                if (restLine.isNotEmpty)
                  Padding(
                    padding: EdgeInsets.only(top: roleLine.isNotEmpty ? 2 : 0),
                    child: Text(
                      restLine,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: _ConnectColors.inkSoft,
                        fontSize: 13,
                      ),
                    ),
                  ),
                const SizedBox(height: 10),
                if (_bodyString(post, 'facts').isNotEmpty) ...[
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: const Color(0xFFEAF6FF),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: const Color(0xFFBEEDFF)),
                    ),
                    child: Text(
                      _bodyString(post, 'facts'),
                      style: const TextStyle(
                        color: _ConnectColors.inkSoft,
                        fontSize: 12.5,
                        height: 1.45,
                      ),
                    ),
                  ),
                  const SizedBox(height: 10),
                ],
                Text(
                  _bodyString(post, 'managerNote'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: _ConnectColors.ink,
                    fontSize: 13.5,
                    height: 1.45,
                  ),
                ),
                const SizedBox(height: 14),
                _ActionButton(
                  label: done
                      ? _bodyString(post, 'actionDoneLabel')
                      : _bodyString(post, 'actionLabel'),
                  icon: done ? Icons.check_rounded : Icons.waving_hand_rounded,
                  onTap: () => onAction(),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _ActionPanel extends StatelessWidget {
  const _ActionPanel({
    required this.icon,
    required this.iconColor,
    required this.title,
    required this.subtitle,
    required this.buttonLabel,
    required this.onTap,
  });

  final IconData icon;
  final Color iconColor;
  final String title;
  final String subtitle;
  final String buttonLabel;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: _ConnectColors.sand,
          borderRadius: BorderRadius.circular(18),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 46,
              height: 46,
              decoration: const BoxDecoration(
                color: Colors.white,
                shape: BoxShape.circle,
              ),
              child: Icon(icon, color: iconColor),
            ),
            const SizedBox(width: 13),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      color: _ConnectColors.ink,
                      fontSize: 17,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    subtitle,
                    style: const TextStyle(
                      color: _ConnectColors.inkSoft,
                      fontSize: 13,
                      height: 1.45,
                    ),
                  ),
                  if (buttonLabel.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    _ActionButton(
                      label: buttonLabel,
                      icon: Icons.arrow_forward_rounded,
                      onTap: onTap,
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Last two comments in chronological order (second-newest, then newest).
List<ConnectComment> _latestComments(List<ConnectComment> comments) {
  if (comments.length <= 2) return comments;
  return comments.sublist(comments.length - 2);
}

class _PostFooter extends StatelessWidget {
  const _PostFooter({
    required this.post,
    required this.busy,
    required this.controller,
    required this.onLike,
    required this.onComment,
    required this.onOpenComments,
    required this.viewerInitials,
    required this.viewerColor,
    this.viewerPhotoUrl = '',
  });

  final ConnectPost post;
  final bool busy;
  final TextEditingController controller;
  final VoidCallback onLike;
  final VoidCallback onComment;
  final VoidCallback onOpenComments;
  final String viewerInitials;
  final Color viewerColor;
  final String viewerPhotoUrl;

  @override
  Widget build(BuildContext context) {
    // Transparent, not opaque white: the card behind it may be tinted (see
    // `_celebrationCardTint`) and this footer shouldn't paint over that.
    return DecoratedBox(
      decoration: const BoxDecoration(color: Colors.transparent),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            decoration: const BoxDecoration(
              border: Border(top: BorderSide(color: Color(0x66EBEBEB))),
            ),
            child: Row(
              children: [
                InkWell(
                  borderRadius: BorderRadius.circular(99),
                  onTap: busy ? null : onLike,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      vertical: 4,
                      horizontal: 2,
                    ),
                    child: Row(
                      children: [
                        SvgPicture.asset(
                          post.liked
                              ? 'assets/icons/connect_icon_heart_filled.svg'
                              : 'assets/icons/connect_icon_heart_outline.svg',
                          width: 22,
                          height: 22,
                        ),
                        const SizedBox(width: 5),
                        Text(
                          '${post.likeCount}',
                          style: const TextStyle(
                            color: Color(0xFF9197A2),
                            fontSize: 12,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 16),
                InkWell(
                  borderRadius: BorderRadius.circular(99),
                  onTap: onOpenComments,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      vertical: 4,
                      horizontal: 2,
                    ),
                    child: Row(
                      children: [
                        SvgPicture.asset(
                          'assets/icons/connect_icon_comment.svg',
                          width: 22,
                          height: 22,
                        ),
                        const SizedBox(width: 5),
                        Text(
                          '${post.commentCount}',
                          style: const TextStyle(
                            color: _ConnectColors.faint,
                            fontSize: 12,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const Spacer(),
                if (busy)
                  const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: _ConnectColors.terra,
                    ),
                  ),
              ],
            ),
          ),
          if (post.comments.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                // The two most recent comments, oldest of the pair first — so
                // the newest sits closest to the comment box. `take(2)` showed
                // the two *oldest* comments on the post.
                children: _latestComments(post.comments).map((comment) {
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTap: onOpenComments,
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _InitialAvatar(
                            initials: _initials(comment.name),
                            // `ConnectComment` has no `userId` field (only
                            // id/name/text/createdAt) — `comment.id` is used
                            // as the hash seed instead, giving each comment a
                            // stable color the same way `avatarColorFor` does
                            // server-side. See final report.
                            color: _avatarColorFor(comment.id),
                            size: 32,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: RichText(
                              text: TextSpan(
                                style: const TextStyle(
                                  color: _ConnectColors.inkSoft,
                                  fontSize: 13,
                                  height: 1.35,
                                ),
                                children: [
                                  TextSpan(
                                    text: '${comment.name}  ',
                                    style: const TextStyle(
                                      color: _ConnectColors.ink,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                  TextSpan(
                                    text: _timeAgo(comment.createdAt),
                                    style: const TextStyle(
                                      color: _ConnectColors.faint,
                                      fontWeight: FontWeight.w600,
                                      fontSize: 11.5,
                                    ),
                                  ),
                                  TextSpan(text: '\n${comment.text}'),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                }).toList(),
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 14),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                _InitialAvatar(
                  initials: viewerInitials,
                  color: viewerColor,
                  photoUrl: viewerPhotoUrl,
                  size: 32,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: controller,
                    minLines: 1,
                    maxLines: 3,
                    textInputAction: TextInputAction.send,
                    onSubmitted: (_) => onComment(),
                    decoration: InputDecoration(
                      hintText: 'Write a comment...',
                      hintStyle: const TextStyle(
                        color: _ConnectColors.faint,
                        fontSize: 12.5,
                      ),
                      suffixIcon: IconButton(
                        icon: const Icon(Icons.send_rounded, size: 18),
                        color: _ConnectColors.blue,
                        onPressed: busy ? null : onComment,
                      ),
                      filled: true,
                      fillColor: const Color(0xFFF7F7F9),
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 10,
                      ),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(99),
                        borderSide: const BorderSide(
                          color: _ConnectColors.cardBorder,
                        ),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(99),
                        borderSide: const BorderSide(
                          color: _ConnectColors.cardBorder,
                        ),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(99),
                        borderSide: const BorderSide(
                          color: _ConnectColors.terra,
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _BodyText extends StatelessWidget {
  const _BodyText({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
      child: LinkifiedText(
        text,
        style: const TextStyle(
          color: _ConnectColors.ink,
          fontSize: 14.5,
          height: 1.55,
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton({required this.label, this.icon, required this.onTap});

  final String label;
  final IconData? icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 17, vertical: 16),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: _ConnectColors.blue,
            borderRadius: BorderRadius.circular(16),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (icon != null) ...[
                Icon(icon, color: Colors.white, size: 17),
                const SizedBox(width: 7),
              ],
              Text(
                label,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _InitialAvatar extends StatelessWidget {
  const _InitialAvatar({
    required this.initials,
    required this.color,
    required this.size,
    this.photoUrl = '',
  });

  final String initials;
  final Color color;
  final double size;
  final String photoUrl;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      child: photoUrl.isEmpty
          ? Text(
              initials.isEmpty ? '?' : initials,
              style: TextStyle(
                color: Colors.white,
                fontSize: size * 0.36,
                fontWeight: FontWeight.w800,
              ),
            )
          : Image(
              image: _remoteImage(photoUrl),
              width: size,
              height: size,
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) => Text(
                initials.isEmpty ? '?' : initials,
                style: TextStyle(
                  color: Colors.white,
                  fontSize: size * 0.36,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
    );
  }
}

class _DarkChip extends StatelessWidget {
  const _DarkChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        label.toUpperCase(),
        style: const TextStyle(
          color: Colors.white,
          fontSize: 10,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _QuickPostPage extends StatefulWidget {
  const _QuickPostPage({
    required this.viewerInitials,
    required this.viewerColor,
    required this.viewerPhotoUrl,
    required this.department,
    this.teammates = const [],
    this.isAdmin = false,
  });

  final String viewerInitials;
  final Color viewerColor;
  final String viewerPhotoUrl;
  final String? department;

  /// People who can be tagged in a media post.
  final List<ConnectTeammate> teammates;

  /// Admins get the extra Announcement type in the chip row.
  final bool isAdmin;

  @override
  State<_QuickPostPage> createState() => _QuickPostPageState();
}

class _QuickPostPageState extends State<_QuickPostPage> {
  final _text = TextEditingController();
  final _focus = FocusNode();
  final _media = <ConnectMediaAttachment>[];
  int _previewIndex = 0;
  bool _teamOnly = false;
  final _taggedUserIds = <String>[];

  @override
  void initState() {
    super.initState();
    _text.addListener(() => setState(() {}));
    WidgetsBinding.instance.addPostFrameCallback((_) => _focus.requestFocus());
  }

  @override
  void dispose() {
    _text.dispose();
    _focus.dispose();
    super.dispose();
  }


  bool get _canPost => _text.text.trim().isNotEmpty || _media.isNotEmpty;

  Future<void> _addMedia() async {
    final result = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov'],
      withData: false,
      allowMultiple: true,
    );
    final files = result?.files ?? const [];
    final picked = <ConnectMediaAttachment>[];
    for (final file in files) {
      var path = file.path;
      if (path == null || path.isEmpty) continue;
      final mime = _mimeTypeFor(file.extension);
      // Each photo gets its own crop step; video has no frame to crop.
      if (mime.startsWith('image/')) {
        if (!mounted) return;
        final cropped = await cropImageFile(
          context,
          path: path,
          title: files.length > 1 ? 'Crop ${file.name}' : 'Crop your photo',
          initial: CropShape.landscape,
        );
        // Skipping the crop skips that photo, rather than posting an uncropped
        // one the author has just declined.
        if (cropped == null) continue;
        path = cropped;
      }
      picked.add(
        ConnectMediaAttachment(
          path: path,
          name: file.name,
          size: file.size,
          mimeType: mime,
        ),
      );
    }
    if (picked.isEmpty || !mounted) return;
    setState(() => _media.addAll(picked));
  }

  Future<void> _pickAudience() async {
    final teamOnly = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      barrierColor: const Color(0x73000000),
      builder: (_) => _AudienceSheet(teamOnly: _teamOnly),
    );
    if (!mounted || teamOnly == null) return;
    setState(() => _teamOnly = teamOnly);
  }

  /// A type chip was tapped. Media is composed right here; every other type
  /// has its own dedicated composer, so hand off to it and leave this screen
  /// behind — the flows themselves are unchanged.
  Future<void> _chooseType(ConnectPostType type) async {
    if (type == ConnectPostType.newPost) {
      await _addMedia();
      return;
    }
    if (!mounted) return;
    Navigator.of(context).pop(_QuickPostResult.switchType(type));
  }

  void _submit() {
    if (!_canPost) return;
    final hasMedia = _media.isNotEmpty;
    final isVideo =
        hasMedia && (_media.first.mimeType?.startsWith('video/') ?? false);
    final draft = ConnectPostDraft(
      type: ConnectPostType.newPost,
      body: {
        'postKind': hasMedia ? 'media' : 'text',
        'text': _text.text.trim(),
        'mediaKind': hasMedia ? (isVideo ? 'video' : 'image') : 'none',
        'mediaTitle': hasMedia ? _media.first.name : '',
        'mediaDuration': '',
        'linkUrl': '',
        'linkTitle': '',
        'linkDomain': '',
        'sendTo': _teamOnly ? 'my_team' : 'everyone',
        'sendToDepartment': _teamOnly ? (widget.department ?? '') : '',
        // Tagging is a media-post feature, so a text-only post carries none.
        'taggedUserIds': hasMedia ? _taggedUserIds : const <String>[],
      },
      media: hasMedia ? _media.first : null,
      mediaList: _media.length > 1 ? List.of(_media) : const [],
    );
    Navigator.of(context).pop(_QuickPostResult.draft(draft));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Column(
          children: [
            _buildHeader(),
            _buildTypeChips(),
            Expanded(
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: () => FocusScope.of(context).unfocus(),
                child: SingleChildScrollView(
                  keyboardDismissBehavior:
                      ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const SizedBox(height: 12),
                      TextField(
                        controller: _text,
                        focusNode: _focus,
                        maxLines: null,
                        minLines: 3,
                        keyboardType: TextInputType.multiline,
                        textCapitalization: TextCapitalization.sentences,
                        style: const TextStyle(
                          color: Color(0xFF222222),
                          fontSize: 15,
                          height: 23 / 15,
                          fontWeight: FontWeight.w400,
                        ),
                        decoration: const InputDecoration(
                          isCollapsed: true,
                          filled: false,
                          border: InputBorder.none,
                          enabledBorder: InputBorder.none,
                          focusedBorder: InputBorder.none,
                          disabledBorder: InputBorder.none,
                          errorBorder: InputBorder.none,
                          focusedErrorBorder: InputBorder.none,
                          contentPadding: EdgeInsets.zero,
                          hintText:
                              'Be the first to spark a conversation and share '
                              'something amazing with your team!',
                          hintStyle: TextStyle(
                            color: Color(0xFF9197A2),
                            fontSize: 15,
                            height: 23 / 15,
                            fontWeight: FontWeight.w400,
                          ),
                        ),
                      ),
                      if (_media.isNotEmpty) ...[
                        _buildMediaPreview(),
                        if (widget.teammates.isNotEmpty) ...[
                          const SizedBox(height: 14),
                          _TagPeopleField(
                            teammates: widget.teammates,
                            selectedUserIds: _taggedUserIds,
                            onChanged: (ids) => setState(() {
                              _taggedUserIds
                                ..clear()
                                ..addAll(ids);
                            }),
                          ),
                        ],
                      ],
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Post-type selector (node 2028:53056): a scrollable row of chips beneath
  /// the composer header, in place of the old bottom-sheet grid.
  Widget _buildTypeChips() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(
          bottom: BorderSide(color: Color(0xFFEBEBEB), width: 1.114),
        ),
      ),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          spacing: 10,
          children: [
            _PostTypeChip(
              label: 'Media',
              asset: 'assets/icons/post_type_media.svg',
              onTap: () => _chooseType(ConnectPostType.newPost),
            ),
            _PostTypeChip(
              label: 'Poll',
              asset: 'assets/icons/post_type_poll.png',
              iconWidth: 30,
              onTap: () => _chooseType(ConnectPostType.survey),
            ),
            _PostTypeChip(
              label: 'Kudos',
              asset: 'assets/icons/post_type_kudos.png',
              onTap: () => _chooseType(ConnectPostType.kudos),
            ),
            _PostTypeChip(
              label: 'Recommend',
              asset: 'assets/icons/post_type_recommend.png',
              onTap: () => _chooseType(ConnectPostType.recommendation),
            ),
            // Not among the design's four chips, but announcements are
            // admin-only and this row is now the only way to reach them.
            if (widget.isAdmin)
              _PostTypeChip(
                label: 'Announcement',
                asset: 'assets/icons/post_type_announcement.png',
                onTap: () => _chooseType(ConnectPostType.hrAnnouncement),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      height: 60,
      padding: const EdgeInsets.symmetric(horizontal: 20),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(
          bottom: BorderSide(color: Color(0xFFF3F4F6), width: 1.1),
        ),
      ),
      child: Row(
        children: [
          InkWell(
            customBorder: const CircleBorder(),
            onTap: () => Navigator.of(context).pop(),
            child: Container(
              width: 36,
              height: 36,
              alignment: Alignment.center,
              decoration: const BoxDecoration(
                color: Color(0xFFF7F7F9),
                shape: BoxShape.circle,
              ),
              child: SvgPicture.asset(
                'assets/icons/composer_close.svg',
                width: 16,
                height: 16,
              ),
            ),
          ),
          const SizedBox(width: 14),
          _InitialAvatar(
            initials: widget.viewerInitials,
            color: widget.viewerColor,
            size: 30,
            photoUrl: widget.viewerPhotoUrl,
          ),
          const SizedBox(width: 8),
          InkWell(
            onTap: _pickAudience,
            borderRadius: BorderRadius.circular(8),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    _teamOnly ? 'Team' : 'Public',
                    style: const TextStyle(
                      color: Color(0xFF484848),
                      fontSize: 16,
                      height: 22 / 16,
                      fontWeight: FontWeight.w400,
                      letterSpacing: 0.4,
                    ),
                  ),
                  const SizedBox(width: 8),
                  // The exported glyph points left; the design rotates it -90°
                  // so it reads as a downward "change audience" chevron.
                  Transform.rotate(
                    angle: -math.pi / 2,
                    child: SvgPicture.asset(
                      'assets/icons/composer_chevron.svg',
                      width: 18,
                      height: 18,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const Spacer(),
          InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: _canPost ? _submit : null,
            // No `alignment:` here — it would make the Container expand to the
            // header's full height instead of hugging the label, which is what
            // made this button tall instead of the design's pill.
            child: Container(
              width: 80,
              padding: const EdgeInsets.symmetric(vertical: 8),
              decoration: BoxDecoration(
                // #0571A6 once there is something to post, the muted
                // #96B7C7 resting state until then.
                color: _canPost
                    ? const Color(0xFF0571A6)
                    : const Color(0xFF96B7C7),
                borderRadius: BorderRadius.circular(16),
              ),
              child: const Text(
                'Post',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 12,
                  height: 16.2 / 12,
                  fontWeight: FontWeight.w400,
                  letterSpacing: -0.16,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMediaPreview() {
    final preview = _media[_previewIndex.clamp(0, _media.length - 1)];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 12),
        ClipRRect(
          borderRadius: BorderRadius.circular(16),
          child: Stack(
            children: [
              // The author just chose this framing in the crop step, so the
              // preview shows it at that shape rather than slicing it back
              // into a fixed landscape box.
              _LocalMediaPreview(attachment: preview),
              Positioned(
                top: 8,
                right: 8,
                child: InkWell(
                  customBorder: const CircleBorder(),
                  onTap: () => setState(() {
                    _media.remove(preview);
                    _previewIndex = 0;
                  }),
                  child: Container(
                    width: 28,
                    height: 28,
                    alignment: Alignment.center,
                    decoration: const BoxDecoration(
                      color: Color(0x99000000),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.close_rounded,
                      size: 16,
                      color: Colors.white,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
        if (_media.length > 1) ...[
          const SizedBox(height: 12),
          SizedBox(
            height: 50,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _media.length,
              separatorBuilder: (_, _) => const SizedBox(width: 8),
              itemBuilder: (_, index) {
                final selected = index == _previewIndex;
                return InkWell(
                  borderRadius: BorderRadius.circular(4),
                  onTap: () => setState(() => _previewIndex = index),
                  child: Container(
                    width: 80,
                    height: 50,
                    clipBehavior: Clip.antiAlias,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(4),
                      border: Border.all(
                        color: selected
                            ? const Color(0xFF0571A6)
                            : Colors.transparent,
                        width: 1.5,
                      ),
                      boxShadow: const [
                        BoxShadow(
                          color: Color(0x1A000000),
                          blurRadius: 3,
                          offset: Offset(0, 1),
                        ),
                      ],
                    ),
                    child: _LocalMediaThumb(attachment: _media[index]),
                  ),
                );
              },
            ),
          ),
        ],
      ],
    );
  }
}

/// One post-type chip in the composer's selector row (node 2028:53058).
class _PostTypeChip extends StatelessWidget {
  const _PostTypeChip({
    required this.label,
    required this.asset,
    required this.onTap,
    this.iconWidth = 20,
  });

  final String label;
  final String asset;
  final VoidCallback onTap;

  /// The poll glyph is 30x20; every other chip icon is square at 20.
  final double iconWidth;
  static const double iconHeight = 20;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFFF7F7F9),
      borderRadius: BorderRadius.circular(99),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(99),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            border: Border.all(color: const Color(0xFFEBEBEB), width: 1.114),
            borderRadius: BorderRadius.circular(99),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            spacing: 6,
            children: [
              SizedBox(
                width: iconWidth,
                height: iconHeight,
                child: asset.endsWith('.svg')
                    ? SvgPicture.asset(
                        asset,
                        width: iconWidth,
                        height: iconHeight,
                      )
                    : Image.asset(
                        asset,
                        width: iconWidth,
                        height: iconHeight,
                        fit: BoxFit.cover,
                      ),
              ),
              Text(
                label.toUpperCase(),
                style: const TextStyle(
                  color: Color(0xFF484848),
                  fontSize: 12,
                  height: 18 / 12,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.3,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// "Start a post....." row at the top of the feed (node 2002:39114) — the
/// composer entry point, replacing the Post tab that used to sit in the nav.
class _StartAPostCard extends StatelessWidget {
  const _StartAPostCard({
    required this.initials,
    required this.color,
    required this.photoUrl,
    required this.onTap,
  });

  final String initials;
  final Color color;
  final String photoUrl;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Container(
          padding: const EdgeInsets.all(22.114),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: const Color(0xFFEBEBEB), width: 1.114),
          ),
          child: Row(
            spacing: 12,
            children: [
              _InitialAvatar(
                initials: initials,
                color: color,
                size: 48,
                photoUrl: photoUrl,
              ),
              Expanded(
                child: Container(
                  height: 52,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  alignment: Alignment.centerLeft,
                  decoration: BoxDecoration(
                    color: const Color(0xFFFAFAFA),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: const Color(0xFFE8E8F0),
                      width: 1.129,
                    ),
                  ),
                  child: const Text(
                    'Start a post.....',
                    style: TextStyle(
                      color: Color(0xFF717171),
                      fontSize: 15,
                      fontWeight: FontWeight.w400,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Audience switcher for the composer (node 655:15638).
class _AudienceSheet extends StatelessWidget {
  const _AudienceSheet({required this.teamOnly});

  final bool teamOnly;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.bottomCenter,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.only(bottom: 24),
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
            boxShadow: [
              BoxShadow(
                color: Color(0x1F000000),
                blurRadius: 16,
                offset: Offset(0, -4),
              ),
            ],
          ),
          child: SafeArea(
            top: false,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Padding(
                  padding: const EdgeInsets.only(top: 12, bottom: 4),
                  child: Center(
                    child: Container(
                      width: 40,
                      height: 4,
                      decoration: BoxDecoration(
                        color: const Color(0xFFD1D5DB),
                        borderRadius: BorderRadius.circular(99),
                      ),
                    ),
                  ),
                ),
                _AudienceOption(
                  label: 'Public',
                  selected: !teamOnly,
                  onTap: () => Navigator.of(context).pop(false),
                ),
                const Divider(
                  height: 1,
                  thickness: 1,
                  color: Color(0xFFEDEDED),
                ),
                _AudienceOption(
                  label: 'Team',
                  selected: teamOnly,
                  onTap: () => Navigator.of(context).pop(true),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _AudienceOption extends StatelessWidget {
  const _AudienceOption({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        child: Row(
          children: [
            Expanded(
              child: Text(
                label,
                style: const TextStyle(
                  color: Color(0xFF222222),
                  fontSize: 16,
                  height: 22 / 16,
                  fontWeight: FontWeight.w400,
                  letterSpacing: 0.4,
                ),
              ),
            ),
            if (selected)
              const Icon(
                Icons.check_rounded,
                size: 18,
                color: Color(0xFF0571A6),
              ),
          ],
        ),
      ),
    );
  }
}

/// A local file preview — these are picked files on disk, not network media.
class _LocalMediaThumb extends StatelessWidget {
  const _LocalMediaThumb({required this.attachment});

  final ConnectMediaAttachment attachment;

  @override
  Widget build(BuildContext context) {
    final isVideo = attachment.mimeType?.startsWith('video/') ?? false;
    if (isVideo) {
      return Container(
        color: const Color(0xFF222222),
        alignment: Alignment.center,
        child: const Icon(
          Icons.play_circle_outline_rounded,
          color: Colors.white,
          size: 32,
        ),
      );
    }
    return Image.file(
      File(attachment.path),
      fit: BoxFit.cover,
      width: double.infinity,
      errorBuilder: (_, _, _) => Container(
        color: _ConnectColors.sand,
        alignment: Alignment.center,
        child: const Icon(Icons.image_outlined, color: Color(0xFF9197A2)),
      ),
    );
  }
}

/// What the quick composer hands back: either a finished draft, or a request to
/// switch into one of the dedicated typed composers.
class _QuickPostResult {
  const _QuickPostResult._({this.draft, this.type});

  factory _QuickPostResult.draft(ConnectPostDraft draft) =>
      _QuickPostResult._(draft: draft);

  factory _QuickPostResult.switchType(ConnectPostType type) =>
      _QuickPostResult._(type: type);

  final ConnectPostDraft? draft;
  final ConnectPostType? type;
}

class _PostComposerPage extends StatefulWidget {
  const _PostComposerPage({
    required this.type,
    this.existing,
    this.department,
    this.recognitionCandidates = const [],
    this.taggablePeople = const [],
    this.initialPoll,
    this.viewerInitials = '',
    this.viewerColor = _ConnectColors.blue,
    this.viewerPhotoUrl = '',
    this.resolveLinkPreview,
  });

  final ConnectPostType type;
  final ConnectPost? existing;
  final String? department;
  final List<ConnectTeammate> recognitionCandidates;

  /// Everyone in the company — who can be tagged in a media post.
  final List<ConnectTeammate> taggablePeople;

  /// Resolves a link's artwork so the composer can show it before posting.
  final Future<Map<String, String>> Function(String url)? resolveLinkPreview;
  final _PollDraft? initialPoll;
  final String viewerInitials;
  final Color viewerColor;
  final String viewerPhotoUrl;

  @override
  State<_PostComposerPage> createState() => _PostComposerPageState();
}

class _PostComposerPageState extends State<_PostComposerPage> {
  late final TextEditingController _text;
  late final TextEditingController _title;
  late final TextEditingController _person;
  late final TextEditingController _linkUrl;
  late final TextEditingController _mediaTitle;
  late final TextEditingController _location;
  late final TextEditingController _prize;
  late final TextEditingController _acknowledgementMessage;
  _PollDraft? _pollDraft;
  /// The link's resolved preview, shown under the URL field. Null until a
  /// lookup has returned something.
  Map<String, String>? _linkPreview;
  bool _resolvingLink = false;
  String _resolvedFor = '';
  Timer? _linkDebounce;
  String _sendTo = 'all_company';
  String _newPostKind = 'media';
  final _taggedUserIds = <String>[];
  String _eventCategory = 'sports';
  bool _allowRegistration = true;
  bool _requireAcknowledgement = false;
  ConnectMediaAttachment? _selectedMedia;
  // Additional photos beyond `_selectedMedia` (image posts only — up to 6
  // total across both). Kept separate from `_selectedMedia` so the existing
  // single-media flows (leadership, video) stay untouched.
  final List<ConnectMediaAttachment> _extraMedia = [];
  bool _removeExistingMedia = false;
  late DateTime _eventDate;
  late TimeOfDay _eventTime;

  bool get _editing => widget.existing != null;
  Map<String, dynamic> get _body => widget.existing?.body ?? const {};
  bool get _hasMedia =>
      _selectedMedia != null ||
      (!_removeExistingMedia && _bodyValue('mediaObjectKey').isNotEmpty);

  /// Kudos, Recommendation, Announcement and the Poll editor are dedicated
  /// sub-screens (title header, `#F7F7F9` background); everything else is the
  /// general composer (audience-selector header, white background) — see
  /// item 1/4.
  bool get _isDedicatedSubScreen =>
      widget.type == ConnectPostType.kudos ||
      widget.type == ConnectPostType.recommendation ||
      widget.type == ConnectPostType.hrAnnouncement;

  @override
  void initState() {
    super.initState();
    _text = TextEditingController(text: _bodyValue('text'));
    _title = TextEditingController(text: _bodyValue('title'));
    _person = TextEditingController(text: _bodyValue('personName'));
    _linkUrl = TextEditingController(text: _bodyValue('linkUrl'));
    // Typing a URL is a stream of half-finished ones, so the lookup waits for
    // a pause rather than firing on every keystroke.
    _linkUrl.addListener(_onLinkChanged);
    _mediaTitle = TextEditingController(text: _bodyValue('mediaTitle'));
    _location = TextEditingController(text: _bodyValue('location'));
    _prize = TextEditingController(text: _bodyValue('prize'));
    _acknowledgementMessage = TextEditingController(
      text: _bodyValue('acknowledgementMessage'),
    );
    _sendTo = _bodyValue('sendTo').isEmpty
        ? 'all_company'
        : _bodyValue('sendTo');
    _taggedUserIds.addAll(
      (widget.existing?.body['taggedUserIds'] as List<dynamic>? ?? const [])
          .map((id) => id.toString())
          .where((id) => id.isNotEmpty),
    );
    _newPostKind = _bodyValue('postKind').isEmpty
        ? (_bodyValue('linkUrl').isNotEmpty
              ? 'link'
              : _bodyValue('mediaKind') == 'none'
              ? 'text'
              : 'media')
        : _bodyValue('postKind');
    _eventCategory = _bodyValue('category').isEmpty
        ? 'sports'
        : _bodyValue('category');
    _allowRegistration = _body['allowRegistration'] is bool
        ? _body['allowRegistration'] as bool
        : true;
    _requireAcknowledgement = _body['requireAcknowledgement'] is bool
        ? _body['requireAcknowledgement'] as bool
        : false;
    _eventDate =
        DateTime.tryParse(_bodyValue('date')) ??
        DateTime.now().add(const Duration(days: 7));
    _eventTime =
        _parseTimeOfDay(_bodyValue('time')) ??
        const TimeOfDay(hour: 17, minute: 30);
    _pollDraft =
        widget.initialPoll ??
        (widget.type == ConnectPostType.survey
            ? _PollDraft.fromPost(widget.existing)
            : null);
    // "Add Media" from the post-type sheet should drop straight into the
    // system picker rather than landing on an empty placeholder first.
    if (widget.type == ConnectPostType.newPost &&
        widget.existing == null &&
        _newPostKind == 'media') {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _pickMedia();
      });
    }
    // The submit button's enabled state is a getter recomputed on build, but
    // nothing rebuilds this page as the user types — none of these fields
    // carry an onChanged. Without this, the button only updates when some
    // unrelated setState happens to fire (toggling a switch, picking media),
    // which is the "button stays disabled until I touch something else" bug.
    for (final controller in [
      _text,
      _title,
      _person,
      _linkUrl,
      _mediaTitle,
      _location,
      _prize,
      _acknowledgementMessage,
    ]) {
      controller.addListener(_handleFieldChanged);
    }
  }

  void _handleFieldChanged() {
    if (mounted) setState(() {});
  }

  void _onLinkChanged() {
    _linkDebounce?.cancel();
    final url = _linkUrl.text.trim();
    if (url.isEmpty) {
      if (_linkPreview != null || _resolvingLink) {
        setState(() {
          _linkPreview = null;
          _resolvingLink = false;
          _resolvedFor = '';
        });
      }
      return;
    }
    if (url == _resolvedFor) return;
    _linkDebounce = Timer(const Duration(milliseconds: 600), () => _resolveLink(url));
  }

  Future<void> _resolveLink(String url) async {
    final resolve = widget.resolveLinkPreview;
    if (resolve == null) return;
    setState(() => _resolvingLink = true);
    final preview = await resolve(url);
    if (!mounted || _linkUrl.text.trim() != url) return;
    setState(() {
      _resolvingLink = false;
      _resolvedFor = url;
      _linkPreview = (preview['imageUrl'] ?? '').isEmpty && (preview['title'] ?? '').isEmpty
          ? null
          : preview;
      // The title field is a convenience, not an override — only filled when
      // the author has not written their own.
      final resolvedTitle = preview['title'] ?? '';
      if (resolvedTitle.isNotEmpty && _mediaTitle.text.trim().isEmpty) {
        _mediaTitle.text = resolvedTitle;
      }
    });
  }

  @override
  void dispose() {
    _text.dispose();
    _title.dispose();
    _person.dispose();
    _linkDebounce?.cancel();
    _linkUrl.removeListener(_onLinkChanged);
    _linkUrl.dispose();
    _mediaTitle.dispose();
    _location.dispose();
    _prize.dispose();
    _acknowledgementMessage.dispose();
    super.dispose();
  }

  String _bodyValue(String key) {
    final value = _body[key];
    return value == null ? '' : value.toString();
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.viewInsetsOf(context).bottom;
    return Scaffold(
      resizeToAvoidBottomInset: false,
      backgroundColor: _isDedicatedSubScreen
          ? const Color(0xFFF7F7F9)
          : Colors.white,
      body: SafeArea(
        child: Padding(
          padding: EdgeInsets.only(bottom: bottom),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _ComposerHeader(
                onDismiss: _handleDismiss,
                submitLabel: _editing ? 'Save' : 'Post',
                submitEnabled: _formIsValid,
                onSubmit: _submit,
                title: _isDedicatedSubScreen ? _typeTitle : null,
                audienceLabel: _isDedicatedSubScreen
                    ? null
                    : (_sendTo == 'my_team' ? 'Team' : 'Public'),
                onAudienceTap: _isDedicatedSubScreen
                    ? null
                    : _openAudiencePicker,
                viewerInitials: widget.viewerInitials,
                viewerColor: widget.viewerColor,
                viewerPhotoUrl: widget.viewerPhotoUrl,
              ),
              Expanded(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(18, 16, 18, 24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: _fieldsForType(),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _fieldsForType() {
    return switch (widget.type) {
      ConnectPostType.leadership => [
        _FieldLabel('MESSAGE'),
        _ComposerTextField(
          controller: _text,
          hint: 'Share a win, milestone, or news from leadership...',
          minLines: 5,
        ),
        const SizedBox(height: 18),
        _FieldLabel('MEDIA'),
        _MediaToggle(
          enabled: _hasMedia,
          selectedMedia: _selectedMedia,
          existingMediaKind: _bodyValue('mediaKind'),
          existingMediaUrl: _bodyValue('mediaUrl'),
          onTap: _pickMedia,
          onRemove: _hasMedia ? _removeMedia : null,
        ),
        if (_hasMedia) ...[
          const SizedBox(height: 10),
          _ComposerTextField(
            controller: _mediaTitle,
            hint: 'Video title',
            minLines: 1,
          ),
        ],
        const SizedBox(height: 18),
        _FieldLabel('LINK (OPTIONAL)'),
        _ComposerTextField(
          controller: _linkUrl,
          hint: 'Paste a URL...',
          minLines: 1,
          keyboardType: TextInputType.url,
        ),
      ],
      ConnectPostType.newPost => [
        _FieldLabel('TYPE'),
        _SegmentedChoice(
          value: _newPostKind,
          values: const [
            ('media', 'Video/Photo'),
            ('text', 'Text'),
            ('question', 'Question'),
            ('link', 'Link'),
          ],
          onChanged: (value) => setState(() => _newPostKind = value),
        ),
        const SizedBox(height: 18),
        _FieldLabel('MESSAGE'),
        _ComposerTextField(
          controller: _text,
          hint: _newPostKind == 'question'
              ? 'Ask a question...'
              : 'Write a post...',
          minLines: 5,
        ),
        if (_newPostKind == 'media') ...[
          const SizedBox(height: 18),
          _FieldLabel('VIDEO OR PHOTO'),
          // Per node 526:2474: the first photo is a full-width hero, and
          // any additional photos are a row of smaller tiles underneath —
          // not one uniform row of equal tiles.
          _MediaToggle(
            enabled: _hasMedia,
            selectedMedia: _selectedMedia,
            existingMediaKind: _bodyValue('mediaKind'),
            existingMediaUrl: _bodyValue('mediaUrl'),
            onTap: _pickMedia,
            onRemove: _hasMedia ? _removeMedia : null,
          ),
          // Multiple photos only — a video post stays a single attachment.
          if (_selectedMedia != null &&
              _mediaKindForSelection() == 'image') ...[
            const SizedBox(height: 10),
            _ExtraPhotosRow(
              photos: _extraMedia,
              canAddMore: _extraMedia.length < _maxMediaCount - 1,
              onAdd: _pickExtraMedia,
              onRemove: _removeExtraMedia,
            ),
          ],
        ],
        if (_newPostKind == 'media' && widget.taggablePeople.isNotEmpty) ...[
          const SizedBox(height: 18),
          _FieldLabel('TAG PEOPLE'),
          _TagPeopleField(
            teammates: widget.taggablePeople,
            selectedUserIds: _taggedUserIds,
            onChanged: (ids) => setState(() {
              _taggedUserIds
                ..clear()
                ..addAll(ids);
            }),
          ),
        ],
        if (_newPostKind == 'link') ...[
          const SizedBox(height: 18),
          _FieldLabel('LINK'),
          _ComposerTextField(
            controller: _linkUrl,
            hint: 'Paste a URL...',
            minLines: 1,
            keyboardType: TextInputType.url,
          ),
        ],
      ],
      ConnectPostType.hrAnnouncement => [
        _FieldLabel('TITLE'),
        _ComposerTextField(
          controller: _mediaTitle,
          hint: 'Announcement title...',
          minLines: 1,
        ),
        const SizedBox(height: 18),
        _FieldLabel('MESSAGE'),
        _ComposerTextField(
          controller: _text,
          hint: 'Write your announcement...',
          minLines: 6,
        ),
      ],
      ConnectPostType.kudos => [
        _FieldLabel('RECOGNISE A TEAMMATE'),
        _TeammateSelector(
          teammates: widget.recognitionCandidates,
          selectedName: _person.text,
          onChanged: (name) => setState(() => _person.text = name),
        ),
        const SizedBox(height: 18),
        _FieldLabel('MESSAGE'),
        _ComposerTextField(
          controller: _text,
          hint: 'What did they do well?',
          minLines: 4,
        ),
      ],
      ConnectPostType.survey => [
        if (_pollDraft != null) _pollPreviewCard() else _addPollPrompt(),
      ],
      ConnectPostType.event => [
        _FieldLabel('CATEGORY'),
        _ChipChoice(
          value: _eventCategory,
          values: const [
            ('sports', 'Sports'),
            ('wellness', 'Wellness'),
            ('social', 'Social'),
            ('learning', 'Learning'),
            ('creative', 'Creative'),
          ],
          onChanged: (value) => setState(() => _eventCategory = value),
        ),
        const SizedBox(height: 18),
        _FieldLabel('TITLE'),
        _ComposerTextField(
          controller: _title,
          hint: 'Event title',
          minLines: 1,
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _FieldLabel('DATE'),
                  _PickerField(
                    icon: Icons.calendar_today_rounded,
                    label: _formatComposerDate(_eventDate),
                    onTap: _pickEventDate,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _FieldLabel('TIME'),
                  _PickerField(
                    icon: Icons.schedule_rounded,
                    label: _eventTime.format(context),
                    onTap: _pickEventTime,
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        _FieldLabel('LOCATION'),
        _ComposerTextField(
          controller: _location,
          hint: 'Where is it happening?',
          minLines: 1,
        ),
        const SizedBox(height: 12),
        _FieldLabel('PRIZE (OPTIONAL)'),
        _ComposerTextField(
          controller: _prize,
          hint: 'Prize details',
          minLines: 1,
        ),
        const SizedBox(height: 12),
        SwitchListTile.adaptive(
          contentPadding: EdgeInsets.zero,
          title: const Text(
            'Allow Registration',
            style: TextStyle(
              color: _ConnectColors.ink,
              fontSize: 14,
              fontWeight: FontWeight.w800,
            ),
          ),
          value: _allowRegistration,
          activeThumbColor: _ConnectColors.terra,
          onChanged: (value) => setState(() => _allowRegistration = value),
        ),
      ],
      ConnectPostType.recommendation => [
        _FieldLabel('LINK/URL'),
        _ComposerTextField(
          controller: _linkUrl,
          hint: 'https//',
          minLines: 1,
          keyboardType: TextInputType.url,
        ),
        if (_resolvingLink || _linkPreview != null) ...[
          const SizedBox(height: 12),
          _LinkPreviewCard(preview: _linkPreview, loading: _resolvingLink),
        ],
        const SizedBox(height: 18),
        _FieldLabel('TITLE'),
        _ComposerTextField(
          controller: _mediaTitle,
          hint: 'What is it about',
          minLines: 1,
        ),
        const SizedBox(height: 18),
        // No thumbnail picker: the card's image is resolved from the link's
        // own preview metadata server-side.
        _FieldLabel('BODY'),
        _ComposerTextField(
          controller: _text,
          hint: 'Why should the team see this',
          minLines: 6,
        ),
      ],
      _ => [
        _FieldLabel('MESSAGE'),
        _ComposerTextField(
          controller: _text,
          hint: 'Write a post...',
          minLines: 4,
        ),
      ],
    };
  }

  Future<void> _openAudiencePicker() async {
    final selected = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (_) => _AudiencePickerSheet(value: _sendTo),
    );
    if (!mounted || selected == null) return;
    setState(() => _sendTo = selected);
  }

  Future<void> _openPollEditor() async {
    final result = await Navigator.of(context).push<_PollDraft>(
      MaterialPageRoute(builder: (_) => _PollEditorPage(initial: _pollDraft)),
    );
    if (!mounted || result == null) return;
    setState(() => _pollDraft = result);
  }

  Widget _addPollPrompt() {
    return InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: _openPollEditor,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: const Color(0xFFEBEBEB)),
        ),
        child: const Row(
          children: [
            Icon(
              Icons.add_circle_outline_rounded,
              color: _ConnectColors.blue,
              size: 22,
            ),
            SizedBox(width: 10),
            Expanded(
              child: Text(
                'Add a poll question and options',
                style: TextStyle(
                  color: Color(0xFF222222),
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _pollPreviewCard() {
    final poll = _pollDraft!;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFEBEBEB)),
        boxShadow: const [
          BoxShadow(
            color: Color(0x1A000000),
            blurRadius: 3,
            offset: Offset(0, 1),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Spacer(),
              InkWell(
                onTap: _openPollEditor,
                child: const Text(
                  'Edit',
                  style: TextStyle(
                    color: _ConnectColors.blue,
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(width: 14),
              InkWell(
                onTap: () => setState(() => _pollDraft = null),
                child: const Icon(
                  Icons.close_rounded,
                  size: 18,
                  color: Color(0xFF717171),
                ),
              ),
            ],
          ),
          const SizedBox(height: 2),
          Text(
            poll.question.trim().isEmpty ? 'Untitled question' : poll.question,
            style: const TextStyle(
              color: Color(0xFF222222),
              fontSize: 15,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 14),
          const Divider(height: 1, thickness: 1, color: Color(0xFFF3F4F6)),
          const SizedBox(height: 14),
          for (var i = 0; i < poll.options.length; i++) ...[
            if (i > 0) const SizedBox(height: 10),
            Container(
              width: double.infinity,
              height: 53,
              alignment: Alignment.centerLeft,
              padding: const EdgeInsets.symmetric(horizontal: 14),
              decoration: BoxDecoration(
                border: Border.all(color: const Color(0xFFEBEBEB)),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  if (poll.options[i].isImage &&
                      poll.options[i].imagePath != null) ...[
                    ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: Image.file(
                        File(poll.options[i].imagePath!),
                        width: 32,
                        height: 32,
                        fit: BoxFit.cover,
                      ),
                    ),
                    const SizedBox(width: 10),
                  ],
                  Expanded(
                    child: Text(
                      poll.options[i].text.trim().isEmpty
                          ? 'Option ${i + 1}'
                          : poll.options[i].text,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Color(0xFF222222),
                        fontSize: 14,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  /// Dedicated sub-screen title (item 1) — the only types that render the
  /// bold title header variant instead of the audience selector.
  String get _typeTitle {
    return switch (widget.type) {
      ConnectPostType.kudos => 'Kudos',
      ConnectPostType.recommendation => 'Recommendation',
      ConnectPostType.hrAnnouncement => 'Announcement',
      _ => 'Post',
    };
  }

  /// Does the form currently hold any user-entered content? Gates the
  /// discard-draft confirmation on dismiss (item 9).
  bool get _hasUnsavedInput {
    if (_text.text.trim().isNotEmpty) return true;
    if (_title.text.trim().isNotEmpty) return true;
    if (_person.text.trim().isNotEmpty) return true;
    if (_linkUrl.text.trim().isNotEmpty) return true;
    if (_mediaTitle.text.trim().isNotEmpty) return true;
    if (_location.text.trim().isNotEmpty) return true;
    if (_prize.text.trim().isNotEmpty) return true;
    if (_acknowledgementMessage.text.trim().isNotEmpty) return true;
    if (_selectedMedia != null) return true;
    if (_extraMedia.isNotEmpty) return true;
    if (_taggedUserIds.isNotEmpty) return true;
    if (_requireAcknowledgement) return true;
    final poll = _pollDraft;
    if (poll != null &&
        (poll.question.trim().isNotEmpty ||
            poll.options.any(
              (option) =>
                  option.text.trim().isNotEmpty || option.imagePath != null,
            ))) {
      return true;
    }
    return false;
  }

  Future<void> _handleDismiss() async {
    if (!_hasUnsavedInput) {
      Navigator.of(context).pop();
      return;
    }
    final confirmed = await showDialog<bool>(
      context: context,
      barrierColor: const Color(0x76000000),
      builder: (_) => const _DeletePostSheet(
        title: 'Discard draft?',
        body:
            "You'll lose what you've written if you leave now. This action cannot be undone.",
        confirmLabel: 'Discard',
      ),
    );
    if (confirmed == true && mounted) Navigator.of(context).pop();
  }

  bool get _formIsValid => _isValid(_buildBody(), notify: false);

  Map<String, dynamic> _buildBody() {
    return switch (widget.type) {
      ConnectPostType.leadership => {
        'text': _text.text,
        'mediaKind': _hasMedia ? _mediaKindForSelection() : 'none',
        'mediaTitle': _mediaTitle.text.isEmpty
            ? _selectedMedia?.name ?? ''
            : _mediaTitle.text,
        'mediaDuration': _mediaKindForSelection() == 'video' ? '0:30' : '',
        'linkUrl': _linkUrl.text,
        'linkTitle': _linkUrl.text.isEmpty ? '' : 'Link preview',
        'linkDomain': _linkUrl.text.replaceFirst(RegExp(r'https?://'), ''),
      },
      ConnectPostType.newPost => {
        'postKind': _newPostKind,
        'text': _text.text,
        'mediaKind': _newPostKind == 'media' && _hasMedia
            ? _mediaKindForSelection()
            : 'none',
        'mediaTitle': _mediaTitle.text.isEmpty
            ? _selectedMedia?.name ?? ''
            : _mediaTitle.text,
        'mediaDuration': '',
        'linkUrl': _newPostKind == 'link' ? _linkUrl.text : '',
        'linkTitle': _newPostKind == 'link' && _linkUrl.text.isNotEmpty
            ? 'Link preview'
            : '',
        'linkDomain': _newPostKind == 'link'
            ? _linkUrl.text.replaceFirst(RegExp(r'https?://'), '')
            : '',
        'sendTo': _sendTo,
        'sendToDepartment': _sendTo == 'my_team' ? widget.department ?? '' : '',
        // Tags belong to media posts only.
        'taggedUserIds': _newPostKind == 'media'
            ? _taggedUserIds
            : const <String>[],
      },
      ConnectPostType.hrAnnouncement => {
        'title': _mediaTitle.text,
        'text': _text.text,
        'severity': 'plain',
        'sendTo': _sendTo,
        'sendToDepartment': _sendTo == 'my_team' ? widget.department ?? '' : '',
        'requireAcknowledgement': _requireAcknowledgement,
        if (_requireAcknowledgement)
          'acknowledgementMessage': _acknowledgementMessage.text.trim(),
      },
      ConnectPostType.kudos => {
        'personName': _person.text,
        'personInitials': _initials(_person.text),
        'text': _text.text,
      },
      ConnectPostType.survey => {
        'title': _pollDraft?.question.trim() ?? '',
        'options': (_pollDraft?.options ?? const <_PollOptionEntry>[])
            .map((option) => option.text.trim())
            .where((value) => value.isNotEmpty)
            .toList(),
        'sendTo': _sendTo,
        'sendToDepartment': _sendTo == 'my_team' ? widget.department ?? '' : '',
      },
      ConnectPostType.event => {
        'title': _title.text,
        'subtitle':
            '${_formatComposerDate(_eventDate)} · ${_eventTime.format(context)} · ${_location.text}',
        'category': _eventCategory,
        'date': _dateOnly(_eventDate),
        'time': _formatTimeValue(_eventTime),
        'location': _location.text,
        'prize': _prize.text,
        'allowRegistration': _allowRegistration,
        'actionLabel': _allowRegistration ? 'Register' : '',
        'actionDoneLabel': _allowRegistration ? 'Registered' : '',
      },
      ConnectPostType.recommendation => {
        'text': _text.text,
        'mediaTitle': _mediaTitle.text,
        'mediaKind': 'none',
        'mediaDuration': '',
        'linkUrl': _linkUrl.text,
        'linkTitle': _linkUrl.text.isEmpty ? '' : 'Link preview',
        'linkDomain': _linkUrl.text.replaceFirst(RegExp(r'https?://'), ''),
      },
      _ => {'text': _text.text},
    };
  }

  void _submit() {
    final body = _buildBody();
    if (!_isValid(body)) return;
    Navigator.of(context).pop(
      ConnectPostDraft(
        type: widget.type,
        media: _mediaForSubmit(),
        mediaList: _mediaListForSubmit(),
        pollOptionImages: _pollOptionImagesForSubmit(),
        removeMedia: _removeMediaForSubmit(),
        body: body,
      ),
    );
  }

  /// Local file paths picked in the poll editor, turned into attachments the
  /// same way `_pickMedia` builds one — only when the poll is actually in
  /// image mode, parallel to `_pollDraft.options` by index.
  List<ConnectMediaAttachment?> _pollOptionImagesForSubmit() {
    final poll = _pollDraft;
    if (poll == null) return const [];
    return poll.options
        .map(
          (option) => option.isImage && option.imagePath != null
              ? ConnectMediaAttachment(
                  path: option.imagePath!,
                  name: option.imagePath!.split('/').last,
                  size: File(option.imagePath!).lengthSync(),
                  mimeType: _mimeTypeFor(option.imagePath!.split('.').last),
                )
              : null,
        )
        .toList();
  }

  ConnectMediaAttachment? _mediaForSubmit() {
    if (_extraMedia.isNotEmpty) return null;
    if (widget.type == ConnectPostType.leadership) return _selectedMedia;
    if (widget.type == ConnectPostType.newPost && _newPostKind == 'media') {
      return _selectedMedia;
    }
    return null;
  }

  List<ConnectMediaAttachment> _mediaListForSubmit() {
    if (_extraMedia.isEmpty) return const [];
    return [?_selectedMedia, ..._extraMedia];
  }

  bool _removeMediaForSubmit() {
    if (_removeExistingMedia) return true;
    if (widget.type == ConnectPostType.newPost && _newPostKind != 'media') {
      return _bodyValue('mediaObjectKey').isNotEmpty;
    }
    if (widget.type == ConnectPostType.recommendation) {
      return _bodyValue('mediaObjectKey').isNotEmpty;
    }
    return false;
  }

  Future<void> _pickEventDate() async {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final selected = await showDatePicker(
      context: context,
      initialDate: _eventDate,
      firstDate: today,
      lastDate: today.add(const Duration(days: 730)),
    );
    if (selected == null) return;
    setState(() => _eventDate = selected);
  }

  Future<void> _pickEventTime() async {
    final selected = await showTimePicker(
      context: context,
      initialTime: _eventTime,
    );
    if (selected == null) return;
    setState(() => _eventTime = selected);
  }

  String _mediaKindForSelection() {
    final selected = _selectedMedia?.mimeType;
    if (selected != null) {
      if (selected.startsWith('video/')) return 'video';
      if (selected.startsWith('image/')) return 'image';
    }
    final existing = _bodyValue('mediaKind');
    return existing == 'video' || existing == 'image' ? existing : 'image';
  }

  Future<void> _pickMedia() async {
    final result = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov'],
      withData: false,
    );
    final file = result?.files.single;
    if (file == null) return;
    var path = file.path;
    if (path == null || path.isEmpty) {
      _showValidation('Could not read the selected file.');
      return;
    }
    // Images get a crop step so the author decides what the card shows; video
    // has no frame to crop and goes straight through.
    final mime = _mimeTypeFor(file.extension);
    if (mime.startsWith('image/') && mounted) {
      final cropped = await cropImageFile(
        context,
        path: path,
        title: 'Crop your photo',
        initial: CropShape.landscape,
      );
      if (cropped == null) return;
      path = cropped;
    }
    if (!mounted) return;
    setState(() {
      _selectedMedia = ConnectMediaAttachment(
        path: path!,
        name: file.name,
        size: file.size,
        mimeType: mime,
      );
      _mediaTitle.text = _mediaTitle.text.isEmpty
          ? file.name
          : _mediaTitle.text;
      _removeExistingMedia = false;
    });
  }

  void _removeMedia() {
    setState(() {
      _selectedMedia = null;
      _extraMedia.clear();
      _removeExistingMedia = _bodyValue('mediaObjectKey').isNotEmpty;
    });
  }

  static const _maxMediaCount = 6;

  Future<void> _pickExtraMedia() async {
    final remaining = _maxMediaCount - 1 - _extraMedia.length;
    if (remaining <= 0) return;
    final result = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['jpg', 'jpeg', 'png', 'webp'],
      withData: false,
      allowMultiple: true,
    );
    final files = result?.files.take(remaining) ?? const [];
    final picked = <ConnectMediaAttachment>[];
    for (final file in files) {
      var path = file.path;
      if (path == null || path.isEmpty) continue;
      if (!mounted) return;
      final cropped = await cropImageFile(
        context,
        path: path,
        title: 'Crop ${file.name}',
        initial: CropShape.landscape,
      );
      if (cropped == null) continue;
      path = cropped;
      picked.add(
        ConnectMediaAttachment(
          path: path,
          name: file.name,
          size: file.size,
          mimeType: _mimeTypeFor(file.extension),
        ),
      );
    }
    if (picked.isEmpty) return;
    setState(() => _extraMedia.addAll(picked));
  }

  void _removeExtraMedia(int index) {
    setState(() => _extraMedia.removeAt(index));
  }

  bool _isValid(Map<String, dynamic> body, {bool notify = true}) {
    void warn(String message) {
      if (notify) _showValidation(message);
    }

    // A media post is substantive content on its own — once a photo/video is
    // actually attached, the caption is optional (matches how the "Add
    // Media" flow is expected to work: pick media, post, no caption needed).
    final isMediaKindWithAttachment =
        widget.type == ConnectPostType.newPost &&
        _newPostKind == 'media' &&
        _hasMedia;
    // Kudos is substantive once a teammate is picked — recognising them is
    // the point, the message is supplementary detail, not a gate.
    final isKudosWithPerson =
        widget.type == ConnectPostType.kudos && _person.text.trim().isNotEmpty;
    // A recommendation is substantive as soon as any one of its three fields
    // is filled — link, title and body each stand on their own.
    final isRecommendationWithLink =
        widget.type == ConnectPostType.recommendation &&
        (_linkUrl.text.trim().isNotEmpty || _mediaTitle.text.trim().isNotEmpty);
    final text = (body['text'] ?? body['title'] ?? '').toString().trim();
    if (text.isEmpty &&
        !isMediaKindWithAttachment &&
        !isKudosWithPerson &&
        !isRecommendationWithLink) {
      warn('Add the required text before publishing.');
      return false;
    }
    if (widget.type == ConnectPostType.newPost) {
      if (_newPostKind == 'link' && _linkUrl.text.trim().isEmpty) {
        warn('Add the link before publishing.');
        return false;
      }
      if (_newPostKind == 'media' && !_hasMedia) {
        warn('Select a photo or video before publishing.');
        return false;
      }
    }
    if (widget.type == ConnectPostType.kudos && _person.text.trim().isEmpty) {
      warn('Select a teammate to recognise before publishing.');
      return false;
    }
    if (widget.type == ConnectPostType.survey) {
      final options = body['options'] as List<String>;
      if (options.length < 2) {
        warn('Add at least two poll options.');
        return false;
      }
    }
    if (widget.type == ConnectPostType.event && _location.text.trim().isEmpty) {
      warn('Add the event location before publishing.');
      return false;
    }
    return true;
  }

  void _showValidation(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        behavior: SnackBarBehavior.floating,
        backgroundColor: _ConnectColors.ink,
      ),
    );
  }
}

const List<List<Color>> _commentAvatarGradients = [
  [Color(0xFF667EEA), Color(0xFF764BA2)],
  [Color(0xFFF093FB), Color(0xFFF5576C)],
  [Color(0xFF43E97B), Color(0xFF38F9D7)],
  [Color(0xFFFA709A), Color(0xFFFEE140)],
  [Color(0xFFA18CD1), Color(0xFFFBC2EB)],
];

List<Color> _gradientFor(String seed) {
  final sum = seed.codeUnits.fold<int>(0, (total, unit) => total + unit);
  return _commentAvatarGradients[sum % _commentAvatarGradients.length];
}

/// Full comment thread, opened from the feed card's comment icon or an
/// inline comment preview. Subscribes to the bloc directly so newly posted
/// comments (and the live/count) show up immediately without closing the
/// sheet.
class _CommentsSheet extends StatefulWidget {
  const _CommentsSheet({
    required this.bloc,
    required this.postId,
    required this.viewerInitials,
    required this.viewerColor,
    this.viewerPhotoUrl = '',
  });

  final ConnectBloc bloc;
  final String postId;
  final String viewerInitials;
  final Color viewerColor;
  final String viewerPhotoUrl;

  @override
  State<_CommentsSheet> createState() => _CommentsSheetState();
}

class _CommentsSheetState extends State<_CommentsSheet> {
  final _controller = TextEditingController();
  final _focusNode = FocusNode();
  final Set<String> _expandedThreadIds = {};
  String? _replyingToId;
  String? _replyingToName;

  @override
  void dispose() {
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  void _reply(String commentId, String name) {
    final firstName = name.split(' ').first;
    _replyingToId = commentId;
    _replyingToName = name;
    setState(() {});
    _controller.value = TextEditingValue(
      text: '@$firstName ',
      selection: TextSelection.collapsed(offset: firstName.length + 2),
    );
    _focusNode.requestFocus();
  }

  void _insertEmoji(String emoji) {
    final value = _controller.value;
    final selection = value.selection.isValid
        ? value.selection
        : TextSelection.collapsed(offset: value.text.length);
    final newText = value.text.replaceRange(
      selection.start,
      selection.end,
      emoji,
    );
    _controller.value = TextEditingValue(
      text: newText,
      selection: TextSelection.collapsed(
        offset: selection.start + emoji.length,
      ),
    );
    _focusNode.requestFocus();
  }

  void _cancelReply() {
    setState(() {
      _replyingToId = null;
      _replyingToName = null;
      _controller.clear();
    });
  }

  void _submit() {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    widget.bloc.addComment(widget.postId, text, parentId: _replyingToId);
    _controller.clear();
    setState(() {
      _replyingToId = null;
      _replyingToName = null;
    });
  }

  void _toggleThread(String commentId) {
    setState(() {
      if (!_expandedThreadIds.add(commentId)) {
        _expandedThreadIds.remove(commentId);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<ConnectState>(
      stream: widget.bloc.stream,
      initialData: widget.bloc.state,
      builder: (context, snapshot) {
        final post = (snapshot.data ?? widget.bloc.state).posts
            .where((item) => item.id == widget.postId)
            .firstOrNull;
        if (post == null) return const SizedBox.shrink();
        final busy =
            (snapshot.data ?? widget.bloc.state).busyPostId == widget.postId;
        return DraggableScrollableSheet(
          initialChildSize: 0.75,
          minChildSize: 0.4,
          maxChildSize: 0.92,
          expand: false,
          builder: (context, scrollController) {
            return Container(
              decoration: const BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
                boxShadow: [
                  BoxShadow(
                    color: Color(0x1F000000),
                    blurRadius: 16,
                    offset: Offset(0, -4),
                  ),
                ],
              ),
              child: Column(
                children: [
                  const Padding(
                    padding: EdgeInsets.only(top: 12, bottom: 4),
                    child: Center(
                      child: SizedBox(
                        width: 40,
                        height: 4,
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            color: Color(0xFFD1D5DB),
                            borderRadius: BorderRadius.all(Radius.circular(99)),
                          ),
                        ),
                      ),
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 20,
                      vertical: 12,
                    ),
                    decoration: const BoxDecoration(
                      border: Border(
                        bottom: BorderSide(color: Color(0xFFF3F4F6)),
                      ),
                    ),
                    child: Center(
                      child: RichText(
                        text: TextSpan(
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                            letterSpacing: -0.16,
                          ),
                          children: [
                            const TextSpan(
                              text: 'Comments · ',
                              style: TextStyle(color: Color(0xFF222222)),
                            ),
                            TextSpan(
                              text: '${post.commentCount}',
                              style: const TextStyle(color: Color(0xFF717171)),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  Expanded(
                    child: post.comments.isEmpty
                        ? const Center(
                            child: Text(
                              'No comments yet — say something first.',
                              style: TextStyle(
                                color: _ConnectColors.faint,
                                fontSize: 13.5,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          )
                        : Builder(
                            builder: (context) {
                              final topLevel = _topLevelComments(post);
                              final repliesByParent = _repliesByParent(post);
                              return ListView.builder(
                                controller: scrollController,
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 20,
                                ),
                                itemCount: topLevel.length,
                                itemBuilder: (context, index) {
                                  final comment = topLevel[index];
                                  final replies =
                                      repliesByParent[comment.id] ??
                                      const <ConnectComment>[];
                                  final expanded = _expandedThreadIds.contains(
                                    comment.id,
                                  );
                                  return Container(
                                    padding: const EdgeInsets.only(
                                      top: 12,
                                      bottom: 12,
                                    ),
                                    decoration: const BoxDecoration(
                                      border: Border(
                                        bottom: BorderSide(
                                          color: Color(0xFFF7F7F9),
                                        ),
                                      ),
                                    ),
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        _buildCommentRow(comment),
                                        if (replies.isNotEmpty)
                                          if (expanded) ...[
                                            for (final reply in replies)
                                              _buildReplyRow(comment, reply),
                                            _buildHideRepliesToggle(comment.id),
                                          ] else
                                            _buildViewRepliesToggle(
                                              comment.id,
                                              replies.length,
                                            ),
                                      ],
                                    ),
                                  );
                                },
                              );
                            },
                          ),
                  ),
                  Container(
                    height: 54,
                    padding: const EdgeInsets.symmetric(horizontal: 20),
                    decoration: const BoxDecoration(
                      border: Border(top: BorderSide(color: Color(0xFFF3F4F6))),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        for (final emoji in const [
                          '❤️',
                          '🙌',
                          '🔥',
                          '👏',
                          '😍',
                          '🎉',
                          '💯',
                          '😂',
                        ])
                          InkWell(
                            borderRadius: BorderRadius.circular(99),
                            onTap: () => _insertEmoji(emoji),
                            child: Padding(
                              padding: const EdgeInsets.all(4),
                              child: Text(
                                emoji,
                                style: const TextStyle(fontSize: 22),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                  SafeArea(
                    top: false,
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (_replyingToId != null)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 8),
                              child: Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                      'Replying to ${_replyingToName ?? ''}',
                                      style: const TextStyle(
                                        color: Color(0xFF717171),
                                        fontSize: 12,
                                        fontWeight: FontWeight.w600,
                                      ),
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                  GestureDetector(
                                    onTap: _cancelReply,
                                    child: const Icon(
                                      Icons.close_rounded,
                                      size: 16,
                                      color: Color(0xFF717171),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          Row(
                            children: [
                              _InitialAvatar(
                                initials: widget.viewerInitials,
                                color: widget.viewerColor,
                                photoUrl: widget.viewerPhotoUrl,
                                size: 32,
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: TextField(
                                  controller: _controller,
                                  focusNode: _focusNode,
                                  minLines: 1,
                                  maxLines: 3,
                                  textInputAction: TextInputAction.send,
                                  onSubmitted: (_) => _submit(),
                                  decoration: InputDecoration(
                                    hintText: 'Write a comment...',
                                    hintStyle: const TextStyle(
                                      color: Color(0xFF717171),
                                      fontSize: 13,
                                    ),
                                    filled: true,
                                    fillColor: const Color(0xFFF7F7F9),
                                    contentPadding: const EdgeInsets.symmetric(
                                      horizontal: 16,
                                      vertical: 12,
                                    ),
                                    suffixIcon: IconButton(
                                      icon: const Icon(
                                        Icons.send_rounded,
                                        size: 18,
                                      ),
                                      color: _ConnectColors.blue,
                                      onPressed: busy ? null : _submit,
                                    ),
                                    enabledBorder: OutlineInputBorder(
                                      borderRadius: BorderRadius.circular(99),
                                      borderSide: const BorderSide(
                                        color: Color(0xFFEBEBEB),
                                      ),
                                    ),
                                    focusedBorder: OutlineInputBorder(
                                      borderRadius: BorderRadius.circular(99),
                                      borderSide: const BorderSide(
                                        color: _ConnectColors.blue,
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  List<ConnectComment> _topLevelComments(ConnectPost post) {
    return post.comments.where((comment) => comment.parentId == null).toList();
  }

  Map<String, List<ConnectComment>> _repliesByParent(ConnectPost post) {
    final map = <String, List<ConnectComment>>{};
    for (final comment in post.comments) {
      final parentId = comment.parentId;
      if (parentId == null) continue;
      map.putIfAbsent(parentId, () => []).add(comment);
    }
    return map;
  }

  Widget _buildCommentRow(ConnectComment comment) {
    final gradient = _gradientFor(comment.id);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 40,
          height: 40,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: gradient,
            ),
          ),
          child: Text(
            _initials(comment.name),
            style: const TextStyle(
              color: Colors.white,
              fontSize: 14,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text(
                    comment.name,
                    style: const TextStyle(
                      color: Color(0xFF222222),
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    _timeAgo(comment.createdAt),
                    style: const TextStyle(
                      color: Color(0xFF717171),
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 2),
              LinkifiedText(
                comment.text,
                style: const TextStyle(
                  color: Color(0xFF484848),
                  fontSize: 14,
                  height: 20 / 14,
                ),
              ),
              const SizedBox(height: 6),
              GestureDetector(
                onTap: () => _reply(comment.id, comment.name),
                child: const Text(
                  'Reply',
                  style: TextStyle(
                    color: Color(0xFF717171),
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        _CommentLikeButton(
          liked: comment.liked,
          count: comment.likeCount,
          onTap: () => widget.bloc.reactToComment(widget.postId, comment.id),
        ),
      ],
    );
  }

  /// Nested reply row — same structure as a top-level comment but scaled
  /// down (24px avatar, smaller type) and indented, per the Figma reply
  /// spec. `topLevelComment` is always the thread's root: replying from a
  /// reply row still targets the thread root as `parentId` (one level of
  /// nesting only, enforced server-side), the UI just makes it *feel* like
  /// you replied to the reply via the `_reply` call's `@FirstName` prefix.
  Widget _buildReplyRow(ConnectComment topLevelComment, ConnectComment reply) {
    final gradient = _gradientFor(reply.id);
    return Padding(
      padding: const EdgeInsets.only(top: 6, left: 32),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 24,
            height: 24,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: gradient,
              ),
            ),
            child: Text(
              _initials(reply.name),
              style: const TextStyle(
                color: Colors.white,
                fontSize: 9,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(
                      reply.name,
                      style: const TextStyle(
                        color: Color(0xFF222222),
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      _timeAgo(reply.createdAt),
                      style: const TextStyle(
                        color: Color(0xFF717171),
                        fontSize: 10,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  reply.text,
                  style: const TextStyle(
                    color: Color(0xFF484848),
                    fontSize: 12,
                    height: 18 / 12,
                  ),
                ),
                const SizedBox(height: 4),
                GestureDetector(
                  onTap: () => _reply(topLevelComment.id, reply.name),
                  child: const Text(
                    'Reply',
                    style: TextStyle(
                      color: Color(0xFF717171),
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildViewRepliesToggle(String threadId, int replyCount) {
    return Padding(
      padding: const EdgeInsets.only(top: 8, left: 32),
      child: GestureDetector(
        onTap: () => _toggleThread(threadId),
        behavior: HitTestBehavior.opaque,
        child: Row(
          children: [
            Container(width: 32, height: 1, color: const Color(0xFFD1D5DB)),
            const SizedBox(width: 8),
            Text(
              'View $replyCount more ${replyCount == 1 ? 'reply' : 'replies'}',
              style: const TextStyle(
                color: Color(0xFF717171),
                fontSize: 13,
                fontWeight: FontWeight.w400,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHideRepliesToggle(String threadId) {
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Center(
        child: GestureDetector(
          onTap: () => _toggleThread(threadId),
          child: const Text(
            'Hide reply',
            style: TextStyle(
              color: Color(0xFF717171),
              fontSize: 13,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ),
    );
  }
}

/// Heart + count on a top-level comment, per the comments-sheet spec.
class _CommentLikeButton extends StatelessWidget {
  const _CommentLikeButton({
    required this.liked,
    required this.count,
    required this.onTap,
  });

  final bool liked;
  final int count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(99),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.all(4),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SvgPicture.asset(
              liked
                  ? 'assets/icons/connect_icon_heart_filled.svg'
                  : 'assets/icons/connect_icon_heart_outline.svg',
              width: 16,
              height: 16,
            ),
            if (count > 0) ...[
              const SizedBox(height: 2),
              Text(
                '$count',
                style: const TextStyle(
                  color: Color(0xFF9197A2),
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Centered confirmation dialog (item 9) — shared between "delete a
/// published post" and "discard an unsaved draft" since both are a
/// destructive irreversible confirm/cancel choice with identical chrome.
class _DeletePostSheet extends StatelessWidget {
  const _DeletePostSheet({
    required this.title,
    required this.body,
    this.confirmLabel = 'Delete',
  });

  final String title;
  final String body;
  final String confirmLabel;

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: const EdgeInsets.symmetric(horizontal: 24),
      child: Container(
        width: 320,
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(24),
          boxShadow: const [
            BoxShadow(
              color: Color(0x33000000),
              blurRadius: 16,
              offset: Offset(0, 16),
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 56,
              height: 56,
              alignment: Alignment.center,
              decoration: const BoxDecoration(
                color: Color(0x12DF2C2C),
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.delete_outline_rounded,
                color: Color(0xFFDF2C2C),
                size: 28,
              ),
            ),
            const SizedBox(height: 16),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Color(0xFF1A1C1E),
                fontSize: 20,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              body,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Color(0xFF6C727A),
                fontSize: 14,
                fontWeight: FontWeight.w400,
                height: 1.4,
              ),
            ),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              height: 46,
              child: FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: const Color(0xFFDF2C2C),
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  textStyle: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                onPressed: () => Navigator.of(context).pop(true),
                child: Text(confirmLabel),
              ),
            ),
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              height: 46,
              child: OutlinedButton(
                style: OutlinedButton.styleFrom(
                  foregroundColor: const Color(0xFF1A1C1E),
                  side: const BorderSide(color: Color(0xFFE8E8EC), width: 1.5),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  textStyle: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                onPressed: () => Navigator.of(context).pop(false),
                child: const Text('Cancel'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SheetShell extends StatelessWidget {
  const _SheetShell({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.bottomCenter,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * 0.86,
        ),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.fromLTRB(18, 12, 18, 20),
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
          ),
          child: child,
        ),
      ),
    );
  }
}

class _SheetHandle extends StatelessWidget {
  const _SheetHandle();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        width: 36,
        height: 4,
        margin: const EdgeInsets.only(bottom: 16),
        decoration: BoxDecoration(
          color: const Color(0xFFE7DDCD),
          borderRadius: BorderRadius.circular(99),
        ),
      ),
    );
  }
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        label,
        style: const TextStyle(
          color: Color(0xFF717171),
          fontSize: 11,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.9,
        ),
      ),
    );
  }
}

/// What the link resolved to, shown in the composer so the author sees the
/// card before they post it rather than after.
class _LinkPreviewCard extends StatelessWidget {
  const _LinkPreviewCard({required this.preview, required this.loading});

  final Map<String, String>? preview;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    final imageUrl = preview?['imageUrl'] ?? '';
    final title = preview?['title'] ?? '';
    final site = preview?['siteName'] ?? '';
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: const Color(0xFFF7F7F9),
        border: Border.all(color: const Color(0xFFEBEBEB)),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(9),
            child: SizedBox(
              width: 68,
              height: 68,
              child: loading
                  ? const Center(
                      child: SizedBox(
                        width: 18, height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    )
                  : imageUrl.isEmpty
                      ? Container(
                          color: _ConnectColors.sand,
                          child: const Icon(Icons.link_rounded, color: Colors.white70),
                        )
                      : Image(image: _remoteImage(imageUrl), fit: BoxFit.cover),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  loading
                      ? 'Fetching preview…'
                      : (title.isNotEmpty ? title : 'Preview ready'),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 14, fontWeight: FontWeight.w700, color: Color(0xFF222222),
                  ),
                ),
                if (!loading && site.isNotEmpty) ...[
                  const SizedBox(height: 3),
                  Text(
                    site,
                    style: const TextStyle(fontSize: 12.5, color: Color(0xFF717171)),
                  ),
                ],
                if (!loading && imageUrl.isEmpty) ...[
                  const SizedBox(height: 3),
                  const Text(
                    'This link has no artwork — the card will show without it.',
                    style: TextStyle(fontSize: 12, color: Color(0xFF9197A2)),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ComposerTextField extends StatelessWidget {
  const _ComposerTextField({
    required this.controller,
    required this.hint,
    required this.minLines,
    this.keyboardType,
  });

  final TextEditingController controller;
  final String hint;
  final int minLines;
  final TextInputType? keyboardType;

  @override
  Widget build(BuildContext context) {
    // Explicit border overrides so only Connect's composer diverges from
    // main.dart's app-wide input theme (radius 18 / terra focus) — that
    // global theme stays untouched and keeps applying everywhere else.
    const border = OutlineInputBorder(
      borderRadius: BorderRadius.all(Radius.circular(12)),
      borderSide: BorderSide(color: Color(0xFFEBEBEB)),
    );
    return TextField(
      controller: controller,
      minLines: minLines,
      maxLines: minLines == 1 ? 1 : 7,
      keyboardType: keyboardType,
      textInputAction: minLines == 1
          ? TextInputAction.next
          : TextInputAction.newline,
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: const TextStyle(color: _ConnectColors.faint, fontSize: 13),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 14,
          vertical: 13,
        ),
        border: border,
        enabledBorder: border,
        focusedBorder: const OutlineInputBorder(
          borderRadius: BorderRadius.all(Radius.circular(12)),
          borderSide: BorderSide(color: _ConnectColors.blue, width: 1.5),
        ),
      ),
      style: const TextStyle(
        color: _ConnectColors.ink,
        fontSize: 14,
        height: 1.45,
      ),
    );
  }
}

class _ChipChoice extends StatelessWidget {
  const _ChipChoice({
    required this.value,
    required this.values,
    required this.onChanged,
  });

  final String value;
  final List<(String, String)> values;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: values.map((item) {
        final selected = value == item.$1;
        return InkWell(
          borderRadius: BorderRadius.circular(99),
          onTap: () => onChanged(item.$1),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
            decoration: BoxDecoration(
              color: selected ? _ConnectColors.blue : Colors.white,
              borderRadius: BorderRadius.circular(99),
              border: Border.all(
                color: selected ? _ConnectColors.blue : const Color(0xFFEBEBEB),
                width: 1.5,
              ),
              boxShadow: selected
                  ? const [
                      BoxShadow(
                        color: Color(0x59A9D8FF),
                        blurRadius: 5,
                        offset: Offset(0, 3),
                      ),
                    ]
                  : null,
            ),
            child: Text(
              item.$2,
              style: TextStyle(
                color: selected ? Colors.white : const Color(0xFF484848),
                fontSize: 13,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        );
      }).toList(),
    );
  }
}

class _SegmentedChoice extends StatelessWidget {
  const _SegmentedChoice({
    required this.value,
    required this.values,
    required this.onChanged,
  });

  final String value;
  final List<(String, String)> values;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: values.map((item) {
        final selected = value == item.$1;
        return InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: () => onChanged(item.$1),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: selected ? _ConnectColors.goldTint : Colors.white,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: selected
                    ? _ConnectColors.gold
                    : _ConnectColors.cardBorder,
                width: 1.5,
              ),
            ),
            child: Text(
              item.$2,
              style: TextStyle(
                color: selected ? _ConnectColors.gold : _ConnectColors.inkSoft,
                fontSize: 13,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        );
      }).toList(),
    );
  }
}

/// Multi-select "tag people" control for media posts: shows who's tagged and
/// opens a searchable sheet to change the selection.
class _TagPeopleField extends StatelessWidget {
  const _TagPeopleField({
    required this.teammates,
    required this.selectedUserIds,
    required this.onChanged,
  });

  final List<ConnectTeammate> teammates;
  final List<String> selectedUserIds;
  final ValueChanged<List<String>> onChanged;

  Future<void> _open(BuildContext context) async {
    final picked = await showModalBottomSheet<List<String>>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => _TagPeopleSheet(
        teammates: teammates,
        selectedUserIds: selectedUserIds,
      ),
    );
    if (picked != null) onChanged(picked);
  }

  @override
  Widget build(BuildContext context) {
    final selected = teammates
        .where((teammate) => selectedUserIds.contains(teammate.userId))
        .toList();
    return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: () => _open(context),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: _ConnectColors.cardBorder),
        ),
        child: Row(
          children: [
            Expanded(
              child: selected.isEmpty
                  ? const Text(
                      'Tag people in this post',
                      style: TextStyle(
                        color: _ConnectColors.faint,
                        fontSize: 14,
                        fontWeight: FontWeight.w500,
                      ),
                    )
                  : Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: selected
                          .map(
                            (teammate) => Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 10,
                                vertical: 5,
                              ),
                              decoration: BoxDecoration(
                                color: const Color(0xFFEAF4FA),
                                borderRadius: BorderRadius.circular(99),
                              ),
                              child: Text(
                                teammate.name,
                                style: const TextStyle(
                                  color: Color(0xFF0571A6),
                                  fontSize: 13,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          )
                          .toList(),
                    ),
            ),
            const SizedBox(width: 8),
            const Icon(
              Icons.person_add_alt_1_rounded,
              size: 20,
              color: _ConnectColors.faint,
            ),
          ],
        ),
      ),
    );
  }
}

class _TagPeopleSheet extends StatefulWidget {
  const _TagPeopleSheet({
    required this.teammates,
    required this.selectedUserIds,
  });

  final List<ConnectTeammate> teammates;
  final List<String> selectedUserIds;

  @override
  State<_TagPeopleSheet> createState() => _TagPeopleSheetState();
}

class _TagPeopleSheetState extends State<_TagPeopleSheet> {
  late final List<String> _selected = [...widget.selectedUserIds];
  final _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final query = _search.text.trim().toLowerCase();
    // Only teammates with a real id can be tagged — a tag has to resolve to a
    // profile.
    final options = widget.teammates
        .where((teammate) => teammate.userId.isNotEmpty)
        .where(
          (teammate) =>
              query.isEmpty || teammate.name.toLowerCase().contains(query),
        )
        .toList();
    return SafeArea(
      top: false,
      child: Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(context).viewInsets.bottom,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 12),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: const Color(0xFFD1D5DB),
                borderRadius: BorderRadius.circular(99),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: TextField(
                controller: _search,
                onChanged: (_) => setState(() {}),
                decoration: const InputDecoration(
                  hintText: 'Search people',
                  prefixIcon: Icon(Icons.search_rounded, size: 20),
                ),
              ),
            ),
            Flexible(
              child: options.isEmpty
                  ? const Padding(
                      padding: EdgeInsets.all(24),
                      child: Text('No one to tag.'),
                    )
                  : ListView.builder(
                      shrinkWrap: true,
                      itemCount: options.length,
                      itemBuilder: (context, index) {
                        final teammate = options[index];
                        final checked = _selected.contains(teammate.userId);
                        return CheckboxListTile(
                          value: checked,
                          controlAffinity: ListTileControlAffinity.trailing,
                          onChanged: (_) => setState(() {
                            if (checked) {
                              _selected.remove(teammate.userId);
                            } else {
                              _selected.add(teammate.userId);
                            }
                          }),
                          secondary: _TeammateAvatar(teammate: teammate),
                          title: Text(
                            teammate.name,
                            style: const TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          subtitle: teammate.department.isEmpty
                              ? null
                              : Text(teammate.department),
                        );
                      },
                    ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () => Navigator.of(context).pop(_selected),
                  child: Text(
                    _selected.isEmpty ? 'Done' : 'Tag ${_selected.length}',
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TeammateAvatar extends StatelessWidget {
  const _TeammateAvatar({required this.teammate});

  final ConnectTeammate teammate;

  @override
  Widget build(BuildContext context) {
    final photo = teammate.photoUrl;
    if (photo == null || photo.isEmpty) {
      return CircleAvatar(
        radius: 18,
        backgroundColor: const Color(0xFFEAF4FA),
        child: Text(
          teammate.initials,
          style: const TextStyle(
            color: Color(0xFF0571A6),
            fontWeight: FontWeight.w700,
          ),
        ),
      );
    }
    return ClipOval(
      child: Image(
        image: _remoteImage(photo),
        width: 36,
        height: 36,
        fit: BoxFit.cover,
      ),
    );
  }
}

class _TeammateSelector extends StatefulWidget {
  const _TeammateSelector({
    required this.teammates,
    required this.selectedName,
    required this.onChanged,
  });

  final List<ConnectTeammate> teammates;
  final String selectedName;
  final ValueChanged<String> onChanged;

  @override
  State<_TeammateSelector> createState() => _TeammateSelectorState();
}

class _TeammateSelectorState extends State<_TeammateSelector> {
  final _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  ConnectTeammate? get _selected {
    if (widget.selectedName.isEmpty) return null;
    for (final teammate in widget.teammates) {
      if (teammate.name == widget.selectedName) return teammate;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    if (widget.teammates.isEmpty) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: _ConnectColors.cardBorder),
        ),
        child: const Text(
          'No teammates available',
          style: TextStyle(
            color: _ConnectColors.inkSoft,
            fontSize: 13,
            fontWeight: FontWeight.w700,
          ),
        ),
      );
    }

    final selected = _selected;
    if (selected != null) {
      return _TeammateRow(
        teammate: selected,
        trailing: IconButton(
          onPressed: () => widget.onChanged(''),
          icon: const Icon(Icons.close_rounded),
          color: const Color(0xFF717171),
        ),
      );
    }

    final query = _search.text.trim().toLowerCase();
    final filtered = query.isEmpty
        ? widget.teammates
        : widget.teammates
              .where((t) => t.name.toLowerCase().contains(query))
              .toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextField(
          controller: _search,
          onChanged: (_) => setState(() {}),
          decoration: InputDecoration(
            hintText: 'Search teammates...',
            hintStyle: const TextStyle(
              color: _ConnectColors.faint,
              fontSize: 13,
            ),
            prefixIcon: const Icon(
              Icons.search_rounded,
              color: Color(0xFF717171),
            ),
            contentPadding: const EdgeInsets.symmetric(vertical: 13),
            border: const OutlineInputBorder(
              borderRadius: BorderRadius.all(Radius.circular(12)),
              borderSide: BorderSide(color: Color(0xFFEBEBEB)),
            ),
            enabledBorder: const OutlineInputBorder(
              borderRadius: BorderRadius.all(Radius.circular(12)),
              borderSide: BorderSide(color: Color(0xFFEBEBEB)),
            ),
            focusedBorder: const OutlineInputBorder(
              borderRadius: BorderRadius.all(Radius.circular(12)),
              borderSide: BorderSide(color: _ConnectColors.blue, width: 1.5),
            ),
          ),
          style: const TextStyle(color: _ConnectColors.ink, fontSize: 14),
        ),
        const SizedBox(height: 10),
        Container(
          constraints: const BoxConstraints(maxHeight: 280),
          decoration: BoxDecoration(
            border: Border.all(color: const Color(0xFFEBEBEB)),
            borderRadius: BorderRadius.circular(14),
          ),
          child: filtered.isEmpty
              ? const Padding(
                  padding: EdgeInsets.all(16),
                  child: Text(
                    'No teammates match your search.',
                    style: TextStyle(
                      color: _ConnectColors.inkSoft,
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                )
              : ListView.separated(
                  shrinkWrap: true,
                  padding: EdgeInsets.zero,
                  itemCount: filtered.length,
                  separatorBuilder: (_, _) => const Divider(
                    height: 1,
                    thickness: 1,
                    color: Color(0xFFF5F5F5),
                  ),
                  itemBuilder: (context, index) {
                    final teammate = filtered[index];
                    return InkWell(
                      onTap: () => widget.onChanged(teammate.name),
                      child: _TeammateRow(teammate: teammate),
                    );
                  },
                ),
        ),
      ],
    );
  }
}

class _TeammateRow extends StatelessWidget {
  const _TeammateRow({required this.teammate, this.trailing});

  final ConnectTeammate teammate;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final row = Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        children: [
          _InitialAvatar(
            initials: teammate.initials,
            color: _avatarColorFor(teammate.name),
            size: 36,
            photoUrl: teammate.photoUrl ?? '',
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  teammate.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFF222222),
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (teammate.department.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    teammate.department,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Color(0xFF717171),
                      fontSize: 12,
                      fontWeight: FontWeight.w400,
                    ),
                  ),
                ],
              ],
            ),
          ),
          ?trailing,
        ],
      ),
    );
    if (trailing == null) return row;
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: const Color(0xFFEBEBEB)),
        borderRadius: BorderRadius.circular(14),
      ),
      child: row,
    );
  }
}

class _PickerField extends StatelessWidget {
  const _PickerField({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: onTap,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: _ConnectColors.cardBorder, width: 1.5),
        ),
        child: Row(
          children: [
            Icon(icon, color: _ConnectColors.terra, size: 20),
            const SizedBox(width: 10),
            Text(
              label,
              style: const TextStyle(
                color: _ConnectColors.ink,
                fontSize: 14,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MediaToggle extends StatelessWidget {
  const _MediaToggle({
    required this.enabled,
    required this.onTap,
    this.onRemove,
    this.selectedMedia,
    this.existingMediaKind,
    this.existingMediaUrl,
  });

  final bool enabled;
  final VoidCallback onTap;
  final VoidCallback? onRemove;
  final ConnectMediaAttachment? selectedMedia;
  final String? existingMediaKind;
  final String? existingMediaUrl;

  @override
  Widget build(BuildContext context) {
    if (enabled) {
      // Bare full-bleed rounded preview, no caption/border chrome — matches
      // the "New Post-Media" spec (item 526:2474), which shows just the
      // photo. Remove/replace are overlay affordances instead of a row.
      return ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: Stack(
          children: [
            _preview(),
            Positioned.fill(
              child: Material(
                color: Colors.transparent,
                child: InkWell(onTap: onTap),
              ),
            ),
            Positioned(
              right: 10,
              top: 10,
              child: GestureDetector(
                onTap: onRemove,
                child: Container(
                  width: 30,
                  height: 30,
                  alignment: Alignment.center,
                  decoration: const BoxDecoration(
                    color: Color(0x99000000),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.close_rounded,
                    size: 18,
                    color: Colors.white,
                  ),
                ),
              ),
            ),
          ],
        ),
      );
    }
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFD9C9AE), width: 1.5),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.add_photo_alternate_rounded,
            color: _ConnectColors.terra,
            size: 25,
          ),
          const SizedBox(width: 12),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Add photo or video',
                  style: TextStyle(
                    color: _ConnectColors.ink,
                    fontSize: 12.5,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                SizedBox(height: 2),
                Text(
                  'JPEG, PNG, WEBP, MP4 or MOV',
                  style: TextStyle(
                    color: _ConnectColors.inkSoft,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: 'Select media',
            onPressed: onTap,
            icon: const Icon(Icons.upload_rounded),
            color: _ConnectColors.terra,
          ),
        ],
      ),
    );
  }

  Widget _preview() {
    // A photo is shown at the shape it was cropped to. Forcing 16:9 here meant
    // a square or portrait crop was sliced back into a wide strip, so what the
    // author framed and what they were shown disagreed.
    final media = selectedMedia;
    if (media != null && media.mimeType.startsWith('image/')) {
      return _AspectFrame(
        provider: FileImage(File(media.path)),
        child: Image.file(File(media.path), fit: BoxFit.cover),
      );
    }
    final url = existingMediaUrl;
    if (url != null && url.isNotEmpty && existingMediaKind == 'image') {
      return _AspectFrame(
        provider: _remoteImage(url),
        child: Image(image: _remoteImage(url), fit: BoxFit.cover),
      );
    }
    return AspectRatio(
      aspectRatio: 16 / 9,
      child: Container(
        color: _ConnectColors.sand,
        child: Stack(
          alignment: Alignment.center,
          children: [
            const Icon(
              Icons.play_circle_fill_rounded,
              color: _ConnectColors.terra,
              size: 58,
            ),
            Positioned(
              left: 12,
              bottom: 10,
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: Colors.black.withValues(alpha: 0.55),
                  borderRadius: BorderRadius.circular(99),
                ),
                child: const Text(
                  'Video selected',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Photos beyond the first one picked via [_MediaToggle] — a horizontal row
/// of thumbnails with per-item remove, plus a trailing "add more" tile.
class _ExtraPhotosRow extends StatelessWidget {
  const _ExtraPhotosRow({
    required this.photos,
    required this.canAddMore,
    required this.onAdd,
    required this.onRemove,
  });

  final List<ConnectMediaAttachment> photos;
  final bool canAddMore;
  final VoidCallback onAdd;
  final ValueChanged<int> onRemove;

  // Matches node 526:2474 exactly: 80×50 tiles, 4px radius, 8px gaps —
  // deliberately smaller than the hero photo above, not the same size.
  static const _tileWidth = 80.0;
  static const _tileHeight = 50.0;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: _tileHeight,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: [
          for (final (index, photo) in photos.indexed)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: Image.file(
                      File(photo.path),
                      width: _tileWidth,
                      height: _tileHeight,
                      fit: BoxFit.cover,
                    ),
                  ),
                  Positioned(
                    right: -6,
                    top: -6,
                    child: GestureDetector(
                      onTap: () => onRemove(index),
                      child: Container(
                        width: 20,
                        height: 20,
                        alignment: Alignment.center,
                        decoration: const BoxDecoration(
                          color: _ConnectColors.ink,
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(
                          Icons.close_rounded,
                          size: 12,
                          color: Colors.white,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          if (canAddMore)
            InkWell(
              borderRadius: BorderRadius.circular(4),
              onTap: onAdd,
              child: Container(
                width: _tileWidth,
                height: _tileHeight,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: const Color(0xFFF7F7F9),
                  borderRadius: BorderRadius.circular(4),
                  border: Border.all(color: const Color(0xFFEBEBEB)),
                ),
                child: const Icon(
                  Icons.add_rounded,
                  color: _ConnectColors.terra,
                  size: 22,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Shared composer header (item 1): a fixed dismiss button, either a bold
/// dedicated-sub-screen title or a general-composer audience selector, and
/// a small validity-gated submit pill — reused by [_PostComposerPage] and
/// [_PollEditorPage].
class _ComposerHeader extends StatelessWidget {
  const _ComposerHeader({
    required this.onDismiss,
    required this.submitLabel,
    required this.submitEnabled,
    required this.onSubmit,
    this.title,
    this.audienceLabel,
    this.onAudienceTap,
    this.viewerInitials = '',
    this.viewerColor = _ConnectColors.blue,
    this.viewerPhotoUrl = '',
  });

  final VoidCallback onDismiss;
  final String submitLabel;
  final bool submitEnabled;
  final VoidCallback onSubmit;
  final String? title;
  final String? audienceLabel;
  final VoidCallback? onAudienceTap;
  final String viewerInitials;
  final Color viewerColor;
  final String viewerPhotoUrl;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 60,
      padding: const EdgeInsets.symmetric(horizontal: 14),
      decoration: const BoxDecoration(
        border: Border(
          bottom: BorderSide(color: Color(0xFFF3F4F6), width: 1.114),
        ),
      ),
      child: Row(
        children: [
          _DismissButton(onTap: onDismiss),
          const SizedBox(width: 10),
          Expanded(
            child: title != null
                ? Text(
                    title!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Color(0xFF222222),
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.2,
                    ),
                  )
                : InkWell(
                    borderRadius: BorderRadius.circular(20),
                    onTap: onAudienceTap,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          _InitialAvatar(
                            initials: viewerInitials,
                            color: viewerColor,
                            photoUrl: viewerPhotoUrl,
                            size: 30,
                          ),
                          const SizedBox(width: 8),
                          Text(
                            audienceLabel ?? 'Public',
                            style: const TextStyle(
                              color: Color(0xFF484848),
                              fontSize: 16,
                              fontWeight: FontWeight.w400,
                              letterSpacing: 0.4,
                            ),
                          ),
                          const SizedBox(width: 2),
                          const Icon(
                            Icons.keyboard_arrow_down_rounded,
                            size: 18,
                            color: Color(0xFF717171),
                          ),
                        ],
                      ),
                    ),
                  ),
          ),
          _HeaderSubmitPill(
            label: submitLabel,
            enabled: submitEnabled,
            onTap: onSubmit,
          ),
        ],
      ),
    );
  }
}

class _DismissButton extends StatelessWidget {
  const _DismissButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(18),
      onTap: onTap,
      child: Container(
        width: 36,
        height: 36,
        alignment: Alignment.center,
        decoration: const BoxDecoration(
          color: Color(0xFFF7F7F9),
          shape: BoxShape.circle,
        ),
        child: const Icon(
          Icons.close_rounded,
          size: 20,
          color: Color(0xFF222222),
        ),
      ),
    );
  }
}

class _HeaderSubmitPill extends StatelessWidget {
  const _HeaderSubmitPill({
    required this.label,
    required this.enabled,
    required this.onTap,
  });

  final String label;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    // Node 519:8550: 80 wide, 8px vertical padding (so ~32 tall, not 36),
    // 12px regular with -0.16 tracking — #0571A6 enabled, #96B7C7 resting.
    return SizedBox(
      width: 80,
      child: Material(
        color: enabled ? const Color(0xFF0571A6) : const Color(0xFF96B7C7),
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: enabled ? onTap : null,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            // `Center` would stretch this to the header's height; the text
            // centres itself within the fixed 80pt width instead.
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 12,
                height: 16.2 / 12,
                fontWeight: FontWeight.w400,
                letterSpacing: -0.16,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Public/Team audience picker (item 1) — replaces the old inline
/// `_sendToField()` chip choice for the general composer types.
class _AudiencePickerSheet extends StatelessWidget {
  const _AudiencePickerSheet({required this.value});

  final String value;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
          boxShadow: [
            BoxShadow(
              color: Color(0x1F000000),
              blurRadius: 16,
              offset: Offset(0, -4),
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 12),
            const _SheetHandle(),
            _AudienceRow(
              label: 'Public',
              onTap: () => Navigator.of(context).pop('all_company'),
            ),
            const Divider(height: 1, thickness: 1, color: Color(0xFFF3F4F6)),
            _AudienceRow(
              label: 'Team',
              onTap: () => Navigator.of(context).pop('my_team'),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}

class _AudienceRow extends StatelessWidget {
  const _AudienceRow({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
        child: Row(
          children: [
            Text(
              label,
              style: const TextStyle(
                color: Color(0xFF222222),
                fontSize: 16,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Immutable snapshot of an authored poll — passed between the poll editor
/// sub-screen and the main composer's local state (item 7). No backend
/// field exists yet for option images, so `imagePath` is cosmetic-only and
/// intentionally never round-trips into `ConnectPostDraft.body`.
class _PollDraft {
  const _PollDraft({required this.question, required this.options});

  final String question;
  final List<_PollOptionEntry> options;

  static _PollDraft? fromPost(ConnectPost? post) {
    if (post == null || post.type != ConnectPostType.survey) return null;
    final options = post.pollOptions;
    if (options.isEmpty) return null;
    return _PollDraft(
      question: _bodyString(post, 'title'),
      options: options
          .map((option) => _PollOptionEntry(text: option.label))
          .toList(),
    );
  }
}

class _PollOptionEntry {
  const _PollOptionEntry({
    required this.text,
    this.isImage = false,
    this.imagePath,
  });

  final String text;
  final bool isImage;
  final String? imagePath;
}

/// Dedicated poll editor sub-screen (item 7, Step A). Authors a question and
/// up to 4 options (text or, cosmetically only, image) and pops the result
/// back to the main composer without submitting anything to the backend.
class _PollEditorPage extends StatefulWidget {
  const _PollEditorPage({this.initial});

  final _PollDraft? initial;

  @override
  State<_PollEditorPage> createState() => _PollEditorPageState();
}

class _PollEditorPageState extends State<_PollEditorPage> {
  static const _maxOptions = 4;

  late final TextEditingController _question;
  late final List<TextEditingController> _optionControllers;
  late final List<String?> _optionImages;
  String _optionMode = 'text';
  bool _showMaxToast = false;

  @override
  void initState() {
    super.initState();
    final initial = widget.initial;
    _question = TextEditingController(text: initial?.question ?? '');
    if (initial != null && initial.options.isNotEmpty) {
      _optionControllers = initial.options
          .map((option) => TextEditingController(text: option.text))
          .toList();
      _optionImages = initial.options
          .map((option) => option.imagePath)
          .toList();
      _optionMode = initial.options.any((option) => option.isImage)
          ? 'image'
          : 'text';
    } else {
      _optionControllers = [TextEditingController(), TextEditingController()];
      _optionImages = [null, null];
    }
  }

  @override
  void dispose() {
    _question.dispose();
    for (final controller in _optionControllers) {
      controller.dispose();
    }
    super.dispose();
  }

  void _addOption() {
    if (_optionControllers.length >= _maxOptions) {
      setState(() => _showMaxToast = true);
      Future.delayed(const Duration(seconds: 2), () {
        if (mounted) setState(() => _showMaxToast = false);
      });
      return;
    }
    setState(() {
      _optionControllers.add(TextEditingController());
      _optionImages.add(null);
    });
  }

  void _removeOption(int index) {
    if (_optionControllers.length <= 2) return;
    setState(() {
      _optionControllers.removeAt(index).dispose();
      _optionImages.removeAt(index);
    });
  }

  Future<void> _pickOptionImage(int index) async {
    final result = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['jpg', 'jpeg', 'png', 'webp'],
      withData: false,
    );
    final path = result?.files.single.path;
    if (path == null || path.isEmpty || !mounted) return;
    final cropped = await cropImageFile(
      context,
      path: path,
      title: 'Crop the option image',
      initial: CropShape.square,
      allowShapeChange: false,
    );
    if (cropped == null || !mounted) return;
    setState(() => _optionImages[index] = cropped);
  }

  void _done() {
    final options = List.generate(_optionControllers.length, (index) {
      return _PollOptionEntry(
        text: _optionControllers[index].text.trim(),
        isImage: _optionMode == 'image',
        imagePath: _optionMode == 'image' ? _optionImages[index] : null,
      );
    });
    Navigator.of(
      context,
    ).pop(_PollDraft(question: _question.text.trim(), options: options));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      resizeToAvoidBottomInset: true,
      backgroundColor: const Color(0xFFF7F7F9),
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _ComposerHeader(
              onDismiss: () => Navigator.of(context).pop(),
              submitLabel: 'Done',
              submitEnabled: true,
              onSubmit: _done,
              title: 'Poll',
            ),
            Expanded(
              child: Stack(
                children: [
                  SingleChildScrollView(
                    padding: const EdgeInsets.fromLTRB(18, 16, 18, 24),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const _FieldLabel('QUESTION'),
                        _ComposerTextField(
                          controller: _question,
                          hint: 'What should we ask the team?',
                          minLines: 5,
                        ),
                        const SizedBox(height: 18),
                        const _FieldLabel('OPTION'),
                        const SizedBox(height: 4),
                        _ChipChoice(
                          value: _optionMode,
                          values: const [('text', 'Text'), ('image', 'Image')],
                          onChanged: (value) =>
                              setState(() => _optionMode = value),
                        ),
                        const SizedBox(height: 14),
                        for (var i = 0; i < _optionControllers.length; i++) ...[
                          if (i > 0) const SizedBox(height: 10),
                          _optionMode == 'image'
                              ? _PollImageOptionRow(
                                  imagePath: _optionImages[i],
                                  controller: _optionControllers[i],
                                  onPick: () => _pickOptionImage(i),
                                  onRemove: _optionControllers.length > 2
                                      ? () => _removeOption(i)
                                      : null,
                                )
                              : _PollTextOptionRow(
                                  controller: _optionControllers[i],
                                  hint: 'Option ${i + 1}',
                                  onRemove: _optionControllers.length > 2
                                      ? () => _removeOption(i)
                                      : null,
                                ),
                        ],
                        const SizedBox(height: 12),
                        TextButton(
                          onPressed: _addOption,
                          style: TextButton.styleFrom(
                            padding: EdgeInsets.zero,
                            minimumSize: Size.zero,
                            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          ),
                          child: Text(
                            '+ Add Option',
                            style: TextStyle(
                              color: _optionControllers.length >= _maxOptions
                                  ? const Color(0xFF96B7C7)
                                  : _ConnectColors.blue,
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (_showMaxToast)
                    Positioned(
                      left: 18,
                      right: 18,
                      bottom: 18,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 12,
                        ),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF7F7F9),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: const Color(0xFFEBEBEB)),
                        ),
                        child: const Text(
                          "You've reached the max! Only 4 options can be added.",
                          style: TextStyle(
                            color: Color(0xFF717171),
                            fontSize: 14,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PollTextOptionRow extends StatelessWidget {
  const _PollTextOptionRow({
    required this.controller,
    required this.hint,
    this.onRemove,
  });

  final TextEditingController controller;
  final String hint;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: SizedBox(
            height: 53,
            child: _ComposerTextField(
              controller: controller,
              hint: hint,
              minLines: 1,
            ),
          ),
        ),
        if (onRemove != null)
          IconButton(
            onPressed: onRemove,
            icon: const Icon(Icons.close_rounded),
            color: const Color(0xFF717171),
          ),
      ],
    );
  }
}

class _PollImageOptionRow extends StatelessWidget {
  const _PollImageOptionRow({
    required this.imagePath,
    required this.controller,
    required this.onPick,
    this.onRemove,
  });

  final String? imagePath;
  final TextEditingController controller;
  final VoidCallback onPick;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: const Color(0xFFEBEBEB)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          InkWell(
            borderRadius: BorderRadius.circular(8),
            onTap: onPick,
            child: Container(
              width: 48,
              height: 48,
              alignment: Alignment.center,
              clipBehavior: Clip.antiAlias,
              decoration: BoxDecoration(
                color: const Color(0xFFF7F7F9),
                borderRadius: BorderRadius.circular(8),
              ),
              child: imagePath == null
                  ? const Icon(
                      Icons.add_photo_alternate_rounded,
                      color: _ConnectColors.blue,
                      size: 22,
                    )
                  : Image.file(File(imagePath!), fit: BoxFit.cover),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: TextField(
              controller: controller,
              decoration: const InputDecoration(
                hintText: 'Option label',
                filled: false,
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                isDense: true,
              ),
              style: const TextStyle(color: _ConnectColors.ink, fontSize: 14),
            ),
          ),
          if (onRemove != null)
            IconButton(
              onPressed: onRemove,
              icon: const Icon(Icons.close_rounded),
              color: const Color(0xFF717171),
            ),
        ],
      ),
    );
  }
}

String _initials(String name) {
  final parts = name
      .trim()
      .split(RegExp(r'\s+'))
      .where((part) => part.isNotEmpty);
  final value = parts.take(2).map((part) => part[0].toUpperCase()).join();
  return value.isEmpty ? 'T' : value;
}

String _mimeTypeFor(String? extension) {
  return switch (extension?.toLowerCase()) {
    'jpg' || 'jpeg' => 'image/jpeg',
    'png' => 'image/png',
    'webp' => 'image/webp',
    'mov' => 'video/quicktime',
    'mp4' => 'video/mp4',
    _ => 'application/octet-stream',
  };
}

class _ConnectEmptyState extends StatelessWidget {
  const _ConnectEmptyState({
    required this.icon,
    required this.title,
    required this.body,
    required this.actionLabel,
    required this.onAction,
    this.illustrationAsset,
  });

  final IconData icon;
  final String title;
  final String body;
  final String actionLabel;
  final VoidCallback onAction;

  /// When set, renders in place of [icon] — used for the "No posts yet"
  /// state, which has a real illustration in the design.
  final String? illustrationAsset;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (illustrationAsset != null)
              Image.asset(illustrationAsset!, width: 200, height: 200)
            else
              Icon(icon, color: _ConnectColors.terra, size: 42),
            const SizedBox(height: 14),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: _ConnectColors.ink,
                fontSize: 26,
                fontWeight: FontWeight.w800,
                letterSpacing: -0.5,
              ),
            ),
            const SizedBox(height: 12),
            Text(
              body,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: _ConnectColors.inkSoft,
                fontSize: 15,
                height: 23 / 15,
              ),
            ),
            const SizedBox(height: 28),
            _ActionButton(
              label: actionLabel,
              icon: Icons.refresh_rounded,
              onTap: onAction,
            ),
          ],
        ),
      ),
    );
  }
}

class _ConnectColors {
  const _ConnectColors._();

  static const bg = Color(0xFFF7F7F9);
  static const cardBorder = Color(0xFFEBEBEB);
  static const ink = Color(0xFF2A2420);
  static const inkSoft = Color(0xFF6E655C);
  static const faint = Color(0xFFA79D92);
  static const terra = Color(0xFFBE5A36);
  static const terraTint = Color(0xFFF6E5DB);
  static const gold = Color(0xFFC98A2E);
  static const goldTint = Color(0xFFF4ECDD);
  static const sage = Color(0xFF4C5840);
  static const teal = Color(0xFF4F8C89);
  static const plum = Color(0xFF8A6AA0);
  static const rose = Color(0xFFC26B8A);
  static const live = Color(0xFFE0483B);
  static const sand = Color(0xFFEFEDDD);
  static const blue = Color(0xFF0571A6);
}

String _bodyString(ConnectPost post, String key) {
  final value = post.body[key];
  return value == null ? '' : value.toString();
}

/// One person tagged in a post, resolved server-side per read.
class ConnectTaggedPerson {
  const ConnectTaggedPerson({
    required this.userId,
    required this.name,
    this.designation = '',
    this.photoUrl,
  });

  final String userId;
  final String name;
  final String designation;
  final String? photoUrl;
}

List<ConnectTaggedPerson> _taggedPeople(ConnectPost post) {
  final value = post.body['taggedPeople'];
  if (value is! List) return const [];
  return value
      .whereType<Map>()
      .map((item) {
        final photo = item['photoUrl']?.toString();
        return ConnectTaggedPerson(
          userId: item['userId']?.toString() ?? '',
          name: item['name']?.toString() ?? '',
          designation: item['designation']?.toString() ?? '',
          photoUrl: photo == null || photo.isEmpty ? null : photo,
        );
      })
      .where((person) => person.userId.isNotEmpty && person.name.isNotEmpty)
      .toList();
}

List<String> _bodyStringList(ConnectPost post, String key) {
  final value = post.body[key];
  if (value is! List) return const [];
  return value
      .map((item) => item?.toString() ?? '')
      .where((item) => item.isNotEmpty)
      .toList();
}

/// Media served from Mongo fallback storage (no S3 configured) presigns to a
/// `data:` URI rather than an http(s) URL — `NetworkImage`/`Image.network`
/// issue an HTTP GET and cannot render those, so decode inline instead.
ImageProvider _remoteImage(String url) {
  if (url.startsWith('data:')) {
    final comma = url.indexOf(',');
    if (comma != -1) {
      try {
        return MemoryImage(base64Decode(url.substring(comma + 1)));
      } catch (_) {
        // Fall through to NetworkImage, which will simply fail to load.
      }
    }
  }
  return NetworkImage(resolveMediaUrl(url));
}

Color _hexColor(String value, Color fallback) {
  final normalized = value.replaceFirst('#', '');
  if (normalized.length != 6) return fallback;
  final parsed = int.tryParse(normalized, radix: 16);
  if (parsed == null) return fallback;
  return Color(0xFF000000 | parsed);
}

/// Deterministic seed-to-palette hash, mirroring `avatarColorFor` in
/// backend/src/services/connect.service.ts so avatars generated client-side
/// land on the same palette as author avatars from the API.
Color _avatarColorFor(String seed) {
  const palette = [
    _ConnectColors.terra,
    _ConnectColors.gold,
    _ConnectColors.sage,
    _ConnectColors.teal,
    _ConnectColors.plum,
    _ConnectColors.rose,
  ];
  if (seed.isEmpty) return palette.first;
  final sum = seed.codeUnits.fold<int>(0, (total, unit) => total + unit);
  return palette[sum % palette.length];
}

String _timeAgo(DateTime? value) {
  if (value == null) return 'Now';
  final diff = DateTime.now().difference(value.toLocal());
  if (diff.inMinutes < 1) return 'Now';
  if (diff.inMinutes < 60) return '${diff.inMinutes}m';
  if (diff.inHours < 24) return '${diff.inHours}h';
  if (diff.inDays == 1) return 'Yesterday';
  if (diff.inDays < 7) return '${diff.inDays}d';
  return '${value.day}/${value.month}/${value.year}';
}

String _formatComposerDate(DateTime value) {
  return '${value.day}/${value.month}/${value.year}';
}

String _dateOnly(DateTime value) {
  final month = value.month.toString().padLeft(2, '0');
  final day = value.day.toString().padLeft(2, '0');
  return '${value.year}-$month-$day';
}

String _formatTimeValue(TimeOfDay value) {
  final hour = value.hour.toString().padLeft(2, '0');
  final minute = value.minute.toString().padLeft(2, '0');
  return '$hour:$minute';
}

TimeOfDay? _parseTimeOfDay(String value) {
  final parts = value.split(':');
  if (parts.length != 2) return null;
  final hour = int.tryParse(parts[0]);
  final minute = int.tryParse(parts[1]);
  if (hour == null || minute == null) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return TimeOfDay(hour: hour, minute: minute);
}

extension on Widget {
  Widget withDefaultTextStyle(TextStyle style) {
    return DefaultTextStyle(style: style, child: this);
  }
}
