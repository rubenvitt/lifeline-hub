/// Origin einer Seite, wie sie `WKScriptMessage.frameInfo.securityOrigin` meldet (`protocol`,
/// `host`, `port`). WebKit meldet den Standardport des Schemas als 0.
public struct SeitenOrigin: Equatable, Sendable {
    public let schema: String
    public let host: String
    public let port: Int

    public init(schema: String, host: String, port: Int) {
        self.schema = schema
        self.host = host
        self.port = port
    }
}

/// Die Brücke `lifeline` zwischen Seite und Hülle (Wire-Format im Kopf von
/// `ios/App/Huelle/huelle.js`; Spec `ios-huelle`, „Die Brücke gilt nur für den aktiven Server“).
public enum Bruecke {
    /// Name des Message-Handlers (`window.webkit.messageHandlers.lifeline`).
    public static let handlerName = "lifeline"

    /// Nimmt die Hülle eine Nachricht an? Nur aus dem Hauptframe und nur von der Origin des
    /// aktiven Servers. Die App fragt bei jeder Nachricht mit dem dann aktiven Server; nach einem
    /// Wechsel gilt also sofort die neue Origin. Andere Frames (eingebettete Fremdinhalte) und
    /// andere Origins (Identitätsanbieter, eine fremde Seite nach einem Link) bleiben ohne
    /// Wirkung.
    public static func accepts(
        isMainFrame: Bool, origin: SeitenOrigin, aktiverServer: ServerAdresse?
    ) -> Bool {
        guard isMainFrame, let aktiverServer else { return false }
        // Die Adresse ist geprüft: immer https, Host klein, Standardport weggelassen.
        let schema = origin.schema.lowercased()
        guard schema == "https" else { return false }
        let port = origin.port == 0 ? 443 : origin.port
        return origin.host.lowercased() == aktiverServer.host
            && port == (aktiverServer.url.port ?? 443)
    }
}
