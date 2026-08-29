class ApiConfig {
  const ApiConfig._();

  // Hosted backend. Override for local dev with:
  //   flutter run --dart-define=API_BASE_URL=http://localhost:4000
  static const String _defaultBaseUrl = 'https://d3lwup4rvo6csf.cloudfront.net';

  static String get baseUrl {
    const configured = String.fromEnvironment('API_BASE_URL');
    if (configured.isNotEmpty) return configured;
    return _defaultBaseUrl;
  }
}
