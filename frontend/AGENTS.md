# Frontend — Regeln

Gilt für alles unter `frontend/`, zusätzlich zur `AGENTS.md` der Wurzel. Pfade ohne
Präfix sind relativ zu `frontend/src/`. Fachblöcke mit eigenem Ort stehen in der Regelkarte
der Wurzel-`AGENTS.md`.

## Frontend — Gestaltungssprache Neuentwurf „Instrumententafel“ (22.09.2026)

Fortschreibung von LFH-352 (dunkel, Radius 0, Archivo/JetBrains Mono, Bedienfarbe blau).
**Maßgeblich:** `docs/design/2026-09-21-neuentwurf/umsetzung.md` (Entscheidungen, Palette);
Entwürfe daneben (`neuentwurf.dc.html`, `shell.dc.html`, Inline-Styles maßgeblich;
`_ds/…/tokens/*.css` ist alt). Bei Konflikten gewinnt das Design — **außer bei der Sichtung**
(BBK). Umgekehrte Altregeln tragen „Neuentwurf 22.09.2026".

- **Größere UI-Entwürfe über das Design System** (Ruben, 08.10.2026, geändert 19.10.2026,
  LLH-1333): Bei etwas wirklich Größerem (neue Seite, neues Modul, Umbau des Rahmens, neuer
  Baustein; nicht bei einem Feld oder Knopf) entwirft der Agent selbst mit `/design` bzw. dem
  Artifact-Typ „Design“ auf Grundlage des Design Systems **„Lifeline Hub“** (Adresse in
  `docs/design/design-system/ARTIFACT.md`), auch in einer Cloud-Sitzung: kein Angebot, kein
  Prompt für Ruben, kein Entwurfsabschnitt im Ticket. Das Ergebnis landet wie der Neuentwurf unter
  `docs/design/<datum>-<thema>/` (Inline-Styles maßgeblich).
  - **Das Design System ist aus dem Code erzeugt** (`docs/design/design-system/project/`,
    Generator `frontend/scripts/design-system/`, Wächter `designSystem.guard.test.ts`, Change
    `uzfj5f43-design-system-aus-code`); von Hand gepflegt wird es nicht, Änderungen auf der Seite
    überschreibt die nächste Veröffentlichung. Ändert ein PR das Theme (`theme/tokens.ts`,
    `theme/schriften.ts`, `theme/statusFarben.ts`, `theme/rollen.css`, `theme/sprache.css`,
    `index.css`), `components/instrument/statusFlaeche.ts`, einen vorgestellten Baustein, einen
    Regelabschnitt, den die README trägt, oder `theme/gesperrtZeichen.guard.test.ts` (README
    „Gesperrt“), oder hebt er antd oder eine Schrift, läuft
    `mise exec -- pnpm -C frontend design-system`, und das Erzeugte kommt mit in den PR. Ein roter
    Wächter heißt dasselbe.
  - **Nach dem Merge veröffentlicht der Agent, der den PR abschließt, neu**: aus dem Stand von
    `alpha` auf die Adresse in `ARTIFACT.md`, nur die geänderten Dateien unter `project/`. Den
    Index `design-system.json` gibt es nur im Artifact: zuletzt und einzeln senden, unmittelbar
    vorher lesen, alle Schlüssel und `createdOnFiles` behalten, nur `lastChange` setzen (`via`
    „Claude Code aus lifeline-hub <Commit>“). Ohne claude.ai-Anmeldung vermerkt er das als
    Kommentar an der Aufgabe.

- **Nachtbetrieb ist Vorgabe:** `MODUS_DEFAULT = 'dark'` in `theme/ThemeModeProvider.tsx`,
  **gespiegelt im Bootstrap-Skript von `index.html`** — immer beide ändern. Hellpalette aus der
  Nachtpalette abgeleitet.
- **Rollen** in `theme/tokens.ts` + `theme/rollen.css` (Gate 5), u. a. `kopf`, `paneel`,
  `flaeche3`, `text2`, `steuerRahmen` (= antds `colorBorder`), `bedienText`, Statusflächen,
  `bannerGrund`/`bannerLinie`, Zeilentönungen. `rahmenFarben` ist modusunabhängig und keine
  `Farbrolle` (`rollen.guard.test.ts`). Eigene Paletten statt `Statusrolle`:
  `etbTypFarben{Dunkel,Hell}` (`etbTypFarbe()`), `warnstufeFarben{Dunkel,Hell}`
  (`warnstufeBalkenFarbe()`), `fachebeneFarben{Dunkel,Hell}` (`fachebeneFarbe()`, LFH-593:
  Ebenen-Identität, keine Vertragskarte; `FachebeneDef` trägt keine Farbe).
- **`schriftskala`** (CSS `--lfh-typo-*`, deckungsgleich per `rollen.guard.test.ts`). Zahlen,
  Zeiten, Funkrufnamen, Koordinaten, Nummern immer Mono mit `tabular-nums`. Die Dichte-Staffel
  30/48/72 gilt, nicht die Entwurfsskizze.
- **Bausteine** in `components/instrument/` (Import über `index.ts`, Dateikopf nennt die Regel):
  `Augenbraue` (`als="h2…h6"`) · `Paneel`/`PaneelZeile` · `Formularpaneel` (Hülle im selben `<Form>`) ·
  `PaneelZustand` · `Kennzahl`/`Kennzahlenband` („Zahl führt") · `Aufgliederung`/`Balken` (nie
  Ersatz der Zahl) · `Zeitachseneintrag` · `StatusZelle`/`StatusChip` (`wort` Pflicht, Übersetzung
  nur in `statusFlaeche.ts`) · `Segmentleiste` (statt antds `Segmented`; `SegmentUmschalter` als ein
  Umschaltknopf daneben, LLH-1065) · `Sammelbanner` · `Filterhinweis` (Band über einer gefilterten
  Liste, Achtungsrolle, Zahlen nur aus Serverzählungen, LLH-1071) ·
  `Schnellerfassungszeile` · `Datenraster`/`Datenfeld` (statt `Descriptions`) ·
  `DatenfeldEingabe` (Zelle im Bearbeiten-Modus: Etikett benennt die Eingabe, `Form.Item` ohne
  `noStyle`, der Prüffehler steht darunter, LLH-1101; nie `Form.Item noStyle` im `Datenfeld`) ·
  `BearbeitbaresPaneel` (Bearbeiten in der Ansicht, Paneel oder ganze Ansicht, LLH-1139; der
  einzige Baustein dafür, siehe „UI-Form-Leitlinie“) ·
  `FeldFehler` (Fehlerzeile unter einer Eingabe ohne `Form.Item`: `alarmText`, `data-fehler`, Ziel
  von `aria-describedby`; dieselbe Optik wie antds Formularmeldung) · `rollenwerte`/`useRollen` ·
  Dashboard-Baukasten (unten).
- **Seitenkopf** `components/EinsatzSeite.tsx` (`SEITENKOPF_HOEHE` 44 px, wächst mit der
  Staffel): `titel` als `h1` (Paneele ab `h2`), `meta` Mono, `aktionen` rechts (Primär blau
  gefüllt, sekundär umrandet); Meta + Datenstand unter `md` eigene Zeile, Datenstand hält vorab
  seine Breite. `breite` Vorgabe `'voll'`, `'schmal'` nur für reine Formularseiten,
  `flaeche.seiteBreit` fällt beim Umbau.
- **Orientierung** (LFH-954, Spec `seiten-orientierung`): den Tab-Titel setzen nur die Rahmen über
  `components/useDokumentTitel.ts`, aus dem Modulnamen der Registry („Seite · Einsatz ·
  lifeline-hub“); keine Seite setzt `document.title`. Der Einsatzstatus steht nie im h1, sondern
  als `EinsatzstatusMarke` neben dem Titel, nur bei nicht aktivem Einsatz (Rahmenkontext
  `einsatz/EinsatzRahmenKontext.tsx`). Im Ortspfad kürzt unter `md` nur der mittlere Eintrag.
- **Markdown** (`components/Markdown.tsx`, `MarkdownEditor`): Pflicht-Prop `unterEbene` (Ebene der
  nächsten Überschrift darüber, Boden `h6`, kein fester Versatz). Der optionale Bild-Renderer
  `bild` gehört nur der Hilfe (`docs/anwender/AGENTS.md`, „Bilder“).
- **Liste** (`components/Liste.tsx`): Kopf `kopf.unterEbene` (Pflicht im Kopf), Eintragstitel
  (`ListenEintragMeta`) eine Ebene unter dem Kopf, ohne Kopf aus `unterEbene` an der Liste,
  ohne beides keine Überschrift. `unterEbene` nur bei eigenständigen Gegenständen, nie bei
  Auswahl-, Einstellungs- und Stromlisten (LFH-826, Spec `ueberschriften-gliederung`).
- **Bildmarke „Lebenslinie“** (LFH-837): EINE Geometrie in `marke/bildmarkeGeometrie.ts` für
  Markenzelle, Anmeldeseite, Favicon, PWA und Hülle; Symbole nur über
  `scripts/marke/erzeuge-symbole.sh` (Guard `marke/marke.guard.test.ts`: Nenngrößen, Manifest,
  Pfadgleichheit, Stempel `scripts/marke/quellen.sha256`). PWA-Manifest in `marke/pwaManifest.json`, Farben Kopf-Schwarz.
- **Rahmen:** Kopfleiste (`components/Kopfleiste.tsx`, `KOPF_HOEHE`) · Rail
  (`einsatz/IconRail.tsx`, Kurzetikett `kurz`, voller Name als `aria-label`, Einstellungen per
  `fuss: true`) · Modulpanel (`einsatz/ModulPanel.tsx`) · Sprungpalette
  (`command-palette/CommandPalette.tsx`). Maße im Entwurf.
  - **Stehenbleiben, gestuft** (LFH-952, Spec `einsatztauglichkeit-layout`): ab `md` klebt der
    Kopf (`RAHMEN_KLEBT`, `data-lfh="rahmen-kopf"`), ab `lg` die Rail-Kategorien darunter; unter
    `md` rollt der Kopf, und die Betriebszeile klebt nur bei Störung (offline, Live `lost`).
  - **Wer oben klebt, hängt sich unter den Rahmen:** `top: var(--lfh-rahmen-oben)` bzw.
    rc-tables `sticky={{ offsetHeader: useRahmenOben() }}` (`components/rahmenOben.ts`, gemessen,
    nie gerechnet). Ausnahme nur mit Vermerk `rahmen-oben: frei` und Grund (Guard
    `components/rahmenOben.guard.test.ts`). Den Fokusabstand trägt `scroll-padding-block-start`
    am Dokument (`index.css`), ausgesetzt bei Fokus im Rahmen.
  - **Stehende Alarme liegen unter der Bedienkante** (LFH-1112, Spec
    `einsatztauglichkeit-layout`): unter Kommandoleiste und Seitenkopf, solange er im Bild ist,
    gerollt unter dem Rahmen. Gemessen in `components/alarmOben.ts` (`useAlarmKante` an Kopf und
    Seitenkopf), angewandt über antds `--notification-top` in `index.css`; `AntApp` trägt
    deshalb kein `top`. Nachweis `e2e/alarm-verdeckung.spec.ts`.
  - **Modulpanel:** `navPersistenz` ist dreiwertig; ohne Wahl zwischen `lg` und `xl` zu, ab `xl`
    offen. Eine Wahl schreiben nur der Griff „Menü“ und der Selbstklick, nie ein Rail-Sprung.
- **Modulstruktur** (`einsatz/modulRegistry.ts`): Startseite **Führung · Überblick**
  (`redirectZiel()`); Aufträge/Befehle unter Führung; **Meldebild** heißt sichtbar die
  Kräfteübersicht — **Schlüssel und Route bleiben `kraefteuebersicht`**.
- **Ein Name je Modul** (LFH-965, Spec `modul-benennung`): Menü, Sprungpalette, h1, Ortspfad und
  Tab tragen das `label` der Registry, Seiten holen es über `modulName(key)`, nie als Literal.
  `beschreibung` ist die zweite Zeile in Modulmenü und Sprungpalette: wenige Fachwörter, kein
  Satz, keine Bedienung (Guard in `modulRegistry.test.ts`). Ausnahmen nur für Detailseiten,
  Paneel- und Bereichsnamen.
- **Keine erfundenen Daten:** was ohne Datenquelle ist, wird weggelassen (Epic LFH-606…617),
  trägt sein Ticket im Code-Kommentar und wird als **Abwesenheit** getestet. Eingelöst:
  Evakuiert (LFH-607, `openspec/changes/archive/2026-09-29-lfh-607-kennzahl-evakuiert/`), Pegel auf Platz 1
  (LFH-606), Rückmeldung (LFH-610), ETB-Zählung (LFH-612).
- **Kennzahlenband** (LFH-640): immer sechs Plätze (vier Kern, zwei Lage), jede Kennzahl ein
  Heimatplatz; Lageplätze nur per Entscheidung am Einsatz (`EinsatzAnzeige.lagekennzahlen`), nie
  per Messwert — eine Kennzahl ohne Fachentscheidung wird gewählt (Einstellungen › Kennzahlen,
  LLH-1371); Neuzuschnitt während der Betrachtung als Sammelbanner
  (`docs/superpowers/specs/2026-09-23-lfh-640-lagebezogene-kennzahlreihe-design.md`). Die Fuge
  zeichnet die Zelle, nicht der Rastergrund: Grund `flaeche`, Umriss je Zelle über
  `[data-fugenraster]` (`components/instrument/fugenraster.ts`), damit eine leere Restspur keine
  graue Kachel wird (LFH-961); wer den Grund übernimmt, setzt das Attribut mit. Sie bleibt in
  jeder Dichte 1 px; eine klickbare Zelle rückt ihren Link um 0 / 4 / 8 px ein
  (`kennzahlZielEinzug`), damit Ziele ≥ 8 / ≥ 16 px auseinanderstehen (LFH-630,
  `openspec/changes/archive/2026-10-01-lfh-630-kennzahlenband-handschuh-abstand/design.md`).
  Segmentleiste, Kartengrundlage und Kartenknöpfe teilen den Einzug (`zielEinzug`, LFH-865).
  Ein Band, über dessen Notizen sich die Lage ändert, hält ihre Höhe fest: unter `md` als Boden
  (`notizZeilenSchmal`), ab `md` als Boden und Deckel (`notizZeilen`, „Lage in Zahlen“ drei
  Zeilen; Längeres endet mit „…“ und steht ganz im `title`). Die tragende Aussage einer Notiz
  steht deshalb vorn (LFH-691, `openspec/changes/archive/2026-10-01-lfh-691-kennzahl-notiz-feste-hoehe/design.md`).
- **Dashboard-Baukasten** (LLH-1140, Vorbild Lagebild): jede Fläche, die eine Lage in Zahlen
  zeigt (Lagebild, Führung · Überblick, Meldebild-Kopf), baut sich aus denselben Bausteinen in
  `components/instrument/`.
  Kopf: `EinsatzSeite` mit Datenstand und `WarnstufenHinweis` (nur bei Ton achtung/alarm; die
  Warnstufe ist keine Kennzahl). Reihe 1: `Kennzahlenband`, sechs Plätze (Regel oben).
  Reihe 2: eine oder mehrere `PaneelReihe` mit je bis zu drei Paneelen (`1fr 1fr 1.1fr`, unter
  `lg` gestapelt) in der `DashboardFlaeche` (Fugenraster). Ein Kopf über einer Vergleichstabelle
  (Meldebild) ist nur eine Paneelreihe mit `dichte="kompakt"`, ohne Band, ohne Füllkachel; eine
  Einzelzahl darin (Rückmeldung) ist eine `Kennzahl` mit Sprung. Reihe 3, wo es sie gibt: Fußband „Führungsstand“ als
  `Kennzahlenband` mit `groesse="klein"`, Zahlen aus dem Modulzähler. Jedes Paneel geht durch
  `DashboardPaneel` (Augenbraue, Zähler als Meta, Sprung „… ↗“, `PaneelZustand`; `gesperrt` nennt
  den Grund, ohne Sprung und Leeraktion) und ist einer der Typen `VerteilungsPaneel` (Zahl +
  Anteilsbalken je Kategorie: Sichtung, FMS-Status), `MatrixPaneel` (Stufenmatrix: Gefahren),
  `StromPaneel` (Zeitachseneinträge mit Sammelbanner), `ListenPaneel` (kurze Liste mit
  „n weitere ↗“) oder `GliederungsPaneel` (Teile mit Lagekante, Kopf, Zahlspalte). Laden, Fehler,
  Leer und Gesperrt sehen verschieden aus; eine unbekannte Zahl steht als „—“, nie als 0. Balken
  ergänzen die Zahl, nie ersetzen sie; Farben kommen aufgelöst vom Aufrufer, der Baustein trägt
  keine Statuskarte. Ein neuer Paneeltyp kommt als Baustein hierher, nicht lokal in eine Seite.
- **Eine Heimat je Zahl** (LFH-550,
  `openspec/changes/archive/2026-09-30-lfh-550-lagebesprechung-eine-verdichtung/design.md`):
  Aufträge und Meldungen (offen, in Arbeit, überfällig = davon überfällig, Bestätigung überfällig)
  nur aus dem Modulzähler (`pages/lage-dashboard/fuehrungsZahlen.ts`), nie aus einer Liste
  gezählt; Betroffene/SK über `verdichtePersonen` (→ `sichtungsbild`), Kräfte über `verdichte`,
  Warnstufe über `verdichteGefahrengebiete`, Material-Ausfall (Posten mit Statusrolle Alarm oder
  Achtung) über `kraefte/materialVerdichtungKern.ts`. Stärke einer Menge nur über `summiereStaerke`
  (Wurzeln der Menge; ein Abschnitt zählt seine obersten Einheiten wie das Meldebild), Formatierung
  nur `anzeige/staerke.ts:staerkeText`. Belegung eines Bereitstellungsraums (LLH-1095, Spec
  `bereitstellungsraum-belegung`): Fahrzeuge, Einheiten und längste Wartezeit nur aus `belegung`
  des Servers (Liste, Detail und Lagekarte), Stärke im Raum nur über `staerkeImRaum`
  (`bereitstellungsraum/brZahlen.ts`); „noch n belegt“ vor dem Auflösen zählt wie
  `aktive_belegungen_tx` (Einheiten und einheitenlose Fahrzeuge). Lage einer UHS (In der Stelle,
  Plätze frei, Wartend, Unterwegs; LLH-1136, LLH-1332) nur über `pages/uhs/uhsLage.ts`, aus denselben
  Mengen wie der Grundriss. Dashboard und Vorbereitung der Lagebesprechung teilen `useLagebild` +
  `baueLagebild`. Regeln beider Sprachen pinnt `tests/fixtures/verdichtung/regeln.json`
  (`tests/verdichtung_fixture.rs`, `lage/verdichtungFixture.test.ts`).
- **Eine Baumlogik der Kräfte: `kraefte/kraeftebaumKern.ts`** (LLH-1025, Spec `kraeftebaum`).
  Einheit → Untereinheiten, je Einheit Fahrzeuge mit Besatzung, „Ohne Fahrzeug“, Material; jede
  Kraft genau einmal, Elternstärke über `accumulateStaerke`. Meldebild (`meldebildRaster.ts`) und
  Lagebericht-Text (`kraeftebild.ts`) bilden den Kern nur ab; ein neuer Abnehmer baut keinen
  eigenen Baum.

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
- **Liste + Detailpaneel** (`components/ListeDetail.tsx`, Spec `liste-detail`, Herleitung
  `openspec/changes/archive/2026-10-12-oxgob5gk-auftraege-befehle-angleichen/design.md`): wenn
  Objekte je Stück gelesen und kurz behandelt werden (quittieren, freigeben) und man oft zwischen ihnen wechselt.
  Ab `lg` Liste links, Detail rechts (klebt), darunter klappt es unter der gewählten Karte auf; kein
  Drawer. Die Karte trägt nur das Auswahlziel (`AuswahlZiel`) und Kennungs-Links, Handlungen stehen
  im Detail; gewählt ist `auswahlFlaeche` ohne Linie (`KommKarte` `gewaehlt`). Ein Dokument wird
  weiter auf der Vollseite geschrieben. Vorbild Aufträge/Befehle; Einsatzabschnitte und Gefahren
  sind ältere Einzelbauten.

**Bearbeiten in der Ansicht** (LLH-1139, Spec `formularseiten`, „Eine offene Bearbeitung je
Ansicht“; schreibt LFH-19 und LFH-979 fort)

1. **Ein bestehender Datensatz wird in seiner Ansicht bearbeitet**, nie in einem Formular, das die
   Ansicht ersetzt oder verdeckt. Modal und Drawer bleiben fürs **Anlegen** (Erfassungs-Norm,
   Feldbudget) und für kurze blockierende Aktionen.
2. **Drei Stufen nach Umfang:** **Einzelwert** (Status, Lagezustand, Führer, Frist) über
   `InlineAngabe`/`BemerkungZelle` am Wert, speichert sofort genau dieses Feld · **Paneel**
   (zusammengehörige Werte, „Funk“, „Personendaten“) über `components/instrument/BearbeitbaresPaneel`
   Modus `paneel`: „Bearbeiten“ im Paneelkopf schaltet nur dieses Paneel auf Eingaben, Speichern
   und Abbrechen im Paneelfuß · **ganze Ansicht** nur, wo Felder fachlich zusammen geprüft werden
   (Befehlsschema, Tier/Schaden), Modus `ansicht` mit Speichern-Leiste. Eine Karte, die selbst die
   Ansicht eines Datensatzes ist, nimmt ebenfalls `ansicht` (Vorbild Verpflegung,
   `verpflegung/ZeitfensterBearbeiten.tsx`).
3. **Höchstens eine offene Bearbeitung je Seite** (ein Paneel oder die ganze Ansicht; ein
   Einzelfeld zählt mit, sobald es einen Entwurf hat): jedes weitere „Bearbeiten“ ist gesperrt mit
   „Erst „Titel“ speichern oder abbrechen“, sichtbar am Element. Getragen vom Merker
   `components/offeneBearbeitung.tsx` (ein Paneel belegt die Seite beim Öffnen, die Rückfrage vor
   dem Verlassen kommt erst mit einer Änderung); ohne Merker der Seite legt der Baustein seinen
   eigenen an. Jede offene Bearbeitung trägt CAS über `useEditSitzung`.
4. **Nur geänderte Felder senden** (PATCH), nie das ganze Formular; ohne Änderung kein Aufruf.
   Konflikt über `geaendert_at`: ein 409 fragt „Zwischenzeitlich geändert“ mit „Meine Änderung
   übernehmen“ / „Verwerfen und neu laden“.
5. **Prüffehler sichtbar** unter der Zelle (`DatenfeldEingabe`), eine Ablehnung als
   `SpeicherFehler` am Paneel. Enter speichert, Escape bricht ab; Fokus beim Öffnen ins erste Feld,
   beim Schließen zurück auf „Bearbeiten“.
6. **Jede bearbeitbare Detailansicht hat eine Item-Route** („Deeplink-Muster“).
7. **Nach dem Anlegen springt die Seite in die neue Ansicht** (Vorbild Befehl), nicht zurück in
   die Liste mit erneutem Öffnen.

Kein Fach-Modul baut einen zweiten Baustein dafür; die Seiten stellen ihre Fach-Tickets um
(Einsatzabschnitte, Einheit, Personal, Personendaten, Tier/Schaden, Lageberichte,
Bereitstellungsraum, Betreuung).

**Die Liste ist die zweite Frage** (LFH-330): „welcher von diesen?" → Tabelle
(`components/KatalogTabelle.tsx`, `components/Datensicht.tsx` `form="tabelle"`); „was ist mit diesem?" →
Liste/Karte (`components/Liste.tsx`, `Datensicht` `form="karte"`); Kachel nur für Überblick.
Karten-Fallback unter `md` (`form="auto"`) ist begründungspflichtig (Dateikopf `Datensicht.tsx`,
AK3b im Drawer-Spec); keine Katalogtabelle wird zu Karten.

- **Kein Nutzerschalter Tabelle ↔ Karte** (LFH-507, `openspec/changes/archive/2026-09-30-lfh-507-palette-status-setzen/`):
  die Form bleibt die begründete Entscheidung je Seite, auch in der Palette („Ansicht wechseln“
  gibt es nicht). Wer einen Schalter will, schreibt zuerst diese Regel fort. Keine Ausnahme
  davon ist ein **Überblick nach einer Achse** wie das Sichtungsboard der Betroffenen (LLH-1332,
  `personen/Sichtungsboard.tsx`): es ordnet dieselbe Menge in Spalten je Kategorie, statt dieselbe
  Liste als Tabelle oder Karten zu zeigen.
- **FMS-Tableau** (LFH-642, `kraefte/FmsTableau.tsx`): Ansicht `?ansicht=tableau` der
  Fahrzeugseite, kein Modul; je Kachel genau ein Bedienziel (`StatusWahl`), Kachel selbst nicht
  klickbar; Sortierung Abschnitt → Einheit → Funkrufname, nie Status; der Abschnitt ist der
  eigene der Einheit, sonst der geerbte (`abschnittDerEinheit`, dieselbe Lesart wie die
  Abschnitt-Spalte der Liste, LLH-1073); `fms_anker` 0–9 nur Beschleuniger (Doppelbelegung setzt
  nichts) (`docs/superpowers/specs/2026-09-23-lfh-642-pruefliste.md`).
- **Organigramm der Führungsorganisation** (LFH-626, `pages/einsatzabschnitte/Organigramm.tsx`,
  `openspec/changes/archive/2026-10-01-lfh-626-fuehrungsorganisation-skizze/design.md`): Ansicht
  `?ansicht=organigramm` der Seite Einsatzabschnitte, kein Modul; rein abgeleitet über
  `baueFuehrungsorganisation` (Platzierung und Schlüssel wie der Funkplan; Vorlage für Auto-Layout
  und Fokusfolge der Fernmeldeskizze LFH-893); Stärke je Abschnitt nur über `abschnittStaerken`, die Wurzel
  „Einsatzleitung“ trägt keine Zahl, ihren Einsatzleiter nur über `stab/einsatzleiter.ts`
  (LFH-1199); Stab nur mit Stab-Freigabe. Layout und Druckregeln nur über
  das Gerüst `components/organigramm/HaengenderBaum` (erste Ebene als Spalten-Grid,
  `SPALTE_MIN_PX` gemessen, tiefer senkrecht) — keine
  Graph-Bibliothek, kein zweites Gerüst. **Live-Zufluss nur über die Schleuse des Gerüsts**
  (LFH-867, `components/organigramm/baumSchleuse.ts`,
  `openspec/changes/archive/2026-10-04-lfh-867-organigramm-zufluss-schleuse/design.md`): Zeiger
  (ohne Touch) oder Fokus im Baum halten Menge, Ort und Folge der Knoten, Inhalt fließt;
  Entfallenes bleibt als Platzhalter ohne Link, der Kopf steht still; Banner in der Standzeile
  fester Höhe; im Druck gilt sie nicht. Kein Nutzer baut eine eigene.
- `Datensicht` bricht fest bei `md`; die Prop `tabelleAb` hält `datensicht.guard.test.ts` fern.
- **Zufluss der `Datensicht`** (LFH-1020, Spec `datensicht-zufluss`): Fokus ODER Maus-/Stiftzeiger
  (nicht Touch) in der Sicht hält Menge und Folge der Zeilen, im Baum auf jeder Ebene über
  `organigramm/baumSchleuse.ts` (keine zweite Baumlogik); Inhalt fließt, Entfallenes fällt sofort
  weg, der Sammelbanner nennt Neues, Umgehängtes und Umsortiertes. `zufluss="sofort"` nur für
  Flächen ohne Bedienziel in den Zeilen. Ein offenes Popover, Menü oder Dialog einer Zeile hält
  wie Fokus, auch ohne ihn (Touch): die Seite meldet es über `halten`
  (`components/useHalteQuellen.ts`), `MenueAusloeser` über `onOffenAenderung`; Menüs des
  Kartenfußs hält die Sicht selbst (LLH-1130).
- **Eine geblätterte Liste nimmt den Servermodus der `Datensicht`** (LFH-1075, Prop
  `serverseitig`): Suche (entprellt) und Spaltenfilter gehen an den Server, die Sortierung
  kontrolliert; die Sicht filtert und sortiert nicht noch einmal (auch nicht über den Kopffilter,
  LLH-1086; seine Zahlen reicht die Seite über `serverseitig.zahlen`). `stand` ist die Abfrage der
  gezeigten Zeilen, ihr Wechsel kein Zufluss. Nachladen per „Ältere laden“ unter der Sicht,
  Zahlen aus `…/kennzahlen` (Vorbild `pages/SchaedenPage.tsx`).
  `naechste_lagebesprechung_at` = absolute Wiedervorlage-Schnellwahl, kein berechneter Rhythmus
  (`docs/superpowers/specs/2026-09-08-lfh-463-464-pruefliste.md`); geschrieben nur im Modul
  Lagebesprechung (`frontend/src/lagebesprechung/AGENTS.md`).
- **Fließende Spalte** (LFH-523): trägt genau EINE Spalte `mindestBreite` und alle übrigen eine
  Zahlbreite, setzt `KatalogTabelle` `scroll.x = Σ(width) + mindestBreite` und **nur dann**
  `tableLayout="auto"` (sonst kippt `@rc-component/table` still auf `fixed`); sonst
  Bestandsverhalten plus DEV-Warnung. Zahl gegen die schmalste Fläche wählen (Träger
  `personen/personenSpalten.tsx`). `document.body.scrollWidth` sieht Tabellenüberlauf nicht
  (`docs/superpowers/specs/2026-09-11-lfh-523-etb-langtext-umbruch.md`).

**ETB** (Zeitachse, Erfassung, Zähler, Entwürfe): `frontend/src/etb/AGENTS.md` — gilt auch für
`pages/EtbPage.tsx`, `pages/EtbDruckPage.tsx` und `pages/LagemeldungenPage.tsx`.
**ETB-, Schaden-, Tier-, UHS- und Personen-Anhänge** stehen beim Server: `src/AGENTS.md`; die
Erfassungsmodule teilen den Block `components/erfassungsAnhaenge/ErfassungsAnhaenge`.

**Farbachsen** (Vertrag `theme/statusFarben.ts`)

- **Betroffene** (LFH-455, `StatusTag`, Rand-Form über `darstellungsart="rand"`): Personenstatus neutral, „vermisst" `achtung`; Schaden
  „offen" `achtung`, „übergeben" `bedien`, „abgeschlossen" neutral; Ausmaß „gering" neutral,
  „mittel"/„groß" `achtung`, „katastrophal" `alarm`.
- **Lagezustand** (LFH-608, `abschnittLagezustand`): planmäßig `normal`, angespannt `achtung`,
  kritisch `alarm`; nicht beurteilt = leeres Feld. Nur der Wechsel schreibt System-ETB. Im
  Abschnittsdetail eine `Segmentleiste` mit vier Stufen, jede Wahl speichert sofort, auch per
  Pfeiltaste (LFH-1208). Überblick meldet schlechtere Unterabschnitte („UA kritisch"). Ein
  Fortschritt hat keine Oberfläche (LFH-1208): die Spalte trägt nur Altdaten, die Lage trägt der
  Lagezustand, den Arbeitsstand die offenen Aufträge.
- **Gefahrenmatrix** (LLH-1090, Spec `gefahrenmatrix`): eine Zelle ohne Bewertung zeigt die
  Vorgabe „keine“ („–“), kein Zähler unbewerteter Felder; „nicht beurteilt“ steht am Gebiet
  (`beurteilt_at/von`, Knopf „Beurteilung bestätigen“ nur mit Schreibrecht, System-ETB) und
  fortgeschrieben die Entscheidung LFH-969, dass Offenes nicht wie Entwarnung aussieht. Ein
  ungültiges Paar ist schraffiert (`schraffurStil`, `steuerRahmen`, ≥ 3 : 1), ohne Text.
  Verdichtet (LLH-1102): die ganze Zelle ist das Ziel (Polsterung 0, Knopf 100 %, Zeile =
  `controlHeight`, Ring nach innen). Wer Gefahrentypen listet, ordnet sie über
  `sortGefahrenAlphabetisch` bzw. `GEFAHRENTYPEN_ALPHABETISCH` (`gefahrenSchema.ts`), nie in
  der Katalogfolge `GEFAHRENTYPEN`. Erläuterungen (LLH-1110): eine Zelle mit Text trägt die
  Marke (Dreieck oben rechts, `currentColor`, Name „· mit Erläuterung“), unter der Matrix
  steht die Liste „Erläuterungen“. Die Marke kommt nur aus `pages/gefahren/ErlaeuterungsMarke.tsx`
  (auch im Lagebild-Paneel und im Palettenauszug, LLH-1365), der Namenszusatz aus
  `MIT_ERLAEUTERUNG`. Welche Zellen etwas sagen und in welcher Folge, entscheidet nur
  `pages/gefahren/erlaeuterungen.ts` (`zellenMitErlaeuterung`, `gesetzteGefahren`) — für
  Matrix, Lagebild, Palettenauszug, Lagekarte und Lagevortrag.
- **Sichtung ist eine eigene Achse nach BBK** und die Ausnahme vom Neuentwurf:
  SK I rot, II gelb, III grün, IV blau, Tote schwarz, „unverletzt" ohne Farbe. **Angezeigt** wird
  als umrandetes Farbfeld (`SichtungsTag`/`sichtungsfarben`); die Umrandung macht Gelb auf hellem
  und Schwarz auf dunklem Grund sichtbar. **Gewählt** wird als Vollfläche über
  `personen/SichtungsWahl.tsx` aus der Flächenpalette `sichtungsflaechen` (bis zum Textboden
  abgedunkelt, in beiden Modi gleich) mit Kante in `text` (`sichtungsKante`), gewählt mit ✓ und
  3-px-Rahmen, die übrigen in Randform; 72 × 96 px in jeder Stufe, kein Dropdown für die Sichtung
  (LLH-1083, Spec `sichtungswahl`, `theme/sichtungKontrast.test.ts`). **Kein `color` an antds `Tag`** außer `"default"` (LFH-891/LFH-1022,
  Spec `farbrollen-kontrast`, Guard 3 in `theme/statusVertrag.guard.test.ts`): kein Preset hält
  den Textboden. Ein Status steht in `StatusTag` mit einer Rolle aus dem Vertrag; eine
  Kennzeichnung ohne Status (ad-hoc, Rolle, Kennung, Kategorie, Bezug) ist neutral wie die
  Demo-Marke, Blau bedient.
  Übergabe, Geschädigt-Bezug, UHS-Verortung tragen `bedien`. Personenstatus und Sichtung sind
  unabhängig.
- **Blauer Bedien-TEXT nimmt `rollen.bedienText`**; antds `colorLink` (Ruhe, Zeiger, gedrückt)
  **ist** `bedienText`, ein Link braucht kein eigenes `style`, Zeiger-Rückmeldung ist die
  Unterstreichung. Radio-Text im Stil `outline` über `index.css` (`--lfh-bedien-text`), kein
  `Radio.colorPrimary` (`docs/superpowers/specs/2026-09-22-lfh-613-pruefliste.md`).
- **Geerbter Text auf Textrollen** (LFH-652, Spec `textkontrast-rollen`): Beschreibung
  (`colorTextDescription`) und Kopf der `KatalogTabelle` lesen `gedaempft`, nie `schwach`;
  Formularmeldung über `Form`-Token in `alarmText`/`achtungText`, das globale `colorError` bleibt
  Füllfarbe; Standardknopf unter dem Zeiger in `bedienText`. Alles in `tokens.ts:antdToken`/
  `antdKomponenten`, nicht je Stelle.
- **Roter Fehlertext außerhalb von Formularen** (LFH-874, Spec `textkontrast-rollen`):
  `Typography` `danger` („nicht gefunden“, „Überfällig“, Ablehnungsgrund) liest `alarmText`, ein
  Link `danger` unter dem Zeiger `alarmHover`, über das GLOBALE `colorErrorText*` in `antdToken`
  (antd liest es nur als Schrift); das globale `colorError` bleibt Füllfarbe für Knopf, Rand und
  Kartenkante. Gemessen in `e2e/fehlertext-kontrast.spec.ts`.
- Kontrast: `e2e/betroffene-kontrast.spec.ts` (Tag ≥ 7:1, Nacht ≥ 5:1, Alpha mitgerechnet).
- **Kein eigener Knopfboden** (LFH-661, Spec `farbrollen-kontrast`): die Beschriftung des
  Primärknopfs hält den Textboden in Ruhe, unter dem Zeiger und gedrückt; Werte und Messung am
  Wert in `theme/tokens.ts`. Ein Kontrast-Spec führt den Primärknopf nie unter einer Ausnahme.
- **Gedrückt trägt den Zeigerton** (LFH-897,
  `openspec/changes/archive/2026-10-04-lfh-897-gedrueckt-textboden/design.md`): Primärknopf
  `bedienHover`, Gefahrknopf ohne Rahmen auf `alarmFlaeche`, über die `Button`-Token
  `colorPrimaryActive`/`colorErrorBgActive` in `antdKomponenten`, nie antds Ableitung (nachts
  dunkler als die Ruhe). Gemessen mit `gedrueckt` aus `e2e/kontrast-kern.ts`.
- **Gefahrrot ebenso** (LFH-693, Spec `farbrollen-kontrast`,
  `openspec/changes/archive/2026-10-01-lfh-693-gefahrtext-alarmtext/design.md`): roter
  Menüeintrag und Gefahrknopf lesen `alarmText`, unter dem Zeiger und gedrückt `alarmHover` (am
  Tag dunkler, nicht heller), über die `Dropdown`-/`Button`-Token in `antdKomponenten`, nie je
  Menü oder Knopf. Gemessen in `e2e/gefahr-kontrast.spec.ts`; kein Kontrast-Spec führt Rot unter
  einer Ausnahme.
- **Hinweisflächen sind Statusflächen** (LFH-739, Spec `farbrollen-kontrast`,
  `openspec/changes/archive/2026-10-02-lfh-739-hinweisflaeche-statusrollen/design.md`): `Alert`
  Info/Warnung/Fehler/Erfolg lesen `bedienFlaeche`/`achtungFlaeche`/`alarmFlaeche`/
  `normalFlaeche` über das `Alert`-Token in `antdKomponenten`, nie je Hinweis; antds Ableitung aus
  den Signalfarben ist am Tag trüb. Ein Knopf darauf behält `steuerRahmen` (≥ 3 : 1,
  `theme/hinweisKontrast.test.ts`, `e2e/hinweis-kontrast.spec.ts`). Der Override färbt nur die
  Fläche des Hinweises, antd-Bausteine darin sehen weiter die globalen Tokens.
- **Die Auswahlfläche ist eine eigene Rolle** (LFH-984, Spec `farbrollen-kontrast`,
  `openspec/changes/archive/2026-10-05-lfh-984-auswahlflaeche-rolle/design.md`): gewählte
  Option, gewählter Menüeintrag und Knoten tragen `auswahlFlaeche`, GLOBAL über
  `colorPrimaryBg`/`colorPrimaryBgHover` in `antdToken` (daraus `controlItemBgActive`), nie je
  Stelle; eigene Stellen lesen das Token. Unter dem Zeiger keine eigene Stufe. Der gewählte
  Dropdown-Eintrag schreibt in `bedienText` (`Dropdown.colorPrimary`). Nachweis
  `theme/auswahlKontrast.test.ts` (auch ΔE ≥ 7 gegen Ruhe und Zeigerspur),
  `e2e/auswahl-kontrast.spec.ts`.
- **Deeplink-Hervorhebung** (LFH-698, Spec `deeplink-hervorhebung`; `.zeile-hervorgehoben` an
  Datensicht und Zeitachse): `bedienFlaeche` plus Ober- und Unterlinie in `bedien` (`box-shadow`,
  `index.css`); ein `Zeitachseneintrag` setzt die Fläche inline mit, ebenso die
  Kommunikationskarte (`kommunikation/KommKarte.tsx`, LFH-896: Linien inline, nie ein Ring; eine
  Alarmkarte behält ihre Fläche, `kartenGrund`). Nie `flaeche3` (das ist der
  Hover; die Tagmodus-Regel unten meint Hover und aktive Segmente) und nie eine Statusfläche;
  Nachweis `e2e/deeplink-hervorhebung-kontrast.spec.ts`. **Farbliterale
  in CSS nur in `theme/rollen.css`** (Spec `css-farbquelle`, `theme/cssFarbquelle.guard.test.ts`,
  Schuldmenge `OFFEN` schrumpft nur).
- **Tagmodus** (LFH-618, `docs/superpowers/specs/2026-09-22-lfh-618-hellmodus-pruefliste.md`):
  `achtung`/`alarm` als Text über `achtungText`/`alarmText`; Hervorhebung auf `flaeche3`, nicht
  `flaeche2`; Kontrast gegen den tatsächlichen Grund (`e2e/hellmodus-kontrast.spec.ts`,
  `e2e/kontrast-kern.ts`). **Text auf der Hervorhebung hält den vollen Boden** (LFH-702/LFH-877,
  Spec `textkontrast-rollen`): Hover- und Aktivzeile sind Grund wie jede Fläche; deshalb ist
  `bedienText` am Tag so dunkel, dass er auf `flaeche3` ≥ 7 hält — die Fläche wird nicht
  aufgehellt, die Rolle nicht lokal überschrieben
  (`openspec/changes/archive/2026-10-01-lfh-702-hervorhebung-textboden/design.md`).
- **Textboden für jede Textstufe** (LFH-643, Spec `textstufen-kontrast`,
  `openspec/changes/archive/2026-10-01-lfh-643-tertiaertext-tagesboden/design.md`): `text`,
  `text2`, `gedaempft` und auch Tertiärtext `schwach` (Augenbraue, Meta, Platzhalter)
  halten auf jeder deckenden Fläche Tag ≥ 7 : 1, Nacht ≥ 5 : 1; benachbarte Stufen
  liegen ≥ 5 ΔL\* auseinander (`theme/textstufen.test.ts`). Eine Textstufe unterschreitet
  den Boden nur für Gesperrtes (≥ 4,5, Sperre auch ohne Farbe); Kontrast-Gates führen keine
  Tertiär-Ausnahme.
- **Gesperrte Steuerelemente** (LLH-1228): antds `colorTextDisabled` trägt die Rolle `gesperrt`
  (keine Textstufe, nur für Gesperrtes) und hält ≥ 4,5 auf antds durchscheinender Sperrfläche
  über jeder deckenden Fläche, nicht nur auf dem Grund daneben (`theme/gesperrtKontrast.test.ts`,
  `e2e/gesperrt-kontrast.spec.ts`). Nachts liegt sie heller als `schwach`: die Sperrfläche hellt
  den Grund auf.
- **Gesperrt trägt die Sperre ohne Farbe** (LLH-1233): gesperrte antd-Knöpfe und -Felder haben
  einen gestrichelten Rand in `steuer-rahmen`, randlose Einträge (Menü, Auswahlliste, antds
  `Segmented`) eine Strichlinie nach innen (`index.css`). Gestrichelt heißt nur gesperrt: die
  Knopfvariante `dashed` ist gesperrt (`theme/gesperrtZeichen.guard.test.ts`).

**Lagekarte** (auch `pages/LagekartePage.tsx`): `frontend/src/pages/lagekarte/AGENTS.md`.

**Sprungmarken sind keine Module** (LFH-620, `einsatz/sprungmarken.ts`): Entscheidungen = ETB
`?typ=entscheidung`, Patienten = Personen im Sichtungsboard (`ansicht=raster`), Vermisste = Personen
`?filter=vermisst`. Kein Registry-Eintrag, kein `verweistAuf`; Marke erbt Sichtbarkeit/Sperre,
nie `aria-current`, Ziel im zugänglichen Namen, Pfad aus `routing/deeplinks.ts`;
`parsePersonenSicht`/`sichtNachSprung` apply-then-clean. Kein Filterwert „patienten".
Die Arbeitsseiten des Stabs (LLH-1127) sind Marken hinter „Stab“ (Ziel `stab`, nach Sachgebiet;
Name und Pfad aus `stab/unterseiten.ts`); Fernmeldeskizze und Kommunikationsplan sind Marken
hinter „Fernmeldewesen“ (Ziel `fernmeldewesen`, LLH-1180), eine Marke „Funkplan“ gibt es nicht. Gesperrt
heißt mit Schloss, nicht weg. Jede Marke steht auch in der Sprungpalette (Gruppe „Ansichten“,
`frontend/src/command-palette/AGENTS.md`) und trägt dafür `schlagworte`.

**Stab und Fernmeldewesen** (Fernmeldewesen mit Funkplan, Skizze und Kommunikationsplan,
Checkliste Arbeitsaufnahme, Presse und Medienarbeit S5; auch `pages/StabPage.tsx`,
`pages/FunkplanPage.tsx`, `pages/KommunikationsplanPage.tsx`, `fernmeldewesen/`, die S5-Seiten,
`src/stab/`, `src/presse/`, `src/infotelefon/`): `frontend/src/stab/AGENTS.md`. **Lagebesprechung** (eigenes Modul, Termin,
Vorbereitung, überfälliger Termin; auch `pages/LagebesprechungPage.tsx`, `src/lagebesprechung/`):
`frontend/src/lagebesprechung/AGENTS.md`.
**Führungsfunktionen** (Katalog, Codespalte neben Freitext, Besetzung zur Lesezeit; auch
`src/fuehrung/`): `frontend/src/fuehrung/AGENTS.md`. **Betreuung und Verpflegung** (auch
`pages/VerpflegungPage.tsx`, `src/betreuung/`, `src/verpflegung/`): `frontend/src/betreuung/AGENTS.md`.
**Kräfte-Zeitachse** (Einsatzdauer im Meldebild, Personal und Einheit-Detail; auch
`src/zeitachse/`, Status-Kataloge mit `zeitachse_marke`) und **Ablösung** (Rangfolge,
Vorwarnung aus dem DTO, Schichtmodelle; auch `abloesung/`, `src/schichtmodell/`):
`frontend/src/kraefte/AGENTS.md`.

## Frontend — Bedien-Leitlinie (Einsatzkontexte)

Zweite Achse neben LFH-19: für welchen **Kontext** gebaut wird (LFH-327). Herleitung und
Prüfliste: `docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`; Fallen,
Scanner-Interna, Messwerte: `docs/leitlinien/bedien-leitlinie-herleitungen.md`.

**Kontexte:** **Fükw** (primär, 13–15", Tastatur+Maus, kompakt) · **Führungs-Tablet** (1024–1280
px, Touch, oft Handschuh, keine Massenerfassung) · **ortsfeste Stelle** (BHP/BTP, kompakt, voller
Tastaturfluss) · **mobil** (~390 px, einhändig, keine Vergleichsansichten).
Die Lagekarte bedient den Kontext mobil (LFH-557): `frontend/src/pages/lagekarte/AGENTS.md`.

**Prüfliste Einsatztauglichkeit (15 Kriterien)** an jede neue oder umgebaute Seite; ohne sie ist
ein Modul-Task nicht fertig. Jede Zeile trägt ein Verdikt (erfüllt / offen → Zielticket / nicht
anwendbar), „nicht geprüft" ist keins.

**Texte: zeigen statt erklären** (LFH-1078)

- **Text erklärt nie die Bedienung.** Was ein Knopf tut, zeigt seine Beschriftung; wie ein Feld
  gefüllt wird, zeigen Platzhalter (der wirksame Wert, etwa „jetzt“), Einheit und Prüfung; was
  fehlt, zeigt der Leerzustand mit Knopf (`SeitenLeer` mit `aktion`); warum etwas gesperrt ist,
  steht in wenigen Wörtern sichtbar am Element, nie nur im Tooltip (Touch).
- Kein Satz nennt Dateiformate, Server, Phasen oder Datenflüsse. Neue Seiten tragen keinen
  Zweck-Absatz unter dem Titel; bestehende `beschreibung="…"` baut LFH-1078 schrittweise ab
  (der Wächter erfasst sie nicht).
- Erlaubt: Fehlermeldungen, Zustände („Offline vorgemerkt“, „Update lädt“), **ein** kurzer Satz
  zur Folge vor einem unumkehrbaren Schritt, Datenschutz-Hinweise („Zugriff wird protokolliert“),
  Modulbeschreibungen aus wenigen Fachwörtern.
- **Erklärendes gehört in die Anwenderdokumentation** (`docs/anwender/`, in der App unter
  „Hilfe“, LFH-1096): wer einen Erklärsatz entfernt, dessen Wissen sonst nirgends steht, schreibt
  es dort ins Kapitel. Regeln: `docs/anwender/AGENTS.md`.
- Wächter: `components/erklaertext.guard.test.ts` sucht Erklärmuster („Leer:“, „Klick auf“,
  „Enter sendet“, „sobald wieder Verbindung“, „read-only“ …) in sichtbaren Texten. Die Schuldmenge
  `OFFEN` ist seit LFH-1078 P7 leer; neue Einträge gibt es nicht, ein Treffer wird umgebaut.

**Tabelle und Dichte**

- **Tabelle nur, wenn verglichen wird**: stehende Kopfzeile, fixierte **menschenlesbare** Kennung
  (nie DB-`id`), Spaltenschalter **mit Zähler ausgeblendeter Spalten**. Auf schmalem Schirm
  **angepasst, nicht in Karten aufgelöst**. Träger `KatalogTabelle`/`Datensicht`.
- Spaltenschalter: `components/SpaltenSchalter.tsx` (eine Wahrheit für Handwahl und `abBreite`);
  in `KatalogTabelle` nur per Opt-in `spaltenSchalter={{ bezeichnung }}`, `Datensicht` setzt es
  nie. Antds `responsive`/`hidden` gesperrt (`katalogTabelle.guard.test.ts`). Das Häkchen zeigt
  die wirkliche Sichtbarkeit.
- **Eine Vergleichstabelle ist sortier- und filterbar, im Spaltenkopf** (LLH-1086, Spec
  `tabellen-sortieren-filtern`): Sortieren per Klick auf den Kopf, Filter über antds
  Spaltenfilter (kontrolliert, im Clientmodus mit Zähler „Groß (3)“), je aktivem Wert ein Chip
  (`components/tabellenFilter.tsx`) und darüber der `Filterhinweis` (Treffer von Gesamt,
  „Filter zurücksetzen“ leert Suche und Filter, nicht die Sortierung). Die gefilterte Kopfzelle
  trägt eine 2-px-Linie in `bedien`. Was man nicht sieht, wirkt nicht: der Filter einer
  ausgeblendeten Spalte schneidet nichts und steht nicht als Chip da. Der Kartenzweig zeigt
  dieselbe Menge und sortiert über „Sortieren“. Im Servermodus zählt das Kopfmenü nicht und die
  Zahlen kommen vom Server (`serverseitig.zahlen`). Sortierung, Filter und Suche stehen in der
  Adresse (`?sort=ort:auf&f.ausmass=gross&q=`, `routing/deeplinks.ts`), sonst gilt der Stand der
  Sitzung; die Spaltenwahl liegt am Gerät — beides über `useListenGedaechtnis`
  (`components/listenGedaechtnis.ts`), den die SEITE hält und als `gedaechtnis` an
  `Datensicht`/`KatalogTabelle` reicht; ohne gemerkte Spaltenwahl gilt `spaltenAusVoreinstellung`.
  Spalten, die beim ersten Rendern noch nicht feststehen (Werte aus den Zeilen, Spalte hinter einer
  Freigabe), nennt die Seite als `ausDaten`, sonst fiele ihr Filter aus der Adresse. Eine Sicht im
  Baummodus sortiert und filtert nicht (Meldebild, Funkplan, Kommunikationsplan; Kommentar an der
  Sicht). Ein Filter mit `ohneKartenfeld` hat im Kartenzweig kein Auswahlfeld (Betroffene, Status
  der Tiere: die Seite führt die Achse schon, die erste Karte bleibt im ersten Bild), wirkt aber
  und steht als Chip da. Vorbild Schäden, dazu Fahrzeuge, Personal, Material, Sprechgruppen,
  Betroffene, Tiere, Evakuierung; Rollout LLH-1096. Gerätestartseiten bleiben ohne Kopffilter
  (Kommentar an der Seite).
  In einer `KatalogTabelle` (Unfallhilfsstellen, Bereitstellungsräume) trägt jede Spalte `key` und
  `sorter`, eine Werteliste `filters`/`onFilter`; das Gedächtnis prüft gegen ein Register auf
  Modulebene (`GEDAECHTNIS_SPALTEN`). Ein Reiter einer Detailseite (Kräfte der UHS) sortiert und
  filtert ohne Gedächtnis: die Adresse meint das Objekt. `MaterialAmOrt` bleibt ohne (eine gelöste
  Zeile hält ihre Stelle, LLH-1254).
  Nachweise `e2e/tabellen-sortieren-filtern.spec.ts`, C16 in `e2e/trefflaeche-pruefflaechen.spec.ts`,
  Filtermarke in `e2e/auswahl-kontrast.spec.ts`.
- **Kopfwerkzeuge der `KatalogTabelle` folgen der Dichte** (LLH-1227): Suche und Spaltenschalter
  stehen `paddingSM` auseinander, antds Spaltenfilter-Auslöser hält `controlHeightSM` und liegt
  in der Tab-Folge (Name „<Spalte> filtern“, Enter/Leertaste öffnen), beides im Primitiv, nie je
  Seite. Nachweis `e2e/katalogtabelle-kopf-dichte.spec.ts`.
- **Das Aufklappsymbol im Baum der `Datensicht` folgt der Dichte** (LLH-1240): antds Symbol steht
  in einem Knopf mit Höhe `controlHeight` und Breite `controlHeightSM` (`baumSymbolZielStil`),
  der Text daneben mittig in derselben Höhe (`baumTextStil`); im Druck fällt der Boden. Nachweis
  `e2e/gate3-trefflaeche.spec.ts` „Baumtabellen“ (Einheiten, Meldebild, Funkplan).
- Stehende Kopfzeile hält Freiraum (`setzeKopfFreiraum`, `scroll-margin-top` in `sprache.css`);
  Fokus-Nachweis darunter auch mit `Shift+Tab` (`fokus-kern.ts`, `taste`). In der ersten Zeile
  beschneidet Chromium den Rand am Scrollcontainer von `scroll.x`; dort rollt
  `useFokusUnterKopf` (`components/fokusUnterKopf.ts`) nach (LLH-1358). `KatalogTabelle` trägt
  ihn, eine Tabelle mit stehender Kopfzeile außerhalb ruft ihn selbst (Gefahrenmatrix).
- **Dichte-Staffel 30 / 48 / 72 px** (kompakt · komfortabel · Handschuh) über ein Dichte-Token am
  `ConfigProvider`: `controlHeight` 30/48/72, `controlHeightSM` 24/48/72. **Neues punktuelles
  `size="small"` auf interaktiven Elementen ist verboten** (`components/dichte.guard.test.ts`,
  Schuldmenge `OFFEN` schrumpft nur, im selben Commit wie der Fix; Stand: UHS-Platzkarte in
  `pages/uhs/Grundriss.tsx`, nur in `kompakt`, sonst `platzBedienform`). `Card`/`Descriptions`/
  `Space`/`Liste` dürfen klein bleiben.
- **Die Zähltaste einer Hochfrequenz-Erfassung („+1“) hat in jeder Stufe einen Boden von 72 px**
  (Höhe und Breite) und steht am unteren Rand (LLH-1032, `verpflegung/zaehltasteStil.ts`). Das ist
  eine Ausnahme nach oben, keine Stufenwahl: die übrigen Tasten folgen der Staffel. Nachweis
  `e2e/gate3-trefflaeche.spec.ts` („Ausgabeansicht“).
- **Kein Zoom wie in einer App** (LLH-1328): der Viewport in `index.html` sperrt den Zoom
  (`maximum-scale=1.0, user-scalable=no`), `html` in `index.css` den Doppeltipp
  (`touch-action: manipulation`). Sonst zoomt iOS beim Fokus in jedes Feld unter 16 px Schrift,
  und die Stufen liegen darunter. Größe trägt die Dichte, kein Feld wird dafür auf 16 px gehoben.
  Wächter `theme/keinZoom.guard.test.ts`.
- **Die Stufe folgt dem Gerät, nie der Person** (LFH-724, Spec `bedien-dichte`): beim Start
  gespeicherte Wahl → Zeigerart (grob → `komfortabel`) → `kompakt`, nur in
  `theme/dichte.ts:startDichte`; `handschuh` nur auf Wahl, kein Zuhörer auf die Zeigerart, kein
  Import aus Einsatz, Rolle oder Funktion (`theme/dichteQuelle.guard.test.ts`). Browser-Beleg
  `e2e/dichte-ableitung.spec.ts`; Flächenmessung der Modul-Prüflisten
  `e2e/trefflaeche-pruefflaechen.spec.ts`, Messhelfer in `e2e/trefflaeche-kern.ts`.
- **Der Navigationsrahmen hat keine Dichte-Ausnahme** (LFH-384): die 48 ist Boden, nie Deckel
  (`Math.max(48, controlHeight)`, Griffe über `navGriffMass`); die Rail-Spalte wächst mit
  (`railBreite` in `components/Kopfleiste.tsx`, 73 px in `handschuh`).
- Knopfboden `minWidth` = `controlHeightSM` (`antdKnopf()` in `theme/tokens.ts`). `Switch` über
  `switchMasse`/`antdKomponenten(farben, dichte)`; Nachweis am CSS der `css-var-…`-Klasse über
  `innerHTML`, nicht `textContent`. Schalter in fester Breite brechen um, statt zu kürzen
  (`pages/lagekarte/leistenTeile.tsx`, Zeilen in `pages/lagekarte/Ebenenbaum.tsx`,
  `e2e/lagekarte-leiste-dichte.spec.ts`).
- **Klappkopf** (LFH-653): jedes `Collapse` bekommt den Boden über den Kontext
  (`antdKlappkopf(dichte)` in `theme/tokens.ts`, `collapse` am `ConfigProvider`: `minHeight`
  30/48/72 + Mittellage); antd rechnet den Kopf sonst aus der Schrift (36/45/55). Kein lokales
  `styles.header` je Stelle. Nachweis `e2e/dokumente.spec.ts` „Dichte-Staffel“.
- **Beschriftetes Kästchen** (LFH-907): jede `Checkbox` mit Text bekommt den Boden über den
  Kontext (`antdKaestchen(dichte)`, `checkbox` am `ConfigProvider`: `minHeight` 24/48/72 am Label
  und Mittellage); antd hat dafür kein Token, das Label wäre nur so hoch wie die Schrift
  (21,5/36). Ohne Text (antds Tabellenfilter) kein Boden; im Menüeintrag hebt
  `style={{ minHeight: 0 }}` ihn auf, dort ist der Eintrag das Ziel (`SpaltenSchalter`).
  Nachweis `e2e/trefflaeche-pruefflaechen.spec.ts` (C7).
- **Handgebautes Bedienziel** (LFH-365): `minHeight: token.controlHeight` **plus** `padding` aus
  `token.paddingSM`/`token.padding` (aufgelöste Tokens, nie `var(--lfh-*)`), geprüft über eine
  reine exportierte Stilfunktion (`bedienzielStil`) mit Böden als **Literalen**. **Ein `<a>` erbt
  keine Steuerhöhe.** Gate 3 je Route: `e2e/gate3-trefflaeche.spec.ts`. Kennungs-Links in
  Tabellen-, Listen- und Zeitachsenzeilen tragen den Boden über `components/kennungsLink.tsx`
  (`KennungsLink`, LFH-908), ohne eigene Polsterung: die trägt die Zelle. Ebenso das
  Auswahlziel einer Karte (`auswahlZielStil` in `components/ListeDetail.tsx`): die Polsterung
  trägt die Karte, ein Klick darauf wählt über den Kartenhalter.
- **Die Brotkrume hat keine Dichte-Ausnahme** (LFH-909): jeder Link im Ortspfad des Seitenkopfs
  hält die Staffel über `ortspfadStil` (`components/EinsatzSeite.tsx`) und die Pfad-Link-Regel in
  `EinsatzSeite.css`, durchsichtiger Rand statt Schrift (bleibt 12 px). Die CSS liest
  `--lfh-ortspfad-ziel`, die Stilfunktion setzt dort den aufgelösten Token, kein `var(--lfh-*)`
  der Dichte. Seiten geben nur ihre `Breadcrumb` hinein, kein eigener Boden je Seite.
- **Tastenkürzel als Marke** (LFH-335), nie nacktes `<kbd>`: `components/Tastenkuerzel.tsx`
  (Flex mit `gap`, `currentColor`, **kein** `controlHeight`-Boden; `tastenkuerzelStil` pinnt die
  Abwesenheit).

**Sprungpalette**: `frontend/src/command-palette/AGENTS.md`.

**Begriffe**

- **Voreingestellte Werte heißen „Vorgabe“** (LFH-944, Spec `bedien-begriffe`): nie „Default“,
  „Fallback“ oder „Standard“ im sichtbaren Text. Platzhalter nennen den Wert, der leer wirklich
  gilt; kein „Leer = …“-Satz daneben (LFH-1078). Bausteine in `components/vorgabeText.ts`
  („… (Vorgabe)“, „Vorgabe der Organisation: …“), Wächter `components/vorgabe.guard.test.ts` mit Ausnahmeliste
  für Eigennamen („Standard-Rufname“, „Standardansicht“).
- **Meldung und Lage** (LLH-1046, Spec `bedien-wortlaut`; Begriffe in
  `docs/design/2026-10-21-meldungsmodell/README.md`): das Modul heißt „Meldungen“ (Eingang und
  Ausgang), „Lagemeldungen“ ist die Sicht auf die lagerelevanten Meldungen. Eine Meldung anderer
  Art wird „In die Lage übernommen“ (Aktion und Dialog „In die Lage übernehmen“, Rückmeldung,
  Hinweis, ETB-Eintrag), ihr Etikett ist „In der Lage ✓“; „übergeben“ steht dafür nie. Der
  ETB-Typ „Lage“ heißt in der Mehrzahl „Lagefeststellungen“, nie „Lagemeldungen“. Das Paneel des
  Lagebilds mit ETB-Einträgen heißt „Jüngste ETB-Einträge“.

**Aktionen**

- **Knöpfe nennen die Handlung** (LFH-959, Spec `bedien-wortlaut`): ein Knopf trägt, was er
  tut („Bearbeitung beginnen“, „Außer Dienst nehmen“), ein Zustand steht nur auf dem Etikett.
  Kein Knopftext gleicht einem Statuswort desselben Moduls; die Texte stehen je Zielstatus in
  `kommunikation/phase.ts` (`…_HANDLUNG`) bzw. `stammdaten/dienststatus.tsx`, Guard
  `kommunikation/wortlaut.guard.test.ts`. Der Bestätigungsknopf einer Rückfrage nennt die
  Handlung, nie nur „Ja“/„OK“ (rote `Popconfirm`: `components/rueckfrage.guard.test.ts`, ohne
  Ausnahmen). Eine fachliche Unterscheidung ist ohne Hover lesbar, ein Tooltip
  ergänzt nur. „Quittieren“ heißt Empfang bestätigt (Meldung, Auftrag, Fernmeldeskizze), eine
  Erinnerung „erübrigt“ sich.
- **Datensatz-Aktionen werden gebündelt** (LFH-365): ab drei (nach Rechteprüfung) hinter
  **`components/MenueAusloeser.tsx`** (LFH-683, Spec `datensatz-aktionsmenue`). Der Baustein
  trägt Auslöser, `autoFocus`, Einheitsform (neutral, ein Trenner, Gefahr rot) und den Riegel
  gegen Portal-Klicks; kein eigenes `Dropdown` mit Dreipunkt (`menueAusloeser.guard.test.ts`).
  Beim Aufrufer bleiben: die Zählung, der zugängliche Name mit **Zeilenkennung**, die Rückfrage
  per `<Modal>` außerhalb der Zeilen-`map` (kein `Popconfirm`, Etiketten sind Text) und der
  Rechte-Riegel an der Ableitung (ein Callback ist kein Rechtebeleg). Prüft ein Aufrufer
  `aktionen != null`, gibt er bei leerer Menge selbst `null` zurück. Test über
  `.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]` + `within`. Kartenmodus: `Datensicht`
  baut `weitere`.
- **Ein Sprung ist keine Handlung** (LFH-616): gezählt werden nur ändernde Aktionen; Deeplinks
  („… ↗") stehen als eine Zeile (`data-lfh="inspector-sprung"`), rote Handlung abgesetzt.
- **Drag & Drop zieht nur mit `ZugPointerSensor`** (LFH-519, `components/zugPointerSensor.ts`):
  dnd-kits `PointerSensor` schluckt nach einem Zug jeden Klick, bis ein 50-ms-Timer läuft; unter
  Last verhungert der Timer, und der erste echte Klick geht verloren. Guard und Gegenprobe in
  `zugPointerSensor.test.tsx`, Nachweis `e2e/uhs-grundriss-menue-belegung.spec.ts`.
- **„Genau eine Primäraktion"** prüft der Kopf (`data-lfh="seitenkopf-aktionen"`), nicht global.
- **Ein Anker in der Zeile bedient den Klick allein** (Riegel `closest('a')` in `Datensicht`);
  mit `titel.ziel` erzeugt das `render` keinen Anker.
- **Der Kopf-Slot trägt, was ÖFFNET — nie, was ABSENDET**; Speichern gehört ins `<form>`.
- **Nebenwege im Kopf gehen über `weitere` der `EinsatzSeite`** (LFH-963, Spec
  `einsatztauglichkeit-layout`, Entscheidung 8): Drucken, CSV, Listenzugriffe und ähnliche
  Öffnen-Wege stehen ab `md` als sekundäre Knöpfe, unter `md` hinter EINEM Auslöser „Weitere“
  (`MenueAusloeser`, Name nennt die Seite). In `aktionen` bleibt nur, was am Handy sichtbar sein
  muss: Segmentleiste und genau eine Erfassung, auf Betroffenen- und Tiere-Liste dazu „Vermisst
  melden“. Nachgezogen sind Betroffene, Tiere, Schäden und die Detailseiten Lagebericht,
  Pressemitteilung, Befehl (LFH-1079: Sprung und Drucken über `etb/useZumEtbEintrag.ts` und
  `components/druck/useDruckNebenwege.ts`; ein gesperrter Weg nennt den Grund im `label`).
  Kräfteübersicht, Funkplan und Kommunikationsplan tragen keinen Nebenweg im Kopf.
  Herleitung: `openspec/changes/archive/2026-10-06-lfh-963-betroffene-tiere-handy/design.md`.
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
  Hinweis per `data-fehler`; Zeitpunkte über `ZeitpunktEingabe` und Gleichheit am Instant. Die
  Fokusrückgabe beider Primitive steht in `components/useFokusRueckgabe.ts`. Für die feldweise
  Bearbeitung in einer Ansicht (LLH-1103) trägt `InlineAngabe` optional `pruefe` (Grund nach dem
  Absenden als `FeldFehler`, `aria-invalid`, kein Senden; ein unveränderter Wert wird nicht
  geprüft; auch die Überlänge eines Freitexts), `gesperrt` (Grund als Text am Feld oder
  `{ beschreibungId }`, Verweis auf einen Grund an anderer Stelle; der Auslöser ist `disabled`),
  `onEntwurf` (nur die Wechsel geändert ↔ unverändert), `onOeffnen`/`onSchliessen` (Serverstand
  für einen Feld-CAS festhalten, ein offenes Feld an seinem Ort halten) und `OFFEN_LASSEN` als
  Ergebnis von `onSpeichern` (nichts gespeichert, Eingabe bleibt offen). `BemerkungZelle` trägt
  `gesperrt` ebenso: Grund am Feld, ein offenes Feld behält den Entwurf und sendet nicht.
  Personendaten werden nur so geschrieben (`frontend/src/personen/AGENTS.md`).
  Einsatzdaten haben nur den Zeilenweg (LFH-1170): eine Zeile schickt ihre Angabe
  (`patcheEinsatz`); ein Vollformular gibt es nicht. Ausnahmen (LFH-1175, Spec
  `einsatzdaten-bearbeitung`): die Zeile „Koordinate“ schickt das Paar, die Zeile „Adresse“ mit
  gewähltem Treffer Adresse und Koordinate zusammen; beide stehen im Paneel „Einsatzort“, die
  Kopfleiste zeigt den Einsatzort nur an. Eine Eingabe, die einen ungültigen Entwurf selbst
  anzeigt (Koordinate), sperrt das Senden über `isValid`.
  Die Einheit-Ansicht hat ebenso nur den Zeilenweg (LLH-1036, Spec `einheit-ansicht`): eine Zeile
  schickt genau ihr Feld (`patcheEinheit`; die Soll-Stärke ihre drei, das taktische Zeichen ein
  `tz_*`-Feld über `patchEinheitZeichen`), kein Formular, keine Speichern-Leiste. Der Inhalt
  hängt an `key={einheitId}`, damit kein Grund und keine offene Zeile zur nächsten Einheit wandert.
- **Jede Ortsangabe nimmt `anzeige/Ortsfeld.tsx`** (LFH-1175, LLH-1108, Spec `ortsfeld`; Ausrollen
  auf die übrigen Felder LLH-1114): Suche nur auf Enter oder „Ort suchen“, nie beim Tippen
  (Nominatim-Regeln, ein Takt für alle); Enter im Feld sendet das umgebende Formular nicht ab. Die
  Suche wird hineingereicht (im Einsatz `sucheOrtImEinsatz`, ohne Einsatz `sucheOrtInOrg`), beide
  ohne Lagekarten-Recht. Eine getippte Koordinate erkennt das Feld selbst. Speichert das Ziel eine
  Koordinate, bekommt das Feld `karte` (Vorschau mit ziehbarer Nadel, im Einsatz Ort-Zeile mit
  `exclude` des Objekts, ohne Einsatz nur der Ortsname eines Kartenpunkts über die Ort-Vorschau der
  Organisation, LLH-1376; „Auf Karte wählen“); `quelle` im Wert sagt, ob die Koordinate am Text
  hängt (`adresse`, `koordinate`) oder auf der Karte gesetzt ist (`karte`). **Personenbezogene
  Adressen nie an den Geocoder:** `ohneSuche="personenbezogen"` (reiner Text, auch keine
  Ort-Vorschau); so „Herkunft / Adresse“ der Person. Den gespeicherten Punkt ohne Bearbeitung zeigt
  `anzeige/Kartenausschnitt.tsx`. Im Formular einer Sache im Einsatz nimmt man
  `anzeige/EinsatzOrtsfeld.tsx` (Suche im Einsatz, `karte` mit Einsatzort als Umgebung) und die
  Abbildungen aus `anzeige/ortsfeldFormular.ts` (LLH-1121): `ortFelder` (Text und Koordinate
  gehen gemeinsam hinaus, die Koordinate nur mit Text), `ortsfeldAusGespeichert` (beim Bearbeiten
  steht eine gespeicherte Koordinate als `quelle: 'karte'`, eine Textkorrektur behält sie),
  `ortRegeln` (Pflicht und Länge am Text), `ortEingabe` (für einen POST: ohne Angabe fehlt das Feld).
  Eingebaut in Einsatzort, Schaden, Standort der Betreuungs- und Verpflegungsstelle, Sammelstelle
  des Bezirks, Standort von UHS (Anlegen) und Bereitstellungsraum, Fundort eines Tiers und Ziel
  eines Auftrags (LLH-1114).
- **Mengen nehmen `components/MengenFeld.tsx`** (LFH-983): Pflichtname (`beschriftung`, in der
  Zeile mit Kennung: „Menge zu Wolldecke“), ganze Zahlen ab 1, ohne Stufenknöpfe — rc-input-number
  benennt sie fest „Increase/Decrease Value“. Übrige nackte `InputNumber` sind Bestand; ein Riegel
  kommt erst nach dem Sweep.
- **Dezimalzahlen nehmen `components/DezimalFeld.tsx`, Anzeigen den Zahlenkern `anzeige/zahl.ts`**
  (LLH-1146): „1.20 km“ liest eine Einsatzkraft als 1.200. Das Feld zeigt das Komma und nimmt Komma
  wie Punkt an (Pflichtname `beschriftung`, Pflicht `stellen`, ohne Stufenknöpfe); Anzeigen
  schreiben `zahlText(wert, { stellen })` (de-DE, echtes „−“), nie `toFixed`. Koordinaten und
  Wire-/URL-Werte bleiben mit Punkt. Guard `anzeige/zahl.guard.test.ts`: `toFixed` nur an den dort
  bewerteten Stellen, kein Dezimal-`InputNumber` außerhalb des Bausteins.
- **Zeiteingabe in der Anzeigezone** (LFH-692, Spec `zeiteingabe`,
  `openspec/changes/archive/2026-10-01-lfh-692-zeiteingabe-anzeigezone/design.md`): jede Zeiteingabe nimmt
  `anzeige/ZeitpunktEingabe.tsx` (`ZeitpunktEingabe`, `ZeitraumEingabe`), nie antds `DatePicker`
  oder `TimePicker`;
  der Formularwert ist ein **Zeitpunkt** (hin `alsZeitpunkt`, zurück `alsBackendZeit`, Kern
  `anzeige/zeitEingabe.ts`), in die Wanduhr der Anzeigezone wandelt nur das Feld. Tagesgrenzen
  über `keineZukunftstage`/`tagInZone`, Uhrzeiten in Texten über `useZeitEingabe().formatiere`;
  `.local()` steht nur in `anzeige/` (Guard `anzeige/zeitEingabe.guard.test.ts`). Außerhalb eines
  Einsatzes `OrgAnzeigeProvider`. „Jetzt“ beim Erfassen: `frontend/src/offline/AGENTS.md`,
  „Schreiben ohne Netz“. Bewusst Gerätezeit: Uhr und Datenstand im Kopf. Zonentests
  stellen die Prozesszone per `test/prozessZone.ts` auf UTC — unter der Suiten-Zone Berlin wäre
  Anzeigezone Berlin blind. Eine **Uhrzeit ohne Datum** (Verpflegungsplan, LLH-1058, Spec
  `zeiteingabe`, „Uhrzeit ohne Datum“) liest nur `anzeige/uhrzeit.ts:parseUhrzeit` („0630“, „6:30“)
  und legt nur `uhrzeitAmTag` in der Anzeigezone auf einen Tag (doppelte Stunde: die erste, Lücke:
  nach vorn); die Tagesgrenzen `tagesgrenzen`. Ein **Kalenderdatum ohne Uhrzeit** (Geburtsdatum,
  LLH-1103, Spec `zeiteingabe`, „Kalenderdatum ohne Uhrzeit und Zone“) ist die Ausnahme von der
  Anzeigezone: gelesen nur über `anzeige/kalenderdatum.ts:parseKalenderdatum` („TT.MM.JJJJ“,
  „T.M.JJJJ“, „TT.MM.JJ“, `YYYY-MM-DD`; zweistelliges Jahr = jüngstes nicht zukünftiges; „heute“
  als Tag der Anzeigezone vom Aufrufer), gespeichert als `YYYY-MM-DD`, gezeigt über
  `formatKalenderdatum` („TT.MM.JJJJ“, Altbestand roh); keine Schnellwahl, keine relative Eingabe.
- **Zeiteingabe ist ein Textfeld** (LLH-1070, Spec `zeiteingabe`, „Eingabe als Text“ ff.,
  `openspec/changes/archive/2026-10-17-ri685cfi-zeiteingabe-tippen-schnellwahl/design.md`): getippte
  Zeiten deutet nur `anzeige/zeitParser.ts:deuteZeit` (taktisch `1430`/`101430`/`101430okt26`,
  deutsch, ISO, relativ `-5`/`+2h`/`j`; Unlesbares wird nie übernommen und nie still korrigiert).
  Das Feld zeigt die DTG nach `anzeige/format.ts:formatDtg` (Entscheidung E1, FwDV/DV 810); **kein
  `format` am Aufruf** (Typ und Guard). Die **Feldart** setzt der Aufrufer, wo sie aus dem Feld
  folgt: `art="ereignis"` (Ereignis-, Alarm-, Eingangszeit, Zeitstand), `art="frist"` (Frist,
  Termin, Ende einer Gültigkeit), ohne Art bei Filtern und Planungszeiten. Schnellwahlen stehen nur
  in `anzeige/zeitSchnellwahl.ts`; der Kalender (antds `Calendar`, nur in `anzeige/`) ist der
  Nebenweg. Tests tippen über `test/zeitEingabe.ts` (`tippeZeit`, `setzeZeit`), nie über
  Kalenderzellen oder Format-Strings. Falle: antds `Input` baut sein Gerüst um, sobald ein Präfix
  oder Suffix kommt oder geht, und das Feld verliert mitten im Tippen den Fokus — das Suffix der
  Deutung steht deshalb immer im DOM.
- **Zeitdarstellung** (LLH-1053, Spec `zeitdarstellung`, Entscheidungen E1–E4 aus LLH-1045): eine
  Zeit für Menschen formatiert nur `anzeige/zeitDarstellung.ts`, in drei Rollen — `zeitpunkt`
  (`101430okt26` bzw. `10.10.26 14:30`), `zeitKurz` (heute `1430`, sonst `091430` bzw. `14:30` /
  `09.10. 14:30`) und `uhrzeit` (`1430` bzw. `14:30`, nur wo der Tag aus dem Zusammenhang folgt);
  in Komponenten über `ZeitAnzeige rolle=…` oder die gebundenen Rollen aus
  `useAnzeigeKonventionen()`. Die volle DTG schreibt Monat klein ohne Umlaut und das Jahr
  zweistellig (FwDV/DV 810, Ausgabe 2018, Teil I 5.1.1.12). Die Darstellung (`taktisch`,
  Vorgabe, oder `datum_uhrzeit`) steht in den Konventionen; wirksam ist Gerät vor Einsatz vor
  Organisation vor Vorgabe (`wirksameZeitdarstellung`), die Gerätewahl liegt in
  `anzeige/zeitDarstellungStore.ts` (Profil „Darstellung auf diesem Gerät“, Sprungpalette).
  **Der Druck nimmt nie die Gerätewahl:** die Provider in `AnzeigeKonventionenContext.tsx` lassen
  sie unter `useDruckModus` weg. Ausnahmen: Uhr im Kopf (Gerätezeit) und Dauern. Kein
  `.format('…')` mit `HH`/`mm`/`DD`/`YYYY` außerhalb von `anzeige/` (Maschinenformate ab
  `YYYY-MM-DD` ausgenommen); Wächter `anzeige/zeitDarstellung.guard.test.ts`, Schuldmenge `OFFEN`
  seit LLH-1061 leer. Nebenformen im Kern: `datum`/`kalendertag` (Tag ohne Uhrzeit, `10okt26`
  bzw. `10.10.26`), `tagUndUhrzeit` (Anfang eines Zeitraums), `leereUhrzeit` (Lücke in
  Ziffernbreite); „heute“ einer Nebenzeit (Nachtrag, Übergabe, Zeitraumende) über das `jetzt` von
  `zeitKurz`. Der Datenstand rechnet in Gerätezeit (`components/Datenstand.tsx`), die Uhr des
  Lagemonitors nimmt `formatiereUhr` der Kopfleiste.
- **Statuswechsel in Kräfte-Listen**: Auslöser ist die Statusanzeige, senkrechtes Menü im Portal
  (`components/StatusWahl.tsx`, `statusBedienung`), am `status`-Slot, nie am `aktion`-Slot
  (`docs/superpowers/specs/2026-07-30-kraefte-listen-statuswechsel-zielform.md`).
- **Statusfarbe: Rollenfarben als getönte Fläche, Mandantenfarben nur am Rand** (Neuentwurf
  22.09.2026): `StatusTag` Vorgabe `flaeche`, Werte/Kontrast nur in
  `components/instrument/statusFlaeche.ts`; gesetzte `status_farbe` erzwingt `rand`
  (`wirksameDarstellungsart`). Gemessen in `kraefte-kontrast.spec.ts`.
- **Material** (LFH-341, `materialStatus`): `im_einsatz` `bedien`, `defekt`/`verbraucht` `alarm`;
  `pages/MaterialPage.tsx` und `kraefte/MaterialAmOrt.tsx` (Material am Ort) lesen beide von dort — zwei
  Farbbehandlungen desselben Enums wären der Fehlerfall, nicht der Kompromiss. Am Ort (LLH-1133,
  Spec `material-am-ort`) ist die Statusanzeige ebenso `StatusWahl`, mit denselben Einträgen
  (`kraefte/materialPosten.ts:materialStatusWahl`) und demselben Schreibweg
  (`api/einsatzMaterial.ts:setzeMaterialStatus`), Ablehnung an der Zeile; Ad-hoc-Material nimmt an
  beiden Stellen nur `kraefte/MaterialAdhocDialog.tsx` (am Ort mit festem `ort`, ein Request).
  Rechte wie beim Zuordnen (Schreibrecht und Freigabe Material); ein beendeter Ort sperrt Zuordnen,
  Erfassen und Ausgeben, nicht Status und Lösen. Nachweis `kraefte/materialSchreibweg.test.tsx`.
  Eine selbst gelöste Zeile hält ihre Stelle als träge Marke „Gelöst“, bis Zeiger und Fokus den
  Baustein verlassen haben (LLH-1254, `useHoldGeloest` in `kraefte/MaterialAmOrt.tsx`); Rückgängig
  über `kommunikation/rueckgaengig.tsx`, nicht am beendeten Ort, Ablehnung über dem Block.
- Portal-Menüs sind kein Verlassen der `Datensicht` (`checkVerlassen`, `components/useZuflussSchleuse.ts`); in jsdom wandert der
  Fokus nicht — Handler direkt mit `relatedTarget` prüfen.
- **Ein Status gehört in den Vertrag:** jede `Record<…, StatusDarstellung>` steht in
  `theme/statusFarben.ts` (`ALLE_MAPS` in `statusFarben.test.ts`: 38 am 16.10.2026, LLH-1040 `verpflegungsstelleStatus`); jede weitere
  Karte ist eine begründete Entscheidung (Beispiele: `odlStufe` in
  `openspec/changes/archive/2026-09-21-lfh-78-fachebene-odl/design.md`, `aufbewahrungZustand` in
  `openspec/changes/archive/2026-09-29-lfh-23-retention-rest/design.md` D4,
  `schwaerzungsantragStand` in
  `openspec/changes/archive/2026-10-02-lfh-751-sofort-schwaerzung-auf-antrag/design.md` D9, `capSchwere` in
  `openspec/changes/archive/2026-10-01-lfh-662-dwd-ebene-gueltigkeit-warnstufe/design.md` D5,
  `pegelZustand` in `openspec/changes/archive/2026-10-04-lfh-881-pegelzustand-statusvertrag/design.md` D1–D2,
  `besatzungsUrteil` in `openspec/changes/archive/2026-10-06-lfh-962-farbvertrag-wort/design.md` D1). `theme/statusVertrag.guard.test.ts`: keine Karte außerhalb
  der Datei, kein `<Tag color={…}>` auf Vertrags-Enums (dafür `components/StatusTag.tsx`).

**Farbe und Zeichen**

- **Rot bedient nichts:** `bedien` und Fokusring blau, Rot ist Gefahr. Jede Statusfarbe braucht
  einen **zweiten Kanal** (WCAG 1.4.1). Farbwerte nur aus `theme/tokens.ts`/`theme/rollen.css`.
- **Der Fokusring ist `bedien`** (LFH-737): antds Umriss liest `colorPrimaryBorder`, und
  `antdToken` setzt ihn auf `bedien` (≥ 3 : 1 auf jeder deckenden Fläche,
  `theme/bedienKontrast.test.ts`, `e2e/fokusring-kontrast.spec.ts`), wie die eigenen Klassen in
  `sprache.css`. Er ist zugleich die Ruhefarbe des `Slider`; dessen Zeiger nimmt `bedienHover`.
  Flächen (`warnstufeFlaeche`/`flaechenFarbe`) sind die dritte Darstellungssorte; eine vierte wird
  in `statusFarben.ts` benannt, nicht in `pages/`.
- **Demo-Marke** (LFH-733): Demo-Stammdaten (`ist_demo`) zeigt nur `components/DemoMarke.tsx`
  (`Tag` ohne `color`, kein `StatusTag`, keine Karte in `statusFarben.ts`); Auswahllisten zum
  Disponieren gruppieren sie nur über `stammdaten/demoAuswahl.tsx` hinter die echten Einträge.
  Herleitung: `openspec/changes/archive/2026-10-01-lfh-733-demo-marke-stammdaten/design.md`.
- **Helligkeit: ein Regler, eine Sperre** (LFH-397, Kriterium 8,
  `openspec/changes/archive/2026-09-29-lfh-397-helligkeitsregler-warnsperre/design.md`): dritte Achse im
  `ThemeModeProvider` (`useHelligkeit`, Stufen 100/80/60/40/20, `lifeline-hub.helligkeit`,
  **gespiegelt in `index.html`**), wirkt nur über die Deckschicht `html::after` in `rollen.css`
  (`--lfh-abdunkelung`, `@media screen`), nie über Paletten. Bei aktiver Warnung
  (`einsatz/aktiveWarnung.ts`: Warnstufe mit Rolle `alarm`,
  `meldungen.bestaetigung_ueberfaellig` oder eine jetzt geltende DWD-Warnung mit Rolle `alarm`
  aus `dwdWarnstufe`, nur mit Freigabe `wetter-pegel` und ohne eigenen Abruf, LFH-774) gilt
  `HELLIGKEIT_BODEN_WARNUNG` (abgeleitet über
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
  `size="middle"` (`aktionsabstand.guard.test.ts`). Dialogfüße halten dieselbe Stufe (LFH-653,
  11/18/26 px, Leitlinie ≥ 8 / ≥ 16): der Fuß der Erfassungs-Hülle über `size="middle"`, antds
  eigene Füße (Modal, `modal.confirm`, `Popconfirm`) über eine Regel in `index.css` mit
  `var(--ant-padding)`. **Kein Komponenten-Token `marginXS`:** jeder antd-Knopf setzt die Variable
  mit seiner `css-var-…`-Klasse zurück, die Überschreibung kommt am Knopf nie an (gemessen 7 px).
  Nachweis `e2e/dialogfuss-dichte.spec.ts`, `e2e/dokumente.spec.ts`.
- **Destruktiv ist nicht gleich destruktiv** (LFH-363): Umkehrbares („Außer Dienst",
  „Deaktivieren", eine gelöste Zuordnung) → Abstand + `danger`, keine Rückfrage; Unumkehrbares →
  Rückfrage, `Popconfirm` mit `okButtonProps={{ danger: true }}` und benanntem `okText`.
  **Unumkehrbares für den ganzen Einsatz steht nicht im Kopf oder Menü einer Arbeitsseite**
  (LFH-960, Spec `bedien-wortlaut`): der Einsatzabschluss steht als letzter Abschnitt auf den
  Einsatzdaten, nur für die Einsatzleitung, bestätigt mit „Einsatz endgültig abschließen“.
- **Ein Iconsatz** (LFH-595, Spec `iconsatz`,
  `openspec/changes/archive/2026-09-30-lfh-595-ein-ikonensatz/design.md`): Icons8
  „iOS 27 Outlined“, für aktive Zustände „iOS 27 Filled“ (`IconPaar`, heute Rail und Stern).
  Import nur über `icons/index.ts`; Register, SVG-Quellen und Stempel in `scripts/icons/`
  (`erzeuge-icons.mjs`, Abschreibprüfung gegen das Icons8-PNG `vergleiche-png.mjs`). Auswählen
  mit PNG, SVG erst nach Freigabe abrufen (Kontingent des Abos). Lücke: Ersatz aus demselben Stil,
  sonst eigene Zeichnung im 50er-Raster mit Vermerk; **nie ein zweiter Katalog**. Jedes Icon ist
  `aria-hidden`, `1em`, `currentColor`, Hülle `anticon` (antds Ausrichtung); antds eigene
  Bauteil-Icons (Auswahlpfeil, Schließkreuz, `loading`) bleiben. Taktische Zeichen, die
  Bildmarke und die Figur des Körperschemas samt Sternchen (`personen/koerperschema/`) sind
  Zeichnungen, keine Icons; Knöpfe neben ihnen tragen Icons des Satzes.
- **Ein Emoji ist kein Icon:** Guard `icons/icons.guard.test.ts` (kein Import aus
  `@ant-design/icons`/`react-icons`, Stempel, kein unbenutztes Icon, kein Emoji im Code); in
  Text-/Druckausgaben ein Kurzwort (`Pers.`/`Fzg.`/`Mtl.`). Erlaubt als Textzeichen: ⧖ und ↗
  (`aria-hidden` neben einem Wort), ✓ im Wortlaut, © in Quellenangaben.

**Personen und Sichtung** (Anlegen mit Sichtung, `AufnahmeFelder`, `SK_META`, Verortungsauftrag):
`frontend/src/personen/AGENTS.md` — gilt auch für `pages/PersonenPage.tsx`, `pages/PersonenDetailPage.tsx`
und `pages/personen/`.

**Rückwege und Fehler**

- **Erst die Umkehrbarkeit, dann der Rückgängig-Knopf** (LFH-343): eine Rückfrage fällt nur, wenn
  es einen **serverseitigen** Rückweg gibt (`POST …/vollzug` → `offen`,
  `POST …/erinnerungen/{eid}/oeffnen`, `uebergang_erlaubt` eine Stufe zurück); sonst bleibt sie.
  Toast `kommunikation/rueckgaengig.tsx` mit festem Schlüssel; nach einer Nutzeraktion ist er
  keine Alarmmeldung (EEMUA 191).
- **Linker Kartenrand: EINE Farbe, Gefahr gewinnt** (`colorError` vor `colorWarning`; prüfbar
  über `data-alarm`/`data-unbearbeitet`). „unbearbeitet" sitzt am `StatusDeskriptor`, keine
  fünfte `KommPhase`.
- **Speicherfehler an die Seite, Erfolg an den Toast** (LFH-1077): der Grund einer Ablehnung
  steht am Ort der Handlung, bis zum nächsten Absenden (mittesten): im Dialog über `speicherung`
  der Erfassungs-Hülle oder `SpeicherFehler` (Öffnen und Abbrechen räumen), am Formular oder
  Paneel als `SpeicherFehler`, an der Zeile als `ZeilenFehler` (Grund je Zeile aus
  `components/useZeilenFehler.ts`, gefüttert aus `onMutate`/`onError`, nicht aus
  `mutation.variables`: die Mutation verfolgt nur den letzten Aufruf; in einer `Datensicht` über
  `zeilenFehler`), auf der Lagekarte als Kartenhinweis (`pages/lagekarte/useKartenFehler.ts`),
  Kopfaktionen und Rückgängig aus dem Toast über `SeitenHinweise` (EIN Slot); die Anzeigen in
  `components/SpeicherHinweis.tsx`.
  - Ein Dialog schließt erst beim Erfolg; solange gespeichert wird, ist Abbrechen gesperrt (sonst
    käme die Ablehnung unsichtbar an). Prüfungen ohne Server stehen am Feld.
  - Ist der Ort nach der Antwort nicht mehr sichtbar (Zeile gewandert, Ansicht gewechselt), steht
    der Grund im Seitenhinweis; blendet nur Suche oder Filter die Zeile aus, zeigt ihn die
    `Datensicht` über der Liste. Ein Grund, dessen Ort nie wiederkommt, lässt sich schließen
    (Seiten- und Kartenhinweis). Ein Wechsel von Einsatz oder Detail-Route räumt die Gründe, und
    eine danach scheiternde Anfrage meldet nicht am neuen Ort (Einsatz bzw. Kennung in den
    `variables` mitführen und am Ort mit dem aktuellen vergleichen).
  - Kein `onError`-Toast: ein Fehler-Toast bleibt nur ohne Ort (Zwischenablage, Hintergrund) und
    steht mit Grund in `components/speicherfehler.guard.test.ts`.
- **Gescheiterter Zustandsübergang meldet sich im Dialog** (LFH-535):
  `entwurf/FreigabeDialog.tsx`, kein `modal.confirm`; `freigabeGrund`, Vorrang Speicherfehler;
  Öffnen ruft `freigebenMutation.reset()`. Test zählt `.ant-message`, offen/zu über `ant-zoom-leave`.
- **Fehlende Berechtigung wird benannt, nicht stumm weggeschaltet** (M16): `RechteHinweis` zeigt
  „Nur Ansicht · Grund“ über dem Block (Grund aus `components/nurAnsicht.ts`, wenige Wörter,
  Rollen wie in der Mitgliederverwaltung), Primäraktion gesperrt sichtbar; Zeilenaktionsspalte
  entfällt (M45); gesperrte Einzelzeilen tragen ihren Kurzgrund selbst.
- **Was der Server sicher ablehnt, steht gesperrt mit Grund** (LFH-966): Entfernen und
  Herabstufen der letzten Einsatzleitung, Deaktivieren des letzten aktiven Admins und des
  eigenen Kontos. Der Grund steht in wenigen Wörtern neben der Aktion (`aria-describedby`),
  Wortlaut in `stammdaten/rechteText.ts`. Die eigene Herabstufung ohne Systemrolle fragt nach
  (kein eigener Rückweg); der Knopf nennt die Handlung.
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
  `<div {...useSpeicherLeiste()}>` (`components/speicherLeiste.ts`; mit „Abbrechen“ daneben
  `useSpeicherLeiste({ hasAbbrechen: true })`, Abstand `padding`) — sie bringt den Fokusabstand
  mit (LFH-475, `scroll-padding` über `:root:has(...)` in `index.css`, Nachweis
  `e2e/fokus-verdeckung.spec.ts`); `speicherLeisteStil`/`feldrasterStil` rein, die Breite liest
  der Aufrufer aus `useViewport`.
- **Eine Speichern-Leiste je Seite, und sie speichert jedes Feld der Seite** (LFH-979, Spec
  `formularseiten`): kein zweites `<Form>` mit eigenem Knopf daneben; ein PATCH schickt nur die
  geänderten Felder, der Toast nennt genau sie. Sofort wirkende Wege (Logo, Modulzeilen) sind
  keine Felder. **Gilt für Formularseiten** (Einstellungen, Stammdaten-Detail); in einer Ansicht
  gilt stattdessen „höchstens eine offene Bearbeitung je Seite“ (LLH-1139, „Bearbeiten in der
  Ansicht“ unter der UI-Form-Leitlinie): ein Paneel mit eigenem Fuß ist dort kein zweiter
  Speicherweg.
- **Formularseiten mit Leiste tragen den Verlassen-Schutz:** Merker
  `components/useFormularVerlassenSchutz.ts` (eigener Zähler, nicht `isFieldsTouched`;
  `onValuesChange` → `geaendert`, `fassung()` beim Absenden, `gespeichert(fassung)` nur bei
  Erfolg; `aktiv` = Schreibrecht, `schluessel` = Datensatz-ID bei `key={id}`; im Bearbeiten-Modus
  einer Detailseite `aktiv` = Sitzung offen, `schluessel` nur bei offener Sitzung, LLH-1101) plus
  `<VerlassenRueckfrage>` (`components/VerlassenRueckfrage.tsx`, `useBlocker` bei Pfadwechsel,
  „Bleiben“/„Verwerfen“). Seiten, die jede Zeile sofort speichern (`EinsatzModule`), nicht. Tests
  jeder Seite mit `VerlassenRueckfrage`, auch über den Merker unten, rendern mit
  `renderMitProviders(…, { datenRouter: true })` — `useBlocker` wirft ohne Data Router.
- **Ein offenes, geändertes Einzelfeld in einer Ansicht trägt denselben Schutz** (LLH-1103, Spec
  `formularseiten`, „Rückfrage vor dem Verlassen“): über den Merker
  `components/offeneBearbeitung.tsx` (`OffeneBearbeitungProvider` speist
  `useFormularVerlassenSchutz` und rendert `VerlassenRueckfrage`; ein Feld meldet sich mit
  `useOffeneBearbeitung(etikett)` über `onEntwurf` an). Höchstens ein Entwurf je Seite: die
  übrigen Felder sind gesperrt mit „Erst „Name“ speichern oder abbrechen“
  (`useOffeneBearbeitungGrund` liefert den Grund der Seite; wo er steht, sagt die Bereichsdatei,
  für Personendaten `frontend/src/personen/AGENTS.md`). Ein offenes Feld ohne Änderung meldet sich
  nicht an.
- Ein Collapse-Kopf im Formular ist kein Übermittlungsknopf (`MaterialFormModal.test.tsx`).
- **Direkteinstieg** (LFH-347, `components/Direkteinstieg.tsx`,
  `components/EinstiegSwitcher.tsx`, `components/direkteinstiegKern.ts`; Tabelle unter `…/liste`;
  Schlüssel `<praefix>:letzteAuswahl:<einsatzId>` ist gepinnt). **Ein reiner Kern bekommt ein Suffix** (`…Kern.ts`): gleicher Basename
  wie die `.tsx` kollidiert case-insensitiv, Vite löst `.ts` vor `.tsx` auf („Element type is
  invalid").
- Stärke EINMAL summieren (`anzeige/staerke.ts:summiereStaerke`, `null` bei leerer Menge;
  kumuliert `pages/einsatzabschnitte/abschnittStaerke.ts`).
  „Abschnitt anlegen" ist eine Erfassung mit drei Feldern (`ErfassungsModal`), den Datensatz gibt
  es erst nach dem Absenden; das Detail bearbeitet jede Angabe einzeln (`patcheAbschnitt`, ein
  Feld je PATCH, Spec `einsatzabschnitt-bearbeitung`, LFH-1208,
  `openspec/changes/archive/2026-10-11-lfh-1208-abschnitt-bearbeiten-in-ansicht/design.md`).

**Entwürfe** (Verlustschutz, Navigationsschutz, „Entwurf speichern“, gegliederte Dokumente über
`entwurf/DokumentEntwurf`): `frontend/src/entwurf/AGENTS.md` — gilt auch für `lageberichte/`,
`pages/BefehlDetailPage.tsx`, `pages/LageberichtDetailPage.tsx` und
`pages/PressemitteilungDetailPage.tsx`.

**Layout und Live**

- **Eine Höhenkette endet nicht am Layout** (LFH-343, H51): `AppLayout`/`EinsatzLayout` wachsen
  mit; Scrollbereiche begrenzen die Seite selbst in `dvh` (`pages/ChatPage.tsx`: Messung per
  Callback-Ref, `ant-row` mit `flexWrap: 'nowrap'`); geprüft mit
  `toBeInViewport()`, nie `toBeVisible()`.
- Stick-to-bottom hängt an der jüngsten id, nicht an der Länge.
- **Live-Updates springen nicht unter dem Cursor:** Sammelbanner statt Einschieben (CLS ≤ 0,1,
  WCAG 3.2.5); Alarmbudget EEMUA 191/ISA-18.2: 1–2 je 10 min, ≤ 3 Stufen. **Kein Blinken auf
  lesbarem Text.**
- **Ein Eingang ist Information, kein Alarm** (LLH-1062, LLH-1143, Spec `benachrichtigungen`,
  „Eingangshinweis“): alle Eingänge eines Einsatzes (Stufe `hinweis`) stehen gebündelt im
  Eingangsband **unten** (`alarm/Eingangsband.tsx`, `alarm/useEingangshinweis.tsx`), nie als
  antd-Notification: die drei Toastplätze oben tragen nur Alarme, Org-Hinweise und Unwetter, und
  `maxCount` zählt das Band nicht. Der dezente Ton höchstens 1 je 2 min, kein neuer Eintrag
  während einer Eingabe (erst beim Verlassen des Feldes), keiner auf der Seite, deren
  Sammelbanner ihn trägt. Kein eigener Zeitgeber. e2e-Greifer: `[data-lfh="eingangsband"]`.
- **Eine Zahl für Eingänge** (LLH-1143, Spec `benachrichtigungen`, „Ungelesene Eingänge im
  Tab-Titel“): Knopf „Eingänge“ (`alarm/EingaengeKnopf.tsx`, Zelle `kopf-alarm`), Tab-Titel und
  App-Badge lesen denselben Verlauf (`alarm/useBenachrichtigungVerlauf.ts`, ein Key, ein Abruf);
  abgeglichen wird er nur im Knopf (`useVerlaufAbgleich`). Keine zweite Zahl daneben. Die Zahl
  steht als Plakette über dem Zeichen (`alarm/EingaengeZahl.tsx`, nimmt keine Breite). Bündelt
  der Kopf die Alarmzentrale (`useKopfBuendelt`, Handschirm und Tablet mit Finger), trägt deren
  Ziel Zahl und Eintrag „Eingänge“, kein eigener Knopf: der Kopf hat dort keine 48 px übrig.
  Ab `lg` gibt die Suchbasis die Breite des Knopfs her (`KOPF_SUCHE_FLEX`, Umbruchpunkt bleibt).

## Frontend — Keine Arbeitsplatzachse (LFH-456)

Neben Form (LFH-19) und Kontext (LFH-327) gibt es **keine dritte Bedienachse „Arbeitsplatz“**
(Entscheidung 29.09.2026, `openspec/changes/archive/2026-09-29-lfh-456-keine-arbeitsplatzachse/design.md`,
Spec `bedien-arbeitsplatz`).

- **Einstieg statt Achse:** Eine Fläche für einen Arbeitsplatz ist ein Einzelfall. Sie wird
  über einen Einstieg in einer bestehenden Fläche erreicht (Primäraktion im Seitenkopf,
  Sprungmarke, Leeraktion eines Paneels, Sprungpalette) und hat eine Adresse, die als Lesezeichen
  taugt. Was je Standort verschieden ist, trägt die Kontext-Achse **am Gerät**; „Fükw-Arbeitsplatz“
  in `theme/dichte.ts` meint das Gerät. Keine Wahl einer „Arbeitsweise“, keine Vorbelegung
  von Startziel, Primäraktion, Modulreihenfolge oder Dichte je Person; `standard_modul` gilt für
  den ganzen Einsatz. Je Person liegen nur das Palettengedächtnis „Zuletzt“,
  der ETB-Standard-Rufname (`benutzer_einstellungen::BEKANNTE_SCHLUESSEL`, geschlossener
  Schlüsselraum; der Rufname ist ein Wert, keine Arbeitsweise) und der **Gelesen-Stand** der
  Benachrichtigungen (Server, `benachrichtigung.quittiert_at`, LLH-1143: ein Zustand, keine
  Arbeitsweise; er wandert mit der Person auf jedes Gerät).
- **Nicht zuständig für Rechte:** Sichtbarkeit und Schreibrecht kommen allein aus `EinsatzRolle`,
  Systemrolle und Modulfreigabe (`einsatz/schreibrecht.ts`, `berechtigung::erlaubte_module`). Ein
  Einstieg prüft die Modulfreigabe seines Ziels (`istSprungGesperrt`, gesperrt sichtbar: Knopf
  `disabled` mit `title={KEINE_BERECHTIGUNG}`, Link und Kennzahl-Ziel entfallen). Der Rahmen fängt
  jede Route in ein gesperrtes Modul ab (`ModulGesperrt`, LFH-888,
  `openspec/changes/archive/2026-10-04-lfh-888-modulwaechter-gesperrte-sprungziele/design.md`) und wartet
  beim Kaltstart auf die Freigaben; die Zielseite prüft weiter ihren Datensatz. Verweise in
  Datenzeilen bleiben offen, für sie gilt der Rahmen. Stabsfunktionen und Fernmeldewesen ebenso
  (LFH-46, LLH-1180).
- **Aufnahme** (`personenAufnahmePfad`): Einstiege sind die UHS-Kopfzeile „Patient aufnehmen“
  (LFH-341/C6, nur `aktiv` und mit Schreibrecht) und die Leeraktion des Sichtungspaneels. Die
  Palette führt „Person erfassen“ auf Liste + Modal und **keinen** Aufnahme-Befehl.
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
  Im ETB übernimmt er Von, An, Meldeweg **und den Eintragstyp** (LLH-1112); aus beginnt der
  Folgeentwurf als „Meldung“, ein neuer Reiter über „+“ immer. Nie übernommen: Ereigniszeit,
  Veranlassung, Dateien.
- **Der Tastaturvertrag steht am Knopf, nie im Text** (LFH-1078): Tastenkappe ↵ an „Erfassen“
  nur bei feinem Zeiger und ab `lg`, Kürzel in `aria-keyshortcuts`; keine Hinweiszeile, kein Kürzel im
  Platzhalter (`etb/Schnellerfassung.tsx`).
- **Ein-/Zweifeld-Kataloge nehmen `components/SchnellAnlegen.tsx`** (bewusst kein `<Form>`).
- **Feldbudget** (LFH-19): Modal ≤ ~3, Schnellerfassung ≤ ~4 sichtbare Felder, Rest eingeklappt.
  Zählen nur mit `forceRender`, immer mit Gegenprobe „Aufklappen → Zahl steigt". Ausnahme
  „Neuen Einsatz anlegen“ (LFH-1175, Entscheidung 11.10.2026): fünf Felder, das fünfte ist der
  optionale Einsatzort; ein sechstes gehört in die Kopfdaten. Die Einsatz-Vorlage steht als
  gedämpfte Zeile unter den Feldern, kein Feld (LLH-1375): das Stichwort stellt sie ein.
- **Ein Pflichtfeld gehört nie hinter den Collapse**; Felder, die eine Ablehnung auslösen können,
  bleiben sichtbar (Auftrag: Empfänger als `Select mode="tags"`, Präfix `abschnitt:<id>`/
  `einheit:<id>`). Einzige Ausnahme: ein Klappteil, der bei einem Prüffehler darin selbst aufgeht
  (`onPruefungGescheitert` der Hülle) und dessen Kopf jede Abweichung von der Vorgabe nennt
  (LFH-974, `meldungen/MeldungFormular.tsx`).
- **Freitext nie länger als der Server erlaubt** (LFH-937, Spec `eingabegrenzen`): Grenzen nur aus
  `api/eingabegrenzen.ts` (Spiegeltest `tests/eingabegrenzen_spiegel.rs`). Mehrzeilige Felder
  (TextArea, Markdown) tragen den Zähler `count={zeichenGrenze(max)}` aus
  `components/zeichenGrenze.tsx`; natives `maxLength` nur bei kurzen einzeiligen Feldern ohne
  antd-Zähler. Der Zähler erscheint erst ab 80 % (Höhenbudget der ETB-Leiste), Überlänge in
  `alarmText` und als Wort („zu lang“). **Es wird nie gekürzt**, auch kein vorbelegter oder
  eingefügter Text: Überlänge bleibt stehen und sperrt das Senden — im Formular über
  `zeichenRegel` (Pflicht an jedem Feld mit `zeichenGrenze`), außerhalb eines Formulars über
  `istZuLang` am Sende-Knopf. Die Schnellerfassung prüft die Länge **vor** Upload und Queue
  (`laengenVerstoss`): ein zu langer Baustein wird nie eingereiht.
- Dichte kommt vom `ConfigProvider`. `test/utils.tsx` rendert ein **nacktes** `ConfigProvider`
  ohne Theme — Höhen-/Trefferflächen-Aussagen im Vitest belegen nichts.

## Frontend — Druck (LFH-71/LFH-22)

**Gedruckt wird über den Browser, nie auf dem Server**; kein `window.print()` direkt, Druckknöpfe
sind `DruckKnopf`. Regeln: `frontend/src/druck/AGENTS.md` (gilt für jede Seite mit Druckwurzel).

## Frontend — Deeplink-Muster (Route vs. Query-Param)

Quelle der Wahrheit: `frontend/src/routing/deeplinks.ts` — keine Template-Literals für
Einsatz-Pfade (`docs/superpowers/specs/2026-06-23-deeplinks-vereinheitlichen-design.md`).

- **Item-Route** `/einsaetze/:id/<modul>/:<modul>Id` bei Vollseiten-Detail (uhs, br, lagebericht,
  befehl, person, tier, schaden, einheiten, personal), sonst **Query-Param** `?<modul>=<id>`
  (`?fahrzeug=`, `?abschnitt=`, `?meldung=`, `?auftrag=`, `?gefahrengebiet=`, ETB `?eintrag=`);
  `?neu=1` fokussiert die Schnellerfassung. Stabile DB-`id`; `parseRouteId`.
- **Jede Detailansicht, die bearbeitet werden kann, hat eine Item-Route** (LLH-1139, „Bearbeiten
  in der Ansicht“): eine offene Bearbeitung braucht eine Adresse, auf die Verlassen-Schutz,
  Brotkrume und Lesezeichen zeigen. Ein Query-Param bleibt Auswahl oder Zeilenmarke in einer Liste
  und leitet, wo er eine Ansicht meint, auf die Route weiter (`?einheit=` wie unten). Die Route
  entsteht mit dem Fach-Ticket, das die Ansicht bearbeitbar macht; offen ist sie für den
  Einsatzabschnitt (`?abschnitt=` wählt heute im Detailpaneel).
- **Zwei Bestands-Params neben einer Item-Route** (LLH-1060 D2): `?einheit=` an der
  Einheitenliste leitet auf `einheitDetailPfad` weiter (am Meldebild ist `?einheit=` ein Auftrag,
  `kraefteuebersichtPfad`, LLH-1049). `?personal=` bleibt **Zeilenmarke** der Personalliste
  (`personalPfad`): Lagekarte, Schaden und Meldebild springen auf die hervorgehobene Zeile, um
  die Person im Vergleich zu zeigen; Sprungpalette, Namenslink und Block „Entlassen“ öffnen die
  Personenansicht (`einsatzkraftPfad`), ihre Brotkrume führt auf die Zeilenmarke zurück.
  `?befehl=` wählt einen Befehl im Reiter „Einsatzbefehle“ (`auftraegePfad`), die Item-Route des
  Befehls bleibt Vollseite für Entwurf, Druck und Deeplink.
- **Filter gehören in die URL** (`etbPfad`/`parseEtbFilter`, `mitQuery` kodiert). Unbekannter
  Enum-Wert wird ganz verworfen (exhaustiver `Record<EtbTyp, true>`). Für Tabellen gilt eine
  gemeinsame Kodierung (LLH-1086, `listenZustandParams`/`parseListenZustand`): `sort=<spalte>:auf|ab`
  (`aus` = bewusst unsortiert, die Vorgabe steht nicht da), `f.<spalte>=a,b`, `q=`; geschrieben
  mit `replace`, fremde Parameter bleiben, Unbekanntes prüft `bereinigeListenZustand` weg.
- **Zeit in der URL** ist UTC ohne Zone (`dayjs(s)` läse Ortszeit) — Umkehr in `anzeige/zeitEingabe.ts`
  mit eigenem Test. Kodierung per Round-Trip durch `URLSearchParams` prüfen.
- Filterleiste nur bei **fremder** Änderung neu aufsetzen (nach der Navigation); entprellt wird
  in der Leiste. Unter Fake-Timern: `fireEvent.change`, kein `userEvent.type`, kein `findBy*`.

## Frontend — Query-Key-Registry (LFH-122/307/312)

Quelle der Wahrheit: `frontend/src/api/queryKeys.ts`.

- `einsatzKeys` (`EINSATZ_KEYS`): jeder Key genau einmal klassifiziert — live über
  `EINSATZ_STREAM_EVENTS` oder `NICHT_LIVE_KEYS`. `globalKeys` (`GLOBAL_KEYS`) für alles darüber.
- **Der Einsatzkopf ist live** (LFH-555, `openspec/changes/archive/2026-09-30-lfh-555-einsatzkopf-live/design.md`):
  Ereignis `einsatz` mit leerer Gate-Menge (Tür des Stroms = Tür des Kopf-GET; leer steht nur
  `einsatz`, `lagged` und der empfängergebundenen `benachrichtigung` zu, Guard
  `ungegatet_sind_nur_lagged_einsatz_und_benachrichtigung`), invalidiert Kopf und
  Stand der Lagebesprechung. Es feuern PATCH, Abschluss, Frist und Termin oder Abschluss der
  Lagebesprechung **nur bei geändertem Termin**; `meine_*` und `lagekennzahlen` lösen es nicht aus.
- **Einsatzliste und Stammdaten sind live** (LFH-734, Spec `org-live`): `globalKeys` sind wie die
  Einsatz-Keys genau einmal klassifiziert — live über `ORG_STREAM_EVENTS` (Ereignisse
  `einsatzliste`, `stammdaten`) oder `NICHT_LIVE_GLOBAL_KEYS` (Guard (g)). **Ein Tab, eine
  Live-Verbindung:** der Einsatz-Strom trägt die Org-Ereignisse mit; außerhalb eines Einsatzes
  öffnet die Betriebszeile `/api/live` (`live/useOrgLiveStream.ts`), der ruht, solange ein
  Einsatz-Strom offen ist (`live/einsatzStromStore.ts`). Verbindungsbau nur über
  `live/liveVerbindung.ts`, keine zweite `EventSource`.
- **Live-Ereignisse invalidieren nur über den Sammler** `live/liveInvalidierung.ts` (LFH-922,
  Spec `live-abgleich`): je Key ein Abgleich je 300-ms-Fenster, `cancelRefetch: false`, verdeckte
  Tabs markieren nur. `modulZaehler` läuft über einen zweiten Sammler mit 1-s-Fenster
  (`ZAEHLER_SAMMELFENSTER_MS`, LFH-935): ein Burst kostet je Tab einen Zählerabruf. Seiteneffekte (Ton, Toast, Status) bleiben sofort. Spätere Live-Abnehmer
  (Modulzähler, ETB-Zeitachse, Meldungen) übernehmen ihn, statt eigene Timer zu bauen. Ein
  Neuaufbau des Browsers nach dem Kontroll-Ereignis `position` gleicht im Einsatz-Strom nur die
  Org-Keys ab (der Server liefert per `Last-Event-ID` nach), sonst und bei neuer Verbindung voll.
- **Gezielter Abgleich nach Payload** (LFH-931, Spec `live-abgleich`): trägt ein Ereignis seine
  Objekt-Kennung, ordnet `EINSATZ_STREAM_ZIELE` zu — nur das Detail bei `nur_inhalt`, nur die
  Anhangliste bei `anhang`, eine Zeile über `live/zeilenAbgleich.ts` (bis 10 Kennungen je
  Fenster, sonst und bei verdecktem Tab, Fehler oder fehlender Liste der Sammler). Ohne Kennung
  gelten die Prefixe aus `EINSATZ_STREAM_EVENTS`, `lagged` gleicht weiter alles ab. Jeder gezielte
  Key liegt unter den Prefixen seines Ereignisses (`queryKeys.test.ts`); eine zeilenweise
  abgeglichene Liste sortiert wie ihr SQL (Vergleichsfunktion neben dem Fetcher). Eine
  Seitenkette (`useInfiniteQuery`) bekommt eine Zeile nur innerhalb des geladenen Fensters
  (`fensterEinsortieren`, LFH-1075); entscheidet über die Zugehörigkeit nur der Server
  (Suchbegriff), geht die Kette an den Sammler. Kennzahlen gleicht immer der Sammler ab.
- **Kein Inline-String-Array als Query-Key** (`queryKeys.guard.test.ts`, `queryKeyScan.ts`).
- **Wire-Strings sind eingefroren** (`globalKeys.test.ts`, gegen handgeschriebene Literale).
- Sub-Keys: String-Union-Token als zweites Element; der argumentlose Accessor ist der
  Invalidierungs-Prefix (`personal()` und `personalListe('alle')`).
- **Testfallen:** ohne gemounteten Observer `new QueryClient()` statt `neuerQueryClient()` (dessen
  `gcTime: 0` räumt beim ersten `await`);
  **Charakterisierungstests bauen ihre Keys als Literale**, nicht über die Factory.
- **Ein neuer Prefix entscheidet über `LAGEBILD_OFFLINE`** (auf die Platte oder ausdrücklich
  draußen): `frontend/src/offline/AGENTS.md`.
- **Eine Mutation, die eine `erfasse…OfflineFaehig`-Funktion ruft, und Seitentests ohne Netz**
  (`networkMode`, `setzeOnline`): `frontend/src/offline/AGENTS.md`, „Schreiben ohne Netz“.

## Frontend — Lint-Disziplin

`pnpm lint` mit `--max-warnings 0`; Warnungen an der Wurzel beheben. `exhaustive-deps`
strukturell lösen (Primitive, `useMemo`/`useCallback`). `eslint-disable` nur begründet,
`-next-line` an der gemeldeten Zeile mit Kommentar; keine Block-Disables, keine toten Direktiven.

## Frontend — Browserspeicher (LFH-942)

- **`localStorage` nur über `lib/sichererSpeicher`** (`sicherLesen`, `sicherSchreiben`,
  `sicherEntfernen`, `sicherSchluessel`); `lib/sichererSpeicher.guard.test.ts` macht jeden anderen
  Zugriff rot. Auf gehärteten Rechnern ist `localStorage` `null` oder wirft, ein Wurf im Render
  lässt die Seite weiß.
- **Eine Einstellung wirkt auch ohne Speicher:** erst den State setzen, dann schreiben; ohne
  gespeicherten Wert gilt die Vorgabe (Farbschema: Nachtbetrieb).
- Jeder Speicherort steht in `GERAETESPEICHER`: `frontend/src/offline/AGENTS.md`.
- Herleitung: `openspec/changes/archive/2026-10-06-lfh-942-browserspeicher-abgesichert/design.md`.

## Sitzung über mehrere Tabs (LFH-387)

Geschrieben wird nur über `apiSend`/`apiUpload` (tragen `X-Erwarteter-Benutzer-Id`, Server
antwortet bei fremder Kennung 412). Regeln: `frontend/src/auth/AGENTS.md`.
