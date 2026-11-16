import FirebaseMessaging
import UserNotifications

/// Puts the picture on a push before iOS shows it.
///
/// The server sends `mutable-content: 1` and `fcm_options.image` (the picture's
/// link) on a push that has one; iOS then hands the push here first, and
/// Firebase's helper downloads the picture and attaches it. A push without a
/// picture, or one whose picture does not arrive in time, is shown as it came.
/// The sound needs nothing here: `aps.sound` names a file in Library/Sounds.
class NotificationService: UNNotificationServiceExtension {
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var bestAttemptContent: UNMutableNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
      contentHandler(request.content)
      return
    }
    bestAttemptContent = content
    Messaging.serviceExtension().populateNotificationContent(content, withContentHandler: contentHandler)
  }

  /// iOS is about to give up on the extension (about 30 seconds): show the
  /// push as it is, without the picture, rather than not at all.
  override func serviceExtensionTimeWillExpire() {
    if let contentHandler = contentHandler, let content = bestAttemptContent {
      contentHandler(content)
    }
  }
}
