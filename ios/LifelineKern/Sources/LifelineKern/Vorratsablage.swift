import Foundation

/// Die zuletzt vollständig vorgewärmte Oberfläche eines Servers (LLH-1980).
public struct GespeicherteOberflaeche: Codable, Equatable, Sendable {
    /// Server-Version aus `GET /api/shell`, zu der `html` und die vorgewärmten Assets gehören.
    public let version: String
    /// Die `index.html` des Servers, wie er sie ausliefert.
    public let html: String
    public let gespeichertAm: Date

    public init(version: String, html: String, gespeichertAm: Date) {
        self.version = version
        self.html = html
        self.gespeichertAm = gespeichertAm
    }
}

/// Ablage der gespeicherten Oberflächen: eine Datei je Server (`<uuid>.json`), atomar
/// geschrieben, damit nie `html` einer Version mit der Angabe einer anderen zusammenkommt.
public struct Vorratsablage: Sendable {
    public let verzeichnis: URL

    public init(verzeichnis: URL) {
        self.verzeichnis = verzeichnis
    }

    func datei(_ id: UUID) -> URL {
        verzeichnis.appendingPathComponent("\(id.uuidString).json")
    }

    /// `nil` ohne Ablage und bei einer unlesbaren Datei.
    public func load(_ id: UUID) -> GespeicherteOberflaeche? {
        guard let daten = try? Data(contentsOf: datei(id)) else { return nil }
        return try? Self.decoder.decode(GespeicherteOberflaeche.self, from: daten)
    }

    public func save(_ oberflaeche: GespeicherteOberflaeche, fuer id: UUID) throws {
        try FileManager.default.createDirectory(at: verzeichnis, withIntermediateDirectories: true)
        try Self.encoder.encode(oberflaeche).write(to: datei(id), options: .atomic)
    }

    /// Löscht die Ablage eines Servers; ohne Ablage nichts.
    public func remove(_ id: UUID) {
        try? FileManager.default.removeItem(at: datei(id))
    }

    private static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()
}
