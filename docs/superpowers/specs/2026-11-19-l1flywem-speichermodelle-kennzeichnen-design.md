# Speichermodelle kennzeichnen — Design

Zunder: https://zunder.rubeen.dev/#/aufgabe/l1flywemzy9t64kcea3dnrn0 (LLH-1829)
Stand: 19.11.2026 · Route `entwurf` (E1 mehrere Wege der Kennzeichnung, E2 neue Regel in
`frontend/AGENTS.md`) · nur Frontend.

## Absicht

Die Anwendung hat drei Speichermodelle, und keines zeigt, was gerade ungespeichert ist:

1. **Einzelwert** (`InlineAngabe`, Stift, Enter): Einsatzdaten, Einheit. Klickt man neben ein
   offenes, geändertes Feld, bleibt es kommentarlos offen; man merkt nicht, dass nichts gespeichert
   ist.
2. **Formularseite** (`useSpeicherLeiste`): Einstellungen, Stammdaten-Detail, Tier/Schaden,
   Betreuungsstelle. „Speichern“ ist immer aktiv, geänderte Felder sind nicht markiert.
3. **Paneel / ganze Ansicht** (`BearbeitbaresPaneel`): wie 2, im Paneelfuß.

Ziel: Wer bedient, sieht jederzeit, **welche** Felder ungespeichert sind und **ob** es etwas zu
speichern gibt — in jedem der drei Modelle mit derselben Sprache.

## Ziele

- Ein geändertes Feld (Wert weicht vom geladenen bzw. zuletzt gespeicherten Stand ab) trägt am
  Etikett einen **Punkt „•“**. Ändert man es zurück, verschwindet der Punkt.
- „Speichern“ ist **ohne Änderung gesperrt**; daneben steht sichtbar **„Keine Änderungen“**, mit
  Änderung **„1 Änderung“** / **„N Änderungen“**.
- Ein offenes Inline-Feld **mit** Änderung zeigt **„Nicht gespeichert — Enter speichert, Esc
  verwirft“** (mehrzeilig: „Strg+Enter speichert“) und eine Achtungskante. Es bleibt offen.
- Ein offenes Inline-Feld **ohne** Änderung schließt beim Klick daneben still.

## Nicht-Ziele

- Kein Speichern beim Verlassen (Blur). Die Regel in `InlineAngabe` („Kalender und Select öffnen
  Portale; ein Blur-Speichern schriebe einen halben Zeitpunkt“) bleibt.
- Der „Bearbeiten“-Dialog der Einsatzabschnitte bleibt außen vor; er wird ohnehin auf
  `BearbeitbaresPaneel` umgestellt und erbt es dann.
- `BemerkungZelle` bleibt, wie sie ist: sie steht auf antds `Typography.Text editable`, das beim
  Verlassen übernimmt — ein offenes Feld bleibt dort nicht stehen.
- Keine Änderung an Verlassen-Schutz, CAS oder „eine offene Bearbeitung je Seite“.

## Anti-Ziele

- Markierung nur über Farbe (Regel „Farbe und Zeichen“): der Punkt ist Form, für Screenreader
  kommt ein Wort dazu.
- Ein gesperrter Knopf ohne sichtbaren Grund („zeigen statt erklären“, nie nur Tooltip).
- Ein Punkt, der nach dem Speichern stehen bleibt (antds `touched` setzt sich nie zurück, deshalb
  nicht `isFieldsTouched`).
- Unruhe beim Tippen: die Seite darf nicht bei jedem Tastendruck komplett neu rendern
  (`useFormularVerlassenSchutz` hält deshalb nur einen Wahrheitswert im State).

## Ansätze

**Wie „geändert“ festgestellt wird** (Entscheidung des Builders, hier vorgeschlagen):

- **A — Vergleich mit einem Ausgangsstand (gewählt).** Ein Kontext hält die Ausgangswerte
  (geladen bzw. zuletzt gespeichert) und die Form; `Feld` und `DatenfeldEingabe` lesen ihren
  eigenen Wert per `Form.useWatch(name, form)` und vergleichen. Erkennt das Zurückändern, setzt
  sich beim Speichern zurück, rendert nur das betroffene Feld neu.
- B — antds `isFieldsTouched`: verworfen, `touched` heißt „angefasst“, nicht „anders“, und setzt
  sich nach dem Speichern nie zurück.
- C — Zähler aus `useFormularVerlassenSchutz` erweitern: verworfen, zählt Ereignisse, nicht
  Felder; kann weder Feldnamen noch Zurückändern.

**Form der Markierung** (am Phase-1-Checkpoint gewählt): Punkt am Etikett. Verworfen: Kante + Wort
(lauter), nur Zählung in der Leiste (man sucht das Feld selbst).

**Leiste ohne Änderung** (gewählt): gesperrt + Zählung. Verworfen: gesperrt ohne Text (Sperre ohne
Grund), aktiv mit „Nichts zu speichern“ (erfüllt den Auftrag nicht).

**Inline offen** (gewählt): kennzeichnen und offen lassen, unverändert still schließen. Verworfen:
nur kennzeichnen (das unveränderte Feld bliebe weiter grundlos offen), Blur-Speichern (bricht die
Portalregel).

## Entwurf

### Baustein `components/aenderungsstand.tsx` (neu)

- `useAenderungsstand<W>(form, ausgangswerte: W | undefined)` liefert
  `{ anzahl, geaendert: string[], merke(werte: W), Kontext }` bzw. einen
  `AenderungsstandProvider`.
  - Ausgangsstand = `ausgangswerte` beim ersten Vorliegen; nach erfolgreichem Speichern ruft die
    Seite `merke(werte)` mit den gesendeten Werten (neben `schutz.gespeichert(fassung)`).
  - Wechselt der Datensatz (`key={id}` der Seite), beginnt der Stand neu.
  - Vergleich je **oberstem Feldnamen** mit einem strukturellen Gleich (Arrays, Objekte,
    `dayjs` per `valueOf`, `undefined` ≙ `null` ≙ `''`, damit ein geleertes optionales Feld
    gegenüber „nie gesetzt“ nicht als geändert gilt). Vorhandene Helfer
    (`bearbeitetePatch` in `BearbeitbaresPaneel`) sind zu prüfen und, wenn passend, zu teilen.
- `useFeldGeaendert(name)`: `false` ohne Provider (alle übrigen Formulare bleiben unberührt).

### Markierung am Feld

- `Feld` und `DatenfeldEingabe` hängen bei `useFeldGeaendert(name)` an ihr Etikett
  ` •` (`aria-hidden`) und ein visuell verstecktes „(geändert)“. Farbe: `bedienText`, Ton leise;
  Größe aus der `schriftskala`, keine neue `fontSize`-Zahl.
- `DatenfeldEingabe` hat im Paneel kein antd-Etikett, sondern das Etikett der Datenfeld-Zelle;
  der Punkt steht dort.
- Ein Feld ohne `name` (reine Hülle) bekommt nie einen Punkt.

### Speichern-Knopf und Zählung

- Neuer Baustein `SpeicherKnopf` (neben `speicherLeiste.ts`): rendert „Speichern“
  (`type="primary"`, `htmlType="submit"`, `loading`) und daneben den Stand als `Textstufe` mit
  `aria-live="polite"`: „Keine Änderungen“ / „1 Änderung“ / „N Änderungen“. Ohne Änderung ist der
  Knopf `disabled` (Sperrzeichen aus `index.css`) und per `aria-describedby` mit dem Stand
  verbunden.
- Ohne Schreibrecht (Form `disabled`) bleibt es wie heute: alles gesperrt, der Stand entfällt.
- Die 13 Formularseiten mit `useSpeicherLeiste` (Liste: `grep -l useSpeicherLeiste`, ohne
  `BearbeitbaresPaneel`) setzen den Provider in ihr `<Form>` (s. „Entscheidungen aus der
  Gegenlese“) und tauschen ihren Knopf gegen `SpeicherKnopf`. Eine Seite mit „Abbrechen“ (`hasAbbrechen`) behält es daneben.
- `BearbeitbaresPaneel` nimmt `sitzung.werte` als Ausgangsstand und dasselbe `SpeicherKnopf` im
  Fuß. Das bestehende „ohne Änderung kein Aufruf“ (`isLeer(patch)`) bleibt als Netz.
- Ein Wächter (`*.guard.test.ts`) verlangt in jeder Datei mit `useSpeicherLeiste` den
  `SpeicherKnopf`, damit eine neue Formularseite ihn nicht vergisst.

### Offenes Inline-Feld

- In `InlineAngabe`, sobald `entwurfGeaendert` (vorhandener Wert): unter der Eingabe
  `role="status"` „Nicht gespeichert — Enter speichert, Esc verwirft“ (mehrzeilig „Strg+Enter
  speichert, Esc verwirft“), Ton `achtungText`; das `<form>` trägt eine 2-px-Kante links in der
  Achtungsrolle. Schreibgeschützt (`readOnly`, LLH-1832) steht stattdessen nichts Neues.
- **Klick daneben:** ohne Änderung schließt das Feld (wie Escape, Fokus nicht erzwungen); mit
  Änderung bleibt es offen und der Hinweis steht (er steht schon ab der ersten Änderung, der
  Klick ändert nichts daran). Klicks in Portalen der Eingabe (Kalender, Auswahlliste) zählen
  als „innen“: React-Ereignisse laufen durch Portale, ein `onPointerDownCapture` am `<form>` kann
  „innen“ markieren, bevor ein `pointerdown`-Hörer am `document` entscheidet (Builder prüft das).
  Gilt für die Form im Fluss und schwebend (Popover).

### Regel

`frontend/AGENTS.md`, „Formularseiten“ und „Bearbeiten in der Ansicht“, bekommen je einen
Spiegelstrich „Ungespeichertes ist sichtbar (LLH-1829)“: Punkt am Etikett über
`aenderungsstand`, `SpeicherKnopf` mit Stand, Inline-Hinweis. Das Design System bekommt eine
Karte für `SpeicherKnopf`, und `pnpm design-system` läuft (Regel „Größere UI-Entwürfe …“).

## Entscheidungen aus der Gegenlese (Calls des Entwurfs)

- **Provider sitzt innerhalb von `<Form>`** und holt die Instanz über `Form.useFormInstance()`;
  `merke` kommt aus dem Kontext (z. B. ein Hook `useAenderungsstandMerke()` für `onFinish`). Grund:
  `PersonalDetailPage` hält bewusst keine eigene `Form.useForm()`-Instanz, damit `key={id}` den
  Formularspeicher neu aufbaut; ein Provider außen herum mit eigener Instanz brächte diesen Fehler
  zurück.
- **Enter ohne Änderung:** Auf einer Formularseite geschieht nichts (es gibt nichts zu speichern,
  der Stand sagt es). Im `BearbeitbaresPaneel` schließt Enter ohne Änderung weiter wie heute: ein
  eigener Tastenweg (Enter im Raster bei `anzahl === 0` → `schliesse()`) ersetzt das implizite
  Absenden, das ein gesperrter Submit-Knopf unterbindet. Dasselbe gilt für den Bearbeiten-Modus
  von Tier, Schaden, Bezirk und Betreuungsstelle (Sitzung mit „Abbrechen“). Eine Prüfung ohne
  Änderung (leeres Pflichtfeld im Altbestand) entfällt bewusst: ohne Änderung wird nichts gesendet.
- **Gesperrtes Inline-Feld mit Entwurf** (LLH-1468/1480): dort steht nur „Nicht gespeichert“
  neben dem Sperrgrund, ohne „Enter speichert“, weil Enter dann nicht sendet.

## Abweichung bei der Umsetzung (19.11.2026)

Der abgestimmte Hinweis „Nicht gespeichert — Enter speichert, Esc verwirft“ verstößt gegen die
Bedien-Leitlinie „Text erklärt nie die Bedienung“ (LFH-1078, Wächter
`erklaertext.guard.test.ts`). Umgesetzt ist deshalb nur „Nicht gespeichert“ (auch mehrzeilig und
gesperrt); Speichern und Abbrechen stehen direkt darunter. Zur Rückfrage an den Menschen gemeldet.

## Dem Builder überlassen

- Name und genaue Signatur des Hooks; ob Provider oder Kontextwert.
- Wie der Ausgangsstand nach dem Speichern genau entsteht (gesendete Werte oder neu geladene),
  solange der Punkt nach Erfolg verschwindet und nach Fehlschlag stehen bleibt.
- Lage des Stands (rechts neben dem Knopf, umbrechend am schmalen Schirm).
- Tests: Einheitstests der Bausteine (Punkt kommt und geht, Knopf gesperrt/aktiv, Zählung,
  Inline-Hinweis, Klick daneben mit und ohne Änderung, Portal-Klick) plus je ein Seitentest, der
  den Provider bestätigt.
