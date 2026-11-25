import Foundation

/// Eine gemessene Position, wie sie an `PUT /api/devices/me/position` geht (`lat`, `lon`,
/// `accuracy_m`, `recorded_at`).
public struct Position: Equatable, Sendable {
    public let latitude: Double
    public let longitude: Double
    /// Genauigkeit in Metern, falls das System sie meldet.
    public let accuracy: Double?
    /// Zeitpunkt der Messung am Gerät.
    public let recordedAt: Date

    public init(latitude: Double, longitude: Double, accuracy: Double? = nil, recordedAt: Date) {
        self.latitude = latitude
        self.longitude = longitude
        self.accuracy = accuracy
        self.recordedAt = recordedAt
    }
}

/// Puffer ohne Netz (Spec „Senden, Takt, ohne Netz“): nur die **letzte** Position, nur im
/// Speicher, ohne Datei. Kommt das Netz zurück, geht sie raus, wenn sie jünger als 10 Minuten
/// ist; sonst gilt sie als verworfen. Einen Verlauf gibt es nicht.
public struct Puffer: Sendable {
    /// Höchstes Alter einer gepufferten Position in Sekunden.
    public static let hoechstalterS: Double = 600

    public private(set) var letzte: Position?

    public init() {}

    /// Merkt eine Position; eine ältere ersetzt die gemerkte nicht.
    public mutating func merke(_ p: Position) {
        if let letzte, letzte.recordedAt > p.recordedAt { return }
        letzte = p
    }

    /// Die gemerkte Position, wenn sie jünger als 600 s ist, sonst `nil`.
    public func faellig(jetzt: Date) -> Position? {
        guard let letzte, jetzt.timeIntervalSince(letzte.recordedAt) < Self.hoechstalterS
        else { return nil }
        return letzte
    }

    /// Vergisst die gemerkte Position, etwa nach einer erfolgreichen Sendung oder einem 422.
    public mutating func leere() {
        letzte = nil
    }
}
