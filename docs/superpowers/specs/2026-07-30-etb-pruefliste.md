# Prüfliste Einsatztauglichkeit — Einsatztagebuch (LFH-365 · B5e)

Gate 7 der Bedien-Leitlinie (`2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7)
verlangt diese Liste an jeder neuen oder umgebauten Seite. B5e baut die **Seite ETB** an sechs
Stellen um; die Liste bewertet deshalb die Seite als Ganzes und nennt in jeder Zeile, was von
diesem Bündel kommt und was Bestand ist.

**Umfang:** `pages/EtbPage.tsx` mit `etb/EtbTabelle.tsx`, `etb/MetaChip.tsx`,
`etb/BuchstabierHilfe.tsx`, `etb/SlashMenu.tsx`, `etb/Schnellerfassung.tsx`,
`etb/entwuerfe/EtbEntwurfsTabs.tsx`, `etb/EtbFilterleiste.tsx` · der angepinnte Erfassungskopf
`.etb-erfassung-sticky` (`index.css:51-66`).

**Gemessene Baseline am 30.07.2026** (mit der Scan-Funktion des Dichte-Guards selbst, nicht per
Grep):

| Größe | vorher | nachher |
| --- | --- | --- |
| Klein-Angaben auf interaktiven Elementen in `etb/` + `pages/EtbPage.tsx` | 8 in 3 Dateien | **0** |
| Schuldzeilen für B5e in `dichte.guard.test.ts` | 3 | **0** |
| Restschuld des Guards über das ganze Frontend | 49 in 23 Dateien | **41 in 20 Dateien** |
| Zusicherungen auf die Aktionsspalte in `EtbTabelle.test.tsx` | 0 | **7** |
| dichteblinde Pixel-Paddings in `SlashMenu.tsx` | 3 (`:63`, `:75`, `:102`) | **0** |

---

| #  | Verdikt | Beleg / Zielticket |
| -- | ------- | ------------------ |
| 1 · Treffläche | **erfüllt, mit einer benannten Belegbarkeitsgrenze** | Alle drei neuen Auslöser (Zeilenmenü in `EtbTabelle.tsx`, Chip-Menü in `MetaChip.tsx`, Buchstabierhilfe) tragen **kein** `size`-Prop und erben `controlHeight` — 30 / 48 / 72 px. Das ist der Kern dieses Bündels: vorher nagelten 8 Stellen ihre Fläche auf die Kleingröße, darunter der `Space.Compact`-Wrapper, der sie über den Kontext auch Kindern ohne eigene Prop auftrug. Ersetzt wurden zwei Flächen deutlich **unter** dem Boden: das ~10-px-`closeIcon` am Chip und das nackte ⧖ (kein Klickziel, aber der einzige Träger der Nachtrags-Aussage). **Grenze:** die Höhe der antd-Knöpfe ist in Vitest nicht belegbar — `test/utils.tsx:31` mountet ein nacktes `ConfigProvider` ohne Theme, jede Messung dort ergäbe antd-Vorgaben. Belegt ist sie für die eine Stelle, die einen Inline-Style trägt: `SlashMenu.test.tsx` prüft `minHeight` gegen die Böden 24 / 48 / 72 als Literale |
| 2 · Handschuh-Modus | **teilweise erfüllt** | Die Stufe greift jetzt auf der ganzen Seite: kein Element im Umfang hält seine Größe mehr fest, die Optionszeilen des Slash-Menüs tragen `minHeight: token.controlHeight` (72 px im Handschuh, vorher grob 16 px Polsterung plus Zeilenbox). **Offen bleibt zweierlei:** die Ableitung der Stufe aus dem Einsatzkontext hängt weiter an `localStorage['lifeline-hub.dichte']` mit Vorbelegung über die Zeigerart (LFH-361/B5a) → **B5-Restpunkt**; und die tatsächlich gerenderte Zeilenhöhe ist nur im Browser messbar — jsdom rechnet kein Layout, belegt ist die Inline-Style-Absicht. Der Nachweis am echten Baum wäre `boundingBox().height >= 72` in Playwright und ist **nicht** Teil dieses Bündels → **LFH-373** |
| 3 · Rückmeldung vor der Serverantwort | **erfüllt** | Unverändert durch B5e und schon vorher tragend: `abschliessenMutation.isPending` am Abschluss-Knopf (`EtbPage.tsx:240`), `isFetchingNextPage` am Nachladen (`:345`), `senden={auftragMutation.isPending}` am Auftragsmodal (`:363`), `ladend` bis an die Tabelle (`EtbTabelle.tsx`, gepinnt über `.ant-spin-spinning`). Die Offline-Warteschlange meldet gepufferte und abgelehnte Einträge als Alert über der Tabelle. Optimistische Updates gibt es weiterhin nirgends → **B6 (LFH-334)** |
| 4 · Kritische Aktion hat eine zweite Handlung | **erfüllt** | Das Tagebuch ist **append-only**: es gibt kein Löschen, eine falsche Aussage wird durch eine Berichtigung ergänzt, die beide Richtungen verlinkt (`EtbTabelle.tsx`, „berichtigt #n" / „berichtigt durch #n"). Die einzige irreversible Aktion der Seite ist das Abschließen des Tagebuchs, und sie trägt eine Rückfrage mit Folgesatz „Danach sind keine neuen Einträge oder Berichtigungen mehr möglich." (`EtbPage.tsx:235`). **Zum neuen `danger`-Item „Entfernen" am Chip:** es entfernt ein Metadatenfeld eines noch nicht abgeschickten Entwurfs und ist umkehrbar — „Bearbeiten" steht im selben Menü, und `Schnellerfassung.tsx` setzt den Wert auf `undefined`, ohne den Entwurfstext anzutasten. Nach der Trennlinie aus LFH-363 (umkehrbar → Abstand und `danger`, aber keine zusätzliche Reibung) ist eine Rückfrage hier falsch, nicht fehlend |
| 5 · Kontrast in beiden Modi | **erfüllt für B5e, ein Bestandsbefund daneben** | B5e führt keinen Farbwert ein. Der neue `<Tag>Nachtrag</Tag>` ist **absichtlich farblos** und nimmt die neutrale antd-Fläche; das Menü und seine Einträge liegen im Theme. `theme/gate5.guard.test.ts` ist grün. **Bestandsbefund, nicht von diesem Bündel verursacht:** `.etb-erfassung-sticky` (`index.css:51-66`) hält vier hartkodierte Werte (`#f5f5f5`, `#e8e8e8`, `#000`, `#1f1f1f`) statt Rollen aus `theme/rollen.css`. Der angepinnte Kopf war nicht Teil des Umfangs; wer ihn anfasst, zieht sie mit → **LFH-375** |
| 6 · Kein Status allein über Farbe | **erfüllt — und das ist die Kernverbesserung dieses Bündels** | Das Nachtrags-Merkmal trug seine Aussage vorher allein im Zeichen ⧖, also weder als Wort noch als Farbe, sondern als Symbol, das man kennen musste; jetzt steht dort das Wort **„Nachtrag"**. Zwei Dinge daran sind gemessen: das `aria-label="nachgetragen"` ist **gelöscht**, weil es in der Namensrechnung (accname 2C) den sichtbaren Inhalt (2F) schlägt und damit jede Zusicherung auf eine *sichtbare* Beschriftung unwiderlegbar machte — sie war grün, als dort nur das Zeichen stand. Und das Zeichen ist **ersetzt**, nicht ergänzt: eine Zusicherung auf sein Verschwinden hält das fest. Die übrigen Statusträger der Seite haben ihren zweiten Kanal schon (`StatusTag` mit Text, Berichtigungs-Tags mit laufender Nummer) |
| 7 · Eine Farbe = eine Bedeutung | **erfüllt** | Keine neue Farbbelegung. Das einzige `danger` der Seite außerhalb des Abschlusses ist das neue Menü-Item „Entfernen" — Gefahr, nicht Bedienung; die Bedienfarbe der Schreibfläche im Erfassungskopf bleibt blau (`index.css:68-70` begründet das ausdrücklich mit „Rot bedient nichts") |
| 8 · Helligkeits-/Kontrastregler | **offen** | Weiterhin keiner in der Anwendung; A0 hat ihn ausdrücklich weiterverwiesen → **eigener Folge-Task aus A0** („Was diese Leitlinie nicht entscheidet") |
| 9 · Kritische Anzeigen im Blickfeld | **erfüllt** | Der Erfassungskopf liegt oben und bleibt beim Rollen stehen (`position: sticky; top: 0`), die Chronologie darunter — die Reihenfolge „was ich schreibe" über „was geschrieben wurde" bleibt unverändert. Die Fehlermeldung des Abrufs steht **über** der Tabelle und tauscht sie nicht aus, bereits geladene Einträge bleiben lesbar (Spec-Festlegung D4). Das Zeilenmenü sitzt am rechten Zeilenende, wo es vorher auch saß |
| 10 · Alarmbudget | **nicht anwendbar** | Das Tagebuch erzeugt keine Alarme, es schreibt Einträge. Die Wiedervorlage legt eine Erinnerung an; deren Fälligkeits-Verhalten gehört dem Erinnerungs-Scheduler, nicht dieser Seite |
| 11 · Warnverhalten | **erfüllt** | Kein Blinken, kein Ton. Die Offline-Zustände (gepuffert / abgelehnt) stehen als Alert mit Text, das Verwerfen eines abgelehnten Eintrags ist ein Knopf in derselben Zeile — er hatte bis B5e eine Klein-Angabe und erbt seine Fläche jetzt |
| 12 · Kein Sprung unter dem Cursor | **teilweise erfüllt, zwei benannte Bewegungen** | **Erledigt:** die Zeilen-Aktionen springen nicht mehr um. Sie standen in einem `<Space wrap>` mit drei Knöpfen unterschiedlicher Textlänge, dessen Umbruch von der Spaltenbreite abhing; ein Menü hat eine feste Breite, und die Spalte fällt von 230 auf 96 px. **Benannt und in Kauf genommen:** die Chip-Leiste des Erfassungskopfs wird höher, weil der Auslöser im Chip seine Fläche jetzt aus der Dichtestufe nimmt (vorher ~10 px). Das ist der gewollte Effekt und in der kompakten Stufe klein; ob die Leiste im Handschuh-Betrieb auf ~390 px umbricht und den Kopf wachsen lässt, ist **nicht gemessen** — jsdom rechnet kein Layout, und der angepinnte Kopf verschiebt beim Wachsen die Tabelle darunter. **Offen, Bestand:** neue Einträge fahren über den SSE-Fan-out direkt in die Liste, ohne Sammelbanner → **B6 (LFH-334)** |
| 13 · Fokus nie verdeckt | **offen** | Die Seite trägt das **einzige** `position: sticky` des Frontends (`.etb-erfassung-sticky`, `z-index: 20`) und ist damit der Kandidat für WCAG 2.4.11 schlechthin. B5e **verbessert** die Lage an einer Stelle — die drei Tab-Stopps je Zeile werden zu einem, ein Tab-Durchlauf durch die Chronologie hat also ein Drittel der Ziele —, aber ob ein Fokusziel beim Durchtabben hinter dem Kopf landet, ist damit nicht beantwortet. Die Tabelle rollt in einem eigenen Container (`KatalogTabelle`), was dagegen spricht; belegt ist es nicht, und in jsdom ist es nicht belegbar → **LFH-373** |
| 14 · Tabellenseite vollständig | **teilweise erfüllt** | Über `KatalogTabelle` (LFH-329/B1): Scrollcontainer, stehende Kopfzeile, fixierte **menschenlesbare** Kennung (`lfd_nr`, nie die DB-`id`) ✓. Keine Auflösung in Karten ✓ — die Chronologie wird verglichen, sie bleibt eine Tabelle. Der neue Zeilen-Auslöser trägt die `lfd_nr` in seinem zugänglichen Namen, damit n gleichnamige Knöpfe unterscheidbar sind (Festlegung aus LFH-364). **Offen:** ein **umschaltbarer Spaltensatz mit Zähler ausgeblendeter Spalten** fehlt — die Seite nutzt `KatalogTabelle`, nicht `Datensicht`, und hat damit keinen Spaltenschalter. Das ist Bestand, nicht durch B5e verursacht, und die sieben Spalten sind auf einem Handschirm breiter als der Schirm → **LFH-374** |
| 1a · Nachtrag aus dem Review | **behoben** | Der adversarische Review fand sechs Dinge, die alle Gates passiert hatten; zwei davon waren echte Bedienfehler. **(a)** Ein Fehlgriff auf das Menü des Chips schaltete in den Editor: das Overlay trägt rings um seine Einträge ein 4-px-Polsterband (`dropdownEdgeChildPadding` → `paddingXXS`, vom Projekt-Theme nicht überschrieben, also in **jeder** Dichtestufe gleich schmal), und weil das Overlay ein React-Kind des Chips war, stieg ein Klick darauf durch den Komponentenbaum bis zum `onClick` des `Tag` auf — über die Portal-Grenze hinweg. Das Menü schloss ohne Aktion, der Chip sprang in den Editor, dessen `autoFocus` den Fokus aus dem Inhaltsfeld zog. Die zwei vorhandenen Riegel fingen es nicht: einer saß am Auslöser, einer am Menü-`onClick`, und der feuert nur für Einträge. Behoben nicht durch einen dritten Riegel, sondern indem der Schnellweg an einen **Geschwisterknoten** des Menüs wanderte — ohne klickbaren Vorfahren braucht es überhaupt kein `stopPropagation` mehr. **(b)** Tooltip und Popover der Buchstabierhilfe standen gleichzeitig offen: gemeinsamer Anker, gemeinsame Ausrichtungsregel, und der Tooltip liegt per z-index oben (`+70` gegen `+30`) — er verdeckte die erste Zeile der Buchstabiertafel. Auf Touch ist das der Normalfall, weil rc-trigger einem Hover-Auslöser zusätzlich `touch` gibt und ein Tipp beides öffnet; das Führungs-Tablet ist Primärkontext. Behoben über den hochgezogenen Popover-Zustand. Dazu drei Test-Stärke-Lücken (der `Berichtigen`-Zweig des Schlüssel-Versands war nirgends angeklickt; `minHeight` hatte nur eine untere Schranke, kein Variationspaar — ein dichteblindes `minHeight: 72` passierte gemessen alle neun Fälle; die Spaltenweiche war unter keiner Einzelmutation gepinnt) und das fehlende `autoFocus` am Chip-Menü. Alle sechs behoben, die drei neuen Pins je mit Mutationsprobe belegt. **Eine Review-Behauptung hielt der Nachmessung nicht:** `autoFocus` sei in jsdom belegbar — mit dem Testweg dieses Repos gibt es mit und ohne den Prop keinen Unterschied (aktives Element, `li`-Klassen, `aria-activedescendant` alle gleich). Der Prop bleibt als Konvention mit Quelle, die Grenze steht als Kommentar im Test |
| 15 · Erfassungsmaske vollständig | **erfüllt, verweisend** | Die Schnellerfassung wurde in LFH-332/B4 auf den Erfassungsvertrag gezogen; die Bewertung steht dort (`2026-07-29-schnellerfassung-pruefliste.md`, Zeile 15) und gilt unverändert. B5e fasst zwei Teile davon an und macht beide besser: die Metadaten-Chips bekommen einen benannten, dichte-erbenden Auslöser statt eines 10-px-Kreuzes, und die Zeilen des Slash-Menüs (der Tastaturweg zu Feldern und Bausteinen) folgen der Dichte-Staffel. Der icon-only-Auslöser der Buchstabierhilfe erklärt sich jetzt per Tooltip, wortgleich mit seinem zugänglichen Namen (WCAG 2.5.3) |

**0 Zeilen ohne Verdikt.** Drei offene, drei teilweise erfüllte — jede mit Ziel:

| Zeile | offen woran | Ziel |
| --- | --- | --- |
| 12, 3 | Sammelbanner statt eingeschobener Live-Einträge; optimistische Updates | **B6 (LFH-334)** — Ticket existiert |
| 8 | kein Helligkeitsregler in der Anwendung | Folge-Task aus A0, dort ausdrücklich weiterverwiesen |
| 2 | Dichtestufe wird nicht aus dem Einsatzkontext abgeleitet | B5-Restpunkt (LFH-333) |
| 2, 12, 13 | Layout-Nachweise, die jsdom nicht führen kann: Zeilenhöhe im Handschuh, Chip-Leiste bei ~390 px, Fokus hinter dem angepinnten Kopf | **LFH-373** — es ist der erste Dichte-e2e-Nachweis des Repos und deshalb ein eigener Task |
| 14 | Spaltenschalter mit Zähler fehlt (`KatalogTabelle` statt `Datensicht`) | **LFH-374** — Bestand, nicht von B5e verursacht |
| 5 | vier hartkodierte Farbwerte im angepinnten Erfassungskopf | **LFH-375** |

Jede Zeile zeigt auf eine Nummer, die es gibt. Die drei letzten wurden beim Abschluss von B5e
angelegt (30.07.2026); bis dahin stand hier ausdrücklich „noch nicht getickt" statt eines
Verweises ins Leere — ein Ziel, das keines ist, liest sich wie erledigte Planung und ist
schlechter als ein offen benannter Rest.

---

## Was diese Prüfliste nicht beweist

**Die Zahlen der Baseline sind Scanner-Zahlen, keine Verhaltensbelege.** „0 Klein-Angaben in
`etb/`" heißt: der Dichte-Guard findet dort keine mehr. Er sieht nach seinem eigenen
Kopfkommentar weiterhin kein gespreiztes `{...props}`, keine Größe aus einer Variablen und keine
Wrapper-Komponente, die die Prop intern setzt. Und er sieht `SlashMenu.tsx` überhaupt nicht — ein
Pixel-Padding ist keine Größen-Prop. Der Umbau dieser Datei ist deshalb der einzige des Bündels
**ohne** Gate-Rückmeldung; was ihn hält, sind die vier Zusicherungen in `SlashMenu.test.tsx`.

**Die Trefflächen-Aussage ist eine Absichts-Aussage.** Belegt ist, dass kein Element seine Größe
mehr festnagelt und dass eine Inline-Höhe aus `controlHeight` kommt. Nicht belegt ist ein
gerendertes Pixel: `test/utils.tsx:31` mountet ein nacktes `ConfigProvider`, und jsdom rechnet
kein Layout. Wer „72 px im Handschuh" wirklich belegen will, braucht Playwright mit
`boundingBox()` bei gesetztem `data-dichte='handschuh'`. Das steht als Zeile 2/12/13 offen und ist
bewusst nicht in diesem Bündel — es wäre der erste Dichte-e2e-Nachweis des Repos und damit eine
eigene Entscheidung, kein Nebenprodukt.

**Ein Fall, in dem die geforderte Testform selbst nicht genügte.** Das Akzeptanzkriterium
verlangte, die sichtbare Beschriftung per `getByRole(…, { name })` statt `getByText` zu belegen —
mit der richtigen Begründung, dass `getByText` auch `sr-only` und `aria-hidden` trifft. Gemessen
war die Rollen-Abfrage gegen den **Vorzustand** aber schon grün: der Zellenname lautete
„23.05. 09:00 nachgetragen", weil das `aria-label` am Zeichen in die Namensrechnung einging. Die
Form allein trennt sichtbar nicht von unsichtbar; sie tut es erst, wenn der Name **nur** aus
sichtbarem Inhalt entstehen kann. Deshalb ist das `aria-label` gelöscht und nicht ergänzt, und
deshalb steht die Zusicherung auf das verschwundene ⧖ daneben. Wer das `aria-label` je
zurückholt, dreht das Kriterium ab, ohne einen Test rot zu machen — der Kommentar an
`EtbTabelle.tsx` sagt das an der Stelle.
