# CLAUDE.md

Verbindliche Projektregeln. Begründungen, Messwerte und Prüfspuren stehen in den genannten
Herleitungen (`docs/…`, `openspec/…`); hier steht nur, was gilt und wo es getragen wird.
`AGENTS.md` ist ein Symlink auf diese Datei.

## ClickUp

Dieses Projekt hat ein eigenes ClickUp-Projekt im Space **Lifeline Hub** (`901511065513`,
Workspace/Team `9015920204`). Das **Entwicklungsboard** (`901523554968`) ist das
Task-Board des Projekts, das **Feedbackboard** (`901523554969`) sammelt Feedback.
Tasks werden selbstständig über den ClickUp-MCP angelegt — wie und wann beschreibt der
Skill `clickup-task-anlegen`.

## Planung und Ausführung — OpenSpec und Superpowers (LFH-588)

- **OpenSpec** (`/opsx:*`) besitzt den **Änderungszyklus** (klären, entwerfen, Spec und
  Aufgabenschnitt, abarbeiten, archivieren), **Superpowers** (`superpowers:*`) die
  **Arbeitsdisziplin** (Worktree, Debugging, TDD, Verifikation, Review, Branch-Abschluss).
  OpenSpec löst Superpowers nicht ab.
- `explore`, `propose`, `update`, `sync`, `archive` fassen keinen Projektcode an;
  **`/opsx:apply` setzt um**. Dispatches: `superpowers:brainstorming` → `/opsx:explore`,
  `superpowers:writing-plans` → `/opsx:propose`, `superpowers:executing-plans` → `/opsx:apply`.
  Bei Superpowers bleiben `using-git-worktrees`, `systematic-debugging`,
  `test-driven-development`, `verification-before-completion`, `requesting-code-review`,
  `finishing-a-development-branch`.
- **`/opsx:apply` bringt keine Disziplin mit:** jede Aufgabe per `test-driven-development`, vor
  jedem „fertig" `verification-before-completion` und `requesting-code-review`.
- **Pflicht-Checkpoint:** `/opsx:propose` hält nach den Artefakten an (kein Fehlschlag) —
  vorlegen, Freigabe abwarten, dann `ready for development` und `/opsx:apply`.
- **Vier Ablageorte, keine Überschneidung:** `openspec/changes/<name>/` (laufende Änderung, hier
  landet Neues) · `openspec/changes/archive/` (nach `/opsx:archive`) · `openspec/specs/`
  (Fähigkeits-Specs, SHALL/MUST, über `/opsx:sync`/`/opsx:archive`) · `docs/superpowers/`
  (Herleitungen und Messprotokolle, **eingefrorenes Archiv**, wird nicht nach OpenSpec migriert).
  Wer dort etwas verschiebt, greppt zuerst die Verweise (sie brechen still).
- **Archiviert wird vor dem Merge, im selben Branch** (Entscheidung 30.09.2026): ist die
  `tasks.md` abgehakt, `/opsx:archive` samt Spec-Sync und Verweisen, dann erst der PR — kein
  Archiv-PR danach. Wächter: `scripts/check-openspec-archiv.sh` (Schritt 13 von `check-all.sh`,
  Bündel `schnell`) macht eine aktive Change ohne offenes Kästchen rot.

## Frontend — Gestaltungssprache Neuentwurf „Instrumententafel“ (22.09.2026)

Fortschreibung von LFH-352 (dunkel, Radius 0, Archivo/JetBrains Mono, Bedienfarbe blau).
**Maßgeblich:** `docs/design/2026-09-21-neuentwurf/umsetzung.md` (Entscheidungen, Palette);
Entwürfe daneben (`neuentwurf.dc.html`, `shell.dc.html`, Inline-Styles maßgeblich;
`_ds/…/tokens/*.css` ist alt). Bei Konflikten gewinnt das Design — **außer bei der Sichtung**
(BBK). Umgekehrte Altregeln tragen „Neuentwurf 22.09.2026".

- **Nachtbetrieb ist Vorgabe:** `MODUS_DEFAULT = 'dark'` in `theme/ThemeModeProvider.tsx`,
  **gespiegelt im Bootstrap-Skript von `index.html`** — immer beide ändern. Hellpalette aus der
  Nachtpalette abgeleitet.
- **Rollen** in `theme/tokens.ts` + `theme/rollen.css` (Gate 5), u. a. `kopf`, `paneel`,
  `flaeche3`, `text2`, `steuerRahmen` (= antds `colorBorder`), `bedienText`, Statusflächen,
  `bannerGrund`/`bannerLinie`, Zeilentönungen. `rahmenFarben` ist modusunabhängig und keine
  `Farbrolle` (`rollen.guard.test.ts`). Eigene Paletten statt `Statusrolle`:
  `etbTypFarben{Dunkel,Hell}` (`etbTypFarbe()`), `warnstufeFarben{Dunkel,Hell}`
  (`warnstufeBalkenFarbe()`).
- **`schriftskala`** (CSS `--lfh-typo-*`, deckungsgleich per `rollen.guard.test.ts`). Zahlen,
  Zeiten, Funkrufnamen, Koordinaten, Nummern immer Mono mit `tabular-nums`. Die Dichte-Staffel
  30/48/72 gilt, nicht die Entwurfsskizze.
- **Bausteine** in `components/instrument/` (Import über `index.ts`, Dateikopf nennt die Regel):
  `Augenbraue` (`als="h2…h6"`) · `Paneel`/`PaneelZeile` · `Formularpaneel` (Hülle im selben `<Form>`) ·
  `PaneelZustand` · `Kennzahl`/`Kennzahlenband` („Zahl führt") · `Aufgliederung`/`Balken` (nie
  Ersatz der Zahl) · `Zeitachseneintrag` · `StatusZelle`/`StatusChip` (`wort` Pflicht, Übersetzung
  nur in `statusFlaeche.ts`) · `Segmentleiste` (statt antds `Segmented`) · `Sammelbanner` ·
  `Schnellerfassungszeile` · `Datenraster`/`Datenfeld` (statt `Descriptions`) ·
  `rollenwerte`/`useRollen`.
- **Seitenkopf** `components/EinsatzSeite.tsx` (`SEITENKOPF_HOEHE` 44 px, wächst mit der
  Staffel): `titel` als `h1` (Paneele ab `h2`), `meta` Mono, `aktionen` rechts (Primär blau
  gefüllt, sekundär umrandet); Meta + Datenstand unter `md` eigene Zeile, Datenstand hält vorab
  seine Breite. `breite` Vorgabe `'voll'`, `'schmal'` nur für reine Formularseiten,
  `flaeche.seiteBreit` fällt beim Umbau.
- **Markdown** (`components/Markdown.tsx`, `MarkdownEditor`): Pflicht-Prop `unterEbene` (Ebene der
  nächsten Überschrift darüber, Boden `h6`, kein fester Versatz).
- **Bildmarke „Lebenslinie“** (LFH-837): EINE Geometrie in `marke/bildmarkeGeometrie.ts` für
  Markenzelle, Anmeldeseite, Favicon, PWA und Hülle; Symbole nur über
  `scripts/marke/erzeuge-symbole.sh` (Guard `marke/marke.guard.test.ts`: Nenngrößen, Manifest,
  Pfadgleichheit, Stempel `scripts/marke/quellen.sha256`). PWA-Manifest in `marke/pwaManifest.json`, Farben Kopf-Schwarz.
- **Rahmen:** Kopfleiste (`components/Kopfleiste.tsx`, `KOPF_HOEHE`) · Rail
  (`einsatz/IconRail.tsx`, Kurzetikett `kurz`, voller Name als `aria-label`, Einstellungen per
  `fuss: true`) · Modulpanel (`einsatz/ModulPanel.tsx`) · Sprungpalette
  (`command-palette/CommandPalette.tsx`). Maße im Entwurf.
- **Modulstruktur** (`einsatz/modulRegistry.ts`): Startseite **Führung · Überblick**
  (`redirectZiel()`); Aufträge/Befehle unter Führung; **Meldebild** heißt sichtbar die
  Kräfteübersicht — **Schlüssel und Route bleiben `kraefteuebersicht`**.
- **Keine erfundenen Daten:** was ohne Datenquelle ist, wird weggelassen (Epic LFH-606…617),
  trägt sein Ticket im Code-Kommentar und wird als **Abwesenheit** getestet. Eingelöst:
  Evakuiert (LFH-607, `openspec/changes/archive/2026-09-29-lfh-607-kennzahl-evakuiert/`), Pegel auf Platz 1
  (LFH-606), Rückmeldung (LFH-610), ETB-Zählung (LFH-612).
- **Kennzahlenband** (LFH-640): immer sechs Plätze (vier Kern, zwei Lage), jede Kennzahl ein
  Heimatplatz; Lageplätze nur per Entscheidung am Einsatz (`EinsatzAnzeige.lagekennzahlen`), nie
  per Messwert; Neuzuschnitt während der Betrachtung als Sammelbanner
  (`docs/superpowers/specs/2026-09-23-lfh-640-lagebezogene-kennzahlreihe-design.md`).
- **Eine Heimat je Zahl** (LFH-550,
  `openspec/changes/archive/2026-09-30-lfh-550-lagebesprechung-eine-verdichtung/design.md`):
  Aufträge und Meldungen (offen, in Arbeit, überfällig = davon überfällig, Bestätigung überfällig)
  nur aus dem Modulzähler (`pages/lage-dashboard/fuehrungsZahlen.ts`), nie aus einer Liste
  gezählt; Betroffene/SK über `verdichtePersonen` (→ `sichtungsbild`), Kräfte über `verdichte`,
  Warnstufe über `verdichteGefahrengebiete`. Stärke einer Menge nur über `summiereStaerke`
  (Wurzeln der Menge; ein Abschnitt zählt seine obersten Einheiten wie das Meldebild), Formatierung
  nur `anzeige/staerke.ts:staerkeText`. Dashboard und Stab-Vorbereitung teilen `useLagebild` +
  `baueLagebild`. Regeln beider Sprachen pinnt `tests/fixtures/verdichtung/regeln.json`
  (`tests/verdichtung_fixture.rs`, `lage/verdichtungFixture.test.ts`).

## Frontend — UI-Form-Leitlinie (Drawer-Nutzung)

**Form nach Umfang** (LFH-19, `docs/superpowers/specs/2026-06-22-drawer-nutzung-reduzieren-design.md`)
- **Vollseite/eigene Route** (`/einsaetze/:einsatzId/<modul>/:id`): Sektionen/Tabs, > ~5 Felder,
  Workflow, deeplink-würdig (Muster `BefehlDetailPage`, `PersonenDetailPage`). **Modal**: kurze
  blockierende Aktion, ≤ ~3 Felder. **Inline/Expander**: Zusatz ohne Seitenwechsel.
  **Drawer**: nur Quick-View (read-only) oder Schnellerfassung ≤ ~4 Felder (`PersonDetailDrawer`);
  Tabs, großer Edit-Modus oder > ~480 px → eigene Route.
- **Einzige Ausnahme: der Navigations-Drawer** unter `lg` (`einsatz/EinsatzLayout.tsx` +
  `einsatz/ModulAkkordeon.tsx`): Navigation, keine Entität, schließt beim Modulklick, Inhalt erst
  beim Öffnen (kein `forceRender`). Ein zweiter braucht eine eigene Entscheidung.

**Die Liste ist die zweite Frage** (LFH-330): „welcher von diesen?" → Tabelle
(`components/KatalogTabelle.tsx`, `components/Datensicht.tsx` `form="tabelle"`); „was ist mit diesem?" →
Liste/Karte (`components/Liste.tsx`, `Datensicht` `form="karte"`); Kachel nur für Überblick.
Karten-Fallback unter `md` (`form="auto"`) ist begründungspflichtig (Dateikopf `Datensicht.tsx`,
AK3b im Drawer-Spec); keine Katalogtabelle wird zu Karten.
- **Kein Nutzerschalter Tabelle ↔ Karte** (LFH-507, `openspec/changes/archive/2026-09-30-lfh-507-palette-status-setzen/`):
  die Form bleibt die begründete Entscheidung je Seite, auch in der Palette („Ansicht wechseln“
  gibt es nicht). Wer einen Schalter will, schreibt zuerst diese Regel fort.
- **FMS-Tableau** (LFH-642, `kraefte/FmsTableau.tsx`): Ansicht `?ansicht=tableau` der
  Fahrzeugseite, kein Modul; je Kachel genau ein Bedienziel (`StatusWahl`), Kachel selbst nicht
  klickbar; Sortierung Abschnitt → Einheit → Funkrufname, nie Status; `fms_anker` 0–9 nur
  Beschleuniger (Doppelbelegung setzt nichts) (`docs/superpowers/specs/2026-09-23-lfh-642-pruefliste.md`).
- `Datensicht` bricht fest bei `md`; die Prop `tabelleAb` hält `datensicht.guard.test.ts` fern.
  `naechste_lagebesprechung_at` = absolute Wiedervorlage-Schnellwahl, kein berechneter Rhythmus
  (`docs/superpowers/specs/2026-09-08-lfh-463-464-pruefliste.md`).
- **Fließende Spalte** (LFH-523): trägt genau EINE Spalte `mindestBreite` und alle übrigen eine
  Zahlbreite, setzt `KatalogTabelle` `scroll.x = Σ(width) + mindestBreite` und **nur dann**
  `tableLayout="auto"` (sonst kippt `@rc-component/table` still auf `fixed`); sonst
  Bestandsverhalten plus DEV-Warnung. Zahl gegen die schmalste Fläche wählen (Träger
  `personen/personenSpalten.tsx`). `document.body.scrollWidth` sieht Tabellenüberlauf nicht
  (`docs/superpowers/specs/2026-09-11-lfh-523-etb-langtext-umbruch.md`).

**ETB: ein Tagebuch wird gelesen — auf allen Breiten eine Zeitachse** (`etb/EtbZeitachse.tsx`,
Ableitungen in `etb/zeitachseModell.ts`)
- Keine Sortierung/Spaltenfilter/-auswahl; Ordnung = Zeit (Server). Ebenso Lagemeldungen
  (`pages/LagemeldungenPage.tsx`, Tagesgrenze in der Anzeigezone, `lagemeldungen/zeitachse.ts`).
  `KARTEN_EIGENBAU` ist leer (`datensicht.guard.test.ts` pinnt 0).
- Seitenleiste „Bilanz" (`etb/EtbBilanz.tsx`); unter `xl` erst nach der ersten Liste, dann
  stehend (Riegel `bilanzFrei`, nicht `isLoading`).
- **Erfassung** hängt auf jeder Breite als `fuss` an der Wurzel von `EinsatzSeite`
  (`.etb-erfassung-sticky`; ≤ 50 % Fensterhöhe, oben voll sichtbar — `e2e/leisten-flaeche.spec.ts`,
  `fokus-verdeckung.spec.ts`). Fokusabstand per `scroll-margin-block-end`
  (`--lfh-etb-fokusabstand`, `components/fokusabstandUnten.ts`), **nicht** `scroll-padding`.
  Unter `md`: Feld eigene Zeile (`Schnellerfassungszeile gestapelt`, im DOM zuerst), Feldzeile
  rollt waagerecht, „Werte behalten" in der Hinweiszeile, Kurzplatzhalter, Fokus per
  `preventScroll` (`MetaChip`, nicht `autoFocus`).
- **Kopfzahl und Bilanz zählt der Server über DENSELBEN Filter** (LFH-612, `GET …/etb/zaehler`,
  `etb/repo.rs:filter_bedingung`, Parameter nur über `routes/etb.rs:filter_merkmale`; Parität
  `tests/etb_zaehler.rs`). „412 Einträge"/„Bilanz" bzw. „7 Treffer"/„Bilanz im Filter"; keine
  Tagesgrenze. Ohne Zählung steht **keine** Zahl da, nie die des geladenen Fensters.
- **Modulzähler** (`GET …/modul-zaehler`, `src/einsatz/zaehler.rs`): ETB, Betroffene, Einheiten,
  Abschnitte als Gesamtmenge; Meldungen, Aufträge, Erinnerungen, Chat als Handlungsmenge. Ohne
  Recht **fehlt** das Modul (`berechtigung::erlaubte_module`). Wer eine gezählte Liste invalidiert,
  invalidiert `modulZaehler` mit (`ZAEHLER_LISTEN_KEYS`, `queryKeys.test.ts`).
- Jede Zeile trägt `data-lfh="datensicht-karte"` und die Zeilenklasse (`scrolleZurZeile`,
  `?eintrag=`). Ein neuer `KARTEN_EIGENBAU` wird gegen den Plan-Modus begründet (Titel, Status,
  ≤ 3 Sekundärfelder, eine Primäraktion, optional Menü `weitere`) und setzt Marke/Klasse selbst.
- ≥ 50 % Meldungstext im Fükw: `e2e/etb-chronologie.spec.ts`, gegen die **Contentbreite**.
- **ETB-Entwürfe schreiben nur über `etb/entwuerfe/entwurfStore.ts`** (LFH-521): ein Neuladen
  bricht offene IndexedDB-Transaktionen ab, deshalb steht jeder Auftrag vor dem ersten `await`
  synchron im Vorlauf (`localStorage`, ein Schlüssel `lifeline-etb-entwuerfe-ausstehend:<id>` je
  Entwurf, nie eine gemeinsame Tabelle — Tabs überschrieben sich; Quittung per `stand`);
  `entwuerfeLaden` trägt nach, jüngere Plattenfassung gewinnt.
  Nachweis `e2e/etb-entwurf-tabs.spec.ts`: ausstehend beim Reload und gespeichert getrennt.

**ETB-Anhänge (LFH-117)** (`docs/superpowers/specs/2026-09-24-lfh-117-pruefliste.md`)
- **Jeder modulgebundene Linker auf `anhang` ist EIN Eintrag in `anhang::repo::MODUL_LINKER`**;
  `LinkerStand`, `sweep_verwaiste`, `repo::loeschen`, `chat::repo::anlegen_mit_anhaengen`,
  `etb::repo::pruefe_anhaenge` (`modul_gebunden_sql`) lesen daraus; Chat ist die Ausnahme (n : m).
  Guard `jeder_fremdschluessel_auf_anhang_ist_registriert`. **Abschottungstests laufen als die
  ablegende Person** (`admin`, `common::schaden_anhang`), sonst sind sie ohne Eintrag grün.
- Kreuzsperren: ETB nimmt keine Chat-/modulgebundene Datei (422, `gebunden_meldung()`), Chat keine
  modulgebundene (400). Upload `POST …/etb/anhaenge` (Dokument-Allowlist, eine Datei je Anfrage),
  Download `GET …/etb/{eintrag_id}/anhaenge/{aid}`; Binden über `anhang_ids` in derselben
  Transaktion (`anlegen_idempotent`, `write_retry!`). **Append-only**, nur die Schwärzung löscht.
- Offline geht nur der Upload nicht. Während des Sendens ist die ganze Erfassung gesperrt;
  **Entwurfs-id = `client_id`**. **Replay nur bei DEMSELBEN Eintrag** (Typ, getrimmter Inhalt,
  Anhangsmenge; Route UND Transaktion), sonst 409; danach neue id (`entwurfNeuAusweisen`).
- Sendezustand gehört dem Entwurf (`EtbEntwurfsTabs`, `Versand`); Dateien in `EtbPage`
  (`useEntwurfsDateien`), ≤ 10, Dubletten prüft die Dateiwahl. Ungebundener Anhang gehört der
  hochladenden Person (sonst 404).

**Schaden-Anhänge (LFH-21)** (`docs/superpowers/specs/2026-09-25-lfh-21-pruefliste.md`):
`einsatz_schaden_anhang` im Register; `routes::schaden_anhang`; **`{aid}` ist die Linker-id**;
Allowlist `ERLAUBTE_MIME_ERFASSUNG` (Spiegel `ERFASSUNG_ACCEPT` in `api/upload.ts`);
`anhang::pruefe_vor_persist` vor, Anhang + Linker + ETB in EINEM `write_retry!`. Entfernen =
Soft-Delete mit roter Rückfrage; ETB nennt nie den Dateinamen; storniert → 409.

**Farbachsen** (Vertrag `theme/statusFarben.ts`)
- **Betroffene** (LFH-455, `StatusTag`, Rand-Form über `darstellungsart="rand"`): Personenstatus neutral, „vermisst" `achtung`; Schaden
  „offen" `achtung`, „übergeben" `bedien`, „abgeschlossen" neutral; Ausmaß „gering" neutral,
  „mittel"/„groß" `achtung`, „katastrophal" `alarm`.
- **Lagezustand** (LFH-608, `abschnittLagezustand`): planmäßig `normal`, angespannt `achtung`,
  kritisch `alarm`; nicht beurteilt = leeres Feld. Nur der Wechsel schreibt System-ETB.
  Fortschritt manuell (leer ≠ 0 %); Überblick meldet schlechtere Unterabschnitte („UA kritisch").
- **Sichtung ist eine eigene Achse nach BBK** und die Ausnahme vom Neuentwurf:
  `SichtungsTag`/`sichtungsfarben`, umrandetes Farbfeld, SK I rot, II gelb, III grün, IV blau,
  Tote schwarz, „unverletzt" ohne Farbe; die Umrandung macht Gelb auf hellem und Schwarz auf
  dunklem Grund sichtbar. Nie `color="black"` an antds `Tag`. Übergabe, Geschädigt-Bezug,
  UHS-Verortung tragen `bedien`. Personenstatus und Sichtung sind unabhängig.
- **Blauer Bedien-TEXT nimmt `rollen.bedienText`**, nicht `colorLink`; Radio-Text im Stil
  `outline` über `index.css` (`--lfh-bedien-text`), kein `Radio.colorPrimary`
  (`docs/superpowers/specs/2026-09-22-lfh-613-pruefliste.md`).
- Kontrast: `e2e/betroffene-kontrast.spec.ts` (Tag ≥ 7:1, Nacht ≥ 5:1, Alpha mitgerechnet).
- **Tagmodus** (LFH-618, `docs/superpowers/specs/2026-09-22-lfh-618-hellmodus-pruefliste.md`):
  `achtung`/`alarm` als Text über `achtungText`/`alarmText`; Hervorhebung auf `flaeche3`, nicht
  `flaeche2`; Kontrast gegen den tatsächlichen Grund (`e2e/hellmodus-kontrast.spec.ts`,
  `e2e/kontrast-kern.ts`).

**Lagekarte**
- **Warnstufe trägt der TEXT** (LFH-357, Rangfolge `src/gefahr/repo.rs`): `zonenBeschriftung` (`pages/lagekarte/zonenStil.ts`),
  „Warnstufe: <label>" nur aus `warnstufeKarte`; fehlender Nachschlag = „unbekannt" (die Farbe
  rundet vorsichtshalber auf `keine`/Alarm); „keine" = keine Stufe gesetzt. Kollision des
  `zonen-label` ist nicht abgesichert (eigene Entscheidung).
- **Trefferzone `controlHeight`** an jedem Marker (`KarteMarker.trefferDurchmesser`,
  `marker-einsatzort-treffer`); Personen zusätzlich 2 px schwarze Außenkante. Bild-Ziehgriffe
  (`pages/lagekarte/bildGriffe.ts`) in `max(controlHeight, 44)`, je Modus scharf, Moduswechsel
  wartet auf `dragend`; in „Größe" Ecken immer, eine Kante nur ohne Überlappung mit Ecke oder
  Kante (`scharfeGriffe`, neu bei `move`/`dragend`/`setzeEcken`, nie im Zug; LFH-764).
- **Ein Tipp gehört genau einem Ziel** (LFH-764,
  `openspec/changes/archive/2026-09-30-lfh-764-lagekarte-griffe-klickwege/design.md`): jeder Karten-Klickhörer fragt
  `klickzielAm` (`Kartenflaeche.tsx`, ein Urteil je Originalereignis) → `entscheideKlickziel`
  (`pages/lagekarte/klickziel.ts`): gezeichnetes Punktziel > Trefferzone > Fläche. Eine neue
  Klickebene braucht eine Rolle in `ordneKlickebene` (Guard in `klickziel.test.ts`).
  **Mehrere Flächen am Punkt wählt der Mensch** (LFH-812,
  `openspec/changes/archive/2026-09-30-lfh-812-lagekarte-flaechen-auswahlmenue/design.md`): erst entdoppeln (Zone
  über Füllung + Umriss zählt einmal), ab zwei `mehrdeutig` → `FlaechenwahlMenue` am Tipppunkt,
  eigene vor Fachebenen, Kennung aus `flaechenwahl.ts`; Wahl über dieselben Callbacks, aus im
  exklusiven Modus (Prop `flaechenwahl`). Geschlossen wird nur über `onOpenChange`.
- **Betreuung auf der Karte** (LFH-673, `openspec/changes/archive/2026-09-29-lfh-673-betreuung-auf-der-lagekarte/design.md`):
  Marker-Ebene wie UHS (`alleVerortet`, `?platzieren=betreuungsstelle:<id>`), Sperre an der
  **Datenquelle** (`pages/lagekarte/betreuungEbene.ts`);
  Ort-Vorschau kennt keine Stellen (`src/geocoding/marker.rs`); Verortung ohne ETB, live über
  `Geschrieben::still_geaendert`; Zonentyp `evakuierungsbezirk` (`lage_zone.evakuierungsbezirk_id`).
- **Objektsuche/Zeichenwahl** (LFH-716,
  `openspec/changes/archive/2026-09-29-lfh-716-lagekarte-markersuche-zeichenpicker/design.md`): `MarkerSuche` über
  `suchbareMarker`
  (`pages/lagekarte/objektsuche.ts`) prüft Modulsperre **je Typ**; Enter sendet über `onAbsenden`
  mit Spec; `FreiesZeichenInspector` entprellt (600 ms) mit eigenem Merker, Bezeichnung
  kontrolliert. Enter-Tests über `userEvent.keyboard`.
- **Schwebende Bänder werden gestapelt, nicht per `zIndex` gestaffelt** (LFH-355,
  `pages/lagekarte/KartenFuss.tsx`): ein Rahmen (`pointerEvents: 'none'`), Bänder als
  Flow-Geschwister mit `bandStil(…)` (`'auto'`, nie `position: 'absolute'`). Der Fuß endet vor der
  Knopfspalte (`fussStil(knopfKante)`) und oben an der Karte; kein `overflow` am Rahmen.
- **Die Karte kippt nicht** (`touchPitch: false` **und** `maxPitch: 0` in `Kartenflaeche.tsx`).
- **Unter `lg` gibt jeder Kartenmodus die Karte frei** (LFH-765,
  `openspec/changes/archive/2026-09-30-lfh-765-lagekarte-modi-karte-freigeben/design.md`): abgeleitet aus
  `exklusiverModusAktiv` in `leisteSichtbar` (`lagekarte/leistenWahl.ts`), nie per Aufruf je
  Startweg; nach dem Modus gilt wieder der vorherige Zustand (Entscheidung 29.09.2026).
  „Leiste einblenden" im Modus ist `umschalteImModus` (nie gespeichert). Die Bedienung der
  Leistenmodi (Platzieren, Taktisches Zeichen, Bild) steht unter `lg` im Fuß-Band
  `PlatzierSteuerung`, die Sidebar zeigt dann nur einen Hinweis (`modusBedienungImFuss`) — je
  Breite genau ein Knopf je Handlung. Ab `lg` erzwingen die Leistenmodi die Leiste wie bisher.
- Nachweise: `e2e/lagekarte-smoke.spec.ts`, `e2e/gate1-ueberlauf.spec.ts`,
  `e2e/lagekarte-touch.spec.ts` (LFH-713, `hasTouch`, Trefferwache `elementFromPoint`), `fokus-verdeckung.spec.ts`; Kartenaufbauten sieht
  `e2e/fokus-kern.ts` nur über `zusatzKandidaten`, das Abschneiden der nachgiebigen Zeitachse nur
  über `beschnitt` (LFH-811: Tab/Shift+Tab in jedem Kartenmodus bei 390 und 768 px).
- **`toBeVisible()` ist kein Beleg für Klickbarkeit** (LFH-355) — klicken. Ein Test, der eine
  Überdeckung umgeht, testet den Nutzerzustand nicht.

**Sprungmarken sind keine Module** (LFH-620, `einsatz/sprungmarken.ts`): Entscheidungen = ETB
`?typ=entscheidung`, Patienten = Personen im Sichtungsraster, Vermisste = Personen
`?filter=vermisst`. Kein Registry-Eintrag, kein `verweistAuf`; Marke erbt Sichtbarkeit/Sperre,
nie `aria-current`, Ziel im zugänglichen Namen, Pfad aus `routing/deeplinks.ts`;
`parsePersonenSicht`/`sichtNachSprung` apply-then-clean. Kein Filterwert „patienten".

**Funkplan S6** (LFH-548, `openspec/changes/archive/2026-09-30-lfh-548-funkplan/design.md`):
Unterroute `stab/funkplan` (`funkplanPfad`), kein Modul, Einstieg in der S6-Zeile; die Seite
prüft die Stab-Freigabe selbst (ihre Listen hängen an anderen Modulen). Abgeleitet im Client aus
Abschnitten, Einheiten, Fahrzeugen, Personal, Sprechgruppen (`stab/funkplan.ts`), kein Endpunkt;
jede Liste mit eigener Weiche (`api/abrufZustand.ts`), fehlend = „—“ mit Grund. Lücken nur über
`stab/luecken.ts` (auch für ST6). Erreichbarkeit: Schirm ab `xl`, Druck immer (`useDruckModus`),
Lagebericht nie. Eigene Gegenstelle fehlt als benannte Lücke (LFH-849).

**Checkliste Arbeitsaufnahme** (LFH-551,
`openspec/changes/archive/2026-09-30-lfh-551-stab-checkliste-arbeitsaufnahme/design.md`): unterstes
Paneel der Stabseite (`stab/ChecklistePaneel.tsx`), sieben feste Punkte als Code-Vorlage
(`stab/checkliste.ts` ↔ `ChecklistenPunkt::ALLE`), eigene Tabelle, lazy (ein Aufruf ohne Wirkung
legt keine Zeile an). `PUT …/stab/checkliste/{punkt}` mit Teilfeldern, jedes Bedienziel schickt
genau SEIN Feld. Kein ETB je Haken; nur `leitstelle_gemeldet` belegt Haken **und** Rücknahme (E1).
Mutation je Zeile und Bedienziel, überlappende Antworten über `useChecklistenAbgleich`.

**Vorbereitung der Lagebesprechung** (LFH-550, `stab/VorbereitungPaneel.tsx`, `stab/vorbereitung.ts`):
Paneel der Stab-Seite, rechnet keine Zahl selbst (Lagebild wie das Dashboard, Aufträge/Meldungen
vom Modulzähler), Quelle je Zeile, Rechteweiche je Quelle („—“ mit Grund, nie 0). Reihenfolge wie
das Dashboard, **kein Vortragsschema** (LFH-46 §2.3), nichts wird eingefroren; ein fester Stand
nur über „In Lagebericht übernehmen“ (EIN Aufruf, Freitext).

**Betreuung und Verpflegung**
- **Verbleib → Betreuungsstelle** (LFH-674,
  `openspec/changes/archive/2026-09-29-lfh-674-verbleib-notunterkunft-betreuungsstelle/design.md`): nur die Kennung
  (`person_verbleib.betreuungsstelle_id`, Cache
  `einsatz_person.aktuelle_verbleib_betreuungsstelle_id`), den Namen belegt der Client vor; der Server kopiert
  keinen Stellennamen (Ziel, Kurzform, ETB). Prüfkette 422 → 403 (vor jedem Lesen) → 404 → 409.
  „davon namentlich n" rechnet `…/betreuung`, nicht `repo::uebersicht`; ohne Personenrecht fehlt
  es. Live über `EINSATZ_STREAM_EVENTS.person → betreuung`. `betreuungsstelle` ist kein Leaf
  (Rebuild braucht den FK-Schalter).
- **Meldeverlauf** (LFH-676, `openspec/changes/archive/2026-09-29-lfh-676-betreuung-meldeverlauf/design.md`):
  Reihenfolge `juengste_meldung!`/`meldereihenfolge!` (`src/betreuung/repo.rs`); `aktuell` nur aus
  dem Zeiger am Objekt; fremdes Objekt 404 vor dem Lesen; nachgetragen ≥ 60 s
  (`istNachgetragen`); Rücknahme unumkehrbar mit Rückfrage (`betreuung/MeldeVerlauf.tsx`);
  Aufklappen über `Datensicht.aufklappen` (`aufklappzeile` fällt mit LFH-697).
- **Meldungen offline** (LFH-675, `openspec/changes/archive/2026-09-29-lfh-675-betreuung-meldungen-offline/design.md`):
  `offline/schreiben.ts` (`stand`/`belegung`) mit `client_id`; Replay-Lookup **vor** jeder
  Zustandsprüfung (auch nach Einsatzende, `EinsatzSchreibfreigabe`); Erfassungszeit nur an der vorgemerkten Kopie, online die Serveruhr.
- **Verpflegung** (LFH-634, `pages/VerpflegungPage.tsx`, `src/verpflegung/`): eigene Zeitfenster;
  Bedarf wird **erfasst**, Vorschläge ohne Quelle bleiben leer (nicht 0); Sonderkost ist Teilmenge
  der EP; Ausgabe verweist nur per `nachforderung_id`; Einstufung im Client
  (`verpflegung/deckung.ts`); ins ETB nur Zeitfenster und Bedarf (Org-Zeitzone); kein Modulzähler.
- **Versorgung S4** (LFH-553, Entscheidung 30.09.2026,
  `openspec/changes/archive/2026-09-30-lfh-553-versorgung-abgrenzung/design.md`, Spec
  `stab-versorgung`): kein Modul „Versorgung“, keine Tabelle `versorgungsposten`. Träger:
  Verpflegung → Modul Verpflegung, Einsatzmittel/Verbrauchsgüter/Betriebsstoffe → Nachforderung
  mit **freier Art** (keine Liste; `tests/nachforderung.rs`
  `betriebsstoff_ist_eine_nachforderung_mit_freier_art`), Materialerhaltung → Status am Material.
  **Eine Mengenwahrheit:** Beschafftes steht nur als Nachforderung, andere Module verweisen per
  Kennung. **Kräfte-Unterkunft ist eine Lücke, nie eine Betreuungsstelle** — deren Belegung
  speist „in Betreuung“ und damit den Verpflegungsbedarf der Betreuten (Doppelzählung neben der
  Personalstärke). Wiedervorlage nur mit Feldbefund aus einer Langzeitlage (> 1 Einsatztag).

## Frontend — Bedien-Leitlinie (Einsatzkontexte)

Zweite Achse neben LFH-19: für welchen **Kontext** gebaut wird (LFH-327). Herleitung und
Prüfliste: `docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`; Fallen,
Scanner-Interna, Messwerte: `docs/leitlinien/bedien-leitlinie-herleitungen.md`.

**Kontexte:** **Fükw** (primär, 13–15", Tastatur+Maus, kompakt) · **Führungs-Tablet** (1024–1280
px, Touch, oft Handschuh, keine Massenerfassung) · **ortsfeste Stelle** (BHP/BTP, kompakt, voller
Tastaturfluss) · **mobil** (~390 px, einhändig, keine Vergleichsansichten).

**Die Lagekarte bedient den Kontext mobil** (LFH-557, Entscheidung 30.09.2026): lesen, verorten,
eine Figur zeichnen; Vergleichen und Verwalten bleiben Fükw und Tablet. Die Form ist **kein
Drawer**, die Leiste trägt Inhalt, und die Ausnahme des Navigations-Drawers gilt für sie nicht.
Ab `lg` steht die Leiste (300 px) neben der Karte, darunter **unter** ihr, am Handschirm per
Vorgabe zu (`lagekarte/leistenWahl.ts`), und jeder Kartenmodus gibt die Karte frei (LFH-765).
Nachweis bei 390 px: `e2e/lagekarte-smoke.spec.ts` (Überdeckung, freie Karte über dem Fuß),
`e2e/lagekarte-touch.spec.ts` (Gesten, Modi). Eine neue feste Breite in der Kartenspalte bricht
diese Zusage.

**Prüfliste Einsatztauglichkeit (15 Kriterien)** an jede neue oder umgebaute Seite; ohne sie ist
ein Modul-Task nicht fertig. Jede Zeile trägt ein Verdikt (erfüllt / offen → Zielticket / nicht
anwendbar), „nicht geprüft" ist keins.

**Tabelle und Dichte**
- **Tabelle nur, wenn verglichen wird**: stehende Kopfzeile, fixierte **menschenlesbare** Kennung
  (nie DB-`id`), Spaltenschalter **mit Zähler ausgeblendeter Spalten**. Auf schmalem Schirm
  **angepasst, nicht in Karten aufgelöst**. Träger `KatalogTabelle`/`Datensicht`.
- Spaltenschalter: `components/SpaltenSchalter.tsx` (eine Wahrheit für Handwahl und `abBreite`);
  in `KatalogTabelle` nur per Opt-in `spaltenSchalter={{ bezeichnung }}`, `Datensicht` setzt es
  nie. Antds `responsive`/`hidden` gesperrt (`katalogTabelle.guard.test.ts`). Das Häkchen zeigt
  die wirkliche Sichtbarkeit.
- Stehende Kopfzeile hält Freiraum (`setzeKopfFreiraum`, `scroll-margin-top` in `sprache.css`);
  Fokus-Nachweis darunter auch mit `Shift+Tab` (`fokus-kern.ts`, `taste`).
- **Dichte-Staffel 30 / 48 / 72 px** (kompakt · komfortabel · Handschuh) über ein Dichte-Token am
  `ConfigProvider`: `controlHeight` 30/48/72, `controlHeightSM` 24/48/72. **Neues punktuelles
  `size="small"` auf interaktiven Elementen ist verboten** (`components/dichte.guard.test.ts`,
  Schuldmenge `OFFEN` schrumpft nur, im selben Commit wie der Fix; Stand: UHS-Platzkarte in
  `pages/uhs/Grundriss.tsx`, nur in `kompakt`, sonst `platzBedienform`). `Card`/`Descriptions`/
  `Space`/`Liste` dürfen klein bleiben.
- **Der Navigationsrahmen hat keine Dichte-Ausnahme** (LFH-384): die 48 ist Boden, nie Deckel
  (`Math.max(48, controlHeight)`, Griffe über `navGriffMass`); die Rail-Spalte wächst mit
  (`railBreite` in `components/Kopfleiste.tsx`, 73 px in `handschuh`).
- Knopfboden `minWidth` = `controlHeightSM` (`antdKnopf()` in `theme/tokens.ts`). `Switch` über
  `switchMasse`/`antdKomponenten(farben, dichte)`; Nachweis am CSS der `css-var-…`-Klasse über
  `innerHTML`, nicht `textContent`. Schalter in fester Breite brechen um, statt zu kürzen
  (`pages/lagekarte/Sidebar.tsx`, `e2e/lagekarte-leiste-dichte.spec.ts`).
- **Handgebautes Bedienziel** (LFH-365): `minHeight: token.controlHeight` **plus** `padding` aus
  `token.paddingSM`/`token.padding` (aufgelöste Tokens, nie `var(--lfh-*)`), geprüft über eine
  reine exportierte Stilfunktion (`bedienzielStil`) mit Böden als **Literalen**. **Ein `<a>` erbt
  keine Steuerhöhe.** Gate 3 je Route: `e2e/gate3-trefflaeche.spec.ts`.
- **Tastenkürzel als Marke** (LFH-335), nie nacktes `<kbd>`: `components/Tastenkuerzel.tsx`
  (Flex mit `gap`, `currentColor`, **kein** `controlHeight`-Boden; `tastenkuerzelStil` pinnt die
  Abwesenheit).

**Sprungpalette** (`command-palette/`)
- ↵ öffnet, **Strg/⌘+↵** oder Strg/⌘+Klick im neuen Tab, **→** am Textende zeigt die
  Lese-Vorschau in der Palette (Esc/← zurück; Esc **muss** `preventDefault` rufen). Tippziel
  (Chevron) an jeder Zeile mit Vorschau: kein `Button`, `aria-hidden`, `mousedown` abgefangen,
  Maße aus `vorschauZielStil` (`zeilenStil.ts`).
- `Befehl.ziel` ist die Marke, `ausfuehren(oeffnung?)` reicht `'neuerTab'` durch;
  Navigationszeilen nur über `sprungZu` (`command-palette/typen.ts`; Guards `befehle.test.ts`, `datensaetze.test.ts`). Ohne
  Ziel kein Rückfall auf ↵.
- Neue Vorschausorte: `VorschauZiel` + Zweig in `command-palette/Vorschau.tsx` (exhaustiv), Ziel
  in der Quellentabelle von `datensaetze.ts` (nicht in `befehlFuer`), Inhalt als wiederverwendbares Lese-Bauteil
  (`personen/PersonVorschau.tsx`). Vorschau liest das Listenfach per `select` über
  `command-palette/datensatzAbfrage.ts` (gleicher Schlüssel, `queryFn`, `FRISCH_MS`), kein
  Detailfach; ETB über `lfdNr` nur bei gleicher `id`; fehlt der Satz, sagt `VorschauZustand` es.
  Verweise in der Vorschau schließen die Palette.
- **Fokuszeile** (LFH-507): „Status setzen“ öffnet das `StatusWahl`-Menü der Zeile, die den Fokus
  hat. Die Ebene hängt am Primitiv, ihre Wurzel ist die Zeile (`[data-row-key]` bzw.
  `datensicht-karte`), kein eigener Auswahlzustand. `nurMitFokus` hält zeilengebundene Aktionen aus
  dem Anzeige-Fallback; der Leerfall ist die tragende Aussage (`StatusWahl.palette.test.tsx`).

**Aktionen**
- **Datensatz-Aktionen werden gebündelt** (LFH-365): ab drei (nach Rechteprüfung) ein
  `Dropdown` (`menu={{ items }}`, `trigger={['click']}`, `autoFocus`, icon-only
  `<Button type="text">`), kein `Popover`. Zugänglicher Name mit **Zeilenkennung**. Rückfrage per
  `<Modal>` außerhalb der Zeilen-`map`, kein `Popconfirm`. Portal-Klick per Riegel am
  **Container**; Rechte-Riegel an der Ableitung (ein Callback ist kein Rechtebeleg). Test über
  `.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]` + `within`. Kartenmodus: `Datensicht`
  baut `weitere`.
- **Ein Sprung ist keine Handlung** (LFH-616): gezählt werden nur ändernde Aktionen; Deeplinks
  („… ↗") stehen als eine Zeile (`data-lfh="inspector-sprung"`), rote Handlung abgesetzt.
- **Messwerkzeug**: exklusiver Modus in `useKartenInteraktion`, ohne Schreibrecht, per Escape
  beendbar, Stand über `messQuelle.ts`; `messZeichnung.ts` nimmt nur die gewählte Geometrie.
  **Jede terra-draw-Instanz eigener `prefixId`** (`td-abschnitt`/`td-zone`/`td-mess`);
  Messung vor `setStyle` räumen, nach `style.load` neu.
- **Esc beim Zeichnen ist zweistufig** (LFH-712, Entscheidung 28.09.2026): erstes Esc verwirft
  die Figur mit Quittung, der Modus bleibt; Esc ohne Figur beendet ihn (Messen: ein Esc). Stufe
  aus `lagekarte/zeichnenEsc.ts`, **ein** `keydown`-Zuhörer der Seite, terra-draw-Modi mit
  `keyEvents: { cancel: null }`. Offene antd-Overlays schließen per eigenem `window`-keydown
  **ohne** `preventDefault` → Riegel `escGehoertOverlay`, `defaultPrevented` allein reicht nicht.
  Punktzahl aus terra-draws `history`, nie aus DOM-Klicks (die laufen an terra-draw vorbei).
- **Drag & Drop zieht nur mit `ZugPointerSensor`** (LFH-519, `components/zugPointerSensor.ts`):
  dnd-kits `PointerSensor` schluckt nach einem Zug jeden Klick, bis ein 50-ms-Timer läuft; unter
  Last verhungert der Timer, und der erste echte Klick geht verloren. Guard und Gegenprobe in
  `zugPointerSensor.test.tsx`, Nachweis `e2e/uhs-grundriss-menue-belegung.spec.ts`.
- **„Genau eine Primäraktion"** prüft der Kopf (`data-lfh="seitenkopf-aktionen"`), nicht global.
- **Ein Anker in der Zeile bedient den Klick allein** (Riegel `closest('a')` in `Datensicht`);
  mit `titel.ziel` erzeugt das `render` keinen Anker.
- **Der Kopf-Slot trägt, was ÖFFNET — nie, was ABSENDET**; Speichern gehört ins `<form>`.
- **Eine Sektion wickelt ihren Seitenrahmen selbst** (`AdminPage` in der Sektion; Drift-Test
  `adminNav.test.tsx`). Detailseite ohne Einzel-Endpunkt, wenn die Listenform alles trägt
  (`/admin/stammdaten/{fahrzeuge,personal}/:id`), sonst Einzel-GET; Admin-Pfade in
  `admin/adminNav.tsx`.

**Inline-Bearbeitung und Status**
- **Ein leeres Feld muss sagen, dass man es schreiben kann:** optionale Inline-Angaben nehmen
  `components/BemerkungZelle.tsx`, nicht `Typography.Text editable` (Platzhalter `Button type="link"`, Zeilenkennung im Namen,
  Lesezweig „—", Fehler an der Zelle per `data-fehler`, Fokusrückgabe und Wertgleichheits-Riegel
  im Primitiv). Falle: antds `Editable` wertet **legacy `keyCode`** aus — Tasten per `fireEvent`
  mit `keyCode`, Mausweg (`onBlur`) eigens, Speicherfall mit `rerender`. **Pflichtangaben und
  andere Eingabearten** (Datum, Auswahl, Zahl) nehmen `components/InlineAngabe.tsx` (LFH-472):
  eigenes `<form>`, kein Speichern beim Verlassen, leere Pflicht → kein PATCH, alter Wert und
  Hinweis per `data-fehler`; Zeitpunkte über `wireZuPicker`/`pickerZuWire` und Gleichheit am
  Instant. Die Fokusrückgabe beider Primitive steht in `components/useFokusRueckgabe.ts`.
  Einsatzdaten: eine Zeile schickt EIN Feld (`patcheEinsatz`), Bezeichnung und Koordinate nur
  im Vollformular.
- **Statuswechsel in Kräfte-Listen**: Auslöser ist die Statusanzeige, senkrechtes Menü im Portal
  (`components/StatusWahl.tsx`, `statusBedienung`), am `status`-Slot, nie am `aktion`-Slot
  (`docs/superpowers/specs/2026-07-30-kraefte-listen-statuswechsel-zielform.md`).
- **Statusfarbe: Rollenfarben als getönte Fläche, Mandantenfarben nur am Rand** (Neuentwurf
  22.09.2026): `StatusTag` Vorgabe `flaeche`, Werte/Kontrast nur in
  `components/instrument/statusFlaeche.ts`; gesetzte `status_farbe` erzwingt `rand`
  (`wirksameDarstellungsart`). Gemessen in `kraefte-kontrast.spec.ts`.
- **Material** (LFH-341, `materialStatus`): `im_einsatz` `bedien`, `defekt`/`verbraucht` `alarm`;
  `pages/MaterialPage.tsx` und `pages/uhs/MaterialTab.tsx` lesen beide von dort — zwei
  Farbbehandlungen desselben Enums wären der Fehlerfall, nicht der Kompromiss.
- Portal-Menüs sind kein Verlassen der `Datensicht` (`pruefeVerlassen`); in jsdom wandert der
  Fokus nicht — Handler direkt mit `relatedTarget` prüfen.
- **Ein Status gehört in den Vertrag:** jede `Record<…, StatusDarstellung>` steht in
  `theme/statusFarben.ts` (`ALLE_MAPS` in `statusFarben.test.ts`: 26 am 29.09.2026); jede weitere
  Karte ist eine begründete Entscheidung (Beispiele: `odlStufe` in
  `openspec/changes/archive/2026-09-21-lfh-78-fachebene-odl/design.md`, `aufbewahrungZustand` in
  `openspec/changes/archive/2026-09-29-lfh-23-retention-rest/design.md` D4). `theme/statusVertrag.guard.test.ts`: keine Karte außerhalb
  der Datei, kein `<Tag color={…}>` auf Vertrags-Enums (dafür `components/StatusTag.tsx`).

**Farbe und Zeichen**
- **Rot bedient nichts:** `bedien` und Fokusring blau, Rot ist Gefahr. Jede Statusfarbe braucht
  einen **zweiten Kanal** (WCAG 1.4.1). Farbwerte nur aus `theme/tokens.ts`/`theme/rollen.css`.
  Flächen (`warnstufeFlaeche`/`flaechenFarbe`) sind die dritte Darstellungssorte; eine vierte wird
  in `statusFarben.ts` benannt, nicht in `pages/`.
- **Helligkeit: ein Regler, eine Sperre** (LFH-397, Kriterium 8,
  `openspec/changes/archive/2026-09-29-lfh-397-helligkeitsregler-warnsperre/design.md`): dritte Achse im
  `ThemeModeProvider` (`useHelligkeit`, Stufen 100/80/60/40/20, `lifeline-hub.helligkeit`,
  **gespiegelt in `index.html`**), wirkt nur über die Deckschicht `html::after` in `rollen.css`
  (`--lfh-abdunkelung`, `@media screen`), nie über Paletten. Bei aktiver Warnung
  (`einsatz/aktiveWarnung.ts`: Warnstufe mit Rolle `alarm` oder
  `meldungen.bestaetigung_ueberfaellig`) gilt `HELLIGKEIT_BODEN_WARNUNG` (abgeleitet über
  Kriterium 5, Guard `theme/helligkeit.test.ts`); Quellen melden sich nur über `useWarnsperre`
  (heute allein `EinsatzLayout`). Die Sperre ändert nie die Wahl.
- **Der dauerdunkle Rahmen hält die Tag-Schwelle** (LFH-434): die Schwelle aus Kriterium 5
  folgt dem Umgebungslicht, nicht dem Token. Jeder Text auf Kopfleiste/Rail, auch ein
  Zustandswort, hält ≥ 7 : 1 auf dem Grund, auf dem er steht (`grund`/`feld`/`aktiv`); einzige
  Ausnahme `rahmenFarben.gesperrt` (≥ 4,5) für Gesperrtes, dann mit Zeichen ohne Farbe auf jeder
  Breite (Schloss in `AppLayout.tsx`). Jede Textfarbe im Rahmen steht in
  `theme/rahmenKontrast.test.ts` und wird dort gerechnet (der Test sieht keine Verwendung, nur
  die Liste). Gilt für jede weitere dauerdunkle Fläche.
- **Rot steht nicht bündig neben Neutralem:** `<Space>` mit `danger` und weiterer Aktion trägt
  `size="middle"` (`aktionsabstand.guard.test.ts`).
- **Destruktiv ist nicht gleich destruktiv** (LFH-363): Umkehrbares („Außer Dienst",
  „Deaktivieren", eine gelöste Zuordnung) → Abstand + `danger`, keine Rückfrage; Unumkehrbares →
  Rückfrage, `Popconfirm` mit `okButtonProps={{ danger: true }}`.
- **Ein Emoji ist keine Ikone:** `@ant-design/icons` in `aria-hidden`-Hülle, Zuordnung per
  `Record` in der Komponente (`kraefte/AmpelZelle.tsx`), in Text-/Druckausgaben ein Kurzwort
  (`Pers.`/`Fzg.`/`Mtl.`). Kein Guard (Bestandsliste u. a. `pages/EinheitenPage.tsx`,
  `pages/EinsatzabschnittePage.tsx`, `components/FunkErreichbarkeit.tsx`,
  `components/Platzhalter.tsx`, `pages/lagekarte/FachebenenInspector.tsx`), verbindlich für
  Neues und Angefasstes; Emoji-Testabfragen umstellen, nicht löschen. Erlaubt als
  `aria-hidden`-Textzeichen neben einem Wort: ⧖ und ↗.

**Personen und Sichtung**
- **Sichtung geht mit dem Anlegen mit** (`POST …/personen` mit `sichtung`, eine Transaktion,
  unter `war_neu`) — kein nachgeschobener Request (Offline-Idempotenz). Mit `vermisst` 422,
  unbekannte Kategorie 400.
- **Eine Erfassungsmaske ist ein Bauteil, kein Ort:** `personen/AufnahmeFelder.tsx` (ohne
  `<Form>`) für Modal und `/einsaetze/:id/personen/aufnahme`; Budget verschieben, nicht dehnen.
- **`SK_META`** führt Schlüssel von `sichtungsfarben` oder `null`, keine CSS-Werte.
- **Verortungsauftrag** per `lagekartePfad(…, { platzieren })` → `?platzieren=<typ>:<id>`;
  `parsePlatzierenAuftrag` verwirft Unbrauchbares ganz; die Karte räumt den Parameter und betritt
  den Modus nur mit Schreibrecht. Koordinaten in der Schadens-Erfassung: LFH-453.

**Rückwege und Fehler**
- **Erst die Umkehrbarkeit, dann der Rückgängig-Knopf** (LFH-343): eine Rückfrage fällt nur, wenn
  es einen **serverseitigen** Rückweg gibt (`POST …/vollzug` → `offen`,
  `POST …/erinnerungen/{eid}/oeffnen`, `uebergang_erlaubt` eine Stufe zurück); sonst bleibt sie.
  Toast `kommunikation/rueckgaengig.tsx` mit festem Schlüssel; nach einer Nutzeraktion ist er
  keine Alarmmeldung (EEMUA 191).
- **Linker Kartenrand: EINE Farbe, Gefahr gewinnt** (`colorError` vor `colorWarning`; prüfbar
  über `data-alarm`/`data-unbearbeitet`). „unbearbeitet" sitzt am `StatusDeskriptor`, keine
  fünfte `KommPhase`.
- **Speicherfehler an die Seite, Erfolg an den Toast:** `components/SpeicherHinweis.tsx`
  (`SpeicherFehler`, `RechteHinweis`, `SeitenHinweise` für EINEN Slot); kein `onError`-Toast;
  der Alert geht beim nächsten Absenden (mittesten).
- **Gescheiterter Zustandsübergang meldet sich im Dialog** (LFH-535):
  `entwurf/FreigabeDialog.tsx`, kein `modal.confirm`; `freigabeGrund`, Vorrang Speicherfehler;
  Öffnen ruft `freigebenMutation.reset()`. Test zählt `.ant-message`, offen/zu über `ant-zoom-leave`.
- **Fehlende Berechtigung wird erklärt, nicht stumm weggeschaltet** (M16): `RechteHinweis`,
  Primäraktion gesperrt sichtbar; Zeilenaktionsspalte entfällt (M45); Wortlaut in
  `stammdaten/rechteText.ts`.
- Sofort-Speichern-Zeile sperrt nur sich (`ModulEinstellungsListe`: `laeuftKey`/`fehlerKey` aus
  `mutation.variables`, Fehlerzeile `data-fehler`).
- Zeilenlayouts ohne feste Spaltenbreite (Grid `minmax(0, 1fr) auto auto`, unter `md` gestapelt
  ohne Spaltenköpfe; Beschriftung über `modulZeilenStil`, `<label htmlFor>` nur an bedienbaren
  Zeilen).
- Ein Absende-Ziel erscheint nie später als seine Felder (`pages/LoginPage.animation.test.ts`).
- Dieselbe Eingabe nicht zweimal bauen: `components/OtpEingabe.tsx` (injizierte `id`
  durchreichen, `sendetRef` in der Absende-Funktion, kein `size`).

**Formularseiten**
- **Aufgeteilte Route erbt den Vollersatz-Vertrag:** `PUT …/einstellungen` ist Vollersatz — die
  Sektionen (`…/einstellungen/{allgemein,verhalten,aufbewahrung,module}`,
  `einsatzEinstellungenPfad`) schicken über `einstellungen/einsatzEinstellungenForm.ts`
  (`zuUpdate`) immer alle Felder mit, auch `basemap_modus`, `karten_zoom_start`,
  `fachebenen_sichtbar`. Jede Sektion stellt ihre Queries selbst (kein `useOutletContext`).
  Speichern-Leiste sticky im `<form>` (`htmlType="submit"`), gebaut nur über
  `<div {...useSpeicherLeiste()}>` (`components/speicherLeiste.ts`) — sie bringt den Fokusabstand
  mit (LFH-475, `scroll-padding` über `:root:has(...)` in `index.css`, Nachweis
  `e2e/fokus-verdeckung.spec.ts`); `speicherLeisteStil`/`feldrasterStil` rein, die Breite liest
  der Aufrufer aus `useViewport`.
- Ein Collapse-Kopf im Formular ist kein Übermittlungsknopf (`MaterialFormModal.test.tsx`).
- **Direkteinstieg** (LFH-347, `components/Direkteinstieg.tsx`,
  `components/EinstiegSwitcher.tsx`, `components/direkteinstiegKern.ts`; Tabelle unter `…/liste`;
  Schlüssel `<praefix>:letzteAuswahl:<einsatzId>` ist gepinnt). **Ein reiner Kern bekommt ein Suffix** (`…Kern.ts`): gleicher Basename
  wie die `.tsx` kollidiert case-insensitiv, Vite löst `.ts` vor `.tsx` auf („Element type is
  invalid").
- Stärke EINMAL summieren (`anzeige/staerke.ts:summiereStaerke`, `null` bei leerer Menge;
  kumuliert `pages/einsatzabschnitte/abschnittStaerke.ts`).
  „Abschnitt anlegen" ist ein lokaler Entwurf, kein Fake-Datensatz.

**Entwürfe**
- **Verlustschutz ist ein Hook:** `entwurf/useEntwurfVerlustschutz.ts` (Riegel gegen
  Fremd-Refetch, Autosave 30 s + Blur, `beforeunload`); `pages/BefehlDetailPage.tsx` und
  `LageberichtDetailPage` rendern mit `key={<id>}`. Merker ist
  eigener State, **nicht** `form.isFieldsTouched()`. Riegel als Paar testen. Autosave ohne
  Erfolgs-Toast, sondern „zuletzt gespeichert HH:MM".
- Interne Navigation: `entwurf/EntwurfNavigationSchutz.tsx` (`useBlocker`, Data Router).
- **Ein Klick auf „Entwurf speichern" ist EIN PATCH:** einzige Pforte `speichereJetzt`,
  `gesichertRef` (Start `-1`), `speichertGerade` speist den Blocker, **nicht** `loading` am Knopf.
- Einstiegsfokus im ersten LEEREN Abschnitt (`entwurf/Einstiegsfokus.tsx`).
- Lagebericht: Abschnitte als Akkordeon (`lageberichte/AbschnittsAkkordeon.tsx`, `memo`, alle
  Props identitätsstabil; Gate ist der Render-Zähler im Test, `rerender` mit neuem Element).
  Tippmessung `e2e/lagebericht-tippen.spec.ts` (Deckel nur mit `PW_LATENZ=1`).
  Liste zeigt Kettenköpfe (`lageberichte/ketten.ts`), Zyklen verlieren keinen Bericht.

**Layout und Live**
- **Eine Höhenkette endet nicht am Layout** (LFH-343, H51): `AppLayout`/`EinsatzLayout` wachsen
  mit; Scrollbereiche begrenzen die Seite selbst in `dvh` (`pages/ChatPage.tsx`: Messung per
  Callback-Ref, `ant-row` mit `flexWrap: 'nowrap'`); geprüft mit
  `toBeInViewport()`, nie `toBeVisible()`.
- Stick-to-bottom hängt an der jüngsten id, nicht an der Länge.
- **Live-Updates springen nicht unter dem Cursor:** Sammelbanner statt Einschieben (CLS ≤ 0,1,
  WCAG 3.2.5); Alarmbudget EEMUA 191/ISA-18.2: 1–2 je 10 min, ≤ 3 Stufen. **Kein Blinken auf
  lesbarem Text.**

## Frontend — Keine Arbeitsplatzachse (LFH-456)

Neben Form (LFH-19) und Kontext (LFH-327) gibt es **keine dritte Bedienachse „Arbeitsplatz“**
(Entscheidung 29.09.2026, `openspec/changes/archive/2026-09-29-lfh-456-keine-arbeitsplatzachse/design.md`,
Spec `bedien-arbeitsplatz`).
- **Einstieg statt Achse:** Eine Fläche für einen Arbeitsplatz ist ein Einzelfall. Sie wird
  über einen Einstieg in einer bestehenden Fläche erreicht (Primäraktion im Seitenkopf,
  Sprungmarke, Leeraktion eines Paneels, Sprungpalette) und hat eine Adresse, die als Lesezeichen
  taugt. Was je Standort verschieden ist, trägt die Kontext-Achse **am Gerät**; „Fükw-Arbeitsplatz“
  in `ThemeModeProvider.tsx` meint das Gerät. Keine Wahl einer „Arbeitsweise“, keine Vorbelegung
  von Startziel, Primäraktion, Modulreihenfolge oder Dichte je Person; `standard_modul` gilt für
  den ganzen Einsatz. Je Person liegt nur das Palettengedächtnis „Zuletzt“
  (`benutzer_einstellungen::BEKANNTE_SCHLUESSEL`, geschlossener Schlüsselraum).
- **Nicht zuständig für Rechte:** Sichtbarkeit und Schreibrecht kommen allein aus `EinsatzRolle`,
  Systemrolle und Modulfreigabe (`einsatz/schreibrecht.ts`, `berechtigung::erlaubte_module`); ein
  Einstieg ist keine Freigabe, die Zielseite prüft selbst. Stabsfunktionen S1–S6 ebenso (LFH-46).
- **Aufnahme** (`personenAufnahmePfad`): Einstiege sind die UHS-Kopfzeile „Patient aufnehmen“
  (LFH-341/C6, nur `aktiv` und mit Schreibrecht) und die Leeraktion des Sichtungspaneels. Die
  Palette führt „Neue Person erfassen“ auf Liste + Modal und **keinen** Aufnahme-Befehl.
- **Wiedervorlage** einer wählbaren Arbeitsweise nur mit Feldbefund (Personenwechsel zwischen
  Arbeitsplätzen auf einem geteilten Gerät, dem Lesezeichen und Einstiege nicht genügen) oder bei
  einem dritten Einstieg in dieselbe Fläche. Transport hat keine eigene Fläche (Lücke, kein Anlass).

## Frontend — Erfassungs-Norm (LFH-332/B4)

**Erfassungsformulare nehmen `components/Erfassung.tsx`** (`ErfassungsModal`,
`ErfassungsFormular`); ein handgebautes `<Modal>` + `<Form>` ist ein Fehler.
- **Absende-Knopf im `<form>`, deshalb sendet Enter** (native Übermittlung; `Input.TextArea`
  behält den Zeilenumbruch). Fußzeile selbst gerendert (`footer={null}`), kein
  `onOk={() => form.submit()}`.
- **Ein `Select` schluckt Enter** (`BaseSelect/index.js:246`) — bei Select-Masken die Struktur
  prüfen: kein `.ant-modal-footer` **und** `knopf.closest('form')` ≠ `null`
  (`components/Erfassung.test.tsx`).
- **Fokus im ersten Feld** beim Öffnen und nach jedem Serien-Speichern (`requestAnimationFrame`).
- **Zurückgesetzt wird auf JEDEM Weg hinaus** (Erfassen, Abbrechen, Kreuz, Escape, Maske); der
  Aufrufer ruft kein `resetFields()`; Vorbelegen zum Bearbeiten (`setFieldsValue`) ist kein Reset. **`destroyOnHidden` setzt rc-field-form nicht zurück.**
- **`onErfassen` lehnt bei Ablehnung ab** (`mutateAsync`); die Felder bleiben stehen.
- **Serienmodus** (`serie`): „Speichern und nächste" hält offen, leert, zählt, fokussiert, ruft
  `form.submit()` von Hand; die Serien-Marke wird in `onFinish` verbraucht **und in
  `onFinishFailed` gelöscht**. **Strg/⌘ + Enter** löst es aus (nur bei `serie`); Riegel
  `sendetRef` in `abschicken`.
- **„Werte behalten"** (`uebernahme`) ist eine Einstellung: eigene Zeile über den Knöpfen,
  **Vorgabe AUS** — in `components/Erfassung.tsx` **und** `pages/EtbPage.tsx` (`useState(false)`).
- **Der Tastaturvertrag steht einmal, nicht im Platzhalter** (Hinweiszeile unter der
  `Schnellerfassungszeile`, `etb/Schnellerfassung.tsx`).
- **Ein-/Zweifeld-Kataloge nehmen `components/SchnellAnlegen.tsx`** (bewusst kein `<Form>`).
- **Feldbudget** (LFH-19): Modal ≤ ~3, Schnellerfassung ≤ ~4 sichtbare Felder, Rest eingeklappt.
  Zählen nur mit `forceRender`, immer mit Gegenprobe „Aufklappen → Zahl steigt".
- **Ein Pflichtfeld gehört nie hinter den Collapse**; Felder, die eine Ablehnung auslösen können,
  bleiben sichtbar (Auftrag: Empfänger als `Select mode="tags"`, Präfix `abschnitt:<id>`/
  `einheit:<id>`).
- Dichte kommt vom `ConfigProvider`. `test/utils.tsx` rendert ein **nacktes** `ConfigProvider`
  ohne Theme — Höhen-/Trefferflächen-Aussagen im Vitest belegen nichts.

## Frontend — Druck (LFH-71/LFH-22)

**Gedruckt wird über den Browser, nie auf dem Server** (Herleitung
`openspec/changes/archive/2026-09-29-lfh-22-druck-export/design.md`, Grundsatz aus
`docs/superpowers/specs/2026-06-02-lage-lageberichte-design.md`).
- **Eine Druckwurzel je Seite** (`data-lfh="druckwurzel"`); Mechanik nur in `druck/druck.css`
  (global in `main.tsx`, nur unter `@media print`; `@page` ist die gepinnte Ausnahme; Rest `display: none`, **nie** `visibility: hidden` + `position: absolute`). `*Print.css` tragen
  nur Eigenheiten. Nachweis `druck/druck.test.ts`, `e2e/druck-fluss.spec.ts`; Firefox/Safari per
  Hand.
- **Druckkopf** `components/druck/Druckkopf.tsx` steht in der Wurzel. Druckknöpfe sind `DruckKnopf`
  (`useDrucken`, wartet auf Organisation und Logo, höchstens `LOGO_FRIST_MS`; bereit = Daten da,
  nicht „letzter Abruf gelungen"). **Kein
  `window.print()` direkt**, nie aus dem Passiv-Effekt. `components/druck/useDruckModus.ts`
  schaltet, was CSS nicht kann (`beforeprint`/`afterprint`).
- Ein Editor druckt nie seine `<textarea>` (`MarkdownEditor` `druckfassung`).
- **Tabellen im Druck** (LFH-548): Neutralisierer der `KatalogTabelle` stehen in `druck.css` für
  jede Druckwurzel, beide Hüllen (`.ant-table-body`/`-content`), antds Messzeile aus, Zellen
  brechen um. Nachweis immer mit ausgelöstem `beforeprint` (`e2e/funkplan.spec.ts`), nicht nur
  `emulateMedia`: erst ohne `sticky` ragte eine Baumtabelle über A4.
- **„In Lagebericht übernehmen“ ist EIN Aufruf** (LFH-548): `POST …/lageberichte`/`…/befehle`
  mit `abschnitte` als Startinhalt (`AnlegenBody<A>`, Schlüssel wie beim PATCH, doppelt → 400),
  kein POST + PATCH; Fehler an die Seite.
- **ETB-Druck** (`pages/EtbDruckPage.tsx`, `etb/EtbDruckTabelle.tsx`): schlichtes `<table>` nach
  `lfd_nr`, Vollabruf `etb/druckAbruf.ts` über die bestehende Liste, Drucken erst komplett;
  `einsatzKeys.etbDruck` nicht live, `refetchOnMount: 'always'`.
- **Org-Branding** (`PATCH /api/organisation`, `…/organisation/logo`, PNG/JPEG ≤ 1 MiB,
  Virenscan) liegt außerhalb der Schwärzung (`schwaerzung_registry.rs`).

## Frontend — Deeplink-Muster (Route vs. Query-Param)

Quelle der Wahrheit: `frontend/src/routing/deeplinks.ts` — keine Template-Literals für
Einsatz-Pfade (`docs/superpowers/specs/2026-06-23-deeplinks-vereinheitlichen-design.md`).
- **Item-Route** `/einsaetze/:id/<modul>/:<modul>Id` bei Vollseiten-Detail (uhs, br, lagebericht,
  befehl, person, tier, schaden), sonst **Query-Param** `?<modul>=<id>` (`?einheit=`,
  `?fahrzeug=`, `?personal=`, `?abschnitt=`, `?meldung=`, `?auftrag=`, `?gefahrengebiet=`, ETB
  `?eintrag=`); `?neu=1` fokussiert die Schnellerfassung. Stabile DB-`id`; `parseRouteId`.
- **Filter gehören in die URL** (`etbPfad`/`parseEtbFilter`, `mitQuery` kodiert). Unbekannter
  Enum-Wert wird ganz verworfen (exhaustiver `Record<EtbTyp, true>`).
- **Zeit in der URL** ist UTC ohne Zone (`dayjs(s)` läse Ortszeit) — Umkehr in `etb/filterZeit.ts`
  mit eigenem Test. Kodierung per Round-Trip durch `URLSearchParams` prüfen.
- Filterleiste nur bei **fremder** Änderung neu aufsetzen (nach der Navigation); entprellt wird
  in der Leiste. Unter Fake-Timern: `fireEvent.change`, kein `userEvent.type`, kein `findBy*`.

## Frontend — Query-Key-Registry (LFH-122/307/312)

Quelle der Wahrheit: `frontend/src/api/queryKeys.ts`.
- `einsatzKeys` (`EINSATZ_KEYS`): jeder Key genau einmal klassifiziert — live über
  `EINSATZ_STREAM_EVENTS` oder `NICHT_LIVE_KEYS`. `globalKeys` (`GLOBAL_KEYS`) für alles darüber.
- **Kein Inline-String-Array als Query-Key** (`queryKeys.guard.test.ts`, `queryKeyScan.ts`).
- **Wire-Strings sind eingefroren** (`globalKeys.test.ts`, gegen handgeschriebene Literale).
- Sub-Keys: String-Union-Token als zweites Element; der argumentlose Accessor ist der
  Invalidierungs-Prefix (`personal()` und `personalListe('alle')`).
- **Testfallen:** ohne gemounteten Observer `new QueryClient()` statt `neuerQueryClient()` (dessen
  `gcTime: 0` räumt beim ersten `await`);
  **Charakterisierungstests bauen ihre Keys als Literale**, nicht über die Factory.

## Frontend — Lagebild ohne Netz lesen (LFH-723)

**Was ohne Netz lesbar bleibt, steht in der Registry, nicht im Persister:** `LAGEBILD_OFFLINE`
und `istLagebildOfflineKey` in `api/queryKeys.ts`. Das sind ETB, Meldebild, Betroffene,
Aufträge und Lagekarte samt Rahmendaten (Einsatzkopf, Freigaben, Einstellungen, Zähler,
Einsatzliste, Kartenkonfiguration, Organisation, Fahrzeugstatus). Von den Meldungen zählen nur
die Rückmeldungen. Gespeichert wird in einer eigenen IndexedDB `lifeline-lagebild`
(`offline/lagebildSpeicher.ts`, genau ein Datensatz je Gerät), nie über Workbox auf URL-Ebene.
`lagebildOffline.guard.test.ts` vergleicht die Liste mit **jedem** verwalteten Prefix. Ein neuer
Prefix landet also nicht still auf der Platte, er muss aufgenommen oder ausdrücklich
draußen gelassen werden.

- **Offline-Identität nur bei einem Leitungsfehler.** Scheitert `/api/auth/me` an einem
  Netzfehler oder an einer Gateway-Antwort 502/503/504, gilt der zuletzt bestätigte Benutzer
  aus dem Datensatz. Jede Antwort des Servers selbst, auch eine 500, löscht. Die Frist beträgt
  **24 h ab der letzten Serverbestätigung** (`bestaetigtAt`, bewegt nur von Fetch-Erfolgen,
  nie von `setQueryData` oder `hydrate`), nicht ab dem letzten Speichern.
- **Serverbestätigt wird nichts hydriert.** Der Stand bleibt als Vorrat und wird bei jeder
  Speicherung mit dem Live-Stand zusammengeführt (Live gewinnt, Filter bei jeder Speicherung).
  Gemessen in der CI: Ein hydrierter älterer Stand ließ die ETB-Deeplink-Logik `?eintrag=`
  räumen, bevor der neue Eintrag geladen war (`e2e/lagebild-offline-deeplink.spec.ts`).
  Hydriert wird nur ohne Serverbestätigung. `benutzer` und `laedt` wechseln serverbestätigt im
  selben Takt wie vorher: Ein Takt später färbte elf, zwei getrennte Takte sieben
  Bestandstests rot.
- **Ein Fehler mit Daten ist ein Stand.** Fällt der Server im Tab weg, behalten die Queries
  auf `error` ihren letzten Stand. Nur `success` zu schreiben nähme ihn von der Platte.
- **Gelöscht wird Speicher und Platte** bei Abmelden, 401 (über `logout()`) und
  Benutzerwechsel (`offline/lagebildSitzung.ts`). Die Offline-Queue bleibt, sie ist
  Beweissicherung. Beim **Start** löscht ein Verwerfen nur die Platte: Ein `clear()` dort
  räumte die Abfragen einer schon eingehängten Seite ab (130 rote Tests).
- **Rechteentzug im Fehler-Seam** (`api/queryClient.ts`): 403/404 auf den Einsatzkopf räumt
  den ganzen Einsatz, 403 auf einen anderen Key dessen Prefix im Einsatz. Die Trennlinie
  verläuft zwischen **beobachtet und unbeobachtet**: Beobachtete Queries verlieren nur ihre
  Daten und stehen auf `error` (`setState`), unbeobachtete werden entfernt. Entfernte beobachtete Geschwister (ETB-
  Liste und -Zähler) stießen sich sonst gegenseitig neu an, eine Abrufschleife.
  `resetQueries` scheidet aus demselben Grund aus. Eine Sperrmarke je Bereich hält die
  geleerten Queries bis zum nächsten Erfolg von der Platte, aus dem Vorrat und von der
  Offline-Wiederherstellung fern. Die läuft als eigener Schritt (Filter unmittelbar vor
  `hydrate`), nicht über `persistQueryClientRestore`.
- **Keine Mutationen, kein Einzelstand über 24 h** (`lagebildDehydrierOptionen`): Pausierte
  Mutationen trügen sonst ihre `variables` (Chat, Personen) auf die Platte.
- **„· offline“ entscheidet `Datenstand` selbst** (`useOhneVerbindung`,
  `offline/verbindung.ts`). Es gilt, wenn der Browser offline ist **oder** Abrufe an der Leitung
  scheitern. `navigator.onLine` allein trägt nicht: Chromium meldet nach einem Neuladen unter
  Playwrights Offline-Schalter `true` (gemessen), im Feld steht oft das WLAN ohne Server.
  Eine 502/503/504 **mit** dem `{error}`-Umschlag des eigenen Servers
  (`ApiError.vomAnwendungsserver`) ist keine Unerreichbarkeit, sonst setzte eine gescheiterte
  Pegel-Vorhersage die ganze App auf „offline“.
- **Die erste Speicherung erfolgt beim Abonnieren.** Das Abonnement sieht nur künftige
  Änderungen. Hatte die Seite ihre Abfragen schon fertig, blieb der Stand sonst leer
  (gemessen an der Lagekarte).
- **Testfallen:** `gcTime: 0` des Testclients räumt wiederhergestellte Einträge sofort. Wer
  sie prüft, nimmt einen eigenen `QueryClient`. Das Test-Setup räumt die Lagebild-DB ohne
  `await`, ein wartendes `afterEach` verschob den Takt zwischen Tests. Eine Mutationsprobe
  am Prod-Bundle baut mit `vite build`, nicht mit `pnpm build`: Dessen `tsc -b` bricht an
  einem ungenutzten Import ab, und `dist` bleibt still der alte Stand.
- **Offen:** die übrigen personenbezogenen Daten auf dem Gerät (LFH-767). Herleitung und
  Prüfspur: `openspec/changes/archive/2026-09-30-lfh-723-lagebild-offline-lesen/design.md`, Prüfliste
  `docs/superpowers/specs/2026-09-28-lfh-723-pruefliste.md`.

## Frontend — Lint-Disziplin

`pnpm lint` mit `--max-warnings 0`; Warnungen an der Wurzel beheben. `exhaustive-deps`
strukturell lösen (Primitive, `useMemo`/`useCallback`). `eslint-disable` nur begründet,
`-next-line` an der gemeldeten Zeile mit Kommentar; keine Block-Disables, keine toten Direktiven.

## Qualitäts-Gates — ein Kommando (LFH-235/F17)

`./scripts/check-all.sh` vor dem Merge: `check-fmt.sh` (rustfmt + Prettier) → `pnpm lint` →
`check-typ-codegen.sh` → `cargo test` (Workspace, Hülle getrennt) → Vitest → `check-deps.sh` → `pnpm e2e` →
`release-ruhefenster.test.sh` + `ki-notizen.test.mjs` → `check-deps.test.sh` →
`check-migrationen.sh` → `check-all.test.sh` + `bauziel.test.sh` → `check-toolversionen.sh` →
`check-openspec-archiv.sh`.
- **Das Skript ist die Wahrheit**; `.github/workflows/ci.yml` ruft es unverändert. Neue Schritte
  gehören ins Skript.
- **Ein roter Schritt hält die folgenden nicht auf** (LFH-386, `scripts/lib/schritte.sh`): alle
  laufen, am Ende Gesamtstatus je Schritt und EIN Exit-Code; `--abbrechen` ist das Opt-in für
  den schnellen Abbruch. Schritte laufen als eigenes Kommando in einer Subshell mit `set -e`,
  **nie** in einer Bedingung (`if`/`||` schaltet errexit im ganzen Körper ab). Übersprungen
  meldet ein Schritt mit `return "$UEBERSPRUNGEN_RC"`, nicht mit 0.
- **Ein rot geborenes Gate wird abgeschaltet statt befolgt** — erst sweepen, dann scharf schalten
  (deshalb nicht im Gate: `cargo clippy -D warnings`).
- Prettier prüft nur `frontend/`; nicht idempotent (nach `--write` noch rot → nochmal).
  Ausnahmen nur mit Begründung in `frontend/.prettierignore`. Kein `.git-blame-ignore-revs`.
- **Node und pnpm stehen nur in `[tools]` von `mise.toml`** (LFH-773): Skripte rufen
  `mise exec -- …`, Workflows `jdx/mise-action` ohne `install_args`. `packageManager`,
  `engines.node` und der Devcontainer spiegeln die Zahl; `scripts/check-toolversionen.sh`
  prüft das und bricht an jedem harten `node@…`/`pnpm@…` in `scripts/`, `.github/`, README, Skills.
- Env-Hygiene über `scripts/lib/dev-env.sh`, keine handgepflegte `env -u`-Liste; Isolation wo
  möglich im Test (`config::tests::parse_hermetisch`).
- **Jeder Checkout baut in sein eigenes `target/`** (LFH-520, `.cargo/config.toml`, schlägt
  das globale `build.target-dir`; `CARGO_TARGET_DIR` schlägt beide). In einem geteilten Ziel
  teilen sich Worktrees Fingerprints und Binaries (Hash aus dem Pfad relativ zur
  Workspace-Wurzel, Frische per mtime), und Tests liefen still gegen einen fremden Stand.
  Schritt 3, 4 und 7 prüfen das vorab (`scripts/lib/bauziel.sh`, rot bei fremdem Ziel ohne
  Umgebungsvariable), Selbsttest `scripts/bauziel.test.sh`; Gate und Playwright nennen das
  gestartete `Backend-Binary:`. Kosten: ~3 min kalt, bis 19 GB je voll gebautem Worktree,
  frei mit dem Worktree. Ein älterer Worktree ohne die Datei erbt unter einem Main-Checkout
  mit ihr dessen Ziel, bis er auf `alpha` vorgezogen ist
  (`openspec/changes/archive/2026-09-30-lfh-520-cargo-artefakte-isolieren/design.md`).
- e2e ist selbsttragend, braucht aber das Debug-Binary; Schritt 7 baut bei Bedarf den Prod-Bundle
  (`prod_bundle_bereitstellen`; Service Worker für `e2e/lagekarte-offline-precache.spec.ts`,
  ausgeliefert vom e2e-Backend über `src/static_files.rs`).
- **Kein `| tail` um Gate-Kommandos.** Testgüte belegen Mutationsproben, nicht Abdeckung.
- **Ein Layout-Gate misst jeden rollenabhängigen Zustand auch nicht-privilegiert** (LFH-435):
  Beobachter, Org-Führungskraft bzw. Führungspersonal über `e2e/rollen-kern.ts` (Seeding als
  Admin, Wechsel im selben Kontext). Der Rollenzweig ist VOR der Messung Vorbedingung
  (Hinweis steht, Aktion gesperrt oder abwesend), die Mutationsprobe macht nur den
  Nicht-Admin rot. Freistellungen in Gate 1 nennen die Rolle. Inventar:
  `openspec/changes/archive/2026-09-30-lfh-435-e2e-gates-nicht-privilegiert/pruefliste.md`.
- **e2e wartet nie auf `networkidle`** (LFH-385): der SSE-Strom der Einsatzrouten lässt das Netz
  nie ruhen (parallel rot, `--workers=1` grün). Gewartet wird auf einen Inhaltsanker; Riegel
  `no-restricted-syntax` für `e2e/**` in `frontend/eslint.config.js`.
- Optionaler pre-push-Hook: `git config core.hooksPath .githooks`.
- **Release je Arbeitsschub** (`scripts/release-ruhefenster.sh`, Aufruf in `release.yml`); ein übersprungener Release-Job
  ist Normalfall; `chore(release):` zählt nicht als neuer Commit. Notizen über
  `scripts/release/ki-notizen.mjs` (Rückfall auf konventionelle Notizen, `maxTurns: 1`, Vorlage
  `KI_PROMPT` in `release.config.mjs`).
- **Advisories** (`scripts/check-deps.sh`): Rust `.cargo/audit.toml` (Ignorierliste mit
  Begründung); Frontend nur `overrides` in `frontend/pnpm-workspace.yaml`, jeder `high`-Fund bricht
  (`--audit-level=high`).
  **Kein leerer `auditConfig.ignoreGhsas`-Block** (ein Eintrag ohne Verstoß gilt selbst als
  Verstoß). Overrides pflegen Bereich **und** Zielversion. Der Audit prüft das **Lockfile** in
  einem Wegwerf-Verzeichnis (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`; nie
  `node_modules`; Node/pnpm aus `mise.toml`), Selbsttest `scripts/check-deps.test.sh`.

## Desktop-Hülle (LFH-721)

`src-tauri/` (Crate `lifeline-desktop`, Tauri 2), Anforderungen `openspec/specs/desktop-huelle/`
und `…/desktop-auslieferung/`, Betrieb `docs/betrieb/desktop-app.md`.
- **Keine Anwendungslogik in der Hülle** (Variante A, LFH-720): der Webview lädt die
  https-Adresse des Servers. Abhilfen für Webview-Grenzen gehören in die Hülle (Init-Skript,
  Command), nicht ins Frontend.
- **Rechte:** Adresse setzen nur die lokale Maske (`capabilities/lokal.json`); die Serverseite
  bekommt zur Laufzeit genau für ihre Origin nur `drucken` (`server_freigeben`). Jeder neue
  Command steht im `AppManifest` von `build.rs`, sonst wäre er für jede Seite offen.
- Adresse, Deeplink (`lifeline://verbinden?server=`, Vertrag für LFH-38) und Speicherung sind
  reine, getestete Funktionen (`adresse.rs`, `deeplink.rs`, `verbindung.rs`).
- **Neue Fenster und Links** (LFH-782) entscheidet `links.rs` rein, den Server liest es bei
  jedem Aufruf frisch: eigene Origin → Nebenfenster (`neben-*`, gleicher Fensterbau
  `baue_fenster`, Druckfreigabe per Muster), `/api/` → Download, **außer `/api/auth/`** (OIDC
  läuft im Fenster), fremde `http(s)`/`mailto`/`tel` → System (`tauri_plugin_opener::open_url`,
  Plugin nicht registriert). Fremde Navigation im Fenster bleibt erlaubt (Anbieter).
- **Version: eine Quelle** in `[workspace.package]` der Wurzel, Server und Hülle erben
  (`version.workspace = true`), `tauri.conf.json` trägt keine; `prepareCmd` setzt sie über
  `-p lifeline-hub`. Kein eigenes Versionsfeld in `src-tauri` (driftet beim alpha-Merge; Test
  `version_kommt_aus_dem_workspace`).
- Pakete + `latest.json` nur bei stabilen Tags (`artefakte.yml`, Ausgabe `desktop`);
  `scripts/release/desktop-manifest.mjs`, Selbsttest in Schritt 8. Der Updater-Schlüssel liegt
  außerhalb des Repos (Secrets `TAURI_SIGNING_PRIVATE_KEY[_PASSWORD]`), der Pubkey in
  `tauri.conf.json`.
- **Schritt 4 testet Server und Hülle getrennt** (`--workspace --exclude lifeline-desktop`, dann
  `-p lifeline-desktop`): in einem Zug vereinigte Cargo die Features, der Server liefe mit zwei
  rustls-Providern (Stolperdraht `tls::tests::rcgen_pem_ist_per_rustls_ladbar`). Linux-Runner
  des Rust-Jobs brauchen die GTK-/WebKit-Pakete (`ci.yml`); `coverage.yml` misst ohne Hülle.

## Backend↔Frontend — Typ-Codegen (LFH-120)

Response-Typen werden generiert: `#[derive(ToSchema)]` → `src/api_doc.rs` →
`frontend/src/api/openapi.json` → `openapi-typescript` → `frontend/src/api/types.generated.ts`; `types.ts` ist nur Barrel.
- Nach jeder Response-DTO-/Enum-Änderung `scripts/check-typ-codegen.sh` und beide generierten
  Dateien mitcommitten.
- Enums wire-korrekt `#[serde(rename…)]`; Union-Strings `#[schema(value_type = Enum)]`
  (`Option<Enum>` bei `Option<String>`). **Enum-Wire-Kontrakt** in `tests/enum_wire_kontrakt.rs`
  (`enum_wire_as_str!`/`enum_wire!`, voll qualifizierte Pfade, bei `LiveEvent::ALLE` `contains`
  und Länge).
- **Noch handgepflegt:** Request-/Input-DTOs (`NeuerX`/`PatchX`) und zwei `Record<>`-Maps.
- **Optionalität ehrlich machen** (Norm LFH-265, kein Sweep): `Option<T>` in Response-DTOs mit
  `skip_serializing_if = "Option::is_none"`; `#[serde(default)]`-Felder stattdessen
  `#[schema(required)]`. **Testfalle:** Presence per `contains_key`, nicht `== Value::Null`
  (`tests/ort_vorschau.rs`).

## Backend — Migrationsvergabe (LFH-658)

- **Anhängen, nicht einschieben:** neue Migrationen tragen eine Nummer **größer als jede auf dem
  Ziel-Branch**; bestehende werden nie geändert, umbenannt oder gelöscht.
- `scripts/check-migrationen.sh` (gegen `origin/alpha`, vorher `git fetch`), Umlegen mit
  `--umnummerieren`. Durchgesetzt über `.github/workflows/migrationen.yml` (Required Check
  `Migrationsnummern`); Netz `db::tests::migrationsnummern_sind_eindeutig`.
- **Falle: sqlx spielt eine kleinere, noch nicht eingespielte Migration still nach**
  (`db::tests::sqlx_spielt_eingeschobene_kleinere_version_still_nach`).
- **Migrationen entstehen nur über `alpha`**; Freigaben als Merge-Commit, nicht Squash.
  Herleitung: `openspec/changes/archive/2026-09-29-lfh-658-migrationsnummern-vor-dem-merge/design.md`.

## Backend — Demo-Daten zur Laufzeit (LFH-690)

`src/demo/`, `src/routes/demo_daten.rs`; Schalter `--demo-daten`/`LIFELINE_DEMO_DATEN=true`
(Vorgabe aus). Herleitung: `openspec/changes/archive/2026-09-29-lfh-690-demo-daten-laufzeit-import/`.
- 404 ohne Schalter kommt aus der Registrierung (`RouterOptionen { demo_daten }`,
  `build_router_mit`); das Frontend liest nur `GET /api/demo-daten` (`admin/useDemoDaten.ts`).
- **Import ist eine Transaktion nur über `…_tx(conn)`-Funktionen** (eine Pool-Funktion unter
  offener `BEGIN IMMEDIATE` endet in 503); kein rohes SQL.
- **Löschen erreicht strukturell nur Demo-Daten** (Einsatz-ID aus `demo_import`, `org_id` in jedem
  WHERE, Stammdaten je Zeile im `SAVEPOINT`). Voraussetzung: FKs auf
  `fahrzeug`/`personal`/`material` `NO ACTION`/`RESTRICT`, nie `DEFERRABLE`
  (`src/demo/schema_tests.rs`).
- Einsatz-IDs werden nie wiederverwendet (`einsatz::repo::anlegen_tx`). Die Szenariouhr setzt
  `received_at = ereigniszeit` nur am Demo-Einsatz; nie eine FTS-Spalte per UPDATE ändern.

## Backend — Aufbewahrung (LFH-23)

Herleitung: `openspec/changes/archive/2026-09-29-lfh-23-retention-rest/design.md`.
- **Totalsperre bleibt** (`einsatz::berechtigung::darf_lesen`, auch für den System-Admin); das
  Archiv liest nur `/api/aufbewahrung` (`routes/aufbewahrung.rs`), Guard
  `archiv_namensraum_nur_lesend_und_admin` (`tests/aufbewahrung.rs`) — neue Routen dort
  eintragen, nicht lockern. Frontend: Verwaltung → „Aufbewahrung" (`admin/adminNav.tsx`), Akte
  unter `/admin/aufbewahrung/:einsatzId`.
- Archivzugriff nur für den System-Admin der eigenen Org (`fordere_archivzugriff`: fremd 403,
  unbekannt 404, aktiv 409). `PUT …/aufbewahrungsfrist` prüft die Org nicht (bekannte
  Inkonsistenz).
- **Akte ist eine Retain-Projektion** (`aufbewahrung/projektion.rs`, Guard
  `jede_archivspalte_ist_retain` über `klassifikation_von`), eigene DTOs.
- **Wiederherstellen braucht die neue Frist** (`einsatz::repo::wiederherstellen`, `retention_bis`
  Pflicht, Grenze `retention::karenz_grenze`). 409 bei geschwärzt oder
  abgelaufener Karenz, 422 bei nicht vorgemerkt bzw. vergangener Frist; Frist-PUT über
  `aufbewahrung::frist_sperre`, vor „unverändert → 200".
- **Nicht „vereinfachen":** die Frist-PUT-Antwort lässt an gesperrten Einsätzen Einsatzort,
  Koordinate, meldende Stelle und Sachverhalt weg; `soft_delete_einsatz` prüft die Fälligkeit im
  UPDATE erneut; `frist_setzen` schreibt nur an nicht vorgemerkten, nicht geschwärzten Einsätzen.
- Purge-Audit ist fail-closed (Akteurskette abschließende Person → Einsatzleitung → System-Admin
  der Einsatz-Org; ohne Akteur liefert `system_audit_tx` einen Fehler → Rollback, sichtbar nur
  per `tracing::error!`).
- **Scrub-Werte in System-ETB-Texten** stehen in `AUSNAHMEN_SYSTEM_ETB`
  (`tests/aufbewahrung_e2e.rs`) — kein Test bemerkt einen fehlenden Eintrag.

## Backend — ClamAV-Upload-Scan (Default-AN, LFH-114/LFH-224)

Scan in `src/anhang/mod.rs` hinter Feature `clamav` (Default an). Keine `--clamav-addr` → No-op;
clamd erreichbar → Scan (Fund 422); clamd weg → **503 fail-closed** (oder `--clamav-fail-open`).
Wer `src/anhang/mod.rs`/`clamd_scan` anfasst, fährt auch `cargo test --no-default-features`.
`tests/karte_hintergrundbild_scan.rs` prüft 503 gegen `127.0.0.1:1`. `clamd_verbinden` hat zwei
cfg-Varianten (`unix:` nur unter `#[cfg(unix)]`; Windows → `ScannerNichtErreichbar`).

## Sitzung über mehrere Tabs (LFH-387)

Herleitung: `openspec/changes/archive/2026-09-29-lfh-387-auth-zustand-tabuebergreifend/design.md`. Das Cookie gilt
originweit, der Benutzer steht pro Tab — **der Server ist die Wahrheit, der Kanal nur Komfort.**
- Jede schreibende Anfrage trägt `X-Erwarteter-Benutzer-Id` (`apiSend`/`apiUpload`,
  `setzeErwartetenBenutzer` synchron mit `benutzer` im `AuthProvider`); `CurrentUser` lehnt eine
  abweichende Kennung mit **412** ab (`SitzungsBenutzerMismatch`), erst nach der Sitzung (tot =
  401). Kein anderer Schreibweg (`api/schreibwege.guard.test.ts`). Nachweis
  `tests/sitzung_benutzerwechsel.rs`, `e2e/sitzung-mehrere-tabs.spec.ts`.
- `POST /api/auth/logout` mit fremder Kennung → 412, Sitzung bleibt; `logout()` liefert dann
  `false` und meldet nicht ab. Die Sitzungswache meldet nach 401 **nur lokal** ab
  (`abmeldenLokal`) — ein Server-Logout träfe eine inzwischen neue Sitzung.
- Jede 412 stößt `lfh:benutzer-pruefen` an, der Provider prüft per `/me` (auch auf Kanalmeldung
  `auth/authKanal.ts` und Sichtbarkeit; Generationszähler verwirft veraltete Antworten); fremder
  Benutzer → `BenutzerKonfliktDialog` (eine Aktion, nicht schließbar). Ein Kanalobjekt je Tab
  (kein Selbst-Echo). **Der Konflikt wird per Neuladen gelöst, nie im laufenden Baum** — sonst
  speicherte eine noch montierte Seite von A ihren Entwurf mit der Kennung von B. Offline-Abgleich
  ruht im Konflikt (`abgleichFuer`).

## Backend — Statuscode-Konvention (LFH-267/F22)

Verbindlich nach `src/error.rs`, in jeder Schicht, für Neues und Angefasstes:
**400** `Validation` — das Feld für sich (kaputtes JSON, falscher Typ, **unbekannter Enum-Wert**,
fehlendes oder **leeres** Pflichtfeld) · **422** `UnprocessableEntity` — der Zusammenhang
(Feld-Kombination, **Status-Übergang**, Zustand) · **409** `Conflict` — Nebenläufigkeit (CAS) oder
Lebenszyklus (storniert).
- Referenzpaare: `tests/freies_zeichen.rs`, `tests/einsatz_schaden.rs`;
  `abschliessen_ohne_grund_ist_400` gegen `abschluss_ohne_grund_ist_422_und_mit_grund_ok` nicht
  „harmonisieren".
- **409 hat zwei Quellen:** CAS (`basis_geaendert_at` in `schaden/repo.rs`, `tier/repo.rs`;
  Überschreiben-Dialog) und Lebenszyklus (kein Dialog). Das Frontend trennt nur heuristisch
  (`istKonflikt` in `frontend/src/api/client.ts`, `!v.overwrite`-Zweig in
  `SchaedenDetailPage.tsx`/`TiereDetailPage.tsx`) — ein neuer 409 in einer
  CAS-Route zieht den Zweig mit.
- **CAS-Baseline beim Öffnen einfrieren** (`components/useEditSitzung.ts`, gebrandete
  `CasBasis`; `starte` nimmt den Datensatz). Test braucht ein gemountetes `<Form form={form}>`.
- Legitimes 422 bei Sweeps nicht mitkippen (`lage_zone.rs`, `gefahr.rs`, `einsatzabschnitt.rs`,
  `sprechgruppe/repo.rs`, `auth.rs` „Code ungültig", `einsatz_uhs.rs`).
- Handler-Prechecks vor der DB bleiben (`einsatz_schaden.rs`/PATCH, `einsatz_tier.rs`/Status) —
  nur die 400-Erwartung belegt sie. Sicherheitsnetz
  `AppError::status()`: UNIQUE/FK → 409, CHECK → 422.
- **Extractor-Vertrag:** Bodies nur über `crate::extract::JsonBody`, Route-IDs nur über
  `crate::extract::PfadParam` (`tests/json_extractor_guard.rs`, `tests/path_extractor_guard.rs`,
  `tests/fehler_vertrag.rs`), damit Rejections im `{error}`-Format ankommen. `PfadParam` → 400,
  `EinsatzKontext` → 404 (`src/einsatz/kontext.rs`); beide sind orthogonal.
