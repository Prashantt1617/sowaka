// The links in notification emails: what the app opens for each, and which
// it ignores.
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/services/app_link_service.dart';

void main() {
  test('a request link carries the same fields as its push', () {
    final data = appLinkDestination(
      Uri.parse(
        'https://go.getsowaka.com/open?type=attendance&view=inbox&requestId=abc123',
      ),
    );
    expect(data, {'type': 'attendance', 'view': 'inbox', 'requestId': 'abc123'});
  });

  test('a feedback link names its destination and period', () {
    final data = appLinkDestination(
      Uri.parse(
        'https://go.getsowaka.com/open/?destination=grow_feedback&period=2026-10',
      ),
    );
    expect(data, {'destination': 'grow_feedback', 'period': '2026-10'});
  });

  test('empty values are dropped, and a bare /open opens nothing', () {
    expect(
      appLinkDestination(
        Uri.parse('https://go.getsowaka.com/open?type=leave&requestId='),
      ),
      {'type': 'leave'},
    );
    expect(appLinkDestination(Uri.parse('https://go.getsowaka.com/open')), isNull);
  });

  test('the app scheme spells the same link', () {
    expect(
      appLinkDestination(Uri.parse('sowaka://open?type=leave&view=mine')),
      {'type': 'leave', 'view': 'mine'},
    );
    expect(appLinkDestination(Uri.parse('sowaka://home?type=leave')), isNull);
  });

  test('another path on the domain is not a link of ours', () {
    expect(
      appLinkDestination(Uri.parse('https://go.getsowaka.com/login?next=%2F')),
      isNull,
    );
    expect(appLinkDestination(Uri.parse('https://go.getsowaka.com/')), isNull);
  });
}
