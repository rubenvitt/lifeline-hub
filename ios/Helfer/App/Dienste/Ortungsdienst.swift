import CoreLocation
import Foundation
import HelferKern

/// Die Helfer-Ortung (ADR-0098, Spec „Ortung im Hintergrund“ und „Senden, Takt, ohne Netz“): die
/// einzige Stelle, die im Hintergrund sendet.
///
/// - Startet nur aus dem Vordergrund (beim Einlösen oder auf Knopfdruck), nie von selbst nach einem
///   Neustart der App.
/// - `CLLocationUpdate.liveUpdates` mit `CLBackgroundActivitySession` (ab iOS 17, zeigt die
///   Standortanzeige des Systems), ab iOS 18 dazu `CLServiceSession(authorization: .whenInUse)`.
///   Nur „When in Use“, nie Always.
/// - Was gesendet wird und wann, entscheiden `Takt`, `Puffer`, `Wiederholung` und
///   `entscheide(status:)` im Kern; hier stehen nur Uhr, Netz und System.
/// - Kein Verlauf: der Puffer hält nur die letzte Position, nur im Speicher.
@MainActor
final class Ortungsdienst: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var freigabeWartende: [CheckedContinuation<Bool, Never>] = []

    private var hintergrund: CLBackgroundActivitySession?
    /// `CLServiceSession` ab iOS 18; als `AnyObject`, weil eine gespeicherte Eigenschaft nicht
    /// von der Version abhängen darf.
    private var dienstSitzung: AnyObject?
    private var updates: Task<Void, Never>?
    private var lebenszeichen: Task<Void, Never>?
    private var naechsterVersuch: Task<Void, Never>?

    private let takt = Takt()
    private var puffer = Puffer()
    private var wiederholung = Wiederholung()
    /// Zuletzt angenommene Sendung: Position und Uhrzeit des Geräts.
    private var gesendet: (position: Position, zeit: Date)?
    /// Letzte gemessene Position, für das Lebenszeichen ohne Bewegung.
    private var letzteMessung: Position?
    private var sendetGerade = false

    private(set) var laeuft = false

    /// Schickt eine Position an den Server der Kopplung (setzt das Modell).
    var senden: (@MainActor (Position) async -> Rueckmeldung)?
    /// Entscheidung zu einer Antwort; bei `.stoppen` ist der Dienst schon aus.
    var beiAntwort: (@MainActor (Antwort) -> Void)?
    /// Nächster Versuch nach einem Fehler, `nil` wieder verbunden.
    var beiWiederholung: (@MainActor (Date?) -> Void)?

    override init() {
        super.init()
        manager.delegate = self
    }

    // MARK: Freigabe

    var isErlaubt: Bool {
        [.authorizedWhenInUse, .authorizedAlways].contains(manager.authorizationStatus)
    }

    var isVerweigert: Bool {
        [.denied, .restricted].contains(manager.authorizationStatus)
    }

    /// Fragt einmal nach „When in Use“; `true`, wenn erlaubt.
    func requestFreigabe() async -> Bool {
        guard manager.authorizationStatus == .notDetermined else { return isErlaubt }
        return await withCheckedContinuation { fortsetzung in
            freigabeWartende.append(fortsetzung)
            if freigabeWartende.count == 1 { manager.requestWhenInUseAuthorization() }
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        MainActor.assumeIsolated {
            guard status != .notDetermined else { return }
            let wartend = freigabeWartende
            freigabeWartende = []
            let erlaubt = isErlaubt
            wartend.forEach { $0.resume(returning: erlaubt) }
        }
    }

    // MARK: Start und Stopp

    /// Startet die Ortung. Nur aus dem Vordergrund aufrufen: dort entstehen die Sitzungen, die sie
    /// im Hintergrund weiterlaufen lassen.
    func starte() {
        guard !laeuft else { return }
        laeuft = true
        hintergrund = CLBackgroundActivitySession()
        if #available(iOS 18.0, *) {
            dienstSitzung = CLServiceSession(authorization: .whenInUse)
        }
        updates = Task { [weak self] in
            do {
                for try await update in CLLocationUpdate.liveUpdates() {
                    guard !Task.isCancelled else { return }
                    guard let ort = update.location else { continue }
                    let position = Position(
                        latitude: ort.coordinate.latitude,
                        longitude: ort.coordinate.longitude,
                        accuracy: ort.horizontalAccuracy >= 0 ? ort.horizontalAccuracy : nil,
                        recordedAt: ort.timestamp)
                    self?.neueMessung(position)
                }
            } catch {
                // Die Folge endet nur mit dem Abbruch der Aufgabe.
            }
        }
        // Ohne Bewegung ein Lebenszeichen nach `takt.lebenszeichenS`, damit die Karte nicht
        // „veraltet“ zeigt; geprüft jede halbe Minute.
        lebenszeichen = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                guard !Task.isCancelled else { return }
                self?.pruefeLebenszeichen()
            }
        }
    }

    /// Stoppt die Ortung und vergisst die gepufferte Position.
    func stoppe() {
        updates?.cancel()
        lebenszeichen?.cancel()
        naechsterVersuch?.cancel()
        updates = nil
        lebenszeichen = nil
        naechsterVersuch = nil
        hintergrund?.invalidate()
        hintergrund = nil
        if #available(iOS 18.0, *) {
            (dienstSitzung as? CLServiceSession)?.invalidate()
        }
        dienstSitzung = nil
        puffer.leere()
        wiederholung.zuruecksetzen()
        gesendet = nil
        letzteMessung = nil
        laeuft = false
    }

    // MARK: Takt

    private func neueMessung(_ position: Position) {
        guard laeuft else { return }
        letzteMessung = position
        let jetzt = Date()
        let seit = gesendet.map { jetzt.timeIntervalSince($0.zeit) } ?? .infinity
        let bewegt = gesendet.map { abstand($0.position, position) } ?? .infinity
        if takt.soll(senden: seit, bewegtM: bewegt) {
            puffer.merke(position)
            sendeFaellige()
        }
    }

    private func pruefeLebenszeichen() {
        guard laeuft, let messung = letzteMessung, let gesendet else { return }
        guard Date().timeIntervalSince(gesendet.zeit) >= takt.lebenszeichenS else { return }
        // Ohne Bewegung gilt die letzte Messung weiter; sie geht mit der Uhrzeit von jetzt raus,
        // sonst verwürfe der Server sie als nicht neuer als die gespeicherte.
        puffer.merke(
            Position(
                latitude: messung.latitude, longitude: messung.longitude,
                accuracy: messung.accuracy, recordedAt: Date()))
        sendeFaellige()
    }

    private func abstand(_ a: Position, _ b: Position) -> Double {
        CLLocation(latitude: a.latitude, longitude: a.longitude)
            .distance(from: CLLocation(latitude: b.latitude, longitude: b.longitude))
    }

    // MARK: Senden

    /// Sendet die gepufferte Position, wenn keine Sendung läuft und kein Versuch geplant ist; eine
    /// ältere als 10 min verfällt (`Puffer.faellig`).
    private func sendeFaellige() {
        guard laeuft, !sendetGerade, naechsterVersuch == nil, let senden else { return }
        guard let position = puffer.faellig(jetzt: Date()) else {
            puffer.leere()
            return
        }
        sendetGerade = true
        Task { [weak self] in
            let rueckmeldung = await senden(position)
            self?.verarbeite(rueckmeldung.antwort, fuer: position)
        }
    }

    private func verarbeite(_ antwort: Antwort, fuer position: Position) {
        sendetGerade = false
        guard laeuft else { return }
        switch antwort {
        case .weiter, .warten:
            if antwort == .weiter { wiederholung.zuruecksetzen() }
            gesendet = (position, Date())
            if puffer.letzte == position { puffer.leere() }
            beiWiederholung?(nil)
        case .verwerfen:
            if puffer.letzte == position { puffer.leere() }
        case .wiederholen:
            planeVersuch()
        case .stoppen:
            stoppe()
        }
        beiAntwort?(antwort)
        // Kam während der Sendung eine neuere Position, geht sie jetzt.
        if laeuft, antwort != .wiederholen, puffer.letzte != nil { sendeFaellige() }
    }

    /// Wachsender Abstand nach Fehlern, höchstens jede Minute (`Wiederholung`).
    private func planeVersuch() {
        let sekunden = wiederholung.naechsterAbstandS()
        beiWiederholung?(Date().addingTimeInterval(TimeInterval(sekunden)))
        naechsterVersuch = Task { [weak self] in
            try? await Task.sleep(for: .seconds(sekunden))
            guard !Task.isCancelled else { return }
            self?.naechsterVersuch = nil
            self?.sendeFaellige()
        }
    }
}
