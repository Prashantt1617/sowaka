import 'dart:async';

import '../data/auth_api_service.dart';
import '../data/auth_models.dart';

enum AuthStep { email, code, success }

enum AuthStatus { idle, loading }

class AuthState {
  const AuthState({
    required this.step,
    required this.status,
    required this.email,
    required this.otp,
    this.session,
    this.error,
  });

  factory AuthState.initial() {
    return const AuthState(
      step: AuthStep.email,
      status: AuthStatus.idle,
      email: '',
      otp: '',
    );
  }

  final AuthStep step;
  final AuthStatus status;
  final String email;
  final String otp;
  final AuthSession? session;
  final String? error;

  bool get isEmailValid =>
      RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email);

  bool get isOtpComplete => RegExp(r'^\d{6}$').hasMatch(otp);

  bool get isLoading => status == AuthStatus.loading;

  AuthState copyWith({
    AuthStep? step,
    AuthStatus? status,
    String? email,
    String? otp,
    AuthSession? session,
    String? error,
    bool clearError = false,
  }) {
    return AuthState(
      step: step ?? this.step,
      status: status ?? this.status,
      email: email ?? this.email,
      otp: otp ?? this.otp,
      session: session ?? this.session,
      error: clearError ? null : error ?? this.error,
    );
  }
}

sealed class AuthEvent {
  const AuthEvent();
}

class AuthEmailChanged extends AuthEvent {
  const AuthEmailChanged(this.email);
  final String email;
}

class AuthOtpChanged extends AuthEvent {
  const AuthOtpChanged(this.otp);
  final String otp;
}

class RequestAuthOtp extends AuthEvent {
  const RequestAuthOtp();
}

class VerifyAuthOtp extends AuthEvent {
  const VerifyAuthOtp();
}

class EditAuthEmail extends AuthEvent {
  const EditAuthEmail();
}

class ClearAuthError extends AuthEvent {
  const ClearAuthError();
}

/// The session changed under us — first-run added a photo and interests — and
/// the welcome screen behind it should show the new one.
class SessionUpdated extends AuthEvent {
  const SessionUpdated(this.session);

  final AuthSession session;
}

class AuthBloc {
  AuthBloc({AuthApiService? service})
    : _service = service ?? AuthApiService(),
      _state = AuthState.initial();

  final AuthApiService _service;
  final _controller = StreamController<AuthState>.broadcast();
  AuthState _state;

  AuthState get state => _state;

  Stream<AuthState> get stream => _controller.stream;

  void add(AuthEvent event) {
    _handle(event);
  }

  void dispose() {
    _controller.close();
  }

  void _emit(AuthState state) {
    _state = state;
    if (!_controller.isClosed) {
      _controller.add(state);
    }
  }

  Future<void> _handle(AuthEvent event) async {
    switch (event) {
      case SessionUpdated(:final session):
        _emit(_state.copyWith(session: session));
      case AuthEmailChanged(:final email):
        _emit(_state.copyWith(email: email.trim(), clearError: true));
      case AuthOtpChanged(:final otp):
        _emit(_state.copyWith(otp: otp, clearError: true));
      case RequestAuthOtp():
        if (!_state.isEmailValid || _state.isLoading) return;
        _emit(_state.copyWith(status: AuthStatus.loading, clearError: true));
        try {
          await _service.requestOtp(_state.email);
          _emit(
            _state.copyWith(
              step: AuthStep.code,
              status: AuthStatus.idle,
              otp: '',
            ),
          );
        } catch (error) {
          _emit(
            _state.copyWith(status: AuthStatus.idle, error: error.toString()),
          );
        }
      case VerifyAuthOtp():
        if (!_state.isOtpComplete || _state.isLoading) return;
        _emit(_state.copyWith(status: AuthStatus.loading, clearError: true));
        try {
          final session = await _service.verifyOtp(_state.email, _state.otp);
          _emit(
            _state.copyWith(
              step: AuthStep.success,
              status: AuthStatus.idle,
              session: session,
            ),
          );
        } catch (error) {
          _emit(
            _state.copyWith(status: AuthStatus.idle, error: error.toString()),
          );
        }
      case EditAuthEmail():
        _emit(
          _state.copyWith(
            step: AuthStep.email,
            status: AuthStatus.idle,
            otp: '',
            clearError: true,
          ),
        );
      case ClearAuthError():
        _emit(_state.copyWith(clearError: true));
    }
  }
}
