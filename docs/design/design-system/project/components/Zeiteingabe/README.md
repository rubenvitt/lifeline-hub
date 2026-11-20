# Zeiteingabe (Wert mit Schnellwahl, leer, unlesbar)

Zeiteingabe in der Anzeigezone (Fähigkeit `zeiteingabe`; Regel: `frontend/AGENTS.md`, „Zeiteingabe in der Anzeigezone“). Jede Zeiteingabe der Oberfläche läuft über diese Bausteine
(Guard `zeitEingabe.guard.test.ts`).

Textfeld zuerst (D1–D8):
- Getippt wird taktisch („1430“, „101430“, „101430okt26“), deutsch, ISO oder relativ („-5“,
  „+2h“, „j“); die eine Deutung ist `zeitParser.ts`. Das Feld zeigt seinen Wert als DTG
  („161430okt26“, Entscheidung E1), beim Tippen daneben die Deutung oder den Grund.
- Enter übernimmt (und das Formular sendet wie gewohnt), Verlassen übernimmt eine lesbare
  Eingabe, Escape verwirft. Unlesbares wird nie übernommen und nie still korrigiert: Enter sendet
  dann nicht, und beim Verlassen bleibt der Text samt Grund stehen (löst D3 ab). Der
  Grund geht an die Eingabesperre darüber (`components/instrument/eingabeSperre.tsx`): ein
  Formular mit `Feld` sendet dann nicht, statt still den alten Wert zu senden.
- Liegt der geltende Wert gestern oder morgen, steht das am Feld, auch nach der Übernahme: „1700“ um 17:59 in einem Fristfeld ist morgen.
- `value`/`onChange` tauschen ABSOLUTE Zeitpunkte; `onChange` feuert nur bei einem anderen
  Zeitpunkt, ein unberührtes Feld behält den gelesenen (Spec: „Unverändertes Speichern
  verschiebt nichts“).
- „Jetzt“, relative Eingaben und die Schnellwahl messen an der Serveruhr.
- Weicht die Anzeigezone von der Browserzone ab, steht die Zone am Feld und im Kalender.
- Der Kalender ist ein Nebenweg (`ZeitKalender`); passt er nicht sicher neben das Feld,
  steht er als Blatt am unteren Rand (`zeitPanelAmFeldAb`).

Quelle: `frontend/src/anzeige/ZeitpunktEingabe.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert (der Zustand nach einer Bedienung im jsdom), mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
