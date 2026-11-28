# Ausgang per Matrix an Externe Stellen (LLH-2094)

Zunder: https://zunder.rubeen.dev/#/aufgabe/ntaizaveziu8k9qzqu9tencu
(Unteraufgabe von LLH-1197; baut auf LLH-2093, Design-Doc
`docs/superpowers/specs/2026-11-24-w1ymakq6-ausgang-email-design.md`, PR #1711)

Stand: 25.11.2026, Entwurf. Abgestimmt am Phase-1-Checkpoint: Basis ist der E-Mail-Branch,
Ende-zu-Ende-Verschlüsselung über matrix-sdk, Adressen als Raum-ID oder Alias, Anmeldung per
Access-Token eines Bot-Kontos, Schlüsselspeicher über gepatchtes `matrix-sdk-sqlite` je
Anbindung.

## Absicht

Der E-Mail-Schnitt hat den Ausgangskorb gebaut: Ein Mensch löst aus, der Server stellt zu, jeder
Versand steht im ETB (ADR-0104). Matrix ist der zweite Kanal. Viele Leitstellen, Stäbe und
Behörden-Messenger (BwMessenger, TI-Messenger, eigene Synapse-Server der Hilfsorganisationen)
arbeiten in Matrix-Räumen, und diese Räume sind fast immer **verschlüsselt**. Ein Matrix-Ausgang
ohne E2EE erreichte genau diese Empfänger nicht. Deshalb kommt E2EE gleich mit.

Ein Lagebericht, ein Befehl oder eine Nachforderung landet damit als Nachricht im Lageraum der
Stelle, mit den PNG-Anlagen als Bilder, verschlüsselt wie jede andere Nachricht dort.

## Ziele

1. Eine Externe Stelle kann **Matrix-Räume** als Kanaladresse tragen (Raum-ID `!abc:server` oder
   Alias `#lage:server`), neben ihren Mailadressen.
2. Eine Organisation richtet ein **Matrix-Konto** als Anbindung ein (Art „Matrix“: Homeserver,
   Access-Token eines Bot-Kontos), mit „Verbindung prüfen“.
3. Der **Senden-Dialog** zeigt Mailadressen und Matrix-Räume zusammen; der Ausgangskorb stellt
   je Kanal über den passenden Weg zu.
4. Nachrichten in **verschlüsselte Räume** gehen verschlüsselt hinaus (Megolm über matrix-sdk);
   unverschlüsselte Räume bleiben möglich.
5. Wiederholung, Versandliste, ETB, „Erneut senden“, Spiegel, Schwärzung und Überholt-Prüfung
   gelten unverändert wie beim E-Mail-Schnitt.

## Nicht-Ziele

- Nutzer-IDs (`@person:server`) als Adresse, also Direktchats. Später möglich, braucht eine
  gespeicherte Zuordnung Person → Raum.
- Empfangen und Antworten: Der Bot liest keine Nachrichten, entschlüsselt keine Historie und
  reagiert auf nichts. Er sendet nur.
- Anmeldung mit Benutzer und Passwort, SSO oder OIDC-native Anmeldung (MSC3861) am Homeserver.
- Schlüssel-Backup (Online-Backup der Raumschlüssel), Secret Storage und Wiederherstellungsschlüssel:
  Ein reiner Sender braucht seine alten Raumschlüssel nicht.
- Fax (LLH-2095), Threema (LLH-2096), PDF.
- Matrix-Versand vom gekoppelten ELW (wie bei E-Mail: Geheimnisse fließen dort nicht hin).

## Anti-Ziele

- Eine Nachricht geht **unverschlüsselt** in einen Raum, der verschlüsselt ist. Kann der Bot
  nicht verschlüsseln, scheitert der Versand sichtbar.
- Eine Nachricht erscheint **doppelt** im Raum, weil ein Versuch wiederholt wurde.
- Das Access-Token oder Schlüsselmaterial steht in Log, Fehlertext, Antwort, ETB, Admin-Spur
  oder in einer Sicherung im Klartext.
- Der Server verbindet sich über matrix-sdk mit einem Ziel, das der Zielschutz ablehnen würde
  (auch nicht über `.well-known`, Weiterleitungen oder Medien-URLs).
- Der Bot tritt einem Raum bei, den niemand bewusst eingetragen hat.

## Ansätze

**Gewählt: matrix-sdk mit E2EE, Schlüsselspeicher je Anbindung als eigene SQLite-Datei**,
`matrix-sdk-sqlite` im Repo gepatcht.

`matrix-sdk-sqlite 0.20` (auch `main` am 25.11.2026) setzt `rusqlite 0.41` und damit
`libsqlite3-sys 0.39` voraus; wir nutzen über sqlx 0.9 `libsqlite3-sys 0.40`, und Cargo erlaubt
nur eine SQLite im Binary (`links = "sqlite3"`). Eine Probe (25.11.2026) zeigt: mit
`rusqlite 0.42` (`libsqlite3-sys 0.40`) kompiliert `matrix-sdk-sqlite` ohne weitere Änderung neben
sqlx, eine SQLite im Baum, kein `ring` (matrix-sdk mit `rustls-aws-lc-rs`), dasselbe reqwest 0.13.

Verworfen:
- **Ohne E2EE, nur unverschlüsselte Räume.** Klein und ohne große Abhängigkeit, erreicht aber
  die verschlüsselten Lageräume nicht, für die der Kanal gedacht ist (Entscheidung am Checkpoint).
- **Eigener `CryptoStore` über sqlx in der Hub-Datenbank.** Kein Patch und keine zweite Datei,
  aber Dutzende Methoden, und jede SDK-Hebung kann ihn brechen; das Speicherformat der Olm- und
  Megolm-Sitzungen ist Sache des SDK.
- **Nur `MemoryStore`.** Nach jedem Neustart wäre das Gerät des Bots ohne Schlüssel, während der
  Server seine alten Geräteschlüssel kennt; Empfänger sähen ein neues, unbekanntes Gerät oder
  gar keine entschlüsselbaren Nachrichten.
- **Eigener schlanker HTTP-Client ohne SDK** (wie der eigene SMTP-Client): für unverschlüsselte
  Räume ausreichend, für Olm/Megolm aber ein Nachbau von `matrix-sdk-crypto`.

## Entwurf

### 1. Abhängigkeit und Patch

- `matrix-sdk = { version = "=0.20.0", default-features = false, features = ["e2e-encryption",
  "sqlite", "rustls-aws-lc-rs", "markdown"] }`, fest gepinnt (wie `mdns-sd`), mit Kommentar im
  `Cargo.toml`: warum, welcher Patch, wann er fällt.
- `vendor/matrix-sdk-sqlite/`: unveränderte Kopie von `matrix-sdk-sqlite 0.20.0` bis auf die eine
  Zeile `rusqlite = "0.42"` und eine `PATCH.md` (was geändert, warum, Prüfweg „upstream hebt
  rusqlite → Kopie löschen“). Eingebunden über `[patch.crates-io]`.
- Lizenzen und Advisories nach `scripts/AGENTS.md`: matrix-sdk selbst ist Apache-2.0, der Baum
  enthält daneben MPL-2.0-Crates (zulässig, schon vorher im Baum; berichtigt 26.11.2026, vorher
  hieß es „Apache-2.0 durchgehend“); der Baum wächst um
  rund 370 Crates. Prüfen, dass `cargo deny` (bzw. das Advisory-Gate) grün bleibt und kein
  zweiter Crypto-Provider entsteht (`tls::tests::rcgen_pem_ist_per_rustls_ladbar`).
- Ein Wächtertest hält fest, dass im Lockfile genau ein `libsqlite3-sys` steht (der bestehende
  `tests/sqlite_version.rs` wird darum ergänzt oder daneben gestellt).

### 2. Kanal `matrix` freischalten

- `KanalArt::Matrix.is_freigeschaltet()` wird `true`. Tabelle und CHECK stehen seit 0382.
- **Adresse prüfen** (`externe_stelle::kanal::normalize_matrix`): getrimmt; entweder Raum-ID
  `!localpart:server` oder Alias `#localpart:server`, geprüft mit dem Parser von ruma
  (`OwnedRoomOrAliasId`); höchstens 255 Bytes (Grenze der Spec). Nutzer-IDs (`@…`) und
  `matrix.to`-Links werden mit eigenem Text abgelehnt („Nutzer-IDs gehen noch nicht, bitte den
  Raum eintragen“); ein `matrix.to`-Link auf einen Raum wird zur Adresse entpackt (Komfort, Dem
  Builder überlassen, ob es sich lohnt).
- Oberfläche der Stelle (`ExterneStelleKanaele.tsx`): „Adresse hinzufügen“ bekommt die Wahl
  E-Mail oder Matrix-Raum; die Liste zeigt den Kanal. Die Liste der Stellen zählt „2 Mail, 1
  Matrix“.

### 3. Anbindung „Matrix“ (Adapter-Art `matrix`)

- **Felder:** `homeserver` (URL, `https://`, über den bestehenden URL-Feldtyp mit Zielschutz),
  `anzeigename` (Text, optional, setzt den Anzeigenamen des Bots beim Prüfen).
- **Platz:** `access_token` (Pflicht). Ein geänderter Homeserver entfernt das Token, wie bei
  jeder URL (`has_neues_ziel`).
- Kein `.well-known`-Lookup: Der Admin trägt die Client-API-URL des Homeservers ein
  (`https://matrix.example.org`), nicht den Servernamen. Grund: Zielschutz und keine
  Weiterleitung auf ein zweites Ziel.
- Höchstens **eine Matrix-Anbindung je Org**, gezählt wie bei SMTP (422 bei einer zweiten).
- **Lauf = Verbindungsprüfung** (Intervall Minimum 15 min, Vorschlag 60 min, `OhneUebernahme`):
  `whoami` (Token gültig, Nutzer-ID und `device_id` lesen), Schlüsselspeicher öffnen und zum
  Gerät passend prüfen, Geräteschlüssel hochladen, falls noch nicht geschehen, ausstehende
  Schlüsselanfragen abarbeiten (ein `sync_once` mit engem Filter). Fehler nach den bestehenden
  `AdapterFehler`: 401/`M_UNKNOWN_TOKEN` → `abgelehnt`, Netz/DNS/Zeit/Zielschutz wie gehabt.
  Neu ist **ein** Fehlercode der Anbindung, `schluessel_passen_nicht` (Speicher gehört zu einem
  anderen Gerät oder fehlt, während der Server für dieses Gerät schon Schlüssel kennt); Text:
  „Schlüssel passen nicht zum Gerät des Tokens. Ein neues Access-Token anlegen.“ (Enum-Kontrakt,
  Texte im Frontend, Typ-Codegen.)
- **Cross-Signing:** Hat das Bot-Konto noch keine Cross-Signing-Schlüssel, versucht die Prüfung
  sie anzulegen und das eigene Gerät zu signieren. Synapse erlaubt das erste
  Hochladen ohne erneute Anmeldung (MSC3967); verlangt der Server sie doch, bleibt der Bot ohne
  Cross-Signing, und die Anbindung zeigt einen Hinweis (kein Fehler, kein Störungszustand).
  Folge in beiden Fällen: Empfänger sehen das Gerät des Bots als „nicht verifiziert“, bis sie es
  einmal verifizieren. Das ist in der Anwenderdoku beschrieben, nicht wegautomatisiert.
  *(Eigene Wahl im Entwurf; Begründung: Verifizierung braucht einen zweiten Menschen-Client, den
  der Hub nicht hat.)*

### 4. Schlüsselspeicher

- **Ein Verzeichnis je Anbindung**: `<datenverzeichnis>/matrix/<adapter_id>/` (neben der
  Datenbank, wie Karten-Cache und Cache-DB). `ClientBuilder::sqlite_store` legt dort mehrere
  Dateien an (Crypto-, State- und Event-Cache-Store); alle bleiben dauerhaft, damit nach einem
  Neustart kein voller Initial-Sync nötig ist. Angelegt beim ersten Prüfen. *(Eigene Wahl.)*
- **Verschlüsselt** mit der Passphrase-Funktion von `matrix-sdk-sqlite`. Sie verschlüsselt die
  Werte (Schlüsselmaterial, Inhalte), nicht die Tabellenstruktur. Die Passphrase ist ein
  zufälliger Wert, beim Anlegen der Anbindung erzeugt und als zweites Geheimnis der Anbindung
  (`speicher_passphrase`, nicht im Formular) im Geheimnisspeicher abgelegt. Ohne
  Geheimnisschlüssel des Servers ist das Schlüsselmaterial also nicht lesbar.
- **Nicht in der Sicherung.** Sicherungen enthalten nur die Hub-Datenbank (wie heute). Nach einem
  Restore oder Umzug fehlt die Datei; die Prüfung meldet `schluessel_passen_nicht`, und der Admin
  legt ein neues Access-Token an (neues Gerät). *(Eigene Wahl; Begründung: kein Schlüsselmaterial
  in Sicherungskopien, und ein reiner Sender verliert dabei nichts außer der Verifizierung des
  alten Geräts.)*
- **Neues Token** (Platz neu gesetzt) oder geänderter Homeserver: Das alte Verzeichnis wird gelöscht,
  bevor der neue angelegt wird; ebenso beim Löschen der Anbindung. Das alte Gerät wird beim
  Server nicht abgemeldet (dafür bräuchte es das alte Token, das schon weg ist); die Anwenderdoku
  nennt den Weg, alte Sitzungen im Bot-Konto aufzuräumen.
- Ein Speicher wird **nie gleichzeitig** von zwei Clients geöffnet: Je Anbindung hält der Prozess
  höchstens einen `matrix_sdk::Client`, hinter einer `tokio::sync::Mutex`; Prüflauf und
  Ausgangskorb teilen ihn. Der Client lebt im Prozess (lazy, je `adapter_id` und Token-Stand) und
  wird bei Änderung der Anbindung verworfen.
- Kein Datenbankpool des Hubs wird während Matrix-Netzverkehr gehalten (Regel des Ausgangskorbs).

### 5. Netz und Zielschutz

- matrix-sdk bekommt **unseren** `reqwest::Client` (`ClientBuilder::http_client`), gebaut wie in
  `adapter::ziel` mit dem filternden DNS-Resolver (`lan_erlaubt` der Anbindung), ohne
  Weiterleitungen, mit Zeitlimits (Verbindung 5 s, Anfrage 30 s, Upload 120 s).
  `homeserver_url` direkt, kein `server_name`-Discovery.
- Alle Anfragen gehen an den eingetragenen Homeserver (auch Medien-Upload). Föderation erledigt
  der Homeserver; der Hub spricht nie mit dem Server der Stelle.

### 6. Zustellen im Ausgangskorb (kanalneutral)

- **Zusteller wird kanalneutral.** Heute ist `ausgang::zusteller::Zusteller` auf SMTP zugeschnitten
  (`von`, `an`, Mailbytes, `SmtpFehler`). Er wird ein Trait mit einem Auftrag je Versand:
  ```text
  zustellen(&Versandauftrag) -> Result<Zustellt, Zustellfehler>
  Versandauftrag = { kanal-spezifischer Zugang, Adresse, Betreff, Inhalt, Anhänge, versand_id }
  Zustellfehler  = Voruebergehend | Abgelehnt | Ungewiss | Anbindung | KeinZutritt | Verschluesselung
                   (+ Einzelheit je Kanal für den ETB-Grund: SMTP-Code oder Matrix-errcode)
  ```
  Die Zuordnung `Zustellfehler → AusgangFehler`, Wiederholung, ETB und Abschluss bleiben im Lauf
  an **einer** Stelle. `SmtpZusteller` und `MatrixZusteller` sind die beiden Umsetzungen; das
  aufzeichnende Testdoppel nimmt beide Kanäle an. Dieser Umbau ist ein eigener erster Commit
  (`refactor`), damit Fax (LLH-2095) darauf aufsetzen kann; an LLH-2095 kommt ein Kommentar.
- **Zugang je Kanal:** `adapter::lauf::zugang_fuer_versand(pool, rahmen, org_id, kanal)` sucht die
  Anbindung der passenden Art (`smtp` für `email`, `matrix` für `matrix`). Ebenso
  `pruefe_versand_moeglich`. Anlegen prüft je Empfänger seinen Kanal: Fehlt für einen Kanal die
  Anbindung, ist es 422 mit Code (`anbindung_fehlt`), wie heute.
- **Ablauf je Matrix-Versand** (Lauf, ohne DB-Verbindung im Netzteil):
  1. Client der Anbindung holen (Mutex).
  2. Raum auflösen: Alias → Raum-ID (`resolve_room_alias`).
  3. Mitglied? Sonst beitreten, wenn eingeladen oder öffentlich (`join_room_by_id_or_alias`);
     scheitert das (403, nicht gefunden) → endgültig `kein_zutritt`.
  4. `sync_once` mit Filter auf diesen Raum (Mitglieder, Verschlüsselungszustand), damit das SDK
     die Geräte der Mitglieder kennt.
  5. Senden: Text als `m.text` mit `body` (Klartext-Markdown) und `formatted_body` (HTML aus dem
     Markdown, `RoomMessageEventContent::text_markdown`); danach jede PNG-Anlage als `m.image`
     (`send_attachment`, im verschlüsselten Raum als verschlüsselte Datei). Jede Nachricht trägt
     eine feste **Transaktions-ID** `ausgang-{versand_id}-{n}` (n = 0 für den Text, 1… für die
     Anlagen).
  6. Ist der Raum verschlüsselt, verschlüsselt das SDK für alle Geräte der Mitglieder, auch
     unverifizierte und nicht cross-signierte. Die Strategie wird **ausdrücklich** gesetzt
     (`CollectStrategy::AllDevices` bzw. der Name in 0.20), nicht der Vorgabe überlassen, die
     sich zwischen Versionen ändert. Grund: Der Bot verifiziert niemanden, und eine strengere
     Strategie erreichte in der Praxis niemanden. Jeder Abbruch beim Verschlüsseln oder Teilen
     der Raumschlüssel (Schlüssel fehlen, Speicher kaputt, SDK verweigert) → endgültig
     `verschluesselung`; **nie** Rückfall auf Klartext. *(Eigene Wahl.)*
- **Doppelte Nachrichten vermeiden, in zwei Stufen:**
  - **Gesendete Teile merken:** neue Tabelle `ausgang_teil` (`versand_id` FK ON DELETE CASCADE,
    `teil` INTEGER, `event_id` TEXT, `gesendet_at`; PK `(versand_id, teil)`; Schwärzung und
    Aufbewahrung wie `ausgang`, im Spiegel ausgenommen wie `ausgang`). Nach jedem gelungenen Teil
    (Text = 0, Anlage n) schreibt der Lauf die Event-ID; ein späterer Versuch oder „Erneut
    senden“ überspringt gesendete Teile. Ein Versand, dessen Text schon im Raum ist und dessen
    Anlage scheitert, sendet beim nächsten Versuch nur die fehlenden Anlagen. Das gilt auch
    Tage später und nach einem Token-Wechsel. *(Eigene Wahl.)*
  - **Transaktions-ID je Teil** für die Lücke zwischen Senden und Merken: Der Homeserver erkennt
    eine wiederholte Transaktions-ID desselben Geräts für eine begrenzte Zeit (Synapse rund
    24 h) und liefert die alte Event-ID zurück.
  - Deshalb ist ein abgebrochener Versuch bei Matrix **nicht ungewiss**, sondern vorübergehend
    und wird im Fenster automatisch wiederholt (anders als SMTP nach DATA). Ein Neustart mitten
    in der Zustellung (`versuch_begonnen_at`) bleibt aus Gleichbehandlung `ungewiss` für beide
    Kanäle; „Erneut senden“ sendet dann nur die nicht gemerkten Teile. *(Eigene Wahl: die
    Neustart-Regel nicht je Kanal aufzuspalten.)*
- **Fehlerzuordnung Matrix:** Netz, Zeit, DNS, 429 (`M_LIMIT_EXCEEDED`, mit `retry_after_ms` als
  Untergrenze), 5xx → vorübergehend; 401/`M_UNKNOWN_TOKEN` → `anbindung_fehler` (und Prüflauf
  vorziehen wie bei SMTP-Anmeldung); 403/`M_FORBIDDEN` beim Senden, Raum unbekannt →
  `kein_zutritt`; `M_TOO_LARGE` → `zu_gross`; Verschlüsselungsfehler → `verschluesselung`.
  *Berichtigt 28.11.2026 (LLH-2145):* `kein_zutritt` gilt nur für Auflösen, Beitreten, Sync und
  Mitgliederliste; 403/404 erst beim Senden (dabei verteilt das SDK auch Schlüssel) ist
  `abgelehnt`, 403/404 des eigenen `keys/query` ein verweigerter Schlüsselabgleich
  (`anbindung_fehler`, beim Prüfen `abgelehnt`). Sperre, Zustands-, Ereignis- und Medienspeicher
  und Datei-IO des SDK sind vorübergehend; ein Schlüsselspeicher, der nicht aufgeht, ist beim
  Prüfen `schluesselspeicher_unlesbar` (braucht Eingriff) statt „Antwort ungültig“.
- **Neue `AusgangFehler`-Codes:** `kein_zutritt` („Kein Zutritt zum Raum“) und
  `verschluesselung` („Verschlüsseln nicht möglich“), mit Enum-Kontrakt, Texten im Frontend und
  Typ-Codegen. Das Wire-Feld `smtp_status` bleibt (Grenzwert); für Matrix bleibt es leer, der
  Grund steht im ETB-Text.
- **Größe:** Anlagen je Datei höchstens so groß, wie der Homeserver erlaubt
  (`/_matrix/client/v1/media/config`, beim Prüfen gelesen und an der Anbindung gemerkt); die
  20-MiB-Summe des E-Mail-Schnitts gilt weiter.

### 7. Nachricht

- Text wie beim E-Mail-Schnitt aus dem **Schnappschuss** (`betreff`, `inhalt`), damit
  Mail und Matrix dasselbe Dokument tragen: erste Zeile fett der Betreff, dann der Inhalt, dann
  der Fuß („Gesendet mit Lifeline Hub“, Einsatz, absendende Person, Uhrzeit).
- Markdown wird als HTML (`formatted_body`) mitgeschickt; `body` trägt den Klartext, den Clients
  ohne HTML zeigen. Das HTML wird aus dem eigenen Markdown erzeugt und enthält keine Links oder
  Bilder aus Fremdinhalt (der Inhalt stammt aus freigegebenen Dokumenten). *Berichtigt
  26.11.2026:* `RoomMessageEventContent::text_markdown` maskiert HTML **nicht**; der Zusteller
  maskiert deshalb selbst jedes ASCII-Satzzeichen mit einem CommonMark-Backslash, ein Einzug am
  Zeilenanfang wird zu U+00A0 (kein Codeblock), und der Rückfall ohne Markdown ist der
  HTML-maskierte Klartext (`src/ausgang/zusteller/matrix.rs`, Regel in `src/AGENTS.md`,
  „Ausgang an Menschen“).
- Anlagen: `anlage-{n}.png` als `m.image` mit Größe und Abmessungen.

### 8. Oberfläche

- **Senden-Dialog:** eine Liste je Stelle mit allen freigeschalteten Adressen (Mail und Matrix,
  Kanal als kleines Zeichen davor). Vorbelegt werden die Stellen wie heute (aus Verteiler bzw.
  Adressat), aber je Stelle nur **eine** Adresse: die erste Matrix-Adresse, sonst die erste
  Mailadresse. *(Eigene Wahl: ein Lagebericht soll nicht ungefragt doppelt, per Mail und
  Matrix, bei derselben Stelle landen; wo ein Lageraum existiert, ist er der schnellere Weg.)* Gesperrt mit Grund je Kanal („Kein Matrix-Konto
  eingerichtet“), statt den ganzen Dialog zu sperren.
- **Versandliste:** Kanal je Zeile sichtbar; Matrix-Zeile zeigt den Raum (Alias, sonst die
  Raum-ID gekürzt).
- **Anbindungen:** Art „Matrix“ im bestehenden Paneel, mit dem Hinweis zur Verifizierung und
  dem Gerät (`device_id`) des Bots, damit Empfänger es zuordnen können. (Die Abruf-Angaben, die
  für Versand-Anbindungen nicht passen, behebt LLH-2126 für beide Arten.)
- Texte nach `frontend/AGENTS.md`.

### 9. Regel, Entscheidung, Doku

- **ADR-0107** (neu, präzisiert ADR-0104 und ADR-0105): Der Ausgangskorb ist kanalneutral;
  Matrix mit E2EE; Speicherverzeichnis je Anbindung außerhalb der Hub-Datenbank und außerhalb der
  Sicherung. **ADR-0108** (neu, Nachtrag zu ADR-0002): `rusqlite` nur transitiv über
  `vendor/matrix-sdk-sqlite` für den Speicher des SDK. Beide stehen auf `vorgeschlagen`, bis der
  Mensch sie akzeptiert. Eine akzeptierte ADR ist unveränderlich (`docs/architektur/AGENTS.md`,
  „Entscheidungen“); ADR-0104 und ADR-0002 bleiben deshalb unberührt (Muster ADR-0098 zu
  ADR-0077).
- **`src/AGENTS.md`, „Ausgang an Menschen“:** kanalneutraler Zusteller; je Kanal genau eine
  Anbindung je Org; Matrix-Client nur über `adapter::matrix` mit unserem reqwest-Client; nie
  Klartext in einen verschlüsselten Raum; Speicherverzeichnis nie in Sicherung und nie
  von zwei Clients gleichzeitig.
- `docs/architektur`: Bausteinsicht (neuer Baustein `adapter::matrix`), Verteilungssicht
  (Verzeichnis `matrix/`), Laufzeitsicht „Versand“ um Matrix ergänzen.
- `docs/betrieb`: Datenverzeichnis nennt `matrix/`; Restore-Hinweis (neues Token).
- `docs/anwender`: Anbindungen (Matrix einrichten: Bot-Konto anlegen, Token holen, in die Räume
  einladen, Gerät verifizieren), Stammdaten (Matrix-Raum eintragen), Senden.

## Testbarkeit

- **Ohne echten Homeserver:** `MatrixZusteller` hinter dem kanalneutralen Trait; Lauf-Tests mit
  dem Doppel (Fehlerzuordnung, Wiederholung, kein `ungewiss` bei Matrix-Abbruch, `kein_zutritt`,
  `verschluesselung`).
- **Der echte Client gegen einen nachgebauten Homeserver** (derselbe `MatrixMockServer`): `whoami`, Alias auflösen, Beitreten, Senden in einen
  **unverschlüsselten** Raum mit Transaktions-ID, Wiederholung mit derselben ID, 429, 401.
- **E2EE wirklich prüfen:** Ein Test, der zwei SDK-Clients gegen einen echten Homeserver laufen
  lässt, ist in CI nicht verfügbar. Stattdessen: `matrix_sdk::test_utils::mocks::MatrixMockServer`
  (Feature `testing` von matrix-sdk, nur als Dev-Abhängigkeit, baut auf `wiremock`), in dem der
  Bot in einen verschlüsselten Raum sendet und die gesendete Nachricht `m.room.encrypted` ist
  (nie `m.room.message`). Lässt sich `keys/query`/`keys/claim` damit nicht schlank nachbauen,
  prüft der Test mindestens, dass in einen verschlüsselten Raum nie `m.room.message` geht (der
  Versand scheitert dann mit `verschluesselung`). Ob das reicht, entscheidet der erste
  Plan-Schritt per Spike. Eine Handprobe gegen einen echten
  Synapse mit Element als Empfänger gehört in die PR-Beschreibung.
- Speicher: Passphrase falsch → Fehler, nie Klartext; neues Token löscht die alte Datei;
  zwei Zugriffe auf dieselbe Anbindung laufen nacheinander.
- Adresse: Raum-ID, Alias, Nutzer-ID abgelehnt, zu lang, Leerraum.
- e2e: Matrix-Raum an einer Stelle eintragen, Senden, Versandliste „übergeben“ (Testdoppel).

## Dem Builder überlassen

- Modulschnitt (`adapter::matrix`, `adapter::matrix_art`, Zusteller-Dateien), Funktionsnamen.
- Genaue Filter für `sync_once`, solange nur der Zielraum geladen wird.
- Ob `matrix.to`-Links entpackt werden.
- Wortlaut der Texte und Hinweise.
