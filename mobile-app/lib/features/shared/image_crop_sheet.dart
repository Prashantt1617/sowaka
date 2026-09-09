/// A crop step for any image the app is about to upload.
///
/// Hand-rolled rather than pulled from a package: the ones available need
/// native platform configuration on every target, and this needs nothing but
/// Flutter. The picked image is panned and zoomed behind a fixed frame, and the
/// frame is what gets captured — so what the person lines up is exactly what is
/// uploaded, at the aspect ratio the destination expects.
///
/// Returns the path of a new temporary PNG, or null if cancelled.
library;

import 'dart:async';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';

/// How much a `BoxFit.contain` layout has to be zoomed to fill the frame.
///
/// Under `contain` the photo is letterboxed inside the frame; this is the
/// factor that turns that into a fill, which is where a crop should start.
/// Extracted so the arithmetic can be checked without a screen.
double coverScaleFor(double imageAspect, double frameAspect) {
  if (imageAspect <= 0 || frameAspect <= 0) return 1;
  return imageAspect > frameAspect ? imageAspect / frameAspect : frameAspect / imageAspect;
}

/// The transform that leaves the photo filling the frame, centred.
Matrix4 coverTransform(double imageAspect, Size frame) {
  final scale = coverScaleFor(imageAspect, frame.width / frame.height);
  return Matrix4.identity()
    ..translateByDouble(-(scale - 1) * frame.width / 2, -(scale - 1) * frame.height / 2, 0, 1)
    ..scaleByDouble(scale, scale, 1, 1);
}

/// The shapes on offer. A profile photo is locked to square; media posts choose.
enum CropShape {
  square(1, 'Square', '1:1'),
  portrait(4 / 5, 'Portrait', '4:5'),
  landscape(16 / 9, 'Landscape', '16:9');

  const CropShape(this.aspect, this.label, this.ratio);
  final double aspect;
  final String label;
  final String ratio;
}

Future<String?> cropImageFile(
  BuildContext context, {
  required String path,
  required String title,
  CropShape initial = CropShape.square,
  bool allowShapeChange = true,
}) {
  return Navigator.of(context, rootNavigator: true).push<String>(
    MaterialPageRoute(
      fullscreenDialog: true,
      builder: (_) => _CropPage(
        path: path,
        title: title,
        initial: initial,
        allowShapeChange: allowShapeChange,
      ),
    ),
  );
}

class _CropPage extends StatefulWidget {
  const _CropPage({
    required this.path,
    required this.title,
    required this.initial,
    required this.allowShapeChange,
  });

  final String path;
  final String title;
  final CropShape initial;
  final bool allowShapeChange;

  @override
  State<_CropPage> createState() => _CropPageState();
}

class _CropPageState extends State<_CropPage> {
  final _boundary = GlobalKey();
  final _controller = TransformationController();
  late CropShape _shape = widget.initial;
  bool _saving = false;
  /// The picked image's own aspect ratio, needed to work out how far it has to
  /// be zoomed to fill the frame. Null until the file has been decoded.
  double? _imageAspect;
  Size? _sourceSize;
  Size? _frame;

  @override
  void initState() {
    super.initState();
    _measure();
  }

  /// Reads the image's dimensions off the decoded file.
  void _measure() {
    final stream = FileImage(File(widget.path)).resolve(ImageConfiguration.empty);
    late final ImageStreamListener listener;
    listener = ImageStreamListener((info, _) {
      stream.removeListener(listener);
      if (!mounted) return;
      setState(() {
        _imageAspect = info.image.width / info.image.height;
        _sourceSize = Size(info.image.width.toDouble(), info.image.height.toDouble());
      });
      _reset();
    }, onError: (error, stack) {
      stream.removeListener(listener);
      if (mounted) setState(() => _imageAspect = 1);
    });
    stream.addListener(listener);
  }

  /// Positions the image so it exactly fills the frame, centred.
  ///
  /// The child is laid out with `BoxFit.contain`, so the whole photo is present
  /// and pannable — this only zooms it up to cover, which is where a crop
  /// should start. Laying the child out with `cover` instead is what made
  /// dragging useless: the image was already cropped inside its own box, so
  /// panning moved a fixed crop around rather than choosing one.
  void _reset() {
    final aspect = _imageAspect;
    final frame = _frame;
    if (aspect == null || frame == null || frame.isEmpty) {
      _controller.value = Matrix4.identity();
      return;
    }
    _controller.value = coverTransform(aspect, frame);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _confirm() async {
    if (_saving) return;
    setState(() => _saving = true);
    try {
      final object = _boundary.currentContext?.findRenderObject();
      if (object is! RenderRepaintBoundary) throw StateError('nothing to capture');
      // Captured at the source's own density where possible, so cropping a
      // 4000px photo does not hand back a 700px one. Capped so a huge original
      // cannot produce an unencodable canvas.
      final frameWidth = _frame?.width ?? object.size.width;
      final sourceWidth = (_imageAspect ?? 1) >= 1
          ? (_sourceSize?.width ?? 0)
          : (_sourceSize?.height ?? 0);
      final density = frameWidth > 0 && sourceWidth > 0 ? sourceWidth / frameWidth : 2.0;
      final image = await object.toImage(pixelRatio: density.clamp(1.5, 4.0));
      final data = await image.toByteData(format: ui.ImageByteFormat.png);
      image.dispose();
      if (data == null) throw StateError('could not encode the crop');
      final bytes = data.buffer.asUint8List();
      final file = await _writeTemp(bytes);
      if (mounted) Navigator.of(context).pop(file.path);
    } catch (_) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not crop that image. Try again.')),
      );
    }
  }

  Future<File> _writeTemp(Uint8List bytes) async {
    final dir = await Directory.systemTemp.createTemp('sowaka_crop');
    final file = File('${dir.path}/crop_${DateTime.now().millisecondsSinceEpoch}.png');
    await file.writeAsBytes(bytes, flush: true);
    return file;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF16181B),
      appBar: AppBar(
        backgroundColor: const Color(0xFF16181B),
        foregroundColor: Colors.white,
        elevation: 0,
        title: Text(widget.title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
        actions: [
          TextButton(
            onPressed: _saving ? null : _confirm,
            child: Text(
              _saving ? 'Saving…' : 'Done',
              style: const TextStyle(color: Color(0xFF4FA8DA), fontSize: 16, fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: Center(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: AspectRatio(
                  aspectRatio: _shape.aspect,
                  child: LayoutBuilder(
                    builder: (context, constraints) {
                      final size = Size(constraints.maxWidth, constraints.maxHeight);
                      if (_frame != size) {
                        _frame = size;
                        // The frame is only known once it is laid out, and the
                        // starting zoom depends on it.
                        WidgetsBinding.instance.addPostFrameCallback((_) {
                          if (mounted) _reset();
                        });
                      }
                      // Only what sits inside this box is captured, so the
                      // frame on screen and the file written cannot disagree.
                      return Stack(
                        fit: StackFit.expand,
                        children: [
                      RepaintBoundary(
                        key: _boundary,
                        child: ClipRect(
                          child: ColoredBox(
                            color: const Color(0xFF0E0F11),
                            child: InteractiveViewer(
                              transformationController: _controller,
                              minScale: 0.4,
                              maxScale: 8,
                              // Unbounded, so the subject can be dragged to any
                              // corner of the frame rather than being pinned
                              // once an edge is reached.
                              boundaryMargin: const EdgeInsets.all(double.infinity),
                              clipBehavior: Clip.none,
                              child: Image.file(
                                File(widget.path),
                                // Contain: the whole photo is laid out, and the
                                // transform decides what the frame keeps.
                                fit: BoxFit.contain,
                                width: double.infinity,
                                height: double.infinity,
                                filterQuality: FilterQuality.medium,
                                errorBuilder: (context, error, stack) => const Center(
                                  child: Text('Could not open that image',
                                      style: TextStyle(color: Colors.white70)),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                      // Guides only — outside the RepaintBoundary, so they
                      // help line a subject up without ending up in the file.
                      const IgnorePointer(child: _ThirdsGrid()),
                        ],
                      );
                    },
                  ),
                ),
              ),
            ),
          ),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 24),
            child: Text(
              'Drag to move · pinch or scroll to zoom · the frame is what gets posted',
              style: TextStyle(color: Colors.white54, fontSize: 13),
            ),
          ),
          if (widget.allowShapeChange)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  for (final shape in CropShape.values)
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 5),
                      child: _ShapeChip(
                        shape: shape,
                        selected: shape == _shape,
                        onTap: () {
                          // The old pan belongs to the old frame, so refit.
                          setState(() => _shape = shape);
                          WidgetsBinding.instance.addPostFrameCallback((_) {
                            if (mounted) _reset();
                          });
                        },
                      ),
                    ),
                ],
              ),
            ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 6, 16, 10),
              child: TextButton(
                onPressed: _reset,
                child: const Text('Reset', style: TextStyle(color: Colors.white70)),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Rule-of-thirds guides. Drawn over the frame, never captured with it.
class _ThirdsGrid extends StatelessWidget {
  const _ThirdsGrid();

  @override
  Widget build(BuildContext context) => CustomPaint(painter: _ThirdsPainter());
}

class _ThirdsPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final line = Paint()
      ..color = const Color(0x33FFFFFF)
      ..strokeWidth = 1;
    for (var i = 1; i < 3; i++) {
      final x = size.width * i / 3;
      final y = size.height * i / 3;
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), line);
      canvas.drawLine(Offset(0, y), Offset(size.width, y), line);
    }
    canvas.drawRect(
      Offset.zero & size,
      Paint()
        ..color = const Color(0x55FFFFFF)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5,
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _ShapeChip extends StatelessWidget {
  const _ShapeChip({required this.shape, required this.selected, required this.onTap});

  final CropShape shape;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
        decoration: BoxDecoration(
          color: selected ? Colors.white : Colors.white10,
          borderRadius: BorderRadius.circular(99),
        ),
        child: Text(
          '${shape.label} · ${shape.ratio}',
          style: TextStyle(
            color: selected ? const Color(0xFF16181B) : Colors.white70,
            fontSize: 13,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}
