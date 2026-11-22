import Foundation
import LifelineKern
import WebKit
import os

/// Start ohne Server (LLH-1980; Entwurf
/// `docs/superpowers/specs/2026-11-22-ny0d22bl-ios-start-ohne-server-design.md`): wärmt nach einem
/// Laden vom Server die Assets im Webview vor, legt danach die `index.html` je Server ab und lädt
/// sie ohne Server unter der Adresse des Servers. Was zu tun ist, entscheiden `Vorrat` und
/// `Ablauf` im Kern; hier stehen nur WebKit, Netz und Ablage.
@MainActor
final class Vorratsdienst {
    let ablage: Vorratsablage
    private let holeIndex: @Sendable (URL) async -> ShellAbruf
    private let skript: String
    /// Server, deren gespeicherte Oberfläche in diesem App-Lauf nicht hochfuhr. Nur im Speicher:
    /// ein langsames Gerät soll die Fähigkeit nicht dauerhaft verlieren.
    private var gescheitert: Set<UUID> = []
    private let protokoll = Logger(subsystem: "dev.rubeen.lifeline.ios", category: "ohne-server")

    init(
        ablage: Vorratsablage,
        holeIndex: @escaping @Sendable (URL) async -> ShellAbruf = Vorratsdienst.standardAbruf,
        skript: String = Vorratsdienst.vorwaermskript()
    ) {
        self.ablage = ablage
        self.holeIndex = holeIndex
        self.skript = skript
    }

    /// Version der nutzbaren gespeicherten Oberfläche; `nil` ohne Ablage oder nach einem
    /// gescheiterten Start in diesem Lauf.
    func version(fuer id: UUID) -> String? {
        guard !gescheitert.contains(id) else { return nil }
        return ablage.load(id)?.version
    }

    func markGescheitert(_ id: UUID) {
        gescheitert.insert(id)
    }

    /// Lädt die gespeicherte Oberfläche unter der Adresse des Servers; `false` ohne Ablage.
    func loadVorrat(_ eintrag: ServerEintrag, in webView: WKWebView) -> Bool {
        guard let oberflaeche = ablage.load(eintrag.id) else { return false }
        protokoll.info("Lade gespeicherte Oberfläche \(oberflaeche.version, privacy: .public)")
        webView.loadSimulatedRequest(
            URLRequest(url: eintrag.adresse.url), responseHTML: oberflaeche.html)
        return true
    }

    /// Ist die Oberfläche hochgefahren (das Wurzelelement der App hat Inhalt)? Fragt alle 0,5 s,
    /// höchstens `Vorrat.startpruefungFrist` lang.
    func isGestartet(_ webView: WKWebView) async -> Bool {
        let beginn = ContinuousClock.now
        while ContinuousClock.now - beginn < Vorrat.startpruefungFrist {
            let wert = try? await webView.evaluateJavaScript(
                "(document.getElementById('root')?.childElementCount ?? 0) > 0")
            if (wert as? Bool) == true {
                protokoll.info(
                    "Gestartet nach \(String(describing: ContinuousClock.now - beginn), privacy: .public)")
                return true
            }
            try? await Task.sleep(for: .milliseconds(500))
        }
        protokoll.error("Gespeicherte Oberfläche nicht gestartet")
        return false
    }

    /// Nach einem Laden vom Server: verwerfen, vorwärmen und ablegen, wie `Vorrat.plan` es sagt.
    /// Gespeichert wird nur, wenn jedes Asset ankam.
    func vorwaermen(_ eintrag: ServerEintrag, info: ShellInfo, in webView: WKWebView) async {
        let plan = Vorrat.plan(gespeichert: ablage.load(eintrag.id)?.version, server: info)
        if plan.verwerfen {
            ablage.remove(eintrag.id)
            protokoll.info("Gespeicherte Oberfläche verworfen: neue Version \(info.version, privacy: .public)")
        }
        guard let assets = plan.assets else { return }
        let beginn = ContinuousClock.now
        let rueckgabe = try? await webView.callAsyncJavaScript(
            skript, arguments: ["pfade": assets, "gleichzeitig": Vorrat.gleichzeitig],
            in: nil, contentWorld: .page)
        let ergebnis = rueckgabe as? [String: Any]
        let fehler = ergebnis?["fehler"] as? [String]
        let dauer = String(describing: ContinuousClock.now - beginn)
        guard let fehler, fehler.isEmpty else {
            protokoll.error(
                "Vorwärmen unvollständig: \(fehler?.count ?? assets.count, privacy: .public) von \(assets.count, privacy: .public) fehlen (\(dauer, privacy: .public))")
            return
        }
        guard case .antwort(let status, let body, let contentType) = await holeIndex(eintrag.adresse.url),
            Vorrat.isIndexAntwort(status: status, contentType: contentType),
            let html = String(data: body, encoding: .utf8)
        else {
            protokoll.error("index.html nicht abgelegt: keine HTML-Antwort")
            return
        }
        do {
            try ablage.save(
                GespeicherteOberflaeche(version: info.version, html: html, gespeichertAm: .now),
                fuer: eintrag.id)
            protokoll.info(
                "Vorgewärmt: \(assets.count, privacy: .public) Assets in \(dauer, privacy: .public), Version \(info.version, privacy: .public)")
        } catch {
            protokoll.error("index.html nicht abgelegt: \(error.localizedDescription, privacy: .public)")
        }
    }

    // MARK: Standardwerte

    /// Wie `Vertragsabruf`: ephemer, ohne fremde Weiterleitungen, Zertifikate prüft das System.
    nonisolated private static let session: URLSession = {
        let konfiguration = URLSessionConfiguration.ephemeral
        konfiguration.timeoutIntervalForRequest = 8
        konfiguration.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(
            configuration: konfiguration, delegate: Umleitungssperre(), delegateQueue: nil)
    }()

    nonisolated static func standardAbruf(_ url: URL) async -> ShellAbruf {
        do {
            let (daten, antwort) = try await session.data(from: url)
            let http = antwort as? HTTPURLResponse
            return .antwort(
                status: http?.statusCode ?? 0, body: daten,
                contentType: http?.value(forHTTPHeaderField: "Content-Type"))
        } catch let fehler as URLError {
            return .fehler(fehler.code)
        } catch {
            return .fehler(.unknown)
        }
    }

    /// Das Vorwärm-Skript aus den Ressourcen der App.
    static func vorwaermskript(bundle: Bundle = .main) -> String {
        guard let url = bundle.url(forResource: "vorwaermen", withExtension: "js"),
            let text = try? String(contentsOf: url, encoding: .utf8)
        else {
            Logger(subsystem: "dev.rubeen.lifeline.ios", category: "ohne-server")
                .fault("vorwaermen.js fehlt in den Ressourcen der App")
            return "return { ok: 0, fehler: pfade };"
        }
        return text
    }
}
