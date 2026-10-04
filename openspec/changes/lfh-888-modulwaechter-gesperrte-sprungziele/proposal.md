# Proposal

## Why

Navigation, Sprungpalette und Datenabrufe folgen seit LFH-669 den Modulfreigaben des Servers.
Viele andere Wege führen aber weiter ungeprüft in ein Modul: Kopfaktionen („Eintrag“ und
„Lagebericht“ im Überblick, „Zum ETB-Eintrag“ in Detailseiten), Paneel- und Inspector-Knöpfe,
Kennzahl-Ziele und Datenzeilen-Verweise. Eine Bestandsaufnahme fand rund vierzig solcher Sprünge.
Ein Deeplink in ein gesperrtes Modul hat keinen Wächter. Jede Modulseite läuft dann in ihren
eigenen 403-Zustand, und der sieht auf jeder Seite anders aus (ClickUp LFH-888). Die Change
LFH-669 hatte das bewusst als Non-Goal ausgeklammert.

## What Changes

- **Modulwächter im Einsatzrahmen.** Meldet der Server für das Modul der aktuellen Route
  `zugriff: false`, zeigt der Inhaltsbereich statt der Modulseite einen einheitlichen Hinweis.
  Das gilt auch für die Unterrouten des Moduls (Detail, Druck, Stab-Unterseiten). Der Hinweis
  nennt das Modul und den Grund („ausgeblendet“ oder „für deine Rolle nicht freigegeben“). Er
  bietet einen Rückweg in ein freies Modul an. Rail und Modulpanel bleiben bedienbar. Solange die
  Freigaben laden oder ihr Abruf scheitert, greift der Wächter nicht, und die Seite verhält sich
  wie heute.
- **Bedienelemente in ein fremdes Modul prüfen die Freigabe.** Dazu gehören Kopfaktionen,
  Paneel-, Leer- und Inspector-Aktionen, Kennzahl-Ziele und eigenständige Verweise wie
  „Meldebild ↗“. Ein Knopf steht gesperrt da, mit „Keine Berechtigung“ als Grund (M16). Ein
  Link oder ein Kennzahl-Ziel entfällt, und Text und Zahl bleiben stehen.
- **Verweise in Datenzeilen bleiben ungeprüft.** Gemeint sind Backlinks im ETB, Bezugslinks an
  Karten und Toasts der Alarmzentrale. Für sie ist der Wächter das Netz.
- Die Rückwege der Sackgassen (Platzhalter `ModulStub`, Stab ohne Freigabe) führen in ein freies
  Modul statt fest auf das Standardmodul oder den Überblick.
- Die Frontend-Regel „ein Einstieg ist keine Freigabe, die Zielseite prüft selbst“
  (`frontend/AGENTS.md`, Bedien-Leitlinie) wird fortgeschrieben. Der Rahmen prüft das Modul, und
  die Zielseite prüft weiter ihren Datensatz.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `modul-freigabe`: Zwei neue Anforderungen kommen dazu. Erstens zeigt eine Modulroute ohne
  Zugriff einen einheitlichen Hinweis statt der Modulseite. Zweitens sind Bedienelemente, die in
  ein fremdes Modul springen, bei fehlendem Zugriff gesperrt oder ohne Ziel.

## Impact

- **Frontend, Rahmen:** `einsatz/EinsatzLayout.tsx` (Wächter vor dem `<Outlet>`), neue
  Komponente `einsatz/ModulGesperrt.tsx`, `einsatz/modulRegistry.ts` (Sprung-Prüfung und
  Rückwegziel), `einsatz/ModulStub.tsx`, `stab/useStabFreigabe.tsx`.
- **Frontend, Sprungstellen** (Liste in design.md D4): Überblick, Lage-Dashboard,
  Kräfteübersicht, `kraefte/Verdichtungszeile.tsx`, die Detailseiten von Befehl, Lagebericht,
  Pressemitteilung und UHS, Gefahren, Betreuung, Personen-Detail, Schaden-Daten, Lagekarte
  (Inspector, Zonen-Inspector, `markerToUrl`) und `etb/Schnellerfassung.tsx`.
- **Regeln:** `frontend/AGENTS.md`. Die Spec `modul-freigabe` bekommt ein Delta.
- **e2e:** `e2e/modulfreigabe-org-vorgabe.spec.ts` wird um einen Deeplink in das gesperrte Modul
  erweitert.
- Kein Backend, keine Migration, keine Änderung daran, wer worauf zugreifen darf.
