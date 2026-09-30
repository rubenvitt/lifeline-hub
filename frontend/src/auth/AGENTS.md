# Sitzung über mehrere Tabs — Regeln

Gilt für `frontend/src/auth/`, `api/client.ts` (Schreibwege) und die Server-Gegenstücke
(`CurrentUser`, `POST /api/auth/logout`); ergänzt `frontend/AGENTS.md`. Pfade relativ zu
`frontend/src/`.

Herleitung: `openspec/changes/archive/2026-09-29-lfh-387-auth-zustand-tabuebergreifend/design.md`. Das Cookie gilt
originweit, der Benutzer steht pro Tab — **der Server ist die Wahrheit, der Kanal nur Komfort.**

- Jede schreibende Anfrage trägt `X-Erwarteter-Benutzer-Id` (`apiSend`/`apiUpload`,
  `setzeErwartetenBenutzer` synchron mit `benutzer` im `AuthProvider`); `CurrentUser` lehnt eine
  abweichende Kennung mit **412** ab (`SitzungsBenutzerMismatch`), erst nach der Sitzung (tot =
  401). Kein anderer Schreibweg (`api/schreibwege.guard.test.ts`). Nachweis
  `tests/sitzung_benutzerwechsel.rs`, `e2e/sitzung-mehrere-tabs.spec.ts`.
- `POST /api/auth/logout` mit fremder Kennung → 412, Sitzung bleibt; `logout()` liefert dann
  `false` und meldet nicht ab. Die Sitzungswache meldet nach 401 **nur lokal** ab
  (`abmeldenLokal`) — ein Server-Logout träfe eine inzwischen neue Sitzung.
- Jede 412 stößt `lfh:benutzer-pruefen` an, der Provider prüft per `/me` (auch auf Kanalmeldung
  `auth/authKanal.ts` und Sichtbarkeit; Generationszähler verwirft veraltete Antworten); fremder
  Benutzer → `BenutzerKonfliktDialog` (eine Aktion, nicht schließbar). Ein Kanalobjekt je Tab
  (kein Selbst-Echo). **Der Konflikt wird per Neuladen gelöst, nie im laufenden Baum** — sonst
  speicherte eine noch montierte Seite von A ihren Entwurf mit der Kennung von B. Offline-Abgleich
  ruht im Konflikt (`abgleichFuer`).
