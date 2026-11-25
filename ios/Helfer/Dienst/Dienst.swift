import Foundation
import HelferKern
import LifelineKern
import UserNotifications

/// Mitteilungsdienst der Helfer-App (Notification Service Extension, ADR-0106): öffnet die
/// verschlüsselte Nutzlast `l` eines Auftrags mit dem Schlüssel der Kennung und setzt Titel,
/// Text, Thread, Ton und Zeitkritik, dazu `task_id` für das Antippen. Dünn wie
/// `ios/Benachrichtigungsdienst/Dienst.swift`: kein Netz, keine Ablage; was angezeigt wird,
/// entscheidet `PagerNutzlast` im Kern. Scheitert etwas, bleibt der Rückfalltitel des Relais mit
/// einem Hinweis als Text. Nie Inhalt loggen.
final class Dienst: UNNotificationServiceExtension {
    private var abschluss: ((UNNotificationContent) -> Void)?
    private var inhalt: UNMutableNotificationContent?

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        guard let inhalt = request.content.mutableCopy() as? UNMutableNotificationContent else {
            contentHandler(request.content)
            return
        }
        abschluss = contentHandler
        self.inhalt = inhalt
        // Alles hier ist synchron und kurz (Schlüsselbund, AES-GCM); kein Netz.
        if !Self.fuelle(inhalt) { inhalt.body = AuftragAnzeige.rueckfall }
        beende(inhalt)
    }

    /// iOS beendet die Extension gleich: der Rückfall statt nichts.
    override func serviceExtensionTimeWillExpire() {
        guard let inhalt else { return }
        inhalt.body = AuftragAnzeige.rueckfall
        beende(inhalt)
    }

    /// Genau einmal abschließen, auch wenn die Frist während der Arbeit abläuft.
    private func beende(_ inhalt: UNMutableNotificationContent) {
        let abschluss = self.abschluss
        self.abschluss = nil
        self.inhalt = nil
        abschluss?(inhalt)
    }

    /// `true`, wenn die Meldung entschlüsselt und gesetzt ist.
    private static func fuelle(_ inhalt: UNMutableNotificationContent) -> Bool {
        guard let l = inhalt.userInfo["l"] as? String,
            let umschlag = PagerNutzlast.umschlag(l),
            let schluessel = Schluesselbund.lesen(kennung: umschlag.kennung),
            let klartext = Entschluesseler.oeffnen(umschlag, schluessel: schluessel),
            let meldung = PagerNutzlast.meldung(aus: klartext)
        else { return false }
        inhalt.title = meldung.titel
        inhalt.body = meldung.text
        inhalt.threadIdentifier = meldung.thread
        inhalt.sound = .default
        inhalt.interruptionLevel = .timeSensitive
        var angaben = inhalt.userInfo
        angaben["task_id"] = NSNumber(value: meldung.auftragId)
        angaben["incident_id"] = NSNumber(value: meldung.einsatzId)
        inhalt.userInfo = angaben
        return true
    }
}
