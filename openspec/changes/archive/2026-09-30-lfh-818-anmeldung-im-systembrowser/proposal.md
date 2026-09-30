# Proposal

## Why

Im WKWebView der macOS-Hülle scheitert jeder Passkey, der für Lifeline (`elw.local`) ebenso wie
der beim IdP (LFH-720, LFH-783). Seit LFH-817 bietet die Mac-App den Passkey deshalb nicht mehr
an. Konten, die per OIDC ohne Passwort angelegt wurden und deren IdP nur Passkeys kennt
(PocketID), kommen in der Mac-App gar nicht hinein. Die Messung vom 30.09.2026
(`belege/macos/messung.md`) zeigt: Im Systembrowser tragen beide Passkeys, auch über
`ASWebAuthenticationSession`, und der Rücksprung erreicht die Hülle. Das ist Stufe 2 der
Entscheidung LFH-783.

## What Changes

- **Hülle (macOS):** Die Hülle bekommt die Handlung „Im Browser anmelden“. Sie erzeugt ein
  Geheimnis (`verifier`), öffnet die Anmeldeseite des Servers in einer
  `ASWebAuthenticationSession` und übergibt nur dessen Ableitung (`challenge`). Den Rücksprung
  `lifeline://anmeldung?code=…` nimmt nur diese Sitzung an. Die Hülle löst den Code mit dem
  `verifier` im Webview ein, und so entsteht dort die Sitzung.
- **Hülle:** Ein `lifeline://anmeldung`, der von außen als globaler Deeplink kommt, bleibt
  ohne Wirkung und landet ohne Query im Protokoll.
- **Server:** Zwei neue Endpunkte. Der erste stellt aus einer bestehenden Browsersitzung einen
  kurzlebigen Einmalcode aus, gebunden an die `challenge`. Der zweite löst ihn gegen den
  `verifier` ein, legt die Sitzung an und schreibt einen Audit-Eintrag.
- **Webanwendung:** Eine neue Seite im Browser bestätigt „In der Mac-App anmelden als …“ und
  springt mit dem Code zurück in die App. Wer nicht angemeldet ist, meldet sich vorher über
  jeden vorhandenen Weg an: Passwort, TOTP, OIDC oder Passkey.
- **Anmeldeseite in der macOS-Hülle:** Sie zeigt „Im Browser anmelden“ auch dort, wo bisher der
  Hinweis „nur Passkey, bitte im Browser“ stand (LFH-817). Der Passkey-Knopf selbst bleibt in
  der Hülle aus, weil er im WKWebView weiterhin scheitert.
- **Profil in der Hülle:** Der Hinweis nennt jetzt „Im Browser anmelden“ als Weg, mit einem im
  Browser eingerichteten Passkey in die Mac-App zu kommen.
- **Doku:** Die bekannte Grenze für SSO-Konten mit Passkey-only-IdP in
  `docs/betrieb/desktop-app.md` entfällt.

## Capabilities

### New Capabilities
- `anmeldung-systembrowser`: Die Übergabe einer Anmeldung aus dem Browser in einen anderen
  Cookie-Speicher (die Mac-Hülle) per Einmalcode mit PKCE-Bindung. Dazu gehören Ausstellen,
  Bestätigungsseite, Einlösen, Fristen, Einmaligkeit, Fehlerantworten und Audit.

### Modified Capabilities
- `desktop-huelle`: Neue Anforderung, dass sich die macOS-Hülle im Systembrowser anmeldet.
  Außerdem wird die Anforderung „Der Deeplink hat ein festes Schema“ erweitert: Ein
  `lifeline://anmeldung` von außen bleibt wirkungslos, und der Code landet nicht im Protokoll.

## Impact

- **Server:**
  - `src/routes/auth.rs` bekommt zwei Handler.
  - Neues Modul `src/auth/huelle/` mit einem Code-Speicher nach dem Muster von
    `auth/oidc/state.rs`.
  - Die Routen stehen in `src/app.rs`.
  - Neue Integrationstests.
  - Keine Migration: Der Audit-`provider` ist freier Text.
- **Hülle:**
  - `src-tauri/src/main.rs` bekommt einen neuen Command, der in `build.rs` und in
    `server_freigeben` freigegeben wird.
  - `faehigkeiten.js` meldet die neue Fähigkeit.
  - `deeplink.rs` bekommt den Fall `anmeldung`.
  - Neue macOS-Abhängigkeiten: `objc2`, `objc2-foundation`, `objc2-authentication-services`,
    `block2`. Dazu `sha2` und `base64` für die `challenge`, beides ohne neues Risiko in
    `check-deps.sh`.
- **Frontend:**
  - `huelle/faehigkeiten.ts` bleibt die einzige Lesestelle.
  - Geändert werden `LoginPage.tsx` und `ProfilPage.tsx`.
  - Neue Seite und Route für die Bestätigung im Browser.
  - `api/auth.ts` bekommt zwei Aufrufe. Request-DTOs sind handgepflegt, die Response läuft über
    den Typ-Codegen.
- **Abhängigkeit:** LFH-817 (gemergt, PR 240). Die Deltas aus LFH-783 bleiben gültig: Der
  Passkey-Knopf fehlt in der Hülle weiterhin.
- **Nicht betroffen:** Windows-Hülle und Browser. Beide melden die Fähigkeit nicht und
  verhalten sich wie heute.
