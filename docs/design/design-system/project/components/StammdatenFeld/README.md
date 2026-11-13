# StammdatenFeld (aus Stammdaten oder frei)

StammdatenFeld — Vorschlagsfeld „aus Stammdaten oder frei“ (LLH-1144, Spec `stammdaten-feld`,
Regel `frontend/AGENTS.md`, Erfassungs-Norm; Herleitung
`/mnt/project-files/llh-1022/LLH-1144/design.md`).

Tippen filtert die Vorschläge der Quellen in den Gruppen „Im Einsatz“, „Stammdaten“, „Zuletzt
verwendet“, Demo-Einträge dahinter (`stammdaten/demoAuswahl.tsx`). Freitext bleibt erlaubt und
trägt die Marke „frei“, ein gewählter Wert die Herkunft; beides als Wort, die Eingabe verweist
per `aria-describedby` darauf. Neben einem freien Wert steht „In Stammdaten übernehmen“, wenn
eine Quelle einen Katalog zum Anlegen mitbringt; ohne Recht gesperrt mit Grund daneben.

Wertform (D1): `{ text, ref? }`, im Modus `nurText` der reine Text (die Marke leitet sich dann
aus dem Treffer ab).

Tastatur (ETB-Neuentwurf, design.md D5; in jedem Modus): Beim Tippen ist der oberste passende
Vorschlag markiert, ↓/↑ verschieben die Markierung. Enter und Tab nehmen den markierten Eintrag
und schließen die Liste; Tab springt danach regulär weiter. Der letzte Eintrag „„<Text>“ als
Freitext übernehmen“ nimmt den getippten Text unverändert; passt kein Vorschlag, ist er der
einzige und damit markiert. Umschalt+Tab und Verlassen nehmen nichts, der getippte Text bleibt
stehen. Escape schließt eine offene Liste, erst bei geschlossener meldet das Feld es weiter.
Enter bei offener Liste sendet nie; bei geschlossener gilt die Erfassungs-Norm (`enterSendet`).
Enter und Tab bei offener Liste nimmt das Feld selbst, rc-select bekommt sie nicht: es hielte
bei Tab den Fokus fest (`OptionList`, `preventDefault`), und Enter öffnete eine geschlossene
Liste (`BaseSelect` `onInternalKeyDown`).

Trefflächen (D6): die Zeilen sind antds Optionen mit `optionHeight = controlHeight`, also
30/48/72 px je Dichte; kein `size`, kein eigenes Maß.

Quelle: `frontend/src/components/StammdatenFeld.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
