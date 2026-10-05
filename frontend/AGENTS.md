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
  (`docs/superpowers/specs/2026-09-23-lfh-640-lagebezogene-kennzahlreihe-design.md`). Die Fuge
  bleibt in jeder Dichte 1 px; eine klickbare Zelle rückt ihren Link um 0 / 4 / 8 px ein
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
- **Organigramm der Führungsorganisation** (LFH-626, `pages/einsatzabschnitte/Organigramm.tsx`,
  `openspec/changes/archive/2026-10-01-lfh-626-fuehrungsorganisation-skizze/design.md`): Ansicht
  `?ansicht=organigramm` der Seite Einsatzabschnitte, kein Modul; rein abgeleitet über
  `baueFuehrungsorganisation` (Platzierung und Schlüssel wie der Funkplan; Vorlage für Auto-Layout
  und Fokusfolge der Fernmeldeskizze LFH-893); Stärke je Abschnitt nur über `abschnittStaerken`, die Wurzel
  „Einsatzleitung“ trägt keine Zahl; Stab nur mit Stab-Freigabe. Layout und Druckregeln nur über
  das Gerüst `components/organigramm/HaengenderBaum` (erste Ebene als Spalten-Grid,
  `SPALTE_MIN_PX` gemessen, tiefer senkrecht) — keine
  Graph-Bibliothek, kein zweites Gerüst. **Live-Zufluss nur über die Schleuse des Gerüsts**
  (LFH-867, `components/organigramm/baumSchleuse.ts`,
  `openspec/changes/archive/2026-10-04-lfh-867-organigramm-zufluss-schleuse/design.md`): Zeiger
  (ohne Touch) oder Fokus im Baum halten Menge, Ort und Folge der Knoten, Inhalt fließt;
  Entfallenes bleibt als Platzhalter ohne Link, der Kopf steht still; Banner in der Standzeile
  fester Höhe; im Druck gilt sie nicht. Kein Nutzer baut eine eigene.
- `Datensicht` bricht fest bei `md`; die Prop `tabelleAb` hält `datensicht.guard.test.ts` fern.
  `naechste_lagebesprechung_at` = absolute Wiedervorlage-Schnellwahl, kein berechneter Rhythmus
  (`docs/superpowers/specs/2026-09-08-lfh-463-464-pruefliste.md`).
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
  kritisch `alarm`; nicht beurteilt = leeres Feld. Nur der Wechsel schreibt System-ETB.
  Fortschritt manuell (leer ≠ 0 %); Überblick meldet schlechtere Unterabschnitte („UA kritisch").
- **Sichtung ist eine eigene Achse nach BBK** und die Ausnahme vom Neuentwurf:
  `SichtungsTag`/`sichtungsfarben`, umrandetes Farbfeld, SK I rot, II gelb, III grün, IV blau,
  Tote schwarz, „unverletzt" ohne Farbe; die Umrandung macht Gelb auf hellem und Schwarz auf
  dunklem Grund sichtbar. Nie `color="black"` an antds `Tag`; nie `color="blue"` (LFH-891, Spec
  `farbrollen-kontrast`, Guard 3 in `theme/statusVertrag.guard.test.ts`): eine Kennzeichnung
  ohne Status (ad-hoc, Rolle, Kennung) ist neutral wie die Demo-Marke, Blau bedient.
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

**Lagekarte** (auch `pages/LagekartePage.tsx`): `frontend/src/pages/lagekarte/AGENTS.md`.

**Sprungmarken sind keine Module** (LFH-620, `einsatz/sprungmarken.ts`): Entscheidungen = ETB
`?typ=entscheidung`, Patienten = Personen im Sichtungsraster, Vermisste = Personen
`?filter=vermisst`. Kein Registry-Eintrag, kein `verweistAuf`; Marke erbt Sichtbarkeit/Sperre,
nie `aria-current`, Ziel im zugänglichen Namen, Pfad aus `routing/deeplinks.ts`;
`parsePersonenSicht`/`sichtNachSprung` apply-then-clean. Kein Filterwert „patienten".

**Stab** (Funkplan S6, Checkliste Arbeitsaufnahme, Vorbereitung der Lagebesprechung, Presse und
Medienarbeit S5; auch `pages/StabPage.tsx`, `pages/FunkplanPage.tsx`, die S5-Seiten, `src/stab/`,
`src/presse/`, `src/infotelefon/`): `frontend/src/stab/AGENTS.md`.
**Führungsfunktionen** (Katalog, Codespalte neben Freitext, Besetzung zur Lesezeit; auch
`src/fuehrung/`): `frontend/src/fuehrung/AGENTS.md`. **Betreuung und Verpflegung** (auch
`pages/VerpflegungPage.tsx`, `src/betreuung/`, `src/verpflegung/`): `frontend/src/betreuung/AGENTS.md`.
**Kräfte-Zeitachse** (Einsatzdauer im Meldebild, Personal und Einheit-Detail; auch
`src/zeitachse/`, Status-Kataloge mit `zeitachse_marke`): `frontend/src/kraefte/AGENTS.md`.

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
  (`pages/lagekarte/Sidebar.tsx`, `e2e/lagekarte-leiste-dichte.spec.ts`).
- **Klappkopf** (LFH-653): jedes `Collapse` bekommt den Boden über den Kontext
  (`antdKlappkopf(dichte)` in `theme/tokens.ts`, `collapse` am `ConfigProvider`: `minHeight`
  30/48/72 + Mittellage); antd rechnet den Kopf sonst aus der Schrift (36/45/55). Kein lokales
  `styles.header` je Stelle. Nachweis `e2e/dokumente.spec.ts` „Dichte-Staffel“.
- **Beschriftetes Kästchen** (LFH-907): jede `Checkbox` mit Text bekommt den Boden über den
  Kontext (`antdKaestchen(dichte)`, `checkbox` am `ConfigProvider`: `minHeight` 24/48/72 am Label
  und Mittellage); antd hat dafür kein Token, das Label wäre nur so hoch wie die Schrift
  (21,5/36). Ohne Text (antds Tabellenfilter) kein Boden; im Menüeintrag hebt
  `style={{ minHeight: 0 }}` ihn auf, dort ist der Eintrag das Ziel (`SpaltenSchalter`).
  Nachweis `e2e/trefflaeche-pruefflaechen.spec.ts` (C7, C13).
- **Handgebautes Bedienziel** (LFH-365): `minHeight: token.controlHeight` **plus** `padding` aus
  `token.paddingSM`/`token.padding` (aufgelöste Tokens, nie `var(--lfh-*)`), geprüft über eine
  reine exportierte Stilfunktion (`bedienzielStil`) mit Böden als **Literalen**. **Ein `<a>` erbt
  keine Steuerhöhe.** Gate 3 je Route: `e2e/gate3-trefflaeche.spec.ts`. Kennungs-Links in
  Tabellen-, Listen- und Zeitachsenzeilen tragen den Boden über `components/kennungsLink.tsx`
  (`KennungsLink`, LFH-908), ohne eigene Polsterung: die trägt die Zelle.
- **Die Brotkrume hat keine Dichte-Ausnahme** (LFH-909): jeder Link im Ortspfad des Seitenkopfs
  hält die Staffel über `ortspfadStil` (`components/EinsatzSeite.tsx`) und die Pfad-Link-Regel in
  `EinsatzSeite.css`, durchsichtiger Rand statt Schrift (bleibt 12 px). Die CSS liest
  `--lfh-ortspfad-ziel`, die Stilfunktion setzt dort den aufgelösten Token, kein `var(--lfh-*)`
  der Dichte. Seiten geben nur ihre `Breadcrumb` hinein, kein eigener Boden je Seite.
- **Tastenkürzel als Marke** (LFH-335), nie nacktes `<kbd>`: `components/Tastenkuerzel.tsx`
  (Flex mit `gap`, `currentColor`, **kein** `controlHeight`-Boden; `tastenkuerzelStil` pinnt die
  Abwesenheit).

**Sprungpalette**: `frontend/src/command-palette/AGENTS.md`.

**Aktionen**

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
  Fokusrückgabe beider Primitive steht in `components/useFokusRueckgabe.ts`.
  Einsatzdaten: eine Zeile schickt EIN Feld (`patcheEinsatz`), Bezeichnung und Koordinate nur
  im Vollformular.
- **Zeiteingabe in der Anzeigezone** (LFH-692, Spec `zeiteingabe`,
  `openspec/changes/archive/2026-10-01-lfh-692-zeiteingabe-anzeigezone/design.md`): jede Zeiteingabe nimmt
  `anzeige/ZeitpunktEingabe.tsx` (`ZeitpunktEingabe`, `ZeitraumEingabe`), nie antds `DatePicker`;
  der Formularwert ist ein **Zeitpunkt** (hin `alsZeitpunkt`, zurück `alsBackendZeit`, Kern
  `anzeige/zeitEingabe.ts`), in die Wanduhr der Anzeigezone wandelt nur das Feld. Tagesgrenzen
  über `keineZukunftstage`/`tagInZone`, Uhrzeiten in Texten über `useZeitEingabe().formatiere`;
  `.local()` steht nur in `anzeige/` (Guard `anzeige/zeitEingabe.guard.test.ts`). Außerhalb eines
  Einsatzes `OrgAnzeigeProvider`. „Jetzt“ beim Erfassen: `frontend/src/offline/AGENTS.md`,
  „Schreiben ohne Netz“. Bewusst Gerätezeit: Uhr und Datenstand im Kopf. Zonentests
  stellen die Prozesszone per `test/prozessZone.ts` auf UTC — unter der Suiten-Zone Berlin wäre
  Anzeigezone Berlin blind.
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
  `theme/statusFarben.ts` (`ALLE_MAPS` in `statusFarben.test.ts`: 32 am 04.10.2026, LFH-881); jede weitere
  Karte ist eine begründete Entscheidung (Beispiele: `odlStufe` in
  `openspec/changes/archive/2026-09-21-lfh-78-fachebene-odl/design.md`, `aufbewahrungZustand` in
  `openspec/changes/archive/2026-09-29-lfh-23-retention-rest/design.md` D4,
  `schwaerzungsantragStand` in
  `openspec/changes/archive/2026-10-02-lfh-751-sofort-schwaerzung-auf-antrag/design.md` D9, `capSchwere` in
  `openspec/changes/archive/2026-10-01-lfh-662-dwd-ebene-gueltigkeit-warnstufe/design.md` D5,
  `pegelZustand` in `openspec/changes/archive/2026-10-04-lfh-881-pegelzustand-statusvertrag/design.md` D1–D2). `theme/statusVertrag.guard.test.ts`: keine Karte außerhalb
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
  Rückfrage, `Popconfirm` mit `okButtonProps={{ danger: true }}`.
- **Ein Iconsatz** (LFH-595, Spec `iconsatz`,
  `openspec/changes/archive/2026-09-30-lfh-595-ein-ikonensatz/design.md`): Icons8
  „iOS 27 Outlined“, für aktive Zustände „iOS 27 Filled“ (`IconPaar`, heute Rail und Stern).
  Import nur über `icons/index.ts`; Register, SVG-Quellen und Stempel in `scripts/icons/`
  (`erzeuge-icons.mjs`, Abschreibprüfung gegen das Icons8-PNG `vergleiche-png.mjs`). Auswählen
  mit PNG, SVG erst nach Freigabe abrufen (Kontingent des Abos). Lücke: Ersatz aus demselben Stil,
  sonst eigene Zeichnung im 50er-Raster mit Vermerk; **nie ein zweiter Katalog**. Jedes Icon ist
  `aria-hidden`, `1em`, `currentColor`, Hülle `anticon` (antds Ausrichtung); antds eigene
  Bauteil-Icons (Auswahlpfeil, Schließkreuz, `loading`) bleiben. Taktische Zeichen und die
  Bildmarke sind keine Icons.
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

**Entwürfe** (Verlustschutz, Navigationsschutz, „Entwurf speichern“, Lagebericht-Akkordeon):
`frontend/src/entwurf/AGENTS.md` — gilt auch für `lageberichte/`, `pages/BefehlDetailPage.tsx` und
`pages/LageberichtDetailPage.tsx`.

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
  in `theme/dichte.ts` meint das Gerät. Keine Wahl einer „Arbeitsweise“, keine Vorbelegung
  von Startziel, Primäraktion, Modulreihenfolge oder Dichte je Person; `standard_modul` gilt für
  den ganzen Einsatz. Je Person liegen nur das Palettengedächtnis „Zuletzt“
  und der ETB-Standard-Rufname (`benutzer_einstellungen::BEKANNTE_SCHLUESSEL`, geschlossener
  Schlüsselraum; der Rufname ist ein Wert, keine Arbeitsweise).
- **Nicht zuständig für Rechte:** Sichtbarkeit und Schreibrecht kommen allein aus `EinsatzRolle`,
  Systemrolle und Modulfreigabe (`einsatz/schreibrecht.ts`, `berechtigung::erlaubte_module`). Ein
  Einstieg prüft die Modulfreigabe seines Ziels (`istSprungGesperrt`, gesperrt sichtbar: Knopf
  `disabled` mit `title={KEINE_BERECHTIGUNG}`, Link und Kennzahl-Ziel entfallen). Der Rahmen fängt
  jede Route in ein gesperrtes Modul ab (`ModulGesperrt`, LFH-888,
  `openspec/changes/archive/2026-10-04-lfh-888-modulwaechter-gesperrte-sprungziele/design.md`) und wartet
  beim Kaltstart auf die Freigaben; die Zielseite prüft weiter ihren Datensatz. Verweise in
  Datenzeilen bleiben offen, für sie gilt der Rahmen. Stabsfunktionen S1–S6 ebenso (LFH-46).
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

**Gedruckt wird über den Browser, nie auf dem Server**; kein `window.print()` direkt, Druckknöpfe
sind `DruckKnopf`. Regeln: `frontend/src/druck/AGENTS.md` (gilt für jede Seite mit Druckwurzel).

## Frontend — Deeplink-Muster (Route vs. Query-Param)

Quelle der Wahrheit: `frontend/src/routing/deeplinks.ts` — keine Template-Literals für
Einsatz-Pfade (`docs/superpowers/specs/2026-06-23-deeplinks-vereinheitlichen-design.md`).

- **Item-Route** `/einsaetze/:id/<modul>/:<modul>Id` bei Vollseiten-Detail (uhs, br, lagebericht,
  befehl, person, tier, schaden), sonst **Query-Param** `?<modul>=<id>` (`?einheit=`,
  `?fahrzeug=`, `?personal=`, `?abschnitt=`, `?meldung=`, `?auftrag=`, `?gefahrengebiet=`, ETB
  `?eintrag=`); `?neu=1` fokussiert die Schnellerfassung. Stabile DB-`id`; `parseRouteId`.
- **Filter gehören in die URL** (`etbPfad`/`parseEtbFilter`, `mitQuery` kodiert). Unbekannter
  Enum-Wert wird ganz verworfen (exhaustiver `Record<EtbTyp, true>`).
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
  `einsatz` und `lagged` zu, Guard `ungegatet_sind_nur_lagged_und_einsatz`), invalidiert Kopf und
  Stab-Anzeige. Es feuern PATCH, Abschluss, Frist und die Lagebesprechung **nur bei geändertem
  Termin**; `meine_*` und `lagekennzahlen` lösen es nicht aus.
- **Einsatzliste und Stammdaten sind live** (LFH-734, Spec `org-live`): `globalKeys` sind wie die
  Einsatz-Keys genau einmal klassifiziert — live über `ORG_STREAM_EVENTS` (Ereignisse
  `einsatzliste`, `stammdaten`) oder `NICHT_LIVE_GLOBAL_KEYS` (Guard (g)). **Ein Tab, eine
  Live-Verbindung:** der Einsatz-Strom trägt die Org-Ereignisse mit; außerhalb eines Einsatzes
  öffnet die Betriebszeile `/api/live` (`live/useOrgLiveStream.ts`), der ruht, solange ein
  Einsatz-Strom offen ist (`live/einsatzStromStore.ts`). Verbindungsbau nur über
  `live/liveVerbindung.ts`, keine zweite `EventSource`.
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

## Sitzung über mehrere Tabs (LFH-387)

Geschrieben wird nur über `apiSend`/`apiUpload` (tragen `X-Erwarteter-Benutzer-Id`, Server
antwortet bei fremder Kennung 412). Regeln: `frontend/src/auth/AGENTS.md`.
