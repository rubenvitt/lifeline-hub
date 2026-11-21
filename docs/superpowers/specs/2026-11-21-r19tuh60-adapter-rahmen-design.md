# Adapter-Rahmen: Geheimnisspeicher, Abrufe im Hintergrund, Zustand je Adapter (LLH-1632)

Stand: 21.11.2026 · Zunder: https://zunder.rubeen.dev/#/aufgabe/r19tuh60j02y0c7o547p5d7z ·
Teile: LLH-2017 (A, Backend), LLH-2018 (B, Admin-UI) · Konzept:
[`docs/konzepte/2026-11-10-schnittstellen-ausbau.md`](../../konzepte/2026-11-10-schnittstellen-ausbau.md),
Abschnitt „Gemeinsamer Unterbau“ · Freigabe: offen

## Absicht

Jeder geplante Adapter (Divera LLH-1193, HiOrg LLH-1634/1194, Postfach LLH-1195, Ausgang
LLH-1197) braucht dasselbe: einen Ort für seinen Zugangsschlüssel, einen Abruf im Hintergrund,
der Fehler aushält, und eine Anzeige, ob er läuft. Heute gibt es davon nur die Webhooks
(LLH-1656), fest verdrahtet für einen Zweck. Dieser Entwurf zieht daraus einen Rahmen, in den
ein Adapter sich mit wenig eigenem Code einhängt. Leitplanken aus dem Konzept: G4 (neutraler
Vertrag, Adapter übersetzen), G5 (Eingehendes kommt am Hub an), G7 (kein stiller Fehler).

## Abgestimmt am 21.11.2026 (Phase-1-Checkpoint)

- **Schnitt:** Hier nur der allgemeine Rahmen mit „Verbindung prüfen“. Profile je Leitstelle,
  Probealarm und die Freigabe durch den Aufgabenträger (G2) kommen mit der Alarmübernahme
  LLH-1192 (dort per Kommentar vermerkt).
- **Schlüssel:** age X25519 aus `LIFELINE_GEHEIMNIS_SCHLUESSEL` (`AGE-SECRET-KEY-1…`).
- **Ohne oder mit falschem Schlüssel** startet der Server; Adapter melden es, Speichern wird
  abgelehnt.
- **Lieferung:** zwei PRs. A: Backend, ADR, Architektur, Betrieb. B: Admin-UI, Anwenderdoku.
- **Voreinstellungen ohne Widerspruch:** Geheimnisse bleiben auf ihrer Instanz (kein Fluss an
  gekoppelte ELW); die LAN-Ausnahme setzt nur ein Admin, mit Audit; Schlüsselrotation ist eine
  Folgeaufgabe; die Fachebenen (NINA, Pegel, Autobahn …) bleiben außerhalb; der erste echte
  Adapter kommt mit Divera, hier sichert ein Test-Adapter den Rahmen ab.

## Ziele

- Ein Admin legt einen Adapter einer bekannten Art an, setzt seine Geheimnisse (nur schreiben,
  nie wieder lesen) und seine Einstellungen, und sieht danach jederzeit: aktiv oder aus, zuletzt
  erfolgreich, letzter Fehler als Code, nächster Versuch.
- Ein Adapter-Abruf läuft im Hintergrund mit Backoff, über einen Client ohne Weiterleitungen,
  mit Zielschutz (kein Loopback, kein Link-Local, LAN nur als Ausnahme je Adapter) und
  begrenzter Antwortgröße (`http_begrenzt`).
- Ein Fehler, den nur ein Mensch beheben kann (Schlüssel abgelehnt, Geheimnis fehlt,
  Geheimnisspeicher gesperrt), hält den Adapter an und steht als „braucht Eingriff“ da, statt
  ihn endlos zu wiederholen.
- „Verbindung prüfen“ ruft einmal ab, ohne Ergebnisse zu übernehmen, und zeigt das Ergebnis.
- Kein Geheimnis im Klartext in Datenbank, Log, Audit, Backup oder API-Antwort.

## Nicht-Ziele

- Keine Alarmübernahme, keine Einsatzvorschläge, keine Profile, kein Probealarm, keine
  Aufgabenträger-Freigabe (LLH-1192).
- Kein konkreter Adapter in Produktion; die Arten-Liste ist leer, bis Divera kommt.
- Keine Schlüsselrotation (Folgeaufgabe; der Fingerabdruck je Zeile bereitet sie vor).
- Kein Umbau der Webhooks und ihrer ADR-0046; der Rahmen nutzt deren Bausteine, verschiebt sie
  nicht.
- Keine Benachrichtigung bei Störung (die Admin-Seite zeigt den Zustand, G7). Folgeaufgabe, wenn
  gewünscht.
- Keine Verschlüsselung der übrigen Schlüssel in der DB (Instanzschlüssel, VAPID; R19/R22).

## Ansätze

**Rahmen**

1. **Adapter mit persistiertem Zustand je Zeile, Lauf nach dem Muster der Webhooks (gewählt).**
   Eine Tabelle `adapter` trägt Einstellung und Zustand; ein Lauf im Takt holt die fälligen.
   Das Muster ist im Repo erprobt (Backoff als reine Funktion, keine DB-Verbindung während HTTP,
   Tests ohne Netz über ein Trait).
2. Allgemeine Auftragstabelle (Job-Queue) für alle Hintergrundarbeit. Mächtiger, aber ein
   Abruf ist kein Einmal-Auftrag, sondern ein Rhythmus mit Zustand; die Queue müsste ihn
   nachbilden. Verworfen.
3. Abruf auf Anfrage mit Cache wie die Fachebenen (`karte/quellen.rs`). Kennt keinen Zustand und
   keinen Hintergrund; eine Alarmquelle muss ohne Zuschauer laufen. Verworfen.

**Verschlüsselung**

1. **age, Empfänger aus der Identität in der Umgebung (gewählt).** Keine neue Abhängigkeit, das
   Format kennt der Betrieb vom Backup (`age-keygen`), und Rotation geht später über mehrere
   Empfänger.
2. AEAD mit 32-Byte-Schlüssel (`chacha20poly1305`). Ein zweites Verfahren im Projekt für
   denselben Zweck. Verworfen.

**Ort der Geheimnisse**

1. **Je Adapter, in benannten Plätzen, die die Art festlegt (gewählt).** Löschen räumt mit auf,
   die Art weiß, was sie braucht, und die Admin-Seite zeigt es am Adapter.
2. Ein Org-weiter Tresor mit frei benannten Einträgen, auf die Adapter verweisen. Mehr Bedienung
   für einen seltenen Fall (zwei Adapter mit demselben Geheimnis; HiOrg EFS und Core haben
   verschiedene). Verworfen.

## Entwurf

### Geheimnisspeicher

- **Schlüssel:** `--geheimnis-schluessel` / `LIFELINE_GEHEIMNIS_SCHLUESSEL`, eingelesen nur in
  `src/config.rs`, als `age::x25519::Identity` in einem `secrecy`-Puffer, `Debug` maskiert.
  Ein öffentlicher Schlüssel (`age1…`) oder ein anderes Format wird beim Start abgelehnt
  (Konfigurationsfehler, wie beim Backup-Empfänger umgekehrt).
- **Fingerabdruck:** die ersten 16 Hex-Zeichen von SHA-256 über den Empfänger (`age1…`). Er
  steht an jeder Zeile und in der Admin-Antwort, nie der Schlüssel selbst.
- **Zustand des Speichers** (beim Start berechnet, im Prozess gehalten):
  `bereit` (Schlüssel da, alle Zeilen tragen seinen Fingerabdruck), `fehlt` (kein Schlüssel),
  `passt_nicht` (Schlüssel da, aber mindestens eine Zeile trägt einen anderen Fingerabdruck).
  `fehlt` und `passt_nicht` schreiben beim Start je eine Warnung ins Log, ohne Wert.
- **Tabelle `adapter_geheimnis`:** `adapter_id` (FK, `ON DELETE CASCADE`), `name` (Platz der
  Art), `chiffrat` BLOB, `schluessel_fp`, `gesetzt_at`, `gesetzt_von` (FK Benutzer,
  `SET NULL`); Primärschlüssel `(adapter_id, name)`.
- **Schreiben:** `PUT …/geheimnisse/{name}` mit `{ "wert": "…" }`. Der Wert lebt als
  `SecretString`, wird auf einem Blocking-Thread verschlüsselt (wie ADR-0051) und ersetzt die
  Zeile. Höchstlänge `GEHEIMNIS_MAX` (4096 Byte), gespiegelt in `eingabegrenzen.ts`. Ist der
  Speicher nicht `bereit`, antwortet die Route 422 mit Code `geheimnisspeicher_gesperrt`.
- **Lesen:** gibt es über die API nicht. Die Antwort nennt je Platz nur `gesetzt` (ja/nein),
  `gesetzt_at`, `gesetzt_von` und ob der Fingerabdruck passt. Entschlüsselt wird nur im Lauf,
  direkt vor dem Abruf, und nur für diesen Adapter; der Klartext verlässt das Modul als
  `SecretString` und wird nicht geloggt.
- **Backup:** Das Chiffrat geht mit, der Schlüssel nicht. Wer auf einem anderen Rechner ohne
  denselben Schlüssel wiederherstellt, sieht `passt_nicht` und setzt die Geheimnisse neu.
  Betriebsdoku: Schlüssel getrennt sichern wie die age-Identität des Backups.

### Adapter und Arten

- **Tabelle `adapter`:** `id` TEXT, `org_id` (FK, Cascade, Index), `art`, `name`,
  `einstellungen` (JSON, nichts Geheimes), `intervall_s`, `lan_erlaubt`, `zustand`
  (`aktiv` | `angehalten`), `angehalten_grund` (Code), `fehler_seit`, `fehlversuche`,
  `naechster_abruf_at`, `letzter_fehler_at`, `letzter_fehler_art`, `letzter_fehler_status`,
  `letzter_erfolg_at`, `letzte_anzahl`, `angelegt_at`, `angelegt_von`, `geaendert_at`.
  `art` bekommt **kein** CHECK: neue Arten kämen sonst nur mit Tabellenumbau; geprüft wird gegen
  das Verzeichnis im Code. Eine unbekannte Art (Code entfernt) zeigt der Zustand.
- **Tabelle `adapter_versuch`:** die letzten 50 Versuche je Adapter (`at`, `probe`, `status`,
  `fehler_art`, `dauer_ms`, `anzahl`), wie `maschine_webhook_versuch`; kein Antwortrumpf.
- **Art als Trait** in `src/adapter/`: Code (`divera`, …), Anzeigename, Geheimnis-Plätze
  (Name, Bezeichnung, Pflicht), Einstellungsfelder (Name, Bezeichnung, Typ Text/Zahl/URL,
  Pflicht, Höchstlänge), kleinstes und vorgeschlagenes Intervall, Prüfung der Einstellungen,
  und der Abruf in **zwei Phasen**:
  1. `abrufen(kontext)` — nur Netz, keine DB. Der Kontext bringt den Client des Rahmens,
     die entschlüsselten Geheimnisse, die Einstellungen und ob es ein Probelauf ist.
     Ergebnis ist eine Übernahme oder ein `AdapterFehler`.
  2. `uebernehmen(tx)` — nur DB, kein Netz, in einer Transaktion (`write_retry!`), schreibt in
     den Vertrag der Art (später Alarmmeldung, Stammdaten …) und liefert die Anzahl. Beim
     Probelauf entfällt diese Phase.
- **Verzeichnis:** eine statische Liste der Arten. In Produktion leer bis LLH-1193; der
  Test-Adapter steht nur unter `#[cfg(test)]` bzw. dem Feature `dev-seeds`.

### Lauf

- Gestartet in `main.rs` neben dem Webhook-Lauf, mit demselben `stopp`-Signal und begrenztem
  Warten in `herunterfahren`. Takt 5 s, höchstens 4 Abrufe gleichzeitig, ein Adapter nie
  doppelt (Merker wie `webhook/lauf.rs`). Tests rufen `durchgang(pool, netz, jetzt)` mit einem
  Netz-Ersatz.
- **Fällig** ist ein Adapter mit `zustand = aktiv`, bekannter Art, `naechster_abruf_at <= jetzt`
  (oder leer) und einer Org, die nicht als ELW gekoppelt ist (`gesperrt_grund`, G5).
- **Erfolg:** `letzter_erfolg_at`, `letzte_anzahl`, Störung zurücksetzen,
  `naechster_abruf_at = jetzt + intervall`.
- **Vorübergehender Fehler** (Verbindung, DNS, Zeitüberschreitung, TLS, 5xx, 429, Antwort zu
  groß oder unlesbar): `fehler_seit`/`fehlversuche` fortschreiben, nächster Versuch nach
  `max(intervall, min(60 s · 2^(n−1), 15 min))`. Kein automatisches Anhalten: eine Alarmquelle
  soll nach einer Störung von selbst wiederkommen. Die Formel steht als reine Funktion in
  `src/adapter/zustand.rs`; die Webhook-Funktion bleibt unberührt (anderer Deckel, Anhalten nach
  24 h).
- **Fehler, der einen Menschen braucht:** `abgelehnt` (401/403), `geheimnis_fehlt`,
  `geheimnisspeicher_gesperrt`, `einstellung_ungueltig`, `ziel_intern`, `ziel_ungueltig`,
  `weiterleitung`. Der Adapter geht auf `angehalten` mit diesem Grund. Er läuft wieder, wenn ein
  Admin „fortsetzen“ wählt oder ein Geheimnis bzw. eine Einstellung ersetzt (dann sofort fällig).
- **Fehlercodes** als `wire_enum! AdapterFehler`, angelehnt an `WebhookFehler`: `status`,
  `abgelehnt`, `weiterleitung`, `zeitueberschreitung`, `verbindung`, `tls`, `ziel_intern`,
  `dns`, `ziel_ungueltig`, `zu_gross`, `antwort_ungueltig`, `geheimnis_fehlt`,
  `geheimnisspeicher_gesperrt`, `einstellung_ungueltig`, `intern`. Nie Text des Ziels.
- **Angezeigter Zustand** (`wire_enum! AdapterZustand`, abgeleitet): `aus` (vom Admin
  angehalten), `braucht_eingriff` (angehalten mit Grund), `gestoert` (`fehler_seit` gesetzt),
  `ok` (letzter Abruf erfolgreich), `wartet` (noch nie gelaufen), `art_unbekannt`.

### Weg nach draußen

- Neuer `Zweck::Adapter` in `ausgehend.rs`. Eigener Client-Singleton je LAN-Flag, gebaut wie
  `webhook::ziel::baue_client`: `no_proxy`, `Policy::none()`, `https_only`, Verbindung 5 s,
  gesamt 20 s, Resolver `webhook::ziel::WebhookResolver` (pinnend, fail-closed). URLs aus
  Einstellungen prüft `webhook::ziel::check_url` beim Speichern und vor jedem Abruf.
- Antworten liest der Adapter nur über `http_begrenzt` mit eigenem Deckel
  (`DECKEL_ADAPTER` 2 MiB, je Art kleiner wählbar).
- Für spätere Nicht-HTTP-Adapter (IMAP, SMTP) liefert `src/adapter/ziel.rs` eine geprüfte
  Adressauflösung mit derselben Klassenprüfung (`filter_adressen`); gebaut wird sie, wenn der
  erste solche Adapter kommt.

### Admin-API (Teil A)

Lesen mit `darf_admin_bereich`, Schreiben mit `AdminUser`, alles mit `org_id` gefiltert, fremde
ID 404. Auf einem gekoppelten ELW lehnen Schreibwege mit dem `gesperrt_grund` ab wie bei den
Anbindungen.

| Weg | Zweck |
| --- | --- |
| `GET /api/admin/adapter` | Liste mit Zustand, Speicherzustand und Fingerabdruck, Arten-Verzeichnis (Felder, Plätze) |
| `POST /api/admin/adapter` | anlegen (Art, Name, Einstellungen, Intervall); 201 mit der Ansicht |
| `GET /api/admin/adapter/{id}` | Ansicht mit Plätzen (gesetzt ja/nein), letzten Versuchen |
| `PATCH /api/admin/adapter/{id}` | Name, Einstellungen, Intervall, `lan_erlaubt`; CAS über `geaendert_at`, sonst 409 `Veraltet` |
| `PUT /api/admin/adapter/{id}/geheimnisse/{name}` | Geheimnis setzen oder ersetzen; 204 |
| `DELETE /api/admin/adapter/{id}/geheimnisse/{name}` | Geheimnis entfernen; 204 |
| `POST /api/admin/adapter/{id}/pruefen` | Verbindung prüfen; Ergebnis (Status, Fehlercode, Dauer, Anzahl), ändert den Zustand nicht |
| `POST /api/admin/adapter/{id}/anhalten`, `/fortsetzen` | Zustand wechseln |
| `DELETE /api/admin/adapter/{id}` | löschen samt Geheimnissen und Versuchen |

Statuscodes nach `src/AGENTS.md`: 400 für ein Feld (unbekannter Platz, zu lang, Intervall unter
dem Minimum der Art), 422 für Zustand (Speicher gesperrt, Art unbekannt), 409 für CAS.
Audit nach dem Commit je Schreibweg, mit neuen `AdminAktion`-Varianten (`adapter_angelegt`,
`adapter_geaendert`, `adapter_geloescht`, `adapter_geheimnis_gesetzt`,
`adapter_geheimnis_entfernt`, `adapter_lan_erlaubt`, `adapter_angehalten`,
`adapter_fortgesetzt`) und dem Umbau der CHECK-Liste per Migration (Muster 0350). Im Audit
stehen Adapter-ID, Art, Platzname und Host, nie Wert, Pfad oder Token.

### Admin-UI (Teil B)

- Auf `/admin/einstellungen/anbindungen` ein drittes Paneel **„Adapter“** unter den Zugängen,
  nur sichtbar, wenn das Arten-Verzeichnis nicht leer ist oder schon Adapter bestehen. Zeile:
  Name, Art, `Status` nur bei `gestoert`, `braucht_eingriff`, `aus`, `art_unbekannt`, dazu
  „zuletzt erfolgreich …“. Anlegen über `ErfassungsModal` (Art, Name, Felder der Art), danach
  Sprung in die Einzelansicht.
- **Einzelansicht** `einstellungen/anbindungen/adapter/:adapterId`: `BearbeitbaresPaneel` für
  Name, Intervall und die Einstellungsfelder; Paneel „Zustand“ als `Datenraster` wie
  `AnbindungWebhook` (Zustand, letzter Erfolg, letzter Fehler, nächster Versuch) mit den Aktionen
  „Verbindung prüfen“ (Ergebniszeile) und „Anhalten“/„Fortsetzen“; Paneel „Geheimnisse“ mit je
  Platz dem neuen Baustein **Geheimfeld**; LAN-Ausnahme als eigener Schalter mit Rückfrage.
- **Geheimfeld** (neuer Baustein, Entwurf mit `/design` und Karte im Design System nach
  `frontend/AGENTS.md`): zeigt „gesetzt am … von …“ oder „nicht gesetzt“, Aktion „Ersetzen“
  öffnet ein Passwortfeld, Speichern schickt den Wert und vergisst ihn. Nie ein Wert im
  Browser-Zustand nach dem Speichern, nie im Query-Cache.
- Speicher nicht `bereit`: `RechteHinweis`-artiger Kasten über dem Paneel („Geheimnisspeicher:
  Schlüssel fehlt“ bzw. „passt nicht“), Geheimfelder gesperrt.
- Query-Keys `globalKeys.adapter()`/`adapter(id)` registriert und als nicht live eingestuft,
  30-s-Abruf wie die Anbindungen; `LAGEBILD_OFFLINE`: nein. Mutationen `SOFORT_ODER_NIE`.
- Anwenderkapitel `docs/anwender/kapitel/anbindungen.md` bekommt den Abschnitt „Adapter“ samt
  `quellen:`; Bilder im Bildlauf mit dem Test-Adapter.

### Regeln und Doku

- **ADR-0076 „Geheimnisse und Abrufe der Adapter“** (`vorgeschlagen`): Geheimnisse nur
  verschlüsselt mit dem Schlüssel aus der Umgebung, nie über die API lesbar, nie im Log; Adapter
  rufen nur über den Rahmen ab (Client, Zielschutz, `http_begrenzt`); keine DB-Verbindung
  während eines Abrufs. Prüfung per `verbiete`/`verlange` (z. B. kein `chiffrat` außerhalb von
  `src/adapter/geheimnis.rs`, kein `client_builder(Zweck::Adapter)` außerhalb von
  `src/adapter/ziel.rs`).
- **`src/AGENTS.md`**, neuer Abschnitt „Adapter“: wie eine Art sich einhängt, Zwei-Phasen-Abruf,
  Fehlercodes statt Text, kein Geheimnis in Log/Audit (E2).
- **Architektur:** Kap. 5 (Baustein `src/adapter`), Kap. 6 (Ablauf eines Abrufs), Kap. 7
  (Umgebungsvariable, Speicherort, ausgehende Verbindung „Adapter“ in 7.6), Kap. 8 (neuer
  Abschnitt „Geheimnisse und Adapter“), Kap. 11 (R47: Verlust oder Diebstahl des
  Geheimnis-Schlüssels; R19 bleibt, betrifft aber Adapter-Geheimnisse nicht mehr).
- **Betrieb:** `docs/betrieb/env-registry.md` (neue Variable, maskiert),
  `docs/betrieb/backup-restore.md` (Schlüssel getrennt sichern, Wiederherstellen auf anderem
  Rechner).

## Einschränkungen und Risiken

- Schlüssel in der Umgebung ist so sicher wie der Prozess und sein Startskript; gegen einen
  DB-Diebstahl (R19) schützt er, gegen eine Übernahme des Servers nicht.
- Schlüssel verloren heißt alle Adapter-Geheimnisse neu setzen. Das ist gewollt einfacher als
  eine Wiederherstellung und steht in der Betriebsdoku.
- Ohne produktive Art ist Teil B in Produktion unsichtbar, bis Divera kommt. Bewusst: kein leeres
  Paneel.
- Ein Adapter, der lange gestört ist, ruft alle 15 min ab und bleibt `gestoert`; ohne
  Benachrichtigung sieht das nur, wer die Seite öffnet (Folgeaufgabe möglich).

## Tests

- Reine Funktionen: Backoff-Formel, Ableitung des Zustands, Einteilung der Fehler in
  vorübergehend und Eingriff.
- Geheimnisspeicher: Rundreise verschlüsseln/entschlüsseln; Zustand `fehlt`/`passt_nicht`;
  Antwort und Audit enthalten den Wert nie (Wächtertest sucht den Klartext in Antwort, Audit-Zeile
  und erfasstem Log).
- Lauf mit Test-Adapter und Netz-Ersatz: Erfolg, vorübergehender Fehler mit Wartezeit,
  401 → `braucht_eingriff`, Ersetzen des Geheimnisses macht wieder fällig, Probelauf übernimmt
  nichts und ändert den Zustand nicht, gekoppelter ELW läuft nicht.
- Routen: Org-Isolation (fremde ID 404), Rechte (Führungskraft liest, schreibt nicht), CAS 409,
  Statuscodes, Audit-Aktionen (`tests/admin_audit.rs`), Eingabegrenzen-Spiegel, Typ-Codegen.
- Teil B: Komponententests für Geheimfeld (Wert nach Speichern weg) und Paneel-Zustände; e2e
  nur über den Bildlauf.

## Dem Bauenden überlassen

- Form der IDs (wie `maschinenzugang`), genaue Namen der Rust-Typen nach LFH-1312.
- Ob `letzte_anzahl` und `anzahl` im Versuch nötig sind oder der erste echte Adapter sie bringt.
- Feinschnitt der Migrationen (eine für die Tabellen, eine für den Audit-Umbau).
