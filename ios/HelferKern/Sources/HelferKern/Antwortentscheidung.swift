/// Was der Ortungsdienst auf die Antwort des Servers auf eine Sendung tut (Spec „Ablauf“,
/// Schritt 6; gemeinsame Fälle `src-tauri/faelle/helfer.json`, Abschnitt `antwort`). Die
/// Rohwerte sind die Kennwörter der Fälle.
public enum Antwort: String, Equatable, Sendable, CaseIterable {
    /// Gesendet: weiter im Takt.
    case weiter
    /// Netzfehler, 429 oder 5xx: die letzte Position behalten und später erneut senden.
    case wiederholen
    /// Inhalt unbrauchbar (422): diese eine Position verwerfen, nicht wiederholen.
    case verwerfen
    /// Kopplung noch unbestätigt (409): der Dienst läuft weiter, der Server speichert nichts.
    case warten
    /// Sitzung weg, nicht berechtigt oder Kopplung weg (401, 403, 404): der Dienst stoppt.
    case stoppen
}

/// Entscheidung je HTTP-Status; `0` steht für einen Netzfehler ohne Antwort.
///
/// Nur 401, 403 und 404 stoppen den Dienst, damit ein Neustart des Servers nicht die Ortung aller
/// Helfer stilllegt. Ein anderer 4xx außer 408 und 429 ist ein Fehler dieser Sendung und wird wie
/// 422 verworfen.
public func entscheide(status: Int) -> Antwort {
    switch status {
    case 200...299: .weiter
    case 409: .warten
    case 401, 403, 404: .stoppen
    case 408, 429: .wiederholen
    case 400...499: .verwerfen
    default: .wiederholen
    }
}
