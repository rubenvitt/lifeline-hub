# Spec Delta

## ADDED Requirements

### Requirement: Die macOS-Hülle meldet sich im Systembrowser an
Die macOS-Hülle MUST der geladenen Anwendung melden, dass sie die Anmeldung im Systembrowser
anbietet, und MUST der Serverseite genau diese eine Handlung freigeben. Die Anmeldeseite in der
macOS-Hülle MUST „Im Browser anmelden“ anbieten, neben Passwort und OIDC und auch dann, wenn
nur Passkeys aktiv sind. Die Passkey-Anmeldung selbst MUST in der Hülle weiter fehlen.

Beim Start der Handlung MUST die Hülle einen neuen, zufälligen `verifier` erzeugen und ihn
nicht aus der Hülle herausgeben. Sie MUST die Bestätigungsseite des geladenen Servers in einer
`ASWebAuthenticationSession` öffnen und dabei nur die `challenge` übergeben. Den Rücksprung
`lifeline://anmeldung?code=…` MUST sie nur aus dieser Sitzung annehmen. Den Code MUST sie mit
dem `verifier` gegen denselben Server einlösen, und zwar nur in dem Fenster, aus dem die
Anmeldung gestartet wurde, und nur, wenn es gerade eine Seite dieses Servers zeigt. Nach
erfolgreicher Einlösung MUST dieses Fenster angemeldet sein,
ohne dass die Hülle neu startet. Bricht die Person ab oder scheitert die Einlösung, MUST die
Anmeldeseite stehen bleiben und einen Hinweis zeigen. Ein erneuter Start MUST einen laufenden
ersetzen, und ein alter `verifier` MUST dabei verfallen. Die Handlung MUST wieder bedienbar sein,
sobald der Start zurückgekehrt ist, auch wenn der Browser keinen Abbruch meldet.

#### Scenario: SSO-Konto mit Passkey-only-IdP
- **WHEN** ein Konto ohne eigenes Passwort, dessen IdP nur Passkeys kennt, in der macOS-Hülle „Im Browser anmelden“ wählt und sich im Browser beim IdP per Passkey anmeldet
- **THEN** ist die Mac-App danach als dieses Konto angemeldet

#### Scenario: Lifeline-Passkey
- **WHEN** jemand mit einem im Browser eingerichteten Lifeline-Passkey „Im Browser anmelden“ wählt und sich dort per Passkey anmeldet
- **THEN** ist die Mac-App danach angemeldet

#### Scenario: Abbruch
- **WHEN** die Person das Anmeldefenster des Browsers schließt, ohne zuzustimmen
- **THEN** bleibt die Anmeldeseite der Mac-App stehen, und es entsteht keine Sitzung

#### Scenario: Nur Passkey aktiv
- **WHEN** auf dem Server nur Passkeys als Anmeldeweg aktiv sind und die macOS-Hülle die Anmeldeseite lädt
- **THEN** zeigt die Seite „Im Browser anmelden“ und keinen Passkey-Knopf

#### Scenario: Browser und Windows-Hülle
- **WHEN** die Anmeldeseite im Browser oder in der Windows-Hülle geöffnet wird
- **THEN** fehlt „Im Browser anmelden“, und die Seite verhält sich wie bisher

#### Scenario: Fremde Seite im startenden Fenster
- **WHEN** der Rücksprung eintrifft, während das Fenster, aus dem die Anmeldung gestartet wurde, eine Seite einer anderen Origin zeigt
- **THEN** löst die Hülle den Code nicht ein und gibt weder Code noch `verifier` an diese Seite

## MODIFIED Requirements

### Requirement: Der Deeplink hat ein festes Schema
Die Hülle MUST Deeplinks der Form `lifeline://verbinden?server=<https-Adresse>` annehmen.
Deeplinks mit einem anderen Pfad oder ohne Parameter `server` MUST sie ohne Wirkung verwerfen.
Hat die Hülle noch keine Adresse gespeichert, MUST ein gültiger Deeplink die Erststart-Maske mit
der Adresse vorbelegen, und verbunden wird erst mit „Verbinden“. Ein `lifeline://anmeldung`, der
als Deeplink von außen eintrifft und nicht aus der laufenden Anmeldesitzung der Hülle stammt,
MUST ohne Wirkung bleiben. Verworfene Deeplinks MUST ohne ihre Query ins Protokoll.

#### Scenario: Deeplink beim ersten Start
- **WHEN** die Hülle ohne gespeicherte Adresse über `lifeline://verbinden?server=https://elw.local:8443` geöffnet wird
- **THEN** zeigt die Erststart-Maske `https://elw.local:8443` im Eingabefeld, und nichts ist gespeichert

#### Scenario: Unbekannter Pfad
- **WHEN** die Hülle `lifeline://trennen?server=https://elw.local:8443` empfängt
- **THEN** ändert sich weder die gespeicherte noch die geladene Adresse

#### Scenario: Anmeldecode von außen
- **WHEN** eine Webseite `lifeline://anmeldung?code=abc` öffnet, während die Hülle läuft
- **THEN** löst die Hülle nichts ein, ihre Sitzung ändert sich nicht, und im Protokoll steht der Link ohne `code`
