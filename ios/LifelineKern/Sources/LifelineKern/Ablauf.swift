import Foundation

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

/// Native Status-Seite der Hülle (Entwurf D2a, D4, D6). Die Seite „kein Server“ ist das
/// Onboarding.
public enum Statusseite: Equatable, Sendable {
    /// Das System vertraut dem Zertifikat nicht; Anleitung zum CA-Profil.
    case zertifikat
    /// Keine Verbindung; die App prüft weiter und lädt von selbst.
    case nichtErreichbar
    /// `zuAlt` oder `zuNeu` mit der Version des Servers, soweit bekannt.
    case nichtVertraeglich(Fehlerklasse, serverVersion: String?)

    /// `nil` für einen verträglichen Server. Die Version aus `/api/shell` geht vor der aus
    /// `/api/health` (die nur ein Server ohne Vertrag braucht).
    public init?(_ ergebnis: Vertragsergebnis, healthVersion: String?) {
        switch ergebnis {
        case .vertraeglich: return nil
        case .nichtErreichbar(.zertifikat): self = .zertifikat
        case .nichtErreichbar: self = .nichtErreichbar
        case .nichtVertraeglich(let richtung, let server):
            self = .nichtVertraeglich(richtung, serverVersion: server?.version ?? healthVersion)
        }
    }
}

/// Welche Seite die App zeigt und was sie dafür tut, als reine Zustandsfunktion (Spec
/// `ios-huelle`, „Die App lädt nur einen verträglichen Server“, „Zertifikatsfehler und
/// Unerreichbarkeit haben eigene Seiten“, „Nach einem Abbruch des Web-Prozesses lädt die App
/// neu“). Die App führt die Wirkungen aus und meldet Ergebnisse als Ereignis zurück.
public enum Ablauf {
    /// Abstand der Prüfungen auf der Seite „nicht erreichbar“.
    public static let wiederholIntervall: Duration = .seconds(5)

    public enum Seite: Equatable, Sendable {
        /// Kein Server gespeichert.
        case onboarding
        /// `GET /api/shell` läuft; noch nichts geladen.
        case pruefung(ServerEintrag)
        /// Die Oberfläche des Servers im Webview.
        case web(ServerEintrag, vertrag: Int)
        case status(ServerEintrag, Statusseite)

        /// Der Server der Seite; `nil` im Onboarding.
        public var eintrag: ServerEintrag? {
            switch self {
            case .onboarding: nil
            case .pruefung(let e), .web(let e, _), .status(let e, _): e
            }
        }
    }

    public enum Event: Equatable, Sendable {
        /// Start der App mit dem aktiven Server der Liste.
        case start(aktiv: ServerEintrag?)
        /// Wechsel in der Serverliste oder nach bestätigtem Deeplink.
        case wechseln(ServerEintrag)
        /// Das Onboarding hat den Server geprüft und gespeichert.
        case verbunden(ServerEintrag, ShellInfo)
        /// Rückkehr in den Vordergrund; die App hat vorher gefragt, ob die Seite noch antwortet.
        case vordergrund(seiteAntwortet: Bool)
        /// Ergebnis von `check`; `healthVersion` nur für einen Server ohne Vertrag.
        case ergebnis(Vertragsergebnis, healthVersion: String?, fuer: UUID)
        /// Zeitgeber der Seite „nicht erreichbar“.
        case wiederholen
        /// `didFailProvisionalNavigation` mit dem Fehlercode und der Adresse, die scheiterte.
        case navigationFehlgeschlagen(URLError.Code, url: URL?)
        /// `webViewWebContentProcessDidTerminate`.
        case webProzessBeendet
    }

    public enum Effect: Equatable, Sendable {
        /// `GET /api/shell` (bei 404 dazu `GET /api/health`) und `Vertragspruefung`.
        case check(ServerEintrag)
        /// Webview mit dem Datenspeicher des Eintrags bauen und die Adresse laden.
        case load(ServerEintrag)
        case reload
        case markVerbunden(UUID, vertrag: Int)
        /// Nach `wiederholIntervall` `wiederholen` melden.
        case scheduleRetry
    }

    public struct Step: Equatable, Sendable {
        public let seite: Seite
        public let effects: [Effect]

        init(_ seite: Seite, _ effects: [Effect] = []) {
            self.seite = seite
            self.effects = effects
        }
    }

    public static func next(_ seite: Seite, _ event: Event) -> Step {
        switch (seite, event) {
        case (_, .start(nil)):
            return Step(.onboarding)
        case (_, .start(let eintrag?)), (_, .wechseln(let eintrag)):
            return Step(.pruefung(eintrag), [.check(eintrag)])
        case (_, .verbunden(let eintrag, let info)):
            return loaded(eintrag, info)

        case (.web(let eintrag, _), .vordergrund(seiteAntwortet: true)):
            // Erst prüfen, ob der Server inzwischen einen anderen Vertrag spricht.
            return Step(seite, [.check(eintrag)])
        case (.web(let eintrag, _), .vordergrund(seiteAntwortet: false)):
            return Step(.pruefung(eintrag), [.check(eintrag)])
        case (.status(let eintrag, _), .vordergrund):
            return Step(seite, [.check(eintrag)])
        case (.status(let eintrag, .nichtErreichbar), .wiederholen):
            return Step(seite, [.check(eintrag)])

        case (_, .ergebnis(let ergebnis, let healthVersion, let id)):
            guard let eintrag = seite.eintrag, eintrag.id == id else { return Step(seite) }
            return result(seite, eintrag, ergebnis, healthVersion: healthVersion)

        case (.web(let eintrag, _), .navigationFehlgeschlagen(let code, let url)):
            // Nur Fehler des Servers selbst; der Identitätsanbieter zeigt seine eigenen.
            if let url, !Linkregeln.belongsToServer(eintrag.adresse.url, seite: url) {
                return Step(seite)
            }
            guard let klasse = Fehlerklasse(navigation: code) else { return Step(seite) }
            return status(eintrag, klasse == .zertifikat ? .zertifikat : .nichtErreichbar)
        case (.web, .webProzessBeendet):
            return Step(seite, [.reload])
        default:
            return Step(seite)
        }
    }

    private static func result(
        _ seite: Seite, _ eintrag: ServerEintrag, _ ergebnis: Vertragsergebnis,
        healthVersion: String?
    ) -> Step {
        let geladen: Bool
        if case .web = seite { geladen = true } else { geladen = false }
        switch ergebnis {
        case .vertraeglich(let info):
            if geladen {
                return Step(.web(eintrag, vertrag: info.shellContract), [
                    .markVerbunden(eintrag.id, vertrag: info.shellContract)
                ])
            }
            return loaded(eintrag, info)
        case .nichtErreichbar where geladen:
            // Die geladene Oberfläche arbeitet ohne Netz weiter (Schreib-Queue, Lagebild aus
            // IndexedDB); eine Status-Seite nähme ihr das.
            return Step(seite)
        default:
            guard let status = Statusseite(ergebnis, healthVersion: healthVersion) else {
                return Step(seite)
            }
            return self.status(eintrag, status)
        }
    }

    private static func loaded(_ eintrag: ServerEintrag, _ info: ShellInfo) -> Step {
        Step(
            .web(eintrag, vertrag: info.shellContract),
            [.markVerbunden(eintrag.id, vertrag: info.shellContract), .load(eintrag)])
    }

    private static func status(_ eintrag: ServerEintrag, _ status: Statusseite) -> Step {
        Step(.status(eintrag, status), status == .nichtErreichbar ? [.scheduleRetry] : [])
    }
}

extension Fehlerklasse {
    /// Fehlerklasse eines gescheiterten Ladevorgangs im Webview; `nil` für einen abgebrochenen
    /// (`NSURLErrorCancelled`: eine neue Navigation hat die alte abgelöst).
    public init?(navigation code: URLError.Code) {
        if code == .cancelled { return nil }
        self.init(code)
    }
}
