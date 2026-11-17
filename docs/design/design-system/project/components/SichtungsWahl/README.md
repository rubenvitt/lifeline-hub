# SichtungsWahl (BBK-Flächen, ohne und mit Wahl)

Die Wahl einer Sichtungskategorie nach BBK. Ein Baustein für Erfassung,
Nachsichtung, Patientenkopf und Zeilen-Popover; die ANZEIGE bleibt `SichtungsTag`.

── FLÄCHE STATT FARBFELD ──────────────────────────────────────────────────────────────

Jede Kategorie ist eine gefüllte Fläche aus `sichtungsPalette` (`flaeche`, abgedunkelt bis zum
Textboden), Kürzel groß, Bedeutungswort darunter. „unverletzt“ hat KEINE Fläche (durchsichtig,
nur die Kante), „tot“ trägt in JEDEM Zustand eine Schraffur: nachts lagen beide sonst bei
1,12 : 1 (Change `eon26eat-farbe-entlasten`, D8). Jede Fläche trägt eine Kante in der
Textfarbe des Modus (`sichtungsKante`): nachts verschwänden sonst Rot, Blau, Grün und Schwarz,
am Tag Gelb.

── GEWÄHLT OHNE FARBE ERKENNBAR, ÜBRIGE MIT FARBE ─────────────────────────────────────

Die gewählte Fläche bleibt gefüllt und trägt ✓ und einen Rahmen von 3 px. Die übrigen behalten
ihre Farbe abgeschwächt: 4-px-Innenrahmen in der Anzeigefarbe (`punkt`) auf getönter Fläche
(`sichtungsToenung`), Text in der Textfarbe; so findet man eine Fehlwahl an der Farbe wieder
(vorher nur ein 8-px-Streifen). Für Hilfstechnik `radiogroup`/`radio` mit `aria-checked`,
Roving-Tabindex, Pfeile wechseln, Leertaste und Enter wählen (ein `type="button"` sendet kein
Formular ab).

── STARTFOKUS AUF DER GRUPPE ──────────────────────────────────────────────────────────

Das Fokusziel der Erfassung (`data-erfassung-fokus`) ist die Gruppe (`tabIndex -1`), nicht
„SK I“: ein Ring auf SK I las sich wie eine Vorauswahl. Ein Pfeil auf der Gruppe führt zur
gewählten, sonst zur ersten Kachel; Tab führt in die Gruppe auf den Roving-Stopp.

── FORMULARVERTRAG ────────────────────────────────────────────────────────────────────

`value`/`onChange` wie ein antd-Feld, damit der Baustein direkt in einem `Form.Item` hängt.
`onChange(null)` nur mit `abwaehlbar` (Erfassung: eine Person darf ohne Sichtung entstehen).

Quelle: `frontend/src/personen/SichtungsWahl.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
