import Foundation
import LifelineKern
import UIKit
import UserNotifications

// Push und Mitteilungen der Helfer-App (Stufe 2, ADR-0106): Recht, Token von APNs, Kennung und
// Schlüssel der Kopplung, Mitteilungen bei offener App und das Antippen. Muster ist die Hülle
// (ios/App/LifelineHubApp.swift, ios/App/Systemdienste.swift). Token und Schlüssel stehen in keinem
// Log; Aufträge liegen nie auf der Platte.

/// Was SwiftUI nicht weiterreicht: das Token von APNs (`Geraetetoken`) und der Delegate für
/// Mitteilungen, der vor dem Ende des Starts stehen muss, damit ein Tippen beim Kaltstart ankommt.
@MainActor
final class HelferAppDelegat: NSObject, UIApplicationDelegate {
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

/// Mitteilungen bei offener App und das Antippen. Ohne Akteur: iOS ruft ihn nicht auf dem
/// Hauptthread; über die Grenze gehen nur Zahlen.
final class Meldungsdelegat: NSObject, UNUserNotificationCenterDelegate {
    /// Ein Auftrag bei offener App: die Liste neu laden (keine eigene Live-Verbindung) und die
    /// Mitteilung trotzdem zeigen, damit sie auffällt.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        if notification.request.trigger is UNPushNotificationTrigger {
            await Meldungsweg.pushEmpfangen()
        }
        return [.banner, .list, .sound]
    }

    /// Tippen öffnet den Auftrag; ohne `task_id` (Dienst scheiterte) nur die App.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
    ) async {
        guard response.actionIdentifier == UNNotificationDefaultActionIdentifier else { return }
        let auftrag = (response.notification.request.content.userInfo["task_id"] as? NSNumber)?
            .int64Value
        await Meldungsweg.angetippt(auftrag: auftrag)
    }
}

/// Zwischen `Meldungsdelegat` und `HelferModell`: ein Tippen beim Kaltstart kommt, bevor das
/// Modell steht, und wartet hier, bis `HelferModell.start` es verbindet; im Modell wartet es dann,
/// bis die Phase bekannt ist (`Phase.meldungstipp`).
@MainActor
enum Meldungsweg {
    private static var modell: HelferModell?
    private static var wartend: Int64?
    private static var hatWartenden = false

    static func verbinde(_ modell: HelferModell) {
        self.modell = modell
        guard hatWartenden else { return }
        hatWartenden = false
        modell.meldungAngetippt(auftrag: wartend)
        wartend = nil
    }

    static func angetippt(auftrag: Int64?) {
        guard let modell else {
            wartend = auftrag
            hatWartenden = true
            return
        }
        modell.meldungAngetippt(auftrag: auftrag)
    }

    static func pushEmpfangen() {
        modell?.pushEmpfangen()
    }
}

/// Das Recht für Mitteilungen.
enum Mitteilungsfreigabe: Equatable, Sendable {
    case offen, erlaubt, verweigert
}

/// UserNotifications außerhalb des Hauptakteurs; über die Grenze gehen nur Werte.
enum Mitteilungen {
    static func freigabe() async -> Mitteilungsfreigabe {
        switch await UNUserNotificationCenter.current().notificationSettings().authorizationStatus {
        case .notDetermined: .offen
        case .denied: .verweigert
        case .authorized, .provisional, .ephemeral: .erlaubt
        @unknown default: .verweigert
        }
    }

    /// Alert und Ton, kein Badge (die App setzt keine Zahl am Symbol); zeitkritisch trägt die
    /// Capability (`com.apple.developer.usernotifications.time-sensitive`), keine eigene Option.
    static func requestFreigabe() async -> Bool {
        (try? await UNUserNotificationCenter.current().requestAuthorization(options: [
            .alert, .sound,
        ])) ?? false
    }

    /// Fragt nur, solange noch nicht entschieden ist; `true`, wenn Mitteilungen erlaubt sind.
    static func erlaubtOderFragen() async -> Bool {
        switch await freigabe() {
        case .erlaubt: true
        case .verweigert: false
        case .offen: await requestFreigabe()
        }
    }

    /// Debug-Builds aus Xcode bekommen Token der Sandbox, TestFlight und App Store der Produktion
    /// (`aps-environment` in `Helfer/App/LifelineHelfer.entitlements`).
    static var umgebung: String {
        #if DEBUG
            return "sandbox"
        #else
            return "production"
        #endif
    }
}

struct Pushfehler: Error {}

/// Das Token von APNs: `registerForRemoteNotifications()` antwortet über den App-Delegate, nicht an
/// der Stelle des Aufrufs. Wer wartet, steht hier; antwortet iOS nicht binnen `frist`, gilt Push
/// als nicht verfügbar. Ein neues Token ohne Wartende (iOS hat es gewechselt) geht an
/// `beiNeuemToken`.
@MainActor
enum Geraetetoken {
    static let frist: Duration = .seconds(30)
    static var beiNeuemToken: ((Data) -> Void)?
    private static var wartende: [CheckedContinuation<Data, any Error>] = []
    private static var runde = 0

    static func anfordern() async throws -> Data {
        try await withCheckedThrowingContinuation { fortsetzung in
            wartende.append(fortsetzung)
            guard wartende.count == 1 else { return }
            runde += 1
            let diese = runde
            UIApplication.shared.registerForRemoteNotifications()
            Task { @MainActor in
                try? await Task.sleep(for: frist)
                if runde == diese { gescheitert(Pushfehler()) }
            }
        }
    }

    static func erhalten(_ token: Data) {
        let alle = nimmWartende()
        guard !alle.isEmpty else {
            beiNeuemToken?(token)
            return
        }
        for fortsetzung in alle { fortsetzung.resume(returning: token) }
    }

    static func gescheitert(_ fehler: any Error) {
        for fortsetzung in nimmWartende() { fortsetzung.resume(throwing: fehler) }
    }

    /// Hex wie der Server es erwartet (`token` in `PUT /api/devices/me/push`).
    static func hex(_ token: Data) -> String {
        token.map { String(format: "%02x", $0) }.joined()
    }

    private static func nimmWartende() -> [CheckedContinuation<Data, any Error>] {
        let alle = wartende
        wartende = []
        return alle
    }
}

/// Kennung (UUID, AAD der Nutzlast) und Schlüssel der Push-Anmeldung dieser einen Kopplung. Die
/// Kennung ist kein Geheimnis und liegt in den `UserDefaults` der App, der Schlüssel im
/// Schlüsselbund mit der App Group als Gruppe (`Schluesselbund`), damit der Mitteilungsdienst ihn
/// lesen kann. Eine neue Kopplung bekommt eine neue Kennung; mit der Kopplung fällt beides.
@MainActor
enum Pushschluessel {
    private static let kennungSchluessel = "pushKennung"

    /// Die vorhandene Kennung mit Schlüssel oder neue; `nil`, wenn der Schlüsselbund nicht
    /// schreibt.
    static func vorhandenOderNeu() -> (kennung: String, schluessel: Data)? {
        if let kennung = UserDefaults.standard.string(forKey: kennungSchluessel),
            let schluessel = Schluesselbund.lesen(kennung: kennung)
        {
            return (kennung, schluessel)
        }
        loeschen()
        let kennung = UUID().uuidString.lowercased()
        let schluessel = Entschluesseler.neuerSchluessel()
        do {
            try Schluesselbund.speichern(kennung: kennung, schluessel: schluessel)
        } catch {
            return nil
        }
        UserDefaults.standard.set(kennung, forKey: kennungSchluessel)
        return (kennung, schluessel)
    }

    static func loeschen() {
        guard let kennung = UserDefaults.standard.string(forKey: kennungSchluessel) else { return }
        Schluesselbund.loeschen(kennung: kennung)
        UserDefaults.standard.removeObject(forKey: kennungSchluessel)
    }

    /// Die Anmeldung, wie der Server sie nimmt.
    static func anmeldung(token: Data) -> Pushanmeldung? {
        guard let paar = vorhandenOderNeu() else { return nil }
        return Pushanmeldung(
            registrationId: paar.kennung, token: Geraetetoken.hex(token),
            environment: Mitteilungen.umgebung, key: Base64URL.encode(paar.schluessel))
    }
}
