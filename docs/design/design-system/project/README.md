# Lifeline Hub — Design System

Aus dem Code erzeugt. Quelle der Wahrheit ist das Repo `rubenvitt/lifeline-hub`: Farbrollen,
Paletten, Schrift und Dichten aus `frontend/src/theme/tokens.ts` und
`frontend/src/theme/schriften.ts`, die Regeln unten aus `frontend/AGENTS.md`, die Vorschauen
aus den echten Bausteinen (mit dem antd-Theme der App gerendert). Neu erzeugt mit
`mise exec -- pnpm -C frontend design-system`. **Änderungen auf dieser Seite werden beim nächsten
Veröffentlichen überschrieben**; geändert wird im Repo.

Zwei Themen: **Nacht** (Vorgabe der App, zuerst) und **Tag**, aus der Nachtpalette
abgeleitet. Radius 0, Archivo für Text, JetBrains Mono für jede fachliche Zahl. Dichte-Staffel
kompakt · komfortabel · Handschuh (Steuerhöhe 30 / 48 / 72 px); die Vorschauen zeigen
`kompakt`. Pfade ohne Präfix in den Regeln sind relativ zu `frontend/src/`.

## Bausteine

- **Paneel** (`components/Paneel/`, Gruppe Flächen)
- **Datenraster mit DatenfeldEingabe und FeldFehler** (`components/Datenraster/`, Gruppe Daten)
- **StatusZelle, StatusChip und StatusTag** (`components/Status/`, Gruppe Status)
- **Kennzahl und Kennzahlenband** (`components/Kennzahl/`, Gruppe Daten)
- **Segmentleiste** (`components/Segmentleiste/`, Gruppe Bedienung)
- **Sammelbanner** (`components/Sammelbanner/`, Gruppe Rückmeldung)
- **InlineAngabe (geschlossen, leer, offen)** (`components/InlineAngabe/`, Gruppe Bedienung)
- **Sichtungsmarke (BBK)** (`components/Sichtung/`, Gruppe Status)
- **Speicherleiste** (`components/Speicherleiste/`, Gruppe Formular)
- **DokumentEntwurf (Bearbeiten und Lesefassung)** (`components/DokumentEntwurf/`, Gruppe Formular)
- **Frei und gesperrt** (`components/Gesperrt/`, Gruppe Bedienung)

## Nur im Code

Diese Werte liest das Format des Design Systems nicht; sie stehen nur im Repo:

- `farbenDunkel/farbenHell.markeGlut`: kein Farbwert (Nacht `0 0 12px 0 rgba(168, 7, 26, 0.55)`, Tag `0 0 10px 0 rgba(168, 7, 26, 0.3)`)
- `form.versalSperrung`: Sperrung der Versalien, `2.2px`
- `form.uebergang`: Übergang, `120ms cubic-bezier(0.2, 0.8, 0.2, 1)`
- `schriftskala (Sperrung, Versalien)`: ueberschrift -0.02em · augenbraue 0.14em Versalien · railEtikett 0.06em Versalien · datenwertKlein -0.02em · datenwert -0.02em · datenwertGross -0.02em
- `--lfh-abdunkelung (theme/rollen.css)`: Deckschicht des Helligkeitsreglers, keine Farbrolle

## Gestaltungssprache

Neuentwurf „Instrumententafel“ (22.09.2026)

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
  `FeldFehler` (Fehlerzeile unter einer Eingabe ohne `Form.Item`: `alarmText`, `data-fehler`, Ziel
  von `aria-describedby`; dieselbe Optik wie antds Formularmeldung) · `rollenwerte`/`useRollen`.
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
  per Messwert; Neuzuschnitt während der Betrachtung als Sammelbanner
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

## Farbachsen

(Vertrag `theme/statusFarben.ts`)

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

## Farbe und Zeichen

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

## Dichte und Bedienziele

- **Tabelle nur, wenn verglichen wird**: stehende Kopfzeile, fixierte **menschenlesbare** Kennung
  (nie DB-`id`), Spaltenschalter **mit Zähler ausgeblendeter Spalten**. Auf schmalem Schirm
  **angepasst, nicht in Karten aufgelöst**. Träger `KatalogTabelle`/`Datensicht`.
- Spaltenschalter: `components/SpaltenSchalter.tsx` (eine Wahrheit für Handwahl und `abBreite`);
  in `KatalogTabelle` nur per Opt-in `spaltenSchalter={{ bezeichnung }}`, `Datensicht` setzt es
  nie. Antds `responsive`/`hidden` gesperrt (`katalogTabelle.guard.test.ts`). Das Häkchen zeigt
  die wirkliche Sichtbarkeit.
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

## Texte: zeigen statt erklären

(LFH-1078)

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

## Begriffe

- **Voreingestellte Werte heißen „Vorgabe“** (LFH-944, Spec `bedien-begriffe`): nie „Default“,
  „Fallback“ oder „Standard“ im sichtbaren Text. Platzhalter nennen den Wert, der leer wirklich
  gilt; kein „Leer = …“-Satz daneben (LFH-1078). Bausteine in `components/vorgabeText.ts`
  („… (Vorgabe)“, „Vorgabe der Organisation: …“), Wächter `components/vorgabe.guard.test.ts` mit Ausnahmeliste
  für Eigennamen („Standard-Rufname“, „Standardansicht“).
