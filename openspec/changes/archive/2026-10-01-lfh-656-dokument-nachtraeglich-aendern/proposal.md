# Proposal

## Why

Eine Zeile der Dokumentenablage (LFH-632) lässt sich heute nur entfernen, nicht ändern. Ein
Tippfehler im Titel, eine falsch gewählte Kategorie oder ein vergessener Bezug lassen sich nur
korrigieren, indem man das Dokument entfernt und die Datei neu ablegt. Das kostet einen zweiten
Upload samt Virenscan und hinterlässt zwei ETB-Einträge („entfernt“, „abgelegt“) für einen
Schreibfehler. Die Prüfliste der Dokumentenablage verlangt in Kriterium 15 eine „Sammelliste mit
Ändern/Entfernen je Zeile“ (`docs/superpowers/specs/2026-09-22-lfh-632-pruefliste.md`,
Tabelle 2, Nr. 15). Das Ändern fehlt.

## What Changes

- Neuer Endpunkt `PATCH /api/einsaetze/{id}/dokumente/{did}`: ändert Titel, Kategorie und Bezug
  eines lebenden Dokuments. Die Datei bleibt unangetastet. Das Gate ist dasselbe wie beim
  Ablegen und Entfernen (Schreibrecht, aktiver Einsatz, Modul Dokumente).
- Die Validierung folgt dem Ablegen und der Statuscode-Konvention: 400 für ein Feld für sich
  (leerer oder zu langer Titel, unbekannte Kategorie, unbekannter `bezug_typ`, fremdes oder
  unbekanntes Bezugsziel), 422 für den Zusammenhang (`bezug_typ` ohne `bezug_id` oder
  umgekehrt).
- Eine wirksame Änderung schreibt einen System-ETB-Eintrag „Dokument geändert: …“, der jede
  geänderte Angabe mit altem und neuem Wert nennt. Sie löst denselben Live-Hinweis aus wie
  Ablegen und Entfernen. Eine Anfrage, die nichts ändert, schreibt keinen ETB-Eintrag.
- Die Dokumentenseite bekommt je Zeile die Aktion „Bearbeiten“. Sie öffnet den Dialog
  „Dokument bearbeiten“ auf der Erfassungs-Hülle (`ErfassungsModal`), vorbelegt mit Titel,
  Kategorie und Bezug. In der Tabelle stehen „Bearbeiten“ und „Entfernen“ nebeneinander. In der
  Karte ist „Bearbeiten“ die Primäraktion, „Entfernen“ steht im gebündelten Menü.
- Keine Migration, kein neues Response-Feld, keine Codegen-Änderung.

## Capabilities

### New Capabilities
- `dokumentenablage`: Ablegen, Ändern und Entfernen von Dokumenten eines Einsatzes. Diese Change
  legt die Fähigkeit mit der Anforderung zum Ändern der Angaben an. Das Ablegen und Entfernen aus
  LFH-632 hat bis heute keine Fähigkeits-Spec und bleibt hier außen vor.

### Modified Capabilities
<!-- keine -->

## Impact

- Backend: `src/routes/dokument.rs` (neuer Handler, Validierung geteilt mit dem Ablegen),
  `src/dokument/repo.rs` (Ändern in einer Transaktion mit ETB-Nachweis), `src/app.rs` (Route),
  `tests/dokument.rs`.
- Frontend: `frontend/src/api/dokumente.ts` (`aendereDokument`),
  `frontend/src/dokumente/` (neuer Bearbeiten-Dialog, geteilte Bezug-Helfer),
  `frontend/src/pages/DokumentePage.tsx` (Zeilen- und Kartenaktion) samt Tests.
- API: ein zusätzlicher Endpunkt. Bestehende Endpunkte ändern sich nicht.
- Ticket: LFH-656 (aus LFH-632).
