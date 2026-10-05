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
    this.onViewAttendance,
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

  /// Opens the attendance calendar from the confirmation. Null where the host
  /// is the calendar already, and the link is not shown.
  final VoidCallback? onViewAttendance;

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

  DateTime _requestedAt = DateTime.now();

  /// The reason picked on the outside screen, sent with the punch.
  String? _selectedReason;

  /// What the server said when the punch landed outside every office: the
  /// reasons HR lets this employee choose, and whether choosing one marks the
  /// day present or sends it to the manager. Empty from an older server, which
  /// still wants the WFH / client-visit request instead.
  List<String> _reasons = const [];
  bool _marksPresent = false;

  /// The reason may be left out: the day is marked present either way, so
  /// closing this screen punches without one.
  bool _reasonOptional = false;

  /// The reading the refusal was about, sent again with the reason.
  PunchReading? _reading;

  /// The remark a punch from outside was recorded with, for the confirmation.
  OutsideLocationNote? _outsideNote;

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
    _reading = reading;
    setState(() => _busy = true);
    try {
      final record = await widget.api.recordPunch(widget.type, reading: reading);
      _recorded(record);
    } on ManagerApiException catch (error) {
      if (!mounted) return;
      // 409 outside the fence is the one refusal with somewhere to go next:
      // the employee says why, and HR's policy decides what that leads to.
      final office = error.details?['office'] as Map<String, dynamic>?;
      final location = error.details?['location'] as Map<String, dynamic>?;
      final outside = error.details?['outsideLocation'] as Map<String, dynamic>?;
      setState(() {
        _busy = false;
        // Only a refusal that carries HR's outcome has somewhere to go; an
        // imprecise reading also names the nearest office, but is a retry.
        _stage = outside != null ? _PunchStage.outside : _PunchStage.blocked;
        _problem = error.message;
        _canOpenSettings = false;
        _reasons = (outside?['reasons'] as List<dynamic>? ?? const [])
            .map((value) => value.toString())
            .where((value) => value.isNotEmpty)
            .toList();
        _marksPresent = outside?['outcome'] == 'present';
        _reasonOptional = outside?['reasonOptional'] == true;
        // A choice from an earlier list is only kept if it is still offered.
        if (!_reasons.contains(_selectedReason)) _selectedReason = null;
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

  /// The punch went through — as a recorded punch, or as an out of location
  /// request the manager now holds.
  void _recorded(AttendanceRecord record) {
    final request = record.request;
    if (request != null) {
      _raisedRequest = true;
      if (!mounted) return;
      setState(() {
        _busy = false;
        _stage = _PunchStage.requested;
        _requestedAt = DateTime.now();
      });
      return;
    }
    widget.onRecorded?.call(record);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _stage = _PunchStage.done;
      _officeName = record.officeName;
      // The day's note belongs to the punch that wrote it. A punch-out
      // after an outside punch-in carries the morning's note on the record,
      // and must not describe this punch as taken from there.
      final note = record.outsideLocation;
      _outsideNote = note != null && note.punchType == widget.type ? note : null;
      _punchedAt =
          (_punchingIn ? record.punchIn : record.punchOut) ?? DateTime.now();
    });
  }

  /// The same punch again, with the reason the employee chose for being away
  /// — or, where none is needed, without one.
  Future<void> _sendWithReason(String? reason) async {
    setState(() {
      _busy = true;
      _stage = _PunchStage.sending;
    });
    try {
      final record = await widget.api.recordPunch(
        widget.type,
        reading: _reading,
        reason: reason,
        skipReason: reason == null,
      );
      _recorded(record);
    } on ManagerApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _stage = _PunchStage.blocked;
        _problem = error.message;
        _canOpenSettings = false;
      });
    }
  }

  void _close([PunchOutcome? outcome]) {
    Navigator.of(
      context,
    ).pop(outcome ?? PunchOutcome(punched: false, requested: _raisedRequest));
  }

  /// Whether this punch is the manager's to decide: a punch-in under the
  /// request outcome. A punch-out is recorded whatever the outcome, so the
  /// approval copy never belongs on it.
  bool get _needsApproval => _punchingIn && !_marksPresent;

  /// The close control. On the outside screen of someone whose day is marked
  /// present regardless, leaving is the punch: it goes through with the
  /// reason chosen, or none, and the screen closes on it. Never when today's
  /// request is already with the manager — then it only closes.
  /// Today's request already stands between this punch and the manager.
  /// Only a punch-in that would become a request is held back by it: a
  /// present-outcome punch needs nobody's decision, and a punch-out rides
  /// on a pending request rather than raising another.
  bool get _alreadyIn => _needsApproval && (widget.alreadyRequestedToday || _raisedRequest);

  Future<void> _dismiss() async {
    final alreadyIn = _alreadyIn;
    if (_stage == _PunchStage.outside && _reasonOptional && !alreadyIn && !_busy) {
      await _sendWithReason(_selectedReason);
      if (!mounted || _stage != _PunchStage.done) return;
      _close(PunchOutcome(punched: true, officeName: _officeName));
      return;
    }
    _close();
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
                          onTap: _dismiss,
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
              if (_stage == _PunchStage.ready)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    'When you punch-in, we check if your device location '
                    'matches the office address',
                    textAlign: TextAlign.center,
                    style: _sora(11, FontWeight.w400, const Color(0xFF9E9E9E), height: 16 / 11),
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

  /// Punched (node 3345:29117): the time, the day, and — from outside — the
  /// reason and where from, in one card.
  Widget _done() {
    final note = _outsideNote;
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        const SizedBox(height: 40),
        Image.asset('assets/icons/punch/punched_in.png', width: 80, height: 80),
        const SizedBox(height: 24),
        Text(
          _punchingIn ? "You're punched in!" : "You're punched out!",
          textAlign: TextAlign.center,
          style: _sora(24, FontWeight.w700, _ink, height: 32 / 24),
        ),
        const SizedBox(height: 8),
        Text(
          'Your attendance has been recorded.',
          textAlign: TextAlign.center,
          style: _sora(14, FontWeight.w400, const Color(0xFF484848), height: 21 / 14),
        ),
        const SizedBox(height: 28),
        _PunchSummaryCard(
          heading: _punchingIn ? 'Punched in' : 'Punched out',
          at: _punchedAt,
          reason: note?.reason,
          place: note?.place ?? _officeName,
          placeCaption: note == null ? 'Location at punch' : 'Location at request',
        ),
        const SizedBox(height: 40),
        _PunchPrimaryAction(
          label: 'Continue to Connect',
          onTap: () =>
              _close(PunchOutcome(punched: true, officeName: _officeName)),
        ),
        if (widget.onViewAttendance case final open?) ...[
          const SizedBox(height: 16),
          _LinkText(
            label: 'View attendance',
            underline: true,
            onTap: () {
              _close(PunchOutcome(punched: true, officeName: _officeName));
              open();
            },
          ),
        ],
      ],
    );
  }

  /// Outside every office (nodes 3345:28301 and 3345:28881). The reasons are
  /// HR's own list from the template; which of the two screens this is comes
  /// from the template too: a manager's decision, or marked present outright,
  /// in which case no reason is needed and the button is live from the start.
  Widget _outside() {
    final alreadyIn = _alreadyIn;
    final canSend = !alreadyIn && !_busy && (_selectedReason != null || _reasonOptional);
    final sendLabel = _needsApproval ? 'Send punch-in request' : (_punchingIn ? 'Punch in' : 'Punch out');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 44),
        if (_needsApproval) ...[
          const Align(
            alignment: Alignment.centerLeft,
            child: _AmberPill(icon: Icons.hourglass_top_rounded, label: 'Manager approval required'),
          ),
          const SizedBox(height: 20),
        ],
        Text(
          'You\u2019re outside the office area',
          style: _sora(27, FontWeight.w700, _navy, height: 32.5 / 27),
        ),
        const SizedBox(height: 24),
        _OfficeCard(
          name: _officeLabel?.split(' · ').first ?? 'Office',
          distance: _distanceMeters == null
              ? 'Outside the approved area'
              : '${_formatDistance(_distanceMeters!)} from the office',
        ),
        const SizedBox(height: 24),
        if (alreadyIn)
          Text(
            'Your request for today is already with your manager.',
            style: _sora(13.5, FontWeight.w600, _navy, height: 21 / 13.5),
          )
        else ...[
          Text(
            'Where are you working from today?',
            style: _sora(13.5, FontWeight.w600, _navy, height: 21 / 13.5),
          ),
          const SizedBox(height: 12),
          // Three tiles to a row (node 3357:29529), HR's reasons in HR's
          // order, each wearing one of the three illustrations in turn.
          LayoutBuilder(
            builder: (context, constraints) {
              final width = (constraints.maxWidth - 24) / 3;
              return Wrap(
                spacing: 12,
                runSpacing: 12,
                children: [
                  for (final (index, reason) in _reasons.indexed)
                    SizedBox(
                      width: width,
                      child: _ReasonTile(
                        label: reason,
                        image: 'assets/icons/punch/reason_${index % 3 + 1}.png',
                        selected: _selectedReason == reason,
                        onTap: () => setState(
                          () => _selectedReason = _selectedReason == reason ? null : reason,
                        ),
                      ),
                    ),
                ],
              );
            },
          ),
        ],
        const SizedBox(height: 24),
        _ArrowButton(
          label: sendLabel,
          enabled: canSend,
          onTap: () => _sendWithReason(_selectedReason),
        ),
        const SizedBox(height: 20),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: [
            _LinkText(
              asset: 'assets/icons/punch/ool_recheck.svg',
              label: 'Recheck location',
              onTap: _busy ? null : _punch,
            ),
            _LinkText(
              asset: 'assets/icons/punch/ool_leave.svg',
              label: 'Apply for leave',
              onTap: () {
                _close();
                widget.onRequestWfh?.call();
              },
            ),
          ],
        ),
      ],
    );
  }

  Widget _sending() {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        SizedBox(
          width: 30,
          height: 30,
          child: CircularProgressIndicator(strokeWidth: 2.5, color: _brand),
        ),
        SizedBox(height: 20),
        Text(
          _needsApproval ? 'Sending your request...' : (_punchingIn ? 'Punching you in...' : 'Punching you out...'),
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
  /// The request is with the manager (node 3345:28592). The day is not
  /// present yet; the card says what was asked and from where.
  Widget _requested() {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        const SizedBox(height: 20),
        Image.asset('assets/icons/punch/request_sent.png', width: 76, height: 76),
        const SizedBox(height: 24),
        Text(
          'Request sent',
          textAlign: TextAlign.center,
          style: _sora(27, FontWeight.w700, _navy, height: 33 / 27),
        ),
        const SizedBox(height: 8),
        Text(
          'Your ${_punchingIn ? 'punch-in' : 'punch-out'} request is with your manager for approval.',
          textAlign: TextAlign.center,
          style: _sora(13, FontWeight.w400, _muted, height: 21 / 13),
        ),
        const SizedBox(height: 24),
        _PunchSummaryCard(
          heading: 'Requested at',
          at: _requestedAt,
          reason: _selectedReason,
          place: _distanceMeters == null || _officeLabel == null
              ? _officeLabel
              : '${_formatDistance(_distanceMeters!)} from ${_officeLabel!.split(' · ').first}',
          placeCaption: 'Location at request',
        ),
        const SizedBox(height: 28),
        _PunchPrimaryAction(label: 'Continue to Connect', onTap: () => _close()),
        if (widget.onViewAttendance case final open?) ...[
          const SizedBox(height: 16),
          _LinkText(
            label: 'View attendance',
            underline: true,
            onTap: () {
              _close();
              open();
            },
          ),
        ],
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
    height: 60,
    child: FilledButton(
      style: FilledButton.styleFrom(
        backgroundColor: _brand,
        foregroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: _sora(14, FontWeight.w600, Colors.white, height: 21 / 14),
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
        child: Text(
          label,
          maxLines: 2,
          textAlign: TextAlign.center,
          overflow: TextOverflow.ellipsis,
        ),
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

const _navy = Color(0xFF142A43);
const _muted = Color(0xFF586B7D);
const _hairline = Color(0xFFDCE3EA);
const _link = Color(0xFF0668D8);

/// "Monday, 5 October 2026".
String _longDate(DateTime value) {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return '${days[value.weekday - 1]}, ${value.day} ${months[value.month - 1]} ${value.year}';
}

/// "Manager approval required" — amber wash, 999 radius (node 3345:28301).
class _AmberPill extends StatelessWidget {
  const _AmberPill({required this.icon, required this.label});
  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
    decoration: BoxDecoration(
      color: const Color(0xFFFFF5DC),
      borderRadius: BorderRadius.circular(999),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 15, color: const Color(0xFF996300)),
        const SizedBox(width: 8),
        Text(label, style: _sora(12, FontWeight.w600, const Color(0xFF996300), height: 18 / 12)),
      ],
    ),
  );
}

/// The office this was measured against, and how far away it was.
class _OfficeCard extends StatelessWidget {
  const _OfficeCard({required this.name, required this.distance});
  final String name;
  final String distance;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: const Color(0xFFFBF4F4),
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: _hairline),
    ),
    child: Row(
      children: [
        Container(
          width: 43,
          height: 43,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: const Color(0xFFE4E9EF)),
          ),
          child: Center(child: SvgPicture.asset('assets/icons/punch/ool_office.svg', width: 23, height: 20)),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(name, maxLines: 1, overflow: TextOverflow.ellipsis,
                  style: _sora(14, FontWeight.w600, _navy, height: 21 / 14)),
              const SizedBox(height: 2),
              Text(distance, style: _sora(11.5, FontWeight.w400, _muted, height: 18 / 11.5)),
            ],
          ),
        ),
      ],
    ),
  );
}

/// One of HR's reasons as a tile (node 3357:29571): an illustration over the
/// label, 14 radius, tinted with blue text once chosen.
class _ReasonTile extends StatelessWidget {
  const _ReasonTile({required this.label, required this.image, required this.selected, required this.onTap});
  final String label;
  final String image;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
    color: selected ? const Color(0xFFF4F7FB) : Colors.white,
    borderRadius: BorderRadius.circular(14),
    child: InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: onTap,
      child: Container(
        height: 130,
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: _hairline, width: 1.1),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Image.asset(image, width: 60, height: 60, fit: BoxFit.contain),
            const SizedBox(height: 12),
            SizedBox(
              height: 39,
              child: Center(
                child: Text(
                  label,
                  maxLines: 2,
                  textAlign: TextAlign.center,
                  overflow: TextOverflow.ellipsis,
                  style: _sora(12, FontWeight.w400, selected ? _brand : _navy, height: 19.5 / 12),
                ),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

/// "Send punch-in request →": 52 high, 14 radius, greyed until it can go.
class _ArrowButton extends StatelessWidget {
  const _ArrowButton({required this.label, required this.enabled, required this.onTap});
  final String label;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 52,
    child: FilledButton(
      style: FilledButton.styleFrom(
        backgroundColor: _brand,
        disabledBackgroundColor: const Color(0xFF9DB9CB),
        foregroundColor: Colors.white,
        disabledForegroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
      onPressed: enabled ? onTap : null,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(label, style: _sora(14, FontWeight.w600, Colors.white, height: 21 / 14)),
          const SizedBox(width: 12),
          SvgPicture.asset('assets/icons/punch/ool_arrow.svg', width: 12, height: 9),
        ],
      ),
    ),
  );
}

/// A blue text link, with an icon before it or underlined on its own.
class _LinkText extends StatelessWidget {
  const _LinkText({required this.label, required this.onTap, this.asset, this.underline = false});
  final String label;
  final VoidCallback? onTap;
  final String? asset;
  final bool underline;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(8),
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (asset case final path?) ...[
            SvgPicture.asset(path, width: 17, height: 17),
            const SizedBox(width: 8),
          ],
          Text(
            label,
            style: _sora(underline ? 12 : 11.5, FontWeight.w600, _link, height: 18 / 11.5).copyWith(
              decoration: underline ? TextDecoration.underline : null,
              decorationColor: _link,
            ),
          ),
        ],
      ),
    ),
  );
}

/// The confirmation card (nodes 3345:28592 and 3345:29117): the moment on a
/// tinted band, then the reason and the place as two rows.
class _PunchSummaryCard extends StatelessWidget {
  const _PunchSummaryCard({
    required this.heading,
    required this.at,
    required this.reason,
    required this.place,
    required this.placeCaption,
  });
  final String heading;
  final DateTime at;
  final String? reason;
  final String? place;
  final String placeCaption;

  @override
  Widget build(BuildContext context) {
    final hour = at.hour % 12 == 0 ? 12 : at.hour % 12;
    final time = '$hour:${at.minute.toString().padLeft(2, '0')}';
    final meridiem = at.hour >= 12 ? 'PM' : 'AM';
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _hairline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            color: const Color(0xFFF4F7FB),
            padding: const EdgeInsets.fromLTRB(20, 18, 20, 18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(heading, style: _sora(11.5, FontWeight.w400, _muted, height: 18 / 11.5)),
                const SizedBox(height: 10),
                Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(text: time, style: _sora(35, FontWeight.w700, _navy, height: 1.1)),
                      TextSpan(text: ' $meridiem', style: _sora(20, FontWeight.w600, _navy, height: 1.1)),
                    ],
                  ),
                ),
                const SizedBox(height: 10),
                Text(_longDate(at), style: _sora(11.5, FontWeight.w400, _muted, height: 18 / 11.5)),
              ],
            ),
          ),
          if (reason case final why? when why.isNotEmpty)
            _SummaryRow(asset: 'assets/icons/punch/ool_row_briefcase.svg', title: why, caption: 'Reason for working outside'),
          if (place case final where? when where.isNotEmpty)
            _SummaryRow(asset: 'assets/icons/punch/ool_row_pin.svg', title: where, caption: placeCaption),
        ],
      ),
    );
  }
}

class _SummaryRow extends StatelessWidget {
  const _SummaryRow({required this.asset, required this.title, required this.caption});
  final String asset;
  final String title;
  final String caption;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.fromLTRB(20, 14, 20, 14),
    decoration: const BoxDecoration(border: Border(top: BorderSide(color: _hairline))),
    child: Row(
      children: [
        SizedBox(width: 20, height: 20, child: Center(child: SvgPicture.asset(asset, width: 18, height: 18))),
        const SizedBox(width: 20),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, maxLines: 2, overflow: TextOverflow.ellipsis,
                  style: _sora(12, FontWeight.w600, _navy, height: 18 / 12)),
              const SizedBox(height: 2),
              Text(caption, style: _sora(10.5, FontWeight.w400, _muted, height: 16 / 10.5)),
            ],
          ),
        ),
      ],
    ),
  );
}
