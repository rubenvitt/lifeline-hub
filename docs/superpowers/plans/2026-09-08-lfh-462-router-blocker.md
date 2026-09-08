# LFH-462 Router-Blocker Implementation Plan

> **For agentic workers:** Ausführung sequenziell im Main-Agent nach `dev-clickup-ausfuehren`; unabhängige Scope- und Review-Aufträge nach `dev-clickup-orchestrieren`.

**Goal:** Befehlsentwürfe bei interner Navigation bis zur Speicherung oder ausdrücklichen Entscheidung schützen.

**Architecture:** Die vollständigen bestehenden JSX-Routen werden mit `createRoutesFromElements` in Data-Router-Routen überführt. Ein persistentes Root-Layout trägt Auth, Kommandopalette und Sitzungswache. Der Befehlsdialog verwendet `useBlocker` und den bestehenden Verlustschutz-Merker/Autosave einschließlich Änderungszähler.

**Tech Stack:** React 19, React Router 8.3, Ant Design 6.5, TanStack Query, Vitest, Playwright.

**Spec:** [LFH-462](https://app.clickup.com/t/86cb87u35), `docs/superpowers/specs/2026-08-21-lfh-342-pruefliste.md` (N18).

## Status

Laden abgeschlossen → Scope abgeschlossen → Design abgeschlossen → Entwicklung abgeschlossen → Review abgeschlossen (zwei bestätigte Befunde behoben) → vollständige Gates abgeschlossen → bereit zur PR-Veröffentlichung.

## 1. Router und Provider

- [x] `frontend/src/App.test.tsx`: dieselbe Routenfabrik mit `createMemoryRouter` prüfen; bestehende Auth-, Modul- und Redirect-Belege erhalten. Zusätzliche Belege für Login-Rückkehr, Lazy-Route und Query-Deeplink.
- [x] `frontend/src/App.tsx`: bestehende Routen vollständig unter einer Root-Route mit `App` als Layout exportieren; `SitzungsLayout` ruft `useSitzungsWache` und rendert `<Outlet />`.
- [x] `frontend/src/main.tsx`: `const router = createBrowserRouter(appRouten)` außerhalb des React-Renderns, `<RouterProvider router={router} />` unter Query/Theme/AntApp.
- [x] Gezieltes Gate: `rtk proxy mise exec node@26.7.0 pnpm@11.10.0 -- pnpm -C frontend exec vitest run src/App.test.tsx --no-file-parallelism`.

Risiken: Provider-Remounts, Auth-Umleitungen, relative Pfade, Lazy/Suspense sowie Navigation und `setSearchParams` in Effekten. Routen und Datenzugriff bleiben fachlich gleich; keine Loader-/Action-Migration.

## 2. Befehlsentwurf

- [x] `frontend/src/pages/BefehlDetailPage.test.tsx`: Data-Router als Testträger. RED für Brotkrume → Dialog; Verwerfen → Ziel; Bleiben → Editor; Autosave-Erfolg → nachgeholtes Ziel; Fehler → Dialog bleibt; Speichern und weiter → bestätigter PATCH. Ergänzend Browser-Zurück, saubere/read-only Fassung und neue Eingabe während PATCH.
- [x] `frontend/src/entwurf/EntwurfNavigationSchutz.tsx`: Blocker mit `ungespeichert`, Callback `speichern: () => Promise<void>`, `speichert: boolean`; sichtbarer Modal-Dialog mit drei Aktionen. Automatisches `proceed()` ausschließlich für einen noch blockierten Wechsel ohne offene Fassung. Gleiches pathname (Hash/Query) verlässt den Editor nicht.
- [x] `frontend/src/pages/BefehlDetailPage.tsx`: Dialog für schreibbaren Entwurf anschließen. „Speichern und weiter“ validiert das Formular und stößt den bestehenden Autosave an; dessen Erfolg löst den Blocker, dessen Fehler hält ihn. Kein paralleler zweiter Speichermechanismus.
- [x] Veraltete BrowserRouter-Aussagen in `AGENTS.md`, `CLAUDE.md` und Hook-Kommentar berichtigen; Lagebericht behält bisherigen Schutzumfang.
- [x] Gezieltes Gate: `rtk proxy mise exec node@26.7.0 pnpm@11.10.0 -- pnpm -C frontend exec vitest run src/pages/BefehlDetailPage.test.tsx src/entwurf/useEntwurfVerlustschutz.test.tsx --no-file-parallelism`.

Risiken: Speicherrennen, fehlgeschlagene Requests, Fortsetzung nach „Bleiben“, Rechteentzug. Blocker und Autosave müssen denselben offenen Stand lesen; kein `isFieldsTouched()` als Speicherquittung.

Zusätzliche Review-Nachweise: vorbereitete Speicherquittungen auch für manuelle PATCH,
seriell ausgeführte PATCH und Abbruch noch wartender Aufträge beim Unmount. Alle drei
Fehlerpfade vor dem Fix rot nachgewiesen; gezielter Abschlusslauf 43/43 grün.

## 3. Nachweise und Lieferung

- [x] `.agents/skills/dev-clickup-ausfuehren/SKILL.md`: neue Worktrees nach erfolgreichem frischem Fetch ausdrücklich von `origin/main`; abweichende User-Basis gewinnt.
- [x] Reale Browser-Prüfung des Blockers ergänzen; vollständige Vitest-/Playwright-Suite, Lint, Typecheck und Produktionsbuild ausführen. Vitest 3.727/3.727, Playwright 138/138, Rust 2.198 bestanden / 5 ignoriert. Das Sammel-Gate `rtk proxy ./scripts/check-all.sh` trägt zusätzlich Backend/Codegen/Dependency-Prüfung; der anfänglich rote Browser-Schritt wurde nach zwei belegten Bestands-Testkorrekturen vollständig grün wiederholt (siehe Prüfliste).
- [x] Unabhängiger read-only Review, bestätigte Befunde reparieren, betroffene Prüfungen erneut ausführen.
- Lieferung: `rtk git diff --check`, sauberer Commit mit LFH-462, Push, PR gegen `main`; Head und Checks live prüfen und in ClickUp dokumentieren. Kein Merge beauftragt.

## Quellen

- [React Router: useBlocker](https://reactrouter.com/api/hooks/useBlocker)
- [React Router: createBrowserRouter](https://reactrouter.com/api/data-routers/createBrowserRouter)
