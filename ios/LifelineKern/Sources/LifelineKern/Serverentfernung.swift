import Foundation

/// Was die App zum Entfernen eines Servers tut; die App setzt es mit WebKit und der Ablage um,
/// die Tests mit einer Attrappe.
@MainActor
public protocol Entfernungsdienste: AnyObject {
    /// Die Liste in diesem Moment (sie kann sich während des Löschens ändern).
    var serverliste: Serverliste { get }
    /// Schließt einen Webview, der den Datenspeicher `id` benutzt; sonst nichts.
    func closeWebView(datenspeicher id: UUID)
    /// `WKWebsiteDataStore.remove(forIdentifier:)`.
    func removeDatenspeicher(_ id: UUID) async throws
    /// Nimmt den Eintrag aus der Liste und speichert sie.
    func removeEintrag(_ id: UUID) throws(Serverliste.ListError)
}

/// Entfernen eines Servers (Entwurf D3; Spec `ios-huelle`, „Mehrere Server lassen sich
/// verwalten“, „Jeder Server hat seinen eigenen Datenspeicher“). Reihenfolge: Webview des
/// Speichers schließen (`remove(forIdentifier:)` scheitert, solange ein Webview ihn benutzt),
/// Speicher löschen, erst dann den Eintrag. Scheitert das Löschen, bleibt der Eintrag, und die App
/// meldet den Fehler; so bleibt kein Speicher ohne Eintrag zurück, und ein zweiter Versuch geht.
public enum Serverentfernung {
    public enum Fehler: Error, Equatable, LocalizedError, Sendable {
        case unbekannt
        /// Der aktive Server lässt sich erst nach einem Wechsel entfernen.
        case aktiv
        case datenspeicher(name: String, grund: String)

        public var errorDescription: String? {
            switch self {
            case .unbekannt:
                "Der Server steht nicht mehr in der Liste."
            case .aktiv:
                "Der aktive Server lässt sich erst nach einem Wechsel entfernen."
            case .datenspeicher(let name, let grund):
                "Die Daten von „\(name)“ ließen sich nicht löschen (\(grund)). Der Server bleibt in "
                    + "der Liste; bitte später erneut entfernen."
            }
        }
    }

    /// Hinweis der Rückfrage. Die Hülle liest die Schreib-Queue des Frontends nicht aus, sagt also
    /// allgemein, was verloren geht (Entwurf D3).
    public static let hinweis =
        "Einträge, die noch nicht übertragen wurden, gehen verloren. Auch die Anmeldung und die "
        + "Offline-Daten dieses Servers werden auf diesem Gerät gelöscht."

    public static func rueckfrageTitel(_ eintrag: ServerEintrag) -> String {
        "„\(eintrag.name)“ entfernen?"
    }

    /// Bietet die Liste das Entfernen an? Nur für einen bekannten, nicht aktiven Server.
    public static func isEntfernbar(_ id: UUID, in liste: Serverliste) -> Bool {
        liste.aktiv?.id != id && liste.eintraege.contains { $0.id == id }
    }

    @MainActor
    public static func run(_ id: UUID, dienste: some Entfernungsdienste) async throws(Fehler) {
        let liste = dienste.serverliste
        guard let eintrag = liste.eintraege.first(where: { $0.id == id }) else { throw .unbekannt }
        guard liste.aktiv?.id != id else { throw .aktiv }
        dienste.closeWebView(datenspeicher: id)
        do {
            try await dienste.removeDatenspeicher(id)
        } catch {
            throw .datenspeicher(name: eintrag.name, grund: error.localizedDescription)
        }
        do {
            try dienste.removeEintrag(id)
        } catch .aktivNichtEntfernbar {
            throw .aktiv
        } catch {
            throw .unbekannt
        }
    }
}
