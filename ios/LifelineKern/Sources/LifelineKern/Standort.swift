import Foundation

/// Eine Position für die Seite (LLH-2071, Wire-Format im Kopf von `ios/App/Huelle/huelle.js`).
/// Was das Gerät nicht weiß, ist `nil`; `timestamp` in ms seit 1970.
public struct Standortposition: Equatable, Sendable {
    public let latitude: Double
    public let longitude: Double
    public let accuracy: Double
    public let altitude: Double?
    public let altitudeAccuracy: Double?
    public let heading: Double?
    public let speed: Double?
    public let timestamp: Int64

    public init(
        latitude: Double, longitude: Double, accuracy: Double, altitude: Double?,
        altitudeAccuracy: Double?, heading: Double?, speed: Double?, timestamp: Int64
    ) {
        self.latitude = latitude
        self.longitude = longitude
        self.accuracy = accuracy
        self.altitude = altitude
        self.altitudeAccuracy = altitudeAccuracy
        self.heading = heading
        self.speed = speed
        self.timestamp = timestamp
    }
}

/// Fehler an die Seite; der Polyfill macht daraus die Codes der Web-API (1, 2, 3).
public enum Standortfehler: String, Error, Equatable, Sendable, LocalizedError {
    case denied
    case unavailable
    case timeout

    public var errorDescription: String? { rawValue }
}

/// Ob die App den Standort holen darf.
public enum Standortfreigabe: Equatable, Sendable {
    /// Noch nie gefragt: der erste Befehl fragt.
    case offen
    case erlaubt
    case verweigert
    /// Ortungsdienste des Geräts sind aus.
    case aus
}

/// Was die App mit dem `CLLocationManager` tun soll.
public enum Standortwirkung: Equatable, Sendable {
    case keine
    /// Fortlaufende Ortung (neu) starten, mit dieser Genauigkeit.
    case starte(highAccuracy: Bool)
    case stoppe
}

/// Ein Fehler des `CLLocationManager`, wie ihn der Kern unterscheidet.
public enum Ortungsfehler: Equatable, Sendable {
    /// `CLError.denied`: die Person hat den Standort verweigert.
    case denied
    /// `CLError.locationUnknown`: noch kein Standort, der Manager versucht weiter.
    case locationUnknown
    /// Alles andere.
    case andere
}

/// Wen ein Ereignis des `CLLocationManager` beendet: wartende Einzelabfragen (`location_current`)
/// und die fortlaufende Ortung (`location_watch`), je mit diesem Fehler; `nil` heißt weiter warten.
public struct Ortungsfolge: Equatable, Sendable {
    public let einmal: Standortfehler?
    public let beobachtung: Standortfehler?

    public static let keine = Ortungsfolge(einmal: nil, beobachtung: nil)

    public init(einmal: Standortfehler?, beobachtung: Standortfehler?) {
        self.einmal = einmal
        self.beobachtung = beobachtung
    }
}

/// Was der `Standortdienst` der App bei Ereignissen des `CLLocationManager` tut (LLH-2082; Regel
/// `ios/AGENTS.md`, „Standort“). Die App hält die wartenden Abfragen, der Kern entscheidet.
public enum Ortungsablauf {
    /// Ein Fehler des Managers. Läuft eine fortlaufende Ortung, ist „noch kein Standort“ für
    /// niemanden ein Ende: eine wartende Einzelabfrage nimmt deren nächste Position. Ohne sie hat
    /// `requestLocation()` aufgegeben, die Einzelabfrage endet.
    public static func fehler(_ fehler: Ortungsfehler, beobachtet: Bool, einmalWartend: Bool)
        -> Ortungsfolge
    {
        let text: Standortfehler = fehler == .denied ? .denied : .unavailable
        if fehler == .locationUnknown && beobachtet { return .keine }
        return Ortungsfolge(einmal: einmalWartend ? text : nil, beobachtung: beobachtet ? text : nil)
    }

    /// Die Freigabe hat sich geändert. Fällt sie weg, während eine Ortung läuft oder eine
    /// Einzelabfrage wartet (etwa „Einmal erlauben“ ist abgelaufen, der Status ist dann wieder
    /// „noch nie gefragt“), endet beides mit `denied`; der Manager meldet das nicht selbst.
    public static func freigabe(erlaubt: Bool, beobachtet: Bool, einmalWartend: Bool) -> Ortungsfolge {
        guard !erlaubt else { return .keine }
        return Ortungsfolge(
            einmal: einmalWartend ? .denied : nil, beobachtung: beobachtet ? .denied : nil)
    }

    /// Endet die fortlaufende Ortung, während eine Einzelabfrage noch auf deren nächste Position
    /// wartet, muss die App sie selbst holen (`requestLocation()`), sonst kommt keine mehr.
    public static func isRequestNachStopp(einmalWartend: Bool) -> Bool { einmalWartend }
}

/// Die laufenden Beobachtungen (`location_watch`) des einen Webviews (LLH-2071; Regel
/// `ios/AGENTS.md`, „Standort“). Sie gelten für den Server, auf dem sie begannen: Positionen gehen
/// nur an eine Seite dieses Servers, solange er aktiv ist; sonst endet alles. Navigation, Schließen
/// des Webviews und Ende des Web-Prozesses rufen `reset`. Zeiten in Sekunden einer monotonen Uhr.
public struct Standortbeobachtung: Sendable {
    private struct Eintrag: Sendable {
        let highAccuracy: Bool
        let timeout: Double?
        /// Bis wann die nächste Position da sein muss; `nil`: keine Frist oder schon gemeldet.
        var frist: Double?
    }

    private var eintraege: [Int: Eintrag] = [:]
    private var server: ServerAdresse?
    /// Beobachtungen, die die Seite angefragt hat, deren Start aber noch auf die Freigabe wartet.
    private var angefragte: Set<Int> = []
    /// Zählt Seiten: `reset` beginnt eine neue, Anfragen der alten starten danach nicht mehr.
    private var generation = 0

    public init() {}

    public var isLeer: Bool { eintraege.isEmpty }

    private var genau: Bool { eintraege.values.contains { $0.highAccuracy } }

    /// Die Seite fragt `location_watch` an; die App startet erst nach der Freigabe und gibt dann
    /// die Generation von hier zurück.
    public mutating func angefragt(id: Int) -> Int {
        angefragte.insert(id)
        return generation
    }

    /// Startet eine angefragte Beobachtung. Hat die Seite sie inzwischen beendet (`clear`) oder ist
    /// sie eine andere geworden (`reset`), geschieht nichts.
    public mutating func start(
        id: Int, highAccuracy: Bool, timeout: Duration?, server: ServerAdresse, generation: Int,
        jetzt: Double
    ) -> Standortwirkung {
        guard generation == self.generation, angefragte.remove(id) != nil else { return .keine }
        if self.server != server {
            eintraege = [:]
            self.server = server
        }
        let vorher = isLeer ? nil : genau
        let sekunden = timeout.map(Self.sekunden)
        eintraege[id] = Eintrag(
            highAccuracy: highAccuracy, timeout: sekunden, frist: sekunden.map { jetzt + $0 })
        return vorher == genau ? .keine : .starte(highAccuracy: genau)
    }

    public mutating func clear(watch: Int) -> Standortwirkung {
        angefragte.remove(watch)
        guard eintraege[watch] != nil else { return .keine }
        let vorher = genau
        eintraege[watch] = nil
        if isLeer { return .stoppe }
        return vorher == genau ? .keine : .starte(highAccuracy: genau)
    }

    public mutating func reset() -> Standortwirkung {
        generation += 1
        angefragte = []
        guard !isLeer else { return .keine }
        eintraege = [:]
        server = nil
        return .stoppe
    }

    /// Eine neue Position: an welche Beobachtungen sie geht (aufsteigend). Ist der Server nicht
    /// mehr aktiv oder die Seite keine seine, endet alles (`stoppe`).
    public mutating func zustellen(aktiverServer: ServerAdresse?, seite: URL?, jetzt: Double)
        -> (ids: [Int], wirkung: Standortwirkung)
    {
        guard !isLeer else { return ([], .keine) }
        guard let server, let aktiverServer, server == aktiverServer, let seite,
            Linkregeln.belongsToServer(server.url, seite: seite)
        else { return ([], reset()) }
        for (id, eintrag) in eintraege {
            eintraege[id]?.frist = eintrag.timeout.map { jetzt + $0 }
        }
        return (eintraege.keys.sorted(), .keine)
    }

    /// Beobachtungen, deren Frist abgelaufen ist (aufsteigend); jede einmal je Warten, bis die
    /// nächste Position kommt.
    public mutating func abgelaufen(jetzt: Double) -> [Int] {
        let ids = eintraege.filter { $0.value.frist.map { jetzt >= $0 } ?? false }.keys.sorted()
        for id in ids { eintraege[id]?.frist = nil }
        return ids
    }

    private static func sekunden(_ dauer: Duration) -> Double {
        let teile = dauer.components
        return Double(teile.seconds) + Double(teile.attoseconds) / 1e18
    }
}
