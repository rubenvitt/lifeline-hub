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
    case start, anmelden, wartet, angemeldet, pausiert, ruht, beendet
    // Aufträge (Stufe 2, ADR-0105): „Angemeldet“ mit Aufträgen und mit abgelehnten Mitteilungen,
    // der Auftrag offen, von einem anderen übernommen, aufgehoben und mit gescheiterter Quittung.
    case auftraege
    case mitteilungenAus = "mitteilungen-aus"
    case auftragOffen = "auftrag-offen"
    case auftragUebernommen = "auftrag-uebernommen"
    case auftragAufgehoben = "auftrag-aufgehoben"
    case quittungFehler = "quittung-fehler"

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

    /// Aufträge der Kopplung, geordnet (`Auftraege.ordnen`); nur im Speicher, nie auf der Platte
    /// (ADR-0105).
    private(set) var auftraege: [HelferAuftrag] = []
    /// Empfängerzeilen, deren Quittung gerade läuft.
    private(set) var quittungLaeuft: Set<Int64> = []
    /// Empfängerzeilen, deren Quittung scheiterte, mit dem Text für die Seite.
    private(set) var quittungsfehler: [Int64: String] = [:]
    /// Empfängerzeilen, die diese App quittiert hat: „Übernommen um …“ statt „von …“.
    private(set) var eigeneQuittungen: Set<Int64> = []
    /// Der geöffnete Auftrag (Detail), auch aus dem Tippen auf eine Mitteilung.
    var geoeffneterAuftrag: Int64?
    /// Mitteilungen abgelehnt: Aufträge kommen nur bei offener App (Hinweis in „Angemeldet“).
    private(set) var mitteilungenAus = false

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
    /// Prüfung während `Phase.ruht`, alle `Ruhegrund.pruefabstandS` Sekunden.
    @ObservationIgnored private var ruhePruefung: Task<Void, Never>?
    /// Ob die Szene sichtbar ist: die Ortung startet nur aus dem Vordergrund (ADR-0101).
    @ObservationIgnored private var imVordergrund = false
    /// Die Ruhe endete im Hintergrund; die Ortung startet beim nächsten Öffnen.
    @ObservationIgnored private var startNachRuhe = false
    /// Ob die Push-Anmeldung in diesem Lauf der App schon an den Server ging.
    @ObservationIgnored private var pushGemeldet = false

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
        ortung?.beiAntwort = { [weak self] antwort, grund in self?.verarbeite(antwort, grund: grund) }
        ortung?.beiWiederholung = { [weak self] zeit in
            self?.verbindungsstand = zeit.map { .wiederholt($0) } ?? .verbunden
        }
        Pausieranfrage.ausfuehrung = { [weak self] in await self?.pausieren() }
        // iOS hat das Token gewechselt: neu anmelden.
        Geraetetoken.beiNeuemToken = { [weak self] _ in
            self?.pushGemeldet = false
            Task { await self?.meldePushAn() }
        }
        Meldungsweg.verbinde(self)
        let aktivitaet = aktivitaet
        Task { await aktivitaet?.beendeAlte() }
        if let sitzung = Sitzungsablage.lesen() {
            verbindung = Serververbindung(server: sitzung.server, cookie: sitzung.cookie)
            Task {
                await aktualisiereZustand()
                // Einmal je Lauf: so kommt auch ein neues Token zum Server.
                await meldePushAn()
            }
        }
    }

    // MARK: Lebenszyklus

    /// Die Szene ist sichtbar oder nicht mehr: im Vordergrund fragt die App alle 15 s ihren
    /// Zustand ab (statt des Live-Kanals), im Hintergrund erfährt sie ihn aus der nächsten Sendung.
    func szene(aktiv: Bool) {
        abfrage?.cancel()
        abfrage = nil
        imVordergrund = aktiv
        guard aktiv, umgebung == .echt else { return }
        if Pausieranfrage.abholen(), phase == .aktiv {
            Task { await pausieren() }
        }
        // Die Freigaben können sich in den Einstellungen geändert haben.
        if let ortung { ortungVerweigert = ortung.isVerweigert }
        Task { await pruefeMitteilungen() }
        if startNachRuhe {
            startNachRuhe = false
            starteOrtung()
        }
        // Ohne eigene Live-Verbindung (ADR-0105): die Aufträge kommen beim Öffnen, bei jedem Push
        // (`pushEmpfangen`) und mit dieser Abfrage, auch wenn Mitteilungen aus sind.
        abfrage = Task { [weak self] in
            while !Task.isCancelled {
                await self?.aktualisiereZustand()
                await self?.ladeAuftraege()
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
        guard self.einladung == einladung else { return }
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
        // Eine neue Kopplung bekommt eine neue Kennung für Push.
        Pushschluessel.loeschen()
        pushGemeldet = false
        zustand = rueckmeldung.dekodiert(Zustand.self)
        anmeldung.verarbeite(.eingeloest)
        if let zustand {
            anmeldung.verarbeite(
                .zustand(zustand.state, grund: zustand.reason, rolle: zustand.rolle))
        }
        starteOrtung()
        // Nach dem Einlösen fragt die App nach Mitteilungen und meldet Push an (ADR-0105).
        await meldePushAn()
    }

    /// Startet die Ortung, solange die Phase sie verlangt; nur aus dem Vordergrund (Einlösen,
    /// Fortsetzen, Ende der Ruhe oder „Ortung wieder starten“ nach einem Neustart der App). Ohne
    /// Standortrecht startet nichts, auch keine Live-Aktivität: sie zeigte „Ortung an“, ohne dass
    /// etwas gesendet wird.
    func starteOrtung() {
        guard phase.ortet, let ortung else { return }
        ortungVerweigert = ortung.isVerweigert
        guard !ortungVerweigert else { return }
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
        if let verbindung {
            // Erst Push abmelden, solange die Sitzung gilt.
            _ = await verbindung.meldePushAb()
            _ = await verbindung.abmelden()
        }
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
        vergissAuftraege()
    }

    // MARK: Aufträge (Stufe 2, ADR-0105)

    /// Lädt die eigenen Aufträge, solange die Kopplung bestätigt ist. Eine abgewiesene Sitzung
    /// (401) beendet die Kopplung; alles andere lässt die Liste stehen.
    func ladeAuftraege() async {
        guard umgebung == .echt, phase.zeigtAuftraege, let verbindung else { return }
        let rueckmeldung = await verbindung.auftraege()
        guard rueckmeldung.istErfolg, let liste = Auftraege.liste(aus: rueckmeldung.daten) else {
            if rueckmeldung.status == 401 { reagiere(auf: rueckmeldung) }
            return
        }
        guard phase.zeigtAuftraege else { return }
        uebernimm(liste)
    }

    /// „Übernommen“ an einer eigenen Zeile. Ein aufgehobener Auftrag (422) lädt die Liste neu und
    /// zeigt „aufgehoben“; jeder andere Fehler „Bitte über Funk bestätigen“.
    func quittiere(_ auftrag: HelferAuftrag, empfaenger: HelferAuftrag.Empfaenger) async {
        guard stand(auftrag, empfaenger: empfaenger).kannQuittieren else { return }
        quittungsfehler[empfaenger.id] = nil
        quittungLaeuft.insert(empfaenger.id)
        defer { quittungLaeuft.remove(empfaenger.id) }
        if umgebung == .test {
            eigeneQuittungen.insert(empfaenger.id)
            ersetze(Beispiel.quittiert(auftrag, empfaenger: empfaenger, von: anzeigename))
            return
        }
        guard let verbindung else {
            quittungsfehler[empfaenger.id] = AuftragAnzeige.quittungFehlgeschlagen
            return
        }
        let rueckmeldung = await verbindung.quittiere(auftrag: auftrag.id, empfaenger: empfaenger.id)
        if rueckmeldung.istErfolg, let neu = Auftraege.auftrag(aus: rueckmeldung.daten) {
            eigeneQuittungen.insert(empfaenger.id)
            ersetze(neu)
        } else if rueckmeldung.status == 422 {
            await ladeAuftraege()
        } else {
            quittungsfehler[empfaenger.id] = AuftragAnzeige.quittungFehlgeschlagen
            if rueckmeldung.status == 401 { reagiere(auf: rueckmeldung) }
        }
    }

    /// Stand einer Zeile mit dem, was die App gerade tut.
    func stand(_ auftrag: HelferAuftrag, empfaenger: HelferAuftrag.Empfaenger) -> Quittungsstand {
        Quittungsstand.aus(
            auftrag, empfaenger: empfaenger, sendet: quittungLaeuft.contains(empfaenger.id),
            fehler: quittungsfehler[empfaenger.id])
    }

    /// „Übernommen um …“ oder „Übernommen von … um …“.
    func quittungstext(_ empfaenger: HelferAuftrag.Empfaenger, um: Date?, von: String?) -> String {
        let name = anzeigename.trimmingCharacters(in: .whitespacesAndNewlines)
        let eigen = eigeneQuittungen.contains(empfaenger.id) || (!name.isEmpty && von == name)
        return AuftragAnzeige.quittiert(um: um, von: von, eigen: eigen)
    }

    func auftrag(_ id: Int64) -> HelferAuftrag? {
        auftraege.first { $0.id == id }
    }

    /// Ein Push bei offener App (`willPresent`): die Liste neu laden.
    func pushEmpfangen() {
        Task { await ladeAuftraege() }
    }

    /// Tippen auf eine Mitteilung: den Auftrag öffnen und die Liste neu laden.
    func meldungAngetippt(auftrag: Int64?) {
        guard phase.zeigtAuftraege else { return }
        if let auftrag { geoeffneterAuftrag = auftrag }
        Task { await ladeAuftraege() }
    }

    /// Fragt nach Mitteilungen (nur, solange nicht entschieden), holt das Token und meldet Kennung,
    /// Token und Schlüssel mit `PUT /api/devices/me/push` an; einmal je Lauf und nach jedem
    /// neuen Token. Abgelehnt → Hinweis, nichts an den Server.
    func meldePushAn() async {
        guard umgebung == .echt, phase.gekoppelt, let verbindung else { return }
        let erlaubt = await Mitteilungen.erlaubtOderFragen()
        mitteilungenAus = !erlaubt
        guard erlaubt, !pushGemeldet else { return }
        guard let token = try? await Geraetetoken.anfordern(),
            let anmeldung = Pushschluessel.anmeldung(token: token),
            phase.gekoppelt, self.verbindung === verbindung
        else { return }
        let rueckmeldung = await verbindung.meldePushAn(anmeldung)
        if rueckmeldung.istErfolg {
            pushGemeldet = true
        } else if rueckmeldung.status == 401 {
            reagiere(auf: rueckmeldung)
        }
    }

    /// Ob Mitteilungen erlaubt sind; erst in den Einstellungen erlaubt, meldet die App neu an.
    private func pruefeMitteilungen() async {
        guard umgebung == .echt, phase.gekoppelt else { return }
        let vorher = mitteilungenAus
        mitteilungenAus = await Mitteilungen.freigabe() == .verweigert
        if vorher, !mitteilungenAus { await meldePushAn() }
    }

    private func uebernimm(_ liste: [HelferAuftrag]) {
        auftraege = Auftraege.ordnen(liste)
        let zeilen = Set(auftraege.flatMap { $0.recipients.map(\.id) })
        quittungsfehler = quittungsfehler.filter { zeilen.contains($0.key) }
    }

    private func ersetze(_ neu: HelferAuftrag) {
        uebernimm(auftraege.map { $0.id == neu.id ? neu : $0 })
    }

    private func vergissAuftraege() {
        auftraege = []
        quittungLaeuft = []
        quittungsfehler = [:]
        eigeneQuittungen = []
        geoeffneterAuftrag = nil
    }

    // MARK: Antworten

    /// Antwort des Servers auf eine Sendung des Ortungsdienstes.
    private func verarbeite(_ antwort: Antwort, grund: String?) {
        switch antwort {
        case .weiter:
            letzteSendung = Date()
            verbindungsstand = .verbunden
        case .warten:
            verbindungsstand = .verbunden
        case .wiederholen, .verwerfen, .stoppen, .ruhen:
            break
        }
        let vorher = phase
        anmeldung.verarbeite(.antwort(antwort, grund: grund))
        nachWechsel(von: vorher)
        if phase.ortet { aktivitaet?.aktualisiere(aktivitaetsstand) }
    }

    /// Eine Antwort außerhalb der Sendungen: 401, 403 und 404 beenden die Kopplung, ein 403 mit
    /// `Ruhegrund` lässt sie ruhen.
    private func reagiere(auf rueckmeldung: Rueckmeldung) {
        let antwort = rueckmeldung.antwort
        guard antwort == .stoppen || antwort == .ruhen, phase.gekoppelt else { return }
        let vorher = phase
        anmeldung.verarbeite(.antwort(antwort, grund: rueckmeldung.grund))
        nachWechsel(von: vorher)
    }

    /// Während der Ruhe: alle `Ruhegrund.pruefabstandS` Sekunden den eigenen Zustand holen (eine
    /// neue Rolle beendet `.keineRolle`), bei `.ortungAus` dazu fortsetzen ohne Position (`{paused:
    /// false}`); erst ein angenommenes Fortsetzen beendet die Ruhe.
    private func starteRuhePruefung() {
        ruhePruefung?.cancel()
        guard umgebung == .echt else { return }
        ruhePruefung = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(Ruhegrund.pruefabstandS))
                guard !Task.isCancelled, let self else { return }
                await self.pruefeRuhe()
            }
        }
    }

    private func pruefeRuhe() async {
        await aktualisiereZustand()
        guard case .ruht(let grund) = phase, grund.pruefeMitFortsetzen, let verbindung else {
            return
        }
        let rueckmeldung = await verbindung.pausiere(false)
        guard case .ruht = phase else { return }
        switch rueckmeldung.antwort {
        case .weiter, .warten, .ruhen, .stoppen:
            let vorher = phase
            anmeldung.verarbeite(.antwort(rueckmeldung.antwort, grund: rueckmeldung.grund))
            nachWechsel(von: vorher)
        case .wiederholen, .verwerfen:
            break
        }
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
        anmeldung.verarbeite(.zustand(neu.state, grund: neu.reason, rolle: neu.rolle))
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

    /// Wirkungen eines Phasenwechsels: Bestätigung melden, Ruhe beginnen und beenden, am Ende alles
    /// abräumen.
    private func nachWechsel(von vorher: Phase) {
        guard phase != vorher else { return }
        if vorher == .unbestaetigt, phase == .aktiv {
            bestaetigungen += 1
            aktivitaet?.aktualisiere(aktivitaetsstand)
            Task { await ladeAuftraege() }
        }
        let ruhteVorher: Bool
        if case .ruht = vorher { ruhteVorher = true } else { ruhteVorher = false }
        if case .ruht = phase {
            // Ohne Ortung keine Live-Aktivität; die Kopplung und die Sitzung bleiben.
            stoppeOrtung()
            aktivitaet?.beende()
            if !ruhteVorher { starteRuhePruefung() }
        } else if ruhteVorher {
            ruhePruefung?.cancel()
            ruhePruefung = nil
            if phase.ortet {
                if imVordergrund { starteOrtung() } else { startNachRuhe = true }
            }
        }
        if case .beendet = phase { raeumeAb() }
    }

    private func raeumeAb() {
        stoppeOrtung()
        aktivitaet?.beende()
        abfrage?.cancel()
        abfrage = nil
        ruhePruefung?.cancel()
        ruhePruefung = nil
        startNachRuhe = false
        Sitzungsablage.loeschen()
        verbindung = nil
        // Der Server löscht die Push-Anmeldung mit der Kopplung; hier fallen Kennung und Schlüssel.
        if umgebung == .echt { Pushschluessel.loeschen() }
        pushGemeldet = false
        vergissAuftraege()
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

    /// Text für eine abgewiesene Anfrage (`Anzeige.meldung` im Kern).
    static func text(fuer rueckmeldung: Rueckmeldung) -> String {
        Anzeige.meldung(
            status: rueckmeldung.status, grund: rueckmeldung.grund,
            fehlertext: rueckmeldung.fehlertext)
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
        case .wartet, .angemeldet, .pausiert, .ruht, .beendet, .auftraege, .mitteilungenAus,
            .auftragOffen, .auftragUebernommen, .auftragAufgehoben, .quittungFehler:
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
            if testzustand == .ruht {
                // Bestätigt ohne Ortungsgerät und ohne Person (Entscheidung 7 der Spec).
                let ohneRolle = Rolle(isTracker: false, personId: nil)
                anmeldung.verarbeite(.zustand("aktiv", grund: nil, rolle: ohneRolle))
                ortungLaeuft = false
            }
            if testzustand == .beendet {
                anmeldung.verarbeite(
                    .zustand("beendet", grund: Grund.einsatzBeendet.wire, rolle: Beispiel.zustand(state: "aktiv").rolle))
                ortungLaeuft = false
            }
            zeigeAuftraege(testzustand)
        }
    }

    private func zeigeAuftraege(_ testzustand: Testzustand) {
        switch testzustand {
        case .auftraege:
            uebernimm(Beispiel.auftraege)
        case .mitteilungenAus:
            mitteilungenAus = true
        case .auftragOffen:
            uebernimm(Beispiel.auftraege)
            geoeffneterAuftrag = Beispiel.offenerAuftrag
        case .auftragUebernommen:
            uebernimm(Beispiel.auftraege)
            geoeffneterAuftrag = Beispiel.uebernommenerAuftrag
        case .auftragAufgehoben:
            uebernimm(Beispiel.auftraege)
            geoeffneterAuftrag = Beispiel.aufgehobenerAuftrag
        case .quittungFehler:
            uebernimm(Beispiel.auftraege)
            geoeffneterAuftrag = Beispiel.offenerAuftrag
            if let zeile = auftrag(Beispiel.offenerAuftrag)?.recipients.first {
                quittungsfehler[zeile.id] = AuftragAnzeige.quittungFehlgeschlagen
            }
        case .start, .anmelden, .wartet, .angemeldet, .pausiert, .ruht, .beendet:
            break
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

    static let offenerAuftrag: Int64 = 7
    static let uebernommenerAuftrag: Int64 = 6
    static let aufgehobenerAuftrag: Int64 = 5

    /// Drei Aufträge: offen (sofort, an die Einheit und an dich), von einem anderen übernommen,
    /// aufgehoben.
    static let auftraege: [HelferAuftrag] = [
        HelferAuftrag(
            id: 7, number: 3, text: "Verletzte Person am Zelt 3, bitte Erstversorgung übernehmen",
            location: "Zelt 3, Festplatz Nord", locationLat: 50.11, locationLon: 8.68,
            priority: "sofort", deadlineAt: "2026-11-25 13:45:00",
            issuedAt: "2026-11-25 13:32:00",
            recipients: [
                .init(id: 101, kind: "unit", label: "San-Trupp 2"),
                .init(id: 102, kind: "person", label: "Max Mustermann"),
            ]),
        HelferAuftrag(
            id: 6, number: 2, text: "Getränke zur Ausgabestelle Ost bringen",
            location: "Ausgabestelle Ost", priority: "normal", issuedAt: "2026-11-25 13:05:00",
            recipients: [
                .init(
                    id: 99, kind: "unit", label: "San-Trupp 2",
                    acknowledgedAt: "2026-11-25 13:07:00", acknowledgedBy: "Lisa K.")
            ]),
        HelferAuftrag(
            id: 5, number: 1, text: "Absperrung Parkplatz West besetzen", priority: "dringend",
            issuedAt: "2026-11-25 12:40:00", cancelledAt: "2026-11-25 12:55:00",
            recipients: [.init(id: 98, kind: "unit", label: "San-Trupp 2")]),
    ]

    /// Der Auftrag nach einer Quittung im Testzustand, wie der Server ihn zurückgäbe.
    static func quittiert(
        _ auftrag: HelferAuftrag, empfaenger: HelferAuftrag.Empfaenger, von: String
    ) -> HelferAuftrag {
        let format = DateFormatter()
        format.locale = Locale(identifier: "en_US_POSIX")
        format.timeZone = TimeZone(identifier: "UTC")
        format.dateFormat = "yyyy-MM-dd HH:mm:ss"
        let jetzt = format.string(from: Date())
        return HelferAuftrag(
            id: auftrag.id, number: auftrag.number, text: auftrag.text, location: auftrag.location,
            locationLat: auftrag.locationLat, locationLon: auftrag.locationLon,
            priority: auftrag.priority, deadlineAt: auftrag.deadlineAt, issuedAt: auftrag.issuedAt,
            cancelledAt: auftrag.cancelledAt,
            recipients: auftrag.recipients.map { zeile in
                guard zeile.id == empfaenger.id else { return zeile }
                return HelferAuftrag.Empfaenger(
                    id: zeile.id, kind: zeile.kind, label: zeile.label, acknowledgedAt: jetzt,
                    acknowledgedBy: von)
            })
    }
}
