# Proposal

## Why

Im Einsatztagebuch lässt sich heute nur Text erfassen. Foto der Schadenstelle, abfotografierter
Meldezettel und eingegangenes Fax lassen sich nicht an den Eintrag hängen, der sie
dokumentiert. Die Dokumentenablage (LFH-632) kann eine Datei nachträglich auf einen Eintrag
beziehen. Die Datei ist dann aber ein eigenes Dokument mit Kategorie, Titel und eigenem
System-Eintrag und steht nicht am Eintrag in der Zeitachse. LFH-117 (Welle C1 des Epics
LFH-60) schließt diese Lücke. Der Auftraggeber hat am 24.09.2026 entschieden: eigene
Join-Tabelle `etb_eintrag_anhang`, Anhängen nur online, bei der Schwärzung wird die Datei
gelöscht und der Eintrag samt Text bleibt.

## What Changes

- Beim Erfassen kann ein ETB-Eintrag Dateien tragen. Der Client lädt sie über einen eigenen,
  ETB-gegateten Upload hoch und nennt sie beim Erfassen mit `anhang_ids`. Eintrag und
  Verknüpfung entstehen in **einer** Transaktion, die `client_id`-Idempotenz bleibt
  erhalten. Ein Replay liefert den Bestand samt seinen Anhängen.
- Der Upload nimmt die **Dokument-Allowlist** (mit HEIC/HEIF für iPhone-Fotos und TIFF für
  Scans), nicht die Chat-Allowlist.
- Jede Route, die ETB-Einträge ausliefert (Liste, Einzelladen, Erfassen-Antwort), trägt
  `anhaenge` am Eintrag, leer statt fehlend. Codegen wird nachgezogen.
- Eine eigene Download-Route unter dem ETB-Präfix liefert die Datei nur mit ETB-Lesezugriff
  aus. Ein fremder Einsatz oder ein fremder Eintrag ergibt 404.
- `anhang` bekommt seinen **dritten Linker**. Der generische Download sperrt ETB-Anhänge
  (404), der generische Löschweg weist sie ab (422), und der Aufräumlauf für verwaiste
  Dateien lässt sie stehen.
- **Kreuzsperren:** Eine Datei hat genau einen Lebenszyklus. Das ETB verknüpft keine
  Chat- oder Dokument-Dateien, und der Chat verknüpft keine ETB-Dateien.
- Die Schwärzung löscht ETB-Anhänge mit jeder anderen Datei des Einsatzes. Eintrag und
  Text bleiben (G_ETB).
- Frontend: Die Schnellerfassung bekommt einen Knopf „Anhang“ mit Dateiliste. Die
  Zeitachse und die Vorschau der Sprungpalette zeigen je Anhang einen Download-Verweis mit
  Dateiname und Größe. Ohne Netz ist „Anhang“ gesperrt und sagt warum. Der Text bleibt
  über die Offline-Queue erfassbar.
- **Kein Bearbeiten.** Das ETB ist append-only (`migrations/0004_etb.sql`). Die Ticketzeile
  „ETB-Erfassen/-Bearbeiten“ entfällt für Bearbeiten. Eine Korrektur ist eine Berichtigung,
  also ein neuer Eintrag, und kann eigene Anhänge tragen. Ein Anhang lässt sich nach dem
  Erfassen weder tauschen noch entfernen.

## Capabilities

### New Capabilities
- `etb-anhaenge`: Ein ETB-Eintrag trägt beim Erfassen Dateien. Sie sind nur über das
  ETB-Modul ladbar, an genau einen Eintrag gebunden, bis zur Schwärzung unveränderlich und
  in Zeitachse und Vorschau sichtbar.

### Modified Capabilities
<!-- keine: openspec/specs/ kennt bisher nur lagekarte-fachebenen. Das Anhang-Verhalten
     (Linker, generische Routen, Chat-Kreuzsperre) hat keine eigene Spec und wird hier als
     Teil von etb-anhaenge festgeschrieben. -->

## Nicht-Ziele

- `chat::heraufstufen_zu_etb` übernimmt die Anhänge einer Nachricht nicht. Das bleibt ein
  eigenes Folgeticket (Nebenbefund LFH-60).
- Dokumente mit ETB-Bezug (`einsatz_dokument.bezug_etb_eintrag_id`) erscheinen **nicht** in
  der Zeitachse am Eintrag.
- Keine Offline-Ablage von Dateien (keine Blobs in der IndexedDB-Queue), keine
  Bildvorschau in der Zeitachse, keine EXIF-Bereinigung (EXIF bleibt, Entscheidung
  24.09.2026, Folgeticket).
- Keine Anhänge in der ETB-Druckansicht. Die kommt mit LFH-22 und sollte die Anhänge dort
  nachziehen.

## Impact

- **Datenbank:** neue Migration `etb_eintrag_anhang`, beide FKs `ON DELETE CASCADE`,
  `anhang_id UNIQUE`. Die Nummer ist die nächste freie nach `scripts/check-migrationen.sh`
  (heute 0121).
- **Backend:** `src/anhang/` (Linker, Sweep, Löschriegel, geteilter Multipart-Helfer),
  `src/etb/` (Wire-Feld, gebündeltes Nachladen, transaktionale Erfassung), `src/routes/etb.rs`
  (Upload, Download, `anhang_ids`), `src/routes/anhang.rs`, `src/chat/repo.rs`
  (Kreuzsperre), `src/app.rs`, `src/api_doc.rs`, `src/einsatz/schwaerzung_registry.rs`.
- **Codegen:** `frontend/src/api/openapi.json`, `frontend/src/api/types.generated.ts`.
- **Frontend:** `api/etb.ts`, `etb/Schnellerfassung.tsx`, `etb/EtbZeitachse.tsx`,
  `etb/EtbEintragVorschau.tsx`, `etb/entwuerfe/EtbEntwurfsTabs.tsx`,
  `offline/useEtbErfassung.ts`, dazu Fixtures von `EtbEintragAnzeige`.
- **Tests:** `tests/anhang.rs`, `tests/etb.rs`, Repo-Tests, Vitest, neuer e2e-Spec.
- **Prüfliste Einsatztauglichkeit** für die umgebaute ETB-Seite.
- **Live:** kein neues Ereignis. Das bestehende `etb`-Ereignis trägt nur die ID, der Client
  lädt den Eintrag samt Anhängen nach.
