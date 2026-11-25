import Foundation

/// Ein Auftrag an die Helfer-App (Stufe 2, ADR-0104), wie `GET /api/devices/me/tasks` ihn liefert
/// (`HelperTask` in src/helfer/auftraege.rs). Die Felder sind die englischen Wire-Namen in
/// camelCase; `HelferAuftrag.decoder` übersetzt aus snake_case. Zeiten sind UTC
/// `YYYY-MM-DD HH:MM:SS` (`Serverzeit`). Aufträge liegen nur im Speicher, nie auf der Platte.
public struct HelferAuftrag: Codable, Equatable, Hashable, Sendable, Identifiable {
    /// Eine Empfängerzeile, die diese Kopplung betrifft (Einheit, Fahrzeug oder Person).
    public struct Empfaenger: Codable, Equatable, Hashable, Sendable, Identifiable {
        public let id: Int64
        /// `unit`, `vehicle` oder `person`.
        public let kind: String
        /// Empfänger, wie beim Erteilen angezeigt.
        public let label: String
        public let acknowledgedAt: String?
        /// Wer quittiert hat: Anzeigename der Helfer-Kopplung, sonst Name des Kontos.
        public let acknowledgedBy: String?

        public init(
            id: Int64, kind: String, label: String, acknowledgedAt: String? = nil,
            acknowledgedBy: String? = nil
        ) {
            self.id = id
            self.kind = kind
            self.label = label
            self.acknowledgedAt = acknowledgedAt
            self.acknowledgedBy = acknowledgedBy
        }

        public var isQuittiert: Bool { acknowledgedAt != nil }
    }

    public let id: Int64
    public let number: Int64?
    public let text: String
    public let location: String?
    public let locationLat: Double?
    public let locationLon: Double?
    /// `sofort`, `dringend` oder `normal` (`Prioritaet`).
    public let priority: String
    public let deadlineAt: String?
    public let issuedAt: String
    public let cancelledAt: String?
    public let recipients: [Empfaenger]

    public init(
        id: Int64, number: Int64? = nil, text: String, location: String? = nil,
        locationLat: Double? = nil, locationLon: Double? = nil, priority: String = "normal",
        deadlineAt: String? = nil, issuedAt: String, cancelledAt: String? = nil,
        recipients: [Empfaenger]
    ) {
        self.id = id
        self.number = number
        self.text = text
        self.location = location
        self.locationLat = locationLat
        self.locationLon = locationLon
        self.priority = priority
        self.deadlineAt = deadlineAt
        self.issuedAt = issuedAt
        self.cancelledAt = cancelledAt
        self.recipients = recipients
    }

    /// Liest snake_case wie alle Helfer-Routen.
    public static var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }

    public var isAufgehoben: Bool { cancelledAt != nil }
    /// Offen: nicht aufgehoben und mindestens eine eigene Zeile noch nicht quittiert.
    public var isOffen: Bool { !isAufgehoben && recipients.contains { !$0.isQuittiert } }
    public var prioritaet: Prioritaet? { Prioritaet(rawValue: priority) }
    public var erteilt: Date? { Serverzeit.datum(issuedAt) }
    public var frist: Date? { deadlineAt.flatMap(Serverzeit.datum) }
}

/// Priorität eines Auftrags (Wire-Werte von `Prioritaet` in src/auftrag).
public enum Prioritaet: String, Equatable, Sendable, CaseIterable {
    case sofort, dringend, normal

    public var text: String {
        switch self {
        case .sofort: "Sofort"
        case .dringend: "Dringend"
        case .normal: "Normal"
        }
    }
}

/// Zeitpunkte des Servers: UTC, `%Y-%m-%d %H:%M:%S`.
public enum Serverzeit {
    public static func datum(_ text: String) -> Date? {
        let format = DateFormatter()
        format.locale = Locale(identifier: "en_US_POSIX")
        format.timeZone = TimeZone(identifier: "UTC")
        format.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return format.date(from: text)
    }
}

/// Antwort von `GET /api/devices/me/tasks`.
public struct HelferAuftragsliste: Codable, Equatable, Sendable {
    public let tasks: [HelferAuftrag]

    public init(tasks: [HelferAuftrag]) { self.tasks = tasks }
}

/// Ordnung der Liste und „Mitteilung ja/nein“ (gemeinsame Fälle `src-tauri/faelle/helfer-auftrag.json`,
/// Abschnitte `ordnung` und `mitteilung`; Gegenstück in `android/helferkern`).
public enum Auftraege {
    /// Höchstes Alter eines Auftrags, der noch eine Mitteilung bekommt.
    public static let mitteilungFristS: TimeInterval = 10 * 60

    /// Liest die Antwort von `GET /api/devices/me/tasks`; `nil`, wenn sie nicht passt.
    public static func liste(aus daten: Data) -> [HelferAuftrag]? {
        try? HelferAuftrag.decoder.decode(HelferAuftragsliste.self, from: daten).tasks
    }

    /// Liest die Antwort der Quittung (ein `HelperTask`).
    public static func auftrag(aus daten: Data) -> HelferAuftrag? {
        try? HelferAuftrag.decoder.decode(HelferAuftrag.self, from: daten)
    }

    /// Offen vor quittiert vor aufgehoben, in jeder Gruppe der neueste zuerst (`issued_at`
    /// absteigend, bei Gleichstand die höhere ID).
    public static func ordnen(_ auftraege: [HelferAuftrag]) -> [HelferAuftrag] {
        func gruppe(_ a: HelferAuftrag) -> Int {
            if a.isAufgehoben { return 2 }
            return a.isOffen ? 0 : 1
        }
        return auftraege.sorted { a, b in
            let (ga, gb) = (gruppe(a), gruppe(b))
            if ga != gb { return ga < gb }
            let (ta, tb) = (a.erteilt ?? .distantPast, b.erteilt ?? .distantPast)
            if ta != tb { return ta > tb }
            return a.id > b.id
        }
    }

    /// Zahl der offenen Aufträge (Kopf des Bereichs „Aufträge“).
    public static func offene(_ auftraege: [HelferAuftrag]) -> Int {
        auftraege.filter(\.isOffen).count
    }

    /// Ob ein Auftrag eine Mitteilung bekommt: offen, nicht aufgehoben, noch nicht gemeldet und
    /// höchstens `mitteilungFristS` vor `jetzt` erteilt.
    public static func sollMitteilen(
        _ auftrag: HelferAuftrag, bereitsGemeldet: Set<Int64>, jetzt: Date
    ) -> Bool {
        guard auftrag.isOffen, !bereitsGemeldet.contains(auftrag.id),
            let erteilt = auftrag.erteilt
        else { return false }
        return jetzt.timeIntervalSince(erteilt) <= mitteilungFristS
    }
}

/// Stand der Quittung einer Empfängerzeile: offen → sendet → quittiert; ein Fehler lässt sie
/// offen mit Grund. Ein aufgehobener Auftrag ist aufgehoben, auch wenn er schon quittiert war.
public enum Quittungsstand: Equatable, Sendable {
    case offen
    case sendet
    /// `um` ist `nil`, wenn der Server einen unlesbaren Zeitpunkt nennt.
    case quittiert(um: Date?, von: String?)
    case aufgehoben
    case fehler(String)

    /// Stand der ersten Zeile des Auftrags (gemeinsame Fälle, Abschnitt `quittungsstand`).
    public static func aus(_ auftrag: HelferAuftrag) -> Quittungsstand {
        guard let erste = auftrag.recipients.first else {
            return auftrag.isAufgehoben ? .aufgehoben : .offen
        }
        return aus(auftrag, empfaenger: erste)
    }

    /// Stand einer Zeile aus den Feldern des Servers.
    public static func aus(_ auftrag: HelferAuftrag, empfaenger: HelferAuftrag.Empfaenger)
        -> Quittungsstand
    {
        if auftrag.isAufgehoben { return .aufgehoben }
        guard let um = empfaenger.acknowledgedAt else { return .offen }
        return .quittiert(um: Serverzeit.datum(um), von: empfaenger.acknowledgedBy)
    }

    /// Stand mit dem, was die App gerade tut: eine laufende Quittung `sendet`, eine gescheiterte
    /// `fehler`. Was der Server schon kennt (quittiert, aufgehoben), geht vor.
    public static func aus(
        _ auftrag: HelferAuftrag, empfaenger: HelferAuftrag.Empfaenger, sendet: Bool,
        fehler: String?
    ) -> Quittungsstand {
        let stand = aus(auftrag, empfaenger: empfaenger)
        guard stand == .offen else { return stand }
        if sendet { return .sendet }
        if let fehler { return .fehler(fehler) }
        return .offen
    }

    /// Ob der Knopf „Übernommen“ gilt.
    public var kannQuittieren: Bool {
        switch self {
        case .offen, .fehler: true
        case .sendet, .quittiert, .aufgehoben: false
        }
    }
}

/// Feste Texte des Bereichs „Aufträge“ und des Auftrags (Entwurf „Oberfläche der App“); gleich
/// wie in `android/helferkern`.
public enum AuftragAnzeige {
    public static let bereich = "Aufträge"
    public static let leer = "Keine Aufträge. Neue Aufträge kommen als Mitteilung."
    public static let mitteilungenAus = "Mitteilungen aus — du bekommst Aufträge nur bei offener App"
    public static let knopf = "Übernommen"
    public static let sendet = "Wird gesendet …"
    public static let aufgehoben = "aufgehoben"
    public static let quittungFehlgeschlagen = "Bitte über Funk bestätigen"
    /// Text der Mitteilung, wenn der Dienst die Nutzlast nicht öffnen kann.
    public static let rueckfall = "Öffnen, um den Auftrag zu sehen"

    /// „Übernommen um 14:32“ bzw. „Übernommen von Max M. um 14:32“, wenn ein anderer schneller
    /// war. `eigen`: diese App hat quittiert (oder der Name ist der eigene).
    public static func quittiert(
        um: Date?, von: String?, eigen: Bool, zeitzone: TimeZone = .current
    ) -> String {
        var text = knopf
        if !eigen, let von, !von.trimmingCharacters(in: .whitespaces).isEmpty {
            text += " von \(von)"
        }
        if let um { text += " um \(uhrzeit(um, zeitzone: zeitzone))" }
        return text
    }

    /// `HH:mm` in der Zeitzone des Geräts.
    public static func uhrzeit(_ datum: Date, zeitzone: TimeZone = .current) -> String {
        let format = DateFormatter()
        format.locale = Locale(identifier: "de_DE")
        format.timeZone = zeitzone
        format.dateFormat = "HH:mm"
        return format.string(from: datum)
    }

    /// An wen der Auftrag ging: eine Person ist „an dich“, sonst der Name der Einheit bzw. des
    /// Fahrzeugs.
    public static func empfaenger(_ e: HelferAuftrag.Empfaenger) -> String {
        e.kind == "person" ? "an dich" : e.label
    }

    /// Kurzer Stand in der Liste.
    public static func kurz(_ auftrag: HelferAuftrag) -> String {
        if auftrag.isAufgehoben { return aufgehoben }
        return auftrag.isOffen ? "offen" : "übernommen"
    }
}
