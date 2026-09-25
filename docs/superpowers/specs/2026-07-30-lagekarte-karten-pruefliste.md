# Prüfliste Einsatztauglichkeit — Lagekarte und Kartenverwaltung (LFH-366 · B5f)

Gate 7 der Bedien-Leitlinie (`2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7)
verlangt diese Liste an jeder neuen oder umgebauten Seite. B5f fasst zwei Flächen an, die
zusammengehören, aber getrennt bedient werden: die **Lagekarte** (`pages/lagekarte/`, das
Arbeitsgerät im Einsatz) und die **Kartenverwaltung** (`karten/`, eingebettet in die
Admin-Karten-Seite und im Einsatz selten geöffnet). Wo sich die Bewertung unterscheidet, steht
das in der Zeile.

**Umfang:** `pages/lagekarte/Sidebar.tsx`, `AnsichtSwitcher.tsx`, `SnapshotLeiste.tsx`,
`HistorienBanner.tsx`, `KartenDetailCard.tsx` · `karten/OfflineKartenVerwaltung.tsx`,
`OnlineQuellenVerwaltung.tsx`, `OfflineVorhandeneModal.tsx`.

**Gemessene Baseline am 30.07.2026** (mit der Scan-Funktion des Dichte-Guards selbst, nicht per
Grep — die einzeilige Regex sah in `SnapshotLeiste.tsx` **keine einzige** der sieben Stellen;
`grep -cE '<Button[^>]*size="small"'` gegen die alte Datei liefert 0):

| Größe | vorher | nachher |
| --- | --- | --- |
| Klein-Angaben auf interaktiven Elementen in `karten/` + `pages/lagekarte/` | 16 in 6 Dateien | **0** |
| davon in `SnapshotLeiste.tsx`, alle mehrzeilig | 7 | **0** |
| Schuldzeilen für B5f in `dichte.guard.test.ts` | 6 | **0** |
| Restschuld des Guards über das ganze Frontend | 41 in 20 Dateien | **25 in 14 Dateien** ¹ |
| Dateien im Bereich von `aktionsabstand.guard.test.ts` | 14 | **16** |
| Bedienelemente in der Bild-Zeile der Sidebar | 3 Icon-Knöpfe + `<Space size={4}>` | **1 Auslöser, kein `<Space>`** |
| Zusicherungen auf die Bild-Zeile und den Bedienziel-Boden in `Sidebar.test.tsx` | 2 | **13** |

¹ Gemessen gegen die Basis dieses Bündels. **LFH-367 (B5g) ist parallel gelandet** und hat
eine weitere Stelle abgetragen (`uhs/MaterialTab.tsx`); im gemergten Stand steht der Guard
deshalb auf **24 in 13 Dateien**, und diese Zahl trägt CLAUDE.md. Die 25 hier sind kein
Fehler, sondern die Wirkung von B5f allein — beide Bündel waren aufeinander disjunkt
gestellt.

**`Sidebar.tsx` stand nie in der Schuldmenge.** Der Befund M61 des Elterntickets („Sidebar 38×
`size=small`") war zum Liefertag überholt: die Datei trug **0** Verstöße, ihre 15 Angaben sitzen
auf 11 `Card`, 3 `Liste` und 1 `Spin` und bleiben nach der Regel im Guard-Kopf stehen. Was an ihr
gültig blieb, war etwas anderes und stand nicht im Befund: die gestauchten **klickbaren**
Listeneinträge und die hart verdrahteten vier Pixel der Bild-Zeile.

---

| #  | Verdikt | Beleg / Zielticket |
| -- | ------- | ------------------ |
| 1 · Treffläche | **erfüllt, mit einer benannten Belegbarkeitsgrenze** | Kein interaktives Element im Umfang nagelt seine Fläche mehr fest — 16 Stellen entfernt, der Guard bestätigt 0. Dazu die Stelle, die **keine** Größen-Prop trug und trotzdem unter dem Boden lag: die klickbaren Einträge der Karte „Verortet" sind ein nacktes `<div onClick>` in `ListenEintrag`, dessen Höhe allein aus der Polsterung entstand (gemessen grob 54 px im Handschuh gegen die geforderten 72). Sie tragen jetzt `bedienzielStil` — `minHeight: token.controlHeight` **plus** Polsterung, die Zwei-Angaben-Konvention aus LFH-365. **Grenze:** die Höhe der antd-Knöpfe ist in Vitest nicht belegbar (`test/utils.tsx` mountet ein nacktes `ConfigProvider`, jsdom rechnet kein Layout). Belegt ist sie für die eine Stelle mit Inline-Style: drei Zusicherungen in `Sidebar.test.tsx` prüfen die Böden 30 / 48 / 72 als **Literale** plus die Ungleichheit über die Stufen |
| 2 · Handschuh-Modus | **teilweise erfüllt** | Die Stufe greift jetzt auf beiden Flächen. Der harte Fall war die **schwebende** `SnapshotLeiste`: grössere Knöpfe verdecken dort Kartenfläche, und genau deshalb verlangte das Ticket eine eigene Betrachtung statt eines blinden Attribut-Löschens. Entschieden zugunsten der Staffel, mit Grund: die Leiste ist die einzige Kartenaufbaute mit einer eigenen Antwort auf ihren Flächenverbrauch — sie klappt ein (LFH-353), eingeklappt bleibt genau ein Knopf. Ihr Rahmen trägt `flexWrap: 'wrap'`, sie wird also höher statt abgeschnitten. **Offen bleibt zweierlei:** die Ableitung der Stufe aus dem Einsatzkontext (LFH-361/B5a) → **B5-Restpunkt**; und die tatsächlich gerenderte Höhe, die nur Playwright messen kann → **LFH-373** |
| 3 · Rückmeldung vor der Serverantwort | **erfüllt** | Unverändert durch B5f und schon vorher tragend: `kartenQuery.isLoading` / `quellenQuery.isLoading` an beiden Verwaltungstabellen, `neuLadenMutation.isPending` am Neu-Laden, `sichertGerade` am „Stand sichern", `props.ansichtSpeichert` am Speichern-Knopf der Sidebar, `busy` am Ansichts-Auslöser. Optimistische Updates gibt es weiterhin nirgends → **B6 (LFH-334)** |
| 4 · Kritische Aktion hat eine zweite Handlung | **erfüllt — und das ist die zweite Kernverbesserung** | Drei destruktive Aktionen im Umfang, alle mit Rückfrage und rotem Bestätigungsknopf. **Bild entfernen** (Sidebar) hatte die Bestätigung entgegen der Ticket-Prämisse schon; gefehlt haben die **Trennung** und `okButtonProps={{ danger: true }}`. Beides steht jetzt: die Trennung ist der Menü-Trenner unmittelbar vor dem Eintrag (gepinnt), der rote Knopf ist gepinnt über `ant-btn-dangerous`, und der Aufruf erfolgt nachweislich **erst nach** der Bestätigung. **Mit einer Grenze, die dazugehört:** der Trenner trennt *visuell* — eine sichtbare Linie ist ein zweiter Kanal, den die abgelösten vier Pixel nie hatten —, aber sein eigener Weissraum ist mit ~3 px genauso dichteblind wie sie. antd rechnet ihn aus `lineWidth`, und `theme/tokens.ts` fasst das nicht an. Was mitzieht, sind die **Zeilenhöhen** des Menüs (`itemHeight` ← `controlHeightLG`): die beiden Ziele stehen im Handschuh-Betrieb weit auseinander, weil sie selbst wachsen, nicht weil der Trenner es tut. Das steht auch am Code. **Offline-Karte** und **Online-Quelle** löschen trugen `okButtonProps` bereits; ihnen fehlte der Abstand zur neutralen Nachbaraktion (`<Space>` im Vorgabemaß = `abstand.xs` = 3/5/7 px). Beide stehen jetzt auf `size="middle"` und werden von `aktionsabstand.guard.test.ts` gehalten — mit Mutationsprobe belegt |
| 5 · Kontrast in beiden Modi | **erfüllt für B5f, ein Bestandsbefund daneben** | B5f führt keinen Farbwert ein; `theme/gate5.guard.test.ts` ist grün. **Bestandsbefund, nicht von diesem Bündel verursacht:** die Kartenlayer halten Signaturfarben als Hex-Literale (`kartenLayer.ts`, `markerLayer.ts`, `fachebenen.ts`). Das ist derselbe Fall wie die persistierte Zonen-`farbe`, für den `Sidebar.tsx` bereits eine ausgeschriebene Begründung trägt: es sind **kartografische** Werte, die MapLibre rendert, keine UI-Rollen — ein Themenwechsel darf eine gespeicherte Signatur nicht uminterpretieren |
| 6 · Kein Status allein über Farbe | **erfüllt** | Die Statusträger beider Verwaltungen sind Text-Tags („aktiv" / „inaktiv" / „bereit" / „wird angezeigt"), nicht Farbflächen. Der neue destruktive Menü-Eintrag trägt **Wort plus Symbol** („Bild entfernen …" mit Mülleimer), das Rot ist der dritte Kanal, nicht der einzige. Der Historien-Modus meldet seine Schreibsperre im Klartext („Historischer Stand — schreibgeschützt"), nicht über die Warnfarbe des Alerts allein |
| 7 · Eine Farbe = eine Bedeutung | **erfüllt** | Keine neue Farbbelegung. `danger` steht im Umfang ausschließlich an den drei Löschwegen aus Zeile 4 |
| 8 · Helligkeits-/Kontrastregler | **offen** | Weiterhin keiner in der Anwendung; A0 hat ihn ausdrücklich weiterverwiesen → **Folge-Task aus A0** |
| 9 · Kritische Anzeigen im Blickfeld | **erfüllt** | Der `HistorienBanner` — die Anzeige, deren Übersehen am teuersten ist, weil sie sagt, dass die Karte nicht die Lage zeigt — steht oben und schwebt über der Kartenfläche; sein Rückweg ist ein Knopf in derselben Zeile und erbt jetzt die Staffel. Die Zeitachse liegt unten, außerhalb des Kartenmittelpunkts. Der `KartenDetailCard`-Inspektor sitzt oben rechts und ist scrollbegrenzt (`maxHeight: calc(100% - 24px)`), verdeckt also nie die ganze Karte |
| 10 · Alarmbudget | **nicht anwendbar** | Die Karte zeigt Lage, sie alarmiert nicht. Die Fachebenen (NINA/DWD/Pegel) bringen amtliche Warnungen als **Layer** ein — sie erscheinen als Fläche auf der Karte, nicht als Meldung mit Eskalationsstufe. Die In-App-Alarmierung liegt bei `einsatz/AlarmZentrale.tsx` und damit außerhalb dieses Umfangs |
| 11 · Warnverhalten | **erfüllt** | Kein Blinken, kein Ton im Umfang. Der Historien-Banner ist ein statischer Alert; das Einklappen der Zeitachse stoppt eine laufende Wiedergabe ausdrücklich, damit die Karte nicht weiterschaltet, während die Pause-Taste unsichtbar ist |
| 12 · Kein Sprung unter dem Cursor | **teilweise erfüllt, eine benannte Bewegung** | **Erledigt:** die Bild-Zeile wird schmaler und ruhiger — aus drei Icon-Knöpfen in einer 300 px breiten Leiste wird ein Auslöser, und die vier hart verdrahteten Pixel zwischen dem harmlosen und dem roten Knopf verschwinden mitsamt ihrem `<Space>`. **Benannt und in Kauf genommen:** die schwebende Zeitachse wird auf höheren Dichtestufen höher (Umbruch über `flexWrap`), was am unteren Kartenrand Fläche kostet. Das ist der gewollte Effekt aus Zeile 2 und über den Einklapp-Weg abwählbar; wie viel es bei ~390 px ausmacht, ist **nicht gemessen** — jsdom rechnet kein Layout. **Offen, Bestand:** Marker fahren über den SSE-Fan-out direkt in die Karte, ohne Sammelbanner → **B6 (LFH-334)** |
| 13 · Fokus nie verdeckt | **offen** | Die Lagekarte trägt vier `position: absolute`-Aufbauten mit `zIndex: 5` (Zeitachse, Historien-Banner, Detail-Karte, Zeichensteuerung). Sie liegen über der **Kartenfläche**, nicht über der Sidebar, und die Karte selbst hat keine Tab-Stopps — das spricht dagegen, dass ein Fokusziel dahinter landet. Belegt ist es nicht, und in jsdom ist es nicht belegbar → **LFH-373** |
| 14 · Tabellenseite vollständig | **teilweise erfüllt → LFH-374** (Nachtrag 25.09.2026: **eingelöst durch LFH-374**, Verdikt „erfüllt“ in `openspec/changes/lfh-374-spaltenschalter-katalogtabelle/pruefliste.md`) | Beide Verwaltungen laufen über `KatalogTabelle` (LFH-329/B1): Scrollcontainer, stehende Kopfzeile, fixierte erste Spalte als **menschenlesbare** Kennung (Name der Karte bzw. der Quelle, nie die DB-`id`) ✓. Keine Auflösung in Karten ✓ — beides sind Vergleichsansichten („welche Karte liegt hier, welche Quelle ist aktiv?"). Freitextsuche mit benanntem Platzhalter ✓, Filter auf „aktiv" ✓. **Offen:** ein **umschaltbarer Spaltensatz mit Zähler ausgeblendeter Spalten** fehlt — beide nutzen `KatalogTabelle`, nicht `Datensicht`. Bestand, nicht von B5f verursacht, und dieselbe Lage wie beim ETB (LFH-365, Zeile 14) |
| 15 · Erfassungsmaske vollständig | **erfüllt** (Nachtrag 24.09.2026, LFH-376) | Beim Anlegen dieser Liste waren `karten/OnlineQuelleFormModal.tsx` und `karten/OfflineDownloadUrlModal.tsx` handgebaute `<Modal>` + `<Form>` mit `onOk={() => form.submit()}`: der Absende-Knopf lag **außerhalb** des Formulars, **Enter war dort tot** — wörtlich Befund H69 aus LFH-332/B4. B5f fasste keine der beiden Dateien an und hat den Befund deshalb als Nachzug getickt. **Umgestellt hat sie LFH-346/A6** (`2fbb4887`, 25.08.2026): beide tragen `ErfassungsModal`, `onErfassen` läuft über `mutateAsync`, der Reset-Effekt des Aufrufers ist weg. `serie`/`uebernahme` sind bewusst nicht gesetzt (seltene Admin-Vorgänge, kein Erfassungsstrom). **Was fehlte, war der Beleg der Wirkung**, nicht nur der Struktur: LFH-376 ergänzt je Dialog einen Test „Enter im URL-Feld sendet ab“ und die Gegenprobe „Enter in der Attribution bricht um“. Mutationsprobe: der Absende-Knopf der Hülle zurück auf `htmlType="button"` + `onClick={() => form.submit()}` (das alte Muster) färbt **genau** die beiden Enter-Tests rot, der Klickweg und die Gegenproben bleiben grün |

**0 Zeilen ohne Verdikt.** 10 erfüllt, 3 teilweise, 2 offen (Stand 24.09.2026; beim Anlegen 9/3/3, Zeile 15 hat LFH-376 geschlossen) — jede offene mit Ziel:

| Zeile | offen woran | Ziel |
| --- | --- | --- |
| 12, 3 | Sammelbanner statt eingeschobener Live-Marker; optimistische Updates | **B6 (LFH-334)** — Ticket existiert |
| 8 | kein Helligkeitsregler in der Anwendung | Folge-Task aus A0, dort ausdrücklich weiterverwiesen |
| 2 | Dichtestufe wird nicht aus dem Einsatzkontext abgeleitet | B5-Restpunkt (LFH-333), seit 25.09.2026 **LFH-724** |
| 2, 12, 13 | ~~Layout-Nachweise, die jsdom nicht führen kann: Höhe im Handschuh, Zeitachse bei ~390 px, Fokus hinter den schwebenden Aufbauten~~ — gemessen und behoben 25.09.2026, siehe „Nachtrag LFH-373“ | **LFH-373** |
| 14 | Spaltenschalter mit Zähler fehlt (`KatalogTabelle` statt `Datensicht`) | **LFH-374** — ebenfalls ETB-formuliert, gilt für beide Kartenverwaltungen genauso. **Eingelöst (25.09.2026):** Opt-in `spaltenSchalter` an `KatalogTabelle`, siehe `openspec/changes/lfh-374-spaltenschalter-katalogtabelle/pruefliste.md` |

Alle fünf Zeilen zeigen auf eine Nummer, die es gibt. **LFH-373 und LFH-374 sind geerbt, nicht
neu:** LFH-365 hat sie für das Einsatztagebuch angelegt, und beide Restpunkte sind hier
wortgleich dieselben — der erste Dichte-e2e-Nachweis des Repos und der fehlende Spaltenschalter
in `KatalogTabelle`. Ein zweiter Task für denselben Rest wäre eine Dublette; was fehlt, ist die
**Erweiterung des Umfangs** beider Tickets um `pages/lagekarte/` und `karten/`, und genau das
steht in der Zeile.

---

## Zwei Entscheidungen, die das Ticket offen gelassen hat

**„Platzieren" wandert mit — alle drei Aktionen liegen im Menü.** Die Frage im Ticket war, ob nur
„Löschen" wandert (dann ein Menü mit einem Eintrag neben zwei Icons) oder mehr. Entschieden nach
der Norm aus LFH-365, die wörtlich „ab drei Aktionen an einer Zeile" sagt: drei Aktionen, ein
Auslöser. Das löst zugleich das Platzproblem — in einer 300 px breiten Leiste stehen neben einem
Schalter und einem umbenennbaren Namen sonst drei Trefflächen à 72 px.

Die Zählung erfolgt **nach** der Rechteprüfung. Ohne Schreibrecht bleibt genau eine Aktion übrig
(„zentrieren"), und dafür ist ein Menü keine Bündelung, sondern ein Umweg — dort steht der Knopf
weiter direkt da. Beide Fälle sind als **Paar** gepinnt: der Zentrieren-Test allein bliebe auch
grün, wenn die Bündelung gar nicht griffe oder ein zweiter Knopf danebenstünde.

**Die harten `marginBottom: 12` bleiben stehen.** Das Ticket verlangte für den `<Space size={4}>`
„auf ein Token ziehen" und warnte, dass `:230`/`:408` dieselbe Zahl tragen. Der `<Space>` ist mit
der Bündelung **ersatzlos entfallen** — das Token-Ziel erledigt sich damit an der Stelle, um die
es ging. Die zwölf Karten-Abstände sind eine andere Sache: eine Umstellung träfe alle auf einmal
und wäre eine reine Sichtänderung an der meistgenutzten Fläche der Anwendung, die jsdom nicht
nachrechnen kann. Das ist Tokenisierung (A2-Linie), nicht Dichte. Als **LFH-377** getickt; die
Begründung steht zusätzlich im Dateikopf von `Sidebar.tsx`, damit sie beim nächsten Zugriff
gefunden wird.

> **Nachtrag 24.09.2026 (LFH-377, erledigt).** Den Kartenstapel hat der Neuentwurf S5
> (22.09.2026) abgelöst: die Leiste trennt ihre Abschnitte mit Haarlinien
> (`KlappPaneel`/`LeistenAbschnitt`) und polstert sie mit `token.padding`; der Absatz im
> Dateikopf ist mit dem Stapel entfallen. Übrig waren ein Nachzügler aus dem alten Stapel —
> `AnsichtSwitcher` trug `marginBottom: 12` **in** einem schon gepolsterten Paneel, der Abstand
> unter dem Auswahlfeld lag damit bei Polsterung plus 12 px; entfernt, die Polsterung trägt ihn
> allein — und die Abstände der Bild-Zeile (6/4 px → `paddingSM`/`marginSM`/`marginXS`).
> **Die Breite bleibt fest 300 px** (`LEISTE_BREITE`), bewusst: Polsterung und Zeilenabstand
> wachsen mit der Dichte, die Leiste nicht. Im Browser gemessen (1100 × 800, zwei Bilder): die
> Bild-Zeile ist in **kompakt** 277 px breit (Schalter 43 · Name 190 · Auslöser 30, Abstand
> 7), in **Handschuh** 247 px (Schalter 46 · Name 97 · Auslöser 72, Abstand 16), in beiden
> Stufen ohne Überlauf (`scrollWidth` = `clientWidth`). Der Name kürzt im Handschuh-Betrieb mit
> Tooltip; die 20 px, die der feste Abstand ihm ließe, stünden dort zwischen Stift und
> Aktionsauslöser, also zwischen zwei Trefflächen. Nachweis über die **Quelle**:
> `pages/lagekarte/leistenAbstand.guard.test.ts` scannt `Sidebar.tsx`, `KlappPaneel.tsx` und
> `AnsichtSwitcher.tsx` über den TS-Syntaxbaum (Kommentare zählen nicht) auf feste Abstände
> in Stilobjekten und an `Space`/`Flex`/`Row`, mit Selbsttest; was er nicht sieht (Wert aus
> einer Variablen, Spread aus einer fremden Datei, CSS), steht in seinem Dateikopf.
> **Bewusst ausgelassen:** die Inspectors, die im Abschnitt „Ausgewählt" hängen
> (`FachebenenInspector` mit `marginBottom: 8`, `Inspector`/`KartenDetailCard` mit `gap: 3`),
> und die Bänder über der Karte (`SnapshotLeiste`). Das sind Abstände im Inneren eigener
> Bausteine, keine Kartenabstände der Leiste. Sie stehen als **LFH-703** auf dem Board.

---

## Nachtrag LFH-373 (Messung, 25.09.2026)

Die Zeilen 2, 12 und 13 standen hier seit dem 30.07. offen. LFH-373 hat sie im Browser
gemessen, zwei Befunde waren **rot** und sind im selben Ticket behoben. Korrekturen am
Wortlaut oben:
- Der Historien-Banner steht inzwischen im Fluss, der Inspector sitzt in der Leiste.
- Zeichensteuerung und Zeitachse sind Bänder im `KartenFuss` (LFH-355).
- Die „Verortet“-Einträge sind seit `KlickbareZeile` fokussierbar (`role="button"`), sie
  gehören also in den Tab-Durchlauf.
- Die Lagekarte ist auch bei 390 px messbar: Die Leiste liegt dort unter der Karte und lässt
  sich ausblenden.

| # | Verdikt | Messung / Nachweis |
| -- | ------- | ------------------ |
| 2 · Handschuh-Modus | **erfüllt nach Fix** (die Stufenableitung → **LFH-724**) | `e2e/gate3-trefflaeche.spec.ts`, „Lagekarte (LFH-373)“, bei 1366 × 768: „Verortet“ 35,5 / 48 / 72 px, Kartenknöpfe (kurze Achse, Boden 32 / 48 / 72) 32 / 48 / 72, Knöpfe der Zeitachse 30 / 48 / 72; Gegenprobe kompakt < handschuh. „Abspielen“ bei 390 px in `e2e/leisten-flaeche.spec.ts`. **Vorher gemessen:** „Abspielen“ schrumpfte als Flex-Kind auf 16–17 px Breite. **Behoben:** `abspielenStil` (`flexShrink: 0`). |
| 12 · Kein Sprung unter dem Cursor | **erfüllt nach Fix** | `e2e/leisten-flaeche.spec.ts`. Die ausgeklappte Zeitachse belegt ≤ 50 % der Kartenhöhe: Fükw 13 / 22 / 30 %, Tablet 19 / 31 / 49 %, Handschirm ohne Leiste 23 / 31 / 46 %. Kein Knopf ragt über den Bandrand, das Band bleibt in der Kartenspalte. Mit eingeblendeter Leiste auf dem Handschirm deckt das Band 41 / 56 / 84 % der dann nur 337–382 px hohen Karte. Dort gilt bewusst kein Deckel, nur „in der Spalte, ohne Überlauf, ohne Überschneidung“. Das Laden auf dem Handschirm erreicht CLS 0,0015 / 0,0033. **Entscheidung 25.09.2026:** Bei 1440 × 900 darf die Zeitachse zwei Reihen tragen (73 statt 46 px). Das ist der Preis der Aufteilung aus Zeile 13, `lagekarte-smoke.spec.ts` ist entsprechend angepasst. Offen zu beobachten: 49 % am Tablet im Handschuh-Betrieb liegen nah am Deckel und können mit den Schriften der CI kippen. |
| 13 · Fokus nie verdeckt | **erfüllt nach Fix** | `e2e/fokus-verdeckung.spec.ts`, „Lagekarte (LFH-373)“, bei 390 × 844 mit und ohne Leiste und bei 1024 × 768, handschuh. Der Kern läuft mit den Kartenaufbauten als Zusatzkandidaten (Opt-in, Selbstbeweis im selben Spec): 12 Stopps in der Kartenspalte, 0 verdeckt. Der Rechteckschnitt Knopfblock ↔ Fußband ergibt 0, die Trefferprobe `click({ trial: true })` greift an jedem Kartenknopf. **Vorher gemessen:** Bei 390 px lagen „Herauszoomen“, „Nach Norden ausrichten“ und „Messen“ **vollständig** unter dem Zeitachsenband, auch per Zeiger unerreichbar. Bei 1024 px lag „Zeichenwerkzeuge“ zu 92 % darunter. **Behoben:** Der Fuß endet vor der Knopfspalte (`fussStil(knopfKante)`, Aufteilung statt `zIndex`). Das Bezeichnungsfeld hat keine feste Breite mehr, und die Zeitleiste bricht um. |


## Was diese Prüfliste nicht beweist

**Die Zahlen der Baseline sind Scanner-Zahlen, keine Verhaltensbelege.** „0 Klein-Angaben in
`karten/` und `pages/lagekarte/`" heißt: der Dichte-Guard findet dort keine mehr. Er sieht nach
seinem eigenen Kopfkommentar weiterhin kein gespreiztes `{...props}`, keine Größe aus einer
Variablen und keine Wrapper-Komponente, die die Prop intern setzt.

**Der Bedienziel-Boden ist nicht der ganze Zugang.** `bedienzielStil` trägt die Trefffläche der
klickbaren Listeneinträge. Es bleibt ein `<div onClick>` **ohne** `role`, `tabIndex` und
`onKeyDown` — per Tastatur ist die Zeile weiterhin nicht erreichbar. Das zu ändern hieße,
`components/Liste.tsx` anzufassen, und die klickbare Zeile als Ganzes ist in
`components/Datensicht.tsx` (Festlegung 4) ausdrücklich **B7 (LFH-335)** zugeordnet. Hier wurde
der Boden gelegt, nicht der Zugang gebaut.

**Kein Guard sieht die neue Trennung in der Sidebar.** `aktionsabstand.guard.test.ts` matcht
`<Button` mit `danger` im Tag; ein `danger`-**Menüeintrag** ist für ihn unsichtbar. Die Datei in
seinen Bereich aufzunehmen behauptete eine Deckung, die er nicht hat — sie steht deshalb in
keiner seiner beiden Listen. Was die Trennung hält, sind die Zusicherungen in `Sidebar.test.tsx`:
dass genau ein Trenner existiert und dass er unmittelbar vor „Bild entfernen" sitzt.

**Beide Guards wurden gegen sich selbst geprüft.** Ein grüner Guard nach dem Kürzen seiner
Schuldmenge ist von einem blind gewordenen nicht zu unterscheiden. Mutationsprobe am 30.07.2026:
`size="middle"` in `OnlineQuellenVerwaltung.tsx` zurückgedreht → Abstands-Guard meldet
`:133`; eine Klein-Angabe in `SnapshotLeiste.tsx` zurückgesetzt → Dichte-Guard meldet `:217`.
Beide danach wiederhergestellt.
