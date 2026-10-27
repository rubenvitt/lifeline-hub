# SichtungsWahl (BBK-Flächen, ohne und mit Wahl)

Die Wahl einer Sichtungskategorie nach BBK (LLH-1083, Spec `sichtungswahl`; Herleitung
`openspec/changes/archive/2026-10-18-knc0jyjd-sichtungswahl-flaechen/design.md`). Ein Baustein für Erfassung,
Nachsichtung, Patientenkopf und Zeilen-Popover; die ANZEIGE bleibt `SichtungsTag`.

── FLÄCHE STATT FARBFELD ──────────────────────────────────────────────────────────────

Jede Kategorie ist eine gefüllte Fläche aus `sichtungsflaechen` (abgedunkelt bis zum
Textboden), Kürzel groß, Bedeutungswort darunter; „unverletzt“ bleibt ohne Farbe. Jede Fläche
trägt eine Kante in der Textfarbe des Modus (`sichtungsKante`): nachts verschwänden sonst Rot,
Blau, Grün und Schwarz, am Tag Gelb.

── GEWÄHLT OHNE FARBE ERKENNBAR ───────────────────────────────────────────────────────

Die gewählte Fläche bleibt gefüllt und trägt ✓ und einen Rahmen von 3 px; die übrigen fallen in
die Randform (neutrale Fläche, Farbe nur als Streifen links) und bleiben wählbar. Für
Hilfstechnik `radiogroup`/`radio` mit `aria-checked`, Roving-Tabindex, Pfeile wechseln,
Leertaste und Enter wählen (ein `type="button"` sendet kein Formular ab).

── FORMULARVERTRAG ────────────────────────────────────────────────────────────────────

`value`/`onChange` wie ein antd-Feld, damit der Baustein direkt in einem `Form.Item` hängt.
`onChange(null)` nur mit `abwaehlbar` (Erfassung: eine Person darf ohne Sichtung entstehen).

Quelle: `frontend/src/personen/SichtungsWahl.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
