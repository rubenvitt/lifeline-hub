# Proposal

## Why

Das Session-Cookie gilt für den ganzen Origin, der angemeldete Benutzer steht aber nur im
React-Zustand des einzelnen Tabs. Meldet sich in einem Tab Benutzer B an, zeigt ein zweiter
Tab weiter Benutzer A, und jede Schreibaktion aus diesem Tab läuft unter B. Der
Queue-Besitzer-Guard aus LFH-334 (HTTP 412) schützt nur die Offline-Replays, nicht alle
Schreibwege. Ein „Abmelden“ im alten Tab beendet außerdem die neue Sitzung von B.

## What Changes

- **Server bindet jede Schreibanfrage an den erwarteten Benutzer:** Ein Tab schickt bei jeder
  schreibenden Anfrage (POST/PUT/PATCH/DELETE) die Kennung des Benutzers mit, den er anzeigt.
  Gehört die Sitzung inzwischen jemand anderem, lehnt der Server mit 412 ab, bevor irgendetwas
  gelesen oder geschrieben wird. Ohne Kennung bleibt alles wie bisher (Skripte, Tests, Altstände).
- **Abmelden aus einem veralteten Tab beendet keine fremde Sitzung:** `POST /api/auth/logout`
  mit abweichender Kennung antwortet 412 und lässt Sitzung und Cookie stehen.
- **Tabs erfahren voneinander:** Anmelden, Abmelden und Benutzerwechsel werden an alle Tabs
  desselben Browsers gemeldet. Ein Tab prüft daraufhin (und beim Wieder-Sichtbarwerden) seinen
  Benutzer gegen den Server.
- **Benutzerkonflikt als eigene Situation:** Stellt ein Tab fest, dass die Sitzung einem
  anderen Benutzer gehört, sperrt ein Dialog den Tab, nennt beide Benutzer und bietet „Als
  <neuer Benutzer> weiterarbeiten“ an. Der Tab schreibt bis dahin nichts.
- **Abgelaufene Sitzung meldet nur noch lokal ab:** Die Sitzungswache (LFH-268) ruft bei 401
  nicht mehr den Server-Logout; die Sitzung ist ohnehin tot, und der Ruf konnte eine
  inzwischen neue Sitzung treffen. Der Ablauf wird an die anderen Tabs gemeldet.
- 401-Behandlung, Rückkehr-URL und Offline-Verhalten bleiben erhalten; 412 bleibt für die
  Offline-Queue ein vorübergehender Fehler (Eintrag bleibt liegen).

## Capabilities

### New Capabilities

- `sitzung-tabuebergreifend`: Bindung schreibender Anfragen an den im Tab angezeigten
  Benutzer, geschütztes Abmelden, tabübergreifende Meldung von An-/Abmeldung und
  Benutzerwechsel, Konfliktdialog, Verhalten bei Sitzungsablauf und offline.

### Modified Capabilities

(keine; die einzige bestehende Spec `lagekarte-fachebenen` ist nicht betroffen)

## Impact

- Backend: `src/auth/session.rs` (`CurrentUser` prüft den Kopf bei schreibenden Methoden),
  `src/routes/auth.rs` (`logout`), `src/error.rs` (eigene 412-Variante), neue
  Integrationstests `tests/sitzung_benutzerwechsel.rs`. Keine Migration, keine
  Response-DTO-Änderung (kein Codegen).
- Frontend: `api/client.ts` (Kopf an `apiSend`/`apiUpload`, 412 löst Prüfung aus),
  `auth/AuthContext.tsx` (Prüfen, Konflikt, lokales Abmelden, Meldungen), neues
  `auth/authKanal.ts`, `auth/useSitzungsWache.ts`, neuer `auth/BenutzerKonfliktDialog.tsx`
  im Sitzungs-Layout, Kommentar in `offline/fehler.ts`.
- e2e: neue Spec `e2e/sitzung-mehrere-tabs.spec.ts` (zwei Tabs, ein Browserkontext).
- CLAUDE.md: kurzer Absatz „Sitzung über mehrere Tabs (LFH-387)“.
