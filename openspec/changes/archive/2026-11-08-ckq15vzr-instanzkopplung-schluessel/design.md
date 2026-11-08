# Design

## Context

Motivation in `proposal.md`, Verhalten in den beiden Specs. Was den Weg bestimmt:

- **Muster im Bestand:** Gerätekopplung (`src/geraet/code.rs`, `repo.rs`, `migrations/0147`):
  Crockford-Code aus `OsRng`, nur SHA-256 in der DB, Einmaligkeit per bedingtem `UPDATE`, IP-Sperre
  über `src/auth/rate_limit.rs`, einheitlich 401. Lesezugang LLH-1484 (`src/lagemonitor_zugang/`):
  Anlegen und Widerruf nur mit `AdminUser`, Eintrag in `admin_audit`. VAPID-Schlüssel als
  Einzeilentabelle `web_push_schluessel` (`id = 1` per CHECK), damit die Sicherung ihn mitnimmt.
- **Krypto im Bau:** `ed25519-dalek 2.2` und `p256` liegen schon transitiv im Lockfile, `openssl`
  direkt (nur wegen `webauthn-rs`, R08), `sha2`, `reqwest` mit rustls. Kein JWT-Crate.
- **Rollen:** „Org-Admin“ ist `system_rolle = 'admin'` mit `org_id` (`src/auth/mod.rs`). Ein Admin
  schreibt nur in der eigenen Org (`src/AGENTS.md`, Admin-Schreibwege). `admin_audit.akteur_id`
  darf NULL sein (`migrations/0269`).
- **Passkeys:** `webauthn-rs 0.5`; `Passkey::get_public_key()` liefert den öffentlichen Schlüssel
  als `COSEKey` (ohne Feature-Schalter, nachgeprüft bei der Umsetzung). Passkey-Registrierungen
  bieten nur ES256 und RS256 an (`COSEAlgorithm::secure_algs`). Zeremonie-Zustand im
  Prozessspeicher (R10). Nur der Passwortweg ist admin-tauglich (ADR-0011).
- **Abgestimmt mit Ruben am 08.11.2026** (Zunder-Kommentar an LLH-1490): Anfrage-JWT, eigener
  Unterschrifts-Passkey, Gegenzeichnung durch bekannten Admin, Protokoll N/N−1.

## Goals / Non-Goals

**Goals:**

- Ein Vertrauensanker, auf dem LLH-1491 bis LLH-1497 ohne Protokollbruch aufsetzen.
- Ein Verfahren für Maschinen, das LLH-1148 für Fremdsysteme übernimmt (ADR).
- Ein kompromittierter Hub kann keinen Admin-Schlüssel einschleusen.
- Kein Zustand im Prozessspeicher, der nach einem Neustart Sicherheit kostet (R10).

**Non-Goals:**

- Nutzdaten jeder Art (Einsatz, Stammdaten, Anträge), Führung, Notübernahme (LLH-1491 ff.).
- mTLS, Entdeckung im LAN, Schlüssel außerhalb der DB (Hardware, OS-Schlüsselbund).
- Mehrere Prozesse je Instanz (R10 bleibt).

## Decisions

### D1 Identität: Ed25519 über `ed25519-dalek`, Einzeilentabelle

`instanz_identitaet (id = 1 CHECK, kennung, privat, oeffentlich, erstellt_at)`, erzeugt beim
Start per `INSERT OR IGNORE` wie `web_push::repo::schluessel_laden_oder_erzeugen`. Kennung: UUID v4.
Fingerabdruck für die Anzeige: die ersten 20 Byte von SHA-256 über den öffentlichen Schlüssel als
Crockford-Base32 in Vierergruppen (32 Zeichen), dieselbe Funktion an beiden Seiten.

- *Alternative OpenSSL-Ed25519:* kein neues Crate, bindet aber neuen Code an die C-Abhängigkeit,
  die nur wegen `webauthn-rs` im Bau ist (R08). `ed25519-dalek` liegt schon im Lockfile.
- *Alternative Schlüssel in Datei:* entkoppelt von der Sicherung; eine Wiederherstellung hätte
  eine neue Identität und bräche jede Kopplung. Die DB im Klartext (R19) ist das bekannte Risiko.

### D2 Kopplungscode: 16 Zeichen, Schlüssel aus dem Code abgeleitet

Code wie `geraet::code`, aber 16 Zeichen (80 Bit), 15 Minuten. Aus dem normalisierten Code leitet
HKDF-SHA256 drei Werte ab: `suche` (Tabellenschlüssel, geht über die Leitung), `k_einloeser`,
`k_aussteller` (nur zum Prüfwert). Der Aussteller speichert `suche`, beide Ableitungen, Org,
Admin und Ablauf (`instanz_kopplungscode`), nie den Code.

Ablauf (die einlösende Instanz heißt E, die ausstellende A):

1. E schickt an `POST <A>/api/instanz/koppeln`: `suche`, Protokoll, eigene Kennung, Schlüssel,
   Name, Softwarestand, eine `jti` und `mac_e = HMAC(k_einloeser, Transkript_E)`. Das Transkript
   bindet `suche`, Kennung und Schlüssel von E. Die Adresse von A gehört nicht hinein: A kennt
   seine öffentliche Adresse hinter einem Proxy nicht verlässlich, und ein an eine fremde Instanz
   weitergereichter Code scheitert dort ohnehin, weil nur A den Datensatz zu `suche` hat.
2. A prüft `mac_e`, verbraucht den Code per bedingtem `UPDATE` und legt die Kopplung im Zustand
   `angebahnt` an. Die Antwort trägt Kennung, Schlüssel, Name, Stand von A, die Org (Kennung,
   Name), die Unterschriftsschlüssel der Org und `mac_a = HMAC(k_aussteller, Transkript_E ‖
   Antwortinhalt)`, zusätzlich signiert nach D3.
3. E prüft `mac_a` und Signatur, speichert die Kopplung als `aktiv` und meldet sich sofort (D4).
   Die erste gültige Meldung setzt die Kopplung bei A auf `aktiv`. Eine Kopplung, die 15 Minuten
   `angebahnt` bleibt, verwirft A.

Ein Angreifer in der Mitte sieht nur `suche` und die Prüfwerte; ohne den Code kann er keinen
Prüfwert für einen ausgetauschten Schlüssel bilden. 80 Bit lassen sich in 15 Minuten nicht
durchprobieren. Fehlversuche laufen über `rate_limit::fehlversuch`, jede Ablehnung ist 401.

- *Alternative nur TLS (TOFU):* einfacher, aber ein gefälschtes Zertifikat (fremde CA, Proxy im
  Fahrzeugnetz) genügte für einen untergeschobenen Hub.
- *Alternative PAKE (SPAKE2/CPace):* sicherer gegen Durchprobieren kurzer Codes, aber neues
  Crate und mehr Protokoll; bei 80 Bit und 15 Minuten unnötig.
- *Hinweis:* `k_einloeser` und `k_aussteller` liegen bis zum Einlösen oder Ablauf in der DB. Wer
  in diesen 15 Minuten die DB des Ausstellers liest, kann den Code einlösen; dasselbe gilt für
  jeden, der den Code am Bildschirm abliest.

### D3 Signierte Nachrichten: kompaktes JWS mit EdDSA, Wiederholschutz in der DB

Anfrage: Kopf `Authorization: Instanz <jws>`. JWS-Kopf `{alg: "EdDSA", typ:
"lifeline-instanz+jwt", kid: <kennung>}`, Claims `iss`, `aud` (Kennung des Empfängers), `iat`,
`exp` (höchstens `iat + 60 s`), `jti` (128 Bit), `htm`, `htu` (Pfad mit Query), `bh` (Base64url
SHA-256 des Bodys), `pv` (Protokollversion). Antwort: Kopf `Lifeline-Instanz-Antwort: <jws>` mit
`iss`, `aud`, `iat`, `exp`, `jti`, `bezug` (= `jti` der Anfrage), `status`, `bh`.

Selbst geschrieben auf `ed25519-dalek` und `base64` (etwa 150 Zeilen), weil das Format fest ist
und ein JWT-Crate Algorithmus-Verwirrung erst wieder ausschließen müsste. Nur `alg = EdDSA` wird
angenommen.

Prüfen in einem Extractor `GekoppelteInstanz` (Muster ADR-0005): liest den Body begrenzt, prüft
Signatur gegen den gespeicherten Schlüssel aus `kid`, `aud`, `htm`, `htu`, `bh`, Zeitfenster mit
300 s Toleranz für Uhrabweichung, und trägt `jti` in `instanz_jti (absender, jti, bis)` ein; ein
Primärschlüsselkonflikt heißt Wiederholung → 401. Abgelaufene `jti` räumt der bestehende
Purge-Lauf. Die Antwort zeigt die eigene Uhrzeit; weicht sie mehr als 120 s ab, zeigt die Kopplung
„Uhr weicht ab“.

- *Alternative RFC 9421:* von Ruben verworfen (wenig Rust-Bausteine, LLH-1148 bräuchte trotzdem
  JWT).
- *Alternative `jti` im Speicher:* ein Neustart öffnete ein Fenster für Wiederholungen (R10).

### D4 Melden: Hintergrund-Task der meldenden Seite

Die meldende Seite schickt alle 60 s (`--instanz-melden-sekunden` / `LIFELINE_INSTANZ_MELDEN_SEKUNDEN`)
und nach dem Start `POST /api/instanz/melden` an jede aktive Kopplung. Body: Softwarestand,
Protokoll, je Org-Zuordnung der bekannte Stand der Unterschriftsschlüssel. Antwort: Softwarestand,
Protokoll, Widerrufe von Org-Zuordnungen, Änderungen an Unterschriftsschlüsseln seit dem Stand.
Bei Fehlern verdoppelt sich der Abstand bis 10 Minuten. Ausgehend über `reqwest` ohne Weiterleitung,
Zeitlimit 15 s, Antwort über `http_begrenzt`. Die Adresse muss `https://` sein; `http://` nur für
Loopback (Tests).

Das Schema von Melden ist über alle Protokollversionen nur additiv, damit D5 greift.

### D5 Protokollversion

`const PROTOKOLL: u32 = 1` in `src/instanz/mod.rs`. Volle Arbeit bei `|eigen − fremd| ≤ 1`, sonst
nur Melden (immer angenommen) und jede andere Route 426. Die Kopplung zeigt „Update nötig“ und die
veraltete Seite. Wer `PROTOKOLL` erhöht, hält die vorige Version im Code, bis die übernächste kommt.

### D6 Datenmodell (Migrationen mit der nächsten freien Nummer über `origin/alpha`)

- `instanz_identitaet` (D1)
- `instanz_kopplung (id, gegenueber_kennung UNIQUE, gegenueber_schluessel, gegenueber_name,
  richtung, gegenueber_adresse NULL, zustand, zuletzt_gesehen_at, gegenueber_softwarestand,
  gegenueber_protokoll, letzter_fehler, erstellt_at)` — `richtung` ∈ `meldet_sich` |
  `wird_gemeldet`, `zustand` ∈ `angebahnt` | `aktiv` | `widerrufen` | `vom_gegenueber_widerrufen`
  (`wire_enum!`, ADR-0006). Adresse nur bei `meldet_sich` (CHECK).
- `instanz_kopplung_org (id, kopplung_id, org_id, fremde_org_kennung, fremde_org_name,
  angelegt_von, angelegt_at, widerrufen_at, widerrufen_von, widerruf_gemeldet_at)`, eindeutig je
  `(kopplung_id, org_id)` solange nicht widerrufen. Die fremde Org wird über ihre Kennung
  gehalten, nicht über eine lokale ID; die Übernahme von Kennungen regelt LLH-1493.
- `instanz_kopplungscode (suche PK, org_id, k_einloeser, k_aussteller, ausgestellt_von,
  laeuft_ab_at, eingeloest_at)`
- `instanz_jti (absender, jti, bis, PK (absender, jti))`
- `unterschrift_schluessel` (D7)

Die Org braucht eine stabile Kennung über Instanzgrenzen. Heute ist `organisation.id` eine lokale
Ganzzahl; die Kopplung schickt deshalb `<instanzkennung>/<org_id>` als fremde Org-Kennung. Mehr
braucht diese Change nicht.

### D7 Unterschriftsschlüssel: eigene WebAuthn-Zeremonie, eigene Tabelle

Registrierung über `webauthn-rs` mit eigenem Zeremonie-Zustand und eigenem, zufälligem
User-Handle je Schlüssel (der Anmeldeweg findet ihn nie), `userVerification = required`. Den
öffentlichen Schlüssel liefert `Passkey::get_public_key()`; angenommen wird nur ES256 (P-256),
ein RS256-Passkey wird mit 422 abgelehnt. Gespeichert wird eine eigene, schlanke Form (`alg`,
SEC1-Punkt), nicht das `Passkey`-JSON, damit die Prüfung an einer anderen Instanz nicht an
`webauthn-rs` hängt.

`unterschrift_schluessel (id, org_id, herkunft, kopplung_org_id NULL, benutzer_id NULL,
benutzer_name, credential_id, alg, schluessel, rp_id, origin, bezeichnung, fingerabdruck, zustand,
gegenzeichnung NULL, stand, erstellt_at, widerrufen_at)`. `herkunft` ∈ `lokal` | `gegenueber`,
`zustand` ∈ `wartet_auf_gegenzeichnung` | `gueltig` | `widerrufen`. `stand` steigt je Org
monoton bei jeder Änderung und trägt die Nachlieferung in D4. Die Tabelle ist getrennt von
`webauthn_credential`; der Anmeldeweg liest sie nie (ADR-0011 bleibt unberührt).

Gegenzeichnung: Ein Admin mit gültigem Schlüssel wählt bei einem wartenden Schlüssel
„Gegenzeichnen“. Der Server bildet eine Erklärung (Typ, fremde Org-Kennung, Fingerabdruck und
Hash des neuen Schlüssels, Name des Inhabers, Zeitpunkt) als kanonisches JSON, die Challenge ist
ihr SHA-256. Der Browser ruft `navigator.credentials.get` mit dieser Challenge und dem eigenen
Unterschriftsschlüssel auf; der Server prüft nach D8 und speichert Erklärung und Assertion. Der
erste Schlüssel einer Org ohne Kopplung ist ohne Gegenzeichnung gültig. Die Challenge entsteht am
Server und wird im Zeremonie-Zustand gehalten (Muster `auth::webauthn::state`), damit der Browser
keine eigene Erklärung unterschreiben lässt.

- *Alternative Anmelde-Passkeys:* von Ruben verworfen.
- *Alternative Attestation selbst parsen:* braucht einen CBOR-Parser; `get_public_key()` liefert
  dasselbe aus der schon geprüften Registrierung.
- *Alternative `danger-credential-internals`:* im Entwurf vorgesehen, bei der Umsetzung unnötig
  geworden, weil `get_public_key()` öffentlich ist.

### D8 Prüfer für eine Unterschrift über eine vorgegebene Erklärung

`auth::unterschrift::pruefe(erklaerung_hash, assertion, schluessel)` ohne `webauthn-rs`:
`clientDataJSON` mit `type = "webauthn.get"`, `challenge = b64url(erklaerung_hash)`, `origin =
schluessel.origin`; `authenticatorData` mit `rpIdHash = SHA-256(schluessel.rp_id)`, Flags UP und UV;
Signatur über `authenticatorData ‖ SHA-256(clientDataJSON)` mit ES256 (`p256`, schon im
Lockfile). Der Signaturzähler bleibt ungeprüft (Passkeys melden oft 0). Tests bauen Assertions mit
einem Software-Schlüssel im Test selbst. LLH-1491 nutzt denselben Prüfer für die Notübernahme.

### D9 Widerruf

Widerruf einer Org-Zuordnung setzt `widerrufen_at`; ohne gültige Zuordnung wird die Kopplung
`widerrufen`. Ein schon gesetzter Widerruf bleibt, wie er ist (wer zuerst widerrufen hat, steht
fest). Auf der erreichten Seite trägt die Antwort auf die nächste Meldung den Widerruf signiert
(`widerrufen: true` je Org), danach wird `widerruf_gemeldet_at` gesetzt. Auf der meldenden Seite
schickt der Widerruf sofort eine letzte Meldung, die die widerrufenen Orgs in `widerrufen` nennt.
Scheitert sie, bleibt der Widerruf offen (`widerruf_gemeldet_at` leer), und die Meldeschleife
stellt ihn nach, auch an einer schon widerrufenen Kopplung, bis die Gegenseite signiert antwortet;
diese Meldung trägt nur noch den Widerruf (Nachtrag 08.11.2026, CodeRabbit-Review). Eine eigene
Widerrufs-Route gibt es nicht: Melden ist der eine signierte Weg und geht über alle
Protokollversionen. Eine empfangene Widerrufsmitteilung setzt `vom_gegenueber_widerrufen`. Ein
Wiederkoppeln derselben Gegenstelle legt eine neue Org-Zuordnung an, die alte Zeile bleibt als
Spur.

Unterschriftsschlüssel: Widerruf lokal sofort, Nachlieferung über `stand`. Deaktivieren oder
Herabstufen eines Admins widerruft seine Schlüssel im selben Commit. Der Schutz „letzter gültiger
Schlüssel“ gilt je Org mit aktiver Kopplung.

### D10 Oberfläche

Ein Eintrag „Instanzkopplung“ in `frontend/src/admin/adminNav.tsx` (`NUR_ADMIN`), eine Seite mit
drei Paneelen, gebaut nach `frontend/AGENTS.md` und dem Muster `LagemonitorZugaenge.tsx`:

1. **Diese Instanz:** Name, Kennung, Fingerabdruck (kopierbar), Protokollversion.
2. **Gekoppelte Instanzen:** Liste mit Name, Richtung („meldet sich bei …“ / „meldet sich
   hier“), Zustand, zuletzt gesehen, Stand, Hinweisen („Update nötig“, „Uhr weicht ab“, „Antwort
   ungültig“); Aktionen „Code ausstellen“ (Anzeige wie die Gerätekopplung, mit Fingerabdruck dieser
   Instanz), „Code einlösen“ (Adresse + Code, danach Fingerabdruck des Gegenübers zum Abgleich),
   „Widerrufen“ im Menü.
3. **Unterschriftsschlüssel der Org:** Liste mit Inhaber, Fingerabdruck, Zustand, Herkunft;
   „Eigenen registrieren“, „Gegenzeichnen“, „Widerrufen“.

Ohne eigenen Unterschriftsschlüssel ist „Code ausstellen“ gesperrt und erklärt, warum. Der Name
der Instanz kommt aus `--instanz-name` / `LIFELINE_INSTANZ_NAME`, Vorgabe die RP-ID.

### D11 Admin-Spur

Neue `AdminAktion`-Varianten mit CHECK-Migration und Fall in `tests/admin_audit.rs`:
`instanz_code_ausgestellt`, `instanz_code_eingeloest`, `instanz_gekoppelt`,
`instanz_kopplung_widerrufen`, `instanz_kopplung_vom_gegenueber_widerrufen`,
`unterschrift_registriert`, `unterschrift_gegengezeichnet`, `unterschrift_widerrufen`,
`unterschrift_abgelehnt`. Vom Gegenüber ausgelöste Einträge tragen `akteur_id = NULL` und als
`akteur_name` den Namen der Gegenstelle; `detail` hält Kennung, Fingerabdruck, Adresse.

### D12 Module und ADR

`src/instanz/` (`identitaet`, `code`, `signatur`, `kopplung` mit `repo`, `melden`),
`src/routes/instanz.rs`, `src/auth/unterschrift/` (`repo`, `pruefen`, Zeremonie),
`frontend/src/instanz/` (Seite, Paneele) mit `frontend/src/api/instanz.ts`. Neue ADR-0014
„Maschinen weisen sich mit Schlüsselpaar und signierten Anfrage-JWTs aus“ (`gilt_fuer`
`src/instanz/**`, `src/auth/unterschrift/**`), die LLH-1148 als `private_key_jwt` übernimmt, dazu
Abschnitt „Instanzkopplung“ in `src/AGENTS.md`.

## Risks / Trade-offs

- [Instanzschlüssel liegt im Klartext in der DB (R19)] → Wer die DB liest, kann die Instanz
  vortäuschen. Abhilfe: Widerruf am Gegenüber; Schlüssel im OS-Schlüsselbund ist eine spätere
  Change. Neues Risiko in Kapitel 11.
- [Uhr eines ELW ohne Netz läuft falsch] → 300 s Toleranz, sichtbarer Hinweis „Uhr weicht ab“
  mit der Zeit des Gegenübers.
- [Kompromittierter Hub widerruft alle Admin-Schlüssel] → Er schadet nur der Verfügbarkeit;
  die Notübernahme hat den Code-Fallback (Entscheidung 9). Der Schutz „letzter Schlüssel“ greift
  nur am ehrlichen Hub.
- [Admin verliert seinen einzigen Unterschriftsschlüssel] → Ein zweiter Admin oder ein zweiter
  Schlüssel desselben Admins; die Seite empfiehlt zwei Schlüssel je Org.
- [Öffentlicher Einlöse-Endpunkt] → IP-Sperre, Body-Grenze, einheitlich 401.

## Nachträge aus dem Review (08.11.2026)

Ein adversariales Review vor dem PR fand Lücken; behoben und mit Tests belegt
(`tests/instanz_kopplung.rs`, Abschnitt „Befunde aus dem Review“, und
`src/auth/unterschrift/repo/tests.rs`):

- **Fremder Schlüssel unter bekannter Kennung:** Die Kennung ist nicht geheim. Ein Code einer
  anderen Org überschrieb sonst Schlüssel und Adresse einer bestehenden Kopplung. Solange eine
  Org-Zuordnung gilt, bleibt der Schlüssel; ein abweichender ist ein Konflikt (nach außen 401).
- **Widerrufener Schlüssel unter neuer id:** Die id vergibt der Aussteller. Je Org-Zuordnung ist
  ein Schlüssel (`credential_id`) eindeutig, auch widerrufen, und lebt nie wieder auf.
- **Zuordnung bestätigt:** Auf der erreichten Seite trägt eine Org-Zuordnung `bestaetigt_at`,
  gesetzt mit der ersten Meldung, die sie nennt; unbestätigt verfällt sie nach 15 Minuten wie eine
  angebahnte Kopplung.
- **Alter, nie gemeldeter Widerruf** gilt mit einer neuen Zuordnung derselben Orgs als erledigt.
- **Widerruf einer Zuordnung** widerruft die von dort übernommenen Unterschriftsschlüssel.
- **Erklärung** bindet zusätzlich `rp_id`, `origin` und `alg` des neuen Schlüssels; das
  Transkript der einlösenden Seite zusätzlich Name und `jti`.
- **Herkunft** wird wie im Browser normalisiert (`Url::origin`), bevor sie in einen Schlüssel geht.
- **Extractor:** außer Melden nur bei aktiver Kopplung.
- **Fehlermeldung beim Einlösen** ohne Netzdetails (sonst ein Port-Scanner für Org-Admins); der
  Grund steht im Log.
- **Listen von der Gegenstelle** sind begrenzt: höchstens 256 Orgs und 256 Widerrufe je Meldung
  (sonst 400, gezählt vor dem Entdoppeln) und je Antwort höchstens 256 Orgs. Eine Antwort trägt
  über alle Orgs zusammen höchstens 64 Unterschriftsschlüssel, ein Grundstock ebenso; gelesen wird
  eine Antwort bis 1 MiB, und ein Test rechnet die größte zulässige Antwort dagegen. Die
  Nachlieferung liefert nach Stand sortiert, der Rest folgt mit der nächsten Meldung. Der
  Grundstock wird nie abgeschnitten: Hat die Org mehr gültige Schlüssel, scheitert Code ausstellen
  mit 409 und Grund, ein Einlösen danach scheitert ganz (am Einlöser ohne Grund, wie jedes
  gescheiterte Einlösen). Die übrigen kämen sonst ohne Gegenzeichnung nach und gingen still
  verloren. Eine Antwort mit einer Org doppelt ist
  ungültig, statt entdoppelt zu werden, damit die Reihenfolge nicht über einen Widerruf entscheidet.
- **Zeitstempel** werden ohne Überlauf verrechnet (`checked_sub`, gesättigt), denn sie kommen
  signiert, aber von der Gegenstelle.

Offen als Restrisiko (Entscheidung beim Menschen): **Ein kompromittierter Hub kann eine
Gegenzeichnung erschleichen.** Der Unterschriftsschlüssel ist an die RP-ID des Hubs gebunden, und
dessen Seite liefert der Hub selbst aus. Bösartiges JavaScript kann `navigator.credentials.get`
mit der Challenge einer Erklärung für einen eigenen Schlüssel aufrufen; der Authenticator zeigt
den Inhalt nicht. Unterschreibt ein Admin am kompromittierten Hub irgendetwas, nimmt der ELW den
untergeschobenen Schlüssel an. Das Ziel „ein kompromittierter Hub schiebt keinen Schlüssel
unter“ gilt damit nur, solange niemand am kompromittierten Hub unterschreibt.

## Migration Plan

Nur neue Tabellen und neue CHECK-Werte, keine Änderung an bestehenden Daten. Die Identität entsteht
beim ersten Start der neuen Version. Ein Zurückgehen auf eine ältere Version lässt die Tabellen
liegen; Kopplungen ruhen dann. Ungekoppelte Instanzen merken nichts.

## Open Questions

- Genaue Wortwahl der Hinweise und Paneeltitel klärt die Umsetzung mit `bedien-wortlaut` und
  `design:ux-copy`.
