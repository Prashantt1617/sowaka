import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../auth/data/auth_models.dart';
import '../../manager/data/manager_api_service.dart';
import '../../shared/image_crop_sheet.dart';
import '../../shared/image_source_sheet.dart';
import '../../shared/org_branding.dart';

/// What someone does once, the first time they arrive (Figma 2755:28725,
/// 2755:28758, 2759:40979).
///
/// Two questions and a notice: a photo so colleagues recognise them, what
/// they are into, and — where their company has its own brand — that the app
/// they just downloaded is about to look like their company's.
class OnboardingFlow extends StatefulWidget {
  const OnboardingFlow({
    super.key,
    required this.session,
    required this.api,
    required this.onDone,
    @visibleForTesting this.initialStep = 0,
  });

  /// Which step to open on; only a test ever starts anywhere but the photo.
  final int initialStep;

  final AuthSession session;
  final ManagerApiService api;

  /// Called with the photo's URL (empty if unchanged) once everything is done.
  final void Function(String photoUrl, List<String> interests) onDone;

  /// The list the design ships, in its order.
  static const interests = <_Interest>[
    _Interest('Music', 'int_music.png'),
    _Interest('Photography', 'int_photography.png'),
    _Interest('Travel', 'int_travel.png'),
    _Interest('Cricket', 'int_cricket.png'),
    _Interest('Fitness', 'int_fitness.png'),
    _Interest('Gaming', 'int_gaming.png'),
    _Interest('Art', 'int_art.png'),
    _Interest('Stocks', 'int_stocks.png'),
    _Interest('Books', 'int_books.png'),
    _Interest('Pets', 'int_books.png'),
    _Interest('Clubbing', 'int_books.png'),
    _Interest('AI', 'int_ai.png'),
  ];

  static const maxInterests = 3;

  @override
  State<OnboardingFlow> createState() => _OnboardingFlowState();
}

class _Interest {
  const _Interest(this.label, this.icon);
  final String label;
  final String icon;
}

const _asset = 'assets/onboarding';
const _brand = Color(0xFF0571A6);
const _brandDeep = Color(0xFF1A7FA6);
const _ink = Color(0xFF1A1A2E);
const _muted = Color(0xFF7A7A9A);
const _tint = Color(0xFFE8F4F8);
const _field = Color(0xFFF7FAFB);
const _line = Color(0xFFE8E8F0);

class _OnboardingFlowState extends State<OnboardingFlow> {
  /// 0 = photo, 1 = interests. The third segment is the logo notice.
  late int _step = widget.initialStep;

  String? _photoPath;
  String _photoUrl = '';
  final _picked = <String>{};
  bool _busy = false;
  String? _problem;

  Future<void> _choosePhoto() async {
    final file = await pickImageFrom(context);
    if (file == null || !mounted) return;
    final cropped = await cropImageFile(
      context,
      path: file.path,
      title: 'Crop your photo',
      initial: CropShape.square,
      allowShapeChange: false,
      maxEdge: 1024,
    );
    if (cropped == null || !mounted) return;
    setState(() {
      _photoPath = cropped;
      _problem = null;
    });
  }

  Future<void> _continueFromPhoto() async {
    final path = _photoPath;
    if (path == null || _busy) return;
    setState(() {
      _busy = true;
      _problem = null;
    });
    try {
      _photoUrl = await widget.api.updateProfilePhoto(
        path: path,
        filename: 'profile.png',
      );
      if (mounted) setState(() => _step = 1);
    } catch (error) {
      final reason = error is ManagerApiException ? error.message : null;
      if (mounted) {
        setState(() => _problem = reason ?? 'Could not upload that photo. Try again.');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _continueFromInterests() async {
    if (_picked.isEmpty || _busy) return;
    setState(() {
      _busy = true;
      _problem = null;
    });
    final chosen = _picked.toList();
    try {
      await widget.api.updateInterests(chosen);
    } catch (_) {
      // Nothing reads these yet, and a person who has just added their photo
      // should not be held at a door over them.
    }
    if (!mounted) return;
    setState(() => _busy = false);
    final branding = OrgBranding.of(widget.session.user.org);
    if (!branding.isSowaka) await _showLogoChanged(branding);
    if (!mounted) return;
    widget.onDone(_photoUrl, chosen);
  }

  Future<void> _showLogoChanged(OrgBranding branding) {
    return showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (context) => _LogoChangedDialog(branding: branding),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _brandDeep,
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(height: MediaQuery.paddingOf(context).top + 79),
          Expanded(
            child: Container(
              decoration: const BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
              ),
              padding: const EdgeInsets.fromLTRB(16, 34, 16, 32),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _Progress(step: _step),
                  const SizedBox(height: 48),
                  Expanded(
                    child: _step == 0 ? _photoStep() : _interestsStep(),
                  ),
                  if (_problem != null) ...[
                    Text(
                      _problem!,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontFamily: 'Sora',
                        fontSize: 13,
                        color: Color(0xFFC0392B),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  _Continue(
                    enabled: _step == 0 ? _photoPath != null : _picked.isNotEmpty,
                    busy: _busy,
                    onTap: _step == 0 ? _continueFromPhoto : _continueFromInterests,
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _photoStep() {
    final path = _photoPath;
    return SingleChildScrollView(
      child: Column(
        children: [
          const _Introduction(
            title: 'Add a profile photo',
            body: 'Help people recognize you. You can always change it later.',
          ),
          const SizedBox(height: 32),
          GestureDetector(
            onTap: _choosePhoto,
            child: Container(
              width: 144,
              height: 144,
              decoration: BoxDecoration(
                color: _field,
                shape: BoxShape.circle,
                border: Border.all(color: _line, width: 2),
                image: path == null
                    ? null
                    : DecorationImage(image: FileImage(File(path)), fit: BoxFit.cover),
              ),
              child: path != null
                  ? null
                  : Center(
                      child: SvgPicture.asset('$_asset/user.svg', width: 56, height: 56),
                    ),
            ),
          ),
          const SizedBox(height: 20),
          Center(
            child: GestureDetector(
              onTap: _choosePhoto,
              child: Container(
                width: 203,
                height: 48,
                decoration: BoxDecoration(
                  color: _tint,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    SvgPicture.asset('$_asset/camera.svg', width: 20, height: 20),
                    const SizedBox(width: 10),
                    Text(
                      path == null ? 'Add or take a photo' : 'Change photo',
                      style: const TextStyle(
                        fontFamily: 'Sora',
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: _brandDeep,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _interestsStep() {
    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const _Introduction(
            title: 'What are you into?',
            body: 'Choose up to 3 interests',
            gap: 7,
          ),
          const SizedBox(height: 7),
          Center(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(
                color: _tint,
                borderRadius: BorderRadius.circular(24),
              ),
              child: Text(
                '${_picked.length} of ${OnboardingFlow.maxInterests} selected',
                style: const TextStyle(
                  fontFamily: 'Sora',
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: _brandDeep,
                ),
              ),
            ),
          ),
          const SizedBox(height: 24),
          LayoutBuilder(
            builder: (context, box) {
              // Two to a row at the design's width, and still two on a narrow
              // phone rather than one wide chip and a gap.
              final width = (box.maxWidth - 10) / 2;
              return Wrap(
                spacing: 10,
                runSpacing: 10,
                children: [
                  for (final interest in OnboardingFlow.interests)
                    SizedBox(
                      width: width,
                      child: _InterestChip(
                        interest: interest,
                        selected: _picked.contains(interest.label),
                        onTap: () => _toggle(interest.label),
                      ),
                    ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }

  void _toggle(String label) {
    setState(() {
      if (_picked.contains(label)) {
        _picked.remove(label);
      } else if (_picked.length < OnboardingFlow.maxInterests) {
        _picked.add(label);
      }
    });
  }
}

class _Progress extends StatelessWidget {
  const _Progress({required this.step});

  /// How many segments are behind them; the third is the logo notice.
  final int step;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        for (var i = 0; i < 3; i += 1) ...[
          if (i > 0) const SizedBox(width: 8),
          Expanded(
            child: Container(
              height: 4,
              decoration: BoxDecoration(
                color: i <= step ? _brandDeep : const Color(0xFFE5E5EA),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
        ],
      ],
    );
  }
}

class _Introduction extends StatelessWidget {
  const _Introduction({required this.title, required this.body, this.gap = 8});

  final String title;
  final String body;
  final double gap;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          title,
          textAlign: TextAlign.center,
          style: const TextStyle(
            fontFamily: 'Sora',
            fontSize: 24,
            height: 32 / 24,
            fontWeight: FontWeight.w700,
            color: _ink,
          ),
        ),
        SizedBox(height: gap),
        Text(
          body,
          textAlign: TextAlign.center,
          style: const TextStyle(
            fontFamily: 'Sora',
            fontSize: 14,
            height: 21 / 14,
            color: _muted,
          ),
        ),
      ],
    );
  }
}

class _InterestChip extends StatelessWidget {
  const _InterestChip({
    required this.interest,
    required this.selected,
    required this.onTap,
  });

  final _Interest interest;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        height: 52,
        padding: const EdgeInsets.symmetric(horizontal: 14),
        decoration: BoxDecoration(
          color: selected ? _tint : _field,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: selected ? _brandDeep : _line,
            width: selected ? 2 : 1,
          ),
        ),
        child: Row(
          children: [
            Image.asset('$_asset/${interest.icon}', width: 24, height: 24),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                interest.label,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontFamily: 'Sora',
                  fontSize: 13,
                  fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                  color: selected ? _brandDeep : _ink,
                ),
              ),
            ),
            if (selected) ...[
              const SizedBox(width: 10),
              SvgPicture.asset('$_asset/check_circle.svg', width: 16, height: 16),
            ],
          ],
        ),
      ),
    );
  }
}

class _Continue extends StatelessWidget {
  const _Continue({required this.enabled, required this.busy, required this.onTap});

  final bool enabled;
  final bool busy;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: enabled && !busy ? 1 : 0.5,
      child: GestureDetector(
        onTap: enabled && !busy ? onTap : null,
        child: Container(
          height: 56,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: _brand,
            borderRadius: BorderRadius.circular(16),
          ),
          child: busy
              ? const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                )
              : const Text(
                  'Continue',
                  style: TextStyle(
                    fontFamily: 'Sora',
                    fontSize: 16,
                    height: 24 / 16,
                    letterSpacing: -0.16,
                    fontWeight: FontWeight.w600,
                    color: Colors.white,
                  ),
                ),
        ),
      ),
    );
  }
}

/// "You logo just changed" (Figma 2759:40979) — Sowaka's mark, an arrow, and
/// the company's, so nobody wonders why the icon on their home screen is not
/// the one they installed.
class _LogoChangedDialog extends StatelessWidget {
  const _LogoChangedDialog({required this.branding});

  final OrgBranding branding;

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: Colors.white,
      insetPadding: const EdgeInsets.symmetric(horizontal: 36.5),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                _Mark(asset: OrgBranding.sowaka.logoAsset!),
                const Expanded(
                  child: Icon(Icons.arrow_forward, size: 28, color: _ink),
                ),
                _Mark(asset: branding.logoAsset!),
              ],
            ),
            const SizedBox(height: 12),
            const Text(
              'You logo just changed',
              style: TextStyle(
                fontFamily: 'Sora',
                fontSize: 20,
                height: 30 / 20,
                fontWeight: FontWeight.w700,
                color: _ink,
              ),
            ),
            const SizedBox(height: 12),
            const Text(
              'We updated your logo to the company’s for a personalized feel.',
              style: TextStyle(
                fontFamily: 'Sora',
                fontSize: 14,
                height: 22 / 14,
                color: _muted,
              ),
            ),
            const SizedBox(height: 12),
            GestureDetector(
              onTap: () => Navigator.of(context).pop(),
              child: Container(
                height: 46,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: _brand,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Text(
                  'Okay',
                  style: TextStyle(
                    fontFamily: 'Sora',
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    color: Colors.white,
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

class _Mark extends StatelessWidget {
  const _Mark({required this.asset});

  final String asset;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(18),
      child: Image.asset(asset, width: 80, height: 80, fit: BoxFit.cover),
    );
  }
}
