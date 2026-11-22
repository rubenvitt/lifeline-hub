import Foundation

/// Die Anmeldungen der App am Push-Kanal, je Server eine (Entwurf „iOS-Alarme über APNs“). Die
/// Kennung ist der Name der Anmeldung beim Server (`registration_id`) und steht im Umschlag jeder
/// Nutzlast: die Extension findet über sie den Schlüssel und den Server. Reiner Wert: speichern
/// übernimmt `Pushablage`, Token und Schlüssel liegen im Schlüsselbund, nicht hier.
public struct PushAnmeldungen: Codable, Equatable, Sendable {
    /// Kennung je Server (UUID des `ServerEintrag` → Kennung als UUID-Text).
    private var kennungen: [UUID: String] = [:]

    public init() {}

    /// Die Kennung des Servers; die erste ist neu, jede weitere gleich.
    public mutating func kennung(fuer server: UUID) -> String {
        if let vorhanden = kennungen[server] { return vorhanden }
        let neu = UUID().uuidString.lowercased()
        kennungen[server] = neu
        return neu
    }

    /// Der Server zu einer Kennung aus einer Nutzlast; `nil` für eine unbekannte oder entfernte.
    public func server(zu kennung: String) -> UUID? {
        kennungen.first { $0.value == kennung }?.key
    }

    /// Nimmt die Anmeldung des Servers weg und nennt die Kennungen, deren Schlüssel und
    /// Abmeldung beim Server nun aufzuräumen sind (leer, wenn es keine gab).
    @discardableResult
    public mutating func entfernen(server: UUID) -> [String] {
        kennungen.removeValue(forKey: server).map { [$0] } ?? []
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
}
