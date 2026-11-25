/// Wann der Ortungsdienst eine neue Position sendet (Spec „Senden, Takt, ohne Netz“; gemeinsame
/// Fälle `src-tauri/faelle/helfer.json`, Abschnitt `takt`): höchstens alle 30 s und nur bei einer
/// Bewegung über 25 m; ohne Bewegung ein Lebenszeichen nach 300 s, damit die Karte nicht
/// „veraltet“ zeigt.
public struct Takt: Sendable {
    public let mindestabstandS: Double
    public let bewegungM: Double
    public let lebenszeichenS: Double

    public init(mindestabstandS: Double = 30, bewegungM: Double = 25, lebenszeichenS: Double = 300) {
        self.mindestabstandS = mindestabstandS
        self.bewegungM = bewegungM
        self.lebenszeichenS = lebenszeichenS
    }

    /// Ob gesendet wird, `seitLetzterS` Sekunden nach der letzten Sendung und `bewegtM` Meter von
    /// ihrer Position entfernt. Vor der ersten Sendung ruft die App mit `.infinity` auf.
    public func soll(senden seitLetzterS: Double, bewegtM: Double) -> Bool {
        (seitLetzterS >= mindestabstandS && bewegtM > bewegungM) || seitLetzterS >= lebenszeichenS
    }
}
