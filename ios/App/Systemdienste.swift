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

    init(webView: @escaping @MainActor () -> WKWebView?, anmelder: Anmelder) {
        self.webView = webView
        self.anmelder = anmelder
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

    // Push über APNs: die Anbindung an APNs und den Schlüsselbund folgt mit der Extension (Aufgabe
    // 10); bis dahin meldet die Hülle ehrlich „nicht verfügbar“.
    func registerPush() async throws -> PushRegistrierung { throw PushFehler.unavailable }

    func unregisterPush() async throws {}

    func pushState() async -> (Meldungsfreigabe, kennung: String?) {
        (await Mitteilungen.freigabe(), nil)
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
