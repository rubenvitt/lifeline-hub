# Proposal

## Why

Bei 390 px bleibt auf der Lagekarte in mehreren Kartenmodi keine Karte zum Tippen übrig. Die offene
Leiste halbiert die Karte (680 → 374 px), und der Kartenfuß mit ausgeklappter Zeitachse deckt den
Rest. LFH-713 hat das nur für die Zonen- und Abschnittszeichnung gelöst. Platzieren, Taktisches
Zeichen, Bild einpassen und Messen verlangen ebenfalls einen Tipp auf die Karte, geben sie aber
nicht frei. Drei dieser Modi tragen ihre einzige Bedienung sogar in der Leiste und halten sie
deshalb erzwungen offen.

## What Changes

- Unter `lg` schließt die Leiste, solange **irgendein** Kartenmodus läuft: Zone, Abschnitt,
  Platzieren (aus „Nicht verortet“, Einsatzort, Deeplink `?platzieren=`), Taktisches Zeichen,
  Bild einpassen und Messen. Das gilt für jeden Startweg, nicht nur für die Werkzeugwahl in der
  Leiste.
- **Entscheidung des Auftraggebers (29.09.2026):** Nach dem Ende des Modus bekommt die Leiste
  ihren vorherigen Zustand zurück. Heute bleibt sie für die Sitzung zu. Die Leiste bleibt dabei
  montiert, Suche und Paneelzustand bleiben also erhalten.
- Während eines Modus lässt sich die Leiste unter `lg` über „Leiste einblenden“ zurückholen, etwa
  für „Koordinate eingeben“ oder „Mittelpunkt numerisch“. Dieses Umschalten gilt nur für den
  laufenden Modus und wird nicht gespeichert.
- Unter `lg` bekommen Platzieren, Taktisches Zeichen und Bild einpassen ein eigenes Band im
  Kartenfuß (Muster wie Zeichnen- und Mess-Steuerung) mit Beenden bzw. Abbrechen und ihren
  Pflichtschaltern. In der Leiste stehen diese Bedienelemente unter `lg` dann nicht mehr doppelt.
- Ab `lg` ändert sich nichts: Die Leiste steht neben der Karte, die Leistenmodi halten sie offen
  und tragen ihre Bedienung dort.
- Die bisherige sitzungsweite Freigabe beim Start einer Zeichnung (`karteFreigeben`/`verberge`)
  entfällt zugunsten der Ableitung aus dem laufenden Modus.

## Capabilities

### New Capabilities

- `lagekarte-kartenleiste`: Sichtbarkeit der Kartenleiste auf schmalen Breiten während der
  Kartenmodi. Legt fest, wo die Modusbedienung steht und welchen Zustand die Leiste nach dem
  Modus hat.

### Modified Capabilities

(keine)

## Impact

- Frontend: `pages/LagekartePage.tsx` (Vorrang der Leiste, Fuß-Band einhängen),
  `pages/lagekarte/leistenWahl.ts` (Vorrangregel, Moduszustand), `pages/lagekarte/Sidebar.tsx`
  (Modusbedienung unter `lg` nicht doppelt), neues Fuß-Band `pages/lagekarte/PlatzierSteuerung.tsx`.
- Tests: `leistenWahl.test.ts`, Komponententests für Band und Sidebar, e2e
  `e2e/lagekarte-touch.spec.ts` (je Modus bei 390 und 768 px mit `hasTouch`).
- Doku: Lagekarten-Absatz in `CLAUDE.md` („Rest LFH-765“ fällt).
- Kein Backend, keine API, keine Migration.
