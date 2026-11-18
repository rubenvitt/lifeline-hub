import Foundation
import LifelineKern
import Observation
import SwiftUI
import WebKit
import os

/// Zustand der App und Ausführung der Wirkungen, die die Zustandsfunktionen des Kerns verlangen
/// (`Ablauf` für die Seite, `Onboarding` für die Eingabe). Entscheidungen fallen im Kern; hier
/// stehen nur Netz, Webview, Ablage und Zeitgeber.
@MainActor
@Observable
final class AppModell {
    private(set) var liste: Serverliste
    private(set) var seite: Ablauf.Seite = .onboarding
    private(set) var webView: WKWebView?

    var onboarding: Onboarding.State = .start
    /// Version aus `/api/health`, wenn ein Server im Onboarding keinen Vertrag kennt.
    private(set) var onboardingHealthVersion: String?
    var zeigtOnboarding = false
    var zeigtServerliste = false
    var zeigtEinstellungen = false
    /// Ein Deeplink nennt einen gespeicherten, nicht aktiven Server: wechseln erst nach Rückfrage.
    var wechselRueckfrage: ServerEintrag?
    /// Meldung, wenn sich ein Server nicht entfernen ließ.
    var entfernenFehler: String?
    /// Server, dessen Datenspeicher gerade gelöscht wird; zu ihm wechselt die App nicht.
    private(set) var inEntfernung: UUID?

    let appVersion: AppVersion?
    let testzustand: Testzustand?

    @ObservationIgnored private let ablage: Serverablage?
    @ObservationIgnored private var wiederholung: Task<Void, Never>?
    @ObservationIgnored private var rueckkehr = Rueckkehr()
    @ObservationIgnored private var gestartet = false
    @ObservationIgnored private var anmelder: Anmelder!
    @ObservationIgnored private var dienste: Systemdienste!
    @ObservationIgnored private var empfang: Brueckenempfang!
    @ObservationIgnored private var navigation: Navigationsbegleiter!
    @ObservationIgnored private let protokoll = Logger(
        subsystem: "dev.rubeen.lifeline.ios", category: "app")

    init(
        argumente: [String] = ProcessInfo.processInfo.arguments, info: [String: Any] =
            Bundle.main.infoDictionary ?? [:]
    ) {
        appVersion = AppVersion(info: info)
        testzustand = Testzustand(argumente: argumente)
        if testzustand != nil {
            ablage = nil
            liste = Self.beispielliste()
        } else {
            let ablage = Serverablage(
                verzeichnis: URL.applicationSupportDirectory.appendingPathComponent("Lifeline"))
            self.ablage = ablage
            liste = ablage.loadOrRecover()
        }
        anmelder = Anmelder(
            webView: { [weak self] in self?.webView },
            aktiverServer: { [weak self] in self?.liste.aktiv?.adresse })
        dienste = Systemdienste(webView: { [weak self] in self?.webView }, anmelder: anmelder)
        empfang = Brueckenempfang(
            dienste: dienste, aktiverServer: { [weak self] in self?.liste.aktiv?.adresse })
        navigation = Navigationsbegleiter(aktiverServer: { [weak self] in self?.liste.aktiv?.adresse }) {
            [weak self] webView, event in
            // Meldungen eines schon verworfenen Webviews zählen nicht.
            guard let self, webView === self.webView else { return }
            self.send(event)
        }
        // Erst jetzt: der Testzustand `web` braucht Brücke und Begleiter.
        if let testzustand { zeige(testzustand) }
    }

    // MARK: Ablauf

    /// Einmal beim ersten Erscheinen der Oberfläche.
    func start() {
        guard !gestartet, testzustand == nil else { return }
        gestartet = true
        send(.start(aktiv: liste.aktiv))
    }

    func send(_ event: Ablauf.Event) {
        let schritt = Ablauf.next(seite, event)
        seite = schritt.seite
        if case .web = seite {} else { closeWebView() }
        if case .status(_, .nichtErreichbar) = seite {} else { wiederholung?.cancel() }
        for effekt in schritt.effects { perform(effekt) }
    }

    private func perform(_ effekt: Ablauf.Effect) {
        guard testzustand == nil else { return }
        switch effekt {
        case .check(let eintrag):
            let letzter = liste.eintraege.first { $0.id == eintrag.id }?.bestaetigterVertrag
            Task {
                let (ergebnis, health) = await Vertragsabruf.check(
                    eintrag.adresse, letzterVertrag: letzter)
                send(.ergebnis(ergebnis, healthVersion: health, fuer: eintrag.id))
            }
        case .load(let eintrag):
            closeWebView()
            let webView = Webviewfabrik.make(
                fuer: eintrag,
                skript: Webviewfabrik.initskript(version: appVersion?.fullVersion),
                empfang: empfang, navigation: navigation)
            webView.load(URLRequest(url: eintrag.adresse.url))
            self.webView = webView
        case .reload:
            guard let webView, let eintrag = seite.eintrag else { return }
            if webView.url != nil {
                webView.reload()
            } else {
                webView.load(URLRequest(url: eintrag.adresse.url))
            }
        case .markVerbunden(let id, let vertrag):
            try? liste.markVerbunden(id, am: .now, vertrag: vertrag)
            save()
        case .scheduleRetry:
            wiederholung?.cancel()
            wiederholung = Task {
                try? await Task.sleep(for: Ablauf.wiederholIntervall)
                guard !Task.isCancelled else { return }
                send(.wiederholen)
            }
        }
    }

    private func closeWebView() {
        guard let webView else { return }
        Webviewfabrik.close(webView)
        self.webView = nil
    }

    // MARK: Vordergrund

    func scenePhase(_ phase: ScenePhase) {
        let gemeldet: Rueckkehr.Phase
        switch phase {
        case .active: gemeldet = .active
        case .background: gemeldet = .background
        default: gemeldet = .inactive
        }
        guard rueckkehr.melde(gemeldet), testzustand == nil else { return }
        Task {
            let antwortet = (await webView?.isResponsive()) ?? false
            send(.vordergrund(seiteAntwortet: antwortet))
        }
    }

    // MARK: Serverliste

    func wechseln(_ eintrag: ServerEintrag) {
        wechselRueckfrage = nil
        guard eintrag.id != inEntfernung else { return }
        zeigtServerliste = false
        do {
            try liste.activate(eintrag.id)
        } catch {
            protokoll.error("Wechsel auf unbekannten Server")
            return
        }
        save()
        send(.wechseln(liste.aktiv ?? eintrag))
    }

    /// Die Seite „Erneut prüfen“: prüft den Server der Status-Seite sofort.
    func pruefeErneut() {
        guard let eintrag = seite.eintrag else { return }
        send(.wechseln(eintrag))
    }

    func rename(_ eintrag: ServerEintrag, to name: String) {
        try? liste.rename(eintrag.id, to: name)
        save()
    }

    /// Bietet die Liste „Entfernen“ an? Nicht für den aktiven Server.
    func isEntfernbar(_ eintrag: ServerEintrag) -> Bool {
        inEntfernung == nil && Serverentfernung.isEntfernbar(eintrag.id, in: liste)
    }

    /// Nach der Rückfrage: Reihenfolge und Fehler entscheidet `Serverentfernung` im Kern.
    func entfernen(_ eintrag: ServerEintrag) {
        guard inEntfernung == nil else { return }
        inEntfernung = eintrag.id
        Task {
            defer { inEntfernung = nil }
            do {
                try await Serverentfernung.run(eintrag.id, dienste: self)
            } catch {
                protokoll.error("Server nicht entfernt: \(error.localizedDescription)")
                entfernenFehler = error.localizedDescription
            }
        }
    }

    /// Der aktuelle Stand eines Eintrags (Name nach Umbenennen, zuletzt verbunden).
    func aktuell(_ eintrag: ServerEintrag) -> ServerEintrag {
        liste.eintraege.first { $0.id == eintrag.id } ?? eintrag
    }

    private func save() {
        guard let ablage else { return }
        do {
            try ablage.save(liste)
        } catch {
            protokoll.error("Serverliste nicht gespeichert: \(error.localizedDescription)")
        }
    }

    // MARK: Onboarding

    func sendOnboarding(_ event: Onboarding.Event) {
        let schritt = Onboarding.next(onboarding, event)
        onboarding = schritt.state
        switch schritt.effect {
        case .check(let adresse)?:
            onboardingHealthVersion = nil
            guard testzustand == nil else { return }
            Task {
                let (ergebnis, health) = await Vertragsabruf.check(adresse, letzterVertrag: nil)
                onboardingHealthVersion = health
                sendOnboarding(.ergebnis(ergebnis, fuer: adresse))
            }
        case .save(let adresse, let info)?:
            let eintrag = liste.add(adresse)
            try? liste.activate(eintrag.id)
            save()
            zeigtOnboarding = false
            zeigtServerliste = false
            onboarding = .start
            send(.verbunden(liste.aktiv ?? eintrag, info))
        case nil:
            break
        }
    }

    // MARK: Deeplink

    /// Links von außen (`onOpenURL`). Nur `lifeline://verbinden` wirkt; ein
    /// `lifeline://anmeldung?code=…` von außen bleibt wirkungslos, den Rücksprung der Anmeldung
    /// nimmt nur die laufende Sitzung an (`Anmelder`).
    func open(_ url: URL) {
        guard let adresse = Deeplink.parse(url.absoluteString) else { return }
        switch Deeplink.decide(
            aktiv: liste.aktiv?.adresse, bekannt: liste.eintraege.map(\.adresse), neu: adresse)
        {
        case .vorbelegen(let ziel):
            sendOnboarding(.vorbelegen(ziel))
            if seite != .onboarding { zeigtOnboarding = true }
        case .bestaetigen(let ziel):
            wechselRueckfrage = liste.eintrag(fuer: ziel)
        case .nichts:
            break
        }
    }

    // MARK: Testzustände der UI-Tests

    private static func beispielliste() -> Serverliste {
        var liste = Serverliste()
        let elw = liste.add(try! ServerAdresse.parse("https://elw.local:8443"), name: "ELW 1")
        let lager = liste.add(try! ServerAdresse.parse("https://lager.example"), name: "Lager")
        try? liste.markVerbunden(elw.id, am: Date(timeIntervalSince1970: 1_800_000_000), vertrag: 1)
        _ = lager
        return liste
    }

    private func zeige(_ testzustand: Testzustand) {
        let elw = liste.aktiv!
        switch testzustand {
        case .onboarding:
            liste = Serverliste()
            seite = .onboarding
            onboarding = .eingabe(text: "https://elw.local:8443", meldung: nil)
        case .serverliste:
            seite = .status(elw, .nichtErreichbar)
            zeigtServerliste = true
        case .einstellungen:
            seite = .status(elw, .nichtErreichbar)
            zeigtEinstellungen = true
        case .zertifikat:
            seite = .status(elw, .zertifikat)
        case .nichtErreichbar:
            seite = .status(elw, .nichtErreichbar)
        case .zuAlt:
            seite = .status(elw, .nichtVertraeglich(.zuAlt, serverVersion: "1.0.0-alpha.200"))
        case .zuNeu:
            seite = .status(elw, .nichtVertraeglich(.zuNeu, serverVersion: "2.0.0"))
        case .web:
            let webView = Webviewfabrik.make(
                fuer: elw, skript: Webviewfabrik.initskript(version: appVersion?.fullVersion),
                empfang: empfang, navigation: navigation)
            webView.loadHTMLString(Testzustand.beispielseite, baseURL: elw.adresse.url)
            self.webView = webView
            seite = .web(elw, vertrag: 1)
        }
    }
}

/// Entfernen eines Servers (Entwurf D3; tasks.md 8.11).
extension AppModell: Entfernungsdienste {
    var serverliste: Serverliste { liste }

    func closeWebView(datenspeicher id: UUID) {
        guard webView?.configuration.websiteDataStore.identifier == id else { return }
        closeWebView()
    }

    /// Im Testzustand bleibt jeder Datenspeicher, wie er ist.
    func removeDatenspeicher(_ id: UUID) async throws {
        guard testzustand == nil else { return }
        try await Datenspeicher.remove(id)
    }

    func removeEintrag(_ id: UUID) throws(Serverliste.ListError) {
        try liste.remove(id)
        save()
    }
}
