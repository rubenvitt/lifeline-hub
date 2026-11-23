import Foundation

/// Die Anmeldungen der App am Push-Kanal, je Server eine (Entwurf „iOS-Alarme über APNs“). Die
/// Kennung ist der Name der Anmeldung beim Server (`registration_id`) und steht im Umschlag jeder
/// Nutzlast: die Extension findet über sie den Schlüssel und den Server. Reiner Wert: speichern
/// übernimmt `Pushablage`, Token und Schlüssel liegen im Schlüsselbund, nicht hier.
public struct PushAnmeldungen: Codable, Equatable, Sendable {
    /// Kennung je Server (UUID des `ServerEintrag` → Kennung als UUID-Text).
    private var kennungen: [UUID: String] = [:]
    /// Abmeldungen entfernter Server, die der Server noch nicht bestätigt hat; ihr Schlüssel
    /// bleibt bis dahin im Schlüsselbund (`entfernen(server:abmeldenBei:)`).
    public private(set) var ausstehend: [AusstehendeAbmeldung] = []

    public init() {}

    private enum CodingKeys: String, CodingKey {
        case kennungen
        case ausstehend
    }

    /// Eine `push.json` von vor den ausstehenden Abmeldungen hat das Feld nicht.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kennungen = try c.decode([UUID: String].self, forKey: .kennungen)
        ausstehend = try c.decodeIfPresent([AusstehendeAbmeldung].self, forKey: .ausstehend) ?? []
    }

    /// Die Kennung des Servers; die erste ist neu, jede weitere gleich.
    public mutating func kennung(fuer server: UUID) -> String {
        if let vorhanden = kennungen[server] { return vorhanden }
        let neu = UUID().uuidString.lowercased()
        kennungen[server] = neu
        return neu
    }

    /// Die Kennung des Servers, falls er eine hat; legt keine an (`push_state`).
    public func vorhandeneKennung(fuer server: UUID) -> String? {
        kennungen[server]
    }

    /// Der Server zu einer Kennung aus einer Nutzlast; `nil` für eine unbekannte oder entfernte.
    public func server(zu kennung: String) -> UUID? {
        kennungen.first { $0.value == kennung }?.key
    }

    /// Nimmt die Anmeldung des Servers weg und nennt die Kennungen, deren Schlüssel nun zu
    /// löschen sind (leer, wenn es keine gab). Nur, wo beim Server schon abgemeldet ist
    /// (`push_unregister` nach der Oberfläche); sonst `entfernen(server:abmeldenBei:)`.
    @discardableResult
    public mutating func entfernen(server: UUID) -> [String] {
        kennungen.removeValue(forKey: server).map { [$0] } ?? []
    }

    /// Der Server wird aus der App entfernt: seine Kennung kommt zu den ausstehenden Abmeldungen
    /// bei `adresse`, statt vergessen zu werden. Erst `abgemeldet(kennung:)` nimmt sie weg.
    @discardableResult
    public mutating func entfernen(server: UUID, abmeldenBei adresse: ServerAdresse) -> [String] {
        let weg = entfernen(server: server)
        ausstehend += weg.map { AusstehendeAbmeldung(kennung: $0, adresse: adresse) }
        return weg
    }

    /// Der Server hat die Abmeldung erledigt (`AusstehendeAbmeldung.isErledigt`).
    public mutating func abgemeldet(kennung: String) {
        ausstehend.removeAll { $0.kennung == kennung }
    }
}

/// Eine Abmeldung beim Server (`POST /api/ios-push/unregister`), die noch aussteht: der Server ist
/// aus der App entfernt, hat sie aber nicht bestätigt (etwa ohne Netz). Die App versucht sie bei
/// jedem Start und jeder Rückkehr in den Vordergrund einmal.
public struct AusstehendeAbmeldung: Codable, Equatable, Sendable {
    public let kennung: String
    public let adresse: ServerAdresse

    public init(kennung: String, adresse: ServerAdresse) {
        self.kennung = kennung
        self.adresse = adresse
    }

    /// Ob die Abmeldung mit dieser Antwort erledigt ist (`status` `nil`: keine Antwort). 2xx ist
    /// Erfolg. Ein anderer 4xx (404: der Server hat iOS-Push aus und pusht nicht; 403 oder 400:
    /// abgewiesen) ändert sich durch einen neuen Versuch nicht; sie bliebe sonst für immer
    /// liegen. Ohne Antwort, bei 3xx, 5xx, 408 und 429 kann ein späterer Versuch gelingen.
    public static func isErledigt(status: Int?) -> Bool {
        guard let status else { return false }
        switch status {
        case 200..<300: return true
        case 408, 429: return false
        case 400..<500: return true
        default: return false
        }
    }
}

/// Ablage der Anmeldungen als JSON in Application Support (`<verzeichnis>/push.json`).
public struct Pushablage: Sendable {
    public let verzeichnis: URL

    public init(verzeichnis: URL) {
        self.verzeichnis = verzeichnis
    }

    public var datei: URL { verzeichnis.appendingPathComponent("push.json") }

    /// Ohne Datei keine Anmeldungen; eine unlesbare Datei wirft.
    public func load() throws -> PushAnmeldungen {
        guard FileManager.default.fileExists(atPath: datei.path) else { return PushAnmeldungen() }
        return try JSONDecoder().decode(PushAnmeldungen.self, from: Data(contentsOf: datei))
    }

    public func save(_ anmeldungen: PushAnmeldungen) throws {
        try FileManager.default.createDirectory(at: verzeichnis, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(anmeldungen).write(to: datei, options: .atomic)
    }

    var beiseite: URL { verzeichnis.appendingPathComponent("push.defekt.json") }

    /// Beim Start: eine Datei, die sich lesen, aber nicht dekodieren lässt (etwa aus einer
    /// späteren Version), kommt als `push.defekt.json` beiseite, danach gilt die Ablage als leer.
    /// Sonst scheiterte jede Anmeldung, und das Entfernen eines Servers merkte keine Abmeldung.
    /// Ein Lesefehler (Datei gesperrt) lässt sie liegen. `true`, wenn sie beiseitegelegt wurde.
    @discardableResult
    public func recoverIfUnreadable() -> Bool {
        guard FileManager.default.fileExists(atPath: datei.path),
            let daten = try? Data(contentsOf: datei),
            (try? JSONDecoder().decode(PushAnmeldungen.self, from: daten)) == nil
        else { return false }
        try? FileManager.default.removeItem(at: beiseite)
        return (try? FileManager.default.moveItem(at: datei, to: beiseite)) != nil
    }
}
