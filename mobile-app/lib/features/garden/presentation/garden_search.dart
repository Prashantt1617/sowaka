import 'package:flutter/material.dart';

import '../../manager/presentation/manager_screen.dart';
import '../data/garden_models.dart';
import 'garden_widgets.dart';

/// Everyone in the company, to find a tree or a person to thank. Hands back
/// the person chosen.
class GardenSearchScreen extends StatefulWidget {
  const GardenSearchScreen({
    super.key,
    required this.people,
    required this.trees,
    this.title = 'Find someone',
  });

  final List<GardenPerson> people;
  final Map<String, List<GardenSprite>> trees;
  final String title;

  @override
  State<GardenSearchScreen> createState() => _GardenSearchScreenState();
}

class _GardenSearchScreenState extends State<GardenSearchScreen> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final q = _query.trim().toLowerCase();
    final rows = [
      for (final person in widget.people)
        if (q.isEmpty || person.name.toLowerCase().contains(q) || person.department.toLowerCase().contains(q))
          person,
    ];
    return Scaffold(
      backgroundColor: MColors.bg,
      body: Column(
        children: [
          GardenTopBar(title: widget.title, subtitle: 'Everyone in your garden', onBack: () => Navigator.of(context).pop()),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
            child: TextField(
              autofocus: true,
              onChanged: (value) => setState(() => _query = value),
              style: const TextStyle(color: MColors.ink, fontSize: 14),
              decoration: InputDecoration(
                hintText: 'Search by name or team',
                hintStyle: const TextStyle(color: MColors.inkFaint),
                prefixIcon: const Icon(Icons.search_rounded, color: MColors.inkFaint),
                filled: true,
                fillColor: Colors.white,
                contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(999), borderSide: const BorderSide(color: MColors.line)),
                enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(999), borderSide: const BorderSide(color: MColors.line)),
                focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(999), borderSide: const BorderSide(color: GardenColors.blue)),
              ),
            ),
          ),
          Expanded(
            child: ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
              itemCount: rows.length,
              separatorBuilder: (_, _) => const SizedBox(height: 8),
              itemBuilder: (_, index) {
                final person = rows[index];
                final sprites = widget.trees[person.userId] ?? const [];
                return PressableCard(
                  padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
                  onTap: () => Navigator.of(context).pop(person),
                  child: Row(
                    children: [
                      PersonFace(initial: person.initial, photoUrl: person.photoUrl, size: 40, index: person.name.length % 7),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              person.isMe ? '${person.name} (you)' : person.name,
                              style: const TextStyle(color: MColors.ink, fontSize: 14.5, fontWeight: FontWeight.w700),
                            ),
                            if (person.department.isNotEmpty)
                              Text(person.department, style: const TextStyle(color: MColors.inkSoft, fontSize: 12.5)),
                          ],
                        ),
                      ),
                      GardenTree(width: 44, sprites: sprites, spriteSize: 9),
                    ],
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
