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
    /// Hinweis „Zur Oberfläche“ über dem Webview (`Ablauf`: fremde Seite nach der Rückkehr).
    private(set) var zeigtZurOberflaeche = false

    let appVersion: AppVersion?
    let testzustand: Testzustand?

    @ObservationIgnored private let ablage: Serverablage?
    /// Anmeldungen am Push-Kanal (`push.json` neben der Serverliste); `nil` im Testzustand.
    @ObservationIgnored private let pushablage: Pushablage?
    /// Start ohne Server (LLH-1980); `nil` im Testzustand.
    @ObservationIgnored private let vorrat: Vorratsdienst?
    @ObservationIgnored private var wiederholung: Task<Void, Never>?
    @ObservationIgnored private var rueckkehr = Rueckkehr()
    @ObservationIgnored private var gestartet = false
    @ObservationIgnored private var anmelder: Anmelder!
    @ObservationIgnored private var dienste: Systemdienste!
    /// Kennungen, deren Abmeldung gerade läuft (`abmeldenAusstehende`): kein zweiter Aufruf.
    @ObservationIgnored private var abmeldungenLaufend: Set<String> = []
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
            pushablage = nil
            vorrat = nil
            liste = Self.beispielliste()
        } else {
            let verzeichnis = URL.applicationSupportDirectory.appendingPathComponent("Lifeline")
            let ablage = Serverablage(verzeichnis: verzeichnis)
            self.ablage = ablage
            pushablage = Pushablage(verzeichnis: verzeichnis)
            vorrat = Vorratsdienst(
                ablage: Vorratsablage(verzeichnis: verzeichnis.appendingPathComponent("Oberflaechen")))
            liste = ablage.loadOrRecover()
            meldeServerAnzahl()
        }
        anmelder = Anmelder(
            webView: { [weak self] in self?.webView },
            aktiverServer: { [weak self] in self?.liste.aktiv?.adresse })
        dienste = Systemdienste(
            webView: { [weak self] in self?.webView }, anmelder: anmelder, pushablage: pushablage,
            aktiverServer: { [weak self] in self?.liste.aktiv?.id })
        empfang = Brueckenempfang(
            dienste: dienste, aktiverServer: { [weak self] in self?.liste.aktiv?.adresse })
        navigation = Navigationsbegleiter(aktiverServer: { [weak self] in self?.liste.aktiv?.adresse }) {
            [weak self] webView, event in
            // Meldungen eines schon verworfenen Webviews zählen nicht.
            guard let self, webView === self.webView else { return }
            self.send(event)
        }
        if let testzustand { zeige(testzustand) }
    }

    // MARK: Ablauf

    /// Einmal beim ersten Erscheinen der Oberfläche. Erst hier entsteht ein Webview: das Modell
    /// entsteht mit der App, bevor UIKit läuft, und ein Webview aus dieser Zeit bringt seine
    /// Gesten nie in die Gestenumgebung des Fensters (die erste Berührung beendet die App mit
    /// „Invalid parameter not satisfying: targetNode“).
    func start() {
        guard !gestartet else { return }
        gestartet = true
        if let testzustand {
            zeigeBeispielseite(testzustand)
        } else {
            send(.start(aktiv: liste.aktiv))
            // Erst jetzt: ein Tippen auf eine Meldung beim Kaltstart wartete bis hierher und folgt
            // dem Start, statt von ihm überschrieben zu werden.
            Meldungsweg.verbinde(self)
            abmeldenAusstehende()
        }
    }

    func send(_ event: Ablauf.Event) {
        let vorhanden = seite.eintrag.flatMap { vorrat?.version(fuer: $0.id) }
        let schritt = Ablauf.next(seite, event, vorrat: vorhanden)
        seite = schritt.seite
        if !seite.zeigtWebview { closeWebView() }
        if !seite.wiederholt { wiederholung?.cancel() }
        if !seite.zeigtWebview { zeigtZurOberflaeche = false }
        for effekt in schritt.effects { perform(effekt) }
    }

    private func perform(_ effekt: Ablauf.Effect) {
        // Nur Anzeige: gilt auch im Testzustand, der sonst weder Netz noch Ablage anfasst.
        switch effekt {
        case .showZurOberflaeche:
            zeigtZurOberflaeche = true
            return
        case .hideZurOberflaeche:
            zeigtZurOberflaeche = false
            return
        default:
            break
        }
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
            makeWebView(fuer: eintrag).load(URLRequest(url: eintrag.adresse.url))
        case .ladePfad(let eintrag, let pfad):
            // Nach einem Wechsel ist der Webview weg (`send` schließt ihn auf jeder Seite ohne
            // Webview, `Seite.zeigtWebview`); ein Pfad aus dem Kern ist schon abgesichert, der
            // Rückgriff auf die Startadresse gilt nur, falls er sich nicht auflösen ließe.
            let webView = self.webView ?? makeWebView(fuer: eintrag)
            let ziel = URL(string: pfad, relativeTo: eintrag.adresse.url)?.absoluteURL
            webView.load(URLRequest(url: ziel ?? eintrag.adresse.url))
        case .reload:
            guard let webView, let eintrag = seite.eintrag else { return }
            if webView.url != nil {
                webView.reload()
            } else {
                webView.load(URLRequest(url: eintrag.adresse.url))
            }
        case .loadVorrat(let eintrag):
            loadVorrat(eintrag)
        case .vorwaermen(let eintrag, let info):
            vorwaermen(eintrag, info)
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
        case .showZurOberflaeche, .hideZurOberflaeche:
            break
        }
    }

    /// Baut den Webview mit dem Datenspeicher des Eintrags und merkt ihn als aktuellen.
    @discardableResult
    private func makeWebView(fuer eintrag: ServerEintrag) -> WKWebView {
        let webView = Webviewfabrik.make(
            fuer: eintrag,
            skript: Webviewfabrik.initskript(version: appVersion?.fullVersion),
            empfang: empfang, navigation: navigation)
        self.webView = webView
        return webView
    }

    // MARK: Start ohne Server (LLH-1980)

    /// Neuer Webview mit dem Datenspeicher des Servers, gespeicherte Oberfläche laden, dann
    /// prüfen, ob sie hochfährt. Scheitert das, gilt sie für diesen Lauf nicht mehr.
    private func loadVorrat(_ eintrag: ServerEintrag) {
        guard let vorrat else { return }
        closeWebView()
        let webView = makeWebView(fuer: eintrag)
        let geladen = vorrat.loadVorrat(eintrag, in: webView)
        Task {
            let gestartet = geladen ? await vorrat.isGestartet(webView) : false
            guard !gestartet, webView === self.webView else { return }
            vorrat.markGescheitert(eintrag.id)
            send(.vorratGescheitert(fuer: eintrag.id))
        }
    }

    /// Nach dem Laden vom Server, sobald die Seite fertig ist: vorwärmen und ablegen.
    private func vorwaermen(_ eintrag: ServerEintrag, _ info: ShellInfo) {
        guard let vorrat else { return }
        // Sofort, unabhängig davon, ob das Vorwärmen danach läuft (Review LLH-1980).
        vorrat.verwirfVeraltete(eintrag, version: info.version)
        guard let webView else { return }
        Task {
            // `isLoading` steht erst nach dem Start der Navigation; vorher kurz warten.
            try? await Task.sleep(for: .seconds(1))
            let beginn = ContinuousClock.now
            while webView.isLoading, ContinuousClock.now - beginn < .seconds(60) {
                try? await Task.sleep(for: .milliseconds(500))
            }
            guard webView === self.webView, !webView.isLoading else { return }
            await vorrat.vorwaermen(eintrag, info: info, in: webView)
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
        abmeldenAusstehende()
        Task {
            let antwortet = (await webView?.isResponsive()) ?? false
            send(
                .vordergrund(
                    seiteAntwortet: antwortet, adresse: webView?.url,
                    anmeldungLaeuft: anmelder.isLaufend))
        }
    }

    // MARK: Zur Oberfläche

    /// Bietet die Serverliste „Zur Oberfläche“ an? Entscheidet `Ablauf`.
    var bietetZurOberflaeche: Bool { Ablauf.bietetZurOberflaeche(seite) }

    /// „Zur Oberfläche“ oder ein Tipp auf den aktiven Server: Startadresse des aktiven Servers.
    func zurOberflaeche() {
        zeigtServerliste = false
        send(.zurOberflaeche)
    }

    /// Der Hinweis über dem Webview ist weggetippt; die fremde Seite bleibt.
    func verwerfeZurOberflaeche() {
        zeigtZurOberflaeche = false
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
        meldeServerAnzahl()
        do {
            try ablage.save(liste)
        } catch {
            protokoll.error("Serverliste nicht gespeichert: \(error.localizedDescription)")
        }
    }

    /// Die Extension zeigt den Namen des Servers nur bei mehr als einem (`PushNutzlast.meldung`);
    /// die Liste selbst sieht sie nicht.
    private func meldeServerAnzahl() {
        AppGroup.defaults?.set(liste.eintraege.count, forKey: AppGroup.serverAnzahl)
    }

    // MARK: Meldungen

    /// Tipp auf eine Push-Meldung (`Meldungsweg`): die Kennung nennt den Server, `Ablauf`
    /// entscheidet über Wechsel und Pfad. Ein anderer Server wird wie beim Wechsel in der Liste
    /// aktiv, damit die Brücke seine Seite annimmt.
    func meldungAngetippt(kennung: String, pfad: String?) {
        guard testzustand == nil else { return }
        let eintrag = server(zu: kennung).flatMap { id in
            id == inEntfernung ? nil : liste.eintraege.first { $0.id == id }
        }
        if let eintrag {
            zeigtServerliste = false
            zeigtEinstellungen = false
            wechselRueckfrage = nil
            if liste.aktiv?.id != eintrag.id {
                try? liste.activate(eintrag.id)
                save()
            }
        }
        send(.meldungAngetippt(eintrag, pfad: pfad))
    }

    /// Eine Push-Meldung des Servers, dessen Oberfläche gerade läuft, zeigt die App nicht: die
    /// Oberfläche meldet sie selbst über den Live-Kanal (`Meldungsdelegat`).
    func isAktiverServer(kennung: String) -> Bool {
        guard case .web(let aktiv, _) = seite else { return false }
        return server(zu: kennung) == aktiv.id
    }

    private func server(zu kennung: String) -> UUID? {
        guard let pushablage, let anmeldungen = try? pushablage.load() else { return nil }
        return anmeldungen.server(zu: kennung)
    }

    /// Entfernter Server: seine Kennungen kommen zu den ausstehenden Abmeldungen
    /// (`PushAnmeldungen.entfernen(server:abmeldenBei:)`) und werden gleich einmal versucht.
    private func meldePushAb(server id: UUID, adresse: ServerAdresse) {
        guard let pushablage, var anmeldungen = try? pushablage.load() else { return }
        guard !anmeldungen.entfernen(server: id, abmeldenBei: adresse).isEmpty else { return }
        do {
            try pushablage.save(anmeldungen)
        } catch {
            protokoll.error("Push-Anmeldungen nicht gespeichert: \(error.localizedDescription)")
        }
        abmeldenAusstehende()
    }

    /// Jede ausstehende Abmeldung einmal beim Server versuchen: nach dem Entfernen, beim Start
    /// und bei jeder Rückkehr in den Vordergrund, nie in einer Schleife. Erst eine erledigte
    /// (`AusstehendeAbmeldung.isErledigt`) löscht den Schlüssel; ohne Netz bleibt sie liegen,
    /// sonst pushte der Server weiter und die Meldungen ließen sich nicht mehr abstellen. Ohne
    /// Schlüssel gibt es keinen Nachweis, auch später nicht: dann ist sie erledigt.
    private func abmeldenAusstehende() {
        guard testzustand == nil, let pushablage, let offen = try? pushablage.load().ausstehend
        else { return }
        for abmeldung in offen where !abmeldungenLaufend.contains(abmeldung.kennung) {
            abmeldungenLaufend.insert(abmeldung.kennung)
            Task {
                defer { abmeldungenLaufend.remove(abmeldung.kennung) }
                var erledigt = true
                if let schluessel = Schluesselbund.lesen(kennung: abmeldung.kennung) {
                    let status = await Vertragsabruf.meldePushAb(
                        abmeldung.adresse, kennung: abmeldung.kennung,
                        nachweis: Entschluesseler.nachweis(
                            kennung: abmeldung.kennung, schluessel: schluessel))
                    erledigt = AusstehendeAbmeldung.isErledigt(status: status)
                }
                guard erledigt else { return }
                Schluesselbund.loeschen(kennung: abmeldung.kennung)
                guard var anmeldungen = try? pushablage.load() else { return }
                anmeldungen.abgemeldet(kennung: abmeldung.kennung)
                do {
                    try pushablage.save(anmeldungen)
                } catch {
                    protokoll.error(
                        "Push-Anmeldungen nicht gespeichert: \(error.localizedDescription)")
                }
            }
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
        case .web, .fremdeSeite:
            // Den Webview baut `start()` (`zeigeBeispielseite`).
            seite = .web(elw, vertrag: 1)
            zeigtZurOberflaeche = testzustand == .fremdeSeite
        }
    }

    /// Die Beispielseite der Testzustände `web` und `fremde-seite`, mit Brücke und Begleiter.
    private func zeigeBeispielseite(_ testzustand: Testzustand) {
        guard testzustand == .web || testzustand == .fremdeSeite, case .web(let elw, _) = seite
        else { return }
        let webView = Webviewfabrik.make(
            fuer: elw, skript: Webviewfabrik.initskript(version: appVersion?.fullVersion),
            empfang: empfang, navigation: navigation)
        webView.loadHTMLString(
            Testzustand.beispielseite,
            baseURL: testzustand == .fremdeSeite ? URL(string: "https://idp.example/") : elw.adresse.url)
        self.webView = webView
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

    /// Die gespeicherte Oberfläche des Servers (LLH-1980).
    func removeVorrat(_ id: UUID) {
        vorrat?.ablage.remove(id)
    }

    func removeEintrag(_ id: UUID) throws(Serverliste.ListError) {
        let adresse = liste.eintraege.first { $0.id == id }?.adresse
        try liste.remove(id)
        save()
        if let adresse { meldePushAb(server: id, adresse: adresse) }
    }
}
