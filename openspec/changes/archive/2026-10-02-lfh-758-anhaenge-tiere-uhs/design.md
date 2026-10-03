# Design

## Context

Anlass und Umfang stehen in `proposal.md`, die Anforderungen in `specs/tier-anhaenge/`,
`specs/uhs-anhaenge/` und dem Delta `specs/anhang-metadaten/`. Hier steht nur der Stand, der
den Weg vorgibt (Stand `origin/alpha` am 02.10.2026, höchste Migration `0134`).

### Das Vorbild LFH-21

Archiv `2026-09-29-lfh-21-schaden-anhaenge`, Spec `schaden-anhaenge`.

- **Linker:** `einsatz_schaden_anhang` (`0126`) mit `anhang_id UNIQUE … ON DELETE CASCADE`,
  `einsatz_id` direkt am Linker und Soft-Delete am Linker. Er steht im Register
  `anhang::repo::MODUL_LINKER`. Aus diesem Register lesen die modulgebundenen Stellen:
  - `LinkerStand`, `sweep_verwaiste`, `loeschen`;
  - die Chat-Bindung und die ETB-Bindung;
  - `gebunden_meldung`.

  Der Guard `jeder_fremdschluessel_auf_anhang_ist_registriert` wird rot, sobald eine Tabelle
  mit FK auf `anhang` fehlt.
- **Domäne** `src/schaden/anhang.rs` (rund 250 Zeilen ohne Tests):
  - DTO `SchadenAnhangAnzeige` (`id` = Linker-id);
  - `liste`/`laden`/`anhang_id_fuer_download`;
  - `ablegen`/`entfernen`, je in einem `write_retry!` mit `etb::system_audit_tx`;
  - `etb_text(registrier_nr, mime, Vorgang)` für den Wortlaut des Nachweises.

  Das SQL nennt Tabelle und Besitzerspalte als Literale.
- **Routen** `src/routes/schaden_anhang.rs`:
  - **Gates:** typisiert über `EinsatzLesezugriff<Schaeden>` und
    `EinsatzSchreibzugriff<Schaeden>`.
  - **Multipart:** `genau_eine_datei` prüft die Endung vor dem Lesen der Bytes.
  - **Prüfung:** `anhang::pruefe_vor_persist(…, ERLAUBTE_MIME_ERFASSUNG)` läuft vor der
    Transaktion.
  - **Download:** über `FassungParam`, `support::original_freigeben` und
    `support::anhang_antwort` (LFH-747).
  - **Live:** nach dem Commit `live.publiziere` (ETB) und `sse_schaden`.
- **Router** `src/app.rs`, Block `/schaeden/{sid}/anhaenge`: Der Upload trägt
  `DefaultBodyLimit::max(26 MiB)`, der Download `ConcurrencyLimitLayer`.
- **Schwärzung:** eine `TabellenRegel` mit `ZeileLoeschen` für alle Spalten, nach `anhang`.
  Die Guards `entdeckte_tabellen_gleich_registry_tabellen` und
  `keine_toten_registry_eintraege` wachen darüber.
- **Frontend:**
  - `pages/schaeden/SchadenAnhaenge.tsx` (Paneel, Liste, Entfernen mit Popconfirm,
    Fokusführung, Original-Aktion) und `SchadenAnhangAblegenModal.tsx` (`ErfassungsModal`
    mit Serie, `DateiFeld`). Beide sind über die Props `schaden` und `registrier_nr` und
    über ihren Wortlaut an Schäden gebunden.
  - Geteilt sind bereits `components/DownloadAnker.tsx`, `components/DateiFeld.tsx`,
    `api/upload.ts` (`ERFASSUNG_ACCEPT`), `api/anhangFassung.ts` und
    `einsatz/useDarfOriginalLaden`.

### Tiere

Tabelle `einsatz_tier` (`0031`):
- **Registriernummer:** `registrier_nr`, angezeigt als `T-007` (`tier::registrier_anzeige`).
- **Status:** `aktiv|vermisst|abgeschlossen`, Storno über `storniert_at`.
- **Laden:** `tier::repo::laden`/`laden_tx` lädt mit Einsatz.
- **Gate:** Marker `Tiere`, `PFAD_KEY` `/tiere`.
- **Live:** `LiveEvent::Tier` über den privaten Helfer `sse_tier`
  (`src/routes/einsatz_tier.rs`).
- **Kein Lese-Audit,** ausdrücklich (`0031`, Design 2026-05-29).

### UHS

Tabelle `uhs` (`0027`):
- **Bezeichnung:** `bezeichnung`, eindeutig je Einsatz, etwa „BHP 50“.
- **Status:** `geplant|aktiv|aufgeloest`, Storno über `storniert_at`.
- **Laden:** `uhs::repo::laden`/`laden_tx`.
- **Gate:** Marker `Unfallhilfsstellen`, `PFAD_KEY` `/uhs`.
- **Live:** `LiveEvent::Uhs` über den privaten Helfer `sse_uhs`.
- **ETB-Texte:** Sie nennen die Bezeichnung schon heute („BHP 50 aufgelöst“). Die
  Schwärzung behält `bezeichnung` und setzt `standort` und `notiz` auf NULL.
- **Patienten:** Sie stehen nur als Kennungen in `person_uhs_belegung`. Das UHS-Design sieht
  kein eigenes Lese-Audit vor.
- **„Grundriss“** heißt im Code das Platz-Layout (`uhs_platz.pos_x/pos_y`, `Grundriss.tsx`),
  kein Bild.
- **Seite:** `pages/uhs/UhsDetailPage.tsx` trägt eine `Segmentleiste` mit den Reitern
  „Material“ und „Bewegungen“.

### Lese-Audit heute

Es gibt nur `person_zugriff_audit` (`0021`, `0132`):
- **Spalten:** `art` mit CHECK, `person_id`.
- **Schreiben:** `audit_repo::anlegen`, im Handler vor dem Laden. Scheitert das Schreiben,
  scheitert die Anfrage.
- **Einsicht:** `GET …/personen/{pid}/audit` über `ctx.fordere_einsatzleitung()`. Die
  Einsicht selbst wird nicht protokolliert.
- **Frontend:** `PersonenDetailPage` lädt sie erst beim Aufklappen (`auditOffen`,
  `istEinsatzLeitung`).
- **Schwärzung:** behält alle Spalten (`G_AUDIT`, `G_ZEIT`, `G_FK`).

LFH-757 (`in design`) plant einen CHECK-Rebuild genau dieser Tabelle.

### `anhang.id`

Die Spalte ist `INTEGER PRIMARY KEY` ohne `AUTOINCREMENT`. Eine id kann also nach dem Löschen
der jeweils höchsten Zeile wieder vergeben werden.

## Goals / Non-Goals

**Goals:**

- Tier- und UHS-Anhänge verhalten sich nach außen wie Schaden-Anhänge, mit den Abweichungen
  aus den Specs (ETB-Wortlaut, Lebenszyklus, UHS-Audit).
- Ein Erfassungs-Anhang besteht im Backend aus einem Deskriptor, einer Routendatei und einem
  DTO statt aus einer Kopie von 250 Zeilen Domäne. LFH-757 (Personen) kann denselben Kern
  nehmen.
- Das UHS-Audit ist fail-closed und kollidiert mit keiner geplanten Migration.

**Non-Goals:**

- **Keine Umstellung des Personen-Audits.** `person_zugriff_audit` bleibt unberührt
  (LFH-757).
- **Keine Bildvorschau** (LFH-759). **Kein Bild als Hintergrund** des Platz-Layouts
  (Folgeticket).
- **Keine Anhangzahl** in Tier- und UHS-Listen, Vorschauen oder der Lagekarte.
- **Keine Änderung** an Schaden-Routen, Schaden-DTO oder Schaden-Wortlauten.
- **Kein Audit für Tier-Anhänge** und keins für das Auflisten.

## Decisions

### D1 Zwei Linker-Tabellen nach dem Muster von `0126`

Die beiden Tabellen kommen in je einer Migration:
- `0139_einsatz_tier_anhang.sql` mit `tier_id → einsatz_tier(id) ON DELETE CASCADE`;
- `0137_uhs_anhang.sql` mit `uhs_id → uhs(id) ON DELETE CASCADE`.

Sonst haben beide dieselben Spalten wie `einsatz_schaden_anhang`, also `einsatz_id`,
`anhang_id UNIQUE … CASCADE`, `abgelegt_*`, `geloescht_*` und das Paar-CHECK. Dazu kommt
ein Index auf `(besitzer_id, abgelegt_at)`. Die Kopfkommentare tragen die Pflicht zum
Registereintrag, wie bei `0126`.

Jede Tabelle bekommt einen Eintrag in `MODUL_LINKER`:
- **Tier:** `ort: "Tier"`, `loesch_meldung: "Anhang gehört zu einem Tier und wird dort
  entfernt"`.
- **UHS:** `ort: "Unfallhilfsstelle"`, `loesch_meldung: "Anhang gehört zu einer
  Unfallhilfsstelle und wird dort entfernt"`.

Damit wächst die ETB-422-Meldung „bereits gebunden“ um beide Orte. Ein Test pinnt den neuen
Wortlaut.

**Verworfen:**
- **Eine polymorphe Tabelle `erfassung_anhang`** (`modul`, `besitzer_id`): Sie hat keinen FK
  auf den Besitzer, also kein CASCADE und keine Einsatzgleichheit durch Bau. LFH-21 D1 hat
  sie schon einmal verworfen.
- **Beide Linker in einer Migration:** Das ginge auch. Getrennt bleibt jede Datei einem
  Register- und einem Schwärzungseintrag zugeordnet, und ein Umnummerieren trifft nur eine.

### D2 Gemeinsamer Kern `anhang::erfassung`, Schaden zieht um

`src/anhang/erfassung.rs` bekommt einen Deskriptor aus Compile-Zeit-Konstanten:

```rust
pub struct ErfassungsAblage {
    pub linker: &'static str,           // "einsatz_tier_anhang"
    pub besitzer_spalte: &'static str,  // "tier_id"
    pub besitzer_tabelle: &'static str, // "einsatz_tier"
    pub storniert_meldung: &'static str,// "Tier ist storniert"
}
```

Dazu kommen generische Funktionen:
- **Lesen:** `liste`, `laden`, `anhang_id_fuer_download`, alle mit `einsatz_id`,
  `besitzer_id` und einer Zeile `ErfassungsAnhangZeile` (`besitzer_id` statt
  `schaden_id`).
- **Schreiben:** `ablegen_tx` und `entfernen_tx` in offener Transaktion. Sie bekommen den
  Besitzerkopf als Wert `BesitzerKopf { storniert: bool, etb_name: String }`, den das Modul
  vorher in derselben Transaktion lädt (`schaden_repo::laden_tx`, `tier::repo::laden_tx`,
  `uhs::repo::laden_tx`).
- **Wortlaut:** `etb_text(etb_name, mime, Vorgang)` gibt den Text zurück, etwa „Schaden
  S-003: Foto abgelegt“, „Tier T-007: Foto abgelegt“ oder „UHS BHP 50: Foto abgelegt“.

Der `write_retry!` bleibt im Modul. Ein Modul besteht damit aus:
- dem Deskriptor;
- `ablegen` und `entfernen`, je rund 15 Zeilen (Besitzer laden → Kern-Aufruf);
- dem DTO samt `From<ErfassungsAnhangZeile>` mit `schaden_id`, `tier_id` oder `uhs_id`.

Das SQL entsteht wie `modul_gebunden_sql` aus den Konstanten des Deskriptors über
`sqlx::AssertSqlSafe`. Kein Eingabewert gelangt hinein.

**`src/schaden/anhang.rs` zieht auf den Kern um.** DTO, Routen und Wortlaut bleiben
bitgleich. Das Sicherheitsnetz sind die 30 Tests in `tests/schaden_anhang.rs`, das
Scan-Binary, die Schaden-Fälle in `tests/anhang.rs`, `etb_anhang.rs`, `dokument.rs` und
`anhang_metadaten.rs` sowie die Repo-Tests. Sie müssen unverändert grün bleiben.

**Verworfen:**
- **Zwei Kopien von `schaden/anhang.rs`:** Das wären drei, mit LFH-757 vier Stellen mit
  derselben Transaktionslogik. Jede Korrektur, etwa an Storno-Prüfung oder ETB-Wortlaut,
  müsste viermal gelingen.
- **Kern nur für Tier und UHS, Schaden bleibt Kopie:** Das spart den Umzug, lässt aber
  genau die Abweichung stehen, die der Kern verhindern soll.
- **Trait mit asynchronem Besitzer-Lader:** Das bringt Lebenszeit-Kosten im `write_retry!`
  (Closure über `&mut SqliteConnection`), ohne mehr zu leisten als der vorab geladene
  `BesitzerKopf`.

### D3 Routen und Reihenfolge

`src/routes/tier_anhang.rs` und `src/routes/uhs_anhang.rs` folgen
`routes/schaden_anhang.rs` Zeile für Zeile:
- `liste`, `ablegen`, `datei`, `entfernen`;
- Gates über `EinsatzLesezugriff<Tiere|Unfallhilfsstellen>` und
  `EinsatzSchreibzugriff<…>`;
- `{aid}` ist die Linker-id.

**Reihenfolge beim Ablegen:** Gate → Besitzer im Einsatz (404) → storniert (409) →
Multipart (400) → `pruefe_vor_persist` (400/422/503) → `etb_startwert` → eine Transaktion
(Storno dort erneut geprüft).

`genau_eine_datei` wandert aus `routes/schaden_anhang.rs` nach `routes/support.rs`, damit
drei Routendateien ihn teilen.

**Router:** Die Blöcke `/tiere/{tid}/anhaenge` und `/uhs/{uid}/anhaenge` kommen in `app.rs`
mit denselben Layern wie bei Schäden. `sse_tier` und `sse_uhs` werden am Ort `pub(crate)`.
Es gibt keine Kopie.

**Verworfen:** generische Routen `/erfassung/{modul}/{id}/anhaenge`. Sie verlören das
typisierte Gate je Modul, das der Struktur-Guard `einsatz_kontext_guard` erzwingt.

### D4 ETB-Wortlaut

Der Text entsteht aus `etb_text` im Kern:
- **Tier:** „Tier T-007: Foto abgelegt“, aus `tier::registrier_anzeige`.
- **UHS:** „UHS BHP 50: Foto abgelegt“, aus `bezeichnung`. Das Präfix „UHS“ macht den Text
  ohne Kontext lesbar, weil Bezeichnungen wie „PA 1“ allein mehrdeutig sind.

Die Bezeichnung ist ein operativer Name. Sie bleibt bei der Schwärzung stehen und steht schon
in den Status-Einträgen. Der Leak-Schutz der Spec bleibt erhalten, weil Dateiname, Standort
und Notiz nie in den Text gehen.

Die Art („Foto“/„PDF“/„Datei“) kommt wie bisher aus dem serverseitigen MIME.

### D5 UHS-Lese-Audit in `anhang_zugriff_audit`

Migration `0138_anhang_zugriff_audit.sql`:

```sql
CREATE TABLE anhang_zugriff_audit (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id  INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    anhang_id   INTEGER NOT NULL,          -- bewusst ohne FK, s. u.
    ablage      TEXT    NOT NULL,          -- „UHS BHP 50“, Stand beim Abruf
    benutzer_id INTEGER NOT NULL REFERENCES benutzer(id),
    fassung     TEXT    NOT NULL CHECK (fassung IN ('bereinigt','original')),
    zugriff_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE INDEX idx_anhang_zugriff_audit_anhang ON anhang_zugriff_audit (einsatz_id, anhang_id);
```

**`anhang_id` hat keinen Fremdschlüssel.** Dafür gibt es zwei Gründe:
- **Guard:** Ein FK auf `anhang` machte die Tabelle für
  `jeder_fremdschluessel_auf_anhang_ist_registriert` zu einem Linker, und das ist sie nicht.
- **Schwärzung:** Sie löscht `anhang`, das Protokoll soll aber bleiben. Mit CASCADE
  verschwände es, mit RESTRICT scheiterte die Schwärzung.

Die id kann während der Lebenszeit des Protokolleintrags nicht neu vergeben werden. Eine
UHS-Datei wird vor der Schwärzung nie hart gelöscht (Soft-Delete, generischer DELETE → 422,
Sweep hält sie). Nach der Schwärzung trennt `einsatz_id` die Einsätze.

`ablage` hält den Bezug lesbar, auch wenn Linker und Datei nach der Schwärzung fehlen. Sie
enthält nur die Bezeichnung, die die Schwärzung ohnehin behält.

**Repo** `src/anhang/audit_repo.rs`:
- `anlegen(pool, einsatz_id, anhang_id, ablage, benutzer_id, Fassung)`;
- `liste_je_linker(pool, einsatz_id, linker: &ErfassungsAblage, besitzer_id)`. Das ist ein
  JOIN über den Linker, einschließlich soft-gelöschter Zeilen, mit `anhang.dateiname` und
  `benutzer.anzeigename`, neueste zuerst.

Append-only: Es gibt keine Update- und keine Delete-Funktion.

**Schreiben im Handler `uhs_anhang::datei`:**
1. Linker-Lookup (404).
2. Bei `Fassung::Original`: `original_freigeben` (403 oder ETB-Vermerk).
3. `audit_repo::anlegen` (Fehler → Antwort scheitert, keine Bytes).
4. `anhang_antwort`.

Das Audit läuft über den Pool, nicht in einer Transaktion mit dem Lesen. Es soll vor der
Auslieferung **stehen**, wie beim Personen-Detail. Eine 304-Antwort wird ebenfalls
protokolliert, denn sie bestätigt einen Zugriff auf eine bekannte Datei. Ein 422 für ein
nicht bereinigbares Bild bleibt protokolliert, als Versuch.

**Einsicht:** `GET /api/einsaetze/{id}/uhs/{uid}/anhaenge/zugriffe` mit
`EinsatzLesezugriff<Unfallhilfsstellen>` und `ctx.fordere_einsatzleitung()`. Die UHS wird
im Einsatz geprüft (404). Die Einsicht selbst wird nicht protokolliert. Das DTO
`AnhangZugriffAnzeige` trägt `id`, `anhang_id` (Linker-id), `dateiname`, `benutzer_name`,
`fassung` und `zugriff_at`.

**Schwärzung:** eine `TabellenRegel` `anhang_zugriff_audit` mit `Scoping::EinsatzId`.
Alle Spalten bleiben erhalten:
- `id` G_PK, `einsatz_id` G_SCOPE;
- `anhang_id` und `benutzer_id` G_FK;
- `ablage` als operativer Name, `fassung` G_AUDIT, `zugriff_at` G_ZEIT.

Die Klassen werden an der Registry gegen die vorhandenen Konstanten abgeglichen.

**Verworfen:**
- **Neue `art` in `person_zugriff_audit`:** Das braucht den CHECK-Rebuild, den LFH-757
  ebenfalls plant, also einen Migrationskonflikt. Außerdem gibt es an der UHS keine
  `person_id`.
- **Tabelle `uhs_anhang_zugriff` mit FK auf den Linker:** Die Schwärzung löscht den Linker,
  dann stünde das Protokoll ohne Bezug da oder verschwände per CASCADE. Die modulneutrale
  Tabelle mit `ablage` trägt das, und ein späteres Audit an einem anderen Modul braucht
  keine neue Tabelle.
- **Audit als ETB-Eintrag je Download:** Das füllt das Tagebuch mit Lese-Lärm und macht den
  Abruf allen ETB-Lesenden sichtbar statt nur der Einsatzleitung.

### D6 Frontend: modulneutrale Bausteine

`pages/schaeden/SchadenAnhaenge.tsx` wird zu `components/erfassungsAnhaenge/ErfassungsAnhaenge.tsx`,
`SchadenAnhangAblegenModal.tsx` zu `ErfassungsAnhangAblegenModal.tsx`. Die Props:

```ts
interface ErfassungsAnhaengeProps {
  einsatzId: number;
  bezug: string;                 // „Schaden S-003“, „Tier T-007“, „UHS BHP 50“ (Namen, Dialogtitel)
  quelle: ErfassungsAnhangQuelle;// queryKey, liste, ablegen, entfernen, downloadPfad des Moduls
  darfSchreiben: boolean;
  gesperrt: boolean;             // storniert → nur lesen
  hinweis?: ReactNode;           // UHS: „Jeder Abruf einer Datei wird … protokolliert.“
  zeilenKennung?: string;        // `data-lfh` der Zeilen je Modul
  children?: ReactNode;          // UHS: Bereich „Zugriffe“ im selben Paneel
}
```

`SchadenAnhaenge` bleibt als dünne Hülle mit unveränderter Schnittstelle. Seine Tests bleiben
unverändert grün und tragen den Baustein. `SchadenAnhangAblegenModal` geht ganz im Baustein auf;
seine Tests stehen jetzt am Baustein. Neue Tests decken Tier, UHS-Hinweis und
UHS-Zugriffsliste ab.

**Live-Zufluss (Nachtrag nach PR #360, LFH-760):** Die Zufluss-Schleuse (`anhangZufluss.ts`,
Sammelbanner statt Einschieben, eigene Ablage über `onAbgelegt` sofort sichtbar) sitzt im
Baustein, nicht in der Schaden-Hülle. Damit erfüllen Tier und UHS das Kriterium 12 der Prüfliste
ohne eigene Kopie. Der Zustand der Schleuse ist an den Query-Key der Liste gebunden, also an den
Besitzer.

**Einbau:**
- **Tier:** `TiereDetailPage` bekommt das Paneel „Fotos und Dateien“ nach dem Datenraster,
  außerhalb jedes Bearbeiten-Formulars.
- **UHS:** `UhsDetailPage` bekommt einen dritten Reiter „Dateien“ in der `Segmentleiste`.
  Die Beschriftung der Leiste wird „Material, Bewegungen und Dateien“. Der Reiter zeigt
  `ErfassungsAnhaenge` im Paneel „Fotos und Dateien“: Paneelkopf, Zähler und „Datei ablegen“
  bleiben so an allen drei Modulen gleich, und die e2e-Messung findet sie unter demselben
  Namen.
- **Zugriffsliste:** Darunter steht für `istEinsatzLeitung` ein aufklappbarer Bereich
  „Zugriffe“. Er nutzt das Muster aus `PersonenDetailPage`: `enabled` erst beim Aufklappen,
  `retry: false`. Er zeigt eine Tabelle mit Zeit, Person, Datei und Fassung.

**Query-Keys:**
- `tierAnhaenge(einsatzId, tierId)` unter `EINSATZ_STREAM_EVENTS.tier`;
- `uhsAnhaenge(einsatzId, uhsId)` unter `EINSATZ_STREAM_EVENTS.uhs`;
- `uhsAnhangZugriffe(einsatzId, uhsId)` in `NICHT_LIVE`, denn das Protokoll wird bewusst
  nur auf Aufklappen geladen, wie `personAudit`.

**Verworfen:** zwei Kopien der Schaden-Komponenten (217 + 71 Zeilen je Modul), aus denselben
Gründen wie in D2.

### D7 Dokumentation und Nachweise

`src/AGENTS.md`, Abschnitt „Anhänge“: Der Absatz zu den Schaden-Anhängen wird zu
„Erfassungs-Anhänge (LFH-21, LFH-758)“. Er nennt:
- den Kern `anhang::erfassung`;
- dass ein neues Modul Deskriptor, Linker-Migration, Registereintrag, Schwärzungsregel,
  Routendatei und DTO braucht;
- das UHS-Audit (`anhang_zugriff_audit`, fail-closed, ohne FK auf `anhang`, Einsicht nur
  Einsatzleitung).

Die Prüfliste Einsatztauglichkeit liegt als `pruefliste.md` in dieser Change, wie bei
LFH-600 und LFH-625. `docs/superpowers/` ist eingefroren.

## Risks / Trade-offs

- **[Umzug der Schaden-Domäne bricht Verhalten]** → Der Umzug ist eine eigene Aufgabe vor
  Tier und UHS. Gate dafür sind die unverändert grünen Schaden-Tests (Integration, Scan,
  Abschottung, Metadaten) und eine Mutationsprobe am Kern (Storno-Prüfung entfernt →
  `tests/schaden_anhang.rs` rot).
- **[SQL aus Deskriptor-Konstanten]** → Die Felder sind `&'static str`. Ein Unit-Test baut
  das SQL für alle drei Deskriptoren und führt es gegen eine migrierte Test-DB aus. Ein
  Tippfehler in einer Konstante fällt dort auf, nicht erst zur Laufzeit.
- **[Audit-Lärm durch 304]** → Er wird bewusst in Kauf genommen. Abrufe einer UHS-Datei
  sind selten, und der Browser revalidiert nur bei erneutem Klick. Die Einsicht ist nach
  Zeit sortiert.
- **[Audit ohne FK]** → Eine falsche `anhang_id` ist durch Bau ausgeschlossen, denn der Wert
  kommt aus dem Linker-Lookup derselben Anfrage. Ein Repo-Test pinnt, dass die Einsicht
  nur Zeilen zu Linkern dieser UHS zeigt.
- **[Hinweis statt Verbot]** → Der Dialog verbietet keine Patientenfotos, er macht nur die
  Protokollierung sichtbar. Patientenfotos gehören an die Person (LFH-757). Das ist eine
  Frage der Arbeitsanweisung, nicht des Systems.
- **[Migrationsnummern]** → `0136`–`0138` nach dem Abgleich mit `alpha` (dort kam `0135_aufbewahrung_kategorie` hinzu; ursprünglich `0135`–`0137`). Vor dem PR läuft
  `scripts/check-migrationen.sh` gegen frisches `origin/alpha`, bei Bedarf mit
  `--umnummerieren`.

## Migration Plan

Die drei Migrationen sind rein additiv (neue Tabellen, kein Rebuild, kein
`-- no-transaction`). Ein Rollback geschieht durch Zurücknehmen des Releases. Die Tabellen
bleiben dann leer und unbenutzt zurück, was der Migrationsregel „nie ändern oder löschen“
entspricht.
