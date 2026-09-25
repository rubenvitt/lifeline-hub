# CLAUDE.md

## ClickUp

Dieses Projekt hat ein eigenes ClickUp-Projekt im Space **Lifeline Hub** (`901511065513`,
Workspace/Team `9015920204`). Das **Entwicklungsboard** (`901523554968`) ist das
Task-Board des Projekts, das **Feedbackboard** (`901523554969`) sammelt Feedback.

Tasks werden selbstständig über den ClickUp-MCP angelegt — wie und wann beschreibt der
Skill `clickup-task-anlegen`.

## Planung und Ausführung — OpenSpec und Superpowers (LFH-588)

**Zwei Quellen, und die Grenze läuft nicht dort, wo die Namen sie vermuten lassen.**
**OpenSpec** (`/opsx:*`) besitzt den **Änderungszyklus**: klären, entwerfen, Spec und
Aufgabenschnitt schreiben, die Aufgabenliste abarbeiten, archivieren. **Superpowers**
(`superpowers:*`) besitzt die **Arbeitsdisziplin**: Worktree, Debugging, TDD, Verifikation,
Review, Branch-Abschluss. Die beiden schließen einander nicht aus, sie greifen ineinander.

**Die *planning boundary* gilt für fünf der sechs Workflows, nicht für alle** — gemessen,
nicht vermutet: `explore`, `propose`, `update`, `sync` und `archive` fassen keinen
Projektcode an (`openspec-propose/SKILL.md`: „This workflow creates planning artifacts only
… Do not edit project code"). **`/opsx:apply` dagegen setzt um** — „Implement tasks from an
OpenSpec change" (`openspec-apply-change/SKILL.md`), und das Wort `boundary` kommt dort kein
einziges Mal vor.

Von neun Dispatches der Entwicklungs-Skills haben drei ein OpenSpec-Gegenstück — **zwei aus
der Planung und eines aus der Ausführung**:

| Dispatch | Ziel | Art |
|---|---|---|
| `superpowers:brainstorming` | `/opsx:explore` | Planung |
| `superpowers:writing-plans` | `/opsx:propose` | Planung |
| `superpowers:executing-plans` | `/opsx:apply` | **Ausführung** |

Die sechs übrigen bleiben bei Superpowers: `using-git-worktrees`, `systematic-debugging`,
`test-driven-development`, `verification-before-completion`, `requesting-code-review`,
`finishing-a-development-branch`. **OpenSpec löst Superpowers nicht ab.**

**`/opsx:apply` bringt keine eigene Arbeitsdisziplin mit.** Weder TDD noch Review stehen in
seinem Skill (gegriffen: null Treffer). Es läuft die Aufgabenliste ab; *wie* eine einzelne
Aufgabe entsteht, sagt unverändert `superpowers:test-driven-development`, und vor jeder
„fertig"-Aussage stehen weiterhin `verification-before-completion` und
`requesting-code-review`. Wer `/opsx:apply` als Ersatz dafür liest, verliert die Zusicherung,
ohne dass ein Test rot wird.

**Zwischen Plan und Umsetzung steht ein Pflicht-Checkpoint.** `/opsx:propose` hält nach den
Artefakten an: „Wait for a new user request after the artifacts are presented; then start the
apply workflow." Der Stopp ist das erwartete Verhalten und **kein Fehlschlag** — Artefakte
vorlegen, Freigabe abwarten, dann `ready for development` und `/opsx:apply`.

**Vier Ablageorte, keine Überschneidung** — wer das verwechselt, erzeugt zwei Wahrheiten:

| Ort | Inhalt | Status |
|---|---|---|
| `openspec/changes/<name>/` | Planungsartefakte einer laufenden Änderung | lebend, hier landet Neues |
| `openspec/changes/archive/` | abgeschlossene Änderungen nach `/opsx:archive` | lebend |
| `openspec/specs/` | Fähigkeits-Specs mit SHALL/MUST; beschrieben von `/opsx:sync` und `/opsx:archive` | lebend |
| `docs/superpowers/` | Herleitungen, Entwürfe und **Messprotokolle** abgeschlossener Arbeit | **eingefrorenes Archiv** |

`docs/superpowers/` wird **nicht** nach OpenSpec migriert, und das ist gemessen statt vermutet:
der Baum trägt 95 Specs plus Pläne, und ihre Gliederung ist die eines Beweisstücks, nicht eines
Requirements — Stichprobe LFH-523: `Befund / Entscheidung / Die gemessene Falle / Prüfspur / Was
ausdrücklich nicht behauptet wird`. Eine Prüfspur, die belegt, dass `@rc-component/table` bei
einer Zahlbreite still auf `fixed` kippt, ist **kein** SHALL-Satz; `openspec/specs/` hat dafür
keinen Platz. Dazu kommen **13 tragende Verweise** aus CLAUDE.md und AGENTS.md („Prüfbelege
stehen in …", „Herleitung und Prüfspur: …") — die brechen beim Verschieben **still**: kein roter
Test, kein Fehlerbild, nur ein toter Pfad in einer Begründung. Wer den Baum doch anfasst, greppt
die Verweise zuerst.

## Frontend — Gestaltungssprache Neuentwurf „Instrumententafel“ (22.09.2026)

Der Claude-Design-Neuentwurf ist app-weit umgesetzt (Commits `aed31b40`…`060a1b39`). Er ist
keine neue Grundlage, sondern die Fortschreibung von LFH-352 (dunkel, Radius 0,
Archivo/JetBrains Mono, Bedienfarbe blau): neutralere, tiefere Palette · Nachtbetrieb als
Vorgabe · neuer Rahmen · neue Bausteine · neu gedachte Screens. **Maßgeblich sind die
Entscheidungen des Auftraggebers** in `docs/design/2026-09-21-neuentwurf/umsetzung.md` (dort
auch die Palette mit Werten); die Entwürfe liegen daneben (`neuentwurf.dc.html`,
`shell.dc.html`, Inline-Styles maßgeblich — das mitgelieferte `_ds/…/tokens/*.css` ist der
ALTE Stand und wird nicht übernommen). **Bei Konflikten mit älteren Regeln gewinnt das
Design — außer bei der Sichtung** (BBK bleibt, siehe unten). Wo diese Datei eine ältere Regel
umkehrt, steht das am Absatz selbst mit „Neuentwurf 22.09.2026".

- **Nachtbetrieb ist die Vorgabe.** `MODUS_DEFAULT = 'dark'` in `theme/ThemeModeProvider.tsx`
  (vorher `system`, das als Wahl erhalten bleibt), **gespiegelt im Bootstrap-Skript von
  `index.html`** — wer eines ändert, ändert beide. Die Hellpalette ist aus der Nachtpalette
  **abgeleitet** (gleiche Rollen, Kontrast mindestens wie vorher).
- **Rollen in `theme/tokens.ts`** (+ `theme/rollen.css`, Gate 5 unverändert): neu `kopf`,
  `paneel`, `flaeche3`, `text2`, `steuerRahmen` (trägt antds `colorBorder` — der Entwurfswert
  `linieStark` hält WCAG 1.4.11 nicht), `bedienHover`, `bedienText`, `aufBedien`, `normalText`,
  die deckenden Statusflächen `normal|achtung|alarm|bedienFlaeche`, `bannerGrund`/`bannerLinie`
  und die Zeilentönungen `berichtigung|luecke|problemZeile`. Zwei gemessene Abweichungen vom
  Entwurf (`schwach`, `steuerRahmen`) und die benannte Verschlechterung von `marke` stehen mit
  Messwerten am Nachtblock. **`rahmenFarben`** ist bewusst modusunabhängig: Kopfleiste und Rail
  bleiben in **beiden** Modi dunkel, und als `Farbrollen` müsste der Nachtblock sie wertgleich
  doppeln — genau die Redundanz, die `rollen.guard.test.ts` verbietet. Daneben eigene
  Paletten, keine `Statusrolle`: **`etbTypFarben{Dunkel,Hell}`** (je Typ `kante` + `wort`, weil
  Dekoration und Text verschiedene Böden haben; Zugriff über `etbTypFarbe()` in
  `statusFarben.ts`) und **`warnstufeFarben{Dunkel,Hell}`** (Balken der Gefahrenmatrix, Zugriff
  `warnstufeBalkenFarbe()`; die Zellfläche bleibt `flaechenFarbe`). **`schriftskala`** benennt
  die Stufen über der Dichte-Grundschrift (Überschrift 30 · Seitentitel 14/600 · Augenbraue
  10/600 Versalien .14em · Mono-Meta 11 · Datenwert 22/32/40 Mono 500); CSS-Seite
  `--lfh-typo-*`, deckungsgleich gehalten von `rollen.guard.test.ts`. Zahlen, Zeiten,
  Funkrufnamen, Koordinaten und Nummern laufen immer Mono mit `tabular-nums`. Die Dichte-Staffel
  30/48/72 gilt weiter — die 22/30/46 des Entwurfs sind Skizze.
- **Bausteine in `components/instrument/`** (Seiten importieren über `index.ts`; jede Datei
  trägt im Kopf, welche Regel sie hält): `Augenbraue` (Metadaten-Stimme; `als="h2…h6"` macht
  sie zur Überschrift, ohne die Optik zu ändern) · `Paneel`/`PaneelZeile` (Grundfläche, Kopf
  38 px) · `Formularpaneel` (Feldgruppe einer Formularseite als Paneel; reine Hülle im selben
  `<Form>`, die sticky Speichern-Leiste steht danach im selben `<form>`) · `PaneelZustand` (Lade-/Fehler-/Leerzustand eines Paneelkörpers) · `Kennzahl`/
  `Kennzahlenband` („Zahl führt", Fugenraster) · `Aufgliederung`/`Balken` (Mengenbilder, nie
  Ersatz der Zahl) · `Zeitachseneintrag` (Zeile jedes zeitlich gelesenen Stroms: Zeit ·
  2-px-Typkante · Typwort · Text · Hinweiszeile) · `StatusZelle`/`StatusChip` (Status als
  getönte Fläche, `wort` ist Pflicht-Prop) mit der einen Übersetzung `statusFlaeche.ts` ·
  `Segmentleiste` (Ersatz für antds `Segmented`, dessen Pillenform die Formensprache bricht) ·
  `Sammelbanner` (Live-Zufluss, blau: Bedienaufforderung, keine Gefahr) ·
  `Schnellerfassungszeile` (nur die Hülle — die Erfassungs-Norm gilt weiter) · `Datenraster`/
  `Datenfeld` (Detail-Optik statt `Descriptions`, `<dl>`) · `rollenwerte`/`useRollen` (Rollen
  des aktiven Modus für TSX, weil antd `paneel`, `flaeche3` & Co. nicht kennt).
- **Seitenkopf 44 px** in `components/EinsatzSeite.tsx` (`SEITENKOPF_HOEHE`, Boden, der mit der
  Staffel wächst): `titel` 14/600 als `h1` (Paneele gliedern darunter ab `h2`) · `meta` Mono · `aktionen` rechts (Primär blau gefüllt,
  sekundär umrandet). **Markdown-Inhalt hängt sich in diese Gliederung ein, nicht daneben**
  (LFH-621): `components/Markdown.tsx` und `MarkdownEditor` tragen die Pflicht-Prop
  `unterEbene` — die Ebene der nächsten Überschrift über dem Text, `#` wird die Stufe darunter,
  `h6` ist der Boden. Kein fester Versatz: der frühere Versatz 3 ließ `###` und tiefer auch
  dort auf `h6` zusammenfallen, wo nur der Seitentitel oder ein Zeitachsenkopf darüber steht.
  Heute: Lagebericht/Befehl lesend 3 (unter dem Abschnittskopf), Befehl-Entwurf 2 (Paneel),
  Lagebericht-Entwurf und ETB-Schnellerfassung 1, ETB-Einträge 2 (der Gruppenkopf der
  Zeitachse ist ein `h2`). **`breite` ist per Vorgabe `'voll'`** — die Instrumententafel füllt die
  Inhaltsbreite; `'schmal'` (`flaeche.seiteSchmal`) ist die begründete Ausnahme für reine
  Formularseiten. `flaeche.seiteBreit` lebt nur noch, bis Bestandsaufrufer es beim eigenen
  Umbau streichen. Der Akzentstrich über dem Titel ist entfallen.
- **Rahmen** (Layoutmaße des Entwurfs, keine Dichte-Angaben): Kopfleiste 52 px
  (`components/Kopfleiste.tsx`, `KOPF_HOEHE`; Markenzelle in `RAIL_BREITE` 60 mit
  14-px-Quadrat in `marke`) · Rail 60 px, Kategoriezeile 62 px als Boden unter der Staffel
  (`einsatz/IconRail.tsx`; sichtbares Kurzetikett `kurz`, voller Name bleibt `aria-label`;
  Einstellungen per `fuss: true` unten abgesetzt, in derselben `kategorien`-Liste) ·
  Modulpanel 208 px mit 42-px-Kopf, aktive Modulmarke 2 × 16 px in `bedien`, Fuß
  „Einsatzdauer" (`einsatz/ModulPanel.tsx`) · **Sprungpalette** ⌘K 640 breit, 120 px von oben,
  Kopf 52, Maske als fester Wert (`command-palette/CommandPalette.tsx`; die Zeilen tragen ihren
  Boden weiter über die Staffel).
- **Modulstruktur** (`einsatz/modulRegistry.ts`): **Führung · Überblick** ist die Startseite
  eines Einsatzes (`redirectZiel()`, Fallback ETB; vorher das Lage-Dashboard); **Aufträge/
  Befehle** stehen unter Führung statt Kommunikation (Anordnungen sind Führungsmittel);
  **Meldebild** ist der sichtbare Name der früheren Kräfteübersicht und steht vorn unter
  Kräfte & Mittel — **Schlüssel und Route bleiben `kraefteuebersicht`**, damit Deeplinks und
  gespeicherte Standard-Module nicht brechen.
- **Keine erfundenen Daten.** Was der Entwurf zeigt, aber keine Datenquelle hat, wird
  weggelassen — nicht als Platzhalter gebaut — und steht im ClickUp-Epic „Neuentwurf
  Instrumententafel – Datenlücken des Designs" (LFH-606…LFH-617, z. B. Evakuiert 607,
  FMS-Status je Einheit 609, Koordinate an der Person 613). Die Auslassung trägt ihr Ticket
  im Code-Kommentar und wird im Test als **Abwesenheit** gepinnt. **Eingelöst ist Evakuiert
  (LFH-607):** Lageplatz B zeigt „Evakuiert N · von M geplant“, sobald ein Evakuierungsbezirk
  aktiv ist (nicht storniert, nicht aufgehoben — dasselbe Prädikat wie `istAktiverBezirk`,
  als Auslöser `evakuiert` am Einsatz); ohne Zugriff auf das Modul Betreuung bleibt die Zelle
  stehen, ohne Zahl und ohne Link (Change `openspec/changes/lfh-607-kennzahl-evakuiert/`). **Eingelöst ist der Pegel (LFH-606):** er steht auf Platz 1
  des Kennzahlenbands, „Höchste Warnstufe" ist dafür raus (Entscheidung 22.09.2026; die
  Warnstufe bleibt im Seitenkopf-Hinweis und in der Gefahrenmatrix). **Seit LFH-640 nur bei
  festgelegtem Pegel:** das Band hat immer sechs Plätze, vier Kernplätze und zwei Lageplätze;
  jede Kennzahl hat genau einen Heimatplatz, belegt wird ein Lageplatz nur durch eine bewusste
  Entscheidung am Einsatz (`EinsatzAnzeige.lagekennzahlen`), nie durch einen Messwert, und
  ein neuer Zuschnitt während der Betrachtung kommt als Sammelbanner, nicht als Tausch
  (Spec `docs/superpowers/specs/2026-09-23-lfh-640-lagebezogene-kennzahlreihe-design.md`). **Eingelöst ist auch die
  Rückmeldung (LFH-610):** Spalte „Rückmeldung“ und Kachel „keine Rückmeldung“ im Meldebild,
  letzte Rückmeldung je Abschnitt im Überblick, „Letzte Meldung“ in der Lagekarte; die
  Entscheidungen stehen in `umsetzung.md`. **Eingelöst sind ebenso die ETB-Gesamtzahl und die
  Bilanz-Summen (LFH-612)** — der Server zählt sie über denselben Filter wie die Liste,
  Einzelheiten im ETB-Absatz weiter unten.

## Frontend — UI-Form-Leitlinie (Drawer-Nutzung)

**Farbachse der Betroffenen-Module (LFH-455):** Personenstatus, Schadensstatus und
Schadensausmaß gehören zum A2-Vertrag in `theme/statusFarben.ts`. Ihre Darstellung folgt
`StatusTag` — seit dem Neuentwurf (22.09.2026) als getönte Fläche (siehe „Statusfarbe" in
der Bedien-Leitlinie); die Rand-Form aus LFH-446 (Rollenfarbe am Rand, `colorText` als
Beschriftung) bleibt über `darstellungsart="rand"` erreichbar. „Betroffen“ und
„abgemeldet“ sagen nichts über medizinische Dringlichkeit; „verstorben“ ist kein roter
Alarm wie SK I. Diese Personenstatus sind neutral, „vermisst“ ist `achtung`. Beim Schaden
ist „offen“ `achtung`, „übergeben“ `bedien`, „abgeschlossen“ neutral. Beim Ausmaß ist
„gering“ neutral, „mittel“/„groß“ `achtung`, „katastrophal“ `alarm`; die Labels unterscheiden
die zusammengefassten Stufen.

**Lagezustand je Einsatzabschnitt (LFH-608)** liegt als `abschnittLagezustand` im selben
Vertrag: planmäßig `normal`, angespannt `achtung`, kritisch `alarm`. „Nicht beurteilt“ ist
**kein** Eintrag, sondern ein leeres Feld — ohne Kantenfarbe im Überblick, als Wort in der
Detailansicht. Das Blau der UHS-Zeile im Entwurf ist Bedienblau und keine Lagestufe. Ein
Wechsel des Lagezustands schreibt einen System-ETB-Eintrag, die übrigen Abschnittsfelder
nicht. Der Fortschritt ist eine **manuelle Einschätzung** (leer ≠ 0 %); die Zählung
„n/m Aufträge erledigt“ steht daneben und ersetzt sie nicht, weil jeder Auftrag gleich
wiegt. Die Überblickszeile trägt die Werte des obersten Abschnitts selbst und meldet einen
schlechter beurteilten Unterabschnitt eigens („UA kritisch“).

**Betreuung auf der Lagekarte (LFH-673).** Betreuungsstellen sind eine Marker-Ebene wie die
UHS, stehen in `alleVerortet` und „Nicht verortet" und werden über `?platzieren=betreuungsstelle:<id>`
platziert. Die Ebene hängt an der Modulfreigabe Betreuung, und zwar an der **Datenquelle**
(`pages/lagekarte/betreuungEbene.ts`, Muster der Betroffenen): Ohne Recht gibt es keinen
Abruf und eine Sperrzeile, ein 403 ist kein Quellenfehler. Die **Ort-Vorschau kennt keine
Stellen**, weil ihre Peilung (`src/geocoding/marker.rs`) nur den Einsatz-Lesezugriff prüft.
Ein Bezugspunkt dort nennte den Namen auch ohne Modulrecht. Die Verortung läuft über den
Stellen-PATCH, schreibt **kein ETB** (LFH-639 D5), wird aber live verteilt. Träger ist
`Geschrieben::still_geaendert`, denn ohne diese Marke schnitte der Leerlauf-Riegel einen reinen
Karten-PATCH still ab. Evakuierungsbezirke sind der Zonentyp `evakuierungsbezirk` mit
`lage_zone.evakuierungsbezirk_id` (n : 1, Vorbild Gefahrengebiet). Die Zone trägt nur die
Kennung, Bezeichnung und Räumungszustand kommen aus der gesperrten Betreuungs-Query.
Setzen der Zuordnung ohne Modulrecht ist 403, Storno löst die Flächen im selben Vorgang.
`0119` ist der erste Rebuild von `lage_zone`. Herleitung:
`openspec/changes/lfh-673-betreuung-auf-der-lagekarte/design.md`.

**Verbleib „Notunterkunft“ → Betreuungsstelle (LFH-674).** Der Verbleib trägt nur die
**Kennung** der Stelle (`person_verbleib.betreuungsstelle_id`, Cache
`einsatz_person.aktuelle_verbleib_betreuungsstelle_id`, `0121`). Den Namen belegt der
**Client** sichtbar und änderbar im Ziel vor. Der Server kopiert keinen Stellennamen in Ziel,
Kurzform oder ETB. Die Prüfkette ist 422 (andere Art) → 403 (kein Betreuungsrecht, **vor** jedem
Lesen der Stelle) → 404 → 409 (storniert). Eine geschlossene Stelle ist erlaubt. **„davon
namentlich n“** rechnet die Route `…/betreuung` und **nicht** `repo::uebersicht`, denn die
speist auch den gesicherten Lagestand. Ohne Personenrecht **fehlt** das Feld. Die Zahl geht in
keine Belegung, Kopfzahl oder Summe ein, führend bleibt die Mengenmeldung. Live nachgeführt
wird sie über `EINSATZ_STREAM_EVENTS.person → betreuung`, ein zweites Server-Ereignis gibt es
nicht. Das kostet je Personen-Ereignis ein `GET …/betreuung` auf **jeder** Einsatzseite, weil
`useModulZaehler` die Query dort hält. Das ist bewusst angenommen: Ein `betreuung`-Ereignis
erreichte auch Lesende ohne Personenrecht und verriete ihnen den Takt der Zuordnungen. `betreuungsstelle` ist seitdem **kein Leaf** mehr, ein Rebuild braucht den FK-Schalter.
Herleitung: `openspec/changes/lfh-674-verbleib-notunterkunft-betreuungsstelle/design.md`.
**Meldeverlauf der Betreuung (LFH-676).** `GET …/bezirke/{bid}/staende` und
`…/stellen/{sid}/belegungen` liefern die ganze Reihe samt zurückgenommener Meldungen, in der
Ordnung von `juengste_meldung!` (`meldereihenfolge!` in `src/betreuung/repo.rs`). `aktuell`
kommt aus dem **Zeiger** am Objekt, nie aus einer zweiten Rechnung, auch nicht im Client. Ein
fremdes Objekt ist 404, bevor die Reihe gelesen wird, sonst sähe „fremd“ aus wie „ohne
Meldung“. **Nachgetragen heißt im Verlauf ≥ 60 s zwischen Zeitpunkt und Erfassung**
(`istNachgetragen`, dieselbe Schwelle wie das ⧖ im ETB). Die Nachtragung im Sinn von
LFH-639 D5 („vor dem damals aktuellen“) ist nicht gespeichert. Die Rücknahme aus dem
Verlauf ist unumkehrbar und hat deshalb eine Rückfrage. Sie läuft über eine **eigene**
Mutation in `betreuung/MeldeVerlauf.tsx`: die der Seite melden über `SeitenHinweise`, der
Grund stünde sonst doppelt. Der Aufklappweg ist `Datensicht.aufklappen`: beschriftet, mit
Zeilenkennung im Namen, in Karte **und** Tabelle mit einem Zustand, Inhalt erst beim
Aufklappen gerendert. In der Tabelle steht der Auslöser in der fixierten Kennungszelle,
ohne eigene Aufklappspalte: hinter der Kennung glitt eine solche Spalte bei 390 px unter sie
(Gate 1, gemessen), an Position 0 erbte sie deren `fixed`. Die Bestands-Prop `aufklappzeile` (antds 16-px-Symbol, nur Tabelle)
verschwindet mit LFH-697. Herleitung: `openspec/changes/lfh-676-betreuung-meldeverlauf/design.md`.

**Stand- und Belegungsmeldungen sind offline-fähig (LFH-675).** Sie laufen über die
Offline-Queue (`offline/schreiben.ts`, Arten `stand`/`belegung`) mit `client_id`, eindeutig
je Einsatz und Meldereihe (`0122`). Der Replay-Lookup läuft **vor** jeder Zustandsprüfung,
einmal vorab und einmal in der `BEGIN IMMEDIATE`-Transaktion. Eine gespeicherte Meldung kommt
deshalb auch am stornierten Bezirk, an der geschlossenen Stelle und nach Einsatzende zurück
(`EinsatzSchreibfreigabe`), ohne ETB-Eintrag und ohne Live-Ereignis. Ein Schlüssel an einem
anderen Objekt ist 422. **Den Erfassungszeitpunkt trägt nur die vorgemerkte Kopie**, online
gilt die Serveruhr. Sonst stempelte der Flush die Sendezeit, oder eine vorgehende Tablet-Uhr
machte Online-Meldungen zu 400. Anlegen, Ändern, Rücknahmen und die Leermeldung bleiben
online. Herleitung: `openspec/changes/lfh-675-betreuung-meldungen-offline/design.md`.

**Sichtung ist eine eigene fachliche Farbachse am selben zentralen Ort**, keine A0-Rolle.
`SichtungsTag` zeigt die feste Kennzeichnung aus `tokens.ts` als umrandetes Farbfeld:
SK I rot, II gelb, III grün, IV blau, Tote schwarz; „unverletzt“ ohne erfundene Fachfarbe
([BBK: Triage/Sichtung](https://www.bbk.bund.de/DE/Themen/Gesundheitlicher-Bevoelkerungsschutz/Triage-Sichtung/triage-sichtung.html)).
Die Umrandung macht Gelb auf hellem und Schwarz auf dunklem Grund sichtbar, die separate
Beschriftung folgt dem Modus. `color="black"` an antds `Tag` ist ausdrücklich falsch:
es ist kein Preset und erzeugt ein statisches Farbpaar ohne Nachtmodus. SK IV/blau ist die
benannte fachliche Ausnahme zur blauen Bedien-/Beziehungsrolle. Übergabe, Geschädigt-Bezug
und UHS-Verortung tragen `bedien` als aktive Beziehung, nicht als Zustand der referenzierten
Entität. Personenstatus und Sichtung bleiben unabhängig, auch bei `SK=tot` mit anderem
Personenstatus. **Die Sichtung ist die eine Ausnahme vom Vorrang des Neuentwurfs**
(22.09.2026): dessen Farben (II orange, III gelb, IV grau) hat der Auftraggeber ausdrücklich
abgelehnt — `SichtungsTag`/`sichtungsfarben` bleiben BBK.

**Nachzug LFH-650 (gemessen, Prüfliste `2026-09-22-lfh-613-pruefliste.md`):** Blauer
Bedien-TEXT nimmt `rollen.bedienText`, nicht antds `colorLink` — der Linkton trug auf einer
Lückenzeile 5,93 (Tag) / 4,50 (Nacht). Dasselbe gilt für den Radio-Knopf (LFH-677): antd schreibt
seinen Text gewählt und unter dem Zeiger in `colorPrimary`, am Tag 6,59 auf Weiß.
`index.css` (global geladen) setzt NUR diesen Text auf `--lfh-bedien-text`, nur im Stil
`outline`. Ein Komponenten-Token
`Radio.colorPrimary` färbte auch Scheibe und Flächen und ist deshalb verworfen. Personen-Marker tragen eine unsichtbare Trefferzone mit
dem Durchmesser `controlHeight` (`KarteMarker.trefferDurchmesser`) und außen 2 px Schwarz um den
weißen Rand (Weiß + Schwarz halten gegen jeden Grund ≥ 4,58); die Lagekarte setzt beides nicht.
Personen-Cluster zeigen ihren Ring nach Sichtung und im Kern das Kürzel der dringlichsten
Kategorie — kein eigenes Personen-Segment mehr. Die gefüllte `BemerkungZelle` ist ein
Textknopf (gleiche Höhe wie der Platzhalter), der Fehler einer Inline-Zelle steht an der Zelle
(`data-fehler`), nicht im Toast.

`e2e/betroffene-kontrast.spec.ts` prüft die tatsächlich zusammengesetzten Text-/Hintergrundpaare
auf Aufnahme-Route, im Modal, in Listen und Details: Tag ≥ 7:1, Nacht ≥ 5:1. Die Sichtungswahl
wird ungewählt, gewählt und mit Hover geprüft; Alpha wird mitgerechnet, unbelegte
Bild-/Opacity-Kompositionen werden abgelehnt. Kein zusätzlicher mobiler Status-Slot ist
Teil dieser Farbentscheidung.

**Tagmodus des Neuentwurfs (LFH-618, 22.09.2026).** Drei Regeln aus der ersten Sichtprüfung
im Hellmodus, Befunde samt Messwerten in
`docs/superpowers/specs/2026-09-22-lfh-618-hellmodus-pruefliste.md`:
**(1)** `achtung`/`alarm` als TEXT lesen `achtungText`/`alarmText` — die Füllfarben tragen den
Tagesboden 7 : 1 nicht; nachts sind beide Rollen wertgleich mit der Füllfarbe. Kante, Punkt,
Balken und Legendenfeld bleiben auf der Füllfarbe. Vorher wichen `statusFlaeche` und
`Kennzahl` am Tag auf `text` aus: die Kontrastspecs waren grün, aber die Ampel am Tag
farblos. **(2)** Eine Hervorhebung (aktives Segment, aktive Nav-/Modulzeile, Hover) liegt auf
`flaeche3`, nicht auf `flaeche2` — die liegt am Tag bei 1,01–1,08 : 1 auf `paneel`/`flaeche`
und ist schlicht nicht da; nachts trennt beide Stufen nur 1,02 : 1. **(3)** Ein Kontrast wird
gegen den Grund gerechnet, auf dem der Text WIRKLICH steht: die ETB-Typwörter waren gegen
Weiß gerechnet, die Zeitachse steht auf `grund` — `e2e/hellmodus-kontrast.spec.ts` misst sie
dort. Der Messkern der Kontrastspecs liegt in `e2e/kontrast-kern.ts`.

**Auf der Karte trägt die Warnstufe der TEXT, nicht die Farbe** (LFH-357). `warnstufeKarte`
bildet fünf Stufen auf zwei unterscheidbare Rollen ab (`achtung`: niedrig/mittel · `alarm`:
keine/hoch/akut). A2 hielt das für gedeckt („wer die fünf Stufen unterscheiden muss, nutzt
`label` oder `form`") — auf der Kartenfläche stand aber keiner der beiden Kanäle:
`kartenLayer.ts` beschriftete die Zone mit ihrem **Namen**, und `form` trägt gemessen **drei**
Zeichen (`FORM_ZEICHEN`) für fünf Stufen, kann die Auflösung also gar nicht herstellen — es
bleibt deshalb an keinem Vertragseintrag gesetzt, statt der Vollständigkeit halber gesetzt zu
werden. Träger ist die reine, exportierte `zonenBeschriftung` (`pages/lagekarte/zonenStil.ts`):
„Warnstufe: <label>" unter dem Zonennamen, `label` ausschliesslich aus `warnstufeKarte` — wer
das Wort dort ändert, ändert die Kartenbeschriftung mit. Zonen ohne Warnstufe behalten ihren
Namen unverändert. **Ein fehlender Nachschlag heisst „Warnstufe: unbekannt", nicht „keine"**:
das Ladegate der Karte (`ladt`) hängt an `einsatz`/`config`, NICHT an der Gefahrengebiete-Query
— die Zone wird also gezeichnet, während die Gebiete noch laden oder ihr Abruf gescheitert ist.
Die **Farbe** rundet dort vorsichtshalber auf `keine` (Alarm, unverändert), der **Text** nicht;
`zonenBeschriftung` hat dafür drei Zustände statt zwei. **„Warnstufe: keine" heisst „keine Stufe
gesetzt", nicht „unbewertet"**:
`src/gefahr/repo.rs` rechnet die höchste Stufe über ein Severity-`MAX`, in dem `'keine'`
denselben Rang **0** bekommt wie gar keine Bewertung — die beiden Fälle sind aus den Daten
nicht trennbar, ein Wort, das sie trennt, behauptet zu viel. Die rote Fläche bleibt davon
unberührt; sie ist die Vorsichtsentscheidung aus `gefahrengebietStil`. **Nicht zugesichert ist
der Kollisionsfall:** `zonen-label` fährt ohne `text-allow-overlap`, ein gedrängtes Label kann
ausfallen — dann trägt wieder nur die Farbe. Wer das schliessen will, braucht einen
**graphischen** Kanal (Linienform je Stufe; `line-dasharray` ist in maplibre-gl 6.8.0 gemessen
`cross-faded-data-driven`, also feature-abhängig setzbar) und eine eigene Entscheidung dafür.

Die UI-Form richtet sich nach Umfang/Interaktion des Inhalts (LFH-19):

- **Vollseite / eigene Route** (`/einsaetze/:einsatzId/<modul>/:id`) → umfangreiche
  Detail-/Bearbeitungsansichten: mehrere Sektionen/Tabs, >~5 Felder, Workflow, Deep-Link-würdig.
  Referenzmuster: `BefehlDetailPage`, `PersonenDetailPage`.
- **Modal / Dialog** → kurze, blockierende Aktion: Bestätigung, kleines Formular (≤~3 Felder).
- **Inline / Expander** → kontextbezogener Zusatzinhalt, der die Seite nicht verlässt.
- **Drawer** → nur schlanker, fokussierter Quick-View (read-only Vorschau) oder
  Schnellerfassung (≤~4 Felder). Referenz: `PersonDetailDrawer`. Kein Bearbeiten
  umfangreicher Entitäten, keine mehrteiligen Tabs.

Faustregel: Sobald ein Drawer Tabs bekommt, einen Edit-Modus mit vielen Feldern trägt
oder breiter als ~480 px sein muss, gehört der Inhalt auf eine eigene Route.
Details/Inventar: `docs/superpowers/specs/2026-06-22-drawer-nutzung-reduzieren-design.md`.

**Die Liste ist die zweite Frage** (LFH-330/B2). Die vier Formen oben tragen einen **einzelnen**
Datensatz; für eine **Menge** gilt: Ist die Frage „welcher von diesen ist der richtige?", wird
verglichen → **Tabelle** (`components/KatalogTabelle.tsx`, oder `components/Datensicht.tsx` mit
`form="tabelle"`). Ist sie „was ist mit diesem hier?" → **Liste/Karte** (`components/Liste.tsx`,
oder `Datensicht` mit `form="karte"`). Kachel nur für Überblicksflächen. Der Karten-Fallback
unter `md` (`form="auto"`) ist die begründungspflichtige Ausnahme, nicht der Normalfall — die
Begründung steht im Dateikopf von `Datensicht.tsx`, die Regel in Abschnitt AK3b des
Drawer-Specs. Keine der 13 Katalogtabellen wird zu Karten.

**Die erste Kachel-Überblicksfläche mit Bedienung ist das FMS-Tableau** (LFH-642,
`kraefte/FmsTableau.tsx`). Es ist eine **Ansicht** der Fahrzeugseite (`?ansicht=tableau`,
Sprungmarke) und kein eigenes Modul, weil Endpunkte und Live-Event am Schlüssel `fahrzeuge`
hängen. Die Kachel trägt genau ein Bedienziel, `StatusWahl`, und ist selbst nicht klickbar.
Sortiert wird nach Abschnitt → Einheit → Funkrufname, nie nach Status. Die Ziffern 0–9 sind
über `fms_anker` nur Beschleuniger: Ein doppelt belegter Anker setzt nichts. Formverdikt und
Prüfliste stehen in `docs/superpowers/specs/2026-09-23-lfh-642-pruefliste.md`.

**ETB-Nachzüge LFH-463/464:** Der `tabelleAb`-Punkt, den LFH-464 der ETB-Chronologie als
einziger Konsumentin nach Browsermessung auf `xl` gesetzt hatte (`lg` behob den gemessenen
1024-px-Engpass nicht), ist mit dem Neuentwurf (22.09.2026) **entfallen** — das Tagebuch ist
keine `Datensicht` mehr (siehe unten). Die Auto-Form bricht fest bei `md`;
`datensicht.guard.test.ts` hält die Prop aus der Deklaration fern — wer sie zurückholt,
braucht wieder eine Browsermessung, nicht den Verweis auf LFH-464. Der optionale Einsatztermin
`naechste_lagebesprechung_at` wird in den Einsatzdaten gepflegt und als absolute
Wiedervorlage-Schnellwahl angeboten, wenn er bekannt und zukünftig ist. Kein
berechneter Rhythmus. Prüfbelege stehen in
`docs/superpowers/specs/2026-09-08-lfh-463-464-pruefliste.md`.

**Eine Spalte darf fließen, und nur dann rechnet die Tabelle nicht mehr mit dem längsten
Text** (LFH-523). `KatalogTabelle` rendert mit `scroll={{ x: 'max-content' }}` — die
Tabellenbreite ist damit **inhaltsgetrieben**, und eine Spalte ohne `width` trägt ihre volle
`max-content`-Breite bei. Ein normal umbrechbarer Meldungstext mit 209 Zeichen blieb deshalb
einzeilig und verbreiterte die Tabelle, während der Kartenzweig derselben Daten ihn umbrach.
Der **Rumpf scrollt dabei nicht** — der Überlauf steckt im Scrollcontainer der Tabelle, und
ein Test auf `document.body.scrollWidth` allein ist gegen diesen Befund blind (er war auf
altem Stand grün, während der Text 1122 px weit aus der Sicht ragte). Die Abhilfe ist ein
**Opt-in**: trägt genau EINE Spalte `mindestBreite` und haben alle übrigen eine Zahlbreite,
setzt das Primitiv `Σ(width) + mindestBreite` als `scroll.x`; `min-width: 100%` bleibt daneben
stehen. Ohne den Haken ändert sich an den achtzehn Katalogtabellen nichts. Gemessen wurde der
Befund an der ETB-Tabelle, die es seit dem Neuentwurf nicht mehr gibt; der Haken lebt in
`personen/personenSpalten.tsx` weiter, die ETB-Zahlen unten sind Herleitung, kein Bestand.
**Die ≥50-%-Zusicherung aus C7 ist davon nicht berührt, und das folgt aus der Rechnung statt
aus einer Messung:** liegt die Zahl unter der Containerbreite, ist die *benutzte* Breite in
beiden Fassungen dieselbe und die `auto`-Layoutrechnung verteilt identisch — auseinander gehen
sie erst, wenn `max-content` den Container übersteigt.
**Die Zahl wird gegen die SCHMALSTE Fläche gewählt**, auf der die Tabelle überhaupt steht
(ETB: 320 px, weil bei 1200 px Viewport rund 856 px Contentbreite bleiben und die vier festen
Spalten 494 px belegen). Eine größere Zahl holte den Überlauf zurück.
**Die gemessene Falle ist das Tabellenlayout:** `@rc-component/table` entscheidet
`if (fixColumn) return mergedScrollX === 'max-content' ? 'auto' : 'fixed'` — dieses Primitiv
fixiert Spalte 0 immer, eine Zahl kippt das Layout also still auf `fixed`, wo eine
Spaltenbreite **bindend statt bevorzugt** ist und die 96 px der Aktionsspalte den 72-px-Knopf
der Handschuhstufe anschnitten. `tableLayout="auto"` wird deshalb **nur im Zahlfall**
mitgesetzt. Wer den Haken an eine zweite Spalte hängt oder einer Nachbarspalte die Zahlbreite
nimmt, bekommt das Bestandsverhalten plus DEV-Warnung zurück — ein Opt-in, das still nichts
tut, wäre von einem kaputten nicht zu unterscheiden. Herleitung und Prüfspur:
`docs/superpowers/specs/2026-09-11-lfh-523-etb-langtext-umbruch.md`.

**Ein Tagebuch wird gelesen — das ETB ist auf allen Breiten eine Zeitachse** (Neuentwurf S4,
22.09.2026; `etb/EtbZeitachse.tsx` aus dem Baustein `Zeitachseneintrag`, Ableitungen rein in
`etb/zeitachseModell.ts`). Die Frage ist „was ist passiert?", nicht „welcher von diesen ist der
richtige?"; es gibt keine Sortierung, keinen Spaltenfilter, keine Spaltenauswahl, die Ordnung
ist die Zeit und serverseitig festgelegt. Das hatte LFH-342/C7 schon gegen die B5e-Prüfliste
(„die Chronologie wird verglichen") entschieden, damals noch als `Datensicht` mit Tabelle ab
`xl` und Karten-**Eigenbau** darunter (`etb/EtbTabelle.tsx`, erster Eintrag in
`KARTEN_EIGENBAU`) — der Neuentwurf zieht die Linie zu Ende. Damit ist das ETB aus dem
Konsumenteninventar gefallen (vorher elfte `Datensicht`- und in `katalogTabelle.guard.test.ts`
die **neunzehnte** Konsumentin, LFH-330/AP8), ebenso die **Lagemeldungen**
(`pages/LagemeldungenPage.tsx`, Zeitachse mit Typkante „Lage"), und `KARTEN_EIGENBAU` ist
**wieder leer** (`datensicht.guard.test.ts` pinnt die Länge 0). Die Seite trägt auf breitem
Schirm rechts eine Seitenleiste „Bilanz" (`etb/EtbBilanz.tsx`) — **nicht** „Tagesbilanz" wie
im Entwurf — und die Erfassung **unten** am Fuß der Zeitachse (`.etb-erfassung-sticky` in
`index.css`, Grund `kopf`).
**Kopfzahl und Bilanz zählt der Server, über DENSELBEN Filter wie die Liste** (LFH-612,
`GET …/etb/zaehler`, gemeinsame Bedingung `etb/repo.rs:filter_bedingung`): ohne Filter „412
Einträge" und „Bilanz", mit Filter „7 Treffer" und „Bilanz im Filter". Eine feste Tagesgrenze
gibt es nicht (der Server kennt keine Zeitzone), einen Tag zeigt der Zeitraumfilter. Lädt die
Zählung noch oder ist sie gescheitert, steht **keine** Zahl da — nie eine Zählung des geladenen
Fensters. Liste und Zählung parsen ihre Parameter über `routes/etb.rs:filter_merkmale`; eine
zweite Kopie wäre die Stelle, an der „n Treffer" und die Liste still auseinanderliefen
(`tests/etb_zaehler.rs` prüft die Parität gegen die seitenweise geladene Liste).
**Modulzähler** (LFH-612, `GET …/modul-zaehler`, `src/einsatz/zaehler.rs`): nur Module mit
belegter Bedeutung — ETB, Betroffene, Einheiten, Einsatzabschnitte als Gesamtmenge; Meldungen,
Aufträge, Erinnerungen, Chat mit ihrer bisherigen Handlungsmenge. Ein nicht erlaubtes Modul
**fehlt** in der Antwort statt 0 (Rechte über `berechtigung::erlaubte_module`, dieselbe
Auswertung wie der Live-Feed). Ein weiteres Modul braucht eine eigene Entscheidung. Wer eine
gezählte Liste live invalidiert, invalidiert `modulZaehler` mit — `queryKeys.test.ts` leitet
das aus `ZAEHLER_LISTEN_KEYS` ab.
**Eine gemessene Falle bleibt, auch ohne Datensicht:** jede Zeile trägt
`data-lfh="datensicht-karte"` und die Zeilenklasse selbst — daran findet `scrolleZurZeile` sie,
und daran hängt der Deeplink `?eintrag=`. Wer einen neuen Eigenbau in `KARTEN_EIGENBAU`
einträgt, begründet ihn gegen den Plan-Modus (Titel + Status + höchstens **drei**
Sekundärfelder + genau **eine** Primäraktion, daneben seit LFH-639 optional **ein** gebündeltes
Menü `weitere`) und prüft dieselbe Falle: `Datensicht` gibt beim Eigenbau `karte.render(...)`
**roh** zurück, Marke und Klasse entstehen nur im Plan-Modus. Mehr Zeilenaktionen allein sind
deshalb kein Grund mehr für einen zweiten Eigenbau — sie gehören ins Menü.
**Die ≥ 50-%-Zusicherung für den Meldungstext im Fükw gilt weiter** und wird in
`e2e/etb-chronologie.spec.ts` jetzt an der Zeitachse gemessen — gegen die **Contentbreite**,
nie gegen die Breite des eigenen Containers: der Befund ist in der Contentbreite formuliert,
und ein Verhältnis zu einem mitwachsenden Container kann kleiner werden, obwohl der Text mehr
Platz hat.

**Zwei schwebende Bänder an einem Rand werden gestapelt, nicht gestaffelt** (LFH-355,
`pages/lagekarte/KartenFuss.tsx`). Zeichnen-Steuerung (`bottom: 16`, mittig) und
Zeitachsen-/Snapshot-Leiste (`bottom: 12`, volle Breite) lagen beide absolut auf `zIndex: 5`
über der Lagekarte. Bei Gleichstand gewinnt die spätere DOM-Position — die Leiste verdeckte
im **Default-Zustand** (`lfh:lagekarte:zeitachse-eingeklappt` ungesetzt, damals also
ausgeklappt; seit dem Neuentwurf gilt das nur ab `xl`, darunter startet sie eingeklappt —
`SnapshotLeiste.tsx`, `startEingeklappt`)
„Abschließen"/„Abbrechen" vollständig; aus dem Zeichenmodus kam man nur über Tastatur oder
Reload heraus. Der Fix ist **ein gemeinsamer, absolut positionierter Rahmen mit den Bändern
als Flow-Geschwistern in einer Spalte**, nicht ein höherer `zIndex`: der hätte den Klick
zurückgeholt und die Überdeckung gelassen, nur andersherum. Zwei Elemente im normalen Fluss
können sich nicht überlagern — das folgt aus dem Layout statt aus einer Zahl, und deshalb
gilt es bei jeder Breite. Die Bänder geben dafür ihre **eigene Positionierung ab** und nehmen
`bandStil('voll' | 'mitte' | 'links')`; wer einem von ihnen `position: 'absolute'`
zurückgibt, nimmt es aus dem Fluss und holt den Bug mit (drei Vitest-Guards, per
Mutationsprobe belegt). Der Rahmen trägt `pointerEvents: 'none'`, jedes Band `'auto'` — ohne
diese Gegenzeile schluckte der Leerraum zwischen den Bändern jedes Ziehen auf der Karte,
mit nur der einen Hälfte wäre ein Band sichtbar und tot.
**`toBeVisible()` ist in Playwright kein Beleg für Klickbarkeit** — auf dem verdeckten Knopf
war es grün, während der Klick in den 30-s-Timeout lief („`<div>` intercepts pointer
events"). Diese Falle ist **generisch für die e2e-Suite**, nicht auf diese Stelle beschränkt:
wer eine Bedienbarkeit zusichern will, klickt. Und ein e2e-Test, der eine Überdeckung
**umgeht** (hier: die Zeitachse einklappen, um an die Knöpfe zu kommen), lässt genau den
Zustand ungetestet, den der Nutzer antrifft — die Umgehung gehört mit dem Fix weg, die
Vorbedingung („die Leiste steht ausgeklappt da") bleibt stehen, sonst wird die Messung
still wertlos statt rot. Gemessen wird in `e2e/lagekarte-smoke.spec.ts` mit echten
Bounding-Boxen bei 1280 px und 1024 px. **Nicht bei 390 px — das ist heute eine Lücke,
keine Aussage mehr** (LFH-100). Die frühere Begründung („die Sidebar ist fest 300 px breit,
für die Kartenfläche bliebe nichts") ist seit dem Neuentwurf überholt: unter `lg` liegt die
Leiste UNTER der Karte, auf dem Handschirm per Vorgabe zu. Den Querlauf der Lagekarte misst
seit LFH-100 Gate 1 (`e2e/gate1-ueberlauf.spec.ts`, auch bei 768 und 390 px); die
Klickbarkeit der gestapelten Bänder bei 390 px ist weiter ungemessen und gehört zu LFH-100.

**Sprungmarken sind keine Module** (LFH-620, `einsatz/sprungmarken.ts`). Führt der
Entwurf ein „Modul“, dessen Daten ein vorhandenes Modul schon trägt (Entscheidungen =
ETB `?typ=entscheidung`, Patienten = Personen im Sichtungsraster, Vermisste = Personen
`?filter=vermisst`), steht im Modulpanel eine **Sprungmarke** statt eines
Registry-Eintrags. Das ist weder `verweistAuf` noch ein neuer Modulschlüssel. Ein Modul
hätte eigene Overrides (ETB gesperrt, Entscheidungen frei → 403), bräuchte `MODUL_KEYS`
im Backend und führte den Rail-Kategoriesprung über `modulZielRoute` in eine fremde
Kategorie. Eine Marke erbt Sichtbarkeit und Sperre ihres Zielmoduls, ist nie
`aria-current` und trägt ihr Ziel im zugänglichen Namen („…, springt zu ETB, Typ
Entscheidung“). Ihr Pfad kommt aus `routing/deeplinks.ts`. Die Personenseite übernimmt
`?filter=`/`?ansicht=` apply-then-clean (`parsePersonenSicht`, `sichtNachSprung`,
Lücken-Filter fällt dabei). Ein Filterwert „patienten“ existiert bewusst nicht, weil
Patient eine Darstellung ist und kein Status. Die Entscheidung je Entwurfsmodul steht in
`docs/design/2026-09-21-neuentwurf/umsetzung.md`.

**Verpflegung ist ein Fachmodul mit eigenen Zeitfenstern, nicht mit Schichten** (LFH-634,
`pages/VerpflegungPage.tsx`, Backend `src/verpflegung/`). Die Schicht aus LFH-635 hängt an
einer Einheit, eine einsatzweite Schicht gibt es nicht. Verpflegung führt deshalb eigene
Zeitfenster (Bezeichnung, von, bis). **Der Bedarf in EP wird erfasst, nicht live gerechnet.**
Personalstärke (`verdichte`) und Kopfzahl „in Betreuung“ (LFH-639) sind nur überschreibbare
Vorschläge beim Anlegen. Ein live gerechneter Bedarf verschöbe still die Unterdeckung
vergangener Zeitfenster, denn Dispositionen werden hart gelöscht. Ein Vorschlag aus einer
Quelle, die nichts liefert, bleibt leer, nicht 0. „Nichts gemeldet“ heißt in Betreuung: keine
Stelle trägt `belegt`. `stellen` führt auch Stellen ohne Meldung. Eine Quelle ohne Modulzugang
(ausgeblendet, gesperrt, 403) entfällt still. **Sonderkost ist eine Teilmenge der EP, kein
Zuschlag**, mit fünf festen Kostformen als Spalten und DB-CHECK. **Nachschub hat eine
Wahrheit, die Nachforderung**: Eine Ausgabe verweist höchstens per `nachforderung_id` darauf,
ohne hineingejointe Felder, sonst läse ein Verpflegungs-Leser Nachforderungsdaten ohne Recht.
„Nachfordern“ springt vorbelegt (`nachforderungenPfad(…, { vorbelegung })`, apply-then-clean).
Fehlmenge und Deckung rechnet der Server, die zeitabhängige Einstufung
(`verpflegung/deckung.ts`) nur der Client. „Unterdeckung“ gilt erst ab Beginn, davor „offen“.
Ins ETB kommen nur Zeitfenster und Bedarf, keine Ausgaben, der Zeitraum steht in der
Org-Zeitzone. **Einen Modulzähler gibt es bewusst nicht**, der Entwurf zeigt keinen. S4 führt
Verpflegung statt Fahrzeuge. Offline-Erfassung ist LFH-688.

**Eine benannte Ausnahme: der Navigations-Drawer** (LFH-329/B1, `einsatz/EinsatzLayout.tsx`
mit `einsatz/ModulAkkordeon.tsx`). Unterhalb `lg` liegt der Einsatz-Navigationsrahmen in einem
Drawer statt inline. Er zeigt **Navigation, keine Entität** — kein Datensatz, kein Formular,
kein Edit-Modus; er schließt beim Modulklick. Die Regeln oben zielen auf *Inhalts*-Drawer und
sind für ihn nicht gemeint: die Alternative wäre keine eigene Route, sondern gar keine
Navigation auf schmalem Schirm. Die Ausnahme ist **auf diesen einen Fall beschränkt** — ein
zweiter Navigations-Drawer braucht eine eigene Entscheidung, kein Berufen auf diesen Absatz.
Wer ihn anfasst: der Inhalt wird bewusst erst beim Öffnen gerendert (kein `forceRender`),
sonst steht die Navigation doppelt im Baum und die Prüfung „unter `lg` nicht im Layout" wird
bedeutungslos.

## Frontend — Bedien-Leitlinie (Einsatzkontexte)

Die **zweite Achse** neben LFH-19 (Gerät und Einsatzkontext, LFH-327). Die Regel oben bleibt
unverändert gültig — sie sagt, welche **Form** der Inhalt bekommt. Diese hier sagt, für welchen
**Kontext** er gebaut wird; die **Erscheinung** (Farbe, Form, Schrift) regelt die
Gestaltungssprache aus LFH-352 in der Fassung des Neuentwurfs (Abschnitt oben). Dieselbe Form kann je Kontext eine andere Dichte, Treffläche und
Spaltenzahl haben.

**Die vier Kontexte:** **Fükw** (primär, 13–15", Tastatur+Maus, kompakt, voll) · **Führungs-Tablet**
(1024–1280 px, Touch, oft Handschuh, komfortabel/Handschuh, keine Massenerfassung) ·
**ortsfeste Stelle** (BHP/BTP, Dauerbetrieb, kompakt + voller Tastaturfluss) · **mobil** (~390 px,
einhändig, komfortabel, keine Vergleichsansichten).

**Sieben Festlegungen, je mit einem maschinell prüfbaren Gate** — Kontexte · Tabelle/Liste/Kachel ·
Trefflächen · Dichte-Staffel · Statusfarben · Live-Aktualisierung · Prüfliste. Die vier für den
Alltag wichtigsten:

- **Tabelle nur, wenn verglichen wird** (NN/g), dann mit fixierter Kopfzeile, fixierter
  **menschenlesbarer** Identifierspalte (Funkrufname/Ordnungsnummer, nie die DB-`id`) und
  Spaltenschalter **mit Zähler ausgeblendeter Spalten**. Liste/Karte, wenn gelesen wird; Kachel nur
  für Überblicksflächen. Auf schmalem Schirm wird eine Tabelle **angepasst, nicht in Karten
  aufgelöst** — Karten-Fallback ist die Ausnahme mit Begründung im Task.
  **Träger seit LFH-330/B2:** `components/KatalogTabelle.tsx` (Scrollcontainer, stehende Kopfzeile,
  fixierte Kennung) und `components/Datensicht.tsx` (Formachse `auto`/`tabelle`/`karte`,
  Spaltenschalter mit Zähler, Sortierung/Filter/Suche). Der Zähler kennt **eine** Wahrheit —
  Handauswahl und breitenabhängige Spalten (`abBreite`) laufen durch dieselbe Funktion, weil ein
  Zähler, der lügen kann, das Kriterium verfehlt, für das er existiert; antds eigenes `responsive`
  ist am Spaltentyp deshalb gesperrt. Die begründete Ausnahme ist **eingelöst und begrenzt**:
  Dateikopf von `Datensicht.tsx` plus Abschnitt AK3b in
  `docs/superpowers/specs/2026-06-22-drawer-nutzung-reduzieren-design.md`.
  **Die stehende Kopfzeile hält Freiraum** (LFH-677, WCAG 2.4.11): rückwärts getabbt rollt der
  Browser das Ziel an den oberen Rand, und im Fükw lagen 30-px-Knöpfe dort vollständig hinter
  der Kopfzeile. `KatalogTabelle` misst die Kopfzeile (`setzeKopfFreiraum`), `sprache.css`
  setzt `scroll-margin-top` an jedes Ziel im Tabellenkörper. Ein Fokus-Nachweis unter einer
  stehenden Kopfzeile läuft deshalb auch mit `Shift+Tab` (`fokus-kern.ts`, Parameter `taste`),
  vorwärts rollt der Browser Ziele an den unteren Rand und damit nicht darunter.
- **Dichte-Staffel 30 / 48 / 72 px** (kompakt aus LFH-352 · komfortabel = Material 48 dp ·
  Handschuh = 72 px ≙ 19,05 mm, MIL-STD-1472F Fig. 12). Träger ist ein **Dichte-Token am
  `ConfigProvider`**, nicht `componentSize` und keine punktuellen Größen-Props. **Neues
  punktuelles `size="small"` auf interaktiven Elementen ist verboten**, erzwungen von
  `components/dichte.guard.test.ts` mit einer Schuldmenge `OFFEN`, die nur schrumpfen darf
  (Stand: nur noch die geprüfte Dauerausnahme, die vier Knöpfe der UHS-Platzkarte in
  `pages/uhs/Grundriss.tsx`, gebunden an `SCHRITT_Y = 120`). Wer eine Zeile aus `OFFEN`
  streicht, tut es im selben Commit wie den Fix und prüft `aktionsabstand.guard.test.ts` mit.
  `Card`/`Descriptions`/`Space`/`Liste` dürfen klein bleiben (Abstandsmaß, keine Trefffläche)
  und gehören nicht in `OFFEN`. `controlHeight` = **30/48/72**, `controlHeightSM` = **24/48/72**.
  **Die Breite eines Knopfs hat einen Boden am Kontext** (LFH-381): `antdKnopf()` in
  `theme/tokens.ts` gibt über `ConfigProvider button.style` jedem Knopf `minWidth` =
  `controlHeightSM`, denn antds `paddingInlineSM` ist das Literal 7 und ein „OK" blieb in jeder
  Stufe ~38 px breit. Ein Boden, keine Polsterung: breite Etiketten bleiben unberührt. Die eine
  benannte Ausnahme (`minWidth: 0`) ist die Aktionszeile der UHS-Platzkarte; sie fällt mit LFH-379.
  **Ein handgebautes Bedienziel** (`role="option"`-Zeile, `<div onClick>`, Zeilen-`<Link>`,
  Kommandopalette) braucht **zwei** Angaben: `minHeight: token.controlHeight` **plus** `padding`
  aus `token.paddingSM`/`token.padding`, aus aufgelösten Tokens, nie `var(--lfh-*)`, geprüft über
  eine reine, exportierte Stilfunktion (`bedienzielStil`) mit Böden als Literalen über zwei
  Dichtestufen. Ein `<a>` im Kartenkopf erbt keine Steuerhöhe. Der Gate-3-Nachweis je Route liegt
  in `e2e/gate3-trefflaeche.spec.ts`; ein Boden ist dort nicht immer die Staffel (eigenes Literal).
  Scanner-Interna, Blindflecken, Zeigerart-Vorbelegung und die gemessenen Fallen: `docs/leitlinien/bedien-leitlinie-herleitungen.md`.
- **Ein Tastenkürzel wird als Marke gesetzt, nicht als Text** (Nacharbeit zu LFH-335, 08.08.2026).
  Sichtbare Kürzel nehmen `components/Tastenkuerzel.tsx`, nie ein nacktes `<kbd>`: das hat im
  Browser **keine Vorgabegestaltung außer Monospace** — ohne Rahmen, ohne Polsterung und ohne
  eigenen Abstand zum Nachbarn. In der Kopfzeile stand deshalb gemessen **„Suchen⌘K"** in einem
  Zug; JSX verschluckt den Zeilenumbruch zwischen zwei Elementen ersatzlos, ein Fragment reicht
  als Trennung also nicht, es braucht eine Flex-Zeile mit `gap`.
  Die Marke nimmt ihre Farbe aus **`currentColor`**, nicht aus einer Farbrolle: dasselbe Element
  steht einmal auf dem dunklen Kopfzeilengrund und einmal auf Containergrund in der Palette — ein
  fester Rollenwert wäre an genau einer der beiden Stellen unsichtbar. Und sie ist **kein
  Bedienziel**: ein `<kbd>` ist Satz, kein Ziel, bekommt also bewusst **keinen**
  `controlHeight`-Boden (der stünde im Handschuh-Betrieb bei 72 px neben einer Zeile Text) —
  dieselbe Trennung, aus der `dichte.guard.test.ts` `Card`/`Descriptions` heraushält. Geprüft
  wird die reine `tastenkuerzelStil`-Funktion nach dem Muster von `bedienzielStil`, samt der
  **Abwesenheit** von `minHeight`.
- **Die Sprungpalette öffnet auf drei Wegen, nach dem Raycast-Muster** (LFH-645): ↵ öffnet,
  **Strg/⌘+↵** (auch Strg/⌘+Klick) öffnet das Ziel im **neuen Browser-Tab**, **→** zeigt am
  Textende eine Lese-Vorschau **in** der Palette. Die Vorschau ersetzt die Liste; Esc/← führen
  zurück, Begriff und Markierung bleiben. **Für Finger und Maus** trägt jede Zeile mit Vorschau
  rechts ein **Tippziel** (Chevron, LFH-665), an jeder solchen Zeile, nicht nur an der
  markierten, denn Touch kennt kein Hover. Es ersetzt die frühere `kbd`-→-Marke. Das Ziel ist
  kein `Button`, weil ein fokussierbarer Knopf der Combobox den Fokus nähme. Es ist ein
  handgebautes Ziel mit `aria-hidden` und abgefangenem `mousedown`, sein Klick endet per
  `stopPropagation`. Der Boden kommt aus `vorschauZielStil` (`zeilenStil.ts`): `controlHeight`
  in Höhe und Breite, bündig an der Zeilenkante über die volle Zeilenhöhe. Die Zeile ist
  content-box, darum zieht sich das Ziel um genau ihre Polsterung heraus. „⇧↵ im Panel“ aus
  dem Neuentwurf ist entfallen, ⇧↵ ist frei, und es gibt keine neue Drawer-Fläche.
  `Befehl.ziel` ist die Marke, `ausfuehren(oeffnung?)` reicht `'neuerTab'` bis `navigate`. Navigationszeilen entstehen nur
  über `sprungZu` (`command-palette/typen.ts`), die Guards in `befehle.test.ts` und
  `datensaetze.test.ts` prüfen das Durchreichen je Zeile. Die Fehlerrichtung ist sonst still:
  „neuer Tab“ öffnet dann hier. Eine Zeile ohne Ziel bleibt bei Strg/⌘+↵ wirkungslos, es gibt
  keinen Rückfall auf ↵. Esc in der Vorschau **muss** `preventDefault` rufen, sonst schließt
  der globale `verwerfen` die Palette mit. Strg/⌘+↵ ohne Ziel braucht dagegen kein Abfangen,
  der Dispatcher schluckt Mutationstasten bei offener Palette selbst. Beides ist gemessen. Eine
  neue Vorschausorte bekommt einen Eintrag in `VorschauZiel` und einen Zweig in
  `command-palette/Vorschau.tsx` (exhaustiv). Ihr Inhalt ist ein Lese-Bauteil, das auch außerhalb
  der Palette steht (Vorbild `personen/PersonVorschau.tsx`, geteilt mit `PersonDetailDrawer`).
  **Seit LFH-664 hat jede Datensatzsorte eine Vorschau**, und ihr Ziel steht in der
  Quellentabelle von `datensaetze.ts` (Baustein `vorschau` neben `label`/`ziel`), nicht in
  `befehlFuer`. **Datenregel:** die Vorschau liest das Listenfach der Palette mit `select` auf
  die `id`, über die geteilten Optionen in `command-palette/datensatzAbfrage.ts` — derselbe
  Schlüssel, dieselbe `queryFn`, dieselbe Frische (`FRISCH_MS`). Weicht einer davon ab, lädt
  die Vorschau still ein zweites Fach oder holt beim Öffnen neu. Kein Detailfach: `schaden`
  und `uhsDetail` sind nicht live. Der ETB liest über den Nummerncursor (`lfdNr` im Ziel) und
  zeigt nur einen Eintrag mit derselben `id` — bei einer Nummernlücke liefert der Cursor
  sonst still den nächstälteren. Findet `select` nichts, sagt `VorschauZustand` „… ist nicht
  mehr vorhanden." statt leer zu bleiben. Ein Verweis in der Vorschau schließt die Palette
  (Riegel am Container der Region), sonst navigiert die App unter ihr weg.
- **Datensatz-Aktionen werden gebündelt, nicht aufgereiht** (LFH-365 · B5e). Ab drei Aktionen
  an einer Zeile oder Karte, **gezählt nach der Rechteprüfung**: ein `Dropdown` mit
  `menu={{ items }}`, `trigger={['click']}`, `autoFocus` und icon-only `<Button type="text">`,
  kein `Popover`. Ohne übrige Aktion kein Auslöser. Der zugängliche Name trägt die
  **Zeilenkennung** (`Aktionen zu Eintrag 7`). Rückfrage im Menü per `<Modal>` mit eigenem State
  außerhalb der Zeilen-`map`, kein `Popconfirm`. `onClick` gehört ans `menu`; gegen das Aufsteigen
  des Portal-Klicks in einen klickbaren Elternteil hilft ein Riegel am **Container**, nicht
  `domEvent.stopPropagation()`. Der Rechte-Riegel gehört an die Ableitung, nicht ans Rendern
  (ein übergebener Callback ist kein Rechtebeleg). Im Test über das geöffnete Menü greifen
  (`.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]` + `within`), per Teilstring.
  Im Kartenmodus baut `components/Datensicht.tsx` den Auslöser selbst (`weitere`, LFH-639:
  Deskriptor mit `eintraege`/`zugaenglicherName`/`onWahl`, Gefahr hinter dem Trenner). Träger,
  MeldungKarte-Entscheidung und gemessene Fallen:
  `docs/leitlinien/bedien-leitlinie-herleitungen.md`.
- **Ein Sprung ist keine Handlung** (LFH-616, Inspector der Lagekarte). Gezählt werden für
  „höchstens zwei, sonst bündeln“ die Aktionen, die etwas **ändern**. Zwei Deeplinks
  („Im Fachmodul öffnen ↗“ | „ETB ↗“) bilden zusammen **eine** Zeile Navigation. Sie
  stehen nebeneinander in einer umbrechenden Flex-Zeile (`data-lfh="inspector-sprung"`), die
  rote Handlung steht abgesetzt darunter. Der Deeplink trägt die Zeilenkennung im
  zugänglichen Namen („Einsatztagebuch zu 1. Zug“), sichtbar steht nur „ETB ↗“.
  Das **Messwerkzeug** derselben Karte ist ein exklusiver Modus im Reducer von
  `useKartenInteraktion` wie Zeichnen und Platzieren. Es braucht aber **kein** Schreibrecht,
  weil nichts gespeichert wird. Es ist der einzige Modus, den Escape beendet: Die übrigen
  tragen einen Entwurf, der mehr kostet als ein Blick. Sein Stand läuft wie die
  Zeigerkoordinate über eine Quelle (`messQuelle.ts`), nicht über den Seiten-State. Im
  Bildtakt neu zu rendern wäre die Folge. terra-draw meldet neben der Figur eigene
  **Hilfspunkte** als `create` (gemessen im Browser). `messZeichnung.ts` nimmt deshalb nur
  die Geometrie der gewählten Form als laufende Messung.
  **Drei terra-draw-Instanzen auf einer Karte brauchen drei Präfixe.** Abschnitt, Zone und
  Messen hatten den Vorgabe-Präfix `td` des Adapters gemeinsam. Die Effekte laufen in
  Deklarationsreihenfolge, die zweite Instanz legte `td-polygon` also an, solange die erste
  es noch hielt. MapLibre warf „Source … already exists“, die Seite fiel in die
  Error-Boundary (im Browser gemessen: Messen → Gefahrengebiet zeichnen). Jede Instanz trägt
  deshalb ihren eigenen `prefixId` (`td-abschnitt`/`td-zone`/`td-mess`). Nach `setStyle`
  legt der Adapter seine Sources **nicht** neu an. `Kartenflaeche` räumt eine laufende
  Messung deshalb vor dem Stilwechsel und beginnt sie nach `style.load` neu. Für einen
  offenen Zonen-/Abschnittsentwurf ist dieselbe Lücke Bestand und nicht gelöst.
- **Ein leeres Feld muss sagen, dass man es schreiben kann** (LFH-369 · B5i, Befund M21). Eine
  inline bearbeitbare, **optionale** Angabe nimmt `components/BemerkungZelle.tsx` — nicht
  `Typography.Text editable` von Hand. Bei leerem Wert blieb davon genau das Stift-Icon übrig:
  **sichtbar keine Aufforderung**, und als Trefffläche ein Icon statt eines Textziels.
  **Nicht** dagegen namenlos — das ist im Review gemessen worden und korrigiert hier sowohl das
  Akzeptanzkriterium des Tickets als auch den ersten Anlauf dieses Absatzes: antd setzt das
  `aria-label` unbedingt aus der Locale (`typography/Base/index.js:271-283`), mit `deDE` heißt
  der Stift **„Bearbeiten"** (`locale/de_DE.js:78-79`, gesetzt in `theme/ThemeModeProvider.tsx`).
  Der Mangel ist, dass dieser Name **nicht sagt, WAS** — und dass n Zeilen n gleichnamige Knöpfe
  liefern. Deshalb trägt der Auslöser die **Zeilenkennung** im zugänglichen Namen („Bemerkung zu
  Florian 1 hinzufügen") bei kurzem sichtbaren Text; das ist dieselbe Regel wie bei der
  Aktionsbündelung zwei Absätze weiter unten, nicht ihre Ausnahme. Der **Lese**zweig hatte
  längst ein „—" — die Affordanz war genau falsch herum verteilt.
  Der Platzhalter ist ein echter antd-`Button` (`type="link"`) und **kein gestyltes
  `<span onClick>`**: so erbt er `controlHeight` vom `ConfigProvider` und schuldet nicht die zwei
  Angaben plus Dichte-Zusicherung, die LFH-365 einem handgebauten Bedienziel auferlegt. Der
  Lesezweig behält „—": ohne Schreibrecht gibt es keine Aktion, eine Aufforderung wäre eine ins
  Leere. „Konsistent" heißt hier gleiche **Bedeutung** des Leerzustands — ausdrücklich **nicht**
  gleiche Höhe: blanker Text und ein Knopf mit Polsterung sind nicht gleich hoch, und dieselbe
  Datei ändert daran nichts.
  **Drei Aufrufer, nicht fünf:** `pages/gefahren/GefahrenPage.tsx:135` und
  `pages/lagekarte/Sidebar.tsx:612` sind **Pflichtnamen, die umbenannt werden**, keine optionalen
  Notizen — der Platzhalter hätte dort keinen Zustand, in dem er erschiene. Die Mechanik ist
  dabei **nicht dieselbe**: `Sidebar` verwirft eine leere Eingabe selbst (`if (t && t !== b.name)`),
  `GefahrenPage` tut das **nicht** — dort fängt erst die Anzeige es ab (`api/gefahren.ts`,
  `gefahrengebietName`).
  **Zwei gemessene Fallen beim Anfassen:** (1) antds `Editable` entscheidet über
  Übernehmen/Abbrechen am **legacy `keyCode`** (`Editable.js:70-86`) und vergleicht keydown gegen
  keyup — `userEvent` v14 setzt es nicht, `type(feld, '…{Enter}')` bleibt wirkungslos und der Test
  scheitert mit „0 calls", als wäre die Komponente kaputt; Tastenwege deshalb über `fireEvent` mit
  explizitem `keyCode`, und der Mausweg (`onBlur` → übernehmen) gehört eigens belegt, er ist im
  Betrieb der häufigere. (2) antd gibt den Fokus beim Verlassen nur an seinen **eigenen** Stift
  zurück (`Base/index.js:90-95`), und nur solange das `Typography` am Baum bleibt. Das tut es in
  **zwei** Fällen nicht, beide gemessen: beim **Abbrechen** (der Platzhalter ersetzt es in
  derselben Runde) und beim **Speichern**, wenn der neue Wert per Invalidierung erst eine Runde
  **später** eintrifft — dann hängt ein FRISCHES `Typography` ein, das kein `prevEditing` hat.
  Beide Male fällt der Fokus auf `<body>`; die Rückgabe muss das Primitiv selbst übernehmen, und
  zwar mit einem Merker, der den **Zweigwechsel überlebt** — eine Flanke auf „wird bearbeitet"
  ist beim Nachlauf längst vorbei. Der zweite Fall ist der, den der Betrieb nimmt, und ein Test
  mit `vi.fn()` als Mutation sieht ihn **nicht** (dort kommt der Wert nie nach): er braucht ein
  `rerender` mit dem gespeicherten Wert. Und `onChange` feuert beim Verlassen **unbedingt**: ohne
  Wertgleichheits-Riegel kostet ein Fehlklick ein PATCH samt Invalidierung und Live-Ereignis.
- **Der Statuswechsel in den Kräfte-Listen ist gebaut** (Zielform aus LFH-369 · B5i,
  `docs/superpowers/specs/2026-07-30-kraefte-listen-statuswechsel-zielform.md`; umgesetzt in
  LFH-339 · C4). **Auslöser ist die Statusanzeige selbst** plus senkrechtes Menü im Portal —
  kein `Segmented`, keine Farbfläche, **kein neuer Drawer** und **kein zweiter
  Primäraktions-Slot**. Die Zahl dahinter: eine waagerechte Reihe trägt höchstens
  **2 beschriftete** (dichteunabhängig) bzw. **4 unbeschriftete** Ziele im 480-px-Quick-View;
  die Kataloge haben 10 / 6 / 5, der Fahrzeugkatalog ist mandantengepflegt. Senkrecht trägt,
  weil ein Menü scrollen darf und im Portal liegt — womit auch die feste Mindestbreite
  entfällt, die das `Select` aus der 390-px-Karte drängte (`Datensicht.tsx:234-236`).
  **Träger:** `components/StatusWahl.tsx` (nicht `kraefte/` — es ist ein Primitiv neben
  `StatusTag`/`BemerkungZelle`, und `Datensicht` konsumiert es) plus `statusBedienung` am
  Kartenplan. Der Bedienweg sitzt am **`status`-Slot**, nie am `aktion`-Slot: der sichert genau
  EINE Primäraktion zu und ist auf allen drei Seiten mit „Entfernen" belegt.
  **Statusfarbe: Rollenfarben als getönte Fläche, Mandanten-Freitextfarben nur am Rand**
  (Neuentwurf 22.09.2026 — **kehrt** „nur als Punkt/Rand/Beistrich, nie als Textfläche" für
  ROLLENfarben **um**, Entscheidung 2 des Auftraggebers: „Ampel als Fläche, Zahl bleibt
  lesbar"). `StatusTag` zeigt per Vorgabe `darstellungsart="flaeche"`; die Werte und ihre
  Kontrastrechnung stehen an **einer** Stelle, `components/instrument/statusFlaeche.ts`, die
  auch `StatusChip`/`StatusZelle` tragen. Kontrastregel dort: im **Tagmodus** fallen `achtung`
  (6,02) und `alarm` (5,52) als getönter Text unter den 7 : 1-Boden — die Beschriftung nimmt
  dann `text`, die Fläche behält ihren Ton, der 1-px-Rand bleibt in der Rollenfarbe (≥ 3 : 1,
  gemessen in `kraefte-kontrast.spec.ts`); nachts gilt der Entwurf ungebrochen. **Die
  Rand-Form bleibt Vertrag** für zwei Fälle: `status_farbe` ist bei Fahrzeug und Personal
  ungeprüfter Freitext (`statusFarben.ts:28-41`) — ist eine Mandantenfarbe gesetzt, erzwingt
  `wirksameDarstellungsart` `rand`, weil niemand den Kontrast einer Fläche neben einem frei
  gewählten Punkt zusichern kann; und die Rolle `marke` hat keine Fläche. Die gepflegte Farbe
  geht als dekorativer Punkt (LFH-446) nicht verloren — A2s Sorge bleibt eingelöst.
  **`fms_anker` bleibt Sortier-Anker und Tastenkürzel**, nicht tragende Bedienform — die Spalte
  ist nullable, ein 0–9-Tastenfeld darauf hätte Löcher.
  **Material war der Grenzfall, und die Linie ist seit LFH-341/C6 gezogen.** C4 hatte für
  `MaterialStatus` bewusst keine Rolle vergeben — `im_einsatz` war **blau**, und Blau ist
  `bedien`, also schien es keine ehrliche Rolle zu geben — und die Frage ausdrücklich als
  „eigene Entscheidung, kein Nebenprodukt" offen gelassen. C6 hat sie entschieden:
  `theme/statusFarben.ts:materialStatus` trägt jetzt alle fünf Werte. `bedien` wird dabei
  **nicht erfunden, sondern erkannt** — die Rolle steht in derselben Datei schon dreimal für
  eine aktive Beziehung (`verfuegbarkeit.reserviert`, `belegungsArt.wechsel`,
  `etbTyp.meldung`). `defekt`/`verbraucht` teilen sich `alarm`, unterschieden durch das
  Pflichtfeld `label` (WCAG 1.4.1), wie die fünf Warnstufen sich drei Rollen teilen.
  **EIN Behandlungsweg:** `pages/MaterialPage.tsx` und `pages/uhs/MaterialTab.tsx` lesen
  beide von dort. Zwei Farbbehandlungen desselben Enums wären der Fehlerfall, nicht der
  Kompromiss — und das ist der Grund, warum C6 die Kräfte-Seite mit angefasst hat, obwohl
  ihr Ticket sie nicht nennt. Die **Anordnung** aus C4 (Menü statt Farbfläche, Etikett als
  Auslöser) bleibt davon unberührt.
  **Ein Menü im Portal taut die Zeilenschleuse der `Datensicht` auf, wenn man es lässt.** Das
  Overlay hängt an `document.body`, also ausserhalb der Sicht-Wurzel, und `autoFocus` schiebt
  den Fokus dorthin — `pruefeVerlassen` behandelt `.ant-dropdown`/`.ant-select-dropdown`/
  `.ant-picker-dropdown` deshalb **nicht** als Verlassen. **In jsdom passiert dieses Wandern
  NICHT** (gemessen: der aktive Knoten bleibt der Auslöser): ein Test, der bloss ein Menü
  öffnet und die Reihenfolge prüft, ist auch ohne den Zweig grün und belegt nichts. Geprüft
  wird der Handler direkt, mit einem `relatedTarget` im Portal.
  Die zwei Eigenwidersprüche des Elterntickets („read-only Quick-View + Statuswahl" gegen
  LFH-19) sind damit **aufgelöst statt umbenannt**: es ist keine Fläche entstanden, die sie
  erzeugt hätte.
- **„Genau eine Primäraktion" ist am Kopf prüfbar, nicht global** (LFH-340 · C5). Der
  Aktionen-Slot von `components/EinsatzSeite.tsx` trägt `data-lfh="seitenkopf-aktionen"` —
  denselben Zuschnitt, den die Dev-Warnung des Primitivs ohnehin zählt. Global gezählt wäre die
  Aussage falsch: eine Seite mit einem Formular im Inhalt hat dort zu Recht einen
  Absende-Knopf in Primärgestalt und fiele durch, ohne im Kopf etwas falsch zu machen.
- **Ein Anker in der Zeile bedient den Klick allein** (LFH-340 · C5, im `Datensicht`-Primitiv
  behoben). Eine Zeile trägt regelmäßig echte `<a>`: den Titel-Link, den das Primitiv aus
  `karte.titel.ziel` selbst setzt, und Deeplinks aus einem Spalten-`render`. Ohne Riegel feuern
  bei EINEM Klick beide Wege — der Link navigiert auf sein Ziel, `onZeileKlick` schickt dieselbe
  Zeile auf ihre Detailseite; bei gleichem Ziel unbemerkt, bei verschiedenem gewinnt der zweite.
  Am sichtbarsten beim **Modifier-Klick**: Cmd/Strg öffnet den neuen Tab (der Browser bedient
  das, `defaultPrevented` bleibt false) — und die aktuelle Seite navigiert trotzdem weg. Der
  Riegel (`event.target.closest('a')`) sitzt im **Primitiv**, nicht an jedem Link: die Regel
  „trägt `titel.ziel` einen Wert, darf das `render` keinen Anker erzeugen" verbietet dem
  Konsumenten gerade, den Titel-Link selbst zu bauen — er kann dort nichts stoppen. Gemessen
  hatte **kein** Konsument dafür einen Test außer der Schadensliste, die vor ihrem Umbau eine
  handgebaute Tabelle mit eigenem `stopPropagation` war.
- **Die Sichtungskategorie geht mit dem Anlegen mit, nicht als zweiter Request** (LFH-340 · C5).
  `POST /api/einsaetze/{id}/personen` nimmt ein optionales `sichtung` und schreibt die Sichtung
  in **derselben Transaktion** wie die Anlage, inklusive `erfasst → betroffen`. Der naheliegende
  Weg — anlegen, dann `POST …/sichtung` nachschieben — ist gesperrt, und zwar nicht aus
  Geschwindigkeit: die Personen-Erfassung hat eine **Offline-Queue mit `client_id`-Idempotenz**
  (`offline/schreiben.ts`), ein nachgeschobener Call hätte keine, und ein Replay legte die
  Sichtung ein zweites Mal in die Kette, aus der der medizinische Verlauf gelesen wird. Deshalb
  steht sie serverseitig unter `war_neu`, und die Antwort wird **nach** der Sichtung geladen —
  sonst trüge die Quittung einen Zustand, den es nie gab. Die Kombination mit
  `status: 'vermisst'` ist **422** (eine vermisste Person ist nicht angetroffen), ein unbekannter
  Kategoriewert **400**.
- **Eine Erfassungsmaske ist ein Bauteil, kein Ort** (LFH-340 · C5). `personen/AufnahmeFelder.tsx`
  ist eine reine Feldgruppe **ohne eigenes `<Form>`** und hängt an zwei Mounts: dem
  Schnellerfassungs-Modal der Liste und der Route `/einsaetze/:id/personen/aufnahme`. Zwei Kopien
  wären zwei Feldbudgets, zwei Tastaturwege und zwei Stellen, an denen ein Feld fehlen kann.
  **Das Feldbudget verschiebt, es wächst nicht**: die Sichtung ist ins sichtbare Budget gerückt,
  der **Name** dafür unter „Weitere Angaben" — an der Aufnahme wird zuerst die Kategorie
  vergeben, der Name ist der langsamste Teil und meist unbekannt. Wer eine Testabfrage auf
  `getByLabelText('Name')` findet, klappt auf statt das Budget zu dehnen.
  **Der Widerspruch „≤ 4 Interaktionen ohne Seitenwechsel" gegen „eigene Vollseite" ist
  aufgelöst, nicht umbenannt**: den Zählweg erfüllt das Modal (offen → Kategorie → speichern,
  URL unverändert), die Route ist die **Anspring-Adresse** für andere Module (C6) — ein Dialog
  hat keine. Beide zeigen dieselbe Maske.
- **`SK_META` führt Schlüssel der Sichtungspalette, keine CSS-Werte** (LFH-340 · C5, seit
  LFH-455 ein Alias auf `sichtung` in `theme/statusFarben.ts`: `farbe` ist ein Schlüssel von
  `sichtungsfarben` oder `null`). Einen Farbnamen in ein `style={{ color }}` zu schreiben
  ergäbe einen erfundenen Farbwert, den `theme/tokens.ts` nicht kennt (gemessen in C5: CSS-`gold`
  ist nicht antds Gold). Wo eine Fläche die Kategorie farbig zeigen soll, trägt ein
  `SichtungsTag` **in** der Fläche die Farbe, nicht die Fläche selbst — die Sichtung ist von der
  Flächen-Umkehr des Neuentwurfs ausdrücklich ausgenommen (siehe UI-Form-Leitlinie). Der zweite
  Kanal ist die Beschriftung — „SK I" sagt es auch ohne jede Farbe, weshalb `unverletzt` mit
  `farbe: null` vollwertig ist.
- **Ein Verortungsauftrag geht als Deeplink an die Karte** (LFH-340 · C5):
  `lagekartePfad(einsatzId, { platzieren: { typ, id } })` erzeugt `?platzieren=<typ>:<id>`,
  `parsePlatzierenAuftrag` liest ihn zurück, `pages/LagekartePage.tsx` schickt die Karte in den
  Platzier-Modus und **räumt den Parameter** (apply-then-clean wie beim
  Gefahrengebiet-Deeplink) — ein stehengebliebener Auftrag schickte die Karte bei jedem
  Neuladen erneut hinein. Der Parser verwirft Unbrauchbares **ganz** statt halb zu füllen, und
  ohne Schreibrecht wird der Modus gar nicht erst betreten: er endet in einem PATCH, und ein 403
  nach dem Klick auf die Karte wäre die späteste denkbare Absage. **Vertagt und benannt:** ein
  Koordinatenfeld in der Schadens-**Erfassung** — `SchadenEingabe` kennt kein lat/lon (nur
  `SchadenPatch`), das ist eine Backend-Erweiterung und liegt als **LFH-453**.
- **Ein Emoji ist keine Ikone** (30.07.2026, Kräfteliste). Wo ein Bildzeichen für etwas steht —
  Personal, Fahrzeug, Material, Erreichbarkeit, gesperrt, in Arbeit —, trägt es ein
  `@ant-design/icons`-Element, nie ein Emoji. Begründung: Zeichnung, Farbe und Breite eines
  Emojis kommen aus der Systemschrift statt aus dem Entwurf; es steht in **eigener** Farbe neben
  einer Zeile, deren Farbgebung Bedeutung trägt (Kriterium 6), und im Ausdruck sowie in
  Textausgabeketten (Lagebericht-Markdown) verhält es sich anders als der übrige Satz — dort
  gehört ein **Kurzwort** hin (`Pers.` / `Fzg.` / `Mtl.`), kein Bildzeichen.
  **Die Zuordnung liegt in der Komponente, nicht in einer Prop**: eine Prop, die eine
  Zeichenkette nimmt, nimmt auch wieder ein Emoji. Präzedenz `kraefte/AmpelZelle.tsx` — dort
  bildet ein `Record` über das String-Union der Achse ab, die frühere `symbol: string`-Prop ist
  weg. **Und die Ikone braucht eine `aria-hidden`-Hülle**: ein `@ant-design/icons`-Knoten bringt
  `role="img"` mit eigenem **englischem** `aria-label` mit („user"/„car"). Der Name der
  umgebenden Gruppe leidet nicht (`aria-label` schlägt den Inhalt, gemessen) — der **Knoten**
  schon, und in einer Vergleichstabelle steht er dann in jeder Zeile als eigenes Vorleseziel.
  Prüfbar ist `queryByRole('img')` innerhalb der Gruppe, per Mutationsprobe belegt.
  **Regel, nicht erzwungen**: es gibt keinen Guard, und ein repoweiter wäre rot geboren (rund 15
  Bestandsstellen, u. a. `pages/EinheitenPage.tsx`, `pages/EinsatzabschnittePage.tsx`,
  `components/FunkErreichbarkeit.tsx`, `components/Platzhalter.tsx`,
  `pages/lagekarte/FachebenenInspector.tsx`) — und ein rot geborenes Gate wird abgeschaltet statt
  befolgt. Verbindlich für Neues und ohnehin Angefasstes.
  **Zwei der genannten Stellen sind seit LFH-370 abgetragen**, weil das Bündel sie ohnehin anfasste:
  `einsatz/ModulPanel.tsx` (🚧 ↗ 🔒 → `ToolOutlined`/`ExportOutlined`/`LockOutlined`) und
  `components/AppLayout.tsx` (🔒 am gesperrten Verwaltungs-Link). Dabei gemessen und für die
  nächste Stelle festgehalten: der Pin, der beim Umbau bricht, ist NICHT der Test auf den
  Accessible Name, sondern ein `getByText(/🚧/)` — und in `AppLayout` war das Emoji sogar TEIL des
  zugänglichen Namens („Verwaltung Schloss"), also nie bloß Dekoration. Testabfragen, die auf das
  Zeichen zeigen (`queryByText('Benutzer 🔒')`), werden nach dem Umbau zu Attrappen, die immer
  `null` liefern; sie gehören auf `title`/Klassenselektor umgestellt, nicht gelöscht.
  **Nicht gemeint** ist ein Schriftzeichen **innerhalb** eines Textetiketts (das Häkchen in
  „Quittiert", das Warnzeichen vor „Nicht verortet") — das ist eine eigene Frage, kein Piktogramm.
  **Zwei Glyphen sind seit dem Neuentwurf (22.09.2026) ausdrücklich erlaubt**, als
  Textzeichen, nicht als Ikone: **⧖** (nachgetragen, `etb/EtbZeitachse.tsx`) und **↗**
  (Deeplink/Textverweis, `etb/EtbBacklinkBadges.tsx`, `etb/EtbBilanz.tsx`). Sie stehen
  `aria-hidden` neben einem Wort, das die Aussage trägt („nachgetragen um …", Verweisname) —
  die Regel oben gilt für jedes andere Bildzeichen weiter.
- **Rot bedient nichts** (LFH-352/LFH-315): `bedien` und Fokusring sind blau, Rot ist Gefahr.
  Jede Statusfarbe braucht einen **zweiten Kanal** (Text, Symbol, Form — WCAG 1.4.1). Farbwerte
  kommen ausschließlich aus `theme/tokens.ts`/`theme/rollen.css`; ein abweichender Wert ist ein
  Fehler, kein Vorschlag. **Rot als Marke** (2-px-Strich der aktiven Rail-Kategorie in `marke`,
  Neuentwurf 22.09.2026) bedient nichts; **ETB-Typfarben** erscheinen als 2-px-Kante plus Typwort,
  nicht als Etikett. **Flächen** (`warnstufeFlaeche`/`flaechenFarbe` in `theme/statusFarben.ts`)
  sind die dritte Darstellungssorte, keine `Statusrolle`; eine vierte Sorte wird dort benannt,
  nicht in `pages/` gebaut. **Rot steht nicht bündig neben Neutralem**: eine `<Space>`-Reihe mit
  `danger`-Knopf und weiterer Aktion trägt `size="middle"` (`aktionsabstand.guard.test.ts`,
  gescopt; sieht keine `danger`-Menüeinträge). **Destruktiv ist nicht gleich destruktiv**
  (LFH-363): Umkehrbares („Außer Dienst", „Deaktivieren", eine gelöste Zuordnung) bekommt Abstand
  und `danger`, aber keine Rückfrage; Unumkehrbares zusätzlich eine Rückfrage, und jedes
  `Popconfirm` an einer destruktiven Aktion trägt `okButtonProps={{ danger: true }}`. Wer eine
  Rückfrage anfasst, entscheidet zuerst die Umkehrbarkeit. Herleitungen, gedeckelter Abstand der
  UHS-Platzkarte und Messwerte: `docs/leitlinien/bedien-leitlinie-herleitungen.md`.
- **Ein Entwurf, der Minuten Schreibarbeit kostet, wird gesichert — und der Refetch darf ihn
  nicht überschreiben** (LFH-342 · C7, `pages/BefehlDetailPage.tsx`). Drei Teile, jeder mit
  einer eigenen Falle: **(1)** Der Effekt, der Serverdaten ins Formular schreibt, braucht einen
  Riegel — die Invalidierung kommt über den Live-Stream auch von **fremden** Änderungen am
  Einsatz, und wer gerade schrieb, sah seinen Text ohne Vorwarnung ersetzt. Die Umkehrung
  gehört als **Paar** getestet: ohne eigene Fassung übernimmt die Seite den Serverstand weiter,
  ein Riegel der immer hält macht sie still veraltet. **(2)** Der Merker ist ein eigener State,
  **nicht** `form.isFieldsTouched()`: antd setzt das Flag beim Speichern nicht zurück, ein
  Autosave darauf schriebe alle 30 s ein PATCH samt Invalidierung und Live-Ereignis für nichts.
  **(3)** Autosave meldet sich **nicht** per Erfolgs-Toast (eine Meldung alle 30 s ist eine
  Alarmquelle nach EEMUA 191), sondern über „zuletzt gespeichert HH:MM" neben dem Knopf — der
  Fehlerfall dagegen sehr wohl.
  **Der Befehlsentwurf schützt seit LFH-462 auch interne Navigation.** Die gesamte
  Routenlandschaft liegt im Data Router (`createBrowserRouter` + `RouterProvider`),
  `entwurf/EntwurfNavigationSchutz.tsx` trägt `useBlocker` mit dem eigenen Merker und
  dem Dialog „Speichern und weiter / Verwerfen / Bleiben“. Fällt der Merker nach
  erfolgreichem Autosave, wird ein noch angehaltener Wechsel nachgeholt; nach „Bleiben“
  ist dieser Versuch verworfen. Query-/Hash-Wechsel im selben Editor bleiben möglich.
  Der gemeinsame Hook behält Autosave und `beforeunload` für beide Entwurfsseiten;
  der Lagebericht erhält durch diese Router-Umstellung keinen eigenen Blocker.
- **Erst die Umkehrbarkeit, dann der Rückgängig-Knopf** (LFH-343 · C8, Fortschreibung von
  LFH-378). Eine Rückfrage vor einer umkehrbaren Aktion ist Reibung; sie ersatzlos zu
  streichen macht die Aktion aber nur dann einklickbar, wenn es einen **serverseitigen**
  Rückweg gibt. Gemessen hatte den im Bestand genau **eines** von vier Kommunikations-Modulen:
  `meldung/repo.rs:setze_status` nimmt jeden gültigen Status; `auftrag`s Vollzug-Achse kannte
  nur vorwärts, die Erinnerungs-Routen ebenso, und `nachforderung::uebergang_erlaubt` war
  streng linear. C8 hat deshalb **zuerst die Rückwege gebaut** (`POST …/vollzug` mit
  `status: 'offen'` — nur aus `in_arbeit`, sonst 422; `POST …/erinnerungen/{eid}/oeffnen`,
  das ALLE DREI Achsen räumt (Status, Vollzug, Quittung); Rücknahme um **genau eine** Stufe
  in `uebergang_erlaubt`, `abgelehnt` bleibt terminal) und dann die Rückfragen entfernt.
  **Wo kein Rückweg existiert, bleibt sie** — heute „Bestätigen" an der Meldungskarte
  (`quittiere_einmalig` ist atomar einmalig, die zweite Bestätigung ist 422) und „quittieren"
  am Auftragsempfänger (es gibt keine Ent-Quittierung). Ein Rückgängig-Knopf, der 422 liefert,
  ist schlechter als keiner. Träger des Toasts: `kommunikation/rueckgaengig.tsx` mit **festem
  Schlüssel**, damit eine zweite Aktion den stehenden Toast ersetzt statt zu stapeln — wer in
  Serie sichtet, erzeugt sie im Sekundentakt, und zwei sichtbare Rückwege sagen nicht, welcher
  zu welchem Datensatz gehört.
  **Ein handlungsfähiger Toast ist keine Alarmmeldung.** Das EEMUA-191-Budget, das CLAUDE.md
  gegen den Autosave-Erfolgstoast zitiert, zielt auf **ungefragte Zustandsmeldungen**. Der
  Rückgängig-Toast erscheint ausschließlich nach einer Nutzeraktion, nie nach einem
  Live-Ereignis, und er ersetzt eine Rückfrage, die vorher **zwei** Interaktionen kostete —
  die Zahl der Unterbrechungen sinkt, sie steigt nicht. Wer diese Grenze verschiebt, verschiebt
  sie für beide Seiten.
- **Der linke Kartenrand trägt EINE Farbe, und Gefahr gewinnt** (LFH-343 · C8, Befund H47).
  Alle vier Kommunikations-Karten akzentuieren ihren Alarmzustand über
  `borderInlineStart: 3px solid token.colorError` — Meldung `alarmiert`, Auftrag `ueberfaellig`,
  Erinnerung `faellig`, Nachforderung `abgelehnt`. Der Eingangszustand („hat noch niemand
  angefasst") belegt denselben Rand mit `token.colorWarning`, und der Vorrang ist entschieden
  statt zufällig: eine unbestätigte überfällige Sofortmeldung ist **rot**, nicht gelb. Das
  **Etikett** bleibt davon unberührt — vergeben ist der Rand, nicht die Aussage. Beide Zustände
  gehören als Paar getestet, prüfbar über `data-alarm` / `data-unbearbeitet` an der Karte.
- **Die „unbearbeitet"-Marke sitzt am Deskriptor, nicht an der Phase** (LFH-343 · C8). Sie ist
  ein optionales Feld am `StatusDeskriptor`-Eintrag (`MELDUNG_STATUS.neu`,
  `AUFTRAG_STATUS.offen`) und **keine fünfte `KommPhase`**: `BEFEHL_STATUS.entwurf`,
  `LAGEBERICHT_STATUS.entwurf`, `ERINNERUNG_STATUS.offen` und
  `NACHFORDERUNG_STATUS.angefordert` liegen alle auf der Phase `offen` und wären von einer
  neuen Phase stillschweigend zu „neu" umklassifiziert worden — samt Durchschlag auf
  `PHASE_META` und `istAbgeschlossen`. Der zweite Kanal ist Pflicht (WCAG 1.4.1) und hier
  dreifach: Farbe, Schriftgewicht am Etikett, Wortlaut. Ein Test, der nur die Tag-Klasse prüft,
  belegt ihn nicht.
- **Eine Höhenkette endet nicht am Layout** (LFH-343 · C8, Befund H51). `flex: 1;
  min-height: 0; overflow-y: auto` scrollt **nichts**, solange kein Vorfahr eine begrenzte Höhe
  hat — und keiner hat sie: `components/AppLayout.tsx` und `einsatz/EinsatzLayout.tsx` setzen
  `minHeight: '100vh'`, der `<Content>` wächst mit seinem Inhalt. Wer einen Scroll-Container
  braucht, begrenzt die **Seite selbst**, in `dvh` statt `vh` (die Browserleiste des
  Handschirms frisst sonst genau die Eingabezeile). Eine Kopfhöhen-Konstante gibt es nicht
  (`theme/rollen.css` kennt nur `--lfh-kopf-polsterung`) — `pages/ChatPage.tsx` misst deshalb
  den eigenen Abstand zum Dokumentanfang, statt eine Zahl zu raten.
  **Zwei Fallen, beide im Browser gemessen und in jsdom unsichtbar:** (1) ein
  `useEffect(…, [])` läuft, während die Seite noch ihren Ladespinner zeigt — die Wurzel gibt
  es dann nicht, die Messung fällt aus und der Effekt kommt nie wieder; der Träger ist ein
  **Callback-Ref**, der beim Einhängen feuert. (2) `ant-row` bringt `flex-wrap: wrap` mit, und
  eine umbrechende Flex-Zeile bemisst sich an ihrem Inhalt, statt ihre Kinder auf die
  Containerhöhe zu strecken — der `Col` stand gemessen auf 1081 px in einem 619 px hohen `Row`.
  Ohne `flexWrap: 'nowrap'` läuft die ganze Begrenzung ins Leere.
  **Geprüft wird das in Playwright mit `toBeInViewport()`, nie mit `toBeVisible()`**: ein
  Element unterhalb des sichtbaren Bereichs ist im Sinne von `toBeVisible` sichtbar — genau der
  Zustand, den H51 beschreibt.
- **Stick-to-bottom hängt an der jüngsten id, nicht an der Länge** (LFH-343 · C8). Ein
  Nachrichtenstrom wächst an zwei Enden: hinten durch neue Nachrichten, vorne durch „Ältere
  laden". Ein Effekt auf `nachrichten.length` träfe beide und risse den Lesenden beim Nachladen
  aus seiner Stelle; die id der jüngsten Nachricht wächst nur im ersten Fall.
- **Ein Speicherfehler gehört an die Seite, ein Erfolg an den Toast** (LFH-345 · C10, Befund
  H14). Sieben Speicherpfade der Einstellungs-/Profil-Gruppe meldeten Fehler ausschließlich
  über `message.error`; nach rund drei Sekunden war die Meldung weg, das ausgefüllte Formular
  stand unverändert da und **wirkte gespeichert** — bei Aufbewahrungsfrist, Nummernkreisen und
  Fristen fällt das erst Stunden später auf. Träger ist `components/SpeicherHinweis.tsx`
  (`SpeicherFehler` · `RechteHinweis` · `SeitenHinweise`); die Mutationen haben ihr
  `onError` **verloren**, der Erfolgs-Toast bleibt. Der Alert räumt sich beim nächsten
  Absenden selbst weg (react-query setzt `error` beim Übergang nach `pending` zurück) — das
  ist die zweite Hälfte der Zusicherung und gehört mitgetestet.
  **`SeitenHinweise` bündelt beide für EINEN Slot, und der Grund ist der Leerfall:** die
  `hinweis`-Hüllen von `AdminPage`/`EinsatzSeite` rendern ihren Abstand, sobald der Inhalt
  truthy ist. Ein Fragment mit zwei `null`-Kindern **ist** truthy und hinterließe einen
  sichtbaren Leerraum.
  **Die vom AK verlangte Fake-Timer-Prüfung ist in dieser Umgebung nicht möglich** — und das
  ist gemessen, nicht vermutet. Beide Bauformen scheitern: nach dem Klick aktivierte
  Fake-Timer erreichen antds längst laufenden Message-Timer nicht, und mit
  `useFakeTimers({ shouldAdvanceTime: true })` ab dem Rendern (ohne das bleibt die Seite im
  Ladeskelett und der Knopf existiert nie) bleibt der Toast beim Vorlauf trotzdem stehen. Die
  **Mutationsprobe** entscheidet: mit zurückgedrehtem `message.error` blieb genau dieser Test
  grün, während „die Meldung steht außerhalb von `.ant-message`" und „sie geht beim nächsten
  Absenden" rot wurden. Ein Test, der nicht rot werden kann, behauptet eine Deckung, die er
  nicht hat — die beiden tragenden Aussagen stehen deshalb an seiner Stelle.
- **Ein gescheiterter Zustandsübergang meldet sich dort, wo die Person steht** (LFH-535,
  Nachzug N5 aus LFH-348 · C13). Dieselbe H14-Diagnose wie beim Speichern, nur am
  Übergang: schlägt `POST …/freigeben` fehl, hält antd das Bestätigungs-Modal **offen** —
  und solange der Grund nur im Toast stand, war er nach rund drei Sekunden weg und der
  unveränderte Dialog von „nichts passiert" nicht zu unterscheiden. Der Seiten-Alert taugt
  hier **nicht**: der Dialog trägt `mask={{ closable: false }}`, alles dahinter ist
  abgedunkelt. Der Grund steht deshalb **IM Dialog**, Bauform `EntwurfNavigationSchutz`
  (LFH-494).
  **Träger ist `entwurf/FreigabeDialog.tsx`, eine geteilte Komponente — nicht zwei
  Copy-Paste-Dialoge**: die Entscheidung gilt für beide Zwillingsseiten gemeinsam, sonst
  entsteht wieder die Divergenz, die C13 mit dem geteilten Verlustschutz-Hook geschlossen
  hat. Damit fällt `modal.confirm` an beiden Seiten weg, und zwar aus einem gemessenen
  Grund: dessen `content` wird beim **Aufruf** eingefroren, ein
  `<SpeicherFehler fehler={mutation.error}>` darin rendert nicht nach und müsste per
  `instanz.update({ content })` von Hand nachgeschoben werden — ein zweiter
  Anzeigemechanismus neben dem, den LFH-494 schon gebaut hat.
  **Der Flow hat ZWEI Fehlerquellen und zwei Überschriften**: der Speicher-Vorlauf
  („Nicht gespeichert") und der Übergang selbst („Freigabe fehlgeschlagen") sagen der
  Person Verschiedenes darüber, was ihr Entwurf jetzt **ist**. Die Wahl liegt als reine,
  exportierte `freigabeGrund`-Funktion daneben; **Vorrang hat der Speicherfehler**, und
  das ist die Reihenfolge, nicht Geschmack: scheitert der Vorlauf, läuft die Freigabe gar
  nicht erst, ein dann noch stehender Freigabe-Grund stammt aus einem **früheren** Versuch.
  Umgekehrt kann der Speicherfehler nicht veralten — er fällt bei jedem gelungenen
  Speichern. Aus demselben Grund ruft das Öffnen `freigebenMutation.reset()`: react-query
  hält `error` bis zum nächsten `mutate()`, ein Abbrechen-und-neu-Öffnen trüge den alten
  Grund sonst in einen frischen Dialog.
  **Die Toasts sind BEIDE weg, auch der im Speicher-Vorlauf.** Bis LFH-494 war er der
  einzige Kanal über der Maske; mit dem Grund im Dialog wäre er die zweite Wahrheit, die
  drei Sekunden später geht. Der Seiten-Alert bleibt daneben stehen — er überlebt das
  Schliessen. Der **Erfolg** bleibt beim Toast: er quittiert eine abgeschlossene Handlung,
  und der Dialog, in dem er stünde, ist dann zu. `fortschreibenMutation` ist **nicht**
  betroffen: sie läuft ohne Dialog, dort ist der Toast die richtige Form.
  **Zwei gemessene Testfallen dabei:** (1) `within(dialog).findByText(…)` allein belegt die
  Zusicherung **nicht** — käme der Toast zurück, stünde der Wortlaut an zwei Stellen und
  die Abfrage im Dialog fände ihren Alert weiter; gezählt wird deshalb die Message-Queue
  selbst (`.ant-message`). Ein `getAllByText`-Zähler taugt ebenfalls nicht überall: beim
  gescheiterten Vorlauf steht der Grund zu Recht doppelt (Dialog **und** Seiten-Alert).
  (2) `toBeVisible()`/`queryByRole('dialog')` sind für „offen/zu" blind — antds Modal räumt
  seinen Knoten erst am Ende der Zoom-Animation ab, und jsdom feuert kein `transitionend`;
  geprüft wird `ant-zoom-leave` (Konvention aus `MaterialPage.test.tsx`).
  **Kein eigener `sendetRef`-Riegel am OK-Knopf**, anders als in `Erfassung.tsx`: antds
  `Button` sperrt seinen Klick selbst, solange `loading` steht (gemessen,
  `antd/es/button/Button.js`), und der Knopf ist hier der **einzige** Weg in die
  Absende-Funktion — dort greift der Riegel, weil ein Tastenkürzel den Knopf umgeht. Ein
  zweiter Riegel daneben liesse sich in jsdom von antds eigenem nicht unterscheiden, wäre
  also eine Zusicherung, die kein Test rot machen kann.
- **Fehlende Berechtigung wird erklärt, nicht stumm weggeschaltet** (LFH-345 · C10, M16). Ein
  `RechteHinweis` (`Alert type="info"`) über dem Block nennt den Grund, und **der
  Speichern-Knopf verschwindet nicht mehr** — er steht gesperrt da. „Ausgegraut" allein ist
  eine Ein-Kanal-Aussage (Grau ist eine Farbe, WCAG 1.4.1) und nennt keinen Grund; ein
  fehlender Knopf ist von „diese Seite kann das gar nicht" nicht zu unterscheiden. Das ist
  derselbe Befund, den LFH-370/B5j je Zeile gelöst hat (`Anmeldeverfahren`), hier auf
  Blockebene. Die Bestandstests „kein Speichern-Button" heißen entsprechend jetzt „Knopf
  **gesperrt**".
- **Eine Sofort-Speichern-Zeile sperrt sich selbst, nicht die Liste** (LFH-345 · C10, H15).
  `ModulEinstellungsListe` nahm ein `laeuft: boolean` und sperrte damit bei jeder Mutation
  **alle 50** Steuerelemente; jetzt `laeuftKey`/`fehlerKey` mit Key-Vergleich. Die Zeile, an
  der eine Mutation scheitert, trägt `data-fehler` und den linken Rand aus `token.colorError`
  — der Wert selbst springt ohnehin von allein zurück (die Anzeige liest aus dem Query, es
  gibt kein optimistisches Update), was fehlte, war die Angabe **welche** Zeile. Die Quelle
  ist `mutation.variables`, nicht ein eigener State.
- **Eine feste Spaltenbreite ist ein Breakpoint, den niemand gesetzt hat** (LFH-345 · C10,
  H16). Die Modulzeile belegte fest 268 px (64 Sichtbar + 180 Rolle + zwei Abstände); bei
  390 px blieben unter 100 px fürs Label. Jetzt CSS-Grid `minmax(0, 1fr) auto auto`, unter
  `md` gestapelt — **und die Spaltenköpfe fallen dann GANZ weg**: ein Kopf über gestapelten
  Zeilen benennt keine Spalten mehr, sondern behauptet eine Ordnung, die es nicht gibt. Der
  Rollen-`Select` nimmt `width: '100%'` statt einer festen Breite (dieselbe Beobachtung wie
  bei `Datensicht.tsx:234-236`, LFH-369: eine feste Mindestbreite drängt das Steuerelement aus
  der schmalen Karte) — dass die `auto`-Spalte dabei nicht auf ihre Pfeil-Ikone zusammenfällt,
  ist **in Playwright gemessen**, nicht angenommen; jsdom rechnet kein Layout.
  Die Beschriftung ist ein handgebautes Bedienziel und trägt deshalb die ZWEI Angaben aus
  LFH-365 (`modulZeilenStil`, rein und exportiert), plus ein `<label htmlFor>` **nur an der
  bedienbaren Zeile** — dieselbe Regel wie in `Anmeldeverfahren` (LFH-370).
- **Ein Absende-Ziel darf nie später erscheinen als die Felder, die es absendet**
  (LFH-345 · C10, M18). Die Anmeldekarte staffelte ihre Eingangsanimation: Karte 0,15 s
  Versatz + 0,7 s Dauer, Felder bei 0,3/0,38 s, Absende-Knopf bei 0,46 s — der Knopf stand
  gemessen erst nach **1,06 s** vollständig da. Wer schnell tippt und Enter drückt, drückt auf
  einen Knopf, der noch halb durchsichtig ist. Jetzt eine gemeinsame Regel ohne Versatz,
  0,35 s. Geprüft wird die **CSS-Quelle** (`pages/LoginPage.animation.test.ts`), nicht ein
  gerechneter Stil: jsdom führt keine Animationen aus. Die schärfere der beiden Aussagen ist
  die **Abwesenheit** einer eigenen Versatz-Regel je Zeile — ein niedriger Wert ließe sich
  vortäuschen, ein fehlender Selektor nicht. Der `prefers-reduced-motion`-Block bleibt.
- **Dieselbe Eingabe wird nicht zweimal gebaut** (LFH-345 · C10, M20).
  `components/OtpEingabe.tsx` trägt die sechsstellige TOTP-Eingabe für Anmeldung **und**
  Profil; vorher hatte die Anmeldeseite `inputMode`/`pattern`/`maxLength`/Ziffern-Optik und
  die Profilseite ein nacktes `<Input>` — die schlechtere Bauform stand ausgerechnet dort, wo
  2FA **eingerichtet** wird. Drei gemessene Festlegungen daran:
  **(1) `Form.Item` injiziert die `id`, und sie MUSS durchgereicht werden** — ohne sie zeigt
  das `<label for>` ins Leere; zehn Bestandstests fielen mit „no form control was found
  associated to that label" aus, und Vorlesende verlieren denselben Bezug.
  **(2) Zwei Absendewege brauchen einen Riegel.** Seit die sechste Ziffer selbst absendet,
  führen Auto-Weg und Knopf zum selben Aufruf; ohne `sendetRef` lief `totp/finish` zweimal
  gegen einen Code, der serverseitig **genau einmal** gültig ist — der zweite Aufruf meldete
  „Code ungültig" für einen Code, der gerade funktioniert hat (gemessen:
  `['login','totpFinish','totpFinish']`). Der Riegel sitzt in der Absende-Funktion, nicht am
  Knopf, und fällt im `finally`; dieselbe Bauform wie in `components/Erfassung.tsx`.
  **(3) Der Merker im Primitiv hält den zuletzt GEMELDETEN Code**, kein Flag auf „ist
  sechsstellig" — und er wird beim Kürzen zurückgesetzt: wer nach einer Ablehnung dieselbe
  Ziffer erneut tippt, muss einen neuen Versuch bekommen. Ein Riegel, der das verhindert,
  hielte die Person fest. **Keine `size`-Angabe** am Primitiv (beide Aufrufer hatten
  `size="large"`): die Höhe erbt es vom `ConfigProvider`, die auffällige Ziffern-Optik kommt
  aus `login-otp`.
- **Eine aufgeteilte Route erbt den Vollersatz-Vertrag ihrer Vorgängerin** (LFH-345 · C10,
  H15/M15). Die Einsatz-Einstellungen liegen seit C10 auf vier Sektions-Routen
  (`…/einstellungen/{allgemein,verhalten,aufbewahrung,module}`, Builder
  `einsatzEinstellungenPfad` in `routing/deeplinks.ts`, Reiter-Layout nach dem Muster von
  `AdminLayout`). `PUT …/einstellungen` ist **Vollersatz**: jede Sektion schickt die Felder
  der anderen als Bestandswert mit, sonst nullt ein Speichern in „Aufbewahrung" die
  Nummernkreise — **ohne roten Test und ohne Fehlerbild**. Träger ist
  `einstellungen/einsatzEinstellungenForm.ts` mit `zuUpdate` als Basis, exakt die Bauform,
  die die Org-Ebene seit LFH-281 fährt. `basemap_modus`, `karten_zoom_start` und
  `fachebenen_sichtbar` (seit LFH-319 auf der Karte zuhause) fahren in **jedem** Payload mit
  und stehen im Test namentlich.
  **Jede Sektion stellt ihre Queries selbst**, statt sie über `useOutletContext` vom Layout
  zu bekommen — nicht aus Bequemlichkeit: `Form initialValues` wird genau einmal beim Mount
  gelesen; eine Sektion, die ohne Daten montiert, zeigt ein leeres Formular, und der nächste
  Klick auf Speichern schickt einen Vollersatz-PUT aus lauter `null`. TanStack führt gleiche
  Query-Keys ohnehin zusammen, der doppelte Aufruf kostet keinen zweiten Request.
  **Die Speichern-Leiste liegt sticky am unteren Rand, nicht im Kopf-Slot** — dadurch steht
  der Knopf IM `<form>` und trägt `htmlType="submit"`, womit Enter absendet (Erfassungs-Norm
  B4/LFH-332; ein Knopf im Kopf-Slot ist ein DOM-Geschwister außerhalb des `<form>` und kann
  nichts übermitteln). „Genau eine Primäraktion im Kopf" (LFH-340 · C5) ist damit trivial
  erfüllt statt verletzt. `speicherLeisteStil`/`feldrasterStil` sind **rein und exportiert**,
  damit die Zusicherungen ohne Render prüfbar sind — die Breiten-Schwelle liest der Aufrufer
  aus `useViewport`, nicht die Stilfunktion: eine reine Funktion, die selbst einen Hook ruft,
  wäre kein Prüfobjekt mehr.
- **Ein Status gehört nicht in die Seite, die ihn zufällig zuerst brauchte**
  (LFH-345 · C10, M14) — **und seit LFH-358 auch nicht neben den Vertrag.** Die Karte war
  erst eine modul-lokale Konstante in `EinsaetzePage`; der zweite Leser
  (`EinsatzdatenPage`) hatte sie **nicht** und zeigte den rohen Wire-Wert im Titel-Tag. Das
  ist die Sorte Abweichung, die niemandem auffällt: beide Seiten sahen für sich plausibel
  aus, und „aktiv" ist zufällig auch ein deutsches Wort. C10 hat sie nach
  `einsatz/einsatzStatus.ts` gezogen, aber bewusst NICHT in `theme/statusFarben.ts` — dort
  zählte der Abdeckungsguard gegen ein `toHaveLength`, ein Eintrag mehr wäre eine
  Vertragsänderung gewesen und damit eine eigene Entscheidung.
  **LFH-358 ist diese Entscheidung, und sie fiel andersherum:** die Karte heißt jetzt
  `einsatzStatus` und steht IM Vertrag (`theme/statusFarben.ts`), zusammen mit
  `dringlichkeit` (vormals `DRINGLICHKEIT_ZEICHEN` in `lage-dashboard/lagebild.ts`), die
  mit derselben Begründung draußen lag. `einsatz/einsatzStatus.ts` gibt es nicht mehr — wer
  den Import sucht, nimmt `theme/statusFarben.ts`.
  **Der Grund ist der Wächter selbst:** `statusFarben.test.ts` leitet die geprüfte Map-Liste
  aus den Exporten des Moduls ab, „damit eine zehnte Map nicht still durchrutscht". Eine
  Karte mit dem Vertragstyp **außerhalb der Datei** läuft an genau diesem Wächter vorbei —
  der Präzedenzfall untergräbt also die Aussage, die er schützen soll. Gemessen war das
  keine Theorie: während `einsatzStatus` draußen stand, malten **zehn** Seitenköpfe weiter
  `<Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>`,
  also denselben Befund, den M14 an einer Seite einzeln behoben hatte.
  **Die Zahl im Abdeckungstest zählt „Vertragskarten", nicht „Vertrags-Enums"**:
  `dringlichkeit` ist über eine `Statusrolle` geschlüsselt und beschriftet die Stufe selbst,
  nicht eine Domänen-Achse. Nach LFH-358 stand sie bei 15; seither kamen `hochwasserKlasse`
  (LFH-77) und `odlStufe` (LFH-78, Entscheidung 4 in
  `openspec/changes/archive/2026-09-21-lfh-78-fachebene-odl/design.md`) und
  `luftqualitaetIndex` (LFH-79) dazu — Stand 22.09.2026: 18. Seither kamen unter anderem
  `abschnittLagezustand` (LFH-608), `abloesungEinstufung` (LFH-635), `betreuungsstelleStatus`
  und `raeumungszustand` (LFH-639) sowie `verpflegungDeckung` (LFH-634) dazu — **Stand
  24.09.2026: 24** (`ALLE_MAPS` in `statusFarben.test.ts`). Der Neuentwurf hat **keine**
  Karte hinzugefügt: ETB-Typfarben und Warnstufen-Balken sind eigene Paletten
  (`etbTypFarbe`/`warnstufeBalkenFarbe`), keine `StatusDarstellung`. Jede weitere Karte bleibt
  eine eigene Entscheidung, die im Ticket begründet wird.
  **Zwei Guards halten beide Grenzen maschinell** (`theme/statusVertrag.guard.test.ts`):
  kein `Record<…, StatusDarstellung>` außerhalb `statusFarben.ts` — **die Datei, nicht das
  Verzeichnis**, denn ein Geschwistermodul exportiert nichts über sie und liefe am
  Abdeckungstest genauso vorbei —, und kein `<Tag color={…}>`, das ein Vertrags-Enum
  einfärbt; dafür ist `components/StatusTag.tsx` da. Blinde Flecken stehen mit gemessener
  Fundstelle im Kopfkommentar; eine Schuldmenge gibt es bewusst nicht. Der Selbsttest des
  zweiten Guards (der Schnitt findet überhaupt `<Tag`-Stellen) steht seit dem Neuentwurf auf
  **≥ 50** statt ≥ 100: gemessen 132 Stellen am 12.09., **70** am 22.09.2026, weil Status jetzt
  als `StatusChip`/`StatusZelle` statt antd-`Tag` erscheint. Die Zahl kann nur fallen; wer sie
  unter 50 drückt, misst neu und senkt die Schranke.
- **Der Kopf-Slot trägt, was ÖFFNET — nie, was ABSENDET** (LFH-346 · C11). Die
  Anlegen-Knöpfe der elf Stammdaten-Sektionen sind in den `aktionen`-Slot von `AdminPage`
  gewandert, der Speichern-Knopf der Einsatz-Defaults im selben Ticket **heraus** in eine
  sticky Leiste im Fuß. Beides ist richtig, und der Unterschied ist die Ursache: „Fahrzeug
  anlegen" öffnet ein Modal und braucht kein `<form>`; ein Speichern-Knopf **muss** im
  `<form>` liegen, sonst sendet Enter nicht (Erfassungs-Norm B4 — der Slot rendert
  ausserhalb jedes `<form>`, `AdminPage` sagt das im eigenen Doc-Kommentar). Wer die beiden
  „harmonisiert", tötet die Enter-Zusicherung auf der einen oder die Kopf-Regel auf der
  anderen Seite.
- **Eine Sektion wickelt ihren Seitenrahmen selbst** (LFH-346 · C11, Befund M46). Bis dahin
  wickelte `admin/adminNav.tsx` die elf Stammdaten-Tabs in `<AdminPage titel={label}>` — sie
  konnten damit weder `aktionen` noch `hinweis` erreichen. Nur die Sektion weiss, WAS ihre
  Primäraktion ist und OB sie gerade gesperrt gehört; ein Wrapper von aussen kann den Slot
  nicht füllen, und ein durchgereichter Context wäre ein neuer Mechanismus für einen Fall,
  den die Karten- und Einstellungssektionen seit LFH-281 anders lösen. **Der Preis ist eine
  Dopplung** — der Titel steht in der Registry (`label`, fürs Menü) UND in der Sektion
  (`titel`, für den Kopf). Sie war bei den fünf selbstwickelnden Sektionen schon da,
  unbemerkt; `adminNav.test.tsx` schliesst sie jetzt mit einem Drift-Test, der **auf die elf
  Stammdaten-Sektionen gescopt** ist: über alle sechzehn zu iterieren zöge die Queries der
  Karten- und Einstellungssektionen in die Datei und färbte sie aus Mock-Gründen rot, die
  mit Titel-Drift nichts zu tun haben.
- **Fehlende Berechtigung hat zwei Zuschnitte, nicht einen** (LFH-346 · C11, M45). Die
  **Primäraktion** steht gesperrt mit `RechteHinweis` darüber (Fortschreibung von C10/M16),
  die **Zeilenaktionsspalte** entfällt weiterhin ganz. Das ist kein Widerspruch: n Zeilen ×
  2 gesperrte Knöpfe kosten waagerechten Platz für null Handlungsmöglichkeit, und das
  M16-Argument („ein fehlender Knopf ist von ‚diese Seite kann das gar nicht' nicht zu
  unterscheiden") greift genau dann nicht mehr, wenn ein Satz auf der Seite den Grund nennt.
  Der Wortlaut steht **einmal** in `stammdaten/rechteText.ts`; vorher hatte jede Sektion
  ihre eigene Ausprägung von „nur lesen", vier gezählt, drei davon stumm.
- **Eine Detailseite braucht nicht zwingend einen Einzel-Endpunkt** (LFH-346 · C11, H36).
  `/admin/stammdaten/{fahrzeuge,personal}/:id` liest die **Listen**-Query
  (`globalKeys.fahrzeuge()`) und selektiert die Zeile — `FahrzeugAnzeige`
  (`src/fahrzeug/mod.rs:92-108`) trägt alle Stammdatenfelder, ein `GET /api/fahrzeuge/{id}`
  läge Byte für Byte darauf. Ein zweiter Endpunkt wäre ein zweites Cache-Fach für dieselben
  Bytes und eine zweite Invalidierung. Den 404-Fall erzeugt die Seite selbst. **Nicht
  übertragbar** auf Entitäten, deren Detailform mehr trägt als die Listenform (`PersonDetail`
  gegen `Person`) — dort ist der Einzel-GET richtig, und `PersonenDetailPage` bleibt das
  Muster dafür. Die Admin-Pfad-Builder liegen in `admin/adminNav.tsx`, **nicht** in
  `routing/deeplinks.ts`: das trägt Einsatz-Pfade, und zwei Quellen für dieselbe
  Adressfamilie sind genau die Lage, gegen die LFH-25 gebaut wurde.
- **Ein Collapse im Erfassungsformular liegt in Reichweite von Enter** (LFH-346 · C11,
  gemessen). Er steht IM `<form>` und damit vor dem Speichern-Knopf; Enter löst den
  **ersten** Übermittlungsknopf im Baum aus. Wäre der Klapp-Kopf ein `<button>` ohne
  `type="button"`, klappte Enter im ersten Feld den Bereich auf, statt zu speichern — und
  die beiden Struktur-Abfragen der Erfassungs-Norm (keine `.ant-modal-footer`, Knopf im
  `<form>`) blieben dabei **beide grün**. In antd 6 ist er gemessen ein
  `<div role="button">`, die Zusicherung hält; `MaterialFormModal.test.tsx` ist die Stelle,
  an der ein antd-Sprung das auffliegen liesse.
- **Ein Direkteinstieg ist ein Baustein, kein UHS-Sonderfall** (LFH-347 · C12, M56).
  `components/Direkteinstieg.tsx` + `components/EinstiegSwitcher.tsx` +
  `components/direkteinstiegKern.ts` tragen „spring in den zuletzt gewählten Datensatz, sonst
  in den ältesten aktiven, sonst den jüngsten; bei leerer Menge Leerzustand mit Anlage". UHS
  und Bereitstellungsraum sind zwei dünne Belegungen; die Tabelle liegt jeweils unter
  `…/liste`. Der `localStorage`-Schlüssel `<praefix>:letzteAuswahl:<einsatzId>` ist für `uhs`
  byte-gleich zum Bestand — gespeicherte Auswahlen überleben den Umbau, und
  `direkteinstiegKern.test.ts` pinnt ihn.
  **Die Kerndatei heisst `direkteinstiegKern.ts`, nicht `direkteinstieg.ts`** — und das ist
  gemessen, nicht Geschmack: der naheliegende Name kollidiert case-insensitiv mit
  `Direkteinstieg.tsx` im selben Verzeichnis. Vites `resolve.extensions` prüft `.ts` **vor**
  `.tsx`, auf macOS/Windows traf `import … from './Direkteinstieg'` deshalb still die
  Kerndatei statt der Komponente, ohne Fehler — der Default-Export war schlicht `undefined`
  (Memory `ts-tsx-basename-shadowing-typecheck`). Wer ein Modul aus Komponente plus reinem
  Kern baut, gibt dem Kern ein Suffix.
  **Eine Stärke wird EINMAL summiert** (`anzeige/staerke.ts:summiereStaerke`, `null` bei
  leerer Menge — „keine Einheit" ist nicht „0/0/0"); Abschnitt eigene, Abschnitt inkl.
  Unterabschnitte (`pages/einsatzabschnitte/abschnittStaerke.ts`) und BR-Summenzeile lesen alle
  von dort. Die Bestandszeile `Stärke (F/UF/M//Σ)` behält ihre Bedeutung (direkt zugeordnet);
  die kumulierte ist eine **zweite** Zeile, kein stiller Bedeutungswechsel.
  **„Abschnitt anlegen" ist ein lokaler Entwurf** (M55): eigener `entwurf`-State, kein
  Fake-Datensatz in der Query — ein Objekt mit `id: -1` liefe durch `nachfahrenInkl`, die
  Stärke-Rechnung und den Deeplink-Abgleich. Der POST (und der ETB-Eintrag) entsteht beim
  Speichern; Abbrechen hinterlässt nichts, und der Test zählt beides (0 POST, 0
  ETB-Invalidierung) — wobei der POST-Zähler die Aussage trägt und die ETB-Zeile die Absicht
  dokumentiert: sie hängt kausal am POST (die Invalidierung läuft nur in dessen `onSuccess`)
  und kann für sich allein nicht rot werden.
  **M51 bleibt bei einem Auslöser je Zelle** — das Ticket verlangte ein 5-Wege-Segmentcontrol
  mit einem Tipp, LFH-368 hat gemessen, dass das Breitenbudget (~693 px) es nicht trägt. Der
  e2e-Nachweis (`e2e/gefahren-matrix-zelle.spec.ts`) misst ≥ 44 px auf dem Tablet in Stufe
  `komfortabel`; im Fükw sind 30 px die Staffel, kein Mangel.
- **Der Verlustschutz eines Entwurfs ist ein Hook, keine Seitenlogik** (LFH-348 · C13, H63).
  `entwurf/useEntwurfVerlustschutz.ts` trägt Riegel gegen den Fremd-Refetch, Autosave (30 s +
  Blur), `beforeunload` und den Zeitstempel; `BefehlDetailPage` und `LageberichtDetailPage`
  konsumieren ihn — und **beide rendern ihren Inhalt mit `key={<id>}`**, weil der Merker zu
  EINEM Datensatz gehört: ein Routenwechsel auf dieselbe Komponente (Fortschreiben → neuer
  Entwurf) trüge sonst den Riegel des alten mit und hielte den neuen Serverstand fern
  (getestet). Das Ticket verlangte `form.isFieldsTouched()` und ein lokales `useEntwurf`
  (IndexedDB); beides ist bewusst nicht gebaut — die C7-Begründung gilt, und ein lokaler
  Entwurf neben dem Server-Autosave wäre eine zweite Wahrheit ohne Auflösungsregel.
  **Die Abschnittsnavigation ist ein Akkordeon, kein `Anchor`** — gemessen: die Bestandsseite
  war 2108 px hoch (`e2e/lagebericht-schmal.spec.ts`), die verlangte Halbierung ist mit acht
  ausgeklappten Editoren in keiner Bauform erreichbar, und der Körper hat einen Boden von
  `100vh`. Die Kopfzeilen (`lageberichte/AbschnittsAkkordeon.tsx`, `forceRender`, Leer-Marke
  mit Wort „(leer)" als zweitem Kanal) SIND die Navigation. Wer eine Seitenhöhe misst, wartet
  bis sie steht: `autoSize` misst nach dem Einhängen nach, ein Griff davor las 1324 statt 2108.
  Die Lageberichte-Liste zeigt **Kettenköpfe** (`lageberichte/ketten.ts`, Kopf = ohne
  Nachfolger, nicht `vorgaenger_id == null`). Die Lagemeldungen waren hier die zwölfte
  `Datensicht`-Konsumentin und sind seit dem Neuentwurf (22.09.2026) wie das ETB eine
  Zeitachse; ihre Tagesgrenze liegt weiter in der Anzeigezone (`lagemeldungen/zeitachse.ts`),
  nicht in UTC.
- **Ein Klick auf „Entwurf speichern" ist EIN PATCH** (LFH-495, Nachzug zu C13/N3+N4). Der
  Klick ist zwei Ereignisse: er nimmt dem Feld zuerst den Fokus — `onBlur` startet den
  Autosave —, und erst danach kommt `click` mit `form.submit()`. Bis dahin sperrte `laeuftRef`
  nur Autosave gegen Autosave; der explizite Pfad lief daneben und schickte denselben Inhalt
  ein zweites Mal, samt zweitem SSE-Ereignis und zweiter Invalidierung. **`speichereJetzt` ist
  jetzt die EINZIGE Pforte** für ein Speichern ausserhalb der Uhr; `quittungVorbereiten`,
  `quittiereGespeichert` und `meldeSpeicherfehler` sind **entfernt und nicht bloss ungenutzt**
  — aus ihnen war der zweite Pfad zusammengesetzt, und die Begründung ist dieselbe wie bei
  `onFehler` in LFH-494.
  **„Anhängen" allein ist ein Rennen, nicht der Riegel** (gemessen): zwischen `mousedown` und
  `click` liegen Millisekunden, ein schneller PATCH ist da längst zurück und die Dublette ging
  doch raus. Vor dem Anhängen steht deshalb die Frage, ob dieser Stand **schon gesichert** ist
  (`gesichertRef`). Dessen Start auf `-1` ist Teil des Vertrags: „nichts geändert" und „nichts
  gesendet" sind zwei Zustände, und mit `0` verlöre ein unberührter Entwurf den PATCH des
  Freigabe-Vorlaufs — `/freigeben` prüft den **persistierten** Stand, nicht den Editor-Inhalt.
  **Der Riegel sperrt die Dublette, nicht den Fortschritt:** ein Blur mit NEUEREM Stand
  bekommt weiter seinen eigenen PATCH. Die strengere Fassung („es läuft etwas, also nichts
  senden") verschluckte den Fall „erst manuell speichern, dann weitertippen, dann die Seite
  verlassen" und färbte den Reihenfolge-Test des Befehls sofort rot.
  **`speichertGerade` (vormals `autosaveLaeuft`) deckt beide Pfade ab** und ist damit die
  einzige Quelle am Navigations-Blocker. **Nicht** als `loading` am Speichern-Knopf, obwohl
  das Ticket es vorschlug: antds Ladezustand hängt ein `role="img" aria-label="loading"` in
  den Knopf und benennt ihn bei JEDEM stillen Autosave zu „loading Entwurf speichern" um —
  ein Hintergrundvorgang, der ein Bedienelement umbenennt. Der Riegel liegt im Hook, nicht an
  einem `loading`.
- **Der Einstiegsfokus eines Entwurfs sitzt im ersten LEEREN Abschnitt** (LFH-495; das Ticket
  liess die Bedienentscheidung offen), sonst im ersten. Ein fortgeschriebener Bericht trägt
  die Abschnitte des Vorgängers befüllt — der erste leere ist die Stelle, an der die Arbeit
  weitergeht; der Titel ist beim Anlegen UND beim Fortschreiben schon gesetzt und wäre der
  falsche Kandidat. Der Lagebericht klappt denselben Abschnitt auf, sonst stünde der Cursor
  in einem zugeklappten Editor. Träger ist `entwurf/Einstiegsfokus.tsx` (reine, exportierte
  Wahlfunktion). Vier Festlegungen, alle gemessen: es ist eine **Komponente im
  Formularzweig**, kein Effekt in der Seite (beide Seiten zeigen erst einen `<Spin>`, ein
  `useEffect(…, [])` oben liefe, während es das Feld noch nicht gibt, und käme nie wieder);
  ein **Effekt**, kein `requestAnimationFrame` (Lektion aus `Erfassung.tsx`); das Ziel wird
  **am Mount eingefroren** und im Lagebericht **während des Renderns** abgeleitet — per Effekt
  kam es eine Runde zu spät und der Fokus landete auf `<body>`, der Riegel gegen die
  Renderschleife ist das Objekt, weil `feld` `null` sein darf; und es wird **kein Fokus
  gestohlen**, der schon woanders liegt. Das Ziel kommt aus dem **Serverstand**, nicht aus den
  Formularwerten — die sind beim Mount noch leer.
- **`Form.useWatch([], form)` kostet die Kaskade, nicht die Marke** (LFH-495 · N4, dreimal
  gemessen bei 1366 × 768, `e2e/lagebericht-tippen.spec.ts`, Anschlag bis Bild): Median 36 ms,
  **p90 73 ms**, schlechtester 138 ms — gegen 17/30/72 ms am Befehlsentwurf, der dieselben
  Editoren **ohne** `useWatch` trägt. Beide im Ticket vorgeschlagenen Eingriffe wären
  wirkungslos gewesen: **„auf die Abschnittspfade einschränken"** geht nicht (der Hook nimmt
  EINEN Pfad, die Abschnittszahl steht erst zur Laufzeit fest) und würde nichts sparen — die
  Abschnittspfade sind genau das, was sich beim Tippen ändert; **„die Leer-Marke entprellen"**
  trifft das Ergebnis, während den Render der **Hook** auslöst. Wirksam ist, die Kaskade zu
  unterbinden: `AbschnittsAkkordeon` ist `memo`, `befuellt` läuft über ein **Primitiv**
  (`befuellungsKette`) und der `editor` über `useCallback`. Der Elternteil rendert weiter je
  Anschlag (Kopfzeile, Etiketten — billig), die acht Editoren mit ihrer `autoSize`-Nachmessung
  nicht mehr: **p90 43–48 ms**. Die Sperre trägt nur, solange ALLE vier Props
  identitätsstabil sind — eine inline `editor`-Prop genügt, um sie aufzuheben, und sie macht
  sonst nichts kaputt.
  **Das Gate dafür ist deterministisch und steht NICHT in der e2e-Suite** (gemessen im ersten
  CI-Lauf dieses Tests): ein p90-Deckel von 60 ms war auf dem GitHub-Runner (2 vCPU, zwei
  Playwright-Worker auf zwei Kernen) mit **83,4 ms** und im Wiederholversuch **62,5 ms** rot,
  obwohl die Memoisierung drin ist. Auch das Verhältnis zur Kontrolle trennt nicht: 2,56 und
  1,74 gegen 2,35 im unmemoisierten Zustand — die Bereiche überlappen. Ein absoluter
  Millisekunden-Deckel für Eingabelatenz ist auf geteilten zwei Kernen ein Würfel, und ein rot
  geborenes Gate wird abgeschaltet statt befolgt. Die Zusicherung zählt deshalb in Vitest die
  Aufrufe der `editor`-Render-Prop (`AbschnittsAkkordeon.test.tsx`): bei unveränderten Props
  rendert der Teilbaum nicht neu, ohne Uhr und hardwareunabhängig. **Beim Schreiben dieses
  Tests ist die Falle, `rerender` DASSELBE Element-Objekt zu geben** — React überspringt den
  Teilbaum dann von sich aus (Bailout auf die Element-Referenz), und der Test ist auch ohne
  `memo` grün (per Mutationsprobe gemessen); es braucht je Render ein neues Element mit
  gleichen Prop-*Identitäten*. Der e2e-Spec bleibt die **Messung** samt
  Struktur-Vorbedingungen und schreibt die Zahlen in Log und Annotation; die RAIL-Deckel dort
  gelten nur mit `PW_LATENZ=1` auf ruhiger Hardware. **Offen und benannt:** der schlechteste Anschlag liegt
  unverändert bei 120–130 ms und damit über der RAIL-Grenze von 100 ms — die Memoisierung hat
  ihn nicht bewegt, er hängt also nicht an `useWatch` (Verdacht: `autoSize`-Neumessung beim
  Zeilenumbruch, die auch die Kontrolle auf 58–77 ms hebt). Eigene Untersuchung, kein
  Nebenprodukt dieses Nachzugs.
- **`kettenKoepfe` lässt keinen Bericht fallen** (LFH-495). Bei einem VOLLSTÄNDIGEN Zyklus
  (`11 → 13 → 11`, ein Datenfehler) hat jedes Glied einen Nachfolger, es gibt also keinen
  Kopf — die Funktion lieferte dafür eine leere Liste, und die Berichte verschwanden lautlos
  aus der Übersicht (`ketten.test.ts` pinnte das). Was nach dem ersten Durchgang in keiner
  Kette liegt, wird **hinten** angehängt, mit gefolgter Kette statt als nackte Einzelköpfe:
  der Zyklus bricht ohnehin ab, und so bleibt die Verwandtschaft sichtbar statt als n
  gleichnamige Karten nebeneinander — das Bild, gegen das N23 gebaut wurde. Die
  Listenreihenfolge der echten Köpfe bleibt; ein Datenfehler sortiert die Sicht nicht um.
- **Live-Updates springen nicht unter dem Cursor**: neue Datensätze als **Sammelbanner**
  („12 neue Meldungen"), nicht eingeschoben (CLS ≤ 0,1; WCAG 3.2.5). Alarmbudget nach
  EEMUA 191/ISA-18.2: 1–2 je 10 min, ≤ 3 Eskalationsstufen. Kein Blinken auf lesbarem Text.

**Die Prüfliste Einsatztauglichkeit (15 Kriterien) wird an jede neue oder umgebaute Seite
angelegt** — ein Modul-Task ohne ausgefüllte Prüfliste gilt nicht als fertig; jede Zeile trägt ein
Verdikt (erfüllt / offen → Zielticket / nicht anwendbar), „nicht geprüft" ist keins.

Jede Zahl trägt dort Quelle und Abschnittsnummer, Gerechnetes ist als `[abgeleitet]` markiert.
Details, Herleitungen und die am Lage-Dashboard validierte Prüfliste:
`docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`.

## Frontend — Erfassungs-Norm (LFH-332/B4)

**Ein Erfassungsformular wird nicht mehr von Hand gebaut.** Träger ist
`components/Erfassung.tsx` — `ErfassungsModal` für Dialoge, `ErfassungsFormular` für
Inline-Formulare. Wer eine neue Erfassungsmaske schreibt oder eine bestehende ohnehin
anfasst, nimmt die Hülle; ein handgebautes `<Modal>` + `<Form>` daneben ist ein Fehler,
kein Stil.

Die Hülle trägt drei Zusicherungen, die der Bestand einzeln verletzt hat:

- **Der Absende-Knopf liegt im `<form>`, deshalb sendet Enter.** Das ist die eingebaute
  Formularübermittlung des Browsers, kein nachgebauter Tastaturbehandler — und genau
  deshalb bleibt Enter in einer `Input.TextArea` weiterhin ein Zeilenumbruch, ohne
  Sonderfall. Der Bestand sendete über `onOk={() => form.submit()}` am Modal, also mit
  dem Knopf **ausserhalb** des Formulars; dort war Enter tot (26 Stellen am 29.07.2026,
  Befund H69). Der Dialog rendert seine Fusszeile deshalb **selbst** (`footer={null}`)
  statt antds `footer` zu füllen.
  **Ein `Select` ist von Enter ausgenommen wie eine `Input.TextArea`** (gemessen 31.07.2026,
  LFH-378/B5l). `@rc-component/select` ruft in `BaseSelect/index.js:246` bei **jedem** Enter
  `event.preventDefault()`, solange der Modus nicht `combobox` ist — kommentiert mit „Do not
  submit form when type in the input" — und öffnet stattdessen die Liste. Die eingebaute
  Übermittlung des Browsers erreicht die Taste also nie; die Zusicherung greift für
  `Input`/`InputNumber`/`DatePicker`. Folge fürs **Testen**: eine Maske, deren einziges Feld ein
  `Select` ist, kann „Enter sendet ab" nicht belegen. Prüfbar ist die **Struktur, aus der die
  Zusicherung folgt** — kein `.ant-modal-footer` im Dialog **und** `knopf.closest('form')` ≠
  `null` (Muster: `components/Erfassung.test.tsx`, angewandt in `pages/uhs/MaterialTab.test.tsx`).
  Ein Ticket, das „Enter sendet ab" für eine Select-Maske als Akzeptanzkriterium schreibt,
  verlangt etwas, das die Bibliothek nicht hergibt — das ist kein Umsetzungsfehler.
- **Fokus im ersten Feld** beim Öffnen und nach jedem Serien-Speichern. Der Rücksprung
  braucht `requestAnimationFrame` — direkt gerufen verpufft er und der Fokus landet
  gemessen auf `<body>`.
- **Zurückgesetzt wird auf JEDEM Weg hinaus** — nach dem Erfassen, über den Abbrechen-Knopf,
  über das Schließkreuz, über Escape und über den Klick auf die Maske. Der Aufrufer ruft
  `resetFields()` nicht mehr selbst; ein zurückgebliebener Reset ist doppelt und verdeckt
  Fehler. Ausgenommen ist das Vorbelegen zum **Bearbeiten** (`setFieldsValue` beim Öffnen) —
  das ist kein Reset. **`destroyOnHidden` erledigt das nicht** (gemessen, LFH-332-Review): es
  hängt die Kinder ab, aber der Speicher von rc-field-form überlebt (`destroyForm(undefined)`
  lässt den Store stehen, `preserve` ist per Vorgabe an) und gewinnt beim nächsten Öffnen
  gegen `initialValues`. Wer einen Dialog baut, dessen Schließwege nicht durch das Formular
  laufen, muss dort selbst zurücksetzen — sonst trägt der Anlegen-Dialog die Werte des
  zuletzt bearbeiteten Datensatzes und legt ihn als Dublette an.
  **Der Fehler traf nur Masken mit `Form`-Speicher** (Klarstellung aus LFH-378, gemessen):
  antds `Modal` ruft `onCancel` für **alle vier** Auswege — Knopf, Schliesskreuz, Escape und
  Maskenklick. Ein handgebauter Dialog, der seinen Zustand in `useState` hält und dort leert,
  war also **nie** lückenhaft; die Lücke entsteht am Speicher von rc-field-form, der das
  Abhängen der Kinder überlebt. Wer ein `<Modal onOk>` auf die Hülle zieht, baut die Lücke
  damit **erst ein** und muss sie im selben Zug wieder schliessen — „der Bestand deckte nur
  zwei der vier Wege" ist für solche Masken eine Fehldiagnose.

**`onErfassen` muss bei Ablehnung ablehnen** — also `mutateAsync`, nicht `mutate`. Der
Bestand rief `resetFields()` synchron neben `mutate()`: ein 422 kostete den Wortlaut
trotz Fehler-Toast. Die Hülle lässt die Felder stehen, wenn die Zusage bricht.

**Serienmodus** (`serie`) für alles, was im Minutentakt erfasst wird — Aufnahme, BHP,
BTP. „Speichern und nächste" hält offen, leert, zählt und fokussiert zurück; Schliessen
bleibt ausdrückliche Nutzeraktion. **Wiederholfelder** (`uebernahme`) überleben ein
Serien-Speichern, sichtbar umschaltbar über „Werte behalten". Nur der Primär-Knopf ist
ein Übermittlungsknopf — „Speichern und nächste" ruft `form.submit()` von Hand, weil
Enter sonst vom **ersten** Übermittlungsknopf im Baum abhinge und damit von der
Anordnung im DOM. Die Marke, die den Serienlauf unterscheidet, wird in `onFinish`
verbraucht **und in `onFinishFailed` gelöscht**: scheitert die Prüfung, läuft `onFinish`
nie, und eine stehengebliebene Marke färbte das nächste reguläre Absenden still zum
Serienlauf — der Dialog bliebe offen, die Person drückte ein zweites Mal, der Datensatz
läge doppelt vor.

**„Werte behalten" ist eine Einstellung, keine Aktion** (Nachtrag 30.07.2026). Der
Schalter stand bis dahin in derselben Reihe wie die Knöpfe, wirkte aber nur auf
„Speichern und nächste" — der Primär-Knopf daneben leert und schliesst, mit Schalter
oder ohne. Ein Umschalter mitten in einer Knopfreihe, der nur einen der Knöpfe betrifft,
ist von der Bedienung aus nicht von „wirkungslos" zu unterscheiden; genau so wurde er
gemeldet. Deshalb: **eigene, sekundär gesetzte Zeile über der Knopfreihe**, Tooltip nennt
die Bedingung, und die **Vorgabe ist AUS** — ein Schalter, der von selbst ansteht, ist
benutzt worden, ohne gewählt worden zu sein. Beide Träger sind betroffen und wurden
gemeinsam umgestellt: `components/Erfassung.tsx` und die ETB-Schnellerfassung, deren
Zustand in `pages/EtbPage.tsx` liegt (`useState(false)`). Wer nur einen von beiden
umlegt, hat es halb getan.

**Strg/⌘ + Enter löst „Speichern und nächste" aus**, blankes Enter bleibt der
Primär-Knopf. Das Kürzel hängt am Wurzel-`div` der Hülle (unabhängig davon, ob antd
unbekannte Props ans native `form` durchreicht) und **greift nur bei `serie`** — ohne
den Knopf dürfte es keine Serien-Marke setzen, sonst gilt der Doppel-Datensatz-Fall aus
dem Absatz darüber. Der Riegel gegen doppeltes Absenden sitzt in `abschicken`
(`sendetRef`) und nicht am Knopf: ein `loading`-Knopf ignoriert Klicks, eine gehaltene
Taste erreicht ihn nie. Angezeigt wird das Kürzel `aria-hidden` im Knopf — der
zugängliche Name bleibt „Speichern und nächste", sonst müsste jede der ~10
Aufrufstellen ihre Knopf-Abfrage umschreiben.

**Ein Tastaturvertrag steht EINMAL, und nicht im Platzhalter** (Nacharbeit zu LFH-335,
08.08.2026). Der Platzhalter sagt, **was** in das Feld gehört; der Vertrag sagt, **was beim
Absenden passiert** — das ist die Steuerzeile (seit dem Neuentwurf die Hinweiszeile unter der
`Schnellerfassungszeile`, `etb/Schnellerfassung.tsx`; sie nennt nur, was es gibt — `# Koordinate`
des Entwurfs hat keinen Weg in den Eintrag und fehlt). Die ETB-Schnellerfassung trug beides doppelt:
`Enter sendet · Shift+Enter neue Zeile · Mehrzeiler mit Cmd/Strg+Enter senden` stand als
sichtbare Zeile zwischen Feld und Chip-Leiste **und** noch einmal als **Anfang** des
Platzhalters — der sichtbare Beginn des leeren Feldes war damit der Tastaturvertrag, „Inhalt
…" stand dahinter. Wer den Ort ändert, prüft die Gegenaussage mit: ein Test, der nur „der
Wortlaut ist im DOM" behauptet, bliebe grün, wenn der Vertrag dem Platzhalter wieder
vorangestellt würde.

**Ein-/Zweifeld-Kataloge nehmen `components/SchnellAnlegen.tsx`**, nicht die Hülle und
kein Modal: Eingabefeld plus Knopf in einer Zeile, Enter legt an, das Modal bleibt fürs
Bearbeiten. Es ist bewusst **kein** `<Form>` — eine Einsatzstelle kann in einem fremden
Formular landen, und ein verschachteltes Formular lädt beim Absenden die Seite neu.

**Feldbudget** (LFH-19, unverändert): Modal ≤ ~3, Schnellerfassung ≤ ~4 sichtbare Felder.
Überzähliges wird optional und eingeklappt, nicht gestrichen. Zwei gemessene Testfallen
dabei: ein `<Collapse>` rendert seinen Inhalt ohne `forceRender` erst beim Aufklappen —
dann ist die Zählung „≤ 4" trivial erfüllt und beweist nichts; mit `forceRender` stehen
die Felder im DOM und werden mitgezählt. Und eine „≤ 4"-Behauptung ohne die zweite
Hälfte (**Aufklappen → Zahl steigt**) ist nicht widerlegbar.

**Ein Pflichtfeld gehört nie hinter den Collapse** (LFH-343 · C8, Befund H49). Das
Auftragsformular kam von 14 sichtbaren Feldern auf vier — und der Empfänger, der einzige
zweite Pflichtwert neben dem Auftragstext, war der Grenzfall: er stand in **zwei** Feldern
nebeneinander (Ziele-`Select` + Funktions-Freitext), und beide zusammen sprengten das
Budget. Den Freitext einzuklappen ging nicht: **ohne gepflegte Abschnitte und Einheiten ist
er der einzige Weg**, überhaupt einen Empfänger zu setzen. Die Auflösung ist ein
`Select mode="tags"` — es nimmt die strukturierten Optionen UND freie Eingaben, getrennt
wird beim Absenden am Präfix (`abschnitt:<id>` / `einheit:<id>` gegen alles andere). Wer ein
Budget drückt, prüft zuerst, welche der Felder eine Ablehnung auslösen können; die dürfen
sichtbar bleiben, auch wenn das die bequemere Aufteilung kostet.
`richtung` ging trotz Steuerwirkung (sie blendet die Extern-Felder ein) mit hinein — `intern`
ist der Normalfall, und die Extern-Felder gehören dann **mit** in den Collapse, sonst stünden
sie sichtbar unter einem eingeklappten Auslöser.

**Was hier nicht hingehört:** Trefferflächen und Dichte. Die erbt jedes Element vom
`ConfigProvider` (Dichteachse aus LFH-329/B1); neues punktuelles `size` auf interaktiven
Elementen bleibt verboten. Und `test/utils.tsx` rendert ein **nacktes** `ConfigProvider`
ohne Theme — eine Höhen- oder Trefferflächen-Behauptung im Vitest misst antd-Vorgaben
und belegt nichts.

## Frontend — Deeplink-Muster (Route vs. Query-Param)

Modulübergreifende Deeplinks folgen einem festen Muster (LFH-25):

- **Item-Route** `/einsaetze/:id/<modul>/:<modul>Id` → das Modul hat eine eigene
  Vollseiten-Detailansicht (uhs, br, lagebericht, befehl, person, tier, schaden).
- **Query-Param-Selektion** `/einsaetze/:id/<modul>?<modul>=<id>` → das Zielobjekt wird in
  einer Listenseite selektiert/als Drawer geöffnet, weil (noch) keine Detail-Route existiert
  (`?einheit=`, `?fahrzeug=`, `?personal=`, `?abschnitt=`, `?meldung=`,
  `?auftrag=`, `?gefahrengebiet=`, ETB `?eintrag=`). `?neu=1` fokussiert die Schnellerfassung.

Faustregel: Vollseiten-Detail vorhanden → Item-Route, sonst Query-Param. Param-Namen sind
sprechend (`:<modul>Id`, Query-Key Modul-Singular) und nutzen die stabile DB-`id` (nicht die
laufende Anzeigennummer).

**Quelle der Wahrheit:** `frontend/src/routing/deeplinks.ts` (zentrale, unit-getestete
URL-Builder) — keine inline-Template-Literals für Einsatz-Pfade. `parseRouteId` dort
validiert Route-IDs (positive Ganzzahl, sonst Redirect auf die Liste).
Details: `docs/superpowers/specs/2026-06-23-deeplinks-vereinheitlichen-design.md`.

**Ein Filter gehört ebenfalls in die URL, und `mitQuery` kodiert seit LFH-342 seine Werte.**
Der ETB-Filter (`etbPfad(einsatzId, { q, typ, von, bis })` / `parseEtbFilter`) überlebt damit
einen Reload und ist teilbar. Drei Festlegungen daran:
- **Der Volltext ist Freitext** und darf `&`, `=` und Leerzeichen tragen — unkodiert machte
  ein `&` aus einem Suchbegriff zwei Parameter. Für alle Bestandswerte ist die Kodierung die
  Identität; die **einzige** sichtbare Ausnahme ist der Doppelpunkt in
  `?platzieren=schaden%3A10`, unschädlich, weil der Aufrufer über `searchParams.get()` liest.
  Ein Pin auf den rohen Pfad ist deshalb schwächer als der Round-Trip durch `URLSearchParams`.
- **Ein unbekannter Enum-Wert wird GANZ verworfen**, nicht halb übernommen (dieselbe Regel wie
  `parsePlatzierenAuftrag`). Die Prüfung läuft über einen **exhaustiven Record**
  (`Record<EtbTyp, true>`), nicht über ein Array: eine neue Variante bricht dann den Typcheck,
  statt zur Laufzeit still zu verschwinden.
- **Eine Zeitachse in der URL braucht die Umkehr, und die braucht einen eigenen Test**
  (`etb/filterZeit.ts` mit `filterZeit.test.ts`). Der Wire-String ist UTC **ohne**
  Zonenkennung; `dayjs(s)` läse ihn als Ortszeit. Der Fehlermodus ist eine STILLE Verschiebung
  um den Zonenversatz — kein roter Test, kein Fehlerbild, nur ein falscher Zeitraum in einer
  beweissichernden Unterlage. Der Test misst beidseits beider Sommerzeit-Grenzen **und** gegen
  den absoluten Zeitpunkt: ein Round-Trip, der beide Richtungen um denselben Betrag
  verschiebt, wäre sonst grün.
- **Wer den Filter in die URL hebt, braucht eine Weiche „eigene gegen fremde Änderung"**
  (gemessen an `pages/EtbPage.tsx`). Die unkontrollierte Filterleiste wird bei jeder FREMDEN
  Änderung neu aufgesetzt (Zurücksetzen, Deeplink), bei eigener nicht — sonst nähme der
  Remount dem Suchfeld bei jedem entprellten Wort den Fokus. Und der Remount muss in der Runde
  **nach** der Navigation laufen: react-router liefert die geräumte URL erst dann, ein
  `setState` neben dem `navigate` setzte die Leiste mit dem noch gültigen Filter neu auf und
  schriebe den Suchbegriff ins Feld zurück.
- **Entprellt wird in der Leiste, nicht in der Seite**: nur sie unterscheidet die Achsen — `q`
  wächst zeichenweise (~300 ms Frist), `typ`/`von`/`bis` springen und greifen sofort. Der
  sichtbare Text hängt **nicht** an der Frist, sonst sähe die Bedienung aus wie ein hängendes
  Feld. Testfalle dabei: `userEvent.type` kommt unter Fake-Timern nicht voran und endet im
  Test-Timeout statt in einer Aussage — Tippen läuft dort über `fireEvent.change`, und
  `findBy*` ist gesperrt (sein `waitFor` hängt an echten Timern).

## Frontend — Query-Key-Registry (LFH-122/307/312)

**Quelle der Wahrheit:** `frontend/src/api/queryKeys.ts` — seit LFH-307 mit zwei Hälften:

- **`einsatzKeys`** (Prefixe in `EINSATZ_KEYS`) für alles unter einer `einsatzId`. Hängt am
  SSE-Fan-out: `EINSATZ_STREAM_EVENTS` mappt Wire-Event → invalidierte Prefixe, und jeder
  managed Key ist **genau einmal** klassifiziert (live via Event **oder** `NICHT_LIVE_KEYS`).
- **`globalKeys`** (Prefixe in `GLOBAL_KEYS`) für alles darüber: Mandant/Organisation,
  Stammdaten-Kataloge, Instanz/Betrieb, externe Quellen. Bewusst **nicht** `ORG_KEYS` —
  `admin-karte`/`karte-config` sind instanzweit, `fachebene` bezeichnet Fremdquellen.

**Kein Inline-String-Array als Query-Key.** Erzwungen von `queryKeys.guard.test.ts` über einen
TS-AST-Scanner (`queryKeyScan.ts`), nicht mehr per Regex: mehrzeilige Literale sind sichtbar,
Kommentare erzeugen strukturell keinen Fehlalarm, der Quote-Stil ist egal, und ein bare-Literal,
das in einen lokalen Key-Helfer fließt (`inval('einsatz-uhs')`), fliegt ebenfalls auf. Der
Scanner trennt zwei Radien — **weit** (jedes Array-Literal, für die Denylist-Guards) und **eng**
(nur echte Query-Key-Kontexte, für den Allowlist-Guard); ohne diese Trennung wären Konstanten
wie `['KB','MB','GB','TB']` Fehlalarme. Was der Guard **nicht** sieht, steht als Liste in seinem
Kopfkommentar — die ist Teil des Vertrags, nicht Beiwerk.

**Wire-Strings sind eingefroren und byte-gepinnt** (`globalKeys.test.ts`). Grund: ein geänderter
Query-Key **bricht nichts** — er trifft still ein anderes Cache-Fach. Kein Fehler, kein roter
Test, kein auffälliger Request; die Komponente lädt neu und eine Invalidierung anderswo läuft
ins Leere. Deshalb prüft der Byte-Pin gegen **handgeschriebene Literale**, nie gegen
`GLOBAL_KEYS.x` — sonst prüfte er die Konstante gegen sich selbst.

**Sub-Key-Konvention:** getyptes String-Union-Token als zweites Element (`Dienstfilter`,
`AdminKarteBereich`), **kein** Filter-Objekt; der **argumentlose** Accessor ist zugleich der
Invalidierungs-Prefix (TanStack matcht per Prefix), Filter-Varianten hängen an. Deshalb zwei
Accessoren (`personal()` **und** `personalListe('alle')`) statt eines optionalen Arguments.

**Zwei gemessene Testfallen** in diesem Bereich:

- Cache-Tests **ohne** mounted Observer dürfen nicht `neuerQueryClient()` nutzen — dessen
  `gcTime: 0` räumt einen per `setQueryData` gesetzten, unbeobachteten Eintrag beim ersten
  `await` weg, und `isStale()`-Assertions werden trivial grün. `new QueryClient()` nehmen;
  Tests **mit** gerenderter Komponente dürfen `neuerQueryClient()`.
- Charakterisierungstests bauen ihre Keys als **Literale**, nicht über die Factory. Sonst sind
  beide Seiten aus derselben Quelle gebaut und matchen auch bei kaputter Factory (gemessen:
  `adminKarte()` verbogen → Literal-Variante rot, Accessor-Variante grün geblieben).

Die org/instanz/extern-Gliederung in `GLOBAL_KEYS` ist **Dokumentation**, nicht maschinell
erzwungen (gemessen: kein `qc.clear`/`removeQueries`/`resetQueries` im Produktivcode, also kein
Konsument). Kommt einer dazu, gehört sie in eine XOR-Partition nach dem Muster von
`NICHT_LIVE_KEYS` gehoben.

## Frontend — Lint-Disziplin

`pnpm lint` läuft mit `--max-warnings 0`: Warnings brechen das Gate genauso hart wie
Errors (LFH-168). Sie werden **behoben, nicht ignoriert** — und zwar an der Wurzel:

- `react-hooks/exhaustive-deps` strukturell lösen (z. B. Primitive statt Objekt in die
  Deps, `useMemo`/`useCallback` zur Identitäts-Stabilisierung), nicht die fehlende
  Dependency stumpf hineinzwingen, wenn das den Effekt ungewollt neu auslösen würde.
- `eslint-disable` nur als **begründete Ausnahme**, wenn der echte Fix nachweislich falsch
  wäre (z. B. eine Dependency, die den Effekt bewusst *nicht* neu triggern soll): dann
  zeilengenau (`eslint-disable-next-line <regel>`) **an der gemeldeten Stelle** — die
  exhaustive-deps-Warnung sitzt auf der Deps-Array-Zeile, nicht auf dem `useEffect(` — und
  **mit Kommentar, warum**. Keine pauschalen Datei-/Block-Disables, keine toten Direktiven
  (eslint meldet ungenutzte Disables selbst). Referenz: `LagekartePage` Blob-URL-Effekt (LFH-166).

## Qualitäts-Gates — ein Kommando (LFH-235/F17)

**Seit LFH-522 läuft das Gate auch in der CI** (`.github/workflows/ci.yml`) — und zwar,
indem der Workflow `scripts/check-all.sh` **unverändert** aufruft. Die Reihenfolge bleibt
damit: das Skript ist die Wahrheit, die CI ist nur ein zweiter Ort, an dem es läuft. Wer
einen Schritt ergänzt, ergänzt ihn im Skript; ein Workflow, der seine Schritte selbst
zusammenstellt, driftet vom lokalen Lauf ab, und dann prüft niemand mehr dasselbe.
Lokal bleibt es der Weg vor dem Merge:

```bash
./scripts/check-all.sh     # alle Gates, vor dem Merge
```

Reihenfolge (billig → teuer): `check-fmt.sh` (rustfmt **und** Prettier) → `pnpm lint` →
`check-typ-codegen.sh` (enthält `tsc`) → `cargo test --workspace` → Vitest →
`check-deps.sh` → `pnpm e2e` → `release-ruhefenster.test.sh` + `ki-notizen.test.mjs` →
`check-deps.test.sh`.

- **Schritt 1 prüft zwei Sprachen, nicht eine** (LFH-354). `prettier --check` liegt **in**
  `check-fmt.sh` statt in einem eigenen Schritt: es ist dieselbe Frage wie bei rustfmt
  („weicht die Formatierung von der Baseline ab?"), kostet Sekunden, und ein neuer Schritt
  hätte `check-all.sh` umnummeriert, ohne etwas anderes zu fragen. Prettier lief bis dahin
  in **keinem** Gate-Schritt, obwohl es seit jeher devDependency ist; die Folge war keine
  Warnung, sondern ein stiller Aufschlag auf fremde Diffs — beim LFH-352-Merge zwei
  Bestandsdateien mit rund 250 Zeilen Diff, token-genau gegengeprüft reine Formatierung.
  **Das Gate steht nur, weil der einmalige Sweep davor lag** (564 von 787 Dateien wichen ab)
  — ein rot geborenes Gate wird abgeschaltet statt befolgt.
  **Prettier ist dabei nicht idempotent, und das ist gemessen:** nach dem ersten `--write`
  wichen sechs Dateien weiterhin ab, weil eine Methodenkette wie
  `vi.fn().mockResolvedValue({…})` im zweiten Lauf anders umbricht als im ersten. Ein Gate
  prüft einen **Fixpunkt**; wer nach einem einzelnen `--write` noch rot ist, lässt es ein
  zweites Mal laufen, statt die Datei von Hand zu biegen.
  **Was der Sweep nicht anfassen durfte, steht in `frontend/.prettierignore`** — und die drei
  generierten Dateien dort sind kein Geschmack: `openapi.json` und `types.generated.ts`
  entstehen in `check-typ-codegen.sh` (Schritte 1+2) und werden dort in Schritt 3 per
  `git diff --exit-code` geprüft. Formatiert committet, schriebe der Generator sie bei jedem
  Lauf unformatiert zurück — das Typ-Gate wäre dauerhaft rot, während das Formatier-Gate das
  Gegenteil verlangte. Zwei Gates, die einander brechen. Wer eine Datei ergänzt, begründet
  sie dort; ein Einzelfall-Fix an der Datei selbst ist der falsche Ort.
  **Eine `.git-blame-ignore-revs` braucht so ein Sweep NICHT — und das ist gemessen, nicht
  angenommen.** Die naheliegende Sorge („564 Dateien Formatierung entwerten `git blame`
  fürs ganze Frontend") trifft nicht zu: über 80 Dateien mit zusammen 14 100 Zeilen
  beansprucht der Sweep-Commit im Blame genau **18 Zeilen**, und `blame.ignoreRevsFile`
  ändert daran **nichts** — es sind die Zeilen, die Prettier durch einen Umbruch neu
  erzeugt hat und die deshalb gar keinen Vorgänger haben, auf den git sie umhängen könnte.
  Den Rest ordnet gits eigene Verschiebungserkennung von selbst dem Ursprungs-Commit zu.
  Eine Ignore-Datei wäre hier also ein Artefakt ohne Wirkung, das eine Zusicherung behauptet,
  die es nicht einlöst. Wer den nächsten Sweep fährt, misst nach, statt die Datei vorsorglich
  anzulegen.

- **Env-Hygiene ist Teil des Gates.** `scripts/lib/dev-env.sh` räumt alle
  `LIFELINE_*`/`KS_*`/`AWS_*`-Variablen aus dem Testlauf. Nicht durch eine handgepflegte
  `env -u`-Liste ersetzen — genau deren Drift (3 Einträge gegen 13 gesetzte Variablen)
  hat die Suite unbemerkt rot gefärbt. Wo möglich gehört die Isolation **in den Test**
  (`config::tests::parse_hermetisch`, `karte::KarteConfig`), nicht in den Wrapper: ein
  Gate, das nur durch seinen eigenen Wrapper grün ist, verfehlt den Zweck.
- **Optionaler pre-push-Hook** (nur die schnellen Gates, ~1 min):
  `git config core.hooksPath .githooks`. Die vollen Suiten bleiben bewusst draußen —
  ein Hook, der jeden Push minutenlang blockiert, wird per `--no-verify` umgangen.
- **Bewusst nicht im Gate:** `cargo clippy -D warnings` — der Bestand hat ~27 Warnungen,
  ein rot geborenes Gate wird abgeschaltet statt befolgt.
- **e2e läuft als Schritt 7 mit** (LFH-309): die Playwright-Suite ist selbsttragend —
  sie startet Backend und Vite selbst auf freien Ports, mit Temp-DB je Lauf, und stört
  einen parallel laufenden Dev-Stack auf 8080/5173 nicht. **`pnpm e2e` braucht kein
  separat gestartetes Backend mehr**; der alte Hinweis „Backend muss separat laufen
  (siehe Step 5)" verwies auf einen Schritt, den es im Repo nie gab, und ist weg.
  Bauen kann die Suite das Binary nicht, deshalb fährt Schritt 7 nur, wenn
  das Debug-Binary `lifeline-hub` im Cargo-target-Verzeichnis existiert (Pfad kommt aus
  `cargo metadata`, weil ein globales `build.target-dir` es verschieben kann), und
  überspringt sonst mit lautem Hinweis statt
  zu brechen. Praktisch greift dieser Guard im Sammel-Gate nie, weil `cargo test
  --workspace` (Schritt 4) das bin-Target ohnehin mitbaut — e2e ist hier also faktisch
  immer dabei (+~30 s). Der Guard schützt die Fälle daneben: verkürzte Läufe, einzeln
  von Hand aufgerufene Schritte.
  **Schritt 7 baut seit LFH-356 auch den Prod-Bundle** (`prod_bundle_bereitstellen`), und zwar
  nur bei Bedarf: fehlt `frontend/dist/sw.js` oder ist eine Quelle neuer, läuft `pnpm build`
  (~26 s lokal, ~1 min auf 2 vCPU). Grund ist `e2e/lagekarte-offline-precache.spec.ts`: einen
  **Service Worker gibt es nur im Build** — `vite-plugin-pwa` ist ohne `devOptions` im
  Dev-Server gar nicht aktiv, und sein Dev-SW wäre kein Precache der gehashten Assets, also
  eine Attrappe. Ohne den Build überspringt sich der Spec laut, und ein Nachweis, der nie
  läuft, ist keiner. **Ausgeliefert wird der Bundle vom e2e-Backend**, nicht von
  `vite preview`: `src/static_files.rs` liest `frontend/dist` im Debug-Build zur Laufzeit vom
  Dateisystem, das Backend läuft ohnehin, und damit ist die Seite same-origin mit der API —
  kein zweiter Webserver, kein Preview-Proxy. In der geteilten CI baut jeder der vier Shards
  (welcher den Spec fährt, steht vorher nicht fest); sie laufen parallel, der Aufschlag ist
  einmal ~1 min. Bewusst **kein** dist-Artefakt zwischen den Jobs — das wäre ein Schritt, den
  nur die CI kennt, und damit die Drift, gegen die LFH-522 den Workflow auf dieses Skript
  zurückgeführt hat.
- **Kein `| tail` um Gate-Kommandos** — das maskiert den Exit-Code, und eine rote Suite
  sieht dann grün aus.
- **Ein Release entsteht nicht mehr je Merge, sondern je Arbeitsschub.** Der Release-Job
  hängt weiter am grünen Push-Gate, tritt davor aber selbst zurück, wenn auf dem Kanal
  schon ein neuerer Commit liegt — dessen Lauf macht das eine Sammel-Release, und die
  Notizen enthalten die übersprungenen Commits mit. Dazu ein Ruhefenster von 15 Minuten
  auf den jüngsten Commit für den Fall, dass das Gate schneller ist als der Abstand
  zwischen zwei Merges. Träger ist `scripts/release-ruhefenster.sh` (Aufruf in
  `release.yml`, Begründung im Dateikopf), Schritt 8 des Gates ist sein Selbsttest.
  **Ein übersprungener Release-Job ist der Normalfall, kein Fehlerbild.**
  **`chore(release):`-Commits zählen dabei nicht als „neuer Commit"** — sie sind der
  Versions-Commit von semantic-release und danach HEAD des Kanals; ein naiver Vergleich
  „HEAD == mein Commit?" liesse ab dem ersten Release JEDEN Lauf zurücktreten, und es
  entstünde nie wieder eine Version. Dasselbe gilt für den Zeitstempel, an dem das
  Ruhefenster rechnet: zwei Stellen, zwei Tests (Fall 3 und 6 im Selbsttest).
  Wer das Fenster vergrössert, hebt den Job-Timeout in `release.yml` mit und bedenkt, dass
  Push-Läufe desselben Kanals in EINER Nebenläufigkeitsgruppe stehen — ein wartender
  Release hält den nächsten Gate-Lauf auf.
- **Die Release-Notizen schreibt Claude, hinter einer Hülle** (`scripts/release/ki-notizen.mjs`,
  übernommen aus einsatzzeichen). Das nackte Plugin `semantic-release-claude-changelog` trägt
  drei stille Fehlerbilder, die die Hülle schliesst: semantic-release erzeugt die Notizen
  nach dem Versions-Commit **ein zweites Mal** (`prepare.getNextInput`), das Modell formuliert
  dabei neu — in einsatzzeichen weichen CHANGELOG und GitHub-Release von v1.5.0 gemessen
  voneinander ab; deshalb wird das Ergebnis je Version gemerkt. Ein Fehlschlag kommt als
  Text zurück („No release notes generated due to an error.") und stünde für immer im
  CHANGELOG; deshalb fällt jeder unbrauchbare Text — und ein fehlendes Secret
  `ANTHROPIC_API_KEY` — auf die **konventionellen Notizen** zurück, mit Warnung, ohne roten
  Lauf. Claude bekommt **genau einen Zug** (`maxTurns: 1`): das Plugin startet einen Agenten
  mit Lesewerkzeugen im Checkout, und dort liegt der App-Token (`persist-credentials: true`) —
  eine präparierte Commit-Nachricht hätte ihn sonst in die öffentlichen Notizen holen
  können. Und das Plugin kürzt still auf 100 Commits; die Hülle gibt alle, bei Übergrösse nur
  die Kopfzeilen, sonst konventionell. Die Versionskopfzeile (Vergleichslink, Datum) kommt
  weiter aus dem konventionellen Generator, damit das CHANGELOG-Format gleich bleibt.
  Die Vorlage (`KI_PROMPT`) steht in `release.config.mjs`.

`scripts/check-deps.sh` (LFH-253/G01) prüft Abhängigkeiten gegen RUSTSEC/GHSA. Fehlt
`cargo-audit`, warnt es laut und exitet 0 statt zu brechen. Bekannte, bewertete Advisories
stehen mit Begründung in `.cargo/audit.toml` — was dort **nicht** steht, bricht den Build.

**Die beiden Hälften haben BEIDE einen benannten Ort, und es sind nicht dieselben**
(LFH-354). Rust: `.cargo/audit.toml`, eine Ignorier-Liste mit Begründung je Eintrag.
Frontend: der **`overrides`-Block in `frontend/pnpm-workspace.yaml`** — dort steht die
erzwungene sichere Mindestversion samt Kette und Begründung, und **eine Ignorier-Liste gibt
es bewusst nicht**. Der Unterschied ist keine Nachlässigkeit, sondern die Lage: bei npm lässt
sich eine transitive Version erzwingen, bei Cargo nicht. Genau deshalb braucht die Rust-Seite
ein Werkzeug zum Stummschalten und die Frontend-Seite keines — **jeder `high`-Fund bricht und
wird behoben**, `moderate`/`low` melden nur (`--audit-level=high`, sonst wäre das Gate durch
Dev-Tooling-Rauschen dauerrot).
**Ein leerer `auditConfig.ignoreGhsas`-Block „für später" gehört NICHT angelegt**, obwohl
pnpm ihn mitbrächte: eine Ausnahmeliste ohne Eintrag sichert nichts zu — dieselbe Linie wie
„ein Eintrag ohne Verstoß gilt selbst als Verstoß" bei der Dichte-Schuldmenge. Wer den ersten
echten Fall hat — ein `high`-Advisory, das WEDER über einen Override noch über ein Upgrade
erreichbar ist —, führt den Block **mit** diesem Eintrag ein, nach dem Muster von
`.cargo/audit.toml`: warum kein Upgrade möglich ist, warum das Risiko in diesem Code nicht
trägt, und woran man merkt, dass sich das ändert.
**Bei einem Override werden BEIDE Grenzen gepflegt**, der Bereich und die Zielversion: dass
ein Advisory sich unter einem festgenagelten Ziel wegbewegt und das Gate ohne eine Zeile
Codeänderung rot wird, ist im Bestand dreimal passiert (`nanoid`, `fast-uri`, `js-yaml`).

**Das Advisory-Gate prüft das Lockfile, nicht den lokalen Installationszustand**
(LFH-316). Der Befund war zwei Arbeitsbäume desselben Commits mit zwei Antworten — der
lang gewachsene Haupt-Checkout gab Entwarnung, der frische Worktree meldete zwei Funde.
Ein falsch-grünes Sicherheits-Gate ist schlechter als gar keines: es erzeugt begründetes
Vertrauen. Der Frontend-Audit läuft deshalb in einem Wegwerf-Verzeichnis **ausserhalb des
Arbeitsbaums**, in dem ausschliesslich `package.json`, `pnpm-lock.yaml` und
`pnpm-workspace.yaml` liegen; `node_modules` kann das Ergebnis nicht mehr erreichen.
**Die Ursache aus dem Ticket ist dabei korrigiert, nicht übernommen** — gemessen an
pnpm 11.10.0 liest `pnpm audit` die *wanted lockfile*
(`plugin-commands-audit/lib/audit.js` ruft `readWantedLockfile`), und ein nachgebautes
stale `node_modules` ändert die Antwort heute **nicht**. Genau darauf ruhte die
Zusicherung aber, und nichts pinnte sie: die Hilfe desselben Aufrufs sagt „Checks for
known security issues with the **installed** packages", und `frontend/mise.toml` führt
pnpm als `latest`. Eine Eigenschaft, die man sich von einer Bibliotheksversion leiht, ist
keine Zusicherung — der Umbau stellt sie strukturell her.
**Zwei Dinge gehören dazu, sonst kippt das falsche Grün nur die Seite:**
`pnpm-workspace.yaml` **muss** mitkopiert werden (dort stehen seit pnpm 10 die Overrides —
ohne sie liefe das Gate falsch ROT, und ein grundlos rotes Gate wird abgeschaltet), und
die Kopierliste trägt einen **Riegel gegen ihre eigene Veralterung**: bekommt das Frontend
echte Workspace-Pakete, fehlen deren `package.json` im Wegwerf-Verzeichnis und der
Audit-Baum wäre still unvollständig — das Skript bricht deshalb laut ab, sobald das
Lockfile einen Importer neben `.` führt. Der **Node-Pin** (`node@26.7.0`) steht jetzt auch
hier, nicht nur in `check-all.sh`: er ist dieselbe Hälfte der Frage, auf welcher Maschine
das Gate dasselbe sagt.
**Schritt 9 ist der Selbsttest dazu** (`scripts/check-deps.test.sh`, im `schnell`-Bündel,
ohne Netz, ~1 s). Er misst **nicht**, was der Audit findet — das hängt an der
Advisory-Datenbank und ändert sich über Nacht —, sondern worauf er schaut und ob sein
Urteil durchschlägt. Die tragenden Aussagen sind die **negativen**: „der Audit sieht
`node_modules` NICHT" und „ein Fund bricht das Gate". „Er sieht das Lockfile" allein wäre
auch dann grün, wenn er nebenher den halben Arbeitsbaum sähe. Per Mutationsprobe belegt:
der Audit zurück auf `-C "$FE"` färbt drei Aussagen rot, der entfernte Importer-Riegel
zwei, die fehlende `pnpm-workspace.yaml` eine.

## Backend↔Frontend — Typ-Codegen (LFH-120)

Die Frontend-Response-Typen werden **aus dem Rust-Backend generiert**, nicht mehr von Hand
gepflegt. Wahrheitsquelle: die `#[derive(ToSchema)]`-Response-Structs + Domänen-Enums →
`src/api_doc.rs` (utoipa `ApiDoc`) → `frontend/src/api/openapi.json` → `openapi-typescript`
→ `frontend/src/api/types.generated.ts`. `frontend/src/api/types.ts` ist nur noch ein
**Re-Export-Barrel** über die generierten Schemas (Namens-Mapping Rust `XxxAnzeige` ↔ FE `Xxx`).

- **Nach einer Backend-Typänderung** (Struct-/Enum-/Feld-Änderung an einem Response-DTO):
  `scripts/check-typ-codegen.sh` laufen lassen und die regenerierten `openapi.json` +
  `types.generated.ts` **mitcommitten**. Das Skript ist das Drift-Gate: es emittiert
  die Spec, regeneriert die TS, bricht per `git diff --exit-code`, wenn etwas nicht committet
  ist, und fährt `tsc`. Ein Feld-Rename bricht damit Build/Test statt still zur Laufzeit.
- **Enum-Werte:** Domänen-Enums tragen wire-korrektes `#[serde(rename…)]`; `String`-Felder,
  die eine Union tragen, bekommen `#[schema(value_type = Enum)]` (bei `Option<String>`:
  `value_type = Option<Enum>` — sonst verliert utoipa die Nullability).
- **Enum-Wire-Kontrakt ist erzwungen, nicht behauptet (LFH-312/AP5):** `tests/enum_wire_kontrakt.rs`
  pinnt jedes in `src/api_doc.rs` registrierte Enum über `enum_wire_as_str!` (Wire == `as_str()`)
  bzw. `enum_wire!` (Orphans ohne `as_str()`, Literal-Pin). Beide Makros erzeugen einen
  **exhaustiven `match`** — eine neue Variante ohne Nachtrag bricht damit den **Build** (E0004),
  nicht bloß einen Assert. Ein Inventar-Guard verlangt zusätzlich, dass jedes *neu registrierte*
  Enum überhaupt einen Block bekommt. Zwei Konsequenzen fürs Anfassen dieser Datei: die
  Invokationen tragen **voll qualifizierte Pfade** (der Guard schneidet nur die
  Makro-Argumentbereiche — ein `use`-Block würde ihn blind machen, deshalb gibt es keinen), und
  bei `LiveEvent::ALLE` stehen `contains`-Prüfung **und** Längenvergleich nebeneinander: `contains`
  liefert die benannte Diagnose, aber nur die Länge fängt eine *Dublette* in `ALLE`.
- **Noch handgepflegt** (bewusst, FE-lokal in `types.ts`): Request-/Input-DTOs (`NeuerX`/`PatchX`,
  PATCH-null-vs-absent-Semantik) und die 2 `Record<>`-Maps. Der Pfad-/Operations-Contract
  (`#[utoipa::path]`) ist additiv nachrüstbar, in v1 nicht enthalten.
- **Optionalität ehrlich machen (Norm ab LFH-265):** `Option<T>`-Felder von Response-DTOs
  bekommen `#[serde(skip_serializing_if = "Option::is_none")]` — sonst schickt das Backend
  `feld: null`, während der generierte Typ `feld?: T | null` sagt, und der Client kann `absent`
  und `null` nicht auseinanderhalten. Bei Feldern, die **kein** `Option<T>` sind, aber
  `#[serde(default)]` tragen, ist `skip_serializing_if` **falsch** (es würde den Default-Wert
  weglassen = echte Wire-Verschlechterung); dort macht `#[schema(required)]` die Spec ehrlich
  (gemessen: das Feld landet in `required`). **Norm ja, Sweep nein** — verbindlich für neue und
  ohnehin angefasste Felder, kein Bestands-Sweep.
  **Testfalle:** `assert_eq!(v["feld"], Value::Null)` unterscheidet einen FEHLENDEN Key nicht
  von `null` — serde_json liefert beim Index-Zugriff auf ein Object in beiden Fällen `Null`.
  Presence wird deshalb per `v.as_object().unwrap().contains_key("feld")` geprüft; sonst bleibt
  der Test nach der Umstellung grün und belegt nichts (`tests/ort_vorschau.rs` ist die Referenz).

## Backend — Migrationsvergabe (LFH-658)

**Die Migrationsnummer bleibt fortlaufend** (`migrations/0001_…` ff.). Neu ist die Regel
**„anhängen, nicht einschieben“**: Eine Migration, die ein Branch neu mitbringt, trägt eine
Nummer, die **größer als jede Nummer auf dem aktuellen Ziel-Branch** ist. Eine freie Nummer
genügt nicht. Eine Migration, die es an der Abzweigung schon gab, wird weder geändert noch
umbenannt oder gelöscht.

- **Prüfen:** `scripts/check-migrationen.sh` (Vorgabe: gegen `origin/alpha`, also vorher
  `git fetch`). Bei einem Verstoß nennt das Skript die Datei und die nächste freie Nummer.
- **Umlegen:** `scripts/check-migrationen.sh --umnummerieren`. Es benennt die eigenen neuen
  Migrationen um und ersetzt jeden Verweis auf den alten Dateinamen, also `include_str!` in
  Tests und Pfade in der Doku. Es committet nicht. Eine alte Nummer in Bezeichnern, etwa
  `migration_0117_…` als Testname, listet es nur auf.
- **Durchgesetzt** wird die Regel über `.github/workflows/migrationen.yml`. Der Workflow setzt
  den Commit-Status `Migrationsnummern` beim Öffnen und Aktualisieren eines PRs und bewertet
  **bei jedem Push auf `alpha`/`beta`/`main` alle offenen PRs gegen diesen Branch neu**. Der
  Status ist ein Required Check im Ruleset 17017911. Mergt PR A, wird PR B rot, ohne sich
  selbst zu bewegen. `db::tests::migrationsnummern_sind_eindeutig` bleibt das Netz auf dem
  eigenen Stand. Lokal läuft die Prüfung als Schritt 10 von `check-all.sh` und ist dort nur
  so frisch wie der letzte `fetch`.

**Warum die Nummer verschieden sein muss und dazu höher:** sqlx 0.9 spielt eine kleinere,
noch nicht eingespielte Version **still** nach. Es gibt keine Prüfung „applied out of order“,
festgehalten in `db::tests::sqlx_spielt_eingeschobene_kleinere_version_still_nach`. Eine DB,
die `0118` schon hat, nimmt ein später gemergtes `0117` ohne Meldung mit, eine frische DB
spielt beide in Nummernfolge. Bei den Tabellen-Rebuilds dieses Projekts (0082, 0089, 0112)
entstehen daraus verschiedene Schemata, ohne dass irgendetwas rot wird.

**Verworfen, mit Grund** (Einzelheiten in
`openspec/changes/lfh-658-migrationsnummern-vor-dem-merge/design.md`):
- **Zeitstempel-Versionen** schließen Kollisionen aus, die Reihenfolge aber nicht. Aus einer
  lauten Kollision würde ein stiller Einschub, und die Prüfung gegen den Ziel-Branch bräuchte
  es trotzdem. Ein späterer Wechsel ginge ohne Bruch: Versionen sind `i64`, ein Zeitstempel
  sortiert hinter `0116`.
- **Nummer erst beim Merge vergeben:** Es gibt keinen Haken vor dem GitHub-Merge, der ohne
  Bot-Push umbenennt. Ein Bot-Push löst die volle CI erneut aus. Platzhalternamen brechen
  zudem `include_str!`.
- **„Branches must be up to date“** kostet nach jedem Merge einen vollen CI-Lauf für jeden
  offenen PR, auch ohne Migration. Eine **Merge Queue** bietet GitHub nur für Repositories
  von Organisationen an.

**Bekannte Grenze:** Zwischen dem Merge von A und dem Ende des Push-Laufs, etwa eine Minute,
steht B noch grün. PRs aus Forks bekommen ihren Status erst mit dem nächsten Push auf den
Ziel-Branch, weil der Token dort nicht schreiben darf.

**Migrationen entstehen nur über `alpha`.** Die Regel kennt keine Kanal-Ausnahme. Bringt ein
Hotfix direkt auf `beta`/`main` eine `0117` mit, während `alpha` schon bis `0120` reicht,
ist der Rückweg nach `alpha` rot. Die nächste Freigabe `alpha → main` ist es ebenfalls, und
auflösen ließe es sich nur, indem man eine eingespielte Migration umbenennt. Ein Hotfix mit
Schemaänderung geht deshalb über `alpha`. Freigaben laufen als Merge-Commit, nicht als
Squash: Nach einem Squash bleibt die Abzweigung alt, und jede frühere Migration erschiene
wieder als eingeschoben.

## Backend — ClamAV-Upload-Scan (Default-AN, LFH-114/LFH-224)

Der clamd-Virenscan der Uploads (`src/anhang/mod.rs`) hängt am Cargo-Feature `clamav`, das
seit LFH-224 **Default-AN** ist: `clamav-client` ist ein reiner Rust-INSTREAM-Client (nur
`tokio`, kein FFI/keine Signatur-DB im Prozess) → das Binary bleibt **single-binary**. Der
echte Scanner `clamd` ist unvermeidlich ein **separater Laufzeit-Daemon** (Sidecar/systemd/apt);
ohne `--clamav-addr` ist der Seam ein **No-op** → kein zweiter Prozess nötig, kein Compose.
Verhalten: keine Adresse → No-op; Adresse + erreichbarer clamd → echter Scan (Fund → 422);
Adresse + clamd weg/Timeout → **fail-closed 503** (Default) bzw. `--clamav-fail-open` → durch.

**Folge fürs Testen:** Der Scan-Pfad läuft jetzt im **Default-`cargo test`** (rottet nicht mehr
still). Der reine No-op-/Fehlkonfig-Stub (`#[cfg(not(feature = "clamav"))]`) läuft nur unter
**`cargo test --no-default-features`** — wer `src/anhang/mod.rs`/`clamd_scan` anfasst, sollte
beide fahren. Der Scan-Wiring-Test (`tests/karte_hintergrundbild_scan.rs`) übt gegen
`127.0.0.1:1` (ECONNREFUSED) in BEIDEN Builds den fail-closed-503-Pfad. Die CI fährt nur
den Default-Build; `--no-default-features` bleibt Handarbeit an dieser Datei.

**Der `unix:`-Zweig ist plattformgetrennt** (LFH-522): `clamav_client::tokio::Socket` ist in
der Crate mit `#[cfg(unix)]` gated, weshalb `clamd_verbinden` in zwei cfg-Varianten vorliegt.
Ohne diese Trennung ist das gesamte Crate für `x86_64-pc-windows-gnu` nicht übersetzbar
(E0422) — gemessen, nicht vermutet. Unter Windows bleibt TCP; eine dort konfigurierte
`unix:`-Adresse endet als `ScannerNichtErreichbar` mit lauter Warnung, also in derselben
fail-open/closed-Entscheidung wie jeder andere Ausfall.

## Backend — Statuscode-Konvention (LFH-267/F22)

Die in `src/error.rs` dokumentierte Konvention ist **verbindlich**. Sie ist bewusst **am
Bestand ausgerichtet** (F22 Teil B): wo Doku und Code auseinanderliefen, wurde die Doku
angepasst, statt ~59 Handler umzuschreiben, die niemand als falsch empfand.

| Code | `AppError`-Variante | Wann |
|---|---|---|
| **400** | `Validation` | **Das Feld für sich** ist unbrauchbar: kaputtes JSON, falscher Feldtyp, **unbekannter Enum-Wert** (Body *und* Query-Filter), strukturell fehlendes Pflichtfeld, **vorhandenes aber leeres Pflichtfeld** |
| **422** | `UnprocessableEntity` | Jedes Feld für sich ist in Ordnung, aber **der Zusammenhang** verbietet die Aktion: XOR-verletzende Feld-Kombination, **ungültiger Status-Übergang**, Zustandsverletzung |
| **409** | `Conflict` | **Nebenläufigkeit** oder **Lebenszyklus**: CAS-/Sperrkonflikt, storniertes Objekt |

Trennlinie 400 ↔ 422: **400 bewertet das Feld isoliert** — fehlt es, ist es vom falschen Typ,
trägt es einen unbekannten Enum-Wert oder ist es leer, dann ist die Eingabe schon für sich
genommen unbrauchbar. **422 bewertet erst den Zusammenhang** — die *Kombination* mehrerer
Felder oder der *Zustand des Objekts* verbietet die Aktion.

Ein leeres Pflichtfeld ist deshalb **400**, nicht 422: es scheitert am Feld, nicht am
Zusammenhang. Das ist auch, was die klare Mehrheit im Bestand tut (`AppError::Validation` mit
„… darf nicht leer sein" in `einsatz.rs`, `benutzer.rs`, `meldung.rs`, `nachforderung.rs`,
`etb.rs`, `karte.rs`, `sprechgruppe.rs`, `erinnerung.rs` u. a.). Das Frontend unterscheidet
400 und 422 nicht (keine Status-400-Prüfung), der Unterschied ist reine API-Hygiene.

Referenz-Testpaare für die Linie:

- **400 auf beiden Wegen** — `tests/freies_zeichen.rs`: `fehlendes_grundzeichen_ist_400`
  (scheitert am Extractor, `String` ohne `#[serde(default)]`) und `leeres_grundzeichen_ist_400`
  (scheitert an der Handler-Validierung).
- **422 aus dem Zusammenhang** — `tests/einsatz_schaden.rs`: `geschaedigt_beide_felder_ist_422`
  (Feld-Kombination) und `uebergeben_aus_abgeschlossen_ist_422` (Status-Übergang).

**409 hat ZWEI Quellen, die nicht verschmelzen dürfen** (Ursache des LFH-299/300-Fehlers):

1. **CAS / optimistisches Lock** — `basis_geaendert_at` passt nicht (`schaden/repo.rs`,
   `tier/repo.rs`). Das Frontend bietet hier einen Überschreiben-Dialog an.
2. **Lebenszyklus / Storno** — das Objekt ist storniert o. ä. (`einsatz_schaden.rs`).
   Ein Überschreiben-Dialog ist hier **sinnlos** und führt in eine Endlosschleife.

Die Unterscheidung ist im Frontend heute nur **Heuristik**, kein Vertrag: `istKonflikt`
(`frontend/src/api/client.ts`) prüft bloß `status === 409`; getrennt wird erst über den
`!v.overwrite`-Zweig in `SchaedenDetailPage.tsx` / `TiereDetailPage.tsx`. **Wer einen neuen
409 in einer Route mit CAS-Dialog einführt, muss diesen Zweig mitziehen** — sonst läuft die
Seite wieder in „Überschreiben?"-Schleifen. Ein maschinenlesbarer Fehler-Code im `{error}`-Body
wäre die saubere Lösung und ist bewusst vertagt.

**Die Baseline wird beim ÖFFNEN der Maske eingefroren, nicht beim Absenden gelesen**
(LFH-303). Träger ist `components/useEditSitzung.ts`; `PersonenDetailPage`,
`TiereDetailPage` und `SchaedenDetailPage` — die drei Seiten mit CAS-Dialog — konsumieren
es. Gelesen aus den Live-Query-Daten hebelte `basis: t.geaendert_at` das Lock aus, das es
setzen sollte: der QueryClient fährt `staleTime: 10_000` und lässt TanStacks Vorgaben
`refetchOnWindowFocus`/`refetchOnReconnect` (beide `true`) stehen. Wer während offener
Maske das Fenster wechselt und nach mehr als zehn Sekunden zurückkommt, hat den **fremden,
neueren** Stand im Cache; der ging als Baseline raus, der Server verglich ihn mit sich
selbst, die Prüfung passte — und die fremde Änderung war still überschrieben. Also genau
der Lost-Update, gegen den F10 gebaut wurde, nur mit Fensterwechsel als Auslöser.
**`refetchOnWindowFocus` abzuschalten wäre die kleinere Lösung gewesen**: der
Fensterwechsel ist nur einer der Auslöser ohne Nutzeranlass — ein Netzwechsel
(`refetchOnReconnect`) und jede `invalidateQueries` auf den Detail-Key tun dasselbe. Ein
Flag schlösse einen Auslöser, der eingefrorene Stand schließt die Klasse.
**Der Riegel gegen erneutes Driften ist ein Typ, kein Scanner**: `basis` ist eine
`CasBasis` (gebrandeter `string`), und die entsteht ausschließlich in `useEditSitzung`. Ein
`basis: t.geaendert_at` bricht damit den **Typcheck** — per Mutationsprobe belegt
(`TS2322: Type 'string' is not assignable to type 'CasBasis'`). Ein Regex-Guard hätte die
Schreibweise `const b = t.geaendert_at` nicht gesehen. Nach `string` bleibt `CasBasis`
zuweisbar, die API-Funktionen und `patchBody` ändern sich also nicht.
**Zwei gemessene Fallen daran:** `starte` nimmt den **Datensatz**, nicht den Zeitstempel —
so ist eine fremde Zeichenkette als Basis nicht bloß verboten, sondern nicht formulierbar;
und es befüllt das Formular gleich mit, weil nur ein gemeinsamer Aufruf belegt, dass Werte
und Basis aus einem Snapshot stammen. Ein Test dafür braucht ein **gemountetes**
`<Form form={form}>`: eine `Form.useForm()`-Instanz ohne angehängtes Formularelement
verwirft `setFieldsValue` still (rc-field-form warnt nur auf der Konsole), die Zusicherung
„das Formular ist befüllt" wäre dort nicht widerlegbar, weil sie immer scheiterte.
**`UhsDetailPage` ist nicht betroffen** — sie hat gar keine Bearbeiten-Maske; der einzige
UHS-PATCH ist das lat/lon-Setzen der Lagekarte und schreibt bewusst ohne Lock. Bekommt die
UHS eine Maske, nimmt sie dasselbe Primitiv.

**Die Konvention gilt in jeder Schicht**, nicht nur in `src/routes/`. Die ~89
`AppError::Validation`-Stellen in `repo`/`parse`/`config` wurden bewusst **nicht** auditiert
(kein Sweep über den Bestand) — die Regel ist verbindlich für Neues und für Stellen, die man
ohnehin anfasst.

**Angleichung erledigt (LFH-305).** Die früher hier gelisteten Abweichungen sind aufgelöst:
unbekannte Enum-Werte liefern jetzt 400 in `einsatz_schaden.rs` (Query-Filter, Anlegen,
PATCH), `gefahr.rs`, `lage_zone.rs`, `befehl.rs`, `lagebericht.rs` und `organisation.rs`;
die Pflichtfeld-Ausreißer in `einsatz_schaden.rs` (Anlegen, PATCH, Übergabe-Adressat,
Abschlussgrund) sind entwirrt und unterscheiden „fehlt" / „ist leer" / „ist unbekannt" jetzt
per eigener Meldung. Wer hier etwas zurückdreht, dreht eine getestete Entscheidung zurück.

**Referenz-Testpaar für die feine Linie** — zwei Stellen, die gleich aussehen und es nicht
sind: `einsatz_schaden.rs`/`abschliessen` ist ein **dedizierter** Aktions-Endpunkt, der
Abschlussgrund ist dort unbedingt Pflicht → das Feld scheitert isoliert → **400**
(`abschliessen_ohne_grund_ist_400`). `einsatz_tier.rs`/`status` ist der **generische**
Status-Endpunkt, der Grund ist dort nur bei Zielstatus `abgeschlossen` Pflicht → das ist ein
Zusammenhang → **422** (`abschluss_ohne_grund_ist_422_und_mit_grund_ok`), während der
*unbekannte* Enum-Wert derselben Stelle 400 liefert. Beide Stellen tragen einen Kommentar,
der auf die jeweils andere verweist — wer sie „harmonisiert", bricht einen gepinnten Test.

**Nicht betroffen, legitimes 422 — beim nächsten Sweep NICHT mitkippen:**
`lage_zone.rs` (Typ × Geometrie-Klasse, kaputtes GeoJSON, `geometrie.type` ≠ `geometrie_typ`,
Gefahrengebiet-Zuordnung an eine Nicht-Gefahrengebiet-Zone — alles Feld-*Kombinationen*),
`gefahr.rs` (Gefahrentyp × Schutzobjekt), `einsatzabschnitt.rs:261` (kaputtes GeoJSON),
`sprechgruppe/repo.rs:207` (referenzielle Zuordenbarkeit), `auth.rs:1288` („Code ungültig" —
ein TOTP-Einmalcode scheitert am kryptographischen Vergleich, nicht an der Form; das ist ein
Zustandsfehler), `einsatz_uhs.rs:264/270/277/516` (lat/lon-Paar, Koordinaten- und
Mengen-Ranges) und `einsatz_uhs.rs:359` (Status-Übergang). **`einsatz_uhs.rs` hat keine
Enum-Abweichung** — alle sieben Enum-Parse-Stellen der Datei nutzen bereits `Validation`.

**Vorsicht bei `einsatz_schaden.rs`/PATCH und `einsatz_tier.rs`/Status:** dort binden die
Repos `typ`/`ausmass`/`abschluss_grund` als **rohen String**, und die CHECKs aus
`migrations/0033` bzw. `0031` kommen über das Sicherheitsnetz unten wieder als **422**
heraus. Entfernt man einen Handler-Precheck, antwortet die Route also lautlos wieder mit dem
alten Code statt mit 500 — ein Test, der 422 erwartet, wäre auch ganz ohne Precheck grün.
Nur die 400-Erwartung beweist, dass der Precheck vor der DB greift (per Mutationsprobe belegt).

**Sicherheitsnetz (LFH-245):** nicht vorab abgefangene DB-Constraint-Verletzungen bekommen in
`AppError::status()` automatisch einen fachlichen Code — UNIQUE/FK → **409**, CHECK → **422**,
statt eines nackten 500. Per-Handler-Prechecks bleiben für präzise Meldungen zuständig.

**Extractor-Vertrag:** Handler nehmen Request-Bodies **ausschließlich** über
`crate::extract::JsonBody` und Route-IDs **ausschließlich** über `crate::extract::PfadParam`
entgegen, nie über `axum::Json` bzw. `axum::extract::Path` — nur so folgt auch eine
Deserialisierungs-/Path-Rejection dem `{error}`-JSON-Format (LFH-317/F22-B). `axum::Json` bleibt
für **Responses** richtig. Erzwungen von `tests/json_extractor_guard.rs` und
`tests/path_extractor_guard.rs` (beide `src/routes/`-scoped, Token-genau — `FsPath<`/`PfadParam<`
sind kein Verstoß); querschnittliche Fehlerfälle (405, unbekannter API-Pfad, kaputter Body,
nicht-numerische Route-ID) deckt `tests/fehler_vertrag.rs` ab.

**`PfadParam` → 400, `EinsatzKontext` → 404 — bewusst getrennt.** Eine nicht-parsebare Sub-ID ist
ein formaler Eingabefehler (LFH-267: falscher Feldtyp → 400; axum-Default ist ohnehin 400, die
Umstellung ist envelope-only, gepinnt von `proxy_raster_nicht_numerisches_z_ist_400`). Die
*einsatz_id* dagegen bildet `src/einsatz/kontext.rs` auf `NotFound` (404) ab — dort ist die
fehlende ID eine Ressourcen-Existenzfrage. Die beiden Extraktoren sind **orthogonal**:
`EinsatzKontext` zieht die `{id}`, `PfadParam` die Sub-IDs. Ein auf `EinsatzKontext` migriertes
Modul behält deshalb sein rohes `Path` für die Sub-IDs (gemessen: `auftrag.rs`/`meldung.rs` nutzen
beide) — die frühere Annahme „Migration entfernt das rohe Path" war falsch, weshalb LFH-317
unabhängig von der (partiell gebliebenen, unscheduled) LFH-121/230-Migration umgesetzt wurde. Eine
spätere Kontext-Migration trimmt höchstens ein Tuple-Element, macht den Swap aber nicht zunichte.
