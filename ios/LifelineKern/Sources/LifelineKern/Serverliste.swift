import Foundation

/// Ein gespeicherter Server der iOS-App. Die `id` benennt auch seinen Datenspeicher
/// (`WKWebsiteDataStore(forIdentifier:)`, Entwurf D3): Cookies, Sitzung und Offline-Daten zweier
/// Server liegen nie im selben Speicher.
public struct ServerEintrag: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public var name: String
    public let adresse: ServerAdresse
    public var zuletztVerbunden: Date?
    /// Der `shell_contract`, mit dem die App zuletzt geladen hat; ohne Netz gilt er weiter.
    public var bestaetigterVertrag: Int?
}

/// Die Server der App und welcher davon aktiv ist (Spec `ios-huelle`, „Mehrere Server lassen
/// sich verwalten“). Reiner Wert: speichern und Datenspeicher löschen übernimmt die App.
public struct Serverliste: Codable, Equatable, Sendable {
    public enum ListError: Error, Equatable, Sendable {
        case unbekannt
        /// Der aktive Server lässt sich erst nach einem Wechsel entfernen.
        case aktivNichtEntfernbar
    }

    public private(set) var eintraege: [ServerEintrag] = []
    private var aktivID: UUID?

    public init() {}

    public var aktiv: ServerEintrag? { aktivID.flatMap(eintrag(id:)) }

    public func eintrag(fuer adresse: ServerAdresse) -> ServerEintrag? {
        eintraege.first { $0.adresse == adresse }
    }

    /// Nimmt einen geprüften Server auf; eine bekannte Adresse gibt ihren Eintrag zurück. Der
    /// erste Server wird aktiv, jeder weitere erst über `activate`.
    @discardableResult
    public mutating func add(_ adresse: ServerAdresse, name: String? = nil) -> ServerEintrag {
        if let vorhanden = eintrag(fuer: adresse) { return vorhanden }
        let eintrag = ServerEintrag(
            id: UUID(), name: Self.name(name, adresse: adresse), adresse: adresse)
        eintraege.append(eintrag)
        if aktiv == nil { aktivID = eintrag.id }
        return eintrag
    }

    /// Ein leerer Name fällt auf den Hostnamen zurück.
    public mutating func rename(_ id: UUID, to name: String) throws(ListError) {
        let index = try index(id)
        eintraege[index].name = Self.name(name, adresse: eintraege[index].adresse)
    }

    public mutating func activate(_ id: UUID) throws(ListError) {
        _ = try index(id)
        aktivID = id
    }

    public mutating func remove(_ id: UUID) throws(ListError) {
        let index = try index(id)
        if id == aktiv?.id { throw .aktivNichtEntfernbar }
        eintraege.remove(at: index)
    }

    /// Die Oberfläche wurde mit `vertrag` geladen.
    public mutating func markVerbunden(_ id: UUID, am zeit: Date, vertrag: Int) throws(ListError) {
        let index = try index(id)
        eintraege[index].zuletztVerbunden = zeit
        eintraege[index].bestaetigterVertrag = vertrag
    }

    private func eintrag(id: UUID) -> ServerEintrag? { eintraege.first { $0.id == id } }

    private func index(_ id: UUID) throws(ListError) -> Int {
        guard let index = eintraege.firstIndex(where: { $0.id == id }) else { throw .unbekannt }
        return index
    }

    private static func name(_ name: String?, adresse: ServerAdresse) -> String {
        let name = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return name.isEmpty ? adresse.host : name
    }
}

extension ServerEintrag {
    init(id: UUID, name: String, adresse: ServerAdresse) {
        self.init(
            id: id, name: name, adresse: adresse, zuletztVerbunden: nil, bestaetigterVertrag: nil)
    }
}
