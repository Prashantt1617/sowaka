import 'dart:io';

import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';

import '../../auth/data/auth_models.dart';
import '../bloc/connect_bloc.dart';
import '../data/connect_models.dart';
import 'game_play_screen.dart';
import '../../manager_shell/presentation/app_home_header.dart';
import '../../notifications/presentation/notification_inbox_screen.dart';
import '../../../services/notification_service.dart';

class ConnectFeedScreen extends StatefulWidget {
  const ConnectFeedScreen({
    super.key,
    required this.session,
    required this.profileAction,
    this.recognitionCandidates = const [],
  });

  final AuthSession session;
  final Widget profileAction;
  final List<ConnectTeammate> recognitionCandidates;

  @override
  State<ConnectFeedScreen> createState() => _ConnectFeedScreenState();
}

class _ConnectFeedScreenState extends State<ConnectFeedScreen> {
  late final ConnectBloc _bloc;

  @override
  void initState() {
    super.initState();
    _bloc = ConnectBloc(session: widget.session)..load();
  }

  @override
  void dispose() {
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
                  onQuickCreate: () =>
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('Quick create coming soon'),
                        ),
                      ),
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
      return Stack(
        children: [
          _ConnectEmptyState(
            icon: Icons.forum_rounded,
            title: 'No posts yet',
            body: 'Company updates, kudos and events will appear here.',
            actionLabel: 'Refresh',
            onAction: _bloc.refresh,
          ),
          _createPostButton(),
        ],
      );
    }
    return Stack(
      children: [
        RefreshIndicator(
          color: _ConnectColors.terra,
          onRefresh: _bloc.refresh,
          child: ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 6, 16, 118),
            itemCount: state.posts.length,
            separatorBuilder: (_, _) => const SizedBox(height: 16),
            itemBuilder: (context, index) {
              final post = state.posts[index];
              return _ConnectPostCard(
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
              );
            },
          ),
        ),
        _createPostButton(),
      ],
    );
  }

  Widget _createPostButton() {
    return Positioned(
      right: 20,
      bottom: 28,
      child: FloatingActionButton(
        heroTag: 'connect-create-post',
        elevation: 8,
        backgroundColor: _ConnectColors.terra,
        foregroundColor: Colors.white,
        onPressed: _openPostTypePicker,
        child: const Icon(Icons.add_rounded, size: 30),
      ),
    );
  }

  Future<void> _openPostTypePicker() async {
    final type = await showModalBottomSheet<ConnectPostType>(
      context: context,
      useSafeArea: true,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const _PostTypePickerSheet(),
    );
    if (!mounted || type == null) return;
    await _openComposer(type);
  }

  Future<void> _openComposer(
    ConnectPostType type, {
    ConnectPost? existing,
  }) async {
    final draft = await Navigator.of(context).push<ConnectPostDraft>(
      MaterialPageRoute(
        builder: (_) => _PostComposerPage(
          type: type,
          existing: existing,
          department: widget.session.user.department,
          recognitionCandidates: widget.recognitionCandidates,
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
    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _DeletePostSheet(post: post),
    );
    if (confirmed == true) await _bloc.deletePost(post.id);
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
    required this.post,
    required this.busy,
    required this.canManage,
    required this.onLike,
    required this.onComment,
    required this.onAction,
    required this.onPlayGame,
    required this.onEdit,
    required this.onDelete,
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
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: _ConnectColors.cardBorder),
        boxShadow: const [
          BoxShadow(
            color: Color(0x142A2420),
            blurRadius: 28,
            offset: Offset(0, 14),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _PostHeader(
              post: post,
              canManage: widget.canManage,
              onEdit: widget.onEdit,
              onDelete: widget.onDelete,
            ),
            _PostBody(
              post: post,
              onAction: widget.onAction,
              onPlayGame: widget.onPlayGame,
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
            ),
          ],
        ),
      ),
    );
  }
}

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
    final tagColor = _hexColor(post.tagColor, _ConnectColors.terra);
    final tagTint = _hexColor(post.tagTint, _ConnectColors.terraTint);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 12, 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _InitialAvatar(
            initials: post.author.initials,
            color: _hexColor(post.author.avatarColor, _ConnectColors.terra),
            size: 42,
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
                        fontSize: 14.5,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    _PostPill(
                      label: '${post.tagIcon} ${post.tag}',
                      textColor: tagColor,
                      bgColor: tagTint,
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
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
          if (canManage)
            PopupMenuButton<_PostMenuAction>(
              icon: const Icon(
                Icons.more_horiz_rounded,
                color: _ConnectColors.faint,
              ),
              color: Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
              ),
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
            )
          else
            const Icon(Icons.more_horiz_rounded, color: _ConnectColors.faint),
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
  });

  final ConnectPost post;
  final Future<void> Function({String? optionId}) onAction;
  final VoidCallback onPlayGame;

  @override
  Widget build(BuildContext context) {
    return switch (post.type) {
      ConnectPostType.leadership ||
      ConnectPostType.recommendation => _MediaPostBody(post: post),
      ConnectPostType.newPost => _TextPostBody(post: post),
      ConnectPostType.hrAnnouncement => _AnnouncementBody(post: post),
      ConnectPostType.birthday => _BirthdayBody(post: post, onAction: onAction),
      ConnectPostType.anniversary => _AnniversaryBody(post: post),
      ConnectPostType.kudos => _KudosBody(post: post),
      ConnectPostType.award => _AwardBody(post: post),
      ConnectPostType.survey => _SurveyBody(post: post, onAction: onAction),
      ConnectPostType.event => _EventBody(post: post, onAction: onAction),
      ConnectPostType.liveGame => _LiveGameBody(
        post: post,
        onPlayGame: onPlayGame,
      ),
      ConnectPostType.newJoinee => _NewJoineeBody(
        post: post,
        onAction: onAction,
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

class _TextPostBody extends StatelessWidget {
  const _TextPostBody({required this.post});

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

class _MediaPreview extends StatelessWidget {
  const _MediaPreview({required this.post});

  final ConnectPost post;

  @override
  Widget build(BuildContext context) {
    final mediaKind = _bodyString(post, 'mediaKind');
    final mediaUrl = _bodyString(post, 'mediaUrl');
    final isImage = mediaKind == 'image' && mediaUrl.isNotEmpty;
    return Container(
      height: 200,
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: _ConnectColors.sand,
        image: isImage
            ? DecorationImage(image: NetworkImage(mediaUrl), fit: BoxFit.cover)
            : null,
      ),
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

class _AnnouncementBody extends StatelessWidget {
  const _AnnouncementBody({required this.post});

  final ConnectPost post;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      child: Container(
        padding: const EdgeInsets.all(15),
        decoration: BoxDecoration(
          color: _ConnectColors.goldTint,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(Icons.warning_amber_rounded, color: _ConnectColors.gold),
            const SizedBox(width: 12),
            Expanded(
              child: RichText(
                text: TextSpan(
                  style: const TextStyle(
                    color: _ConnectColors.ink,
                    fontSize: 14,
                    height: 1.55,
                    fontWeight: FontWeight.w500,
                  ),
                  children: [
                    TextSpan(
                      text: '${_bodyString(post, 'title')} ',
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                    TextSpan(text: _bodyString(post, 'text')),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BirthdayBody extends StatelessWidget {
  const _BirthdayBody({required this.post, required this.onAction});

  final ConnectPost post;
  final Future<void> Function({String? optionId}) onAction;

  @override
  Widget build(BuildContext context) {
    final done = post.actionValue != null;
    return Container(
      color: _ConnectColors.terraTint,
      padding: const EdgeInsets.fromLTRB(16, 22, 16, 20),
      child: Column(
        children: [
          const _PostPill(
            label: '🎂 HAPPY BIRTHDAY',
            textColor: _ConnectColors.terra,
            bgColor: Colors.white,
          ),
          const SizedBox(height: 16),
          _InitialAvatar(
            initials: _bodyString(post, 'personInitials'),
            color: _ConnectColors.gold,
            size: 78,
            photoUrl: _bodyString(post, 'photoUrl'),
          ),
          const SizedBox(height: 12),
          Text(
            _bodyString(post, 'personName'),
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: _ConnectColors.ink,
              fontSize: 22,
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
            ),
          ),
          const SizedBox(height: 16),
          _ActionButton(
            label: done
                ? _bodyString(post, 'actionDoneLabel')
                : _bodyString(post, 'actionLabel'),
            icon: done ? Icons.check_rounded : Icons.celebration_rounded,
            onTap: () => onAction(),
          ),
        ],
      ),
    );
  }
}

class _AnniversaryBody extends StatelessWidget {
  const _AnniversaryBody({required this.post});

  final ConnectPost post;

  @override
  Widget build(BuildContext context) {
    final years = (post.body['years'] as num?)?.toInt() ?? 1;
    return Container(
      color: _ConnectColors.sageTint,
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          Stack(
            clipBehavior: Clip.none,
            children: [
              _InitialAvatar(
                initials: _bodyString(post, 'personInitials'),
                color: _ConnectColors.plum,
                size: 64,
                photoUrl: _bodyString(post, 'photoUrl'),
              ),
              Positioned(
                right: -6,
                bottom: -6,
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
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${_bodyString(post, 'personName')} has been with Sowaka for $years years!',
                  style: const TextStyle(
                    color: _ConnectColors.ink,
                    fontSize: 17,
                    height: 1.25,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  _bodyString(post, 'subtitle'),
                  style: const TextStyle(
                    color: _ConnectColors.inkSoft,
                    fontSize: 12.5,
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

class _KudosBody extends StatelessWidget {
  const _KudosBody({required this.post});

  final ConnectPost post;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: _ConnectColors.terraTint,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _InitialAvatar(
              initials: _bodyString(post, 'personInitials'),
              color: _ConnectColors.teal,
              size: 54,
            ),
            const SizedBox(width: 13),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Kudos to ${_bodyString(post, 'personName')}',
                    style: const TextStyle(
                      color: _ConnectColors.ink,
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    _bodyString(post, 'text'),
                    style: const TextStyle(
                      color: _ConnectColors.inkSoft,
                      fontSize: 13.5,
                      height: 1.5,
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

class _AwardBody extends StatelessWidget {
  const _AwardBody({required this.post});

  final ConnectPost post;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: _ConnectColors.goldTint,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFFE9D7B8)),
      ),
      child: Column(
        children: [
          const Icon(
            Icons.emoji_events_rounded,
            color: _ConnectColors.gold,
            size: 38,
          ),
          const SizedBox(height: 8),
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
            _bodyString(post, 'personName'),
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: _ConnectColors.gold,
              fontSize: 13,
              fontWeight: FontWeight.w800,
            ),
          ),
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
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            _bodyString(post, 'title'),
            style: const TextStyle(
              color: _ConnectColors.ink,
              fontSize: 16,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 12),
          ...post.pollOptions.map((option) {
            final selected = post.selectedPollOptionId == option.id;
            final pct = option.votes / total;
            return Padding(
              padding: const EdgeInsets.only(bottom: 9),
              child: InkWell(
                borderRadius: BorderRadius.circular(13),
                onTap: () => onAction(optionId: option.id),
                child: Container(
                  padding: const EdgeInsets.all(11),
                  decoration: BoxDecoration(
                    color: selected ? _ConnectColors.terraTint : Colors.white,
                    borderRadius: BorderRadius.circular(13),
                    border: Border.all(
                      color: selected
                          ? _ConnectColors.terra
                          : _ConnectColors.cardBorder,
                    ),
                  ),
                  child: Column(
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              option.label,
                              style: const TextStyle(
                                color: _ConnectColors.ink,
                                fontSize: 13,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          Text(
                            '${(pct * 100).round()}%',
                            style: const TextStyle(
                              color: _ConnectColors.inkSoft,
                              fontSize: 12,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(99),
                        child: LinearProgressIndicator(
                          value: pct,
                          minHeight: 7,
                          color: selected
                              ? _ConnectColors.terra
                              : _ConnectColors.gold,
                          backgroundColor: _ConnectColors.sand,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            );
          }),
        ],
      ),
    );
  }
}

class _EventBody extends StatelessWidget {
  const _EventBody({required this.post, required this.onAction});

  final ConnectPost post;
  final Future<void> Function({String? optionId}) onAction;

  @override
  Widget build(BuildContext context) {
    final done = post.actionValue != null;
    return _ActionPanel(
      icon: Icons.confirmation_number_rounded,
      iconColor: _ConnectColors.terra,
      title: _bodyString(post, 'title'),
      subtitle: _bodyString(post, 'subtitle'),
      buttonLabel: done
          ? _bodyString(post, 'actionDoneLabel')
          : _bodyString(post, 'actionLabel'),
      onTap: () => onAction(),
    );
  }
}

class _LiveGameBody extends StatelessWidget {
  const _LiveGameBody({required this.post, required this.onPlayGame});

  final ConnectPost post;
  final VoidCallback onPlayGame;

  @override
  Widget build(BuildContext context) {
    final done = post.actionValue != null;
    final leaders = (post.body['leaderboard'] as List<dynamic>? ?? const [])
        .map((entry) => Map<String, dynamic>.from(entry as Map))
        .toList();
    return Column(
      children: [
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
  const _NewJoineeBody({required this.post, required this.onAction});

  final ConnectPost post;
  final Future<void> Function({String? optionId}) onAction;

  @override
  Widget build(BuildContext context) {
    final done = post.actionValue != null;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: _ConnectColors.roseTint,
          borderRadius: BorderRadius.circular(18),
        ),
        child: Column(
          children: [
            _InitialAvatar(
              initials: _bodyString(post, 'personInitials'),
              color: _ConnectColors.rose,
              size: 70,
              photoUrl: _bodyString(post, 'photoUrl'),
            ),
            const SizedBox(height: 12),
            Text(
              _bodyString(post, 'personName'),
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
                fontSize: 13,
              ),
            ),
            const SizedBox(height: 10),
            if (_bodyString(post, 'facts').isNotEmpty) ...[
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: _ConnectColors.sand,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Text(
                  '🤖  Auto-generated quick facts — ${_bodyString(post, 'facts')}',
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

class _PostFooter extends StatelessWidget {
  const _PostFooter({
    required this.post,
    required this.busy,
    required this.controller,
    required this.onLike,
    required this.onComment,
  });

  final ConnectPost post;
  final bool busy;
  final TextEditingController controller;
  final VoidCallback onLike;
  final VoidCallback onComment;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(color: Colors.white),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            decoration: const BoxDecoration(
              border: Border(
                top: BorderSide(color: _ConnectColors.divider),
                bottom: BorderSide(color: _ConnectColors.divider),
              ),
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
                        Icon(
                          post.liked
                              ? Icons.favorite_rounded
                              : Icons.favorite_border_rounded,
                          color: post.liked
                              ? _ConnectColors.terra
                              : _ConnectColors.faint,
                          size: 18,
                        ),
                        const SizedBox(width: 5),
                        Text(
                          '${post.likeCount}',
                          style: TextStyle(
                            color: post.liked
                                ? _ConnectColors.terra
                                : _ConnectColors.faint,
                            fontSize: 12,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 16),
                const Icon(
                  Icons.mode_comment_outlined,
                  color: _ConnectColors.faint,
                  size: 17,
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
                children: post.comments.take(2).map((comment) {
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 5),
                    child: RichText(
                      text: TextSpan(
                        style: const TextStyle(
                          color: _ConnectColors.inkSoft,
                          fontSize: 13,
                          height: 1.35,
                        ),
                        children: [
                          TextSpan(
                            text: '${comment.name} ',
                            style: const TextStyle(
                              color: _ConnectColors.ink,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          TextSpan(text: comment.text),
                        ],
                      ),
                    ),
                  );
                }).toList(),
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 14),
            child: TextField(
              controller: controller,
              minLines: 1,
              maxLines: 3,
              textInputAction: TextInputAction.send,
              onSubmitted: (_) => onComment(),
              decoration: InputDecoration(
                hintText: 'Add a comment...',
                hintStyle: const TextStyle(
                  color: _ConnectColors.faint,
                  fontSize: 12.5,
                ),
                suffixIcon: IconButton(
                  icon: const Icon(Icons.send_rounded, size: 18),
                  color: _ConnectColors.terra,
                  onPressed: busy ? null : onComment,
                ),
                filled: true,
                fillColor: Colors.white,
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
                  borderSide: const BorderSide(color: _ConnectColors.terra),
                ),
              ),
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
      child: Text(
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
  const _ActionButton({
    required this.label,
    required this.icon,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(99),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 17, vertical: 10),
        decoration: BoxDecoration(
          color: _ConnectColors.terra,
          borderRadius: BorderRadius.circular(99),
          boxShadow: const [
            BoxShadow(
              color: Color(0x3DBE5A36),
              blurRadius: 16,
              offset: Offset(0, 6),
            ),
          ],
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: Colors.white, size: 17),
            const SizedBox(width: 7),
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
    );
  }
}

class _PostPill extends StatelessWidget {
  const _PostPill({
    required this.label,
    required this.textColor,
    required this.bgColor,
  });

  final String label;
  final Color textColor;
  final Color bgColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: textColor,
          fontSize: 10.5,
          fontWeight: FontWeight.w800,
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
          : Image.network(
              photoUrl,
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

class _PostTypePickerSheet extends StatelessWidget {
  const _PostTypePickerSheet();

  @override
  Widget build(BuildContext context) {
    final tiles = [
      _PostTypeTile(
        type: ConnectPostType.leadership,
        label: 'Leadership',
        subtitle: 'News or milestone',
        icon: Icons.workspace_premium_rounded,
        color: _ConnectColors.gold,
        tint: _ConnectColors.goldTint,
      ),
      _PostTypeTile(
        type: ConnectPostType.hrAnnouncement,
        label: 'Announcement',
        subtitle: 'Policy or notice',
        icon: Icons.campaign_rounded,
        color: _ConnectColors.gold,
        tint: _ConnectColors.goldTint,
      ),
      _PostTypeTile(
        type: ConnectPostType.newPost,
        label: 'New Post',
        subtitle: 'Text, photo or video',
        icon: Icons.edit_note_rounded,
        color: _ConnectColors.terra,
        tint: _ConnectColors.terraTint,
      ),
      _PostTypeTile(
        type: ConnectPostType.kudos,
        label: 'Give Kudos',
        subtitle: 'Recognise a teammate',
        icon: Icons.volunteer_activism_rounded,
        color: _ConnectColors.terra,
        tint: _ConnectColors.terraTint,
      ),
      _PostTypeTile(
        type: ConnectPostType.survey,
        label: 'Survey/Poll',
        subtitle: 'Ask the team',
        icon: Icons.poll_rounded,
        color: _ConnectColors.terra,
        tint: _ConnectColors.terraTint,
      ),
      _PostTypeTile(
        type: ConnectPostType.event,
        label: 'Event',
        subtitle: 'Register or RSVP',
        icon: Icons.confirmation_number_rounded,
        color: _ConnectColors.sage,
        tint: _ConnectColors.sageTint,
      ),
      _PostTypeTile(
        type: ConnectPostType.recommendation,
        label: 'Must Watch/Read',
        subtitle: 'Video or link',
        icon: Icons.play_circle_rounded,
        color: _ConnectColors.teal,
        tint: Color(0xFFE4EBF0),
      ),
    ];

    return _SheetShell(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _SheetHandle(),
          const Text(
            'Create a post',
            style: TextStyle(
              color: _ConnectColors.ink,
              fontSize: 20,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            "Choose what you'd like to share",
            style: TextStyle(
              color: _ConnectColors.inkSoft,
              fontSize: 13,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 18),
          GridView.count(
            crossAxisCount: 2,
            crossAxisSpacing: 10,
            mainAxisSpacing: 10,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            childAspectRatio: 2.24,
            children: tiles.map((tile) {
              return InkWell(
                borderRadius: BorderRadius.circular(16),
                onTap: () => Navigator.of(context).pop(tile.type),
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 10,
                  ),
                  decoration: BoxDecoration(
                    color: tile.tint,
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Row(
                    children: [
                      Icon(tile.icon, color: tile.color, size: 24),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              tile.label,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: _ConnectColors.ink,
                                fontSize: 13.5,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const SizedBox(height: 3),
                            Text(
                              tile.subtitle,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: _ConnectColors.inkSoft,
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }
}

class _PostTypeTile {
  const _PostTypeTile({
    required this.type,
    required this.label,
    required this.subtitle,
    required this.icon,
    required this.color,
    required this.tint,
  });

  final ConnectPostType type;
  final String label;
  final String subtitle;
  final IconData icon;
  final Color color;
  final Color tint;
}

class _PostComposerPage extends StatefulWidget {
  const _PostComposerPage({
    required this.type,
    this.existing,
    this.department,
    this.recognitionCandidates = const [],
  });

  final ConnectPostType type;
  final ConnectPost? existing;
  final String? department;
  final List<ConnectTeammate> recognitionCandidates;

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
  late final List<TextEditingController> _options;
  String _sendTo = 'all_company';
  String _severity = 'plain';
  String _newPostKind = 'media';
  String _eventCategory = 'sports';
  bool _allowRegistration = true;
  ConnectMediaAttachment? _selectedMedia;
  bool _removeExistingMedia = false;
  late DateTime _eventDate;
  late TimeOfDay _eventTime;

  bool get _editing => widget.existing != null;
  Map<String, dynamic> get _body => widget.existing?.body ?? const {};
  bool get _hasMedia =>
      _selectedMedia != null ||
      (!_removeExistingMedia && _bodyValue('mediaObjectKey').isNotEmpty);

  @override
  void initState() {
    super.initState();
    _text = TextEditingController(text: _bodyValue('text'));
    _title = TextEditingController(text: _bodyValue('title'));
    _person = TextEditingController(text: _bodyValue('personName'));
    _linkUrl = TextEditingController(text: _bodyValue('linkUrl'));
    _mediaTitle = TextEditingController(text: _bodyValue('mediaTitle'));
    _location = TextEditingController(text: _bodyValue('location'));
    _prize = TextEditingController(text: _bodyValue('prize'));
    _sendTo = _bodyValue('sendTo').isEmpty
        ? 'all_company'
        : _bodyValue('sendTo');
    _severity = _announcementSeverityValue(_bodyValue('severity'));
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
    _eventDate =
        DateTime.tryParse(_bodyValue('date')) ??
        DateTime.now().add(const Duration(days: 7));
    _eventTime =
        _parseTimeOfDay(_bodyValue('time')) ??
        const TimeOfDay(hour: 17, minute: 30);
    final existingOptions = widget.existing?.pollOptions ?? const [];
    _options = existingOptions.isNotEmpty
        ? existingOptions
              .map((option) => TextEditingController(text: option.label))
              .toList()
        : [TextEditingController(), TextEditingController()];
  }

  @override
  void dispose() {
    _text.dispose();
    _title.dispose();
    _person.dispose();
    _linkUrl.dispose();
    _mediaTitle.dispose();
    _location.dispose();
    _prize.dispose();
    for (final controller in _options) {
      controller.dispose();
    }
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
      backgroundColor: const Color(0xFFF6F2EC),
      body: SafeArea(
        child: Padding(
          padding: EdgeInsets.only(bottom: bottom),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(8, 8, 10, 10),
                child: Row(
                  children: [
                    IconButton(
                      onPressed: () => Navigator.of(context).pop(),
                      icon: const Icon(Icons.arrow_back_rounded),
                    ),
                    Expanded(
                      child: Text(
                        _editing ? 'Edit $_typeTitle' : _typeTitle,
                        style: const TextStyle(
                          color: _ConnectColors.ink,
                          fontSize: 22,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.of(context).pop(),
                      icon: const Icon(Icons.close_rounded),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(18, 8, 18, 24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: _fieldsForType(),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 8, 18, 16),
                child: _ComposerSubmitButton(
                  label: _editing ? 'Save changes' : _submitLabel,
                  onTap: _submit,
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
          existingLabel: _bodyValue('mediaTitle'),
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
          _MediaToggle(
            enabled: _hasMedia,
            selectedMedia: _selectedMedia,
            existingLabel: _bodyValue('mediaTitle'),
            existingMediaKind: _bodyValue('mediaKind'),
            existingMediaUrl: _bodyValue('mediaUrl'),
            onTap: _pickMedia,
            onRemove: _hasMedia ? _removeMedia : null,
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
        const SizedBox(height: 18),
        _sendToField(),
      ],
      ConnectPostType.hrAnnouncement => [
        _FieldLabel('STYLE'),
        _SegmentedChoice(
          value: _severity,
          values: const [
            ('plain', 'Plain'),
            ('highlight_alert', 'Highlight/Alert'),
          ],
          onChanged: (value) => setState(() => _severity = value),
        ),
        const SizedBox(height: 18),
        _FieldLabel('MESSAGE'),
        _ComposerTextField(
          controller: _text,
          hint: 'What does everyone need to know?',
          minLines: 4,
        ),
        const SizedBox(height: 18),
        _sendToField(),
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
        _FieldLabel('QUESTION'),
        _ComposerTextField(
          controller: _title,
          hint: 'What should we ask the team?',
          minLines: 2,
        ),
        const SizedBox(height: 18),
        _FieldLabel('OPTIONS'),
        ..._options.asMap().entries.map((entry) {
          return Padding(
            padding: const EdgeInsets.only(bottom: 9),
            child: _ComposerTextField(
              controller: entry.value,
              hint: 'Option ${entry.key + 1}',
              minLines: 1,
            ),
          );
        }),
        TextButton.icon(
          onPressed: () => setState(() {
            _options.add(TextEditingController());
          }),
          icon: const Icon(Icons.add_rounded),
          label: const Text('Add Option'),
        ),
        const SizedBox(height: 18),
        _sendToField(),
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
        _FieldLabel('TITLE'),
        _ComposerTextField(controller: _mediaTitle, hint: 'Title', minLines: 1),
        const SizedBox(height: 18),
        _FieldLabel('LINK (OPTIONAL)'),
        _ComposerTextField(
          controller: _linkUrl,
          hint: 'Paste a URL...',
          minLines: 1,
          keyboardType: TextInputType.url,
        ),
        const SizedBox(height: 18),
        _FieldLabel('WHY IT MATTERS'),
        _ComposerTextField(
          controller: _text,
          hint: "Tell teammates why it's worth their time...",
          minLines: 4,
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

  Widget _sendToField() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _FieldLabel('SEND TO'),
        _ChipChoice(
          value: _sendTo,
          values: const [
            ('my_team', 'My team'),
            ('all_company', 'All company'),
          ],
          onChanged: (value) => setState(() => _sendTo = value),
        ),
      ],
    );
  }

  String get _typeTitle {
    return switch (widget.type) {
      ConnectPostType.leadership => 'Leadership post',
      ConnectPostType.hrAnnouncement => 'Announcement',
      ConnectPostType.newPost => 'New post',
      ConnectPostType.kudos => 'Give kudos',
      ConnectPostType.survey => 'Survey/Poll',
      ConnectPostType.event => 'Create event',
      ConnectPostType.recommendation => 'Must Watch/Read',
      _ => 'Create post',
    };
  }

  String get _submitLabel {
    return switch (widget.type) {
      ConnectPostType.hrAnnouncement => 'Post announcement',
      ConnectPostType.newPost => 'Post to company',
      ConnectPostType.kudos => 'Share kudos',
      ConnectPostType.survey => 'Publish survey',
      ConnectPostType.event => 'Publish event',
      ConnectPostType.recommendation => 'Share',
      _ => 'Post to company',
    };
  }

  void _submit() {
    final body = switch (widget.type) {
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
      },
      ConnectPostType.hrAnnouncement => {
        'title': _severity == 'plain' ? 'Announcement' : 'Highlight/Alert',
        'text': _text.text,
        'severity': _severity,
        'sendTo': _sendTo,
        'sendToDepartment': _sendTo == 'my_team' ? widget.department ?? '' : '',
      },
      ConnectPostType.kudos => {
        'personName': _person.text,
        'personInitials': _initials(_person.text),
        'text': _text.text,
      },
      ConnectPostType.survey => {
        'title': _title.text,
        'options': _options
            .map((controller) => controller.text.trim())
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
        'mediaTitle': _mediaTitle.text.isEmpty
            ? _linkUrl.text
            : _mediaTitle.text,
        'mediaKind': 'none',
        'mediaDuration': '',
        'linkUrl': _linkUrl.text,
      },
      _ => {'text': _text.text},
    };
    if (!_isValid(body)) return;
    Navigator.of(context).pop(
      ConnectPostDraft(
        type: widget.type,
        media: _mediaForSubmit(),
        removeMedia: _removeMediaForSubmit(),
        body: body,
      ),
    );
  }

  ConnectMediaAttachment? _mediaForSubmit() {
    if (widget.type == ConnectPostType.leadership) return _selectedMedia;
    if (widget.type == ConnectPostType.newPost && _newPostKind == 'media') {
      return _selectedMedia;
    }
    return null;
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
    final path = file.path;
    if (path == null || path.isEmpty) {
      _showValidation('Could not read the selected file.');
      return;
    }
    setState(() {
      _selectedMedia = ConnectMediaAttachment(
        path: path,
        name: file.name,
        size: file.size,
        mimeType: _mimeTypeFor(file.extension),
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
      _removeExistingMedia = _bodyValue('mediaObjectKey').isNotEmpty;
    });
  }

  bool _isValid(Map<String, dynamic> body) {
    final text = (body['text'] ?? body['title'] ?? '').toString().trim();
    if (text.isEmpty) {
      _showValidation('Add the required text before publishing.');
      return false;
    }
    if (widget.type == ConnectPostType.newPost) {
      if (_newPostKind == 'link' && _linkUrl.text.trim().isEmpty) {
        _showValidation('Add the link before publishing.');
        return false;
      }
      if (_newPostKind == 'media' && !_hasMedia) {
        _showValidation('Select a photo or video before publishing.');
        return false;
      }
    }
    if (widget.type == ConnectPostType.survey) {
      final options = body['options'] as List<String>;
      if (options.length < 2) {
        _showValidation('Add at least two survey options.');
        return false;
      }
    }
    if (widget.type == ConnectPostType.event && _location.text.trim().isEmpty) {
      _showValidation('Add the event location before publishing.');
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

class _DeletePostSheet extends StatelessWidget {
  const _DeletePostSheet({required this.post});

  final ConnectPost post;

  @override
  Widget build(BuildContext context) {
    return _SheetShell(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _SheetHandle(),
          const Text(
            'Delete post?',
            style: TextStyle(
              color: _ConnectColors.ink,
              fontSize: 20,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'This will remove your ${post.tag.toLowerCase()} post from the company feed.',
            style: const TextStyle(
              color: _ConnectColors.inkSoft,
              fontSize: 13.5,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 20),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => Navigator.of(context).pop(false),
                  child: const Text('Cancel'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: _ConnectColors.live,
                    foregroundColor: Colors.white,
                  ),
                  onPressed: () => Navigator.of(context).pop(true),
                  child: const Text('Delete'),
                ),
              ),
            ],
          ),
        ],
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
          color: _ConnectColors.faint,
          fontSize: 11.5,
          fontWeight: FontWeight.w800,
          letterSpacing: 0,
        ),
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
              color: selected ? _ConnectColors.terraTint : Colors.white,
              borderRadius: BorderRadius.circular(99),
              border: Border.all(
                color: selected
                    ? _ConnectColors.terra
                    : _ConnectColors.cardBorder,
                width: 1.5,
              ),
            ),
            child: Text(
              item.$2,
              style: TextStyle(
                color: selected ? _ConnectColors.terra : _ConnectColors.inkSoft,
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

class _TeammateSelector extends StatelessWidget {
  const _TeammateSelector({
    required this.teammates,
    required this.selectedName,
    required this.onChanged,
  });

  final List<ConnectTeammate> teammates;
  final String selectedName;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    if (teammates.isEmpty) {
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
    return SizedBox(
      height: 96,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: teammates.length,
        separatorBuilder: (_, _) => const SizedBox(width: 12),
        itemBuilder: (context, index) {
          final teammate = teammates[index];
          final name = teammate.name;
          final selected = selectedName == name;
          return InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: () => onChanged(name),
            child: SizedBox(
              width: 86,
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  _InitialAvatar(
                    initials: teammate.initials,
                    color: selected
                        ? _ConnectColors.terra
                        : _ConnectColors.gold,
                    size: 38,
                  ),
                  const SizedBox(height: 7),
                  Text(
                    name.split(' ').first,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: selected
                          ? _ConnectColors.terra
                          : _ConnectColors.ink,
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
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
    this.existingLabel,
    this.existingMediaKind,
    this.existingMediaUrl,
  });

  final bool enabled;
  final VoidCallback onTap;
  final VoidCallback? onRemove;
  final ConnectMediaAttachment? selectedMedia;
  final String? existingLabel;
  final String? existingMediaKind;
  final String? existingMediaUrl;

  @override
  Widget build(BuildContext context) {
    final label = _displayLabel;
    if (enabled) {
      return Container(
        width: double.infinity,
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: _ConnectColors.terra, width: 1.5),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _preview(),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
              child: Row(
                children: [
                  Icon(
                    _isVideo ? Icons.videocam_rounded : Icons.image_rounded,
                    color: _ConnectColors.terra,
                    size: 22,
                  ),
                  const SizedBox(width: 9),
                  Expanded(
                    child: Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: _ConnectColors.ink,
                        fontSize: 12.5,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  IconButton(
                    tooltip: 'Remove media',
                    onPressed: onRemove,
                    icon: const Icon(Icons.close_rounded),
                    color: _ConnectColors.inkSoft,
                  ),
                  IconButton(
                    tooltip: 'Replace media',
                    onPressed: onTap,
                    icon: const Icon(Icons.swap_horiz_rounded),
                    color: _ConnectColors.terra,
                  ),
                ],
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

  String get _displayLabel {
    if (_isVideo) return 'Video selected';
    if (_isImage) return 'Photo selected';
    if (selectedMedia != null) return 'Media selected';
    return existingLabel?.isNotEmpty == true
        ? existingLabel!
        : 'Media attached';
  }

  bool get _isImage {
    final mime = selectedMedia?.mimeType;
    if (mime != null) return mime.startsWith('image/');
    return existingMediaKind == 'image';
  }

  bool get _isVideo {
    final mime = selectedMedia?.mimeType;
    if (mime != null) return mime.startsWith('video/');
    return existingMediaKind == 'video';
  }

  Widget _preview() {
    final media = selectedMedia;
    if (media != null && media.mimeType.startsWith('image/')) {
      return AspectRatio(
        aspectRatio: 16 / 9,
        child: Image.file(File(media.path), fit: BoxFit.cover),
      );
    }
    final url = existingMediaUrl;
    if (url != null && url.isNotEmpty && existingMediaKind == 'image') {
      return AspectRatio(
        aspectRatio: 16 / 9,
        child: Image.network(url, fit: BoxFit.cover),
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

class _ComposerSubmitButton extends StatelessWidget {
  const _ComposerSubmitButton({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: FilledButton(
        style: FilledButton.styleFrom(
          backgroundColor: _ConnectColors.terra,
          foregroundColor: Colors.white,
          padding: const EdgeInsets.symmetric(vertical: 15),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
        ),
        onPressed: onTap,
        child: Text(label),
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
  });

  final IconData icon;
  final String title;
  final String body;
  final String actionLabel;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: _ConnectColors.terra, size: 42),
            const SizedBox(height: 14),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: _ConnectColors.ink,
                fontSize: 20,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              body,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: _ConnectColors.inkSoft,
                fontSize: 13.5,
                height: 1.45,
              ),
            ),
            const SizedBox(height: 16),
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

  static const bg = Color(0xFFEDE6DA);
  static const cardBorder = Color(0xFFF0E8DD);
  static const divider = Color(0xFFF3EDE4);
  static const ink = Color(0xFF2A2420);
  static const inkSoft = Color(0xFF6E655C);
  static const faint = Color(0xFFA79D92);
  static const terra = Color(0xFFBE5A36);
  static const terraTint = Color(0xFFF6E5DB);
  static const gold = Color(0xFFC98A2E);
  static const goldTint = Color(0xFFF4ECDD);
  static const sage = Color(0xFF4C5840);
  static const sageTint = Color(0xFFE9EBE0);
  static const teal = Color(0xFF4F8C89);
  static const plum = Color(0xFF8A6AA0);
  static const rose = Color(0xFFC26B8A);
  static const roseTint = Color(0xFFF5E4EC);
  static const live = Color(0xFFE0483B);
  static const sand = Color(0xFFEFEDDD);
}

String _bodyString(ConnectPost post, String key) {
  final value = post.body[key];
  return value == null ? '' : value.toString();
}

Color _hexColor(String value, Color fallback) {
  final normalized = value.replaceFirst('#', '');
  if (normalized.length != 6) return fallback;
  final parsed = int.tryParse(normalized, radix: 16);
  if (parsed == null) return fallback;
  return Color(0xFF000000 | parsed);
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

String _announcementSeverityValue(String value) {
  return switch (value) {
    'highlight' || 'alert' || 'highlight_alert' => 'highlight_alert',
    _ => 'plain',
  };
}

extension on Widget {
  Widget withDefaultTextStyle(TextStyle style) {
    return DefaultTextStyle(style: style, child: this);
  }
}
