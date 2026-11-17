package com.sowaka.connect

import androidx.core.content.FileProvider

/**
 * Hands the system the notification sounds the app downloaded
 * (filesDir/notification_sounds, see res/xml/notification_sound_paths.xml) as
 * content:// URIs, which a notification channel's sound must be: the system's
 * sound player cannot read the app's own files by path.
 *
 * A subclass rather than FileProvider itself, so its manifest entry never
 * merges with a plugin's own FileProvider (image_picker, file_picker…).
 */
class NotificationSoundProvider : FileProvider()
