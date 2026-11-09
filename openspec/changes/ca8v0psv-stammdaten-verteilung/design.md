# Design

## Context

Ausgangspunkt ist die Kopplung aus LLH-1490
(`openspec/changes/archive/2026-11-08-ckq15vzr-instanzkopplung-schluessel/design.md`, ADR-0014).
Die meldende Seite meldet sich jede Minute signiert, und die Antwort liefert Unterschriftsschlüssel
nach einem Stand je Org nach (`auth::unterschrift::repo::nachlieferung`, Budget
`LIEFERUNGEN_MAX`). Das Schema der Meldung wächst nur additiv (`src/AGENTS.md`, Instanzkopplung).

Aufnahme vom 09.11.2026 (Zunder-Kommentar an LLH-1493):

- Rund 25 org-gebundene Stammdatenarten haben nur INTEGER-IDs. Es gibt keinen Änderungszähler,
  Zeitstempel fehlen oft, und manche Arten werden hart gelöscht.
- Einsatzdaten zeigen per Fremdschlüssel (meist `NO ACTION`) auf lokale IDs, tragen aber
  Schnappschüsse (`snap_*`).
- Ein Konto (`benutzer`) hält Passwort-Hash (Argon2id, OWASP-Vorgabe), TOTP-Geheimnis im Klartext,
  Rollen und eine Pflicht zum Passwortwechsel. Passkeys (`webauthn_credential`) sind an die RP-ID
  gebunden.
- `age` 0.12 ist schon Abhängigkeit (Sicherungen, `src/backup/verschluesselung.rs`).
- Der Schalter `--datentraeger-verschluesselung-extern` existiert schon (`src/config.rs`).

Der abgestimmte Lösungsweg steht im Zunder-Kommentar vom 09.11.2026.

## Goals / Non-Goals

**Goals:**

- Ein Verfahren, das alle Stammdatenarten tragen kann. Eine neue Art braucht nur Trigger, eine
  Beschreibung ihrer Spalten und ihres natürlichen Schlüssels.
- Schreibschutz und Änderungslog sitzen in der Datenbank, damit kein Schreibweg sie umgehen kann.
- Geheimnisse sind auf der Leitung, auf einer Platte ohne Bestätigung und nach einem Verlust
  geschützt.

**Non-Goals:**

- Anträge der meldenden Seite an die Quelle (LLH-1492).
- Die übrigen Kataloge (eigene Folgeaufgabe, gleiches Verfahren).
- Verteilung von Passkeys, SSO-Verknüpfungen, Logo, Kartenquellen.
- Stammdaten in Gegenrichtung oder zwischen zwei ELW (LLH-1497).
- Sicherheitsgewinn gegen einen kompromittierten Hub: Er ist die Quelle und hat die Geheimnisse
  ohnehin.

## Decisions

### D1 Änderungslog per Trigger

Die Tabelle `stammdaten_aenderung` hat die Spalten `stand` (INTEGER PRIMARY KEY AUTOINCREMENT,
global steigend), `org_id`, `art` (TEXT, etwa `fahrzeug`) und `schluessel` (TEXT: die id als Text
oder ein natürlicher Schlüssel bei Org-Einstellungen, Modul-Einstellungen und Führungsfunktionen).
Je `(art, schluessel)` gibt es höchstens eine Zeile (UNIQUE). Der Trigger löscht die alte Zeile und
fügt eine neue ein, das Log bleibt so etwa so groß wie der Bestand.

- Trigger `AFTER INSERT`, `AFTER UPDATE`, `AFTER DELETE` an jeder Tabelle des Schnitts.
- An `benutzer` nur `AFTER UPDATE OF` den verteilten Spalten, nämlich Name, Anzeigename, Rollen,
  Aktivität, `org_id`, `passwort_hash`, `totp_secret` und `totp_aktiviert`. Die Spalten, die jede
  Anmeldung schreibt (`totp_letzter_schritt`, Fehlversuche, Sperre), lösen nichts aus.
- Unterlisten ohne `org_id` (`personal_qualifikation`, `einheit_vorlage_fahrzeug`,
  `_personal`, `_material`) melden ihre Elternzeile. Geliefert wird immer die Elternzeile samt
  Unterlisten.
- Ob eine Zeile gelöscht ist, steht nicht im Log. Die Quelle schaut beim Liefern nach: Fehlt die
  Zeile, wird sie als Löschung geliefert.
- Abhängigkeiten im Log für die nächste Meldung: Der Stand ist global, gefiltert wird nach Org.

*Verworfen:* Eine Spalte `stand` je Tabelle müsste jeder Schreibweg im Code setzen. Bei rund 25
Arten mit vielen Schreibwegen und harten Löschungen ohne Grabstein vergisst das einer. Ein
Vollabgleich mit Prüfsumme schickt die ganze Art über eine schmale Leitung. Beides wurde am
09.11.2026 mit Ruben verworfen.

### D2 Lieferung über Melden, additiv

- `MeldenOrg` bekommt `stammdaten_stand: i64` (`serde(default)` = 0).
- `MeldenAnfrage` bekommt `age_empfaenger: Option<String>` und `datentraeger_verschluesselt: bool`
  (beide `serde(default)`).
- `MeldenOrgAntwort` bekommt `stammdaten: Vec<StammdatenLieferung>` und `stammdaten_bis: i64`
  (der höchste gelieferte Stand).

Eine `StammdatenLieferung` ist `{ art, schluessel, stand, geloescht, daten }`. `daten` ist ein
JSON-Objekt je Art mit festen, versionierten Feldern; die Unterlisten sind eingebettet. Bei Konten
kommt `geheimnis: Option<String>` dazu (D6).

Budget: `STAMMDATEN_MAX` Zeilen je Antwort über alle Orgs (Vorschlag 200). Dazu kommt die
bestehende Grenze `ANTWORT_MAX` (1 MiB), Unterlisten je Zeile sind gedeckelt, und
`check_antwort` prüft beides auf der Empfängerseite. Die Protokollversion bleibt, denn eine ältere
Gegenseite ignoriert die neuen Felder.

**Reihenfolge und Abhängigkeiten:** Geliefert wird nach `stand`. Zeigt eine Zeile auf eine andere
verteilte Zeile, deren Stand über dem gemeldeten liegt (die Gegenseite kennt sie noch nicht),
kommt diese Zeile vorher mit, auch über das Budget hinaus. Beispiele: Vorlage auf Fahrzeug,
Personal auf Konto oder Qualifikation, Qualifikation auf Qualifikation. Die Abhängigkeiten reichen
höchstens zwei Ebenen tief. Der Empfänger übernimmt die ganze Antwort in einer Transaktion in zwei
Durchgängen: erst alle Zeilen ohne Verweise, dann die Verweise. Ein Verweis, der trotzdem
unbekannt bleibt, wird `NULL` bzw. der Unterlisteneintrag entfällt, und die Kopplung zeigt einen
Hinweis.

### D3 Herkunft und Abbildung der IDs

Die Tabelle `stammdaten_herkunft` an der meldenden Seite hat die Spalten `kopplung_org_id`
(FK, CASCADE), `art`, `fremder_schluessel`, `lokaler_schluessel` und `geheimnis_merkmal` (nur
Konten, D6). Eindeutig ist `(kopplung_org_id, art, fremder_schluessel)` und ebenso
`(art, lokaler_schluessel)`.

- „vom Hub“ heißt: Für die Zeile gibt es eine Herkunft.
- „nur hier“ heißt: Die Zeile hat keine Herkunft, aber ihre Org bezieht Stammdaten aus einer
  Kopplung.
- Mit dem Widerruf der Org-Zuordnung werden die Herkunftszeilen gelöscht, und die Zeilen gehören
  danach der Instanz.

Die Quelle einer lokalen Org ist die älteste aktive Org-Zuordnung mit `richtung = meldet_sich`.
Für jede weitere Zuordnung liefert die Meldung `stammdaten_stand = -1` (heißt: „bitte nichts“), und
die Kopplung trägt einen Hinweis.

### D4 Schreibschutz per Trigger, Übernahme per Merker

An jeder Tabelle des Schnitts stehen `BEFORE UPDATE` und `BEFORE DELETE`, an den Unterlisten auch
`BEFORE INSERT`. Sie brechen mit `RAISE(ABORT, 'stammdaten_vom_hub')` ab, wenn die Zeile (bzw.
ihre Elternzeile) eine Herkunft hat und die einzeilige Tabelle `stammdaten_uebernahme` leer ist.
Die Übernahme schreibt diese Zeile am Anfang ihrer Transaktion und löscht sie vor dem Commit.
SQLite hat nur einen Schreiber, deshalb sieht kein anderer Schreibweg den Merker.

- `AppError` bildet einen sqlx-Datenbankfehler mit dieser Nachricht auf 409 „Wird am Hub gepflegt“
  ab, zentral in `src/error.rs`.
- An `benutzer` schützt der Trigger nur die verteilten Spalten (`BEFORE UPDATE OF …`). Passwort,
  TOTP-Einrichtung, Zähler, Sperren und Pflicht zum Passwortwechsel bleiben lokal schreibbar
  (Spec). `webauthn_credential` ist nicht betroffen.

*Verworfen:* Prüfungen in jeder Route. Rund 40 Schreibwege, und eine vergessene Route schriebe
still in die Kopie. Der Guard-Test bräuchte dazu eine Liste, die mitgepflegt werden müsste.

### D5 Erster Abgleich

Kommt eine Lieferung ohne Herkunft an, sucht die meldende Seite eine lokale Zeile derselben Art
und Org ohne Herkunft mit gleichem natürlichem Schlüssel:

| Art | Schlüssel |
| --- | --- |
| Fahrzeug | `funkrufname` |
| Personal | `personalnummer`, wenn gesetzt |
| Material | `bestandsnummer`, wenn gesetzt |
| Einheiten-Vorlage | `name` |
| Status, Qualifikation, Einheit-Typ | `label` |
| Führungsfunktion | `funktion` |
| Modul-Einstellung | `modul_key` |
| Org-Einstellungen | die Org |

Bei einem Treffer wird die lokale Zeile überschrieben und bekommt die Herkunft. Einsatzdaten
behalten dadurch ihre Verweise. Ohne Treffer wird eine neue Zeile angelegt. Das Muster ist
`src/demo/stammdaten.rs`.

Konten werden nie abgeglichen. Ist der Benutzername vergeben (`NOCASE`), wird das Konto
übersprungen, und die Kopplung trägt den Hinweis. Die nächste Lieferung dieses Kontos versucht es
erneut; die Quelle liefert es nach dem Konflikt nicht von selbst neu, deshalb gibt es die Aktion
„Erneut abgleichen“ (setzt `stammdaten_stand` dieser Zuordnung auf 0).

### D6 Konten und ihre Geheimnisse

- **Schlüssel des ELW:** `instanz_identitaet` bekommt `age_privat` (X25519, beim ersten Start
  erzeugt, wandert mit der Sicherung wie der Ed25519-Schlüssel). Die meldende Seite schickt
  `age_empfaenger` und `datentraeger_verschluesselt` (aus `--datentraeger-verschluesselung-extern`)
  in jeder Meldung. Die Quelle speichert beides an der Kopplung. Der Wert ist echt, weil die
  Anfrage mit dem gepinnten Instanzschlüssel signiert ist.
- **Liefern:** Das Geheimnis ist `{passwort_hash, totp_secret, totp_aktiviert}` als JSON, mit age
  an genau diesen Empfänger verschlüsselt. Die Quelle lässt es weg, wenn der Empfänger fehlt, die
  Platte nicht bestätigt ist oder das Konto ein System-Admin ohne Anmelde-Passkey ist (D7).
  `instanz_geheimnis_lieferung (kopplung_org_id, benutzer_id, geliefert_at)` hält fest, wessen
  Geheimnisse wohin gingen.
- **Übernehmen:** Kommt ein Konto ohne Geheimnis an, wird `passwort_hash` zum neuen Platzhalter
  `PASSWORT_HASH_KEIN_LOKALES`, der kein PHC-String ist. `verifizieren` liefert dafür `false` und
  brennt den Wegwerf-Lauf. Mit Geheimnis übernimmt die meldende Seite Hash und TOTP nur, wenn sich
  das Merkmal des gelieferten Geheimnisses (SHA-256 über den Klartext) von `geheimnis_merkmal`
  unterscheidet. Ein Einmalpasswort am ELW bleibt so bestehen, bis sich am Hub wirklich etwas
  ändert.
- **Deaktivieren:** Bei `aktiv = 0` beendet die Übernahme nach dem Commit alle Sitzungen des Kontos
  (`session`-Funktion, kein eigenes `DELETE`, ADR-0011).
- `oidc_*`, `webauthn_*` und Passkeys bleiben lokal.

*Verworfen:* Nur das Konto zu verteilen, ohne Geheimnisse: Im Einsatz käme niemand hinein, der
vorher keinen Zugang eingerichtet hat. Ein Schalter je Konto: zu viel Pflege. Beides am 09.11.2026
mit Ruben verworfen.

### D7 Admins an einer verteilenden Instanz: nur Passkey

Eine Org gilt als verteilend, wenn an dieser Instanz eine aktive Org-Zuordnung mit
`richtung = wird_gemeldet` besteht. Für einen System-Admin dieser Org mit mindestens einem
Eintrag in `webauthn_credential` weist der Passwort-Provider nach der Passwortprüfung mit 403 ab.
Ein Fehlversuch ist das nicht. Wer ohne Passkey ist, behält den Passwortweg, aber seine Geheimnisse
gehen nicht hinaus. So sperrt die Regel niemanden aus und macht trotzdem jeden gestohlenen
Admin-Hash am Hub wertlos.

Das widerspricht der Regel „Nur der Passwort-Provider ist admin-tauglich“ aus ADR-0011. Eine
akzeptierte ADR ist unveränderlich (`docs/architektur/AGENTS.md`), deshalb gibt es eine neue
**ADR-0016**: Sie übernimmt die Regeln von ADR-0011 und ergänzt die Ausnahme. ADR-0011 bekommt
`status: ersetzt`. Der Abschaltschutz des letzten admin-tauglichen Wegs bleibt unverändert, denn
der Passwort-Provider bleibt serverweit an.

### D8 „ELW verloren“

`POST /api/admin/instanz/kopplungen/{id}/verloren`, nur für die eigene Org, nur bei
`richtung = wird_gemeldet`. In einer Transaktion:

1. Widerruf der Zuordnung wie bisher.
2. Für jedes Konto aus `instanz_geheimnis_lieferung` dieser Zuordnung: `passwort_hash` wird
   `PASSWORT_HASH_KEIN_LOKALES`, der zweite Faktor wird zurückgesetzt (bestehender Weg
   „Zweitfaktor zurücksetzen“).

Nach dem Commit werden die Sitzungen dieser Konten beendet, und genau ein Eintrag mit der neuen
Aktion `instanz_elw_verloren` und `anzahl` in den Angaben kommt in die Admin-Spur.

Weil Hash und TOTP sich ändern, liefern die Trigger die Konten auch an andere ELW neu aus: Dort
gilt danach ebenfalls kein altes Passwort mehr. Der Weg zurück ist das Einmalpasswort (Spec
`konto-einmalpasswort`) oder ein Passkey.

### D9 Oberfläche

- `GET /api/instanz/stammdaten/herkunft` liefert je Art die lokalen Schlüssel „vom Hub“ und je Org,
  ob sie eine Quelle hat (Name der Gegenstelle). Ein Hook `useStammdatenHerkunft` und ein Abzeichen
  `HerkunftAbzeichen` („vom Hub“ / „nur hier“) bedienen die Reiter des Schnitts (Fahrzeuge,
  Material, Fahrzeug-Status, Personal, Qualifikationen, Personal-Status, Einheitstypen,
  Einheiten-Vorlagen, Führungsfunktionen, Anzeige und Einsatz-Vorgaben) und die Benutzerverwaltung.
  Bearbeiten und Löschen sind für „vom Hub“ gesperrt, mit dem Hinweis „Wird am Hub gepflegt“.
- Ein eigener Endpunkt statt eines Felds in rund zehn DTOs hält den Diff klein und die Antworten
  der bestehenden Listen stabil.
- **Instanzkopplung:** neue Hinweise an der Kopplung (Stand, Konflikte, „Geheimnisse nicht
  verteilt“, „Stammdaten kommen schon von …“). Auf der erreichten Seite kommt die Aktion
  „ELW verloren“ dazu (Bestätigungsdialog mit Zahl der betroffenen Konten), auf der meldenden
  „Erneut abgleichen“.
- **Benutzerverwaltung am Hub:** Hinweis an Admins ohne Passkey (Spec). **Anmeldung:** Text der
  403-Abweisung.

## Risks / Trade-offs

- **Gestohlener ELW ohne Plattenverschlüsselung, die aber bestätigt wurde.** → Die Bestätigung ist
  eine Aussage des Betreibers, keine Prüfung. Die Doku sagt das, und „ELW verloren“ ist der Weg
  danach.
- **Argon2id mit OWASP-Mindestwerten ist offline angreifbar, wenn Passwörter schwach sind.** →
  Plattenverschlüsselung als Bedingung; Admin-Hashes sind am Hub wertlos (D7). Stärkere Parameter
  würden die Anmeldung auf schwacher ELW-Hardware bremsen und bleiben eine eigene Frage.
- **Admin verliert seinen einzigen Passkey am Hub.** → Ein anderer Admin vergibt ein
  Einmalpasswort und entfernt den Passkey. Für den letzten Admin bleibt der Bootstrap-Weg über
  die Kommandozeile. Das steht in der Doku.
- **„ELW verloren“ trifft auch andere ELW** (D8), dort gilt das alte Passwort ebenfalls nicht mehr.
  → Gewollt, denn das Geheimnis gilt als bekannt.
- **Trigger machen jede Stammdaten-Schreibung etwas teurer.** → Eine Zeile Log je Schreibung, bei
  Stammdaten vernachlässigbar.
- **Ein Trigger-Abbruch an einer Stelle, die heute still Hub-Zeilen ändert** (etwa ein
  Purge-Lauf). → Die Rust-Suite läuft mit den Triggern; jeder solche Weg fällt dort auf und
  bekommt den Merker oder bleibt draußen.
- **Doppelte Abhängigkeit über das Budget hinaus** (D2). → Höchstens zwei Ebenen; `ANTWORT_MAX`
  bleibt die harte Grenze, und `check_antwort` prüft sie.

## Migration Plan

Neue Tabellen, Trigger und Spalten, alles additiv. Ungekoppelte Instanzen schreiben ein Log, das
niemand liest. Bestehende Kopplungen holen beim ersten Lauf mit Stand 0 den Grundstock. Ein
Zurückgehen auf eine ältere Version lässt Tabellen und Trigger liegen. Die Trigger brechen dann nur
ab, wenn Herkunftszeilen bestehen, und eine ältere Version bildet den Fehler auf 500 ab statt
auf 409. Die Release-Notiz nennt das.

## Open Questions

- Genaue Wortwahl der Hinweise und Dialoge (mit `design:ux-copy` bei der Umsetzung).
- Wert von `STAMMDATEN_MAX`: Ein Test misst die größte zulässige Antwort gegen `ANTWORT_MAX`, wie
  bei den Unterschriftsschlüsseln.
