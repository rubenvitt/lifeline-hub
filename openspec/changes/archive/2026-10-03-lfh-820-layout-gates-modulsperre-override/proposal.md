# Proposal

## Why

LFH-435 hat die Layout-Gates um nicht-privilegierte Rollen ergänzt. Die Modulsperre per Override
(`benoetigte_rolle` am Einsatz) hat es ausdrücklich ausgelassen, weil sie keine Rollen-, sondern
eine Mandanten-Einstellung ist (archivierte Change `lfh-435-e2e-gates-nicht-privilegiert`,
`design.md`, Non-Goals und Open Questions). Gerade diese Achse erzeugt aber eigene Zustände, die
heute kein Gate misst. Rail, Modulpanel und Navigations-Drawer zeigen gesperrte Zeilen mit
Schloss. Das Lage-Dashboard zeigt Kennzahlplätze mit „—“ und dem Grund „nicht freigegeben“ und
Paneele mit „Modul … nicht freigegeben.“. `nav-schmal` und `lage-dashboard-schmal` messen nur den
Admin, der wegen der Admin-Ausnahme nie gesperrt ist. Damit gelten beide Specs heute als „nicht
rollenabhängig“, obwohl ein Benutzer mit gesperrtem Modul eine andere Oberfläche sieht.

Die Frage aus dem Ticket („Bekommen beide Specs einen Durchgang?“) wird mit **ja** beantwortet.
Der Aufwand ist klein: eine API-Zeile zum Säen und ein Geschwistertest je Spec. Ohne ihn bleibt
der Sperrzweig die einzige sichtbare Rechte-Variante der Navigation, die nie gemessen wird.

## What Changes

- `frontend/e2e/nav-schmal.spec.ts` bekommt einen Durchgang „Beobachter mit Modulsperre“. Der
  Admin sperrt per Override Module des Einsatzes für Nicht-Admins, dann wechselt die Sitzung auf
  einen Beobachter. Gemessen werden der Drawer auf 390 px und die inline stehende Navigation (Rail
  und Modulpanel) auf 1024 px. Vor der Messung muss feststehen, dass eine gesperrte Zeile da ist
  (gesperrt, Grund „Keine Berechtigung“).
- `frontend/e2e/lage-dashboard-schmal.spec.ts` bekommt je Prüfbreite einen Durchgang „Beobachter
  mit Modulsperre“. Vorbedingung ist, dass gesperrte Kennzahlplätze „—“ mit dem Grund zeigen und
  die Paneele ihren Sperrsatz tragen. Danach gelten dieselben Zusicherungen wie für den Admin:
  Spaltenzahl, kein Überlauf, jede Kennzahl in ihrer Zelle.
- Für jeden neuen Durchgang wird eine Mutationsprobe festgehalten, die nur den Sperrzweig
  verbreitert. Der Beobachter wird rot, der Admin bleibt grün.
- Die Spec `layout-gates-rollen` nennt die Modulsperre per Override als eigene Achse.
- `frontend/e2e/AGENTS.md` ergänzt die LFH-435-Regel um diese Achse.
- Das Inventar in der Prüfliste dieser Change ersetzt die Verdikte „nicht rollenabhängig
  (Override-Achse)“ der beiden Specs. Die archivierte Prüfliste von LFH-435 bleibt unverändert.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `layout-gates-rollen`: Eine neue Anforderung verlangt, dass Navigationsrahmen und
  Lage-Dashboard auch mit Modulsperre per Override für einen Nicht-Admin ohne Überlauf rendern.
  Der Nachweis muss die Sperre als Ursache tragen.

## Impact

- Nur e2e-Code (`frontend/e2e/`), die Regeldatei `frontend/e2e/AGENTS.md` und die Spec. Kein
  Produktcode, solange kein neuer Durchgang einen echten Befund aufdeckt. Für diesen Fall gilt
  die Befundregel aus `design.md` (D5).
- Laufzeit: Es kommen fünf e2e-Tests hinzu (zwei in `nav-schmal`, drei, also einer je Prüfbreite, in
  `lage-dashboard-schmal`). Jeder legt einen Einsatz und einen Benutzer an. Die Shard-Zahl bleibt.
- Keine API- oder Schemaänderung. Die Override-Route
  `PUT /api/einsaetze/{id}/modul-overrides/{key}` besteht und wird schon von e2e genutzt.
