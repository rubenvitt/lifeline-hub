import Foundation
import HelferKern
import os

/// Antwort des Servers; `status` 0 heißt Netzfehler ohne Antwort (wie `entscheide(status:grund:)`).
struct Rueckmeldung: Sendable {
    let status: Int
    let daten: Data

    static let netzfehler = Rueckmeldung(status: 0, daten: Data())

    var antwort: Antwort { entscheide(status: status, grund: grund) }
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

/// Folgt keiner Weiterleitung (ADR-0098: nur der Server der Kopplung). Das `Cookie` setzt die
/// Verbindung von Hand; `URLSession` kopierte es beim Folgen in die Anfrage an die neue Adresse.
/// Ohne neue Anfrage endet die Aufgabe mit der 3xx-Antwort selbst, die wie ein Serverfehler gilt
/// (`entscheide`: wiederholen).
final class OhneWeiterleitung: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(
        _ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest
    ) async -> URLRequest? {
        nil
    }
}

/// Verbindung zum Server der einen Kopplung (ADR-0098: nur an diesen Server und nur mit der
/// Sitzung dieser Kopplung, ohne Weiterleitungen). Eine eigene `URLSession` ohne gemeinsamen
/// Cookie-Speicher: das Cookie `lifeline_sid` nimmt die Verbindung aus `Set-Cookie` selbst an und
/// schickt es selbst mit, die Ablage ist der Schlüsselbund (`Sitzungsablage`). So landet es nie in
/// einer Datei des Systems.
@MainActor
final class Serververbindung {
    /// `SESSION_COOKIE` in src/auth/session.rs.
    static let cookieName = "lifeline_sid"

    /// Eine Sitzung für alle Verbindungen: ohne Cookie-Speicher und Cache, ohne Weiterleitungen.
    /// Geteilt, weil eine `URLSession` mit Delegate bis zum `invalidate` lebt.
    nonisolated static let session: URLSession = {
        let konfiguration = URLSessionConfiguration.ephemeral
        konfiguration.httpCookieAcceptPolicy = .never
        konfiguration.httpShouldSetCookies = false
        konfiguration.httpCookieStorage = nil
        konfiguration.urlCache = nil
        konfiguration.timeoutIntervalForRequest = 20
        konfiguration.httpAdditionalHeaders = [
            "Accept": "application/json",
            "User-Agent": kennung,
        ]
        return URLSession(
            configuration: konfiguration, delegate: OhneWeiterleitung(), delegateQueue: nil)
    }()

    private nonisolated static let protokoll = Logger(
        subsystem: "dev.rubeen.lifeline.helfer", category: "Serververbindung")

    let server: URL
    private(set) var cookie: String?

    init(server: URL, cookie: String?) {
        self.server = server
        self.cookie = cookie
    }

    /// Eigene Kennung und Version, damit der Server die Helfer-App erkennt.
    nonisolated static var kennung: String {
        let version =
            Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
        return "LifelineHelfer/\(version) (\(build); iOS)"
    }

    // MARK: Routen (src/app.rs)

    /// Zielliste der Einladung; der Code steht im Body, nie in der Adresse (Zugriffsprotokolle).
    func ziele(code: String) async -> Rueckmeldung {
        await anfrage("POST", "api/devices/helpers/targets", body: Zielanfrage(code: code))
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
        _ methode: String, _ pfad: String, body: (any Encodable & Sendable)? = nil
    ) async -> Rueckmeldung {
        let url = server.appendingPathComponent(pfad)
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
            let (daten, antwort) = try await Self.session.data(for: request)
            guard let http = antwort as? HTTPURLResponse else { return .netzfehler }
            if (300...399).contains(http.statusCode) {
                // Nicht gefolgt (`OhneWeiterleitung`); das Ziel steht nicht im Protokoll.
                Self.protokoll.warning(
                    "Weiterleitung \(http.statusCode, privacy: .public) nicht verfolgt: \(methode, privacy: .public) \(pfad, privacy: .public)")
                return Rueckmeldung(status: http.statusCode, daten: Data())
            }
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
