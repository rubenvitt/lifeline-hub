# Dashboard-Baukasten (Abschnitte, Gliederung, Strom)

ListenAbschnitt — ein Abschnitt eines Dashboard-Paneels mit kurzer Liste (LLH-1145, Regel
„Dashboard-Baukasten“, `frontend/AGENTS.md`). Erster Abnehmer: „Offene Vorgänge“ im Überblick.

KOPF: Augenbraue als Überschrift (Vorgabe `h3`, unter dem `h2` des Paneels), die Zahl (Mono),
eine Notiz und der Sprung „alle ↗“ ins Modul. Die ZAHL reicht der Aufrufer aus seiner
Zählquelle (Modulzähler, LFH-550); der Abschnitt zählt seine Liste nie. Zahl und Liste haben
getrennte Stände: die Zahl steht, sobald sie bekannt ist, auch wenn die Liste fehlt (ohne Netz
liegt der Zähler auf der Platte, manche Liste nicht). Unbekannt steht „—“, nie 0.

KÖRPER: höchstens `max` Einträge (Vorgabe 3). Leer ist EINE Zeile „keine“, keine leere Fläche;
Laden, Fehler und „ohne Netz“ sind kein „keine“. GESPERRT (Modul nicht freigegeben, LFH-888):
Zahl „—“, der Grund als Zeile, kein Sprung, keine Liste.

Zeilen mit Ziel nehmen `listenZeileStil`; der Sprung trägt den Boden `controlHeight`.

Aus `frontend/src/components/instrument/StromPaneel.tsx`:

StromPaneel — jüngste Einträge eines Zeitstroms, Neues per Sammelbanner statt Einschieben
(Regel „Dashboard-Baukasten“, `frontend/AGENTS.md`; Vorbild „Jüngste ETB-Einträge“ im Lagebild,
LLH-1140). Abnehmer: ETB-Einträge im Lagebild, Entscheidungen im Überblick.

Quelle: `frontend/src/components/instrument/ListenPaneel.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
