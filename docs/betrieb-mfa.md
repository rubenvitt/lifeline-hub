# Betrieb: MFA/TOTP

`lifeline-hub` unterstützt TOTP (RFC 6238, Google-Authenticator-kompatibel) als
**optionalen zweiten Faktor** für den lokalen **Passwort-Login** (LFH-43,
Increment 5). SSO- und Passkey-Nutzer sind bereits MFA-stark (IdP-eigene
Passkey-/Hardware-Prüfung, siehe `docs/betrieb-oidc.md` und
`docs/betrieb-webauthn.md`) — TOTP schließt gezielt die Lücke beim
Passwort-Pfad. Es gibt **keine Server-Konfiguration**: TOTP ist rein
per-Nutzer und opt-in, jeder Nutzer richtet es selbst über sein Profil ein.

## Einrichten (Enrollment)

1. Eingeloggt zu "Profil" navigieren und "Zwei-Faktor (TOTP) einrichten"
   klicken.
2. Der Server erzeugt ein neues Secret und zeigt einen QR-Code (`otpauth://`-
   URL) sowie das Base32-Secret als Text an. Mit einer Authenticator-App
   (Aegis, FreeOTP, Google Authenticator, …) den QR scannen oder das Secret
   manuell eingeben.
3. Den von der App erzeugten 6-stelligen Code eingeben, um die Einrichtung zu
   bestätigen. Erst ein gültiger Code aktiviert TOTP für das Konto
   (`totp_aktiviert=1`) — bei falschem Code bleibt der bisherige
   Login-Zustand unverändert.
4. **Direkt nach erfolgreicher Bestätigung zeigt die App einmalig 10
   Recovery-Codes an.** Dieses Fenster kommt nicht wieder — die Codes müssen
   in diesem Moment gesichert werden (Passwort-Manager, Ausdruck o.ä.).

Ein erneutes Starten der Einrichtung (Re-Enroll) ersetzt das Secret und
setzt `totp_aktiviert` zurück auf 0, bis der neue Code bestätigt wird — ein
abgebrochener Re-Enroll lässt das Konto also vorübergehend ohne aktives
TOTP, nicht mit dem alten Secret.

## Recovery-Codes: der einzige Ausweg bei Geräteverlust

Die Recovery-Codes sind **einmalig einsehbar** (Schritt 4 oben) und danach
serverseitig nur noch als Hash vorhanden — der Server kann sie nicht erneut
anzeigen. Jeder Code ist **einmal verwendbar** (wird beim Einlösen atomar als
benutzt markiert).

Ist das Authenticator-Gerät verloren/zurückgesetzt, sind die Recovery-Codes
der einzige Weg, sich noch selbst einzuloggen (siehe Login-Ablauf unten).
**Fehlen sowohl Gerät als auch Recovery-Codes, kommt der Nutzer nicht mehr
selbst hinein — es braucht einen Admin-Reset.**

## Admin-Reset (Achtung: Alleinstell-Admin-Lockout)

Ein Admin kann über die Benutzerverwaltung das TOTP eines anderen Nutzers
zurücksetzen. Das löscht das Secret, deaktiviert TOTP (`totp_aktiviert=0`),
löscht alle verbliebenen Recovery-Codes und invalidiert alle bestehenden
Sessions des betroffenen Nutzers — der Nutzer kann sich danach wieder mit
Passwort allein einloggen und TOTP bei Bedarf neu einrichten.

**Der Admin-Reset setzt zwingend eine bereits eingeloggte Admin-Session
voraus.** Aktiviert ein **alleiniger** Admin TOTP für sich selbst und verliert
sowohl das Authenticator-Gerät als auch die Recovery-Codes, gibt es niemanden
mehr, der den Reset für ihn auslösen kann — das Konto ist ausgesperrt, ohne
Wiederherstellungsweg über die Anwendung selbst. Deshalb:

- **Mindestens zwei aktive Admin-Konten** vorhalten, bevor TOTP für
  Admin-Konten genutzt wird.
- Recovery-Codes von Admin-Konten besonders sorgfältig sichern.

## Login mit aktivem TOTP

Der Login bleibt zweistufig, sonst unverändert:

1. Benutzername + Passwort wie gewohnt prüfen lassen.
2. Ist TOTP für das Konto aktiv, entsteht **noch keine Session** — der Server
   verlangt einen zweiten Schritt: entweder den 6-stelligen TOTP-Code aus der
   Authenticator-App **oder** einen Recovery-Code. Erst nach dessen
   erfolgreicher Prüfung wird die Session angelegt.

Nutzer ohne aktives TOTP loggen sich unverändert einstufig mit
Benutzername/Passwort ein.

## Akzeptierte Posture (dokumentierte Trade-offs)

- **TOTP-Secret liegt serverseitig im Klartext** (keine Hashing-/
  Verschlüsselungsschicht) — anders als ein Passwort muss das Secret bei
  jeder Code-Prüfung wieder lesbar sein, es kann nicht wie ein Passwort
  gehasht werden.
- **Innerhalb-des-Zeitfensters-Replay eines TOTP-Codes** (~90 s, durch die
  Toleranz des Prüf-Algorithmus) wird nicht zusätzlich verhindert — ein
  einmal beobachteter gültiger Code könnte innerhalb dieses kurzen Fensters
  ein zweites Mal funktionieren.

Beide Punkte sind bewusst akzeptiert und konsistent mit dem
Vertrauensmodell der Anwendung (Betrieb im geschützten Einsatz-LAN, kein
Internet-exponierter Login). App-seitige Verschlüsselung des Secrets
at-rest sowie ein Replay-Schutz über Zeitschritt-Tracking sind als
Folgearbeit vorgemerkt (LFH-277).
