# Prüfliste Einsatztauglichkeit — Schnellerfassung (LFH-332 · B4)

Gate 7 der Bedien-Leitlinie (`2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7)
verlangt diese Liste an **jeder** neuen oder umgebauten Seite. Sie wird hier **einmal für den
Querschnitt** geführt, nicht vierzehnmal: B4 baut keine Seite um, sondern zieht **einen
Erfassungsvertrag** durch den Bestand — wo der Absende-Knopf liegt, wo der Fokus steht, was nach
dem Speichern passiert. Wo eine Maske abweicht, steht sie in der Zeile namentlich.

**Umfang:** `components/Erfassung.tsx` und `components/SchnellAnlegen.tsx` (die zwei Primitive) ·
sechs Pilot-Dialoge (`PersonErfassungModal`, `SchadenErfassenModal`, `TierePage`, `MaterialPage`,
`PersonalFormModal`, `uhs/Grundriss` Verbleib-Modal) · zwei Ad-hoc-Dialoge (`PersonalPage`,
`FahrzeugePage`) · der Einsatz-Anlegedialog (`EinsaetzePage`) · zwei Wertübernahme-Stellen
(`etb/Schnellerfassung`, `meldungen/MeldungFormular`) · vier Katalog-Reiter (`Qualifikationen`,
`EinheitTypen`, `PersonalStatus`, `StatusKatalog`) · der Platzier-Modus der Lagekarte
(`useKartenInteraktion`, `Sidebar`, `ZeichnenSteuerung`).

**Gemessene Baseline am 29.07.2026** (nicht die Ticket-Zahlen — die stammen vom 25.07. und waren
an zwei Stellen überholt):

| Größe | vorher | nachher |
| --- | --- | --- |
| `onOk={() => form.submit()}` im Produktivcode | 26 (Ticket sagte 28; B2/B3 hatten zwei mitgenommen) | **18** |
| davon in den sechs Pilotdateien | 5 (`Grundriss` sendete über `transportForm`, nicht `form` — kein Treffer, aber sehr wohl betroffen) | **0** |
| `autoFocus` in Erfassungs-/Stammdatenmasken | 0 | Fokus kommt aus der Hülle, nicht aus `autoFocus` |
| Erfassungsdialoge mit „Speichern und nächste" | 0 | 8 |

---

| #  | Verdikt | Beleg / Zielticket |
| -- | ------- | ------------------ |
| 1 · Treffläche | **nicht anwendbar** | B4 setzt an keinem interaktiven Element eine Größe. Die neuen Knöpfe erben `controlHeight` vom `ConfigProvider` (Dichteachse aus LFH-329/B1, `theme/tokens.ts:265`) — genau so, wie es das Ticket verlangt. Eine Messung wäre hier auch nicht belastbar: `test/utils.tsx:30` rendert ein **nacktes** `ConfigProvider` ohne Theme, jede Höhenbehauptung im Vitest misst antd-Vorgaben. Die Fläche selbst entscheidet **B5 (LFH-333)** |
| 2 · Handschuh-Modus | **offen** | Die Stufe existiert (`dichten.handschuh`, 72 px, `theme/tokens.ts:118`), aber ihre **Ableitung aus dem Einsatzkontext** ist noch nicht verdrahtet — der Schalter hängt an `localStorage['lifeline-hub.dichte']`. Unverändert durch B4 → **B5 (LFH-333)** |
| 3 · Rückmeldung vor der Serverantwort | **erfüllt** | Beide Speicher-Knöpfe tragen `loading={laeuft}` aus `mutation.isPending` — die Anzeige steht mit dem Klick, nicht mit der Antwort. Der Serien-Zähler „Erfasst: n" ist `aria-live="polite"`. Optimistische Updates gibt es weiterhin nirgends (Baseline 0) → **B6 (LFH-334)** |
| 4 · Kritische Aktion hat eine zweite Handlung | **nicht anwendbar** | B4 baut **Anlege**-Pfade um. Keine der 14 Stellen storniert, schließt ab, löscht oder alarmiert; das Verbleib-Modal im UHS-Grundriss erfasst einen Verbleib, es beendet keinen Fall |
| 5 · Kontrast in beiden Modi | **erfüllt** | B4 führt keinen Farbwert ein. Die einzige neue Fläche ist die Trennlinie über der Aktionsleiste, sie liest `token.colorBorderSecondary` aus dem Theme. Der Gate-5-Guard (`theme/gate5.guard.test.ts`) scannt `components/` mit und ist grün |
| 6 · Kein Status allein über Farbe | **nicht anwendbar** | B4 zeigt keinen Status an. Der Serien-Zähler ist reiner Text |
| 7 · Eine Farbe = eine Bedeutung | **nicht anwendbar** | siehe 5 — keine neue Farbbelegung |
| 8 · Helligkeits-/Kontrastregler | **offen** | Weiterhin keiner in der Anwendung; A0 hat ihn ausdrücklich weiterverwiesen → **eigener Folge-Task** (Leitlinie, „Was diese Leitlinie nicht entscheidet") |
| 9 · Kritische Anzeigen im Blickfeld | **erfüllt** | Die Aktionsleiste steht unmittelbar unter dem letzten Feld, im Fluss, nicht am Layoutrand — das ist ein **Gewinn** gegenüber vorher: die antd-Modal-Fußzeile lag hinter einer Trennlinie unterhalb des Formularkörpers, jetzt liegt der Knopf dort, wo die Eingabe endet |
| 10 · Alarmbudget | **nicht anwendbar** | B4 erzeugt keine Alarme. Bewusst auch keine neue Erfolgsmeldung je Datensatz — im Serienbetrieb wären das 1 Toast je Minute; die Rückmeldung ist der Zähler |
| 11 · Warnverhalten | **erfüllt** | Kein Blinken, kein Ton. Ein abgelehntes Speichern meldet die Mutation des Aufrufers wie bisher als Text |
| 12 · Kein Sprung unter dem Cursor | **erfüllt, mit einer benannten Bewegung** | Der Dialog behält beim Serien-Speichern seine Höhe; die einzige Layoutänderung ist der Zähler „Erfasst: n", der nach dem **ersten** Speichern in der Aktionsleiste erscheint — einmal, in einer Zeile, die es schon gibt. Der aufgeklappte `Collapse`-Bereich wächst nur auf ausdrückliche Nutzeraktion. **Gefundene und behobene Verletzung:** der Fokus beim Öffnen war zunächst per `requestAnimationFrame` aufgeschoben und griff unter Last erst, wenn die Person schon tippte — der Cursor sprang mitten im Wortlaut ins erste Feld zurück. Aufgedeckt hat das die volle Vitest-Suite, nicht der Einzellauf (`Erfassung.test.tsx`, „Enter in der Textarea sendet NICHT ab"); der Mount-Fokus steht jetzt direkt, nur der Serien-Rücksprung bleibt aufgeschoben |
| 13 · Fokus nie verdeckt | **erfüllt** | Alle acht Dialoge portalen nach `document.body`, es gibt keinen fixierten Kopf und keine Fußleiste darüber. Die Aktionsleiste liegt im Fluss des Formulars, nicht darüber |
| 14 · Tabellenseite vollständig | **nicht anwendbar** | B4 fasst keine Tabelle an. Die vier Katalog-Reiter behalten ihre `KatalogTabelle` aus LFH-330/B2 unverändert; der Quick-Add steht daneben |
| 15 · Erfassungsmaske vollständig | **erfüllt, drei Teile mit Grenze** | **Defaults vorbelegt, sichtbar, einzeln überschreibbar:** Wertübernahme über `uebernahme` an sieben Stellen, sichtbar umschaltbar über „Werte behalten"; der Einsatz-Anlegedialog belegt Einsatzart (`realeinsatz`) und Alarmzeit (`jetzt`) vor, das Verbleib-Modal Art (`transport`). Alle sind normale Feldwerte und einzeln änderbar. **„Speichern und nächsten anlegen" mit gehaltenem Kontext:** an acht Erfassungsstellen, mit Zähler; Schließen bleibt ausdrückliche Nutzeraktion. **Labels über dem Feld:** `layout="vertical"` liegt in der Hülle, nicht mehr bei den Aufrufern — keine Maske kann davon abweichen. **Volle Tastaturbedienung:** Enter sendet, weil der Knopf im `<form>` liegt (26 → 18 Treffer, Pilotdateien 0); Shift+Enter und Enter in einer `Input.TextArea` bleiben Zeilenumbruch. **GRENZE:** die *Sammelliste mit Ändern/Entfernen je Zeile* (DWP „Add another thing") ist **nicht** gebaut — der Serienmodus schreibt jeden Datensatz sofort weg, statt eine Vorschauliste zu führen. Das ist eine bewusste Entscheidung, keine Lücke: an BHP und BTP soll ein erfasster Patient sofort im Lagebild stehen, nicht in einem lokalen Entwurf hängen. Das *Ändern* der eben erfassten Zeile führt die jeweilige Modulliste direkt daneben |

**0 Zeilen ohne Verdikt.** Drei offene Zeilen, alle mit Zielticket: 2 und 1 → LFH-333 (B5), 3 →
LFH-334 (B6), 8 → eigener Folge-Task aus A0.

---

## Was diese Prüfliste nicht beweist

Die Zahl 18 ist ein **Grep-Zähler**, kein Verhaltensbeleg. Sie sagt, dass an 18 Stellen noch ein
Absende-Knopf außerhalb seines Formulars hängt — sie sagt nicht, dass die umgebauten Stellen
richtig funktionieren. Dafür stehen die Vitest-Fälle, und dort ist die schärfere Grenze: die
Behauptung „höchstens vier sichtbare Felder" ist für sich **nicht widerlegbar**, weil ein
`Collapse` seinen Inhalt ohne `forceRender` ohnehin nicht rendert. Sie zählt nur, weil jede
Maske die zweite Hälfte mitbringt — **Aufklappen lässt die Zahl steigen**.

Ebenso: `Grundriss.tsx` erfüllt die Ticket-Bedingung „in den sechs Pilotdateien ist der Treffer 0"
**leer** — sie war dort schon vorher 0, weil die Formularinstanz `transportForm` heißt und das
gesuchte Literal nicht traf. Was dort tatsächlich belegt, dass die Hülle greift, sind die vier
gepinnten Zusicherungen im Test der Datei: der Knopf heißt weiterhin „Erfassen", das Feld „Art"
bleibt eine Combobox mit diesem Namen, die Vorbelegung `art: 'transport'` steht, und der Fokus
liegt auf „Ziel".
