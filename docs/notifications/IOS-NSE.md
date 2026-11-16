# iOS Notification Service Extension: checking it in Xcode

Branch `el/notif-rich` adds a Notification Service Extension (NSE) target, `NotificationService`, so an iPhone shows the picture a push carries. It was written by hand, without Xcode, `pod install` or a build. Someone needs to check it on a Mac with Xcode before the release goes out.

## What the extension does

When a push has a picture, the server sends `mutable-content: 1` and `fcm_options.image` (see `backend/src/services/notification-look.service.ts`). iOS then runs the extension first. `NotificationService.swift` calls `Messaging.serviceExtension().populateNotificationContent`, which downloads the picture and attaches it. If the picture does not arrive within iOS's time limit, `serviceExtensionTimeWillExpire` shows the push without it.

The sound needs no extension. `aps.sound` names a file that the app copies into `Library/Sounds`: `chime.caf` and the other built-in sounds, or `<key>.wav` for a sound it downloaded.

## What was changed

| File | Change |
|---|---|
| `mobile-app/ios/NotificationService/NotificationService.swift` | the extension's code |
| `mobile-app/ios/NotificationService/Info.plist` | `NSExtensionPointIdentifier` = `com.apple.usernotifications.service`, `NSExtensionPrincipalClass` = `$(PRODUCT_MODULE_NAME).NotificationService`, version = `$(FLUTTER_BUILD_NAME)` / `$(FLUTTER_BUILD_NUMBER)` |
| `mobile-app/ios/NotificationService/NotificationService.entitlements` | empty (the extension needs no capabilities) |
| `mobile-app/ios/NotificationService/{Debug,Release,Profile}.xcconfig` | include the extension's Pods xcconfig and `Flutter/Generated.xcconfig`, so the version matches the app's |
| `mobile-app/ios/Podfile` | `target 'NotificationService'` with `use_frameworks!` and `pod 'Firebase/Messaging'` (unpinned, so it resolves to the app's 12.18.0) |
| `mobile-app/ios/Runner.xcodeproj/project.pbxproj` | the new target (see below) |

The project file changes:

- A new native target, `NotificationService` (`com.apple.product-type.app-extension`), with Sources (`NotificationService.swift`), Frameworks and Resources phases.
- A `NotificationService` group, and `NotificationService.appex` under Products.
- In **Runner**:
  - an **Embed Foundation Extensions** phase (copy files, destination PlugIns) holding `NotificationService.appex`. It sits right after Copy Bundle Resources and before Thin Binary, the position that avoids Xcode's "Cycle inside Runner" error.
  - a target dependency on NotificationService.
- Build settings for all three configurations:
  - Bundle id:
    - Debug and Release: `com.tanvijadhav.sowaka.NotificationService`
    - Profile: `com.kritik.sowaka.dev.NotificationService`, matching Runner's per-configuration ids
  - Team `W86YPZ2HGF`, automatic signing.
  - iOS 15.5, the same as Runner.
  - Swift 5.
  - `APPLICATION_EXTENSION_API_ONLY = YES`.
  - `SKIP_INSTALL = YES`.
  - Runpath `@executable_path/../../Frameworks`.
  - `EXCLUDED_ARCHS[sdk=iphonesimulator*] = arm64`, the same as Runner.
  - Base configurations: the three xcconfigs above.

`plutil -lint` passes on the project file, and every object it references exists exactly once (checked with a script, not with Xcode).

## Steps to verify (about 15 minutes)

1. `cd mobile-app && flutter pub get`, then `cd ios && pod install`.
   - Expect this CocoaPods warning, and ignore it: *"CocoaPods did not set the base configuration of your project because your project already has a custom config set… NotificationService…"*. Our xcconfigs include the Pods file themselves, the same way Flutter's Runner does.
   - `Podfile.lock` gains `Pods-NotificationService`. Commit the lock file.
2. Open `ios/Runner.xcworkspace`. Check:
   - **Targets** lists Runner, RunnerTests and NotificationService.
   - **NotificationService › Signing & Capabilities**: team W86YPZ2HGF and automatic signing, with no red errors. Xcode creates the new App ID the first time; let it.
   - **NotificationService › General**: iOS 15.5. The version and build show `$(FLUTTER_BUILD_NAME)` / `$(FLUTTER_BUILD_NUMBER)`, which is correct.
   - **Runner › Build Phases**: **Embed Foundation Extensions** contains `NotificationService.appex` and comes before **Thin Binary**. **Dependencies** lists NotificationService.
3. Build:
   - `flutter build ios --release --no-codesign`, or Product › Archive in Xcode.
   - In the archive or `.app`, `Runner.app/PlugIns/NotificationService.appex` must exist.
   - In Organizer › Validate App, check that the extension's version and build match the app's (1.4.0 (70) or whatever ships).
4. Test on a real iPhone. A simulator cannot receive remote pushes with an NSE reliably.
   - Install the build, sign in to the **sowaka** org (test only there) and open the app once. That copies the built-in sounds and registers the token with its sounds.
   - Post a contest with a photo in sowaka, or wait for one to close. You should see the photo on the push (long-press it to see it large) and hear the chime.
   - A push with no picture, such as a leave approval, looks exactly as before.
   - In Console.app on the Mac, filter by process `NotificationService` to see the extension run.

## If Xcode complains

- **"Cycle inside Runner; building could produce unreliable results"**: in Runner › Build Phases, drag **Embed Foundation Extensions** above **Thin Binary**, or directly under **Copy Bundle Resources**.
- **"No such module 'FirebaseMessaging'"** in `NotificationService.swift`: `pod install` did not run, or did not pick up the new target. Check that the Podfile has `target 'NotificationService'`, run `pod deintegrate && pod install`, and open the `.xcworkspace`, not the `.xcodeproj`.
- **"The CFBundleVersion of an app extension must match that of its containing parent app"**: the xcconfig include of `Flutter/Generated.xcconfig` is not taking effect. Set **Base Configuration** for each NotificationService configuration (Project › Info › Configurations) to `NotificationService/Debug|Release|Profile.xcconfig`. Alternatively, set `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` by hand to the app's values.
- **Signing errors for `…NotificationService`**: in Signing & Capabilities, choose the team again and let Xcode register the App ID. For App Store export, Organizer with automatic signing creates the profile. Manual profiles need a new one for the extension's bundle id.
- **The project will not open, or the target looks broken**: revert `project.pbxproj` with `git checkout <base> -- mobile-app/ios/Runner.xcodeproj/project.pbxproj` and add the target through Xcode's UI instead (next section). Keep the files in `ios/NotificationService/`; Xcode's template would overwrite them, so restore them afterwards with `git checkout el/notif-rich -- mobile-app/ios/NotificationService`.

## Adding the target through Xcode instead

1. Open `ios/Runner.xcworkspace` and choose File › New › Target… › **Notification Service Extension**.
   - Product name `NotificationService`, team W86YPZ2HGF, language Swift, embed in **Runner**.
   - When Xcode asks to activate the scheme, choose **Cancel**, so you stay on Runner.
2. Xcode creates `NotificationService/NotificationService.swift` and `Info.plist`. Replace both with the ones from this branch: `git checkout el/notif-rich -- mobile-app/ios/NotificationService`.
3. In the new target's Build Settings:
   - **iOS Deployment Target** 15.5
   - **Bundle Identifier**:
     - Debug and Release: `com.tanvijadhav.sowaka.NotificationService`
     - Profile: `com.kritik.sowaka.dev.NotificationService`
   - **Code Signing Entitlements** `NotificationService/NotificationService.entitlements`
   - **Excluded Architectures** (simulator) `arm64`
   - **Info.plist File** `NotificationService/Info.plist`
4. Project › Info › Configurations: for each configuration, set NotificationService's base configuration to `NotificationService/<Configuration>.xcconfig`.
5. Xcode 14 and later name Runner's new phase **Embed Foundation Extensions**. Move it above **Thin Binary**.
6. `pod install`, then follow the steps to verify above.

## Known limits

- Firebase's helper names the downloaded picture after the response's file name, and iOS refuses an attachment whose name gives the wrong type. A PNG upload can be served as a JPEG copy, so push links carry `push=1`, which makes `/media` answer `Content-Disposition: inline; filename="picture.jpg|png"` with the type actually sent. If a picture shows on Android but not on an iPhone, check that header first: `curl -I '<imageUrl>'`.
- Devices on older builds, without the extension, show the same push without the picture. The server needs no switch.
