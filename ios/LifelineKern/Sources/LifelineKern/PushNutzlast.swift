import Foundation

/// base64url ohne Auffüllung (RFC 4648 §5), wie ihn Server und Relais für Push schreiben.
enum Base64URL {
    static func decode(_ text: String) -> Data? {
        var b64 = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        guard !b64.contains("=") else { return nil }
        b64 += String(repeating: "=", count: (4 - b64.count % 4) % 4)
        return Data(base64Encoded: b64)
    }

    static func encode(_ daten: Data) -> String {
        daten.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

/// Was die Extension anzeigt.
public struct PushMeldung: Equatable, Sendable {
    public let titel: String
    public let untertitel: String?
    public let text: String?
    /// Gruppiert die Meldungen eines Einsatzes (`threadIdentifier`).
    public let thread: String
    /// Pfad, den das Antippen öffnet.
    public let pfad: String
    public let einsatzId: Int
}

/// Die Nutzlast einer Push-Nachricht lesen: erst den Umschlag, nach dem Entschlüsseln den
/// Klartext (`src/ios_push/inhalt.rs`). Die Entschlüsselung selbst gehört nicht in den Kern: unter
/// Linux gibt es kein CryptoKit; sie steht in der Extension der App.
public enum PushNutzlast {
    /// Der verschlüsselte Teil: `kennung` der Anmeldung (zugleich AAD), `nonce` (12 Byte) und
    /// `chiffrat` (Chiffrat gefolgt vom 16-Byte-Tag).
    public struct Umschlag: Equatable, Sendable {
        public let kennung: String
        public let nonce: Data
        public let chiffrat: Data
    }

    /// Liest den Umschlag `l` aus der APNs-Nutzlast: base64url eines JSON `{k, n, c}`. `nil` bei
    /// jedem Fehler.
    public static func umschlag(_ l: String) -> Umschlag? {
        guard let daten = Base64URL.decode(l),
            let json = try? JSONSerialization.jsonObject(with: daten) as? [String: Any],
            let kennung = json["k"] as? String, !kennung.isEmpty,
            let n = json["n"] as? String, let nonce = Base64URL.decode(n), nonce.count == 12,
            let c = json["c"] as? String, let chiffrat = Base64URL.decode(c), chiffrat.count >= 16
        else { return nil }
        return Umschlag(kennung: kennung, nonce: nonce, chiffrat: chiffrat)
    }

    /// Baut die Meldung aus dem entschlüsselten Klartext. Titel wie `pushInhalt` im Service Worker
    /// (`alarm-sw.js`): mit Absender „‹titel› · ‹absender›“; Text ist der Wortlaut, sonst das
    /// Detail. Der Name des Servers (`s`) steht nur bei mehr als einem Server im Untertitel. `nil`,
    /// wenn der Klartext kein Objekt mit Titel und Einsatz ist. `kennung` (die der Anmeldung)
    /// macht den Thread je Server eindeutig.
    public static func meldung(
        aus klartext: Data, serverAnzahl: Int, kennung: String? = nil
    ) -> PushMeldung? {
        guard let json = try? JSONSerialization.jsonObject(with: klartext) as? [String: Any],
            let titel = text(json["titel"]), let einsatz = ganzzahl(json["e"])
        else { return nil }
        let absender = text(json["absender"])
        return PushMeldung(
            titel: absender.map { "\(titel) · \($0)" } ?? titel,
            untertitel: serverAnzahl > 1 ? text(json["s"]) : nil,
            text: text(json["wortlaut"]) ?? text(json["detail"]),
            thread: kennung.map { "\($0)-\(einsatz)" } ?? "\(einsatz)",
            pfad: text(json["pfad"]) ?? "/einsaetze/\(einsatz)",
            einsatzId: einsatz)
    }

    /// Getrimmter Text; leer zählt als fehlend.
    private static func text(_ wert: Any?) -> String? {
        guard let text = (wert as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
            !text.isEmpty
        else { return nil }
        return text
    }

    private static func ganzzahl(_ wert: Any?) -> Int? {
        if wert is String || wert is Bool { return nil }
        if let zahl = wert as? Int { return zahl }
        if let zahl = wert as? Double { return Int(exactly: zahl) }
        return nil
    }
}
