# Messung LFH-818: Passkey im Systembrowser (30.09.2026)

Frage aus LFH-783, Stufe 2: Erscheint die Passkey-Abfrage für `elw.local` und für den IdP
(PocketID), wenn die Anmeldung außerhalb des WKWebView der Hülle läuft? Und erreicht der
Rücksprung per eigenem Schema die Hülle?

## Aufbau

- Server: lifeline-hub `origin/alpha` (3d5d3572), Debug-Binary, `--tls` mit mkcert
  (CA im System-Schlüsselbund), `0.0.0.0:8443`, `elw.local` per mDNS (`dns-sd -P`),
  `LIFELINE_WEBAUTHN_RP_ID=elw.local`, OIDC gegen PocketID (`https://id.rubeen.dev`,
  Callback `https://elw.local:8443/api/auth/oidc/callback`).
- Messseite `messseite-spike-818.html`, ausgeliefert unter `https://elw.local:8443/spike-818.html`:
  1. `navigator.credentials.create` (RP = Host, Nutzer „spike818“),
  2. `navigator.credentials.get` (RP = Host),
  3. OIDC-Anmeldung (`/api/auth/oidc/start?von=/spike-818.html`),
  4. `/api/auth/me`,
  5. Rücksprung per `location.href = 'lifeline-spike://anmeldung?code=…&erg=…&ua=…'`.
  Die Ergebnisse (Art, ok, Dauer in ms, Benutzer) reisen im Rücksprung mit.
- Hülle: Spike-Repo `lfh-720-tauri-spike` (Commit 4ba006b), unsigniert, Debug-Bundle, Schema
  `lifeline-spike` global registriert. Zwei Messwege:
  - `aswas`: `ASWebAuthenticationSession` mit `callbackURLScheme = "lifeline-spike"`,
    `prefersEphemeralWebBrowserSession = NO`, Anker das Hauptfenster.
  - `browser`/`safari`: `open <url>` bzw. `open -a Safari <url>`, Rücksprung über Launch Services.
- Versionen: `umgebung.txt` (macOS 27.0, Safari 27.0, Vivaldi 8.2 als Standardbrowser).

## Ergebnis

| Lauf | Träger (User-Agent) | create `elw.local` | get `elw.local` | OIDC PocketID | Rücksprung |
|---|---|---|---|---|---|
| 1 `aswas` | Vivaldi, Chrome 152 | beobachtet* | beobachtet* | Sitzung `rubeen`, `me` 200 (aufgezeichnet) | im Completion-Handler, 91,8 s nach Start (aufgezeichnet) |
| 2 `safari` | Safari 27.0 | `ok`, 9 894 ms (aufgezeichnet) | `ok`, 15 540 ms (aufgezeichnet) | Sitzung `rubeen`, `me` 200 (aufgezeichnet) | Deeplink an die laufende Instanz (aufgezeichnet) |
| 3 `browser` | Vivaldi, Chrome 152 | `ok`, 4 312 ms (aufgezeichnet) | `ok`, 9 775 ms (aufgezeichnet) | Sitzung `rubeen`, `me` 200 (aufgezeichnet)** | Deeplink an die laufende Instanz (aufgezeichnet) |

\* Lauf 1 trägt im Rücksprung nur den letzten Schritt (`me`). Dass die Passkey-Abfragen dort
erschienen, beruht auf der Aussage des Nutzers vom 30.09.2026: „alle Anfragen kamen wie
erwartet“. Warum die Schritte davor fehlen (vermutlich hat Chromiums Auth-Fenster den
`sessionStorage` über die OIDC-Umleitung nicht gehalten), ist nicht untersucht.

\*\* In Lauf 3 kann die PocketID-Sitzung aus Lauf 1 noch bestanden haben (derselbe Browser,
nicht ephemer). Der saubere Beleg für den IdP-Passkey ist Lauf 2 (Safari).

Zum Vergleich: im WKWebView der Hülle endet `get` für `elw.local` nach 4 ms mit
`NotAllowedError` (LFH-720, `passkey-mit-geste-elw-local.json`). Die Dauern von 4 bis 15 s
sind die Zeit bis zur Bestätigung per Touch ID.

## Befunde

1. **Der Systembrowser trägt beide RPs**, Safari wie Vivaldi. Stufe 2 aus LFH-783 steht, die
   Entscheidung muss nicht neu aufgemacht werden.
2. **`ASWebAuthenticationSession` gibt an den Standardbrowser ab**, wenn er das unterstützt
   (hier Vivaldi). Die Sitzung ist also nicht an Safari gebunden.
3. **Der Rücksprung über `ASWebAuthenticationSession` läuft nicht über Launch Services.**
   Zwischen `aswas-1-start.json` (…864756) und `aswas-2-ruecksprung-vivaldi.json` (…956573)
   gibt es kein `deeplink.json`, obwohl `lifeline-spike` global registriert ist. Die
   Rücksprung-URL landete nur im Completion-Handler der Sitzung. Beim Weg über `open` kommt
   derselbe Rücksprung als globaler Deeplink an (Läufe 2 und 3), den jede Seite auslösen kann.
4. **OIDC schreibt keinen Audit-Eintrag.** Nach Lauf 1 ist `auth_audit` leer, obwohl der
   Benutzer `rubeen` per JIT angelegt und angemeldet wurde.

## Nicht gemessen

- `ASWebAuthenticationSession` mit Safari oder Firefox als Standardbrowser.
- `prefersEphemeralWebBrowserSession = YES`, insbesondere ob Chromium das Flag beachtet.
- Eine signierte Hülle.
- Der Rücksprung per **Server-Umleitung** (303 auf `lifeline-spike://…`). Gemessen ist nur die
  Navigation per `location.href` aus der Seite.
