import CoreLocation
import Foundation
import LifelineKern

/// Standort für die Oberfläche (LLH-2071; Regel `ios/AGENTS.md`, „Standort“): ein
/// `CLLocationManager`, nur „When in Use“, gefragt erst beim ersten Befehl der Seite. Was die Seite
/// bekommt und wann, entscheiden `Brueckenausfuehrung` und `Standortbeobachtung` im Kern; diese
/// Klasse holt nur Positionen; was bei Fehlern und Wechseln der Freigabe endet, entscheidet
/// `Ortungsablauf` (LLH-2082).
@MainActor
final class Standortdienst: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var freigabeWartende: [CheckedContinuation<Bool, Never>] = []
    private var einmalWartende: [UUID: CheckedContinuation<Standortposition, any Error>] = [:]
    private var einmalGenau = false
    /// Läuft eine fortlaufende Ortung (`starte`), und wie genau?
    private var beobachtetGenau: Bool?

    /// Jede neue Position der fortlaufenden Ortung.
    var beiPosition: (@MainActor (Standortposition) -> Void)?
    /// Ein Fehler der fortlaufenden Ortung; nach `denied` endet sie.
    var beiFehler: (@MainActor (Standortfehler) -> Void)?

    override init() {
        super.init()
        manager.delegate = self
        // Eine Beobachtung der Seite soll nicht still pausieren, weil sich das Gerät nicht bewegt:
        // danach käme weder eine Position noch ein Fehler (LLH-2082).
        manager.pausesLocationUpdatesAutomatically = false
    }

    // MARK: Freigabe

    func freigabe() async -> Standortfreigabe {
        // Nicht im Hauptthread: Apple warnt sonst vor einem hängenden UI.
        let dienstAn = await Task.detached { CLLocationManager.locationServicesEnabled() }.value
        guard dienstAn else { return .aus }
        switch manager.authorizationStatus {
        case .notDetermined: return .offen
        case .authorizedWhenInUse, .authorizedAlways: return .erlaubt
        case .denied, .restricted: return .verweigert
        @unknown default: return .verweigert
        }
    }

    /// Fragt die Person einmal („When in Use“); `true`, wenn sie erlaubt.
    func requestFreigabe() async -> Bool {
        guard manager.authorizationStatus == .notDetermined else { return isErlaubt }
        return await withCheckedContinuation { fortsetzung in
            freigabeWartende.append(fortsetzung)
            if freigabeWartende.count == 1 { manager.requestWhenInUseAuthorization() }
        }
    }

    private var isErlaubt: Bool {
        [.authorizedWhenInUse, .authorizedAlways].contains(manager.authorizationStatus)
    }

    // Die Rückrufe kommen auf dem Hauptthread (der Manager entstand dort); über die Grenze gehen
    // nur Sendable-Werte.
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        MainActor.assumeIsolated {
            let erlaubt = isErlaubt
            // „Einmal erlauben“ läuft ab, indem der Status wieder `.notDetermined` wird.
            melde(Ortungsablauf.freigabe(
                erlaubt: erlaubt, beobachtet: beobachtetGenau != nil, einmalWartend: !einmalWartende.isEmpty))
            guard status != .notDetermined else { return }
            let wartend = freigabeWartende
            freigabeWartende = []
            wartend.forEach { $0.resume(returning: erlaubt) }
        }
    }

    // MARK: Positionen

    /// Eine Position; die Frist zählt ab jetzt (die Freigabe ist schon erteilt).
    func einmal(highAccuracy: Bool, timeout: Duration?) async throws -> Standortposition {
        let kennung = UUID()
        return try await withCheckedThrowingContinuation { fortsetzung in
            einmalWartende[kennung] = fortsetzung
            einmalGenau = einmalGenau || highAccuracy
            passeGenauigkeitAn()
            // Läuft schon eine fortlaufende Ortung, nimmt die einmalige ihre nächste Position.
            if beobachtetGenau == nil { manager.requestLocation() }
            if let timeout {
                Task { @MainActor [weak self] in
                    try? await Task.sleep(for: timeout)
                    self?.beende(kennung, mit: .failure(Standortfehler.timeout))
                }
            }
        }
    }

    func starte(highAccuracy: Bool) {
        beobachtetGenau = highAccuracy
        passeGenauigkeitAn()
        manager.startUpdatingLocation()
    }

    func stoppe() {
        beobachtetGenau = nil
        manager.stopUpdatingLocation()
        passeGenauigkeitAn()
        // Eine Einzelabfrage wartete auf die nächste Position der Ortung, die es nicht mehr gibt.
        if Ortungsablauf.isRequestNachStopp(einmalWartend: !einmalWartende.isEmpty) {
            manager.requestLocation()
        }
    }

    private func passeGenauigkeitAn() {
        let genau = (beobachtetGenau ?? false) || (!einmalWartende.isEmpty && einmalGenau)
        manager.desiredAccuracy = genau ? kCLLocationAccuracyBest : kCLLocationAccuracyHundredMeters
    }

    private func beende(_ kennung: UUID, mit ergebnis: Result<Standortposition, any Error>) {
        guard let fortsetzung = einmalWartende.removeValue(forKey: kennung) else { return }
        if einmalWartende.isEmpty { einmalGenau = false }
        fortsetzung.resume(with: ergebnis)
    }

    private func beendeAlleEinmal(mit ergebnis: Result<Standortposition, any Error>) {
        for kennung in Array(einmalWartende.keys) { beende(kennung, mit: ergebnis) }
        passeGenauigkeitAn()
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let position = locations.last.flatMap(Self.position) else { return }
        MainActor.assumeIsolated {
            beendeAlleEinmal(mit: .success(position))
            if beobachtetGenau != nil { beiPosition?(position) }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: any Error) {
        let fehler: Ortungsfehler =
            switch (error as? CLError)?.code {
            case .denied?: .denied
            case .locationUnknown?: .locationUnknown
            default: .andere
            }
        MainActor.assumeIsolated {
            melde(Ortungsablauf.fehler(
                fehler, beobachtet: beobachtetGenau != nil, einmalWartend: !einmalWartende.isEmpty))
        }
    }

    private func melde(_ folge: Ortungsfolge) {
        if let fehler = folge.einmal { beendeAlleEinmal(mit: .failure(fehler)) }
        if let fehler = folge.beobachtung { beiFehler?(fehler) }
    }

    /// Eine Position im Wire-Format; ungültige Werte (negativ) sind `nil`.
    nonisolated private static func position(_ ort: CLLocation) -> Standortposition? {
        guard ort.horizontalAccuracy >= 0 else { return nil }
        return Standortposition(
            latitude: ort.coordinate.latitude, longitude: ort.coordinate.longitude,
            accuracy: ort.horizontalAccuracy,
            altitude: ort.verticalAccuracy >= 0 ? ort.altitude : nil,
            altitudeAccuracy: ort.verticalAccuracy >= 0 ? ort.verticalAccuracy : nil,
            heading: ort.course >= 0 ? ort.course : nil,
            speed: ort.speed >= 0 ? ort.speed : nil,
            timestamp: Int64((ort.timestamp.timeIntervalSince1970 * 1000).rounded()))
    }
}
