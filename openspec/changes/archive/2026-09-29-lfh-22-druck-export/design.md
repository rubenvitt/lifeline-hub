# Design

## Context

Motivation: siehe proposal.md. Hier nur der Bestand, der den Weg bestimmt (gegengeprüft am
24.09.2026 auf `origin/alpha` b8088ba3):

- **Drei Druck-Stylesheets mit demselben Muster.** `pages/lageberichtPrint.css:3-16`,
  `pages/befehlPrint.css:3-16` und `pages/kraefteuebersichtPrint.css:20-34` setzen im
  `@media print` `body * { visibility: hidden }` und den Druckbereich auf
  `position: absolute; left: 0; top: 0`. Sonst blendet **nichts** den App-Rahmen aus:
  Kopfleiste, Rail, Modulpanel, Overrides-Alert (`einsatz/EinsatzLayout.tsx:325-480`),
  `minHeight: 100vh`, die Content-Polsterung und alle antd-Portale unter `body`. Unsichtbare
  Knoten belegen weiter Platz.
- **Umbruchregeln nur im Lesezweig.** `page-break-after: avoid` für Überschriften und
  `page-break-inside: avoid` für `p/ul/ol/blockquote` gelten nur unter `.lagebericht-druck
  .markdown` bzw. `.befehl-druck .markdown`. Diese Hüllen stehen nur im Lesezweig
  (`LageberichtDetailPage.tsx:510`, `BefehlDetailPage.tsx:501`). Der Abschnittstitel
  (`lageberichte/LageberichtText.tsx:38`, `Typography.Title`) liegt außerhalb von `.markdown`.
  `table/tr/pre` fehlen, obwohl `remark-gfm` aktiv ist. Das Meldebild hat schon
  `thead { display: table-header-group }` und `tr { break-inside: avoid }`.
- **Tests prüfen den CSS-Text.** `lageberichtPrint.test.ts`/`befehlPrint.test.ts` zerlegen
  den `@media print`-Block mit einem **flachen** Regel-Muster und verlangen Selektoren ab
  `body` oder dem Seitenpräfix. Ein verschachteltes `@page { @bottom-right {…} }` in diesen
  Dateien bräche sie. e2e: nur `e2e/meldebild-tabelle.spec.ts:349` nutzt
  `emulateMedia('print')`, `page.pdf()` kommt nirgends vor; `playwright.config.ts` fährt nur
  das Projekt `chromium`.
- **Druckköpfe:** nur das Meldebild hat einen (`KraefteuebersichtPage.tsx:895`,
  `kraefte-druckkopf`: Einsatz, Stand, Ersteller, Auswahl). Keine Organisation.
- **ETB:** kein Druckweg. `EtbPage` lädt seitenweise (`useInfiniteQuery`), die Liste
  `GET /api/einsaetze/{id}/etb` liefert `lfd_nr DESC` mit Cursor `before_lfd_nr` und
  höchstens `MAX_LIMIT = 500` je Seite (`src/etb/repo.rs:295-297`). Gates in
  `routes/etb.rs:fordere_lese_gates` (Lesezugriff inkl. Beobachter und Aufbewahrungsfrist,
  Modul `etb`), Filter in `filter_merkmale`/`repo::filter_bedingung` (eine Quelle für Liste
  und Zählungen, LFH-612). Der Client baut die Parameter in `api/etb.ts:filterParameter`, die
  URL-Achse in `routing/deeplinks.ts:etbPfad/parseEtbFilter`.
  Zeitumkehr der Filterwerte: `etb/filterZeit.ts:alsOrtszeit`. Nachtrag:
  `etb/typFarben.ts:istNachgetragen`. Berichtigungen: `etb/zeitachseModell.ts:berichtigungsindex`.
  Anzeigezone: `useAnzeigeKonventionen()`.
- **Organisation:** Tabelle `organisation(id, name, erstellt_at, tz_organisation)`.
  `GET /api/organisation` (jeder Angemeldete, eigene Org), `PATCH` nur Admin und nur
  `tz_organisation` (Pflichtfeld im Body). Der Name entsteht in `auth/bootstrap.rs:72-77`,
  und zwar **nur**, solange es noch keinen Benutzer gibt; ein späterer Start überschreibt ihn
  nicht. `anhang` ist einsatzgebunden (`einsatz_id NOT NULL`, `0052_anhang.sql`) und taugt
  nicht als Logo-Ablage. Wiederverwendbar: `anhang::scan` (Fund 422, Scanner weg 503 bzw.
  fail-open), `karte_hintergrundbild::erkenne_bild_mime` (PNG/JPEG per Magic-Bytes),
  `routes/support.rs:etag_von/if_none_match_matcht`.
- **Zulassung:** `REQUEST_BUDGET` 60 s, clamd-Timeout 30 s. Kleine Uploads brauchen keine
  Ausnahme in `src/zulassung.rs`.

## Goals / Non-Goals

**Goals:**

- Eine gemeinsame Druckmechanik für alle Druckstücke, deren Kern ohne Seitenpräfix auskommt.
  Ein neues Druckstück braucht nur die Marke an seiner Wurzel und den Druckkopf.
- Der Nachweis „läuft im normalen Fluss" ist maschinell und scheitert am heutigen Code.
- ETB-Druck ohne neuen Endpunkt und ohne zweite Filterkopie.

**Non-Goals:**

- Firefox und Safari automatisch testen. Playwright fährt dort kein `page.pdf()`, ein
  zweites und drittes Browserprojekt änderte die CI-Laufzeit und die Pflicht-Checks
  (Ruleset). Diese Browser werden von Hand in der Prüfliste geprüft.
- Seitenzählung in Firefox und Safari zusichern (siehe D3).
- Audit von Druckvorgängen. Ein Client-Druck ist serverseitig nicht beobachtbar, und das ETB
  enthält Sichtungen nur pseudonym. Personenlisten bekommen ihren Druck in einem Folgeticket.
- Live-Verteilung von Organisationsänderungen. Name und Logo ändern sich selten; die
  Invalidierung beim ändernden Admin und die normale Frische der übrigen Clients genügen.

## Decisions

### D1 — Eine Druckwurzel, ein gemeinsames Stylesheet, Ausblenden per `display: none`

Jedes Druckstück markiert seine Wurzel mit `data-lfh="druckwurzel"` (neben der bisherigen
Seitenklasse). Ein neues Stylesheet `frontend/src/druck/druck.css`, einmal global importiert,
trägt die Mechanik, nur unter `@media print` und nur, wenn eine Wurzel existiert:

- **Alles, was weder Wurzel noch Vorfahr noch Nachfahr der Wurzel ist, wird
  `display: none !important`:**
  `body:has([data-lfh='druckwurzel']) *:not(:has([data-lfh='druckwurzel'])):not([data-lfh='druckwurzel']):not([data-lfh='druckwurzel'] *)`.
  Das trifft Kopfleiste, Rail, Modulpanel, Alert **und** jedes Portal unter `body`
  (Modal, `message`, Dropdown, Drawer), ohne dass jede Stelle eine Marke tragen muss.
- **Vorfahren der Wurzel werden neutralisiert:** `position: static`, `display: block`,
  `margin/padding: 0`, `min-height: 0`, `height: auto`, `overflow: visible`. Damit fallen
  `100vh`, Flex-Layout und die Content-Polsterung weg.
- **Die Wurzel steht im Fluss** (`position: static`, volle Breite). `visibility` wird nicht
  mehr angefasst.
- **Gemeinsame Umbruchregeln unter der Wurzel:** `h1–h6 { break-after: avoid }`;
  `p, ul, ol, blockquote, pre, tr, img, figure { break-inside: avoid }`;
  `thead { display: table-header-group }`. Da sie an der Wurzel und nicht an
  `.X-druck .markdown` hängen, gelten sie auch im Entwurfszweig (Editor-Vorschau bzw.
  Druckfassung). Der Abschnittstitel ist nur im Lesezweig eine Überschrift; im Entwurf ist
  er der Akkordeonkopf (Lagebericht) bzw. das Feldetikett (Befehl), deshalb stehen
  `.ant-collapse-header` und `.ant-form-item-label` mit in der `break-after`-Regel
  (Nachtrag Review Welle B). Codeblöcke (`.markdown pre`) brechen im Druck um
  (`white-space: pre-wrap`, `overflow: visible`), statt rechts abgeschnitten zu werden.
  Schreibweise `break-*` statt `page-break-*`.
- **Papierfarben** (`color: black`, `background: transparent`, `box-shadow: none`, jeweils
  `!important`) wandern aus den drei Dateien hierher.

Die drei Seiten-Stylesheets behalten nur ihre Eigenheiten: Entwurfsregeln (M86: Eingabespalte,
Toggle-Layout: Textfeld weg, Druckfassung sichtbar, Akkordeon `-panel-inactive`,
Editor-Beschriftung), `.X-no-print`, Seitenkopf
ausblenden, Tabellen-Neutralisierer des Meldebilds. `visibility: hidden`, `position: absolute`
und die doppelten Farb- und Umbruchregeln fallen dort weg. Der falsche Kommentar in
`kraefteuebersichtPrint.css:86-89` („in Playwright nicht zu haben") wird berichtigt.

*Verworfen:* **Rahmen-Marken an jedem Rahmenteil** (`data-druck="aus"`). Das ist eine
Liste, die beim nächsten Rahmenteil oder Portal still veraltet. **`body:has(.X-print-root)`
je Seite dreimal** kopiert dieselbe Regel in drei Dateien. **Nur die AK2-Lücken schließen und
das absolute Muster behalten** scheidet aus, weil alle drei Browser gefordert sind.

`:has()` und komplexe Selektoren in `:not()` tragen Chromium ≥ 105, Safari ≥ 15.4 und
Firefox ≥ 121. Ohne Wurzel auf der Seite greift keine der Regeln, und Strg+P druckt den
Bildschirm wie heute — bis auf Seitenrand und Seitenzählung: `@page` hängt an keinem
Selektor und gilt für jeden Ausdruck (benannte Ausnahme, gepinnt in `druck.test.ts`).

**Nachtrag Review Welle B — zwei Fälle, die CSS allein nicht löst:**

- *Lagebericht-Entwurf in der Vorgabe* („Vorschau neben dem Text" aus, Toggle-Layout mit
  geschlossener Vorschau): dort trug nur die `<textarea>` den Text und kam so aufs Papier —
  Rohtext in Bildschirmhöhe, lange Abschnitte abgeschnitten. `MarkdownEditor` rendert mit
  der Prop `druckfassung` bei geschlossener Vorschau eine gerenderte Fassung, die nur der
  Druck zeigt; `lageberichtPrint.css` nimmt das Textfeld im Toggle-Layout immer weg. Opt-in,
  weil jede Fassung einen Markdown-Render je Anschlag kostet (ETB-Schnellerfassung).
- *Tabellenkopf des Meldebilds*: `KatalogTabelle` rendert mit `sticky`, und dann legt
  rc-table den Kopf in eine eigene Tabelle im Sticky-Halter — die Körpertabelle hatte kein
  `thead`, die Kopfwiederholung griff nicht. Das Primitiv rendert zwischen `beforeprint` und
  `afterprint` ohne `sticky` (`useDruckModus`, `flushSync`); am Bildschirm bleibt die
  stehende Kopfzeile (LFH-330).

### D2 — Druckkopf als Baustein, Drucken erst mit geladenem Kopf

`components/druck/Druckkopf.tsx` rendert Organisation (Name, Logo), Dokumentart und -titel
als `h1`, Einsatzbezeichnung mit `einsatznummer_intern`, Stand oder Auswahl (als Zeilen vom
Aufrufer), die druckende Person (`benutzer.anzeigename`, Etikett „Gedruckt von“ — nicht
„Erstellt von“, das sich als Urheberschaft läse) und Druckzeitpunkt („Gedruckt am“). Zeiten laufen über
`useAnzeigeKonventionen()` und `taktischeDtgVoll`. Die Prop `sichtbarkeit: 'druck' | 'immer'`
steuert, ob der Kopf auch am Bildschirm steht. Das nutzt nur die ETB-Druckansicht; auf den
übrigen Seiten stehen dieselben Angaben schon in Seitenkopf und Leisten. Seine Regeln
(Bildschirm-`display: none` bei `druck`, Logo-Höhe) stehen in `druck.css`.

Die Organisationsdaten kommen über `globalKeys.organisation()` / `ladeOrganisation`. Das Logo
ist ein `<img>` auf `/api/organisation/logo?v=<sha256>`, nur wenn `OrganisationAnzeige.logo`
gesetzt ist. Der Parameter `v` sorgt dafür, dass ein ersetztes Logo im selben Dokument nicht
aus dem Bildspeicher des Browsers kommt.

`useDrucken()` liefert `drucken()`: Es wartet, bis die Organisationsabfrage erfolgreich war
und das Logo `decode()`t ist (ein Fehler dabei gilt als „ohne Logo drucken"), und ruft dann
`window.print()`. Die drei Druckknöpfe und der Meldebild-Effekt (`printPending`) laufen darüber.
`window.print()` läuft dabei **nie direkt im Passiv-Effekt**, sondern nach einem Takt
Aufschub (Nachtrag Review Welle B): es feuert `beforeprint` synchron, und im Effekt steht
React im Commit-Kontext — das `flushSync` der Listener (Druckzeit im Kopf, Druckform der
Tabelle) rendert dort nicht, das Blatt trug sonst die Zeit vom Seitenaufbau.
Ohne diese Sperre druckt der erste Aufruf ohne Namen oder mit einem leeren Bildrahmen, weil
ein nicht geladenes Bild im Druckbild fehlt.

**Schnitt der Lieferung:** Der Kopf entsteht (Aufgabengruppe 2), bevor das Logo-Backend
existiert. Er kommt zuerst nur mit dem Namen aus dem bestehenden `GET /api/organisation`;
der Logo-Platz wird in Gruppe 3 nach dem Codegen verdrahtet.

Der Meldebild-Kopf `kraefte-nur-print`/`kraefte-druckkopf` entfällt. Befehl und Lagebericht
bekommen den Kopf innerhalb der Druckwurzel über dem Inhalt.

### D3 — Seitenzählung als Randfeld, statisch

`druck.css` setzt `@page { margin: … ; @bottom-right { content: "Seite " counter(page)
" von " counter(pages) } }`. Randfelder zeichnet heute Chromium (ab 131); in Firefox und
Safari bleibt das Feld leer, und die Kopf-/Fußzeile des Browsers kann die Seitenzahl
liefern. Die Zusicherung für alle Browser ist die Zuordnung über den Druckkopf auf Seite 1.
Im Randfeld steht **kein** Freitext (Org-Name, Einsatz): Er müsste als CSS-Zeichenkette in ein
`<style>` gesetzt werden, und das wäre eine Escape-Fläche ohne Gewinn. Der Test von
`druck.css` versteht Verschachtelung. Die flachen Parser der Seitentests bleiben gültig, weil
dort kein `@page` steht.

*Verworfen:* ein `position: fixed`-Fuß. Er überlagert in Chromium den Seiteninhalt am
unteren Rand und wiederholt sich in Safari nicht verlässlich.

### D4 — ETB-Vollabruf als Cursor-Schleife über die bestehende Liste

`etb/druckAbruf.ts:ladeEtbVollstaendig(einsatzId, filter, { onFortschritt })` ruft `listeEtb`
mit `limit: 500` und dem Filter, dann mit `before_lfd_nr` = kleinste `lfd_nr` der letzten
Seite, bis eine Seite weniger als 500 Einträge bringt. Parameter baut ausschließlich
`listeEtb`/`filterParameter`. Es gibt damit **eine** Abbildung Filter → Query, und Gates und
Bedingung sind per Konstruktion dieselben wie am Bildschirm. Ein Riegel wirft, wenn eine Seite
eine `lfd_nr` nicht unterhalb des Cursors liefert; eine Endlosschleife ist so ausgeschlossen.

**Berichtigungs-Durchgang:** Ist ein Filter aktiv und nicht `typ = berichtigung`, lädt
dieselbe Funktion zusätzlich alle Einträge mit `{ typ: 'berichtigung' }` (ohne weitere
Filter). Daraus entsteht „berichtigt durch Nr. m" für gedruckte Einträge, deren Berichtigung
nicht in der Auswahl liegt. Ohne Filter enthält die Auswahl alle Berichtigungen schon.

**Schnappschuss:** Die Schleife geht nach unten; neuere Einträge haben höhere Nummern und
kommen nicht dazu. `lfd_nr` wird nie nachträglich vergeben, der Stand ist also konsistent.
Stand = Ladezeitpunkt + höchste `lfd_nr` der ersten Seite.

**Query:** `einsatzKeys.etbDruck(einsatzId, filter)`, eingetragen in `NICHT_LIVE_KEYS` mit der
Begründung „ein Druckbeleg ist ein Schnappschuss; er ändert sich nicht unter der Hand"
(`staleTime: Infinity`, kein Refetch bei Fokus oder Reconnect). „Neu laden" ruft `refetch`.
Beim Öffnen wird dagegen immer frisch geladen (`refetchOnMount: 'always'`, Nachtrag Review
Welle B): Schnappschuss heißt „keine stille Ergänzung einer offenen Ansicht", nicht „der
Stand des letzten Besuchs aus dem Cache".
Fortschritt über einen State neben der Query, nicht im Cache.

*Verworfen:* ein eigener Endpunkt `GET …/etb/druck`. Er hätte eine einzige Transaktion und
aufsteigende Ordnung gebracht, dafür aber eine zweite Route mit eigenen Gates, einen Eintrag
in `zulassung.rs` (unbegrenzte Menge im Speicher), Codegen und einen Guard gegen
auseinanderlaufende Filter. 1 200 Einträge sind drei Anfragen.

### D5 — Druckansicht: Route, Ordnung, Darstellung

- **Route** `/einsaetze/:id/etb/druck` neben den übrigen Unterrouten in `App.tsx` (Muster
  `personen/aufnahme`). Builder `etbDruckPfad(einsatzId, filter)` in `routing/deeplinks.ts`
  über `mitQuery`, Rückweg über `parseEtbFilter`. Keine Inline-Pfade. Die Sperre setzt der
  Server durch (403 der Liste → Seite zeigt „kein Zugriff", kein Drucken).
- **Einstieg:** `EtbPage` bekommt im Kopf-Slot einen **sekundären** Link-Knopf „Drucken / als
  PDF" auf `etbDruckPfad(einsatzId, aktiverFilter)`. Er öffnet, sendet nichts ab und gehört
  damit in den Kopf (LFH-346). „Genau eine Primäraktion" bleibt erfüllt.
- **Seite** `pages/EtbDruckPage.tsx`: `EinsatzSeite` mit Titel „ETB – Druckansicht",
  Aktionen „Drucken / als PDF" (primär, gesperrt bis vollständig), „Neu laden", „Zurück zum
  ETB". Darunter die Druckwurzel mit `Druckkopf sichtbarkeit="immer"` und der Tabelle.
  Laden zeigt „n Einträge geladen …", Fehler `SeitenFehler` mit Wiederholen.
- **Ordnung aufsteigend nach `lfd_nr`**, bewusst anders als die Zeitachse (Ereigniszeit):
  Auf Papier beweist die lückenlose Nummernfolge die Vollständigkeit. Ein Nachtrag steht an
  seiner Nummer und trägt Ereigniszeit + „nachgetragen um HH:MM" (`istNachgetragen`).
- **Darstellung als `<table>`**, Spalten Nr. · Zeit · Typ · Von/An (Meldeweg) · Inhalt ·
  Erfasser. Das ist eine **benannte Ausnahme** von „das ETB ist auf allen Breiten eine
  Zeitachse" und „Tabelle nur, wenn verglichen wird": Die Druckansicht ist kein Bedienort,
  sondern die Papierform des Einsatztagebuchs (Vordruck mit laufender Nummer, Zeit, Von/An,
  Inhalt). Sie hat keine Sortierung, keinen Filter, keinen Spaltenschalter. Nur die Tabelle
  wiederholt ihren Kopf je Seite. Sie ist ein schlichtes HTML-`<table>`, weder
  `KatalogTabelle` noch `Datensicht`. `katalogTabelle.guard` und `datensicht.guard` werden
  dagegen geprüft.
- **Inhalt** über `Markdown` mit `unterEbene={1}` (der Dokumenttitel im Druckkopf ist `h1`,
  eine Gruppenüberschrift gibt es nicht). Typ als Typwort, ohne Farbe. Farbe trägt auf Papier
  nichts, und das Wort war schon der zweite Kanal.
- **Berichtigungen:** `berichtigungsindex` über Auswahl ∪ Berichtigungs-Durchgang. Liegt der
  Grundeintrag außerhalb, heißt es „berichtigt einen Eintrag außerhalb dieser Auswahl".

### D6 — Auswahl in Worten

Die reine Funktion `etb/druckAuswahl.ts:auswahlZeilen(filter, { konventionen, typWort,
einheitName })` liefert die Zeilen für den Kopf: Typwort, Zeitraum, „Suchbegriff: „…"",
„betrifft <Einheit>". Ohne Filter heißt es „vollständiges Tagebuch". Zeitwerte gehen über
`alsOrtszeit` (Wire-UTC ohne Zonenkennung), formatiert in der Org-Zone. Ein rohes
`dayjs(s)` verschöbe den Zeitraum still. Den Einheitsnamen löst die Seite über die
Einheitenliste auf, wenn das Modul zugänglich ist; sonst und bei unbekannter Kennung heißt es
„betrifft eine Einheit (Name nicht verfügbar)". Eine DB-Kennung erscheint nie.

### D7 — Org-Name: PATCH mit optionalen Feldern

`OrgPatch { name: Option<String>, tz_organisation: Option<String> }`. Beide fehlen → 400.
`name` wird getrimmt, leer oder länger als 120 Zeichen → 400. `tz_organisation` bleibt an der
Allowlist. Ein `UPDATE` setzt nur die gelieferten Felder. Der bisherige Aufruf
`{ tz_organisation }` des Frontends bleibt gültig. Bootstrap bleibt unverändert; ein Test
hält fest, dass ein zweiter Bootstrap-Lauf den gepflegten Namen nicht anfasst.

### D8 — Logo: eigene Tabelle, drei Routen

Migration (Nummer > höchste auf `origin/alpha`, heute also ≥ `0121`, per
`scripts/check-migrationen.sh` geprüft):
`org_logo(org_id INTEGER PRIMARY KEY REFERENCES organisation(id) ON DELETE CASCADE, mime TEXT
NOT NULL CHECK (mime IN ('image/png','image/jpeg')), groesse INTEGER NOT NULL CHECK (groesse
BETWEEN 1 AND 1048576), sha256 TEXT NOT NULL, daten BLOB NOT NULL, hochgeladen_von INTEGER
REFERENCES benutzer(id) ON DELETE SET NULL, geaendert_at TEXT NOT NULL)`.

Eigene 1:1-Tabelle statt Spalten an `organisation`: kein Tabellen-Rebuild, der BLOB bleibt
aus jeder Abfrage der Stammdaten heraus, und „kein Logo" ist die fehlende Zeile statt vier
`NULL`s. `anhang` scheidet aus (einsatzgebunden, fiele in die Schwärzungsmenge).

- `GET /api/organisation` (unverändert zugänglich) trägt `logo: Option<OrgLogoAnzeige { mime,
  groesse, sha256, geaendert_at }>` mit `skip_serializing_if`.
- `POST /api/organisation/logo` (AdminUser, Multipart-Feld `datei`, `DefaultBodyLimit`
  1 MiB + 64 KiB): Größe 1…1 MiB (400), `erkenne_bild_mime` (400, SVG fällt dort durch),
  `anhang::scan` (422/503), dann Upsert in einer Transaktion. Antwort `OrganisationAnzeige`.
- `GET /api/organisation/logo` (CurrentUser, eigene Org): Metadaten ohne BLOB zuerst, ETag
  `etag_von(sha256)`, `If-None-Match` → 304. Sonst Bytes mit `Content-Type` aus der Zeile,
  `Cache-Control: private, no-cache` (nicht `ASSET_CACHE_CONTROL`/immutable: die Adresse ist
  stabil, der Inhalt nicht), `X-Content-Type-Options: nosniff`. Keine Zeile → 404.
- `DELETE /api/organisation/logo` (AdminUser) → 204, auch wenn keines da war.

Alle Routen lesen die Org aus `benutzer.org_id` (LFH-232), nie aus einem Parameter. Die
Routen brauchen keine Zulassungs-Ausnahme: 1 MiB plus höchstens 30 s Scan liegen unter dem
60-s-Budget. Extractor-Vertrag: `JsonBody` für den PATCH, Multipart wie
`karte_hintergrundbild`. Codegen über `scripts/check-typ-codegen.sh`.

**Schwärzung:** `org_logo` hat keine `einsatz_id` und keinen CASCADE-Pfad zu `einsatz`; die
dynamische Menge in `schwaerzung_registry.rs` (`entdecke_einsatz_scoped`) erfasst sie nicht.
Eine Gegenprobe pinnt das, damit ein späterer FK die Tabelle nicht still in die Schwärzung
zieht.

### D9 — Verwaltung

`stammdaten/OrganisationTab.tsx` bekommt zwei Blöcke über der DV-102-Auswahl:

- **Name:** Feld im Formular, Speichern-Knopf im `<form>` (Enter sendet), Fehler über
  `SpeicherFehler` an der Seite, Erfolg als Toast (LFH-345). Ohne Admin-Recht steht der Knopf
  gesperrt unter einem `RechteHinweis`.
- **Logo:** Vorschau, Hochladen (antd `Upload` mit `customRequest`, Vorprüfung von Typ und
  Größe im Client, maßgeblich bleibt der Server), „Logo entfernen" als `danger` mit
  Rückfrage (`Modal`, `okButtonProps={{ danger: true }}`). Entfernen ist unumkehrbar, die
  Datei ist danach weg (LFH-363).
- `api/organisation.ts`: `setzeOrgName`, `ladeOrgLogoHoch`, `entferneOrgLogo`;
  `setzeOrgDefault` bleibt. Nach jeder Mutation wird `globalKeys.organisation()` invalidiert.

### D10 — Nachweise

- **Vitest, Quelltext:** `druck/druck.test.ts` mit einem Parser, der Verschachtelung versteht:
  alles im `@media print` außer den Bildschirmregeln des Druckkopfs; die Ausblende-Regel
  nutzt `display: none` und nicht `visibility`; Vorfahren-Neutralisierer; Umbruchregeln
  inklusive `h1–h6`, `table/tr/pre`, `thead`; `@page` mit Zähler **ohne** freien Text.
  Die drei Seitentests bekommen die **Gegenaussage**: kein `visibility: hidden`, kein
  `position: absolute`, keine zweite Farbregel. „Bestandszusicherungen" werden angepasst.
- **Vitest, Verhalten:** `ladeEtbVollstaendig` (Cursor, Abbruchbedingung, Riegel, Fehler
  bricht ab, Berichtigungs-Durchgang nur bei Filter), `auswahlZeilen` (beidseits beider
  Sommerzeitgrenzen gegen absolute Zeitpunkte, Einheit-Rückfall), `useDrucken` (wartet auf
  Org und Logo, Logo-Fehler druckt trotzdem), Seitentests der Druckansicht.
- **e2e `e2e/druck-fluss.spec.ts`** (Chromium): Lagebericht mit langem Text (Lese- und
  Entwurfszweig) und Befehl, `emulateMedia({ media: 'print' })`. **Diskriminierend** und am
  heutigen Code rot: Die Wurzel hat `position: static` und oben ≈ 0; Kopfleiste, Rail,
  Modulpanel und eine offene `message` haben `display: none`; die Endmarke des letzten
  Abschnitts liegt im Layout unterhalb einer A4-Seitenhöhe. Dazu als **Plausibilität**
  `page.pdf({ format: 'A4' })` mit Seitenzahl in einem Band zwischen 2 und
  ⌈Inhaltshöhe / Seitenhöhe⌉ + 1 (keine Leerseiten). Gezählt wird `/Type /Page` im PDF, der
  Zähler prüft sich selbst an einem einseitigen Dokument. Eine Textprüfung im PDF bräuchte
  einen PDF-Parser als neue Abhängigkeit (Glyphen sind subsetted und komprimiert); darauf
  wird verzichtet.
- **e2e `e2e/etb-druck.spec.ts`:** mehr als 500 Einträge per API säen (zwei Seiten), dann:
  Kopfzahl und letzte Nummer, Ordnung aufsteigend, Filter im Kopf, gefilterter Druck mit
  „berichtigt durch", `emulateMedia('print')` mit Rahmen `display: none`.
- `e2e/meldebild-tabelle.spec.ts` bleibt grün. Sein Kommentar zur `visibility`-Falle bei
  `toBeVisible` wird angepasst.
- **Von Hand:** Firefox und Safari, Druckvorschau von Lagebericht (lesen/Entwurf, > 2
  Seiten), Befehl, Meldebild (> 1 Seite) und ETB-Druck. Verdikt je Browser in der Prüfliste.

## Risks / Trade-offs

- [Firefox und Safari sind nur von Hand geprüft] → Das Muster (normaler Fluss,
  `display: none`) ist das robusteste bekannte. Die Prüfliste verlangt ein Verdikt je Browser
  und Druckstück. Ein e2e-Nachweis dort wäre ein eigenes Ticket (Browserprojekte in der CI).
- [Die generische `:has`-Ausblendung trifft etwas, das gedruckt werden soll] → Alles
  Druckbare liegt in der Wurzel; ein Druckkopf außerhalb wäre ein Bauteilfehler. Die e2e-Probe
  sucht die Endmarke im Druckbild.
- [Vorfahren-Neutralisierer greift in Layouts ein] → Nur unter `@media print` und nur mit
  Wurzel. Der Bildschirm bleibt unberührt, und der Quelltest pinnt das.
- [Wiederholung des Tabellenkopfs in Safari] → Standardverhalten von `table-header-group`,
  aber nicht automatisch geprüft. Punkt in der Prüfliste.
- [Seitenzählung nur in Chromium] → Offen benannt (D3); Zuordnung über den Druckkopf.
- [Sehr großes ETB (≥ 5 000 Einträge) macht die Druckvorschau träge] → Zehn Anfragen sind
  unkritisch. Die Vorschaudauer liegt beim Browser. Der Fortschritt ist sichtbar; der
  Zeitraumfilter ist der vorgesehene Weg zu einem Tagesauszug.
- [Logo nicht rechtzeitig geladen] → `useDrucken` wartet auf `decode()`. Ein Fehler druckt
  ohne Logo statt gar nicht.
- [Name ändert sich, andere Clients sehen ihn verzögert] → Hinnehmbar (Non-Goal); der nächste
  Abruf der Organisation liefert ihn.
- [Datenschutz: Druck verlässt das System] → Wie beim Bildschirm dieselben Gates. Das ETB
  enthält Sichtungen nur pseudonym (Registriernummer).

## Migration Plan

Die Migration ist additiv (eine neue Tabelle). Vor dem Merge `git fetch` und
`scripts/check-migrationen.sh`, bei Bedarf `--umnummerieren`. Rückweg: Die Tabelle bleibt
ungenutzt stehen; die Frontend-Druckmechanik hat keinen Datenanteil. Die Umstellung der drei
Druck-Stylesheets geschieht in einem Commit mit ihren Tests, damit kein Zwischenstand zwei
Mechaniken zugleich trägt.
