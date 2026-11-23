import Foundation

/// base64url ohne Auffüllung (RFC 4648 §5), wie ihn Server und Relais für Push schreiben. Öffentlich
/// für die App (Schlüssel an die Seite, Nachweis beim Abmelden).
public enum Base64URL {
    public static func decode(_ text: String) -> Data? {
        var b64 = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        guard !b64.contains("=") else { return nil }
        b64 += String(repeating: "=", count: (4 - b64.count % 4) % 4)
        return Data(base64Encoded: b64)
    }

    public static func encode(_ daten: Data) -> String {
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
    /// Gruppiert die Meldungen eines Einsatzes (`threadIdentifier`); die ohne Einsatz in einem
    /// Thread je Server (`<kennung>-org`, LLH-2077).
    public let thread: String
    /// Pfad, den das Antippen öffnet.
    public let pfad: String
    /// `nil` bei einer Meldung ohne Einsatz (Störung einer Anbindung).
    public let einsatzId: Int?
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

    /// Der Klartext wie `ios_push::inhalt::Klartext`. Gelesen mit `JSONDecoder`, nicht mit
    /// `JSONSerialization`: dort brückt Darwin jede Zahl 0 oder 1 auch zu `Bool`, und Einsatz 1
    /// ginge verloren. `e` fehlt ohne Einsatz (LLH-2077); steht es da, muss es eine ganze Zahl sein
    /// (`true` und `"1"` nicht). Ein Textfeld mit falschem Typ zählt als fehlend wie ein leeres.
    struct Klartext: Decodable {
        let v: Int?
        let s: String?
        let e: Int?
        let b: Int?
        let stufe: String?
        let titel: String?
        let detail: String?
        let pfad: String?
        let absender: String?
        let wortlaut: String?

        private enum CodingKeys: String, CodingKey {
            case v, s, e, b, stufe, titel, detail, pfad, absender, wortlaut
        }

        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            e = try c.decodeIfPresent(Int.self, forKey: .e)
            func zahl(_ k: CodingKeys) -> Int? { (try? c.decodeIfPresent(Int.self, forKey: k)) ?? nil }
            func text(_ k: CodingKeys) -> String? {
                let roh = (try? c.decodeIfPresent(String.self, forKey: k)) ?? nil
                let text = roh?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                return text.isEmpty ? nil : text
            }
            v = zahl(.v)
            b = zahl(.b)
            s = text(.s)
            stufe = text(.stufe)
            titel = text(.titel)
            detail = text(.detail)
            pfad = text(.pfad)
            absender = text(.absender)
            wortlaut = text(.wortlaut)
        }
    }

    /// Baut die Meldung aus dem entschlüsselten Klartext. Titel wie `pushInhalt` im Service Worker
    /// (`alarm-sw.js`): mit Absender „‹titel› · ‹absender›“; Text ist der Wortlaut, sonst das
    /// Detail. Der Name des Servers (`s`) steht nur bei mehr als einem Server im Untertitel. `nil`,
    /// wenn der Klartext kein Objekt mit Titel ist. `kennung` (die der Anmeldung) macht den Thread
    /// je Server eindeutig. Ohne Einsatz gruppiert der Thread `org`, und ohne Pfad geht es wie im
    /// Service Worker zu den Anbindungen. Leere Texte zählen als fehlend.
    public static func meldung(
        aus klartext: Data, serverAnzahl: Int, kennung: String? = nil
    ) -> PushMeldung? {
        guard let k = try? JSONDecoder().decode(Klartext.self, from: klartext),
            let titel = k.titel
        else { return nil }
        let gruppe = k.e.map(String.init) ?? "org"
        return PushMeldung(
            titel: k.absender.map { "\(titel) · \($0)" } ?? titel,
            untertitel: serverAnzahl > 1 ? k.s : nil,
            text: k.wortlaut ?? k.detail,
            thread: kennung.map { "\($0)-\(gruppe)" } ?? gruppe,
            pfad: k.pfad ?? k.e.map { "/einsaetze/\($0)" } ?? "/admin/einstellungen/anbindungen",
            einsatzId: k.e)
    }
}
