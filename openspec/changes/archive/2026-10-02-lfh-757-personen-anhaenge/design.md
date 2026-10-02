# Design

## Context

Anlass und Umfang stehen in `proposal.md`, die Anforderungen in
`specs/personen-anhaenge/spec.md` und `specs/anhang-metadaten/spec.md`. Hier steht der Stand,
der den Weg vorgibt (gemessen am 02.10.2026 auf `origin/alpha` `da9bfe1c`, höchste Migration
`0134`).

- **Muster LFH-21** (`openspec/changes/archive/2026-09-29-lfh-21-schaden-anhaenge/design.md`):
  Linker `einsatz_schaden_anhang` (0126) mit Soft-Delete am Linker, `anhang_id UNIQUE … ON
  DELETE CASCADE`; Register `anhang::repo::MODUL_LINKER` mit drei Einträgen (Dokument, ETB,
  Schaden) samt Guard `jeder_fremdschluessel_auf_anhang_ist_registriert`; Prüfkette
  `anhang::pruefe_vor_persist` und Allowlist `ERLAUBTE_MIME_ERFASSUNG` (schon modulneutral
  benannt „für Personen, Tiere und UHS“). Domäne in `src/schaden/anhang.rs` (`liste`, `laden`,
  `anhang_id_fuer_download`, `ablegen`, `entfernen`, `etb_text`), Routen in
  `src/routes/schaden_anhang.rs` (`genau_eine_datei`, Reihenfolge Gate → Objekt → Storno →
  Datei → Prüfkette → eine Transaktion).
- **Auslieferung LFH-747:** `routes::support::anhang_antwort(pool, anhang_id, headers,
  Fassung)` mit `FassungParam`; die bereinigte Fassung trägt `Cache-Control: private,
  no-cache` und ein ETag, das Original `no-store` ohne ETag. Vor `Fassung::Original` ruft der
  Handler `support::original_freigeben` (Einsatzleitung oder Admin der Org, sonst 403; danach
  System-ETB-Vermerk „Originaldatei … abgerufen: {ablage}, Anhang #{id}“).
- **Personen-Modul:** Routen in `src/routes/einsatz_person.rs` tragen bereits
  `EinsatzLesezugriff<Personen>`/`EinsatzSchreibzugriff<Personen>` (Marker `Personen`,
  `PFAD_KEY` `/api/einsaetze/{id}/personen`). Die Person wird nie hart gelöscht, nur storniert
  (`storniert_at`); `person::repo::laden`/`laden_tx` laden auch stornierte und scopen über
  `einsatz_id`. `person::registrier_anzeige(7)` = „R-007“. ETB-Texte der Personen sind
  pseudonym („Person R-007 storniert“). Live: `LiveEvent::Person` (Modulfilter `personen`) über
  `sse_person` (heute `pub(super)`).
- **Lese-Audit:** `person_zugriff_audit` (0021, Rebuild 0132 für `druck`) ist append-only und
  Leaf, `art CHECK IN ('detail','export','druck')`, Spalten `id, einsatz_id, person_id,
  benutzer_id, art, zugriff_at`. Geschrieben über `person::audit_repo::anlegen(pool, einsatz,
  Option<person>, benutzer, art)`; gelesen von `liste_je_person` (Einsicht nur für die
  Einsatzleitung). `ZugriffArt` ist der Schema-Anker für die Wire-Union (Codegen LFH-120).
  Die Schwärzung hält alle Spalten (`retain`, `G_AUDIT`). Netz des Rebuilds:
  `db::tests::migration_0132_*` gegen eine 0021-Alt-DB.
- **Frontend:** `pages/schaeden/SchadenAnhaenge.tsx` (Paneel, Liste mit `DownloadAnker`,
  Original-Verweis über `useDarfOriginalLaden`/`originalPfad`, Entfernen mit `Popconfirm` und
  Fokusführung, `data-lfh="schaden-anhang-zeile"`) und `SchadenAnhangAblegenModal.tsx`
  (`ErfassungsModal` mit `serie`, `DateiFeld`, `ERFASSUNG_ACCEPT`). Die Personen-Detailseite
  lädt beim Öffnen nur Einsatz und Detail; Zuordnungen und Audit hängen als
  `Collapse`-Abschnitte am Aufklappen („Ladehoheit“). Der Detail-Key `person` steht in
  `NICHT_LIVE_KEYS`, weil jeder Detail-GET eine Audit-Zeile schreibt. Das Lagebild offline
  persistiert nur eine Allowlist (`istLagebildOfflineKey`).

## Goals / Non-Goals

**Goals:**

- Personen-Anhänge entstehen nach dem Muster der Schaden-Anhänge, mit einem einzigen
  zusätzlichen Kern: dem Lese-Audit je Download.
- Kein Weg liefert die Bytes einer Personen-Datei aus, ohne dass vorher eine Audit-Zeile steht.
- Ein Live-Ereignis, eine Liste und der Detail-Abruf erzeugen keine zusätzlichen Audit-Zeilen.
- Der Anhang-Block im Frontend existiert einmal und wird von Schaden und Person benutzt.

**Non-Goals:**

- **Kein Dateibezug im Audit** (Entscheidung des Menschen, 02.10.2026): die Zeile nennt Person
  und Art, nicht welche Datei. Der Rebuild ändert nur den CHECK.
- **Kein strengeres Leserecht** als die Detailansicht: Beobachter mit Modul Personen sehen und
  laden (Entscheidung 02.10.2026); das Audit ist der Ausgleich.
- Keine Vorschau/Thumbnails (LFH-759), keine Anhänge im Personendruck oder CSV-Export, kein
  Offline-Upload, keine `client_id`-Idempotenz (Begründung wie LFH-21 D5).
- Keine Anhänge an Tieren oder UHS. Der geteilte Frontend-Baustein bereitet sie vor, das
  Backend bekommt keinen generischen Linker (LFH-21 D1, verworfen: polymorphe Tabelle).
- Keine Umstellung der bestehenden Schadensrouten.

## Decisions

### D1 — Linker `einsatz_person_anhang` (Migration 0135)

Rein additiv, Spiegel von 0126:

```sql
CREATE TABLE einsatz_person_anhang (
    id               INTEGER PRIMARY KEY,
    einsatz_id       INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    person_id        INTEGER NOT NULL REFERENCES einsatz_person(id) ON DELETE CASCADE,
    anhang_id        INTEGER NOT NULL UNIQUE REFERENCES anhang(id) ON DELETE CASCADE,
    abgelegt_von_id  INTEGER NOT NULL REFERENCES benutzer(id),
    abgelegt_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    geloescht_at     TEXT,
    geloescht_von_id INTEGER REFERENCES benutzer(id),
    CHECK ((geloescht_at IS NULL) = (geloescht_von_id IS NULL))
);
CREATE INDEX idx_einsatz_person_anhang_person
    ON einsatz_person_anhang(person_id, abgelegt_at);
```

Begründungen wie LFH-21 D1 (eine Datei je Person, CASCADE von `anhang` für die Schwärzung,
`einsatz_id` direkt am Linker, Soft-Delete am Linker, Einsatzgleichheit durch Bau). Die
CASCADE von `einsatz_person` ist ehrlich, weil Personen nur mit dem Einsatz hart
verschwinden. **Wichtig für 0136:** die neue Tabelle verweist auf `einsatz_person`, nicht auf
`person_zugriff_audit`; das Audit bleibt Leaf, der Rebuild braucht weiter keinen
`foreign_keys`-Toggle.

Registereintrag (vierter in `MODUL_LINKER`):

```rust
ModulLinker { tabelle: "einsatz_person_anhang",
              loesch_meldung: "Anhang gehört zu einer Person und wird dort entfernt",
              ort: "Person" },
```

Damit gelten Sweep, generischer Download (404), generisches Löschen (422), Chat-Sperre (400)
und ETB-Sperre (422) ohne Handarbeit. `gebunden_meldung()` lautet danach „Anhang ist bereits
gebunden (Chat-Nachricht, Dokumentenablage, ETB-Eintrag, Schaden oder Person)“; der Pin in
`tests/etb_anhang.rs` zieht nach.

### D2 — Audit-Art `anhang` per Rebuild (Migration 0136)

Eigene Datei, weil `-- no-transaction` für die ganze Datei gilt und 0135 eine normale
Transaktion verträgt. Inhalt: 0132 wörtlich, nur `CHECK (art IN
('detail','export','druck','anhang'))` und der Kopfkommentar (LFH-757, Schema = 0132 1:1).
Muster: Zwischentabelle, Kopie mit ids, `sqlite_sequence` vor dem `DROP` umhängen, `RENAME`,
No-op-`UPDATE`, Index neu.

*Verworfen:* **Dateibezug als Spalte** (`person_anhang_id … ON DELETE SET NULL`), vom Menschen
abgelehnt. Er hätte die Einsicht um den Dateinamen erweitert, also genau den Freitext in ein
Protokoll gezogen, das die Schwärzung behält. **`art = 'detail'` für Downloads** ohne
Rebuild: verwischt, ob jemand die Person geöffnet oder ein Foto geladen hat.

`ZugriffArt` bekommt `Anhang` (Wire `anhang`, Kommentar mit Migration 0136); der Kommentar am
Enum nennt 0136 als Quelle des CHECK. Codegen zieht `openapi.json` und `types.generated.ts`
nach.

**Netz:** `db::tests::migration_0136_*` nach dem Muster der 0132-Tests, aber gegen eine Alt-DB
im **0132-Stand** (0021 und dann 0132 einspielen): Zeilen aller drei Bestandsarten samt ids
erhalten, Sequenz erhalten (auch bei leerer Tabelle), Schema unverändert, DDL unterscheidet
sich nur in `,'anhang'`, CHECK nimmt `anhang` und lehnt `foo` ab, `foreign_key_check` leer.
Die bestehende 0132-Hilfe `alt_db_person_zugriff_audit` wird dafür um einen Parameter oder
eine zweite Hilfe ergänzt, nicht kopiert.

### D3 — Audit vor jeder Auslieferung, nach jeder Abweisung

Reihenfolge im Download-Handler `routes::person_anhang::datei`:

1. Extractor `EinsatzLesezugriff<Personen>` (403/409-Regeln des Moduls),
2. `FassungParam::fassung()` (400),
3. Linker-Lookup `WHERE id = ? AND person_id = ? AND einsatz_id = ? AND geloescht_at IS
   NULL` (404) — er ist die Zugriffsprüfung,
4. bei `Fassung::Original`: `original_freigeben(…, "Person R-007")` (403 ohne Vermerk, sonst
   ETB-Vermerk),
5. **`audit_repo::anlegen(pool, einsatz, Some(person_id), benutzer, "anhang")`** — scheitert
   er, endet der Handler mit dem Fehler, ohne Bytes,
6. `anhang_antwort(…)` (200, 304 oder 422 bei nicht bereinigbarem Bild).

Damit protokolliert jede Antwort, die Bytes **oder** die Bestätigung des Cache-Stands liefert
(200, 304), und keine Abweisung aus Schritt 1–4. Ein 422 aus Schritt 6 trägt eine Zeile: der
Zugriff war berechtigt und versucht, er wird nicht nachträglich gelöscht (append-only). Das
steht als bewusste Grenze unter Risks.

**Warum auch 304:** die bereinigte Fassung trägt `no-cache`, also fragt der Browser bei jedem
Öffnen nach; ein 304 bedeutet „die Person sieht das Foto jetzt aus dem Cache“. Ohne Zeile wäre
der zweite Blick auf dasselbe Patientenfoto unprotokolliert (Entscheidung 02.10.2026).

**Nicht in derselben Transaktion wie der Original-Vermerk:** `original_freigeben` schreibt über
den Pool (geteilt mit vier Routen). Scheitert die Audit-Zeile danach, steht ein ETB-Vermerk
ohne Auslieferung. Das ist Über-Protokollierung, kein Leck, und den geteilten Helfer für eine
Route umzubauen, lohnt nicht.

*Verworfen:* **Audit nach der Auslieferung** (Middleware/Response-Hook) — ein abgebrochener
Client oder ein Fehler beim Schreiben ließe Bytes ohne Zeile zurück; das Detail schreibt aus
demselben Grund vorher (`einsatz_person::detail`). **Audit in `anhang_antwort`** — der Helfer
ist modulneutral und kennt keine Person.

### D4 — Domäne `src/person/anhang.rs` und Routen `src/routes/person_anhang.rs`

Spiegel von `schaden/anhang.rs` und `routes/schaden_anhang.rs`:

| Methode | Pfad | Gate | Layer | Antwort |
|---|---|---|---|---|
| GET | `/api/einsaetze/{id}/personen/{pid}/anhaenge` | `EinsatzLesezugriff<Personen>` | — | 200 `Vec<PersonAnhangAnzeige>` |
| POST | `…/personen/{pid}/anhaenge` | `EinsatzSchreibzugriff<Personen>` | `DefaultBodyLimit::max(26 MiB)` | 201 `PersonAnhangAnzeige` |
| GET | `…/personen/{pid}/anhaenge/{aid}/datei` | `EinsatzLesezugriff<Personen>` | `ConcurrencyLimitLayer(MAX_GLEICHZEITIGE_ASSET_DOWNLOADS)` | Datei, ETag/304, Audit |
| DELETE | `…/personen/{pid}/anhaenge/{aid}` | `EinsatzSchreibzugriff<Personen>` | — | 204 |

- `{aid}` ist die Linker-id; `PersonAnhangAnzeige` trägt `person_id` statt `schaden_id`, sonst
  dieselben Felder wie `SchadenAnhangAnzeige`.
- Storno-Prüfung vor dem Lesen der Datei und erneut in der Transaktion (`person::repo::laden_tx`).
  Personenstatus (vermisst, abgemeldet, verstorben) sperrt nichts.
- `etb_text(registrier_nr, mime, Vorgang)` → „Person R-007: Foto|PDF|Datei abgelegt|entfernt“,
  aus dem serverseitig ermittelten MIME.
- `genau_eine_datei` wird nicht kopiert: die Funktion zieht aus `routes/schaden_anhang.rs` nach
  `routes/support.rs` (`pub(crate)`, unverändert) und beide Routendateien rufen sie. Ebenso
  bekommt `Vorgang` einen gemeinsamen Ort (`anhang::Vorgang`) und `etb_text` die Art-Ableitung
  aus einer geteilten Funktion `anhang::erfassung_art(mime)` („Foto“, „PDF“, „Datei“); der
  Präfix („Schaden S-003“, „Person R-007“) bleibt beim Modul. Die Repo-Funktionen bleiben je
  Modul, weil Tabelle, Objektspalte und Storno-Regel verschieden sind.
- **Die Liste schreibt kein Audit** (Spec „Liste ohne Protokolleintrag“), auch wenn sie
  Dateinamen trägt. Begründung: der Block hängt im aufgeklappten Abschnitt der Detailseite,
  und deren Öffnen ist bereits protokolliert; Listen-Reads werden projektweit nicht auditiert
  (0021-Kopf, SSE-Refetch-Lärm).
- Live nach dem Commit: `state.live.publiziere(einsatz_id, etb_id)` und `sse_person`
  (`pub(super)` → `pub(crate)`), keine Kopie. Die neue Routendatei steht nicht in
  `DEFERRED_MODULE`; der Struktur-Guard erzwingt Gate und Marker.
- Original-Vermerk: `ablage = format!("Person {}", registrier_anzeige(nr))`. Der Vermerk nennt
  damit die Registriernummer, keinen Namen.

### D5 — Schwärzung

`TabellenRegel` `einsatz_person_anhang`, `Scoping::EinsatzId`, alle acht Spalten
`ZeileLoeschen`, in `TABELLEN` nach `anhang` (wie `einsatz_schaden_anhang`); der Kommentar an
der `anhang`-Regel nennt den fünften Linker. `person_zugriff_audit` bleibt unverändert retain
(die neue Art trägt keinen Personenbezug). Verhaltenstest in `src/einsatz/repo.rs` neben dem
Schaden-Gegenstück: zwei Ablagen, ein Download mit Audit, ein Entfernen, Schwärzung → 0
`anhang`- und 0 Linker-Zeilen, drei ETB-Einträge „Person R-001: …“, eine Audit-Zeile `anhang`.

### D6 — Frontend: geteilter Anhang-Block

Neuer Ort `components/anhaenge/`:

- `ObjektAnhaenge.tsx` — der heutige Inhalt von `SchadenAnhaenge.tsx`, parametrisiert über
  ein kleines Objekt `quelle`: `queryKey`, `liste()`, `ablegen(datei)`, `entfernen(id)`,
  `downloadPfad(id)`, `kennung` („Schaden S-003“ / „Person R-007“ — für zugängliche Namen,
  Dialogtitel und Original-Kennung), `invalidieren` (Keys nach Erfolg). Dazu `darfSchreiben`
  (schon inklusive Storno) und `huelle: 'paneel' | 'abschnitt'`: `paneel` rendert wie heute
  mit Kopf-Aktion, `abschnitt` ohne eigenes `Paneel`, mit „Datei ablegen“ über der Liste (der
  Abschnittskopf gehört der `Collapse`). `data-lfh="anhang-zeile"` statt
  `schaden-anhang-zeile`; die zwei Leser (Unit-Test und `e2e/schaden-anhaenge.spec.ts`) ziehen
  nach.
- `AnhangAblegenModal.tsx` — der heutige `SchadenAnhangAblegenModal`, Titel aus `kennung`.
- `pages/schaeden/SchadenAnhaenge.tsx` wird ein dünner Adapter (Quelle aus
  `api/einsatzSchaden.ts`), die Tests von `SchadenAnhaenge` und dem Modal bleiben in ihren
  Aussagen grün und wandern, wo sie den Baustein prüfen, mit ihm.
- **Personen-Detailseite:** neuer `Collapse`-Abschnitt `anhaenge` „Fotos und Dateien“ zwischen
  „Zuordnungen“ und „Zugriffs-Audit“, Liste lädt erst beim Aufklappen (Ladehoheit; ein Foto
  einer Person öffnet niemand nebenbei). `huelle="abschnitt"`, `darfSchreiben &&
  !person.storniert_at`. Der Abschnitt steht für alle mit Modulzugriff, auch Beobachter.
- `api/einsatzPerson.ts`: `listePersonAnhaenge`, `legePersonAnhangAb` (`apiUpload`,
  `UPLOAD_TIMEOUT_MS`), `entfernePersonAnhang`, `personAnhangDownloadPfad`.
- `api/queryKeys.ts`: `EINSATZ_KEYS.personAnhaenge = 'einsatz-person-anhaenge'`, Factory
  `personAnhaenge(einsatzId, personId)`, Eintrag unter `EINSATZ_STREAM_EVENTS.person`. **Nicht**
  in der Lagebild-Allowlist; ein Test pinnt `istLagebildOfflineKey(personAnhaenge(…)) ===
  false`.
- Nach eigenem Download invalidiert nichts das Audit; die Audit-Einsicht lädt beim Aufklappen
  neu (`personAudit` bleibt in `NICHT_LIVE_KEYS`).
- **Audit-Einsicht:** Spalte „Art“ rendert über eine Zuordnung `ZugriffArt → Klartext`
  („Detail geöffnet“, „Liste exportiert“, „Liste gedruckt“, „Datei geladen“), erschöpfend über
  die generierte Union (ein fehlender Wert ist ein Typfehler).

*Verworfen:* **Kopie `personen/PersonAnhaenge.tsx`** (vom Menschen abgelehnt). **Paneel unter
den Stammdaten** statt Abschnitt: lüde die Dateinamen bei jedem Öffnen der Person und bräche die
Ladehoheit der Seite.

### D7 — Doku

`src/AGENTS.md`, Abschnitt Anhänge: ein Absatz „Personen-Anhänge (LFH-757)“ (Register-Eintrag,
Linker-id im Pfad, **Audit vor jeder Auslieferung, auch 304 und Original**, Liste ohne Audit,
Spec `personen-anhaenge`). `frontend/src/personen/AGENTS.md`: ein Punkt zum Abschnitt „Fotos und
Dateien“ (lädt beim Aufklappen, Key nicht live für das Detail, nicht offline). Der Satz „Personen
brauchen es — deshalb kommen sie später“ steht nur im Archiv von LFH-21 und bleibt dort.

## Risks / Trade-offs

- **[Gespeicherte Datei außerhalb des Systems]** Der Download liefert `attachment`; was danach
  auf dem Gerät geschieht, sieht kein Audit. → Grenze jedes Downloads; die bereinigte Fassung
  ohne GPS ist der Ausgleich. In der Prüfliste benannt.
- **[Audit-Lärm durch Browser-Revalidierung]** `no-cache` erzeugt je Öffnen eine Zeile mit 304.
  → Gewollt (D3). Ein `<img>`-Vorschau gibt es nicht (LFH-759 muss das Audit beim Entwurf der
  Thumbnails berücksichtigen; im Ticket vermerken).
- **[422 nach Audit]** Ein nicht bereinigbares Foto trägt eine Audit-Zeile ohne Auslieferung.
  → Über-Protokollierung, append-only; selten.
- **[Original-Vermerk ohne Auslieferung]** wenn die Audit-Zeile nach `original_freigeben`
  scheitert (D3). → Über-Protokollierung, kein Leck.
- **[Rebuild auf befüllter Produktions-DB]** → Muster 0132 mit Tests gegen befüllte Alt-DB,
  Leaf-Tabelle, `-- no-transaction` am Dateianfang (Test prüft das).
- **[Migrationsnummer kollidiert]** → `scripts/check-migrationen.sh` direkt vor dem PR, Required
  Check `Migrationsnummern`.
- **[Refactoring des Schaden-Blocks bricht Bestand]** → Schaden-Tests (Unit und e2e) laufen mit
  unveränderten Aussagen; nur der `data-lfh`-Name wandert.
- **[Abschottungstest blind durch D12]** → alle Abschottungstests als ablegende Person (`admin`,
  Hilfe `person_anhang` in `tests/common`), Testregel aus `src/AGENTS.md`.

## Migration Plan

1. `git fetch origin alpha`, `scripts/check-migrationen.sh` — `0135`/`0136` sind frei.
2. `0135_einsatz_person_anhang.sql` (additiv) und `0136_person_zugriff_audit_anhang.sql`
   (Rebuild, `-- no-transaction` als erste Zeile).
3. Rollback: eingespielte Migrationen werden nicht editiert. Eine Rücknahme braucht eine
   Folgemigration (Linker und zugehörige `anhang`-Zeilen entfernen; der erweiterte CHECK kann
   stehen bleiben) und den Rückbau des Registereintrags im selben Zug.

## Annahmen

- Anhänge sind in **jedem Status** einer nicht stornierten Person möglich (auch vermisst: Foto
  zur Identifikation; verstorben: Dokumentation). Am Freigabe-Checkpoint änderbar.
- Platz auf der Detailseite als aufklappbarer Abschnitt (D6). Am Freigabe-Checkpoint änderbar.

## Open Questions

Keine, die Spec oder Aufgabenschnitt ändern. Die vier Grundsatzfragen (Audit-Takt, Dateibezug,
Leserecht, Frontend-Schnitt) hat der Mensch am 02.10.2026 entschieden.
