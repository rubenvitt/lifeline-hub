import Foundation
import LifelineKern

/// Fragt `GET /api/shell` (bei 404 dazu `GET /api/health`) und wertet die Antwort mit der
/// Vertragsprüfung des Kerns aus (Entwurf D4). Zertifikate prüft das System, ohne Ausnahmen
/// (Entwurf D2a): kein eigener Delegat für Authentifizierungs-Challenges. Weiterleitungen auf eine
/// fremde Origin (Captive Portal, Auth-Proxy) verfolgt der Abruf nicht; ihre 3xx und eine 200 ohne
/// JSON wertet der Kern wie ohne Verbindung.
enum Vertragsabruf {
    private static let session: URLSession = {
        let konfiguration = URLSessionConfiguration.ephemeral
        konfiguration.timeoutIntervalForRequest = 8
        konfiguration.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(
            configuration: konfiguration, delegate: Umleitungssperre(), delegateQueue: nil)
    }()

    /// Ergebnis und, nur für einen Server ohne Vertrag, die Version aus `/api/health`.
    static func check(_ adresse: ServerAdresse, letzterVertrag: Int?) async
        -> (Vertragsergebnis, healthVersion: String?)
    {
        let abruf = await fetch(endpoint("/api/shell", adresse))
        let ergebnis = Vertragspruefung.evaluate(abruf, letzterVertrag: letzterVertrag)
        guard case .nichtVertraeglich(.zuAlt, server: nil) = ergebnis,
            case .antwort(status: 404, _, _) = abruf
        else { return (ergebnis, nil) }
        guard case .antwort(status: 200, let body, _) = await fetch(endpoint("/api/health", adresse))
        else { return (ergebnis, nil) }
        return (ergebnis, try? HealthInfo(json: body).version)
    }

    /// Die API liegt an der Wurzel des Servers, auch wenn die Adresse einen Pfad trägt.
    static func endpoint(_ pfad: String, _ adresse: ServerAdresse) -> URL {
        URL(string: pfad, relativeTo: adresse.url)!.absoluteURL
    }

    private static func fetch(_ url: URL) async -> ShellAbruf {
        do {
            let (daten, antwort) = try await session.data(from: url)
            let http = antwort as? HTTPURLResponse
            return .antwort(
                status: http?.statusCode ?? 0, body: daten,
                contentType: http?.value(forHTTPHeaderField: "Content-Type"))
        } catch let fehler as URLError {
            return .fehler(fehler.code)
        } catch {
            return .fehler(.unknown)
        }
    }
}

/// Folgt nur Weiterleitungen auf derselben Origin (`Vertragspruefung.followsRedirect`). `nil`
/// beendet die Aufgabe mit der 3xx-Antwort selbst als Ergebnis.
final class Umleitungssperre: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(
        _ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest
    ) async -> URLRequest? {
        let von = task.originalRequest?.url ?? response.url
        return Vertragspruefung.followsRedirect(von: von, nach: request.url) ? request : nil
    }
}

extension Vertragsabruf {
    /// `POST /api/ios-push/unregister` beim Entfernen eines Servers (Entwurf „iOS-Alarme über
    /// APNs“): die einzige native Anfrage an einen Server, die keine Seite lädt. Ohne Sitzung, mit
    /// dem Nachweis aus dem Schlüssel; einmal je Anlass, ohne Wiederholen. Liefert den Status
    /// (`nil` ohne Antwort), über den `AusstehendeAbmeldung.isErledigt` entscheidet; gleiche
    /// Sitzung wie der Abruf (keine Weiterleitung auf eine fremde Origin).
    static func meldePushAb(_ adresse: ServerAdresse, kennung: String, nachweis: String) async
        -> Int?
    {
        var anfrage = URLRequest(url: endpoint("/api/ios-push/unregister", adresse))
        anfrage.httpMethod = "POST"
        anfrage.setValue("application/json", forHTTPHeaderField: "Content-Type")
        anfrage.httpBody = try? JSONSerialization.data(withJSONObject: [
            "kennung": kennung, "nachweis": nachweis,
        ])
        guard let (_, antwort) = try? await session.data(for: anfrage) else { return nil }
        return (antwort as? HTTPURLResponse)?.statusCode
    }
}
