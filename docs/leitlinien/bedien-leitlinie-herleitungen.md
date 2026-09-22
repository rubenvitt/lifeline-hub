# Bedien-Leitlinie — Herleitungen und Prüfspuren

Ausgelagert aus `CLAUDE.md` (22.09.2026), weil die Datei das Zeichenlimit überschritt. Die
Regeln stehen weiterhin in Kurzform in `CLAUDE.md`, Abschnitt „Frontend — Bedien-Leitlinie
(Einsatzkontexte)"; hier steht der ungekürzte Wortlaut samt Messungen und Fallen.

## Dichte-Staffel, Klein-Angaben und handgebaute Bedienziele

**Dichte-Staffel 30 / 48 / 72 px** (kompakt aus LFH-352 · komfortabel = Material 48 dp ·
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
Dichtestufen prüfbar, ohne zu rendern), seit LFH-396 auch `pages/EinsaetzePage.tsx`
(`kartenTitelStil`). **Ein `<a>` erbt keine Steuerhöhe** (LFH-396, gemessen): der Titel-Link
der Einsatzkarte maß **17 px in jeder Stufe** — ein Inline-Anker im Kartenkopf ist so hoch
wie seine Zeile, und die Prüfliste von LFH-336 hatte „Card-Link erbt vom `ConfigProvider`"
als Annahme statt als Messung geführt. Wer einen `Link` als Tastaturziel in einen
**Kartenkopf** setzt (antds `Card title`, `white-space: nowrap`), gibt ihm die zwei Angaben —
dort mit `display: flex` statt `inline-flex`, damit der Text als Flex-Item weiter per Ellipsis
abschneidet. **Bekannter, davon abweichender Stand:** die zwei Titel-Links des
`Datensicht`-Primitivs (Tabellen- und Kartenzweig) tragen `inline-flex` mit nur `minHeight` und
sind so im Browser belegt (`e2e/datensicht-schmal.spec.ts`, 30 / 48 / 72) — das ist kein
Restposten, sondern der Beleg, dass in einer Zelle ohne `nowrap`-Kopf die eine Angabe trägt.
Die Regel zielt auf den Kartenkopf, nicht auf das Primitiv. **Der Gate-3-Nachweis je Route liegt in
`e2e/gate3-trefflaeche.spec.ts`** (Lage-Dashboard, Einsatzauswahl, Einheiten-Detailroute
und seit LFH-516 der **Einsatz-Navigationsrahmen**: Rail, Modul-Panel, beide Kopfzeilen,
Kommandopalette und der Drawer-Zweig auf 390 px); eine neue Route mit
handgebauten Bedienzielen bekommt dort ihren Test — Böden als Literale, Mengen über
`alleHaltenStufe` mit gesäter Mindestzahl, und die Mutationsprobe „Stufe festgenagelt →
rot", die das Ticket verlangt. **Ein Boden ist nicht immer die Staffel**: der Rahmen trägt
vier Verträge nebeneinander (30/48/72 · `Math.max(48, controlHeight)` an Rail, Hamburger,
schmalem Suchzugang und den Drawer-Modulzeilen · `Math.max(40, …)` am Benutzermenü · zwei
feste 48er im Drawer, gemessen in LFH-516 und als LFH-537 benannt). Wer eine Fläche
aufnimmt, schreibt ihren Boden als eigenes Literal hin, statt sie unter die Staffel zu
zwingen — `kompakt` prüfte sonst 30, wo der Code 48 garantiert, und die Zusicherung wäre
schwächer als der Bestand. Der Boden ist die **Trefffläche, nicht der ganze
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

## Datensatz-Aktionen bündeln

**Datensatz-Aktionen werden gebündelt, nicht aufgereiht** (LFH-365 · B5e nach dem Vorbild von
LFH-364). Ab drei Aktionen an einer Zeile oder Karte: ein `Dropdown` mit `menu={{ items }}`,
`trigger={['click']}`, `autoFocus` und einem icon-only `<Button type="text">` — kein `Popover`
(der trägt im Repo ausschließlich Inhalt und liefert keine `menuitem`-Rollen). Bleibt nach der
Sichtbarkeitsfilterung keine Aktion übrig, wird **gar kein** Auslöser gerendert statt eines
deaktivierten. Der zugängliche Name trägt die **Zeilenkennung** (`Aktionen zu Eintrag 7`), weil n
Zeilen sonst n gleichnamige Knöpfe liefern. Träger: `chat/NachrichtenStrom.tsx:88`,
`etb/EtbZeitachse.tsx` (vorher `EtbTabelle.tsx`), `etb/MetaChip.tsx`,
`pages/lagekarte/Sidebar.tsx` (Bild-Zeile).
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

## Rot bedient nichts: Marke, Fläche, danger-Abstand, Umkehrbarkeit

**Rot bedient nichts** (LFH-352/LFH-315): `bedien` und Fokusring sind blau, Rot ist Gefahr.
Jede Statusfarbe braucht einen **zweiten Kanal** (Text, Symbol, Form — WCAG 1.4.1). Farbwerte
kommen ausschließlich aus `theme/tokens.ts`/`theme/rollen.css`; ein abweichender Wert ist ein
Fehler, kein Vorschlag.
**Rot als MARKE ist keine Bedienung** (Neuentwurf 22.09.2026, Entscheidung 2): die aktive
Rail-Kategorie trägt einen 2-px-Strich in `marke` am linken Rand (`railZielStil` in
`einsatz/IconRail.tsx`, als inneres `boxShadow`, damit nichts verspringt), die Fläche ist
neutral `flaeche3`, das Etikett hell — Rot markiert den Ort, es bedient nichts. Vorher trug
der aktive Zustand eine blaue Vollfläche (LFH-328/A2). Primärknöpfe bleiben blau, `marke`
taugt nachts nicht als Textfarbe (2,57 : 1). **ETB-Typfarben** (Meldung blau, Anordnung
orange, Entscheidung violett, Lage cyan, Berichtigung rot, System neutral) erscheinen als
**2-px-Kante plus Typwort in Typfarbe, nicht als Etikett** — sie sind eine Kategorie, keine
Dringlichkeit, und liegen deshalb in `etbTypFarben*` statt auf der Statusachse; der frühere
„bewusste Auflösungsverlust" (`lage`/`entscheidung` → neutral) gilt nur noch fürs Etikett
`etbTyp` in `statusFarben.ts`. Das Rot der Berichtigung ist eine Kante, kein Bedienziel.
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
