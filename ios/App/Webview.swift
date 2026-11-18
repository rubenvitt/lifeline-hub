import Foundation
import LifelineKern
import SwiftUI
import WebKit
import os

/// Baut den Webview eines Servers (Entwurf D3, D4, D6; Spec `ios-huelle`, „Jeder Server hat
/// seinen eigenen Datenspeicher“, „Die Brücke gilt nur für den aktiven Server“).
@MainActor
enum Webviewfabrik {
    private static let protokoll = Logger(subsystem: "dev.rubeen.lifeline.ios", category: "webview")

    /// Ein Webview je Server: eigener Datenspeicher mit der UUID des Eintrags, Init-Skript vor dem
    /// ersten Skript der Seite und nur im Hauptframe, Message-Handler `lifeline`.
    static func make(
        fuer eintrag: ServerEintrag, skript: String, empfang: WKScriptMessageHandler,
        navigation: WKNavigationDelegate?
    ) -> WKWebView {
        let inhalt = WKUserContentController()
        inhalt.addUserScript(
            WKUserScript(source: skript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        // Der Controller hält seinen Handler stark; die Weiche bricht den Kreis zum Modell.
        inhalt.add(SchwacherEmpfang(empfang), name: Bruecke.handlerName)
        let konfiguration = WKWebViewConfiguration()
        konfiguration.websiteDataStore = WKWebsiteDataStore(forIdentifier: eintrag.id)
        konfiguration.userContentController = inhalt
        let webView = WKWebView(frame: .zero, configuration: konfiguration)
        webView.navigationDelegate = navigation
        #if DEBUG
            webView.isInspectable = true
        #endif
        return webView
    }

    /// Das Init-Skript aus den Ressourcen der App mit eingesetzter Version.
    static func initskript(version: String?, bundle: Bundle = .main) -> String {
        guard let url = bundle.url(forResource: "huelle", withExtension: "js"),
            let vorlage = try? String(contentsOf: url, encoding: .utf8)
        else {
            protokoll.fault("huelle.js fehlt in den Ressourcen der App")
            return ""
        }
        return Initskript.render(vorlage: vorlage, version: version)
    }

    /// Vor dem Verwerfen: nichts lädt weiter, und die Brücke ist abgebaut.
    static func close(_ webView: WKWebView) {
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.configuration.userContentController.removeScriptMessageHandler(
            forName: Bruecke.handlerName)
    }
}

/// Reicht Nachrichten an einen schwach gehaltenen Empfänger weiter.
@MainActor
final class SchwacherEmpfang: NSObject, WKScriptMessageHandler {
    private weak var ziel: WKScriptMessageHandler?

    init(_ ziel: WKScriptMessageHandler) {
        self.ziel = ziel
    }

    func userContentController(
        _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
    ) {
        ziel?.userContentController(userContentController, didReceive: message)
    }
}

/// Der Message-Handler `lifeline`. Ob eine Nachricht wirkt, entscheidet `Bruecke.accepts` mit
/// dem in diesem Moment aktiven Server; die Antwort geht nur an eine Seite dieses Servers.
@MainActor
final class Brueckenempfang: NSObject, WKScriptMessageHandler {
    private let dienste: any Huellendienste
    private let aktiverServer: @MainActor () -> ServerAdresse?

    init(dienste: any Huellendienste, aktiverServer: @escaping @MainActor () -> ServerAdresse?) {
        self.dienste = dienste
        self.aktiverServer = aktiverServer
    }

    func userContentController(
        _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
    ) {
        let frame = message.frameInfo
        let origin = SeitenOrigin(
            schema: frame.securityOrigin.`protocol`, host: frame.securityOrigin.host,
            port: frame.securityOrigin.port)
        guard
            Bruecke.accepts(
                isMainFrame: frame.isMainFrame, origin: origin, aktiverServer: aktiverServer()),
            let befehl = Bruecke.parse(message.body)
        else { return }
        let dienste = self.dienste
        Task { @MainActor [weak self, weak webView = message.webView] in
            guard let antwort = await Brueckenausfuehrung.run(befehl, dienste: dienste),
                let self, let webView, let seite = webView.url,
                let server = self.aktiverServer(),
                Linkregeln.belongsToServer(server.url, seite: seite)
            else { return }
            webView.evaluateJavaScript(Bruecke.replyScript(antwort), completionHandler: nil)
        }
    }
}

/// Meldet Ladefehler und das Ende des Web-Prozesses an das Modell (Entwurf D6; tasks.md 8.6).
@MainActor
final class Navigationsbegleiter: NSObject, WKNavigationDelegate {
    private let melde: @MainActor (WKWebView, Ablauf.Event) -> Void

    init(melde: @escaping @MainActor (WKWebView, Ablauf.Event) -> Void) {
        self.melde = melde
    }

    func webView(
        _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: any Error
    ) {
        // Nur Fehler der URL-Schicht; WebKit-eigene (etwa ein Download statt einer Seite) nicht.
        let fehler = error as NSError
        guard fehler.domain == NSURLErrorDomain else { return }
        let url = fehler.userInfo[NSURLErrorFailingURLErrorKey] as? URL
        melde(webView, .navigationFehlgeschlagen(URLError.Code(rawValue: fehler.code), url: url))
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        melde(webView, .webProzessBeendet)
    }
}

/// Bindet den Webview des Modells in SwiftUI ein. Der Webview lebt im Modell (Neuladen, Drucken,
/// Antworten der Brücke); ein neuer Webview bekommt über `.id` eine neue Ansicht.
struct WebviewHost: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView { webView }

    func updateUIView(_ webView: WKWebView, context: Context) {}
}

/// Setzt eine Fortsetzung genau einmal fort, auch wenn Zeitgeber und Rückruf beide feuern.
final class Einmal<Wert: Sendable>: @unchecked Sendable {
    private let sperre = NSLock()
    private var fortsetzung: CheckedContinuation<Wert, Never>?

    init(_ fortsetzung: CheckedContinuation<Wert, Never>) {
        self.fortsetzung = fortsetzung
    }

    func resume(_ wert: Wert) {
        sperre.lock()
        let offen = fortsetzung
        fortsetzung = nil
        sperre.unlock()
        offen?.resume(returning: wert)
    }
}

extension WKWebView {
    /// Antwortet die Seite noch? Ein beendeter Web-Prozess oder eine hängende Seite antwortet
    /// nicht binnen `frist`.
    func isResponsive(frist: TimeInterval = 3) async -> Bool {
        guard url != nil else { return false }
        return await withCheckedContinuation { fortsetzung in
            let einmal = Einmal(fortsetzung)
            evaluateJavaScript("document.readyState") { wert, fehler in
                einmal.resume(fehler == nil && wert != nil)
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + frist) { einmal.resume(false) }
        }
    }
}
