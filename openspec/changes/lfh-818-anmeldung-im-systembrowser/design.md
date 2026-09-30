# Design

## Context

Motivation: siehe `proposal.md`. Die Messung vom 30.09.2026 liegt in `belege/macos/messung.md`.

Bestand, der den Entwurf formt:

- **Hülle** (`src-tauri/`, Variante A):
  - Der Webview lädt die https-Adresse des Servers.
  - Die Serverseite darf zur Laufzeit genau einen Command rufen, `drucken`
    (`server_freigeben`, `main.rs`). Jeder Command steht im `AppManifest` von `build.rs`.
  - `faehigkeiten.js` setzt auf macOS `window.__LIFELINE_HUELLE__ = { passkey: false }`, im
    Hauptframe jeder Seite (LFH-817).
  - `deeplink.rs` kennt nur `lifeline://verbinden`.
  - `deeplinks_verarbeiten` protokolliert einen verworfenen Link heute **mit** Query.
  - Den einzigen Rust→Seite-Weg bildet `fenster.eval` mit JSON-Literal (`download_skript`).
  - macOS-Frameworks sind bisher nicht eingebunden.
- **Server:**
  - Jeder Anmeldeweg ruft selbst `session::anlegen` und `jar.add(session_cookie(…))` (`routes/auth.rs`).
  - Kurzlebige Zustände liegen als Prozess-Statics mit TTL und atomarem `remove`
    (`auth/oidc/state.rs`, `totp/state.rs`, `webauthn/state.rs`).
  - Audit `login_ok` schreiben heute nur Passwort (ohne TOTP) und Passkey (discoverable).
    OIDC, `totp_finish` und `webauthn_auth_finish` schreiben keinen Eintrag, das ist
    Befund 4 der Messung.
- **Frontend:**
  - Es ruft die Hülle nirgends selbst. `huelle/faehigkeiten.ts` ist die einzige Lesestelle der
    Kennung.
  - `test/huelle.ts` führt das ausgelieferte `faehigkeiten.js` im jsdom aus.

## Goals / Non-Goals

**Goals:**
- Jeder Anmeldeweg, den der Browser kann, trägt auch in die macOS-Hülle, ohne dass einer der
  fünf bestehenden Anmelde-Handler angefasst wird.
- Ein untergeschobener oder abgefangener Code ergibt keine Sitzung (Login-CSRF aus LFH-720).
- Code und `verifier` erscheinen in keiner URL des Servers, keinem Protokoll und keinem Verlauf.

**Non-Goals:**
- Passkey im WKWebView selbst (Associated Domains, MDM). Diese Option ist in LFH-783 verworfen.
- Die Windows-Hülle. WebView2 zeigt den Passkey-Dialog (LFH-720), sie meldet die Fähigkeit nicht.
- Die fehlenden Audit-Einträge von OIDC, TOTP und `webauthn_auth_finish` im Browser. Dafür gibt
  es ein eigenes Ticket, siehe Entscheidung 8.
- Die Passkey-Einrichtung in der Hülle. Sie bleibt ausgeblendet und geschieht im Browser.

## Decisions

### 1. Träger: `ASWebAuthenticationSession`, nicht `open` mit globalem Deeplink

Die Hülle öffnet die Bestätigungsseite in einer `ASWebAuthenticationSession` mit
`callbackURLScheme = "lifeline"`. Den Rücksprung liefert die Sitzung an ihren
Completion-Handler.

- **Warum:**
  - Befund 3 der Messung: Über `ASWebAuthenticationSession` läuft der Rücksprung **nicht**
    über Launch Services, er erreicht also keinen anderen Empfänger.
  - Die Hülle kann jeden `lifeline://anmeldung`, der von außen kommt, schon strukturell
    verwerfen. Sie braucht dafür keinen „wartet gerade“-Zustand, gegen den ein fremder Link
    antreten könnte.
  - Die Sitzung gibt an den Standardbrowser ab, wenn er das kann (Befund 2, Vivaldi). Die
    Passkeys des Nutzers sind dort, wo er sie gewohnt ist.
- **Alternative `open <url>`**, Rücksprung über `on_open_url`: gemessen, trägt (Läufe 2 und 3).
  Jede Webseite kann aber denselben Deeplink auslösen. Die Hülle müsste den Code gegen einen
  offenen Vorgang prüfen und vor Einlösen-Spam schützen. Verworfen, weil sie mehr Angriffsfläche
  hat als die gemessene Alternative.
- **Bindung per `verifier` bleibt trotzdem Pflicht.** Der Code läuft durch den Browser (Verlauf,
  Erweiterungen). Wer ihn dort liest, soll damit nichts anfangen können.

### 2. Der Code entsteht aus einer bestehenden Browsersitzung, mit Bestätigung

Es gibt keine Umleitung am Ende jedes Anmeldewegs. Stattdessen gibt es eine eigene Seite
`/app-anmeldung?challenge=<c>`:

1. Ohne Sitzung schickt die Seite zur Anmeldung mit `von=/app-anmeldung?challenge=<c>`.
   `ziel_pfad_aus_query` lässt Query zu, Passwort, TOTP, Passkey und OIDC führen alle über
   `zielPfad` zurück.
2. Mit Sitzung zeigt sie „In der Mac-App anmelden als <Anzeigename>“ mit zwei Knöpfen,
   „In der App anmelden“ (primär) und „Mit anderem Konto“ (abmelden, dann zur Anmeldung).
3. Der Klick ruft `POST /api/auth/app-code {challenge}` auf, gebunden an die Sitzung. Danach
   setzt die Seite `location.href = 'lifeline://anmeldung?code=…'`.

- **Warum:**
  - TOTP, OIDC, Passkey und Passwort sind ohne Eingriff in ihre Handler abgedeckt. Alle Wege
    münden weiter in `session::anlegen` (Zusage aus LFH-783).
  - Die Navigation per `location.href` nach einer Nutzergeste ist genau der gemessene
    Mechanismus. Auch in der Messung wartete die Seite zwischen Klick und Navigation einen
    `fetch` ab (`me-vor-ruecksprung`), und Chromium sprang trotzdem zurück (Lauf 1 und 3).
    Das stützt „POST, dann Navigation“.
  - Die Navigation auf `lifeline://` ist in eine injizierbare Funktion gekapselt, weil jsdom
    nicht auf ein fremdes Schema navigieren kann.
  - Eine Umleitung per 303 auf ein eigenes Schema ist mit Chromium-ASWebAuth **nicht**
    gemessen (Messung, „Nicht gemessen“).
  - Die Bestätigung mit Namen verhindert, dass eine im Browser offene Sitzung einer anderen
    Person unbemerkt in die App wandert (siehe Entscheidung 7).
- **Alternative: Umleitung in jedem Anmelde-Handler.** Fünf Stellen, TOTP als Zwischenstufe,
  ungemessener 303. Verworfen.
- Die `challenge` reist in der Seiten-URL, nicht im Cookie. Sie ist kein Geheimnis. Ein Angreifer,
  der eine Person mit eigener `challenge` auf die Seite lockt und sie zustimmen lässt, bekommt
  den Code nicht zu sehen. Der Code geht an `lifeline://` auf dem Gerät der Person, und deren
  Hülle hat keinen passenden `verifier`. Ein `POST /api/auth/app-code` von einer fremden Seite
  scheitert an `SameSite=Lax`, und die JSON-Antwort ist cross-origin nicht lesbar.

### 3. PKCE-Form nach RFC 7636 (S256)

- **`verifier`:** 32 zufällige Bytes aus dem OS-Zufall, base64url ohne Auffüllung, also 43 Zeichen.
- **`challenge`:** `base64url(SHA-256(verifier))`, ebenfalls 43 Zeichen.

Der Server prüft beim Ausstellen die Form der `challenge` (400) und beim Einlösen
`SHA-256(verifier) == challenge` mit einem Vergleich in konstanter Zeit. Der Testvektor aus
RFC 7636, Anhang B, pinnt die Ableitung in der Hülle **und** im Server.

### 4. Code-Speicher im Prozess, 60 s, einmal entnehmbar

`src/auth/huelle/state.rs` folgt dem Muster von `auth/oidc/state.rs`:

- ein statischer `Mutex<HashMap<code, (Eintrag, Ablauf)>>`,
- Bereinigung beim Schreiben, `remove` als atomares Entnehmen,
- kein `.await` unter dem Lock.

Der Code ist `session::neuer_token()` (32 Byte, 64 Hex-Zeichen). Der Eintrag enthält
`benutzer_id` und `challenge`. Nach 60 s ist der Code abgelaufen, und ein Serverneustart verwirft
alle offenen Codes. Das reicht für „Anmeldung bestätigt → App löst ein“, einen Vorgang, der sich
in Sekunden abspielt. **Alternative Tabelle in SQLite:** Sie würde Neustarts überdauern, das
braucht der Vorgang nicht. Verworfen, spart eine Migration.

### 5. Einlösen: `POST /api/auth/app-code/einloesen {code, verifier}`

Der Ablauf, in dieser Reihenfolge:

1. Form prüfen: Code 64 Hex-Zeichen, `verifier` 43–128 Zeichen `[A-Za-z0-9-._~]`. Sonst 400
   (`Validation`, Feld für sich).
2. Rate-Limit der Adresse: Ist sie gesperrt, gibt es 429, wie bei `login`.
3. Code entnehmen. Damit ist er verbraucht, gleich wie es ausgeht.
4. `verifier` prüfen, dann das Konto aktiv laden.
5. `session::anlegen`, Cookie wie bei den anderen Wegen, Audit `login_ok`, Antwort 204.
6. Stand in der Anfrage bereits ein `lifeline_sid`, wird diese alte Sitzung gelöscht. Sonst
   bliebe sie verwaist in der Tabelle.

**Scheitern:**
- Unbekannter, abgelaufener, verbrauchter oder falsch gebundener Code und ein deaktiviertes
  Konto geben einheitlich **401** mit demselben Text („Die Anmeldung aus dem Browser ist nicht
  mehr gültig. Bitte erneut anmelden.“).
- Dazu kommen `login_fehlgeschlagen` (Anbieter `systembrowser`) und `rate_limit::fehlversuch`.

**Warum 401 statt 422/409:** Das Ticket nennt „400/422/409 nach Konvention“.
- Die Konvention (`error.rs`) ordnet einer gescheiterten Anmeldung 401 zu, so wie `totp_finish`
  mit ungültigem Code.
- 409 ist Nebenläufigkeit oder Lebenszyklus, 422 ist ein Zusammenhang von Feldern. Beide würden
  einen Grund verraten („verbraucht“, „falscher verifier“) und damit ein Orakel bilden.
- 400 bleibt der reinen Form vorbehalten.
- **Bestätigt am 30.09.2026:** Das weicht bewusst vom Wortlaut des Akzeptanzkriteriums ab.

**Ausstellen:** `POST /api/auth/app-code {challenge}` braucht `CurrentUser` und gibt 401 ohne
Sitzung, 400 bei falscher Form. Die Antwort ist `{code}` als Response-DTO (`ToSchema`, Codegen).

### 6. Einlösen im Webview per `eval` aus der Hülle, Ergebnis als Ereignis an die Seite

Nach dem Rücksprung baut die Hülle ein Skript nach dem Muster von `download_skript`. Code,
`verifier` und die erwartete Origin gehen als JSON-Literale hinein. Das Skript:

1. prüft `location.origin === <Server-Origin>`. Die Hülle prüft vorher dasselbe über
   `fenster.url()`, doppelt, weil die Seite zwischen Prüfung und `eval` wechseln kann.
   `fenster` ist das Fenster, aus dem der Command kam. Tauri injiziert es als `WebviewWindow`,
   die Hülle merkt sich sein Label im ausstehenden Vorgang. Nur dort hängt der Hörer der
   Anmeldeseite. Die Freigabe gilt wie `drucken` für `main` und `neben-*`.
2. ruft `fetch('/api/auth/app-code/einloesen', {method: 'POST', …})` auf.
3. meldet das Ergebnis als `CustomEvent('lifeline:app-anmeldung', {detail: {ergebnis}})`
   (`angemeldet`, `abgelehnt`, `fehler`). Das Ereignis trägt weder Code noch `verifier`.

Beim Abbruch der Sitzung meldet die Hülle `abgebrochen`, ohne `fetch`. Die Anmeldeseite hört
auf das Ereignis:

- `angemeldet`: `aktualisiere()` und `navigate(zielPfad)`, wie nach dem Passkey.
- `abgelehnt` oder `fehler`: ein Hinweis an der Seite (`SpeicherHinweis`-Muster).
- `abgebrochen`: nur ein Signal. Den Knopf sperrt die Seite ohnehin nur, solange der
  `invoke` läuft, also bis die Sitzung gestartet ist. Ob Chromium beim Schließen den Abbruch
  meldet, ist nicht gemessen. Ein erneuter Klick startet einen neuen Vorgang, der den alten
  ersetzt.

- **Warum:** Nur der Webview hat den Cookie-Speicher, in dem die Sitzung entstehen muss. Die
  Hülle setzt keine Cookies selbst (WKHTTPCookieStore wäre Anwendungslogik in der Hülle). Die
  Seite entscheidet, wohin es danach geht, genau wie nach jeder anderen Anmeldung.
- **Alternative: Navigation auf `/…?code=…&verifier=…`.** Der `verifier` stünde in URL,
  Verlauf und Serverprotokoll. Verworfen.

### 7. Geteilte Browsersitzung (Vorgabe) statt ephemer

`prefersEphemeralWebBrowserSession = NO`. Ist die Person im Standardbrowser schon angemeldet,
reicht ein Klick auf „In der App anmelden“. TOTP und IdP-Passkey muss sie dann nicht erneut
bestätigen. Gegen die Sitzung einer anderen Person auf einem geteilten ELW-Rechner steht die
Bestätigungsseite: Sie nennt den Namen und bietet „Mit anderem Konto“.

- **Alternative ephemer:** Das hieße bei jeder App-Anmeldung eine frische Anmeldung im Browser,
  und im Browser bliebe danach keine Sitzung zurück. Ob Chromium (Vivaldi) das Flag beachtet,
  ist **noch nicht gemessen** (Lauf `aswas-ephemer` steht aus).
- Die Wahl ist ein Schalter an einer Stelle der Hülle und ändert weder Spec noch Server.
- **Bestätigt am 30.09.2026.**

### 8. Audit mit Anbieter `systembrowser`, Lücken der Browser-Wege separat

Die Einlösung schreibt `login_ok` bzw. `login_fehlgeschlagen` mit dem Anbieter `systembrowser`.
Eine Migration braucht es nicht, `provider` ist freier Text.

Welcher Weg im Browser zur Sitzung führte, weiß der Server beim Einlösen nicht, weil die
Sitzungstabelle keine Herkunft kennt. Die Anmeldung im Browser selbst wird dort auditiert, wo ihr
Weg es heute tut. Dass OIDC, `totp_finish` und `webauthn_auth_finish` das nicht tun (Befund 4),
kommt als eigenes Ticket. Es ist kein Teil dieses Changes.

### 9. Die Brücke Seite → Hülle bleibt im Init-Skript

`faehigkeiten.js` erweitert die Kennung auf
`{ passkey: false, anmeldungImBrowser: () => invoke('anmeldung_im_browser') }`. Das nutzt
`__TAURI_INTERNALS__.invoke` nach dem Muster von `druck.js` und bleibt ein eingefrorenes Objekt.

- `huelle/faehigkeiten.ts` bleibt die einzige Lesestelle, neu mit
  `huelleAnmeldungImBrowser(): (() => Promise<void>) | null`.
- Das Skript läuft auch auf fremden Seiten, etwa beim IdP. Der Aufruf scheitert dort an der
  Laufzeit-Capability, die `anmeldung_im_browser` nur der Server-Origin freigibt
  (`server_freigeben`, `build.rs`).
- Der Command nimmt keine Adresse vom Aufrufer an. Er öffnet immer
  `<gespeicherter Server>/app-anmeldung?challenge=…`.

### 10. Globaler Deeplink `anmeldung`: verwerfen, ohne Query protokollieren

`deeplink::deute` bleibt auf `verbinden` beschränkt. Ein `lifeline://anmeldung`, der über den
globalen Weg kommt, ergibt dort nichts. Den Rücksprung der Sitzung liest eine eigene reine
Funktion (`anmeldung::anmeldecode_aus`), die nur `lifeline://anmeldung?code=<64 hex>` akzeptiert.

`deeplinks_verarbeiten` protokolliert verworfene Links über `fuers_protokoll`, also nur mit Schema,
Host und Pfad. Das schließt nebenbei das heutige Leck der Query im Protokoll.

### 11. Anmeldeseite und Profil in der Hülle

- **Anmeldeseite:** Meldet die Hülle `anmeldungImBrowser`, steht „Im Browser anmelden“ als
  umrandeter Knopf unter Formular und SSO. Das gilt auch dann, wenn nur Passkeys aktiv sind, dann
  als einziger Weg. Er ersetzt dort den Hinweis aus LFH-817. Der Passkey-Knopf bleibt aus
  (`huelleSperrtPasskey`).
- **Profil:** Der Hinweis lautet künftig sinngemäß: „Passkeys richtest du im Browser ein. In der
  Mac-App meldest du dich damit über ‚Im Browser anmelden‘ an.“ Die Einrichtung selbst bleibt
  ausgeblendet.
- **Lesart des Tickets:** „Ausblende-Schalter aus Stufe 1 zurücknehmen“ heißt, der Hinweis
  weicht dem Weg. Der Passkey-Knopf im WKWebView kommt nicht zurück, weil er dort weiter
  scheitert.
- **Bestätigt am 30.09.2026.**

## Risks / Trade-offs

- **Firefox oder Safari als Standardbrowser sind für `ASWebAuthenticationSession` nicht
  gemessen.** → Einmal von Hand prüfen (Aufgabe in `tasks.md`). Die Apple-Doku sagt, dass
  ohne unterstützenden Standardbrowser die Sitzung in Safari läuft. Liefert `start()` NO,
  zeigt die Seite einen Hinweis. Einen Rückfall auf `open` gibt es bewusst nicht
  (Entscheidung 1).
- **Die signierte Hülle ist nicht gemessen** (LFH-722). → Bei der Signierung erneut prüfen.
  `ASWebAuthenticationSession` braucht kein Entitlement.
- **macOS fragt beim ersten Start „… möchte ‚elw.local‘ zum Anmelden verwenden“.** Das ist
  erwartet und in der Doku zu erwähnen.
- **Der Code-Speicher hat keine Größengrenze** (wie `oidc::state`). → Ausstellen braucht
  eine Sitzung, und die TTL beträgt 60 s. Das Risiko ist klein. Eine Grenze wäre ein
  Folgeticket für alle drei Speicher.
- **`eval` in eine Seite, die zwischen Prüfung und Ausführung wechselt.** → Doppelte
  Origin-Prüfung, außen in Rust und innen im Skript. Scheitert die innere Prüfung, gibt es
  keinen `fetch`, und der Code verfällt nach 60 s.
- **Die Anmeldeseite ist beim Rücksprung nicht mehr eingehängt.** Die Sitzung entsteht dann
  trotzdem, nur die Navigation fehlt. → Die bestehende Sitzungswache (`/me` bei Sichtbarkeit,
  LFH-387) holt den Benutzer nach.

## Migration Plan

- Der Server kann vor der Hülle ausgeliefert werden: Neue Endpunkte ohne Aufrufer schaden nicht.
- Die Hülle kommt mit dem nächsten stabilen Desktop-Release.
- Rücknahme: `anmeldungImBrowser` aus `faehigkeiten.js` entfernen. Dann gilt wieder der Stand
  von LFH-817.

## Open Questions

- Beachtet Chromium `prefersEphemeralWebBrowserSession`? Die Antwort ändert nur die Vorgabe
  aus Entscheidung 7, nicht Spec oder Aufgaben. Gemessen wird mit `aswas-ephemer`.
