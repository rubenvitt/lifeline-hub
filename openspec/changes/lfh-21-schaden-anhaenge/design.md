# Design

## Context

Anlass und Umfang stehen in `proposal.md`, die Anforderungen in
`specs/schaden-anhaenge/spec.md`. Hier steht nur der Stand, der den Weg vorgibt.

**Stand auf `origin/alpha` nach dem Merge von LFH-117 (`f68aa1f1`, 25.09.2026, höchste
Migration `0125`):**

- Die Bytes jeder Datei liegen in `anhang` (`migrations/0052_anhang.sql`): BLOB,
  `sha256`, `hochgeladen_von`, `einsatz_id … ON DELETE CASCADE`, **kein** Soft-Delete.
  Daran hängen drei Linker — die einzigen Tabellen mit `REFERENCES anhang(id)`:
  `chat_nachricht_anhang` (n : m, Chat, LFH-102, 0052), `einsatz_dokument` (1 : 1,
  `anhang_id UNIQUE`, Soft-Delete am Linker, LFH-632, 0116) und `etb_eintrag_anhang`
  (`eintrag_id`, `anhang_id UNIQUE`, PK `(eintrag_id, anhang_id)`, append-only, LFH-117,
  0125). `karte_hintergrundbild` (0075) hält eigene Bytes und verweist nicht auf `anhang`.
- **Fünf Stellen je Linker** (CLAUDE.md „ETB-Anhänge (LFH-117)“, design.md D12 von
  LFH-117), jede mit eigenen Tabellenliteralen:
  1. `anhang::repo::LinkerStand` / `linker_stand` — Felder `chat_gesamt`, `chat_lebend`,
     `dokument_gesamt`, `etb_gesamt`; Methoden `ist_dokument()`, `ist_etb()`,
     `generischer_download_gesperrt()` (Dokument ∨ ETB ∨ Chat-Tombstone) und
     `ist_ungebunden()` (alle drei Zähler 0). Daraus liest `routes::anhang` den 404 beim
     generischen Download, die zwei 422-Wortlaute beim generischen DELETE
     („… gehört zur Dokumentenablage und wird dort entfernt“, „… gehört zu einem
     ETB-Eintrag und ist unveränderlich“) und die Uploader-Regel D12
     (`fordere_hochladende_bei_ungebunden`).
  2. `anhang::repo::sweep_verwaiste` — `NOT EXISTS` für Chat, Dokument, ETB.
  3. `anhang::repo::loeschen` — `NOT EXISTS` für Dokument und ETB (Chat räumt die CASCADE).
  4. `chat::repo::anlegen_mit_anhaengen` — `NOT EXISTS` für Dokument und ETB; Fehlschlag ist
     400 „Unbekannter oder fremder Anhang“.
  5. `etb::repo::pruefe_anhaenge` — `EXISTS etb OR EXISTS chat OR EXISTS dokument` als
     **Wert** einer SELECT zusammen mit `a.hochgeladen_von`; gebunden → 422 „Anhang ist
     bereits an einen ETB-Eintrag, eine Chat-Nachricht oder ein Dokument gebunden“, frei und
     fremd hochgeladen oder unbekannt → 400 (`ANHANG_UNBEKANNT`).
  Die vier SQL-Stellen haben damit **vier verschiedene Formen** (Negation mit und ohne Chat,
  positive Disjunktion mit Chat als Wert). Kein Wortlaut ist von einem Test gepinnt.
- **D12 (LFH-117):** ein ungebundener Anhang ist über die generischen Routen nur für
  `hochgeladen_von` erreichbar, alle anderen bekommen 404. **Folge für jeden neuen Linker:**
  fehlt er in `LinkerStand`, gilt seine Datei als ungebunden. Andere Personen sähen dann
  weiter 404, **die hochladende Person aber könnte sie generisch laden und hart löschen**;
  die CASCADE nähme den Linker mit, am Soft-Delete und am ETB-Nachweis vorbei. Der
  CLAUDE.md-Satz „machte seine Dateien damit für alle anderen unerreichbar“ beschreibt nur
  die harmlose Hälfte. Jeder Abschottungstest muss deshalb **als ablegende Person** laufen —
  als jemand anderes wäre er auch ohne Registereintrag grün.
- **Upload-Bausteine** (`src/anhang/mod.rs`): `ermittle_mime_aus(dateiname, erlaubt)`,
  `pruefe_groesse(len)`, `scan(scan_config(), &daten)` und `repo::anlegen_tx` (INSERT in
  offener Transaktion). Darüber liegt `hochladen_multipart` — der geteilte Helfer aus
  LFH-117 für generischen und ETB-Upload. Er legt **jede** Datei sofort über den Pool als
  **ungebundenen** Anhang an (Best-Effort je Feld, keine Transaktion). Für eine Ablage, die
  Datei, Linker und ETB atomar braucht, taugt er nicht: ein Storno-409 nach dem Upload
  hinterließe einen Waisen. Die Dokumentenablage (`routes::dokument::ablegen`) ruft deshalb
  die drei Prüfbausteine selbst und persistiert in `dokument::repo::ablegen` per
  `anlegen_tx`. Allowlists: `ERLAUBTE_MIME` (Chat), `ERLAUBTE_MIME_DOKUMENT` (Ablage und
  ETB, mit HEIC/HEIF/TIFF).
- Das Modul Schäden (`src/routes/einsatz_schaden.rs`, `MODUL_KEY = "schaeden"`) prüft seine
  Gates noch von Hand und steht in `DEFERRED_MODULE` von `tests/einsatz_kontext_guard.rs`.
  `schaeden` steht in `MODUL_KEYS`, einen Marker in `modul_marker!` und einen
  `PFAD_KEY`-Eintrag gibt es noch nicht. Die Routen schreiben eine pseudonyme ETB-Spur
  („Schaden S-003 storniert“, `schaden::registrier_anzeige`) über
  `etb::system_audit_tx(conn, einsatz_id, benutzer_id, startwert, &text)` im selben
  `write_retry!`; `startwert` kommt vorher aus
  `einsatz::einstellungen::laden_oder_default(…).etb_startwert()`. Danach verteilen sie
  **nur** `LiveEvent::Schaden` (`{einsatz_id, schaden_id}`, Helfer `sse_schaden`), nicht das
  ETB-Ereignis. `schaden_repo::laden_tx` lädt einen Schaden in offener Transaktion.
  Schäden werden nie hart gelöscht, nur storniert (`storniert_at`).
- **Routenmuster:** Upload-Routen tragen `DefaultBodyLimit::max(26 * 1024 * 1024)`,
  Download-Routen `ConcurrencyLimitLayer::new(MAX_GLEICHZEITIGE_ASSET_DOWNLOADS)`
  (Dokumentenablage und ETB-Anhang in `src/app.rs`). Der Download läuft über
  `routes::support::anhang_antwort` (ETag/304).
- Die Schwärzungs-Registry löscht `anhang` per `ZeileLoeschen`; `einsatz_dokument` steht mit
  `Scoping::EinsatzId` und `ZeileLoeschen` für alle Spalten danach, `etb_eintrag_anhang` als
  Retain-G_FK-Junction über `UeberParent`. Der Guard verlangt für jede Tabelle mit
  `einsatz_id` oder in der CASCADE-Hülle eine Regel.
- **Frontend nach LFH-117:** `api/dokumente.ts` exportiert `DOKUMENT_MAX_GROESSE`,
  `DOKUMENT_ACCEPT` und `DOKUMENT_UPLOAD_TIMEOUT_MS`; gelesen werden sie auch von
  `api/etb.ts` und `etb/Schnellerfassung.tsx`. `formatGroesse` liegt in
  `karten/formatGroesse.ts`. `pages/DokumentePage.tsx` trägt einen lokalen `DownloadAnker`
  (`minHeight: controlHeight`), `etb/EtbAnhaenge.tsx` baut seine Verweise mit `verweisStil`.
  `dokumente/DokumentAblegenModal.tsx` nutzt antds `Upload` (`beforeUpload={() => false}`,
  `maxCount={1}`). LFH-117 hat an der Schnellerfassung **gemessen**, dass antds `Upload` den
  Auslöser in ein zweites `role="button"` mit eigenem Tabstopp wickelt, und dort ein
  verstecktes `<input type="file">` genommen.
- **LFH-23 (in Arbeit, nicht gemergt):** die Archivakte liest nur Retain-Projektionen
  (`einsatz_schaden` u. a.). `einsatz_schaden_anhang` ist durchgehend `ZeileLoeschen` und
  gehört nicht in die Akte; es gibt keine Wechselwirkung.

## Goals / Non-Goals

**Goals:**

- Schaden-Anhänge entstehen nach dem Muster der Dokumentenablage, ohne deren Titel,
  Kategorie und Freitext-ETB.
- Jeder künftige modulgebundene Linker (Personen, Tiere, UHS) kostet **einen**
  Registereintrag statt fünf Handstellen, und ein vergessener Eintrag macht einen Test rot.
- Die neuen Routen tragen ihr Gate strukturell (typisierter Extractor), obwohl das übrige
  Schadensmodul noch von Hand prüft.
- Die Prüfkette vor dem Speichern (Typ, Größe, Scan) gibt es genau einmal für alle
  Upload-Wege.

**Non-Goals:**

- **Keine Umstellung der bestehenden Schadensrouten** auf die typisierten Extractoren. Das
  Modul `einsatz_schaden` bleibt in `DEFERRED_MODULE`; nur die neue Routendatei ist davon
  ausgenommen.
- **Kein Lese-Audit.** Schäden haben keins (`migrations/0032_einsatz_schaden.sql`,
  `docs/superpowers/specs/2026-05-29-erfassung-schaeden-design.md`), und ein Foto ändert
  daran nichts. Personen brauchen es — deshalb kommen sie später (Folgeticket).
- **Keine Vorschau, keine Thumbnails, keine Galerie.** Die Datei wird als Anlage
  ausgeliefert wie in der Dokumentenablage.
- **Keine EXIF-/GPS-Bereinigung.** Entscheidung des Auftraggebers: Metadaten bleiben als
  Beweismittel erhalten; die Bereinigung ist **LFH-747**.
- **Kein Offline-Upload, keine Idempotenz über `client_id`** (siehe D5).
- **Keine Anhangzahl in der Schadensliste**, keine Anzeige in der Palette-Vorschau
  (`SchadenVorschau`) und im Inspector der Lagekarte.
- **Kein Umbenennen/Metadaten-Ändern** eines Anhangs (vgl. LFH-656 für Dokumente).
- **Keine Schließung der ETB-Live-Lücke** der bestehenden Schadensrouten (siehe D8); sie
  wird als Nebenbefund benannt.
- **Keine Änderung am Chat-Verhalten** über die Registerbedingung hinaus (Allowlist- und
  Uploader-Prüfung beim Verknüpfen ist **LFH-745**).

## Decisions

### D1 — Eigener Linker `einsatz_schaden_anhang`, 1 : 1 zum Anhang

Migration `0126_einsatz_schaden_anhang.sql` (nächste freie über `origin/alpha`, Regel
„anhängen, nicht einschieben“, LFH-658; vor dem PR erneut mit
`scripts/check-migrationen.sh` prüfen). Rein additiv, kein Rebuild, kein
`-- no-transaction`:

```sql
CREATE TABLE einsatz_schaden_anhang (
    id               INTEGER PRIMARY KEY,
    einsatz_id       INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    schaden_id       INTEGER NOT NULL REFERENCES einsatz_schaden(id) ON DELETE CASCADE,
    anhang_id        INTEGER NOT NULL UNIQUE REFERENCES anhang(id) ON DELETE CASCADE,
    abgelegt_von_id  INTEGER NOT NULL REFERENCES benutzer(id),
    abgelegt_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    geloescht_at     TEXT,
    geloescht_von_id INTEGER REFERENCES benutzer(id),
    CHECK ((geloescht_at IS NULL) = (geloescht_von_id IS NULL))
);
CREATE INDEX idx_einsatz_schaden_anhang_schaden
    ON einsatz_schaden_anhang(schaden_id, abgelegt_at);
```

- **`anhang_id UNIQUE`:** eine Datei gehört genau einem Schaden, ein Lebenszyklus, ein
  Rechtemodell (wie `einsatz_dokument` und `etb_eintrag_anhang`).
- **`anhang_id … ON DELETE CASCADE`:** die Schwärzung löscht `anhang` per `ZeileLoeschen`;
  mit RESTRICT schlüge sie fehl (E9 aus LFH-632, D1 aus LFH-117). Der generische DELETE ist
  durch das Register gesperrt (D2), also reißt nichts ungewollt mit.
- **`einsatz_id` direkt am Linker:** Ownership-Abfragen bleiben einsatz-gescopt ohne Join,
  die Schwärzungs-Regel scoped über `Scoping::EinsatzId`, und der Guard aus LFH-291 findet
  die Tabelle unabhängig von der CASCADE-Kette.
- **`schaden_id … ON DELETE CASCADE`:** Schäden werden nur storniert; hart verschwinden sie
  allein mit dem Einsatz. CASCADE ist dort die ehrliche Kette.
- **Soft-Delete am Linker**, weil `anhang` keinen hat (Entscheidung des Auftraggebers:
  Entfernen = Soft-Delete, Datei geht erst mit der Schwärzung). Das Paar-CHECK verhindert
  halb gesetzte Löschmarken. Anders als beim ETB-Anhang (unveränderlich, LFH-117) gibt es
  hier ein Entfernen, weil ein Foto am falschen Schaden sonst dort stehen bliebe; der
  Nachweis im ETB bleibt.
- **Keine `etb_eintrag_id`-Spalte** (anders als `einsatz_dokument`): der Nachweis steht über
  die Registriernummer im Text, eine Rückverknüpfung braucht niemand.
- **Gleicher Einsatz für Schaden, Linker und Anhang** kann SQLite nicht über Tabellen hinweg
  prüfen. Es gilt durch Bau: alle drei Werte stammen in einer Transaktion aus
  `ctx.einsatz.id`, und der Schaden wird vorher mit `AND einsatz_id = ?` geladen. Ein
  Repo-Test pinnt die Gleichheit.

*Verworfen:* **Dokumentenablage mit neuem Bezug `schaden`** — machte die Datei für jeden
mit Modul `dokumente` sichtbar (auch ohne Schadensrecht), schriebe einen Freitext-Titel ins
ETB und bräuchte einen CHECK-Rebuild von `einsatz_dokument`. **Eine generische Tabelle
`erfassung_anhang(objekt_typ, objekt_id)`** — polymorph ohne FK, also ohne CASCADE vom
Schaden und ohne Einsatz-Garantie durch die DB; jedes Modul braucht ohnehin eigene Rechte-
und Lebenszyklusregeln.

### D2 — Linker-Register `MODUL_LINKER` in `anhang::repo`

Mit diesem Change gibt es vier Linker. Drei davon (Dokument, ETB, Schaden) teilen dieselbe
Semantik: **modulgebunden** — generischer Download gesperrt, generischer DELETE 422, Sweep
hält die Datei, keine zweite Verknüpfung, nie „ungebunden“ im Sinne von D12. Der Chat ist
anders (n : m, Tombstone-Regel, der generische Upload/Download ist sein Weg). Statt einen
vierten Zähler an `LinkerStand` zu hängen und an fünf Stellen ein viertes Literal
einzufügen, führt dieser Change **ein Register**:

```rust
/// Modulgebundene Linker auf `anhang` — jede Tabelle trägt eine Spalte `anhang_id`.
/// Der Chat (`chat_nachricht_anhang`) steht bewusst NICHT hier: n:m, Tombstone-Regel.
pub struct ModulLinker {
    pub tabelle: &'static str,
    /// Meldung des generischen DELETE (422) für eine Datei dieses Linkers.
    pub loesch_meldung: &'static str,
    /// Kurzname für die Bindungsmeldung des ETB („… bereits gebunden (…)“).
    pub ort: &'static str,
}
pub const MODUL_LINKER: &[ModulLinker] = &[
    ModulLinker { tabelle: "einsatz_dokument",
                  loesch_meldung: "Anhang gehört zur Dokumentenablage und wird dort entfernt",
                  ort: "Dokumentenablage" },
    ModulLinker { tabelle: "etb_eintrag_anhang",
                  loesch_meldung: "Anhang gehört zu einem ETB-Eintrag und ist unveränderlich",
                  ort: "ETB-Eintrag" },
    ModulLinker { tabelle: "einsatz_schaden_anhang",
                  loesch_meldung: "Anhang gehört zu einem Schaden und wird dort entfernt",
                  ort: "Schaden" },
];
```

Die ersten beiden Wortlaute sind die heutigen aus `routes::anhang::loeschen`, unverändert.

**Ein positiver Ausdruck, keine Negation.** Weil die vier SQL-Stellen vier Formen haben,
liefert das Register **einen** Baustein, den die Aufrufer negieren oder verodern:

```rust
/// `(EXISTS (SELECT 1 FROM einsatz_dokument x WHERE x.anhang_id = {alias}.id) OR …)`
pub fn modul_gebunden_sql(alias: &str) -> String
```

- `sweep_verwaiste`: `… AND NOT EXISTS (… chat_nachricht_anhang …) AND NOT {modul_gebunden}`
- `loeschen`: `… AND NOT {modul_gebunden}` (Chat räumt weiter die CASCADE)
- `chat::repo::anlegen_mit_anhaengen`: `… AND NOT {modul_gebunden}` (400 unverändert)
- `etb::repo::pruefe_anhaenge`: `SELECT (EXISTS (… chat_nachricht_anhang …) OR
  {modul_gebunden}), a.hochgeladen_von FROM anhang a …`. Das ETB-Literal
  `etb_eintrag_anhang` steckt jetzt im Register; die 422-Meldung lautet
  „Anhang ist bereits gebunden (Chat-Nachricht, Dokumentenablage, ETB-Eintrag oder Schaden)“
  und wird aus `ort` gebaut (`gebunden_meldung()`), damit ein fünfter Linker sie ohne
  Handarbeit erweitert. Die 400-/Uploader-Logik (D12) bleibt unverändert.

Die SQL-Texte entstehen zur Laufzeit aus Compile-Zeit-Konstanten und gehen über
`sqlx::AssertSqlSafe(format!(…))` (Präzedenz `anhang::repo::anzeige_laden` und
`schwaerzung_registry`; sqlx 0.9 nimmt sonst nur `&'static str`). Der Alias ist in jedem
Aufrufer ein Literal; kein Eingabewert gelangt in den Text.

**`LinkerStand` wird**
`{ chat_gesamt, chat_lebend, modul: Option<&'static ModulLinker> }`.
`linker_stand` zählt Chat wie bisher und je Registereintrag `COUNT(*)` in derselben
dynamisch gebauten SELECT; `modul` ist der erste Eintrag mit Zählung > 0. Abgeleitet:

- `ist_modul_gebunden()` = `modul.is_some()` (ersetzt `ist_dokument()`/`ist_etb()`);
- `generischer_download_gesperrt()` = modulgebunden **oder** Chat-Tombstone (Aussage wie
  heute);
- `ist_ungebunden()` = `chat_gesamt == 0 && modul.is_none()` (D12 unverändert);
- `routes::anhang::loeschen`: `if let Some(m) = linker.modul { 422 m.loesch_meldung }`
  statt zweier Einzelzweige.

**Der Guard** (`anhang::repo::tests::jeder_fremdschluessel_auf_anhang_ist_registriert`,
gegen eine frisch migrierte DB): die Menge aller Tabellen mit einem Fremdschlüssel auf
`anhang(id)` (über `pragma_foreign_key_list` je Tabelle aus `sqlite_master`) MUST gleich
`{chat_nachricht_anhang} ∪ MODUL_LINKER.tabelle` sein, und jede Registertabelle MUST eine
Spalte `anhang_id` tragen. Rot wird er in genau den Fällen, die heute still bleiben: neue
Tabelle ohne Eintrag, Eintrag ohne Tabelle. Der Chat steht bewusst außerhalb der Liste; der
Guard nennt ihn als einzige Ausnahme.

**Was sich an den Bestandstests ändert:** die Aussagen aller Tests aus LFH-632 und LFH-117
bleiben stehen (`sweep_verwaiste_haelt_{dokument,etb}_gebundene_anhaenge`,
`loeschen_verweigert_{dokument,etb}_gebundene_anhaenge`,
`dokument_anhang_*`/`etb_anhang_*` in `tests/anhang.rs`, `gebundener_anhang_ist_422` und
`fremder_ungebundener_upload_laesst_sich_nicht_binden` in `tests/etb_anhang.rs`,
`chat_anhang_vor_dem_senden_nur_fuer_die_hochladende_danach_fuer_alle`). Nur die
Unit-Tests, die `LinkerStand` als Struct-Literal bauen oder ein entferntes Feld prüfen
(`linker_stand_zaehlt_beide_linker`, `linker_stand_zaehlt_den_etb_linker`,
`ungebunden_heisst_an_keinem_der_drei_linker`,
`generischer_download_gesperrt_folgt_dem_chat_tombstone`), bekommen die neue Konstruktion
(`modul: Some(&MODUL_LINKER[i])`) — die Erwartung bleibt, der Name darf das Wort „drei“
verlieren.

**Warum hier und nicht in LFH-117:** LFH-117 hat den dritten Linker nach dem bestehenden
Muster ergänzt und die Regel „fünf Stellen“ dokumentiert; erst beim vierten kippt die
Rechnung, und dieser Change fasst die Stellen ohnehin an.

*Verworfen:* **viertes Feld `schaden_gesamt`** — funktioniert, lässt aber die Fehlerklasse
offen, die LFH-632 und LFH-117 je mit Einzeltests pinnen mussten, und die D12-Lücke für die
hochladende Person (Context) bliebe von einem vergessenen `ist_ungebunden`-Term abhängig.
**Ein Negations-Fragment `nicht_modul_gebunden(alias)`** (Stand 7062fa59) — passt nicht in
`pruefe_anhaenge`, das die Bindung als Wert neben `hochgeladen_von` liest. **Linker-Liste
per Laufzeit-Introspektion** — machte jede neue Tabelle mit FK auf `anhang` automatisch zur
Sperre, auch eine, die das nicht will; die explizite Liste plus Guard erzwingt die
Entscheidung, statt sie zu erraten.

### D3 — Allowlist `ERLAUBTE_MIME_ERFASSUNG` und eine Prüfkette `pruefe_vor_persist`

Neue Konstante in `src/anhang/mod.rs`: `image/jpeg`, `image/png`, `image/webp`,
`image/heic`, `image/heif`, `application/pdf`.

- **HEIC/HEIF** ist das Standardformat der iPhone-Kamera; ohne sie scheitert das häufigste
  Endgerät am Schadensort. `mime_guess` kennt die Endungen (Unit-Test
  `dokument_allowlist_kennt_heic_und_tiff_chat_nicht`).
- **JPEG/PNG/WebP** decken Android-Kameras, Screenshots und Messenger-Weiterleitungen.
- **PDF** trägt Kostenvoranschlag, Gutachten, Übergabeprotokoll.
- **Nicht enthalten:** Office-Dateien und Text/CSV (gehören in die Dokumentenablage, kein
  Erfassungsnachweis), GIF (keine Kameraquelle), TIFF (Scan-Format der Ablage, im Browser
  nicht darstellbar). Die Liste ist eine echte Teilmenge von `ERLAUBTE_MIME_DOKUMENT`; ein
  Unit-Test pinnt das.

Der Name ist modulneutral, weil Personen, Tiere und UHS dieselbe Liste übernehmen sollen.

**Eine Prüfkette für alle Upload-Wege.** Neuer Baustein

```rust
/// Typ aus der Endung gegen `erlaubt`, Größe, Virenscan — in dieser Reihenfolge, vor jedem
/// Persistieren. Liefert den serverseitig ermittelten MIME.
pub async fn pruefe_vor_persist(dateiname: &str, daten: &[u8], erlaubt: &[&str])
    -> Result<String, AppError>
```

Ihn rufen `hochladen_multipart` (generischer und ETB-Upload), `routes::dokument::ablegen`
und die neue Schaden-Ablage. Heute stehen die drei Aufrufe dort zweimal nebeneinander; eine
dritte Kopie wäre genau die Stelle, an der die Wege bei der nächsten Prüfung
(Content-Sniffing, LFH-114) still auseinanderliefen — dieselbe Begründung, mit der LFH-117
`hochladen_multipart` geteilt hat. `hochladen_multipart` behält dabei seinen frühen
`ermittle_mime_aus`-Aufruf **vor** dem Lesen der Bytes (ein verbotener Typ wird weiter ohne
Lesen und mit „Dateityp … ist nicht erlaubt“ abgewiesen, auch über dem Body-Limit) und ruft
`pruefe_vor_persist` danach zusätzlich; die doppelte Endungsprüfung kostet nichts, und das
Verhalten bleibt bitgleich.

**`hochladen_multipart` selbst wird für Schäden nicht verwendet**: er persistiert jede
Datei sofort ungebunden über den Pool. Die Schaden-Ablage braucht Datei, Linker und ETB in
einer Transaktion (D4), sonst ließe ein 409 nach Storno einen Waisen zurück, und die
Anforderung „speichert nichts“ wäre gebrochen.

Das Frontend spiegelt die Liste als `ERFASSUNG_ACCEPT` (D9); ein Test pinnt die
Endungsliste literal (Präzedenz `DOKUMENT_ACCEPT`: kein Codegen, Spiegel mit Kommentar).

### D4 — Routen unter `/schaeden/{sid}/anhaenge` mit typisiertem Gate

| Methode | Pfad | Gate | Layer | Antwort |
|---|---|---|---|---|
| GET | `/api/einsaetze/{id}/schaeden/{sid}/anhaenge` | `EinsatzLesezugriff<Schaeden>` | — | 200 `Vec<SchadenAnhangAnzeige>` |
| POST | `/api/einsaetze/{id}/schaeden/{sid}/anhaenge` | `EinsatzSchreibzugriff<Schaeden>` | `DefaultBodyLimit::max(26 MiB)` | 201 `SchadenAnhangAnzeige` |
| GET | `/api/einsaetze/{id}/schaeden/{sid}/anhaenge/{aid}/datei` | `EinsatzLesezugriff<Schaeden>` | `ConcurrencyLimitLayer(MAX_GLEICHZEITIGE_ASSET_DOWNLOADS)` | Datei, ETag/304 |
| DELETE | `/api/einsaetze/{id}/schaeden/{sid}/anhaenge/{aid}` | `EinsatzSchreibzugriff<Schaeden>` | — | 204 |

- `{aid}` ist die **Linker-id** (`einsatz_schaden_anhang.id`), nicht `anhang.id` — wie die
  Dokument-id der Ablage. Das DTO trägt keine `anhang_id`; der generische Weg ist ohnehin
  gesperrt.
- Neuer Marker `Schaeden => "schaeden"` in `modul_marker!` (`src/einsatz/modul.rs`) und
  `PFAD_KEY`-Eintrag `("/api/einsaetze/{id}/schaeden", Some("schaeden"))`. Der Guard prüft
  nur nicht-deferred Module; die Bestandsrouten `einsatz_schaden::*` bleiben deferred und
  unberührt, der Präfix ist für sie später ohnehin der richtige. Die Handler liegen in einer
  **neuen Datei** `src/routes/schaden_anhang.rs`; `schaden_anhang` steht nicht in
  `DEFERRED_MODULE`, also erzwingt `tests/einsatz_kontext_guard.rs` Gate und Marker.
- **Reihenfolge im Ablegen-Handler:** Extractor (403/409) → Schaden laden mit
  `AND einsatz_id = ?` (404) → Storno prüfen (409) → Multipart lesen: genau ein Feld
  `datei` mit Dateinamen, ein zweites Datei-Feld → 400 „Genau eine Datei je Ablage“, kein
  Feld → 400 „Keine Datei im Upload“; andere Felder werden ignoriert →
  `anhang::pruefe_vor_persist(…, ERLAUBTE_MIME_ERFASSUNG)` (400/422/503) → `etb_startwert()`
  laden → **ein** `write_retry!`: `schaden_repo::laden_tx` (Storno erneut → 409),
  `anhang::repo::anlegen_tx`, Linker-INSERT, `etb::system_audit_tx`. Der Scan läuft **vor**
  der Transaktion, damit kein Schreib-Lock über die Scandauer gehalten wird; das zweite
  Storno-Prüfen in der Transaktion schließt das Fenster zwischen Prüfung und Commit.
- **Entfernen:** ein `write_retry!`: lebenden Linker am Schaden im Einsatz laden (sonst
  404), Schaden per `laden_tx` (storniert → 409), Soft-Delete (`geloescht_at`,
  `geloescht_von_id`), `etb::system_audit_tx`. Der Text braucht den MIME aus `anhang`, der
  im selben Lookup gejoint wird.
- **Download:** Linker-Lookup `WHERE id = ? AND schaden_id = ? AND einsatz_id = ? AND
  geloescht_at IS NULL` ist die Zugriffsprüfung (404), danach `anhang_antwort`. Ein
  stornierter Schaden bleibt ladbar.
- **Statuscodes** nach der Konvention (LFH-267): fehlende/leere/zu große Datei, zwei
  Dateien, falscher Typ → 400; Scan-Fund → 422; Scanner weg → 503; storniert → 409
  (Lebenszyklus, wie PATCH und Übergeben am stornierten Schaden); fremd/unbekannt/entfernt
  → 404; Einsatz abgeschlossen → 409 aus dem Extractor.
- Multipart bleibt `axum::extract::Multipart` (kein JSON-Body); IDs über `PfadParam`.
- **D12 greift hier nicht:** die Route nimmt keine bestehende `anhang_id` entgegen und legt
  ihre Datei erst in der Transaktion an, die auch den Linker schreibt. Es gibt keinen
  Zeitpunkt, in dem eine Schaden-Datei ungebunden wäre. Deshalb braucht die Schaden-Ablage
  **keine eigene Bindungsabfrage** und keine Uploader-Prüfung — wie die Dokumentenablage
  (D7 in LFH-117: „Dokumente brauchen keine Sperre“). Die fünf Stellen bleiben fünf.

### D5 — Eine Datei je Ablage, Serienmodus, keine Idempotenz

Ein Request trägt genau ein Feld `datei`; mehrere Fotos entstehen über den **Serienmodus**
der `ErfassungsModal`-Hülle („Speichern und nächste“), jedes mit eigenem ETB-Nachweis.
Begründung: ein Body-Limit von 26 MiB je Request passt zur 25-MiB-Grenze und zum
120-s-Upload-Timeout über Mobilfunk; ein Fehlschlag trifft genau eine Datei, und Entfernen
wirkt auf genau das, was abgelegt wurde. Dieselbe Schnittlinie hat LFH-117 für den
ETB-Upload gewählt. **Vom Auftraggeber bestätigt** (Freigabe der Proposes, 24./25.09.2026).

**Keine `client_id`-Idempotenz.** LFH-117 brauchte sie (D13 dort), weil die ETB-Erfassung
eine Offline-Queue hat, die automatisch wiederholt, und weil zwei Browser-Tabs denselben
Entwurf tragen können. Beides gibt es hier nicht: der Upload läuft nur online, es gibt keine
Queue und keinen automatischen Retry, und der Dialog sperrt doppeltes Absenden
(`sendetRef` der Erfassungshülle). Die Dokumentenablage fährt dasselbe Modell. Das
Restrisiko steht unter Risks.

*Verworfen:* **mehrere Dateien in einem Request mit einem Sammel-Eintrag** — braucht ein
Body-Limit von n × 25 MiB, macht einen einzigen Fehlschlag teuer und den Nachweis beim
Entfernen einer einzelnen Datei uneindeutig. **`client_id` am Multipart** — ein
Idempotenzschlüssel ohne Wiederholer ist eine Zusicherung, die kein Aufrufer braucht, und
er bräuchte die Vergleichsregel aus D13 (gleiche Bytes?) samt eigenem 409.

### D6 — Pseudonyme ETB-Spur

Wortlaut `Schaden {registrier_anzeige}: {Art} abgelegt|entfernt`, `Art` = „Foto“ für
`image/*`, „PDF“ für `application/pdf`, abgeleitet aus dem **serverseitig ermittelten**
MIME, nie aus Eingaben. Kein Dateiname, kein Ort (anders als das Anlegen, das `ort_kurz`
nennt: der Ort ist dort Teil der Erfassung, hier liefe er nur mit), keine Beschreibung.
Geschrieben über `etb::system_audit_tx` im selben `write_retry!` wie Anhang und Linker
(Pattern B), mit vorher geladenem `etb_startwert()`. Die Schwärzung lässt
`etb_eintrag.inhalt` stehen (G_ETB) — das ist hier unkritisch, weil der Text keinen
Personenbezug trägt; ein Leak-Test pinnt das mit einem Dateinamen, der einen Personennamen
enthält. Der Wortlaut entsteht in einer reinen Funktion `etb_text(registrier_nr, mime,
Vorgang)`.

### D7 — Schwärzung: Regel `ZeileLoeschen`, nach `anhang`

Neue `TabellenRegel` für `einsatz_schaden_anhang` mit `Scoping::EinsatzId` und
`ZeileLoeschen` für alle neun Spalten, in `TABELLEN` **nach** `anhang` (wie
`einsatz_dokument`), Kommentar nach dessen Muster. Der Kommentar an der `anhang`-Regel
(„CASCADE räumt die Linker … mit“) nennt den vierten Linker. Praktisch räumt schon die
CASCADE von `anhang` alle Zeilen weg; die Regel macht die Klassifikation explizit und hält
`zeile_loeschen_ist_kohaerent`. Ein Verhaltenstest nach dem Muster
`schwaerzung_loescht_dokument_samt_anhang_und_haelt_den_etb_nachweis` pinnt: Datei und
Linker weg (auch soft-gelöschte), ETB-Einträge da. Entspricht der Entscheidung „Datei bei
Schwärzung löschen, Eintrag/Text bleibt“.

### D8 — Live über `schaden` plus ETB-Ereignis

Nach dem Commit: `state.live.publiziere(einsatz_id, etb_id)` (ETB, ID-only) und
`LiveEvent::Schaden` mit `{einsatz_id, schaden_id}` über den Helfer `sse_schaden` aus
`routes/einsatz_schaden.rs`, der dafür am Ort `pub(crate)` wird (kleinste Änderung, die
Bestandsroute bleibt unangetastet; keine Kopie). Die Modul-Post-Filter bleiben unverändert
(`Schaden → ["schaeden"]`). Im Frontend neuer Key-Prefix
`EINSATZ_KEYS.schadenAnhaenge = 'einsatz-schaden-anhaenge'` mit Factory
`schadenAnhaenge(einsatzId, schadenId)`, eingetragen unter `EINSATZ_STREAM_EVENTS.schaden`
neben `schaeden` (Prefix-Match invalidiert alle Anhanglisten des Einsatzes — bei einer
Detailseite je Sitzung billig). **Bewusste Abweichung:** die bestehenden Schadensrouten
verteilen kein ETB-Ereignis; die neuen tun es, wie Dokumentenablage und ETB-Erfassung. Die
Lücke der Bestandsrouten ist ein **Nebenbefund** (Folgeticket), nicht Teil dieses Changes.

### D9 — Frontend: Block „Fotos und Dateien“ auf der Detailseite

- **Upload-Konstanten an einen neutralen Ort.** Neues `api/upload.ts` mit
  `UPLOAD_MAX_GROESSE` (25 MiB, Spiegel von `MAX_GROESSE`), `UPLOAD_TIMEOUT_MS` (120 s) und
  `ERFASSUNG_ACCEPT` (`.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf`, Spiegel von
  `ERLAUBTE_MIME_ERFASSUNG`). `DOKUMENT_MAX_GROESSE` und `DOKUMENT_UPLOAD_TIMEOUT_MS`
  entfallen; ihre vier Leser (`api/dokumente.ts`, `api/etb.ts`,
  `etb/Schnellerfassung.tsx`, `dokumente/DokumentAblegenModal.tsx`) lesen die neuen Namen.
  `DOKUMENT_ACCEPT` bleibt in `api/dokumente.ts` (es ist die Dokument-Allowlist, die das ETB
  mitbenutzt). Ein Schaden-Upload mit „Dokument“-Konstanten wäre ein Name, der lügt.
- **Ort:** ein `Paneel` unter dem Datenraster von `SchaedenDetailPage`, mit Kopf „Fotos und
  Dateien“ und Zähler. Es ist eine **Liste** („was ist mit diesem hier?“, LFH-330), keine
  Tabelle.
- **Zeile:** Download-Anker (Dateiname, Größe über `karten/formatGroesse`,
  `abgelegt von · Zeit`) als nativer `<a href download>` auf die modulgebundene Route — der
  Anker wird aus `DokumentePage` (`DownloadAnker`) in ein geteiltes
  `components/DownloadAnker.tsx` gehoben, mit `minHeight: controlHeight` und `padding` über
  eine reine, exportierte Stilfunktion (handgebautes Bedienziel, zwei Angaben nach
  LFH-365). Der zugängliche Name trägt die Zeilenkennung („dach.jpg, 2,0 MB, Datei von
  Schaden S-003 herunterladen“), wie `EtbAnhaenge` es für Einträge tut. `EtbAnhaenge`
  bleibt bei `verweisStil` (Textverweis in der Zeitachse, eine andere Bauform).
- **Ablegen:** Knopf „Datei ablegen“ im Paneelkopf (öffnet, sendet nicht → Kopf-Slot ist
  richtig), nur mit Schreibrecht und nicht storniert. Dialog auf `ErfassungsModal` mit
  `serie`; das Dateifeld (antd `Upload` mit `beforeUpload={() => false}`, `maxCount={1}`,
  Vorab-Größenprüfung mit dem Server-Wortlaut, `accept`-Prop) wird aus
  `DokumentAblegenModal` in `components/DateiFeld.tsx` gehoben („dieselbe Eingabe wird nicht
  zweimal gebaut“, M20). Die Bauform bleibt antds `Upload`, damit
  `DokumentAblegenModal.test.tsx` unverändert grün bleibt; den von LFH-117 gemessenen
  zweiten Tabstopp prüft die Prüfliste (Aufgabe 7.2) ausdrücklich — tritt er auf, ist das ein
  offener Punkt mit Zielticket für beide Dialoge, kein stiller Erbfehler. Upload über
  `apiUpload` mit `UPLOAD_TIMEOUT_MS`.
- **Entfernen — erst die Umkehrbarkeit:** Soft-Delete, aber **ohne Wiederherstellen in der
  Oberfläche**; aus Bediensicht unumkehrbar. Deshalb Rückfrage per `Popconfirm` mit
  `okButtonProps={{ danger: true }}` („Datei entfernen? Sie verschwindet aus der Liste; der
  ETB-Nachweis bleibt.“), icon-only `danger`-Knopf mit zugänglichem Namen samt
  Zeilenkennung („Datei dach.jpg von Schaden S-003 entfernen“), in einer Reihe mit Abstand
  `middle` zum Anker (Rot steht nicht bündig neben Neutralem). Kein Rückgängig-Toast: es
  gibt keinen serverseitigen Rückweg (LFH-343).
- **Zustände:** `PaneelZustand` für Laden/Fehler/leer („Noch keine Fotos oder Dateien“);
  storniert → Liste lesbar, keine Aktionen; ohne Schreibrecht entfallen Ablegen und
  Entfernen wie die übrigen Aktionen der Seite (Übergeben, Stornieren).
- **Keine Emojis**, Ikonen aus `@ant-design/icons` in `aria-hidden`-Hülle; kein neues
  punktuelles `size=`.

### D10 — Dokumentation der Linker-Regel

Der CLAUDE.md-Absatz „ETB-Anhänge (LFH-117)“ sagt heute „Jeder Linker gehört in fünf
Stellen“, und `chat/repo.rs` sowie `etb/repo.rs` tragen je den Kommentar „eine der FÜNF
Stellen“. Nach D2 ist die Anleitung falsch: ein neuer modulgebundener Linker braucht **einen
Registereintrag**, der Guard macht den vergessenen rot. Der Absatz wird auf das Register
umgeschrieben und nennt die D12-Folge für die hochladende Person (Context) samt der
Testregel „Abschottung als ablegende Person prüfen“; die zwei Kommentare verweisen auf
`MODUL_LINKER`. Ein eigener CLAUDE.md-Absatz zu Schaden-Anhängen hält Linker-id statt
`anhang.id` im Pfad, Soft-Delete ohne UI-Rückweg und die ETB-Live-Abweichung fest.

## Risks / Trade-offs

- **[Register-Refactoring bricht Bestandsverhalten]** → reine Umformung; die Bestandstests
  von Chat, Dokument und ETB laufen mit unveränderten Aussagen als Netz mit, und der Guard
  kommt zuerst rot. Einzige sichtbare Änderung ist der ETB-422-Wortlaut, den kein Test
  pinnt; der neue Wortlaut wird in `tests/etb_anhang.rs` gepinnt.
- **[Abschottungstest blind durch D12]** → alle generischen und Bindungs-Tests für
  Schaden-Dateien laufen als ablegende Person (`admin`, wie die Bestandstests); je ein
  Gegenstück als andere Person ist nicht nötig, weil dort D12 ohnehin 404 liefert.
- **[Migrationsnummer kollidiert]** → `scripts/check-migrationen.sh` unmittelbar vor dem PR
  gegen frisches `origin/alpha`; der Required Check `Migrationsnummern` fängt späte
  Kollisionen (LFH-23 arbeitet parallel, bringt nach heutigem Stand aber keine Migration).
- **[Storno zwischen Prüfung und Commit]** → Storno-Prüfung im selben `write_retry!` wie der
  Insert (D4).
- **[Verlorene Antwort erzeugt eine Dublette]** → Läuft der 120-s-Timeout ab, nachdem der
  Server schon committet hat, zeigt der Dialog einen Fehler, und ein erneutes Ablegen legt
  die Datei ein zweites Mal samt zweitem ETB-Nachweis ab. Bewusst hingenommen (D5): selten,
  sichtbar, und über Entfernen mit Nachweis korrigierbar.
- **[EXIF/GPS im Foto]** Standort und Gerät bleiben in der Datei, sichtbar für jeden mit
  Modulrecht. → Bewusste Entscheidung des Auftraggebers (Beweismittel); Bereinigung ist
  LFH-747. Die Schwärzung löscht die Datei ohnehin.
- **[Datenbankwachstum]** 25 MiB je Foto als BLOB in SQLite. → Wie Chat, Dokumentenablage
  und ETB; die Backup-Strategie (VACUUM INTO) erfasst es. Kein neues Risiko, aber das
  erste, das im Minutentakt am Schadensort entsteht.
- **[Guard sieht nur deklarierte FKs]** Eine Tabelle, die `anhang.id` ohne `REFERENCES`
  speichert, entgeht ihm. → Gleiche Grenze wie der Schwärzungs-Guard; im Guard-Kommentar
  benannt.
- **[Scan-Fund nur per Einheitstest belegbar]** Ein echter clamd-Fund ist im Testlauf nicht
  herstellbar. → `anhang::entscheide` ist unit-getestet; die Reihenfolge „Scan vor jeder
  Schreiboperation“ belegt der 503-Test im eigenen Binary.
- **[Prüfkette verschiebt Verhalten des generischen Uploads]** (D3) → `hochladen_multipart`
  behält die frühe Endungsprüfung vor dem Lesen; die Bestandstests
  `unerlaubter_dateityp_abgelehnt` und `upload_weist_exe_ab` bleiben das Netz.

## Migration Plan

1. `origin/alpha` frisch holen (LFH-117 ist gemergt, `f68aa1f1`), Worktree darauf bringen.
2. `0126_einsatz_schaden_anhang.sql` anlegen; rein additiv (`CREATE TABLE`,
   `CREATE INDEX`), kein Rebuild, kein `-- no-transaction`.
3. Rollback: die Tabelle bleibt leer, bis jemand ablegt. Eingespielte Migrationen werden
   nicht editiert; eine Rücknahme nach ersten Ablagen braucht eine Folgemigration, die
   Linker und zugehörige `anhang`-Zeilen entfernt, und den Rückbau des Register-Eintrags im
   selben Zug (sonst meldet der Guard aus D2 die verwaiste Tabelle bzw. den toten Eintrag).

## Annahmen

Beide Annahmen des Stands 7062fa59 hat der Auftraggeber mit der Freigabe der Proposes
(24./25.09.2026) übernommen:

- **Eine Datei je Ablage mit Serienmodus** (D5).
- **Übergebene und abgeschlossene Schäden nehmen Dateien an**, nur der stornierte nicht
  (Spec „Lebenszyklus des Schadens“). Grund: der Nachweis einer Instandsetzung entsteht
  typischerweise nach dem Abschluss.

## Open Questions

Keine, die Spec, Ansatz oder Aufgabenschnitt ändern. Der Abgleich mit dem gemergten
LFH-117 hat nur technische Korrekturen ergeben (Register-Form, ETB-Status 422,
Prüfkette statt `hochladen_multipart`, Migrationsnummer, Concurrency-Layer).
