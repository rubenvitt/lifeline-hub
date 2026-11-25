/// Phase der einen Anmeldung dieses Geräts (Spec „Die Helfer-App“, „Logik im Kern“):
/// `start` → `anmelden` → `unbestaetigt` → `aktiv` ⇄ `pausiert` → `beendet`; `aktiv` ⇄ `ruht`,
/// solange die Kopplung besteht, aber nicht orten darf.
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
    /// Bestätigt, aber ohne Ortung (`Ruhegrund`): Bildschirm „Angemeldet – Ortung ruht“. Der
    /// Dienst ist aus, Kopplung und Sitzung bleiben; die App prüft alle `Ruhegrund.pruefabstandS`
    /// Sekunden.
    case ruht(Ruhegrund)
    /// Die Anmeldung ist vorbei: Bildschirm „Beendet“ mit Grund.
    case beendet(Grund)

    /// Ob der Ortungsdienst läuft: ab dem Einlösen, solange die Kopplung besteht und nicht
    /// pausiert ist (ADR-0098).
    public var ortet: Bool {
        switch self {
        case .unbestaetigt, .aktiv: true
        case .start, .anmelden, .pausiert, .ruht, .beendet: false
        }
    }

    /// Ob eine Kopplung am Server besteht (eingelöst und nicht beendet).
    public var gekoppelt: Bool {
        switch self {
        case .unbestaetigt, .aktiv, .pausiert, .ruht: true
        case .start, .anmelden, .beendet: false
        }
    }
}

/// Was die Leitung dem Gerät beim Bestätigen gegeben hat (`is_tracker`, `person` aus
/// `GET /api/devices/me`): ohne beides sendet die App nichts (Entscheidung 7 der Spec).
public struct Rolle: Equatable, Sendable {
    public let isTracker: Bool
    public let personId: Int64?

    public init(isTracker: Bool, personId: Int64?) {
        self.isTracker = isTracker
        self.personId = personId
    }

    public var darfOrten: Bool { isTracker || personId != nil }
}

/// Was der Anmeldung widerfährt; die App meldet es, der Automat entscheidet die neue Phase.
public enum Ereignis: Equatable, Sendable {
    /// QR-Code gescannt, Deeplink geöffnet oder Code eingegeben.
    case gescannt(HelferZiel)
    /// `POST /api/devices/helpers/redeem` war erfolgreich.
    case eingeloest
    /// Die Leitung hat bestätigt (Live-Ereignis).
    case bestaetigt
    /// Antwort des Servers auf eine Sendung (`entscheide(status:grund:)`) mit `reason` des
    /// Fehler-Bodys.
    case antwort(Antwort, grund: String? = nil)
    /// Die Kraft hat pausiert.
    case pausiert
    /// Die Kraft hat fortgesetzt (nur in der geöffneten App).
    case fortgesetzt
    /// Die Kraft hat sich abgemeldet oder das Warten abgebrochen.
    case abgemeldet
    /// Eigener Zustand vom Server (`GET /api/devices/me` oder Live): `state` und `reason` als
    /// Wire-Werte (`unbestaetigt`, `aktiv`, `abgelehnt`, `beendet`; `Grund.init?(wire:)`) und
    /// die `Rolle`.
    case zustand(String, grund: String?, rolle: Rolle)
}

/// Zustandsautomat der Anmeldung. Ein Ereignis, das in der Phase keinen Sinn hat, ändert nichts.
public struct Anmeldung: Equatable, Sendable {
    public private(set) var phase: Phase
    /// Zuletzt vom Server genannte Rolle.
    private var rolle: Rolle?
    /// Rolle, mit der `.ruht(.keineRolle)` gilt (beim Eintritt und jede spätere ohne Ortung):
    /// erst eine andere Rolle, die orten darf, beendet die Ruhe. Sonst begänne die App bei einer
    /// Person ohne Personenortung der Organisation nach jeder Abfrage neu zu senden und bekäme
    /// wieder 403.
    private var rolleBeimRuhen: Rolle?

    public init(phase: Phase = .start) {
        self.phase = phase
    }

    public mutating func verarbeite(_ ereignis: Ereignis) {
        var ohneOrtung = false
        if case .zustand(_, _, let neueRolle) = ereignis {
            rolle = neueRolle
            ohneOrtung = !neueRolle.darfOrten
        }
        let vorher = phase
        if let neu = folge(auf: ereignis, in: vorher) { phase = neu }
        if phase == .ruht(.keineRolle), vorher != phase || ohneOrtung { rolleBeimRuhen = rolle }
    }

    /// Neue Phase oder `nil`, wenn das Ereignis in dieser Phase nichts bewirkt.
    private func folge(auf ereignis: Ereignis, in phase: Phase) -> Phase? {
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
        case (.antwort(let antwort, let grund), _) where phase.gekoppelt:
            return Self.folge(auf: antwort, grund: grund, in: phase)
        case (.pausiert, .aktiv):
            return .pausiert
        case (.fortgesetzt, .pausiert):
            return .aktiv
        case (.abgemeldet, .anmelden):
            return .start
        case (.abgemeldet, _) where phase.gekoppelt:
            return .beendet(.abgemeldet)
        case (.zustand(let state, let grund, let rolle), _):
            return folge(aufZustand: state, grund: grund, rolle: rolle, in: phase)
        default:
            return nil
        }
    }

    private static func folge(auf antwort: Antwort, grund: String?, in phase: Phase) -> Phase? {
        let ruht: Bool
        if case .ruht = phase { ruht = true } else { ruht = false }
        switch antwort {
        // Die Sitzung ist weg; den genauen Grund kennt das Gerät aus der Antwort nicht.
        case .stoppen: return .beendet(.entfernt)
        // Die Kopplung bleibt; eine eigene Pause bleibt Pause.
        case .ruhen:
            guard phase != .pausiert, let ruhegrund = Ruhegrund(wire: grund) else { return nil }
            return .ruht(ruhegrund)
        // Die erste angenommene Position heißt: die Leitung hat bestätigt. Aus der Ruhe heißt ein
        // angenommenes Fortsetzen: die Ortung ist wieder an.
        case .weiter: return phase == .unbestaetigt || ruht ? .aktiv : nil
        case .warten: return ruht ? .unbestaetigt : nil
        case .wiederholen, .verwerfen: return nil
        }
    }

    /// Eigener Zustand vom Server. Vor dem Einlösen gibt es keinen; nach dem Ende bleibt es beim
    /// Ende. Ein unbekannter Wert ändert nichts.
    ///
    /// `aktiv` ohne Rolle, die orten darf, ruht (`.keineRolle`). Aus der Ruhe `.ortungAus` führt
    /// der Zustand nicht: er nennt die Einstellung der Organisation nicht, das entscheidet die
    /// Antwort auf das Fortsetzen (`Ruhegrund.pruefeMitFortsetzen`).
    private func folge(aufZustand state: String, grund: String?, rolle: Rolle, in phase: Phase)
        -> Phase?
    {
        switch phase {
        case .anmelden, .beendet: return nil
        case .start, .unbestaetigt, .aktiv, .pausiert, .ruht: break
        }
        let ortungAus = phase == .ruht(.ortungAus)
        switch state {
        case "unbestaetigt": return phase == .unbestaetigt || ortungAus ? nil : .unbestaetigt
        case "aktiv":
            if phase == .pausiert || ortungAus { return nil }
            if !rolle.darfOrten { return .ruht(.keineRolle) }
            if phase == .ruht(.keineRolle) { return rolle == rolleBeimRuhen ? nil : .aktiv }
            return phase == .aktiv ? nil : .aktiv
        case "abgelehnt": return .beendet(.abgelehnt)
        case "beendet": return .beendet(grund.flatMap(Grund.init(wire:)) ?? .entfernt)
        default: return nil
        }
    }
}
