import Foundation
import LifelineKern

/// Fragt `GET /api/shell` (bei 404 dazu `GET /api/health`) und wertet die Antwort mit der
/// Vertragsprüfung des Kerns aus (Entwurf D4). Zertifikate prüft das System, ohne Ausnahmen
/// (Entwurf D2a): kein eigener Delegat für Authentifizierungs-Challenges.
enum Vertragsabruf {
    private static let session: URLSession = {
        let konfiguration = URLSessionConfiguration.ephemeral
        konfiguration.timeoutIntervalForRequest = 8
        konfiguration.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: konfiguration)
    }()

    /// Ergebnis und, nur für einen Server ohne Vertrag, die Version aus `/api/health`.
    static func check(_ adresse: ServerAdresse, letzterVertrag: Int?) async
        -> (Vertragsergebnis, healthVersion: String?)
    {
        let abruf = await fetch(endpoint("/api/shell", adresse))
        let ergebnis = Vertragspruefung.evaluate(abruf, letzterVertrag: letzterVertrag)
        guard case .nichtVertraeglich(.zuAlt, server: nil) = ergebnis,
            case .antwort(status: 404, _) = abruf
        else { return (ergebnis, nil) }
        guard case .antwort(status: 200, let body) = await fetch(endpoint("/api/health", adresse))
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
            return .antwort(status: (antwort as? HTTPURLResponse)?.statusCode ?? 0, body: daten)
        } catch let fehler as URLError {
            return .fehler(fehler.code)
        } catch {
            return .fehler(.unknown)
        }
    }
}
