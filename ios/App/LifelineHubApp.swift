import LifelineKern
import SwiftUI
import UIKit
import UserNotifications

/// Einstieg der iOS-Hülle (LLH-1978). Die Hülle lädt die Weboberfläche des gewählten Servers und
/// trägt keine Anwendungslogik (ADR-0068, ios/AGENTS.md). Welche Seite sie zeigt, entscheidet die
/// Zustandsfunktion `Ablauf` des Kerns; `AppModell` führt deren Wirkungen aus.
@main
struct LifelineHubApp: App {
    @UIApplicationDelegateAdaptor(AppDelegat.self) private var appDelegat
    @State private var modell = AppModell()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(modell)
        }
    }
}

/// Was SwiftUI nicht weiterreicht: das Token von APNs (`Geraetetoken`) und der Delegate für
/// Meldungen, der vor dem Ende des Starts stehen muss, damit ein Tippen beim Kaltstart ankommt.
@MainActor
final class AppDelegat: NSObject, UIApplicationDelegate {
    /// `UNUserNotificationCenter.delegate` hält ihn nur schwach.
    private let meldungsdelegat = Meldungsdelegat()

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = meldungsdelegat
        return true
    }

    func application(
        _ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Geraetetoken.erhalten(deviceToken)
    }

    func application(
        _ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: any Error
    ) {
        Geraetetoken.gescheitert(error)
    }
}

/// Meldungen bei offener App und das Antippen (Spec `ios-huelle`, „Meldung und Badge bei
/// laufender App“; Entwurf „iOS-Alarme über APNs“). Ohne Akteur: iOS ruft ihn nicht auf dem
/// Hauptthread; über die Grenze gehen nur Texte.
final class Meldungsdelegat: NSObject, UNUserNotificationCenterDelegate {
    /// Meldungen der Brücke als Banner. Eine Push-Meldung des Servers, dessen Oberfläche gerade
    /// läuft, nicht: die Oberfläche meldet sie selbst über den Live-Kanal, sonst käme sie doppelt.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        let istPush = notification.request.trigger is UNPushNotificationTrigger
        if istPush, let kennung = Self.kennung(notification.request.content.userInfo),
            await Meldungsweg.isAktiverServer(kennung: kennung)
        {
            return []
        }
        return [.banner, .list, .sound]
    }

    /// Tippen öffnet Server und Pfad der Meldung (`AppModell.meldungAngetippt`).
    func userNotificationCenter(
        _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
    ) async {
        guard response.actionIdentifier == UNNotificationDefaultActionIdentifier else { return }
        let angaben = response.notification.request.content.userInfo
        guard let kennung = Self.kennung(angaben) else { return }
        let pfad = angaben["pfad"] as? String
        await Meldungsweg.angetippt(kennung: kennung, pfad: pfad)
    }

    /// Die Kennung setzt die Extension; scheiterte sie, steht sie noch im unverschlüsselten
    /// Umschlag `l`, und das Tippen öffnet wenigstens den richtigen Server.
    private static func kennung(_ angaben: [AnyHashable: Any]) -> String? {
        if let kennung = angaben["kennung"] as? String { return kennung }
        return (angaben["l"] as? String).flatMap { PushNutzlast.umschlag($0)?.kennung }
    }
}

/// Zwischen `Meldungsdelegat` und `AppModell`: ein Tippen beim Kaltstart kommt, bevor die
/// Oberfläche steht, und wartet hier, bis `AppModell.start()` das Modell verbindet.
@MainActor
enum Meldungsweg {
    private static var modell: AppModell?
    private static var wartend: (kennung: String, pfad: String?)?

    static func verbinde(_ modell: AppModell) {
        self.modell = modell
        guard let tipp = wartend else { return }
        wartend = nil
        modell.meldungAngetippt(kennung: tipp.kennung, pfad: tipp.pfad)
    }

    static func angetippt(kennung: String, pfad: String?) {
        guard let modell else {
            wartend = (kennung, pfad)
            return
        }
        modell.meldungAngetippt(kennung: kennung, pfad: pfad)
    }

    static func isAktiverServer(kennung: String) -> Bool {
        modell?.isAktiverServer(kennung: kennung) ?? false
    }
}
