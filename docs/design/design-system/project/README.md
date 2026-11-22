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

## Bausteinwahl: wann nehme ich was

Die erste Frage beim Bauen und beim Entwerfen: Welcher Baustein trägt den Bedarf? Eine Zeile je
Bedarf. Die Regel dahinter steht am genannten Ort und wird hier nicht wiederholt; die Orte sind
Abschnitte dieser Datei im Repo, die README des Design Systems trägt nur einen Teil davon. Die Karte ist der
Ordner im Design System. Die README des
Design Systems beginnt mit dieser Tabelle, und `designSystem.test.ts` hält die Spalte „Karte“ und
die Karten deckungsgleich.

| Bedarf                                                                                          | Baustein                                                                                                                                         | Karte                              |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| **Rahmen**                                                                                      |                                                                                                                                                  |                                    |
| Seite mit Titel, Meta und Kopfaktionen                                                          | `EinsatzSeite` (Verwaltung: `AdminPage`), Kopf nach „Seitenkopf“                                                                                 | `Seitenkopf`                       |
| Zusammengehöriges in einer Fläche                                                               | `Paneel`/`PaneelZeile`                                                                                                                           | `Paneel`                           |
| Lagebild aus Zahlen, Verteilung und Listen                                                      | Dashboard-Baukasten                                                                                                                              | `Dashboard`, `DashboardListen`     |
| Kopfaktion mit wechselndem Wortlaut                                                             | `BreiteHalten`                                                                                                                                   | `BreiteHalten`                     |
| Übung kennzeichnen                                                                              | `UebungsBand`/`UebungsMarke` (Rahmen, „Übung“)                                                                                                   | `Uebung`                           |
| Navigation im Einsatz (Kategorien und Module)                                                   | `IconRail`/`ModulPanel` ab `lg`, darunter Navigations-Drawer („UI-Form-Leitlinie“)                                                               | `Navigation`                       |
| **Darstellen**                                                                                  |                                                                                                                                                  |                                    |
| Angaben eines Datensatzes                                                                       | `Datenraster`/`Datenfeld`                                                                                                                        | `Datenraster`                      |
| Nebenangaben eines Datensatzes in einer Zeile                                                   | `MetaZeile`                                                                                                                                      | `MetaZeile`                        |
| Text in einer Größe und Farbe                                                                   | `Textstufe` (Stufe der `schriftskala`, Ton)                                                                                                      | `Text`                             |
| Elemente mit Abstand reihen                                                                     | `Stapel` (Rasterstufe)                                                                                                                           | `Stapel`                           |
| Knöpfe nebeneinander (Kopf, Paneel, Dialogfuß)                                                  | `Knopfreihe` (Abstand `md`, Fuß mit `fuss`)                                                                                                      | `Knopfreihe`                       |
| Eine Zahl, die führt                                                                            | `Kennzahl`/`Kennzahlenband`                                                                                                                      | `Kennzahl`                         |
| Kennzahlen über einer Liste, einklappbar                                                        | `KlappBand`                                                                                                                                      | `KlappBand`                        |
| „Welcher von diesen?“                                                                           | `KatalogTabelle`, `Datensicht form="tabelle"` („Die Liste ist die zweite Frage“)                                                                 | `Tabelle`                          |
| Zustand eines Datensatzes (Status, Urteil, storniert)                                           | `Status`, im Raster `StatusZelle` (Farbachsen, „Rahmen heißt bedienbar“)                                                                         | `Status`                           |
| Status, den man wechseln kann                                                                   | `StatusWahl` (rendert `StatusKnopf`; Tableau `variante="gross"`)                                                                                 | `Status`                           |
| Kennzeichnung ohne Zustand (ad-hoc, Rolle, Typ, Herkunft)                                       | `Marke` (entfernbar mit `onEntfernen`), nie rohes `Tag`                                                                                          | `Status`                           |
| Sichtungskategorie                                                                              | `SichtungsTag`                                                                                                                                   | `Sichtung`                         |
| Zeitpunkt oder Dauer                                                                            | `anzeige/zeitDarstellung.ts`, Dauer `anzeige/dauer.ts` („Zeitdarstellung“, „Uhr, Dauer und Datenstand“)                                          | `Zeitdarstellung`                  |
| Funk- und Telefonverbindungen                                                                   | `VerbindungenAngabe`, `FunkUndTelefon`                                                                                                           | `Verbindungen`                     |
| Taktisches Zeichen                                                                              | `EinsatzZeichen`                                                                                                                                 | `TaktischeZeichen`                 |
| Verletzungen am Körper                                                                          | `Koerperschema`                                                                                                                                  | `Koerperschema`                    |
| Großbild (Lagemonitor)                                                                          | `GrossKennzahl`, `GrossZeile`                                                                                                                    | `GrossKennzahl`, `GrossZeile`      |
| **Rückmeldung**                                                                                 |                                                                                                                                                  |                                    |
| Laden, leer oder Fehler einer Seite oder eines Paneels                                          | `SeitenSkeleton`/`SeitenLeer`/`SeitenFehler`, `PaneelZustand`                                                                                    | `Zustaende`                        |
| Hinweis zu Rechten, Warnstufe oder Lage der Fläche                                              | `RechteHinweis`, `WarnstufenHinweis`, `Alert` auf der Statusfläche                                                                               | `Hinweis`                          |
| Mehrere gleichartige Meldungen gebündelt                                                        | `Sammelbanner`                                                                                                                                   | `Sammelbanner`                     |
| Was gerade brennt, unter dem Seitenkopf von Überblick und Lagebild                              | `AlarmZeile` („Dashboard-Baukasten“)                                                                                                             | `AlarmZeile`                       |
| Alarm, der eine Handlung verlangt                                                               | `AlarmZone`                                                                                                                                      | `Alarmzone`                        |
| Eingang (Einwurf, Nachricht)                                                                    | `EingaengeKnopf`, `Eingangsband`                                                                                                                 | `Eingaenge`                        |
| **Eingabe**                                                                                     |                                                                                                                                                  |                                    |
| Eine Handlung auslösen                                                                          | antd `Button`, Farben aus `antdKnopf` („Farbe und Zeichen“, „Rot bedient nichts“)                                                                | `Knopf`                            |
| Frei oder gesperrt mit Grund                                                                    | Sperrzeichen aus `index.css` („Gesperrt trägt die Sperre ohne Farbe“)                                                                            | `Gesperrt`                         |
| Ein Feld mit Beschriftung und Fehlerzeile                                                       | `Feld` mit `breite` (Hülle um `Form.Item`), ohne Formular `FeldFehler`                                                                           | `Eingabefeld`                      |
| Zeitpunkt eingeben                                                                              | `ZeitpunktEingabe`                                                                                                                               | `Zeiteingabe`                      |
| Ort eingeben                                                                                    | `Ortsfeld`                                                                                                                                       | `Ortsfeld`                         |
| Wert aus Stammdaten oder frei                                                                   | `StammdatenFeld`                                                                                                                                 | `StammdatenFeld`                   |
| Geheimnis setzen oder ersetzen, nie lesen (Zugangsdaten eines Adapters)                         | `Geheimfeld` (Wert nur im State der Zeile, nie in `Form`, Query- oder Mutations-Cache)                                                           | `Geheimfeld`                       |
| Sichtung wählen                                                                                 | `SichtungsWahl`                                                                                                                                  | `SichtungsWahl`                    |
| Formularseite mit Feldgruppen                                                                   | `Formularpaneel`, Speichern über `useSpeicherLeiste` + `SpeicherKnopf` („Formularseiten“)                                                        | `Formularlayout`, `Speicherleiste` |
| Gegliedertes Dokument                                                                           | `DokumentEntwurf`                                                                                                                                | `DokumentEntwurf`                  |
| **Umschalten**                                             |                                                                                                                                                  |                                    |
| Fläche oder Bereich darunter umschalten                                                         | `Segmentleiste rolle="tablist"` mit Reiterfläche (`role="tabpanel"`, `steuert`); führt ein Reiter auf eine andere Seite, `aktivierung="manuell"` | `Segmentleiste`                    |
| Dokumentreiter mit Anlegen und Schließen                                                        | antd `Tabs` `editable-card` (nur ETB-Entwürfe)                                                                                                   | —                                  |
| Sicht oder Status derselben Liste, bis etwa 5 Werte                                             | `Segmentleiste`, höchstens eine je Ebene                                                                                                         | `Segmentleiste`                    |
| Weitere Einschränkung derselben Liste                                                           | `Select` oder Suche in derselben Werkzeugzeile                                                                                                   | `Eingabefeld`                      |
| Kurze Wahl im Formular                                                                          | `SegmentFeld` in `Form.Item`, nie `Radio.Group optionType="button"`                                                                              | `Segmentleiste`                    |
| Wahl mit erklärenden Optionen                                                                   | senkrechte `Radio.Group`                                                                                                                         | —                                  |
| Viele Werte oder Wahl aus Stammdaten                                                            | `Select` bzw. `StammdatenFeld`                                                                                                                   | `Eingabefeld`, `StammdatenFeld`    |
| Zweizustand neben einer Leiste                                                                  | `SegmentUmschalter`                                                                                                                              | `Segmentleiste`                    |
| antds `Segmented`                                                                               | nie                                                                                                                                              | —                                  |
| **Bearbeiten** (Regeln: „UI-Form-Leitlinie“, „Bearbeiten in der Ansicht“, „Ort von Bearbeiten“) |                                                                                                                                                  |                                    |
| Einzelwert am Ort ändern                                                                        | `InlineAngabe`, `BemerkungZelle`                                                                                                                 | `InlineAngabe`                     |
| Zusammengehörige Werte eines Datensatzes                                                        | `BearbeitbaresPaneel` Modus `paneel`                                                                                                             | `BearbeitbaresPaneel`              |
| Ganze Ansicht, Felder zusammen geprüft                                                          | `BearbeitbaresPaneel` Modus `ansicht`                                                                                                            | `BearbeitbaresPaneel`              |
| Anlegen                                                                                         | Muster Dialog: `ErfassungsModal` („Erfassungs-Norm“); eigene Seite erst ab Ablauf oder > ~5 Pflichtfeldern                                       | `Dialog`                           |
| Serienerfassung neben einer Liste                                                               | Muster Zeile: `Schnellerfassungszeile`, aufgeklappt `ErfassungsFormular`                                                                         | —                                  |
| Kurze blockierende Aktion, Datensatz ohne eigene Ansicht                                        | Modal (Punkt 1 von „Bearbeiten in der Ansicht“)                                                                                                  | `Dialog`                           |
| Unumkehrbares                                                                                   | rote `Popconfirm`, aus einem Zeilenmenü ein Modal („Aktionen“)                                                                                   | `Knopf`                            |
| Nur ansehen                                                                                     | Drawer; nie zum Anlegen oder Bearbeiten                                                                                                          | —                                  |

## Bausteine

- **Paneel** (`components/Paneel/`, Gruppe Flächen)
- **Seitenkopf (Ortspfad, Titel, Meta, Kopfaktionen)** (`components/Seitenkopf/`, Gruppe Rahmen)
- **Navigation im Einsatz (Rail und Modulpanel)** (`components/Navigation/`, Gruppe Rahmen)
- **Dashboard-Baukasten (Verteilung, Matrix, Kopf-Aktion)** (`components/Dashboard/`, Gruppe Flächen)
- **Datenraster mit DatenfeldEingabe und FeldFehler** (`components/Datenraster/`, Gruppe Daten)
- **Textstufe (Stufen der Schriftskala und Töne)** (`components/Text/`, Gruppe Flächen)
- **Stapel (Abstand als Rasterstufe, senkrecht und als Zeile)** (`components/Stapel/`, Gruppe Flächen)
- **Knopfreihe (Knöpfe nebeneinander, Abstand md)** (`components/Knopfreihe/`, Gruppe Flächen)
- **MetaZeile (Nebenangaben eines Datensatzes)** (`components/MetaZeile/`, Gruppe Daten)
- **Status, Marke und Statusknopf (Rahmen heißt bedienbar)** (`components/Status/`, Gruppe Status)
- **Kennzahl und Kennzahlenband** (`components/Kennzahl/`, Gruppe Daten)
- **Klappbares Kennzahlenband** (`components/KlappBand/`, Gruppe Daten)
- **Großbild: Kennzahl** (`components/GrossKennzahl/`, Gruppe Großbild)
- **Großbild: Zeilen** (`components/GrossZeile/`, Gruppe Großbild)
- **Segmentleiste (Filter, Umbruch, als Formularfeld)** (`components/Segmentleiste/`, Gruppe Bedienung)
- **AlarmZeile „Was brennt“ (Einträge, Ruhe, unvollständig, Großbild)** (`components/AlarmZeile/`, Gruppe Rückmeldung)
- **Sammelbanner** (`components/Sammelbanner/`, Gruppe Rückmeldung)
- **Zustände: Seite und Paneel (laden, leer, Fehler)** (`components/Zustaende/`, Gruppe Rückmeldung)
- **Hinweis: Rechte, Warnstufe und Alert auf der Statusfläche** (`components/Hinweis/`, Gruppe Rückmeldung)
- **InlineAngabe (geschlossen, leer, offen)** (`components/InlineAngabe/`, Gruppe Bedienung)
- **Verbindungen (Funk und Telefon getrennt; Liste offen)** (`components/Verbindungen/`, Gruppe Bedienung)
- **Übungsmarke: Band und Marke** (`components/Uebung/`, Gruppe Status)
- **Sichtungsmarke (BBK)** (`components/Sichtung/`, Gruppe Status)
- **BearbeitbaresPaneel (offen und gesperrt)** (`components/BearbeitbaresPaneel/`, Gruppe Formular)
- **Knopf (primär, Standard, Text, Gefahr, gesperrt, mit Symbol)** (`components/Knopf/`, Gruppe Eingabe)
- **Eingabefeld (Feld mit Breitenstufe, Pflicht mit Fehlerzeile, FeldFehler)** (`components/Eingabefeld/`, Gruppe Eingabe)
- **Formularlayout (Feldgruppen im Formularpaneel, Speicherleiste)** (`components/Formularlayout/`, Gruppe Eingabe)
- **Dialog: ErfassungsModal (Felder und Fuß, Serienmodus)** (`components/Dialog/`, Gruppe Eingabe)
- **Speicherleiste (SpeicherKnopf, Punkt am geänderten Feld)** (`components/Speicherleiste/`, Gruppe Formular)
- **Geheimfeld (nicht gesetzt, gesetzt, offen, unlesbar, gesperrt, nur lesen)** (`components/Geheimfeld/`, Gruppe Formular)
- **StammdatenFeld (aus Stammdaten oder frei)** (`components/StammdatenFeld/`, Gruppe Formular)
- **DokumentEntwurf (Bearbeiten und Lesefassung)** (`components/DokumentEntwurf/`, Gruppe Formular)
- **Frei und gesperrt** (`components/Gesperrt/`, Gruppe Bedienung)
- **Kopfaktion mit wechselndem Wortlaut (frei und gesperrt)** (`components/BreiteHalten/`, Gruppe Bedienung)
- **Dashboard-Baukasten (Abschnitte, Gliederung, Strom)** (`components/DashboardListen/`, Gruppe Flächen)
- **Tabelle: KatalogTabelle mit Suche, Spalten, Filtern und Zeilenmenü** (`components/Tabelle/`, Gruppe Daten)
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
- `schriftskala (Sperrung, Versalien)`: ueberschrift -0.02em · augenbraue 0.14em Versalien · railEtikett 0.06em Versalien · datenwertKlein -0.02em · datenwert -0.02em · datenwertGross -0.02em
- `--lfh-abdunkelung (theme/rollen.css)`: Deckschicht des Helligkeitsreglers, keine Farbrolle

## Gestaltungssprache

Neuentwurf „Instrumententafel“

Fortschreibung des ersten Entwurfs (dunkel, Radius 0, Archivo/JetBrains Mono, Bedienfarbe blau).
**Maßgeblich:** `docs/design/2026-09-21-neuentwurf/umsetzung.md` (Entscheidungen, Palette);
Entwürfe daneben (`neuentwurf.dc.html`, `shell.dc.html`, Inline-Styles maßgeblich;
`_ds/…/tokens/*.css` ist alt). Bei Konflikten gewinnt das Design — **außer bei der Sichtung**
(BBK). Umgekehrte Altregeln tragen „Neuentwurf 22.09.2026".

- **Nachtbetrieb ist Vorgabe:** `MODUS_DEFAULT = 'dark'` in `theme/ThemeModeProvider.tsx`,
  **gespiegelt im Bootstrap-Skript von `index.html`** — immer beide ändern. Hellpalette aus der
  Nachtpalette abgeleitet.
- **Vier Flächenstufen**:
  `grund`, `paneel`, `kopf`, `flaeche`, `flaeche2`, `flaeche3` belegen je Modus höchstens vier
  Werte, je Schritt ≥ 1,10 : 1, zusammengelegt entlang der Helligkeitsfolge des Modus (nachts
  `grund` = `paneel`, `kopf` = `flaeche`; am Tag `paneel` = `flaeche2`, `grund` = `kopf`). Ein
  fünfter Wert ist eine Entscheidung, kein Nachtrag. Der dauerdunkle Rahmen (`rahmenFarben`) ist
  keine Inhaltsfläche und hält seine Werte selbst. Das gewählte Segment der `Segmentleiste`
  trägt zusätzlich eine 2-px-Bedienkante unten (eine Typkante ersetzt sie).
- **Rollen** in `theme/tokens.ts` + `theme/rollen.css` (Gate 5), u. a. `kopf`, `paneel`,
  `flaeche3`, `text2`, `steuerRahmen` (= antds `colorBorder`), `bedienText`, Statusflächen,
  `bannerGrund`/`bannerLinie`, Zeilentönungen. `rahmenFarben` ist modusunabhängig und keine
  `Farbrolle`. Eigene Paletten statt `Statusrolle`:
  `etbTypFarben{Dunkel,Hell}` (`etbTypFarbe()`), `warnstufeFarben{Dunkel,Hell}`
  (`warnstufeBalkenFarbe()`), `fachebeneFarben{Dunkel,Hell}` (`fachebeneFarbe()`, Ebenen-Identität, keine Vertragskarte; `FachebeneDef` trägt keine Farbe).
- **`schriftskala`** (CSS `--lfh-typo-*`, deckungsgleich per `rollen.guard.test.ts`). Zahlen,
  Zeiten, Funkrufnamen, Koordinaten, Nummern immer Mono mit `tabular-nums`. Die Dichte-Staffel
  30/48/72 gilt, nicht die Entwurfsskizze. Text setzt `Textstufe` (Stufe und Ton), Titel einer
  Karte oder eines Listeneintrags die Stufe `kartentitel` (15/600); 13 px gibt es nur als
  Mono-Stufe `mono`. Mono-Text nimmt `monoStil(stufe)` mit `metaKlein` 10, `meta` 11, `monoKlein`
  12, `mono` 13, `monoGross` 14 oder `datenwert*`, eine Zahl nur aus einer Variablen. Die Stufen wachsen nicht mit der Dichte. Neue
  `fontSize`-Zahlen und `monoStil(<Zahl>)` verbietet `theme/schriftgroesse.guard.test.ts`; die
  Altlast steht in `schriftgroesse.schuld.ts` und sinkt wie beim Abstandsraster.
- **Abstandsraster**: Abstände kommen aus dem Raster der aktiven
  Dichte (`dichten[*].abstand` in `theme/tokens.ts`), Stufen `xxs`·`xs`·`sm`·`md`·`lg`·`xl` auf
  Vielfachen von 4. Die Werte sind kompakt 4·4·8·12·16·24, komfortabel 4·4·12·20·28·40 und
  handschuh 4·8·16·24·44·64. In TSX nimmst du das antd-Token (`paddingXXS…XL`, `marginXXS…XL`;
  MD = LG). In CSS nimmst du `var(--lfh-luft-0…5)`. antds Steuerelement-Polster
  (`controlPaddingHorizontal`/`…SM`) stehen auf `md`/`sm`; die Inhaltspolster (`paddingContent*`:
  Knopf, Modal, Alert, Liste) bleiben bewusst antds feste Werte. Ein festes Kompakt-Raster gibt es nicht.
  Zahl-Literale über 2 px in `padding*`/`margin*`/`gap`, `<Space size>`, `gap=` und `gutter`
  verbietet `theme/abstandsraster.guard.test.ts` ohne Schuldliste. Wo kein `token` zur
  Hand ist (Stil auf Modulebene, `tagRender`), nimmst du `var(--lfh-luft-*)`; ein Wert, der kein
  Layoutabstand ist (Kartenrand bei `fitBounds`), steht als benannte Konstante. Feste Ausnahmen
  (Lagemonitor, Hilfe-Prosa, Anmeldung, Druck) stehen mit Grund im Wächter. Elemente
  reiht `Stapel abstand="…"` (Stufe, nie Zahl) statt `Space direction="vertical"` oder eines
  Flex-`div` mit `gap`.
- **Orientierung**: den Tab-Titel setzen nur die Rahmen über
  `components/useDokumentTitel.ts`, aus dem Modulnamen der Registry („Seite · Einsatz ·
  lifeline-hub“); keine Seite setzt `document.title`. Der Einsatzstatus steht nie im h1, sondern
  als `EinsatzstatusMarke` neben dem Titel, nur bei nicht aktivem Einsatz (Rahmenkontext
  `einsatz/EinsatzRahmenKontext.tsx`). Im Ortspfad kürzt unter `md` nur der mittlere Eintrag; im
  Einsatzrahmen steht unter `md` statt des Ortspfads nur der Rückweg „‹ <Eintrag>“ zum letzten
  verlinkten Eintrag unterhalb des Einsatzes (`lfh-ortspfad--einsatz`).
- **Markdown** (`components/Markdown.tsx`, `MarkdownEditor`): Pflicht-Prop `unterEbene` (Ebene der
  nächsten Überschrift darüber, Boden `h6`, kein fester Versatz). Der optionale Bild-Renderer
  `bild` gehört nur der Hilfe („Bilder“).
- **Liste** (`components/Liste.tsx`): Kopf `kopf.unterEbene` (Pflicht im Kopf), Eintragstitel
  (`ListenEintragMeta`) eine Ebene unter dem Kopf, ohne Kopf aus `unterEbene` an der Liste,
  ohne beides keine Überschrift. `unterEbene` nur bei eigenständigen Gegenständen, nie bei
  Auswahl-, Einstellungs- und Stromlisten.
- **Bildmarke „Lebenslinie“**: EINE Geometrie in `marke/bildmarkeGeometrie.ts` für
  Markenzelle, Anmeldeseite, Favicon, PWA und Hülle; Symbole nur über
  `scripts/marke/erzeuge-symbole.sh` (Guard `marke/marke.guard.test.ts`: Nenngrößen, Manifest,
  Pfadgleichheit, Stempel `scripts/marke/quellen.sha256`). PWA-Manifest in `marke/pwaManifest.json`, Farben Kopf-Schwarz.
- **Rahmen:** Kopfleiste (`components/Kopfleiste.tsx`, `KOPF_HOEHE`) · Rail
  (`einsatz/IconRail.tsx`, Kurzetikett `kurz`, voller Name als `aria-label`, Einstellungen per
  `fuss: true`) · Modulpanel (`einsatz/ModulPanel.tsx`) · Sprungpalette
  (`command-palette/CommandPalette.tsx`). Maße im Entwurf.
  - **Stehenbleiben**: der Kopf
    klebt in jeder Breite (`RAHMEN_KLEBT`, `data-lfh="rahmen-kopf"`), ab `lg` Rail-Kategorien und
    Modulpanel darunter; unter `md` klebt die Betriebszeile bei Störung (offline, Live `lost`) über
    dem Kopf, denn dort steht die Verbindung im Kopf nur als Symbol. Am Handy trägt der Einsatzkopf
    eine Zeile: Menü, Einsatzname, Alarmzentrale (Ruhe als Glocke, Störung im Wort), Verbindung,
    Uhr (umbrechen darf er nur in `handschuh` bei einer Störung im Wort der Alarmzentrale); Suche
    und Benutzermenü stehen dort im Drawer „Navigation“. Der App-Rahmen lässt unter `md` die
    Wortmarke weg, ihr Link liegt dann auf der Bildmarke. Der Fuß der Rail (Griff „Menü“,
    Einstellungen) klebt nicht: reicht die Höhe nicht, folgt er den Kategorien, statt sie zu
    verdecken. Das Modulpanel ist eine Spalte
    mit festem Kopf und Fuß „Einsatzdauer“, nur die Liste rollt in sich (`modul-panel-spalte`);
    ihre Höhe ist gemessen (Oberkante im Fenster bis Fensterrand), und die Liste holt den aktiven
    Eintrag ins Bild.
  - **Der Seitenkopf klebt, wenn er passt** (`components/seitenkopfKleben.ts`): ab
    `md` auf jeder `EinsatzSeite` und `AdminPage`, solange Kopf und Seitenkopf höchstens ein
    Drittel der Fensterhöhe nehmen (`KLEBEN_HOECHSTENS`), nie in einem eigenen Scrollbereich
    (Gerätehülle) und nie mit `fensterInhalt` (dort ist `FensterRahmen` sein Containing Block).
    `kopfKlebt` setzt die Entscheidung von außen (nur das ETB). Es klebt nur die Leiste, nicht
    Hinweis oder Beschreibung darunter.
  - **Modulwechsel zeigt sofort Kopf und Gerippe**: Der
    Router zeichnet jeden Wechsel als Übergang und hält das alte Bild, bis die neue Seite fertig
    ist. Deshalb hängt das `<Outlet />` des Einsatzrahmens in `einsatz/ModulWechselGerippe.tsx`.
    Wechselt das Modul, steht im ersten Bild `ModulGerippeSeite` (Seitenkopf mit `modulName` und Ortspfad,
    `SeitenSkeleton verzoegert`, die Balken erst nach 120 ms), danach die Seite. Das gilt nicht
    im selben Modul. Beim ersten Aufruf zeigt `ModulWechselGerippe` kein Vorab-Gerippe; lädt der
    Einsatz dann noch, gibt die Seite in ihrem Frühausstieg selbst `ModulGerippeSeite` zurück
    (Kopf sofort, Einsatz im Ortspfad als „…“), nie ein nacktes `SeitenSkeleton`. Was
    erst mit den Daten kommt, reserviert seine Zeile vorher (unsichtbar, ohne Nullen) oder steht
    unter allem, was schon steht; Nachweis: `e2e/erstaufruf-cls.spec.ts` (Erstaufruf mit langsamem
    Server, CLS < 0,1). Eine Seite baut kein eigenes Vorab-Gerippe für den Wechsel. Ein nachgeladenes Modul nimmt `ModulGerippeSeite` als Suspense-Fallback, keinen
    Ladetext.
  - **Zwei Höhen** (`components/rahmenOben.ts`): `--lfh-kopf-oben` (`useKopfOben`)
    ist der Kopf samt Betriebszeile und Übungsband (Ebene `kopf`), `--lfh-rahmen-oben`
    (`useRahmenOben`) dazu der klebende Seitenkopf. Die Kopfhöhe nehmen nur, was neben dem Inhalt
    klebt (Rail, Modulpanel, Verwaltungsmenü), der Seitenkopf selbst und die Klebe-Entscheidungen;
    alles andere die Rahmenhöhe (Guard). Innerhalb der Ebene `kopf` stapelt sich der Rahmen nach
    Rang (`RAHMEN_RANG`: Betriebszeile, Kopf, Übungsband, Alarmzone; `useRahmenObenStapel`): jede Quelle klebt unter denen mit kleinerem Rang.
  - **Wer oben klebt, hängt sich unter den Rahmen:** `top: var(--lfh-rahmen-oben)` bzw.
    rc-tables `sticky={{ offsetHeader: useRahmenOben() }}` (`components/rahmenOben.ts`, gemessen,
    nie gerechnet), also auch unter den klebenden Seitenkopf. Ausnahme nur mit Vermerk
    `rahmen-oben: frei` und Grund (Guard `components/rahmenOben.guard.test.ts`). Den Fokusabstand
    trägt `scroll-padding-block-start` am Dokument (`index.css`), ausgesetzt bei Fokus im Rahmen;
    bei Fokus im Seitenkopf gilt nur die Kopfhöhe.
  - **Alarme stehen in der Alarmzone, nie über dem Inhalt**: Alarme, Org-Hinweise und
    die Unwetterwarnung zeichnet `alarm/AlarmZone.tsx` direkt unter Kopf und Übungsband, nie
    antds `notification` (`AntApp` trägt kein `notification`-Prop). Die Zone ist eine
    Rahmenquelle der Ebene `kopf` unter dem Übungsband (`useRahmenObenStapel` mit
    `RAHMEN_RANG.alarmzone`): Rail, Modulpanel und Seitenkopf kleben unter ihr. Sie schiebt den Inhalt
    und liegt auf `RAHMEN_EBENE` unter Drawer und Dialogen. Ab zwei Einträgen bündelt sie.
    Im Einsatz unter `md` trägt die Leiste am Handschirm die Alarme (`alarm/HandyLeiste.tsx`).
    ✕ blendet aus (`blendeAus`, sessionStorage je Tab), quittiert wird nur mit „Öffnen“ und
    „Gelesen“. Greifer `[data-lfh="alarmzone"]`, `[data-lfh="alarm-eintrag"]`;
    Nachweis `e2e/alarm-verdeckung.spec.ts`.
  - **Kopfleiste: der Name hat Vorrang**: Rangfolge Einsatzname vor
    Suche vor Daueranzeigen. Ab `lg` gibt ein Raster dem Namen (Stufe `kartentitel`) seine Eigenbreite, bevor die
    Suche mehr als ihre Lupe bekommt (`kopfRasterSpalten`); die Umbruch-Basis hängt an der Dichte,
    nie am geladenen Namen. Ein Zustand ohne Handlungsbedarf steht in jeder Breite nur als
    Symbol, eine Störung ab `md` mit Wort (darunter trägt die Betriebszeile die Verbindung, die
    gebündelte Alarmzentrale nennt die vorrangige Störung). Einziger Breitenhalter: der Platz von „Ton blockiert“ am
    Glockenknopf ab `md`, weil der Browser den Ton vor der ersten Geste ohne Zutun sperrt (am Handy
    nicht, dort hätte die eine Zeile keinen Platz dafür). Tastenhinweise
    nur bei feinem Zeiger. Die Wortmarke steht im Einsatz erst ab `xxl`. Der Knopf „?“ (Hilfe zur
    Seite) steht im Einsatz-Kopf erst ab `xl`, im App-Rahmen ab `md`; wo er die eine Zeile
    bräche, steht „Hilfe zu dieser Seite“ im Benutzermenü (`hilfeZurSeite`), am Handy im Einsatz im
    Fuß der Navigation. Unter `md` ersetzt dieser Eintrag „Hilfe“ (die Seitenleiste verlinkt die
    volle Hilfe), und der Menükopf trägt keine Versionszeile, wie im Handschuh-Betrieb; sonst
    ragte „Abmelden“ in `komfortabel` unter den Fensterrand (e2e `benutzermenue`, Entscheidung
    20.11.2026).
  - **Übung**: Jede Fläche, die einen Einsatz zeigt,
    kennzeichnet eine Übung (Rahmen, Gerät, Lagemonitor, Einsatzliste, Wechsler, Sprungpalette,
    Planungsübernahme, externes Lagebild, „Zurück zu …“, Tab-Titel, Druck, Lageplan-Anlage,
    Fernmeldeskizze).
    Entschieden wird nur über `isUebung` (`einsatz/einsatzart.ts`) aus der Einsatzart, nie aus dem
    Namen. Gezeigt wird am Bildschirm nur über `UebungsMarke`/`UebungsBand`
    (`components/instrument/Uebung.tsx`), auf Papier über Druckkopf, `DruckUebung` und Randfeld
    (`druck/AGENTS.md`), in Text- und Bildtiteln als Präfix „ÜBUNG · “. Erkennbar ist sie
    an Form und Wort (schraffiertes Band, gefüllter Chip, immer „ÜBUNG“), nicht am Farbton: violett
    sind auch die ETB-Entscheidung, die Abschnittsflächen und das Führungscluster der Lagekarte. Das Band steht direkt unter dem Kopf und klebt in jeder Breite unter den übrigen
    Quellen der Kopfhöhe, über einem klebenden Seitenkopf (`useRahmenObenStapel`). In einer Hülle fester Höhe (Gerät) klebt es nicht.
  - **Sprunglink zum Inhalt** (WCAG 2.4.1): einmal in `BetriebsLayout` (`App.tsx`), vor der Betriebszeile
    (`components/SprungZumInhalt.tsx`); die Hilfe liegt außerhalb und bindet ihn selbst ein. Jeder
    Rahmen markiert sein Ziel mit `sprungzielInhalt` (`data-lfh="sprungziel-inhalt"`,
    `tabIndex -1`), der Link nimmt das letzte in DOM-Reihenfolge: das `main` von Einsatz, Ebene 1
    und Hilfe, in der Verwaltung den Inhalt neben dem Menü (ein `div`, kein zweites `<main>`). Ein
    neuer Rahmen markiert sein Ziel mit (Wächter `components/SprungZumInhalt.rahmen.test.tsx`). Ohne
    Fokus aus dem Bild, mit Fokus `fixed` oben links über `RAHMEN_EBENE` (`.lfh-sprung-inhalt`, von
    den Fokusabständen in `index.css` ausgenommen). Die Gerätehülle hat keinen. Nachweis
    `e2e/sprung-zum-inhalt.spec.ts`.
  - **Jede Rahmenebene hat eine Fehlergrenze** („Fehlergrenze je Rahmen“ und „Letztes Netz an der Wurzel“, Change `a12ms7g9-seitenzustaende`
    D1/D2): unter `EinsatzLayout`, `AppLayout`, `AdminLayout`, `GeraeteLayout` und
    `GeraetEinsatzRahmen` genau eine pfadlose Kindroute mit
    `errorElement={<Fehlergrenze rahmen="…" />}` (`components/Fehlergrenze.tsx`), die alle Seiten
    des Rahmens umschließt; nie ein `errorElement` am Layout selbst, es ersetzte den Rahmen. Die
    oberste Route trägt das letzte Netz (`rahmen="wurzel"`, ganze Seite ohne `AuthProvider`). Die
    Grenze zeigt nie Meldung oder Stack, nur „Neu laden“ und den sicheren Ort des Rahmens („Zum
    Überblick“ über `einsatz/useUeberblickRueckweg.ts`, „Zur Einsatzliste“, „Zur Startseite“), und
    meldet den Wurf einmal je Fehlerobjekt über `meldeClientFehler` (`api/clientFehler.ts`). Ein
    neuer Rahmen kommt mit seiner Grenze in den Wächter `App.fehlergrenze.guard.test.tsx`.
    Nachweis `e2e/fehlergrenze.spec.ts`.
  - **Jede Kachel einer Lagefläche hat ihre eigene Fehlergrenze** (Entwurf
    `docs/superpowers/specs/2026-11-19-ft74hjiv-fehlergrenze-je-kachel-design.md`): Auf
    Überblick, Lagebild, Lagebild-Großbild und Lagemonitor steht jede Kachel (Alarmzeile,
    Startliste, Paneel, Kennzahlenband, Monitorkachel) einzeln in `KachelGrenze`
    (`components/KachelGrenze.tsx`), damit ein Wurf nur sie ersetzt und nicht über die
    Rahmengrenze die ganze Seite. Form `paneel` mit „Neu laden“ auf Flächen mit Bedienung, Form
    `gross` ohne Knopf auf Großbild und Lagemonitor, dort mit dem Datenstand als `neuversuch`. Wie
    die Rahmengrenze zeigt sie nie Meldung oder Stack und meldet über `meldeClientFehler`. Sie
    fängt nur Würfe beim Zeichnen: Abfragefehler zeigt `PaneelZustand`, ein Wurf im Rumpf der
    Seite bleibt bei der Rahmengrenze. Wächter `pruefeKachelGrenzen` (`test/kachelWaechter.ts`)
    in den Seitentests von Überblick, Lagebild und Lagemonitor; Nachweis
    `components/KachelGrenze.test.tsx`.
  - **Ortsmarke in der Bedienfarbe**: die aktive
    Rail-Kategorie (`rahmenFarben.bedien`), die offene Kategorie im Navigations-Drawer und der
    aktive Reiter der Gerätehülle tragen ihre Marke in `bedien` wie das aktive Modul im
    Modulpanel, nie in `marke`; `marke` bleibt der Bildmarke.
  - **Modulpanel:** `navPersistenz` ist dreiwertig; ohne Wahl zwischen `lg` und `xl` zu, ab `xl`
    offen. Eine Wahl schreiben nur der Griff „Menü“ und der Selbstklick, nie ein Rail-Sprung.
- **Keine erfundenen Daten:** was ohne Datenquelle ist, wird weggelassen,
  trägt sein Ticket im Code-Kommentar und wird als **Abwesenheit** getestet. Eingelöst:
  Evakuiert, Pegel auf Platz 1, Rückmeldung, ETB-Zählung.
- **Rollen der Übersichten**: der Überblick sagt, was zu tun ist (Startliste eines neuen Einsatzes, nächste
  Marken, offene Vorgänge samt Aufträgen und Meldungen, Abschnitte, Entscheidungen; ohne
  Kennzahlenband), das Lagebild, was los ist (Betroffene, Kräfte, Vermisste, Gefahren,
  Sichtung, Einsatzdauer, Lagebericht, UHS). Eine Zahl steht auf genau einer der beiden Seiten;
  nur die Alarmzeile steht auf beiden. Die
  Startliste zeigt Haken, keine Zahl. Beide verweisen im Seitenkopf aufeinander..

## Farbachsen

(Vertrag `theme/statusFarben.ts`)

- **Betroffene** (`Status`): Personenstatus neutral, „vermisst" `achtung`; Schaden
  „offen" neutral (Eingang), „übergeben" `bedien`, „abgeschlossen" neutral; Ausmaß „gering" neutral,
  „mittel"/„groß" `achtung`, „katastrophal" `alarm`.
- **Lagezustand** (`abschnittLagezustand`): planmäßig `normal`, angespannt `achtung`,
  kritisch `alarm`; nicht beurteilt = leeres Feld. Nur der Wechsel schreibt System-ETB. Im
  Abschnittsdetail eine `Segmentleiste` mit vier Stufen, jede Wahl speichert sofort, auch per
  Pfeiltaste. Überblick meldet schlechtere Unterabschnitte („UA kritisch"). Ein
  Fortschritt hat keine Oberfläche: die Spalte trägt nur Altdaten, die Lage trägt der
  Lagezustand, den Arbeitsstand die offenen Aufträge.
- **Gefahrenmatrix**: eine Zelle ohne Bewertung zeigt die
  Vorgabe „keine“ („–“), kein Zähler unbewerteter Felder; „nicht beurteilt“ steht am Gebiet
  (`beurteilt_at/von`, Knopf „Beurteilung bestätigen“ nur mit Schreibrecht, System-ETB) und
  fortgeschrieben die Entscheidung, dass Offenes nicht wie Entwarnung aussieht. Ein
  ungültiges Paar ist schraffiert (`schraffurStil`, `steuerRahmen`, ≥ 3 : 1), ohne Text.
  Verdichtet: die ganze Zelle ist das Ziel (Polsterung 0, Knopf 100 %, Zeile =
  `controlHeight`, Ring nach innen). Wer Gefahrentypen listet, ordnet sie über
  `sortGefahrenAlphabetisch` bzw. `GEFAHRENTYPEN_ALPHABETISCH` (`gefahrenSchema.ts`), nie in
  der Katalogfolge `GEFAHRENTYPEN`. Erläuterungen: eine Zelle mit Text trägt die
  Marke (Dreieck oben rechts, `currentColor`, Name „· mit Erläuterung“), unter der Matrix
  steht die Liste „Erläuterungen“. Die Marke kommt nur aus `pages/gefahren/ErlaeuterungsMarke.tsx`
  (auch im Lagebild-Paneel und im Palettenauszug), der Namenszusatz aus
  `MIT_ERLAEUTERUNG`. Welche Zellen etwas sagen und in welcher Folge, entscheidet nur
  `pages/gefahren/erlaeuterungen.ts` (`zellenMitErlaeuterung`, `gesetzteGefahren`) — für
  Matrix, Lagebild, Palettenauszug, Lagekarte und Lagevortrag.
- **Sichtung ist eine eigene Achse nach BBK** und die Ausnahme vom Neuentwurf:
  SK I rot, II gelb, III grün, IV blau, Tote schwarz, „unverletzt" ohne Farbe. **Angezeigt** wird
  als umrandetes Farbfeld (`SichtungsTag`/`sichtungsfarben`); die Umrandung macht Gelb auf hellem
  und Schwarz auf dunklem Grund sichtbar. **Gewählt** wird als Vollfläche über
  `personen/SichtungsWahl.tsx` aus `sichtungsPalette` (`flaeche`, bis zum Textboden abgedunkelt,
  in beiden Modi gleich; `punkt` ist die Anzeigefarbe, eine Palette je Kategorie) mit Kante in
  `text` (`sichtungsKante`), gewählt mit ✓ und 3-px-Rahmen. Nach einer Wahl behalten die übrigen
  ihre Farbe als 4-px-Innenrahmen in `punkt` auf getönter Fläche, keine Randform; „tot“ trägt in
  jedem Zustand eine Schraffur, „unverletzt“ keine Fläche; der Startfokus liegt auf der Gruppe,
  nicht auf SK I. 72 × 96 px in jeder Stufe, kein Dropdown für die Sichtung. **Kein rohes antds `Tag`**
  (ESLint `no-restricted-imports`; Ausnahme nur
  `SichtungsTag`): ein Zustand steht in `Status` mit einer Rolle aus dem Vertrag; eine
  Kennzeichnung ohne Zustand (ad-hoc, Rolle, Kennung, Kategorie, Bezug) ist eine neutrale `Marke`,
  Blau bedient. Urteile („unterbesetzt“, „Soll erfüllt“) sind Zustände, keine Marken.
- **Rahmen heißt bedienbar**: einen Rahmen trägt nur, was
  man bedienen kann. `Status` und `Marke` sind randlos; der bedienbare Status ist der
  `StatusKnopf` (Fläche der Rolle, Rahmen in ihrer Kante, Pfeil ▾, 14 px, sichtbar so hoch wie
  die Dichtehöhe 30/48/72), eine entfernbare Marke trägt Rahmen und ✕. Die Sichtung bleibt das
  umrandete BBK-Feld; wo sie bedienbar ist, legt sich der Knopfrahmen außen darum. Nachweis
  `theme/statusKnopfKontrast.test.ts`.
  Übergabe, Geschädigt-Bezug, UHS-Verortung tragen `bedien`. Personenstatus und Sichtung sind
  unabhängig.
- **Blauer Bedien-TEXT nimmt `rollen.bedienText`**; antds `colorLink` (Ruhe, Zeiger, gedrückt)
  **ist** `bedienText`, ein Link braucht kein eigenes `style`, Zeiger-Rückmeldung ist die
  Unterstreichung. Radio-Text im Stil `outline` über `index.css` (`--lfh-bedien-text`), kein
  `Radio.colorPrimary`.
- **Geerbter Text auf Textrollen**: Beschreibung
  (`colorTextDescription`) und Kopf der `KatalogTabelle` lesen `gedaempft`, nie `schwach`;
  Formularmeldung über `Form`-Token in `alarmText`/`achtungText`, das globale `colorError` bleibt
  Füllfarbe; Standardknopf unter dem Zeiger in `bedienText`. Alles in `tokens.ts:antdToken`/
  `antdKomponenten`, nicht je Stelle.
- **Roter Fehlertext außerhalb von Formularen**:
  `Typography` `danger` („konnte nicht geladen werden“, „Überfällig“, Ablehnungsgrund) liest
  `alarmText`, ein Link `danger` unter dem Zeiger `alarmHover`, über das GLOBALE `colorErrorText*`
  in `antdToken` (antd liest es nur als Schrift); das globale `colorError` bleibt Füllfarbe für
  Knopf, Rand und Kartenkante. Gemessen in `e2e/fehlertext-kontrast.spec.ts`.
- Kontrast: `e2e/betroffene-kontrast.spec.ts` (Tag ≥ 7:1, Nacht ≥ 5:1, Alpha mitgerechnet).
- **Kein eigener Knopfboden**: die Beschriftung des
  Primärknopfs hält den Textboden in Ruhe, unter dem Zeiger und gedrückt; Werte und Messung am
  Wert in `theme/tokens.ts`. Ein Kontrast-Spec führt den Primärknopf nie unter einer Ausnahme.
- **Gedrückt trägt den Zeigerton**: Primärknopf
  `bedienHover`, Gefahrknopf ohne Rahmen auf `alarmFlaeche`, über die `Button`-Token
  `colorPrimaryActive`/`colorErrorBgActive` in `antdKomponenten`, nie antds Ableitung (nachts
  dunkler als die Ruhe). Gemessen mit `gedrueckt` aus `e2e/kontrast-kern.ts`.
- **Gefahrrot ebenso**: roter
  Menüeintrag und Gefahrknopf lesen `alarmText`, unter dem Zeiger und gedrückt `alarmHover` (am
  Tag dunkler, nicht heller), über die `Dropdown`-/`Button`-Token in `antdKomponenten`, nie je
  Menü oder Knopf. Gemessen in `e2e/gefahr-kontrast.spec.ts`; kein Kontrast-Spec führt Rot unter
  einer Ausnahme.
- **Hinweisflächen sind Statusflächen**: `Alert`
  Info/Warnung/Fehler/Erfolg lesen `bedienFlaeche`/`achtungFlaeche`/`alarmFlaeche`/
  `normalFlaeche` über das `Alert`-Token in `antdKomponenten`, nie je Hinweis; antds Ableitung aus
  den Signalfarben ist am Tag trüb. Ein Knopf darauf behält `steuerRahmen` (≥ 3 : 1). Der Override färbt nur die
  Fläche des Hinweises, antd-Bausteine darin sehen weiter die globalen Tokens.
- **Die Auswahlfläche ist eine eigene Rolle**: gewählte
  Option, gewählter Menüeintrag und Knoten tragen `auswahlFlaeche`, GLOBAL über
  `colorPrimaryBg`/`colorPrimaryBgHover` in `antdToken` (daraus `controlItemBgActive`), nie je
  Stelle; eigene Stellen lesen das Token. Unter dem Zeiger keine eigene Stufe. Der gewählte
  Dropdown-Eintrag schreibt in `bedienText` (`Dropdown.colorPrimary`). Nachweis
  `theme/auswahlKontrast.test.ts` (auch ΔE ≥ 7 gegen Ruhe und Zeigerspur),
  `e2e/auswahl-kontrast.spec.ts`.
- **Deeplink-Hervorhebung** (`.zeile-hervorgehoben` an
  Datensicht und Zeitachse): `bedienFlaeche` plus Ober- und Unterlinie in `bedien` (`box-shadow`,
  `index.css`); ein `Zeitachseneintrag` setzt die Fläche inline mit, ebenso die
  Kommunikationskarte (`kommunikation/KommKarte.tsx`, Linien inline, nie ein Ring; eine
  Alarmkarte behält ihre Fläche, `kartenGrund`). Nie `flaeche3` (das ist der
  Hover; die Tagmodus-Regel unten meint Hover und aktive Segmente) und nie eine Statusfläche;
  Nachweis `e2e/deeplink-hervorhebung-kontrast.spec.ts`. **Farbliterale
  in CSS nur in `theme/rollen.css`** (Schuldmenge `OFFEN` schrumpft nur).
- **Tagmodus**:
  `achtung`/`alarm` als Text über `achtungText`/`alarmText`; Hervorhebung auf `flaeche3`, nicht
  `flaeche2`; Kontrast gegen den tatsächlichen Grund. **Text auf der Hervorhebung hält den vollen Boden**: Hover- und Aktivzeile sind Grund wie jede Fläche; deshalb ist
  `bedienText` am Tag so dunkel, dass er auf `flaeche3` ≥ 7 hält — die Fläche wird nicht
  aufgehellt, die Rolle nicht lokal überschrieben.
- **Textboden für jede Textstufe**: `text`,
  `text2`, `gedaempft` und auch Tertiärtext `schwach` (Augenbraue, Meta, Platzhalter)
  halten auf jeder deckenden Fläche Tag ≥ 7 : 1, Nacht ≥ 5 : 1; benachbarte Stufen
  liegen ≥ 5 ΔL\* auseinander. Eine Textstufe unterschreitet
  den Boden nur für Gesperrtes (≥ 4,5, Sperre auch ohne Farbe); Kontrast-Gates führen keine
  Tertiär-Ausnahme.
- **Gesperrte Steuerelemente**: antds `colorTextDisabled` trägt die Rolle `gesperrt`
  (keine Textstufe, nur für Gesperrtes) und hält ≥ 4,5 auf antds durchscheinender Sperrfläche
  über jeder deckenden Fläche, nicht nur auf dem Grund daneben. Nachts liegt sie heller als `schwach`: die Sperrfläche hellt
  den Grund auf.
- **Gesperrt trägt die Sperre ohne Farbe**: gesperrte antd-Knöpfe und -Felder haben
  einen gestrichelten Rand in `steuer-rahmen`, randlose Einträge (Menü, Auswahlliste, antds
  `Segmented`, eigene `Segmentleiste`) eine Strichlinie nach innen (`index.css`, `sprache.css`).
  Gestrichelt heißt nur gesperrt: die Knopfvariante `dashed` ist gesperrt.

## Farbe und Zeichen

- **Rot bedient nichts:** `bedien` und Fokusring blau, Rot ist Gefahr. Jede Statusfarbe braucht
  einen **zweiten Kanal** (WCAG 1.4.1). Farbwerte nur aus `theme/tokens.ts`/`theme/rollen.css`.
- **Statusrollen haben eine Bedeutung**: Gelb (`achtung`) heißt
  „jemand muss bald handeln“, Rot (`alarm`) „überfällig, Ausfall, Gefahr“. Ein Zustand des
  Normalbetriebs (unterwegs, eingesetzt, eingegangen, läuft planmäßig) trägt nie Gelb: „gebunden“
  ist überall `neutral` und kommt immer aus `statusKategorie`, nie fest in einer Seite; der
  Eingang „Neu“/„Offen“ ist neutral mit leiser Kante (`linieStark`), Dringliches zeigt die
  Priorität. Die ZAHL der noch nicht gesichteten Meldungen (Kennzahl „Unbearbeitet“) bleibt
  dagegen gelb: gezählt ist sie Handlungsbedarf (Entscheidung 16.11.2026). Einzige Ausnahme an der Kategorie vorbei: der Sprechwunsch (FMS 5 und 0) ist gelb;
  wer den Status EINES Fahrzeugs oder einer Einheit färbt, geht über `fahrzeugStatusRolle` bzw.
  `kategorieDarstellung` (`theme/statusFarben.ts`). (D1–D4).
- **Der Fokusring ist `bedien`**: antds Umriss liest `colorPrimaryBorder`, und
  `antdToken` setzt ihn auf `bedien` (≥ 3 : 1 auf jeder deckenden Fläche), wie die eigenen Klassen in
  `sprache.css`. Er ist zugleich die Ruhefarbe des `Slider`; dessen Zeiger nimmt `bedienHover`.
  Flächen (`warnstufeFlaeche`/`flaechenFarbe`) sind die dritte Darstellungssorte; eine vierte wird
  in `statusFarben.ts` benannt, nicht in `pages/`.
- **Demo-Marke**: Demo-Stammdaten (`ist_demo`) zeigt nur `components/DemoMarke.tsx`
  (`Tag` ohne `color`, kein `StatusTag`, keine Karte in `statusFarben.ts`); Auswahllisten zum
  Disponieren gruppieren sie nur über `stammdaten/demoAuswahl.tsx` hinter die echten Einträge.
- **Helligkeit: ein Regler, eine Sperre** (Kriterium 8): dritte Achse im
  `ThemeModeProvider` (`useHelligkeit`, Stufen 100/80/60/40/20, `lifeline-hub.helligkeit`,
  **gespiegelt in `index.html`**), wirkt nur über die Deckschicht `html::after` in `rollen.css`
  (`--lfh-abdunkelung`, `@media screen`), nie über Paletten. Bei aktiver Warnung
  (`einsatz/aktiveWarnung.ts`: Warnstufe mit Rolle `alarm`, `meldungen.bestaetigung_ueberfaellig` oder eine jetzt geltende DWD-Warnung mit Rolle `alarm`
  aus `dwdWarnstufe`, nur mit Freigabe `wetter-pegel` und ohne eigenen Abruf) gilt
  `HELLIGKEIT_BODEN_WARNUNG` (abgeleitet über
  Kriterium 5, Guard `theme/helligkeit.test.ts`); Quellen melden sich nur über `useWarnsperre`
  (heute allein `EinsatzLayout`). Die Sperre ändert nie die Wahl.
- **Der dauerdunkle Rahmen hält die Tag-Schwelle**: die Schwelle aus Kriterium 5
  folgt dem Umgebungslicht, nicht dem Token. Jeder Text auf Kopfleiste/Rail, auch ein
  Zustandswort, hält ≥ 7 : 1 auf dem Grund, auf dem er steht (`grund`/`feld`/`aktiv`); einzige
  Ausnahme `rahmenFarben.gesperrt` (≥ 4,5) für Gesperrtes, dann mit Zeichen ohne Farbe auf jeder
  Breite (Schloss in `AppLayout.tsx`). Jede Textfarbe im Rahmen steht in
  `theme/rahmenKontrast.test.ts` und wird dort gerechnet (der Test sieht keine Verwendung, nur
  die Liste). Gilt für jede weitere dauerdunkle Fläche.
- **Knopfreihen über `Knopfreihe`**: zwei oder mehr Knöpfe nebeneinander
  stehen in `Knopfreihe` mit dem festen Abstand `md` (12 / 20 / 24 px), so steht auch Rot nie
  bündig neben Neutralem; kein `<Space>`, kein eigener Abstand. Dialogfüße nehmen `fuss` (ab `md`
  rechtsbündig, darunter untereinander in voller Breite). Im `ErfassungsModal` unter `md` klebt nur der Abschluss
  (Primärknopf, Nebenaktionen, Zusammenfassung); „Abbrechen“ steht dort als Text im Schließknopf des
  Kopfs, Einstellungszeile und „Speichern und nächste“ am Formularende. Primär steht im Kopf, im Paneel und in
  der Zeile vorn, im Fuß hinten; die Reihe ordnet nicht um. In Tabellenzellen und Zeilen, die ihre
  Höhe halten, `umbruch={false}`. Ein `<Space>` in `aktionen` der `EinsatzSeite` wird zum
  Fragment, denn die Kopfhülle ist selbst eine Knopfreihe; nur eine Reihe mit Druckklasse oder
  Hülle bleibt eine eigene `Knopfreihe` (Kräfte, Lagebericht). Bestand in
  `components/knopfreihe.schuld.ts` (Ratsche). antds eigene Füße
  (Modal, `modal.confirm`, `Popconfirm`) halten dieselbe Stufe über eine Regel in `index.css` mit
  `var(--ant-padding)`. **Kein Komponenten-Token `marginXS`:** jeder antd-Knopf setzt die Variable
  mit seiner `css-var-…`-Klasse zurück, die Überschreibung kommt am Knopf nie an (gemessen 7 px).
  Nachweis `e2e/dialogfuss-dichte.spec.ts`, `e2e/dokumente.spec.ts`.
- **Destruktiv ist nicht gleich destruktiv**: Umkehrbares („Außer Dienst",
  „Deaktivieren", eine gelöste Zuordnung) → Abstand + `danger`, keine Rückfrage; Unumkehrbares →
  Rückfrage, `Popconfirm` mit `okButtonProps={{ danger: true }}` und benanntem `okText`. **Im
  ⋮-Menü ist nur Unumkehrbares rot**: ein Lösen, Entlassen oder Austragen mit
  Rückgängig steht neutral unter den umkehrbaren, `gefahr` nur für Stornieren, Auflösen und
  Ähnliches (Wächter `components/menueFarbe.guard.test.ts`). In der Zeile trennt der rote Knopf,
  im Menü der Trenner.
  **Unumkehrbares für den ganzen Einsatz steht nicht im Kopf oder Menü einer Arbeitsseite**: der Einsatzabschluss steht als letzter Abschnitt auf den
  Einsatzdaten, am aktiven Einsatz nur für die Einsatzleitung. Er ist die Ausnahme von
  „Unumkehrbares → `Popconfirm`“: ein Dialog
  (`pages/einsatzdaten/EinsatzAbschlussDialog.tsx`) nennt die offenen Punkte, sperrt aber nicht,
  und sein roter Knopf „Einsatz abschließen“ wird erst aktiv, wenn Einsatznummer oder Bezeichnung
  eingetippt sind (geprüft nur im Client). Binnen 24 Stunden öffnen Einsatzleitung und System-Admin
  der Einsatz-Org ihn mit Pflicht-Grund wieder (`darfEinsatzWiedereroeffnen`).
- **Ein Iconsatz**: Icons8
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
  (nie DB-`id`), Spaltenschalter **mit Zähler ausgeblendeter Spalten**. Der Zähler steht erst
  nach eigener Wahl im Namen: solange die Wahl
  der Voreinstellung der Seite und der Breite folgt, heißt der Schalter „Spalten“, danach
  „Spalten · n ausgeblendet“ mit allen verborgenen (`weichtVonVorgabeAb` in
  `components/SpaltenSchalter.tsx`; die Seite reicht `spaltenAusVoreinstellung` durch). Auf schmalem Schirm
  **angepasst, nicht in Karten aufgelöst**; ausgenommen sind Flächen mit `form="auto"`, deren
  Zeile am Handy nicht trägt (Fahrzeuge, Personal, die Einheitenliste mit Baum als Karten). Träger `KatalogTabelle`/`Datensicht`.
- Spaltenschalter: `components/SpaltenSchalter.tsx` (eine Wahrheit für Handwahl und `abBreite`);
  in `KatalogTabelle` nur per Opt-in `spaltenSchalter={{ bezeichnung }}`, `Datensicht` setzt es
  nie. Antds `responsive`/`hidden` gesperrt. Das Häkchen zeigt
  die wirkliche Sichtbarkeit. Eine Seite mit eigener Werkzeugzeile (Kräfteübersicht) hängt ihn dort ein:
  Zustand aus `useSpaltenSchalterZustand`, an die Sicht als `spaltenSchalterAussen`;
  sein Fokus hält die Zeilenschleuse nicht, die Werkzeugzeile der Sicht bleibt Standzeile des
  Sammelbanners. Sonst bleibt der eingebaute Schalter.
- **Eine Vergleichstabelle ist sortier- und filterbar, im Spaltenkopf**: Sortieren per Klick auf den Kopf, Filter über antds
  Spaltenfilter (kontrolliert, im Clientmodus mit Zähler „Groß (3)“), je aktivem Wert ein Chip
  (`components/tabellenFilter.tsx`) und darüber der `Filterhinweis` (Treffer von Gesamt,
  „Filter zurücksetzen“ leert Suche und Filter, nicht die Sortierung). Die gefilterte Kopfzelle
  trägt eine 2-px-Linie in `bedien`. Was man nicht sieht, wirkt nicht: der Filter einer
  ausgeblendeten Spalte schneidet nichts und steht nicht als Chip da. Der Kartenzweig zeigt
  dieselbe Menge und sortiert über „Sortieren“; zurück geht es über den Eintrag „wie geliefert“,
  nicht über ein Löschkreuz (es war 12 × 12 px und der
  einzige Rückweg). Im Servermodus zählt das Kopfmenü nicht und die
  Zahlen kommen vom Server (`serverseitig.zahlen`). Sortierung, Filter und Suche stehen in der
  Adresse (`?sort=ort:auf&f.ausmass=gross&q=`, `routing/deeplinks.ts`), sonst gilt der Stand der
  Sitzung; die Spaltenwahl liegt am Gerät — beides über `useListenGedaechtnis`
  (`components/listenGedaechtnis.ts`), den die SEITE hält und als `gedaechtnis` an
  `Datensicht`/`KatalogTabelle` reicht; ohne gemerkte Spaltenwahl gilt `spaltenAusVoreinstellung`.
  Spalten, die beim ersten Rendern noch nicht feststehen (Werte aus den Zeilen, Spalte hinter einer
  Freigabe), nennt die Seite als `ausDaten`, sonst fiele ihr Filter aus der Adresse. Eine Sicht im
  Baummodus sortiert und filtert nicht (Kräfteübersicht, Funkplan, Kommunikationsplan; Kommentar an der
  Sicht). Ein Filter mit `ohneKartenfeld` hat im Kartenzweig kein Auswahlfeld (Betroffene, Status
  der Tiere: die Seite führt die Achse schon, die erste Karte bleibt im ersten Bild), wirkt aber
  und steht als Chip da. Vorbild Schäden, dazu Fahrzeuge, Personal, Material, Sprechgruppen,
  Betroffene, Tiere, Evakuierung. Gerätestartseiten bleiben ohne Kopffilter
  (Kommentar an der Seite).
  In einer `KatalogTabelle` (Unfallhilfsstellen, Bereitstellungsräume) trägt jede Spalte `key` und
  `sorter`, eine Werteliste `filters`/`onFilter`; das Gedächtnis prüft gegen ein Register auf
  Modulebene (`GEDAECHTNIS_SPALTEN`). Ein Reiter einer Detailseite (Kräfte der UHS) sortiert und
  filtert ohne Gedächtnis: die Adresse meint das Objekt. `MaterialAmOrt` bleibt ohne (eine gelöste
  Zeile hält ihre Stelle).
  Nachweise `e2e/tabellen-sortieren-filtern.spec.ts`, C16 in `e2e/trefflaeche-pruefflaechen.spec.ts`,
  Filtermarke in `e2e/auswahl-kontrast.spec.ts`.
- **Die Hauptaktion einer Zeile bleibt im Bild** (Change `lsug0joq-tabellen-touch` D1): die Aktionsspalte einer `Datensicht` trägt `amEnde` und
  steht ab `md` rechts fixiert (direkte `KatalogTabelle`-Nutzer setzen `fixed: 'right'` selbst); unter `md` ziehen Primäraktion und ⋮ in die fixierte Kennung (`Datensicht`), eine
  zweite fixierte Spalte gibt es dort nicht. Spalte mit Primäraktion über
  `components/aktionsSpalte.tsx` (Breite je Stufe gerechnet, aus `PrimaerAktion`/`WeitereAktionen`
  wie Karte und Kontextmenü); eine reine ⋮-Spalte (`menueSpaltenBreite`) setzt nur `amEnde`.
  Nachweis `e2e/gate1-ueberlauf.spec.ts` („Aktion im Bild“), Fokus in
  `e2e/fokus-verdeckung.spec.ts`.
- **Kopf und Körper sind gleich breit**: mit stehender Kopfzeile legt rc-table den
  Kopf in eine eigene Tabelle; `theme/sprache.css` setzt sie auf `table-layout: fixed`, damit
  sie die gemessenen Körperbreiten genau übernimmt. Damit der feste Kopf nie gekürzt wird, hebt
  `KatalogTabelle` jede Zahlbreite und jedes `mindestBreite` auf die Mindestbreite ihres Kopfs
  (`components/kopfBreite.ts`: längstes Wort des Titels in der Kopfschrift, Sortiersymbol,
  Filterauslöser der Stufe, Zellpolster). Gerechnet, nicht gemessen, damit nichts springt.
  Nachweis `e2e/gate1-ueberlauf.spec.ts` („Spaltenköpfe … stehen über ihren Spalten“).
- **Kopfwerkzeuge der `KatalogTabelle` folgen der Dichte**: Suche und Spaltenschalter
  stehen `paddingSM` auseinander, antds Spaltenfilter-Auslöser hält `controlHeightSM` und liegt
  in der Tab-Folge (Name „<Spalte> filtern“, Enter/Leertaste öffnen), beides im Primitiv, nie je
  Seite. Nachweis `e2e/katalogtabelle-kopf-dichte.spec.ts`.
- **Eine sortierbare Kopfzelle sortiert nur über ihren Inhalt**: antd hängt den Klick
  an die ganze Zelle, zwei sortierbare Köpfe stießen ohne Lücke aneinander. `KatalogTabelle` hält
  einen Klick in die Polsterung an (`polsterKlickRiegel`), der Inhalt reicht senkrecht bis an den
  Zellrand und auf `controlHeight` (`sortierKopfStyle`, `theme/sprache.css`); die Polsterung trennt
  die Spalten. Nicht über `pointer-events: none`: unter einer fixierten Zelle fiele der Tipp auf
  die verdeckte Spalte. Unit-Tests klicken über `sortTarget` (`test/utils.tsx`). Nachweis
  `e2e/gate3-trefflaeche.spec.ts` „Personal“.
- **Das Aufklappsymbol im Baum der `Datensicht` folgt der Dichte**: antds Symbol steht
  in einem Knopf mit Höhe `controlHeight` und Breite `controlHeightSM` (`baumSymbolZielStil`),
  der Text daneben mittig in derselben Höhe (`baumTextStil`); im Druck fällt der Boden. Nachweis
  `e2e/gate3-trefflaeche.spec.ts` „Baumtabellen“ (Einheiten, Kräfteübersicht, Funkplan).
- Stehende Kopfzeile hält Freiraum (`setzeKopfFreiraum`, `scroll-margin-top` in `sprache.css`);
  Fokus-Nachweis darunter auch mit `Shift+Tab` (`fokus-kern.ts`, `taste`). In der ersten Zeile
  beschneidet Chromium den Rand am Scrollcontainer von `scroll.x`; dort rollt
  `useFokusUnterKopf` (`components/fokusUnterKopf.ts`) nach. `KatalogTabelle` trägt
  ihn, eine Tabelle mit stehender Kopfzeile außerhalb ruft ihn selbst (Gefahrenmatrix).
- **Dichte-Staffel 30 / 48 / 72 px** (kompakt · komfortabel · Handschuh) über ein Dichte-Token am
  `ConfigProvider`: `controlHeight` 30/48/72, `controlHeightSM` 24/48/72. **Neues punktuelles
  `size="small"` auf interaktiven Elementen ist verboten** (Schuldmenge `OFFEN` schrumpft nur, im selben Commit wie der Fix; Stand: UHS-Platzkarte in
  `pages/uhs/Grundriss.tsx`, nur in `kompakt`, sonst `platzBedienform`). `Card`/`Descriptions`/
  `Space`/`Liste` dürfen klein bleiben.
- **Die Zähltaste einer Hochfrequenz-Erfassung („+1“) hat in jeder Stufe einen Boden von 72 px**
  (Höhe und Breite) und steht am unteren Rand (`verpflegung/zaehltasteStil.ts`). Das ist
  eine Ausnahme nach oben, keine Stufenwahl: die übrigen Tasten folgen der Staffel. Nachweis
  `e2e/gate3-trefflaeche.spec.ts` („Ausgabeansicht“).
- **Kein Zoom wie in einer App**: der Viewport in `index.html` sperrt den Zoom
  (`maximum-scale=1.0, user-scalable=no`), `html` in `index.css` den Doppeltipp
  (`touch-action: manipulation`). Sonst zoomt iOS beim Fokus in jedes Feld unter 16 px Schrift,
  und die Stufen liegen darunter. Größe trägt die Dichte, kein Feld wird dafür auf 16 px gehoben.
  Wächter `theme/keinZoom.guard.test.ts`.
- **Die Stufe folgt dem Gerät, nie der Person**: beim Start
  gespeicherte Wahl → Zeigerart (grob → `komfortabel`) → `kompakt`, nur in
  `theme/dichte.ts:startDichte`; `handschuh` nur auf Wahl, kein Zuhörer auf die Zeigerart, kein
  Import aus Einsatz, Rolle oder Funktion. Browser-Beleg
  `e2e/dichte-ableitung.spec.ts`; Flächenmessung der Modul-Prüflisten
  `e2e/trefflaeche-pruefflaechen.spec.ts`, Messhelfer in `e2e/trefflaeche-kern.ts`.
- **Der Navigationsrahmen hat keine Dichte-Ausnahme**: die 48 ist Boden, nie Deckel
  (`Math.max(48, controlHeight)`, Griffe über `navGriffMass`); die Rail-Spalte wächst mit
  (`railBreite` in `components/Kopfleiste.tsx`, 73 px in `handschuh`).
- Knopfboden `minWidth` = `controlHeightSM` (`antdKnopf()` in `theme/tokens.ts`). `Switch` über
  `switchMasse`/`antdKomponenten(farben, dichte)`; Nachweis am CSS der `css-var-…`-Klasse über
  `innerHTML`, nicht `textContent`. Schalter in fester Breite brechen um, statt zu kürzen
  (`pages/lagekarte/leistenTeile.tsx`, Zeilen in `pages/lagekarte/Ebenenbaum.tsx`).
- **Klappkopf**: jedes `Collapse` bekommt den Boden über den Kontext
  (`antdKlappkopf(dichte)` in `theme/tokens.ts`, `collapse` am `ConfigProvider`: `minHeight`
  30/48/72 + Mittellage); antd rechnet den Kopf sonst aus der Schrift (36/45/55). Kein lokales
  `styles.header` je Stelle. Nachweis `e2e/dokumente.spec.ts` „Dichte-Staffel“.
- **Beschriftetes Kästchen**: jede `Checkbox` mit Text bekommt den Boden über den
  Kontext (`antdKaestchen(dichte)`, `checkbox` am `ConfigProvider`: `minHeight` 24/48/72 am Label
  und Mittellage); antd hat dafür kein Token, das Label wäre nur so hoch wie die Schrift
  (21,5/36). Ohne Text (antds Tabellenfilter) kein Boden; im Menüeintrag hebt
  `style={{ minHeight: 0 }}` ihn auf, dort ist der Eintrag das Ziel (`SpaltenSchalter`).
  Nachweis `e2e/trefflaeche-pruefflaechen.spec.ts` (C7).
- **Schließen-Kreuz eines Hinweises**: jedes
  schließbare `Alert` bekommt den Boden über den Kontext (`antdHinweis(dichte)` in
  `theme/tokens.ts`, `alert` am `ConfigProvider`: 24 / 48 / 72 auf beiden Achsen am Knopf selbst),
  höhenneutral über einen negativen Rand; antd zeichnete es 12 × 14 px in jeder Stufe. Kein eigenes
  `closeIcon` oder `styles.close` je Stelle. Nachweis `e2e/gate3-trefflaeche.spec.ts` („Hinweis-Kreuz
  und kurzer Ortspfad-Link“, wirksame Fläche per `elementFromPoint`).
- **Handgebautes Bedienziel**: `minHeight: token.controlHeight` **plus** `padding` aus
  `token.paddingSM`/`token.padding` (aufgelöste Tokens, nie `var(--lfh-*)`), geprüft über eine
  reine exportierte Stilfunktion (`bedienzielStil`) mit Böden als **Literalen**. **Ein `<a>` erbt
  keine Steuerhöhe.** Gate 3 je Route: `e2e/gate3-trefflaeche.spec.ts`. Kennungs-Links in
  Tabellen-, Listen- und Zeitachsenzeilen tragen den Boden über `components/kennungsLink.tsx`
  (`KennungsLink`), ohne eigene Polsterung: die trägt die Zelle. Ebenso das
  Auswahlziel einer Karte (`auswahlZielStil` in `components/ListeDetail.tsx`): die Polsterung
  trägt die Karte, ein Klick darauf wählt über den Kartenhalter.
- **Die Brotkrume hat keine Dichte-Ausnahme**: jeder Link im Ortspfad des Seitenkopfs
  hält die Staffel über `ortspfadStil` (`components/EinsatzSeite.tsx`) und die Pfad-Link-Regel in
  `EinsatzSeite.css`, durchsichtiger Rand statt Schrift (bleibt 12 px), dazu die Mindestbreite eines
  Knopfs der Stufe (`controlHeightSM`, „ETB“ war 32 px breit). Die CSS liest
  `--lfh-ortspfad-ziel` und `--lfh-ortspfad-breite`, die Stilfunktion setzt dort den aufgelösten Token, kein `var(--lfh-*)`
  der Dichte. Seiten geben nur ihre `Breadcrumb` hinein, kein eigener Boden je Seite.
- **Tastenkürzel als Marke**, nie nacktes `<kbd>`: `components/Tastenkuerzel.tsx`
  (Flex mit `gap`, `currentColor`, **kein** `controlHeight`-Boden; `tastenkuerzelStil` pinnt die
  Abwesenheit).

## Texte: zeigen statt erklären



- **Text erklärt nie die Bedienung.** Was ein Knopf tut, zeigt seine Beschriftung; wie ein Feld
  gefüllt wird, zeigen Platzhalter (der wirksame Wert, etwa „jetzt“), Einheit und Prüfung; was
  fehlt, zeigt der Leerzustand mit Knopf (`SeitenLeer` mit `aktion`); warum etwas gesperrt ist,
  steht in wenigen Wörtern sichtbar am Element, nie nur im Tooltip (Touch).
- Kein Satz nennt Dateiformate, Server, Phasen oder Datenflüsse. Neue Seiten tragen keinen
  Zweck-Absatz unter dem Titel; bestehende `beschreibung="…"` werden schrittweise abgebaut
  (der Wächter erfasst sie nicht).
- Erlaubt: Fehlermeldungen, Zustände („Offline vorgemerkt“, „Update lädt“), **ein** kurzer Satz
  zur Folge vor einem unumkehrbaren Schritt, Datenschutz-Hinweise („Zugriff wird protokolliert“),
  Modulbeschreibungen aus wenigen Fachwörtern, die Darf-Zeile unter einer Rollenoption (Umfang in
  wenigen Wörtern, keine Bedienung; „Begriffe“, Rollen-Vokabular).
- **Erklärendes gehört in die Anwenderdokumentation** (in der App unter
  „Hilfe“): wer einen Erklärsatz entfernt, dessen Wissen sonst nirgends steht, schreibt
  es dort ins Kapitel. Regeln: `docs/anwender/AGENTS.md`.
- Wächter: `components/erklaertext.guard.test.ts` sucht Erklärmuster („Leer:“, „Klick auf“,
  „Enter sendet“, „sobald wieder Verbindung“, „read-only“ …) in sichtbaren Texten. Die Schuldmenge
  `OFFEN` ist leer; neue Einträge gibt es nicht, ein Treffer wird umgebaut.
- **Ausnahme Rundgang** (Entscheidung 20.11.2026): Der Rundgang für Erstnutzer darf
  die Bedienung erklären. Seine Texte stehen nur in `hilfe/rundgang/rundgangTexte.ts`, die der
  Wächter als einzige Datei ausnimmt (`AUSNAHMEN`); die Anrede-Regel gilt dort weiter. Er startet
  von selbst nur für Erstnutzer und im Einsatz nur in einer Übung, nie am Handschirm oder auf einem
  gekoppelten Gerät oder unter Browser-Automatisierung (`navigator.webdriver`), und öffnet weder
  Paneel noch Schublade.
- **Anrede: niemand wird angesprochen** (Entscheidung 19.11.2026). Kein Du, kein Sie,
  auch nicht in Servertexten, die bis zum Anwender durchkommen. Texte nennen die Sache („Eigene
  Rolle“, „Code aus der Authenticator-App“) oder den Handgriff im Infinitiv („Nur bestätigen,
  wenn …“); eine Frage ohne Pronomen ist erlaubt („Mit welchem Rufnamen ins ETB schreiben?“).
  Dieselbe Regel gilt für die Anwenderdokumentation. Wächter:
  `anredeText.guard.test.ts`; „Sie“ für eine Sache am Satzanfang steht dort als bewertete
  Ausnahme.
- **Kürzel sind eingeführt oder erklärt**: Die Oberfläche zeigt ein
  Kürzel nur, wenn es in `anzeige/kuerzel.ts` (`EINGEFUEHRTE_KUERZEL`) steht oder auf derselben
  Fläche sichtbar erklärt wird; sonst wird es ausgeschrieben („Unterabschnitte“, nicht „UA“). Ein
  neues Kürzel kommt in die Liste und in die Tabelle des Kapitels `zeiten-und-kuerzel.md`
  (`anzeige/kuerzel.test.ts` hält beide gleich). Kurzbezeichnungen der Organisation („EA 1.1“) sind
  Daten und bleiben. **Die Stärke** schreibt nur `anzeige/staerke.ts` (`staerkeText`, Wert
  „1/2/5//8“); jede Fläche mit Stärke nennt die Schreibweise „F/UF/M//Σ“ einmal sichtbar
  (Spaltenkopf, Feldetikett, Legende), der Wert trägt `STAERKE_AUSGESCHRIEBEN` als `title`
  (`StaerkeAnzeige`, `Kennzahl notizBeschreibung`). „Ges“, „Gesamt“ und eine Stärke ohne Summe gibt
  es nicht (Wächter `anzeige/staerke.guard.test.ts`). **Die Schreibweise erklärt sich auf Tippen**: in Komponenten
  steht sie nur über `anzeige/KuerzelErklaerung.tsx` (`StaerkeSchreibweise`, schmale Spalte
  `umbruchVorSumme`), einen Knopf ohne Knopfoptik mit Popover aus Bedeutung, Beispiel und dem Link
  „Zeiten und Kürzel“; ein Tooltip allein trägt auf Touch nicht. Der Knopf hält Klicks, Enter und
  Leertaste, Zeile und Tabellenkopf darum lösen nicht aus; Esc und Pfeile reicht er geschlossen
  weiter, und ein Klick auf den Verweis im Fenster erreicht die Umgebung (Sprungpalette schließt).
  Nie in einem Link oder `<label>`: dort bleibt die Schreibweise Text, und die Erklärung steht einmal
  über den Zeilen (Überblick: `vorspann` des Paneels, nicht im Kopf-Meta, das schmal abgeschnitten
  wird). Ein Spaltentitel als Knoten trägt `etikett` mit dem Klartext. **Die Trefffläche ist die
  Textzeile**, eine begründete Ausnahme von der Staffel 30/48/72 (Entscheidung 19.11.2026): das
  Kürzel steht in dichten Etiketten direkt über bearbeitbaren Werten, ein größeres Feld überdeckte
  sie, und die Erklärung ist ein Zusatz, keine Handlung. Ausnahmen mit Grund und der Wächter (auch
  Etiketten in `.ts`): `anzeige/kuerzelErklaerung.guard.test.ts`; in Leseansichten zählt der
  Erklär-Knopf nicht als Aktion (`test/kuerzel.ts`, `aktionsKnoepfe`).

## Begriffe

- **Rollen-Vokabular** (Entwurf
  `docs/superpowers/specs/2026-11-19-zlzpieaq-rollen-vokabular-design.md`): Name und Darf-Zeile
  jeder Rolle stehen nur in `einsatz/rollenVokabular.ts` (Rolle im Einsatz, in der Organisation,
  in der Verwaltung, Stufe der Modulsperre). Eine Rolle heißt überall gleich: „System-Admin“ (mit
  Bezug auf den Einsatz „System-Admin der Organisation“, nie „Org-Admin“), „Führungskraft der
  Organisation“, ohne Rolle „Keine“ bzw. am Konto „Keine Rolle“; Felder heißen „Rolle in der
  Verwaltung“, „Rolle in der Organisation“, „Rolle im Einsatz“. Jede Auswahl, die eine Rolle
  vergibt, nutzt `rollenOptionen` und `rollenOptionRender` (`einsatz/rollenOption.tsx`): offen Name
  und Darf-Zeile, geschlossen nur der Name. Darf-Zeilen höchstens 80 Zeichen. Eine neue Rolle kommt
  zuerst ins Vokabular (der `Record` bricht sonst den Build). Wächter
  `einsatz/rollenVokabular.guard.test.ts`.
- **Voreingestellte Werte heißen „Vorgabe“**: nie „Default“,
  „Fallback“ oder „Standard“ im sichtbaren Text. Platzhalter nennen den Wert, der leer wirklich
  gilt; kein „Leer = …“-Satz daneben. Bausteine in `components/vorgabeText.ts`
  („… (Vorgabe)“, „Vorgabe der Organisation: …“), Wächter `components/vorgabe.guard.test.ts` mit Ausnahmeliste
  für Eigennamen („Standard-Rufname“, „Standardansicht“).
- **Meldung und Lage** (Begriffe in
  `docs/design/2026-10-21-meldungsmodell/README.md`): das Modul heißt „Meldungen“ (Eingang und
  Ausgang), „Lagemeldungen“ ist die Sicht auf die lagerelevanten Meldungen. Eine Meldung anderer
  Art wird „In die Lage übernommen“ (Aktion und Dialog „In die Lage übernehmen“, Rückmeldung,
  Hinweis, ETB-Eintrag), ihr Etikett ist „In der Lage ✓“; „übergeben“ steht dafür nie. Der
  ETB-Typ „Lage“ heißt in der Mehrzahl „Lagefeststellungen“, nie „Lagemeldungen“. Das Paneel des
  Lagebilds mit ETB-Einträgen heißt „Jüngste ETB-Einträge“.

## Zeitdarstellung

- **Zeitdarstellung**: eine
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
  sie unter `useDruckModus` weg. Kein
  `.format('…')` und kein `formatiere(…, '…')` mit `HH`/`mm`/`DD`/`YYYY` außerhalb von `anzeige/`
  (Maschinenformate ab `YYYY-MM-DD` ausgenommen); Wächter `anzeige/zeitDarstellung.guard.test.ts`,
  Schuldmenge `OFFEN` leer. Titelvorschlag und Startinhalt eines Lagevortrags werden
  gespeichert und nehmen `konventionenOhneGeraet` (Einsatz vor Organisation, ohne Gerätewahl, wie
  Druck und Servertexte); ein Eingabefeld zeigt seinen Wert taktisch. Nebenformen im Kern:
  `datum`/`kalendertag` (Tag ohne Uhrzeit, `10okt26` bzw. `10.10.26`), `uhrzeitOhneDatum`
  (Wanduhrzeit `HH:MM` ohne Tag: Verpflegungsplan, Wechselzeiten), `tagUndUhrzeit` (Anfang eines
  Zeitraums), `leereUhrzeit` (Lücke in Ziffernbreite); „heute“ einer Nebenzeit (Nachtrag, Übergabe,
  Zeitraumende) über das `jetzt` von `zeitKurz`.
