# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst der rote Test, dann der
Code. Pfade ohne Präfix sind im Frontend relativ zu `frontend/src/`, im Backend relativ zum
Repo-Wurzelverzeichnis.

## 1. Backend: Feld „Weg“ (D3)

- [x] 1.1 Migration `migrations/0180_auftrag_weg.sql` mit `ALTER TABLE auftrag ADD COLUMN weg
  TEXT;` und einem Kopfkommentar (LLH-1091, Verweis auf diese Change). Vorher die Nummer mit
  `git fetch origin alpha && scripts/check-migrationen.sh` gegen `origin/alpha` prüfen.
  Nachweis: `db::tests::migrationsnummern_sind_eindeutig` ist grün, und
  `scripts/check-migrationen.sh` meldet keinen Konflikt.
- [x] 1.2 `weg` durch `src/auftrag/` führen:
  - `NeuerAuftrag` und `ValidierterAuftrag` (`eingabe.rs`), geprüft mit `befehlsfeld(&req.weg,
    "Weg")`; das Etikett von `ort` wird „Ziel/Ort“
  - `AuftragDaten`, `ANZEIGE_SELECT` und der Insert in `anlegen_tx` (`repo.rs`)
  - `AuftragAnzeige` (`mod.rs`)
  - `weg: None` in den Struct-Literalen in `src/etb/repo.rs`, `src/chat/repo.rs`,
    `src/meldung/repo.rs`, `src/demo/import.rs`, `src/auftrag/repo.rs` (Tests) und
    `tests/listen_abfragen.rs`

  Nachweis: Ein neuer Integrationstest erteilt einen Auftrag mit Weg `"  über B 3  "` und liest
  im Detail und in der Liste `"über B 3"`. Ein Weg aus Leerzeichen ergibt `null` (Spec
  „Ein Auftrag trägt den Weg“). `cargo test` für `auftrag` ist grün.
- [x] 1.3 `tests/eingabegrenzen_auftrag.rs`: `mit_feld("weg", x(2_000))` unter `gut` und
  `(mit_feld("weg", x(2_001)), "Weg")` unter `schlecht`. Nachweis: der Test ist grün. Als
  Mutationsprobe die Prüfung von `weg` in `eingabe.rs` entfernen: dann wird er rot.
- [x] 1.4 Weitere Entstehungswege: Ein Test für einen Auftrag aus dem ETB
  (`AuftragAusEtbModal`-Weg, Route `…/etb/…/auftrag` o. ä.) trägt den Weg durch. Das gilt nur,
  wenn der Weg den Request-Body von `NeuerAuftrag` durchreicht. Reicht er ihn nicht durch, gilt
  stattdessen der Nachweis, dass Meldung, Chat und ETB `NeuerAuftrag` unverändert durchreichen
  (Code-Stelle im Commit nennen). Nachweis: der Test ist grün bzw. die Stellen sind belegt.
- [x] 1.5 Schwärzung: `scrub("weg", Strategie::NullSetzen, Z_EINSATZ)` in der Regel `auftrag`
  (`src/einsatz/schwaerzung_registry.rs`). Der Einsatz-Test in `src/einsatz/repo.rs` (Insert mit
  allen Feldern, Select samt Array) nimmt `weg` auf. Nachweis: Wächter
  `jede_einsatz_scoped_spalte_ist_klassifiziert` und der Einsatz-Test sind grün. Als Gegenprobe
  macht die Spalte ohne Regel den Wächter rot.
- [x] 1.6 Typ-Codegen mit `scripts/check-typ-codegen.sh`. `frontend/src/api/openapi.json` und
  `types.generated.ts` werden mitcommittet, `NeuerAuftrag` in `api/types.ts` bekommt `weg?:
  string`. Nachweis: das Skript ist grün.

## 2. Frontend: Formular nach FwDV 100 (D1, D2, D4)

- [x] 2.1 Reines Modul `auftraege/auftragsschemaKern.ts` mit den beiden Feldfolgen:
  - `AUSFUEHRUNG_FELDER`: mittel, ort, weg, zeit
  - `WEITERE_FELDER`: lage, absicht, verbindung, sicherheit, richtung, erteiltAm, externKategorie,
    externBezeichnung

  Dazu die Etiketten für Formular und Karte und eine Funktion `klappteilFuer(feld)`. Nachweis:
  `auftragsschemaKern.test.ts` pinnt beide Folgen und ordnet jedes Feld genau einem Klappteil zu.
- [x] 2.2 `AuftragFormular.tsx`:
  - Empfänger in eigener Zeile zuerst, darunter „Auftrag / Was“, darunter Priorität und Frist
  - zwei `Collapse`-Einträge „Ausführung: Mittel, Ziel, Weg, Zeit“ und „Weitere Angaben“, ohne
    `forceRender`
  - neues Feld „Weg“ (`befehlsfeldRegel('Weg')`, Zähler wie die übrigen)
  - Etiketten „Ziel / Ort“ und „Absicht“
  - `absenden` schickt `weg`

  Nachweis in `AuftragFormular.test.tsx`:
  - Zählung 4 im Ausgangszustand, Etiketten-Folge gepinnt
  - Gegenprobe „Ausführung aufklappen → 8“ mit den vier Etiketten in Folge
  - Gegenprobe „Weitere Angaben aufklappen → 10“
  - Fokus im Empfänger
  - `weg` im gesendeten Body, Überlänge von „Weg“ meldet „Weg darf …“

  Dazu Testhelfer `oeffneAusfuehrung`/`oeffneWeitere` statt `/Befehlsschema/`, der bestehende
  Überlängen-Test über acht Felder.
- [x] 2.3 Selbstöffnen (D4): Ein kontrollierter `activeKey` (Mehrfachöffnung).
  `onPruefungGescheitert` nimmt die Klappteile der gescheiterten Felder auf (`klappteilFuer`).
  Nachweis: Ein Vitest tippt einen überlangen Weg, schließt „Ausführung“, sendet und findet den
  Klappteil offen, den Grund am Feld und keinen Aufruf von `onAnlegen`. Gegenprobe: Ein Fehler nur
  im Empfänger öffnet keinen Klappteil.
- [x] 2.4 Einbettungen: `etb/AuftragAusEtbModal.tsx` sowie die Wege aus Meldung und Chat
  übernehmen die neue Folge ohne eigenen Code. Nachweis: Ihre bestehenden Tests sind grün, und ein
  Test der ETB-Einbettung prüft, dass der Empfänger vor dem vorbelegten Auftragstext steht und den
  Fokus hat.

## 3. Frontend: Karte (D5)

- [x] 3.1 `AuftragKarte.tsx` liest Folge und Etiketten aus `auftragsschemaKern.ts`, mit `weg`.
  Nachweis in `AuftragKarte.test.tsx`:
  - Ein Auftrag mit Mittel, Weg und Absicht zeigt beim Aufklappen genau „Mittel“, „Weg“, „Absicht“
    und „Erteilt am“ in Folge.
  - Ein Bestandsauftrag mit `ort`/`absicht` zeigt „Ziel / Ort“ und „Absicht“.
  - „Erteilt am“ steht immer (jeder Auftrag trägt eine Erteilzeit), deshalb gibt es keinen Fall
    „ohne Feld kein Klappteil“; die Spec ist entsprechend gefasst.

## 4. Frontend: Befehlsvorlage (D6)

- [x] 4.1 `befehle/vorlagen.ts`: `nurBestand?: true` an `VorlageDef`, gesetzt an
  `befehl_ea_zmw`. Der Spiegelkommentar in `vorlagen.ts` und in `src/befehl/mod.rs` nennt die
  Markierung als reine Frontend-Angabe. Nachweis: `vorlagen.test.ts` pinnt, dass genau
  `befehl_ea_zmw` `nurBestand` trägt und alle vier Vorlagen in `VORLAGEN` bleiben.
- [x] 4.2 `auftraege/BefehlListe.tsx`: Der Dialog bietet nur `!nurBestand` an. Spaltenfilter und
  Label lesen weiter die volle Liste. Nachweis in `BefehlListe.test.tsx`:
  - Der Dialog zeigt genau drei Optionen ohne „Einzelauftrag (EA/ZMW)“.
  - `waehleSchema` wählt „Befehl SCHNEE“ statt der EA-Vorlage.
  - Der Filter „Einzelauftrag (EA/ZMW)“ trifft einen Bestandsbefehl.
- [x] 4.3 Bestandsbefehl: Ein Test in `pages/BefehlDetailPage.test.tsx` öffnet einen Entwurf mit
  `befehl_ea_zmw`, zeigt die vier Abschnitte, und „Speichern“ sendet sie unter ihren Schlüsseln.
  Ein Test für die Fortschreibung mit dieser Vorlage gilt nur, wenn noch keiner besteht (Backend
  `vorlagendokument`). Nachweis: die Tests sind grün.

## 5. Doku, e2e und Einsatztauglichkeit

- [x] 5.1 `e2e/chat-layout.spec.ts`: Statt `/Befehlsschema/` und „Ort / Wo“ öffnet die Spec
  „Ausführung: Mittel, Ziel, Weg, Zeit“ und erwartet „Ziel / Ort“. `grep -rn "Befehlsschema und
  Richtung" frontend/` trifft nichts mehr. Nachweis: die Spec ist grün.
- [x] 5.2 Kapitel `docs/anwender/kapitel/auftraege-befehle.md`:
  - „Einen Auftrag erteilen“ in der neuen Reihenfolge, mit beiden Klappteilen und dem Weg
  - unter „Grundlagen und Quellen“ die EA/ZMW-Vorlage als „nur noch für bestehende Befehle“, mit
    Verweis auf den Auftrag
  - `quellen:` ergänzen (`auftragsschemaKern.ts`)

  Regeln aus `docs/anwender/AGENTS.md`. Nachweis: Der Wächter der Anwenderdoku
  (`hilfe/anwenderdoku.guard.test.ts`) ist grün.
- [x] 5.3 `e2e/doku-bilder/auftraege-befehle.bilder.ts`: `auftrag-erteilen` zeigt die neue Folge
  (Empfänger oben). Bilder neu erzeugen mit `pnpm doku:bilder --grep auftraege-befehle`, auch die
  dunkle Fassung, und den Alt-Text im Kapitel anpassen. Nachweis: Die Bilder liegen neu unter
  `docs/anwender/bilder/auftraege-befehle/`. Trägt der Container den Bildlauf nicht, steht das
  mit Grund hier, und der Lauf folgt in der CI bzw. lokal.
- [x] 5.4 `pruefliste.md` (neben dieser Datei) mit der Prüfliste Einsatztauglichkeit für das
  umgebaute Auftragsformular. Es sind 15 Kriterien, jedes mit Verdikt, dazu Handschuh-Dichte und
  mobil (390 px, Zeilen stapeln). Nachweis: die Datei ist vollständig, ohne „nicht geprüft“.

## 6. Abschluss

- [x] 6.1 `./scripts/check-all.sh` ist grün (ohne `| tail`). Kästchen, die erst die CI des PRs
  belegt, werden mit Verweis auf diesen Lauf abgehakt. Stand lokal:
  - Bündel `schnell` grün (11 Schritte)
  - Bündel `frontend` in drei Shards grün (858 Dateien, 13 284 Tests)
  - Rust gezielt grün: `auftrag`, `etb`, `befehl`, `eingabegrenzen_auftrag`,
    `eingabegrenzen_spiegel`, `listen_abfragen`, `openapi_spec_aktuell`, dazu `--lib` für
    Schwärzung, Migrationen und Auftrag
  - e2e gezielt grün: `chat-layout`, `etb-folgeauftraege`, `fuehrungsfunktionen`,
    `trefflaeche-pruefflaechen`, `auftraege-abgeschlossen`, `gate1-ueberlauf`,
    `knopf-wortlaut`, `fehlertext-kontrast` (73/73, Chromium)

  Die vollen Bündel `rust` und `e2e` laufen in der CI des PRs, weil der Container sie nicht
  trägt: Plattenplatz für alle Testbinaries, Chromium einer anderen Playwright-Version.
- [x] 6.2 Code-Review ist gelaufen (`superpowers:requesting-code-review` oder ein unabhängiger
  Review-Agent), und die bestätigten Findings sind behoben. Ein unabhängiger Review-Agent lief,
  denn `superpowers:requesting-code-review` steht in der Cloud-Sitzung nicht bereit. Seine
  Funde:
  - roter Bestandstest `AuftraegePage`
  - Bezeichner-Sprache
  - Richtung „Extern“ verborgen hinter dem zugeklappten Kopf
  - Fokustest nach „Speichern und nächste“
  - Kapitel Einsatztagebuch

  Alles ist behoben (Commit `fix(auftrag): Richtung „Extern“ im Kopf …`). Den Archivpfad in
  Migration und Kern prüft das Archiv am selben Tag.
