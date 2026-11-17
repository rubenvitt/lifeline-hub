# Dashboard-Baukasten (Verteilung, Matrix, Kopf-Aktion)

**Dashboard-Baukasten** (Vorbild Lagebild): jede Fläche, die eine Lage in Zahlen
zeigt (Lagebild, Führung · Überblick, Meldebild-Kopf), baut sich aus denselben Bausteinen in
`components/instrument/`.
Kopf: `EinsatzSeite` mit Datenstand und `WarnstufenHinweis` (nur bei Ton achtung/alarm; die
Warnstufe ist keine Kennzahl). Darunter, vor Band und Paneelen, auf Überblick, Lagebild und Lagemonitor
die **Alarmzeile „Was brennt“** (`AlarmZeile`): Einträge,
Folge und Wortlaut nur aus `lage/wasBrennt.ts`, auf den Übersichten über `lage/useWasBrennt.ts`,
am Monitor über `lage/alarmAusMonitor.ts`; feste Höhe, „Nichts brennt“ nur bei vollständigen
Quellen, Sprungziele aus `lage/alarmZiel.ts`. Sie zeigt Zustände, die Alarmzone Ereignisse; keine
Seite baut eine zweite Sammlung. Nur im Überblick folgt ihr die Reihe **„Einsatz starten“**: eine eigene `PaneelReihe` mit genau einem `ListenPaneel`,
Punkte nur aus `pages/fuehrung/startliste.ts`, nur mit Schreibrecht am aktiven Einsatz; sie fehlt
ganz, sobald kein Punkt offen ist oder sie in diesem Browser ausgeblendet ist. Weil sie über den
Paneelreihen steht, warten sie und die Reihen beim ersten Aufbau gemeinsam auf ihre Quellen; die
Alarmzeile nicht. Später hängt eine erstmals ladende Quelle nichts aus, und ein gescheiterter
Neuabruf zählt mit den zuletzt geladenen Daten (Review LLH-1815).
Reihe 1: `Kennzahlenband` (Regel oben; sechs Plätze im Band „Lage in Zahlen“ des Lagebilds). Der
Überblick hat keins (Change `wf7l9axn-ueberblick-ohne-band`): seine erste
Paneelreihe trägt „Nächste Marken“ und „Offene Vorgänge“, die zweite „Einsatzabschnitte“ und
die Entscheidungen, damit Fristen über der Falz und am Handy zuerst stehen. Beim ersten Aufbau
warten die Reihen auf die Quellen der Gliederung und der Marken, sonst rückt alles darunter.
Reihe 2: eine oder mehrere `PaneelReihe` mit je bis zu drei Paneelen (`1fr 1fr 1.1fr`, unter
`lg` gestapelt) in der `DashboardFlaeche` (Fugenraster). Ein Kopf über einer Vergleichstabelle
(Meldebild) ist nur eine Paneelreihe mit `dichte="kompakt"`, ohne Band, ohne Füllkachel; eine
Einzelzahl darin (Rückmeldung) ist eine `Kennzahl` mit Sprung. Reihe 3, wo es sie gibt: Fußband
„Stand“ des Lagebilds (Lagebericht, UHS aktiv) als `Kennzahlenband` mit `groesse="klein"`. Jedes Paneel geht durch
`DashboardPaneel` (Augenbraue, Zähler als Meta, Sprung „… ↗“, Kopf-Aktion ohne „↗“ für eine
Handlung am Paneel selbst, `PaneelZustand`; `gesperrt` nennt den Grund, ohne Sprung und
Leeraktion) und ist einer der Typen `VerteilungsPaneel` (Zahl +
Anteilsbalken je Kategorie: Sichtung, FMS-Status), `MatrixPaneel` (Stufenmatrix: Gefahren),
`StromPaneel` (Zeitachseneinträge mit Sammelbanner), `ListenPaneel` (kurze Liste mit
„n weitere ↗“) oder `GliederungsPaneel` (Teile mit Lagekante, Kopf, Zahlspalte). Mehrere kurze
Listen in einem Paneel sind `ListenAbschnitt`e („Offene Vorgänge“): je Überschrift,
Zahl vom Aufrufer, Notiz, höchstens drei Einträge, „alle ↗“; ein Abschnitt fällt nie weg, auch
leer („keine“), gesperrt („—“ mit Grund), ausgefallen oder „ohne Netz nicht geladen“. Laden, Fehler,
Leer und Gesperrt sehen verschieden aus; eine unbekannte Zahl steht als „—“, nie als 0. Balken
ergänzen die Zahl, nie ersetzen sie; Farben kommen aufgelöst vom Aufrufer, der Baustein trägt
keine Statuskarte. Ein neuer Paneeltyp kommt als Baustein hierher, nicht lokal in eine Seite.

Quelle: `frontend/src/components/instrument/DashboardPaneel.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
