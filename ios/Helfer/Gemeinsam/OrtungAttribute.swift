import ActivityKit
import Foundation

/// Live-Aktivität der laufenden Ortung (ADR-0101: die Ortung ist sichtbar) auf Sperrbildschirm
/// und Dynamic Island: Einsatz und Ziel fest, letzte Sendung und Pause im Zustand. Gemeinsam mit
/// der Widget-Erweiterung; die App startet, ändert und beendet sie (`LiveAktivitaet`).
struct OrtungAttribute: ActivityAttributes, Hashable {
    struct ContentState: Codable, Hashable, Sendable {
        /// Zeitpunkt der letzten angenommenen Sendung; `nil` vor der ersten.
        var letzteSendung: Date?
        /// Die Kraft hat pausiert.
        var pausiert: Bool
        /// Die Einsatzleitung hat noch nicht bestätigt (Wire `unbestaetigt`).
        var wartet: Bool
    }

    /// Name des Einsatzes.
    var einsatz: String
    /// Name der Einheit bzw. Funkrufname des Fahrzeugs.
    var ziel: String
}
