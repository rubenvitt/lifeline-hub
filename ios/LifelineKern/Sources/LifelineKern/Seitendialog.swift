import Foundation

/// Ein Dialog der Seite (`alert`, `confirm`, `prompt`) als nativer Dialog (tasks.md 8.13). Ohne
/// ihn liefert `confirm` im Webview still `false`. Die App ruft ihn aus den `runJavaScript…`-
/// Rückrufen von `WKUIDelegate` und zeigt ihn mit `UIAlertController`.
///
/// Jeder Frame darf fragen, auch eine fremde Origin (Identitätsanbieter, eingebettete Inhalte);
/// der Titel nennt aber immer den Host des auslösenden Frames, nie den des Servers. So kann eine
/// fremde Seite nicht im Namen des Servers fragen.
public struct Seitendialog: Equatable, Sendable {
    public enum Art: Equatable, Sendable {
        /// `alert`: nur „OK“.
        case hinweis
        /// `confirm`: „OK“ und „Abbrechen“.
        case rueckfrage
        /// `prompt`: Textfeld mit Vorgabe, „OK“ und „Abbrechen“.
        case eingabe(vorgabe: String?)
    }

    /// Was der Mensch gewählt hat.
    public enum Ergebnis: Equatable, Sendable {
        /// „OK“, bei der Eingabe mit dem Text des Feldes.
        case ok(text: String?)
        case abgebrochen
    }

    /// Längere Nachrichten schneidet die Hülle ab, damit „OK“ erreichbar bleibt.
    public static let maxZeichen = 1000
    public static let okTitel = "OK"
    public static let ohneHost = "Diese Seite"

    public let art: Art
    public let titel: String
    public let nachricht: String

    public init(art: Art, nachricht: String, origin: SeitenOrigin) {
        self.art = art
        self.titel = Self.titel(origin: origin)
        self.nachricht =
            nachricht.count > Self.maxZeichen
            ? String(nachricht.prefix(Self.maxZeichen)) + "…" : nachricht
    }

    /// Host des Frames, klein; Port nur, wenn er nicht der Standardport des Schemas ist (WebKit
    /// meldet den Standardport als 0); ein anderes Schema als https steht davor.
    public static func titel(origin: SeitenOrigin) -> String {
        let host = origin.host.trimmingCharacters(in: .whitespaces).lowercased()
        guard !host.isEmpty else { return ohneHost }
        let schema = origin.schema.lowercased()
        let standardport = schema == "http" ? 80 : 443
        let port = origin.port == 0 || origin.port == standardport ? "" : ":\(origin.port)"
        let vorsatz = schema == "https" ? "" : "\(schema)://"
        return vorsatz + host + port
    }

    public var abbrechenTitel: String? { art == .hinweis ? nil : "Abbrechen" }

    public var hasFeld: Bool {
        if case .eingabe = art { return true }
        return false
    }

    /// Vorbelegung des Textfeldes; leer, wenn die Seite keine nennt.
    public var feldVorgabe: String? {
        guard case .eingabe(let vorgabe) = art else { return nil }
        return vorgabe ?? ""
    }

    /// Antwort für `confirm`. `nil` heißt: kein Dialog gezeigt (kein Fenster, schon einer offen);
    /// dann lehnt die Seite ab wie bei „Abbrechen“.
    public static func confirmWert(_ ergebnis: Ergebnis?) -> Bool {
        if case .ok = ergebnis { return true }
        return false
    }

    /// Antwort für `prompt`: der Text nach „OK“ (leer statt `null`), sonst `nil`.
    public static func promptWert(_ ergebnis: Ergebnis?) -> String? {
        guard case .ok(let text) = ergebnis else { return nil }
        return text ?? ""
    }
}
