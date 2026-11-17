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
- **Dashboard-Baukasten (Verteilung und Matrix)** (`components/Dashboard/`, Gruppe Flächen)
- **Schrift: Rollen der Skala und Feldetikett** (`components/Schrift/`, Gruppe Daten)
- **Datenraster mit DatenfeldEingabe und FeldFehler** (`components/Datenraster/`, Gruppe Daten)
- **StatusZelle, StatusChip und StatusTag** (`components/Status/`, Gruppe Status)
- **Kennzahl und Kennzahlenband** (`components/Kennzahl/`, Gruppe Daten)
- **Großbild: Kennzahl** (`components/GrossKennzahl/`, Gruppe Großbild)
- **Großbild: Zeilen** (`components/GrossZeile/`, Gruppe Großbild)
- **Segmentleiste** (`components/Segmentleiste/`, Gruppe Bedienung)
- **AlarmZeile „Was brennt“ (Einträge, Ruhe, unvollständig)** (`components/AlarmZeile/`, Gruppe Rückmeldung)
- **Sammelbanner** (`components/Sammelbanner/`, Gruppe Rückmeldung)
- **InlineAngabe (geschlossen, leer, offen)** (`components/InlineAngabe/`, Gruppe Bedienung)
- **Verbindungen (Funk und Telefon getrennt; Liste offen)** (`components/Verbindungen/`, Gruppe Bedienung)
- **Übungsmarke: Band und Marke** (`components/Uebung/`, Gruppe Status)
- **Sichtungsmarke (BBK)** (`components/Sichtung/`, Gruppe Status)
- **BearbeitbaresPaneel (offen und gesperrt)** (`components/BearbeitbaresPaneel/`, Gruppe Formular)
- **Speicherleiste** (`components/Speicherleiste/`, Gruppe Formular)
- **StammdatenFeld (aus Stammdaten oder frei)** (`components/StammdatenFeld/`, Gruppe Formular)
- **DokumentEntwurf (Bearbeiten und Lesefassung)** (`components/DokumentEntwurf/`, Gruppe Formular)
- **Frei und gesperrt** (`components/Gesperrt/`, Gruppe Bedienung)
- **Kopfaktion mit wechselndem Wortlaut (frei und gesperrt)** (`components/BreiteHalten/`, Gruppe Bedienung)
- **Dashboard-Baukasten (Abschnitte, Gliederung, Strom)** (`components/DashboardListen/`, Gruppe Flächen)
- **Tabellenkopf mit Sortieren und Filtern, Filterhinweis** (`components/Tabelle/`, Gruppe Daten)
- **Zeitdarstellung (taktisch und Datum mit Uhrzeit)** (`components/Zeitdarstellung/`, Gruppe Daten)
- **Zeiteingabe (Wert mit Schnellwahl, leer, unlesbar)** (`components/Zeiteingabe/`, Gruppe Formular)
- **Ortsfeld (leer, verortet, nur Text; Kartenbild nur in der App)** (`components/Ortsfeld/`, Gruppe Formular)
- **Alarmzone (gebündelt, aufgeklappt)** (`components/Alarmzone/`, Gruppe Rückmeldung)
- **Eingänge (Knopf im Kopf und Eingangsband)** (`components/Eingaenge/`, Gruppe Rückmeldung)
- **SichtungsWahl (BBK-Flächen, ohne und mit Wahl)** (`components/SichtungsWahl/`, Gruppe Fach)
- **Körperschema (Lesen)** (`components/Koerperschema/`, Gruppe Fach)
- **Taktische Zeichen (Einheit, Fahrzeug, Gefahr; Meldebildzeile)** (`components/TaktischeZeichen/`, Gruppe Fach)

## Nur im Code

Diese Werte liest das Format des Design Systems nicht; sie stehen nur im Repo:

- `farbenDunkel/farbenHell.markeGlut`: kein Farbwert (Nacht `0 0 12px 0 rgba(168, 7, 26, 0.55)`, Tag `0 0 10px 0 rgba(168, 7, 26, 0.3)`)
- `form.versalSperrung`: Sperrung der Versalien, `2.2px`
- `form.uebergang`: Übergang, `120ms cubic-bezier(0.2, 0.8, 0.2, 1)`
- `schriftskala (Sperrung, Versalien)`: ueberschrift -0.02em · uhr 0.04em · augenbraue 0.08em Versalien · railEtikett 0.04em Versalien · datenwertKlein -0.02em · datenwert -0.02em · datenwertGross -0.02em
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
- **Schrift: sechs Stufen, Rollen darüber** (LLH-1773/LLH-1775, Spec `schriftskala`, Change
  `i1o47voj-schrift-lesbarkeit`; umgekehrt 15.11.2026 gegenüber dem Neuentwurf): jede Größe am
  Schirm ist eine der `groessenstufen` in `theme/tokens.ts` (`fein` 11 · `klein` 12 · `text` 14 ·
  `titel` 16 · `wert` 22 · `gross` 32), nichts unter 11 px. `schriftskala` nennt je Rolle Stufe,
  Gewicht und Familie (`seitentitel` und `uhr` 16, `warnung` 14/600 für jeden Warnhinweis,
  `etikett`, `meta` …); CSS `--lfh-groesse-*`/`--lfh-typo-*`, deckungsgleich per
  `rollen.guard.test.ts`. Die Stufen bis `titel` wachsen mit der Dichte um 1 / 1,15 / 1,25
  (`--lfh-schrift-faktor`, `dichteFaktor`, LLH-1774), auch antds Schriftgrößen; `wert` und
  `gross` stehen fest. Gesetzt wird eine Größe nur über `schriftGroesse(stufe)`,
  `schriftStil(rolle)`, `zahlStil(stufe)` (`components/instrument/rollenwerte.ts`), den Baustein
  `Schrift`, antds `token.fontSize*` oder `var(--lfh-…)` in CSS; Rechnungen nehmen `schriftPx`.
  **Kein Größen-Literal** (`fontSize: 12`, `font-size: 12px`, `monoStil`), ohne Schuldmenge:
  Wächter `theme/schriftLiteral.guard.test.ts`. Ausnahmen nur Druckblätter (pt), die
  Fernsicht-Skala des Lagemonitors (`fernsicht`), die Großbild-Skala (`grossMass`, LLH-1747) und
  Zeichnungen mit eigenem Maßstab (Lagekarte, Fernmeldeskizze, taktische Zeichen).
- **Mono nur für Zahl, Zeit, Kennung und Funkrufname** (LLH-1777, Spec `schriftrollen`;
  umgekehrt 15.11.2026: der Neuentwurf setzte auch die Meta-Zeilen in Mono): `zahlStil` trägt
  Mono, Kennungen sind auch das Typwort der Zeitachse, `/typ`, Tastenkürzel, die Wortmarke und
  FMS-Kürzel. Text mit Wörtern steht in der Textschrift, auch gemischt („Stand 14:32“) und ganz:
  jede Rolle setzt `tabular-nums`. Funkrufnamen tragen `data-schrift="kennung"` (Messung
  `e2e/schrift-mono-grenze.spec.ts`).
- **Versalien nur in Köpfen, Feldetiketten gemischt** (LLH-1776, Spec `schriftrollen`;
  umgekehrt 15.11.2026): die `Augenbraue` benennt Paneelköpfe, Kennzahlen, Tabellenköpfe und
  Gruppen, das Rail-Etikett steht ebenso in Versalien. Ein Feld benennt das `Feldetikett`
  (`components/instrument/Feldetikett.tsx`: Stufe `klein`, `gedaempft`, ohne Sperrung);
  `Datenfeld`, `DatenfeldEingabe` und `FeldLabel` tragen es, die Augenbraue kennt `als="dt"` nicht.
- **Body und native Bedienelemente erben die Textschrift** (LLH-1772): `index.css` setzt sie an
  `html, body` und `font: inherit` an `button, input, textarea, select`; kein lokales
  `font: 'inherit'` mehr nötig. Wächter `theme/schriftReset.guard.test.ts`, Beleg
  `e2e/schrift-familie.spec.ts`.
- **Bausteine** in `components/instrument/` (Import über `index.ts`, Dateikopf nennt die Regel):
  `Augenbraue` (`als="h2…h6"`, nur Köpfe) · `Feldetikett` · `Schrift` · `Paneel`/`PaneelZeile` · `Formularpaneel` (Hülle im selben `<Form>`) ·
  `PaneelZustand` · `Kennzahl`/`Kennzahlenband` („Zahl führt") · `Aufgliederung`/`Balken` (nie
  Ersatz der Zahl) · `Zeitachseneintrag` · `StatusZelle`/`StatusChip` (`wort` Pflicht, Übersetzung
  nur in `statusFlaeche.ts`) · `Segmentleiste` (statt antds `Segmented`; `SegmentUmschalter` als ein
  Umschaltknopf daneben, LLH-1065; Wortlaut einzeilig; ein `\n` im `label` bricht ihn in zwei
  Zeilen, nur wo die Höhe sie trägt und einzeilig kein Platz bliebe: „Ohne\nSchicht“ der
  Ablösung im Handschuh-Betrieb auf dem Handschirm, LLH-1128) · `Sammelbanner` ·
  `Filterhinweis` (Band über einer gefilterten Liste, Achtungsrolle, Zahlen nur aus Serverzählungen, LLH-1071) ·
  `Schnellerfassungszeile` · `Datenraster`/`Datenfeld` (statt `Descriptions`) ·
  `DatenfeldEingabe` (Zelle im Bearbeiten-Modus: Etikett benennt die Eingabe, `Form.Item` ohne
  `noStyle`, der Prüffehler steht darunter, LLH-1101; nie `Form.Item noStyle` im `Datenfeld`) ·
  `BearbeitbaresPaneel` (Bearbeiten in der Ansicht, Paneel oder ganze Ansicht, LLH-1139; der
  einzige Baustein dafür, siehe „UI-Form-Leitlinie“) ·
  `FeldFehler` (Fehlerzeile unter einer Eingabe ohne `Form.Item`: `alarmText`, `data-fehler`, Ziel
  von `aria-describedby`; dieselbe Optik wie antds Formularmeldung) · `UebungsMarke`/`UebungsBand`
  (Kennzeichnung einer Übung, Regel unter „Rahmen“, „Übung“) · `AlarmZeile` („Was brennt“, LLH-1743,
  Regel im Dashboard-Baukasten) · `rollenwerte`/`useRollen` · Dashboard-Baukasten (unten).
- **Bausteine außerhalb von `instrument/`** (LLH-1147; Regel je am genannten Spiegelstrich):
  `anzeige/ZeitpunktEingabe.tsx` (Zeiteingabe) · `anzeige/ZeitAnzeige.tsx` (Zeitdarstellung) ·
  `anzeige/Ortsfeld.tsx`, im Einsatz `anzeige/EinsatzOrtsfeld.tsx` (Ortsfeld) ·
  `components/StammdatenFeld.tsx` (aus Stammdaten oder frei) · `components/VerbindungenFeld.tsx`
  und `components/FunkUndTelefon.tsx` (Verbindungen) · `components/InlineAngabe.tsx` ·
  `components/tabellenFilter.tsx` (Filterchips und Kopfmarke; Träger `KatalogTabelle`,
  `Datensicht`; Sortieren und Filtern in der Bedien-Leitlinie) · `alarm/EingaengeKnopf.tsx` und
  `alarm/Eingangsband.tsx` (Eingänge, Layout und Live) · `alarm/AlarmZone.tsx` (Alarmzone,
  Rahmen) · `personen/SichtungsWahl.tsx` ·
  `personen/koerperschema/Koerperschema.tsx` · `zeichen/EinsatzZeichen.tsx` (taktische Zeichen,
  am Schirm mit `useZeichenTheme`, LLH-1409) · `components/grossbild/` (Großbild am Bedienplatz,
  LLH-1747, Spec `grossbild-ansicht`: `GrossKennzahl`, `GrossZeile(n)`, Hülle `GrossbildFlaeche`
  mit Element-Vollbild, nur Ansehen; Größen nur über `grossMass`, Bezug 1920 × 1080 = Lagemonitor,
  mitwachsend über `min(vw, vh)`). Jeder hat eine Karte im Design System, außer der Hülle
  `GrossbildFlaeche` (Portal und Vollbild).
- **Seitenkopf** `components/EinsatzSeite.tsx` (`SEITENKOPF_HOEHE` 44 px, wächst mit der
  Staffel): `titel` als `h1` (16/600, Paneele ab `h2`), `meta` in der Textschrift, `aktionen` rechts (Primär blau
  gefüllt, sekundär umrandet); Meta + Datenstand unter `md` eigene Zeile, Datenstand hält vorab
  seine Breite. Kommt die Meta erst mit den Daten, hält `metaPlatzhalter` (ihre Form, Zahlen als
  `0`) ihre Breite, sonst brechen die Aktionen nachträglich um (LLH-1463). Wechselt eine Kopfaktion
  ihren Wortlaut mit den Daten (früher „Auflösen (noch 2 Personen)“, seit LLH-1722 im ⋮), hält
  `components/BreiteHalten.tsx` die Breite der breitesten Form (LLH-1627). `breite` Vorgabe `'voll'`, `'schmal'` nur für reine Formularseiten,
  `flaeche.seiteBreit` fällt beim Umbau.
- **Orientierung** (LFH-954, Spec `seiten-orientierung`): den Tab-Titel setzen nur die Rahmen über
  `components/useDokumentTitel.ts`, aus dem Modulnamen der Registry („Seite · Einsatz ·
  lifeline-hub“); keine Seite setzt `document.title`. Der Einsatzstatus steht nie im h1, sondern
  als `EinsatzstatusMarke` neben dem Titel, nur bei nicht aktivem Einsatz (Rahmenkontext
  `einsatz/EinsatzRahmenKontext.tsx`). Im Ortspfad kürzt unter `md` nur der mittlere Eintrag; im
  Einsatzrahmen steht unter `md` statt des Ortspfads nur der Rückweg „‹ <Eintrag>“ zum letzten
  verlinkten Eintrag unterhalb des Einsatzes (`lfh-ortspfad--einsatz`, LLH-1728).
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
  - **Stehenbleiben** (LFH-952, zjt7c073, LLH-1728, Spec `einsatztauglichkeit-layout`): der Kopf
    klebt in jeder Breite (`RAHMEN_KLEBT`, `data-lfh="rahmen-kopf"`), ab `lg` Rail-Kategorien und
    Modulpanel darunter; unter `md` klebt die Betriebszeile bei Störung (offline, Live `lost`) über
    dem Kopf, denn dort steht die Verbindung im Kopf nur als Symbol. Am Handy trägt der Einsatzkopf
    eine Zeile: Menü, Einsatzname, Alarmzentrale (Ruhe als Glocke, Störung im Wort), Verbindung,
    Uhr (umbrechen darf er nur in `handschuh` bei einer Störung im Wort der Alarmzentrale); Suche
    und Benutzermenü stehen dort im Drawer „Navigation“. Der App-Rahmen lässt unter `md` die
    Wortmarke weg, ihr Link liegt dann auf der Bildmarke. Herleitung:
    `openspec/changes/archive/2026-11-15-ejt520so-handy-kopfleiste-fixiert/design.md`. Der Fuß der Rail (Griff „Menü“,
    Einstellungen) klebt nicht: reicht die Höhe nicht, folgt er den Kategorien, statt sie zu
    verdecken (LLH-1273, `e2e/gate3-trefflaeche.spec.ts` „Rail“). Das Modulpanel ist eine Spalte
    mit festem Kopf und Fuß „Einsatzdauer“, nur die Liste rollt in sich (`modul-panel-spalte`);
    ihre Höhe ist gemessen (Oberkante im Fenster bis Fensterrand), und die Liste holt den aktiven
    Eintrag ins Bild.
  - **Der Seitenkopf klebt, wenn er passt** (zjt7c073 D3, `components/seitenkopfKleben.ts`): ab
    `md` auf jeder `EinsatzSeite` und `AdminPage`, solange Kopf und Seitenkopf höchstens ein
    Drittel der Fensterhöhe nehmen (`KLEBEN_HOECHSTENS`), nie in einem eigenen Scrollbereich
    (Gerätehülle) und nie mit `fensterInhalt` (dort ist `FensterRahmen` sein Containing Block).
    `kopfKlebt` setzt die Entscheidung von außen (nur das ETB). Es klebt nur die Leiste, nicht
    Hinweis oder Beschreibung darunter.
  - **Zwei Höhen** (zjt7c073 D2, `components/rahmenOben.ts`): `--lfh-kopf-oben` (`useKopfOben`)
    ist der Kopf samt Betriebszeile und Übungsband (Ebene `kopf`), `--lfh-rahmen-oben`
    (`useRahmenOben`) dazu der klebende Seitenkopf. Die Kopfhöhe nehmen nur, was neben dem Inhalt
    klebt (Rail, Modulpanel, Verwaltungsmenü), der Seitenkopf selbst und die Klebe-Entscheidungen;
    alles andere die Rahmenhöhe (Guard). Innerhalb der Ebene `kopf` stapelt sich der Rahmen nach
    Rang (`RAHMEN_RANG`: Betriebszeile, Kopf, Übungsband, Alarmzone; `useRahmenObenStapel`,
    LLH-1728, ADR-0056): jede Quelle klebt unter denen mit kleinerem Rang.
  - **Wer oben klebt, hängt sich unter den Rahmen:** `top: var(--lfh-rahmen-oben)` bzw.
    rc-tables `sticky={{ offsetHeader: useRahmenOben() }}` (`components/rahmenOben.ts`, gemessen,
    nie gerechnet), also auch unter den klebenden Seitenkopf. Ausnahme nur mit Vermerk
    `rahmen-oben: frei` und Grund (Guard `components/rahmenOben.guard.test.ts`). Den Fokusabstand
    trägt `scroll-padding-block-start` am Dokument (`index.css`), ausgesetzt bei Fokus im Rahmen;
    bei Fokus im Seitenkopf gilt nur die Kopfhöhe.
  - **Alarme stehen in der Alarmzone, nie über dem Inhalt** (LLH-1735, Spec
    `benachrichtigungen`, „Alarmzone verdeckt nichts“, Herleitung
    `openspec/changes/archive/2026-11-15-zu9ptja2-alarmzone/design.md`; löst LFH-1112 ab): Alarme, Org-Hinweise und
    die Unwetterwarnung zeichnet `alarm/AlarmZone.tsx` direkt unter Kopf und Übungsband, nie
    antds `notification` (`AntApp` trägt kein `notification`-Prop). Die Zone ist eine
    Rahmenquelle der Ebene `kopf` unter dem Übungsband (`useRahmenObenStapel` mit
    `RAHMEN_RANG.alarmzone`): Rail, Modulpanel und Seitenkopf kleben unter ihr. Sie schiebt den Inhalt
    und liegt auf `RAHMEN_EBENE` unter Drawer und Dialogen. Ab zwei Einträgen bündelt sie.
    Im Einsatz unter `md` trägt die Leiste am Handschirm die Alarme (`alarm/HandyLeiste.tsx`).
    ✕ blendet aus (`blendeAus`, sessionStorage je Tab), quittiert wird nur mit „Öffnen“ und
    „Gelesen“ (LLH-1736). Greifer `[data-lfh="alarmzone"]`, `[data-lfh="alarm-eintrag"]`;
    Nachweis `e2e/alarm-verdeckung.spec.ts`.
  - **Kopfleiste: der Name hat Vorrang** (LLH-1726, Spec `kopfleiste`): Rangfolge Einsatzname vor
    Suche vor Daueranzeigen. Ab `lg` gibt ein Raster dem Namen (Stufe `titel`, 16 / 18,4 / 20 px)
    seine Eigenbreite, bevor die
    Suche mehr als ihre Lupe bekommt (`kopfRasterSpalten`); die Umbruch-Basis hängt an der Dichte,
    nie am geladenen Namen. Ein Zustand ohne Handlungsbedarf steht in jeder Breite nur als
    Symbol, eine Störung ab `md` mit Wort (darunter trägt die Betriebszeile die Verbindung, die
    gebündelte Alarmzentrale nennt die vorrangige Störung). Einziger Breitenhalter: der Platz von „Ton blockiert“ am
    Glockenknopf ab `md`, weil der Browser den Ton vor der ersten Geste ohne Zutun sperrt (am Handy
    nicht, dort hätte die eine Zeile keinen Platz dafür, LLH-1728). Tastenhinweise
    nur bei feinem Zeiger. Die Wortmarke steht im Einsatz erst ab `xxl`.
  - **Übung** (LLH-1725, Spec `uebungsmarke`, Herleitung
    `openspec/changes/archive/2026-11-15-wc3kzd54-uebungsmarke-rahmen/design.md`): Jede Fläche, die einen Einsatz zeigt,
    kennzeichnet eine Übung (Rahmen, Gerät, Lagemonitor, Einsatzliste, Wechsler, Sprungpalette,
    Planungsübernahme, externes Lagebild, „Zurück zu …“, Tab-Titel, Druck, Lageplan-Anlage,
    Fernmeldeskizze).
    Entschieden wird nur über `isUebung` (`einsatz/einsatzart.ts`) aus der Einsatzart, nie aus dem
    Namen. Gezeigt wird am Bildschirm nur über `UebungsMarke`/`UebungsBand`
    (`components/instrument/Uebung.tsx`), auf Papier über Druckkopf, `DruckUebung` und Randfeld
    (`druck/AGENTS.md`), in Text- und Bildtiteln als Präfix „ÜBUNG · “ (ADR-0053). Erkennbar ist sie
    an Form und Wort (schraffiertes Band, gefüllter Chip, immer „ÜBUNG“), nicht am Farbton: violett
    sind auch die ETB-Entscheidung, die Abschnittsflächen und das Führungscluster der Lagekarte. Das Band steht direkt unter dem Kopf und klebt in jeder Breite unter den übrigen
    Quellen der Kopfhöhe, über einem klebenden Seitenkopf (`useRahmenObenStapel`). In einer Hülle fester Höhe (Gerät) klebt es nicht.
  - **Sprunglink zum Inhalt** (nufmon70, Spec `einsatztauglichkeit-layout`, „Ein Sprunglink führt
    zum Inhalt“, WCAG 2.4.1): einmal in `BetriebsLayout` (`App.tsx`), vor der Betriebszeile
    (`components/SprungZumInhalt.tsx`); die Hilfe liegt außerhalb und bindet ihn selbst ein. Jeder
    Rahmen markiert sein Ziel mit `sprungzielInhalt` (`data-lfh="sprungziel-inhalt"`,
    `tabIndex -1`), der Link nimmt das letzte in DOM-Reihenfolge: das `main` von Einsatz, Ebene 1
    und Hilfe, in der Verwaltung den Inhalt neben dem Menü (ein `div`, kein zweites `<main>`). Ein
    neuer Rahmen markiert sein Ziel mit (Wächter `components/SprungZumInhalt.rahmen.test.tsx`). Ohne
    Fokus aus dem Bild, mit Fokus `fixed` oben links über `RAHMEN_EBENE` (`.lfh-sprung-inhalt`, von
    den Fokusabständen in `index.css` ausgenommen). Die Gerätehülle hat keinen. Nachweis
    `e2e/sprung-zum-inhalt.spec.ts`.
  - **Modulpanel:** `navPersistenz` ist dreiwertig; ohne Wahl zwischen `lg` und `xl` zu, ab `xl`
    offen. Eine Wahl schreiben nur der Griff „Menü“ und der Selbstklick, nie ein Rail-Sprung.
- **Modulstruktur** (`einsatz/modulRegistry.ts`): Startseite **Führung · Überblick**
  (`redirectZiel()`); ETB direkt dahinter, Aufträge/Befehle unter Führung (y3zh5ymv D10). Das
  Kräftemodul heißt sichtbar **Kräfteübersicht** (y3zh5ymv D7, löst LFH-965 D1 ab), **Schlüssel
  und Route bleiben `kraefteuebersicht`**; „Sachverhalt / Meldebild“ der Einsatzdaten ist der
  Leitstellenbegriff und bleibt.
- **Synonyme** (y3zh5ymv D2): `ModulEintrag.schlagworte` trägt Abkürzungen, Alltagswörter und
  frühere Namen; die Sprungpalette sucht darüber, sichtbar sind sie nirgends. Wer ein Modul
  umbenennt, legt den alten Namen dort ab.
- **Ein Name je Modul** (LFH-965, Spec `modul-benennung`): Menü, Sprungpalette, h1, Ortspfad und
  Tab tragen das `label` der Registry, Seiten holen es über `modulName(key)`, nie als Literal.
  `beschreibung` ist die zweite Zeile in Modulmenü und Sprungpalette: wenige Fachwörter, kein
  Satz, keine Bedienung (Guard in `modulRegistry.test.ts`). Ausnahmen nur für Detailseiten,
  Paneel- und Bereichsnamen.
- **Keine erfundenen Daten:** was ohne Datenquelle ist, wird weggelassen (Epic LFH-606…617),
  trägt sein Ticket im Code-Kommentar und wird als **Abwesenheit** getestet. Eingelöst:
  Evakuiert (LFH-607, `openspec/changes/archive/2026-09-29-lfh-607-kennzahl-evakuiert/`), Pegel auf Platz 1
  (LFH-606), Rückmeldung (LFH-610), ETB-Zählung (LFH-612).
- **Kennzahlenband** (LFH-640): „Lage in Zahlen“ hat immer sechs Plätze (vier Kern, zwei Lage); der
  Führungsstand des Überblicks nur seine Handlungszahlen (LLH-1743). Jede Kennzahl hat einen
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
  Warnstufe ist keine Kennzahl). Darunter, vor jedem Band, auf Überblick, Lagebild und Lagemonitor
  die **Alarmzeile „Was brennt“** (`AlarmZeile`, LLH-1743, Spec `lage-alarmzeile`): Einträge,
  Folge und Wortlaut nur aus `lage/wasBrennt.ts`, auf den Übersichten über `lage/useWasBrennt.ts`,
  am Monitor über `lage/alarmAusMonitor.ts`; feste Höhe, „Nichts brennt“ nur bei vollständigen
  Quellen, Sprungziele aus `lage/alarmZiel.ts`. Sie zeigt Zustände, die Alarmzone Ereignisse; keine
  Seite baut eine zweite Sammlung. Reihe 1: `Kennzahlenband` (Regel oben; sechs Plätze im Band
  „Lage in Zahlen“ des Lagebilds, der Überblick trägt den „Führungsstand“ mit drei Handlungszahlen).
  Reihe 2: eine oder mehrere `PaneelReihe` mit je bis zu drei Paneelen (`1fr 1fr 1.1fr`, unter
  `lg` gestapelt) in der `DashboardFlaeche` (Fugenraster). Ein Kopf über einer Vergleichstabelle
  (Meldebild) ist nur eine Paneelreihe mit `dichte="kompakt"`, ohne Band, ohne Füllkachel; eine
  Einzelzahl darin (Rückmeldung) ist eine `Kennzahl` mit Sprung. Reihe 3, wo es sie gibt: Fußband
  „Stand“ des Lagebilds (Lagebericht, UHS aktiv) als `Kennzahlenband` mit `groesse="klein"`. Jedes Paneel geht durch
  `DashboardPaneel` (Augenbraue, Zähler als Meta, Sprung „… ↗“, `PaneelZustand`; `gesperrt` nennt
  den Grund, ohne Sprung und Leeraktion) und ist einer der Typen `VerteilungsPaneel` (Zahl +
  Anteilsbalken je Kategorie: Sichtung, FMS-Status), `MatrixPaneel` (Stufenmatrix: Gefahren),
  `StromPaneel` (Zeitachseneinträge mit Sammelbanner), `ListenPaneel` (kurze Liste mit
  „n weitere ↗“) oder `GliederungsPaneel` (Teile mit Lagekante, Kopf, Zahlspalte). Mehrere kurze
  Listen in einem Paneel sind `ListenAbschnitt`e (LLH-1145, „Offene Vorgänge“): je Überschrift,
  Zahl vom Aufrufer, Notiz, höchstens drei Einträge, „alle ↗“; ein Abschnitt fällt nie weg, auch
  leer („keine“), gesperrt („—“ mit Grund), ausgefallen oder „ohne Netz nicht geladen“. Laden, Fehler,
  Leer und Gesperrt sehen verschieden aus; eine unbekannte Zahl steht als „—“, nie als 0. Balken
  ergänzen die Zahl, nie ersetzen sie; Farben kommen aufgelöst vom Aufrufer, der Baustein trägt
  keine Statuskarte. Ein neuer Paneeltyp kommt als Baustein hierher, nicht lokal in eine Seite.
- **Rollen der Übersichten** (LLH-1743, Spec `lage-verdichtung`, „Überblick führt, Lagebild zeigt
  die Lage“): der Überblick sagt, was zu tun ist (Aufträge, Meldungen, Abschnitte, offene
  Vorgänge, nächste Marken, Entscheidungen), das Lagebild, was los ist (Betroffene, Kräfte,
  Vermisste, Gefahren, Sichtung, Einsatzdauer, Lagebericht, UHS). Eine Kennzahl steht auf genau
  einer der beiden Seiten; nur die Alarmzeile steht auf beiden. Beide verweisen im Seitenkopf
  aufeinander. Herleitung: `openspec/changes/archive/2026-11-16-t9jjrajy-alarmzeile-was-brennt/design.md` (D8).
- **Eine Heimat je Zahl** (LFH-550,
  `openspec/changes/archive/2026-09-30-lfh-550-lagebesprechung-eine-verdichtung/design.md`):
  Aufträge und Meldungen (offen, in Arbeit, überfällig = davon überfällig, Bestätigung überfällig,
  Sofort- und dringende Meldungen offen samt Eingang der ältesten, LLH-1743),
  Nachforderungen (offen, je Stufe, überfällig; LLH-1145), Erinnerungen (fällig) und Lagemeldungen
  (neu) nur aus dem Modulzähler (`pages/lage-dashboard/fuehrungsZahlen.ts`), nie aus einer Liste
  gezählt; Betroffene/SK über `verdichtePersonen` (→ `sichtungsbild`), Kräfte über `verdichte`,
  Warnstufe über `verdichteGefahrengebiete`, Material-Ausfall (Posten mit Statusrolle Alarm oder
  Achtung) über `kraefte/materialVerdichtungKern.ts`. Ausfall einer Einheit (Mittel, Material) nur
  über die Gründe der Tönung des Meldebilds (`toenungsGruende`, gelesen über
  `lage/ausfallJeEinheit.ts`); der Überblick summiert sie je Abschnitt, die Alarmzeile nennt die
  Einheiten. Die Rückmeldung eines Abschnitts urteilt je Einheit des Teilbaums, nie über die
  jüngste Meldung allein (LLH-1739, `abschnittGruende`). Stärke einer Menge nur über `summiereStaerke`
  (Wurzeln der Menge), Formatierung nur `anzeige/staerke.ts:staerkeText`. Ein Abschnitt zählt, wer in
  ihm steht (LLH-1744): Stärke nur über `abschnittStaerken` (eigene Stärke `ist` je aktiver Einheit
  beim wirksamen Abschnitt), seine Einheiten nur über `einheitenImAbschnitt`, dieselbe Menge. „Kräfte“
  sind Köpfe, Fahrzeuge zählen eigens; Kräfte an UHS nur an aktiven UHS (`countsKraefteAnUhs`,
  Lagebild und Lagemonitor). Belegung eines Bereitstellungsraums (LLH-1095, Spec
  `bereitstellungsraum-belegung`): Fahrzeuge, Einheiten und längste Wartezeit nur aus `belegung`
  des Servers (Liste, Detail und Lagekarte), Stärke im Raum nur über `staerkeImRaum`
  (`bereitstellungsraum/brZahlen.ts`; nur Einheiten im Raum mit ihrer eigenen Stärke, LLH-1289); „noch n belegt“ vor dem Auflösen zählt wie
  `aktive_belegungen_tx` (Einheiten und einheitenlose Fahrzeuge). Lage einer UHS (In der Stelle,
  Plätze frei, Wartend, Unterwegs; LLH-1136, LLH-1332) nur über `pages/uhs/uhsLage.ts`, aus denselben
  Mengen wie der Grundriss. Einheiten ohne Schicht (Seite Ablösung, Sprung im Überblick; LLH-1312) nur
  über `abloesung/ohneSchicht.ts:findOhneSchicht`, aus denselben Fächern. Dashboard und Vorbereitung der Lagebesprechung teilen `useLagebild` +
  `baueLagebild`. Regeln beider Sprachen pinnt `tests/fixtures/verdichtung/regeln.json`
  (`tests/verdichtung_fixture.rs`, `lage/verdichtungFixture.test.ts`).
- **Eine Baumlogik der Kräfte: `kraefte/kraeftebaumKern.ts`** (LLH-1025, Spec `kraeftebaum`).
  Einheit → Untereinheiten, je Einheit Fahrzeuge mit Besatzung, „Ohne Fahrzeug“, Material; jede
  Kraft genau einmal, Elternstärke über `accumulateStaerke`. Meldebild (`meldebildRaster.ts`) und
  Lagebericht-Text (`kraeftebild.ts`) bilden den Kern nur ab; ein neuer Abnehmer baut keinen
  eigenen Baum. Meldebild, Kräftebild und Organigramm lösen abgestellte Untereinheiten (eigener
  Abschnitt ungleich dem der Obereinheit) über `detachAbgestellte`/`abgestelltVon` vom Verband,
  „aus <Obereinheit>“ (LLH-1744); Einheiten-Gliederung, FMS-Tableau, Funkplan und Fernmeldeskizze
  (`baueFuehrungsorganisation(…, { detachAbgestellte: false })`) behalten den Verband.

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
  `Segmented`, eigene `Segmentleiste`) eine Strichlinie nach innen (`index.css`, `sprache.css`).
  Gestrichelt heißt nur gesperrt: die Knopfvariante `dashed` ist gesperrt
  (`theme/gesperrtZeichen.guard.test.ts`).

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
- **Ein `<Space>` in `aktionen` nennt seinen Abstand** (LLH-1273): ohne `size` stehen die Knöpfe
  3 / 5 / 7 px auseinander, auch im Seitenkopf, dessen Hülle selbst `marginSM` hält. Vorgabe
  `size={token.marginSM}` (7 / 11 / 16); Wächter `components/aktionenSpace.guard.test.ts`.
- **Rot steht nicht bündig neben Neutralem:** `<Space>` mit `danger` und weiterer Aktion trägt
  `size="middle"` (`aktionsabstand.guard.test.ts`). Dialogfüße halten dieselbe Stufe (LFH-653,
  11/18/26 px, Leitlinie ≥ 8 / ≥ 16): der Fuß der Erfassungs-Hülle über `size="middle"`, antds
  eigene Füße (Modal, `modal.confirm`, `Popconfirm`) über eine Regel in `index.css` mit
  `var(--ant-padding)`. **Kein Komponenten-Token `marginXS`:** jeder antd-Knopf setzt die Variable
  mit seiner `css-var-…`-Klasse zurück, die Überschreibung kommt am Knopf nie an (gemessen 7 px).
  Nachweis `e2e/dialogfuss-dichte.spec.ts`, `e2e/dokumente.spec.ts`.
- **Destruktiv ist nicht gleich destruktiv** (LFH-363): Umkehrbares („Außer Dienst",
  „Deaktivieren", eine gelöste Zuordnung) → Abstand + `danger`, keine Rückfrage; Unumkehrbares →
  Rückfrage, `Popconfirm` mit `okButtonProps={{ danger: true }}` und benanntem `okText`. **Im
  ⋮-Menü ist nur Unumkehrbares rot** (LLH-1722, D2): ein Lösen, Entlassen oder Austragen mit
  Rückgängig steht neutral unter den umkehrbaren, `gefahr` nur für Stornieren, Auflösen und
  Ähnliches (Wächter `components/menueFarbe.guard.test.ts`). In der Zeile trennt der rote Knopf,
  im Menü der Trenner.
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
  die wirkliche Sichtbarkeit. Eine Seite mit eigener Werkzeugzeile (Meldebild) hängt ihn dort ein:
  Zustand aus `useSpaltenSchalterZustand`, an die Sicht als `spaltenSchalterAussen` (LLH-1417);
  sein Fokus hält die Zeilenschleuse nicht, die Werkzeugzeile der Sicht bleibt Standzeile des
  Sammelbanners. Sonst bleibt der eingebaute Schalter.
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
- **Eine sortierbare Kopfzelle sortiert nur über ihren Inhalt** (LLH-1273): antd hängt den Klick
  an die ganze Zelle, zwei sortierbare Köpfe stießen ohne Lücke aneinander. `KatalogTabelle` hält
  einen Klick in die Polsterung an (`polsterKlickRiegel`), der Inhalt reicht senkrecht bis an den
  Zellrand und auf `controlHeight` (`sortierKopfStyle`, `theme/sprache.css`); die Polsterung trennt
  die Spalten. Nicht über `pointer-events: none`: unter einer fixierten Zelle fiele der Tipp auf
  die verdeckte Spalte. Unit-Tests klicken über `sortTarget` (`test/utils.tsx`). Nachweis
  `e2e/gate3-trefflaeche.spec.ts` „Personal (LLH-1273)“.
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
- **Der Zoom ist frei, der Doppeltipp nicht** (LLH-1774, Spec `schriftskala`; umgekehrt
  15.11.2026 gegenüber LLH-1328 „Kein Zoom wie in einer App“): der Viewport in `index.html` nennt
  weder `maximum-scale` noch `user-scalable=no`, `html` in `index.css` sperrt nur den Doppeltipp
  (`touch-action: manipulation`). iOS zoomt beim Fokus nicht, weil ein Feld in `komfortabel`
  14 × 1,15 = 16,1 px misst; in `kompakt` auf dem iPhone ist der Fokus-Zoom hingenommen. Wächter
  `theme/zoomFrei.guard.test.ts`.
- **Die Stufe folgt dem Gerät, nie der Person** (LFH-724, Spec `bedien-dichte`): beim Start
  gespeicherte Wahl → Zeigerart (grob → `komfortabel`) → `kompakt`, nur in
  `theme/dichte.ts:startDichte`, gespiegelt im Bootstrap-Skript von `index.html` (setzt
  `data-dichte` vor dem ersten Bild, LLH-1774) — immer beide ändern, `theme/dichte.test.ts` führt
  das Skript gegen `startDichte` aus; `handschuh` nur auf Wahl, kein Zuhörer auf die Zeigerart,
  kein Import aus Einsatz, Rolle oder Funktion (`theme/dichteQuelle.guard.test.ts`). Browser-Beleg
  `e2e/dichte-ableitung.spec.ts`; Flächenmessung der Modul-Prüflisten
  `e2e/trefflaeche-pruefflaechen.spec.ts`, Messhelfer in `e2e/trefflaeche-kern.ts`.
- **Der Navigationsrahmen hat keine Dichte-Ausnahme** (LFH-384): die 48 ist Boden, nie Deckel
  (`Math.max(48, controlHeight)`, Griffe über `navGriffMass`); die Rail-Spalte wächst mit
  (`railBreite` in `components/Kopfleiste.tsx`, mit der Schrift: 64 / 74 / 80 px, LLH-1774).
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
- **Meldung und Lage** (LLH-1046, Spec `bedien-wortlaut`; Begriffe in
  `docs/design/2026-10-21-meldungsmodell/README.md`): das Modul heißt „Meldungen“ (Eingang und
  Ausgang), „Lagemeldungen“ ist die Sicht auf die lagerelevanten Meldungen. Eine Meldung anderer
  Art wird „In die Lage übernommen“ (Aktion und Dialog „In die Lage übernehmen“, Rückmeldung,
  Hinweis, ETB-Eintrag), ihr Etikett ist „In der Lage ✓“; „übergeben“ steht dafür nie. Der
  ETB-Typ „Lage“ heißt in der Mehrzahl „Lagefeststellungen“, nie „Lagemeldungen“. Das Paneel des
  Lagebilds mit ETB-Einträgen heißt „Jüngste ETB-Einträge“.

## Zeitdarstellung

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
  `.format('…')` und kein `formatiere(…, '…')` mit `HH`/`mm`/`DD`/`YYYY` außerhalb von `anzeige/`
  (Maschinenformate ab `YYYY-MM-DD` ausgenommen); Wächter `anzeige/zeitDarstellung.guard.test.ts`,
  Schuldmenge `OFFEN` seit LLH-1061 leer. Titelvorschlag und Startinhalt eines Lagevortrags werden
  gespeichert und nehmen `konventionenOhneGeraet` (Einsatz vor Organisation, ohne Gerätewahl, wie
  Druck und Servertexte; LLH-1437); ein Eingabefeld zeigt seinen Wert taktisch. Nebenformen im Kern:
  `datum`/`kalendertag` (Tag ohne Uhrzeit, `10okt26` bzw. `10.10.26`), `uhrzeitOhneDatum`
  (Wanduhrzeit `HH:MM` ohne Tag: Verpflegungsplan, Wechselzeiten), `tagUndUhrzeit` (Anfang eines
  Zeitraums), `leereUhrzeit` (Lücke in Ziffernbreite); „heute“ einer Nebenzeit (Nachtrag, Übergabe,
  Zeitraumende) über das `jetzt` von `zeitKurz`. Der Datenstand rechnet in Gerätezeit
  (`components/Datenstand.tsx`), die Uhr des Lagemonitors nimmt `formatiereUhr` der Kopfleiste.
