# CLAUDE.md

## ClickUp

Dieses Projekt hat ein eigenes ClickUp-Projekt im Space **Lifeline Hub** (`901511065513`,
Workspace/Team `9015920204`). Das **Entwicklungsboard** (`901523554968`) ist das
Task-Board des Projekts, das **Feedbackboard** (`901523554969`) sammelt Feedback.

Tasks werden selbstständig über den ClickUp-MCP angelegt — wie und wann beschreibt der
Skill `clickup-task-anlegen`.

## Frontend — UI-Form-Leitlinie (Drawer-Nutzung)

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
  30.07.2026 nach LFH-363 + LFH-364 + LFH-365: **41 Stellen in 20 Dateien** — gemessen mit der
  Scan-Funktion des Guards selbst, nicht fortgeschrieben —, je Verzeichnis-Bündel von LFH-333
  zugeordnet; ein Eintrag ohne Verstoß gilt selbst als Verstoß). Der Guard scannt **JSX-Tags mit
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
  `components/Datensicht.tsx:1255`, `etb/SlashMenu.tsx`. **Kein Guard sieht diese Fälle** — ein
  Pixel-Padding ist keine Größen-Prop —, die Zusicherung muss also von Hand kommen. Prüfbar ist der
  **Inline-Style**, nicht ein Pixel (jsdom rechnet kein Layout): die belastbare Behauptung ist die
  Ungleichheit über zwei Dichtestufen plus die Böden 24/48/72 als **Literale** hingeschrieben —
  aus dem Token zurückgelesen prüfte sie den Token gegen sich selbst.
- **Datensatz-Aktionen werden gebündelt, nicht aufgereiht** (LFH-365 · B5e nach dem Vorbild von
  LFH-364). Ab drei Aktionen an einer Zeile oder Karte: ein `Dropdown` mit `menu={{ items }}`,
  `trigger={['click']}`, `autoFocus` und einem icon-only `<Button type="text">` — kein `Popover`
  (der trägt im Repo ausschließlich Inhalt und liefert keine `menuitem`-Rollen). Bleibt nach der
  Sichtbarkeitsfilterung keine Aktion übrig, wird **gar kein** Auslöser gerendert statt eines
  deaktivierten. Der zugängliche Name trägt die **Zeilenkennung** (`Aktionen zu Eintrag 7`), weil n
  Zeilen sonst n gleichnamige Knöpfe liefern. Träger: `chat/NachrichtenStrom.tsx:88`,
  `etb/EtbTabelle.tsx`, `etb/MetaChip.tsx`. Zwei gemessene Fallen: die Zuordnung gehört ans **Menü**
  (`onClick` am `menu`, nicht je Item), weil ein Riegel dann einen Ort hat — liegt das Menü in einem
  klickbaren Elternteil, steigt sein Synthetic Event aus dem Portal in den **Komponenten**-Baum auf
  und feuert dessen `onClick` mit (gemessen an `MetaChip`: „Entfernen" rief zusätzlich „Bearbeiten"
  auf, obwohl der Auslöser selbst schon `stopPropagation` hatte). Und im Test wird der Eintrag
  **immer über das geöffnete Menü** gegriffen (`.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]`
  + `within`): antd lässt die Portale geschlossener Dropdowns im Baum stehen.
  **MeldungKarte ist die begründete Gegenausnahme** — dort wurde die Bündelung geprüft und wegen
  vier Popconfirms und ~10 Testabfragen verworfen (`meldungen/MeldungKarte.tsx:75-94`, offen als
  LFH-372/B5k).
- **Ein leeres Feld muss sagen, dass man es schreiben kann** (LFH-369 · B5i, Befund M21). Eine
  inline bearbeitbare, **optionale** Angabe nimmt `components/BemerkungZelle.tsx` — nicht
  `Typography.Text editable` von Hand. Grund: bei leerem Wert blieb davon genau das Stift-Icon
  übrig, als `<button>` ohne Textinhalt und damit **ohne zugänglichen Namen** (gemessen:
  `getByRole('button', { name: … })` fand nichts). Der **Lese**zweig hatte dagegen längst ein
  „—" — die Affordanz war genau falsch herum verteilt. Der Platzhalter ist ein echter
  antd-`Button` (`type="link"`) und **kein gestyltes `<span onClick>`**: so erbt er
  `controlHeight` vom `ConfigProvider` und schuldet nicht die zwei Angaben plus
  Dichte-Zusicherung, die LFH-365 einem handgebauten Bedienziel auferlegt. Der Lesezweig behält
  „—": ohne Schreibrecht gibt es keine Aktion, eine Aufforderung wäre eine falsche Affordanz —
  „konsistent" heißt gleiche Höhe und Typografie, und die trägt das Primitiv, weil beide Zweige
  durch dieselbe Datei laufen. **Drei Aufrufer, nicht fünf:** `gefahren/GefahrenPage.tsx:135`
  und `lagekarte/Sidebar.tsx:532` haben gemessen **keinen Leerfall** (Pflichtname mit
  `trim`-Vergleich) und bleiben draußen. **Gemessene Testfalle:** antds `Editable` entscheidet
  über Übernehmen/Abbrechen am **legacy `keyCode`** (`Editable.js:70-86`) und vergleicht keydown
  gegen keyup — `userEvent` v14 setzt es nicht, `type(feld, '…{Enter}')` bleibt wirkungslos und
  der Test scheitert mit „0 calls", als wäre die Komponente kaputt. Tastenwege deshalb über
  `fireEvent` mit explizitem `keyCode`; der Mausweg (`onBlur` → übernehmen) gehört eigens
  belegt, er ist im Betrieb der häufigere.
- **Die Zielform des Statuswechsels in den Kräfte-Listen liegt fest, gebaut wird sie in
  LFH-339/C4** (LFH-369 · B5i, `docs/superpowers/specs/2026-07-30-kraefte-listen-statuswechsel-zielform.md`).
  Kurzfassung: **Auslöser ist die Statusanzeige selbst** plus senkrechtes Menü im Portal — kein
  `Segmented`, keine Farbfläche, **kein neuer Drawer** und **kein zweiter Primäraktions-Slot**.
  Die Zahl dahinter: eine waagerechte Reihe trägt höchstens **2 beschriftete** (dichteunabhängig)
  bzw. **4 unbeschriftete** Ziele im 480-px-Quick-View; die Kataloge haben 10 / 6 / 5, der
  Fahrzeugkatalog ist mandantengepflegt. Senkrecht trägt, weil ein Menü scrollen darf und im
  Portal liegt — womit auch die feste Mindestbreite entfällt, die das `Select` aus der
  390-px-Karte drängte (`Datensicht.tsx:234-236`). **Statusfarbe nur als Punkt/Rand/Beistrich,
  nie als Textfläche**: `status_farbe` ist bei Fahrzeug und Personal ungeprüfter Freitext
  (`statusFarben.ts:28-41`), Kontrast ist dort nicht zugesichert. `fms_anker` bleibt Sortier-Anker
  und Tastenkürzel, **nicht** tragende Bedienform — die Spalte ist nullable, ein 0–9-Tastenfeld
  darauf hätte Löcher. Die zwei Eigenwidersprüche des Elterntickets („read-only Quick-View +
  Statuswahl" gegen LFH-19) sind damit **aufgelöst statt umbenannt**: es entsteht keine Fläche,
  die sie erzeugen würde.
- **Rot bedient nichts** (LFH-352/LFH-315): `bedien` und Fokusring sind blau, Rot ist Gefahr.
  Jede Statusfarbe braucht einen **zweiten Kanal** (Text, Symbol, Form — WCAG 1.4.1). Farbwerte
  kommen ausschließlich aus `theme/tokens.ts`/`theme/rollen.css`; ein abweichender Wert ist ein
  Fehler, kein Vorschlag.
  **Rot steht auch nicht bündig neben Neutralem** (LFH-363): eine `<Space>`-Aktionsreihe mit
  einem `danger`-Knopf und mindestens einer weiteren Aktion trägt `size="middle"`. Der
  Vorgabewert ist hier **nicht** antds 8 px — antd mappt `spaceGapSmallSize` auf `paddingXS`,
  und das steht auf `abstand.xs` = 3/5/7 px je Stufe; `middle` führt auf `abstand.md` =
  11/18/26 und liegt damit in jeder Stufe über dem geforderten `token.marginSM`. Erzwungen von
  `components/aktionsabstand.guard.test.ts` — auf die in LFH-363 bewerteten Dateien **gescopt**,
  weil die danger-Nachbarschaft anders als eine Größen-Prop keine zählbare Eigenschaft ist,
  sondern eine Bewertung je Stelle; er wächst mit den Bündeln B5d–B5j. Geprüft wird der
  **Prop-Wert im Quelltext**, nicht ein Pixelabstand: jsdom rechnet kein Layout.
  **Destruktiv ist nicht gleich destruktiv** (Entscheidung aus LFH-363): „Außer Dienst" /
  „Deaktivieren" / eine gelöste Zuordnung sind **umkehrbar** — die Umkehrung steht als Knopf
  daneben —, sie bekommen Abstand und `danger`, aber keine zusätzliche Reibung. **Unumkehrbares**
  (heute nur „Löschen" in `stammdaten/StichworteTab.tsx`) bekommt zusätzlich eine Rückfrage.
  Jedes `Popconfirm` an einer destruktiven Aktion trägt `okButtonProps={{ danger: true }}` —
  sonst bestätigt man das Löschen mit einem blauen Knopf.
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