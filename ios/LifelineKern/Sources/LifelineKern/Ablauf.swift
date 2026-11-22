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
        /// Der Server antwortet nicht; der Webview zeigt die gespeicherte Oberfläche dieses
        /// Servers in der Version `version` (LLH-1980). Die App prüft weiter.
        case ohneServer(ServerEintrag, version: String)
        case status(ServerEintrag, Statusseite)

        /// Der Server der Seite; `nil` im Onboarding.
        public var eintrag: ServerEintrag? {
            switch self {
            case .onboarding: nil
            case .pruefung(let e), .web(let e, _), .ohneServer(let e, _), .status(let e, _): e
            }
        }

        /// Steht auf dieser Seite ein Webview?
        public var zeigtWebview: Bool {
            switch self {
            case .web, .ohneServer: true
            case .onboarding, .pruefung, .status: false
            }
        }

        /// Prüft die App auf dieser Seite alle `wiederholIntervall` erneut?
        public var wiederholt: Bool {
            switch self {
            case .ohneServer, .status(_, .nichtErreichbar): true
            default: false
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
        /// `adresse` ist die Adresse des Webviews, `anmeldungLaeuft` gilt, solange „Im Browser
        /// anmelden“ eine Sitzung offen hat.
        case vordergrund(seiteAntwortet: Bool, adresse: URL?, anmeldungLaeuft: Bool)
        /// „Zur Oberfläche“ in der Serverliste oder im Hinweis, oder ein Tipp auf den aktiven
        /// Server: zurück zur Startadresse des aktiven Servers.
        case zurOberflaeche
        /// Der Webview hat eine neue Seite übernommen (`didCommit`).
        case seiteGeladen(url: URL?)
        /// Ergebnis von `check`; `healthVersion` nur für einen Server ohne Vertrag.
        case ergebnis(Vertragsergebnis, healthVersion: String?, fuer: UUID)
        /// Zeitgeber der Seite „nicht erreichbar“.
        case wiederholen
        /// `didFailProvisionalNavigation` mit dem Fehlercode und der Adresse, die scheiterte.
        case navigationFehlgeschlagen(URLError.Code, url: URL?)
        /// `webViewWebContentProcessDidTerminate`.
        case webProzessBeendet
        /// Die gespeicherte Oberfläche ist nach dem Laden nicht hochgefahren (LLH-1980).
        case vorratGescheitert(fuer: UUID)
    }

    public enum Effect: Equatable, Sendable {
        /// `GET /api/shell` (bei 404 dazu `GET /api/health`) und `Vertragspruefung`.
        case check(ServerEintrag)
        /// Webview mit dem Datenspeicher des Eintrags bauen und die Adresse laden.
        case load(ServerEintrag)
        /// Webview mit dem Datenspeicher des Eintrags bauen und die gespeicherte Oberfläche unter
        /// der Adresse des Servers laden, danach prüfen, ob sie hochfährt (LLH-1980).
        case loadVorrat(ServerEintrag)
        /// Nach dem Laden vom Server: Assets vorwärmen und die Oberfläche ablegen, wie
        /// `Vorrat.plan` es sagt (LLH-1980).
        case vorwaermen(ServerEintrag, ShellInfo)
        case reload
        case markVerbunden(UUID, vertrag: Int)
        /// Nach `wiederholIntervall` `wiederholen` melden.
        case scheduleRetry
        /// Hinweis „Zur Oberfläche“ über dem Webview zeigen: er steht auf einer fremden Seite.
        case showZurOberflaeche
        /// Den Hinweis wieder wegnehmen.
        case hideZurOberflaeche
    }

    public struct Step: Equatable, Sendable {
        public let seite: Seite
        public let effects: [Effect]

        init(_ seite: Seite, _ effects: [Effect] = []) {
            self.seite = seite
            self.effects = effects
        }
    }

    /// `vorrat` ist die Version einer nutzbaren gespeicherten Oberfläche für den Server der Seite;
    /// `nil`, wenn keine vorliegt oder sie in diesem Lauf schon gescheitert ist (LLH-1980).
    public static func next(_ seite: Seite, _ event: Event, vorrat: String? = nil) -> Step {
        switch (seite, event) {
        case (_, .start(nil)):
            return Step(.onboarding)
        case (_, .start(let eintrag?)), (_, .wechseln(let eintrag)):
            return Step(.pruefung(eintrag), [.check(eintrag)])
        case (_, .verbunden(let eintrag, let info)):
            return loaded(eintrag, info)

        case (.web(let eintrag, _), .vordergrund(seiteAntwortet: true, let adresse, let anmeldungLaeuft)):
            // Erst prüfen, ob der Server inzwischen einen anderen Vertrag spricht. Eine fremde
            // Seite bleibt stehen (sie kann der Identitätsanbieter sein), aber ohne laufende
            // Anmeldung bietet die App den Weg zurück an.
            if let adresse, !anmeldungLaeuft, !Linkregeln.belongsToServer(eintrag.adresse.url, seite: adresse) {
                return Step(seite, [.check(eintrag), .showZurOberflaeche])
            }
            return Step(seite, [.check(eintrag)])
        case (.web(let eintrag, _), .vordergrund(seiteAntwortet: false, _, _)):
            return Step(.pruefung(eintrag), [.check(eintrag)])
        case (.status(let eintrag, _), .vordergrund), (.ohneServer(let eintrag, _), .vordergrund):
            return Step(seite, [.check(eintrag)])
        case (.status(let eintrag, .nichtErreichbar), .wiederholen), (.ohneServer(let eintrag, _), .wiederholen):
            return Step(seite, [.check(eintrag)])

        case (.web(let eintrag, _), .zurOberflaeche):
            // Ein neuer Webview mit dem Datenspeicher des Servers: Startadresse, ohne die
            // Geschichte der fremden Seite.
            return Step(seite, [.hideZurOberflaeche, .load(eintrag)])
        case (.ohneServer(let eintrag, _), .zurOberflaeche):
            return Step(seite, [.hideZurOberflaeche, .loadVorrat(eintrag)])
        case (.status(let eintrag, _), .zurOberflaeche):
            return Step(.pruefung(eintrag), [.check(eintrag)])
        case (.web(let eintrag, _), .seiteGeladen(let url?)), (.ohneServer(let eintrag, _), .seiteGeladen(let url?)):
            guard Linkregeln.belongsToServer(eintrag.adresse.url, seite: url) else { return Step(seite) }
            return Step(seite, [.hideZurOberflaeche])

        case (_, .ergebnis(let ergebnis, let healthVersion, let id)):
            guard let eintrag = seite.eintrag, eintrag.id == id else { return Step(seite) }
            return result(seite, eintrag, ergebnis, healthVersion: healthVersion, vorrat: vorrat)

        case (.ohneServer(let eintrag, _), .navigationFehlgeschlagen(let code, let url)):
            // Ohne Server ginge jede Navigation ins Leere; die gespeicherte Oberfläche bleibt.
            guard let url, Linkregeln.belongsToServer(eintrag.adresse.url, seite: url),
                Fehlerklasse(navigation: code) != nil
            else { return Step(seite) }
            return Step(seite, [.loadVorrat(eintrag)])
        case (.ohneServer(let eintrag, _), .webProzessBeendet):
            // `reload()` ginge ans Netz.
            return Step(seite, [.loadVorrat(eintrag)])
        case (.ohneServer(let eintrag, _), .vorratGescheitert(let id)) where eintrag.id == id:
            return status(eintrag, .nichtErreichbar)

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

    /// Bietet die Serverliste „Zur Oberfläche“ an? Nur mit einem Server, dessen Oberfläche geladen
    /// ist oder auf einer Status-Seite wartet.
    public static func bietetZurOberflaeche(_ seite: Seite) -> Bool {
        switch seite {
        case .web, .ohneServer, .status: true
        case .onboarding, .pruefung: false
        }
    }

    private static func result(
        _ seite: Seite, _ eintrag: ServerEintrag, _ ergebnis: Vertragsergebnis,
        healthVersion: String?, vorrat: String?
    ) -> Step {
        let geladen: Bool
        if case .web = seite { geladen = true } else { geladen = false }
        switch ergebnis {
        case .vertraeglich(let info):
            if geladen {
                return Step(.web(eintrag, vertrag: info.shellContract), [
                    .markVerbunden(eintrag.id, vertrag: info.shellContract), .vorwaermen(eintrag, info),
                ])
            }
            if case .ohneServer(_, let version) = seite, version == info.version {
                // Dieselbe Oberfläche, dieselbe Origin: sie arbeitet mit Netz einfach weiter, und
                // offene Eingaben bleiben (Entscheidung Ruben, 22.11.2026).
                return Step(.web(eintrag, vertrag: info.shellContract), [
                    .markVerbunden(eintrag.id, vertrag: info.shellContract), .vorwaermen(eintrag, info),
                ])
            }
            return loaded(eintrag, info)
        case .nichtErreichbar(let klasse) where geladen && klasse != .zertifikat:
            // Die geladene Oberfläche arbeitet ohne Netz weiter (Schreib-Queue, Lagebild aus
            // IndexedDB); eine Status-Seite nähme ihr das. Ein Zertifikatsfehler dagegen heilt
            // nicht von selbst: die Anleitung zum CA-Profil geht vor.
            return Step(seite)
        case .nichtErreichbar(.nichtErreichbar):
            if case .ohneServer = seite { return Step(seite, [.scheduleRetry]) }
            if let vorrat {
                // Nur eine Oberfläche dieses Servers, nie bei Zertifikatsfehler oder
                // unverträglichem Server (LLH-1980).
                return Step(.ohneServer(eintrag, version: vorrat), [.loadVorrat(eintrag), .scheduleRetry])
            }
            return status(eintrag, .nichtErreichbar)
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
            [.markVerbunden(eintrag.id, vertrag: info.shellContract), .load(eintrag), .vorwaermen(eintrag, info)])
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
