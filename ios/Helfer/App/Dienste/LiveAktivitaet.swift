import ActivityKit
import Foundation

/// Die Live-Aktivität der Ortung (ADR-0101: die Ortung ist sichtbar). Gestartet nur aus dem
/// Vordergrund zusammen mit der Ortung, geändert bei jeder angenommenen Sendung und jeder Pause,
/// beendet mit der Ortung (`Antwort.stoppen`, Abmelden, Ende der Kopplung).
///
/// Wird die App beendet, endet die Ortung, die Aktivität aber nicht sofort; sie trägt deshalb ein
/// Verfallsdatum, nach dem sie „unterbrochen“ zeigt, und die App räumt beim Start jede alte ab.
@MainActor
final class LiveAktivitaet {
    /// Nach dieser Zeit ohne Änderung gilt die Anzeige als veraltet (zwei Lebenszeichen).
    static let verfallS: TimeInterval = 600

    /// Nur die Kennung: `Activity` ist nicht `Sendable`; wer sie ändert, holt sie frisch aus
    /// `Activity.activities` (Swift 6, „sending … risks causing data races“).
    private var aktivitaetID: String?
    private var attribute: OrtungAttribute?

    /// Beendet jede Aktivität eines früheren Laufs der App.
    func beendeAlte() async {
        for alte in Activity<OrtungAttribute>.activities where alte.id != aktivitaetID {
            await alte.end(nil, dismissalPolicy: .immediate)
        }
    }

    func starte(_ attribute: OrtungAttribute, zustand: OrtungAttribute.ContentState) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        if let aktivitaetID, self.attribute == attribute {
            let inhalt = Self.inhalt(zustand)
            Task { await Self.aendere(aktivitaetID, inhalt: inhalt) }
            return
        }
        beende()
        do {
            aktivitaetID = try Activity<OrtungAttribute>.request(
                attributes: attribute, content: Self.inhalt(zustand), pushType: nil
            ).id
            self.attribute = attribute
        } catch {
            aktivitaetID = nil
            self.attribute = nil
        }
    }

    func aktualisiere(_ zustand: OrtungAttribute.ContentState) {
        guard let aktivitaetID else { return }
        let inhalt = Self.inhalt(zustand)
        Task { await Self.aendere(aktivitaetID, inhalt: inhalt) }
    }

    func beende() {
        guard let aktivitaetID else { return }
        self.aktivitaetID = nil
        attribute = nil
        Task { await Self.aendere(aktivitaetID, inhalt: nil) }
    }

    /// Ändert (`inhalt`) oder beendet (`nil`) die Aktivität mit dieser Kennung, falls es sie noch gibt.
    private nonisolated static func aendere(
        _ id: String, inhalt: ActivityContent<OrtungAttribute.ContentState>?
    ) async {
        guard let aktivitaet = Activity<OrtungAttribute>.activities.first(where: { $0.id == id })
        else { return }
        if let inhalt {
            await aktivitaet.update(inhalt)
        } else {
            await aktivitaet.end(nil, dismissalPolicy: .immediate)
        }
    }

    private static func inhalt(_ zustand: OrtungAttribute.ContentState)
        -> ActivityContent<OrtungAttribute.ContentState>
    {
        // Pausiert ändert sich nichts mehr: kein Verfall.
        let verfall = zustand.pausiert ? nil : Date().addingTimeInterval(verfallS)
        return ActivityContent(state: zustand, staleDate: verfall)
    }
}
