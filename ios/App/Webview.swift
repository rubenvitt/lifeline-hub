import Foundation
import LifelineKern
import SwiftUI
import UIKit
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
        webView.uiDelegate = navigation as? WKUIDelegate
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
        webView.uiDelegate = nil
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

/// Begleitet die Navigation des Webviews: Linkregeln, neue Fenster, Downloads (Entwurf D8; Spec
/// `ios-huelle`, „Links, Downloads und Druck laufen nicht ins Leere“), dazu Ladefehler und das Ende
/// des Web-Prozesses an das Modell (Entwurf D6). Was geschieht, entscheidet `Linkweiche` im Kern.
@MainActor
final class Navigationsbegleiter: NSObject, WKNavigationDelegate, WKUIDelegate {
    private let aktiverServer: @MainActor () -> ServerAdresse?
    private let oeffne: @MainActor (URL) -> Void
    private let downloads: Downloads
    private let melde: @MainActor (WKWebView, Ablauf.Event) -> Void

    init(
        aktiverServer: @escaping @MainActor () -> ServerAdresse?,
        oeffne: @escaping @MainActor (URL) -> Void = { UIApplication.shared.open($0) },
        downloads: Downloads = Downloads(),
        melde: @escaping @MainActor (WKWebView, Ablauf.Event) -> Void
    ) {
        self.aktiverServer = aktiverServer
        self.oeffne = oeffne
        self.downloads = downloads
        self.melde = melde
    }

    private func entscheide(
        _ aktion: WKNavigationAction, in webView: WKWebView, neuesFenster: Bool
    ) -> Linkweiche.Entscheidung {
        guard let ziel = aktion.request.url else { return neuesFenster ? .abbrechen : .erlauben }
        return Linkweiche.navigation(
            server: aktiverServer()?.url, ziel: ziel,
            isMainFrame: aktion.targetFrame?.isMainFrame ?? true,
            neuesFenster: neuesFenster || aktion.targetFrame == nil,
            shouldPerformDownload: aktion.shouldPerformDownload, seite: webView.url)
    }

    // MARK: Navigation

    func webView(
        _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
    ) {
        switch entscheide(navigationAction, in: webView, neuesFenster: false) {
        case .erlauben:
            decisionHandler(.allow)
        case .abbrechen:
            decisionHandler(.cancel)
        case .download:
            decisionHandler(.download)
        case .imWebviewLaden(let url):
            decisionHandler(.cancel)
            webView.load(URLRequest(url: url))
        case .system(let url):
            decisionHandler(.cancel)
            oeffne(url)
        }
    }

    func webView(
        _ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping @MainActor @Sendable (WKNavigationResponsePolicy) -> Void
    ) {
        let entscheidung = Linkweiche.antwort(
            canShowMIMEType: navigationResponse.canShowMIMEType,
            isForMainFrame: navigationResponse.isForMainFrame)
        decisionHandler(entscheidung == .download ? .download : .allow)
    }

    func webView(
        _ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload
    ) {
        download.delegate = downloads
    }

    func webView(
        _ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload
    ) {
        download.delegate = downloads
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

    // MARK: Neue Fenster

    /// `target=_blank` und `window.open`: ein zweiter Webview entsteht nie. Die eigene Origin lädt
    /// im selben Webview, eine Dateiroute wird heruntergeladen, Fremdes öffnet das System.
    func webView(
        _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        switch entscheide(navigationAction, in: webView, neuesFenster: true) {
        case .imWebviewLaden(let url):
            webView.load(URLRequest(url: url))
        case .download:
            let downloads = self.downloads
            webView.startDownload(using: navigationAction.request) { download in
                download.delegate = downloads
            }
        case .system(let url):
            oeffne(url)
        case .erlauben, .abbrechen:
            break
        }
        return nil
    }
}

/// Lädt Dateien mit `WKDownload` (mit den Cookies des Datenspeichers, auch aus `blob:`) in ein
/// eigenes Verzeichnis unter dem temporären Verzeichnis und bietet sie im Teilen-Blatt an.
@MainActor
final class Downloads: NSObject, WKDownloadDelegate {
    static let basis = FileManager.default.temporaryDirectory.appendingPathComponent(
        "Downloads", isDirectory: true)

    private var ziele: [ObjectIdentifier: URL] = [:]
    private let zeige: @MainActor (URL, WKWebView?) -> Void
    private let protokoll = Logger(subsystem: "dev.rubeen.lifeline.ios", category: "download")

    init(zeige: @escaping @MainActor (URL, WKWebView?) -> Void = Teilen.zeige) {
        self.zeige = zeige
    }

    func download(
        _ download: WKDownload, decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping @MainActor @Sendable (URL?) -> Void
    ) {
        let ziel = Downloadablage.ziel(basis: Self.basis, vorschlag: suggestedFilename, kennung: UUID())
        do {
            try FileManager.default.createDirectory(
                at: ziel.deletingLastPathComponent(), withIntermediateDirectories: true)
        } catch {
            protokoll.error("Download-Verzeichnis nicht angelegt: \(error.localizedDescription)")
            completionHandler(nil)
            return
        }
        ziele[ObjectIdentifier(download)] = ziel
        completionHandler(ziel)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let ziel = ziele.removeValue(forKey: ObjectIdentifier(download)) else { return }
        zeige(ziel, download.webView)
    }

    func download(_ download: WKDownload, didFailWithError error: any Error, resumeData: Data?) {
        protokoll.error("Download gescheitert: \(error.localizedDescription)")
        if let ziel = ziele.removeValue(forKey: ObjectIdentifier(download)) {
            try? FileManager.default.removeItem(at: ziel.deletingLastPathComponent())
        }
    }
}

/// Das Teilen-Blatt für eine geladene Datei; danach räumt es die Datei weg.
enum Teilen {
    @MainActor
    static func zeige(_ datei: URL, von webView: WKWebView?) {
        guard let webView, var oben = webView.window?.rootViewController else { return }
        while let gezeigt = oben.presentedViewController { oben = gezeigt }
        let blatt = UIActivityViewController(activityItems: [datei], applicationActivities: nil)
        // Nur Dateioperationen: der Rückruf braucht keinen Hauptthread.
        blatt.completionWithItemsHandler = { @Sendable _, _, _, _ in
            try? FileManager.default.removeItem(at: datei.deletingLastPathComponent())
        }
        if let popover = blatt.popoverPresentationController {
            popover.sourceView = webView
            popover.sourceRect = CGRect(x: webView.bounds.midX, y: webView.bounds.midY, width: 1, height: 1)
            popover.permittedArrowDirections = []
        }
        oben.present(blatt, animated: true)
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
