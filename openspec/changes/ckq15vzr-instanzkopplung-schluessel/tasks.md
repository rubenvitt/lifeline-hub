# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: zuerst der rote Test, dann der
Code. Migrationen bekommen die nächste freie Nummer über `origin/alpha`
(`scripts/check-migrationen.sh`, vorher `git fetch origin alpha`).

## 1. Identität der Instanz (D1)

- [x] 1.1 `ed25519-dalek`, `p256`, `hmac`, `hkdf` (Versionen aus dem Lockfile) als direkte Abhängigkeiten samt Kommentar; `danger-credential-internals` bleibt in `[dev-dependencies]`, weil `Passkey::get_public_key()` genügt (D7); prüfen mit `cargo tree -d` (keine neue zweite Version) und `cargo build`
- [x] 1.2 Migration `instanz_identitaet` (Einzeile per CHECK) und `instanz::identitaet::laden_oder_erzeugen` beim Start; Tests: zweiter Aufruf liefert dieselbe Kennung und denselben Schlüssel, zwei gleichzeitige Aufrufe ergeben eine Zeile, Debug-Ausgabe der Struktur enthält den privaten Schlüssel nicht
- [x] 1.3 Fingerabdruck (20 Byte SHA-256, Crockford in Vierergruppen) als reine Funktion; Test mit festem Schlüssel und erwarteter Zeichenkette
- [x] 1.4 Optionen `--instanz-name`/`LIFELINE_INSTANZ_NAME` (Vorgabe RP-ID) und `--instanz-melden-sekunden`/`LIFELINE_INSTANZ_MELDEN_SEKUNDEN` (Vorgabe 60) in `src/config.rs`; Test der Vorgaben und der Untergrenze (mindestens 10 s)

## 2. Signierte Nachrichten (D3)

- [x] 2.1 `instanz::signatur`: Anfrage-JWS bauen und prüfen (Claims laut D3, nur `alg = EdDSA`); Tests: gültig, falsche Signatur, anderes `aud`, `htm`, `htu`, `bh`, abgelaufen, `exp − iat > 60`, `alg = none`/`HS256` abgelehnt, Uhrabweichung 290 s angenommen und 310 s abgelehnt
- [x] 2.2 Migration `instanz_jti` und Wiederholschutz; Purge räumt abgelaufene Einträge im bestehenden Purge-Lauf; Tests: zweite Anfrage mit gleicher `jti` → abgelehnt, nach Ablauf geräumt
- [x] 2.3 Antwort-JWS mit `bezug` und `bh`; Test: Antwort zu fremder `jti` oder mit verändertem Body wird abgelehnt
- [x] 2.4 Extractor `GekoppelteInstanz` (begrenzter Body, Kopplung aus `kid`, Zustand aktiv, Protokollfenster aus D5 mit 426); Integrationstests in `tests/`: unsigniert → 401, unbekannte Kennung → 401, widerrufen → 401, Protokoll zwei Stände zurück → 426 außer bei Melden; Einträge in `tests/fehler_vertrag.rs`

## 3. Kopplung per Code (D2, D6)

- [x] 3.1 Migrationen `instanz_kopplung`, `instanz_kopplung_org`, `instanz_kopplungscode` mit CHECKs; Wire-Enums `KopplungRichtung`, `KopplungZustand` über `wire_enum!` mit Fall in `tests/enum_wire_kontrakt.rs`
- [x] 3.2 `instanz::code`: 16 Zeichen, Normalisieren, HKDF-Ableitung von `suche`, `k_einloeser`, `k_aussteller`, Transkripte und Prüfwerte; Tests mit festen Vektoren, Prüfwert mit ausgetauschtem Schlüssel oder anderer Adresse scheitert
- [x] 3.3 Code ausstellen: `POST /api/admin/instanz/codes` nur `AdminUser` mit gültigem eigenem Unterschriftsschlüssel (sonst 409), Org des Admins, Ablauf 15 min; Tests: Nicht-Admin 403, ohne Schlüssel 409, ein neuer Code ersetzt keinen fremden
- [x] 3.4 Einlösen am Aussteller: öffentliche Route `POST /api/instanz/koppeln` mit IP-Sperre, einmalig per bedingtem `UPDATE`, Zustand `angebahnt`, signierte Antwort mit Org und Unterschriftsschlüsseln; Tests: abgelaufen, zweites Mal, falscher Prüfwert → je 401; zehn Fehlversuche → 429; bestehende Kopplung derselben Gegenstelle bekommt eine zweite Org-Zuordnung; `angebahnt` älter als 15 min wird verworfen
- [x] 3.5 Einlösen am Einlöser: `POST /api/admin/instanz/einloesen` (Adresse + Code, nur `AdminUser`, Org des Admins), ausgehender Aufruf ohne Weiterleitung, nur `https://` (Loopback-`http` für Tests), Prüfung von `mac_a` und Antwortsignatur, Speichern als `aktiv`, Unterschriftsschlüssel des Grundstocks als `herkunft = gegenueber`; Test mit zwei Instanzen im selben Testprozess (zwei Pools, echte HTTP-Server auf Loopback): Koppeln gelingt, ausgetauschter Schlüssel in der Mitte (Test-Proxy) → beide Seiten ohne Kopplung

## 4. Melden und Protokollversion (D4, D5)

- [x] 4.1 `PROTOKOLL = 1` und Fensterlogik als reine Funktion; Tests für Abstand 0, 1, 2 in beide Richtungen
- [x] 4.2 Route `POST /api/instanz/melden`: aktualisiert zuletzt gesehen, Stand, Protokoll; setzt `angebahnt` → `aktiv`; liefert Widerrufe und Änderungen an Unterschriftsschlüsseln seit dem gemeldeten Stand; Tests: erste Meldung aktiviert, Antwort enthält nur Neues
- [x] 4.3 Hintergrund-Task der meldenden Seite in `main.rs` (Start sofort, Abstand aus Konfiguration, Verdopplung bis 10 min bei Fehlern), Ergebnis und Fehler an der Kopplung („Antwort ungültig“, „Uhr weicht ab“, „Update nötig“); Tests mit zwei Instanzen: Meldung kommt an, Ausfall des Gegenübers setzt `letzter_fehler`, Instanz ohne Kopplung baut keine Verbindung auf

## 5. Unterschriftsschlüssel (D7, D8)

- [x] 5.1 Migration `unterschrift_schluessel` mit Wire-Enums `SchluesselHerkunft`, `SchluesselZustand` und monotonem `stand` je Org
- [x] 5.2 Prüfer `auth::unterschrift::pruefe` für ES256; Tests mit im Test erzeugten Assertions: gültig, falsche Challenge, falsche RP-ID, falsche Herkunft, ohne UV, ohne UP, Signatur einer anderen Erklärung, unbekannter `alg`
- [x] 5.3 Registrierung: Zeremonie-Routen nur `AdminUser`, UV required, eigener User-Handle je Schlüssel, nur ES256 (RS256 → 422), eigene Tabelle; erster Schlüssel einer Org ohne Kopplung `gueltig`, sonst `wartet_auf_gegenzeichnung`; Tests: Nicht-Admin 403, Anmeldung mit dem Unterschriftsschlüssel scheitert (Passkey-Anmeldung findet ihn nicht)
- [x] 5.4 Gegenzeichnung: Server bildet die Erklärung (kanonisches JSON) und die Challenge im Zeremonie-Zustand, prüft per 5.2 mit einem gültigen Schlüssel der Org, setzt `gueltig` und erhöht `stand`; Tests: Gegenzeichnung mit widerrufenem Schlüssel oder fremder Org scheitert
- [x] 5.5 Annahme am Einlöser (Grundstock und Nachlieferung aus 4.2): neuer Schlüssel nur mit gültiger Gegenzeichnung eines bekannten Schlüssels derselben Org, sonst verwerfen + Hinweis + Admin-Spur; Widerruf ohne Gegenzeichnung; Tests: untergeschobener Schlüssel ohne Gegenzeichnung wird verworfen, gegengezeichneter angenommen, Widerruf übernommen
- [x] 5.6 Widerruf: durch Admin der Org; automatisch beim Deaktivieren oder Herabstufen eines Admins im selben Commit; letzter gültiger Schlüssel einer Org mit aktiver Kopplung → 409; Tests für alle drei Wege

## 6. Widerruf der Kopplung (D9)

- [x] 6.1 `POST /api/admin/instanz/kopplungen/{id}/widerrufen` nur für die eigene Org; ohne gültige Zuordnung → `widerrufen`; erreichte Seite liefert die Mitteilung bei der nächsten Meldung (signiert), meldende Seite schickt sofort eine letzte Meldung mit `widerrufen` und stellt das Melden ein (D9); Tests mit zwei Instanzen für beide Richtungen, auch Widerruf ohne Netz an der meldenden Seite

## 7. Admin-Spur (D11)

- [x] 7.1 Neue `AdminAktion`-Varianten mit CHECK-Migration; Fälle in `tests/admin_audit.rs`; vom Gegenüber ausgelöste Einträge mit `akteur_id = NULL` und Namen der Gegenstelle; Test: Einlösen schreibt an beiden Seiten je einen Eintrag mit Kennung und Fingerabdruck

## 8. Oberfläche (D10)

- [x] 8.1 OpenAPI-Typen für alle neuen Antworten, `scripts/check-typ-codegen.sh` grün, beide generierten Dateien mitcommittet; `frontend/src/api/instanz.ts` mit Query-Keys nach `frontend/AGENTS.md`
- [x] 8.2 Seite „Instanzkopplung“ in `frontend/src/instanz/`, Eintrag in `adminNav.tsx` (`NUR_ADMIN`), Paneel „Diese Instanz“; Vitest: Fingerabdruck kopierbar, Nicht-Admin sieht den Eintrag nicht
- [x] 8.3 Paneel „Gekoppelte Instanzen“ mit Code ausstellen (gesperrt mit Erklärung ohne eigenen Unterschriftsschlüssel), Code einlösen (zeigt danach den Fingerabdruck des Gegenübers), Zustandszeile als reine Funktion, Widerruf im Menü; Vitest für Zustandszeile und Sperre
- [x] 8.4 Paneel „Unterschriftsschlüssel“ mit Registrieren, Gegenzeichnen und Widerrufen über `navigator.credentials`; Vitest mit gestubbtem WebAuthn
- [ ] 8.5 e2e-Fall in `frontend/e2e/` für die Seite an einer Instanz (Anzeige, Code ausstellen gesperrt ohne Schlüssel); Bilder der Seite für den PR nach `dev-zunder-ausfuehren`, „Bilder der Änderung“

## 9. Doku und Regeln

- [x] 9.1 ADR-0014 „Maschinen weisen sich mit Schlüsselpaar und signierten Anfrage-JWTs aus“ mit Regeln und Prüfung nach `docs/architektur/AGENTS.md`, Kapitel 9; Wächter der ADRs grün
- [x] 9.2 Architektur: Kapitel 5 (neue Module), 6 (Ablauf Koppeln und Melden als Mermaid), 8 (Instanzkopplung als Konzept), 11 (Risiko Instanzschlüssel im Klartext, öffentlicher Einlöse-Endpunkt), 12 (Instanz, Kopplung, Unterschriftsschlüssel); Wächter der Architektur grün
- [x] 9.3 Abschnitt „Instanzkopplung“ in `src/AGENTS.md` (Signatur-Extractor, Protokollversion erhöhen, Melden nur additiv) samt Zeile in der Tabelle der Wurzel-`AGENTS.md`, falls ein eigener Bereich entsteht
- [x] 9.4 Anwenderdoku: Kapitel zur Administration um „Instanzen koppeln“ und „Unterschriftsschlüssel“ nach `docs/anwender/AGENTS.md`; Bilder über den Bildlauf
- [x] 9.5 Kommentar an LLH-1148 mit Verweis auf ADR-0014; Konzeptnotiz `docs/konzepte/2026-10-29-instanzkopplung-elw-hub.md` mit Verweis auf diese Change unter „Offene Fragen“ (Protokollversion beantwortet)

## 10. Abschluss

- [ ] 10.1 `./scripts/check-all.sh` grün (bekannte Fremdbefunde benannt); Mutationsproben für Wiederholschutz, Body-Hash und Gegenzeichnung (Prüfung auskommentiert → Test rot)
- [ ] 10.2 Review per `superpowers:requesting-code-review` mit Schwerpunkt Krypto und Vertrauenskette, Befunde abgearbeitet

## Workflow follow-up

- `/opsx:archive ckq15vzr-instanzkopplung-schluessel` im selben Branch vor dem PR, Spec-Sync nach `openspec/specs/instanz-kopplung/` und `openspec/specs/org-admin-unterschrift/`
- PR gegen `alpha`, Zunder LLH-1490 auf `review` mit `pr_url`, danach `release_task`
