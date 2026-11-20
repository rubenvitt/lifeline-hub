# Dialoge schützen Eingaben (LLH-1755)

Zunder: https://zunder.rubeen.dev/#/aufgabe/t103cygusr90pa1mcjc2zuw9

## Absicht

Escape, das Schließkreuz und ein Klick oder Tap neben den Dialog schließen heute jeden
Erfassungsdialog sofort, und die Eingaben sind weg. Geprüft bei „Vermisst melden“ (Name und Notiz),
„Auftrag erteilen“ (Klick auf die Maske) und „Schaden erfassen“ (Tap 60 px neben dem Dialog am
Tablet). Im Einsatz kostet das Zeit und Angaben, die oft nicht wiederkommen. Das ETB schützt seine
Entwürfe schon, die Dialoge nicht. Teil von LLH-1718: Nichts geht still verloren.

## Ziele

- Ein Klick oder Tap neben den Dialog schließt ihn **nie**.
- Haben Felder einen geänderten Stand, fragt der Dialog vor dem Schließen nach: „Eingaben
  verwerfen?“ mit „Weiter bearbeiten“ (Vorgabe) und „Verwerfen“ (rot).
- Ohne Änderung schließen Escape, Kreuz und „Abbrechen“ wie bisher sofort und still.
- Das gilt für alle Dialoge auf `ErfassungsModal` (rund 107 Dateien, darunter Vermisst und
  Schaden) und für die drei Auftragsdialoge (`auftraege/AuftragErteilenDialog.tsx`,
  `meldungen/AuftragErteilenModal.tsx`, `etb/AuftragAusEtbModal.tsx`).

## Nicht-Ziele

- Kein Entwurf, den der Dialog sich merkt und beim Wiederöffnen anbietet (am Checkpoint
  verworfen, s. „Ansätze“).
- Die rund 35 von Hand gebauten Dialoge mit Formular (Einstellungen, Stammdaten, Betreuung …)
  bleiben unverändert; sie kommen als eigene Folgeaufgabe aufs Board.
- Kein Schutz beim Verlassen der Seite mit offenem Dialog (Pfadwechsel, Tab schließen); das bleibt
  bei `VerlassenRueckfrage` und den Seiten.

## Ansätze

1. **Rückfrage bei Änderung (gewählt, Ruben 20.11.2026).** Ein zentraler Abbruch in
   `ErfassungsFormular` fragt nach, bevor er zurücksetzt. Einfach, an einer Stelle. Nach dem
   Schließen bleiben keine Personendaten (Vermisst, Betroffene) im Speicher liegen.
2. **Entwurf merken.** Ohne Rückfrage schließen und die Eingaben je Dialog im Speicher der Seite
   halten, beim Wiederöffnen „Entwurf fortsetzen?“. Das ist bequemer, braucht aber Regeln, wann ein
   Entwurf verfällt, je Dialog einen Schlüssel und einen Umgang mit Personendaten im Speicher.
   Verworfen.
3. **Beides.** Erst die Rückfrage, und „Verwerfen“ merkt sich die Eingaben trotzdem zum
   Wiederherstellen. Den größten Aufwand für einen seltenen Fall. Verworfen.

## Entwurf

**Eine Pforte.** Alle Wege hinaus laufen heute schon durch `ErfassungsFormular.abbrechen`: der
Knopf und Escape direkt, Kreuz und Maske über `steuerungRef` (`ErfassungsModal`, ebenso der Drawer
in `pages/bereitstellungsraum/EintreffenDialog.tsx`). Dort setzt die Rückfrage an. `abbrechen`
prüft den Änderungsstand. Ohne Änderung läuft es wie heute. Mit Änderung öffnet es die Rückfrage,
und erst „Verwerfen“ setzt zurück und ruft `onAbbrechen`.

**Was „geändert“ heißt.** Ein Feld gilt als geändert, wenn die Person es angefasst hat
(`onValuesChange` am `<Form>` der Hülle; antd ruft es nur bei Bedienung, nie bei
`setFieldsValue`) **und** sein Wert jetzt von `initialValues` abweicht (Vergleich über
`gleichFuerStand` aus `components/aenderungsstand.tsx`: leer ≙ `null` ≙ nie gesetzt). Daraus
folgt:

- Etwas tippen und wieder löschen gilt als unverändert.
- Was ein Aufrufer per `setFieldsValue` vorbelegt (Bearbeiten, Übernahme aus einer Auswahl), löst
  allein keine Rückfrage aus. Das betrifft 42 Dateien.
- Die Menge der angefassten Felder leert sich bei jedem Zurücksetzen, auch nach einem
  Serien-Speichern. Was „Werte behalten“ danach stehen lässt, gilt als unverändert.
- Grenzfall (meine Entscheidung): Wer einen vorbelegten Wert ändert und ihn von Hand auf den
  vorbelegten Wert zurücksetzt, bekommt trotzdem die Rückfrage, weil der Vergleich gegen
  `initialValues` läuft. Selten und harmlos.

**Die Rückfrage.** Ein kleiner Dialog über dem Erfassungsdialog mit dem Titel „Eingaben
verwerfen?“ und dem Text „Die Eingaben in „<Titel>“ gehen verloren.“ (ohne Titel: „Die Eingaben
gehen verloren.“). Die Knöpfe stehen in `Knopfreihe fuss`: „Verwerfen“ (`danger`) und „Weiter
bearbeiten“ (primär, mit dem Fokus). Escape und ein Klick auf die Maske der Rückfrage bedeuten
„Weiter bearbeiten“. Danach kehrt der Fokus in den Erfassungsdialog zurück, an das zuletzt
fokussierte Feld oder sonst an das erste. Gebaut wird sie als eigener kleiner Baustein neben
`VerlassenDialog` in `components/VerlassenRueckfrage.tsx` (gleiche Form, anderer Wortlaut; „beim
Verlassen“ passt hier nicht). Ob er sich `VerlassenDialog` über Props teilt, entscheidet der
Umsetzer.

**Escape doppelt.** Solange die Rückfrage offen ist, darf das Escape der Tastatur-Ebene des
Erfassungsformulars (`useTastaturEbene`, `verwerfen: abbrechen`) nicht erneut auslösen. Die
Rückfrage nimmt Escape für sich.

**Maske.** `ErfassungsModal` setzt `mask={{ closable: false }}` fest. Die Sperre während des
Speicherns (Kreuz gesperrt) bleibt.

**Auftragsdialoge.** `AuftragFormular` bringt sein eigenes `ErfassungsFormular` mit. Es bekommt
ein `steuerungRef`, das es an die Hülle weiterreicht. Die drei Modals leiten `onCancel` (Kreuz)
darüber, setzen `mask={{ closable: false }}` und `keyboard={false}`. Escape läuft dann wie bei
`ErfassungsModal` über die Tastatur-Ebene des Formulars.

**Abbrechen-Knopf (meine Entscheidung).** Auch der Knopf „Abbrechen“ fragt bei Änderung nach. Er
teilt heute denselben Abbruch wie Escape, und ein Fehltipp im Handschuh-Betrieb ist so teuer wie
ein Escape. Eine Ausnahme nur für den Knopf wäre eine zweite Regel.

## Regeln, die sich ändern

- `frontend/AGENTS.md`, „Erfassungs-Norm“: Der Punkt „Zurückgesetzt wird auf JEDEM Weg hinaus“
  bekommt den Zusatz: Mit geänderten Feldern fragt jeder Weg hinaus vorher nach (Rückfrage
  „Eingaben verwerfen?“). Die Maske schließt nie. „Geändert“ heißt angefasst und anders als
  `initialValues`.
- Der Dateikopf von `components/Erfassung.tsx` (Zusicherung 3) und die Kommentare an
  `ErfassungsModal` und `AuftragErteilenDialog` ziehen nach.
- Trägt die README des Design Systems diesen Abschnitt, wird es neu erzeugt (`pnpm -C frontend
  design-system`).

## Nachweis

- `components/Erfassung.test.tsx`: Escape, Kreuz, Abbrechen und Maske je ohne Änderung (schließt
  bzw. bleibt offen) und mit Änderung (Rückfrage). „Weiter bearbeiten“ behält die Werte,
  „Verwerfen“ leert und schließt. Tippen und Löschen fragt nicht. `setFieldsValue` allein fragt
  nicht. Ein Serien-Speichern mit „Werte behalten“ fragt danach nicht.
- Ein Test je Auftragsdialog: Kreuz mit Änderung fragt nach, die Maske schließt nicht.
- e2e: eine Spec für „Vermisst melden“ (Name tippen, Escape, Rückfrage, Weiter bearbeiten, Name
  steht noch).

## Dem Umsetzer überlassen

- Ob die Rückfrage `VerlassenDialog` erweitert oder ein eigener Baustein wird.
- Wie der Fokus nach „Weiter bearbeiten“ zurückfindet (gemerktes `document.activeElement` oder das
  erste Feld).
- Bekommt der neue Baustein eine Karte im Design System (`PREVIEWS`), wenn er eigenständig wird?
