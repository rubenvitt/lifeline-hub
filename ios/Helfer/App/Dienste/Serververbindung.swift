import Foundation
import HelferKern

/// Antwort des Servers; `status` 0 heißt Netzfehler ohne Antwort (wie `entscheide(status:)`).
struct Rueckmeldung: Sendable {
    let status: Int
    let daten: Data

    static let netzfehler = Rueckmeldung(status: 0, daten: Data())

    var antwort: Antwort { entscheide(status: status) }
    var istErfolg: Bool { (200...299).contains(status) }

    func dekodiert<T: Decodable>(_ typ: T.Type) -> T? {
        try? Wire.decoder.decode(T.self, from: daten)
    }

    /// `error` des Fehler-Bodys (`{error, reason?}`), für die Anzeige.
    var fehlertext: String? { feld("error") }
    /// `reason` des Fehler-Bodys, etwa `tracking_off`.
    var grund: String? { feld("reason") }

    private func feld(_ name: String) -> String? {
        guard let objekt = try? JSONSerialization.jsonObject(with: daten) as? [String: Any]
        else { return nil }
        return objekt[name] as? String
    }
}

/// Verbindung zum Server der einen Kopplung (ADR-0098: nur an diesen Server und nur mit der
/// Sitzung dieser Kopplung). Eine eigene `URLSession` ohne gemeinsamen Cookie-Speicher: das Cookie
/// `lifeline_sid` nimmt die Verbindung aus `Set-Cookie` selbst an und schickt es selbst mit, die
/// Ablage ist der Schlüsselbund (`Sitzungsablage`). So landet es nie in einer Datei des Systems.
@MainActor
final class Serververbindung {
    /// `SESSION_COOKIE` in src/auth/session.rs.
    static let cookieName = "lifeline_sid"

    let server: URL
    private(set) var cookie: String?
    private let session: URLSession

    init(server: URL, cookie: String?) {
        self.server = server
        self.cookie = cookie
        let konfiguration = URLSessionConfiguration.ephemeral
        konfiguration.httpCookieAcceptPolicy = .never
        konfiguration.httpShouldSetCookies = false
        konfiguration.httpCookieStorage = nil
        konfiguration.urlCache = nil
        konfiguration.timeoutIntervalForRequest = 20
        konfiguration.httpAdditionalHeaders = [
            "Accept": "application/json",
            "User-Agent": Self.kennung,
        ]
        session = URLSession(configuration: konfiguration)
    }

    /// Eigene Kennung und Version, damit der Server die Helfer-App erkennt.
    static var kennung: String {
        let version =
            Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
        return "LifelineHelfer/\(version) (\(build); iOS)"
    }

    // MARK: Routen (src/app.rs)

    func ziele(code: String) async -> Rueckmeldung {
        await anfrage("GET", "api/devices/helpers/targets", query: [URLQueryItem(name: "code", value: code)])
    }

    func einloesen(_ einloesung: Einloesung) async -> Rueckmeldung {
        await anfrage("POST", "api/devices/helpers/redeem", body: einloesung)
    }

    func zustand() async -> Rueckmeldung {
        await anfrage("GET", "api/devices/me")
    }

    func zielAendern(_ ziel: ZielEingabe) async -> Rueckmeldung {
        await anfrage("PUT", "api/devices/me", body: Zielaenderung(target: ziel))
    }

    func sende(_ position: Position) async -> Rueckmeldung {
        await anfrage("PUT", "api/devices/me/position", body: Positionssendung(position))
    }

    func pausiere(_ pausiert: Bool) async -> Rueckmeldung {
        await anfrage("PUT", "api/devices/me/position", body: Pausensendung(paused: pausiert))
    }

    func abmelden() async -> Rueckmeldung {
        let antwort = await anfrage("POST", "api/auth/logout")
        cookie = nil
        return antwort
    }

    // MARK: Anfrage

    private func anfrage(
        _ methode: String, _ pfad: String, query: [URLQueryItem] = [],
        body: (any Encodable & Sendable)? = nil
    ) async -> Rueckmeldung {
        guard var teile = URLComponents(url: server.appendingPathComponent(pfad), resolvingAgainstBaseURL: false)
        else { return .netzfehler }
        if !query.isEmpty { teile.queryItems = query }
        guard let url = teile.url else { return .netzfehler }
        var request = URLRequest(url: url)
        request.httpMethod = methode
        if let body {
            guard let daten = try? Wire.encoder.encode(body) else { return .netzfehler }
            request.httpBody = daten
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let cookie {
            request.setValue("\(Self.cookieName)=\(cookie)", forHTTPHeaderField: "Cookie")
        }
        do {
            let (daten, antwort) = try await session.data(for: request)
            guard let http = antwort as? HTTPURLResponse else { return .netzfehler }
            uebernimmCookie(aus: http, url: url)
            return Rueckmeldung(status: http.statusCode, daten: daten)
        } catch {
            return .netzfehler
        }
    }

    /// Nimmt ein neues `lifeline_sid` aus `Set-Cookie` an; ein leeres oder abgelaufenes löscht es.
    private func uebernimmCookie(aus antwort: HTTPURLResponse, url: URL) {
        guard let kopf = antwort.value(forHTTPHeaderField: "Set-Cookie") else { return }
        let cookies = HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": kopf], for: url)
        guard let neu = cookies.first(where: { $0.name == Self.cookieName }) else { return }
        if neu.value.isEmpty || (neu.expiresDate.map { $0 <= Date() } ?? false) {
            cookie = nil
        } else {
            cookie = neu.value
        }
    }
}
