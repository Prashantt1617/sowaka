/// R6: what an ended account sees on sign-in or on opening the app. No
/// header, no tabs; the company, the last day, where to write for documents.
library;

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../shared/org_branding.dart';
import 'offboarding_dates.dart';
import 'offboarding_models.dart';
import 'offboarding_ui.dart';

class AccountClosedScreen extends StatelessWidget {
  const AccountClosedScreen({
    super.key,
    required this.info,
    required this.onBackToSignIn,
    this.openMail,
  });

  final AccountClosedInfo info;
  final VoidCallback onBackToSignIn;

  /// Opens the mail app; `url_launcher` otherwise (tests pass their own).
  final Future<void> Function(Uri uri)? openMail;

  @override
  Widget build(BuildContext context) {
    final company = info.companyName;
    final hrEmail = info.hrEmail;
    final lastDay = info.lastDay;
    final body = [
      if (lastDay != null)
        company == null
            ? 'Your last day was ${dayMonthYear(lastDay)}.'
            : 'Your last day at $company was ${dayMonthYear(lastDay)}.',
      hrEmail == null
          ? 'For your documents, contact HR.'
          : 'For your documents, contact HR at $hrEmail.',
    ].join(' ');
    final logo = OrgBranding.current.value.homeLogoAsset;
    return Scaffold(
      key: const ValueKey('account-closed'),
      backgroundColor: OffColors.page,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (logo != null)
                    Image.asset(
                      logo,
                      height: 36,
                      fit: BoxFit.contain,
                      errorBuilder: (_, _, _) => const SizedBox.shrink(),
                    )
                  else if (company != null)
                    Text(
                      company,
                      style: offText(
                        22,
                        weight: FontWeight.w700,
                        color: OffColors.brand,
                      ),
                    ),
                  const SizedBox(height: 28),
                  Container(
                    width: 64,
                    height: 64,
                    decoration: const BoxDecoration(
                      color: OffColors.tint,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.door_front_door_outlined,
                      size: 30,
                      color: OffColors.brand,
                    ),
                  ),
                  const SizedBox(height: 20),
                  Text(
                    'This account is no longer active',
                    textAlign: TextAlign.center,
                    style: offText(20, weight: FontWeight.w700, height: 26),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    body,
                    key: const ValueKey('account-closed-body'),
                    textAlign: TextAlign.center,
                    style: offText(14, color: OffColors.secondary, height: 21),
                  ),
                  const SizedBox(height: 28),
                  if (hrEmail != null) ...[
                    OffOutlineButton(
                      key: const ValueKey('account-closed-email-hr'),
                      label: 'Email HR',
                      onPressed: () {
                        final uri = Uri(scheme: 'mailto', path: hrEmail);
                        final open = openMail ?? (uri) async => launchUrl(uri);
                        open(uri);
                      },
                    ),
                    const SizedBox(height: 8),
                  ],
                  TextButton(
                    key: const ValueKey('account-closed-sign-in'),
                    onPressed: onBackToSignIn,
                    child: Text(
                      'Back to sign in',
                      style: offText(
                        14,
                        weight: FontWeight.w600,
                        color: OffColors.brand,
                      ),
                    ),
                  ),
                  const SizedBox(height: 32),
                  Text(
                    'Thank you for your time here.',
                    style: offText(13, color: OffColors.tertiary),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
