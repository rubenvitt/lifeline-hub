# Design: Passkey in der macOS-Hülle (LFH-783)

## Kontext

LFH-128 Phase 1, Variante A: Der Tauri-Webview lädt die https-Adresse des Servers. Der Spike
LFH-720 (`openspec/changes/lfh-720-tauri-huelle-variante-a/design.md`, Abschnitt „Passkey
(macOS)“) hat gemessen:

- `navigator.credentials.get` für RP `elw.local` scheitert im WKWebView nach 4 ms mit
  `NotAllowedError`, ohne Systemabfrage, trotz Fokus und Nutzergeste
  (`belege/macos/passkey-mit-geste-elw-local.json`).
- Der Passkey beim IdP (PocketID, `id.rubeen.dev`) erscheint ebenfalls nicht
  (`belege/macos/oidc-pocketid-ohne-geste.json`: „Die Authentifizierungs-Aufforderung wurde
  abgebrochen“).
- WebView2 unter Windows zeigt den Dialog (`belege/windows/passkey-mit-geste.json`).
- Ursache nach Apple-Doku: Ein eingebetteter WKWebView stellt Passkeys nur für RPs aus, die per
  Associated Domains (`webcredentials:`) verknüpft sind. Die Ausnahme ist das
  Browser-Entitlement, das nur echte Browser bekommen. Die AASA-Datei holt Apple über das eigene
  CDN aus dem öffentlichen Internet, für `.local` unmöglich. Ausweichmodi: `?mode=developer`
  und `?mode=managed`.

## Zwei Fakten, die die Optionen trennen

1. **OIDC legt Konten ohne Passwort an.** JIT-Provisionierung setzt
   `PASSWORT_HASH_SSO_ONLY` (`src/auth/oidc/provisioning.rs`). Solche Nutzer haben nur den
   IdP. Kennt der IdP nur Passkeys (PocketID ist so gebaut), kommen sie in der Mac-Hülle nicht
   hinein. Wie der OIDC-Login im Spike trotzdem gelang (`belege/macos/oidc-angemeldet.json`),
   ist nicht belegt. Vermutlich lief er über einen Ausweichweg von PocketID. „OIDC trägt“ gilt
   auf dem Mac also nur für IdPs mit einem Weg ohne Passkey.
2. **Die Feature-Erkennung lügt.** `PublicKeyCredential.getClientCapabilities()` meldet im
   WKWebView der Hülle `passkeyPlatformAuthenticator: true` und
   `userVerifyingPlatformAuthenticator: true` (`belege/macos/probe-remote-localhost.json`).
   Das Frontend kann die Sperre nicht selbst erkennen, ohne einen Versuch scheitern zu
   lassen. Die Hülle muss es sagen.

## Optionen

| | 1 Associated Domains (MDM) | 2 Systembrowser + Einmalcode | 3 kein Passkey auf dem Mac |
|---|---|---|---|
| Lifeline-Passkey (`elw.local`) | nur auf MDM-Macs, nur Doku-Stand | ja (Safari darf jede RP), nicht gemessen | nein |
| IdP-Passkey | nein, fremde IdP-Domain bekommt kein AASA mit unserer Team-ID | ja | nein |
| SSO-Konten mit IdP nur per Passkey | ausgesperrt | erreichbar | ausgesperrt |
| Voraussetzungen | LFH-722 (Signierung, Team-ID, Provisioning Profile), MDM, AASA auf dem Server | Server-Endpunkt, Deeplink (gemessen, Beleg 19), Messung ASWebAuthenticationSession | keine |
| Aufwand | M, plus Betrieb je Gerät | M | S |

Option 1 scheidet aus. Sie hängt an MDM-verwalteten Macs, die bei den Zielorganisationen
(ehrenamtliche Einheiten, ELW-Rechner) nicht die Regel sind. Sie deckt keinen fremden IdP ab und
ist für `.local` nicht belegt.

## Entscheidung (29.09.2026)

**Gestaffelt: Option 3 jetzt, Option 2 danach.**

### Stufe 1 — Mac-Hülle ohne Passkey (LFH-817)

- Die Hülle meldet ihre Fähigkeiten per Init-Skript, auf macOS mit `passkey: false`. Das ist
  der einzige Weg, der ohne Fehlversuch auskommt (Fakt 2). Name und Form der Kennung legt
  LFH-817 fest, gelesen wird sie im Frontend an genau einer Stelle.
- Die Login-Seite zeigt dort keinen Passkey-Knopf, das Profil bietet keine Einrichtung an und
  sagt in einer Zeile, warum.
- Ohne Kennung (Browser, Windows-Hülle) bleibt alles, wie es ist.
- Bekannte Grenze bis Stufe 2: SSO-Konten, deren IdP nur Passkeys kennt (Fakt 1).
- Nicht gemessen ist `navigator.credentials.create` mit Geste für `elw.local`, nur ohne
  Fokus (`belege/macos/passkey-ohne-fokus.json`). Die Einrichtung wird nach Apples
  Regel mit ausgeblendet, sie hängt an derselben Verknüpfung.

### Stufe 2 — Anmeldung im Systembrowser (LFH-818)

- **Zuerst messen**, im Spike-Repo: Erscheint die Passkey-Abfrage für `elw.local` (mkcert,
  mDNS) und für PocketID in `ASWebAuthenticationSession`, ersatzweise im Standardbrowser?
  Scheitert beides, wird diese Entscheidung neu aufgemacht.
- Ablauf nach dem Muster von PKCE:
  1. Die Hülle erzeugt `verifier`, behält ihn und öffnet die Anmeldeseite des Servers mit
     `challenge` im Systembrowser.
  2. Nach erfolgreicher Anmeldung, gleich über welchen Weg, leitet der Server auf
     `lifeline://anmeldung?code=…` um. Der Code ist kurzlebig, nur einmal gültig und an die
     `challenge` gebunden.
  3. Die Hülle löst den Code mit dem `verifier` im Webview ein, der Server setzt dort die
     Sitzung.
- **Warum die Bindung Pflicht ist:** Der Spike hat gezeigt, dass jede Webseite die Hülle per
  Deeplink ansteuern kann. Ohne `verifier` könnte eine fremde Seite einen eigenen Code
  unterschieben und die Hülle in ein fremdes Konto anmelden (Login-CSRF).
- **Abweichung von „Abhilfen nur in der Hülle“** (LFH-720, Empfehlung): Die Übergabe einer
  Sitzung zwischen zwei Cookie-Speichern geht nicht ohne Server. Die Abweichung ist klein
  (ein Start-, ein Einlöse-Endpunkt), alle Anmeldewege münden weiter in `session::anlegen`.
- Mit Stufe 2 fällt die Ausblendung der Passkey-Anmeldung aus Stufe 1. Die Einrichtung im
  Profil bleibt in der Hülle ausgeblendet und geschieht im Browser. Der Passkey hängt an der RP,
  nicht am Gerätefenster, und trägt danach auch die Anmeldung über Stufe 2.

## Nicht behauptet

- Dass `ASWebAuthenticationSession` oder Safari den Passkey für `elw.local` mit mkcert
  anbieten. Das misst LFH-818 zuerst.
- Dass Associated Domains im MDM-Modus für `.local` funktioniert. Das ist Doku-Stand und wurde
  mit dieser Entscheidung nicht weiter verfolgt.
