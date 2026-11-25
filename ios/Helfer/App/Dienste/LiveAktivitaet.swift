import ActivityKit
import Foundation

/// Die Live-Aktivität der Ortung (ADR-0098: die Ortung ist sichtbar). Gestartet nur aus dem
/// Vordergrund zusammen mit der Ortung, geändert bei jeder angenommenen Sendung und jeder Pause,
/// beendet mit der Ortung (`Antwort.stoppen`, Abmelden, Ende der Kopplung).
///
/// Wird die App beendet, endet die Ortung, die Aktivität aber nicht sofort; sie trägt deshalb ein
/// Verfallsdatum, nach dem sie „unterbrochen“ zeigt, und die App räumt beim Start jede alte ab.
@MainActor
final class LiveAktivitaet {
    /// Nach dieser Zeit ohne Änderung gilt die Anzeige als veraltet (zwei Lebenszeichen).
    static let verfallS: TimeInterval = 600

    private var aktivitaet: Activity<OrtungAttribute>?
    private var attribute: OrtungAttribute?

    /// Beendet jede Aktivität eines früheren Laufs der App.
    func beendeAlte() async {
        for alte in Activity<OrtungAttribute>.activities where alte.id != aktivitaet?.id {
            await alte.end(nil, dismissalPolicy: .immediate)
        }
    }

    func starte(_ attribute: OrtungAttribute, zustand: OrtungAttribute.ContentState) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        if let aktivitaet, self.attribute == attribute {
            let laufend = aktivitaet
            Task { await laufend.update(Self.inhalt(zustand)) }
            return
        }
        beende()
        do {
            aktivitaet = try Activity<OrtungAttribute>.request(
                attributes: attribute, content: Self.inhalt(zustand), pushType: nil)
            self.attribute = attribute
        } catch {
            aktivitaet = nil
            self.attribute = nil
        }
    }

    func aktualisiere(_ zustand: OrtungAttribute.ContentState) {
        guard let aktivitaet else { return }
        Task { await aktivitaet.update(Self.inhalt(zustand)) }
    }

    func beende() {
        guard let aktivitaet else { return }
        self.aktivitaet = nil
        attribute = nil
        Task { await aktivitaet.end(nil, dismissalPolicy: .immediate) }
    }

    private static func inhalt(_ zustand: OrtungAttribute.ContentState)
        -> ActivityContent<OrtungAttribute.ContentState>
    {
        // Pausiert ändert sich nichts mehr: kein Verfall.
        let verfall = zustand.pausiert ? nil : Date().addingTimeInterval(verfallS)
        return ActivityContent(state: zustand, staleDate: verfall)
    }
}
