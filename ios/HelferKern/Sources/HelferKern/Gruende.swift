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

/// Warum eine bestätigte Kopplung gerade nicht ortet (403 einer Sendung mit `reason`,
/// `src/routes/helfer.rs`, `position_senden`): Kopplung und Sitzung bleiben, die App zeigt
/// „Angemeldet – Ortung ruht“ mit `text` und prüft alle `pruefabstandS` Sekunden, ob sie weiter
/// orten darf (`Phase.ruht`; Gegenstück `Ruhegrund` in `android/helferkern`).
public enum Ruhegrund: String, Sendable, CaseIterable {
    /// Weder Ortungsgerät des Ziels noch eine Person mit Personenortung.
    case keineRolle
    /// „Ortung im Einsatz“ der Organisation ist aus.
    case ortungAus

    /// Überschrift der Seite „Angemeldet“ während der Ruhe.
    public static let titel = "Angemeldet – Ortung ruht"

    /// Abstand der Prüfung während der Ruhe.
    public static let pruefabstandS: Double = 60

    /// Grund aus `reason` eines 403; `nil` für jeden anderen Wert.
    public init?(wire: String?) {
        switch wire {
        case "no_role": self = .keineRolle
        case "tracking_off": self = .ortungAus
        default: return nil
        }
    }

    public var wire: String {
        switch self {
        case .keineRolle: "no_role"
        case .ortungAus: "tracking_off"
        }
    }

    /// Erklärung unter der Überschrift.
    public var text: String {
        switch self {
        case .keineRolle:
            "Die Einsatzleitung hat dich ohne Ortung angemeldet: dieses Gerät ortet weder deine "
                + "Einheit oder dein Fahrzeug noch dich als Person. Ändert sie das, ortet die App "
                + "von selbst weiter."
        case .ortungAus:
            "Die Ortung ist für diese Organisation gerade ausgeschaltet. Wird sie wieder "
                + "eingeschaltet, ortet die App von selbst weiter."
        }
    }

    /// Ob die App in der Ruhe mit `{paused: false}` prüft, ob sie wieder orten darf: `GET
    /// /api/devices/me` nennt die Einstellung der Organisation nicht, das Fortsetzen antwortet 403
    /// `tracking_off`, solange sie aus ist, und braucht keine Position.
    public var pruefeMitFortsetzen: Bool { self == .ortungAus }
}
