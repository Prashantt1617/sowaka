import 'package:flutter/material.dart';

import '../../../auth/data/auth_models.dart';
import '../../../care/data/care_api_service.dart';
import '../../../care/data/care_models.dart';
import '../../data/help_api_service.dart';
import '../../data/help_models.dart';
import '../../data/help_topics.dart';
import '../topic_screen.dart';
import 'balance_topic_screen.dart';
import 'couples_topic_screen.dart';
import 'grief_topic_screen.dart';
import 'parents_topic_screen.dart';

/// The screen a topic draws, by the kind the catalogue gives it. A topic
/// added to the catalogue with no kind gets the generic page.
Widget topicScreenFor({
  required HelpTopic topic,
  required CareApiService care,
  required CareCatalog catalog,
  required AuthSession session,
  HelpApiService? help,
  HelpMatch? match,
  bool showCounsellor = true,
  String backLabel = 'Help',
}) {
  switch (topic.kind) {
    case 'grief':
      if (help != null)
        return GriefTopicScreen(
          topic: topic,
          help: help,
          match: match,
          backLabel: backLabel,
        );
    case 'balance':
      return BalanceTopicScreen(topic: topic, care: care, backLabel: backLabel);
    case 'parents':
      return ParentsTopicScreen(
        topic: topic,
        care: care,
        catalog: catalog,
        backLabel: backLabel,
      );
    case 'couples':
      return CouplesTopicScreen(
        topic: topic,
        care: care,
        catalog: catalog,
        backLabel: backLabel,
      );
  }
  return TopicScreen(
    topic: topic,
    care: care,
    catalog: catalog,
    session: session,
    service: help,
    matchedCounsellorId: match?.counsellor.userId,
    showCounsellor: showCounsellor && help != null,
    backLabel: backLabel,
  );
}
