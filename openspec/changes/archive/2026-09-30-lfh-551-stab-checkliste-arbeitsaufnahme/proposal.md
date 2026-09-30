# Proposal

## Why

Die ersten zehn Minuten eines Fükw-Einsatzes folgen einer festen Abfolge. Der ELW wird aufgestellt,
die Einsatzleitung weist ein, die Lageskizze beginnt, Funkarbeitsplätze und Sprechgruppen werden
eingerichtet, das ETB wird eröffnet, und die Einsatzbereitschaft geht an die Leitstelle. Die
Lehrunterlagen beschreiben diese Abfolge als Checkliste: LFS-BW F5-I Kap. 5 (S. 33–34) und HLFS
„Aufgaben S3“ Kap. 5 (S. 12, nur als Bild). Im Lifeline Hub steht sie heute nirgends.

Die Stab-Spec LFH-46 hat die Checkliste bewusst aus v1 herausgenommen (Abschnitt 13, Punkt 5). Sie
ist Lehrmeinung, und je Haken ein ETB-Eintrag erzeugte Rauschen. Dieses Folgeticket baut sie so,
dass beides nicht eintritt. Die Checkliste bleibt ein Arbeitsmittel am Fahrzeug und ist kein
Führungsnachweis. Einzige Ausnahme ist der Punkt, den die FwDV 100 selbst dokumentiert sehen will
(Anlage 5, S. 64): die Meldung der Einsatzbereitschaft an die Leitstelle.

## What Changes

- **Sieben Punkte als Code-Vorlage** mit Quelle je Punkt, in fester Reihenfolge:
  1. Aufstellort des ELW festgelegt
  2. Einweisung durch die Einsatzleitung erhalten
  3. Lageskizze begonnen
  4. Funkarbeitsplätze eingerichtet
  5. Sprechgruppen zugeteilt
  6. ETB eröffnet
  7. Einsatzbereitschaft an die Leitstelle gemeldet

  Die Punkte sind nicht konfigurierbar. Das Backend kennt nur die Schlüssel (geschlossener Enum,
  CHECK in der Tabelle), die Texte und Quellen stehen im Frontend (`stab/checkliste.ts`, Muster
  `stab/sachgebiete.ts`).
- **Eigene Tabelle** `einsatz_stab_checkliste` (Migration 0127). Eine Zeile entsteht erst beim
  ersten Haken oder bei der ersten Bemerkung (lazy). Keine Zeile heißt „offen, ohne Bemerkung“.
- **`GET …/stab/checkliste`** liest die vorhandenen Zeilen. **`PUT …/stab/checkliste/{punkt}`**
  setzt `erledigt` und/oder `bemerkung`. Der Aufruf ist idempotent und umkehrbar, ohne Rückfrage.
  Rechte wie der übrige Stab (Lesen: alle Mitglieder; Schreiben: Schreibrecht im aktiven Einsatz).
- **Kein System-ETB-Eintrag je Haken.** Einzige Ausnahme ist Punkt 7. Wird er erledigt, entsteht
  ein System-ETB-Eintrag in derselben Transaktion (FwDV 100 Anlage 5, S. 64). Die Rücknahme
  dieses Hakens wird ebenso belegt (Entscheidung E1 = A, `design.md` D4).
- **Neue Fläche auf der Stabseite:** ein drittes Paneel „Arbeitsaufnahme“ unter den beiden
  bestehenden, mit Zähler „n/7 erledigt“. Sieben Zeilen in `components/Liste.tsx`. Jede Zeile ist
  ein `<label>` mit antd-`Checkbox`, Text und Quelle und trägt die zwei Angaben eines handgebauten
  Bedienziels (LFH-365). Die Bemerkung läuft über `BemerkungZelle`. Ohne Schreibrecht sind die
  Haken gesperrt, und der bestehende `RechteHinweis` des Seitenkopfs nennt den Grund.
- **Live** über das bestehende Ereignis `stab`. Der neue Query-Key liegt unter dem Stab-Prefix.

## Capabilities

### New Capabilities

- `stab-checkliste`: Die Checkliste zur Arbeitsaufnahme der Führungseinheit. Sie regelt die
  Vorlage, die Speicherung (lazy, idempotent, umkehrbar), den einzigen ETB-Beleg, Rechte, Live,
  Schwärzung und die Fläche auf der Stabseite.

### Modified Capabilities

_keine_. Besetzung und Lagebesprechung (LFH-46) bleiben unverändert. Die Antwort `StabAnzeige`
bekommt kein neues Feld (Akzeptanzkriterium „ohne Einfluss auf die Stab-v1-Subtasks“).

## Impact

- **Backend, neu:** `migrations/0127_stab_checkliste.sql`, `src/stab/checkliste.rs` (Enum, DTO,
  Repo), Routen in `src/routes/stab.rs`, Registrierung in `src/app.rs`,
  `src/api_doc.rs`. Tests: `tests/stab_checkliste.rs`, Eintrag in `tests/enum_wire_kontrakt.rs`.
- **Backend, geändert:** `src/einsatz/schwaerzung_registry.rs` (neue Tabelle: `bemerkung` wird
  geschwärzt, das Skelett bleibt).
- **Codegen:** `frontend/src/api/openapi.json`, `types.generated.ts`.
- **Frontend, neu:** `stab/checkliste.ts` (Vorlage + Zeilenstil), `stab/ChecklistePaneel.tsx`,
  API in `api/stab.ts`, Key `einsatzKeys.stabCheckliste`.
- **Frontend, geändert:** `pages/StabPage.tsx` (drittes Paneel).
- **e2e:** Gate 3 (Trefffläche der Zeilen 30/48/72, auch als Beobachter), Gate 1 neu mit der
  Route `stab`, dazu `e2e/stab-checkliste.spec.ts` (Klickweg und ETB-Beleg).
- **Keine** Änderung an Rechten, Modulfreigaben, Modulzählern, Live-Ereignissen oder `StabAnzeige`.
