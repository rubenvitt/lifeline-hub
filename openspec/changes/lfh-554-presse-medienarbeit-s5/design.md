# Design

## Context

Anlass und Umfang stehen in `proposal.md`. Die Anforderungen stehen in `specs/stab-presse-log/`,
`specs/stab-pressemitteilung/`, `specs/stab-infotelefon/` und `specs/stab-medienlage/`.

Stand im Code (Scope-Lauf vom 30.09.2026):

- **S5 gibt es nur als Beschriftung.**
  - `src/stab/mod.rs:53` enthält `S5 => "Presse- und Medienarbeit"`.
  - `frontend/src/stab/sachgebiete.ts:60-67` hat `werkzeuge: []`.
  - Außer diesem Label findet die Suche nach Presse, Pressemitteilung, Informationstelefon,
    Bürgertelefon und Öffentlichkeitsarbeit nichts.
- **Vorbild Funkplan (LFH-548).**
  - Unterroute `stab/funkplan` als Geschwisterroute in `App.tsx:260-262`.
  - Bauer `funkplanPfad` in `routing/deeplinks.ts:280`.
  - `modulAusPfad` markiert den Stab als aktiv.
  - Die Seite prüft die Stab-Freigabe fail-closed selbst (`FunkplanPage.tsx:369-389`).
  - Den Einstieg gibt es nur für S6, fest verdrahtet in `StabPage.tsx:202/243-250`.
- **Vorlagendokument-Kern.** `src/vorlagendokument/` und `src/routes/vorlagendokument.rs` sind
  generisch über `Dokumentart` und `DokumentRoute`. Beide Traits sind schon für Lagebericht und
  Befehl implementiert.
  - Die Freigabe prüft `fordere_schreiben::<T>`: Schreibrecht und Modul.
  - Die Freigabe rendert einen Snapshot ohne leere Abschnitte (`render_snapshot`, `mod.rs:91-107`).
  - Die Freigabe schreibt in einer Transaktion ins ETB (`freigeben_gerendert`).
  - Das Frontend teilt `FreigabeDialog`, `useEntwurfVerlustschutz`, `AbschnittsAkkordeon` und
    `MarkdownEditor`. `repo::select<T>` setzt denselben Spaltensatz in jeder Tabelle voraus.
- **Lagebericht-Vorlagen** stehen doppelt: in `src/lagebericht/mod.rs:29-110` und in
  `frontend/src/lageberichte/vorlagen.ts:17-50`.
  - Der Test `vorlagen_haben_erwartete_abschnittszahl` pinnt 7/8/1.
  - `pruefe_abschnitts_schluessel` lehnt nur fremde und doppelte Schlüssel ab, nicht fehlende. Ein
    Teilbestand bleibt also gültig.
  - Der Editor rendert aus der Vorlage und liest den Text je Schlüssel nach.
- **Modul-Gate per Präfix.** `PFAD_KEY` in `src/einsatz/modul.rs:147` ordnet
  `/api/einsaetze/{id}/stab` dem Modul `stab` zu, per Längster-Präfix-Match. Neue Endpunkte unter
  `…/stab/…` fallen ohne neuen Eintrag unter die Stab-Sperre.
- **Muster für eine neue einsatzgebundene Entität:** Verpflegung (LFH-634), in dieser Kette:
  1. Migration
  2. `src/<modul>/{mod,repo}.rs`
  3. Routen mit `EinsatzLesezugriff`/`EinsatzSchreibzugriff`, `write_retry!`
  4. `LiveEvent`
  5. `api_doc.rs` und Codegen
  6. Schwärzungs-Registry
  7. Query-Keys
  
  Die höchste Migration ist `0126`.

## Goals / Non-Goals

**Goals:**
- S5 im Stabsraum an zwei Plätzen arbeitsfähig machen: Pressestelle und Bürgertelefon. Dafür
  entsteht keine neue Rechte- oder Modulachse.
- Die Pressemitteilung nutzt den bestehenden Dokumentkern mit, statt ihn nachzubauen.
- Die Medienlage kommt ohne Personenbezug in den Lagevortrag.

**Non-Goals:**
- **Suchhinweise** (Personenfahndung) sind Sache der Polizei. Sie werden nicht als Vorlage
  angeboten, auch weil sie personenbezogene Beschreibungen in einen öffentlichen Text trügen.
- Keine Veröffentlichungskanäle: kein Versand per E-Mail, keine Social-Media-Anbindung, kein
  Presseverteiler, keine Kontaktdatenbank der Medien in den Stammdaten.
- Keine Medienbeobachtung und kein Monitoring von Veröffentlichungen.
- Keine Pressekonferenz-Planung als eigene Entität. Ein Termin ist ein Medienkontakt der Art
  `termin`.
- Kein Abgleich von Anrufen mit Betroffenen oder der Personenauskunft, nur der Sprung „Vermisste ↗“.
- Pressemitteilungs-Vorlagen, die je Organisation änderbar sind. Mandanten-Labels (THW
  „Öffentlichkeitsarbeit“) kommen erst nach dem Feldbefund (LFH-46, Abschnitt 6).
- Kein Modulzähler, keine Sprungmarke, kein Palettenbefehl, keine Offline-Schreibqueue.
- Kein Druck von Presse-Log oder Anrufprotokoll. Nachweis ist die Datenhaltung. Die freigegebene
  Mitteilung steht zusätzlich im ETB.
- Keine Aufnahme in die Archivakte der Aufbewahrung (`aufbewahrung/projektion.rs`). Die Retain-Spalten
  bleiben nur in der Datenbank bis zum Purge.

## Decisions

### D1 · Ort: zwei Unterrouten unter `stab`, Einstieg in der S5-Zeile

Neue Routen als Geschwister von `stab/funkplan`:
- `stab/presse` mit Presse-Log, Pressemitteilungen und Medienlage
- `stab/presse/mitteilungen/:mitteilungId` als Item-Route der Vollseite
- `stab/infotelefon`

Die Bauer `pressePfad`, `pressemitteilungPfad` und `infotelefonPfad` kommen nach
`routing/deeplinks.ts`. Die Query-Parameter `?kontakt=` und `?anruf=` nutzen `mitQuery`.

Pressestelle und Bürgertelefon sind im Stabsraum zwei Plätze. Nach LFH-456 bekommen sie jeweils
einen Einstieg und eine Adresse, die als Lesezeichen taugt, aber keine Arbeitsplatzachse.

Den Einstieg in `StabPage` bilden zwei Verweise im Stil von `stabZeilenzielStil`. Er wird aus der
Sonderverdrahtung `s.sachgebiet === 's6'` in eine kleine Tabelle `unterseiten` je Sachgebiet
gehoben: S6 → Funkplan, S5 → Pressearbeit und Informationstelefon. So gibt es keinen zweiten
Einzelfall-Zweig. `werkzeugeFuer` bleibt für Registry-Module.

Jede Seite prüft die Stab-Freigabe selbst. Die Prüfung aus `FunkplanPage` wandert dafür in einen
Hook `useStabFreigabe()` (fail-closed, Fehler mit Wiederholen). Auch der Funkplan nutzt ihn dann.

Verworfen:
- **Eigenes Registry-Modul `presse`:** Die Stab-Spec hat ein Cockpit je Sachgebiet verworfen. Ein
  eigenes Modul brächte außerdem einen neuen Modul-Key samt Override, Drift-Test und Rail-Eintrag.
  Gewonnen wäre damit nur eine getrennte Sperre, und die braucht heute niemand.
- **Reiter auf einer Seite:** Das Bürgertelefon ist ein eigener Platz mit Serienerfassung. Ein
  Reiter wäre kein Lesezeichen und teilte die Fußleiste der Erfassung mit dem Presse-Log.

### D2 · Backend: Endpunkte unter `…/stab/…`, Gate über den Stab

Die Endpunkte:
- `GET/POST …/stab/medienkontakte`
- `PATCH …/stab/medienkontakte/{kid}` für Stammangaben
- `POST …/stab/medienkontakte/{kid}/status` mit `{ status, antwort?, freigabe_durch?, pressemitteilung_id? }`
- `GET/POST …/stab/pressemitteilungen`, `GET/PATCH …/{mid}`, `POST …/{mid}/freigeben`,
  `POST …/{mid}/fortschreiben`
- `GET/POST …/stab/infotelefon`
- `POST …/stab/infotelefon/{aid}/status` mit `{ status }`

Die Handler nutzen `EinsatzLesezugriff<Stab>` und `EinsatzSchreibzugriff<Stab>`. Das umfasst
Schreibrecht, Modul und `fordere_aktiv`. Die Bodies gehen über `JsonBody`, die IDs über
`PfadParam`. `PFAD_KEY` braucht keinen Eintrag, weil der Präfix `/stab` greift. Der Guard, der
Handler-Marker gegen `PFAD_KEY` abgleicht, bestätigt das.

Ein eigener Statusendpunkt statt Status im PATCH hat drei Gründe:
- Der Übergang hat eigene Pflichtfelder (die Antwort).
- Er schreibt `bearbeitet_von`/`bearbeitet_at`.
- Er folgt dem Muster „Statuswechsel am Status-Slot“ (`StatusWahl`).

Die Fehlercodes:
- 400: unbekannter Enum-Wert, fehlendes oder leeres Pflichtfeld
- 422: Übergang passt nicht zur Art, `beantwortet` ohne Antwort, „Rückruf nötig“ ohne Nummer,
  Bezug auf eine nicht freigegebene Mitteilung
- 404: fremder Einsatz

### D3 · Datenmodell: Migration `0127_presse.sql`

- **`medienkontakt`**
  - `id`, `einsatz_id` FK
  - `art` CHECK (`anfrage`, `abstimmung`, `termin`)
  - `medium` NOT NULL, `thema` NOT NULL
  - `kontakt_name`, `kontakt_erreichbarkeit`
  - `eingang_at` NOT NULL
  - `status` CHECK (`offen`, `beantwortet`, `abgelehnt`, `erledigt`)
  - `antwort`, `freigabe_durch`, `pressemitteilung_id` FK
  - `bearbeitet_von` FK benutzer, `bearbeitet_at`
  - `angelegt_von`, `angelegt_at`, `geaendert_at`
  - Index `(einsatz_id, eingang_at)`
  
  Die Kopplung von Art und Status (`anfrage` ↛ `erledigt`, `abstimmung`/`termin` ↛
  `beantwortet`/`abgelehnt`) steht als CHECK in der Tabelle **und** im Repo. Das Repo liefert die
  lesbare 422, der CHECK ist das Netz (`AppError::status()` bildet CHECK auf 422 ab).
- **`pressemitteilung`**: exakt der Spaltensatz von `lagebericht` aus Migration 0038, den
  `repo::select<T>` voraussetzt.
  - `vorlage` CHECK (`erstinformation`, `folgeinformation`, `bevoelkerungshinweis`, `freitext`)
  - `status` CHECK (`entwurf`, `freigegeben`)
  - `abschnitte` JSON, `version`, `vorgaenger_id`, `freigegeben_*`, `etb_eintrag_id`
  - Dazu `ALTER TABLE etb_eintrag ADD COLUMN pressemitteilung_id` als FK, genau wie
    `lagebericht_id`.
- **`infotelefon_anruf`**
  - `id`, `einsatz_id`
  - `anliegen` CHECK (sieben Werte)
  - `notiz`, `anrufer_name`, `rueckruf`
  - `status` CHECK (`offen`, `erledigt`)
  - `eingang_at`, `erledigt_von`, `erledigt_at`, `angelegt_von`, `angelegt_at`
  - CHECK: `status = 'offen'` nur mit `rueckruf` NOT NULL und nicht leer
  - Index `(einsatz_id, eingang_at)`

Alle FKs auf Stammdaten stehen auf `NO ACTION`, damit der Demo-Import sie weiter strukturell löschen
kann. Die Nummer wird vor dem Merge mit `scripts/check-migrationen.sh` gegen `origin/alpha`
geprüft.

### D4 · Pressemitteilung als dritte `Dokumentart`, Freigaberegel je Art

`src/presse/mitteilung.rs` implementiert `Dokumentart`:
- `TABELLE = "pressemitteilung"`
- `ETB_TYP = TYP_MELDUNG`
- `ETB_VERWEIS = "pressemitteilung_id"`
- `NOMEN = "Mitteilung"`, `NOMEN_PLURAL = "Mitteilungen"`

`DokumentRoute` bekommt `MODUL_KEY = "stab"`, `LIVE = LiveEvent::Presse` und `LIVE_ID`.

Die Maskulin-Annahme der Meldungstexte („beide maskulin“, `mod.rs:55`) muss dabei geprüft werden:
Die Texte werden auf das Femininum durchgesehen und, wo nötig, neutral formuliert („… ist bereits
freigegeben“). Das ist eine Stelle im Kern, kein Zweig je Art.

**ETB-Typ `meldung`:** Eine freigegebene Pressemitteilung ist eine ausgehende Meldung an die
Öffentlichkeit.
- Nicht `entscheidung`: Die Sprungmarke „Entscheidungen“ (LFH-620) füllte sich sonst mit
  Pressetexten.
- Nicht `lage`: Das ist der Typ des Lageberichts.

**Freigaberegel:** `DokumentRoute` bekommt die Konstante `FREIGABE: Freigaberecht` mit den Werten
`Schreibrecht` (Lagebericht, Befehl, unverändert) und `Einsatzleitung` (Pressemitteilung). Im
Handler `freigeben` wird bei `Einsatzleitung` zusätzlich `darf_leiten` geprüft (Einsatzleitung
oder System-Admin), sonst 403. Das Frontend liest dieselbe Regel über `darfEinsatzLeiten`.
`FreigabeDialog` bekommt keinen Zweig: Die Detailseite sperrt den Knopf und zeigt den Grund aus
`stammdaten/rechteText.ts`.

Verworfen: die Freigabe für alle Schreibenden, nur als Freitext dokumentiert, wer freigegeben hat.
Die Freigabe von Presseinformationen ist die Kernaufgabe der Einsatzleitung, und das Ticket nennt
„Freigaben“ ausdrücklich. Beim Medienkontakt (D5) bleibt die Freigabeangabe dagegen Freitext.

**Vorlagen** stehen doppelt, wie beim Lagebericht:
- Backend in `src/presse/mitteilung.rs`
- Frontend in `frontend/src/presse/vorlagen.ts`

Ein Paar-Test pinnt Schlüssel und Reihenfolge auf beiden Seiten.

**Frontend:** `PressemitteilungDetailPage` baut auf `LageberichtDetailPage` auf. Übernommen werden
`AbschnittsAkkordeon`, `useEntwurfVerlustschutz`, `EntwurfNavigationSchutz`, `Einstiegsfokus`,
`FreigabeDialog`, `Druckkopf dokumentart="Pressemitteilung"` und `key={mitteilungId}`. Was der
Lagebericht davon hart verdrahtet hat (Queries, Pfade), wird per Prop hereingereicht und nicht
kopiert. Wo das eine Umstellung der Lageberichtseite verlangt, gehört sie in dieselbe Aufgabe,
samt ihren Tests.

### D5 · Medienkontakt: Freigabeangabe als Freitext, Statusweg mit Rückweg

Im Stabsraum gibt S5 eine Antwort oft nach mündlicher Rücksprache mit der Einsatzleitung. Ein
Freigabe-Workflow je Anfrage wäre Ballast. Deshalb dokumentiert `freigabe_durch` als Freitext, wer
die Aussage freigegeben hat. `bearbeitet_von` hält fest, wer den Status gesetzt hat.

Jeder Zielstatus lässt sich nach `offen` zurücknehmen. Nach LFH-343 gibt es daher keine Rückfrage
beim Beantworten. Der Rückgängig-Toast folgt dem Muster von `kommunikation/rueckgaengig.tsx`.

„Beantworten“ öffnet ein `ErfassungsModal` mit Antwort, Freigabe durch und optional einem Bezug
auf eine Pressemitteilung, also drei Feldern. „Ablehnen“ und „Erledigt“ laufen direkt über
`StatusWahl`.

Die Erfassung eines Medienkontakts ist ein `ErfassungsModal` mit Serienmodus.
- Sichtbar: Art (`Segmentleiste`), Medium, Thema.
- Eingeklappt: Ansprechperson, Erreichbarkeit, Eingang.

### D6 · Listenformen

- **Presse-Log:** `Datensicht form="karte"`, weil die Frage „was ist mit diesem?“ lautet.
  - `titel` = Medium · Thema
  - `status` = `StatusWahl` mit `StatusTag`
  - Sekundärfelder: Art, Eingang (Mono), Ansprechperson
  - Primäraktion: „Beantworten“ bei offenen Anfragen
  
  Das ist kein neuer `KARTEN_EIGENBAU`. Über der Liste steht ein `Paneel` (kein
  `Kennzahlenband`, das gehört der Lage) mit der `Kennzahl` „offene Anfragen“. Die Segmentleiste bietet „alle“ und „offen“. Die
  Reihenfolge ist offene zuerst, dann nach Eingang absteigend. Die Sortierung liefert der Server.
- **Pressemitteilungen:** eine `Liste` der Kettenköpfe mit dem Kettenmuster aus
  `lageberichte/ketten.ts`, das geteilt statt kopiert wird. Der Titel verlinkt auf die
  Detailseite.
- **Informationstelefon:** eine Zeitachse wie ETB und Lagemeldungen.
  - Ordnung nach Zeit, jüngste oben, keine Sortierung, kein Filter außer der Segmentleiste „alle“
    / „offene Rückrufe“.
  - Die Erfassung hängt als `fuss` an `EinsatzSeite`, mit `Schnellerfassungszeile` und Hinweiszeile
    für den Tastaturvertrag, wie `etb/Schnellerfassung.tsx`.
  - Über der Achse stehen `Kennzahl` „Anrufe“, `Kennzahl` „offene Rückrufe“ und die
    `Aufgliederung` nach Anliegen, alle aus derselben geladenen Menge.
  - Die Liste wird vollständig geladen, ohne Paginierung. Im Maßstab eines Einsatzes (hunderte
    Anrufe) ist das tragbar. Wächst die Menge, kommt eine serverseitige Zählung nach dem Muster
    `etb/zaehler` (Risiko unten).
- **Statusfarben:** Drei neue Karten gehen in `theme/statusFarben.ts`, und `ALLE_MAPS` steigt um
  drei.
  - `medienkontaktStatus`: offen `achtung`, beantwortet neutral, abgelehnt neutral, erledigt
    neutral
  - `infotelefonStatus`: offen `achtung`, erledigt neutral
  - `pressemitteilungStatus`: Entwurf neutral, freigegeben `bedien`
  
  Jede Karte trägt das Wort als zweiten Kanal.

### D7 · Medienlage im Client, Übernahme in den Lagevortrag

`stab/medienlage.ts` exportiert `baueMedienlage(quellen): Medienlage` und
`rendereMedienlageMarkdown(m): string`. Jede Quelle trägt einen `AbrufZustand`
(`api/abrufZustand.ts`). Ist sie nicht `daten`, rendert ihr Teil „—“ mit Grund.

Die Funktion bekommt nur Felder ohne Personenbezug. Der Typ der Eingabe ist eine Projektion, nicht
das DTO. Ein Test legt Kontakte mit Namen und Nummern an und pinnt deren Abwesenheit im
Markdown.

**Lagebericht:** Der Abschnitt `medienlage` („Medienlage“) wird in `VORLAGEN` von Backend und
Frontend vor `zusammenfassung` eingefügt. Der Test der Abschnittszahl geht von 7 auf 8.

Im `AbschnittsAkkordeon` bekommt der Abschnitt `medienlage` einen Slot `zusatz`. Die
Lageberichtseite füllt ihn mit dem Knopf „Aus S5 übernehmen“, und zwar nur, wenn Stab freigegeben
ist (`istKeyFreigegeben('stab', …)`). Die drei S5-Listen lädt der Knopf erst beim Klick, mit
`fetchQuery` über dieselben Keys. So kostet ein Lagebericht ohne Übernahme keine Abrufe.

Die Rückfrage vor dem Ersetzen ist ein `<Modal>`. Ersetzen ist unumkehrbar, weil der Entwurf danach
autosaved. Die Props des Akkordeons bleiben identitätsstabil (`memo`-Vertrag, Render-Zähler-Test).

Verworfen:
- **Eigener Freitext-Bericht „Medienlage“ über `dokument-uebernahme`:** Die Medienlage ist Punkt
  III **im** Lagevortrag, kein eigener Bericht. Jede Übernahme legte einen weiteren Bericht an.
- **Automatisches Befüllen beim Anlegen:** Das wäre eine stille Nebenwirkung eines anderen Moduls.
  Außerdem ist der Stand zum Zeitpunkt des Vortrags gefragt, nicht der beim Anlegen.

### D8 · Live, Query-Keys, Offline

- Zwei `LiveEvent`s: `Presse` für Medienkontakte und Pressemitteilungen, `Infotelefon` für Anrufe.
  Beide gehen in `modul_keys()` auf `stab`. Die Freigabe publiziert zusätzlich die ETB-id.
- Query-Keys in `api/queryKeys.ts`: `medienkontakte`, `pressemitteilungen`, `pressemitteilung(id)`
  und `infotelefon`, alle in `EINSATZ_STREAM_EVENTS` über die beiden Events.
- `LAGEBILD_OFFLINE` nimmt die Keys **ausdrücklich nicht** auf. Das Lagebild offline umfasst ETB,
  Meldebild, Betroffene, Aufträge und Lagekarte, und die Keys enthalten personenbezogene Daten
  (LFH-767). Der Guard `lagebildOffline.guard.test.ts` verlangt die Entscheidung: Die Prefixe
  stehen in der Draußen-Liste.
- Neue Einträge erscheinen ohne Sprung. Die Zeitachse des Informationstelefons folgt dem
  Einschiebemuster des ETB (Sammelbanner bei neuen Einträgen außerhalb des Sichtbereichs).

### D9 · Schwärzung

Die `TabellenRegel`n in `src/einsatz/schwaerzung_registry.rs`, Scoping `EinsatzId`:

| Tabelle | Scrub (`NullSetzen`) | Retain |
|---|---|---|
| `medienkontakt` | `kontakt_name`, `kontakt_erreichbarkeit` | `medium`, `thema`, `antwort` und `freigabe_durch` (`G_FUEHRUNG`); Art und Status (`G_ENUM`); Zeiten, Personen-FKs |
| `infotelefon_anruf` | `anrufer_name`, `rueckruf`, `notiz` | `anliegen`, `status`, Zeiten, FKs |
| `pressemitteilung` | — | alle Spalten wie `lagebericht` (`G_FUEHRUNG`): ein veröffentlichter Text |

Dazu kommt `etb_eintrag.pressemitteilung_id` als `G_FK`.

Der CHECK „offen nur mit `rueckruf`“ kollidiert mit dem Scrub eines offenen Anrufs. Deshalb setzt
die Schwärzung `status` vorher auf `erledigt`: `PlatzhalterWennGesetzt` für `rueckruf` scheidet aus,
und ein Scrub einer Pflichtangabe verbietet die Registry. Das wird am Schwärzungstest geprüft. Ist
die Reihenfolge in der Registry nicht steuerbar, entfällt der CHECK. Die Regel steht dann nur im
Repo, und der Nachtrag hier nennt das.

Schwärzungstests für beide Tabellen kommen nach `src/einsatz/purge_scheduler.rs`.

### D10 · Rechte in der Oberfläche

- Die Seiten zeigen `RechteHinweis`, wenn Schreibrecht fehlt. Die Primäraktion bleibt gesperrt
  sichtbar. Die Zeilenaktionen entfallen (M45).
- Der Knopf „Freigeben“ der Pressemitteilung ist ohne `darfEinsatzLeiten` gesperrt, mit dem Grund
  „Freigabe durch die Einsatzleitung“.
- Am abgeschlossenen Einsatz ist alles read-only (`fordere_aktiv` serverseitig, Kopf gesperrt).

### D11 · Dichte, Kontext, Prüfliste

Zielkontext ist die ortsfeste Stelle (Stabsraum, kompakt, voller Tastaturfluss). Die Seiten müssen
trotzdem die Dichte-Staffel und 390 px bestehen. Kein neues `size="small"` an interaktiven
Elementen. Die Prüfliste Einsatztauglichkeit (15 Kriterien) liegt als `pruefliste.md` in dieser
Change und trägt je Seite ein Verdikt.

## Risks / Trade-offs

- **Kein Feldbefund, keine Stabsraum-Version.** Die Sperre im Ticket wurde vom User bewusst
  aufgehoben. → Der Schnitt bleibt klein: drei Tabellen, keine neue Achse, keine Stammdaten. Die
  Aufgabe LFH-852 (Feldbefund Stab) nimmt eine S5-Beobachtung auf. Bleibt die Nutzung aus, lässt
  sich S5 zurückbauen, ohne dass andere Module etwas verlieren: Einstiege weg, Tabellen bleiben
  lesbar.
- **Das Bürgertelefon wächst über die volle Liste hinaus.** Bei einer Großlage mit tausenden
  Anrufen trägt die Vollabfrage nicht mehr. → Die Kennzahlen rechnen aus derselben Menge wie die
  Liste. Die Umstellung auf eine serverseitige Zählung (Muster LFH-612) ist ein eigener Schritt
  mit Zielticket.
- **Personenbezug in Freitexten.** Thema und Antwort bleiben erhalten und könnten Namen tragen. →
  Das ist dieselbe Abwägung wie beim Lagebericht (`G_FUEHRUNG`): Nachweis der Pressearbeit. Die
  Medienlage und der Lagebericht übernehmen kein Thema.
- **Beobachtung liest Kontaktdaten und Rückrufnummern.** Das Leserecht auf den Stab umfasst die
  Beobachtung (LFH-46, Abschnitt 11). → Das wird bewusst hingenommen: Wer den Stab lesen darf,
  liest den Stabsraum. Eine Feldsperre je Rolle wäre eine neue Rechteachse (LFH-456) und bräuchte
  eine eigene Entscheidung.
- **Eingriff in den Dokumentkern.** Freigaberegel und Genus der Texte betreffen auch Lagebericht und
  Befehl. → Paar-Tests: Führungspersonal gibt Lagebericht und Befehl weiter frei, eine
  Pressemitteilung nicht.
- **Neuer Lagebericht-Abschnitt für alle.** Wer S5 nicht nutzt, sieht einen leeren Abschnitt
  „Medienlage“. → Der Abschnitt ist optional, leer erscheint er nicht im Snapshot, und er steht
  in der Gliederung des Lagevortrags.

## Migration Plan

- Die Migration `0127_presse.sql` ist rein additiv: neue Tabellen und eine nullable Spalte am
  `etb_eintrag`. Sie wird nie geändert (Migrationsvergabe). Ein Rollback erfolgt per Revert des
  Codes. Die leeren Tabellen stören nicht.
- Kein Datenumzug. Bestehende Lageberichte bleiben gültig (Teilbestand der Schlüssel).
- Die Reihenfolge der Umsetzung steht in `tasks.md`: Datenmodell und Kern, dann Oberfläche, dann
  Lagebericht-Kopplung.
