## Context

Gelegenheitsnutzer bedienen Erinnerungen, Meldungen, Aufträge und Nachforderungen am
Führungs-Tablet oder Handy (Bedien-Leitlinie, Kontexte Führungs-Tablet und mobil). Was ein Knopf
tut, muss ohne Hover aus seinem Wortlaut hervorgehen. Heute:

- `erinnerung/ErinnerungKarte.tsx`: „Quittieren“ und „Erledigt“ gleichrangig, die Trennung steht
  nur in `TOOLTIP_QUITTIEREN`/`TOOLTIP_ERLEDIGT`. An einer quittierten Erinnerung steht der
  `QuittungIndikator`, dessen Tooltip „sagt nichts über die Erledigung“ dem Sinn dort widerspricht.
- `meldungen/MeldungKarte.tsx`: Fortschaltung „Sichten“ (Verb), dann „In Bearbeitung“ und
  „Erledigt“ (Statuswörter), dieselben Wörter im ⋮-Menü.
- `auftraege/AuftragKarte.tsx`: „In Bearbeitung“ neben dem Etikett „Offen“, Knopf „quittieren“
  klein geschrieben.
- `nachforderungen/NachforderungKarte.tsx`: `→ {NACHFORDERUNG_STATUS[next].label}`.
- `stammdaten/dienststatus.tsx`: „Außer Dienst“ neben dem Chip „in Dienst“.
- `pages/MeldungenPage.tsx`: Kennzahl „Alarmiert“, auf der Karte zusätzlich „Alarm“ mit Uhr.

Die Begriffsentscheidungen 1 und 10 (Klärungsrunde Welle 4, 06.10.2026) sind gefallen; dieses
Dokument hält fest, wie sie im Code getragen werden.

## Goals / Non-Goals

**Goals:**

- Eine Regel, einmal in `frontend/AGENTS.md`, mit einem Guard, der sie für die vier Module trägt.
- Erinnerungen ohne Tooltip lesbar: erübrigt ist nicht durchgeführt.
- „Quittier…“ in der Oberfläche nur noch für die Empfangsbestätigung.
- Kennzahl und Karte der Meldungen heißen wie Modulzähler und Lage-Dashboard.

**Non-Goals:**

- Kein Backend: das Enum `quittiert`, die Route `…/quittieren` und die DTO-Felder
  `quittiert_at` bleiben. Nur Wortlaut.
- Keine Umbenennung von Bezeichnern über den Wortlaut hinaus, außer dem Kennzahlfeld (D5).
- Die benannten Rückfragen bei unumkehrbaren Aktionen (Einsatzabschluss, Auflösen, Stornieren)
  setzt die Folgeänderung zu den unumkehrbaren Aktionen um; diese Änderung bringt die Regel mit.
- Kein Wechsel der Knopfform (primär/sekundär) und keine neue Bündelung.

## Decisions

### D1 Handlungstexte stehen neben dem Statusdeskriptor

`kommunikation/phase.ts` bekommt je Modul eine Karte „Zielstatus → Knopftext“
(`MELDUNG_HANDLUNG`, `AUFTRAG_HANDLUNG`, `NACHFORDERUNG_HANDLUNG`, `ERINNERUNG_HANDLUNG`), der
Dienststatus seine zwei Texte in `stammdaten/dienststatus.tsx` neben dem Wortlaut aus
`statusFarben.ts`. Die Karten lesen Knopf, Menüeintrag und Palette. Alternative: Texte an jeder
Stelle; verworfen, weil der Guard dann Quelltext statt Daten prüfen müsste und Knopf und
⋮-Menü auseinanderlaufen.

| Modul | Zielstatus | Knopf |
| --- | --- | --- |
| Meldung | gesichtet | Sichten |
| Meldung | in_bearbeitung | Bearbeitung beginnen |
| Meldung | erledigt | Als erledigt melden |
| Auftrag | in_arbeit | Bearbeitung beginnen |
| Nachforderung | zugesagt | Zusage erfassen |
| Nachforderung | unterwegs | Abfahrt melden |
| Nachforderung | eingetroffen | Eintreffen melden |
| Dienststatus | ausser_dienst / in_dienst | Außer Dienst nehmen / Wieder in Dienst nehmen |
| Erinnerung | quittiert / erledigt | Erübrigt (zur Kenntnis) / Erledigt (durchgeführt) |

### D2 Erinnerungen: Wortlaut nach Entscheidung 10

Knöpfe „Erübrigt (zur Kenntnis)“ und „Erledigt (durchgeführt)“, Statuswort „Erübrigt“ statt
„Quittiert“ (`ERINNERUNG_STATUS.quittiert.label`). Die Klammer trägt die Abgrenzung sichtbar; die
Tooltips entfallen. Das ist die eine benannte Ausnahme von „Knöpfe tragen Handlungen“: der
Wortlaut ist entschieden, und die Klammer macht aus dem Zustandswort eine Aussage über die
Handlung. Der Guard (D4) prüft deshalb nur auf Gleichheit, nicht auf Wortanfang. An einer
erübrigten Erinnerung steht „Erübrigt: ‹Zeit›“ wie heute „Erledigt: ‹Zeit›“; der
`QuittungIndikator` erscheint an Erinnerungen nicht mehr. Toast „Erinnerung erübrigt“.

### D3 „Quittieren“ nur für die Empfangsbestätigung

Bleibt: Meldungen („✓ Quittiert von …“ an der bestätigten Sofortmeldung), Aufträge („Quittung
offen“, Knopf „Quittieren“ je Empfänger), die Kenntnisnahme einer Meldung an einem Element der
Fernmeldeskizze (Empfang einer Meldung, also dieselbe Bedeutung). Weg: alles an Erinnerungen.
Der Erklärungstext des `QuittungIndikator` entfällt ebenfalls (Nachtrag 06.10.2026, Übergabe
aus dem Abbau der Erklärtexte): das Chip-Wort trägt die Aussage allein.

### D4 Guard über Daten und Quelltext

`kommunikation/wortlaut.guard.test.ts`:

1. Für Meldung, Auftrag, Nachforderung und Dienststatus: kein Handlungstext gleicht
   (ohne Groß-/Kleinschreibung, getrimmt) einem Statuswort desselben Moduls.
2. Kein `<Button>` in den vier Karten und `dienststatus.tsx` rendert `…_STATUS[…].label`
   (Quelltext-Scan nach dem Muster von `aktionsabstand.guard.test.ts`).
3. Kein sichtbarer Wortlaut „Quittier…“ in `erinnerung/` und `pages/ErinnerungenPage.tsx`.

Selbstbeweise wie in den anderen Guards: ein eingeschleustes Statuswort färbt jede Hälfte rot.

### D5 Kennzahl „Bestätigung überfällig“

`MeldungenPage` zeigt „Bestätigung überfällig“, Notiz „Bestätigungsfrist verstrichen“ bleibt.
Das Feld `meldungKennzahlen.alarmiert` heißt `bestaetigungUeberfaellig`, damit der interne Name
nicht wieder in die Oberfläche rutscht. `istAlarmiert` bleibt (auch `einsatz/aktiveWarnung.ts`
liest es; der Name meint dort den Alarmrand). Auf der Karte entfällt „Alarm“; die Uhr steht im
Chip „Bestätigung überfällig“.

## Risks / Trade-offs

- [Längere Knopftexte brechen am Handy um] → e2e-Layout-Gate bei 390 und 820 px auf
  Erinnerungen, Meldungen, Aufträgen und Nachforderungen, auch als Beobachter (Knöpfe fehlen).
- [Tests und Palette suchen nach alten Namen] → Liste in `tasks.md`, Palette-Befehle über
  dieselben Karten.
- [„Erledigt (durchgeführt)“ ähnelt dem Statuswort] → bewusst entschieden (D2); der Guard prüft
  Gleichheit, und die Erinnerungen stehen nicht in seiner Gleichheitsprüfung.
