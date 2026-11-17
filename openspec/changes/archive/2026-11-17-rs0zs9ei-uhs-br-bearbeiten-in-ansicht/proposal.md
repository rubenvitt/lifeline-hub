# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/rs0zs9eimp5i9s3xmjuzm9xc (LLH-1920)

## Why

Unfallhilfsstelle und Bereitstellungsraum ändern ihre Stammdaten noch in einem Modal
(`UhsBearbeitenModal`, `BrBearbeitenModal`). Die Regel „Bearbeiten in der Ansicht“ (LLH-1139) sagt
aber: Ein bestehender Datensatz wird in seiner Ansicht bearbeitet. `frontend/AGENTS.md` führt
beide deshalb als Altstellen (LLH-1722, D8). Am Bereitstellungsraum fehlt außerdem der
Kollisionsschutz: Wer die Raumdaten speichert, überschreibt still, was ein anderer Arbeitsplatz
inzwischen gespeichert hat.

## What Changes

- **UHS:** Die Detailseite bekommt einen neuen Bereich „Angaben“ (`?bereich=angaben`). Darin
  steht ein `BearbeitbaresPaneel` (Modus `paneel`) mit Bezeichnung, Standort, Soll-Anzahl,
  Qualifikationssoll und Notiz. „Bearbeiten“ steht im Paneelkopf. Der Seitenkopf verliert
  „Bearbeiten“; seine Zusammenfassung (Typ · Standort · Stärke, Soll · Notiz) bleibt. Am
  gekoppelten Gerät gibt es den Bereich nicht.
- **BR:** Der Abschnitt „Raumdaten“ wird ein `BearbeitbaresPaneel` (Modus `paneel`) mit
  Bezeichnung, Standort und Notiz. „Auf Karte verorten“ bleibt im Kopf der Raumdaten, vor
  „Bearbeiten“.
- **Baustein:** `BearbeitbaresPaneel` bekommt einen optionalen Platz für weitere Handlungen im
  Paneelkopf (nur im Lesezustand, vor „Bearbeiten“).
- **Backend:** `PATCH /api/einsaetze/{id}/bereitstellungsraeume/{bid}` nimmt optional
  `basis_geaendert_at` an. Weicht der gespeicherte Stand davon ab, antwortet der Server mit 409.
  Fehlt das Feld, schreibt er wie bisher (Verorten auf der Lagekarte, „Meine Änderung
  übernehmen“).
- **Entfernt:** `UhsBearbeitenModal`, `BrBearbeitenModal` samt Tests.
- **Regeln und Doku:** Die Altstellenliste in `frontend/AGENTS.md` verliert die beiden Modals
  (die Anlegen-Drawer bleiben bis LLH-1921). Die Anwenderkapitel zu UHS und BR beschreiben den
  neuen Weg, der Bildlauf des BR-Kapitels fotografiert das offene Paneel statt des Dialogs.

## Capabilities

### New Capabilities

- `uhs-bearbeitung`: wie die Stammdaten einer Unfallhilfsstelle in ihrer Ansicht (Bereich
  „Angaben“) gelesen und bearbeitet werden, mit Kollisionsschutz.
- `bereitstellungsraum-bearbeitung`: wie die Raumdaten eines Bereitstellungsraums in seiner
  Ansicht bearbeitet werden, und der Kollisionsschutz des Speicherwegs.

### Modified Capabilities

- `uhs-grundriss`: Die Anforderung „Die UHS-Seite gliedert sich in Bereiche“ zählt „Angaben“ als
  weiteren Bereich.

## Impact

- Frontend: `pages/uhs/UhsDetailPage.tsx`, `pages/uhs/uhsBereich` (Bereichsliste),
  neue Datei für das Paneel „Angaben“; `pages/bereitstellungsraum/BrDetailPage.tsx`;
  `components/instrument/BearbeitbaresPaneel.tsx`; `api/einsatzUhs.ts`,
  `api/einsatzBereitstellungsraum.ts` (`basis_geaendert_at` im Patch-Typ).
- Backend: `src/routes/einsatz_bereitstellungsraum.rs` (`PatchBody`, `update`),
  `src/bereitstellungsraum/repo.rs` (`update_tx`). Request-DTO, keine Antwortänderung, kein
  Typ-Codegen.
- Design System: `BearbeitbaresPaneel` ist ein vorgestellter Baustein, also wird es neu erzeugt.
- Doku: `docs/anwender/kapitel/unfallhilfsstellen.md`, `bereitstellungsraeume.md`, Bild
  `bereitstellungsraeume/bearbeiten.png` und `e2e/doku-bilder/bereitstellungsraeume.bilder.ts`.
- Nicht betroffen: Anlegen über `UhsAnlegenDrawer`/`BrAnlegenDrawer` (LLH-1921).
