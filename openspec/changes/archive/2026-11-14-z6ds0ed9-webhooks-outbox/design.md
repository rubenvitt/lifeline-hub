# Design

## Context

Motivation und Umfang: proposal.md. Anforderungen: `specs/webhook-zustellung/spec.md` und die
Änderung an `specs/maschinenzugang/spec.md`. Abgestimmt mit Ruben am 13.11.2026: ein Webhook je
Zugang, LAN-Ausnahme jetzt, Wiederaufnahme mit Nachliefern, Testzustellung, letzter Fehler und
Verlauf.

Was im Code steht und den Weg bestimmt (Stand `origin/alpha`, `97933469`):

- **Outbox** `maschine_ereignis` (Migrationen 0344, 0345, ADR-0038). Sie hat eine fortlaufende
  `id` (Cursor), `zugang_id`, `type`, `occurred_at` und `einsatz_id`, dazu einen Index
  `(zugang_id, id)`. Die Löschgrenze steht in `maschine_ereignis_stand.purged_until`, der
  Höchststand in `sqlite_sequence`. `lage.changed` wird verdichtet: eine neue Zeile ersetzt die
  alte und bekommt eine höhere Nummer. Rust liest und löscht nur (`public_api::events`).
- **Lesen** in `public_api::events`: `stand()`, `sichtbare_arten()` und `seite()` sind privat.
  `lesen()` liefert `ApiError` und ist auf den Abruf zugeschnitten.
- **Zugang** (`public_api::zugang::Zugang`): `scopes`, `zustand` (`wartet|aktiv|widerrufen`),
  `gueltig_bis`. Die Admin-Routen liegen in `routes::anbindungen` (`AdminUser` schreibt,
  `darf_admin_bereich` liest), die DTOs in `AnbindungAnzeige`.
- **Signatur** in `instanz::signatur`: kompaktes JWS mit EdDSA, selbst geschrieben, Profile
  `INSTANZ` und `MACHINE`, `sign()`/`verify()` generisch über Claims. Der Instanzschlüssel kommt
  aus `instanz::identitaet` (in der DB, die Sicherung nimmt ihn mit). Das Fremdsystem bekommt den
  öffentlichen Schlüssel beim Einlösen; `GET /api/v1/instanz/jwks.json` liefert ihn ebenfalls.
- **Ausgehend:** `ausgehend::client_builder(Zweck)` setzt nur den User-Agent. Ein Wächter
  verbietet `reqwest::Client::builder()` außerhalb davon. `http_begrenzt::lies_begrenzt` liest
  einen Rumpf mit Deckel.
- **Ziel-Schutz:** `karte::download::ip_ist_intern` und `karte::proxy::SichererResolver`
  (pinnend und fail-closed). Beide kennen keine LAN-Ausnahme und keinen Multicast. Kein Client
  setzt `.no_proxy()`; mit gesetztem `HTTPS_PROXY` löste der Resolver nur den Proxy auf und
  prüfte das Ziel nie.
- **LAN-Ausnahme:** LLH-1632 (Adapter-Rahmen) ist noch nicht gebaut. Es gibt kein Vorbild, diese
  Change legt das Muster an.
- **Hintergrundläufe:** `backup::scheduler` (watch-Stopp, `catch_unwind`, `auf_ende_warten`)
  ist das Muster mit sauberem Ende, verdrahtet in `main.rs` (`herunterfahren`).
- **Admin-Spur:** `auth::admin_audit::schreibe` nach dem Commit. Jede neue Aktion braucht eine
  Variante und einen Neubau des CHECK (zuletzt 0340).
- **Referenz-Clients:** `crates/lifeline-machine-client` (erzeugt die Vektoren),
  `docs/api/clients/typescript/machineClient.ts`, `docs/api/clients/python/machine_client.py`,
  Vektoren in `docs/api/machine-auth-testvektoren.json`, geprüft von Server, Crate,
  `frontend/src/api/machineClient.vektoren.test.ts` und `scripts/check-api-clients.sh`.
- Höchste Migration: 0345.

## Goals / Non-Goals

**Goals:**

- Ein Empfänger bekommt jedes Ereignis seines Zugangs innerhalb der Aufbewahrung, in Reihenfolge,
  mindestens einmal.
- Die Signatur ist ohne geteiltes Geheimnis prüfbar und an genau einen Empfänger gebunden.
- Kein Webhook öffnet einen Weg in interne Netze, auch nicht über DNS, Weiterleitung oder Proxy.
- Ein Admin sieht ohne Log-Zugriff, ob und warum die Zustellung hängt.

**Non-Goals:**

- Mehrere Webhooks je Zugang (bewusst eins, Entscheidung 13.11.2026).
- Neue Ereignisarten oder Änderungen an Outbox, Triggern und Abruf.
- Exakt-einmal-Zustellung. Der Empfänger entdoppelt über `id`.
- Zertifikats-Pinning oder eigene Vertrauensanker für LAN-Ziele (Risiken).
- Der Adapter-Rahmen LLH-1632 selbst. Er übernimmt später das Muster aus D5.

## Decisions

### D1: Zwei Tabellen, eine Zeile je Zugang

```sql
CREATE TABLE maschine_webhook (
    id                   TEXT PRIMARY KEY,               -- UUID, zugleich `aud`
    zugang_id            TEXT NOT NULL UNIQUE
                         REFERENCES maschinenzugang(id) ON DELETE CASCADE,
    url                  TEXT NOT NULL,
    arten                TEXT NOT NULL,                  -- JSON-Liste der Wire-Werte
    lan_erlaubt          INTEGER NOT NULL DEFAULT 0 CHECK (lan_erlaubt IN (0, 1)),
    zustand              TEXT NOT NULL DEFAULT 'aktiv' CHECK (zustand IN ('aktiv', 'angehalten')),
    cursor               INTEGER NOT NULL,               -- letzte zugestellte oder übersprungene Nummer
    offen_id             INTEGER,                        -- Nummer des wartenden Ereignisses
    fehler_seit          TEXT,                           -- erster Fehlschlag der laufenden Störung
    fehlversuche         INTEGER NOT NULL DEFAULT 0,
    naechster_versuch_at TEXT,
    letzter_fehler_at    TEXT,
    letzter_fehler_status INTEGER,
    letzter_fehler_art   TEXT,                           -- Code aus D6, kein Freitext des Ziels
    letzter_erfolg_at    TEXT,
    angehalten_at        TEXT,
    verlust_at           TEXT,                           -- Rückstand vor der Zustellung gelöscht
    angelegt_at          TEXT NOT NULL DEFAULT (datetime('now')),
    geaendert_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE maschine_webhook_versuch (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    webhook_id  TEXT NOT NULL REFERENCES maschine_webhook(id) ON DELETE CASCADE,
    at          TEXT NOT NULL,
    ereignis_id INTEGER,                                 -- NULL beim Testereignis
    test        INTEGER NOT NULL DEFAULT 0,
    status      INTEGER,                                 -- HTTP-Status, NULL bei Netzfehler
    fehler_art  TEXT,                                    -- NULL bei Erfolg
    dauer_ms    INTEGER NOT NULL
);
CREATE INDEX idx_maschine_webhook_versuch ON maschine_webhook_versuch (webhook_id, id);
```

- `UNIQUE (zugang_id)` trägt „höchstens ein Webhook je Zugang“. Ein zweites Anlegen ergibt `409`.
- „Fehler“ ist kein eigener Zustand, sondern `zustand = 'aktiv'` mit `fehler_seit`. „Ruht“ wird
  aus dem Zugang abgeleitet (D3). So gibt es nur einen Übergang, den der Lauf schreibt
  (`aktiv → angehalten`), und einen, den der Admin schreibt (`angehalten → aktiv`).
- Beim Anlegen steht `cursor` auf dem Höchststand der Outbox: Ein neuer Webhook liefert, was
  danach entsteht, wie ein Abruf ohne `after`.
- Der Verlauf hält je Webhook die letzten 50 Versuche. Wer einen Versuch einfügt, löscht in
  derselben Transaktion die älteren. Ein eigener Purge-Schritt ist nicht nötig.
- Nach ADR-0038 bleibt `maschine_ereignis` unberührt.

Alternativen: Spalten am `maschinenzugang` (mischt Anmeldung und Zustellung, und der CAS des
Zugangs bräche bei jedem Zustellversuch); ein Abo mit eigener Ereignistabelle (doppelter Bestand,
widerspricht „zweiter Leser derselben Outbox“).

### D2: Gelesen wird die nächste fällige Zeile, nicht eine Seite

Neu in `public_api::events`: `pub(crate) async fn naechstes(pool, zugang_id, arten, after) ->
Result<Naechstes, sqlx::Error>` mit `Naechstes::{Ereignis(Event), Leer, Verloren { head }}`, in
einer Lesetransaktion wie `lesen_ab`. Die Abfrage nutzt den Index `(zugang_id, id)`:
`… WHERE zugang_id = ? AND id > ? AND id <= head AND type IN (…) ORDER BY id LIMIT 1`.

- `arten` ist die Schnittmenge aus der Auswahl des Webhooks und `sichtbare_arten(scopes)`.
  `sichtbare_arten` wird dafür `pub(crate)`.
- Der Lauf liest vor jedem Versuch neu und merkt sich die Nummer nicht. Ersetzt ein neues
  `lage.changed` das wartende, gilt beim nächsten Versuch das neue.
- **Über ein zuzustellendes Ereignis rückt der Cursor nur bei Erfolg vor.** Liefert
  `naechstes` nichts, nennt es die höchste eigene Zeile dazwischen (`uebersprungen_bis`, nicht
  gewählte oder nicht erlaubte Arten); der Webhook rückt darüber hinweg, damit eine später
  gewählte Art nicht rückwirkend kommt (Spec „Nicht gewählte Art“). Geschrieben wird nur, wenn
  es eigene übersprungene Zeilen gibt; ein ruhiger Webhook schreibt nie. (Nachgezogen aus dem
  Review: zuerst rückte der Cursor nur bei Erfolg vor.)
- **Verlust erkennen:** Ein ruhiger Webhook hat oft `cursor < purged_until`, ohne dass ihm etwas
  fehlt; gelesen wird ohnehin nur `id > cursor`. Verlust liegt nur vor, wenn das Ereignis, das
  beim letzten Blick fällig war und nicht zugestellt werden konnte (`offen_id`), inzwischen unter
  der Löschgrenze liegt (`offen_id <= purged_until`). Dann `Verloren`: Der Lauf setzt `cursor` auf
  `head`, setzt `verlust_at` und löscht `offen_id`. (Umgesetzt mit der Nummer statt eines
  Zeitpunkts `offen_seit`, wie zuerst entworfen: Ein Zeitpunkt meldete auch dann Verlust, wenn
  nur Zeilen anderer Zugänge gelöscht wurden.)
- `offen_id` wird gesetzt, sobald der Lauf ein fälliges Ereignis findet, das er nicht zustellen
  kann (Fehlschlag, ruhend), und nur, wenn es noch leer ist. Ein Erfolg und ein leeres Ergebnis
  löschen es. Ein ersetztes `lage.changed`, dessen alte Nummer später gelöscht wird, gilt dabei
  als Verlust; das ist nur nach mehr als sieben Tagen Störung möglich und hingenommen.

Alternative: den Cursor auch im Leerlauf auf den Höchststand ziehen. Dann gäbe es eine
Schreibzeile je Takt und Webhook, sobald irgendwo ein Ereignis entsteht.

### D3: Ein Lauf, Takt 2 s, je Webhook der Reihe nach

`public_api::webhook::lauf::start(pool, stopp) -> JoinHandle`, nach dem Muster von
`backup::scheduler`: `tokio::select! { biased; stopp…, ticker.tick() }`, `catch_unwind` je
Belieferung. Beim Stopp schließt der Lauf die Plätze (keine neue Zustellung) und wartet auf die
laufenden; `main::herunterfahren` wartet darauf höchstens 20 s.

Je Takt:

1. Webhooks laden mit `zustand = 'aktiv'` und `naechster_versuch_at IS NULL OR <= jetzt`, ohne
   die, die gerade beliefert werden. Der Takt wartet nicht auf die Belieferungen: Ein langsames
   Ziel hält die übrigen nicht auf.
2. **Vor jedem Versuch** werden Webhook und Zugang neu gelesen: Ein Widerruf, ein entzogenes
   Recht, ein neues Ziel oder das Entfernen wirken ab dem nächsten Ereignis. Darf der Zugang nicht
   beliefert werden (nicht `aktiv`, abgelaufen, ohne `events:read`), ruht der Webhook: Über ein
   zuzustellendes Ereignis rückt der Cursor nicht vor, und `offen_id` wird gesetzt. Über nicht
   gewählte Arten und ein gelöschtes Ereignis rückt er auch dann (ADR-0046).
3. Je Webhook höchstens 50 Ereignisse nacheinander, dann der nächste Takt.
4. Bis zu 8 Webhooks gleichzeitig (Semaphore über alle Takte), je Webhook streng nacheinander.
5. Während der HTTP-Anfrage hält der Lauf keine Datenbankverbindung. Das Ergebnis schreibt er
   danach in einer Transaktion, **nur auf dem Stand, mit dem der Versuch begann**
   (`geaendert_at`); sonst steht der Versuch nur im Verlauf, und das Ereignis kommt erneut.
6. Jeder Versuch rechnet mit seiner eigenen Zeit (Signatur, Verlauf, Backoff), nicht mit der des
   Takts. Ein leerer Blick oder ein Verlust beendet auch die Störung (`fehler_seit`).

(Punkte 1, 2, 5 und 6 nachgezogen aus dem Review vor dem PR.)

Der Takt von 2 s bestimmt die Verzögerung bis zur Zustellung. Ein Wecken beim Commit gibt es
nicht, aus demselben Grund wie beim Abruf (LLH-1655, D9).

Alternative: ein Task je Webhook. Mehr bewegliche Teile beim Anlegen und Entfernen, und der Takt
müsste trotzdem die Datenbank fragen.

### D4: Signatur als drittes Profil

In `instanz::signatur`:

- `pub const EVENT_TYP: &str = "lifeline-event+jwt"`, Kopfname `Lifeline-Signature` wie bei
  `MACHINE`.
- Claims `WebhookClaims { iss, aud, iat, exp, jti, bh }`. `iss` ist die Instanzkennung (zugleich
  `kid`), `aud` die Webhook-ID und `exp = iat + 300` (höchstens 5 min, Konzept D4).
- `sign_webhook(identitaet, aud, body, jetzt)` und `verify_webhook(token, instanz_pk, aud, body,
  jetzt)`. Die Prüfung ist dieselbe Strenge wie bei den anderen Profilen: nur `EdDSA`, `typ`
  exakt, Zeitfenster mit `UHR_TOLERANZ_S`, `bh` über die gesendeten Bytes. Der Server braucht sie
  für die Vektoren und Tests.
- Je Versuch eine neue Signatur mit neuem `jti`. Eine Wiederholung nach Stunden trägt also ein
  gültiges `exp`.
- Weitere Köpfe der Zustellung: `Content-Type: application/json` und `Lifeline-Event-Id: <id>`.
  Der zweite dient dem Entdoppeln vor dem Parsen. Er ist nicht signiert; maßgeblich ist das `id`
  im signierten Body.
- **Testereignis:** Body `{"type":"ping","occurred_at":"…"}`, gleich signiert, `Lifeline-Event-Id`
  fehlt. Clients überspringen unbekannte Arten ohnehin (Vertrag des Abrufs).

Alternative: das Profil `MACHINE` wiederverwenden (`typ lifeline-machine-response+jwt`). Dann
wäre eine Antwort auf eine Anfrage als Webhook-Zustellung verwendbar und umgekehrt, also
Typverwechslung. Ein eigener `typ` schließt das am ersten Feld aus.

### D5: Ziel-Schutz mit eigener Adressklasse und zwei pinnenden Clients

Neues Modul `public_api::webhook::ziel`:

- `fn klasse(ip) -> Adressklasse::{Oeffentlich, Privat, Gesperrt}`.
  - **Gesperrt immer:** Loopback, unbestimmt, Link-Local (v4 `169.254/16` mit Metadatenadresse,
    v6 `fe80::/10`), Multicast (`224/4`, `ff00::/8`), Broadcast, `0/8`, `240/4`, Benchmark
    `198.18/15`.
  - **Privat** (nur mit LAN-Ausnahme erlaubt): `10/8`, `172.16/12`, `192.168/16`, `100.64/10`,
    `fc00::/7`.
  - Eingebettetes IPv4 (mapped, compatible, NAT64, 6to4) wird wie bei `ip_ist_intern` ausgepackt
    und rekursiv geprüft.
- `fn check_url(url, lan_erlaubt) -> Result<Url, ZielFehler>`: Schema `https`, ohne
  Userinfo und Fragment, Host nicht `localhost`/`*.localhost`, ein IP-Literal nach `klasse`.
  reqwest löst IP-Literale nicht über den Resolver auf, also muss diese Prüfung sie fangen. Sie
  läuft beim Speichern und vor jedem Versuch, damit eine verschärfte Regel auch alte Ziele trifft.
- `struct WebhookResolver { lan_erlaubt }` (impl `reqwest::dns::Resolve`), fail-closed wie
  `SichererResolver`: Ist eine einzige Adresse gesperrt oder ohne Ausnahme privat, kommt keine
  zurück.
- Zwei Prozess-Clients (`OnceLock`), mit und ohne LAN-Ausnahme, über
  `ausgehend::client_builder(Zweck::Webhook)` mit `.no_proxy()`,
  `.redirect(Policy::none())`, `.https_only(true)`, `.no_gzip()`, `connect_timeout` 5 s und
  `timeout` 15 s.
- Die Antwort wird nur über `http_begrenzt::lies_begrenzt` mit einem neuen Deckel `WEBHOOK`
  (16 KiB) gelesen und dann verworfen. Gespeichert werden nur Status und Fehlerart, nie der Rumpf
  (Spec „Diagnose“).
- `ip_ist_intern` und `SichererResolver` bleiben unverändert. Dass `ip_ist_intern` Multicast und
  `198.18/15` nicht kennt, betrifft die Karte und geht als Folgeaufgabe aufs Board.

**Für Tests:** Weil Loopback immer gesperrt ist, läuft die Zustellung im Lauf über einen Trait
`Zusteller` (`async fn senden(&self, ziel, lan, kopf, body) -> Ergebnis`). Integrations-Tests
setzen einen aufzeichnenden Zusteller ein, der echte HTTP-Weg wird über `klasse`, `check_url`
und den Resolver als Einheit getestet. Einen Schalter für Loopback im Produktivbinary gibt es
nicht.

Alternative: `ip_ist_intern` um einen Parameter erweitern. Das ändert Karte und Proxy mit, und
deren Prüfspur gehört nicht in diese Change.

### D6: Backoff, Anhalten und Fehlerarten

- Wartezeit nach dem n-ten Fehlschlag in Folge: `min(60 s · 2^(n−1), 6 h)`, also 1, 2, 4, 8, 16,
  32, 64, 128 und 256 min, danach 6 h.
- **Anhalten genau nach 24 h:** Fiele der nächste Versuch hinter `fehler_seit + 24 h`, wird er auf
  diesen Zeitpunkt gelegt. Scheitert er, wechselt `zustand` auf `angehalten` mit
  `angehalten_at`. Ein Erfolg setzt `fehler_seit`, `fehlversuche` und `naechster_versuch_at`
  zurück.
- Ein Empfänger, der 2 h weg war: Die Versuche liegen bei 0, 1, 3, 7, 15, 31, 63 und 127 min.
  Danach geht alles der Reihe nach hinaus (Akzeptanzkriterium).
- Fehlerarten als festes Wire-Enum (`WebhookFehler`): `status` (Nicht-2xx, Status steht
  daneben), `weiterleitung` (3xx), `zeitueberschreitung`, `verbindung`, `tls`, `ziel_intern`
  (Resolver oder Literal gesperrt), `dns`. Keine Fehlertexte des Ziels in der Datenbank.
- Die Logik steht als reine Funktion `naechster_zustand(webhook, ergebnis, jetzt)` und wird ohne
  Netz getestet.

### D7: Wiederaufnehmen, Ändern, Entfernen

- **Wieder aufnehmen** (nur aus `angehalten`, sonst `409`): `zustand = 'aktiv'`, Fehlerfelder
  leer, `naechster_versuch_at = jetzt`. Liegt `offen_id <= purged_until`, werden `cursor = head` und `verlust_at = jetzt` gesetzt (D2). Sonst bleibt der Cursor,
  und der Rückstand kommt der Reihe nach.
- **Hinweis zum Verlust:** steht in der Ansicht, solange `verlust_at` gesetzt ist. Die nächste
  Admin-Aktion am Webhook löscht ihn.
- **Ändern** (URL, Arten, LAN-Ausnahme; CAS über `geaendert_at`, sonst `409`): Der Cursor bleibt.
  Ein geändertes Ziel setzt die Fehlerfelder zurück, ein angehaltener Webhook bleibt angehalten.
  Ändert sich die LAN-Ausnahme, schreibt die Route zusätzlich `…_lan_erlaubt` oder
  `…_lan_entzogen` in die Admin-Spur.
- **Entfernen:** löscht Webhook und Verlauf. Ein neuer Webhook beginnt beim Höchststand.

### D8: Admin-API und Admin-Spur

Unter `/api/admin/anbindungen/{id}/webhook` in `routes::anbindungen` (Untermodul `webhook`):

| Methode | Pfad | Recht | Antwort |
| --- | --- | --- | --- |
| `POST` | `/webhook` | `AdminUser` | `201 WebhookAnzeige`, `409` wenn vorhanden |
| `PATCH` | `/webhook` | `AdminUser` | `200`, `409` bei CAS |
| `DELETE` | `/webhook` | `AdminUser` | `204` |
| `POST` | `/webhook/wieder-aufnehmen` | `AdminUser` | `200`, `409` wenn nicht angehalten |
| `POST` | `/webhook/test` | `AdminUser` | `200 TestErgebnis` |
| `GET` | `/webhook/versuche` | `darf_admin_bereich` | `200 [WebhookVersuch]` |

- `AnbindungAnzeige` bekommt `webhook: Option<WebhookAnzeige>`. Liste und Ansicht sehen den
  Zustand ohne eigene Abfrage. Die Seite pollt ohnehin alle 30 s.
- `WebhookAnzeige`: `id`, `url`, `arten`, `lan_erlaubt`, `zustand` (`aktiv | fehler | angehalten
  | ruht`, abgeleitet), `ruht_grund`, `fehler_seit`, `fehlversuche`, `naechster_versuch_at`,
  `letzter_fehler` (`at`, `status`, `art`), `letzter_erfolg_at`, `angehalten_at`, `verlust_at`,
  `geaendert_at`.
- Eingaben: `URL_MAX = 2048` mit Spiegel in `frontend/src/api/eingabegrenzen.ts`. Leere Arten,
  unbekannte Art, `http`, Userinfo und ein gesperrtes Literal ergeben `400`.
- Das Testereignis wartet auf die Antwort (höchstens 15 s, unter `REQUEST_BUDGET`) und schreibt
  einen Verlaufseintrag mit `test = 1`, sonst nichts.
- Neue `AdminAktion`: `maschinenzugang_webhook_angelegt`, `…_geaendert`, `…_entfernt`,
  `…_wieder_aufgenommen`, `…_lan_erlaubt`, `…_lan_entzogen`. Ziel ist `Ziel::Maschinenzugang`,
  die Angaben sind Zugang und Host des Ziels (nicht die ganze URL, sie kann Token im Pfad tragen).
  Dazu eine Migration, die den CHECK von `admin_audit` nach dem Muster 0340 neu baut.
- Schreibende Routen sperren wie die übrigen am gekoppelten ELW (`gesperrt_grund`).

### D9: Oberfläche: Paneel „Webhook“ in der Ansicht der Anbindung

- In `AnbindungAnsicht.tsx` ein Paneel „Webhook“ unter „Schlüssel“.
  - **Ohne Webhook:** ein Satz, was ein Webhook tut, dazu für Admins „Webhook einrichten“.
    Erfasst wird im `ErfassungsModal` mit drei Feldern: Ziel-URL, Ereignisarten und
    LAN-Ausnahme. Wählbar sind nur Arten, die die Rechte des Zugangs öffnen; die übrigen stehen
    ausgegraut mit Grund. Die LAN-Ausnahme trägt eine Warnung.
  - **Mit Webhook:** `BearbeitbaresPaneel` mit denselben drei Feldern und CAS. Dazu ein Chip für
    den Zustand (Töne wie `zustandAnzeige`: aktiv normal, Fehler bedien, angehalten achtung, ruht
    neutral), der letzte Fehler, der nächste Versuch und gegebenenfalls der Hinweis zum Verlust.
  - **Aktionen** im Kopf eines Paneels „Zustellung“, das auch Zustand, letzten Fehler, nächsten
    Versuch und die Webhook-Kennung zeigt: eine Hauptaktion („Wieder aufnehmen“ bei einem
    angehaltenen, sonst „Testereignis senden“), der Rest im `MenueAusloeser` („Webhook entfernen
    …“ als Gefahr, mit Rückfrage), nach „Datensatz-Aktionen werden gebündelt“. Ohne Verbindung
    sind die Aktionen gesperrt (`OHNE_VERBINDUNG_NICHT_AENDERBAR`).
  - **Ziel-URL nur für den System-Admin** (Entscheidung Ruben, 13.11.2026, aus dem Review): Wer
    sonst den Admin-Bereich sieht, bekommt nur den Host (`WebhookAnzeige.host`, `url` fehlt).
- Ein Paneel „Zustellungen“ zeigt die letzten 50 Versuche, ohne Rumpf: Zeit, Ereignis oder Test,
  Ergebnis, Status oder Fehlerart, Dauer.
- In der Liste auf „Anbindungen“ steht bei einem angehaltenen Webhook ein Hinweis im Ton
  `achtung`, bei einem Fehler im Ton `bedien`.
- Query-Keys über `queryKeys.ts`: die Liste bleibt `globalKeys.anbindungen()`, neu ist
  `globalKeys.anbindungWebhookVersuche(id)`.
- Das ist ein Paneel in einer bestehenden Ansicht, keine neue Seite. Der Entwurf über das Design
  System (`frontend/AGENTS.md`, „Größere UI-Entwürfe“) ist deshalb nicht nötig.

### D10: Referenz-Clients und Testvektoren

- Die Vektor-Datei bekommt einen Abschnitt `webhooks`. Erzeugt wird er von der Crate mit festem
  Instanzschlüssel, fester Zeit und festem `jti`. Er enthält `webhook_id`, Body, Kopf, `jetzt`,
  `gueltig` und je ungültigem Fall den erwarteten Fehler: fremder Schlüssel, Body um ein Byte
  geändert, falsche `aud`, abgelaufenes `exp` und falscher `typ`.
- Prüffunktion je Client:
  - Rust: `verify_webhook(header, body, instanz_pk, webhook_id, now)`.
  - TypeScript: `verifyWebhook(...)` mit WebCrypto.
  - Python: `verify_webhook(...)`.
  Alle drei laufen gegen die Vektoren. Der Server prüft die Vektoren mit `verify_webhook` und
  erzeugt den gültigen Fall byte-gleich mit `sign_webhook`, denn EdDSA ist deterministisch.
- Python und TypeScript bekommen ein kurzes Empfänger-Beispiel in der Doku, keinen Server im Repo.

### D11: ADR und Regeln

- Neue ADR (nächste freie Nummer, voraussichtlich 0039): „Webhooks werden mit dem
  Instanzschlüssel signiert und nur an geprüfte Adressen zugestellt“. Sie enthält:
  - **MUST:** `typ lifeline-event+jwt` mit `aud` = Webhook-ID; kein HMAC; keine Weiterleitung;
    `.no_proxy()`; pinnender Resolver; LAN nur über `lan_erlaubt`; Loopback, Link-Local und
    Multicast immer gesperrt; kein Rumpf des Ziels in der Datenbank.
  - **Prüfung** u. a.: `verlange '.no_proxy()' src/public_api/webhook/ziel.rs` und
    `verbiete 'Hmac' 'src/public_api/webhook/**/*.rs'`.
- `src/AGENTS.md`: ein Abschnitt „Webhooks“ neben „Ausgangsereignisse für Fremdsysteme“.
- Architektur: Bausteinsicht (Kapitel 5) und Kontextabgrenzung (Kapitel 3) nachziehen,
  Mitänderungsregel aus `docs/architektur/AGENTS.md`.

## Risks / Trade-offs

- **Mindestens einmal statt genau einmal** → Antwortet das Ziel erst nach dem Zeitlimit mit 2xx,
  kommt das Ereignis erneut. Der Empfänger entdoppelt über `id`; die Doku sagt das deutlich.
- **LAN-Ziel mit selbstsigniertem Zertifikat** → scheitert mit `tls`, weil nur die
  Vertrauensanker des Systems gelten. Abhilfe heute: ein Zertifikat einer vertrauten Stelle oder
  ein Reverse-Proxy. Pinning wäre eine eigene Aufgabe. Ruben wird beim Freigabe-Checkpoint darauf
  hingewiesen.
- **Takt 2 s** → bis zu 2 s Verzögerung zusätzlich. Für Einsatzbuch und Lagebild genügt das.
- **Ein langsames Ziel bremst nur sich selbst** → Zeitlimit 15 s, 8 parallel, höchstens 50 je
  Takt. Bei vielen hängenden Zielen verzögern sich die übrigen um höchstens einige Takte.
- **Verlust-Erkennung über `offen_id`** → Lief der Server über sieben Tage nicht, kann der
  Purge beim Start vor dem ersten Takt Zeilen löschen, die der Lauf noch nicht als offen gesehen
  hat. Das ist hingenommen: Der Abrufer hätte denselben Verlust und bekäme `410`.
- **Instanzschlüssel wechselt** (neue Instanz aus Sicherung, Kopplung) → Empfänger prüfen gegen
  den Schlüssel aus dem Einlösen. `jwks.json` hilft beim Wechsel. Das ist unverändert gegenüber
  den Antwortsignaturen.

## Migration Plan

- Migrationen ab 0349 (zuerst 0346, vor dem Merge umgelegt), Nummer vor dem Merge gegen `origin/alpha` prüfen
  (`scripts/check-migrationen.sh`): Tabellen `maschine_webhook` und `maschine_webhook_versuch`,
  Neubau des `admin_audit`-CHECK.
- Kein Datenumzug. Bestehende Zugänge haben keinen Webhook.
- Rückweg: Ein Binary ohne diese Change ignoriert die Tabellen. Ohne Webhook ist jeder Takt des
  Laufs eine leere Abfrage.

## Open Questions

- Keine offenen Punkte. Pinning für LAN-Ziele kommt als Folgeaufgabe, wenn Ruben es will.
