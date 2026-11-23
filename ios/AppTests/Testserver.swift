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

    init(routen: [String: Antwort]) {
        self.routen = routen
    }

    /// Wie oft jeder Pfad angefragt wurde.
    var abrufe: [String: Int] {
        schloss.lock()
        defer { schloss.unlock() }
        return _abrufe
    }

    /// Startet auf 127.0.0.1 mit einem freien Port und liefert ihn.
    func start(port: NWEndpoint.Port = .any) async throws -> UInt16 {
        let tls = NWProtocolTLS.Options()
        sec_protocol_options_set_local_identity(
            tls.securityProtocolOptions, try Self.identitaet())
        let parameter = NWParameters(tls: tls)
        parameter.acceptLocalOnly = true
        parameter.allowLocalEndpointReuse = true
        let listener = try NWListener(using: parameter, on: port)
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

    /// Die Identität aus `testserver.p12` (Ressource des Test-Targets).
    static func identitaet() throws -> sec_identity_t {
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
            let roh = eintrag[kSecImportItemIdentity as String],
            let identitaet = sec_identity_create(roh as! SecIdentity)
        else { throw Testserverfehler.identitaet(status) }
        return identitaet
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
