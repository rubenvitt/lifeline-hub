# Tasks

## 1. Verzögertes Gerippe

- [x] 1.1 `SeitenSkeleton` bekommt `verzoegert`, das `lfh-skelett--verzoegert` setzt. In `theme/sprache.css` bleiben die Balken die ersten 120 ms unsichtbar, ihr Platz ist von Anfang an da. Beleg: Komponententest prüft Klasse und `aria-busy`; Vitest grün.

## 2. Gerippe-Seite und Wechsel im Rahmen

- [x] 2.1 Neuer Baustein `einsatz/ModulWechselGerippe.tsx` (Gerippe-Seite: `EinsatzSeite` mit `modulName(key)` + verzögertes `SeitenSkeleton`, `data-testid="modul-gerippe"`; Hülle mit `freigegeben`-Zustand und `startTransition` laut design.md D1). Per TDD: Test zuerst mit MemoryRouter. Wechsel zwischen zwei Modulen zeigt erst Kopf und Gerippe, dann die Seite; Wechsel im selben Modul und erster Aufruf zeigen kein Gerippe. Vitest grün.
- [x] 2.2 `EinsatzLayout.tsx` hängt das Outlet in die Hülle (nach Modulwächter und gesperrtem Modul). Beleg: bestehende `EinsatzLayout`-, `ModulPanel`- und `IconRail`-Tests grün, nötige Umstellungen auf `findBy…` vorgenommen.
- [x] 2.3 Lagekarte und Kräfteübersicht in `App.tsx`: Suspense-Fallback = Gerippe-Seite des Moduls statt Ladetext. Beleg: Test oder Prüfung, dass „Karte wird geladen…“ im Code nicht mehr vorkommt; Vitest grün.

## 3. Regel und Nachweis

- [x] 3.1 Regel in `frontend/AGENTS.md`, Abschnitt „Rahmen“: Modulwechsel zeigt Kopf und Gerippe, eine Stelle im Rahmen, keine Seite baut ein eigenes Vorab-Gerippe für den Wechsel, Verweis auf die Spec `seiten-zustaende`. Beleg: Prettier grün.
- [x] 3.2 Gegenmessung am Produktions-Build mit der Messung aus LLH-1838: Der Seitenkopf des Zielmoduls steht für Betroffene, Personal und Fahrzeuge im ersten Bild (≤ 50 ms), die Seite danach wie bisher. Ergebnis als Kommentar an LLH-1838.
- [x] 3.3 Bilder: Wechsel Überblick → Personal, das Gerippe-Bild und die fertige Seite, für PR und Meldung.
- [ ] 3.4 `./scripts/check-all.sh --geaendert --ohne-e2e` grün.

## Workflow follow-up

- `/opsx:archive q71gt8zq-modulwechsel-gerippe` im selben Branch, dann PR gegen `alpha`.
