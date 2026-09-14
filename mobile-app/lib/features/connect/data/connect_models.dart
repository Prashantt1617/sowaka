enum ConnectPostType {
  leadership,
  hrAnnouncement,
  newPost,
  birthday,
  anniversary,
  kudos,
  award,
  survey,
  event,
  liveGame,
  newJoinee,
  recommendation,
}

class ConnectTeammate {
  const ConnectTeammate({
    required this.name,
    required this.initials,
    this.userId = '',
    this.department = '',
    this.photoUrl,
  });

  /// Empty for teammates supplied without one — kudos matches on name, but
  /// tagging needs a stable id.
  final String userId;
  final String name;
  final String initials;
  final String department;
  final String? photoUrl;
}

class ConnectAuthor {
  const ConnectAuthor({
    required this.userId,
    required this.name,
    required this.initials,
    required this.designation,
    required this.avatarColor,
    this.photoUrl,
  });

  final String userId;
  final String name;
  final String initials;
  final String designation;
  final String avatarColor;
  final String? photoUrl;

  factory ConnectAuthor.fromJson(Map<String, dynamic> json) {
    return ConnectAuthor(
      userId: json['userId'] as String? ?? '',
      name: json['name'] as String? ?? 'Sowaka',
      initials: json['initials'] as String? ?? 'S',
      designation: json['designation'] as String? ?? '',
      avatarColor: json['avatarColor'] as String? ?? '#BE5A36',
      photoUrl: json['photoUrl'] as String?,
    );
  }
}

class ConnectPostDraft {
  const ConnectPostDraft({
    required this.type,
    required this.body,
    this.media,
    this.mediaList = const [],
    this.pollOptionImages = const [],
    this.removeMedia = false,
  });

  final ConnectPostType type;
  final Map<String, dynamic> body;
  final ConnectMediaAttachment? media;

  /// Multiple images for a single post (item: multi-image support). When
  /// non-empty this is sent instead of `media`.
  final List<ConnectMediaAttachment> mediaList;

  /// Parallel to the survey's poll options by index; a null entry means that
  /// option has no image.
  final List<ConnectMediaAttachment?> pollOptionImages;
  final bool removeMedia;

  Map<String, dynamic> toJson() {
    return {
      'type': connectPostTypeToWire(type),
      'removeMedia': removeMedia,
      'body': body,
    };
  }
}

class ConnectMediaAttachment {
  const ConnectMediaAttachment({
    required this.path,
    required this.name,
    required this.size,
    required this.mimeType,
  });

  final String path;
  final String name;
  final int size;
  final String mimeType;
}

String connectPostTypeToWire(ConnectPostType type) {
  return switch (type) {
    ConnectPostType.leadership => 'leadership',
    ConnectPostType.hrAnnouncement => 'hr_announcement',
    ConnectPostType.newPost => 'new_post',
    ConnectPostType.birthday => 'birthday',
    ConnectPostType.anniversary => 'anniversary',
    ConnectPostType.kudos => 'kudos',
    ConnectPostType.award => 'award',
    ConnectPostType.survey => 'survey',
    ConnectPostType.event => 'event',
    ConnectPostType.liveGame => 'live_game',
    ConnectPostType.newJoinee => 'new_joinee',
    ConnectPostType.recommendation => 'recommendation',
  };
}

class ConnectAudience {
  const ConnectAudience({required this.label});

  final String label;

  factory ConnectAudience.fromJson(Map<String, dynamic> json) {
    return ConnectAudience(label: json['label'] as String? ?? 'Public');
  }
}

class ConnectComment {
  const ConnectComment({
    required this.id,
    required this.name,
    required this.text,
    required this.createdAt,
    this.userId = '',
    this.parentId,
    this.likeCount = 0,
    this.liked = false,
  });

  final String id;

  /// Who wrote it — needed to tell your own comment from someone else's, which
  /// is what decides whether reporting and blocking are offered on it.
  final String userId;
  final String name;
  final String text;
  final DateTime? createdAt;
  final String? parentId;
  final int likeCount;
  final bool liked;

  factory ConnectComment.fromJson(Map<String, dynamic> json) {
    return ConnectComment(
      id: json['id'] as String? ?? '',
      userId: json['userId'] as String? ?? '',
      name: json['name'] as String? ?? 'Teammate',
      text: json['text'] as String? ?? '',
      createdAt: DateTime.tryParse(json['createdAt'] as String? ?? ''),
      parentId: json['parentId'] as String?,
      likeCount: (json['likeCount'] as num?)?.toInt() ?? 0,
      liked: json['liked'] as bool? ?? false,
    );
  }
}

class ConnectPollOption {
  const ConnectPollOption({
    required this.id,
    required this.label,
    required this.votes,
    this.imageUrl,
  });

  final String id;
  final String label;
  final int votes;
  final String? imageUrl;

  factory ConnectPollOption.fromJson(Map<String, dynamic> json) {
    return ConnectPollOption(
      id: json['id'] as String? ?? '',
      label: json['label'] as String? ?? '',
      votes: (json['votes'] as num?)?.toInt() ?? 0,
      imageUrl: json['imageUrl'] as String?,
    );
  }
}

class ConnectPost {
  const ConnectPost({
    required this.id,
    required this.type,
    required this.tag,
    required this.tagIcon,
    required this.tagColor,
    required this.tagTint,
    required this.author,
    required this.audience,
    required this.body,
    required this.liked,
    required this.likeCount,
    required this.commentCount,
    required this.comments,
    required this.publishedAt,
    this.selectedPollOptionId,
    this.actionValue,
  });

  final String id;
  final ConnectPostType type;
  final String tag;
  final String tagIcon;
  final String tagColor;
  final String tagTint;
  final ConnectAuthor author;
  final ConnectAudience audience;
  final Map<String, dynamic> body;
  final bool liked;
  final int likeCount;
  final int commentCount;
  final List<ConnectComment> comments;
  final DateTime? publishedAt;
  final String? selectedPollOptionId;
  final String? actionValue;

  List<ConnectPollOption> get pollOptions {
    final values = body['options'] as List<dynamic>? ?? const [];
    return values
        .map(
          (value) => ConnectPollOption.fromJson(value as Map<String, dynamic>),
        )
        .toList();
  }

  int get totalVotes {
    final explicit = (body['totalVotes'] as num?)?.toInt();
    if (explicit != null) return explicit;
    return pollOptions.fold(0, (sum, option) => sum + option.votes);
  }

  factory ConnectPost.fromJson(Map<String, dynamic> json) {
    return ConnectPost(
      id: json['id'] as String? ?? '',
      type: _parseType(json['type'] as String?),
      tag: json['tag'] as String? ?? 'Update',
      tagIcon: json['tagIcon'] as String? ?? '•',
      tagColor: json['tagColor'] as String? ?? '#BE5A36',
      tagTint: json['tagTint'] as String? ?? '#F6E5DB',
      author: ConnectAuthor.fromJson(
        json['author'] as Map<String, dynamic>? ?? const {},
      ),
      audience: ConnectAudience.fromJson(
        json['audience'] as Map<String, dynamic>? ?? const {},
      ),
      body: Map<String, dynamic>.from(
        json['body'] as Map<String, dynamic>? ?? const {},
      ),
      liked: json['liked'] as bool? ?? false,
      likeCount: (json['likeCount'] as num?)?.toInt() ?? 0,
      commentCount: (json['commentCount'] as num?)?.toInt() ?? 0,
      comments: (json['comments'] as List<dynamic>? ?? const [])
          .map(
            (value) => ConnectComment.fromJson(value as Map<String, dynamic>),
          )
          .toList(),
      publishedAt: DateTime.tryParse(json['publishedAt'] as String? ?? ''),
      selectedPollOptionId: json['selectedPollOptionId'] as String?,
      actionValue: json['actionValue'] as String?,
    );
  }
}

ConnectPostType _parseType(String? value) {
  return switch (value) {
    'leadership' => ConnectPostType.leadership,
    'hr_announcement' => ConnectPostType.hrAnnouncement,
    'new_post' => ConnectPostType.newPost,
    'birthday' => ConnectPostType.birthday,
    'anniversary' => ConnectPostType.anniversary,
    'kudos' => ConnectPostType.kudos,
    'award' => ConnectPostType.award,
    'survey' => ConnectPostType.survey,
    'event' => ConnectPostType.event,
    'live_game' => ConnectPostType.liveGame,
    'new_joinee' => ConnectPostType.newJoinee,
    'recommendation' => ConnectPostType.recommendation,
    _ => ConnectPostType.leadership,
  };
}

/// Why someone is reporting a post or a comment.
///
/// The list is fixed and matches the backend's — a report goes to the
/// reporter's own HR team, and these are the categories they act on.
enum ConnectReportReason {
  harassment,
  hate,
  sexual,
  violence,
  confidential,
  spam,
  other,
}

String connectReportReasonToWire(ConnectReportReason reason) {
  return switch (reason) {
    ConnectReportReason.harassment => 'harassment',
    ConnectReportReason.hate => 'hate',
    ConnectReportReason.sexual => 'sexual',
    ConnectReportReason.violence => 'violence',
    ConnectReportReason.confidential => 'confidential',
    ConnectReportReason.spam => 'spam',
    ConnectReportReason.other => 'other',
  };
}

String connectReportReasonLabel(ConnectReportReason reason) {
  return switch (reason) {
    ConnectReportReason.harassment => 'Harassment or bullying',
    ConnectReportReason.hate => 'Hate speech or discrimination',
    ConnectReportReason.sexual => 'Sexual or explicit content',
    ConnectReportReason.violence => 'Violence or threats',
    ConnectReportReason.confidential => 'Confidential information',
    ConnectReportReason.spam => 'Spam or irrelevant content',
    ConnectReportReason.other => 'Something else',
  };
}

/// A colleague this person has chosen not to see in Connect.
class BlockedPerson {
  const BlockedPerson({
    required this.userId,
    required this.name,
    this.designation = '',
    this.photoUrl,
    this.blockedAt,
  });

  final String userId;
  final String name;
  final String designation;
  final String? photoUrl;
  final DateTime? blockedAt;

  factory BlockedPerson.fromJson(Map<String, dynamic> json) {
    return BlockedPerson(
      userId: json['userId'] as String? ?? '',
      name: json['name'] as String? ?? 'Colleague',
      designation: json['designation'] as String? ?? '',
      photoUrl: json['photoUrl'] as String?,
      blockedAt: DateTime.tryParse(json['blockedAt'] as String? ?? ''),
    );
  }
}
