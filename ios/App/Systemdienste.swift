import Foundation
import LifelineKern
import UIKit
import UserNotifications
import WebKit

/// Die Systemdienste der Brücke mit UIKit und UserNotifications (Entwurf D6, D8). Was hier
/// geschieht, entscheidet `Brueckenausfuehrung` im Kern; diese Klasse spielt nur ab.
@MainActor
final class Systemdienste: Huellendienste {
    private let webView: @MainActor () -> WKWebView?
    private let anmelder: Anmelder
    /// Anmeldungen am Push-Kanal; `nil` im Testzustand (kein Netz, keine Ablage).
    private let pushablage: Pushablage?
    /// Der Server, dessen Seite gerade die Brücke ruft.
    private let aktiverServer: @MainActor () -> UUID?

    init(
        webView: @escaping @MainActor () -> WKWebView?, anmelder: Anmelder, pushablage: Pushablage?,
        aktiverServer: @escaping @MainActor () -> UUID?
    ) {
        self.webView = webView
        self.anmelder = anmelder
        self.pushablage = pushablage
        self.aktiverServer = aktiverServer
    }

    var isHaptikEnabled: Bool {
        Haptik.isEnabled(
            gespeichert: UserDefaults.standard.object(forKey: Haptik.schalterSchluessel) as? Bool)
    }

    /// Auf dem iPad ohne Wirkung (keine Taptic Engine).
    func play(_ feedback: Haptik.Feedback) {
        switch feedback {
        case .success: UINotificationFeedbackGenerator().notificationOccurred(.success)
        case .warning: UINotificationFeedbackGenerator().notificationOccurred(.warning)
        case .error: UINotificationFeedbackGenerator().notificationOccurred(.error)
        case .selection: UISelectionFeedbackGenerator().selectionChanged()
        case .lightImpact: UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
    }

    func loadMeldungsfreigabe() async -> Meldungsfreigabe { await Mitteilungen.freigabe() }

    func requestMeldungsfreigabe() async -> Bool { await Mitteilungen.requestFreigabe() }

    func showNotification(title: String, body: String?) async throws {
        try await Mitteilungen.show(title: title, body: body)
    }

    func setBadge(_ count: Int) async throws { try await Mitteilungen.setBadge(count) }

    /// Druckdialog von iOS mit dem Inhalt des Webviews (`window.print` ersetzt das Init-Skript).
    func print() async throws -> Bool {
        guard UIPrintInteractionController.isPrintingAvailable else {
            throw Druckfehler("Drucken ist auf diesem Gerät nicht möglich.")
        }
        guard let webView = webView() else { throw Druckfehler("Keine Seite zum Drucken.") }
        let drucker = UIPrintInteractionController.shared
        let info = UIPrintInfo.printInfo()
        info.outputType = .general
        info.jobName = webView.title.flatMap { $0.isEmpty ? nil : $0 } ?? "Lifeline"
        drucker.printInfo = info
        drucker.printFormatter = webView.viewPrintFormatter()
        let ergebnis: Result<Bool, Druckfehler> = await withCheckedContinuation { fortsetzung in
            let einmal = Einmal(fortsetzung)
            let fertig: UIPrintInteractionController.CompletionHandler = { _, gedruckt, fehler in
                einmal.resume(
                    fehler.map { .failure(Druckfehler($0.localizedDescription)) } ?? .success(gedruckt))
            }
            let gezeigt: Bool
            if UIDevice.current.userInterfaceIdiom == .pad {
                let mitte = CGRect(x: webView.bounds.midX, y: webView.bounds.midY, width: 1, height: 1)
                gezeigt = drucker.present(from: mitte, in: webView, animated: true, completionHandler: fertig)
            } else {
                gezeigt = drucker.present(animated: true, completionHandler: fertig)
            }
            if !gezeigt { einmal.resume(.failure(Druckfehler("Der Druckdialog ließ sich nicht öffnen."))) }
        }
        return try ergebnis.get()
    }

    func startAnmeldung() throws { try anmelder.start() }

    // MARK: Push über APNs (Entwurf „iOS-Alarme über APNs“)

    /// Fragt bei Bedarf nach der Berechtigung (zeitkritisch trägt die Capability, keine eigene
    /// Option), holt das Token und legt Kennung und Schlüssel des aktiven Servers einmalig an.
    func registerPush() async throws -> PushRegistrierung {
        guard let pushablage, let server = aktiverServer() else { throw PushFehler.unavailable }
        switch await Mitteilungen.freigabe() {
        case .erlaubt: break
        case .verweigert: throw PushFehler.denied
        case .offen: guard await Mitteilungen.requestFreigabe() else { throw PushFehler.denied }
        }
        let token: Data
        do {
            token = try await Geraetetoken.anfordern()
        } catch {
            throw PushFehler.unavailable
        }
        // Eine unlesbare Ablage nicht überschreiben: sie trägt die Kennungen der anderen Server.
        guard var anmeldungen = try? pushablage.load() else { throw PushFehler.unavailable }
        let kennung = anmeldungen.kennung(fuer: server)
        let schluessel: Data
        do {
            try pushablage.save(anmeldungen)
            if let vorhanden = Schluesselbund.lesen(kennung: kennung) {
                schluessel = vorhanden
            } else {
                schluessel = Entschluesseler.neuerSchluessel()
                try Schluesselbund.speichern(kennung: kennung, schluessel: schluessel)
            }
        } catch {
            throw PushFehler.unavailable
        }
        return PushRegistrierung(
            kennung: kennung, token: token.map { String(format: "%02x", $0) }.joined(),
            umgebung: Self.umgebung, schluessel: Base64URL.encode(schluessel))
    }

    /// Nimmt Kennung und Schlüssel des aktiven Servers weg; beim Server meldet die Seite selbst ab.
    func unregisterPush() async throws {
        guard let pushablage, let server = aktiverServer() else { return }
        var anmeldungen = try pushablage.load()
        let kennungen = anmeldungen.entfernen(server: server)
        guard !kennungen.isEmpty else { return }
        try pushablage.save(anmeldungen)
        for kennung in kennungen { Schluesselbund.loeschen(kennung: kennung) }
    }

    /// Angemeldet ist der aktive Server nur mit Kennung und Schlüssel.
    func pushState() async -> (Meldungsfreigabe, kennung: String?) {
        let freigabe = await Mitteilungen.freigabe()
        guard let pushablage, let server = aktiverServer(),
            let kennung = (try? pushablage.load())?.vorhandeneKennung(fuer: server),
            Schluesselbund.lesen(kennung: kennung) != nil
        else { return (freigabe, nil) }
        return (freigabe, kennung)
    }

    /// Debug-Builds aus Xcode bekommen Token der Sandbox, TestFlight und App Store der Produktion
    /// (`aps-environment` in `App/LifelineHub.entitlements`).
    private static var umgebung: String {
        #if DEBUG
            return "sandbox"
        #else
            return "production"
        #endif
    }
}

/// Das Token von APNs: `registerForRemoteNotifications()` antwortet über den App-Delegate
/// (`AppDelegat`), nicht an der Stelle des Aufrufs. Wer wartet, steht hier; antwortet iOS nicht
/// binnen `frist`, gilt Push als nicht verfügbar statt die Anfrage der Seite hängen zu lassen.
@MainActor
enum Geraetetoken {
    static let frist: Duration = .seconds(30)
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
                if runde == diese { gescheitert(PushFehler.unavailable) }
            }
        }
    }

    static func erhalten(_ token: Data) {
        for fortsetzung in nimmWartende() { fortsetzung.resume(returning: token) }
    }

    static func gescheitert(_ fehler: any Error) {
        for fortsetzung in nimmWartende() { fortsetzung.resume(throwing: fehler) }
    }

    private static func nimmWartende() -> [CheckedContinuation<Data, any Error>] {
        let alle = wartende
        wartende = []
        return alle
    }
}

struct Druckfehler: LocalizedError {
    let errorDescription: String?
    init(_ text: String) { errorDescription = text }
}

/// UserNotifications außerhalb des Hauptakteurs; über die Grenze gehen nur Werte.
enum Mitteilungen {
    static func freigabe() async -> Meldungsfreigabe {
        switch await UNUserNotificationCenter.current().notificationSettings().authorizationStatus {
        case .notDetermined: .offen
        case .denied: .verweigert
        case .authorized, .provisional, .ephemeral: .erlaubt
        @unknown default: .verweigert
        }
    }

    static func requestFreigabe() async -> Bool {
        (try? await UNUserNotificationCenter.current().requestAuthorization(options: [
            .alert, .sound, .badge,
        ])) ?? false
    }

    static func show(title: String, body: String?) async throws {
        let inhalt = UNMutableNotificationContent()
        inhalt.title = title
        if let body { inhalt.body = body }
        inhalt.sound = .default
        let anfrage = UNNotificationRequest(
            identifier: UUID().uuidString, content: inhalt, trigger: nil)
        try await UNUserNotificationCenter.current().add(anfrage)
    }

    /// 0 nimmt die Zahl am Symbol weg.
    static func setBadge(_ count: Int) async throws {
        try await UNUserNotificationCenter.current().setBadgeCount(count)
    }
}
