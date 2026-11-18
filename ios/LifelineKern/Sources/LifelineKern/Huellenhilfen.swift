import Foundation

/// Erkennt die Rückkehr in den Vordergrund aus den Phasen der Szene (`scenePhase`): `active` nach
/// `background`. Ein kurzes `inactive` (Kontrollzentrum, Mitteilungen) zählt nicht.
public struct Rueckkehr: Sendable {
    public enum Phase: Sendable {
        case active
        case inactive
        case background
    }

    private var warImHintergrund = false

    public init() {}

    /// `true`, wenn die App gerade aus dem Hintergrund zurückkehrt.
    public mutating func melde(_ phase: Phase) -> Bool {
        switch phase {
        case .background:
            warImHintergrund = true
            return false
        case .inactive:
            return false
        case .active:
            defer { warImHintergrund = false }
            return warImHintergrund
        }
    }
}

/// Zustände für die UI-Tests (`ios/AppUITests`): Startargument `-LifelineTestzustand <name>`.
/// Die App zeigt dann die Seite mit Beispieldaten, ohne Netz und ohne die gespeicherte Liste.
public enum Testzustand: String, CaseIterable, Sendable {
    case onboarding
    case serverliste
    case einstellungen
    case zertifikat
    case nichtErreichbar = "nicht-erreichbar"
    case zuAlt = "zu-alt"
    case zuNeu = "zu-neu"

    public static let argument = "-LifelineTestzustand"

    public init?(argumente: [String]) {
        guard let stelle = argumente.firstIndex(of: Self.argument),
            argumente.indices.contains(stelle + 1)
        else { return nil }
        self.init(rawValue: argumente[stelle + 1])
    }
}

extension Deeplink {
    /// Inhalt eines gescannten QR-Codes: ein Deeplink `lifeline://verbinden?server=…` oder eine
    /// https-Adresse. Alles andere (WLAN-Codes, fremde Links) ergibt nichts.
    public static func adresse(ausQRCode inhalt: String) -> ServerAdresse? {
        let inhalt = inhalt.trimmingCharacters(in: .whitespacesAndNewlines)
        if inhalt.lowercased().hasPrefix(schema + ":") { return parse(inhalt) }
        return try? ServerAdresse.parse(inhalt)
    }
}

extension Haptik {
    /// Schlüssel des Schalters „Haptik“ in `UserDefaults` (Vorgabe an).
    public static let schalterSchluessel = "haptik"

    public static func isEnabled(gespeichert: Bool?) -> Bool { gespeichert ?? true }
}

/// Ablage der Serverliste als JSON in Application Support (`<verzeichnis>/server.json`).
public struct Serverablage: Sendable {
    public let verzeichnis: URL

    public init(verzeichnis: URL) {
        self.verzeichnis = verzeichnis
    }

    public var datei: URL { verzeichnis.appendingPathComponent("server.json") }
    var beiseite: URL { verzeichnis.appendingPathComponent("server.defekt.json") }

    /// Ohne Datei eine leere Liste; eine unlesbare Datei wirft.
    public func load() throws -> Serverliste {
        guard FileManager.default.fileExists(atPath: datei.path) else { return Serverliste() }
        return try JSONDecoder().decode(Serverliste.self, from: Data(contentsOf: datei))
    }

    public func save(_ liste: Serverliste) throws {
        try FileManager.default.createDirectory(at: verzeichnis, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(liste).write(to: datei, options: .atomic)
    }

    /// Wie `load`, aber eine unlesbare Datei wird als `server.defekt.json` beiseitegelegt statt
    /// beim nächsten Speichern überschrieben; dann beginnt die App mit einer leeren Liste.
    public func loadOrRecover() -> Serverliste {
        do {
            return try load()
        } catch {
            try? FileManager.default.removeItem(at: beiseite)
            try? FileManager.default.moveItem(at: datei, to: beiseite)
            return Serverliste()
        }
    }
}
