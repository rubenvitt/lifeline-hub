import AuthenticationServices
import LifelineKern
import UIKit
import WebKit
import os

/// „Im Browser anmelden“ (Entwurf D7; Spec `ios-huelle`, „Die App meldet sich im Systembrowser
/// an“; Vorbild `src-tauri/src/aswas.rs`). Öffnet die Bestätigungsseite des aktiven Servers — nie
/// eine Adresse der Seite — in einer `ASWebAuthenticationSession` mit Rücksprung-Schema
/// `lifeline`. Den Rücksprung bekommt nur der Abschluss der Sitzung, nicht `onOpenURL`; der
/// `verifier` verlässt die App nur im Einlöse-Skript gegen dieselbe Origin. Was am Ende geschieht,
/// entscheidet `Anmeldung.folge` im Kern.
@MainActor
final class Anmelder: NSObject, ASWebAuthenticationPresentationContextProviding {
    private struct Laufend {
        let sitzung: ASWebAuthenticationSession
        let verifier: String
        let server: ServerAdresse
        weak var webView: WKWebView?
    }

    private var lauf = Anmeldelauf<Laufend>()
    private let webView: @MainActor () -> WKWebView?
    private let aktiverServer: @MainActor () -> ServerAdresse?
    private let protokoll = Logger(subsystem: "dev.rubeen.lifeline.ios", category: "anmeldung")

    init(
        webView: @escaping @MainActor () -> WKWebView?,
        aktiverServer: @escaping @MainActor () -> ServerAdresse?
    ) {
        self.webView = webView
        self.aktiverServer = aktiverServer
    }

    /// Startet eine Sitzung; eine laufende wird vorher abgebrochen. Wirft, wenn keine beginnt.
    func start() throws {
        guard let server = aktiverServer(), let webView = webView() else {
            throw Anmeldefehler("Es ist kein Server verbunden.")
        }
        abbrechen()
        let verifier = PKCE.neuerVerifier()
        let ziel = Anmeldung.bestaetigungURL(server: server, challenge: PKCE.challenge(aus: verifier))
        let generation = lauf.naechste()
        // Ausdrücklich @Sendable: der Abschluss kommt nicht sicher auf dem Hauptthread (auf dem Mac
        // gemessen auf einer XPC-Queue, `aswas.rs`); er liest nur Werte und gibt dann ab.
        let sitzung = ASWebAuthenticationSession(
            url: ziel, callback: .customScheme(Deeplink.schema)
        ) { @Sendable [weak self] ruecksprung, fehler in
            let ende: Anmeldung.Ende
            if let ruecksprung {
                ende = .ruecksprung(ruecksprung.absoluteString)
            } else if let fehler = fehler as? ASWebAuthenticationSessionError,
                fehler.code == .canceledLogin
            {
                ende = .abgebrochen
            } else {
                ende = .fehler
            }
            let grund = fehler?.localizedDescription
            Task { @MainActor in self?.beende(generation, ende, grund: grund) }
        }
        sitzung.presentationContextProvider = self
        // Geteilte Browsersitzung wie in der Mac-App (`main.rs`, `aswas::starten(…, false, …)`):
        // Passkeys und die Sitzung beim Identitätsanbieter tragen. Gegen die Sitzung einer anderen
        // Person steht die Bestätigungsseite mit Namen (Design LFH-818, Entscheidung 7).
        sitzung.prefersEphemeralWebBrowserSession = false
        guard sitzung.start() else {
            throw Anmeldefehler("Die Anmeldung im Browser ließ sich nicht starten.")
        }
        lauf.merke(
            generation,
            Laufend(sitzung: sitzung, verifier: verifier, server: server, webView: webView))
    }

    /// Läuft gerade „Im Browser anmelden“? Dann gehört eine fremde Seite zur Anmeldung.
    var isLaufend: Bool { lauf.isLaufend }

    /// Bricht eine laufende Sitzung ab; deren Abschluss findet danach keine Sitzung mehr.
    func abbrechen() {
        lauf.nimm()?.sitzung.cancel()
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        if let fenster = webView()?.window { return fenster }
        let szene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        return szene?.keyWindow ?? szene?.windows.first ?? ASPresentationAnchor()
    }

    /// Nur die eigene Sitzung, nur im Webview, in dem sie begann, und nur, solange er noch der
    /// Webview der App ist (nach einem Serverwechsel ist er es nicht mehr).
    private func beende(_ generation: UInt64, _ ende: Anmeldung.Ende, grund: String?) {
        guard let laufend = lauf.beende(generation) else { return }
        if ende == .fehler, let grund { protokoll.warning("Anmeldung im Browser gescheitert: \(grund)") }
        let webView = laufend.webView.flatMap { $0 === self.webView() ? $0 : nil }
        let skript: String
        switch Anmeldung.folge(ende, seite: webView?.url, server: laufend.server) {
        case .einloesen(let code):
            skript = Anmeldung.einloeseSkript(server: laufend.server, code: code, verifier: laufend.verifier)
        case .melden(let ergebnis):
            skript = Anmeldung.meldungSkript(ergebnis)
        case .nichts:
            protokoll.warning("Anmeldung nicht eingelöst: der Webview zeigt keine Anmeldeseite des Servers")
            return
        }
        webView?.evaluateJavaScript(skript, completionHandler: nil)
    }
}

struct Anmeldefehler: LocalizedError {
    let errorDescription: String?
    init(_ text: String) { errorDescription = text }
}
