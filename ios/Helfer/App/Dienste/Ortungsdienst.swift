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
/// - Was gesendet wird und wann, entscheiden `Sendeplan` und `entscheide(status:grund:)` im Kern;
///   hier stehen nur Uhr, Netz und System. Das Lebenszeichen fordert eine frische Messung an
///   (`requestLocation`), nie geht eine alte Position mit neuer Zeit raus.
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

    /// Takt, Puffer, Wiederholung und Lebenszeichen (Kern, gemeinsame Fälle `sendeplan`).
    private var plan = Sendeplan()
    /// Zählt jeden Start; eine Antwort aus einem früheren Lauf ändert nichts mehr.
    private var lauf = 0

    private(set) var laeuft = false

    /// Schickt eine Position an den Server der Kopplung (setzt das Modell).
    var senden: (@MainActor (Position) async -> Rueckmeldung)?
    /// Entscheidung zu einer Antwort mit `reason` des Fehler-Bodys; bei `.stoppen` und `.ruhen`
    /// ist der Dienst schon aus.
    var beiAntwort: (@MainActor (Antwort, String?) -> Void)?
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

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let ort = locations.last else { return }
        let position = Ortungsdienst.position(ort)
        MainActor.assumeIsolated { neueMessung(position) }
    }

    /// Pflicht für `requestLocation`; ohne Messung geht kein Lebenszeichen raus.
    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: any Error) {}

    // MARK: Start und Stopp

    /// Startet die Ortung. Nur aus dem Vordergrund aufrufen: dort entstehen die Sitzungen, die sie
    /// im Hintergrund weiterlaufen lassen.
    func starte() {
        guard !laeuft else { return }
        laeuft = true
        lauf += 1
        plan.stoppe()
        hintergrund = CLBackgroundActivitySession()
        if #available(iOS 18.0, *) {
            dienstSitzung = CLServiceSession(authorization: .whenInUse)
        }
        updates = Task { [weak self] in
            do {
                for try await update in CLLocationUpdate.liveUpdates() {
                    guard !Task.isCancelled else { return }
                    guard let ort = update.location else { continue }
                    self?.neueMessung(Ortungsdienst.position(ort))
                }
            } catch {
                // Die Folge endet nur mit dem Abbruch der Aufgabe.
            }
        }
        // Ohne Bewegung liefert das System keine Messung: jede halbe Minute fragt der Plan, ob ein
        // Lebenszeichen dran ist, und dann wird genau eine frische Messung angefordert.
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
        plan.stoppe()
        laeuft = false
    }

    // MARK: Messungen

    private nonisolated static func position(_ ort: CLLocation) -> Position {
        Position(
            latitude: ort.coordinate.latitude,
            longitude: ort.coordinate.longitude,
            accuracy: ort.horizontalAccuracy >= 0 ? ort.horizontalAccuracy : nil,
            recordedAt: ort.timestamp)
    }

    private func neueMessung(_ position: Position) {
        guard laeuft, let faellig = plan.messung(position, jetzt: Date()) else { return }
        sende(faellig)
    }

    private func pruefeLebenszeichen() {
        guard laeuft, plan.lebenszeichen(jetzt: Date()) else { return }
        manager.requestLocation()
    }

    // MARK: Senden

    private func sende(_ position: Position) {
        guard let senden else { return }
        let dieser = lauf
        Task { [weak self] in
            let rueckmeldung = await senden(position)
            self?.verarbeite(rueckmeldung, lauf: dieser)
        }
    }

    private func verarbeite(_ rueckmeldung: Rueckmeldung, lauf dieser: Int) {
        guard laeuft, dieser == lauf else { return }
        let antwort = rueckmeldung.antwort
        let naechste = plan.antwort(antwort, jetzt: Date())
        switch antwort {
        case .weiter, .warten:
            beiWiederholung?(nil)
        case .wiederholen:
            planeVersuch()
        case .stoppen, .ruhen:
            stoppe()
        case .verwerfen:
            break
        }
        beiAntwort?(antwort, rueckmeldung.grund)
        // Kam während der Sendung eine neuere Position, geht sie jetzt.
        if laeuft, let naechste { sende(naechste) }
    }

    /// Wachsender Abstand nach Fehlern, höchstens jede Minute (`Wiederholung` im Plan).
    private func planeVersuch() {
        guard let zeit = plan.naechsterVersuch else { return }
        beiWiederholung?(zeit)
        naechsterVersuch?.cancel()
        naechsterVersuch = Task { [weak self] in
            try? await Task.sleep(for: .seconds(max(0, zeit.timeIntervalSinceNow)))
            guard !Task.isCancelled else { return }
            self?.versuche()
        }
    }

    private func versuche() {
        naechsterVersuch = nil
        guard laeuft, let faellig = plan.versuch(jetzt: Date()) else { return }
        sende(faellig)
    }
}
