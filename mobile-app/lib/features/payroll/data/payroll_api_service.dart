import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import '../../../services/api_client.dart';
import '../../../services/api_config.dart';
import '../../auth/data/auth_models.dart';
import '../../manager/data/manager_models.dart';
import '../../shared/network_status.dart';
import 'payroll_models.dart';

/// A Payroll call that did not work. [message] is always fit to show: the
/// server writes its messages for the person, and anything else becomes a
/// plain line here.
class PayrollApiException implements Exception {
  const PayrollApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  static const failed = 'Something went wrong. Try again.';
  static const offline = 'No internet connection';
  static const tooSlow = 'Payroll is taking too long. Try again.';

  /// The split's change window moved between Review and Submit.
  static const windowMoved = 'The window has moved, review again';

  /// Whether this is the save refused because the window moved.
  bool get isConflict => statusCode == 409;

  /// A server without the Payroll routes yet.
  static const unavailable = 'Payroll isn\'t available yet. Try again later.';

  /// A 409 the server sent no words for: something is closed or locked that
  /// the person can't change themselves. The server's own message (which
  /// says what to do) is shown whenever there is one.
  static const conflict = 'This can\'t be changed right now. Ask HR.';

  @override
  String toString() => message;
}

/// What a Payroll screen says when a call fails.
String payrollErrorText(Object error) =>
    error is PayrollApiException ? error.message : PayrollApiException.failed;

/// A proof file chosen on the phone, as bytes.
class PayrollUpload {
  const PayrollUpload({required this.name, required this.bytes});

  final String name;
  final Uint8List bytes;

  int get size => bytes.length;

  /// The server takes PDF, JPEG and PNG.
  MediaType get mediaType {
    final extension = name.contains('.')
        ? name.split('.').last.toLowerCase()
        : '';
    return switch (extension) {
      'pdf' => MediaType('application', 'pdf'),
      'png' => MediaType('image', 'png'),
      _ => MediaType('image', 'jpeg'),
    };
  }
}

/// The employee's own payroll: the month's salary, the flexible split, the
/// tax declaration and its proofs, and the released payslips
/// (docs/payroll-employee-api.md). Every route reads the signed-in person's
/// own data; nothing here takes a user id.
class PayrollApiService {
  PayrollApiService({
    required this.session,
    String? baseUrl,
    http.Client? client,
  }) : _baseUrl = baseUrl ?? ApiConfig.baseUrl,
       _client = client ?? ApiClient.shared;

  static const requestTimeout = Duration(seconds: 30);
  static const uploadTimeout = Duration(minutes: 2);

  /// The largest proof the server accepts.
  static const maxProofBytes = 5 * 1024 * 1024;

  final AuthSession session;
  final String _baseUrl;
  final http.Client _client;

  // ---------------------------------------------------------------- home

  Future<PayrollHome> fetchHome({String? period}) async => PayrollHome.fromJson(
    await _json('GET', _path('/payroll/home', {'period': period})),
  );

  Future<MissingPunches> fetchMissingPunches({String? period}) async =>
      MissingPunches.fromJson(
        await _json(
          'GET',
          _path('/payroll/missing-punches', {'period': period}),
        ),
      );

  // ---------------------------------------------------------------- EPF

  /// What Sowaka knows about the person's PF, with their own UAN.
  Future<EpfSummary> fetchEpf() async {
    final json = await _json('GET', '/payroll/me/epf');
    return EpfSummary.fromJson(_object(json['epf']));
  }

  /// Sets the PF balance read off the EPFO passbook ([balancePaise], whole
  /// rupees, as on [asOn]) and returns the page as it now reads.
  Future<EpfSummary> saveEpfBalance({
    required int balancePaise,
    required DateTime asOn,
  }) async {
    final day = asOn.day.toString().padLeft(2, '0');
    final json = await _json(
      'PUT',
      '/payroll/me/epf/balance',
      body: {
        'balancePaise': balancePaise,
        'asOn': '${payrollPeriod(asOn)}-$day',
      },
    );
    return EpfSummary.fromJson(_object(json['epf']));
  }

  // ---------------------------------------------------------------- split

  Future<FbpSplit> fetchSplit() async {
    final json = await _json('GET', '/payroll/split');
    return FbpSplit.fromJson(_object(json['split']));
  }

  /// Checks [amounts] (code → paise) and says what the split will be,
  /// without saving it.
  Future<FbpReview> reviewSplit(Map<String, int> amounts) async {
    final json = await _json(
      'POST',
      '/payroll/split/review',
      body: {'amounts': amounts},
    );
    return FbpReview.fromJson(_object(json['review']));
  }

  /// Saves the split. [amounts] as for [reviewSplit]; the person has ticked
  /// that they will keep and upload the bills.
  ///
  /// [effectiveFrom] is the month the review showed: when the window has
  /// moved since (the cutoff passed, or a run locked that month) the server
  /// refuses with 409 ([PayrollApiException.windowMoved]) and the split has
  /// to be reviewed again.
  Future<FbpSplit> saveSplit(
    Map<String, int> amounts, {
    DateTime? effectiveFrom,
  }) async {
    final json = await _json(
      'PUT',
      '/payroll/split',
      body: {
        'amounts': amounts,
        'acknowledged': true,
        if (effectiveFrom != null)
          'effectiveFrom': payrollPeriod(effectiveFrom),
      },
    );
    return FbpSplit.fromJson(_object(json['split']));
  }

  // ---------------------------------------------------------------- payslips

  /// Released payslips, newest first, with the company they are printed
  /// under. The Payslips screen asks for a year's worth.
  Future<(PayslipCompany, List<Payslip>)> fetchPayslips({
    int limit = 12,
  }) async {
    final json = await _json(
      'GET',
      _path('/payslips/mine', {'limit': '$limit'}),
    );
    return (
      PayslipCompany.fromJson(_object(json['company'])),
      [
        for (final row in json['payslips'] as List<dynamic>? ?? const [])
          if (row is Map<String, dynamic>)
            Payslip.fromJson(_object(row['run']), _object(row['payslip'])),
      ],
    );
  }

  Future<(PayslipCompany, Payslip)> fetchPayslip(String payslipId) async {
    final json = await _json(
      'GET',
      '/payslips/${Uri.encodeComponent(payslipId)}',
    );
    return (
      PayslipCompany.fromJson(_object(json['company'])),
      Payslip.fromJson(_object(json['run']), _object(json['payslip'])),
    );
  }

  // ---------------------------------------------------------------- earnings

  /// A financial year's earnings ("2026-27"); without [fy], the latest year
  /// with pay.
  Future<PayrollEarnings> fetchEarnings({String? fy}) async {
    final json = await _json('GET', _path('/payroll/me/earnings', {'fy': fy}));
    return PayrollEarnings.fromJson(_object(json['earnings']));
  }

  // ---------------------------------------------------------------- Form 16

  /// Downloads › Form 16: the signed-in person's years and their files.
  Future<Form16Overview> fetchForm16() async => Form16Overview.fromJson(
    _object((await _json('GET', '/payroll/form16'))['form16']),
  );

  /// One of their Form 16 files as PDF bytes, under its own name: a
  /// short-lived link from the server, then the file from storage.
  Future<(Uint8List, String)> downloadForm16(Form16Document document) async {
    final json = await _json(
      'GET',
      '/payroll/form16/${Uri.encodeComponent(document.id)}/file',
    );
    final url = Uri.tryParse(json['url'] as String? ?? '');
    final name = json['fileName'] as String? ?? document.fileName;
    if (url == null || !url.hasScheme) {
      throw const PayrollApiException(PayrollApiException.failed);
    }
    final http.Response response;
    try {
      // The link is signed itself: no Authorization header goes to storage.
      response = await _client
          .send(http.Request('GET', url))
          .then(http.Response.fromStream)
          .timeout(uploadTimeout);
    } catch (error) {
      throw PayrollApiException(switch (error) {
        TimeoutException() => PayrollApiException.tooSlow,
        _ when NetworkStatus.isNetworkError(error) =>
          PayrollApiException.offline,
        _ => PayrollApiException.failed,
      });
    }
    if (response.statusCode != 200 || response.bodyBytes.isEmpty) {
      throw PayrollApiException(
        PayrollApiException.failed,
        statusCode: response.statusCode,
      );
    }
    return (
      response.bodyBytes,
      name.isEmpty ? 'Form16-${document.fy}.pdf' : name,
    );
  }

  // ---------------------------------------------------------------- salary summary

  /// One pay period's salary as a receipt, each line explained: the
  /// previous pay period unless [period] ("2026-10") is given.
  Future<PayrollSalarySummary> fetchSalarySummary({String? period}) async {
    final json = await _json(
      'GET',
      _path('/payroll/me/salary', {'period': period}),
    );
    return PayrollSalarySummary.fromJson(_object(json['salary']));
  }

  // ---------------------------------------------------------------- declaration

  Future<TaxDeclaration> fetchDeclaration({String? fy}) async {
    final json = await _json(
      'GET',
      _path('/payroll/tax-declaration', {'fy': fy}),
    );
    return TaxDeclaration.fromJson(_object(json['declaration']));
  }

  /// Saves the regime and the declared amounts (item key → paise; the
  /// read-only `epf` is never sent). [submit] says "Declaration submitted"
  /// rather than "saved".
  Future<TaxDeclaration> saveDeclaration({
    required String regime,
    Map<String, int> items = const {},
    bool submit = true,
    String? fy,
  }) async {
    final json = await _json(
      'PUT',
      _path('/payroll/tax-declaration', {'fy': fy}),
      body: {
        'regime': regime,
        'items': {
          for (final entry in items.entries)
            if (entry.key != 'epf') entry.key: entry.value,
        },
        'submit': submit,
      },
    );
    return TaxDeclaration.fromJson(_object(json['declaration']));
  }

  /// The year's income tax: paid months from released payslips, the rest
  /// as the TDS engine projects them now. The regime is changed through
  /// [saveDeclaration].
  Future<TaxSummary> fetchTaxSummary({String? fy}) async {
    final json = await _json('GET', _path('/payroll/me/tax', {'fy': fy}));
    return TaxSummary.fromJson(_object(json['tax']));
  }

  // ---------------------------------------------------------------- proofs

  Future<InvestmentProofs> fetchProofs({String? fy}) async {
    final json = await _json(
      'GET',
      _path('/payroll/investment-proofs', {'fy': fy}),
    );
    return InvestmentProofs.fromJson(_object(json['proofs']));
  }

  /// Uploads (or replaces) the proof for one declared [item], with the
  /// amount on it and, for rent, the landlord's PAN.
  Future<InvestmentProofItem> uploadProof({
    required String item,
    required PayrollUpload file,
    required int amountPaise,
    String? fy,
    String? landlordPan,
  }) async {
    final request =
        http.MultipartRequest(
            'POST',
            Uri.parse(
              '$_baseUrl${_path('/payroll/investment-proofs/${Uri.encodeComponent(item)}', {'fy': fy})}',
            ),
          )
          ..headers['Authorization'] = 'Bearer ${session.token}'
          ..fields['amountPaise'] = '$amountPaise'
          ..fields.addAll({
            if (landlordPan != null && landlordPan.isNotEmpty)
              'landlordPan': landlordPan,
          })
          ..files.add(
            http.MultipartFile.fromBytes(
              'proof',
              file.bytes,
              filename: file.name,
              contentType: file.mediaType,
            ),
          );
    final json = await _send(request, limit: uploadTimeout);
    return InvestmentProofItem.fromJson(_object(json['item']));
  }

  /// A short-lived link to look at the file sent for [item].
  Future<String> proofFileUrl(String item) async {
    final json = await _json(
      'GET',
      '/payroll/investment-proofs/${Uri.encodeComponent(item)}/file',
    );
    return json['url'] as String? ?? '';
  }

  // ---------------------------------------------------------------- plumbing

  static Map<String, dynamic> _object(Object? value) =>
      value is Map<String, dynamic> ? value : const {};

  static String _path(String path, Map<String, String?> query) {
    final present = {
      for (final entry in query.entries)
        if (entry.value != null && entry.value!.isNotEmpty)
          entry.key: entry.value!,
    };
    return present.isEmpty
        ? path
        : '$path?${Uri(queryParameters: present).query}';
  }

  Future<Map<String, dynamic>> _json(
    String method,
    String path, {
    Map<String, dynamic>? body,
  }) {
    final request = http.Request(method, Uri.parse('$_baseUrl$path'))
      ..headers.addAll({
        'Authorization': 'Bearer ${session.token}',
        'Content-Type': 'application/json',
      });
    if (body != null) request.body = jsonEncode(body);
    return _send(request);
  }

  Future<Map<String, dynamic>> _send(
    http.BaseRequest request, {
    Duration limit = requestTimeout,
  }) async {
    final http.Response response;
    try {
      response = await _client
          .send(request)
          .then(http.Response.fromStream)
          .timeout(limit);
    } catch (error) {
      NetworkStatus.reportFailure(error, probe: Uri.parse('$_baseUrl/health'));
      throw PayrollApiException(switch (error) {
        TimeoutException() => PayrollApiException.tooSlow,
        _ when NetworkStatus.isNetworkError(error) =>
          PayrollApiException.offline,
        _ => PayrollApiException.failed,
      });
    }
    NetworkStatus.reportSuccess();
    Map<String, dynamic> json;
    try {
      final body = response.body.isEmpty
          ? null
          : jsonDecode(utf8.decode(response.bodyBytes));
      json = body is Map<String, dynamic> ? body : <String, dynamic>{};
    } on FormatException {
      json = <String, dynamic>{};
    }
    final status = response.statusCode;
    if (status < 200 || status >= 300) {
      final said = json['message'] is String
          ? (json['message'] as String).trim()
          : '';
      throw PayrollApiException(switch (status) {
        404 when said.isEmpty || said.startsWith('Route not found') =>
          PayrollApiException.unavailable,
        413 => 'Choose a file smaller than 5 MB.',
        409 when said.isEmpty => PayrollApiException.conflict,
        >= 500 when said.isEmpty => PayrollApiException.failed,
        _ when said.isEmpty => PayrollApiException.failed,
        _ => said,
      }, statusCode: status);
    }
    return json;
  }
}

// ---------------------------------------------------------------- FBP

/// The FBP page and its bills (GET /payroll/me/fbp …).
extension PayrollFbpApi on PayrollApiService {
  Future<FbpPlan> fetchFbp() async {
    final json = await _json('GET', '/payroll/me/fbp');
    return FbpPlan.fromJson(PayrollApiService._object(json['fbp']));
  }

  Future<FbpHead> fetchFbpHead(String code) async {
    final json = await _json(
      'GET',
      '/payroll/me/fbp/${Uri.encodeComponent(code)}',
    );
    return FbpHead.fromJson(PayrollApiService._object(json['head']));
  }

  /// Sends (or, after a rejection, sends again) the bill for [period]
  /// ("2026-08") of head [code]. The head comes back as it now stands.
  Future<FbpHead> uploadFbpBill({
    required String code,
    required String period,
    required PayrollUpload file,
    required int amountPaise,
  }) async {
    final request =
        http.MultipartRequest(
            'POST',
            Uri.parse(
              '$_baseUrl/payroll/me/fbp/${Uri.encodeComponent(code)}/bills',
            ),
          )
          ..headers['Authorization'] = 'Bearer ${session.token}'
          ..fields['period'] = period
          ..fields['amountPaise'] = '$amountPaise'
          ..files.add(
            http.MultipartFile.fromBytes(
              'proof',
              file.bytes,
              filename: file.name,
              contentType: file.mediaType,
            ),
          );
    final json = await _send(request, limit: PayrollApiService.uploadTimeout);
    return FbpHead.fromJson(PayrollApiService._object(json['head']));
  }
}
