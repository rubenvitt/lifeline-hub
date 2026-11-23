import Foundation
import LifelineKern
import UserNotifications

/// Notification Service Extension (Entwurf „iOS-Alarme über APNs“): öffnet die verschlüsselte
/// Nutzlast `l` mit dem Schlüssel der Kennung und setzt Titel, Untertitel, Text, Thread und die
/// Angaben für das Antippen (`kennung`, `pfad`). Dünn und ohne Netz; was angezeigt wird,
/// entscheidet `PushNutzlast` im Kern. Scheitert etwas, bleibt der Rückfalltitel des Relais
/// („Alarm“ / „Neue Benachrichtigung“) mit einem Hinweis als Text. Nie Inhalt loggen.
final class Dienst: UNNotificationServiceExtension {
    static let rueckfallText = "Öffnen, um die Meldung zu sehen"

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
        if !Self.fuelle(inhalt) { inhalt.body = Self.rueckfallText }
        beende(inhalt)
    }

    /// iOS beendet die Extension gleich: der Rückfall statt nichts.
    override func serviceExtensionTimeWillExpire() {
        guard let inhalt else { return }
        inhalt.body = Self.rueckfallText
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
            let umschlag = PushNutzlast.umschlag(l),
            let schluessel = Schluesselbund.lesen(kennung: umschlag.kennung),
            let klartext = Entschluesseler.oeffnen(umschlag, schluessel: schluessel),
            let meldung = PushNutzlast.meldung(
                aus: klartext, serverAnzahl: AppGroup.defaults?.integer(forKey: AppGroup.serverAnzahl) ?? 0,
                kennung: umschlag.kennung)
        else { return false }
        inhalt.title = meldung.titel
        inhalt.subtitle = meldung.untertitel ?? ""
        inhalt.body = meldung.text ?? ""
        inhalt.threadIdentifier = meldung.thread
        var angaben = inhalt.userInfo
        angaben["kennung"] = umschlag.kennung
        angaben["pfad"] = meldung.pfad
        inhalt.userInfo = angaben
        return true
    }
}
