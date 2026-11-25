/// Warum eine Anmeldung endete; die App zeigt den Text auf dem Bildschirm „Beendet“ (Spec „Die
/// Helfer-App“, Bildschirm 5).
public enum Grund: String, Sendable, CaseIterable {
    case einsatzBeendet
    case entfernt
    case abgelaufen
    case abgelehnt
    case abgemeldet

    /// Grund aus `reason` des Servers (`HelferEndeGrund` in `src/helfer/anmeldung.rs`); `nil` für
    /// einen unbekannten Wert.
    public init?(wire: String) {
        switch wire {
        case "incident_closed": self = .einsatzBeendet
        case "revoked": self = .entfernt
        case "expired": self = .abgelaufen
        case "rejected": self = .abgelehnt
        case "signed_out": self = .abgemeldet
        default: return nil
        }
    }

    /// Wire-Wert von `reason` (Gegenstück zu `init?(wire:)`).
    public var wire: String {
        switch self {
        case .einsatzBeendet: "incident_closed"
        case .entfernt: "revoked"
        case .abgelaufen: "expired"
        case .abgelehnt: "rejected"
        case .abgemeldet: "signed_out"
        }
    }

    /// Überschrift auf dem Bildschirm „Beendet“.
    public var titel: String {
        switch self {
        case .einsatzBeendet: "Einsatz beendet"
        case .entfernt: "Abgemeldet durch die Einsatzleitung"
        case .abgelaufen: "Anmeldung abgelaufen"
        case .abgelehnt: "Anmeldung abgelehnt"
        case .abgemeldet: "Abgemeldet"
        }
    }

    /// Erklärung unter der Überschrift.
    public var text: String {
        switch self {
        case .einsatzBeendet: "Der Einsatz ist beendet. Die Ortung ist aus."
        case .entfernt: "Die Einsatzleitung hat dich entfernt. Die Ortung ist aus."
        case .abgelaufen: "Die Anmeldung ist abgelaufen. Die Ortung ist aus."
        case .abgelehnt: "Die Einsatzleitung hat die Anmeldung abgelehnt. Die Ortung ist aus."
        case .abgemeldet: "Du hast dich abgemeldet. Die Ortung ist aus."
        }
    }
}
