/// Phase der einen Anmeldung dieses Geräts (Spec „Die Helfer-App“, „Logik im Kern“):
/// `start` → `anmelden` → `unbestaetigt` → `aktiv` ⇄ `pausiert` → `beendet`.
public enum Phase: Equatable, Sendable {
    /// Keine Anmeldung: Bildschirm „Start“ (scannen oder Code eingeben).
    case start
    /// Einladung gelesen, noch nicht eingelöst: Bildschirm „Anmelden“.
    case anmelden(HelferZiel)
    /// Eingelöst, die Leitung hat noch nicht bestätigt (Wire `unbestaetigt`): Bildschirm „Wartet“.
    case unbestaetigt
    /// Bestätigt: Bildschirm „Angemeldet“, die Ortung läuft.
    case aktiv
    /// Die Kraft hat die Ortung pausiert.
    case pausiert
    /// Die Anmeldung ist vorbei: Bildschirm „Beendet“ mit Grund.
    case beendet(Grund)

    /// Ob der Ortungsdienst läuft: ab dem Einlösen, solange die Kopplung besteht und nicht
    /// pausiert ist (ADR-0098).
    public var ortet: Bool {
        switch self {
        case .unbestaetigt, .aktiv: true
        case .start, .anmelden, .pausiert, .beendet: false
        }
    }

    /// Ob eine Kopplung am Server besteht (eingelöst und nicht beendet).
    public var gekoppelt: Bool {
        switch self {
        case .unbestaetigt, .aktiv, .pausiert: true
        case .start, .anmelden, .beendet: false
        }
    }
}

/// Was der Anmeldung widerfährt; die App meldet es, der Automat entscheidet die neue Phase.
public enum Ereignis: Equatable, Sendable {
    /// QR-Code gescannt, Deeplink geöffnet oder Code eingegeben.
    case gescannt(HelferZiel)
    /// `POST /api/devices/helpers/redeem` war erfolgreich.
    case eingeloest
    /// Die Leitung hat bestätigt (Live-Ereignis).
    case bestaetigt
    /// Antwort des Servers auf eine Sendung (`entscheide(status:)`).
    case antwort(Antwort)
    /// Die Kraft hat pausiert.
    case pausiert
    /// Die Kraft hat fortgesetzt (nur in der geöffneten App).
    case fortgesetzt
    /// Die Kraft hat sich abgemeldet oder das Warten abgebrochen.
    case abgemeldet
    /// Eigener Zustand vom Server (`GET /api/devices/me` oder Live): `state` und `reason` als
    /// Wire-Werte (`unbestaetigt`, `aktiv`, `abgelehnt`, `beendet`; `Grund.init?(wire:)`).
    case zustand(String, grund: String?)
}

/// Zustandsautomat der Anmeldung. Ein Ereignis, das in der Phase keinen Sinn hat, ändert nichts.
public struct Anmeldung: Equatable, Sendable {
    public private(set) var phase: Phase

    public init(phase: Phase = .start) {
        self.phase = phase
    }

    public mutating func verarbeite(_ ereignis: Ereignis) {
        if let neu = Self.folge(auf: ereignis, in: phase) { phase = neu }
    }

    /// Neue Phase oder `nil`, wenn das Ereignis in dieser Phase nichts bewirkt.
    private static func folge(auf ereignis: Ereignis, in phase: Phase) -> Phase? {
        switch (ereignis, phase) {
        // Ein neuer Scan gilt nur ohne Kopplung; während einer Anmeldung fragt die App erst, ob
        // die alte beendet werden soll, und meldet dann `abgemeldet`.
        case (.gescannt(let ziel), .start), (.gescannt(let ziel), .anmelden),
            (.gescannt(let ziel), .beendet):
            return .anmelden(ziel)
        case (.eingeloest, .anmelden):
            return .unbestaetigt
        case (.bestaetigt, .unbestaetigt):
            return .aktiv
        case (.antwort(let antwort), _) where phase.gekoppelt:
            return folge(auf: antwort, in: phase)
        case (.pausiert, .aktiv):
            return .pausiert
        case (.fortgesetzt, .pausiert):
            return .aktiv
        case (.abgemeldet, .anmelden):
            return .start
        case (.abgemeldet, _) where phase.gekoppelt:
            return .beendet(.abgemeldet)
        case (.zustand(let state, let grund), _):
            return folge(aufZustand: state, grund: grund, in: phase)
        default:
            return nil
        }
    }

    private static func folge(auf antwort: Antwort, in phase: Phase) -> Phase? {
        switch antwort {
        // Die Sitzung ist weg; den genauen Grund kennt das Gerät aus der Antwort nicht.
        case .stoppen: .beendet(.entfernt)
        // Die erste angenommene Position heißt: die Leitung hat bestätigt.
        case .weiter: phase == .unbestaetigt ? .aktiv : nil
        case .warten, .wiederholen, .verwerfen: nil
        }
    }

    /// Eigener Zustand vom Server. Vor dem Einlösen gibt es keinen; nach dem Ende bleibt es beim
    /// Ende. Ein unbekannter Wert ändert nichts.
    private static func folge(aufZustand state: String, grund: String?, in phase: Phase) -> Phase? {
        switch phase {
        case .anmelden, .beendet: return nil
        case .start, .unbestaetigt, .aktiv, .pausiert: break
        }
        switch state {
        case "unbestaetigt": return phase == .unbestaetigt ? nil : .unbestaetigt
        case "aktiv": return phase == .aktiv || phase == .pausiert ? nil : .aktiv
        case "abgelehnt": return .beendet(.abgelehnt)
        case "beendet": return .beendet(grund.flatMap(Grund.init(wire:)) ?? .entfernt)
        default: return nil
        }
    }
}
