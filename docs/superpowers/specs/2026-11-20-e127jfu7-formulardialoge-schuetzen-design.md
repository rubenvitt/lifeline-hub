# Handgebaute Dialoge schützen Eingaben (LLH-2010)

Zunder: https://zunder.rubeen.dev/#/aufgabe/e127jfu7zghh3h7z17tbbaw0

Folgeaufgabe von LLH-1755 (Design-Doc
`docs/superpowers/specs/2026-11-20-t103cygu-dialoge-schuetzen-eingaben-design.md`). Der Branch
baut auf `claude/brave-meitner-1oyvfo` auf. Der PR gegen `alpha` entsteht erst, wenn LLH-1755
gemergt ist.

## Absicht

LLH-1755 schützt alle Dialoge auf `ErfassungsModal` und die Auftragsdialoge:

- Die Maske schließt nie.
- Bei geänderten Feldern fragt jeder Weg hinaus „Eingaben verwerfen?“.

Dialoge mit eigenem `<Modal>` schließen weiter still per Maske, Escape oder Kreuz. Diese Aufgabe
schließt die Lücke. Auch in diesen Dialogen soll nichts verloren gehen, das jemand getippt hat.
Danach soll ein Wächter verhindern, dass ein neuer Dialog die Lücke wieder öffnet.

## Bestand (Scope-Scan 20.11.2026)

Die Aufgabe ging von rund 35 Dialogen aus. Der Grep traf aber vor allem Dateien, in denen das
`<Modal>` eine Bestätigung oder die einmalige Anzeige eines Schlüssels ist; das Formular steht
dort an anderer Stelle. Wirklich betroffen sind:

| Dialog | Datei | Inhalt | Weg |
| --- | --- | --- | --- |
| Baustein einsetzen | `etb/BausteinPlatzhalterModal.tsx` | antd-Form, ein Feld je Platzhalter | auf `ErfassungsModal` |
| In die Lage übernehmen | `meldungen/LagerelevantModal.tsx` | antd-Form: Lage-Text (vorbelegt), Verortung | auf `ErfassungsModal` |
| Eintreffen buchen | `pages/bereitstellungsraum/EintreffenDialog.tsx` | Schritt „Suche“, dann `ErfassungsFormular` | Maske immer gesperrt |
| Vollzug melden | `auftraege/VollzugMeldenModal.tsx` | ein Textfeld (gesteuert) | `useVerwerfenSchutz` |
| Nachforderung ablehnen | `pages/NachforderungenPage.tsx` | Bestätigung mit optionalem Grund | `useVerwerfenSchutz` |
| Nachforderung zurückziehen | `pages/NachforderungenPage.tsx` | dasselbe | `useVerwerfenSchutz` |
| Neue Ansicht / Ansicht umbenennen | `pages/lagekarte/AnsichtSwitcher.tsx` | ein Namensfeld | `useVerwerfenSchutz` |
| Nachforderungen für eine Stelle | `betreuung/unterkunft/NachforderungenDialog.tsx` | Postenliste: Haken und Menge | `useVerwerfenSchutz` |
| Taktisches Zeichen | `pages/lagekarte/ZeichenWahlDialog.tsx` | Auswahl aus einem Raster | nur Maskensperre |
| Zeichen hier setzen | `pages/lagekarte/ZeichenHierDialog.tsx` | Auswahl | nur Maskensperre |
| In Einsatz übernehmen | `planung/PlanungUebernahmeDialog.tsx` | zwei Auswahlfelder und eine Vorschau | nur Maskensperre |

Außerhalb des Umfangs bleiben:

- Bestätigungen ohne Eingabe.
- Die einmalige Anzeige eines Schlüssels oder Links („nur jetzt sichtbar“).
- Der Konfliktdialog von `BearbeitbaresPaneel`: Er sperrt die Maske schon.
- Die Personensuche (`aufbewahrung/PersonensucheDialog.tsx`): Ein Suchbegriff ist keine Eingabe,
  die geschützt werden muss.
- Der Verbindungsdialog der Fernmeldeskizze: Er besteht aus Suche und Wahl.
- Upload- und Radio-Dialoge.

## Ziele

- Kein Dialog mit Eingabe schließt per Klick oder Tap neben den Dialog.
- Geänderte Eingaben gehen in keinem dieser Dialoge ohne Rückfrage verloren. Escape, Kreuz und
  Abbrechen fragen „Eingaben verwerfen?“. Dafür nutzen sie denselben `VerwerfenDialog` wie
  LLH-1755, mit demselben Wortlaut und Fokus.
- Ohne Änderung schließen Escape, Kreuz und Abbrechen wie bisher sofort und still.
- Ein Wächter meldet jeden neuen Dialog mit Eingabe, der die Maske nicht sperrt.

## Nicht-Ziele

- Kein Entwurfsspeicher. Am Checkpoint von LLH-1755 wurde er verworfen.
- Bestätigungen und Schlüsselanzeigen bleiben unverändert.
- Auswahldialoge fragen nicht nach. Eine Auswahl ist mit einem Klick wiederholt. Hier fragt nur
  „Eingaben verwerfen?“, wo jemand getippt hat (Entscheidung am Checkpoint vom 20.11.2026).
- Dialoge, die erst nach dem Merge entstehen, fallen nicht unter diese Aufgabe; dafür gibt es den
  Wächter.

## Ansätze

1. **Formulare umstellen, für den Rest ein Hook (gewählt, Ruben 20.11.2026).**
   - Die beiden Dialoge mit antd-Form kommen auf `ErfassungsModal`, wie es die Erfassungs-Norm
     ohnehin verlangt („ein handgebautes `<Modal>` + `<Form>` ist ein Fehler“).
   - Die Dialoge mit gesteuerten Feldern bekommen einen kleinen gemeinsamen Hook. Er liefert die
     Modal-Props und die Rückfrage.
   - Auswahldialoge sperren nur die Maske.
2. **Überall nur die Hülle.** Jeder Dialog bleibt, wie er ist, und bekommt den Hook. Der Diff wäre
   kleiner, aber die Norm bliebe an zwei Stellen verletzt. Verworfen.
3. **Alles auf `ErfassungsModal`.** Auch die Einfelddialoge würden zu Formularen. Bei Bestätigungen
   mit optionalem Grund (Ablehnen, Zurückziehen) und bei der Postenliste der Unterkunft passt die
   Hülle schlecht: Dort gibt es keinen Serienmodus und keine Feldregeln, und der rote Primärknopf
   ist eine Bestätigung. Das wäre viel Umbau für denselben Schutz. Verworfen.

## Entwurf

### `useVerwerfenSchutz`

Der Hook liegt in `components/VerlassenRueckfrage.tsx` neben `VerwerfenDialog`. Er kann auch eine
eigene Datei bekommen; das entscheidet, wer baut.

```ts
const schutz = useVerwerfenSchutz({
  geaendert,          // boolean: Hat die Person etwas eingegeben, das verloren ginge?
  gesperrt,           // optional: Läuft gerade gespeichert? Dann ist jeder Weg hinaus aus.
  titel,              // Titel des Dialogs, für den Text der Rückfrage
  onSchliessen,       // der bisherige Abbruch (Zustand räumen, Dialog zu)
});
<Modal {...schutz.modalProps} …>…</Modal>
{schutz.rueckfrage}
```

`modalProps` enthält diese Props:

- `mask={{ closable: false }}`.
- `wrapProps={MASKE_HAELT_FOKUS}`.
- `onCancel`: Der Abbruch läuft so:
  - Ist `gesperrt` gesetzt, passiert nichts.
  - Ohne Änderung ruft er `onSchliessen`.
  - Mit Änderung öffnet er die Rückfrage. „Verwerfen“ ruft `onSchliessen`, „Weiter bearbeiten“
    schließt nur die Rückfrage.
- `keyboard={!gesperrt && !rueckfrageOffen}`. Solange die Rückfrage offen ist, hört der Dialog
  darunter kein Escape. So kommt Escape nicht doppelt an (wie die Ebene in LLH-1755).

Der Knopf „Abbrechen“ des Dialogs (`cancelText`, eigener Fuß) läuft über denselben `onCancel`. So
gilt die Regel aus LLH-1755 auch hier: Auch der Knopf fragt bei Änderung nach.

`rueckfrage` ist der gerenderte `VerwerfenDialog`. Er steht **neben** dem `<Modal>`, nicht darin.
Sonst liefe das React-Ereignis für Escape über den Baum in den äußeren Dialog.

Nach „Weiter bearbeiten“ kehrt der Fokus in den Dialog zurück, so wie es `VerwerfenDialog` in
LLH-1755 löst. Wer baut, übernimmt dessen Weg.

### Was „geändert“ je Dialog heißt

| Dialog | `geaendert` |
| --- | --- |
| Vollzug melden | Text nach `trim()` nicht leer |
| Nachforderung ablehnen / zurückziehen | Grund nach `trim()` nicht leer |
| Neue Ansicht | Name nach `trim()` nicht leer |
| Ansicht umbenennen | Name nach `trim()` anders als der bisherige Name |
| Nachforderungen für eine Stelle | Haken oder Menge einer Zeile anders als beim Öffnen (Vorschlag) |

Der Vergleich gegen den Stand beim Öffnen wie in LLH-1755 führt dazu: Etwas tippen und wieder
löschen gilt als unverändert.

### Umstellung auf `ErfassungsModal`

- **Baustein einsetzen:**
  - Das ist `ErfassungsModal` mit Titel „Baustein einsetzen“ und `erfassenText="Einsetzen"`.
  - `onErfassen` setzt den Baustein ein. Es gibt keine Mutation, also löst die Funktion sofort
    auf.
  - Bausteine ohne Platzhalter werden weiter ohne Dialog eingesetzt.
  - Die Felder entstehen weiter dynamisch je Platzhalter. Der erste Platzhalter bekommt den Fokus.
  - `form.resetFields()` beim Öffnen fällt weg, wo die Hülle das selbst tut.
- **In die Lage übernehmen:**
  - Das ist `ErfassungsModal` mit `erfassenText="Übernehmen"` (wie bisher; wer baut, prüft den
    heutigen Wortlaut), `speicherung` und `speicherFehlerTitel="Nicht übernommen"`.
  - Der Lage-Text wird weiter beim Öffnen per `setFieldsValue` mit dem Inhalt der Meldung
    vorbelegt. Nach LLH-1755 löst das allein keine Rückfrage aus. Erst wer den Text ändert,
    bekommt sie.
  - Die eigenen Knöpfe im Formular entfallen.

### Eintreffen buchen

- Die Maske ist in beiden Schritten gesperrt: `mask={{ closable: false }}` und
  `wrapProps={MASKE_HAELT_FOKUS}`.
- Im Schritt „Suche“ schließen Escape und Kreuz weiter sofort. Ein Suchbegriff ist keine
  Eingabe, die geschützt werden muss.
- Schritt 2 ist schon über `ErfassungsFormular` geschützt.

### Auswahldialoge

`ZeichenWahlDialog`, `ZeichenHierDialog` und `PlanungUebernahmeDialog` bekommen nur zwei Props:
`mask={{ closable: false }}` und `wrapProps={MASKE_HAELT_FOKUS}`. Escape und Kreuz bleiben, wie
sie sind.

### Wächter `components/dialogEingabe.guard.test.ts`

Der Wächter folgt dem Muster der übrigen `*.guard.test.ts`: Er liest den Quelltext.

- Er durchsucht jede `.tsx`-Datei unter `src` (ohne Tests) nach `<Modal`-Elementen.
- Enthält der Block bis zum passenden `</Modal>` ein Eingabeelement, verlangt er eine von zwei
  Formen: `mask={{ closable: false }}` oder `{...<x>.modalProps}`. Als Eingabeelemente zählen
  `<Form`, `<Input`, `Input.TextArea`, `<TextArea`, `<InputNumber`, `<Select`, `<Checkbox` und
  `<Feld`.
- Ein Dialog, der zu Recht offen schließt, steht in einer Ausnahmeliste mit Grund. Das sind etwa
  Schlüsselanzeigen mit einem `readOnly`-Feld und die Personensuche.
- Die Liste darf nicht wachsen, ohne dass jemand im Review den Grund liest. Diese Regel steht im
  Kommentar über der Liste. Eine Schuldliste für Bestand, der „später“ umgestellt wird, gibt es
  nicht: Der Bestand wird in dieser Aufgabe umgestellt.
- Eine Mutationsprobe belegt den Wächter: Ohne die Sperre in `ZeichenHierDialog` muss er rot
  werden.

### Regeln, die sich ändern

In `frontend/AGENTS.md`, Abschnitt „Erfassungs-Norm“, kommt nach dem Punkt aus LLH-1755 („Geänderte
Eingaben gehen nie ohne Rückfrage verloren …“) ein Zusatz:

- Ein eigenes `<Modal>` mit gesteuerten Feldern, das kein Formular ist (Bestätigung mit Grund,
  Einfelddialog, Postenliste), nimmt `useVerwerfenSchutz`.
- Ein reiner Auswahldialog sperrt nur die Maske.
- Wächter ist `components/dialogEingabe.guard.test.ts`.

Die README des Design Systems wird neu erzeugt, wenn sie den Abschnitt trägt.

Die Anwenderdoku nennt das Verhalten der Maske bisher nicht. Wer baut, prüft per Grep, ob LLH-1755
dort etwas eingeführt hat, und zieht es gleich nach.

## Nachweis

- **Hook-Test** (`components/useVerwerfenSchutz.test.tsx` oder neben `VerwerfenDialog`):
  - Ohne Änderung schließt `onCancel` sofort.
  - Mit Änderung erscheint die Rückfrage. „Weiter bearbeiten“ lässt den Dialog offen,
    „Verwerfen“ ruft `onSchliessen`.
  - Mit `gesperrt` passiert nichts.
  - Escape bei offener Rückfrage schließt nur die Rückfrage.
- **Je umgestelltem Dialog ein Test:**
  - Ein Klick auf die Maske schließt nicht.
  - Kreuz mit Eingabe fragt nach.
  - Kreuz ohne Eingabe schließt.
  - Für Lagerelevant zusätzlich: Die Vorbelegung allein fragt nicht.
- **Der Wächter** und seine Mutationsprobe.
- **Bestehende Tests:** Tests der betroffenen Dialoge, die heute über die Maske schließen, werden
  angepasst, nicht gelöscht.

## Dem Umsetzer überlassen

- Ob der Hook in `VerlassenRueckfrage.tsx` liegt oder eine eigene Datei bekommt.
- Ob der Wächter Blöcke über einen einfachen Klammerzähler oder per TypeScript-AST erkennt. Er muss
  den heutigen Bestand fehlerfrei einordnen.
- Wie die Ausnahmen im Wächter einzeln heißen.

## Risiken

- **Gestapelt auf LLH-1755.** Ändert LLH-1755 vor dem Merge noch die API von `VerwerfenDialog`,
  wird hier nachgezogen.
- **Laufende Nachbaraufgaben** berühren dieselben Dateien:
  - LLH-1771 ändert `VollzugMeldenModal` (Beschriftung, Fehler am Feld).
  - LLH-1766 vereinheitlicht die Sendeverben.

  Vor dem PR wird `alpha` nachgeführt, und die Konflikte werden im Branch gelöst.
