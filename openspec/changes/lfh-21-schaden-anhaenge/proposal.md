# Proposal

## Why

Wer einen Schaden erfasst, braucht meist ein Foto dazu: für die Übergabe an Stadtwerke
oder Bauhof, für die Versicherung, als Beweis für den Zustand zum Zeitpunkt der Meldung.
Heute geht das nicht. Die Anhang-Infrastruktur steht (BLOB-Speicher, 25-MiB-Grenze,
MIME-Allowlist, ClamAV-Scan vor dem Speichern, ETag-Download, Orphan-Sweep, Schwärzung),
und seit LFH-117 hängen drei Linker daran: Chat, Dokumentenablage und ETB. Ein
Erfassungsmodul ist noch nicht angeschlossen. Der einzige Weg zu einem Schadensfoto ist die
Dokumentenablage (LFH-632), und die kennt keinen Bezug auf einen Schaden. Sie ist über das
Modul `dokumente` sichtbar, nicht über `schaeden`, und sie schreibt den Freitext-Titel ins
ETB. LFH-21 fordert Anhänge an Erfassungsobjekten. Diese erste Ausbaustufe bindet sie an
Schäden an (Welle C2 des Epics LFH-60), weil Schäden kein Lese-Audit brauchen und das
geringste DSGVO-Risiko der Erfassungsmodule tragen.

## What Changes

- **Fotos und PDFs an einem Schaden.** Auf der Schadens-Detailseite können Personen mit
  Schreibrecht eine Datei ablegen, alle mit Lesezugriff auf das Modul Schäden können sie
  auflisten und herunterladen. Erlaubt sind Kamerabilder einschließlich HEIC/HEIF sowie
  PDF, eine Datei je Ablage (mehrere nacheinander über den Serienmodus des Dialogs),
  höchstens 25 MiB. Der Virenscan läuft vor dem Speichern. Datei, Verknüpfung und
  ETB-Nachweis entstehen in **einer** Transaktion; die Datei ist also nie ungebunden.
- **Entfernen ist ein Soft-Delete mit Nachweis.** Die Datei verschwindet aus der Liste und
  ist nicht mehr ladbar. Die Bytes bleiben bis zur Schwärzung des Einsatzes erhalten
  (Beweissicherung). Ablegen und Entfernen schreiben je einen pseudonymen System-ETB-
  Eintrag, der nur die Registriernummer und die Art nennt („Schaden S-003: Foto
  abgelegt“), nie den Dateinamen.
- **Nur im Fachmodul sichtbar.** Die Dateien erscheinen weder in der Dokumentenablage noch
  über die generischen Anhang-Routen. Der generische Download antwortet 404, der
  generische Löschpfad 422, **auch für die ablegende Person**. Eine Chat-Nachricht kann sie
  nicht verknüpfen (400, der Chat-Wortlaut „Unbekannter oder fremder Anhang“), ein
  ETB-Eintrag ebenso wenig (422, „bereits gebunden“, wie jeder gebundene Anhang seit
  LFH-117).
- **Stornierter Schaden:** Ablegen und Entfernen werden mit 409 abgewiesen, Lesen bleibt
  möglich. Übergebene und abgeschlossene Schäden nehmen weiter Dateien an (Annahme,
  bestätigt vom Auftraggeber am 24./25.09.2026).
- **Schwärzung löscht die Datei.** Die DSGVO-Schwärzung des Einsatzes entfernt Datei und
  Verknüpfung, der pseudonyme ETB-Nachweis bleibt stehen.
- **Live:** Ablegen und Entfernen verteilen das bestehende Ereignis `schaden` und das
  ETB-Ereignis. Andere Sitzungen sehen die Liste und das Tagebuch ohne Neuladen.
- **Linker-Register statt Einzelstellen (intern).** LFH-117 hat festgehalten, dass jeder
  Linker auf `anhang` an **fünf Stellen** von Hand nachgetragen werden muss: `LinkerStand`,
  das `NOT EXISTS` in `sweep_verwaiste` und in `anhang::repo::loeschen` sowie die
  Bindungsabfragen in `chat::repo::anlegen_mit_anhaengen` und `etb::repo::pruefe_anhaenge`.
  Dieser Change bringt den vierten Linker und zieht dabei die drei modulgebundenen
  (Dokument, ETB, Schaden) in ein Register `MODUL_LINKER`, aus dem alle fünf Stellen ihre
  SQL-Bedingung und `LinkerStand` seine Ableitungen beziehen. Ein Guard-Test vergleicht das
  Register mit allen Fremdschlüsseln auf `anhang` in der Datenbank. Nach außen ändert sich
  dadurch nur der Wortlaut der ETB-422-Meldung, die den Schaden mit nennt.

Keine Änderung ist **BREAKING**. Die neuen Routen und das neue DTO sind additiv. Die
generischen Anhang-Routen, die Chat- und die ETB-Bindung ändern ihr Verhalten nur für
Dateien, die es heute noch nicht gibt.

**Abhängigkeit (erfüllt):** LFH-117 (`lfh-117-etb-anhaenge`, PR #161) ist seit Merge-Commit
`f68aa1f1` auf `origin/alpha`. Tabellen- und Funktionsnamen dieses Changes sind gegen den
gemergten Stand abgeglichen (design.md, Context).

## Capabilities

### New Capabilities

- `schaden-anhaenge`: Dateien (Fotos, PDF) an einem Schaden ablegen, auflisten,
  herunterladen und entfernen. Dazu gehören Allowlist, Größe und Virenscan, Rechte über
  das Modul Schäden, Lebenszyklus des Schadens und des Einsatzes, pseudonyme ETB-Spur,
  Live-Verteilung, Abschottung gegen Dokumentenablage, generische Anhang-Routen, Chat und
  ETB, Verhalten des Orphan-Sweeps und die Schwärzung.

### Modified Capabilities

(keine; `openspec/specs/` führt nur `lagekarte-fachebenen`, das hier nicht berührt wird.
Anhang-Infrastruktur, Dokumentenablage und Schadensmodul haben keine Spec unter
`openspec/specs/`. Die ETB-Anhänge aus LFH-117 liegen im gemergten, noch nicht
archivierten Change `lfh-117-etb-anhaenge`; dessen Anforderung „gebundener Anhang → 422“
gilt unverändert und umfasst die Schaden-Dateien, ohne dass ihr Wortlaut sich ändert.)

## Impact

- **Migration:** `0126_einsatz_schaden_anhang.sql`. Stand 25.09.2026 ist `0125`
  (`etb_eintrag_anhang`) die höchste Nummer auf `origin/alpha` und auf allen Branches; vor
  dem PR erneut mit `scripts/check-migrationen.sh` gegen frisches `origin/alpha` prüfen und
  bei Bedarf mit `--umnummerieren` anhängen.
- **Backend:** `src/anhang/{mod,repo}.rs` (Allowlist `ERLAUBTE_MIME_ERFASSUNG`,
  Prüfbaustein `pruefe_vor_persist`, Linker-Register), `src/routes/anhang.rs`,
  `src/routes/dokument.rs` (nutzt den Prüfbaustein wie `hochladen_multipart`),
  `src/chat/repo.rs`, `src/etb/repo.rs`
  (beide Bindungsabfragen aus dem Register), ein neues `src/schaden/anhang.rs`, ein neues
  `src/routes/schaden_anhang.rs`, `src/routes/mod.rs`, `src/schaden/mod.rs`, `src/app.rs`,
  `src/einsatz/modul.rs` (Marker `Schaeden`, `PFAD_KEY`),
  `src/einsatz/schwaerzung_registry.rs`, `src/einsatz/repo.rs` (Verhaltenstest),
  `src/api_doc.rs`. Tests in `tests/anhang.rs`, `tests/etb_anhang.rs`, `tests/dokument.rs`,
  in neuen Dateien `tests/schaden_anhang.rs` und `tests/schaden_anhang_scan.rs` sowie
  Repo-Tests.
- **Frontend:** neues `api/upload.ts` (Größe, Timeout, Erfassungs-`accept`; Leser:
  `api/dokumente.ts`, `api/etb.ts`, `etb/Schnellerfassung.tsx`,
  `dokumente/DokumentAblegenModal.tsx`), `api/einsatzSchaden.ts`, `api/queryKeys.ts`,
  `api/types.ts`, Codegen (`openapi.json`, `types.generated.ts`),
  `pages/SchaedenDetailPage.tsx`, neue Bausteine unter `pages/schaeden/`. Dazu ein
  geteilter Download-Anker (`components/DownloadAnker.tsx`, aus `pages/DokumentePage.tsx`)
  und ein geteiltes Dateifeld (`components/DateiFeld.tsx`, aus
  `dokumente/DokumentAblegenModal.tsx`).
- **API:** `GET|POST /api/einsaetze/{id}/schaeden/{sid}/anhaenge`,
  `GET /api/einsaetze/{id}/schaeden/{sid}/anhaenge/{aid}/datei`,
  `DELETE /api/einsaetze/{id}/schaeden/{sid}/anhaenge/{aid}`; neues DTO
  `SchadenAnhangAnzeige`. Geänderter Wortlaut der ETB-422-Meldung „bereits gebunden“.
- **Dokumentation:** CLAUDE.md-Absatz „ETB-Anhänge (LFH-117)“ (die fünf Stellen) und die
  Kommentare „eine der FÜNF Stellen“ in `chat/repo.rs` und `etb/repo.rs` verweisen auf das
  Register.
- **Nachweise:** e2e-Spec `e2e/schaden-anhaenge.spec.ts` und die Prüfliste
  Einsatztauglichkeit für den neuen Block.
- **Keine neuen Abhängigkeiten.**
- **Nicht enthalten, als Folgetickets:**
  - EXIF-/GPS-Bereinigung beim Upload → **LFH-747** (besteht).
  - Chat prüft beim Verknüpfen Allowlist und Hochladende → **LFH-745** (besteht; für
    Schaden-Dateien ohne Wirkung, weil der Chat gebundene Dateien ohnehin abweist).
  - Anhänge in der ETB-Druckansicht → **LFH-744** (besteht; Schaden-Dateien stehen nicht
    am ETB-Eintrag, nur ihr pseudonymer Nachweis).
  - **Neu anzulegen:** Anhänge an Personen (Lese-Audit je Download und CHECK-Rebuild von
    `person_zugriff_audit`), Anhänge an Tieren, Anhänge an UHS, Bildvorschau/Thumbnails,
    Nebenbefund „Bestehende Schadensrouten verteilen kein ETB-Live-Ereignis“.
