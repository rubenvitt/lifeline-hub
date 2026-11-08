# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/ckq15vzr5mrd23p99cj394an (LLH-1490, Epic LLH-1489)

## Why

Eine ELW-Instanz und ein öffentlicher Hub sollen zusammenarbeiten (Konzept
`docs/konzepte/2026-10-29-instanzkopplung-elw-hub.md`). Heute kennt ein Server nur Menschen und
gekoppelte Geräte, keine anderen Server: Es gibt keine Instanzkennung, kein Schlüsselpaar und
keinen Weg, eine Anfrage einer fremden Instanz zu prüfen. Jeder weitere Teil des Epics (Führung,
Spiegel, Stammdaten, Brücke) und die Maschinen-Anmeldung der öffentlichen API (LLH-1148) bauen auf
diesem Vertrauensanker auf. Deshalb kommt er zuerst und ohne Nutzdaten.

## What Changes

- Jede Instanz bekommt beim ersten Start eine **Instanzkennung und ein Ed25519-Schlüsselpaar**,
  gespeichert in der Datenbank (wandert mit der Sicherung).
- **Kopplung per Einmal-Code:** Ein Org-Admin erzeugt am Hub einen Code (16 Zeichen, 15 Minuten,
  einmalig). Ein Admin am ELW gibt Hub-Adresse und Code ein. Dabei tauschen beide Seiten ihre
  öffentlichen Schlüssel aus; der Code bindet die Schlüssel beider Seiten, sodass ein Angreifer
  in der Mitte auch mit gefälschtem TLS-Zertifikat auffällt. Eine Kopplung je Instanzpaar, jede
  Org kommt mit eigenem Code dazu und wird an die Org des einlösenden Admins gebunden.
- **Signierte Anfragen und Antworten:** Jede Anfrage zwischen gekoppelten Instanzen trägt ein
  kurzlebiges EdDSA-JWT (Muster DPoP/`private_key_jwt`) mit Ziel, Methode, Pfad und Hash des
  Bodys; jede Antwort ist ebenso signiert. Wiederholte Anfragen werden abgewiesen.
- **Melden:** Die Instanz, die sich meldet (zuerst der ELW), meldet sich in festen Abständen
  signiert beim Gegenüber. Beide Seiten zeigen „zuletzt gesehen“, Softwarestand und
  Protokollversion.
- **Protokollversion:** ganzzahlig; beide Seiten sprechen N und N−1. Bei größerem Abstand bleibt
  die Kopplung bestehen, aber nur Melden und Status gehen, beide Seiten zeigen „Update nötig“.
- **Unterschriftsschlüssel der Org-Admins:** Ein Org-Admin registriert am Hub einen eigenen
  Passkey nur zum Unterschreiben, getrennt von der Anmeldung. Die öffentlichen Schlüssel gehen an
  die gekoppelten Instanzen der Org. Einen neuen Schlüssel nimmt eine Instanz nur an, wenn ein
  ihr schon bekannter Admin ihn unterschrieben hat; einen Widerruf nimmt sie vom Gegenüber allein
  an. Das Prüfen einer Unterschrift über eine eigene Challenge entsteht hier als Baustein; die
  Notübernahme selbst bleibt LLH-1491.
- **Widerruf an beiden Seiten:** Ein Admin nimmt seine Org aus der Kopplung; ohne Org ist sie
  widerrufen. Der Widerruf wird dem Gegenüber signiert mitgeteilt, sobald es sich meldet.
- **Admin-Seite „Instanzkopplung“** an jeder Instanz: eigene Kennung und Fingerabdruck,
  gekoppelte Instanzen mit Zustand, Code erzeugen bzw. einlösen, Widerruf, Unterschriftsschlüssel
  der Org. Jede Aktion landet in `admin_audit`.
- **ADR** „Maschinen weisen sich mit Schlüsselpaar und signierten Anfragen aus“ als Vorgabe für
  LLH-1148.
- Nicht in dieser Change: mTLS, Nutzdaten (Einsatz, Stammdaten), Führung und Notübernahme,
  Entdeckung im LAN.

## Capabilities

### New Capabilities

- `instanz-kopplung`: Identität einer Instanz, Kopplung zweier Instanzen per Einmal-Code,
  signierte Anfragen und Antworten, Melden, Protokollversion und Widerruf.
- `org-admin-unterschrift`: Unterschriftsschlüssel der Org-Admins: Registrierung am Hub,
  Verteilung an gekoppelte Instanzen, Vertrauenskette für neue Schlüssel, Widerruf, Prüfen einer
  Unterschrift über eine vorgegebene Challenge.

### Modified Capabilities

(keine)

## Impact

- **Backend:** neues Modul `src/instanz/` (Identität, Kopplung, Signatur, Melden), neues Modul
  `src/auth/unterschrift/` (Unterschriftsschlüssel, Prüfen), Routen, Hintergrund-Task zum Melden,
  neue Migrationen (nächste freie Nummer über `origin/alpha`), neue `AdminAktion`-Varianten mit
  CHECK-Migration. Neue direkte Abhängigkeiten `ed25519-dalek`, `p256`, `hmac`, `hkdf`
  (alle schon im Lockfile).
- **Frontend:** Admin-Seite „Instanzkopplung“ in `frontend/src/admin/adminNav.tsx`, API-Modul,
  generierte Typen.
- **Doku:** ADR + Kapitel 9, Kapitel 5/6/8/11/12 der Architektur, Anwenderkapitel zur
  Administration, `src/AGENTS.md` (Abschnitt Instanzkopplung).
- **Sicherheit:** neuer öffentlicher Endpunkt zum Einlösen (IP-Sperre wie Gerätekopplung), neue
  ausgehende Verbindung vom ELW zum Hub (SSRF-Schutz wie OIDC). Keine Änderung für ungekoppelte
  Instanzen.
