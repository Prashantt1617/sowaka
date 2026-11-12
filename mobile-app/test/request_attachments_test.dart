// Every place a request takes a file offers what the feed's photo picker
// does: Take a photo, Choose from gallery, and Choose file where a PDF is
// welcome too. The camera and the gallery stand in through
// `debugPickPhoto`, Files through a fake `file_picker` platform.
import 'dart:convert';
import 'dart:math';

import 'package:file_picker/file_picker.dart';
// ignore: implementation_imports
import 'package:file_picker/src/platform/file_picker_platform_interface.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:image/image.dart' as img;
import 'package:image_picker/image_picker.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/manager/bloc/manager_bloc.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';
import 'package:mobile_app/features/quick_actions/presentation/quick_actions_screen.dart';
import 'package:mobile_app/features/shared/attachment_picker.dart';
import 'package:mobile_app/features/shared/image_source_sheet.dart';

final _session = AuthSession(
  token: 'token',
  user: const AuthUser(
    id: 'tanvi',
    email: 'tanvi@example.test',
    name: 'Tanvi',
    role: 'employee',
    company: 'Sowaka',
    org: 'sowaka',
  ),
);

http.Response _json(Object body) => http.Response.bytes(
  utf8.encode(jsonEncode(body)),
  200,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

MockClient _server() => MockClient((request) async {
  if (request.url.path.endsWith('/manager/workspace')) {
    return _json({
      'success': true,
      'team': <dynamic>[],
      'holidays': <dynamic>[],
      'weekoffDays': [6],
      'shift': {
        'name': 'Default',
        'startTime': '09:30',
        'endTime': '18:30',
        'minHalfDayHours': 4,
        'minFullDayHours': 8,
        'weeklyOff': <String, dynamic>{},
        'leaveTypes': [
          {
            'key': 'casual',
            'name': 'Casual Leave',
            'advanceDays': 30,
            'allowBackdated': true,
            'backdatedDays': 30,
          },
        ],
        'leaveBalanceTracked': false,
      },
      'overtimeEnabled': true,
      'hasManager': true,
    });
  }
  return _json({
    'success': true,
    'leaves': <dynamic>[],
    'overtime': <dynamic>[],
    'regularizations': <dynamic>[],
    'claims': <dynamic>[],
    'types': <dynamic>[],
    'records': <dynamic>[],
    'balance': <String, dynamic>{},
  });
});

/// A JPEG by its first bytes, which is all the servers check.
final _jpeg = Uint8List.fromList([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

/// Files, made to hand back one PDF.
class _FakeFilePicker extends FilePickerMacOS {
  List<String>? askedFor;

  @override
  Future<FilePickerResult?> pickFiles({
    String? dialogTitle,
    String? initialDirectory,
    FileType type = FileType.any,
    List<String>? allowedExtensions,
    Function(FilePickerStatus)? onFileLoading,
    int compressionQuality = 0,
    bool allowMultiple = false,
    bool withData = false,
    bool withReadStream = false,
    bool lockParentWindow = false,
    bool readSequential = false,
    bool cancelUploadOnWindowBlur = true,
  }) async {
    askedFor = allowedExtensions;
    final bytes = Uint8List.fromList(utf8.encode('%PDF-1.4 note'));
    return FilePickerResult([
      PlatformFile(name: 'note.pdf', size: bytes.length, bytes: bytes),
    ]);
  }
}

void main() {
  setUp(() => debugHasNativeGallery = true);
  tearDown(() {
    debugHasNativeGallery = null;
    debugPickPhoto = null;
  });

  /// The sources the camera/gallery stand-in was asked for, in order.
  List<ImageSource> fakePhotos() {
    final asked = <ImageSource>[];
    debugPickPhoto = (source) async {
      asked.add(source);
      return XFile.fromData(_jpeg, name: 'image_picker_AE62.jpg');
    };
    return asked;
  }

  Future<void> pumpActions(WidgetTester tester) async {
    tester.view.physicalSize = const Size(393 * 2, 852 * 2);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    final bloc = ManagerBloc(
      session: _session,
      service: ManagerApiService(
        session: _session,
        baseUrl: 'https://example.test',
        client: _server(),
      ),
    );
    await tester.runAsync(() => bloc.add(const LoadManagerDashboard()));
    final controller = QuickActionsController();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: QuickActionsScreen(
            bloc: bloc,
            dashboard: bloc.state.dashboard!,
            controller: controller,
            profileAction: const SizedBox(width: 30, height: 30),
            onNotifications: () {},
            onOpenComposer: () {},
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 300)),
    );
    await tester.pump(const Duration(milliseconds: 300));
    addTearDown(() async {
      bloc.dispose();
      controller.dispose();
    });
  }

  Future<void> settle(WidgetTester tester) async {
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 100)),
    );
    await tester.pump(const Duration(milliseconds: 400));
  }

  Future<void> tapOn(WidgetTester tester, Finder finder) async {
    await tester.ensureVisible(finder);
    await tester.pump();
    await tester.tap(finder);
    await settle(tester);
  }

  void expectSheet({required bool withFiles}) {
    expect(find.byKey(const ValueKey('image-source-camera')), findsOneWidget);
    expect(find.text('Take a photo'), findsOneWidget);
    expect(find.byKey(const ValueKey('image-source-gallery')), findsOneWidget);
    expect(find.text('Choose from gallery'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('image-source-files')),
      withFiles ? findsOneWidget : findsNothing,
    );
    if (withFiles) expect(find.text('Choose file'), findsOneWidget);
  }

  Future<void> openLeaveForm(WidgetTester tester) async {
    await pumpActions(tester);
    await tapOn(tester, find.text('Leave').first);
    await tapOn(tester, find.text('Apply Leave').first);
    expect(find.text('Attachment (Optional)'.toUpperCase()), findsOneWidget);
  }

  Future<void> openReimbursementForm(WidgetTester tester) async {
    await pumpActions(tester);
    await tapOn(tester, find.text('Reimbursement').first);
    await tapOn(tester, find.text('Apply').first);
    expect(find.text('Upload receipt'), findsOneWidget);
  }

  group('leave attachment', () {
    testWidgets('offers the camera, the gallery and Files; a photo taken '
        'is attached as a JPEG', (tester) async {
      final asked = fakePhotos();
      await openLeaveForm(tester);

      await tapOn(
        tester,
        find.byKey(const ValueKey('leave-attachment-upload')),
      );
      expectSheet(withFiles: true);
      await tapOn(tester, find.text('Take a photo'));

      expect(asked, [ImageSource.camera]);
      // Named for when it was taken, never the phone's own file name.
      expect(
        find.textContaining(RegExp(r'^photo-\d{4}-\d\d-\d\d-\d{4}\.jpg$')),
        findsOneWidget,
      );
      expect(find.text('Upload document'), findsNothing);
    });

    testWidgets('a PDF from Files is attached as before', (tester) async {
      final files = _FakeFilePicker();
      final before = FilePickerPlatform.instance;
      FilePickerPlatform.instance = files;
      addTearDown(() => FilePickerPlatform.instance = before);
      await openLeaveForm(tester);

      await tapOn(
        tester,
        find.byKey(const ValueKey('leave-attachment-upload')),
      );
      await tapOn(tester, find.text('Choose file'));

      expect(files.askedFor, ['pdf', 'jpg', 'jpeg', 'png']);
      expect(find.text('note.pdf'), findsOneWidget);
    });

    testWidgets('a denied camera says so and attaches nothing', (tester) async {
      debugPickPhoto = (_) async =>
          throw PlatformException(code: 'camera_access_denied');
      await openLeaveForm(tester);

      await tapOn(
        tester,
        find.byKey(const ValueKey('leave-attachment-upload')),
      );
      await tapOn(tester, find.text('Take a photo'));

      expect(
        find.text('Sowaka needs permission for that. Turn it on in Settings.'),
        findsOneWidget,
      );
      expect(find.text('Upload document'), findsOneWidget);
    });
  });

  group('reimbursement receipt', () {
    testWidgets('offers the camera, the gallery and Files; a gallery photo '
        'is attached', (tester) async {
      final asked = fakePhotos();
      await openReimbursementForm(tester);

      await tapOn(
        tester,
        find.byKey(const ValueKey('reimbursement-receipt-upload')),
      );
      expectSheet(withFiles: true);
      await tapOn(tester, find.text('Choose from gallery'));

      expect(asked, [ImageSource.gallery]);
      expect(find.textContaining(RegExp(r'^photo-.*\.jpg$')), findsOneWidget);
      expect(find.text('Upload receipt'), findsNothing);
    });

    testWidgets('backing out of the sheet keeps the field empty', (
      tester,
    ) async {
      final asked = fakePhotos();
      await openReimbursementForm(tester);

      await tapOn(
        tester,
        find.byKey(const ValueKey('reimbursement-receipt-upload')),
      );
      await tester.tapAt(const Offset(20, 40));
      await settle(tester);

      expect(asked, isEmpty);
      expect(find.text('Upload receipt'), findsOneWidget);
    });
  });

  group('pickAttachment', () {
    Future<PickedAttachment?> Function() host(
      WidgetTester tester, {
      List<String> allowedExtensions = attachmentExtensions,
    }) {
      late BuildContext context;
      return () async {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: Builder(
                builder: (c) {
                  context = c;
                  return const SizedBox.expand();
                },
              ),
            ),
          ),
        );
        PickedAttachment? picked;
        var done = false;
        pickAttachment(context, allowedExtensions: allowedExtensions).then((
          value,
        ) {
          picked = value;
          done = true;
        });
        await settle(tester);
        if (find.text('Take a photo').evaluate().isNotEmpty) {
          await tapOn(tester, find.text('Take a photo'));
        }
        expect(done, isTrue);
        return picked;
      };
    }

    testWidgets('a photos-only surface leaves Files off the sheet', (
      tester,
    ) async {
      fakePhotos();
      late BuildContext context;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (c) {
                context = c;
                return const SizedBox.expand();
              },
            ),
          ),
        ),
      );
      pickAttachment(context, allowedExtensions: const ['jpg', 'png']);
      await settle(tester);
      expectSheet(withFiles: false);
    });

    testWidgets('on desktop Files opens straight away', (tester) async {
      debugHasNativeGallery = false;
      final files = _FakeFilePicker();
      final before = FilePickerPlatform.instance;
      FilePickerPlatform.instance = files;
      addTearDown(() => FilePickerPlatform.instance = before);

      final picked = await host(tester)();

      expect(find.text('Take a photo'), findsNothing);
      expect(picked?.name, 'note.pdf');
      expect(picked?.bytes.first, 0x25); // "%"
    });

    testWidgets('a camera photo comes back as its JPEG bytes', (tester) async {
      fakePhotos();
      final picked = await host(tester)();
      expect(picked?.bytes, _jpeg);
      expect(picked?.name, endsWith('.jpg'));
      expect(picked?.toPlatformFile().bytes, _jpeg);
    });
  });

  group('fitting a photo to the servers', () {
    test('JPEG and PNG are told by their bytes', () {
      expect(photoKind(_jpeg), 'jpg');
      final png = img.encodePng(img.Image(width: 2, height: 2));
      expect(photoKind(png), 'png');
      expect(photoKind(Uint8List.fromList(utf8.encode('%PDF-1.4'))), isNull);
    });

    test('a format the servers refuse is re-encoded as a JPEG', () {
      final bmp = img.encodeBmp(img.Image(width: 40, height: 30));
      expect(photoKind(bmp), isNull);
      final jpeg = fitPhotoAsJpeg(bmp, attachmentMaxBytes)!;
      expect(photoKind(jpeg), 'jpg');
      final back = img.decodeJpg(jpeg)!;
      expect((back.width, back.height), (40, 30));
    });

    test('a photo over the limit is shrunk until it fits', () {
      // Noise, which no encoder can make small: a stand-in for a detailed
      // full-size camera shot.
      final random = Random(7);
      final big = img.Image(width: 3000, height: 1500);
      for (final pixel in big) {
        pixel
          ..r = random.nextInt(256)
          ..g = random.nextInt(256)
          ..b = random.nextInt(256);
      }
      final png = img.encodePng(big);
      const limit = 1024 * 1024;
      expect(png.length, greaterThan(limit));
      final jpeg = fitPhotoAsJpeg(png, limit)!;
      expect(jpeg.length, lessThanOrEqualTo(limit));
      final back = img.decodeJpg(jpeg)!;
      expect(back.width, lessThanOrEqualTo(2048));
      expect(back.width / back.height, closeTo(2, 0.01));
    });

    test('bytes that are not a picture this can read give null', () {
      // The start of a HEIC: the camera and gallery convert those already.
      final heic = Uint8List.fromList([
        0,
        0,
        0,
        0x18,
        ...utf8.encode('ftypheic'),
        0,
        0,
        0,
        0,
      ]);
      expect(fitPhotoAsJpeg(heic, attachmentMaxBytes), isNull);
    });
  });
}
