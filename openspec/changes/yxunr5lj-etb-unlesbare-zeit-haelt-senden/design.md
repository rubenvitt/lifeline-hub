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
- `ZeitpunktEingabe` ändert für bestehende Aufrufer nur, wie der Grund einer verworfenen Eingabe
  weicht (D1a); der gesendete Wert bleibt derselbe.

**Non-Goals:**

- Kein Halt in anderen Formularen: Sie senden weiter den geltenden Wert (Spec `zeiteingabe`).
  Deren Anforderung „Unlesbare Eingabe wird nicht übernommen“ ändert sich nur um D1a.
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

### D1a · Enter und Escape im Feld nehmen den Grund zurück (Nachtrag beim Umsetzen, Ruben 15.11.2026)

War das Feld leer („jetzt“), steht es nach dem Verwerfen wieder leer da; „Feld leeren“ geht dann
nicht. Deshalb nimmt `ZeitpunktEingabe` den Grund auch zurück, wenn im Feld Enter auf den gezeigten
Wert gedrückt wird (ausdrückliche Übernahme, wie `onOk` sie schon kennt) oder Escape, ohne dass
getippt wird (die verworfene Eingabe ist ohnehin zurückgenommen). Escape wird dabei verbraucht
(`preventDefault`): Escape-Handler der App, die `defaultPrevented` lesen, reagieren dann nicht;
antd-Dialoge schließen trotzdem (`@rc-component/portal` hört auf `window`). Gilt für jedes Zeitfeld,
deshalb ein MODIFIED-Delta zur Spec `zeiteingabe`; ohne Grund ändert sich nichts.

Ebenso weicht der Grund, wenn sich der Wert von außen ändert (ein lesbares `/zeit` im ETB setzt
ihn): die verworfene Eingabe ist dann überholt (Review B2).

- *Verworfen:* nur Kalender oder neues Tippen. Die Kalenderwahl „jetzt“ setzt eine feste Uhrzeit,
  und ein Eintrag hieße dann „Nachtrag“, obwohl „jetzt“ gemeint war.

### D2 · Unlesbares `/zeit` hält ebenfalls an

`absenden()` hält auch an, solange `zeitBefehlGrund` gesetzt ist. Heute geht ein solcher Eintrag mit
„jetzt“ und dem Befehl im Inhalt hinaus („/zeit 2590 Pumpe“), derselbe stille Fehler in anderer
Form. Am Feld steht der Grund schon (`zeitGrund`), die Regel wird also nur durchgesetzt.

- *Verworfen:* `/zeit` beim alten Verhalten lassen. Zwei Wege zur Ereigniszeit mit verschiedenen
  Regeln für denselben Fehler wären schwer zu erklären und zu prüfen.

### D2a · `/zeit` beim Senden: erst sichtbar, dann senden (Review B1, Nach-Review, Ruben 15.11.2026)

Der Grund eines unlesbaren `/zeit` wird aus dem Text abgeleitet, nicht gespeichert; so kennt ihn
auch ein neu eingehängter Entwurf. `absenden()` liest den Textanfang:

- **unlesbar:** Halt mit „/zeit im Text: …“, der Cursor markiert die Angabe im Text (Entscheidung
  Ruben: der Fehler steht im Text, also auch der Cursor; eine Zeit im Feld ersetzt den Befehl
  nicht, das änderte den Text ohne sichtbaren Schritt).
- **lesbar, beim Tippen nicht übernommen** (mitten in der Angabe berichtigt, dort löst LLH-1088
  bewusst nicht aus): der Klick übernimmt die Zeit ins Feld, nimmt den Befehl aus dem Text und
  sendet noch nicht. So steht der Nachtrag vor dem Senden am Knopf (Spec „Abweichende Ereigniszeit
  bleibt sichtbar“); der nächste Klick sendet.
- Wird eine Zeit aus `/zeit` übernommen, hängt das Feld Zeit neu ein und vergisst einen Grund aus
  einer verworfenen Eingabe, auch bei gleichem Wert.

*Verworfen:* direkt mit der Zeit aus dem Text senden (erste Fassung). Dann ging ein Nachtrag
hinaus, den vorher weder Feld noch Knopf zeigten, und ein Befehl ohne Rest tat beim Klick nichts.

### D3 · Stelle in der Prüfkette und Anzeige

Die neue Prüfung steht in `absenden()` direkt vor der Zukunftsprüfung, also nach Von/An-Pflicht und
Zeichengrenzen und vor Upload und Warteschlange (die Übernahme eines lesbaren `/zeit` aus D2a steht
davor). Fehlen Von oder An, geht der Fokus dorthin wie bisher; erst danach zur Zeit. Bei einem Halt:

- Grund in der Fußzeile als `role="alert"` mit `data-lfh="etb-zeit-grund"` und dem Wortlaut
  „Zeit nicht übernommen: <Grund>“ bzw. „/zeit im Text: <Grund>“, an derselben Stelle wie „Zeit
  liegt in der Zukunft“. Die
  höfliche Hinweiszeile „/zeit: …“ beim Tippen bleibt.
- `zeitGrund` an `EtbFeldzeile` nimmt den verworfenen Grund mit auf, das Feld steht in der
  Fehlerrolle (`aria-invalid`, `status="error"`), wie bei der Zukunft.
- Fokus über `fokusFeld('ereigniszeit')`, bei `/zeit` auf die markierte Angabe im Text.
- Der Halt endet, sobald kein Grund mehr besteht; ein späterer Grund meldet sich wieder nur höflich
  beim Tippen (Review B3).
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
- [Wer einen Grund sieht und trotzdem „jetzt“ will, muss das Feld leeren oder dort Enter bzw. Escape
  drücken] → Das Kapitel nennt den Ausweg (D1a).
- [Neuer Prop an einem gemeinsamen Bauteil] → optional, ohne Wirkung ohne Aufrufer; ein Test sichert,
  dass ein Formular ohne `onVerworfen` wie bisher den unveränderten Wert sendet.
