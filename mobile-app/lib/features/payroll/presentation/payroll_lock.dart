import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:local_auth/local_auth.dart';

/// What asking the phone for its lock came to.
enum DeviceLockResult { unlocked, canceled, notSet, unavailable, failed }

/// The phone's own lock: Face ID, fingerprint, or its passcode, PIN or
/// pattern. Tests hand in their own.
abstract class DeviceLock {
  Future<DeviceLockResult> unlock(String reason);
}

/// The real one, through the system's own prompt. Biometrics when the phone
/// has them, its passcode otherwise (or when the face or finger fails).
class SystemDeviceLock implements DeviceLock {
  SystemDeviceLock([LocalAuthentication? auth]) : _auth = auth ?? LocalAuthentication();
  final LocalAuthentication _auth;

  @override
  Future<DeviceLockResult> unlock(String reason) async {
    try {
      if (!await _auth.isDeviceSupported()) return DeviceLockResult.notSet;
      final ok = await _auth.authenticate(localizedReason: reason, persistAcrossBackgrounding: true);
      return ok ? DeviceLockResult.unlocked : DeviceLockResult.canceled;
    } on LocalAuthException catch (e) {
      switch (e.code) {
        case LocalAuthExceptionCode.noCredentialsSet:
          return DeviceLockResult.notSet;
        case LocalAuthExceptionCode.userCanceled:
        case LocalAuthExceptionCode.systemCanceled:
        case LocalAuthExceptionCode.timeout:
        case LocalAuthExceptionCode.userRequestedFallback:
          return DeviceLockResult.canceled;
        case LocalAuthExceptionCode.uiUnavailable:
          return DeviceLockResult.unavailable;
        default:
          return DeviceLockResult.failed;
      }
    } catch (_) {
      return DeviceLockResult.failed;
    }
  }
}

/// Whether Payroll is unlocked right now. It stays unlocked while the app is
/// in use (leave Payroll and come back: no second prompt) and locks again the
/// moment the app goes to the background.
class PayrollLockSession with WidgetsBindingObserver {
  PayrollLockSession._();
  static final PayrollLockSession instance = PayrollLockSession._();

  final ValueNotifier<bool> unlocked = ValueNotifier(false);
  bool _watching = false;

  void markUnlocked() {
    if (!_watching) {
      WidgetsBinding.instance.addObserver(this);
      _watching = true;
    }
    unlocked.value = true;
  }

  void lock() => unlocked.value = false;

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // The system's own prompt makes the app "inactive" while it is up, so only
    // really leaving (background, another app on top) locks it.
    if (state == AppLifecycleState.paused || state == AppLifecycleState.hidden) lock();
  }
}

/// Payroll behind the phone's lock. Opening it asks for Face ID, a fingerprint
/// or the phone's passcode first; a phone with no lock at all is asked to set
/// one, because Payroll shows salary.
class PayrollLockGate extends StatefulWidget {
  const PayrollLockGate({super.key, required this.child, required this.onClose, this.lock, this.session});

  final Widget child;
  final VoidCallback onClose;
  final DeviceLock? lock;
  final PayrollLockSession? session;

  @override
  State<PayrollLockGate> createState() => _PayrollLockGateState();
}

class _PayrollLockGateState extends State<PayrollLockGate> with WidgetsBindingObserver {
  late final DeviceLock _lock = widget.lock ?? SystemDeviceLock();
  late final PayrollLockSession _session = widget.session ?? PayrollLockSession.instance;
  DeviceLockResult? _last;
  bool _asking = false;

  /// Web has no phone lock to ask for.
  bool get _skip => kIsWeb;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _session.unlocked.addListener(_changed);
    if (!_skip && !_session.unlocked.value) WidgetsBinding.instance.addPostFrameCallback((_) => _ask());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _session.unlocked.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Back from the background with Payroll open: ask again straight away.
    if (state == AppLifecycleState.resumed && !_skip && !_session.unlocked.value && !_asking) _ask();
  }

  Future<void> _ask() async {
    if (_asking || !mounted) return;
    setState(() => _asking = true);
    final result = await _lock.unlock('Unlock Payroll');
    if (!mounted) return;
    if (result == DeviceLockResult.unlocked) _session.markUnlocked();
    setState(() {
      _asking = false;
      _last = result;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_skip || _session.unlocked.value) return widget.child;
    final notSet = _last == DeviceLockResult.notSet;
    final title = notSet ? 'Set a screen lock to open Payroll' : 'Payroll is locked';
    final body = notSet
        ? 'Payroll shows your salary, so Sowaka asks for your phone’s Face ID, fingerprint or passcode before opening it. '
            'This phone has no screen lock yet. Add one in your phone’s Settings, then come back and try again.'
        : _last == DeviceLockResult.failed || _last == DeviceLockResult.unavailable
            ? 'Your phone could not check it just now. Try again.'
            : 'Use your Face ID, fingerprint or phone passcode to see your salary and payslips.';
    final scheme = Theme.of(context).colorScheme;
    return Material(
      key: const ValueKey('payroll-lock'),
      color: Colors.transparent,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 64,
                height: 64,
                decoration: BoxDecoration(color: const Color(0xFFE0F2FE), borderRadius: BorderRadius.circular(20)),
                child: Icon(notSet ? Icons.lock_open_rounded : Icons.lock_rounded, color: const Color(0xFF0571A6), size: 30),
              ),
              const SizedBox(height: 18),
              Text(title, textAlign: TextAlign.center, style: const TextStyle(fontFamily: 'Sora', fontSize: 18, fontWeight: FontWeight.w600, height: 1.3)),
              const SizedBox(height: 8),
              Text(body, textAlign: TextAlign.center, style: TextStyle(fontSize: 14, height: 1.45, color: scheme.onSurface.withValues(alpha: 0.7))),
              if (notSet) ...[
                const SizedBox(height: 10),
                Text(
                  defaultTargetPlatform == TargetPlatform.iOS
                      ? 'Settings › Face ID & Passcode (or Touch ID & Passcode) › Turn Passcode On'
                      : 'Settings › Security › Screen lock (PIN, pattern or password; add a fingerprint or face there too)',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 12.5, height: 1.4, color: scheme.onSurface.withValues(alpha: 0.55)),
                ),
              ],
              const SizedBox(height: 22),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  key: const ValueKey('payroll-unlock'),
                  onPressed: _asking ? null : _ask,
                  style: FilledButton.styleFrom(backgroundColor: const Color(0xFF0571A6), minimumSize: const Size.fromHeight(48), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))),
                  child: Text(_asking ? 'Checking…' : notSet ? 'I’ve set it, try again' : 'Unlock Payroll'),
                ),
              ),
              const SizedBox(height: 6),
              TextButton(key: const ValueKey('payroll-lock-back'), onPressed: widget.onClose, child: const Text('Back')),
            ],
          ),
        ),
      ),
    );
  }
}
