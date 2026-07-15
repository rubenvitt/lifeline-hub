# Admin-UI „Provider-Verwaltung" — Design (LFH-280)

**Goal:** Eine Frontend-Admin-Oberfläche, um die verfügbaren Auth-Provider an-/abzuschalten,
und dabei die überladene `GlobalEinstellungenPage` in eine übersichtliche Tab-Struktur bringen.

**Kontext:** Follow-up zum v1-komplett gemergten Auth-Provider-System (Epic LFH-57). Das
Backend für die Provider-Verwaltung existiert vollständig — es fehlt nur die UI, die den
Toggle-Endpoint aufruft. Reiner **Frontend**-Task, **kein** Backend-Change.

## Backend-Contract (Bestand, unverändert)

- `GET /api/auth/providers` → `AuthProvider[]` (`{ id, typ, anzeigename, aktiviert }`).
  Öffentlich (treibt auch die LoginPage). Liefert **nur beim Serverstart konfigurierte**
  Provider: `passwort` immer; `dev` nur im Dev-/Seed-Build; `oidc`/`webauthn` nur bei
  gesetzter Start-Config.
- `PUT /api/auth/providers/{id}` mit Body `{ aktiviert: boolean }` → aktualisierte
  `AuthProvider[]`. **AdminUser**-gegated (sonst 403). **404** bei unbekanntem/nicht
  konfiguriertem Provider. **409 Conflict** mit lesbarer deutscher Meldung, wenn der
  Lockout-Guard das Deaktivieren des letzten admin-tauglichen Login-Wegs verhindert
  (in v1 ist `passwort` der einzige admin-taugliche Provider).
- Typ `AuthProvider` = `AuthProviderAnzeige` ist bereits codegeneriert
  (`frontend/src/api/types.ts` → `types.generated.ts`). `apiSend` unterstützt `PUT`;
  `ApiError` trägt `.message`.

## Architektur & Komponenten

Die Änderung ist auf **eine Seite plus eine API-Funktion** begrenzt:

### 1. `frontend/src/api/auth.ts` — neue Funktion

```ts
/** Schaltet einen Auth-Provider an/aus (Admin, LFH-280). Gibt die aktualisierte Liste
 *  zurück (Server-Wahrheit). 409 (Lockout) / 404 kommen als ApiError. */
export function providerSchalten(id: string, aktiviert: boolean): Promise<AuthProvider[]> {
  return apiSend<AuthProvider[]>(`/api/auth/providers/${id}`, 'PUT', { aktiviert });
}
```

### 2. `frontend/src/pages/GlobalEinstellungenPage.tsx` — Tab-Struktur + Anmeldeverfahren

**Aufräumen:** Der bisher lange vertikale Fluss wird in antd `Tabs` (`tabPosition="left"`)
gruppiert:

- **Anzeige** → Anzeige-Konventionen (Zeitzone, Zeitformat, Einheiten, Koordinaten, Geocoder-URL).
- **Einsatz-Defaults** → Aufbewahrung + Verhalten & Automatik (Präfixe, Fristen, auto-ETB) +
  Modul-Rollen-Default.
- **Anmeldeverfahren** (NEU) → Provider-Toggle-Liste.

Die bestehende Org-Settings-`Form` (ein „Speichern"-Button) spannt weiter die Felder aus
**Anzeige** + **Einsatz-Defaults**. Die Tab-Panes mit Form-Feldern werden mit `forceRender`
gerendert, damit (a) ein Speichern über Tab-Grenzen hinweg alle Felder erfasst und (b) die
bestehenden Text-Assertions der Tests weiter greifen (Felder bleiben im DOM, auch wenn der
Tab inaktiv ist). Modul-Rollen-Default und Anmeldeverfahren speichern wie gehabt **sofort**
bei Änderung (kein Teil der Form).

**Anmeldeverfahren-Tab (das Feature):**

- `useQuery(['auth-provider'], providerListe)` lädt die konfigurierten Provider.
- Je Provider eine Zeile: `anzeigename` + `Switch` (`checked={p.aktiviert}`).
- `passwort`: `Switch` **disabled** mit Tooltip „Garantierter Admin-Login-Weg — nicht
  deaktivierbar." (v1: einziger admin-tauglicher Provider; der Server würde ein Deaktivieren
  ohnehin per 409 ablehnen — die Sperre ist ehrlicher als ein umschaltbarer Switch, der dann
  zurückspringt).
- Übrige Provider (`oidc`/`webauthn`/`dev`): frei umschaltbar.
- Kurzer Hinweistext: „Nur beim Serverstart konfigurierte Verfahren erscheinen hier.
  Änderungen werden sofort gespeichert."
- Alle Switches zusätzlich `disabled`, wenn `!istAdmin` (read-only für Führungskräfte,
  konsistent mit dem Rest der Seite) oder die Mutation gerade läuft.

### Datenfluss (Toggle)

`Switch onChange` → `schaltenMutation.mutate({ id, aktiviert })` →
`providerSchalten(id, aktiviert)` (PUT). Bei Erfolg: die vom PUT zurückgegebene
Server-Liste per `qc.setQueryData(['auth-provider'], liste)` in den Cache schreiben → der
Anmeldeverfahren-Tab spiegelt sofort die Wahrheit.

**Kein Cross-Component-Invalidieren nötig:** Die `LoginPage` nutzt **kein** react-query für
die Provider-Liste, sondern lädt sie bei jedem Mount frisch per `useEffect` +
`providerListe()` in lokalen State (mit Passwort-Fallback bei Fehler). Sie ist damit beim
nächsten Laden — dem relevanten Moment: eine anmeldende Person öffnet die Login-Seite neu —
automatisch aktuell; es gibt keinen geteilten Cache, den die Settings-Seite invalidieren
müsste.

### Fehlerbehandlung

- **409 Conflict** (Lockout): `message.error(e instanceof ApiError ? e.message : 'Umschalten
  fehlgeschlagen')`. Der Cache bleibt unangetastet → der Switch spiegelt weiter die
  Server-Wahrheit.
- **403** (Nicht-Admin): durch das UI-Gating (`disabled`) praktisch unerreichbar; fällt
  andernfalls in denselben `onError`-Pfad.

## Testing (vitest, `GlobalEinstellungenPage.test.tsx`)

Bestehende Tests an die Tab-Struktur anpassen (dank `forceRender` bleiben die meisten
Text-Assertions gültig). Neue Fälle für das Anmeldeverfahren:

1. Der Anmeldeverfahren-Tab listet die von `GET /api/auth/providers` gelieferten Provider.
2. Umschalten eines Nicht-`passwort`-Providers ruft `PUT /api/auth/providers/{id}` mit
   `{ aktiviert }` und aktualisiert die Anzeige (msw liefert die neue Liste).
3. Der `passwort`-Switch ist deaktiviert (kann nicht umgeschaltet werden).
4. Ein **409** vom Server zeigt eine Fehlermeldung und lässt den Zustand unverändert.
5. Als Nicht-Admin sind die Switches read-only (disabled).

Gates: vitest grün, `pnpm lint` (`--max-warnings 0`), `pnpm typecheck`.

## Nicht in Scope (YAGNI)

- **Nicht-konfigurierte** Provider grau ausgegraut mit „Start-Flag setzen"-Hinweis anzeigen:
  `GET` liefert sie nicht; ein statischer Hinweistext genügt in v1.
- Kein Backend-Change; kein neuer Endpoint; keine Änderung am Lockout-Guard.
- Keine neue Route/Nav (bewusst in die bestehende `/admin/einstellungen` integriert).
