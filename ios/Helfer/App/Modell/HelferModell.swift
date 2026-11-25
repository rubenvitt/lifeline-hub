import Foundation
import HelferKern
import Observation

/// Verbindung zum Server, wie die Seite „Angemeldet“ sie zeigt.
enum Verbindungsstand: Equatable, Sendable {
    /// Noch keine Antwort auf eine Sendung.
    case unbekannt
    /// Die letzte Sendung kam an.
    case verbunden
    /// Kein Netz oder der Server antwortet nicht; nächster Versuch zur genannten Zeit.
    case wiederholt(Date)
}

/// Seiten, die die App im Testzustand mit Beispieldaten zeigt (Startargument
/// `-HelferTestzustand <seite>`; ohne Netz, Schlüsselbund, Ortung und Live-Aktivität). Für die
/// Bildschirmbilder in ios/HelferUITests.
enum Testzustand: String, CaseIterable, Sendable {
    case start, anmelden, wartet, angemeldet, pausiert, beendet

    static let argument = "-HelferTestzustand"

    init?(argumente: [String]) {
        guard let stelle = argumente.firstIndex(of: Self.argument),
            argumente.indices.contains(stelle + 1)
        else { return nil }
        self.init(rawValue: argumente[stelle + 1])
    }
}

/// Das Modell der Helfer-App: hält die eine `Anmeldung` (Zustandsautomat im Kern) und führt ihre
/// Wirkungen aus: Server, Schlüsselbund, Ortung, Live-Aktivität. Welche Phase gilt, entscheidet
/// allein `Anmeldung.verarbeite`; die Seiten zeigen nur `phase`.
@MainActor
@Observable
final class HelferModell {
    enum Umgebung: Sendable {
        /// Mit Netz, Schlüsselbund, Ortung und Live-Aktivität.
        case echt
        /// Ohne Systemdienste: Tests und Testzustand.
        case test
    }

    let umgebung: Umgebung

    private(set) var anmeldung = HelferKern.Anmeldung()
    var phase: Phase { anmeldung.phase }

    /// Server und Code der gelesenen Einladung; nach einem Neustart der App unbekannt.
    private(set) var einladung: HelferZiel?
    private(set) var zielliste: Zielliste?
    private(set) var zieleLaden = false
    /// Eigener Zustand vom Server (Einsatz, Ziel, Person, Ablauf).
    private(set) var zustand: Zustand?
    private(set) var letzteSendung: Date?
    private(set) var verbindungsstand: Verbindungsstand = .unbekannt
    /// Eine Anfrage, auf die eine Seite wartet (Knöpfe gesperrt).
    private(set) var beschaeftigt = false
    /// Ob der Ortungsdienst gerade läuft; nach einem Neustart der App nicht, bis die Kraft ihn
    /// wieder startet.
    private(set) var ortungLaeuft = false
    private(set) var ortungVerweigert = false
    /// Zählt jede Bestätigung durch die Leitung (Haptik der Seite).
    private(set) var bestaetigungen = 0

    /// Fehlermeldung für die aktuelle Seite.
    var meldung: String?
    /// Ein neuer Scan während einer Anmeldung; die Seite fragt, ob die alte enden soll.
    var ausstehenderScan: HelferZiel?
    /// Anzeigename, vorbelegt mit dem zuletzt genutzten.
    var anzeigename: String
    var gewaehltesZiel: ZielOption?
    var personOrten = false

    @ObservationIgnored private var verbindung: Serververbindung?
    private let ortung: Ortungsdienst?
    private let aktivitaet: LiveAktivitaet?
    @ObservationIgnored private var abfrage: Task<Void, Never>?

    private static let anzeigenameSchluessel = "anzeigename"

    init(umgebung: Umgebung) {
        self.umgebung = umgebung
        switch umgebung {
        case .echt:
            ortung = Ortungsdienst()
            aktivitaet = LiveAktivitaet()
            anzeigename = UserDefaults.standard.string(forKey: Self.anzeigenameSchluessel) ?? ""
        case .test:
            ortung = nil
            aktivitaet = nil
            anzeigename = ""
        }
    }

    /// Modell für den Start der App: echt, oder mit Beispieldaten im Testzustand.
    static func start(argumente: [String]) -> HelferModell {
        if let testzustand = Testzustand(argumente: argumente) {
            let modell = HelferModell(umgebung: .test)
            modell.zeige(testzustand)
            return modell
        }
        let modell = HelferModell(umgebung: .echt)
        modell.verbindeDienste()
        return modell
    }

    private func verbindeDienste() {
        ortung?.senden = { [weak self] position in
            guard let verbindung = self?.verbindung else { return .netzfehler }
            return await verbindung.sende(position)
        }
        ortung?.beiAntwort = { [weak self] antwort in self?.verarbeite(antwort) }
        ortung?.beiWiederholung = { [weak self] zeit in
            self?.verbindungsstand = zeit.map { .wiederholt($0) } ?? .verbunden
        }
        Pausieranfrage.ausfuehrung = { [weak self] in await self?.pausieren() }
        let aktivitaet = aktivitaet
        Task { await aktivitaet?.beendeAlte() }
        if let sitzung = Sitzungsablage.lesen() {
            verbindung = Serververbindung(server: sitzung.server, cookie: sitzung.cookie)
            Task { await aktualisiereZustand() }
        }
    }

    // MARK: Lebenszyklus

    /// Die Szene ist sichtbar oder nicht mehr: im Vordergrund fragt die App alle 15 s ihren
    /// Zustand ab (statt des Live-Kanals), im Hintergrund erfährt sie ihn aus der nächsten Sendung.
    func szene(aktiv: Bool) {
        abfrage?.cancel()
        abfrage = nil
        guard aktiv, umgebung == .echt else { return }
        if Pausieranfrage.abholen(), phase == .aktiv {
            Task { await pausieren() }
        }
        abfrage = Task { [weak self] in
            while !Task.isCancelled {
                await self?.aktualisiereZustand()
                try? await Task.sleep(for: .seconds(15))
            }
        }
    }

    // MARK: Einladung lesen

    /// QR-Inhalt, Deeplink oder eingegebener Link; `false`, wenn es keine Helfer-Einladung ist.
    @discardableResult
    func gescannt(_ text: String) -> Bool {
        guard let ziel = deuteHelferLink(text) else {
            meldung = "Das ist kein QR-Code einer Helfer-Einladung."
            return false
        }
        if phase.gekoppelt {
            ausstehenderScan = ziel
            return true
        }
        uebernimm(ziel)
        return true
    }

    /// Server und Code aus „Code eingeben“; der Server ohne `https://` ist erlaubt.
    @discardableResult
    func eingegeben(server: String, code: String) -> Bool {
        var adresse = server.trimmingCharacters(in: .whitespacesAndNewlines)
        while adresse.hasSuffix("/") { adresse.removeLast() }
        if !adresse.lowercased().hasPrefix("https://") { adresse = "https://" + adresse }
        let code = code.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: " ", with: "")
        guard !code.isEmpty, gescannt("\(adresse)\(HelferLink.pfad)#\(code)") else {
            meldung = "Server oder Code passen nicht. Der Server braucht eine https-Adresse."
            return false
        }
        return true
    }

    /// Ein Deeplink `lifeline-helfer://anmelden?server=…#CODE`.
    func oeffne(_ url: URL) {
        gescannt(url.absoluteString)
    }

    /// Antwort auf die Rückfrage nach einem neuen Scan während einer Anmeldung.
    func bestaetigeNeuenScan(_ ja: Bool) async {
        guard let neu = ausstehenderScan else { return }
        ausstehenderScan = nil
        guard ja else { return }
        await abmelden()
        uebernimm(neu)
    }

    private func uebernimm(_ ziel: HelferZiel) {
        anmeldung.verarbeite(.gescannt(ziel))
        einladung = ziel
        zielliste = nil
        gewaehltesZiel = nil
        personOrten = false
        meldung = nil
        Task { await ladeZiele() }
    }

    func ladeZiele() async {
        guard let einladung else { return }
        if umgebung == .test {
            zielliste = Beispiel.zielliste
            return
        }
        zieleLaden = true
        defer { zieleLaden = false }
        let rueckmeldung = await Serververbindung(server: einladung.server, cookie: nil)
            .ziele(code: einladung.code)
        if rueckmeldung.istErfolg, let liste = rueckmeldung.dekodiert(Zielliste.self) {
            zielliste = liste
            meldung = nil
        } else {
            meldung = Self.text(fuer: rueckmeldung)
        }
    }

    // MARK: Anmelden

    var kannAnmelden: Bool {
        if case .anmelden = phase {
            return gewaehltesZiel != nil && !beschaeftigt
                && !anzeigename.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        return false
    }

    /// „Anmelden und Ortung erlauben“: fragt nach „When in Use“, löst die Einladung ein und
    /// startet sofort die Ortung (Spec „Ablauf“, Schritt 5: schon beim Einlösen).
    func anmelden() async {
        guard case .anmelden(let ziel) = phase, let gewaehlt = gewaehltesZiel, kannAnmelden else {
            return
        }
        let name = anzeigename.trimmingCharacters(in: .whitespacesAndNewlines)
        beschaeftigt = true
        defer { beschaeftigt = false }
        meldung = nil
        if let ortung {
            ortungVerweigert = !(await ortung.requestFreigabe())
        }
        if umgebung == .test {
            anmeldung.verarbeite(.eingeloest)
            return
        }
        let verbindung = Serververbindung(server: ziel.server, cookie: nil)
        let rueckmeldung = await verbindung.einloesen(
            Einloesung(
                code: ziel.code, displayName: name, target: gewaehlt.eingabe,
                trackPerson: personOrten && (zielliste?.personTrackingAllowed ?? false)))
        guard rueckmeldung.status == 201, let cookie = verbindung.cookie else {
            meldung = Self.text(fuer: rueckmeldung)
            return
        }
        UserDefaults.standard.set(name, forKey: Self.anzeigenameSchluessel)
        Sitzungsablage.speichern(.init(server: ziel.server, cookie: cookie))
        self.verbindung = verbindung
        zustand = rueckmeldung.dekodiert(Zustand.self)
        anmeldung.verarbeite(.eingeloest)
        if let zustand { anmeldung.verarbeite(.zustand(zustand.state, grund: zustand.reason)) }
        starteOrtung()
    }

    /// Startet die Ortung, solange die Phase sie verlangt; nur aus dem Vordergrund (Einlösen,
    /// Fortsetzen oder „Ortung wieder starten“ nach einem Neustart der App).
    func starteOrtung() {
        guard phase.ortet, let ortung else { return }
        ortungVerweigert = ortung.isVerweigert
        ortung.starte()
        ortungLaeuft = true
        aktivitaet?.starte(
            OrtungAttribute(einsatz: einsatzname, ziel: zielname), zustand: aktivitaetsstand)
    }

    /// „Ortung wieder starten“ nach einem Neustart der App: fragt erst nach der Freigabe.
    func ortungWiederStarten() async {
        if let ortung { ortungVerweigert = !(await ortung.requestFreigabe()) }
        starteOrtung()
    }

    private func stoppeOrtung() {
        ortung?.stoppe()
        ortungLaeuft = false
    }

    // MARK: Ziel ändern (nur unbestätigt)

    /// Ob die Kraft das Ziel noch ändern kann: nur unbestätigt und nur, solange die App den Code
    /// der Einladung kennt (für die Zielliste).
    var kannZielAendern: Bool { phase == .unbestaetigt && einladung != nil }

    func zielAendern(_ option: ZielOption) async {
        guard kannZielAendern, let verbindung else { return }
        beschaeftigt = true
        defer { beschaeftigt = false }
        let rueckmeldung = await verbindung.zielAendern(option.eingabe)
        if rueckmeldung.istErfolg, let neu = rueckmeldung.dekodiert(Zustand.self) {
            zustand = neu
            gewaehltesZiel = option
            if ortungLaeuft {
                aktivitaet?.starte(
                    OrtungAttribute(einsatz: einsatzname, ziel: zielname),
                    zustand: aktivitaetsstand)
            }
        } else {
            meldung = Self.text(fuer: rueckmeldung)
            reagiere(auf: rueckmeldung)
        }
    }

    // MARK: Pausieren und Fortsetzen

    /// Pausieren (App oder Live-Aktivität): die Ortung hört sofort auf; der Server erfährt es mit
    /// `paused: true`. Erreicht ihn das nicht, holt die nächste Abfrage es nach.
    func pausieren() async {
        guard phase == .aktiv else { return }
        anmeldung.verarbeite(.pausiert)
        stoppeOrtung()
        aktivitaet?.aktualisiere(aktivitaetsstand)
        guard let verbindung else { return }
        let rueckmeldung = await verbindung.pausiere(true)
        reagiere(auf: rueckmeldung)
    }

    /// „Fortsetzen“ geht nur in der geöffneten App und nur, wenn der Server zustimmt.
    func fortsetzen() async {
        guard phase == .pausiert else { return }
        if umgebung == .test {
            anmeldung.verarbeite(.fortgesetzt)
            return
        }
        guard let verbindung else { return }
        beschaeftigt = true
        defer { beschaeftigt = false }
        let rueckmeldung = await verbindung.pausiere(false)
        if rueckmeldung.istErfolg {
            anmeldung.verarbeite(.fortgesetzt)
            starteOrtung()
        } else {
            meldung = Self.text(fuer: rueckmeldung)
            reagiere(auf: rueckmeldung)
        }
    }

    // MARK: Abmelden und Ende

    /// „Abmelden“ oder „Abbrechen“: vor dem Einlösen zurück zum Start, danach `POST
    /// /api/auth/logout` und Ende mit Grund „abgemeldet“. Die Ortung hört in jedem Fall auf.
    func abmelden() async {
        if case .anmelden = phase {
            anmeldung.verarbeite(.abgemeldet)
            einladung = nil
            return
        }
        guard phase.gekoppelt else { return }
        beschaeftigt = true
        defer { beschaeftigt = false }
        let vorher = phase
        stoppeOrtung()
        if let verbindung { _ = await verbindung.abmelden() }
        anmeldung.verarbeite(.abgemeldet)
        nachWechsel(von: vorher)
    }

    /// „Neu anmelden“ auf der Seite „Beendet“.
    func neuAnmelden() {
        anmeldung = HelferKern.Anmeldung()
        einladung = nil
        zielliste = nil
        zustand = nil
        letzteSendung = nil
        verbindungsstand = .unbekannt
        gewaehltesZiel = nil
        meldung = nil
    }

    // MARK: Antworten

    /// Antwort des Servers auf eine Sendung des Ortungsdienstes.
    private func verarbeite(_ antwort: Antwort) {
        switch antwort {
        case .weiter:
            letzteSendung = Date()
            verbindungsstand = .verbunden
        case .warten:
            verbindungsstand = .verbunden
        case .wiederholen, .verwerfen, .stoppen:
            break
        }
        let vorher = phase
        anmeldung.verarbeite(.antwort(antwort))
        nachWechsel(von: vorher)
        if phase.ortet { aktivitaet?.aktualisiere(aktivitaetsstand) }
    }

    /// Eine Antwort außerhalb der Sendungen: 401, 403 und 404 beenden die Kopplung.
    private func reagiere(auf rueckmeldung: Rueckmeldung) {
        guard rueckmeldung.antwort == .stoppen, phase.gekoppelt else { return }
        let vorher = phase
        stoppeOrtung()
        anmeldung.verarbeite(.antwort(.stoppen))
        nachWechsel(von: vorher)
    }

    /// Eigener Zustand vom Server (Abfrage im Vordergrund und nach dem Start der App).
    func aktualisiereZustand() async {
        guard umgebung == .echt, let verbindung else { return }
        let rueckmeldung = await verbindung.zustand()
        guard rueckmeldung.istErfolg, let neu = rueckmeldung.dekodiert(Zustand.self) else {
            if rueckmeldung.antwort == .stoppen {
                if phase.gekoppelt {
                    reagiere(auf: rueckmeldung)
                } else {
                    // Gespeicherte Sitzung beim Start ungültig: vergessen.
                    Sitzungsablage.loeschen()
                    self.verbindung = nil
                }
            }
            return
        }
        zustand = neu
        let vorher = phase
        anmeldung.verarbeite(.zustand(neu.state, grund: neu.reason))
        if neu.paused, phase == .aktiv {
            // Pausiert aus der Live-Aktivität, während die App nicht lief.
            anmeldung.verarbeite(.pausiert)
            stoppeOrtung()
        } else if !neu.paused, phase == .pausiert {
            // Die Pause erreichte den Server nicht: nachholen.
            _ = await verbindung.pausiere(true)
        }
        nachWechsel(von: vorher)
    }

    /// Wirkungen eines Phasenwechsels: Bestätigung melden, am Ende alles abräumen.
    private func nachWechsel(von vorher: Phase) {
        guard phase != vorher else { return }
        if vorher == .unbestaetigt, phase == .aktiv {
            bestaetigungen += 1
            aktivitaet?.aktualisiere(aktivitaetsstand)
        }
        if case .beendet = phase { raeumeAb() }
    }

    private func raeumeAb() {
        stoppeOrtung()
        aktivitaet?.beende()
        abfrage?.cancel()
        abfrage = nil
        Sitzungsablage.loeschen()
        verbindung = nil
    }

    // MARK: Anzeige

    var einsatzname: String { zustand?.incident.name ?? "Einsatz" }
    var zielname: String { zustand?.target?.name ?? gewaehltesZiel?.name ?? "Ohne Ziel" }
    var servername: String { (einladung?.server ?? verbindung?.server)?.host() ?? "" }

    private var aktivitaetsstand: OrtungAttribute.ContentState {
        OrtungAttribute.ContentState(
            letzteSendung: letzteSendung, pausiert: phase == .pausiert,
            wartet: phase == .unbestaetigt)
    }

    /// Text für eine abgewiesene Anfrage.
    static func text(fuer rueckmeldung: Rueckmeldung) -> String {
        switch rueckmeldung.status {
        case 0: return "Der Server ist nicht erreichbar. Prüfe die Verbindung und versuche es erneut."
        case 401: return "Der Code ist ungültig oder abgelaufen. Bitte den QR-Code neu scannen."
        case 403 where rueckmeldung.grund == "tracking_off", 403 where rueckmeldung.grund == nil:
            return "Die Ortung ist für diese Organisation ausgeschaltet."
        case 409 where rueckmeldung.grund == "person_session":
            return "Auf diesem Gerät ist eine persönliche Anmeldung aktiv."
        case 409: return "Das geht im aktuellen Zustand der Anmeldung nicht."
        case 422: return rueckmeldung.fehlertext ?? "Die Angaben passen nicht. Bitte prüfen."
        case 429: return "Zu viele Versuche. Bitte kurz warten."
        default:
            return rueckmeldung.fehlertext ?? "Unerwartete Antwort des Servers (\(rueckmeldung.status))."
        }
    }

    // MARK: Testzustand

    private func zeige(_ testzustand: Testzustand) {
        let einladung = Beispiel.einladung
        anzeigename = "Max M., San-Trupp 2"
        switch testzustand {
        case .start:
            return
        case .anmelden:
            anmeldung.verarbeite(.gescannt(einladung))
            self.einladung = einladung
            zielliste = Beispiel.zielliste
            gewaehltesZiel = Beispiel.zielliste.targets.first
        case .wartet, .angemeldet, .pausiert, .beendet:
            anmeldung.verarbeite(.gescannt(einladung))
            self.einladung = einladung
            zielliste = Beispiel.zielliste
            gewaehltesZiel = Beispiel.zielliste.targets.first
            anmeldung.verarbeite(.eingeloest)
            zustand = Beispiel.zustand(state: "unbestaetigt")
            ortungLaeuft = true
            if testzustand == .wartet { return }
            anmeldung.verarbeite(.bestaetigt)
            zustand = Beispiel.zustand(state: "aktiv")
            letzteSendung = Date().addingTimeInterval(-12)
            verbindungsstand = .verbunden
            if testzustand == .pausiert {
                anmeldung.verarbeite(.pausiert)
                ortungLaeuft = false
            }
            if testzustand == .beendet {
                anmeldung.verarbeite(.zustand("beendet", grund: Grund.einsatzBeendet.wire))
                ortungLaeuft = false
            }
        }
    }
}

/// Beispieldaten für Tests und Bildschirmbilder.
enum Beispiel {
    static let einladung = HelferZiel(server: URL(string: "https://elw.local:8443/")!, code: "AB12CD34")

    static let zielliste = Zielliste(
        targets: [
            ZielOption(
                kind: "unit", id: 1, name: "San-Trupp 2", callSign: "Rotkreuz Musterstadt 72/2",
                signFunction: "Sanitätsdienst", signOrganization: "DRK"),
            ZielOption(
                kind: "vehicle", id: 7, name: "Rotkreuz Musterstadt 72/83-1", callSign: nil,
                signFunction: "Krankentransport", signOrganization: "DRK"),
            ZielOption(
                kind: "unit", id: 3, name: "Betreuungsgruppe", callSign: nil,
                signFunction: "Betreuung", signOrganization: "DRK"),
        ],
        personTrackingAllowed: true)

    static func zustand(state: String) -> Zustand {
        Zustand(
            state: state, reason: nil,
            incident: .init(id: 42, name: "Stadtfest Musterstadt"),
            target: .init(kind: "unit", id: 1, name: "San-Trupp 2"),
            person: state == "aktiv" ? .init(id: 5, name: "Max Mustermann") : nil,
            isTracker: true, paused: false,
            expiresAt: "2026-11-25 22:00:00", serverTime: "2026-11-25 14:00:00")
    }
}
