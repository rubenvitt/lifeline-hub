# Dashboard-Baukasten (Verteilung und Matrix)

**Dashboard-Baukasten** (LLH-1140, Vorbild Lagebild): jede Fläche, die eine Lage in Zahlen
zeigt (Lagebild, Führung · Überblick, Meldebild-Kopf), baut sich aus denselben Bausteinen in
`components/instrument/`.
Kopf: `EinsatzSeite` mit Datenstand und `WarnstufenHinweis` (nur bei Ton achtung/alarm; die
Warnstufe ist keine Kennzahl). Reihe 1: `Kennzahlenband`, sechs Plätze (Regel oben).
Reihe 2: `PaneelReihe` mit bis zu drei Paneelen (`1fr 1fr 1.1fr`, unter `lg` gestapelt) in der
`DashboardFlaeche` (Fugenraster). Reihe 3, wo es sie gibt: Fußband „Führungsstand“ als
`Kennzahlenband` mit `groesse="klein"`, Zahlen aus dem Modulzähler. Jedes Paneel geht durch
`DashboardPaneel` (Augenbraue, Zähler als Meta, Sprung „… ↗“, `PaneelZustand`; `gesperrt` nennt
den Grund, ohne Sprung und Leeraktion) und ist einer der Typen `VerteilungsPaneel` (Zahl +
Anteilsbalken je Kategorie: Sichtung, FMS-Status), `MatrixPaneel` (Stufenmatrix: Gefahren),
`StromPaneel` (Zeitachseneinträge mit Sammelbanner), `ListenPaneel` (kurze Liste mit
„n weitere ↗“) oder `GliederungsPaneel` (Teile mit Lagekante, Kopf, Zahlspalte). Laden, Fehler,
Leer und Gesperrt sehen verschieden aus; eine unbekannte Zahl steht als „—“, nie als 0. Balken
ergänzen die Zahl, nie ersetzen sie; Farben kommen aufgelöst vom Aufrufer, der Baustein trägt
keine Statuskarte. Ein neuer Paneeltyp kommt als Baustein hierher, nicht lokal in eine Seite.

Quelle: `frontend/src/components/instrument/DashboardPaneel.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
