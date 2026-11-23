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
        // Natives Gefühl (D6): keine Lupe und kein Textmenü außerhalb von Eingaben.
        inhalt.addUserScript(
            WKUserScript(
                source: Huellenstil.skript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        // Standort in Unterframes sperren (LLH-2071): sonst fragte WebKit dort selbst, an der Brücke
        // vorbei. Im Hauptframe tut das Skript nichts.
        inhalt.addUserScript(
            WKUserScript(
                source: unterframeSkript(), injectionTime: .atDocumentStart, forMainFrameOnly: false))
        let konfiguration = WKWebViewConfiguration()
        konfiguration.websiteDataStore = WKWebsiteDataStore(forIdentifier: eintrag.id)
        konfiguration.userContentController = inhalt
        let webView = WKWebView(frame: .zero, configuration: konfiguration)
        fuehlNativ(webView)
        webView.navigationDelegate = navigation
        webView.uiDelegate = navigation as? WKUIDelegate
        #if DEBUG
            webView.isInspectable = true
        #endif
        return webView
    }

    /// Natives Gefühl (Entwurf D6; Spec `ios-huelle`, „Die Oberfläche fühlt sich nativ an“): der
    /// Webview liegt in der Safe Area (`WebviewHost` ignoriert sie nicht), also rechnet die
    /// Scroll-Ansicht keine Ränder mehr hinzu; kein Nachfedern, kein Ziehen zum Neuladen, keine
    /// Linkvorschau. Hintergrund in Kopf-Schwarz, damit vor dem ersten Bild nichts weiß aufblitzt.
    static func fuehlNativ(_ webView: WKWebView) {
        let kopfschwarz = UIColor(named: "Kopfschwarz") ?? .black
        webView.isOpaque = false
        webView.backgroundColor = kopfschwarz
        webView.underPageBackgroundColor = kopfschwarz
        webView.allowsLinkPreview = false
        webView.allowsBackForwardNavigationGestures = false
        let scroll = webView.scrollView
        scroll.backgroundColor = kopfschwarz
        scroll.contentInsetAdjustmentBehavior = .never
        scroll.bounces = false
        scroll.alwaysBounceVertical = false
        scroll.alwaysBounceHorizontal = false
        scroll.refreshControl = nil
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

    /// Die Sperre des Standorts für Unterframes aus den Ressourcen der App (LLH-2071).
    static func unterframeSkript(bundle: Bundle = .main) -> String {
        guard let url = bundle.url(forResource: "unterframe-standort", withExtension: "js"),
            let skript = try? String(contentsOf: url, encoding: .utf8)
        else {
            protokoll.fault("unterframe-standort.js fehlt in den Ressourcen der App")
            return ""
        }
        return skript
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
/// Laufende Beobachtungen des Standorts (`location_watch`, LLH-2071) führt er über
/// `Standortbeobachtung`; ohne `standort` meldet jede Beobachtung `unavailable`.
@MainActor
final class Brueckenempfang: NSObject, WKScriptMessageHandler {
    private let dienste: any Huellendienste
    private let aktiverServer: @MainActor () -> ServerAdresse?
    private let standort: Standortdienst?
    private var beobachtung = Standortbeobachtung()
    /// Der Webview, dessen Seite die Beobachtungen gestartet hat.
    private weak var beobachteterWebView: WKWebView?
    /// Prüft im Sekundentakt die Fristen der Beobachtungen, solange welche laufen.
    private var fristuhr: Task<Void, Never>?

    init(
        dienste: any Huellendienste, aktiverServer: @escaping @MainActor () -> ServerAdresse?,
        standort: Standortdienst? = nil
    ) {
        self.dienste = dienste
        self.aktiverServer = aktiverServer
        self.standort = standort
        super.init()
        standort?.beiPosition = { [weak self] position in self?.stelleZu(position: position, fehler: nil) }
        standort?.beiFehler = { [weak self] fehler in self?.stelleZu(position: nil, fehler: fehler) }
    }

    /// Navigation, Schließen des Webviews oder Ende des Web-Prozesses: alle Beobachtungen enden.
    func beendeStandort() {
        fuehreAus(beobachtung.reset())
        beobachteterWebView = nil
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
        switch befehl {
        case .locationWatch(let id, let genau, let frist):
            // Sofort festhalten: ein `clear` oder eine neue Seite vor der Freigabe verhindert den Start.
            if beobachteterWebView !== message.webView { beendeStandort() }
            beobachteterWebView = message.webView
            let generation = beobachtung.angefragt(id: id)
            starteBeobachtung(
                id: id, highAccuracy: genau, timeout: frist, generation: generation, in: message.webView)
            return
        case .locationClear(let watch):
            fuehreAus(beobachtung.clear(watch: watch))
            return
        default:
            break
        }
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

    // MARK: Standort (LLH-2071)

    private static var jetzt: Double { ProcessInfo.processInfo.systemUptime }

    private func starteBeobachtung(
        id: Int, highAccuracy: Bool, timeout: Duration?, generation: Int, in webView: WKWebView?
    ) {
        let dienste = self.dienste
        Task { @MainActor [weak self, weak webView] in
            guard let self, let webView else { return }
            do {
                guard self.standort != nil else { throw Standortfehler.unavailable }
                // Erst nach der Freigabe: die Frist zählt die Wartezeit auf die Person nicht mit.
                try await Brueckenausfuehrung.isStandortErlaubt(dienste)
            } catch {
                self.sende(Bruecke.locationScript(
                    id: id, fehler: error as? Standortfehler ?? .unavailable, position: nil), an: webView)
                return
            }
            guard let server = self.aktiverServer(), self.istSeiteDesServers(webView),
                self.beobachteterWebView === webView
            else { return }
            self.fuehreAus(
                self.beobachtung.start(
                    id: id, highAccuracy: highAccuracy, timeout: timeout, server: server,
                    generation: generation, jetzt: Self.jetzt))
        }
    }

    private func stelleZu(position: Standortposition?, fehler: Standortfehler?) {
        let webView = beobachteterWebView
        let (ids, wirkung) = beobachtung.zustellen(
            aktiverServer: aktiverServer(), seite: webView?.url, jetzt: Self.jetzt)
        if let webView {
            for id in ids { sende(Bruecke.locationScript(id: id, fehler: fehler, position: position), an: webView) }
        }
        fuehreAus(wirkung)
        // Nach einer Verweigerung endet jede Beobachtung.
        if fehler == .denied { beendeStandort() }
    }

    private func pruefeFristen() {
        guard let webView = beobachteterWebView, istSeiteDesServers(webView) else {
            beendeStandort()
            return
        }
        for id in beobachtung.abgelaufen(jetzt: Self.jetzt) {
            sende(Bruecke.locationScript(id: id, fehler: .timeout, position: nil), an: webView)
        }
    }

    private func fuehreAus(_ wirkung: Standortwirkung) {
        switch wirkung {
        case .keine:
            return
        case .starte(let genau):
            standort?.starte(highAccuracy: genau)
            if fristuhr == nil {
                fristuhr = Task { @MainActor [weak self] in
                    while !Task.isCancelled {
                        try? await Task.sleep(for: .seconds(1))
                        guard !Task.isCancelled else { return }
                        self?.pruefeFristen()
                    }
                }
            }
        case .stoppe:
            standort?.stoppe()
            fristuhr?.cancel()
            fristuhr = nil
        }
    }

    private func istSeiteDesServers(_ webView: WKWebView) -> Bool {
        guard let server = aktiverServer(), let seite = webView.url else { return false }
        return Linkregeln.belongsToServer(server.url, seite: seite)
    }

    /// Wie die Antworten: nur an eine Seite des aktiven Servers.
    private func sende(_ skript: String, an webView: WKWebView) {
        guard istSeiteDesServers(webView) else { return }
        webView.evaluateJavaScript(skript, completionHandler: nil)
    }
}

/// Begleitet die Navigation des Webviews: Linkregeln, neue Fenster, Downloads (Entwurf D8; Spec
/// `ios-huelle`, „Links, Downloads und Druck laufen nicht ins Leere“), dazu Ladefehler und das Ende
/// des Web-Prozesses an das Modell (Entwurf D6). Was geschieht, entscheidet `Linkweiche` im Kern.
/// Dialoge der Seite (`alert`, `confirm`, `prompt`) zeigt er nativ (tasks.md 8.13, `Seitendialog`).
@MainActor
final class Navigationsbegleiter: NSObject, WKNavigationDelegate, WKUIDelegate {
    private let aktiverServer: @MainActor () -> ServerAdresse?
    private let oeffne: @MainActor (URL) -> Void
    private let downloads: Downloads
    private let melde: @MainActor (WKWebView, Ablauf.Event) -> Void
    private let dialoge: any Dialogzeiger

    init(
        aktiverServer: @escaping @MainActor () -> ServerAdresse?,
        oeffne: @escaping @MainActor (URL) -> Void = { UIApplication.shared.open($0) },
        downloads: Downloads = Downloads(),
        dialoge: any Dialogzeiger = Systemdialoge(),
        melde: @escaping @MainActor (WKWebView, Ablauf.Event) -> Void
    ) {
        self.aktiverServer = aktiverServer
        self.oeffne = oeffne
        self.downloads = downloads
        self.dialoge = dialoge
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

    /// Zurück auf einer Seite des Servers nimmt `Ablauf` den Hinweis „Zur Oberfläche“ weg.
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        melde(webView, .seiteGeladen(url: webView.url))
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

    // MARK: Dialoge der Seite

    // Die async-Formen der Anforderungen: die Formen mit `completionHandler` erkennt Swift 6 je
    // nach Reihenfolge der Konformitäten im Modul nicht als Erfüllung („nearly matches optional
    // requirement“); WebKit sah die Methode dann nicht und überging `alert` still mit „OK“. Die
    // async-Form hat keinen Rückruf im Typ, und Swift ruft den Rückruf von WebKit genau einmal,
    // wenn sie zurückkehrt. `testDerBegleiterBeantwortetAlleDialogeDerSeite` hält das fest.

    /// Zeigt den Dialog und kehrt genau einmal zurück, auch wenn er nicht erscheinen kann.
    private func frage(
        _ art: Seitendialog.Art, nachricht: String, frame: WKFrameInfo, in webView: WKWebView
    ) async -> Seitendialog.Ergebnis? {
        let origin = SeitenOrigin(
            schema: frame.securityOrigin.`protocol`, host: frame.securityOrigin.host,
            port: frame.securityOrigin.port)
        return await withCheckedContinuation { fortsetzung in
            let einmal = EinmaligeAntwort { fortsetzung.resume(returning: $0) }
            dialoge.zeige(Seitendialog(art: art, nachricht: nachricht, origin: origin), in: webView) {
                einmal.call($0)
            }
        }
    }

    func webView(
        _ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo
    ) async {
        _ = await frage(.hinweis, nachricht: message, frame: frame, in: webView)
    }

    func webView(
        _ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo
    ) async -> Bool {
        Seitendialog.confirmWert(await frage(.rueckfrage, nachricht: message, frame: frame, in: webView))
    }

    func webView(
        _ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?, initiatedByFrame frame: WKFrameInfo
    ) async -> String? {
        Seitendialog.promptWert(
            await frage(.eingabe(vorgabe: defaultText), nachricht: prompt, frame: frame, in: webView))
    }
}

/// Zeigt einen Dialog der Seite und meldet die Wahl; `nil`, wenn er nicht erscheinen kann.
@MainActor
protocol Dialogzeiger: AnyObject {
    func zeige(
        _ dialog: Seitendialog, in webView: WKWebView,
        antwort: @escaping @MainActor (Seitendialog.Ergebnis?) -> Void)
}

/// Ruft eine Antwort höchstens einmal; WebKit verlangt den Rückruf genau einmal.
@MainActor
final class EinmaligeAntwort {
    private var antwort: (@MainActor (Seitendialog.Ergebnis?) -> Void)?

    init(_ antwort: @escaping @MainActor (Seitendialog.Ergebnis?) -> Void) {
        self.antwort = antwort
    }

    func call(_ ergebnis: Seitendialog.Ergebnis?) {
        let offen = antwort
        antwort = nil
        offen?(ergebnis)
    }
}

/// `UIAlertController` über dem obersten View-Controller des Fensters, in dem der Webview liegt.
/// Kein Fenster, oder der oberste Controller kommt oder geht gerade (etwa ein zweiter Dialog,
/// solange der erste offen ist): dann kein Dialog, und die Seite bekommt sofort die Ablehnung.
@MainActor
final class Systemdialoge: Dialogzeiger {
    func zeige(
        _ dialog: Seitendialog, in webView: WKWebView,
        antwort: @escaping @MainActor (Seitendialog.Ergebnis?) -> Void
    ) {
        guard var oben = webView.window?.rootViewController else { return antwort(nil) }
        while let gezeigt = oben.presentedViewController { oben = gezeigt }
        guard !oben.isBeingPresented, !oben.isBeingDismissed, !(oben is UIAlertController) else {
            return antwort(nil)
        }
        // `.alert` braucht auch auf dem iPad keinen Popover-Anker.
        let fenster = UIAlertController(title: dialog.titel, message: dialog.nachricht, preferredStyle: .alert)
        if let vorgabe = dialog.feldVorgabe {
            fenster.addTextField { feld in
                feld.text = vorgabe
                feld.accessibilityIdentifier = "seitendialog-feld"
            }
        }
        if let abbrechen = dialog.abbrechenTitel {
            fenster.addAction(UIAlertAction(title: abbrechen, style: .cancel) { _ in antwort(.abgebrochen) })
        }
        let ok = UIAlertAction(title: Seitendialog.okTitel, style: .default) { [weak fenster] _ in
            antwort(.ok(text: fenster?.textFields?.first?.text))
        }
        fenster.addAction(ok)
        fenster.preferredAction = ok
        oben.present(fenster, animated: true)
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

/// Datenspeicher je Server (Entwurf D3). Die Rückrufe von WebKit kommen auf dem Hauptthread; die
/// Hüllen machen sie `async`, ohne sich auf einen erzeugten async-Namen zu verlassen.
@MainActor
enum Datenspeicher {
    /// `WKWebsiteDataStore.remove(forIdentifier:)`; scheitert, solange ein Webview ihn benutzt.
    static func remove(_ id: UUID) async throws {
        try await withCheckedThrowingContinuation { (fortsetzung: CheckedContinuation<Void, any Error>) in
            WKWebsiteDataStore.remove(forIdentifier: id) { fehler in
                if let fehler {
                    fortsetzung.resume(throwing: fehler)
                } else {
                    fortsetzung.resume()
                }
            }
        }
    }

    static func fetchIdentifiers() async -> [UUID] {
        await withCheckedContinuation { fortsetzung in
            WKWebsiteDataStore.fetchAllDataStoreIdentifiers { fortsetzung.resume(returning: $0) }
        }
    }
}
