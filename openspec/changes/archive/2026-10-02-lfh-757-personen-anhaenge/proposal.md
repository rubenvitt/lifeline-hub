# Proposal

## Why

Bei betroffenen Personen entstehen im Einsatz Fotos und Dokumente: ein Bild zur
Identifikation oder Wiedererkennung, ein Foto der Verletzung für die Übergabe, ein
mitgebrachtes Dokument, ein Übergabeprotokoll. Heute gibt es dafür nur die Dokumentenablage.
Sie kennt keinen Bezug auf eine Person, ist über das Modul `dokumente` sichtbar statt über
`personen` und schreibt ihren Freitext-Titel ins ETB. LFH-21 hat Anhänge an Erfassungsobjekten
für Schäden gebaut und Personen ausdrücklich zurückgestellt, weil sie das höchste DSGVO-Risiko
tragen und ein Lese-Audit brauchen (Folgeticket LFH-757). Die Bausteine dafür stehen
inzwischen: Linker-Register `MODUL_LINKER`, Prüfkette `pruefe_vor_persist`, Allowlist
`ERLAUBTE_MIME_ERFASSUNG`, bereinigte Auslieferung mit Original nur für die Einsatzleitung
(LFH-747).

## What Changes

- **Fotos und PDFs an einer Person.** Auf der Personen-Detailseite können Personen mit
  Schreibrecht eine Datei ablegen. Alle mit Lesezugriff auf das Modul Personen, auch
  Beobachter, können sie auflisten und herunterladen, wie die Detailansicht selbst. Erlaubt
  sind dieselben Typen wie an Schäden (JPEG, PNG, WebP, HEIC/HEIF, PDF), eine Datei je
  Ablage, höchstens 25 MiB, Virenscan vor dem Speichern. Datei, Verknüpfung und ETB-Nachweis
  entstehen in einer Transaktion.
- **Lese-Audit je Download.** Jeder Abruf einer Personen-Datei schreibt vor der Auslieferung
  eine Zeile in das Zugriffsprotokoll der Person (`person_zugriff_audit`, neue Art `anhang`).
  Das gilt auch für eine Antwort 304 (der Browser zeigt die Datei dann aus seinem Cache) und
  für den Abruf des Originals. Scheitert die Protokollzeile, wird nichts ausgeliefert. Die
  Liste der Anhänge wird nicht protokolliert, wie alle Listen-Reads. Die Zeile nennt Person,
  abrufende Person, Zeit und Art, aber nicht die Datei. Die Audit-Einsicht der
  Einsatzleitung zeigt die Arten lesbar.
- **Entfernen ist ein Soft-Delete mit Nachweis**, wie an Schäden. Die Datei bleibt bis zur
  Schwärzung des Einsatzes gespeichert.
- **Pseudonyme ETB-Spur:** „Person R-007: Foto abgelegt“ bzw. „… entfernt“. Kein Dateiname,
  kein Name, keine Freitexte. Ein Leak-Test pinnt das.
- **Stornierte Person:** Ablegen und Entfernen werden mit 409 abgewiesen, Lesen bleibt.
- **Nur im Modul Personen sichtbar:** weder in der Dokumentenablage noch über die generischen
  Anhang-Routen, Chat oder ETB (vierter Eintrag im Register `MODUL_LINKER`, fünfter Linker auf `anhang`). Die
  Original-Aktion aus LFH-747 gilt auch hier, ihr ETB-Vermerk nennt „Person R-007“.
- **Schwärzung löscht Datei und Verknüpfung**, der pseudonyme ETB-Nachweis und das
  Zugriffsprotokoll bleiben.
- **Ein Anhang-Block für alle Erfassungsobjekte (Frontend).** Der Block „Fotos und Dateien“
  der Schadensseite wird zu einem geteilten Baustein. Schaden und Person nutzen ihn. Tiere und
  UHS brauchen danach nur noch die Einbindung.

Keine Änderung ist **BREAKING**. Neue Routen und das neue DTO sind additiv. Das Enum
`ZugriffArt` wächst um einen Wert. Die ETB-422-Meldung „bereits gebunden“ nennt zusätzlich die
Person, weil sie aus dem Register gebaut wird.

## Capabilities

### New Capabilities

- `personen-anhaenge`: Dateien (Fotos, PDF) an einer betroffenen Person ablegen, auflisten,
  herunterladen und entfernen. Dazu gehören Allowlist, Größe und Virenscan, Rechte über das
  Modul Personen, Lebenszyklus der Person, Lese-Audit je Download, pseudonyme ETB-Spur,
  Live-Verteilung, Abschottung gegen Dokumentenablage, generische Routen, Chat und ETB, das
  Verhalten des Orphan-Sweeps und die Schwärzung.

### Modified Capabilities

- `anhang-metadaten`: Die Requirements zählen die Wege einzeln auf (Chat, Dokumentenablage,
  ETB, Schaden). Bereinigte Auslieferung, Original nur für Einsatzleitung und System-Admin und
  die Original-Aktion in der Oberfläche gelten künftig auch für Personen-Anhänge.

## Impact

- **Migrationen:** `0137_einsatz_person_anhang.sql` (neuer Linker, rein additiv) und
  `0138_person_zugriff_audit_anhang.sql` (Rebuild von `person_zugriff_audit` mit Art `anhang`,
  `-- no-transaction`, Muster 0132). Stand 02.10.2026 ist `0134` die höchste Nummer auf
  `origin/alpha`. Vor dem PR erneut mit `scripts/check-migrationen.sh` prüfen.
- **Backend:** `src/anhang/repo.rs` (Registereintrag), neues `src/person/anhang.rs`, neues
  `src/routes/person_anhang.rs`, `src/routes/mod.rs`, `src/app.rs`, `src/person/audit_repo.rs`
  (`ZugriffArt::Anhang`), `src/routes/einsatz_person.rs` (`sse_person` wird `pub(crate)`),
  `src/einsatz/schwaerzung_registry.rs`, `src/einsatz/repo.rs` (Verhaltenstest),
  `src/db.rs` (Migrationstest), `src/api_doc.rs`. Tests: neue `tests/person_anhang.rs` und
  `tests/person_anhang_scan.rs`, dazu `tests/anhang.rs`, `tests/etb_anhang.rs`,
  `tests/dokument.rs`, `tests/anhang_metadaten.rs`, `tests/common`.
- **Frontend:** geteilter Baustein unter `components/anhaenge/` (aus
  `pages/schaeden/SchadenAnhaenge.tsx` und `SchadenAnhangAblegenModal.tsx`),
  `pages/SchaedenDetailPage.tsx`, `pages/PersonenDetailPage.tsx`, `api/einsatzPerson.ts`,
  `api/queryKeys.ts`, `api/types.ts`, Codegen (`openapi.json`, `types.generated.ts`).
- **API:** `GET|POST /api/einsaetze/{id}/personen/{pid}/anhaenge`,
  `GET /api/einsaetze/{id}/personen/{pid}/anhaenge/{aid}/datei`,
  `DELETE /api/einsaetze/{id}/personen/{pid}/anhaenge/{aid}`. Neues DTO
  `PersonAnhangAnzeige`, `ZugriffArt` um `anhang` erweitert.
- **Dokumentation:** `src/AGENTS.md` (Abschnitt Anhänge), `frontend/src/personen/AGENTS.md`.
- **Nachweise:** e2e-Spec, Prüfliste Einsatztauglichkeit für die Einbindung auf der
  Personenseite.
- **Keine neuen Abhängigkeiten.**
- **Nicht enthalten:** Bildvorschau/Thumbnails (LFH-759), Anhänge an Tieren und UHS (eigene
  Tickets), Anhänge im Personendruck und im CSV-Export, Offline-Speicherung der Anhangliste
  (bleibt außerhalb der Lagebild-Allowlist, LFH-723/LFH-767).
