import Foundation
import Network
import Security

/// Kleiner https-Server im Testprozess (LLH-1980): beantwortet jede Anfrage aus einer festen
/// Tabelle Pfad → Antwort und schließt danach die Verbindung. Das Zertifikat erzeugt
/// scripts/ios/testserver-zertifikat.sh bei jedem Lauf; dessen CA steht im Simulator als Wurzel,
/// die App vertraut dem Server also ohne Ausnahme im App-Code.
final class Testserver: @unchecked Sendable {
    struct Antwort: Sendable {
        let status: Int
        let contentType: String
        let cacheControl: String
        let koerper: Data
    }

    private let routen: [String: Antwort]
    private let warteschlange = DispatchQueue(label: "testserver")
    private var listener: NWListener?
    private var verbindungen: [NWConnection] = []
    private let schloss = NSLock()
    private var _abrufe: [String: Int] = [:]
    private var _angenommen = 0
    private var _verbindungsfehler: [String] = []

    /// Die Adresse, auf der der Server lauscht; das Zertifikat nennt sie als IP-SAN.
    static let host = "127.0.0.1"

    init(routen: [String: Antwort]) {
        self.routen = routen
    }

    /// Wie oft jeder Pfad angefragt wurde.
    var abrufe: [String: Int] {
        schloss.lock()
        defer { schloss.unlock() }
        return _abrufe
    }

    /// Für Meldungen roter Tests: kam die Verbindung beim Server an, und woran scheiterte sie dort
    /// (etwa am TLS-Handshake)?
    var bericht: String {
        schloss.lock()
        defer { schloss.unlock() }
        let fehler = _verbindungsfehler.isEmpty ? "keine" : _verbindungsfehler.joined(separator: "; ")
        return "Testserver: \(_angenommen) Verbindungen angenommen, Fehler: \(fehler)"
    }

    /// Startet auf 127.0.0.1 mit einem freien Port und liefert ihn.
    ///
    /// Gebunden an die Loopback-Adresse statt `acceptLocalOnly` („nur Verbindungen vom lokalen
    /// Link“): diese Einschränkung hängt am NECP-Client des Listeners, und im Simulator scheitert
    /// schon dessen Anmeldung (`nw_listener_socket_inbox_create_socket setsockopt
    /// SO_NECP_LISTENUUID failed`). Mit `acceptLocalOnly` kam kein Handshake zustande: der Webview
    /// sandte den ClientHello und bekam einen Reset, beim Wiederholen „server closed session with
    /// no notification“ (-1200, darunter -9816), ohne TLS-Alert und ohne eine Zeile des Servers zum
    /// Handshake im Systemprotokoll; bis zur Zertifikatsprüfung kam es nie (Lauf 45134034033).
    func start(port: NWEndpoint.Port = .any) async throws -> UInt16 {
        let tls = NWProtocolTLS.Options()
        guard let identitaet = sec_identity_create(try Self.identitaet()) else {
            throw Testserverfehler.identitaet(errSecParam)
        }
        sec_protocol_options_set_local_identity(tls.securityProtocolOptions, identitaet)
        let parameter = NWParameters(tls: tls)
        parameter.requiredLocalEndpoint = .hostPort(host: NWEndpoint.Host(Self.host), port: port)
        parameter.allowLocalEndpointReuse = true
        let listener = try NWListener(using: parameter)
        self.listener = listener
        listener.newConnectionHandler = { [weak self] verbindung in self?.bediene(verbindung) }
        return try await withCheckedThrowingContinuation { fortsetzung in
            // Der Handler läuft auf `warteschlange`; die Fortsetzung darf nur einmal kommen.
            let einmal = Einmal()
            listener.stateUpdateHandler = { zustand in
                switch zustand {
                case .ready:
                    if einmal.zum() { fortsetzung.resume(returning: listener.port?.rawValue ?? 0) }
                case .failed(let fehler):
                    if einmal.zum() { fortsetzung.resume(throwing: fehler) }
                default:
                    break
                }
            }
            listener.start(queue: warteschlange)
        }
    }

    /// Hält den Server an; offene Verbindungen brechen ab.
    func stop() {
        warteschlange.sync {
            listener?.cancel()
            listener = nil
            verbindungen.forEach { $0.cancel() }
            verbindungen = []
        }
    }

    private func bediene(_ verbindung: NWConnection) {
        verbindungen.append(verbindung)
        schloss.lock()
        _angenommen += 1
        schloss.unlock()
        verbindung.stateUpdateHandler = { [weak self] zustand in
            guard let self, case .failed(let fehler) = zustand else { return }
            self.schloss.lock()
            self._verbindungsfehler.append(String(describing: fehler))
            self.schloss.unlock()
        }
        verbindung.start(queue: warteschlange)
        lies(verbindung, bisher: Data())
    }

    private func lies(_ verbindung: NWConnection, bisher: Data) {
        verbindung.receive(minimumIncompleteLength: 1, maximumLength: 65_536) {
            [weak self] daten, _, ende, fehler in
            guard let self else { return }
            var gesamt = bisher
            if let daten { gesamt.append(daten) }
            if let kopfende = gesamt.range(of: Data("\r\n\r\n".utf8)) {
                let kopf = String(decoding: gesamt[..<kopfende.lowerBound], as: UTF8.self)
                self.antworte(verbindung, anfrage: kopf)
            } else if fehler == nil, !ende {
                self.lies(verbindung, bisher: gesamt)
            } else {
                verbindung.cancel()
            }
        }
    }

    private func antworte(_ verbindung: NWConnection, anfrage: String) {
        let zeile = anfrage.split(separator: "\r\n", maxSplits: 1).first ?? ""
        let teile = zeile.split(separator: " ")
        let pfad = teile.count >= 2 ? String(teile[1].split(separator: "?").first ?? "") : "/"
        schloss.lock()
        _abrufe[pfad, default: 0] += 1
        schloss.unlock()
        let antwort =
            routen[pfad]
            ?? Antwort(status: 404, contentType: "text/plain", cacheControl: "no-store", koerper: Data("fehlt".utf8))
        var kopf = "HTTP/1.1 \(antwort.status) \(antwort.status == 200 ? "OK" : "Not Found")\r\n"
        kopf += "Content-Type: \(antwort.contentType)\r\n"
        kopf += "Cache-Control: \(antwort.cacheControl)\r\n"
        kopf += "Content-Length: \(antwort.koerper.count)\r\n"
        kopf += "Connection: close\r\n\r\n"
        var daten = Data(kopf.utf8)
        daten.append(antwort.koerper)
        verbindung.send(content: daten, completion: .contentProcessed { _ in verbindung.cancel() })
    }

    /// Vertraut das System dem Serverzertifikat für `host`? `nil`, wenn ja, sonst der Grund. Dieselbe
    /// Prüfung macht der Webview; schlägt sie hier fehl, fehlt die Test-CA im Simulator
    /// (scripts/ios/simulator-pruefung.sh, `simctl keychain add-root-cert`).
    static func vertrauensfehler(host: String = Testserver.host) -> String? {
        do {
            var zertifikat: SecCertificate?
            let status = SecIdentityCopyCertificate(try identitaet(), &zertifikat)
            guard status == errSecSuccess, let zertifikat else {
                return "Zertifikat nicht lesbar (OSStatus \(status))"
            }
            var vertrauen: SecTrust?
            let erstellt = SecTrustCreateWithCertificates(
                zertifikat, SecPolicyCreateSSL(true, host as CFString), &vertrauen)
            guard erstellt == errSecSuccess, let vertrauen else {
                return "SecTrust nicht erstellt (OSStatus \(erstellt))"
            }
            var fehler: CFError?
            if SecTrustEvaluateWithError(vertrauen, &fehler) { return nil }
            return fehler.map { String(describing: $0) } ?? "nicht vertrauenswürdig"
        } catch {
            return String(describing: error)
        }
    }

    /// Die Identität aus `testserver.p12` (Ressource des Test-Targets).
    static func identitaet() throws -> SecIdentity {
        guard
            let url = Bundle(for: Testserver.self).url(forResource: "testserver", withExtension: "p12"),
            let daten = try? Data(contentsOf: url)
        else {
            throw Testserverfehler.zertifikatFehlt
        }
        var elemente: CFArray?
        let status = SecPKCS12Import(
            daten as CFData, [kSecImportExportPassphrase as String: "lifeline-test"] as CFDictionary,
            &elemente)
        guard status == errSecSuccess,
            let liste = elemente as? [[String: Any]],
            let eintrag = liste.first,
            let roh = eintrag[kSecImportItemIdentity as String]
        else { throw Testserverfehler.identitaet(status) }
        // Ein CFTypeRef aus dem Wörterbuch; der Typ steht durch kSecImportItemIdentity fest.
        return roh as! SecIdentity
    }
}

/// `true` genau beim ersten Aufruf.
private final class Einmal: @unchecked Sendable {
    private let schloss = NSLock()
    private var erledigt = false

    func zum() -> Bool {
        schloss.lock()
        defer { schloss.unlock() }
        if erledigt { return false }
        erledigt = true
        return true
    }
}

enum Testserverfehler: Error, CustomStringConvertible {
    case identitaet(OSStatus)
    case zertifikatFehlt

    var description: String {
        switch self {
        case .identitaet(let status): "testserver.p12 nicht lesbar (OSStatus \(status))"
        case .zertifikatFehlt:
            "testserver.p12 fehlt im Test-Target: scripts/ios/simulator-pruefung.sh erzeugt es "
                + "(scripts/ios/testserver-zertifikat.sh) und trägt die CA im Simulator ein."
        }
    }
}
