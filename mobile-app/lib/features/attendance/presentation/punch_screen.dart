import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import 'slide_to_punch.dart';

import '../data/punch_location_service.dart';
import '../../manager/data/manager_api_service.dart';
import '../../manager/data/manager_models.dart';

/// What the punch screen is doing right now (nodes 2306:58967 onward).
enum _PunchStage { ready, checking, sending, done, outside, blocked, requested }

/// How a punch ended, for whoever opened the screen.
class PunchOutcome {
  const PunchOutcome({
    required this.punched,
    this.officeName,
    this.requested = false,
  });

  final bool punched;
  final String? officeName;

  /// A correction was raised instead of a punch. The host reloads on this too,
  /// so the day knows a request is with the manager the next time it is opened.
  final bool requested;
}

/// Punching in or out, with the location check in front of it.
///
/// A full screen rather than a sheet because it has something to say in every
/// outcome: where you were punched in, or why you could not be, and what to do
/// instead. A snackbar cannot carry that.
class PunchScreen extends StatefulWidget {
  const PunchScreen({
    super.key,
    required this.api,
    required this.type,
    this.onRequestWfh,
    this.onRecorded,
    this.alreadyRequestedToday = false,
    this.geofenced = true,
    this.startImmediately = false,
  });

  final ManagerApiService api;

  /// 'in' or 'out'.
  final String type;

  /// Hands the recorded punch back to whoever opened this screen.
  ///
  /// The punch is sent straight to the API rather than through the bloc,
  /// because this screen needs the refusal's own details to decide what to
  /// offer next. That left the dashboard unaware a punch had happened: the
  /// time never appeared on the home card and the slider invited another go,
  /// which the server then refused as already punched in.
  final void Function(AttendanceRecord record)? onRecorded;

  /// Opens the work-from-home request, for the case where someone is not
  /// coming in at all. Null where the host cannot navigate there.
  final VoidCallback? onRequestWfh;

  /// A correction for today is already with the manager. They may still come
  /// in and punch, but the screen stops offering a second request for a day
  /// that is already being decided.
  final bool alreadyRequestedToday;

  /// Whether this employee's punch is checked against an office.
  ///
  /// In-app punch-in is the same flow without the location question: no
  /// permission prompt, no location check, and no way to land outside an area
  /// nobody is being measured against.
  final bool geofenced;

  /// Opened by a slider that has already been dragged, so the punch is under
  /// way. Asking for the same gesture twice is the screen not believing what
  /// the person just did.
  final bool startImmediately;

  @override
  State<PunchScreen> createState() => _PunchScreenState();
}

class _PunchScreenState extends State<PunchScreen> {
  static const _location = PunchLocationService();

  _PunchStage _stage = _PunchStage.ready;
  String? _officeName;
  String? _officeLabel;
  int? _distanceMeters;
  String _problem = '';
  bool _canOpenSettings = false;
  DateTime _punchedAt = DateTime.now();

  /// Which request was sent, for the confirmation that follows it.
  String? _requestLabel;

  /// Whether this visit raised one, so the host can refresh on the way out.
  bool _raisedRequest = false;

  /// A punch is in flight. An in-app punch has no location step to show, so
  /// the screen stays put — but the slider must not be draggable again, or a
  /// slow network turns one punch into two.
  bool _busy = false;

  bool get _punchingIn => widget.type == 'in';

  @override
  void initState() {
    super.initState();
    if (widget.startImmediately) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _punch());
    }
  }

  /// Reads the device, sends it, and lets the server rule.
  ///
  /// [offsite] carries an office visit through: the same reading, recorded
  /// where the person actually is rather than refused.
  /// Asks the manager to vouch for a day worked away from the office.
  ///
  /// Nobody marks their own day present from outside the fence: working from
  /// home or at a client site is a claim about the day, and the day only
  /// becomes a worked one when the manager approves it.
  Future<void> _request(String label) async {
    // Its own state, not the location check: nothing is being located here, and
    // showing "Checking your location…" while a request is in flight describes
    // work the app is not doing.
    setState(() => _stage = _PunchStage.sending);
    try {
      await widget.api.submitAttendanceRegularization(
        workDate: DateTime.now(),
        // A day worked elsewhere is still a day worked, so it is asked for as
        // a full day. Where it was worked is the reason, which is what the
        // manager is actually being asked to vouch for.
        dayType: 'full_day',
        note: _officeLabel == null
            ? '$label — outside the approved attendance area'
            : '$label — ${_distanceMeters == null ? 'outside' : _formatDistance(_distanceMeters!)} '
                  'from $_officeLabel',
      );
      if (!mounted) return;
      setState(() {
        _stage = _PunchStage.requested;
        _requestLabel = label;
      });
      _raisedRequest = true;
    } on ManagerApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _stage = _PunchStage.blocked;
        _problem = error.message;
        _canOpenSettings = false;
      });
    }
  }

  Future<void> _punch() async {
    if (!widget.geofenced) {
      await _send(null);
      return;
    }
    // The system asks for the permission itself, with the app's own reason in
    // its prompt; a second dialog in front of it was one tap for nothing.
    if (!mounted) return;
    setState(() => _stage = _PunchStage.checking);
    PunchReading? reading;
    try {
      reading = await _location.read();
    } on PunchLocationException catch (error) {
      if (!mounted) return;
      setState(() {
        _stage = _PunchStage.blocked;
        _problem = error.message;
        _canOpenSettings = error.problem == PunchLocationProblem.deniedForever;
      });
      return;
    }

    await _send(reading);
  }

  /// Sends the punch and shows however it landed.
  Future<void> _send(PunchReading? reading) async {
    setState(() => _busy = true);
    try {
      final record = await widget.api.recordPunch(widget.type, reading: reading);
      widget.onRecorded?.call(record);
      if (!mounted) return;
      setState(() {
        _busy = false;
        _stage = _PunchStage.done;
        _officeName = record.officeName;
        _punchedAt =
            (_punchingIn ? record.punchIn : record.punchOut) ?? DateTime.now();
      });
    } on ManagerApiException catch (error) {
      if (!mounted) return;
      // 409 outside the fence is the one refusal with somewhere to go next:
      // the screen offers WFH or an office visit rather than a dead end.
      final office = error.details?['office'] as Map<String, dynamic>?;
      final location = error.details?['location'] as Map<String, dynamic>?;
      setState(() {
        _busy = false;
        _stage = office != null ? _PunchStage.outside : _PunchStage.blocked;
        _problem = error.message;
        _canOpenSettings = false;
        _officeLabel = office == null
            ? null
            : [
                office['name'] as String? ?? 'Office',
                if ((office['city'] as String? ?? '').isNotEmpty)
                  office['city'] as String,
              ].join(' · ');
        _distanceMeters = (location?['distanceMeters'] as num?)?.round();
      });
    }
  }

  void _close([PunchOutcome? outcome]) {
    Navigator.of(
      context,
    ).pop(outcome ?? PunchOutcome(punched: false, requested: _raisedRequest));
  }

  @override
  Widget build(BuildContext context) {
    // Node 2412:86633 — 16px gutter, 24px top and bottom, and the close sits
    // in the flow above the content rather than floating over it.
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 24, 16, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Align(
                alignment: Alignment.centerRight,
                child: _stage == _PunchStage.checking
                    // Nothing to close while the check runs: it finishes on its
                    // own, and the design leaves the corner empty.
                    ? const SizedBox(width: 24, height: 24)
                    : Semantics(
                        button: true,
                        label: 'Close',
                        child: InkWell(
                          borderRadius: BorderRadius.circular(20),
                          onTap: () => _close(),
                          child: SvgPicture.asset(
                            'assets/icons/punch/close.svg',
                            width: 24,
                            height: 24,
                          ),
                        ),
                      ),
              ),
              Expanded(
                child: SingleChildScrollView(
                  child: ConstrainedBox(
                    constraints: BoxConstraints(
                      minHeight: MediaQuery.sizeOf(context).height * 0.7,
                    ),
                    child: switch (_stage) {
                  _PunchStage.ready => _ready(),
                  _PunchStage.checking => _checking(),
                  _PunchStage.sending => _sending(),
                  _PunchStage.done => _done(),
                  _PunchStage.outside => _outside(),
                  _PunchStage.blocked => _blocked(),
                      _PunchStage.requested => _requested(),
                    },
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _ready() {
    final now = DateTime.now();
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        // 115px below the close row, then the target at 130px (2412:86638).
        const SizedBox(height: 91),
        Image.asset(
          'assets/icons/punch/target.png',
          width: 130,
          height: 130,
          fit: BoxFit.cover,
        ),
        const SizedBox(height: 12),
        Text(
          _punchingIn ? 'Ready to start your day?' : 'Ready to wrap up?',
          textAlign: TextAlign.center,
          style: _sora(26, FontWeight.w700, _ink, height: 34 / 26),
        ),
        const SizedBox(height: 24),
        // Current time and date, 40px apart with a 32px hairline between.
        IntrinsicHeight(
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              _ReadyFact(label: 'CURRENT TIME', value: _clockLabel(now)),
              Container(
                width: 1,
                height: 32,
                margin: const EdgeInsets.symmetric(horizontal: 20),
                color: const Color(0xFFDDDDDD),
              ),
              _ReadyFact(label: 'DATE', value: _dayAndMonth(now)),
            ],
          ),
        ),
        const SizedBox(height: 100),
        SlideToPunch(
          label: _busy
              ? (_punchingIn ? 'Punching you in…' : 'Punching you out…')
              : (_punchingIn ? 'Slide to Punch In' : 'Slide to Punch Out'),
          enabled: !_busy,
          onComplete: _punch,
        ),
        const SizedBox(height: 28),
        _QuietButton(
          label: 'Apply for a leave',
          onTap: () {
            _close();
            widget.onRequestWfh?.call();
          },
        ),
        const SizedBox(height: 12),
      ],
    );
  }

  /// "17 Sep" — the day this punch will be recorded against.
  static String _dayAndMonth(DateTime value) {
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${value.day} ${months[value.month - 1]}';
  }

  /// "09:42 AM", as the design writes it.
  static String _clockLabel(DateTime value) {
    final hour = value.hour % 12 == 0 ? 12 : value.hour % 12;
    return '${hour.toString().padLeft(2, '0')}:'
        '${value.minute.toString().padLeft(2, '0')} '
        '${value.hour >= 12 ? 'PM' : 'AM'}';
  }

  Widget _checking() {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        const SizedBox(height: 24),
        Image.asset(
          'assets/icons/punch/locating.png',
          width: 282,
          height: 212,
          fit: BoxFit.cover,
        ),
        Text(
          'Checking your location…',
          textAlign: TextAlign.center,
          style: _sora(20, FontWeight.w700, _ink, height: 30 / 20),
        ),
        const SizedBox(height: 12),
        Text(
          'Please wait while we verify that you are within the approved '
          'attendance area.',
          textAlign: TextAlign.center,
          style: _sora(14, FontWeight.w400, const Color(0xFF484848), height: 22 / 14),
        ),
      ],
    );
  }

  Widget _done() {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Container(
          width: 56,
          height: 56,
          alignment: Alignment.center,
          decoration: const BoxDecoration(
            color: Color(0xFFE6F4EA),
            shape: BoxShape.circle,
          ),
          child: const Icon(Icons.check, color: Color(0xFF15803D), size: 28),
        ),
        const SizedBox(height: 18),
        Text(
          _punchingIn ? "You're punched in!" : "You're punched out!",
          style: const TextStyle(
            fontSize: 21,
            fontWeight: FontWeight.w700,
            color: _ink,
          ),
        ),
        const SizedBox(height: 6),
        const Text(
          'Your attendance has been recorded.',
          style: TextStyle(fontSize: 13, color: _inkTertiary),
        ),
        const SizedBox(height: 22),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: _border),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _punchingIn ? 'Punched in at' : 'Punched out at',
                      style: const TextStyle(fontSize: 11, color: _inkTertiary),
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        const Icon(
                          Icons.place,
                          size: 14,
                          color: Color(0xFF15803D),
                        ),
                        const SizedBox(width: 4),
                        Text(
                          _officeName ?? 'Recorded',
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: _ink,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              Text(
                TimeOfDay.fromDateTime(_punchedAt).format(context),
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: _ink,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 18),
        _PunchPrimaryAction(
          label: 'Continue to Connect',
          onTap: () =>
              _close(PunchOutcome(punched: true, officeName: _officeName)),
        ),
      ],
    );
  }

  Widget _outside() {
    final alreadyIn = widget.alreadyRequestedToday || _raisedRequest;
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        const SizedBox(height: 62),
        // A 37px no-entry mark on a 9% red wash (2433:87809).
        Container(
          padding: const EdgeInsets.all(18),
          decoration: const BoxDecoration(
            color: Color(0x17A31616),
            shape: BoxShape.circle,
          ),
          child: SvgPicture.asset(
            'assets/icons/punch/no_entry.svg',
            width: 37,
            height: 37,
          ),
        ),
        const SizedBox(height: 24),
        Text(
          'You are outside the approved attendance area.',
          textAlign: TextAlign.center,
          style: _sora(22, FontWeight.w700, _ink, height: 30 / 22),
        ),
        const SizedBox(height: 20),
        // Where the office is and when this was tried (2313:59170).
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: const Color(0x0AA31616),
            border: Border.all(color: const Color(0x21A31616), width: 1.129),
            borderRadius: BorderRadius.circular(14),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  SvgPicture.asset('assets/icons/punch/pin.svg', width: 16, height: 16),
                  const SizedBox(width: 8),
                  Flexible(
                    child: Text(
                      _officeLabel ?? 'Your office',
                      style: _sora(13, FontWeight.w600, _ink, height: 19.5 / 13),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  SvgPicture.asset('assets/icons/punch/clock.svg', width: 16, height: 16),
                  const SizedBox(width: 8),
                  Text(
                    _distanceMeters == null
                        ? TimeOfDay.now().format(context)
                        : '${_formatDistance(_distanceMeters!)} away',
                    style: _sora(13, FontWeight.w400, const Color(0xFF484848), height: 19.5 / 13),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 24),
        if (alreadyIn)
          // One day, one request: what is already with the manager is said
          // plainly instead of offering a duplicate.
          Text(
            'Regularisation has been sent to your manager.',
            textAlign: TextAlign.center,
            style: _sora(14, FontWeight.w600, const Color(0xFF9197A2), height: 21 / 14),
          )
        else ...[
          Text(
            'You will be marked absent until you choose an option below.',
            textAlign: TextAlign.center,
            style: _sora(14, FontWeight.w600, const Color(0xFF9197A2), height: 21 / 14),
          ),
          const SizedBox(height: 12),
          _OutlineAction(label: 'Request WFH', onTap: () => _request('Work from home')),
          const SizedBox(height: 8),
          _OutlineAction(label: 'Client visit', onTap: () => _request('Client visit')),
          const SizedBox(height: 28),
          _QuietButton(
            label: 'Apply for a leave',
            onTap: () {
              _close();
              widget.onRequestWfh?.call();
            },
          ),
        ],
      ],
    );
  }

  Widget _sending() {
    return const Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        SizedBox(
          width: 30,
          height: 30,
          child: CircularProgressIndicator(strokeWidth: 2.5, color: _brand),
        ),
        SizedBox(height: 20),
        Text(
          'Sending your request...',
          style: TextStyle(
            fontSize: 21,
            fontWeight: FontWeight.w700,
            color: _ink,
          ),
        ),
      ],
    );
  }

  /// The request is with the manager. Says plainly that the day is not
  /// present yet, so nobody leaves thinking their attendance is settled.
  Widget _requested() {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Container(
          width: 74,
          height: 74,
          decoration: const BoxDecoration(
            color: Color(0xFFEAF4FB),
            shape: BoxShape.circle,
          ),
          child: const Icon(Icons.send_rounded, size: 32, color: _brand),
        ),
        const SizedBox(height: 20),
        Text(
          '${_requestLabel ?? 'Request'} sent',
          textAlign: TextAlign.center,
          style: const TextStyle(
            fontSize: 21,
            fontWeight: FontWeight.w700,
            color: _ink,
          ),
        ),
        const SizedBox(height: 10),
        const Text(
          'Your manager has it now. The day is marked present once they '
          'approve it, and you can follow it under your requests.',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 14, height: 1.45, color: _inkTertiary),
        ),
        const SizedBox(height: 26),
        _PunchPrimaryAction(label: 'Done', onTap: () => _close()),
      ],
    );
  }

  Widget _blocked() {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        const Icon(Icons.location_off, size: 44, color: _inkTertiary),
        const SizedBox(height: 16),
        Text(
          _problem,
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 14, height: 1.45, color: _inkTertiary),
        ),
        const SizedBox(height: 20),
        if (_canOpenSettings)
          _OutlineAction(
            label: 'Open Settings',
            onTap: () => _location.openSettings(),
          )
        else
          _OutlineAction(
            label: 'Try again',
            onTap: () => setState(() => _stage = _PunchStage.ready),
          ),
      ],
    );
  }
}

String _formatDistance(int metres) =>
    metres >= 1000 ? '${(metres / 1000).toStringAsFixed(1)} km' : '$metres m';

/// The filled call to action, matching the app's own: a 58-high button with a
/// 17 radius and a 15/w800 label, the same as the ones on the attendance and
/// request flows. Defined once here so the four screens cannot drift.
class _PunchPrimaryAction extends StatelessWidget {
  const _PunchPrimaryAction({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: double.infinity,
    height: 58,
    child: FilledButton(
      style: FilledButton.styleFrom(
        backgroundColor: _brand,
        foregroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(17)),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
      ),
      onPressed: onTap,
      child: Text(label),
    ),
  );
}

class _OutlineAction extends StatelessWidget {
  const _OutlineAction({required this.label, required this.onTap});
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: 48,
      child: OutlinedButton(
        style: OutlinedButton.styleFrom(
          backgroundColor: Colors.white,
          foregroundColor: _ink,
          side: const BorderSide(color: _border, width: 1.4),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          textStyle: const TextStyle(
            fontSize: 14,
            height: 20 / 14,
            fontWeight: FontWeight.w600,
          ),
        ),
        onPressed: onTap,
        child: Text(label),
      ),
    );
  }
}

/// "Not now" — 14/w600 in #9197A2, no border, no fill.
class _QuietButton extends StatelessWidget {
  const _QuietButton({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    child: Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Text(
        label,
        textAlign: TextAlign.center,
        style: _sora(14, FontWeight.w600, const Color(0xFF9197A2), height: 21 / 14),
      ),
    ),
  );
}

/// Every line on these screens is set in Sora, as the design has it.
TextStyle _sora(double size, FontWeight weight, Color color, {double? height}) =>
    TextStyle(
      fontFamily: 'Sora',
      fontSize: size,
      fontWeight: weight,
      color: color,
      height: height,
    );

const _ink = Color(0xFF222222);
const _inkTertiary = Color(0xFF717171);
const _border = Color(0xFFEBEBEB);
const _brand = Color(0xFF0571A6);

/// One of the two facts above the slider: a quiet label over a bold value.
class _ReadyFact extends StatelessWidget {
  const _ReadyFact({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // 10/w500 uppercase with 0.25 tracking over 24/w600 (2412:86645).
        Text(
          label,
          style: _sora(10, FontWeight.w500, _inkTertiary, height: 15 / 10)
              .copyWith(letterSpacing: 0.25),
        ),
        const SizedBox(height: 12),
        Text(
          value,
          style: _sora(24, FontWeight.w600, _ink).copyWith(letterSpacing: -0.16),
        ),
      ],
    );
  }
}
