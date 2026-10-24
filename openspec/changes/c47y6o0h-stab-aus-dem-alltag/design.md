# Design

## Context

Den Grund für die Change nennt `proposal.md`. Den Bestand haben drei Leser am 24.10.2026 auf dem
Branch erhoben, Stand `alpha` nach `1.0.0-alpha.152`.

**Stab heute**
- Das Modul `stab` steht in der Registry in der Kategorie Führung (`einsatz/modulRegistry.ts`). Rail,
  Modulmenü, Drawer, Palette, „Zuletzt besucht“ und die Wahl der Startseite lesen den Eintrag
  generisch.
- Ohne Vorlage ist der Stab sichtbar. Alle sechs mitgelieferten Vorlagen blenden ihn aus
  (`src/einsatz_vorlage/mod.rs`, `EINSATZ_VORLAGE_STARTLISTE`).
- `pages/StabPage.tsx` zeigt:
  - im Kopf den Besetzungsstand
  - die Zeile „Nächste Lagebesprechung“ (`lagebesprechung/LagebesprechungZeile.tsx`, einziger
    Nutzer)
  - sechs `stab/SachgebietKachel.tsx` mit Werkzeugen und Zahlen (`stab/werkzeuge.ts`,
    `stab/werkzeugZahlen.ts`)
  - `stab/ChecklistePaneel.tsx` und `stab/BesetzungModal.tsx`
- Stab-Daten lesen auch andere Seiten, alle mit der Weiche `stab`:
  - Empfänger „S4 · Name“, Chat-Erwähnungen, Organigramm, Lagebericht
  - Kommunikationsplan, Fernmeldeskizze, Einsatzbericht
  - Benachrichtigungen an Funktionen
- Das Flag `status: 'geplant'` versteckt nichts, es sperrt nur `istModulFreigegeben`. Damit würde
  jedes Lesen der Stab-Daten brechen. `sichtbar: false` schneidet Nicht-Admins den Zugriff ab. Ein
  Modul mit Freigabe, aber ohne Navigationsziel, gibt es bisher nicht.

**Presse heute**
- Die Presse ist eine Unterroute des Stabs: `stab/presse`, `stab/presse/mitteilungen/:id` und
  `stab/infotelefon`, gelesen über `stab/unterseiten.ts`.
- Jede Seite prüft `useStabFreigabe`.
- Backend:
  - `src/routes/presse.rs` und `src/routes/infotelefon.rs` nutzen `EinsatzLese-`,
    `EinsatzSchreib-` und `EinsatzLeitungszugriff<Stab>`.
  - `src/live/mod.rs` gatet `LiveEvent::Presse` und `LiveEvent::Infotelefon` auf `["stab"]`.
  - `PFAD_KEY` führt `…/stab` auf `stab`, Unterpräfixe sind möglich (`key_fuer_pfad`).
- Das Muster liefert die Abspaltung des Fernmeldewesens
  (`openspec/changes/archive/2026-10-13-nrptfg8r-fernmeldewesen-modul/`).

**Geräteansichten heute**
- `src/geraet/mod.rs`:
  - `Funktionsansicht` hat sieben Werte, `Bindungsart` fünf.
  - `Stelle { art, id: i64 }`.
  - Jede Ansicht hat eine feste Liste `(Methode, MatchedPath)`, `darf_route` vergleicht exakt.
  - `lese_module(self)` steuert Live, Zähler und verengte Freigaben je Ansicht, nicht je Kopplung.
- `geraet_kopplung` hat je Stellenart eine FK-Spalte und einen CHECK auf `ansicht`. Ein Neubau
  läuft nach dem Muster `migrations/0213_…`.
- Keine Ansicht bindet heute ganze Module mit Schreibrecht ein. Der UHS-Laptop nutzt die meisten
  Seiten der Hauptanwendung, über `useEinsatzPfade()`.
- Der Lagemonitor (`src/routes/lagemonitor.rs`, `geraet/LagemonitorPage.tsx`) ist das Muster für
  einen Großbildschirm: ein verdichteter Endpunkt, Live plus 30-s-Takt, Großbild-Regeln,
  Gerätemenü auf langes Drücken.

## Goals / Non-Goals

**Goals:**
- Die Hauptanwendung zeigt den Stab nirgends als Ziel. Seine Daten wirken weiter, wo sie
  gebraucht werden.
- Die Presse funktioniert ohne Stab. Die Rechte bleiben für jede Person wie heute.
- Jedes Sachgebiet hat einen eigenen Zugang mit den Rechten eines Führungsplatzes, begrenzt auf
  seine Werkzeuge. Der Stabsraum hat einen Großbildschirm.

**Non-Goals:**
- Keine neuen API-Pfade für Presse und Infotelefon. Die Pfade sind Grenzwerte (`AGENTS.md`,
  „Bezeichner-Sprache“).
- Kein Verschieben von Dateien aus `frontend/src/stab/`, `src/stab/`, `src/presse/`,
  `src/infotelefon/`.
- Keine Funkplan-Lücken auf dem Stabsmonitor. Die Zählung gibt es nur im Client
  (`stab/luecken.ts`), ein Rust-Nachbau wäre eine zweite Wahrheit. Die Kachel S6 zeigt keine Zahl.
- Kein Offline-Schreiben am Fachzugang. Wie weit die Werkzeugseiten offline lesbar sind, bleibt,
  wie es ist.
- Keine Änderung an Besetzungsregeln, Checkliste, ETB-Text der Besetzung oder S7.
- Die Lagebesprechung bleibt ein eigenes Modul. Fachzugang und Stabsmonitor zeigen nur den Termin.

## Decisions

### D1 Eine Change, vier Teile, Reihenfolge A → B → D → C
Alle vier Unteraufgaben ändern dieselben Fähigkeiten (`stab-uebersicht`, `modul-freigabe`,
`funktionsansichten`). Nach `dev-zunder-orchestrieren` („Eine Change je Task“) wird daraus eine
gemeinsame Change mit dem `<kurz>` des Elterntasks. `tasks.md` gliedert nach Teilen.

Die Reihenfolge ist A → B → D → C:
- **A (Presse)** muss stehen, bevor S5 im Fachzugang auf das Modul Presse zeigen kann.
- **B (Stab aus der Navigation)** baut die Stab-Seite ab, deren Kachel C wiederverwendet.
- **D (Stabsmonitor)** führt die zweite ungebundene Monitoransicht ein und zieht dabei die
  gemeinsamen Monitorbausteine heraus.
- **C (Fachzugang)** ist der größte Teil und hat das höchste Risiko (D16 bis D19). Er kommt
  zuletzt, mit einem Spike vorweg.

*Verworfen:* vier Changes in vier PRs. Jede würde dieselben Specs ändern, und B ohne C ließe
Stabsmitglieder ohne Werkzeugübersicht zurück.

### D2 Presse: Registry-Eintrag und Schlüssel
- Der Eintrag `presse` steht in `modulRegistry.ts` mit diesen Werten:
  - `kategorie: 'kommunikation'`, vor `fernmeldewesen`
  - `label: 'Presse'`, `route: 'presse'`
  - `beschreibung: 'Presse-Log, Mitteilungen, Infotelefon'` (36 Zeichen, Grenze 40 aus
    `modul-benennung`)
- `MODUL_KEYS` wächst auf 35 Einträge, an derselben Stelle wie in der Registry.
- „Presse“ statt „Presse- und Medienarbeit“: Das Modulmenü bleibt einzeilig, und die Palette trifft
  „Presse“ als ersten Treffer. Den vollen Begriff trägt die Hilfe.
- Das Icon kommt aus Icons8 iOS 27 Outlined über `scripts/icons/`, wie bei LLH-1111. Die Wahl steht
  unter Open Questions.

### D3 Presse: Marker tauschen, Pfade bleiben
- **Backend:**
  - In `modul_marker!` kommt der Marker `Presse => "presse"`.
  - `PFAD_KEY` bekommt drei Unterpräfixe (`…/stab/medienkontakte`, `…/stab/pressemitteilungen`,
    `…/stab/infotelefon`); der längste Präfix gewinnt wie bei LLH-1180.
- **Handler:** Alle Handler in `routes/presse.rs` und `routes/infotelefon.rs` und der Kern in
  `src/presse/mitteilung.rs` wechseln von `<Stab>` auf `<Presse>`, die Freigabe einer
  Pressemitteilung auf `EinsatzLeitungszugriff<Presse>`.
- **Gate-Tests** nach dem Muster der Fernmeldewesen-Tests:
  - Stab ausgeblendet: Presse 200/201
  - Presse ausgeblendet: 403
  - Rolle beschränkt: 403
  - fremde Org: 404
  - Führungspersonal gibt frei: 403
- **Live:** `LiveEvent::Presse` und `LiveEvent::Infotelefon` behalten ihre Wire-Namen und gaten auf
  `["presse"]`. Die Query-Keys `einsatz-presse` und `einsatz-infotelefon` sind schon eigene Präfixe
  und bleiben.

### D4 Presse: Rolle und Sichtbarkeit wandern mit
Eine Migration, die nächste freie Nummer nach `scripts/check-migrationen.sh`, kopiert die Zeilen
des Stabs auf `presse`, nach dem strengeren Muster `0224_evakuierung_modul.sql`. Kopiert werden
`benoetigte_rolle` und `sichtbar` in diese Tabellen:
- `einsatz_modul_override`
- `org_modul_einstellung`
- `einsatz_vorlage_modul_aus`

`EINSATZ_VORLAGE_STARTLISTE` bekommt `presse` in keiner Vorlage, damit eine neue Organisation die
Presse ausgeblendet bekommt. Ein Test in `src/db.rs` deckt drei Fälle ab:
- Ausblendung übernommen
- Rolle übernommen
- ohne Stab-Vorgabe keine Zeile

*Verworfen:* nur die Rolle übernehmen, wie beim Fernmeldewesen. Rubens Wahl vom 24.10.2026 lautet
„Niemand sieht mehr oder weniger als heute“. Für das Fernmeldewesen war damals das Gegenteil
gewollt.

### D5 Presse: Modulseite mit zwei Reitern, alte Adressen
- `presse/PresseReiter.tsx` (antd `Tabs`: Presse · Informationstelefon) steht über
  `PressePage` und `InfotelefonPage`. Das h1 ist `modulName('presse')`, der Ortspfad Einsatz ›
  Presse.
- Routen in `App.tsx`:
  - `MODUL_ELEMENTE.presse`
  - `presse/infotelefon`
  - `presse/mitteilungen/:mitteilungId`
- `ALTPFAD_MODUL` bekommt `stab/presse` und `stab/infotelefon` → `presse`.
  `AltpfadWeiterleitung` behält Query und Rest des Pfads; `…/stab/presse/mitteilungen/7` wird zu
  `…/presse/mitteilungen/7`.
- `deeplinks.ts`: `pressePfad`, `pressemitteilungPfad` und `infotelefonPfad` zeigen auf die neuen
  Adressen.
- Die Seiten prüfen `useModulFreigabe(einsatzId, 'presse')` fail-closed.

### D6 Presse: Abnehmer
- Diese Abnehmer prüfen `presse`:
  - `stab/medienlageQuelle.ts` (Übernahme in den Lagevortrag)
  - `command-palette/befehle.ts` („Anruf erfassen“, `modulKey: 'presse'`)
  - `infotelefon/`, „Zu den Vermissten“ mit zusätzlicher Prüfung von `personen`
- `einsatz/sprungmarken.ts`:
  - `stabMarken()` entfällt.
  - Die Marke „Informationstelefon“ hängt hinter „Presse“ (`zielModul: 'presse'`).
  - „Pressearbeit“ entfällt, das Modul öffnet die Presse selbst.
  - Die Schlagworte („bürgertelefon“, „medien“, „S5“) wandern an Modul und Marke.
- `stab/unterseiten.ts`: Die S5-Einträge zeigen auf `modul: 'presse'`. Ihre Bezeichnungen „Presse“
  und „Informationstelefon“ nutzt der Fachzugang (D19).

### D7 Navigationsziel als Eigenschaft des Registry-Eintrags
- `ModulEintrag` bekommt `ohneNavigation?: true`, gesetzt nur bei `stab`. Eine Hilfsfunktion
  `istNavigationsziel(modul)` ist die eine Regel.
- Diese Stellen filtern mit ihr:
  - `ModulListe` in `ModulPanel.tsx` und darüber Drawer und Akkordeon
  - `erstesFreigegebenesModul` (Rail-Sprung)
  - `freiesRueckwegModul` (Rückweg aus `ModulGesperrt`, `useModulFreigabe`, `ModulStub`)
  - die Modulschleife und „Zuletzt besucht“ der Palette (`command-palette/befehle.ts`)
  - `einsatz/zuletztModule.ts` (schreibt nicht)
  - die Wahl der Startseite (`EinsatzAllgemein.tsx`)
  - `aufloeseStandardModul` (ein gespeichertes `stab` gilt als nicht gesetzt)
- Die Modul-Einstellungen (`ModulEinstellungsListe.tsx`, `EinsatzVorlageFormModal.tsx`,
  `einsatzVorlageModule.ts`) filtern nicht. Dort bleibt der Stab schaltbar, mit der Beschreibung
  „Besetzung, Fachzugänge, Stabsmonitor“ (36 Zeichen).
- Ein Guard-Test (`modulRegistry.test.ts`) prüft:
  - Jeder Abnehmer der Navigation nutzt `istNavigationsziel`.
  - `stab` ist das einzige Modul ohne Navigationsziel.

*Verworfen:*
- `status: 'geplant'`: sperrt die Freigabe und bricht alle Leser der Stab-Daten.
- `sichtbar: false` per Migration: schneidet Nicht-Admins den Zugriff ab, Server
  `berechtigung.rs`.
- Den Stab ganz aus `MODUL_KEYS` nehmen: Die Freigabe trägt Besetzungsdaten und die beiden neuen
  Geräteansichten.

### D8 Paneel „Stab“ in den Einsatzdaten
- Neu ist `stab/StabPaneel.tsx`. Es steht in `EinsatzdatenPage.tsx` nach `FuehrungsstellePaneel`
  und vor dem Abschluss, mit `id="stab"`. Darin stehen:
  - je Sachgebiet eine Zeile mit Kennung, wirksamem Label, Besetzungschip und „Besetzung ändern“
    (`BesetzungModal` unverändert)
  - der Besetzungsstand im Paneelkopf
  - die Checkliste als Abschnitt „Arbeitsaufnahme“: `ChecklistePaneel` wird ein Abschnitt ohne
    eigenes Paneel, die Klapplogik bleibt.
- Recht und Freigabe bleiben wie auf der alten Seite: Lesen und Schreiben über `useStabFreigabe`
  und `darfImEinsatzSchreiben`. Der Server ist unverändert (`EinsatzSchreibzugriff<Stab>`). Das
  Recht der Einsatzdaten (`darfEinsatzVerwalten`) gilt nicht. Sonst verlöre Führungspersonal die
  Besetzung, die es heute pflegt.
- Ohne Stab-Freigabe fehlt das Paneel, und es geht keine Anfrage an `…/stab`, fail-closed wie im
  Organigramm.
- Der Verweis des ersten Checklistenpunkts auf die Führungsstelle wird ein Sprung innerhalb der
  Seite (`#fuehrungsstelle`).

### D9 Alte Stab-Adresse
- Die Route `stab` wird eine `AltpfadWeiterleitung` auf `einsatzdaten#stab`. `ALTPFAD_MODUL` lernt
  einen Schlüssel mit einem Segment (`stab` → `einsatzdaten`). Ohne ihn fängt `modulAusPfad` den
  Aufruf bei ausgeblendetem Stab mit dem Hinweis „Stab ausgeblendet“ ab, bevor die Umleitung läuft.
  Das ist dieselbe Falle wie bei D7 von LLH-1180.
- `EinsatzdatenPage` rollt bei `#stab` einmal zum Paneel. Fehlt das Paneel, bleibt die Seite oben.
- `pages/StabPage.tsx` und ihr Test entfallen.
- `SachgebietKachel`, `WerkzeugZelle`, `werkzeuge.ts`, `werkzeugZahlen.ts` und `stabRaster.ts`
  bleiben für den Fachzugang (D19). `stabRaster.ts` entfällt, falls der Fachzugang es nicht
  braucht.
- `LagebesprechungZeile` bekommt die Variante ohne Sprung für Fachzugang und Monitor.

### D10 Stabsmonitor: Ansicht und Schranke
- Neue `Funktionsansicht::Stabsmonitor => "stabsmonitor"`. Ihre Eigenschaften:
  - Rolle `Beobachter`, `stellenart() = None`
  - `ohne_personenbezug() = true`: Der Einsatzkopf kommt ohne Sachverhalt.
  - Routen: nur `GET /api/einsaetze/{id}/stabsmonitor`
  - `lese_module`: `stab`, `lagebesprechung` und die gezählten Module (`etb`, `lagemeldungen`,
    `einheiten`, `einsatzabschnitte`, `auftraege`, `meldungen`, `nachforderungen`, `presse`), damit
    deren Live-Ereignisse den Monitor auffrischen
- Lesbar ist damit nichts weiter, denn `darf_route` bleibt die Schranke.
- `tests/geraet_routen_guard.rs` bekommt `stabsmonitor_schreibt_nichts`, nach dem Muster
  `lagemonitor_schreibt_nichts`.
- Der Handler antwortet jeder Nicht-Monitor-Sitzung mit 403. Ist `stab` für das Gerät nicht
  zugänglich, antwortet er ebenfalls mit 403.

### D11 Stabsmonitor: ein verdichteter Endpunkt
Neu ist `src/routes/stabsmonitor.rs` mit `StabsmonitorAnzeige`:
```
stand_at
naechste_lagebesprechung_at
sachgebiete: [{ sachgebiet, label, besetzung: { art, name? }, zahlen: [{ quelle, wert, davon? }] }]
```
- `label` ist das wirksame Label aus dem Funktionskatalog der Organisation.
- `besetzung.name` ist der Name des Funktionsträgers, sonst nichts. Keine `personal_id`, keine
  Kontaktdaten.
- Die Zahlen kommen aus den bestehenden Zählregeln:
  - `einsatz::zaehler::berechne` mit der festen Modulmenge, gefiltert auf die im Einsatz sichtbaren
    Module, ohne die Gerätekürzung von `routes/modul_zaehler.rs`
  - `presse::repo::kennzahlen` (offene Anfragen)
  - die Zählung des Informationstelefons (offene Rückrufe)
- Die Zuordnung der Zahlen zu den Sachgebieten steht als Tabelle neben dem Handler. Ein Test hält
  sie gleich mit `stab/sachgebiete.ts`, denselben Werkzeugen.
- Der Handler zählt nichts selbst.

### D12 Stabsmonitor: Oberfläche
- Neu ist `geraet/StabsmonitorPage.tsx`: Kopfzeile, ein Raster 3 × 2 mit den Kacheln S1 bis S6
  und eine Statusleiste.
- Die Bausteine des Lagemonitors kommen in `geraet/monitorBausteine.tsx`, als eigener
  `refactor`-Commit vorab:
  - `Statusleiste` mit Langdruck
  - „Anzeige starten“
  - `useBildschirmWach`
  - `useAnstieg`
  - die Konstanten `GROSS`, `VERALTET_AB_MS`, `ABRUF_TAKT_MS`, `HERVORHEBUNG_MS`
- `GeraeteLayout` wählt `MonitorHuelle` für beide Monitore.
- Der Query-Key `einsatzKeys.stabsmonitor` steht in `EINSATZ_STREAM_EVENTS` bei den Ereignissen
  aus D10 und bei `einsatz` (Termin). Dazu kommt der Takt von 30 s.
- e2e `geraet-stabsmonitor.spec.ts`:
  - 1920 × 1080 ohne Bildlauf
  - Kennzahl ≥ 72 px
  - kein Name eines Anrufers im DOM
  - neuer Termin ohne Neuladen

### D13 Fachzugang: Bindung an ein Sachgebiet als eigene Spalte
- `Bindungsart` bekommt `Sachgebiet => "sachgebiet"`, und `geraet_kopplung` die Spalte
  `sachgebiet TEXT`. Ein CHECK auf `'s1'…'s6'` steht im CHECK „höchstens eine Bindung“, dazu
  `CHECK ((ansicht = 'stab-sachgebiet') = (sachgebiet IS NOT NULL))`.
- `Stelle { art, id: i64 }` bleibt für die FK-Stellen. Das Sachgebiet steht daneben:
  - `GeraetKontext.sachgebiet: Option<Sachgebiet>`
  - `NeueKopplungBody.sachgebiet`
  - `KopplungAnzeige.sachgebiet` und `GeraetAnzeige.sachgebiet`
- Den Stellennamen der Übersicht liefert das wirksame Label.
- `stelle_pruefen` bekommt einen Zweig ohne DB-Abfrage.
- Im Frontend:
  - `StellenWert` wird `number | 'einsatzweit' | Sachgebiet`.
  - `stellenOptionen` liefert für `sachgebiet` die sechs festen Einträge mit `mitWirksamemLabel`.
  - `stelleIdAusWahl` schickt `sachgebiet` statt `stelle_id`.

*Verworfen:*
- `Stelle.id` als 1 bis 6 kodieren: täuscht einen Fremdschlüssel vor.
- `Stelle` zu einem Enum machen: alle Handler mit Stellenfilter (`stelle.rs`) fassen ein Feld an,
  das sie nicht brauchen.

### D14 Migration der Kopplungstabelle
Der Neubau von `geraet_kopplung` folgt `0213_geraet_kopplung_verpflegungsstelle.sql`:
- `-- no-transaction` und `PRAGMA foreign_keys = OFF`, weil `geraet_kopplungscode`,
  `geraet_kopplung_ereignis` und `session` kaskadieren
- der CHECK auf `ansicht` mit neun Werten
- die Spalte `sachgebiet`

Der Test in `src/db.rs` folgt `migration_0213_…`:
- Bestand übernommen
- `stab-sachgebiet` ohne Sachgebiet abgelehnt
- `stabsmonitor` mit Sachgebiet abgelehnt
- Kinder nicht gelöscht

Beide neuen Ansichten bekommt diese eine Migration, auch wenn D vor C umgesetzt wird.

### D15 Fachzugang: Werkzeugmodule als eine Tabelle im Backend
- Neu ist `src/stab/werkzeuge.rs` mit `werkzeug_module(Sachgebiet) -> &'static [&'static str]`, die
  Spiegel von `stab/sachgebiete.ts` nach Modul-Keys:
  - S5 → `presse`
  - S6 → `fernmeldewesen`
- Ein Test liest `sachgebiete.ts` und vergleicht beide, nach dem Muster
  `backend_modul_keys_decken_frontend_registry`.

### D16 Fachzugang: Schranke über die Modulmenge statt Routenliste
- `darf_route(&GeraetKontext, methode, pfad)` statt `darf_route(ansicht, …)`. Für `stab-sachgebiet`
  ist eine Route erlaubt, wenn eine dieser Bedingungen zutrifft:
  - Sie steht in `ALLE_GERAETE` oder `ALLE_ANSICHTEN`.
  - Ihr Modul nach `key_fuer_pfad` gehört zu `werkzeug_module(sachgebiet)`.
  - Sie ist `("GET", "/api/einsaetze/{id}/stab")`.
  - Sie steht in einer kurzen Liste `STAB_SACHGEBIET_ZUSATZ`. Darin stehen organisationsweite
    Leserouten, die die Werkzeugseiten brauchen (etwa Funktionskatalog, Fahrzeug- und
    Einheitentypen). Der Spike C.1 erhebt sie, und jede steht mit Grund und Test darin.
- Für die übrigen Ansichten bleibt die Liste exakt.
- `lese_module` wird `GeraetKontext::lese_module()` (Rückgabe `Cow<'static, [&str]>`). Beim
  Fachzugang ist das Ergebnis die Werkzeugmodule plus `stab`. `schneide_module` und
  `verenge_freigaben` lesen es dort.
- Die Rolle ist `Fuehrungspersonal`. Leitungsaktionen sperren die Handler selbst
  (`EinsatzLeitungszugriff`).
- `fordere_geraeteroute` prüft für `stab-sachgebiet` zusätzlich die Freigabe `stab` des Geräts.
  Fehlt sie, ist außer dem Einsatzkopf alles 403.
- Die Modulzähler sind für den Fachzugang einsatzweit. Er hat keine `stelle`, die
  `modul_zaehler.rs` kürzen würde.
- Tests:
  - je Sachgebiet eine erlaubte Schreibroute und eine verbotene Route eines fremden Moduls
  - S5 gibt keine Pressemitteilung frei
  - Stab ausgeblendet → 403
  - Live nur der Werkzeugmodule
  - `tests/geraet_routen_guard.rs`: Jede Route der Zusatzliste existiert.

*Verworfen:* eine handgepflegte Routenliste je Sachgebiet. Bei 14 ganzen Modulen sind das mehrere
hundert Einträge, und jede neue Route eines Werkzeugmoduls müsste nachgetragen werden. Die Spec
verlangt aber volle Modulrechte. `PFAD_KEY` ist schon die geprüfte Zuordnung von Route zu Modul
(`tests/einsatz_kontext_guard.rs`).

### D17 Fachzugang: ETB und Belege nennen Gerät und Sachgebiet
Schreibt ein Fachzugang, nennt der Beleg das Gerät mit Bezeichnung und Sachgebiet, etwa „Gerät
Stab S2 (S2 · Lage)“. Das betrifft ETB-Einträge, Absender und `erstellt_von`. Der Name kommt aus
derselben Stelle, die heute für Geräte mit Stelle den Stellennamen setzt (geraete-kopplung,
„Einträge nennen Gerät und Stelle“). Das Gerät ist keine Person. Personennamen entstehen nur, wo
der Datensatz sie ohnehin trägt.

### D18 Fachzugang: Hülle und Werkzeugseiten
- Neu ist `geraet/FachzugangHuelle.tsx`, eine Variante von `GeraeteHuelle`:
  - Kopf mit Sachgebiet und Gerätebezeichnung
  - Leiste mit Startseite und Werkzeugen, unten unter `md`, seitlich ab `md`
  - Live-Strom `stumm`, ohne Palette, ohne Benutzermenü
- Routen unter `/geraet/:id/stab/…`: Die Startseite ist `…/stab`, ein Werkzeug
  `…/stab/<modulroute>/*` mit dem Element aus `MODUL_ELEMENTE`.
- Die Werkzeugseiten erwarten die Kontexte des Einsatzrahmens (Einsatz, Modulfreigaben,
  Anzeigekonventionen, Zähler). Die Hülle stellt sie bereit. `EinsatzAnzeigeProvider` lädt
  `/einstellungen` (für Geräte 403); er bekommt für Geräte die Vorgaben aus dem Einsatzkopf, wie
  heute die übrigen Hüllen.
- Sprünge in fremde Module braucht die Hülle nicht abzufangen. Die verengten Freigaben melden
  diese Module als nicht zugänglich, und die Seiten sperren solche Bedienelemente schon heute
  (`modul-freigabe`, „Bedienelemente in ein gesperrtes Modul sind gesperrt oder ohne Ziel“).
  Verweise, die heute ohne Freigabeprüfung springen, findet der Spike C.1. Sie werden über
  `useEinsatzPfade()` oder die Freigabe abgesichert.

### D19 Fachzugang: Startseite aus den Bausteinen der Stab-Seite
- Neu ist `geraet/FachzugangStartPage.tsx`. Sie zeigt die `SachgebietKachel` des eigenen
  Sachgebiets in großer Form:
  - Werkzeuge als `WerkzeugZelle` mit Zahlen aus `werkzeugZahlen.ts`
  - `LagebesprechungZeile` ohne Sprung
- Die Ziele der Werkzeuge kommen aus einer Pfadfunktion der Hülle statt aus den Einsatzpfaden.
  `werkzeugState` entscheidet weiter allein über fehlend, gesperrt oder Sprung.
- Neu ist die Quelle „Informationstelefon“ (offene Rückrufe aus `…/infotelefon/zaehler`) in
  `werkzeugZahlen.ts`. Ihre Bedeutung steht in der Spec `stab-fachzugang`.

## Risks / Trade-offs

- [Werkzeugseiten laufen nicht ohne den Einsatzrahmen] → Spike C.1 vor der Hülle: Jede der 15
  Werkzeugseiten wird in einer Test-Hülle gerendert, mit fehlenden Kontexten und abgelehnten
  Routen als Liste. Was sich nicht mit vertretbarem Aufwand lösen lässt, kommt als
  Rückfrage an Ruben.
- [Volle Modulrechte auf einem Gerät ohne Person] Ein verlorenes S1-Tablet sieht Personaldaten.
  → Gilt heute schon für den UHS-Laptop mit Betroffenen. Es gelten Ablauf und Widerruf der
  Kopplung (höchstens 72 h, sofortiger Widerruf) und die Belege nach D17. Ruben hat die vollen
  Rechte am 24.10.2026 gewählt.
- [Module mit Rollensperre „Führung im Einsatz“ bleiben für Geräte gesperrt] (`modul-freigabe`,
  „Ein gekoppeltes Gerät zählt nicht als Führung im Einsatz“) → Die Kopplungsmaske nennt sie
  schon heute als gesperrt (`sperren`). Die Regel bleibt.
- [Die Schranke nach Modulmenge öffnet neue Routen eines Werkzeugmoduls ohne Durchsicht] → Gewollt
  (volle Modulrechte). Rechte am Datensatz prüfen die Handler. `einsatz_kontext_guard` hält jede
  Einsatzroute in `PFAD_KEY`, sonst ist sie für das Gerät verboten.
- [Wer heute die Stab-Seite als Lesezeichen hat, landet in den Einsatzdaten] → Weiterleitung nach
  D9 und ein Versionshinweis.
- [Großer PR] → Commits je Teil, jeder Teil grün für sich. Die Prüfliste Einsatztauglichkeit je Teil
  steht in `pruefliste.md`.

## Migration Plan

1. Teil A: Migration der Presse-Freigaben (nächste freie Nummer, vorher `git fetch origin alpha`
   und `scripts/check-migrationen.sh`).
2. Teil D/C: Neubau von `geraet_kopplung` mit `sachgebiet` und neun Ansichten (die Nummer danach).
3. Beide Migrationen sind vorwärts. Ein Rückbau bräuchte eine weitere Migration, denn bestehende
   Migrationen werden nie geändert. Ein Revert des Codes vor dem Release ist folgenlos: `presse`
   ist eine zusätzliche Zeile, die Spalte `sachgebiet` bleibt leer.
4. Versionshinweise im `feat`-Commit:
   - „Der Stab hat jetzt eigene Zugänge: Besetzung in den Einsatzdaten, Fachzugang je Sachgebiet,
     Stabsmonitor“
   - „Presse ist ein eigenes Modul“

## Open Questions

- Icon des Moduls Presse aus Icons8 iOS 27 Outlined (Vorschlag: Zeitung oder Mikrofon). Ruben
  wählt in Teil A. Bis dahin blockiert nur die Icon-Aufgabe.
- Bezeichnung der Ansicht in der Kopplungsmaske: „Stab-Fachzugang“ (Vorschlag) oder
  „Stab · Sachgebiet“. Das ist nur der Wortlaut. Die Spec nennt den Vorschlag, eine Änderung wäre
  eine Textkorrektur.
