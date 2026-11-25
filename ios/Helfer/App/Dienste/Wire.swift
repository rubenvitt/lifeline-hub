import Foundation
import HelferKern

// Wire-Typen der Helfer-Routen (src/helfer/anmeldung.rs, src/routes/helfer.rs; generiert in
// frontend/src/api/types.generated.ts). Die Felder sind die englischen Wire-Namen in camelCase;
// `Wire.decoder` und `Wire.encoder` übersetzen nach snake_case.

enum Wire {
    static var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }

    static var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        return encoder
    }

    /// Zeitpunkte des Servers (`expires_at`, `server_time`): UTC, `%Y-%m-%d %H:%M:%S`.
    static func serverzeit(_ text: String) -> Date? {
        let format = DateFormatter()
        format.locale = Locale(identifier: "en_US_POSIX")
        format.timeZone = TimeZone(identifier: "UTC")
        format.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return format.date(from: text)
    }

    /// `recorded_at` nach RFC 3339.
    static func zeitpunkt(_ datum: Date) -> String {
        datum.formatted(.iso8601)
    }
}

/// Ein wählbares Ziel vor dem Einlösen (`HelferZielOption`).
struct ZielOption: Codable, Hashable, Sendable {
    /// `unit` oder `vehicle`.
    let kind: String
    let id: Int64
    /// Name der Einheit bzw. Funkrufname des Fahrzeugs.
    let name: String
    let callSign: String?
    let signFunction: String?
    let signOrganization: String?

    /// Eindeutig über Art und Kennung (Einheit und Fahrzeug können dieselbe Zahl tragen).
    var kennung: String { "\(kind)-\(id)" }
    var istFahrzeug: Bool { kind == "vehicle" }
    var eingabe: ZielEingabe { ZielEingabe(kind: kind, id: id) }
}

/// Antwort von `POST /api/devices/helpers/targets` (`HelferZielliste`).
struct Zielliste: Decodable, Equatable, Sendable {
    let targets: [ZielOption]
    let personTrackingAllowed: Bool
}

/// Ziel, wie die App es beim Einlösen und Ändern schickt (`ZielEingabe`).
struct ZielEingabe: Codable, Hashable, Sendable {
    let kind: String
    let id: Int64
}

/// Body von `POST /api/devices/helpers/targets`: der Code im Body, nie in der Adresse.
struct Zielanfrage: Encodable, Sendable {
    let code: String
}

/// Body von `POST /api/devices/helpers/redeem`.
struct Einloesung: Encodable, Sendable {
    let code: String
    let displayName: String
    let target: ZielEingabe
    let trackPerson: Bool
}

/// Body von `PUT /api/devices/me`.
struct Zielaenderung: Encodable, Sendable {
    let target: ZielEingabe
}

/// Body von `PUT /api/devices/me/position` mit einer Position.
struct Positionssendung: Encodable, Sendable {
    let lat: Double
    let lon: Double
    let accuracyM: Double?
    let recordedAt: String

    init(_ position: Position) {
        lat = position.latitude
        lon = position.longitude
        accuracyM = position.accuracy
        recordedAt = Wire.zeitpunkt(position.recordedAt)
    }
}

/// Body von `PUT /api/devices/me/position` zum Pausieren und Fortsetzen.
struct Pausensendung: Encodable, Sendable {
    let paused: Bool
}

/// Eigener Zustand der Kopplung (`HelferZustand`, `GET /api/devices/me` und Antwort auf das
/// Einlösen).
struct Zustand: Decodable, Equatable, Sendable {
    struct Einsatz: Decodable, Equatable, Sendable {
        let id: Int64
        let name: String
    }

    struct Ziel: Decodable, Equatable, Sendable {
        let kind: String
        let id: Int64
        let name: String
    }

    struct Person: Decodable, Equatable, Sendable {
        let id: Int64
        let name: String
    }

    /// `unbestaetigt`, `aktiv`, `abgelehnt` oder `beendet`.
    let state: String
    /// `HelferEndeGrund` als Wire-Wert (`Grund(wire:)`).
    let reason: String?
    let incident: Einsatz
    let target: Ziel?
    let person: Person?
    let isTracker: Bool
    let paused: Bool
    let expiresAt: String
    let serverTime: String

    /// Was die Leitung beim Bestätigen gegeben hat (`Ereignis.zustand`).
    var rolle: Rolle { Rolle(isTracker: isTracker, personId: person?.id) }

    /// Ablauf der Kopplung, auf die Uhr des Geräts umgerechnet (der Server nennt seine Uhrzeit mit).
    var ablauf: Date? {
        guard let ablauf = Wire.serverzeit(expiresAt), let server = Wire.serverzeit(serverTime)
        else { return nil }
        return Date().addingTimeInterval(ablauf.timeIntervalSince(server))
    }
}
