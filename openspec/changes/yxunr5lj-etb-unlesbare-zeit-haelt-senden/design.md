# Design

## Context

Motivation: `proposal.md`, „Why“. Stand im Code:

- `anzeige/ZeitpunktEingabe.tsx` verwirft beim Verlassen eine unlesbare Eingabe (`onBlur` →
  `uebernimmText() === false` → `setVerworfen(grund)`), zeigt wieder den geltenden Wert und nennt
  den Grund am Feld, bis erneut getippt oder gewählt wird. Nach außen meldet das Feld davon nichts;
  `onChange` läuft nicht, weil sich der Wert nicht ändert.
- `etb/Schnellerfassung.tsx`, `absenden()`: prüft der Reihe nach Von/An-Pflicht, Zeichengrenzen und
  die Zeit in der Zukunft (`zukunftsVerstoss`), jeweils vor Upload und Warteschlange, und setzt bei
  einem Verstoß den Grund und den Fokus (`fokusFeld('ereigniszeit')`).
- Ein unlesbares `/zeit` setzt `zeitBefehlGrund` (Hinweiszeile „/zeit: …“, `role="status"`) und den
  Grund am Feld (`zeitGrund`), hält das Senden aber nicht an.
- Der Klick auf „Erfassen“ löst zuerst `blur` am Feld Zeit aus (bei `mousedown`), dann `click`.
  React rendert zwischen beiden Ereignissen neu, `absenden` sieht also den Stand nach dem Verwerfen.

## Goals / Non-Goals

**Goals:**

- Ein Grund, ein Weg: Der Halt bei unlesbarer Zeit sitzt in derselben Prüfkette wie die Zukunft.
- `ZeitpunktEingabe` ändert für bestehende Aufrufer kein Verhalten.

**Non-Goals:**

- Keine Änderung der Spec `zeiteingabe` und keiner anderen Formulare.
- Keine Prüfung am Server: unlesbarer Text kommt dort nie an.

## Decisions

### D1 · Das Zeitfeld meldet eine verworfene Eingabe über einen eigenen Rückruf

`ZeitpunktEingabe` bekommt den optionalen Prop `onVerworfen?: (grund: string | null) => void`. Er
läuft, wenn sich der Grund einer verworfenen Eingabe ändert: mit dem Grund beim Verwerfen im
`onBlur`, mit `null`, sobald der Grund weicht (erneutes Tippen, Wahl im Kalender,
Schnellwahl, Escape während des Tippens). Die ETB-Erfassung führt ihn als Zustand
`zeitVerworfen` und prüft ihn in `absenden()`.

- *Verworfen:* den getippten Text über eine Ref aus dem Feld lesen. Das Feld hielte dann zwei
  Wahrheiten (Text und Grund), und die Erfassung müsste die Deutung wiederholen.
- *Verworfen:* `onChange` mit einem Fehlerwert. `onChange` trägt in jedem Formular den Wert, ein
  Sonderwert bräche `Form.Item` und alle bestehenden Aufrufer.
- *Verworfen:* „nur im selben Klick“ anhalten, wie die Aufgabe es ursprünglich formulierte. Der Grund
  steht nach dem Verwerfen sichtbar am Feld; eine Regel, die ihn beim nächsten Klick ignoriert,
  sendet trotz sichtbarem Fehler. Der Halt gilt deshalb, solange das Feld den Grund nennt.

### D2 · Unlesbares `/zeit` hält ebenfalls an

`absenden()` hält auch an, solange `zeitBefehlGrund` gesetzt ist. Heute geht ein solcher Eintrag mit
„jetzt“ und dem Befehl im Inhalt hinaus („/zeit 2590 Pumpe“), derselbe stille Fehler in anderer
Form. Am Feld steht der Grund schon (`zeitGrund`), die Regel wird also nur durchgesetzt.

- *Verworfen:* `/zeit` beim alten Verhalten lassen. Zwei Wege zur Ereigniszeit mit verschiedenen
  Regeln für denselben Fehler wären schwer zu erklären und zu prüfen.

### D3 · Stelle in der Prüfkette und Anzeige

Die neue Prüfung steht in `absenden()` direkt vor der Zukunftsprüfung, also nach Von/An-Pflicht und
Zeichengrenzen und vor Upload und Warteschlange. Fehlen Von oder An, geht der Fokus dorthin wie
bisher; erst danach zur Zeit. Bei einem Halt:

- Grund in der Fußzeile als `role="alert"` mit `data-lfh="etb-zeit-grund"` und dem Wortlaut
  „Zeit nicht übernommen: <Grund>“, an derselben Stelle wie „Zeit liegt in der Zukunft“. Die
  höfliche Hinweiszeile „/zeit: …“ beim Tippen bleibt.
- `zeitGrund` an `EtbFeldzeile` nimmt den verworfenen Grund mit auf, das Feld steht in der
  Fehlerrolle (`aria-invalid`, `status="error"`), wie bei der Zukunft.
- Fokus über `fokusFeld('ereigniszeit')`.
- Der Sendeknopf bleibt bedienbar: ein ausgegrauter Knopf ohne Grund wäre schlechter als ein Klick,
  der den Grund zeigt (gleiche Abwägung wie bei Von/An, LFH-894).

### D4 · Stand nach dem Senden und beim Entwurfswechsel

`zeitVerworfen` gehört zum Entwurf, ist aber kein gespeicherter Wert: Nach einem erfolgreichen
Senden ist er ohnehin `null` (sonst wäre nicht gesendet worden). Beim Wechsel des Entwurfsreiters
wird das Feld neu eingehängt und meldet keinen Grund mehr; die Erfassung setzt `zeitVerworfen`
dabei auf `null`, damit kein Grund aus dem anderen Entwurf hängen bleibt.

## Risks / Trade-offs

- [Reihenfolge `blur` → `click` ist Browserverhalten] → Test in jsdom mit `fireEvent.blur` und
  `click` hintereinander, dazu ein e2e-Schritt im echten Browser (Klick auf „Erfassen“ direkt aus
  dem Feld Zeit).
- [Wer einen Grund sieht und trotzdem „jetzt“ will, muss das Feld leeren] → Das Kapitel nennt den
  Ausweg; der Platzhalter „jetzt · 1926“ zeigt, was ein leeres Feld bedeutet.
- [Neuer Prop an einem gemeinsamen Bauteil] → optional, ohne Wirkung ohne Aufrufer; ein Test sichert,
  dass ein Formular ohne `onVerworfen` wie bisher den unveränderten Wert sendet.
