# Design

## Context

Stand `alpha` 894781c9. Der Passwort-Login (`routes::auth::login`) reicht `req.benutzername` roh an
`provider::password::anmelden`, das exakt sucht (`WHERE benutzername = ? AND aktiv = 1`); die Spalte
ist `TEXT NOT NULL UNIQUE` mit BINARY-Vergleich (`migrations/0002_auth.sql`). Die Anlage
(`routes::benutzer::anlegen`) trimmt, der Login nicht. Der Err-Arm von `login` zählt jeden Fehler
als Fehlversuch (`rate_limit::fehlversuch(ip, Some(name))`) und schreibt `login_fehlgeschlagen`
mit dem rohen Namen; `passwort_aendern` unterscheidet bereits `Unauthorized` von anderen Fehlern.
Seit LFH-793 ordnet `rate_limit` Fehlversuche einem Konto zu (`konto(benutzername)` als Hash), und
ein Erfolg räumt nur die Versuche gegen dieses Konto. Anlage hasht synchron im Handler,
`passwort_aendern` per `spawn_blocking`, beide außerhalb des `KDF_GATE`. Die höchste Migration auf
`alpha` ist `0149`. Benutzernamen ändern lässt sich heute nicht über die API (PATCH lässt
`benutzername` bewusst aus).

## Goals / Non-Goals

**Goals:**
- Eine einzige Vorverarbeitung des Benutzernamens für alle Eingänge, die einen Namen von außen
  annehmen (Login, Passkey-Start mit Namen, Anlage).
- Vergleich und Eindeutigkeit ohne Groß-/Kleinschreibung, durchgesetzt in der Datenbank.
- Fehlversuchszählung nur für echte Fehlversuche.

**Non-Goals:**
- Umbenennen von Benutzern über die Oberfläche (gibt es nicht; bleibt so).
- Unicode-Faltung (`Ä`/`ä`), s. Entscheidung 1.
- Sperre je Konto, IP-Granularität (LFH-793, LFH-866 erledigt bzw. eigene Tickets).
- Längengrenze für SSO-Namen aus `preferred_username`: SSO-Konten melden sich nicht per Passwort
  an.

## Decisions

### 1. Vergleich ohne Groß-/Kleinschreibung über SQLite `NOCASE` (zur Freigabe)

Gewählt: Gespeichert wird die Schreibweise wie angelegt; gesucht wird mit
`WHERE benutzername = ? COLLATE NOCASE`, ein zusätzlicher eindeutiger Index
`benutzer(benutzername COLLATE NOCASE)` macht die Eindeutigkeit zur Datenbankregel. `NOCASE` faltet
nur A–Z.

Alternativen:
- **Groß-/Kleinschreibung bleibt relevant**, nur Trim und Tastatur-Attribute im Frontend. Keine
  Migration, aber Tablets mit Hardwaretastatur, die Hülle und Skripte bleiben empfindlich, und
  `Admin`/`admin` können als zwei Konten nebeneinander stehen. Verworfen.
- **Alles kleinschreiben** beim Anlegen und per Migration. Ändert sichtbare Namen bestehender
  Konten und bricht Skripte, die die alte Schreibweise senden. Verworfen.
- **Unicode-Faltung in Rust** (`to_lowercase`) mit einer zweiten, normalisierten Spalte. Mehr Code
  und eine zweite Wahrheit für einen Fall (Umlaute in Benutzernamen), der bei uns kaum vorkommt;
  SSO-Namen sind schon auf `[a-z0-9._-]` normiert. Verworfen; `Ä` und `ä` bleiben zwei Namen.

### 2. Ein Modul für den Benutzernamen

Neues `src/auth/benutzername.rs` mit `MAX_LAENGE = 128`, `normalisiere(&str) -> Result<&str,
AppError>` (Trim, dann Länge in Zeichen prüfen; 400 „Benutzername ist zu lang“, leer bleibt Sache
von `pflicht` bzw. führt beim Login zu 401 wie ein unbekannter Name) und `fuer_protokoll(&str) ->
Cow<str>` (64 Zeichen plus „…“). Erst trimmen, dann prüfen: angehängte Leerzeichen zählen nicht
zur Länge. Die Prüfung läuft im Handler als erster Schritt nach dem Body, also vor Sperrprüfung,
Audit und Log; ein überlanger Name verlässt den Handler nie.

`audit::schreibe` kürzt selbst über `fuer_protokoll`, damit kein künftiger Aufrufer die Grenze
vergisst. Log-Felder der Anmeldung nutzen dieselbe Funktion; der 429-Zweig nennt den Namen gar
nicht mehr.

### 3. Fehlversuche je Konto ohne Schreibweise

`rate_limit::konto` hasht `benutzername.to_ascii_lowercase()`. So räumt ein Erfolg als `max` die
Fehlversuche, die dieselbe Quelle als `Max` gemacht hat, im Einklang mit `NOCASE`. `erfolg` und
`fehlversuch` bleiben in der Signatur gleich.

### 4. Nur 401 zählt

Der Err-Arm von `login` folgt `passwort_aendern`: `Err(AppError::Unauthorized)` zählt, loggt
gekürzt, schreibt `login_fehlgeschlagen` und gibt 401; `Err(e)` geht unverändert durch. Damit
bleibt 503 (Andrang, Wartefrist) ohne Zählung und ohne Audit.

### 5. `hash_gedrosselt` teilt sich die Schranken mit dem Login

`provider::password` bekommt eine private `platz_holen(&Schranken)`, die Andrang und KDF-Platz
mit Wartefrist erwirbt (bisher inline in `anmelden_mit_schranken`). `hash_gedrosselt(pw)` und
`hash_gedrosselt_mit_schranken(pw, &Schranken)` (Tests) holen einen Platz und hashen per
`spawn_blocking`, der Platz liegt in der Closure. Andrang mitzunehmen ist Absicht: ein wartender
Hash hält ebenso einen Zulassungsplatz. `benutzer::anlegen` und `passwort_aendern` rufen nur noch
`hash_gedrosselt`. Synchrone Aufrufe von `password::hash` bleiben in `bootstrap.rs`,
`dev/seed.rs` und Tests.

### 6. Body-Limits

`DefaultBodyLimit::max(4 * 1024)` auf `/api/auth/login` und `/api/auth/webauthn/auth/start`;
`16 * 1024` auf die beiden Passkey-`finish`. Der discoverable Start liest keinen Body und braucht
keine Grenze.

Damit jedes setzbare Passwort in die 4 KiB passt, bekommt `pruefe_passwort_laenge` eine
Höchstlänge von 128 Zeichen: JSON-escaped (Surrogatpaar, 12 Byte je Zeichen) sind das höchstens
1536 Byte, ebenso viel für einen 128 Zeichen langen Namen. Ohne die Grenze ließe sich bei Anlage
oder Wechsel ein Passwort setzen, mit dem sich niemand mehr anmelden kann; einen Admin-Reset
gibt es nicht. Ein
Assertion-Body (authenticatorData, clientDataJSON, Signatur, userHandle in base64url) liegt meist
unter 2 KiB, kann mit Erweiterungen aber darüber gehen; 16 KiB lässt Luft und deckelt trotzdem.
Die Rejection läuft durch `JsonBody` und kommt wie jeder unlesbare Body als 400 im
`{error}`-Format („Anfrage-Body konnte nicht gelesen werden.“); `AppError` kennt kein 413, und
`src/extract.rs` hält diese Ungenauigkeit bewusst.

### 7. Migration `0150_benutzername_nocase.sql`

Zuerst eine Prüfung, die bei Kollision mit klarer Meldung abbricht: eine temporäre Tabelle mit
einem `BEFORE INSERT`-Trigger, der `RAISE(ABORT, 'Benutzernamen kollidieren ohne Groß-/Kleinschreibung …')`
wirft, wenn die eingefügte Anzahl doppelter Namen (gruppiert mit `COLLATE NOCASE`, derselben
Kollation wie der Index) größer als 0 ist. Danach
`CREATE UNIQUE INDEX idx_benutzer_benutzername_nocase ON benutzer(benutzername COLLATE NOCASE)`.
Die bestehende BINARY-UNIQUE-Einschränkung bleibt (Tabellenumbau nur dafür lohnt nicht).
Ohne die Vorprüfung käme nur SQLites „UNIQUE constraint failed: index …“, das den Betreiber
ratlos lässt.

### 8. SSO-Provisionierung

`plane_benutzername` bekommt die vergebenen Namen kleingeschrieben und prüft den Kandidaten
kleingeschrieben. Kandidaten sind schon auf `[a-z0-9._-]` normiert, deshalb genügt ASCII.

### 9. Login-Seite

`<Input … autoCapitalize="none" autoCorrect="off" spellCheck={false} />` und
`login(werte.benutzername.trim(), werte.passwort)`. Die Passkey-Anmeldung der Seite ist
discoverable und schickt keinen Namen; dort ist nichts zu tun.

## Risks / Trade-offs

- [Eine Installation hat schon `max` und `Max`] → Die Migration bricht den Start ab. Die Meldung
  nennt das Problem; Umbenennen geht nur per SQL. Für die Hauptinstallation vor dem Merge mit
  `SELECT lower(benutzername), count(*) FROM benutzer GROUP BY 1 HAVING count(*) > 1` prüfen.
- [Ein bestehender Name ist länger als 128 Zeichen] → Dieses Konto kann sich nicht mehr per Passwort
  anmelden. Praktisch ausgeschlossen (Anlage per Formular, Gerätekonten haben 39 Zeichen); die
  Abfrage oben um `max(length(benutzername))` ergänzen.
- [Umlaute werden nicht gefaltet] → `Jürgen` und `jürgen` bleiben zwei Namen und der Login als
  `jürgen` findet `Jürgen` nicht. Akzeptiert (Entscheidung 1).
- [Body-Limit zu knapp für einen Passkey] → 16 KiB auf `finish`; ein Test belegt, dass 6 KiB nicht an
  der Größe scheitern.
- [Weitere öffentliche POSTs mit `JsonBody` (`/api/auth/totp/finish`, `/api/auth/app-code/einloesen`,
  `/api/geraete/koppeln`) behalten axums 2 MiB] → Sie schreiben keinen Namen in Audit oder Log;
  eigener Nachzug auf dem Board.
- [`LIFELINE_ADMIN_USER` mit Randleerzeichen] → `bootstrap_admin` normalisiert ebenfalls und bricht
  bei leerem oder überlangem Namen den Start ab.
- [Dev-Seed-Upsert und `= ?`-Suchen in `dev/seed.rs`] → feste, kleingeschriebene Namen, kein Eingang
  von außen; die Regel in `src/AGENTS.md` gilt für Namen von außen.

## Migration Plan

Die Migration läuft beim Start. Rollback: Index `idx_benutzer_benutzername_nocase` löschen; der
Code sucht dann weiter mit `COLLATE NOCASE` (Volltabellenscan, bei wenigen hundert Benutzern
unerheblich), die Eindeutigkeit ohne Schreibweise fehlt bis zur nächsten Version.
