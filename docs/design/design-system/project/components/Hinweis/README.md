# Hinweis: Rechte, Warnstufe und Alert auf der Statusfläche

Persistenter Speicher-Fehler und Rechte-Hinweis „Nur Ansicht · Grund“.

── Warum nicht der Toast ──────────────────────────────────────────────────────
Ein Toast ist nach rund drei Sekunden weg, das ausgefüllte Formular steht unverändert da und
wirkt gespeichert. Der Fehlerzustand gehört deshalb an die SEITE (`mutation.error`). Der
ERFOLG bleibt beim Toast: er quittiert eine abgeschlossene Handlung.

Der Alert verschwindet beim nächsten Absenden von selbst (react-query räumt `error` beim
Übergang nach `pending`) — die zweite Hälfte der Zusicherung, mitgetestet.

`fehlerText` ist rein und exportiert, damit die Fallunterscheidung ohne Render prüfbar ist.
„Ohne Fehler NICHTS" ist die Aussage, die ein Primitiv auffliegen lässt, das immer einen Text
liefert. Den Wortlaut nimmt sie aus `api/client.fehlerText`, damit Netzfehler („nicht
abgeschickt“) und unklarer Ausgang („erst die Liste prüfen“) am Ort so heißen wie vorher im
Toast; nur ein fremder Fehler bekommt den Rückfalltext.

Aus `frontend/src/components/instrument/WarnstufenHinweis.tsx`:

WarnstufenHinweis — die Warnstufe im Seitenkopf einer Dashboard-Fläche (Regel
„Dashboard-Baukasten“, `frontend/AGENTS.md`; Vorbild Lagebild, LLH-1140). Die Warnstufe ist
keine Kennzahl: sie steht neben dem Datenstand, nur wenn sie etwas sagt (Ton achtung/alarm).

Quelle: `frontend/src/components/SpeicherHinweis.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
