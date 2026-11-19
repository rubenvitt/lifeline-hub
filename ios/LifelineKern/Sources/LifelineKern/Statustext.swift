/// Text einer nativen Status-Seite.
public struct Statustext: Equatable, Sendable {
    public let titel: String
    public let text: String
    /// Nummerierte Anleitung (nur „Zertifikat nicht vertrauenswürdig“).
    public let schritte: [String]
}

extension Statusseite {
    /// `servername` ist der Name aus der Serverliste, `appVersion` die volle Version der App.
    public func text(servername: String, appVersion: String?) -> Statustext {
        let app = appVersion ?? "unbekannt"
        switch self {
        case .zertifikat:
            return Statustext(
                titel: "Zertifikat nicht vertrauenswürdig",
                text: "Dieses Gerät vertraut dem Zertifikat von „\(servername)“ nicht. Ein Server "
                    + "im Einsatz-LAN braucht das CA-Profil seines Zertifikats (mkcert oder eigene "
                    + "CA) auf diesem Gerät.",
                schritte: [
                    "CA-Profil auf das Gerät laden und unter Einstellungen → Allgemein → VPN und "
                        + "Geräteverwaltung installieren.",
                    "Unter Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen "
                        + "das volle Vertrauen für diese CA einschalten.",
                    "Zurück in die App wechseln oder „Erneut prüfen“ tippen.",
                ])
        case .nichtErreichbar:
            return Statustext(
                titel: "Server nicht erreichbar",
                text: "„\(servername)“ antwortet nicht. Die App prüft weiter und lädt die "
                    + "Oberfläche, sobald der Server wieder antwortet.",
                schritte: [])
        case .nichtVertraeglich(.zuNeu, let serverVersion):
            return Statustext(
                titel: "App aktualisieren",
                text: "„\(servername)“ (Version \(serverVersion ?? "unbekannt")) braucht eine "
                    + "neuere Lifeline-App. Diese App hat Version \(app). Bitte die App über "
                    + "TestFlight aktualisieren.",
                schritte: [])
        case .nichtVertraeglich(_, let serverVersion):
            return Statustext(
                titel: "Server ist zu alt für diese App",
                text: "„\(servername)“ (Version \(serverVersion ?? "unbekannt")) ist zu alt für "
                    + "diese App (Version \(app)). Der Server muss aktualisiert werden.",
                schritte: [])
        }
    }
}
