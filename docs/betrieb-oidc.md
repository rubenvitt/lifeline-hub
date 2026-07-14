# Betrieb: OIDC/SSO (PocketID)

`lifeline-hub` unterstützt OIDC als **zusätzlichen** Login-Weg neben dem lokalen
Passwort-Login (LFH-41). Referenz-IdP ist PocketID; jeder OIDC-1.0-konforme
Provider mit Discovery-Endpoint funktioniert aber grundsätzlich gleich.

**Offline-first:** Der lokale Passwort-Login ist von OIDC vollständig unabhängig.
Ist PocketID nicht erreichbar (Einsatz-LAN ohne Internet, IdP down), bleibt der
Passwort-Login unverändert nutzbar — OIDC ist ein optionales Zusatzfeature, kein
Ersatz. Discovery gegen den Issuer läuft **lazy** (erst beim ersten tatsächlichen
OIDC-Login-Versuch, dann prozessweit gecacht), nicht beim Serverstart — ein
nicht erreichbarer IdP blockiert den Start also nicht.

## PocketID-Client anlegen

In PocketID einen neuen OIDC-Client anlegen mit:

- **Redirect-URL:** `https://<host>/api/auth/oidc/callback` (exakt dieser Pfad,
  Schema/Host je nach Deployment — siehe `docs/betrieb-tls.md` für TLS/`--bind`).
- Client-ID und Client-Secret aus PocketID notieren — beide werden unten in die
  Server-Konfiguration übernommen.

## Env-Konfiguration

| Variable | Bedeutung |
|---|---|
| `LIFELINE_OIDC_ISSUER` | Basis-URL des PocketID-Servers (Issuer, dient der Discovery). |
| `LIFELINE_OIDC_CLIENT_ID` | Client-ID aus dem PocketID-Client. |
| `LIFELINE_OIDC_CLIENT_SECRET` | Client-Secret aus dem PocketID-Client. |
| `LIFELINE_OIDC_REDIRECT_URL` | Muss exakt der beim PocketID-Client hinterlegten Redirect-URL entsprechen (`https://<host>/api/auth/oidc/callback`). |

Das Client-Secret ist ein reines Betriebsgeheimnis: es lebt **ausschließlich in
der Prozess-Config** (Env/CLI-Flag), wird im `Debug`-Output maskiert (wie
`--admin-password`/`--karten-service-token`) und landet **nie** in der
Datenbank.

Alle vier Variablen sind für einen funktionierenden Login-Flow nötig. Der
"Mit PocketID anmelden"-Button erscheint auf der Login-Seite bereits, sobald
Issuer, Client-ID und Client-Secret gesetzt sind (die Provider-Registry prüft
diese drei beim Serverstart); fehlt zusätzlich die Redirect-URL, scheitert der
tatsächliche Login-Versuch beim Klick. In der Praxis daher immer alle vier
gemeinsam setzen.

## Verhalten: JIT-Provisionierung, least privilege

Der **erste** erfolgreiche SSO-Login über PocketID legt automatisch ein
**neues, rechtearmes** Konto an (Just-in-Time-Provisionierung):

- Matching ausschließlich über `(issuer, subject)` aus dem `id_token` — es gibt
  **kein** automatisches Verlinken an ein bestehendes lokales Konto, auch nicht
  bei identischem Benutzer-/Anzeigenamen. Kollidiert der abgeleitete
  Benutzername mit einem bereits vergebenen, wird er gesuffixt (`max-2`, `max-3`, …).
- Es gibt (in diesem Increment) **kein** Claims→Rollen-Mapping. Das neue Konto
  bekommt keine System- und keine Org-Rolle (`system_rolle = keiner`,
  `org_rolle = keine`) — es kann sich zwar einloggen, sieht aber fachlich
  nichts. **Ein Admin muss das Konto anschließend manuell hochstufen**
  (Rolle setzen), bevor es nutzbar ist.
- SSO-Konten haben **kein lokales Passwort**: der Passworthash ist ein
  Sentinel-Wert, der bei jeder Passwort-Prüfung fehlschlägt — Login geht für
  diese Konten ausschließlich über PocketID.
- Wiederholte Logins mit demselben `(issuer, subject)` finden dasselbe Konto
  wieder (kein Doppel-Insert).

Admin-seitiges Verlinken eines SSO-Logins an ein bestehendes lokales Konto und
Claims→Rollen-Mapping sind bewusst nicht Teil dieses Increments (spätere
Iteration, LFH-41/LFH-275).

## Ein-/Ausschalten

OIDC ist ein Provider wie `passwort`/`dev` in der Auth-Provider-Registry und
lässt sich über denselben Admin-Toggle (Provider-Verwaltung) an-/abschalten.
Die Durchsetzung passiert **serverseitig**: `GET /api/auth/oidc/start` und
`GET /api/auth/oidc/callback` prüfen bei jedem Aufruf, ob `oidc` aktiv gelistet
ist, und lehnen andernfalls ab — ein deaktivierter Provider ist nicht nur im
Frontend ausgeblendet, sondern am Endpunkt selbst gesperrt.

`oidc` ist **nicht admin-tauglich**: der Aussperr-Guard, der das Deaktivieren
des letzten Login-Wegs für aktive Admins verhindert, lässt `passwort` deshalb
unabhängig vom OIDC-Zustand niemals aussperren — SSO-Konten sind in diesem
Increment grundsätzlich least-privilege und können keine Admin-Session
bereitstellen.

## Manueller Smoke-Test

Der End-to-End-Flow braucht einen laufenden Server, ein erreichbares PocketID
und einen Browser und ist daher kein Teil der automatisierten Test-Suite. Der
dokumentierte Ablauf (Client-Erstellung, Login, JIT-Provisionierung,
Zweitlogin) liegt in `tests/oidc_smoke.rs` (`#[ignore]`).
