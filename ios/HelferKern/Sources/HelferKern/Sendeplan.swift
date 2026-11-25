import Foundation

/// Was der Ortungsdienst wann sendet (Spec „Senden, Takt, ohne Netz“): `Takt`, `Puffer` und
/// `Wiederholung` zusammen; Gegenstück `Sendeplan` in `android/helferkern`, beide gegen den
/// Abschnitt `sendeplan` von `src-tauri/faelle/helfer.json`. Der Dienst meldet Messungen, Antworten
/// und die Uhr; jede Methode gibt die Position zurück, die jetzt rausgeht, oder `nil`. Es läuft
/// höchstens eine Sendung zur Zeit; eine neuere Messung wartet im Puffer (nur die letzte, nur im
/// Speicher).
///
/// Eine Position geht immer mit der Zeit **ihrer** Messung raus, nie eine alte mit neuer Zeit: das
/// Lebenszeichen fordert eine frische Messung an (`lebenszeichen(jetzt:)`); kommt keine, geht
/// nichts raus und die Karte zeigt die Position ehrlich als veraltet.
public struct Sendeplan: Sendable {
    /// So lange wartet das Lebenszeichen auf die angeforderte Messung.
    public static let lebenszeichenFristS: Double = 30

    private let takt: Takt
    private var puffer = Puffer()
    private var wiederholung = Wiederholung()

    /// Zuletzt angenommene Sendung und wann sie ankam.
    private var gesendet: Position?
    private var gesendetUm: Date?
    /// Wann das Lebenszeichen eine frische Messung angefordert hat; `nil` ohne Anforderung.
    private var angefordertUm: Date?
    /// Die Position, deren Antwort aussteht.
    private var unterwegs: Position?

    /// Zeitpunkt des nächsten Versuchs nach einem Fehler; `nil` ohne Fehler.
    public private(set) var naechsterVersuch: Date?

    public init(takt: Takt = Takt()) {
        self.takt = takt
    }

    /// Eine neue Messung des Systems. Eine, die nicht neuer ist als die zuletzt angenommene, geht
    /// nicht noch einmal raus (das System liefert auf eine Anforderung auch eine
    /// zwischengespeicherte).
    public mutating func messung(_ p: Position, jetzt: Date) -> Position? {
        if let gesendet, p.recordedAt <= gesendet.recordedAt { return nil }
        angefordertUm = nil
        let seit = gesendetUm.map { jetzt.timeIntervalSince($0) } ?? .infinity
        let bewegt = gesendet.map { abstandM($0, p) } ?? .infinity
        guard takt.soll(senden: seit, bewegtM: bewegt) else { return nil }
        puffer.merke(p)
        return faellige(jetzt: jetzt)
    }

    /// Die halbminütliche Prüfung des Dienstes: `true` heißt „fordere jetzt **eine** frische
    /// Messung an“ (ohne Bewegung liefert das System sonst keine). `Takt.lebenszeichenS` nach der
    /// letzten angenommenen Sendung; eine Anforderung gilt `lebenszeichenFristS` Sekunden, erst
    /// danach kommt die nächste. Die Messung geht über `messung(_:jetzt:)` mit ihrer eigenen Zeit
    /// raus.
    public mutating func lebenszeichen(jetzt: Date) -> Bool {
        guard let gesendetUm, unterwegs == nil,
            jetzt.timeIntervalSince(gesendetUm) >= takt.lebenszeichenS
        else { return false }
        if let angefordertUm, jetzt.timeIntervalSince(angefordertUm) < Self.lebenszeichenFristS {
            return false
        }
        angefordertUm = jetzt
        return true
    }

    /// Der geplante Versuch nach einem Fehler ist dran (oder noch nicht: dann `nil`).
    public mutating func versuch(jetzt: Date) -> Position? {
        guard let geplant = naechsterVersuch else { return faellige(jetzt: jetzt) }
        if geplant > jetzt { return nil }
        naechsterVersuch = nil
        return faellige(jetzt: jetzt)
    }

    /// Antwort des Servers (`entscheide(status:grund:)`) auf die laufende Sendung. Kam
    /// währenddessen eine neuere Position, geht sie jetzt raus; nach `.wiederholen` erst zum
    /// `naechsterVersuch`.
    public mutating func antwort(_ antwort: Antwort, jetzt: Date) -> Position? {
        guard let p = unterwegs else { return nil }
        unterwegs = nil
        switch antwort {
        case .weiter, .warten:
            if antwort == .weiter { wiederholung.zuruecksetzen() }
            gesendet = p
            gesendetUm = jetzt
            if puffer.letzte == p { puffer.leere() }
        case .verwerfen:
            if puffer.letzte == p { puffer.leere() }
        case .wiederholen:
            naechsterVersuch = jetzt.addingTimeInterval(TimeInterval(wiederholung.naechsterAbstandS()))
            return nil
        case .stoppen, .ruhen:
            stoppe()
            return nil
        }
        return puffer.letzte != nil ? faellige(jetzt: jetzt) : nil
    }

    /// Vergisst alles: Puffer, Sendung, Fehler.
    public mutating func stoppe() {
        puffer.leere()
        wiederholung.zuruecksetzen()
        gesendet = nil
        gesendetUm = nil
        angefordertUm = nil
        unterwegs = nil
        naechsterVersuch = nil
    }

    /// Die gepufferte Position, wenn keine Sendung läuft und kein Versuch geplant ist; eine zu
    /// alte verfällt.
    private mutating func faellige(jetzt: Date) -> Position? {
        guard unterwegs == nil, naechsterVersuch == nil else { return nil }
        guard let p = puffer.faellig(jetzt: jetzt) else {
            puffer.leere()
            return nil
        }
        unterwegs = p
        return p
    }
}

/// Mittlerer Erdradius in Metern (IUGG).
private let erdradiusM = 6_371_008.8

/// Abstand zweier Positionen in Metern auf der Kugel (Haversine; wie `abstandM` in
/// `android/helferkern`).
public func abstandM(_ a: Position, _ b: Position) -> Double {
    let phi1 = a.latitude * .pi / 180
    let phi2 = b.latitude * .pi / 180
    let dPhi = phi2 - phi1
    let dLambda = (b.longitude - a.longitude) * .pi / 180
    let h = sin(dPhi / 2) * sin(dPhi / 2) + cos(phi1) * cos(phi2) * sin(dLambda / 2) * sin(dLambda / 2)
    return 2 * erdradiusM * asin(min(1, h.squareRoot()))
}
