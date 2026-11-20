# Handy-Dialog: nur der Abschluss klebt, „Abbrechen“ im Kopf (LLH-1763)

Zunder: https://zunder.rubeen.dev/#/aufgabe/zpnrt6qzrs6r1y860x9yus0v
Größe: kleine Änderung (kurzer Entwurf). Route `entwurf` wegen E2: Die Regel zum Dialogfuß in
`frontend/AGENTS.md` ändert sich für alle `ErfassungsModal` am Handy.

## Warum

Am Handy (unter `md`) stehen im Erfassungsdialog alle Fußknöpfe untereinander in voller Breite und
kleben am unteren Rand (LFH-953, LLH-1274). Im Serien-Dialog sind das „Werte behalten / Erfasst: n“,
„Abbrechen“, „Speichern und nächste“ und der Primärknopf: 271 px, 32 % von 844. Direkt nach dem
Öffnen zeichnen sich Felder unter „Abbrechen“ durch, mit Bildschirmtastatur bleiben rechnerisch
etwa 170 px Formular.

## Ziele

- Unter `md` klebt im `ErfassungsModal` nur noch, was den Dialog abschließt: der Primärknopf, dazu
  die Nebenaktionen (gleichrangige Abschlüsse) und die Zusammenfassung am Primärknopf.
- „Abbrechen“ steht unter `md` im Dialogkopf, als Textknopf an der Stelle des Schließkreuzes.
- „Werte behalten / Erfasst: n“ und „Speichern und nächste“ stehen unter `md` am Formularende,
  nicht klebend, direkt über dem klebenden Abschluss.

## Nicht-Ziele

- Ab `md` (Tablet, Desktop) ändert sich nichts.
- Die Inline-Erfassung (`ErfassungsFormular` ohne Dialog, `fussKlebt` aus) ändert sich nicht.
- Andere Dialoge (antds `Modal` mit eigenem Fuß, `modal.confirm`, `Popconfirm`) bleiben, wie sie sind.
- Kein Schutz vor Verwerfen beim Schließen: das ist LLH-1755.

## Anti-Ziele

- Ein Abschluss mit Wirkung im Einsatz („RTW nötig“) liegt nie erst nach Rollen.
- Kein zweiter Ausweg im Kopf (Kreuz und „Abbrechen“ zugleich).
- Kein eigener Schließweg: der Kopfknopf nimmt denselben zentralen Abbruch wie Kreuz, Escape und
  Maske, damit Reset, Sperre während des Speicherns und der Schutz aus LLH-1755 auch dort greifen.

## Ansätze

1. **Kreuz wird unter `md` zum Textknopf „Abbrechen“ (gewählt).** Ein Ausweg, klar benannt, kein
   zusätzlicher Platz im Kopf.
2. Kreuz und „Abbrechen“ nebeneinander im Kopf. Verworfen: doppelt, und im Handschuh-Betrieb wird
   es neben dem 72-px-Kreuz für den Titel eng.

Für die Serie:

1. **„Speichern und nächste“ und „Werte behalten“ ans Formularende (gewählt).** Wer eine Serie
   erfasst, rollt einmal nach unten; der klebende Fuß bleibt bei einer Zeile.
2. „Speichern und nächste“ klebt mit. Verworfen: der Fuß wäre etwa doppelt so hoch.

Nebenaktionen (heute nur der Kontakt-Dialog am Einheitengerät, `personen/LeichterFallModal.tsx`:
„Zur UHS“, „RTW nötig“) kleben mit dem Primärknopf (Entscheidung Ruben, 20.11.2026).

## Entscheidungen zum Wie

- Alles in `components/Erfassung.tsx`; Aufrufer ändern sich nicht.
- `ErfassungsModal` unter `md`: kein Schließkreuz (`closable` aus), der Kopf trägt Titel links und
  den Knopf „Abbrechen“ rechts. Der Knopf ruft denselben `schliessen` wie heute Kreuz und Maske und
  ist gesperrt, solange gespeichert wird (wie heute das Kreuz).
- `ErfassungsFormular` mit `fussKlebt` unter `md`: kein „Abbrechen“ im Fuß. Der Fuß teilt sich in
  einen nicht klebenden Teil (Einstellungszeile der Serie, „Speichern und nächste“) und den klebenden
  Abschluss (Zusammenfassung, Nebenaktionen, Primärknopf; Primär unten am Daumen).
- Der Primärknopf bleibt der einzige Übermittlungsknopf im `<form>` (Enter-Vertrag unverändert).
- Regeln nachziehen: Dateikopf von `Erfassung.tsx` („DER FUSS HAT ZWEI ZEILEN“, „Unter `md` …“,
  „Im Dialog klebt der Fuß …“), `frontend/AGENTS.md` in „Knopfreihen über `Knopfreihe`“ und in der
  Erfassungs-Norm.

## Dem Umsetzenden überlassen

- Wie der Kopf gebaut wird (Titel als Flexzeile oder antds `extra`), solange `kopfBoden` und der
  umbrechende Titel weiter tragen.
- Belege: Unit-Tests in `components/Erfassung.test.tsx` (schmal: kein „Abbrechen“ im Fuß, Kopfknopf
  schließt und setzt zurück, Kopfknopf gesperrt beim Speichern, Serie nicht im klebenden Teil),
  e2e `e2e/dialoge-handy.spec.ts` (Höhe des klebenden Fußes auf 390 × 700, „Abbrechen“ im Kopf
  klickbar). Bestehende Specs, die am Handy „Abbrechen“ im Fuß suchen, nachziehen.
- Ob das Design System neu erzeugt werden muss (Wächter entscheidet).
