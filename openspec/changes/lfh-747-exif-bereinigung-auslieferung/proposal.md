# Proposal

## Why

Foto-Anhänge werden seit LFH-117 und LFH-21 unverändert gespeichert und ausgeliefert, mit
EXIF, XMP und IPTC. Am 24.09.2026 hat der Auftraggeber entschieden, dass das Original als
Beweismittel erhalten bleibt. Jeder Download gibt damit aber den GPS-Standort, das Gerät samt
Seriennummer und die Aufnahmezeit an alle weiter, die das Modul lesen dürfen. Bei Fotos
Betroffener ist das ein DSGVO-Problem (Datenminimierung, Art. 5 Abs. 1 lit. c). LFH-747 klärt
den Konflikt zwischen beiden Zielen.

Entscheidung des Menschen vom 02.10.2026 (Phase-1-Checkpoint):

1. **Das Original bleibt unverändert gespeichert.** Die Entscheidung vom 24.09.2026 gilt
   weiter. Bereinigt wird bei der **Auslieferung**: jeder normale Download liefert eine
   bereinigte Fassung.
2. **Das Original laden nur Einsatzleitung und System-Admin**, über einen eigenen Abruf. Jeder
   Abruf hinterlässt einen System-Vermerk im ETB.
3. **Entfernt werden alle Metadaten außer der Ausrichtung**: EXIF (samt GPS, Gerät,
   Seriennummer, Aufnahmezeit, eingebettetem Vorschaubild), XMP, IPTC/Photoshop und
   Kommentare. Die Ausrichtung bleibt, damit Handyfotos nicht quer liegen.

## What Changes

- Jeder Download eines Bild-Anhangs über die vier Wege Chat, Dokumentenablage, ETB und Schaden
  liefert eine **bereinigte Fassung**. Bildinhalt und Farbprofil bleiben bytegleich, es wird
  nicht neu kodiert. Die gespeicherten Bytes, `groesse` und `sha256` ändern sich nicht.
- Die Bereinigung ist reines Rust im Server-Binary und braucht keinen Fremddienst. Sie deckt
  JPEG, PNG, WebP, GIF, HEIC/HEIF und TIFF ab, also alle Bildtypen der drei Allowlists. Das
  Format erkennt sie an den Magic Bytes, nicht an der Endung.
- **Fail-closed:** Lässt sich ein Bild nicht sicher bereinigen (kaputte oder unbekannte
  Struktur), liefert der normale Download 422 statt des Originals.
- Neuer Original-Abruf auf denselben vier Routen über `?fassung=original`. Zusätzlich zu den
  bestehenden Gates der Route gilt: Einsatzleitung oder System-Admin, sonst 403. Jeder Abruf
  schreibt vorher einen System-ETB-Eintrag ohne Dateinamen. Er bekommt keinen ETag, keine
  304-Antwort und `Cache-Control: no-store`.
- Der ETag der bereinigten Fassung unterscheidet sich vom ETag des Originals. Er trägt die
  Version der Bereinigung, damit eine korrigierte Bereinigung alte Browser-Caches ablöst.
- Frontend: Einsatzleitung und System-Admin sehen an jedem Bild-Anhang im Chat, in der
  Dokumentenablage, im ETB und an Schäden eine zweite Aktion „Original (mit Standort)“. Alle
  anderen sehen sie nicht.
- Nicht-Bilder (PDF, Text, CSV, Office) werden unverändert ausgeliefert, wie bisher.

## Capabilities

### New Capabilities
- `anhang-metadaten`: Wie Datei-Anhänge eines Einsatzes ausgeliefert werden. Das sind die
  bereinigte Standardfassung von Bildern, der geschützte und vermerkte Original-Abruf und das
  Verhalten bei nicht bereinigbaren Dateien. Die Fähigkeit gilt für alle Linker gleich (Chat,
  Dokument, ETB, Schaden und künftige).

### Modified Capabilities
<!-- Keine: `etb-anhaenge`, `schaden-anhaenge` und `dokumentenablage` regeln Gates, Bindung
     und Cache-Header ihrer Download-Route. Diese bleiben wahr. Die Bereinigung legt sich als
     eigene Fähigkeit über alle Routen, statt in drei Specs dieselbe Anforderung zu wiederholen. -->

## Impact

- **Backend:** neues Modul `src/anhang/metadaten.rs` (Bereinigung je Format).
  `routes/support.rs::anhang_antwort` bekommt die Fassung als Parameter. Die vier
  Download-Handler `routes/anhang.rs`, `routes/dokument.rs`, `routes/etb.rs` und
  `routes/schaden_anhang.rs` lesen `?fassung=` und rufen für das Original das neue Gate samt
  ETB-Vermerk. Kein neues Crate, keine Migration, keine Änderung an Speichern, Heraufstufen
  oder Schwärzung.
- **Frontend:** `components/DownloadAnker.tsx` bekommt einen optionalen Original-Verweis.
  Aufrufer sind `chat/NachrichtenStrom.tsx`, `pages/DokumentePage.tsx`,
  `pages/schaeden/SchadenAnhaenge.tsx` und `etb/EtbAnhaenge.tsx`. Die Sichtbarkeit regeln
  `istEinsatzLeitung`/`istAdmin` aus `einsatz/schreibrecht.ts`.
- **Regeln:** Der Abschnitt „Anhänge“ in `src/AGENTS.md` bekommt die Regel „ausgeliefert wird
  bereinigt, das Original nur mit Vermerk“.
- **Nicht betroffen:** Karten-Hintergrundbild und Org-Logo sind keine Anhänge. Der Druck
  bettet keine Anhänge ein (LFH-744 offen). Backup und Aufbewahrungs-Archiv lesen die DB und
  enthalten weiter das Original. Das ist gewollt, die Schwärzung löscht es.
- **Nicht-Ziele:** Metadaten in PDF- und Office-Dateien (Autor, Software). Bereinigung schon
  beim Upload. Bildinhalt-Schwärzung (Gesichter, Kennzeichen).
