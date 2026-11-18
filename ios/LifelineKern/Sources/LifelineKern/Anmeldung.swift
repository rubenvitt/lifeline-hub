import Foundation

/// PKCE (RFC 7636, S256) für „Im Browser anmelden“ (wie `src-tauri/src/pkce.rs`): Der `verifier`
/// bleibt in der App, nur die `challenge` geht an den Browser.
public enum PKCE {
    /// Neuer `verifier`: 32 Byte aus `SystemRandomNumberGenerator` (laut Swift-Standardbibliothek
    /// kryptographisch sicher, auf Apple-Systemen aus `arc4random_buf`), base64url ohne
    /// Auffüllung, 43 Zeichen.
    public static func neuerVerifier() -> String {
        var zufall = SystemRandomNumberGenerator()
        return base64url((0..<32).map { _ in UInt8.random(in: .min ... .max, using: &zufall) })
    }

    /// `base64url(SHA-256(verifier))` ohne Auffüllung, 43 Zeichen.
    public static func challenge(aus verifier: String) -> String {
        base64url(SHA256.hash(Array(verifier.utf8)))
    }

    static func base64url(_ bytes: [UInt8]) -> String {
        Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

/// SHA-256 nach FIPS 180-4. Eigene Umsetzung, weil CryptoKit unter Linux fehlt und der Kern dort
/// mit denselben Tests läuft wie auf iOS (NIST-Vektoren und RFC 7636 in `AnmeldungTests`).
enum SHA256 {
    private static let k: [UInt32] = [
        0x428a_2f98, 0x7137_4491, 0xb5c0_fbcf, 0xe9b5_dba5, 0x3956_c25b, 0x59f1_11f1, 0x923f_82a4,
        0xab1c_5ed5, 0xd807_aa98, 0x1283_5b01, 0x2431_85be, 0x550c_7dc3, 0x72be_5d74, 0x80de_b1fe,
        0x9bdc_06a7, 0xc19b_f174, 0xe49b_69c1, 0xefbe_4786, 0x0fc1_9dc6, 0x240c_a1cc, 0x2de9_2c6f,
        0x4a74_84aa, 0x5cb0_a9dc, 0x76f9_88da, 0x983e_5152, 0xa831_c66d, 0xb003_27c8, 0xbf59_7fc7,
        0xc6e0_0bf3, 0xd5a7_9147, 0x06ca_6351, 0x1429_2967, 0x27b7_0a85, 0x2e1b_2138, 0x4d2c_6dfc,
        0x5338_0d13, 0x650a_7354, 0x766a_0abb, 0x81c2_c92e, 0x9272_2c85, 0xa2bf_e8a1, 0xa81a_664b,
        0xc24b_8b70, 0xc76c_51a3, 0xd192_e819, 0xd699_0624, 0xf40e_3585, 0x106a_a070, 0x19a4_c116,
        0x1e37_6c08, 0x2748_774c, 0x34b0_bcb5, 0x391c_0cb3, 0x4ed8_aa4a, 0x5b9c_ca4f, 0x682e_6ff3,
        0x748f_82ee, 0x78a5_636f, 0x84c8_7814, 0x8cc7_0208, 0x90be_fffa, 0xa450_6ceb, 0xbef9_a3f7,
        0xc671_78f2,
    ]

    static func hash(_ nachricht: [UInt8]) -> [UInt8] {
        var h: [UInt32] = [
            0x6a09_e667, 0xbb67_ae85, 0x3c6e_f372, 0xa54f_f53a, 0x510e_527f, 0x9b05_688c,
            0x1f83_d9ab, 0x5be0_cd19,
        ]
        var daten = nachricht
        daten.append(0x80)
        while daten.count % 64 != 56 { daten.append(0) }
        let bits = UInt64(nachricht.count) &* 8
        for stelle in (0..<8).reversed() { daten.append(UInt8(truncatingIfNeeded: bits >> (stelle * 8))) }

        var w = [UInt32](repeating: 0, count: 64)
        for block in stride(from: 0, to: daten.count, by: 64) {
            for i in 0..<16 {
                let b = block + i * 4
                w[i] = UInt32(daten[b]) << 24 | UInt32(daten[b + 1]) << 16 | UInt32(daten[b + 2]) << 8
                    | UInt32(daten[b + 3])
            }
            for i in 16..<64 {
                let s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3)
                let s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10)
                w[i] = w[i - 16] &+ s0 &+ w[i - 7] &+ s1
            }
            var (a, b, c, d, e, f, g, hh) = (h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7])
            for i in 0..<64 {
                let s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
                let ch = (e & f) ^ (~e & g)
                let t1 = hh &+ s1 &+ ch &+ k[i] &+ w[i]
                let s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
                let maj = (a & b) ^ (a & c) ^ (b & c)
                let t2 = s0 &+ maj
                (hh, g, f, e, d, c, b, a) = (g, f, e, d &+ t1, c, b, a, t1 &+ t2)
            }
            for (i, wert) in [a, b, c, d, e, f, g, hh].enumerated() { h[i] = h[i] &+ wert }
        }
        return h.flatMap { wort in (0..<4).map { UInt8(truncatingIfNeeded: wort >> (24 - $0 * 8)) } }
    }

    private static func rotr(_ x: UInt32, _ n: UInt32) -> UInt32 { x >> n | x << (32 - n) }
}

/// Reine Schritte rund um die Anmeldesitzung (wie `src-tauri/src/anmeldung.rs`; Entwurf D7, Spec
/// `ios-huelle`, „Die App meldet sich im Systembrowser an“). Den Code löst die Seite des Servers im
/// Webview ein, weil nur dort der Datenspeicher liegt, in dem die Sitzung entstehen muss.
public enum Anmeldung {
    /// Pfad der Anmeldeseite, auf der die App einlöst.
    public static let anmeldeseite = "/login"
    /// Pfad der Bestätigungsseite im Browser (`frontend/src/pages/AppAnmeldungPage.tsx`).
    public static let bestaetigung = "/app-anmeldung"
    /// Ereignis, mit dem die App der Seite das Ergebnis meldet; es trägt nie Code oder `verifier`.
    public static let ereignis = "lifeline:app-anmeldung"
    /// Host des Rücksprungs `lifeline://anmeldung?code=…`.
    public static let ruecksprungHost = "anmeldung"

    /// Kennwörter von `AppAnmeldungErgebnis` in `frontend/src/huelle/faehigkeiten.ts`.
    public enum Ergebnis: String, CaseIterable, Sendable {
        case angemeldet
        case abgelehnt
        case fehler
        case abgebrochen
    }

    /// Wie die Sitzung endete.
    public enum Ende: Equatable, Sendable {
        /// Rücksprung-URL aus der Sitzung (nur die Sitzung liefert ihn, nie `onOpenURL`).
        case ruecksprung(String)
        /// Die Person hat abgebrochen (`ASWebAuthenticationSessionError.canceledLogin`).
        case abgebrochen
        case fehler
    }

    public enum Folge: Equatable, Sendable {
        /// Den Code im Webview einlösen.
        case einloesen(String)
        /// Nur ein Ergebnis melden, ohne Geheimnis.
        case melden(Ergebnis)
        /// Nichts tun: der Webview zeigt keine Seite des Servers (bzw. beim Einlösen nicht die
        /// Anmeldeseite), Code und `verifier` bleiben draußen.
        case nichts
    }

    /// Bestätigungsseite auf der Origin des Servers mit der `challenge`.
    public static func bestaetigungURL(server: ServerAdresse, challenge: String) -> URL {
        var teile = URLComponents()
        teile.scheme = "https"
        teile.host = server.host
        teile.port = server.url.port
        teile.path = bestaetigung
        teile.queryItems = [URLQueryItem(name: "challenge", value: challenge)]
        return teile.url!
    }

    /// Code aus `lifeline://anmeldung?code=<64 hex klein>`; alles andere `nil`.
    public static func code(ausRuecksprung ruecksprung: String) -> String? {
        guard let teile = URLComponents(string: ruecksprung),
            teile.scheme?.lowercased() == Deeplink.schema,
            teile.percentEncodedHost == ruecksprungHost,
            ["", "/"].contains(teile.percentEncodedPath),
            let code = teile.queryItems?.first(where: { $0.name == "code" })?.value,
            code.count == 64,
            code.allSatisfy({ ("0"..."9").contains($0) || ("a"..."f").contains($0) })
        else { return nil }
        return code
    }

    /// Entscheidet über das Ende der Sitzung. `seite` ist die aktuelle Adresse des Webviews, in dem
    /// die Anmeldung begann (`nil`, wenn es ihn nicht mehr gibt).
    public static func folge(_ ende: Ende, seite: URL?, server: ServerAdresse) -> Folge {
        guard let seite, Linkregeln.belongsToServer(server.url, seite: seite) else { return .nichts }
        let ruecksprung: String
        switch ende {
        case .abgebrochen: return .melden(.abgebrochen)
        case .fehler: return .melden(.fehler)
        case .ruecksprung(let url): ruecksprung = url
        }
        guard let code = code(ausRuecksprung: ruecksprung) else { return .melden(.fehler) }
        // Nur dort hört die Seite auf das Ergebnis; wer inzwischen anders angemeldet
        // weiterarbeitet, verliert seine Sitzung nicht an einen späten Rücksprung.
        return seite.path == anmeldeseite ? .einloesen(code) : .nichts
    }

    /// Skript, das den Code im Webview einlöst und das Ergebnis als `ereignis` meldet. Die Origin
    /// prüft es noch einmal, weil die Seite zwischen Prüfung und Ausführung wechseln kann. Endet
    /// auf `0`, weil `evaluateJavaScript` bei einem Promise als Ergebnis einen Fehler meldet.
    public static func einloeseSkript(server: ServerAdresse, code: String, verifier: String) -> String {
        let origin = literal(origin(server))
        let (code, verifier, ereignis) = (literal(code), literal(verifier), literal(ereignis))
        return "(() => { const melden = (ergebnis) => window.dispatchEvent(new CustomEvent(\(ereignis), "
            + "{ detail: { ergebnis } })); if (window.location.origin !== \(origin)) return; "
            + "fetch('/api/auth/app-code/einloesen', { method: 'POST', credentials: 'same-origin', "
            + "headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: \(code), "
            + "verifier: \(verifier) }) }).then((antwort) => melden(antwort.ok ? 'angemeldet' : "
            + "antwort.status === 401 ? 'abgelehnt' : 'fehler')).catch(() => melden('fehler')); })(); 0;"
    }

    /// Skript, das nur ein Ergebnis meldet (Abbruch, Fehler vor dem Einlösen).
    public static func meldungSkript(_ ergebnis: Ergebnis) -> String {
        "window.dispatchEvent(new CustomEvent(\(literal(ereignis)), { detail: { ergebnis: "
            + "\(literal(ergebnis.rawValue)) } })); 0;"
    }

    /// `https://host[:port]` wie `window.location.origin`.
    static func origin(_ server: ServerAdresse) -> String {
        server.url.port.map { "https://\(server.host):\($0)" } ?? "https://\(server.host)"
    }

    /// JSON-String als JS-Literal (maskiert auch `/`, also `</script>`).
    static func literal(_ text: String) -> String {
        let daten = (try? JSONEncoder().encode(text)) ?? Data("\"\"".utf8)
        return String(decoding: daten, as: UTF8.self)
    }
}

/// Die laufende Anmeldesitzung mit ihrer Generation (wie `anmeldung::Lauf` der Desktop-Hülle).
/// Der Handler einer ersetzten Sitzung kann nach dem Start der neuen eintreffen und darf diese
/// nicht beenden.
public struct Anmeldelauf<Wert> {
    private var generation: UInt64 = 0
    private var laufend: (UInt64, Wert)?

    public init() {}

    /// Nächste Generation, bevor die Sitzung gebaut wird (ihr Handler braucht sie).
    public mutating func naechste() -> UInt64 {
        generation += 1
        return generation
    }

    public mutating func merke(_ generation: UInt64, _ wert: Wert) {
        laufend = (generation, wert)
    }

    /// Nimmt die laufende Sitzung heraus, gleich welcher Generation (zum Abbrechen).
    public mutating func nimm() -> Wert? {
        defer { laufend = nil }
        return laufend?.1
    }

    /// Nimmt die Sitzung nur heraus, wenn sie zu `generation` gehört.
    public mutating func beende(_ generation: UInt64) -> Wert? {
        guard laufend?.0 == generation else { return nil }
        return nimm()
    }
}
