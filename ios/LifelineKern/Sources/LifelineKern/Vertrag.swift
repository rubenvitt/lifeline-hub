import Foundation

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

/// Antwort von `GET /api/shell` (OpenAPI-Schema `ShellInfo`, Spec `huellen-vertrag`). Neue Felder
/// des Servers ignoriert die App; die Namen auf dem Draht sind fest.
public struct ShellInfo: Decodable, Equatable, Sendable {
    public let version: String
    public let shellContract: Int

    public init(version: String, shellContract: Int) {
        self.version = version
        self.shellContract = shellContract
    }

    enum CodingKeys: String, CodingKey {
        case version
        case shellContract = "shell_contract"
    }
}

/// Die Version aus `GET /api/health`, für die Seite „Server ist zu alt für diese App“.
public struct HealthInfo: Decodable, Equatable, Sendable {
    public let version: String

    public init(json: Data) throws {
        self = try JSONDecoder().decode(HealthInfo.self, from: json)
    }
}

/// Warum die App die Oberfläche eines Servers nicht lädt; je Klasse eine native Seite
/// (Entwurf D2a, D4).
public enum Fehlerklasse: Equatable, Sendable {
    /// Das System vertraut dem Zertifikat nicht (CA-Profil fehlt oder ist nicht eingeschaltet).
    case zertifikat
    /// Keine Verbindung; die App prüft weiter und lädt von selbst.
    case nichtErreichbar
    /// Der Server kennt den Vertrag nicht oder spricht einen kleineren: „Server ist zu alt“.
    case zuAlt
    /// Der Server spricht einen größeren Vertrag: „App aktualisieren“.
    case zuNeu

    /// Ordnet einen Fehler von URLSession bzw. `didFailProvisionalNavigation` ein. Nur die
    /// Zertifikatsfehler des Servers (`NSURLErrorServerCertificate*`) bekommen die eigene Seite.
    public init(_ code: URLError.Code) {
        switch code {
        case .serverCertificateUntrusted, .serverCertificateHasUnknownRoot,
            .serverCertificateHasBadDate, .serverCertificateNotYetValid:
            self = .zertifikat
        default:
            self = .nichtErreichbar
        }
    }
}

/// Was die App beim Abruf von `GET /api/shell` erlebt hat.
public enum ShellAbruf: Sendable {
    case antwort(status: Int, body: Data)
    case fehler(URLError.Code)
}

public enum Vertragsergebnis: Equatable, Sendable {
    /// Die App lädt die Oberfläche.
    case vertraeglich(ShellInfo)
    /// `zuAlt` oder `zuNeu`; `server` fehlt, wenn der Server keinen Vertrag nannte oder nur der
    /// zuletzt bestätigte galt.
    case nichtVertraeglich(Fehlerklasse, server: ShellInfo?)
    /// `zertifikat` oder `nichtErreichbar`.
    case nichtErreichbar(Fehlerklasse)

    public var fehlerklasse: Fehlerklasse? {
        switch self {
        case .vertraeglich: nil
        case .nichtVertraeglich(let klasse, _), .nichtErreichbar(let klasse): klasse
        }
    }
}

/// Prüft, ob die App mit einem Server arbeiten kann (Entwurf D4): bei jedem Start, Wechsel,
/// Neuladen nach Rückkehr in den Vordergrund und im Onboarding.
public enum Vertragspruefung {
    public static func evaluate(
        _ abruf: ShellAbruf, letzterVertrag: Int?,
        bekannt: [Int] = LifelineKern.bekannteVertraege
    ) -> Vertragsergebnis {
        switch abruf {
        case .antwort(status: 200, let body):
            // Eine 200 ohne lesbaren Vertrag ist ein Server ohne Vertrag, also zu alt.
            guard let info = try? JSONDecoder().decode(ShellInfo.self, from: body) else {
                return .nichtVertraeglich(.zuAlt, server: nil)
            }
            if let richtung = richtung(info.shellContract, bekannt: bekannt) {
                return .nichtVertraeglich(richtung, server: info)
            }
            return .vertraeglich(info)
        case .antwort(status: 404, _):
            return .nichtVertraeglich(.zuAlt, server: nil)
        case .antwort:
            // Ein Proxy oder ein startender Server: wie ohne Verbindung.
            return ohneVerbindung(.nichtErreichbar, letzterVertrag: letzterVertrag, bekannt: bekannt)
        case .fehler(let code):
            let klasse = Fehlerklasse(code)
            if klasse == .zertifikat { return .nichtErreichbar(.zertifikat) }
            return ohneVerbindung(klasse, letzterVertrag: letzterVertrag, bekannt: bekannt)
        }
    }

    /// Richtung eines unbekannten Vertrags; `nil`, wenn die App ihn kennt.
    public static func richtung(_ vertrag: Int, bekannt: [Int]) -> Fehlerklasse? {
        if bekannt.contains(vertrag) { return nil }
        return vertrag > (bekannt.max() ?? 0) ? .zuNeu : .zuAlt
    }

    /// Ohne Verbindung gilt der zuletzt bestätigte Vertrag dieses Servers.
    private static func ohneVerbindung(
        _ klasse: Fehlerklasse, letzterVertrag: Int?, bekannt: [Int]
    ) -> Vertragsergebnis {
        if let letzterVertrag, let richtung = richtung(letzterVertrag, bekannt: bekannt) {
            return .nichtVertraeglich(richtung, server: nil)
        }
        return .nichtErreichbar(klasse)
    }
}
