/// Ablauf des Onboardings als reine Zustandsfunktion (Spec `ios-huelle`, „Ohne Server zeigt die
/// App nur das Onboarding“): Adresse eingeben oder vorbelegen → prüfen → nur ein verträglicher
/// Server wird gespeichert. Die App führt die Wirkungen aus (`check`: `GET /api/shell` und
/// `Vertragspruefung`, `save`: Serverliste) und meldet das Ergebnis als Ereignis zurück.
public enum Onboarding {
    public enum State: Equatable, Sendable {
        /// Eingabefeld mit Text und ggf. der Meldung der Adressprüfung.
        case eingabe(text: String, meldung: String?)
        /// `GET /api/shell` läuft.
        case pruefung(ServerAdresse)
        /// Gespeichert; die App lädt die Oberfläche.
        case verbunden(ServerAdresse, ShellInfo)
        /// Nicht gespeichert; die native Seite zeigt die Fehlerklasse des Ergebnisses.
        case abgelehnt(ServerAdresse, Vertragsergebnis)

        public static let start = State.eingabe(text: "", meldung: nil)
    }

    public enum Event: Equatable, Sendable {
        case textChanged(String)
        /// QR-Code oder Deeplink: die Adresse steht im Feld, geprüft wird erst nach „Verbinden“.
        case vorbelegen(ServerAdresse)
        case verbinden
        case zurueck
        case ergebnis(Vertragsergebnis, fuer: ServerAdresse)
    }

    public enum Effect: Equatable, Sendable {
        case check(ServerAdresse)
        case save(ServerAdresse, ShellInfo)
    }

    public struct Step: Equatable, Sendable {
        public let state: State
        public let effect: Effect?
    }

    public static func next(_ state: State, _ event: Event) -> Step {
        switch (state, event) {
        case (.verbunden, _):
            return Step(state: state, effect: nil)
        case (_, .textChanged(let text)) where !isPruefung(state):
            return Step(state: .eingabe(text: text, meldung: nil), effect: nil)
        case (_, .vorbelegen(let adresse)) where !isPruefung(state):
            return Step(state: .eingabe(text: adresse.text, meldung: nil), effect: nil)
        case (.eingabe(let text, _), .verbinden):
            do {
                let adresse = try ServerAdresse.parse(text)
                return Step(state: .pruefung(adresse), effect: .check(adresse))
            } catch {
                return Step(state: .eingabe(text: text, meldung: error.meldung), effect: nil)
            }
        case (.abgelehnt(let adresse, _), .verbinden):
            return Step(state: .pruefung(adresse), effect: .check(adresse))
        case (.pruefung(let adresse), .zurueck), (.abgelehnt(let adresse, _), .zurueck):
            return Step(state: .eingabe(text: adresse.text, meldung: nil), effect: nil)
        case (.pruefung(let adresse), .ergebnis(let ergebnis, let fuer)) where fuer == adresse:
            if case .vertraeglich(let info) = ergebnis {
                return Step(state: .verbunden(adresse, info), effect: .save(adresse, info))
            }
            return Step(state: .abgelehnt(adresse, ergebnis), effect: nil)
        default:
            return Step(state: state, effect: nil)
        }
    }

    private static func isPruefung(_ state: State) -> Bool {
        if case .pruefung = state { return true }
        return false
    }
}
