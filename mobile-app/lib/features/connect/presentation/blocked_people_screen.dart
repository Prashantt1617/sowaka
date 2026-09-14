import 'package:flutter/material.dart';

import '../../auth/data/auth_models.dart';
import '../data/connect_api_service.dart';
import '../data/connect_models.dart';

/// Everyone this person has muted in Connect, and the one place a block can be
/// undone. Reached from the footnote under Profile — blocking is rare, and a
/// list that is empty for almost everyone does not belong higher up.
class BlockedPeopleScreen extends StatefulWidget {
  const BlockedPeopleScreen({super.key, required this.session});

  final AuthSession session;

  @override
  State<BlockedPeopleScreen> createState() => _BlockedPeopleScreenState();
}

class _BlockedPeopleScreenState extends State<BlockedPeopleScreen> {
  late final ConnectApiService _api = ConnectApiService(
    session: widget.session,
  );
  List<BlockedPerson>? _blocked;
  String? _error;
  String? _busyUserId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final blocked = await _api.fetchBlocked();
      if (!mounted) return;
      setState(() {
        _blocked = blocked;
        _error = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString());
    }
  }

  Future<void> _unblock(BlockedPerson person) async {
    setState(() => _busyUserId = person.userId);
    try {
      final blocked = await _api.unblockPerson(person.userId);
      if (!mounted) return;
      setState(() {
        _blocked = blocked;
        _busyUserId = null;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            "You'll see ${person.name}'s posts in Connect again.",
          ),
          behavior: SnackBarBehavior.floating,
          backgroundColor: const Color(0xFF1A1C1E),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _busyUserId = null);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error.toString()),
          behavior: SnackBarBehavior.floating,
          backgroundColor: const Color(0xFF1A1C1E),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final blocked = _blocked;
    return Scaffold(
      backgroundColor: const Color(0xFFF7F7F9),
      appBar: AppBar(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        elevation: 0,
        title: const Text(
          'Blocked people',
          style: TextStyle(
            color: Color(0xFF1A1C1E),
            fontSize: 17,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
      body: SafeArea(
        child: switch ((blocked, _error)) {
          (_, final String error) => _Centered(
            title: 'Could not load your blocked list',
            body: error,
            onRetry: _load,
          ),
          (null, _) => const Center(child: CircularProgressIndicator()),
          (final List<BlockedPerson> people, _) when people.isEmpty =>
            const _Centered(
              title: 'Nobody is blocked',
              body:
                  'If a colleague’s posts are not something you want to see, '
                  'block them from the menu on their post. Their posts and '
                  'comments stop appearing in your feed, and they are not '
                  'told.',
            ),
          (final List<BlockedPerson> people, _) => ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
            itemCount: people.length + 1,
            separatorBuilder: (_, _) => const SizedBox(height: 10),
            itemBuilder: (context, index) {
              if (index == 0) {
                return const Padding(
                  padding: EdgeInsets.only(bottom: 6),
                  child: Text(
                    'You do not see their posts or comments in Connect. They '
                    'are not told, and nothing about your work together '
                    'changes.',
                    style: TextStyle(
                      color: Color(0xFF6C727A),
                      fontSize: 13,
                      height: 1.5,
                    ),
                  ),
                );
              }
              final person = people[index - 1];
              return _BlockedRow(
                person: person,
                busy: _busyUserId == person.userId,
                onUnblock: () => _unblock(person),
              );
            },
          ),
        },
      ),
    );
  }
}

class _BlockedRow extends StatelessWidget {
  const _BlockedRow({
    required this.person,
    required this.busy,
    required this.onUnblock,
  });

  final BlockedPerson person;
  final bool busy;
  final VoidCallback onUnblock;

  @override
  Widget build(BuildContext context) {
    final photoUrl = person.photoUrl;
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFEBEBEB)),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 20,
            backgroundColor: const Color(0xFFE8EEF3),
            backgroundImage: photoUrl != null && photoUrl.isNotEmpty
                ? NetworkImage(photoUrl)
                : null,
            child: photoUrl != null && photoUrl.isNotEmpty
                ? null
                : Text(
                    _initials(person.name),
                    style: const TextStyle(
                      color: Color(0xFF0571A6),
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
                Text(
                  person.name,
                  style: const TextStyle(
                    color: Color(0xFF1A1C1E),
                    fontSize: 14.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (person.designation.isNotEmpty)
                  Text(
                    person.designation,
                    style: const TextStyle(
                      color: Color(0xFF9CA3AF),
                      fontSize: 12.5,
                    ),
                  ),
              ],
            ),
          ),
          SizedBox(
            height: 34,
            child: OutlinedButton(
              style: OutlinedButton.styleFrom(
                foregroundColor: const Color(0xFF0571A6),
                side: const BorderSide(color: Color(0xFFCFE3EE)),
                padding: const EdgeInsets.symmetric(horizontal: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
                textStyle: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
              onPressed: busy ? null : onUnblock,
              child: busy
                  ? const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Unblock'),
            ),
          ),
        ],
      ),
    );
  }

  String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return '?';
    if (parts.length == 1) return parts.first.characters.first.toUpperCase();
    return (parts.first.characters.first + parts.last.characters.first)
        .toUpperCase();
  }
}

class _Centered extends StatelessWidget {
  const _Centered({required this.title, required this.body, this.onRetry});

  final String title;
  final String body;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Color(0xFF1A1C1E),
                fontSize: 16,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              body,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Color(0xFF6C727A),
                fontSize: 13.5,
                height: 1.5,
              ),
            ),
            if (onRetry != null) ...[
              const SizedBox(height: 16),
              TextButton(onPressed: onRetry, child: const Text('Try again')),
            ],
          ],
        ),
      ),
    );
  }
}
