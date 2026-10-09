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

## Sitzungen beenden (LFH-1092)

Herleitung: `/mnt/project-files/lfh-1092/design.md`. Eine Sitzung trägt eine öffentliche
`kennung` (nie den Token-Hash), die grobe Gerätebezeichnung (Backend
`src/auth/geraet_bezeichnung.rs`, der rohe `User-Agent` wird nie gespeichert) und „zuletzt gesehen“
im 5-min-Takt.

- **Jeder Weg, der Sitzungszeilen löscht, meldet ihre Kennungen an `live.melde_sitzung_ende`**
  (Logout, Passwort, Deaktivieren, Zweitfaktor-Reset, Neuanmeldung, Beenden): offene Live-Ströme
  enden dann sofort, und das Gerät räumt über `/me` → 401 sein Lagebild. Die Löschfunktionen im
  Backend-Modul `src/auth/session.rs` liefern die Kennungen dafür. Nachweis `tests/sitzungen.rs`,
  `e2e/sitzung-beenden.spec.ts`.
- Beenden lässt Konto, Passwort und Zweitfaktor unberührt; Sitzungen gekoppelter Geräte
  (`kopplung_id`) stehen weder in der Liste noch werden sie beendet. Admin-Routen
  (`/api/benutzer/{id}/sitzungen…`) prüfen die Organisation, fremd = 404. Die aktuelle Sitzung
  endet nur über Abmelden (422). Je beendete Sitzung ein Spureintrag: selbst `auth_audit`,
  Admin `admin_audit`, beide `sitzung_beendet`.
- `SitzungsListe` fragt nicht nach (umkehrbar durch erneutes Anmelden), „Alle … beenden“ steht
  erst ab zwei beendbaren Sitzungen. Der Query-Key `sitzungen` ist nicht live.
