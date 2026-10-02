# Design

## Context

Die Gründe stehen in `proposal.md`, die Anforderungen in den drei Spec-Deltas. Hier steht nur
der Ist-Stand, der den Weg bestimmt (Scope-Scan vom 02.10.2026):

- **Klassifikation.** `src/einsatz/schwaerzung_registry.rs` führt jede Spalte als `Scrub` oder
  `Retain`. `scrubbe_aus_registry` baut daraus pro Tabelle ein `UPDATE` oder `DELETE`, mit
  `Scoping` und optionalem `zeilenfilter`. Bisher nutzt nur `einsatz_personal` einen
  Zeilenfilter. Die Schwärzung kennt nur den ganzen Einsatz.
- **Lesewege der Personendaten sind zentral.** Jede der fünf Tabellen (`einsatz_person`,
  `person_sichtung`, `person_verlaufsnotiz`, `person_verbleib`, `person_uhs_belegung`) wird über
  genau eine SELECT-Konstante gelesen und auf genau ein DTO abgebildet (`person/repo.rs:5`,
  `sichtung_repo.rs:19`, `verbleib_repo.rs:39`, `verlaufsnotiz_repo.rs:17`,
  `uhs/belegung_repo.rs:5`). Liste, Detail, CSV-Export, Druck und der `client_id`-Replay laufen
  alle darüber. SSE trägt nur IDs, die ETB-Texte tragen nur Registriernummern (LFH-752).
- **Anhänge haben einen Byte-Weg.** `routes::support::anhang_antwort` ist der einzige Aufrufer
  von `anhang::repo::laden_bytes` (per Test bewacht). Metadaten mit Dateinamen liefern vier
  Listen: Chat, ETB, Schaden und Dokumentablage.
- **Kräfte-Daten sind verstreut**, über rund zwölf SELECTs. Deshalb fehlt die Kategorie
  Einsatzkräfte in dieser Change (Entscheidung Ruben, 02.10.2026).
- **Abgeschlossene Einsätze sind schreibgeschützt** (`fordere_aktiv` an allen Schreib-Extractoren).
  Kategorie-Fristen entstehen erst beim Abschluss. Eine Sperre muss also nur Lesewege abdecken,
  keine Schreibwege.
- **Einsatz-Aufbewahrung**: `einsatz.retention_bis`/`geloescht_at`/`geschwaerzt_at`,
  `retention::zustand`, `KARENZ_TAGE = 30`, Purge-Phasen A/B/C, fail-closed Akteurskette in
  `system_audit_tx`, WAL-Rückschrieb nach jeder Schwärzung (LFH-725).

## Goals / Non-Goals

**Goals:**

- Die Registry bleibt die **einzige Quelle**. Schwärzung je Kategorie und Sperre je Kategorie
  leiten sich aus denselben Einträgen ab wie die Schwärzung des Einsatzes.
- Eine Sperre liest sich **genau wie die spätere Schwärzung**. Clients brauchen dafür keine neue
  Feldlogik, nur einen Hinweis.
- Wer keine Kategorie-Frist einstellt, merkt keinen Unterschied. Einsätze, die vor der Einführung
  abgeschlossen wurden, bleiben unberührt.

**Non-Goals:**

- Kategorie Einsatzkräfte (Folgeticket).
- Eine Kategorie-Frist je Einsatz oder eine nachträgliche Änderung durch die Einsatzleitung. Nur
  der Org-Admin kann über das Wiederherstellen eine neue Frist setzen.
- Eine Kategorie, die die Einsatz-Frist überdauert. Dafür bräuchte es eine Lesesperre und eine
  Teilakte je Kategorie.
- Live-Benachrichtigung der Clients beim Sperren (s. Risiken).

## Decisions

### D1 Fristkategorie an der Scrub-Regel, Vorgabe `Einsatz`

`Klassifikation::Scrub` bekommt neben der Strategie eine `Fristkategorie`:
`Einsatz | Behandlung | Personenauskunft | Identitaet | Bildaufnahmen`. Das bisherige
`scrub(spalte, strategie)` setzt `Einsatz`. Neu ist `scrub_k(spalte, strategie, kategorie)`.
„Genau eine Kategorie“ erzwingt damit der Typ, nicht ein Test. Ein Guard-Test pinnt den
Zuschnitt aus der Spec (Kategorie → Menge `(tabelle, spalte)`), damit eine Umbuchung im Diff
auffällt.

`Identitaet` ist keine einstellbare Kategorie, sie wird aus Personenauskunft und Behandlung
abgeleitet (D3). Sie steht trotzdem in der Registry, damit die Schwärzung sie wie jede andere
Spaltengruppe behandelt.

Bildaufnahmen sind zeilen-, nicht spaltenbezogen. `TabellenRegel` bekommt dafür
`kategorie_zeilen: Option<(Fristkategorie, &'static str)>`, nur bei `anhang` gesetzt:
`(Bildaufnahmen, "mime LIKE 'image/%'")`. Die Kategorie-Schwärzung löscht genau diese Zeilen.
Die Verknüpfungen in ETB, Schaden, Chat und Dokumentablage verschwinden per `ON DELETE CASCADE`
(Migrationen 0052, 0116, 0125, 0126), die ETB-Einträge bleiben. Das Kartenhintergrundbild liegt
in einer eigenen Tabelle und ist nicht betroffen.

*Verworfen:*
- eine zweite, parallele Liste `KATEGORIE_REGELN`. Sie kann gegen `TABELLEN` driften, und ein
  Abgleich bräuchte einen eigenen Guard.
- ein eigenes Kategorie-Feld an `SpaltenRegel`. Dann trüge auch `Retain` eine Kategorie, die
  dort keinen Sinn hat.

### D2 Sperre als SQL-Projektion aus der Registry

Die fünf SELECT-Konstanten werden zu Funktionen. Sie bauen die Spaltenliste über
`schwaerzung_registry::sperr_projektion(tabelle, spalten, &sperre)` auf. Ist die Kategorie
einer Scrub-Spalte gesperrt, wird aus der Spalte der Wert, den die Strategie hinterließe, also
`NULL AS name` oder `'[geschwärzt]' AS text`. Sonst bleibt die Spalte unverändert. DTOs,
`FromRow` und Handler bleiben unverändert. Eine neue Scrub-Spalte einer Kategorie ist
automatisch mit gesperrt, sobald sie in der SELECT-Liste steht.

`KategorieSperre::laden(conn, einsatz_id, jetzt)` liest einmal je Anfrage die Kategoriezeilen
des Einsatzes. Eine Kategorie gilt als gesperrt, wenn der Einsatz abgeschlossen ist und
`gesperrt_at` gesetzt ist, `geschwaerzt_at` gesetzt ist oder `jetzt >= frist_bis` gilt. Das
ist dieselbe Grenze wie `retention_abgelaufen`, die Sperre wartet also nicht auf den Purge-Lauf.

Anhänge: `anhang_antwort` liefert 404, wenn der Anhang ein Bild ist und die Bildaufnahmen
gesperrt sind. Die vier Metadatenlisten filtern solche Zeilen weg. Das ist derselbe Zustand wie
nach der Schwärzung, wo die Zeilen fehlen.

*Verworfen:*
- Maskieren im Rust-DTO nach dem Laden. Das bräuchte eine handgepflegte Abbildung Spalte → Feld,
  die beim nächsten Feld still veraltet.
- Felder zurückhalten und ein `gesperrt`-Flag je Feld setzen. Jeder Client müsste es auswerten.
- 403 auf die ganze Person. Das sperrte auch Registriernummer und Sichtung.

### D3 Identität per Zeilenausdruck

„Behandelt“ heißt: Es gibt eine Zeile in `person_sichtung` oder `person_uhs_belegung`,
stornierte eingeschlossen, damit die Daten im Zweifel länger erhalten bleiben. Für die
Identitätsspalten gilt:

- Personenauskunft nicht gesperrt → die Spalte bleibt unverändert.
- Personenauskunft und Behandlung gesperrt → der Strategiewert.
- Nur Personenauskunft gesperrt → `CASE WHEN EXISTS(behandelt) THEN spalte ELSE NULL END`.

Hat die Behandlung keine Kategorie-Frist, gilt sie für diese Rechnung nie als gesperrt. Dann
behalten behandelte Personen ihre Identität bis zur Schwärzung des Einsatzes. Bei der Schwärzung
gilt dieselbe Regel als Zeilenfilter: Geschwärzt wird die Identität aller nicht behandelten
Personen, sobald die Personenauskunft geschwärzt wird. Die der behandelten Personen folgt erst
mit der zweiten der beiden Schwärzungen. Beides ist ein reiner Ausdruck über die
Kategoriezustände, deshalb braucht es dafür keinen eigenen Speicher.

### D4 Zwei Tabellen, Frist eingefroren beim Abschluss

Eine Migration, Nummer beim Umsetzen größer als jede auf `origin/alpha`
(`scripts/check-migrationen.sh`):

- `org_aufbewahrung_kategorie(org_id, kategorie, dauer_tage, rechtsgrundlage, geaendert_at,
  geaendert_von)` mit PK `(org_id, kategorie)` und CHECK auf `behandlung | personenauskunft |
  bildaufnahmen`. Eine Zeile gibt es nur, wenn eine Dauer eingestellt ist. Fehlt die Zeile, folgt
  die Kategorie der Einsatz-Frist.
- `einsatz_aufbewahrung_kategorie(einsatz_id → einsatz ON DELETE CASCADE, kategorie, dauer_tage,
  rechtsgrundlage, frist_bis, gesperrt_at, geschwaerzt_at)` mit PK `(einsatz_id, kategorie)`.
  Die Tabelle ist einsatzbezogen, die Registry führt sie also. Alle Spalten sind `Retain`: Die
  Rechtsgrundlage ist ein Text der Organisation, kein Personenbezug.

`repo::abschliessen` lädt die Org-Zeilen vor der Transaktion. Hat das Abschluss-UPDATE eine Zeile
getroffen, legt es je Kategorie eine Zeile mit `frist_bis = abgeschlossen_at + dauer_tage` an
(`berechne_retention_bis`). Danach schreibt es *einen* System-Eintrag ins ETB, der alle
Kategorien nennt, in derselben Transaktion wie die Einsatz-Frist.

*Verworfen:*
- die Frist bei jedem Lesen live aus der Org-Einstellung rechnen. Eine spätere Verkürzung in der
  Verwaltung schwärzte dann rückwirkend und unwiderruflich, ohne ETB-Spur am Einsatz.
- Spalten in `org_einstellungen`. Je Kategorie wären das zwei Spalten, und der handgepflegte
  Request-DTO `OrgEinstellungenUpdate` wüchse.

### D5 Purge: zwei neue Phasen, gleiche Muster

Nach Phase B laufen zwei neue Phasen:

- **A2**, Sperrvermerk. Sie betrifft Kategoriezeilen abgeschlossener, nicht geschwärzter
  Einsätze mit `jetzt >= frist_bis` und ohne `gesperrt_at`. Ein bewachtes UPDATE prüft die
  Fälligkeit erneut, `system_audit_tx` schreibt den ETB-Eintrag (fail-closed), alles in einer
  Transaktion.
- **B2**, Schwärzung. Sie betrifft `gesperrt_at <= karenz_grenze(jetzt)` ohne `geschwaerzt_at`.
  Ein bewachtes UPDATE setzt `geschwaerzt_at`, dann laufen
  `scrubbe_kategorie(conn, einsatz_id, kategorie, &zustaende)` und der ETB-Eintrag, alles in
  einer Transaktion. Eine Schwärzung in B2 zählt für den WAL-Rückschrieb wie eine in Phase B.

`scrubbe_kategorie` nutzt denselben SQL-Bau wie `scrubbe_aus_registry` (gemeinsamer Kern,
gefiltert nach Kategorie). Für `Identitaet` ergänzt sie den Zeilenfilter aus D3.

### D6 Zustand je Kategorie mit vorhandener Funktion

`retention::zustand(status, frist_bis, gesperrt_at, geschwaerzt_at, jetzt)` liefert den Zustand
je Kategorie unverändert. `geloescht_at` wird dabei zu `gesperrt_at`, und dieselben Grenzen
gelten. Ist der Einsatz selbst geschwärzt, gilt jede seiner Kategorien als `geschwaerzt`. Im
Frontend heißt der Wert `vorgemerkt` bei Kategorien „gesperrt“. Am Wire-Enum ändert sich
nichts.

### D7 Wiederherstellen einer Kategorie

Neue Route `POST /api/aufbewahrung/einsaetze/{id}/kategorien/{kategorie}/wiederherstellen` mit
`{ "frist_bis": string | null }`. Fehlt das Feld, antwortet sie mit 400 (`Option<Option<…>>`,
wie beim Wiederherstellen des Einsatzes).

- **Zugriff:** `fordere_archivzugriff` (fremde Org 403, unbekannt 404, aktiv 409).
- **Bewachtes UPDATE:** `gesperrt_at > karenz_grenze` und `geschwaerzt_at IS NULL`. Es setzt
  `gesperrt_at = NULL` und die neue `frist_bis`, wobei `NULL` „folgt der Einsatz-Frist“ heißt.
  Dazu kommt ein ETB-Eintrag mit dem Admin als Erfasser.
- **Fehler:** 422 bei fehlendem Sperrvermerk oder vergangener Frist, 409 bei abgelaufener Karenz
  oder geschwärzter Kategorie.
- **Guard:** `archiv_namensraum_nur_lesend_und_admin` bekommt die Route als zweite
  Schreibausnahme.

### D8 Org-Einstellung als eigene Route

`GET/PUT /api/org-einstellungen/aufbewahrung-kategorien` ist nur für `AdminUser`. Der PUT nimmt
die vollständige Liste mit drei Einträgen `{kategorie, dauer_tage | null, rechtsgrundlage}`,
validiert sie und ersetzt sie in einer Transaktion. Grenzen:

- `dauer_tage` liegt in `1..=3660`.
- `rechtsgrundlage` ist nach dem Trimmen nicht leer, wenn eine Dauer gesetzt ist, und höchstens
  500 Zeichen lang.

Auf der Seite `EinsatzDefaults.tsx` kommt in der Karte „Aufbewahrung“ ein Abschnitt
„Fristen je Datenkategorie“ dazu: je Kategorie Dauer, Rechtsgrundlage und Vorschlag mit
Übernehmen-Knopf. Die Vorschläge stehen als Konstante im Frontend:

| Kategorie | Vorschlag | Quelle |
| --- | --- | --- |
| Personenauskunft | 30 Tage | § 46 Abs. 6 BHKG (NRW), höchstens ein Monat |
| Behandlung | 3653 Tage | § 630f Abs. 3 BGB, Landesrettungsdienstgesetz |
| Bildaufnahmen | keine Zahl | Hinweis auf Art. 5 Abs. 1 lit. e DSGVO, Speicherbegrenzung nach Zweck |

Die Höchstdauer steigt für Einsatz, Org-Vorgabe und Kategorien auf 3660 Tage
(`ist_gueltige_retention_dauer`, beide Routen, beide Formulare): zehn Jahre haben bis zu 3653
Tage.

### D9 Anzeige

`GET /api/einsaetze/{id}/aufbewahrung/kategorien` läuft über `EinsatzLesezugriff` und liefert
die Kategoriezeilen mit `zustand` und `karenz_ende`, ohne Personenbezug. Zwei Stellen nutzen
die Route:

- `EinsatzAufbewahrung.tsx` zeigt sie als Tabelle unter der Einsatz-Frist.
- Die Personenansicht zeigt einen Hinweis, sobald Personenauskunft oder Behandlung gesperrt
  sind.

Die Archiv-DTOs bekommen `kategorien` in der Akte und in der Übersicht die Zahlen `gesperrt` und
`geschwaerzt`. Die Typen entstehen über den Typ-Codegen. Den Request-DTO der Org-Route pflegt
`frontend/src/api/types.ts` von Hand.

## Risks / Trade-offs

- **Offline-Cache.** Der Client hält die Personenliste bis zu 24 Stunden in IndexedDB
  (`LAGEBILD_OFFLINE`). Bei einer Kategorie-Frist von 1 Tag kann ein Gerät die Werte nach Ablauf
  der Frist noch kurz zeigen. Das ist dasselbe Restfenster wie bei der Sperre des Einsatzes,
  und die nächste Abfrage ersetzt den Stand. Gegenmittel: keins, die Grenze steht hier und in
  `src/AGENTS.md`.
- **Neuer Leseweg vergisst die Projektion.** Liest jemand später eine Personenspalte an der
  SELECT-Funktion vorbei, ist sie nicht gesperrt. Gegenmittel ist ein Ende-zu-Ende-Test: Er
  pflanzt eindeutige Werte in jede Kategorie-Spalte, sperrt die Kategorie und ruft alle Routen
  des Personenbereichs ab, die es für einen abgeschlossenen Einsatz gibt. Dazu kommt ein Test,
  dass nur die Funktionen die Tabelle mit ihren Kategorie-Spalten selektieren (grep-Guard wie
  bei `laden_bytes`).
- **Identität länger als erwartet.** Ist eine Person gesichtet und hat die Behandlung keine
  Frist, bleibt ihr Name bis zur Einsatz-Frist. Das ist gewollt (längster Zweck), steht aber im
  Hinweistext der Org-Einstellung.
- **Zwei Phasen mehr im Takt.** Die zusätzlichen Abfragen sind indexgestützt (PK
  `(einsatz_id, kategorie)`, Filter auf `frist_bis`/`gesperrt_at`) und laufen alle 10 Minuten.
  Das ist vernachlässigbar.

## Migration Plan

- Die Migration legt nur neue Tabellen an, Bestand bleibt unverändert. Ohne Org-Einstellung
  ändert sich nichts.
- Rückweg: Code zurückrollen. Die Tabellen bleiben stehen und werden nicht mehr gelesen. Eine
  schon erfolgte Kategorie-Schwärzung ist, wie jede Schwärzung, nicht umkehrbar.

## Open Questions

- Vorschlagswert für Bildaufnahmen: In der Recherche ist er nicht erhalten (die Tabelle des
  Kommentars kam leer an). Der Entwurf zeigt nur den Hinweis auf die Speicherbegrenzung. Eine
  Zahl mit Quelle lässt sich später in der Konstante nachtragen, ohne dass sich Spec oder
  Aufgaben ändern.
