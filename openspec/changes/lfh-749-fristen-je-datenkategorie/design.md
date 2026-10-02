# Design

## Context

Zur Motivation siehe proposal.md („Why“). Die Belege stehen in den beiden Kommentaren an
LFH-749 vom 02.10.2026, also in der Entscheidungsvorlage und in der Recherche.

So arbeitet die Aufbewahrung heute (LFH-135, LFH-229, LFH-23):

- **Frist:** Beim Abschluss entsteht `einsatz.retention_bis` aus der wirksamen Dauer
  (`einsatz::effektiv::effektive_retention_dauer_tage`: Einsatz vor Org, 1 bis 3650 Tage).
  Eine manuelle Frist setzt `PUT /api/einsaetze/{id}/aufbewahrungsfrist`.
- **Purge-Lauf:** `einsatz::purge_scheduler::tick_mit_rueckschrieb` läuft alle 10 Minuten in
  drei Phasen:
  - A: Vormerkung `geloescht_at` und Lesesperre.
  - B: nach `retention::KARENZ_TAGE` die Schwärzung über
    `schwaerzung_registry::scrubbe_aus_registry` und den Tombstone `geschwaerzt_at`.
  - C: Auth-Audit.

  Nach einer Schwärzung schreibt der Lauf den WAL zurück.
- **Registry:** Sie ist compile-time, je Spalte `Scrub(Strategie)` oder `Retain(Grund)`.
  Guard-Tests entdecken die einsatzbezogene Tabellenmenge selbst, und eine neue
  unklassifizierte Spalte färbt sie rot.
- **Audit:** Jede Mutation schreibt im selben Vorgang einen ETB-Systemeintrag. Im Purge-Lauf
  bestimmt `repo::system_audit_tx` über `ermittle_system_akteur` den Erfasser; ohne Akteur
  unterbleibt die Mutation.
- **Zustand:** `retention::zustand` leitet einen von sechs Werten ab.
  `aufbewahrung::repo::{uebersicht, akte}` und das Frontend (`frontend/src/aufbewahrung/`:
  `FristPaneel`, `ArchivAktePage`, `AufbewahrungUebersicht`) lesen ihn.
- **Schreibschutz:** Ein abgeschlossener Einsatz ist schreibgeschützt (409, `berechtigung`).
  Nach dem Abschluss entstehen also keine neuen Personen, Sichtungen oder Anhänge mehr. Das
  macht die Kategorie-Fristen stabil.

## Goals / Non-Goals

**Goals:**

- Kategorie-Schwärzung aus **derselben** Registry wie die Einsatz-Schwärzung. Ein zweiter
  Satz Spaltenlisten darf nicht entstehen.
- Verhalten für Bestandsdaten und für Organisationen ohne Kategorie-Dauer unverändert.
- Jede Kategorie-Frist trägt eine Rechtsgrundlage (Rechenschaftspflicht Art. 5 Abs. 2 DSGVO).

**Non-Goals:**

- **Feldweise Lesesperre während der Kategorie-Karenz.** Die Daten bleiben bis zur Schwärzung
  lesbar (s. D6).
- **Frei definierbare Kategorien je Organisation.** Die Zuordnung ist compile-time (s. D1).
- **Eigene Kategorie „Einsatzkräfte“.** Die Recherche fand nur Mindestfristen
  (DGUV V1 § 24 Abs. 6: 5 Jahre), keine Höchstfrist. Eine Mindestfrist begründet keine
  frühere Schwärzung. Stammkräfte sind außerdem Stammdaten und nicht einsatzbezogen.
- **Kartenhintergrund als Bildaufnahme.** `karte_hintergrundbild.daten` bleibt Retain
  (Kartografie-Skelett, LFH-229). Ein hochgeladenes Drohnen-Orthofoto fiele in Niedersachsen
  unter die Zwei-Monats-Frist (§ 32b Abs. 3 NKatSG). Das ist eine Klassifikationsfrage für
  ein Folgeticket (Aufgabe 8.3), keine Kategoriefrage.
- **Rückwirkende Kategorie-Fristen für schon abgeschlossene Einsätze.** Sie lassen sich am
  Einsatz manuell setzen (Requirement „Kategorie-Frist am Einsatz ändern“).
- **Endgültige Löschung des Skeletts.** Das bleibt ein eigenes Thema aus LFH-23.

## Decisions

### D1 Drei feste Kategorien plus Personenstamm

`behandlung`, `personenauskunft` und `anhaenge` sind ein Rust-Enum `Datenkategorie`
(Wire-Enum, gepinnt in `tests/enum_wire_kontrakt.rs`). Jede Scrub-Spalte gehört genau einer
`Zuordnung` an: `Kategorie(Datenkategorie)`, `Personenstamm` oder `Einsatz`.

- **Warum fest im Code:** Die Registry ist compile-time und von Guard-Tests bewacht. Frei
  definierbare Kategorien bräuchten eine Laufzeit-Zuordnung von Spalten, die keine Guard
  prüft. Eine neue Kategorie ist eine Code-Änderung mit Review, und das ist gewollt.
- **Warum diese drei:** Nur hier gibt es eine belegte Höchstfrist oder eine belegte, von der
  Einsatz-Frist abweichende Praxis (Recherche, Tabelle „Befund je Kategorie“).
  „Bildaufnahmen“ aus der Entscheidungsvorlage heißt hier `anhaenge`, weil die Tabelle `anhang`
  alle Dateien trägt: Fotos Betroffener, Dokumente, Chat- und ETB-Anhänge. Eine Trennung nach
  MIME-Typ wäre unscharf.
- **Verworfen:** vier Kategorien mit „Einsatzkräfte“ (s. Non-Goals); eine Kategorie je Modul
  (zu feinkörnig, ohne Rechtsgrund).

**Zuordnung im Einzelnen** (Spalten wie in der Registry):

| Zuordnung | Spalten |
|---|---|
| `behandlung` | `einsatz_person.zustand`, `person_sichtung.notiz`, `person_verlaufsnotiz.text`, `person_uhs_belegung.notiz` |
| `personenauskunft` | `einsatz_person.herkunft_adresse`, `einsatz_person.melder_kontakt` |
| `anhaenge` | `anhang.*`, `einsatz_dokument.*`, `einsatz_schaden_anhang.*` (alle `ZeileLoeschen`) |
| Personenstamm | `einsatz_person.{name, vorname, geschlecht, geburtsdatum, alter_geschaetzt, antreff_ort, antreff_lat, antreff_lon, notiz, aktueller_verbleib, aktuelles_verbleib_ziel}`, `person_verbleib.{transportmittel, ziel, notiz}` |
| Einsatz | alle übrigen Scrub-Spalten, auch `lage_snapshot` (eingefrorenes Lagebild, kein Anhang) |

- **Antreffort und Verbleib im Personenstamm:** Beide brauchen beide Zwecke. Die
  Personenauskunft braucht den Verbleib („wo ist mein Angehöriger“), die
  Behandlungsdokumentation Fundort und Zielklinik.
- **Personennotiz im Personenstamm:** Sie ist Freitext ohne festen Zweck und bleibt deshalb
  konservativ so lange wie der längste Zweck.

### D2 Zuordnung im Typ von `Klassifikation::Scrub`

`Klassifikation::Scrub(Strategie)` wird `Scrub(Strategie, Zuordnung)`. Der Helfer `scrub(spalte,
strategie)` entfällt zugunsten von `scrub(spalte, strategie, zuordnung)`. Eine Scrub-Spalte
ohne Zuordnung **kompiliert nicht** — stärker als der Guard-Test, den die Spec verlangt. Der
Guard-Test bleibt trotzdem und pinnt die Tabelle aus D1 (jede Kategorie-Spalte namentlich),
damit eine stille Umhängung auffällt.

- **Verworfen:** eine getrennte Konstante `KATEGORIE_ZUORDNUNG` mit Vorgabe `Einsatz`. Sie
  kostet weniger Diff, aber eine neue Spalte landete still bei `Einsatz`. Für
  Gesundheitsdaten wäre das die falsche Stelle für einen stillen Default.

`scrubbe_aus_registry` bekommt einen Filter `Umfang`: `Alles` (Einsatz-Schwärzung, Verhalten
unverändert) oder `Kategorie(k)` (nur Spalten dieser Kategorie). Der Personenstamm hat einen
eigenen Schritt (D3).

### D3 Personenstamm nach Zwecken

Der Personenstamm wird nie direkt über eine Frist geschwärzt, sondern als Folgeschritt jeder
Kategorie-Schwärzung, im selben atomaren Vorgang:

```
nach Schwärzung von K:
  auskunft_weg    = personenauskunft geschwärzt
  behandlung_weg  = behandlung geschwärzt
  wenn auskunft_weg und behandlung_weg  -> Personenstamm aller Personen
  sonst wenn auskunft_weg               -> Personenstamm der Personen OHNE Behandlungsbezug
  sonst                                 -> nichts
```

- **Behandlungsbezug** (SQL-Prädikat auf `einsatz_person`): `EXISTS person_sichtung OR EXISTS
  person_verlaufsnotiz OR EXISTS person_uhs_belegung OR zustand IS NOT NULL`, ohne
  `storniert_at`-Filter. Sichtungs-, Verlaufs- und Belegungszeilen bleiben über jede
  Schwärzung erhalten (ihre Kategorie- und Zeitspalten sind Retain). Deshalb bleibt das
  Prädikat stabil, auch wenn `behandlung` `zustand` leert.
- **Zeilenfilter:** Je Personenstamm-Tabelle braucht die Registry, über welche Spalte die
  Person erreicht wird (`einsatz_person.id`, `person_verbleib.person_id`). Das wird ein
  optionales Feld `person_bezug` an `TabellenRegel`.
- **Ohne Frist:** Hat `personenauskunft` keine eigene Frist, folgt sie der Einsatz-Frist. Der
  Personenstamm bleibt dann bis zur Einsatz-Schwärzung, die ihn wie bisher mitnimmt.
- **Verworfen:** die Identität als vierte Kategorie mit eigener Frist. Die Organisation müsste
  dann von Hand „die längste“ wählen und läge bei einem Fehler falsch. Die Regel ergibt sich
  aus dem Zweck und braucht keine Einstellung.

### D4 Datenmodell (Migration 0135, Nummer vor dem Merge gegen `origin/alpha` prüfen)

```sql
CREATE TABLE org_aufbewahrung_kategorie (
  org_id          INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
  kategorie       TEXT    NOT NULL,          -- validiert in Rust (kein CHECK, s. 0069)
  dauer_tage      INTEGER NOT NULL,          -- 0..=3650, validiert in Rust
  rechtsgrundlage TEXT    NOT NULL,
  geaendert_at    TEXT    NOT NULL,
  geaendert_von   INTEGER REFERENCES benutzer(id),
  PRIMARY KEY (org_id, kategorie)
);
CREATE TABLE einsatz_aufbewahrung_kategorie (
  einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
  kategorie       TEXT    NOT NULL,
  frist_bis       TEXT,                      -- NULL = aufgehoben, folgt der Einsatz-Frist
  rechtsgrundlage TEXT    NOT NULL,
  vorgemerkt_at   TEXT,
  geschwaerzt_at  TEXT,
  PRIMARY KEY (einsatz_id, kategorie)
);
```

- **Existenz der Zeile:** Eine Zeile gibt es nur, wenn eine Dauer gesetzt bzw. eine Frist
  entstanden ist. Fehlt sie, bedeutet das „keine Dauer“ bzw. `ohne_frist`.
- **Warum Tabellen statt Spalten:**
  - Drei Kategorien mal vier Spalten an `einsatz` wären zwölf Spalten.
  - Eine vierte Kategorie wäre wieder eine Migration.
  - Ein CHECK auf `kategorie` ließe sich später nur per Rebuild ändern (sqlx-sqlite, vgl.
    Kommentar in 0069).
- **Registry:** `einsatz_aufbewahrung_kategorie` ist einsatzbezogen. Die Guard-Tests entdecken
  sie, deshalb bekommt sie eine Registry-Regel mit nur Retain-Spalten.
  - Die Rechtsgrundlage ist ein Org-Text ohne Personenbezug.
  - Die Zeitstempel sind Aufbewahrungsstruktur und müssen die Schwärzung überleben, damit die
    Archivakte sie zeigt.
- **`org_aufbewahrung_kategorie`:** Sie ist org-bezogen und nicht Teil der Menge S.
- **Rechtsgrundlage je Einsatz als Kopie:** Beim Abschluss wird sie aus der Org kopiert. So
  bleibt die Begründung im ETB und in der Akte stabil, auch wenn die Org sie später ändert.
- **Manuelle Frist ohne Zeile:** Setzt jemand die Frist an einer Kategorie ohne Zeile,
  **muss** die Anfrage eine Rechtsgrundlage mitbringen (sonst 422, Spec-Szenario „Erste Frist
  ohne Rechtsgrundlage“). So bleibt die Invariante aus den Goals gewahrt.

### D5 Purge-Lauf: Phasen K1 und K2

Zwischen Phase A und B laufen zwei neue Phasen, mit derselben Zeitrechnung (`KARENZ_TAGE`,
`karenz_abgelaufen`):

- **K1 Vormerkung:**
  - Betroffen sind Zeilen mit `frist_bis <= jetzt`, `vorgemerkt_at IS NULL` und
    `geschwaerzt_at IS NULL` an abgeschlossenen, nicht geschwärzten Einsätzen.
  - Der bewachte UPDATE und der ETB-Eintrag über `system_audit_tx` laufen in einer
    Transaktion.
  - Ohne Akteur gilt dieselbe Regel wie bisher: kein UPDATE, Fehler im Log, nächster Lauf.
- **K2 Schwärzung:**
  - Betroffen sind vorgemerkte Zeilen mit abgelaufener Karenz und `geschwaerzt_at IS NULL`.
  - In einer Transaktion laufen: Tombstone setzen (bewacht, `rows_affected == 0` → fertig),
    `scrubbe_aus_registry(Umfang::Kategorie(k))`, Personenstamm-Schritt (D3), ETB-Eintrag mit
    Kategorie, Rechtsgrundlage und dem, was bleibt.
  - Danach meldet der Lauf `rueckschrieb_ausstehend = true`.
  - Er publiziert `LiveEvent::Person`, `Dokument` bzw. `Schaden`, `Chat` und `Etb` über
    `LiveHub::publiziere_einsatz`. Offene Clients laden dann neu und tragen keinen Altstand
    weiter.
- **K2 an gesperrten Einsätzen:** K2 läuft auch, wenn der Einsatz vorgemerkt ist (Spec
  „Zusammenspiel“). Eine Kategorie darf nicht länger liegen, nur weil der Einsatz gesperrt
  wurde.
- **Phase B (Einsatz-Schwärzung):** Sie setzt zusätzlich `geschwaerzt_at` an allen
  Kategorie-Zeilen des Einsatzes, die noch keins tragen. Die Zustandsableitung (D7) zeigt sie
  ohnehin als `geschwaerzt`, aber so stimmt die Datenbank selbst.

Die Reihenfolge K1 → K2 vor B ist egal für die Korrektheit (alles idempotent), hält aber das
ETB lesbar: Kategorien erscheinen vor der Einsatz-Schwärzung.

### D6 Keine feldweise Lesesperre in der Kategorie-Karenz

Abweichend vom ersten Entwurf („Sperre und Schwärzung je Kategorie“) bleiben die Daten einer
vorgemerkten Kategorie bis zur Schwärzung über alle Routen lesbar.

- **Grund 1 — Aufwand:** Eine feldweise Sperre müsste in jedem Lesepfad greifen, und das sind
  viele:
  - Personenliste und -detail, Export, Druck, Live-Strom;
  - Lagekarte, Sprungpalette und Suche;
  - Offline-Speicher (Lagebild-Registry, `frontend/src/offline/AGENTS.md`).

  Jeder Pfad, der die Sperre vergisst, wäre ein stilles Datenleck.
- **Grund 2 — kein Rechtsbedarf:** Die Sperre aus § 46 Abs. 6 BHKG zielt auf Daten, die
  *länger* gebraucht werden. Genau das leistet der Personenstamm (D3): Was die
  Behandlungsdokumentation braucht, bleibt; der Rest geht.
- **Karenz:** Sie bleibt als Sicherheitsnetz gegen eine falsch eingestellte Dauer. Die
  Vormerkung steht im ETB und im Zustand, und eine neue Frist hebt sie auf.
- **Folge für Organisationen mit Höchstfrist:** Wer eine Höchstfrist einhalten muss, wählt die
  Dauer so, dass Dauer plus 30 Tage Karenz darunter liegt. Für NRW (ein Monat) heißt das:
  Dauer 0. Deshalb erlaubt die Kategorie-Dauer 0, anders als die Einsatz-Dauer (1 bis 3650).
- **Offline-Speicher:** Er hält höchstens 24 h (`lagebildDehydrierOptionen`), danach ist ein
  geschwärzter Altstand vom Gerät verschwunden.
- **Verworfen:** Sperre über Serialisierung (Felder in jedem DTO ausblenden). Das hat dieselbe
  Breite und ist noch schwerer zu prüfen.

### D7 Zustand und Anzeige

`retention::zustand` bleibt die eine Zeitrechnung. Für eine Kategorie wird sie mit
`(status, frist_bis, vorgemerkt_at, geschwaerzt_at)` aufgerufen. Ist der Einsatz geschwärzt,
gilt `geschwaerzt` ohne Ausnahme. Ohne Zeile gilt `ohne_frist`.

Ein DTO `KategorieAufbewahrungAnzeige { kategorie, frist_bis, vorgemerkt_at, karenz_ende,
geschwaerzt_at, rechtsgrundlage, zustand, dauer_tage_vorgabe }` erscheint an drei Stellen:

- als Antwort von `GET /api/einsaetze/{id}/aufbewahrung-kategorien`, die `FristPaneel` liest;
- als Antwort des Kategorie-PUT (D8);
- in `ArchivAkteAnzeige` als Liste `kategorien`.

Eine eigene Route statt eines Felds im Einsatz-DTO: `EinsatzAnzeige` entsteht synchron an
vielen Stellen (Detail, Liste, Patch, Frist-PUT), die Kategorie-Liste braucht aber eigene
Abfragen (Zeilen, Org-Vorgabe). Rechte wie der Frist-PUT, ergänzt um jeden, der den Einsatz
lesen darf; beide Routen stehen begründet in `ORG_FLOOR_AUSNAHME`
(`tests/einsatz_kontext_guard.rs`).

`dauer_tage_vorgabe` trägt bei aktiven Einsätzen die Org-Vorgabe für den Hinweis aus der Spec.
Die Übersicht bleibt unverändert, denn eine Zeile je Einsatz reicht dort, und die Akte führt
in die Details.

### D8 API

- **Org-Einstellungen:** Das Admin-DTO bekommt `aufbewahrung_kategorien: [{kategorie,
  dauer_tage, rechtsgrundlage}]`.
  - `PUT` ersetzt die Liste, wenn das Feld mitkommt. Fehlt das Feld, bleibt alles, wie es ist
    (Muster der übrigen Felder).
  - Eine Kategorie fehlt in der Liste → ihre Zeile wird gelöscht.
  - Die Validierung erfolgt je Eintrag nach der Statuscode-Konvention (`src/AGENTS.md`): Dauer
    außerhalb 0 bis 3650 oder Rechtsgrundlage über 500 Zeichen → 400 (das Feld für sich); leere
    Rechtsgrundlage bei gesetzter Dauer → 422 (der Zusammenhang).
  - Unbekannte Kategorie → 400 (Muster unbekannter Enum-Werte).
- **Einsatz:** `PUT /api/einsaetze/{id}/aufbewahrungsfrist/{kategorie}` mit `{ retention_bis,
  bestaetigt, rechtsgrundlage? }`.
  - Der Endpunkt spiegelt den bestehenden Handler `aufbewahrungsfrist_setzen`, samt
    `ist_fristverkuerzung` und `frist_sperre`.
  - Zusätzlich gilt: aktiver Einsatz → 409; Kategorie in der Karenz → eine künftige Frist hebt
    `vorgemerkt_at` auf; nach der Karenz bzw. nach ihrer Schwärzung → 409.
- **Typen:** Beide DTO-Änderungen und der neue Wire-Enum laufen durch
  `scripts/check-typ-codegen.sh` (`src/AGENTS.md`).

### D9 Frontend

- **Org-Einstellungen, Abschnitt Aufbewahrung** (`pages/einstellungen/`, neben der
  Aufbewahrungsdauer):
  - je Kategorie eine Zeile mit kurzer Beschreibung der Daten, Dauer und Rechtsgrundlage;
  - darunter ein Vorschlag mit Quelle als Text, nicht als Wert (Spec: nicht vorbelegt);
  - Hinweis, wenn die Dauer die Aufbewahrungsdauer der Organisation übersteigt.

  Vorschläge:
  - `behandlung`: 3650 Tage, § 630f Abs. 3 BGB entsprechend, DRK-LV Saarland;
  - `personenauskunft`: 0 Tage, § 46 Abs. 5 BHKG NRW;
  - `anhaenge`: 30 Tage, § 32b Abs. 3 NKatSG für Drohnenbilder.

  Die Texte liegen an einer Stelle (`aufbewahrung/kategorieText.ts`) mit Test.
- **`FristPaneel`:** Unter der Einsatz-Frist steht je Kategorie eine Zeile mit Zustand als
  Statusetikett mit Wort, Frist und Rechtsgrundlage. Die Aktion nutzt dieselbe
  Rückfrage-Mechanik.
- **Archivakte:** Sie zeigt einen Block „Datenkategorien“, nur lesend.
- Gestaltungs- und Bedienregeln aus `frontend/AGENTS.md` gelten.

## Risks / Trade-offs

- **[Falsch eingestellte Dauer schwärzt zu früh, unumkehrbar]:**
  - Keine Vorgabewerte, Rechtsgrundlage Pflicht.
  - Beim Abschluss nennt ein ETB-Eintrag jede Kategorie-Frist.
  - 30 Tage Karenz mit sichtbarem Zustand; eine neue Frist hebt die Vormerkung auf.
- **[Personenstamm-Prädikat erfasst einen Behandlungsbezug nicht]:** Dann verlöre eine
  behandelte Person ihre Identität mit der Personenauskunft.
  - Das Prädikat ist bewusst weit (auch stornierte Zeilen, auch Sichtung „unverletzt“).
  - Ein Test pflanzt je Bezugsart eine Person und prüft, dass ihr Stamm bleibt.
  - Ein Guard-Test listet die Tabellen mit `person_id`-FK und schlägt an, wenn eine neue
    Tabelle mit Gesundheitsbezug hinzukommt, ohne im Prädikat zu stehen.
- **[Teilgeschwärzter, lesbarer Einsatz verwirrt]:** Ein Name ist da, die Adresse zeigt
  „[geschwärzt]“ bzw. ist leer. Abhilfe: Der ETB-Eintrag der Kategorie-Schwärzung und der
  Zustand im Paneel erklären es. Eigene Hinweise in den Personenmasken sind nicht vorgesehen
  (Folgeticket, falls es im Feld stört).
- **[Kategorie-Schwärzung während laufender Lesezugriffe hält den WAL fest]:** Dieselbe Mechanik
  wie bei Phase B: Der Rückschrieb wird wiederholt, bis er gelingt.
- **[Migrationsnummer kollidiert]:** `scripts/check-migrationen.sh` gegen `origin/alpha` vor
  dem Push, Umlegen mit `--umnummerieren` (Wurzel-`AGENTS.md`).

## Migration Plan

- **Rein additiv:** zwei neue Tabellen, keine Änderung bestehender Spalten. Ohne
  Kategorie-Dauer verhält sich alles wie vorher (Abschluss erzeugt keine Zeilen; K1 und K2
  finden nichts).
- **Rückweg:** Kategorie-Dauern in der Organisation entfernen. Bereits geschwärzte Kategorien
  sind, wie jede Schwärzung, nicht umkehrbar. Das ist der Zweck.

## Open Questions

- Die Texte der Vorschläge in D9 sind Arbeitsstand und dürfen sich bis zum Merge ändern. Sie
  belegen keine Vorgabe und ändern weder Spec noch Aufgabenschnitt.
