# Spec Delta

## ADDED Requirements

### Requirement: Die Hülle meldet, ob sie Passkeys ausführen kann
Die Hülle MUST der geladenen Anwendung vor dem ersten Skript der Seite mitteilen, ob der
Webview Passkeys (WebAuthn) ausführen kann. Auf macOS MUST sie „nicht möglich“ melden, solange
keine Verknüpfung per Associated Domains besteht. Die Anwendung MUST diese Meldung der
Feature-Erkennung des Webviews vorziehen, weil WKWebView dort Fähigkeiten meldet, die es in
der Hülle nicht einlöst. Ohne Meldung (Browser) MUST die Anwendung sich verhalten wie heute.

#### Scenario: macOS-Hülle
- **WHEN** die macOS-Hülle die Anmeldeseite lädt
- **THEN** meldet sie „Passkey nicht möglich“, und die Seite bietet keine Passkey-Anmeldung an

#### Scenario: Browser ohne Hülle
- **WHEN** dieselbe Seite in einem Browser geöffnet wird
- **THEN** fehlt die Meldung, und die Passkey-Anmeldung steht wie bisher zur Verfügung

### Requirement: Die macOS-Hülle bietet keinen Passkey an, den sie nicht ausführen kann
Meldet die Hülle „Passkey nicht möglich“, MUST die Anwendung weder die Passkey-Anmeldung noch
die Einrichtung eines Passkeys anbieten. An der Stelle der Einrichtung MUST sie in einem Satz
sagen, dass Passkeys im Browser eingerichtet werden. Passwort- und OIDC-Anmeldung MUST
unverändert angeboten werden.

#### Scenario: Profil in der macOS-Hülle
- **WHEN** jemand in der macOS-Hülle das Profil öffnet
- **THEN** fehlt „Passkey einrichten“, und ein Hinweis nennt den Browser als Weg
