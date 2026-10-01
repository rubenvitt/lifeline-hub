# Proposal

## Why

Auf der Kartenansicht der Betroffenen (`/einsaetze/:id/personen?ansicht=karte`) wechselt das Ziel
unter dem Zeiger, ohne dass die bedienende Person etwas tut. Kommt live eine Person nahe einem
Marker hinzu, verschmelzen beide zu einem Cluster-Donut, und der Marker unter dem Zeiger ist weg
(LFH-613-Prüfliste, Tabelle 4, Nr. 12 (b), offen an LFH-668). Häufiger noch klappt ein
aufgefächertes Bündel zu: `Kartenflaeche` schließt den Spider bei **jeder** Änderung der Marker,
und jedes Live-Ereignis einer beliebigen Person liefert neue Marker. Wer in einer größeren Lage
aus einem Bündel von 30 Personen eine antippen will, verliert die Auffächerung, sobald irgendwo
ein Zustand gespeichert wird.

Für Listen hat das Projekt die Antwort schon: die Zeilenschleuse der `Datensicht` mit
Sammelbanner (WCAG 3.2.5, Bedien-Leitlinie „Live-Updates springen nicht unter dem Cursor“). Der
Mensch hat am 01.10.2026 entschieden, dieses Muster auf die Karte zu übertragen.

## What Changes

- **Schleuse der Betroffenen-Karte:** Solange die Maus (oder ein Stift) über der Kartenansicht
  liegt, der Fokus darin steht oder ein Bündel aufgefächert ist, halten die Personen-Marker
  **Menge und Lage**. Sichtungsfarbe, Kurzzeichen und Beschriftung aktualisieren weiter.
  Zugänge, verlegte und entfallene Personen warten.
- **Sammelbanner in der Kopfzeile** der Kartenansicht nennt, was wartet, und bietet „anzeigen“
  an. Die Kopfzeile hat eine feste Höhe, damit das Erscheinen des Banners die Karte nicht
  verschiebt.
- Die Schleuse öffnet sich, wenn der Zeiger und der Fokus die Kartenansicht verlassen und kein
  Bündel mehr aufgefächert ist, oder auf „anzeigen“.
- Die Hinweiszeile („n ohne Koordinate“) behauptet nicht „alle stehen auf der Karte“, solange
  Zugänge warten.
- **Spider bleibt bei reiner Inhaltsänderung offen** (`Kartenflaeche`, geteilt mit der
  Lagekarte): ändern sich nur Eigenschaften der Marker, nicht Schlüssel, Folge oder Lage, bleibt
  ein aufgefächertes Bündel stehen und zeigt die neuen Inhalte. Das gilt auch auf der Lagekarte.
- Prüfliste LFH-613, Tabelle 4, Nr. 12 wird mit Verdikt und Belegen nachgetragen.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `betroffene-lagedaten`: Die Kartenansicht der Betroffenen hält bei Live-Änderungen Menge und
  Lage der Marker, solange jemand mit ihr arbeitet, und nennt das Wartende im Sammelbanner.
- `lagekarte-klickziele`: Ein aufgefächertes Bündel bleibt bei einer reinen Inhaltsänderung der
  Marker offen.

## Impact

- Frontend: `personen/BetroffeneKarte.tsx` (Schleusenbereich, Kopfzeile, Banner), neue reine
  Logik `personen/kartenSchleuse.ts` mit Tests, `personen/personenKarte.ts` unverändert;
  `pages/lagekarte/Kartenflaeche.tsx` (Spider bei Inhaltsänderung, neue optionale Prop
  `onSpiderOffen`), reine Hilfen in `pages/lagekarte/spiderfy.ts` bzw. `markerLayer.ts` mit Tests.
- e2e: Browserbeleg in `e2e/betroffene-layout.spec.ts` bzw. `e2e/betroffene-karte.spec.ts`.
- Regeln: `frontend/src/personen/AGENTS.md`, `frontend/src/pages/lagekarte/AGENTS.md`.
- Doku: `docs/superpowers/specs/2026-09-22-lfh-613-pruefliste.md` (Tabelle 4, Nr. 12, Bilanz).
- Kein Backend, keine API, keine Migration.
