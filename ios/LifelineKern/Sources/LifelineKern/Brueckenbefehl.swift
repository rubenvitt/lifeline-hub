import Foundation

/// Ein Befehl der Seite an die Hülle (Wire-Format im Kopf von `ios/App/Huelle/huelle.js`). Die
/// Wire-Namen sind englisch und fest.
public enum Brueckenbefehl: Equatable, Sendable {
    /// Feuern und vergessen, ohne Antwort; `kind` ist ungeprüft (`Haptik.feedback`).
    case haptics(kind: String)
    case showNotification(id: Int, title: String, body: String?)
    /// `count` ≥ 0; 0 nimmt die Zahl weg.
    case setAppBadge(id: Int, count: Int)
    case print(id: Int)
    case signInWithBrowser(id: Int)
    /// Meldet die App am Push-Kanal an (Antwort: Kennung, Token, Umgebung, Schlüssel).
    case pushRegister(id: Int)
    case pushUnregister(id: Int)
    case pushState(id: Int)
    /// Unbekannter Befehl oder fehlerhafte Felder; die Seite bekommt eine Ablehnung.
    case ungueltig(id: Int, grund: String)
}

/// Wert einer erfüllten Antwort; mehr braucht die Brücke nicht.
public enum Antwortwert: Equatable, Sendable {
    case null
    case bool(Bool)
    /// JSON-Objekt aus Textwerten (`push_register`, `push_state`).
    case objekt([String: String])
}

/// Antwort an die Seite: `window.__LIFELINE_REPLY__(id, fehler, wert)`.
public struct Brueckenantwort: Equatable, Sendable {
    public let id: Int
    /// `nil` erfüllt das Versprechen der Seite, sonst lehnt es mit diesem Text ab.
    public let fehler: String?
    public let wert: Antwortwert

    public init(id: Int, fehler: String?, wert: Antwortwert) {
        self.id = id
        self.fehler = fehler
        self.wert = wert
    }
}

extension Bruecke {
    /// Liest den `body` einer `WKScriptMessage` (ein Wörterbuch aus dem JS-Objekt, Zahlen als
    /// `NSNumber`). `nil`, wenn die Nachricht weder `haptics` ist noch eine ganzzahlige `id`
    /// trägt: dann gibt es niemanden, dem die Hülle antworten könnte.
    public static func parse(_ body: Any) -> Brueckenbefehl? {
        guard let nachricht = body as? [String: Any], let cmd = nachricht["cmd"] as? String else {
            return nil
        }
        if cmd == "haptics" { return .haptics(kind: nachricht["kind"] as? String ?? "") }
        guard let id = ganzzahl(nachricht["id"]) else { return nil }
        switch cmd {
        case "show_notification":
            guard let title = nachricht["title"] as? String else {
                return .ungueltig(id: id, grund: "Der Meldung fehlt der Titel.")
            }
            return .showNotification(id: id, title: title, body: nachricht["body"] as? String)
        case "set_app_badge":
            guard let count = ganzzahl(nachricht["count"]), count >= 0 else {
                return .ungueltig(id: id, grund: "Die Zahl am Symbol muss eine ganze Zahl ab 0 sein.")
            }
            return .setAppBadge(id: id, count: count)
        case "print":
            return .print(id: id)
        case "sign_in_with_browser":
            return .signInWithBrowser(id: id)
        case "push_register":
            return .pushRegister(id: id)
        case "push_unregister":
            return .pushUnregister(id: id)
        case "push_state":
            return .pushState(id: id)
        default:
            return .ungueltig(id: id, grund: "Unbekannter Befehl der Hülle: \(cmd)")
        }
    }

    /// Das Skript, das die App im Webview auswertet. Ist die Seite inzwischen eine andere, fehlt
    /// `__LIFELINE_REPLY__`, und der Aufruf tut nichts.
    public static func replyScript(_ antwort: Brueckenantwort) -> String {
        let fehler = antwort.fehler.map(jsString) ?? "null"
        let wert: String
        switch antwort.wert {
        case .null: wert = "null"
        case .bool(let b): wert = b ? "true" : "false"
        case .objekt(let felder): wert = jsObjekt(felder)
        }
        return "window.__LIFELINE_REPLY__?.(\(antwort.id), \(fehler), \(wert));"
    }

    /// JSON-Objekt mit sortierten Schlüsseln, gültig als JS-Literal (wie `jsString`).
    private static func jsObjekt(_ felder: [String: String]) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let daten = (try? encoder.encode(felder)) ?? Data("{}".utf8)
        return String(decoding: daten, as: UTF8.self)
    }

    /// JSON-String, gültig als JS-Literal (JSONEncoder maskiert auch `/`, also `</script>`).
    private static func jsString(_ text: String) -> String {
        let daten = (try? JSONEncoder().encode(text)) ?? Data("\"\"".utf8)
        return String(decoding: daten, as: UTF8.self)
    }

    /// Ganze Zahl aus JS: kommt als `Int` oder `Double`, nie als Text.
    private static func ganzzahl(_ wert: Any?) -> Int? {
        if wert is String { return nil }
        if let zahl = wert as? Int { return zahl }
        if let zahl = wert as? Double { return Int(exactly: zahl) }
        return nil
    }
}

/// Ob die Person Meldungen der App erlaubt hat (`UNAuthorizationStatus`).
public enum Meldungsfreigabe: Equatable, Sendable {
    /// Noch nie gefragt: der erste Aufruf fragt.
    case offen
    case erlaubt
    case verweigert
}

/// Die Anmeldung am Push-Kanal: Kennung der Anmeldung beim Server, Token von APNs, `umgebung`
/// (`sandbox` oder `production`) und der Schlüssel, mit dem der Server die Nutzlast verschlüsselt.
public struct PushRegistrierung: Equatable, Sendable {
    public let kennung: String
    public let token: String
    public let umgebung: String
    public let schluessel: String

    public init(kennung: String, token: String, umgebung: String, schluessel: String) {
        self.kennung = kennung
        self.token = token
        self.umgebung = umgebung
        self.schluessel = schluessel
    }
}

/// Warum sich die App nicht anmelden konnte; der Text geht als Fehlercode an die Seite.
public enum PushFehler: Error, Equatable, Sendable, LocalizedError {
    /// Die Person hat Meldungen nicht erlaubt.
    case denied
    /// APNs gibt kein Token (kein Netz, Simulator ohne Unterstützung).
    case unavailable

    public var errorDescription: String? {
        switch self {
        case .denied: "denied"
        case .unavailable: "unavailable"
        }
    }
}

/// Die Systemdienste, die die Brücke braucht; die App setzt sie mit UIKit und UserNotifications
/// um, die Tests mit einer Attrappe.
@MainActor
public protocol Huellendienste: AnyObject, Sendable {
    /// Schalter „Haptik“ in den Einstellungen der Hülle (Vorgabe an).
    var isHaptikEnabled: Bool { get }
    func play(_ feedback: Haptik.Feedback)
    func loadMeldungsfreigabe() async -> Meldungsfreigabe
    /// Fragt die Person; `true`, wenn sie Meldungen erlaubt.
    func requestMeldungsfreigabe() async -> Bool
    func showNotification(title: String, body: String?) async throws
    func setBadge(_ count: Int) async throws
    /// Öffnet den Druckdialog; `true`, wenn gedruckt wurde.
    func print() async throws -> Bool
    /// Startet „Im Browser anmelden“ (`ASWebAuthenticationSession`, Entwurf D7); wirft, wenn die
    /// Sitzung nicht beginnt. Das Ergebnis meldet die App später als `Anmeldung.ereignis`.
    func startAnmeldung() throws
    /// Fragt bei Bedarf nach der Berechtigung und holt Token und Schlüssel für den aktiven Server;
    /// wirft `PushFehler`.
    func registerPush() async throws -> PushRegistrierung
    /// Nimmt die Anmeldung des aktiven Servers weg (Schlüssel, Kennung).
    func unregisterPush() async throws
    /// Berechtigung und Kennung des aktiven Servers, falls angemeldet; fragt nie.
    func pushState() async -> (Meldungsfreigabe, kennung: String?)
}

/// Führt einen angenommenen Befehl aus (Spec `ios-huelle`, „Haptik nur auf Wunsch der Seite und
/// abschaltbar“, „Meldung und Badge bei laufender App“).
@MainActor
public enum Brueckenausfuehrung {
    public static let meldungenAus =
        "Meldungen sind für Lifeline ausgeschaltet (Einstellungen → Mitteilungen → Lifeline)."

    /// `nil` für `haptics` (ohne Antwort), sonst die Antwort an die Seite.
    public static func run(_ befehl: Brueckenbefehl, dienste: Huellendienste) async
        -> Brueckenantwort?
    {
        switch befehl {
        case .haptics(let kind):
            if let feedback = Haptik.feedback(kind: kind, isEnabled: dienste.isHaptikEnabled) {
                dienste.play(feedback)
            }
            return nil
        case .showNotification(let id, let title, let body):
            return await antwort(id) {
                guard await isMeldungErlaubt(dienste) else { throw Abgelehnt(meldungenAus) }
                try await dienste.showNotification(title: title, body: body)
                return .null
            }
        case .setAppBadge(let id, let count):
            return await antwort(id) {
                // Die Zahl am Symbol braucht dieselbe Berechtigung wie eine Meldung. Wegnehmen fragt
                // nie: ohne Berechtigung steht keine Zahl da, und eine Rückfrage beim Laden der
                // Seite hätte keinen Anlass, den die Person versteht.
                if count == 0 {
                    guard await dienste.loadMeldungsfreigabe() == .erlaubt else { return .null }
                } else if await !isMeldungErlaubt(dienste) {
                    throw Abgelehnt(meldungenAus)
                }
                try await dienste.setBadge(count)
                return .null
            }
        case .print(let id):
            return await antwort(id) { .bool(try await dienste.print()) }
        case .signInWithBrowser(let id):
            return await antwort(id) {
                try dienste.startAnmeldung()
                return .null
            }
        case .pushRegister(let id):
            return await antwort(id) {
                let r = try await dienste.registerPush()
                return .objekt([
                    "registration_id": r.kennung, "token": r.token, "environment": r.umgebung,
                    "key": r.schluessel,
                ])
            }
        case .pushUnregister(let id):
            return await antwort(id) {
                try await dienste.unregisterPush()
                return .null
            }
        case .pushState(let id):
            return await antwort(id) {
                let (freigabe, kennung) = await dienste.pushState()
                let permission =
                    switch freigabe {
                    case .erlaubt: "granted"
                    case .verweigert: "denied"
                    case .offen: "undetermined"
                    }
                var felder = ["permission": permission]
                if let kennung { felder["registration_id"] = kennung }
                return .objekt(felder)
            }
        case .ungueltig(let id, let grund):
            return Brueckenantwort(id: id, fehler: grund, wert: .null)
        }
    }

    /// Berechtigung beim ersten Aufruf: nur wer noch nie gefragt wurde, wird gefragt.
    private static func isMeldungErlaubt(_ dienste: Huellendienste) async -> Bool {
        switch await dienste.loadMeldungsfreigabe() {
        case .erlaubt: true
        case .verweigert: false
        case .offen: await dienste.requestMeldungsfreigabe()
        }
    }

    private static func antwort(
        _ id: Int, _ arbeit: () async throws -> Antwortwert
    ) async -> Brueckenantwort {
        do {
            return Brueckenantwort(id: id, fehler: nil, wert: try await arbeit())
        } catch {
            return Brueckenantwort(id: id, fehler: error.localizedDescription, wert: .null)
        }
    }

    private struct Abgelehnt: LocalizedError {
        let errorDescription: String?
        init(_ text: String) { errorDescription = text }
    }
}
