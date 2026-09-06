# CLAUDE.md

## ClickUp

Dieses Projekt hat ein eigenes ClickUp-Projekt im Space **Lifeline Hub** (`901511065513`,
Workspace/Team `9015920204`). Das **Entwicklungsboard** (`901523554968`) ist das
Task-Board des Projekts, das **Feedbackboard** (`901523554969`) sammelt Feedback.

Tasks werden selbstständig über den ClickUp-MCP angelegt — wie und wann beschreibt der
Skill `clickup-task-anlegen`.

## Frontend — UI-Form-Leitlinie (Drawer-Nutzung)

**Farbachse der Betroffenen-Module (LFH-455):** Personenstatus, Schadensstatus und
Schadensausmaß gehören zum A2-Vertrag in `theme/statusFarben.ts`. Ihre Darstellung folgt
`StatusTag` aus LFH-446: die Rollenfarbe kennzeichnet den Rand, `token.colorText` trägt die
Beschriftung. Dafür ist keine zusätzliche Darstellungsoption nötig. „Betroffen“ und
„abgemeldet“ sagen nichts über medizinische Dringlichkeit; „verstorben“ ist kein roter
Alarm wie SK I. Diese Personenstatus sind neutral, „vermisst“ ist `achtung`. Beim Schaden
ist „offen“ `achtung`, „übergeben“ `bedien`, „abgeschlossen“ neutral. Beim Ausmaß ist
„gering“ neutral, „mittel“/„groß“ `achtung`, „katastrophal“ `alarm`; die Labels unterscheiden
die zusammengefassten Stufen.

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
Personenstatus.

`e2e/betroffene-kontrast.spec.ts` prüft die tatsächlich zusammengesetzten Text-/Hintergrundpaare
auf Aufnahme-Route, im Modal, in Listen und Details: Tag ≥ 7:1, Nacht ≥ 5:1. Die Sichtungswahl
wird ungewählt, gewählt und mit Hover geprüft; Alpha wird mitgerechnet, unbelegte
Bild-/Opacity-Kompositionen werden abgelehnt. Kein zusätzlicher mobiler Status-Slot ist
Teil dieser Farbentscheidung.

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

**Die erste eingelöste Karten-Ausnahme ist die ETB-Chronologie** (LFH-342/C7,
`etb/EtbTabelle.tsx`). Sie zeigt, woran die Formfrage wirklich hängt, und korrigiert dabei ein
früheres Verdikt: die B5e-Prüfliste hatte „die Chronologie wird verglichen, sie bleibt eine
Tabelle" geschrieben. Ein **Tagebuch wird gelesen** — die Frage ist „was ist passiert?", nicht
„welcher von diesen ist der richtige?"; es gibt keine Sortierung, keinen Spaltenfilter und
keine Suche über die Spalten, die Ordnung ist die Zeit und serverseitig festgelegt. Der Satz
„keine der 13" traf sie ohnehin nie: `katalogTabelle.guard.test.ts` führte sie ausdrücklich als
**neunzehnte** Konsumentin und benannten Restposten (LFH-330/AP8) — der ist damit eingelöst,
das ETB ist **nach oben** aus dem Inventar herausgefallen wie `SchaedenPage` in C5.
**Der Kartenzweig ist ein Eigenbau** (`art: 'eigen'`, erster und einziger Eintrag in
`KARTEN_EIGENBAU`), und auch das ist begründungspflichtig: der Plan-Modus trägt Titel + Status
+ höchstens **drei** Sekundärfelder + genau **eine** Primäraktion, die Ereigniszeile braucht
fünf Kopffelder, einen Volltextblock und **drei** Aktionen. Wer den zweiten Eigenbau einträgt,
begründet ebenso — und prüft zwei gemessene Fallen mit: `Datensicht` gibt beim Eigenbau
`karte.render(...)` **roh** zurück, der Wrapper mit `zeilenKlasse` und
`data-lfh="datensicht-karte"` entsteht nur im Plan-Modus. Ohne die Marke findet
`scrolleZurZeile` die Karte nicht, und ein Deeplink läuft unter `md` still ins Leere; ohne die
Klasse gilt jede Zeilenmarkierung nur im Tabellenzweig.
**Das Spaltenbudget ist die Zusicherung, nicht die Kartenauflösung**: dass der Meldungstext im
Fükw ≥ 50 % der Contentbreite bekommt, tragen `abBreite: 'xxl'` an den zwei Nebenspalten und
der Zähler des Spaltenschalters — beide Ausblendungsgründe laufen durch dieselbe Funktion, der
Zähler kann also nicht lügen. Gemessen wird das in Playwright gegen die **Contentbreite**, nie
gegen die Tabellenbreite: `KatalogTabelle` rendert mit `width: max-content`, bei langem Inhalt
wächst die Tabelle über den Container und ein Verhältnis Spalte-zu-Tabelle würde kleiner,
obwohl der Text mehr Platz hat.

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
Gestaltungssprache aus LFH-352. Dieselbe Form kann je Kontext eine andere Dichte, Treffläche und
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
- **Dichte-Staffel 30 / 48 / 72 px** (kompakt aus LFH-352 · komfortabel = Material 48 dp ·
  Handschuh = 72 px ≙ 19,05 mm, MIL-STD-1472F Fig. 12). Träger ist ein **Dichte-Token am
  `ConfigProvider`** — nicht `componentSize` (dessen `large` endet bei 40 px) und erst recht nicht
  verstreute punktuelle Größen-Props. **Neues punktuelles `size="small"` auf interaktiven Elementen
  ist verboten** — seit LFH-362 nicht mehr nur als Prosa, sondern erzwungen von
  `components/dichte.guard.test.ts` mit einer **Schuldmenge**, die nur schrumpfen darf (Stand
  01.08.2026 nach LFH-370/B5j: **5 Stellen in 2 Dateien** — gemessen mit der
  Scan-Funktion des Guards selbst, nicht fortgeschrieben —, je Verzeichnis-Bündel von LFH-333
  zugeordnet; ein Eintrag ohne Verstoß gilt selbst als Verstoß). Stand 17.08.2026 nach
  LFH-339/C4: **eine Datei**, die geprüfte Dauerausnahme unten — die **vier Knöpfe** der
  UHS-Platzkarte (`pages/uhs/Grundriss.tsx`; die zwei `Card`-Angaben derselben Datei zählen
  korrekt nicht mit). Das `InputNumber` in `pages/MaterialPage.tsx` (B5i) ist gefallen, weil
  C4 die Datei ohnehin anfasste. **Damit ist LFH-333/B5 bis auf die begründete Ausnahme
  abgetragen.** Wer eine Zeile aus `OFFEN` streicht, tut es im **selben** Commit wie den Fix
  und prüft `aktionsabstand.guard.test.ts` mit.
  **Eine Klein-Angabe abzubauen kann eine Regel aufwerfen, die vorher keine war** (gemessen in
  LFH-370): solange die vier Knöpfe der Aktionsreihen in `SchaedenDetailPage`/`TiereDetailPage`
  klein waren, war die Frage nach dem Abstand zum `danger`-Knopf nicht gestellt. Mit der Staffel
  wächst „Stornieren" auf bis zu 72 px und steht bündig neben drei gleich hohen neutralen
  Aktionen — beide Dateien mussten im selben Commit in den Bereich von
  `components/aktionsabstand.guard.test.ts`. Wer eine Zeile aus `OFFEN` streicht, prüft den
  zweiten Guard mit.
  **Eine Ausnahme ist geprüft und dauerhaft** (LFH-367/B5g): die vier Knöpfe der UHS-Platzkarte
  hängen an der Backend-Konstante `SCHRITT_Y = 120` aus `raster_position`. Der Innenraum von
  100 px trägt in **keiner** Dichtestufe eine Aktionszeile auf voller Höhe — auch „alles ins
  Dropdown" löst es nicht, dessen Auslöser ist selbst ein Knopf. B5g hat deshalb den **Bedienweg**
  geändert statt der Grösse (Klick auf die ganze Karte, 140 × 116 px, statt Ziehen); die Zeile
  fällt erst mit einer Änderung an `raster_position`. Der Guard scannt **JSX-Tags mit
  Klammertiefe, nicht per Regex**: `<Button\b[^>]*size="small"` ist mehrzeiligen Elementen blind
  (gemessen 61 statt 82) und verliert einen Treffer schon, wenn eine Pfeilfunktion vor der Prop
  steht — ein Gate, das einen Zeilenumbruch für Fortschritt hält. Was er **nicht** sieht, steht in
  seinem Kopfkommentar und ist Teil des Vertrags. Nicht-interaktive Flächen (`Card`,
  `Descriptions`, `Spin`) sind absichtlich draußen, die Projekt-Primitive `Liste`/`KatalogTabelle`
  ebenso — dort ist `size` ein **Abstandsmaß**, keine Treffläche, und `Liste.test.tsx` prüft das
  über mehrere Dichtestufen.
  **Der Scanner kennt seit LFH-364 zwei weitere Fälle** — beide gemessen, nicht vermutet, und
  beide zeigen, dass ein Gate in BEIDE Richtungen falsch liegen kann: **(1)** ein generisches
  Typargument (`<Select<number | null> size="small">`) schrieb sich vorbei, weil der Lookahead
  hinter dem Namen ein `[\s/>{]` verlangte; ein `<` ist keins. Der Lookahead allein genügt nicht —
  `tagEnde` nimmt sonst das `>` des Typarguments für das Tag-Ende, deshalb überspringt
  `generikEnde` die balancierte Klammer zuerst (die Mutationsprobe „nur Lookahead" färbt 5 Tests
  rot). Diese eine Lücke versteckte 4 Stellen, darunter einen Verstoß in
  `personen/personenSpalten.tsx`, der in keiner Schuldzeile stand. **(2)** umgekehrt rechnete der
  Guard eine Angabe aus einer **Prop-Expression** dem äußeren Element zu: `<Collapse
  items={[{ children: <Descriptions size="small"/> }]}>` blieb gemeldet, als die eigene Angabe des
  Collapse längst weg war. `attributEbene` reduziert den Tag darum auf seine Attributebene. Ein
  Gate, das einen Verstoß nicht wieder loslässt, ist von einem kaputten nicht zu unterscheiden.
  Dessen Klammer-Bilanz **muss Zeichenketten überspringen** wie `tagEnde`/`generikEnde`: ohne das
  verschluckt eine Klammer *im String* (`title={x ? "{" : ""} size="small"`) den Rest des Tags —
  ein Fix, der ein neues Loch reißt, ist schlimmer als der Fehlalarm, den er behebt (im Review
  gemessen und mit Selbstbeweis geschlossen). Blindfleck bleiben ein **Funktionstyp** im
  Typargument (dessen `=>` schließt die Klammer zu früh; im Bestand an keiner der 25
  Generic-Stellen) und eine Klammer in einem **Regex-Literal** einer Prop (Altlast in `tagEnde`).
  **Klein-Angaben an `Card`/`Descriptions`/`Space`/`Liste` bleiben stehen — als Regel, nicht als
  Restarbeit**, und sie gehören auch nicht in `OFFEN`: `befunde` belegt einen Eintrag nur über
  einen echten Fund, ein Eintrag für eine nicht-interaktive Fläche wäre also sofort eine „tote
  Schuld-Ausnahme" und färbte den Guard rot. Ein handgezähltes Inventar solcher Ausnahmen verrottet
  (das AK von LFH-364 sprach von „drei" Karten, allein das B5d-Bündel trägt zwölf) — die Regel
  nicht.
  **Die kleine Steuerhöhe liegt seit LFH-361 auf dem Gate-3-Boden** (24 / 48 / 72 statt antds
  abgeleiteter 22,5 / 36 / 54 — `genControlHeight.js` rechnet × 0,75). Folge: wo eine Bibliothek
  die Kleingröße **erzwingt** — antds Popconfirm tut das hart in `PurePanel.js` — greift die
  Staffel trotzdem durch. Eine Hülle, die das per `okButtonProps` zurückdreht, wäre überflüssig;
  das wurde gemessen, nicht vermutet (`button/style/index.js:175` gibt einem kleinen Knopf
  `controlHeightSM`). Ebenfalls seit LFH-361: **die Zeigerart belegt die Stufe vor** (grob →
  `komfortabel`), aber **nur ohne gespeicherte Wahl** — eine getroffene Wahl gewinnt immer, sonst
  drehte sich der Umschalter beim Neuladen selbst zurück. Die Abfrage liegt in
  `components/useViewport.ts` (`zeigerIstGrob`), nicht im Theme-Provider: dessen Freistellung im
  Viewport-Guard gilt nur der Dunkelmodus-Frage.
  **Ein handgebautes Bedienziel braucht ZWEI Angaben, nicht eine** (Festlegung aus LFH-365 · B5e,
  die dort offene Konventionsfrage). Wo kein antd-Steuerelement die Höhe mitbringt — eine
  `role="option"`-Zeile, ein `<div onClick>`, ein Zeilen-`<Link>` —, gilt:
  `minHeight: token.controlHeight` **plus** `padding` aus `token.paddingSM`/`token.padding`. Die
  Polsterung allein trägt den Boden nicht: gemessen kommt eine Zeile im Handschuh-Betrieb damit auf
  grob 54 px gegen die geforderten 72. Träger sind **aufgelöste Tokens, nie `var(--lfh-*)`** — die
  Arbeitsteilung steht in `theme/rollen.css` („ZWEI QUELLEN, EINE WAHRHEIT") und ist seit LFH-328/A2
  begründet: handgeschriebenes CSS liest die Custom Properties, TSX liest `theme.useToken()`. Die
  Dichteachse wurde in TSX noch nie über eine CSS-Variable gelesen (gezählt: `--lfh-zeilenhoehe` hat
  genau einen Konsumenten, und der ist eine Klasse ohne Verwender). Präzedenz:
  `components/Datensicht.tsx:1255`, `etb/SlashMenu.tsx`, `pages/lagekarte/Sidebar.tsx`
  (`bedienzielStil`, als **reine, exportierte** Funktion — nur so ist die Zusicherung über zwei
  Dichtestufen prüfbar, ohne zu rendern). Der Boden ist die **Trefffläche, nicht der ganze
  Zugang**: ein `ListenEintrag` mit `onClick` bleibt ein nacktes `<div>` ohne `role`/`tabIndex`,
  und die klickbare Zeile als Ganzes ist B7/LFH-335 zugeordnet. **Kein Guard sieht diese Fälle** — ein
  Pixel-Padding ist keine Größen-Prop —, die Zusicherung muss also von Hand kommen. Prüfbar ist der
  **Inline-Style**, nicht ein Pixel (jsdom rechnet kein Layout): die belastbare Behauptung ist die
  Ungleichheit über zwei Dichtestufen plus die Böden als **Literale** hingeschrieben —
  aus dem Token zurückgelesen prüfte sie den Token gegen sich selbst.
  **Welches Zahlentripel, hängt am Token** (Klarstellung aus dem LFH-366-Review, hier standen
  vorher zwei Präzedenzen mit verschiedenen Zahlen unter einer): `controlHeight` = **30/48/72**,
  `controlHeightSM` = **24/48/72**. `etb/SlashMenu.test.tsx` prüft gegen `controlHeightSM` und
  deshalb als *untere Schranke*; `pages/lagekarte/Sidebar.test.tsx` prüft `controlHeight` auf
  *Gleichheit*. Wer `toBe(24)` gegen `controlHeight` schreibt, prüft das falsche Tripel.
  **Ist die Fläche ein `ListenEintrag`** (`components/Liste.tsx`), trägt der die Kurzform
  `padding` aus dem übergebenen `style` — er setzt selbst `paddingBlock`/`paddingInline` und
  spreizt `...style` **danach**, die spätere Deklaration gewinnt. Das ist heute richtig und
  ungetestet: zöge jemand den Spread nach vorn, fiele die Polsterungshälfte still weg, während
  `minHeight` überlebt. Der Kommentar an der Spread-Zeile sagt das; wer sie anfasst, liest ihn.
  **Der Boden gilt auch für die Kommandopalette** (Nacharbeit zu LFH-335, 08.08.2026): ihre
  `role="option"`-Zeilen sind handgebaute Bedienziele wie jede andere und hingen bis dahin auf
  einem festen `padding: '8px 10px'` ohne `minHeight`. Solange die Palette nur an `Strg/⌘+K` hing,
  fiel das nicht auf — mit dem sichtbaren Auslöser aus B7 ist sie der **Berührungsweg** zu 42+
  Befehlen, und eine 34-px-Zeile verfehlt genau den Kontext, für den der Auslöser gebaut wurde.
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
- **Datensatz-Aktionen werden gebündelt, nicht aufgereiht** (LFH-365 · B5e nach dem Vorbild von
  LFH-364). Ab drei Aktionen an einer Zeile oder Karte: ein `Dropdown` mit `menu={{ items }}`,
  `trigger={['click']}`, `autoFocus` und einem icon-only `<Button type="text">` — kein `Popover`
  (der trägt im Repo ausschließlich Inhalt und liefert keine `menuitem`-Rollen). Bleibt nach der
  Sichtbarkeitsfilterung keine Aktion übrig, wird **gar kein** Auslöser gerendert statt eines
  deaktivierten. Der zugängliche Name trägt die **Zeilenkennung** (`Aktionen zu Eintrag 7`), weil n
  Zeilen sonst n gleichnamige Knöpfe liefern. Träger: `chat/NachrichtenStrom.tsx:88`,
  `etb/EtbTabelle.tsx`, `etb/MetaChip.tsx`, `pages/lagekarte/Sidebar.tsx` (Bild-Zeile).
  **Gezählt wird NACH der Rechteprüfung** (LFH-366): fällt die Menge unter drei, ist ein Menü
  keine Bündelung, sondern ein Umweg — die Bild-Zeile zeigt ohne Schreibrecht ihre eine Aktion
  weiter direkt. Beide Fälle gehören als **Paar** getestet; „mit Recht ist der direkte Knopf WEG"
  ist die Hälfte, die die Bündelung überhaupt prüfbar macht. **Braucht das Löschen im Menü eine
  Rückfrage, trägt sie ein `<Modal>` mit eigenem State** (Bauform `AnsichtSwitcher.tsx:167`), kein
  `Popconfirm` — der überlebt im Menü-Label nur mit `stopPropagation` das Auto-Schließen; der
  Dialog steht **außerhalb** der Zeilen-`map`, je Zeile einer wären n gleichnamige Knöpfe im Baum.
  Zwei gemessene Fallen: die Zuordnung gehört ans **Menü**
  (`onClick` am `menu`, nicht je Item), weil ein Riegel dann einen Ort hat — liegt das Menü in einem
  klickbaren Elternteil, steigt sein Synthetic Event aus dem Portal in den **Komponenten**-Baum auf
  und feuert dessen `onClick` mit (gemessen an `MetaChip`: „Entfernen" rief zusätzlich „Bearbeiten"
  auf, obwohl der Auslöser selbst schon `stopPropagation` hatte). Und im Test wird der Eintrag
  **immer über das geöffnete Menü** gegriffen (`.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]`
  + `within`): antd lässt die Portale geschlossener Dropdowns im Baum stehen. Dort dann per
  **Teilstring**, nicht per exaktem Namen (LFH-366): ein antd-Icon im Eintrag trägt ein eigenes
  `aria-label` (`role="img"`), das in den zugänglichen Namen einfließt — gemessen heißt der
  Eintrag `delete Bild entfernen …`. Die Beschriftung selbst prüft ein `textContent`-Vergleich.
  **Die Gegenausnahme MeldungKarte ist eingelöst** (LFH-372/B5k): `meldungen/MeldungKarte.tsx`
  bündelt seit 02.08.2026. Was die Vertagung teuer machte, war nicht die Bündelung, sondern die
  **Rückfragen** — und die Rechnung fiel beim Bauen kleiner aus als beim Schätzen: von „vier
  Popconfirms im Menü" blieb **eine** übrig. `Sichten`/`In Bearbeitung` haben ihre verloren, weil
  `src/meldung/repo.rs:223` jeden Status frei zurücksetzt (LFH-378: erst die Umkehrbarkeit, dann
  die Rückfrage); `Bestätigen` bleibt sichtbarer Knopf und kommt nie ins Menü; `Erledigt` trägt
  ein `<Modal>` — und zwar auf **beiden** Wegen dasselbe, ob es gerade sichtbar oder gebündelt
  steht, weil zwei Bauformen für eine Aktion ein Unterschied ohne Bedeutung wären. Sichtbar
  bleiben genau zwei Aktionen: `Bestätigen` und die **eine** Vorwärtsbewegung des Triage-Status;
  was der Primär-Knopf gerade nicht zeigt, steht im Menü — sonst verlöre eine neue Meldung den
  Direktsprung auf „Erledigt", den der Bestand hatte.
  **Der Rechte-Riegel gehört an die Ableitung, nicht ans Rendern** (gemessen): `MeldungenPage`
  übergibt `onStatus` auch einem Beobachter, das Vorhandensein des Callbacks ist also **kein**
  Rechtebeleg — ohne den Riegel sah der Beobachter „Sichten". Und ohne Schreibrecht lautet die
  Negativ-Aussage „**kein Trigger**", nicht „Eintrag fehlt": ein `queryByRole('menuitem')` vor dem
  ersten Öffnen ist immer `null` (rc-dropdown mountet lazy), ein reiner Rollentausch
  `button` → `menuitem` färbte die vier Bestands-Negativaussagen also trivial grün.
  **Wo der Riegel gegen dieses Aufsteigen NICHT hingehört, ist ebenfalls gemessen** (LFH-367/B5g):
  ein `domEvent.stopPropagation()` im `menu.onClick` hält es **nicht** auf — mit ihm allein blieb
  der Regressionstest rot; der Callback läuft zu spät für die Ausbreitung. Wirksam ist ein
  `onClick`-Riegel an dem **Container, in dessen Teilbaum der Auslöser hängt** (dort:
  `uhs/Grundriss.tsx`, Aktionszeile der Platzkarte). Einer am Container fängt beides — die
  direkten Knöpfe daneben, die nur `pointerdown` stoppen (was den folgenden `click` nicht
  aufhält), und den Portal-Klick des Menüs. Wer den Auslöser aus diesem Container bewegt, nimmt
  den Riegel mit; `MetaChip` löste denselben Fall dadurch, dass der Schnellweg an einen
  **Geschwisterknoten** wanderte und damit gar keinen klickbaren Vorfahren mehr hatte.
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
  **Statusfarbe nur als Punkt/Rand/Beistrich, nie als Textfläche.** `status_farbe` ist bei
  Fahrzeug und Personal ungeprüfter Freitext (`statusFarben.ts:28-41`), Kontrast ist dort nicht
  zugesichert. C4 hat die Fläche deshalb auch im **Bestand** abgetragen: A2 hatte die DB-Achse
  auf antds `color`-Prop stehenlassen, aus Sorge um den **Verlust** der gepflegten Farbe — die
  geht über `StatusTag`s `farbe`-Prop auf Rand und Text und bleibt damit erhalten. Das ist
  A2s Sorge eingelöst, kein Zurückdrehen.
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
- **`SK_META` führt antd-TAG-Farbnamen, keine CSS-Werte** (LFH-340 · C5). Sie in ein
  `style={{ color }}` zu schreiben ergibt einen **anderen** Ton als überall sonst — CSS-`gold`
  ist nicht antds Gold — und wäre damit ein erfundener Farbwert, den `theme/tokens.ts` nicht
  kennt. Wo eine Fläche die Kategorie farbig zeigen soll, trägt ein `<Tag color={…}>` **in** der
  Fläche die Farbe, nicht die Fläche selbst; das hält zugleich „Statusfarbe nur als
  Punkt/Rand/Beistrich, nie als Textfläche". Der zweite Kanal ist die Beschriftung — „SK I" sagt
  es auch ohne jede Farbe, weshalb `unverletzt` mit `color: 'default'` vollwertig ist.
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
- **Rot bedient nichts** (LFH-352/LFH-315): `bedien` und Fokusring sind blau, Rot ist Gefahr.
  Jede Statusfarbe braucht einen **zweiten Kanal** (Text, Symbol, Form — WCAG 1.4.1). Farbwerte
  kommen ausschließlich aus `theme/tokens.ts`/`theme/rollen.css`; ein abweichender Wert ist ein
  Fehler, kein Vorschlag.
  **Die Fläche ist die dritte Darstellungssorte, und sie liegt seit LFH-368/B5h im Vertrag**:
  `theme/statusFarben.ts:warnstufeFlaeche` bildet die fünf Warnstufen auf **drei** Farbtöne ab —
  zwei Intensitäten von `achtung`/`alarm` plus leer —, `flaechenFarbe` löst sie je Modus auf.
  Damit hält „nicht eine sechste Farbe" auch dort, wo fünf Flächen gebraucht werden. Eine Füllung
  ist **keine** `Statusrolle`: sie hat einen eigenen Typ (`Flaechendarstellung`) und erreicht
  bewusst keinen antd-Token — `rollenFarbe` kann sie nicht liefern, `antdToken()` bildet die
  Füllungsrollen nicht ab. Wer eine vierte Sorte braucht, benennt sie dort, statt sie in `pages/`
  daneben zu bauen: die Pastelltöne, die dort lagen, hatten **kein Nachtmodus-Paar** und standen
  im Dunkelmodus als vier grelle Helligkeitsblöcke. Weil zwei Stufen sich denselben Ton in zwei
  Intensitäten teilen, ist der **zweite Kanal Pflicht, nicht Kür** — `Flaechendarstellung.kuerzel`
  steht im Auslöser, das Stufenwort im zugänglichen Namen. Ihr **Kontrast** ist eine begründete
  Setzung und kein Messwert (jsdom rechnet keine Farbmischung): der Nachweis steht offen und
  gehört in den Playwright-Topf von **LFH-370/B5j**, der ihn heute noch nicht führt.
  **Rot steht auch nicht bündig neben Neutralem** (LFH-363): eine `<Space>`-Aktionsreihe mit
  einem `danger`-Knopf und mindestens einer weiteren Aktion trägt `size="middle"`. Der
  Vorgabewert ist hier **nicht** antds 8 px — antd mappt `spaceGapSmallSize` auf `paddingXS`,
  und das steht auf `abstand.xs` = 3/5/7 px je Stufe; `middle` führt auf `abstand.md` =
  11/18/26 und liegt damit in jeder Stufe über dem geforderten `token.marginSM`. Erzwungen von
  `components/aktionsabstand.guard.test.ts` — auf die in LFH-363 bewerteten Dateien **gescopt**,
  weil die danger-Nachbarschaft anders als eine Größen-Prop keine zählbare Eigenschaft ist,
  sondern eine Bewertung je Stelle; er wächst mit den Bündeln B5d–B5j (seit LFH-366 mit den
  beiden Kartenverwaltungen). **Was er nicht sieht, ist ein `danger`-MENÜEINTRAG** — `reihenIn`
  matcht `<Button` mit `danger` im Tag. Eine Datei, deren Löschen ins Dreipunkt-Menü gewandert
  ist, gehört deshalb in **keine** der beiden Listen: sie aufzunehmen behauptete eine Deckung,
  die der Scanner nicht hat. Dort ist die Trennung der Menü-Trenner, und der wird im
  Komponententest geprüft (`pages/lagekarte/Sidebar.test.tsx`). Geprüft wird der
  **Prop-Wert im Quelltext**, nicht ein Pixelabstand: jsdom rechnet kein Layout.
  **Destruktiv ist nicht gleich destruktiv** (Entscheidung aus LFH-363): „Außer Dienst" /
  „Deaktivieren" / eine gelöste Zuordnung sind **umkehrbar** — die Umkehrung steht als Knopf
  daneben —, sie bekommen Abstand und `danger`, aber keine zusätzliche Reibung. **Unumkehrbares**
  (heute nur „Löschen" in `stammdaten/StichworteTab.tsx`) bekommt zusätzlich eine Rückfrage.
  Jedes `Popconfirm` an einer destruktiven Aktion trägt `okButtonProps={{ danger: true }}` —
  sonst bestätigt man das Löschen mit einem blauen Knopf.
  **Die erste Anwendung auf den Bestand steht** (LFH-378/B5l): das „Lösen" im UHS-Materialreiter
  (`pages/uhs/MaterialTab.tsx`) hat seine Rückfrage **verloren**, weil CLAUDE.md „eine gelöste
  Zuordnung" wörtlich als umkehrbar führt und die Umkehrung („Material zuordnen") als Knopf
  darüber steht. LFH-367/B5g hatte dasselbe `Popconfirm` noch **gehärtet statt entfernt** —
  bewusst, weil das Entfernen einer bestehenden Rückfrage eine Bedienentscheidung ist und nicht
  ins AK eines Härtungs-Tickets gehört. Wer eine Rückfrage anfasst, entscheidet also zuerst die
  Umkehrbarkeit; `okButtonProps` ist die Antwort auf die zweite Frage, nicht auf die erste.
  **Ein gedeckelter Abstand ist kein fehlender Abstand** (ebenfalls LFH-378): die Aktionszeile
  der UHS-Platzkarte nimmt `token.marginSM` **als Obergrenze**, nicht als Sollwert
  (`aktionsabstand()` in `uhs/Grundriss.tsx`, rein und exportiert nach dem Muster von
  `bedienzielStil`). Grund, gemessen: antd gibt einem icon-only-Knopf `width: controlHeightSM`
  (24 / 48 / 72), und als Flex-Items ohne `flex-shrink: 0` schrumpfen die Knöpfe auf die 124 px
  Innenbreite der Karte. Ab `komfortabel` brauchen vier Knöpfe allein 192 px — dort ginge **jede
  Lücke direkt von der Trefffläche ab**, ein ungedeckeltes `marginSM` machte die Ziele also
  kleiner statt besser. Die Karte ist breitenseitig an `SCHRITT_X = 160` gebunden wie ihre Höhe
  an `SCHRITT_Y = 120` (`uhs/platz_repo.rs`, `raster_position`); das ist dieselbe Ausnahme, nur
  an der anderen Achse. Der Ergebniswert ist **7 / 0 / 0** — die Ungleichheit über zwei Stufen
  ist das, was einen dichteblinden Festwert auffliegen lässt.
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
  **`useBlocker` steht nicht zur Verfügung** und das ist gemessen: er verlangt einen **Data
  Router**, die Anwendung hängt an `<BrowserRouter>` (`main.tsx`), der Aufruf wirft dort beim
  Rendern. Wer ihn will, stellt zuerst die ganze Routenlandschaft um. Bis dahin trägt den
  In-App-Wechsel der **Blur-Autosave** (jeder Klick auf eine Brotkrume verlässt das Feld
  zuerst) und Reload/Tab-Schluss ein `beforeunload` — mit Gegenaussage, dass er ohne offene
  Fassung schweigt.
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
  (LFH-345 · C10, M14). `EINSATZ_STATUS` liegt jetzt in `einsatz/einsatzStatus.ts` neben
  `einsatzart.ts`; vorher war es eine modul-lokale Konstante in `EinsaetzePage`, und der
  zweite Leser (`EinsatzdatenPage`) hatte sie **nicht** — dort stand der rohe Wire-Wert im
  Titel-Tag. Das ist die Sorte Abweichung, die niemandem auffällt: beide Seiten sahen für
  sich plausibel aus, und „aktiv" ist zufällig auch ein deutsches Wort. Der Eintrag trägt den
  Vertragstyp `StatusDarstellung` aus `theme/statusFarben.ts` (damit ist `label` Pflichtfeld
  — zweiter Kanal, WCAG 1.4.1), liegt aber **nicht** in dieser Datei: deren Abdeckungsguard
  zählt die Maps gegen eine Literal-Liste **und** `toHaveLength(10)`; ein elfter Eintrag wäre
  eine Änderung am Vertrag und an seinem Guard, also eine eigene Entscheidung statt eines
  Nebenprodukts.
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
  Nachfolger, nicht `vorgaenger_id == null`), die Lagemeldungen sind die **zwölfte**
  `Datensicht`-Konsumentin; ihre Tagesgrenze liegt in der Anzeigezone
  (`lagemeldungen/zeitachse.ts`), nicht in UTC.
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
Absenden passiert** — das ist die Steuerzeile. Die ETB-Schnellerfassung trug beides doppelt:
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

Es gibt weiterhin **kein CI**. Die Durchsetzungsinstanz ist lokal:

```bash
./scripts/check-all.sh     # alle Gates, vor dem Merge
```

Reihenfolge (billig → teuer): `check-fmt.sh` → `pnpm lint` → `check-typ-codegen.sh`
(enthält `tsc`) → `cargo test --workspace` → Vitest → `check-deps.sh` → `pnpm e2e`.

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
  `target/debug/lifeline-hub` existiert, und überspringt sonst mit lautem Hinweis statt
  zu brechen. Praktisch greift dieser Guard im Sammel-Gate nie, weil `cargo test
  --workspace` (Schritt 4) das bin-Target ohnehin mitbaut — e2e ist hier also faktisch
  immer dabei (+~30 s). Der Guard schützt die Fälle daneben: verkürzte Läufe, einzeln
  von Hand aufgerufene Schritte.
- **Kein `| tail` um Gate-Kommandos** — das maskiert den Exit-Code, und eine rote Suite
  sieht dann grün aus.

`scripts/check-deps.sh` (LFH-253/G01) prüft Abhängigkeiten gegen RUSTSEC/GHSA. Fehlt
`cargo-audit`, warnt es laut und exitet 0 statt zu brechen. Bekannte, bewertete Advisories
stehen mit Begründung in `.cargo/audit.toml` — was dort **nicht** steht, bricht den Build.

## Backend↔Frontend — Typ-Codegen (LFH-120)

Die Frontend-Response-Typen werden **aus dem Rust-Backend generiert**, nicht mehr von Hand
gepflegt. Wahrheitsquelle: die `#[derive(ToSchema)]`-Response-Structs + Domänen-Enums →
`src/api_doc.rs` (utoipa `ApiDoc`) → `frontend/src/api/openapi.json` → `openapi-typescript`
→ `frontend/src/api/types.generated.ts`. `frontend/src/api/types.ts` ist nur noch ein
**Re-Export-Barrel** über die generierten Schemas (Namens-Mapping Rust `XxxAnzeige` ↔ FE `Xxx`).

- **Nach einer Backend-Typänderung** (Struct-/Enum-/Feld-Änderung an einem Response-DTO):
  `scripts/check-typ-codegen.sh` laufen lassen und die regenerierten `openapi.json` +
  `types.generated.ts` **mitcommitten**. Das Skript ist das Drift-Gate (kein CI): es emittiert
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
`127.0.0.1:1` (ECONNREFUSED) in BEIDEN Builds den fail-closed-503-Pfad. Es gibt kein CI.

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


<!-- rtk-instructions v2 -->
# RTK (Rust Token Killer) - Token-Optimized Commands

## Golden Rule

**Always prefix commands with `rtk`**. If RTK has a dedicated filter, it uses it. If not, it passes through unchanged. This means RTK is always safe to use.

**Important**: Even in command chains with `&&`, use `rtk`:
```bash
# ❌ Wrong
git add . && git commit -m "msg" && git push

# ✅ Correct
rtk git add . && rtk git commit -m "msg" && rtk git push
```

## RTK Commands by Workflow

### Build & Compile (80-90% savings)
```bash
rtk cargo build         # Cargo build output
rtk cargo check         # Cargo check output
rtk cargo clippy        # Clippy warnings grouped by file (80%)
rtk tsc                 # TypeScript errors grouped by file/code (83%)
rtk lint                # ESLint/Biome violations grouped (84%)
rtk prettier --check    # Files needing format only (70%)
rtk next build          # Next.js build with route metrics (87%)
```

### Test (60-99% savings)
```bash
rtk cargo test          # Cargo test failures only (90%)
rtk go test             # Go test failures only (90%)
rtk jest                # Jest failures only (99.5%)
rtk vitest              # Vitest failures only (99.5%)
rtk playwright test     # Playwright failures only (94%)
rtk pytest              # Python test failures only (90%)
rtk rake test           # Ruby test failures only (90%)
rtk rspec               # RSpec test failures only (60%)
rtk test <cmd>          # Generic test wrapper - failures only
```

### Git (59-80% savings)
```bash
rtk git status          # Compact status
rtk git log             # Compact log (works with all git flags)
rtk git diff            # Compact diff (80%)
rtk git show            # Compact show (80%)
rtk git add             # Ultra-compact confirmations (59%)
rtk git commit          # Ultra-compact confirmations (59%)
rtk git push            # Ultra-compact confirmations
rtk git pull            # Ultra-compact confirmations
rtk git branch          # Compact branch list
rtk git fetch           # Compact fetch
rtk git stash           # Compact stash
rtk git worktree        # Compact worktree
```

Note: Git passthrough works for ALL subcommands, even those not explicitly listed.

### GitHub (26-87% savings)
```bash
rtk gh pr view <num>    # Compact PR view (87%)
rtk gh pr checks        # Compact PR checks (79%)
rtk gh run list         # Compact workflow runs (82%)
rtk gh issue list       # Compact issue list (80%)
rtk gh api              # Compact API responses (26%)
```

### JavaScript/TypeScript Tooling (70-90% savings)
```bash
rtk pnpm list           # Compact dependency tree (70%)
rtk pnpm outdated       # Compact outdated packages (80%)
rtk pnpm install        # Compact install output (90%)
rtk npm run <script>    # Compact npm script output
rtk npx <cmd>           # Compact npx command output
rtk prisma              # Prisma without ASCII art (88%)
```

### Files & Search (60-75% savings)
```bash
rtk ls <path>           # Tree format, compact (65%)
rtk read <file>         # Code reading with filtering (60%)
rtk grep <pattern>      # Search grouped by file (75%). Format flags (-c, -l, -L, -o, -Z) run raw.
rtk find <pattern>      # Find grouped by directory (70%)
```

### Analysis & Debug (70-90% savings)
```bash
rtk err <cmd>           # Filter errors only from any command
rtk log <file>          # Deduplicated logs with counts
rtk json <file>         # JSON structure without values
rtk deps                # Dependency overview
rtk env                 # Environment variables compact
rtk summary <cmd>       # Smart summary of command output
rtk diff                # Ultra-compact diffs
```

### Infrastructure (85% savings)
```bash
rtk docker ps           # Compact container list
rtk docker images       # Compact image list
rtk docker logs <c>     # Deduplicated logs
rtk kubectl get         # Compact resource list
rtk kubectl logs        # Deduplicated pod logs
```

### Network (65-70% savings)
```bash
rtk curl <url>          # Compact HTTP responses (70%)
rtk wget <url>          # Compact download output (65%)
```

### Meta Commands
```bash
rtk gain                # View token savings statistics
rtk gain --history      # View command history with savings
rtk discover            # Analyze Claude Code sessions for missed RTK usage
rtk proxy <cmd>         # Run command without filtering (for debugging)
rtk init                # Add RTK instructions to CLAUDE.md
rtk init --global       # Add RTK to ~/.claude/CLAUDE.md
```

## Token Savings Overview

| Category | Commands | Typical Savings |
|----------|----------|-----------------|
| Tests | vitest, playwright, cargo test | 90-99% |
| Build | next, tsc, lint, prettier | 70-87% |
| Git | status, log, diff, add, commit | 59-80% |
| GitHub | gh pr, gh run, gh issue | 26-87% |
| Package Managers | pnpm, npm, npx | 70-90% |
| Files | ls, read, grep, find | 60-75% |
| Infrastructure | docker, kubectl | 85% |
| Network | curl, wget | 65-70% |

Overall average: **60-90% token reduction** on common development operations.
<!-- /rtk-instructions -->
