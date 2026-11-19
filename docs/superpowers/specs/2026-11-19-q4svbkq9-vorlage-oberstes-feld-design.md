# Einsatz anlegen: Vorlage als oberstes Feld, Stichwort wählt sie vor — Design

Zunder: https://zunder.rubeen.dev/#/aufgabe/q4svbkq9xdsd2tarix8busg8 (LLH-1816, Teil von LLH-1811,
Welle 3 „Anlegen & Verwaltung“). Route `entwurf` (E1, E2, E3). Lösungsweg abgestimmt am
Phase-1-Checkpoint, 19.11.2026.

## Absicht

Die Einsatz-Vorlage entscheidet, ob ein neuer Einsatz etwa 40 oder 11 Menüpunkte zeigt. Heute
steht sie als kleine gedämpfte Zeile „Module: Alle Module“ unter allen Feldern, und keines der 12
Start-Stichworte ist an eine Vorlage gekoppelt. Die Kopplungslogik aus LLH-1375
(`frontend/src/pages/einsatzVorlageWahlKern.ts`) greift deshalb nie. Wer unter Zeitdruck anlegt,
bekommt fast immer das volle Menü. Zusätzlich klappt das Stichwortfeld beim Fokus alle 12
Vorschläge auf und verdeckt das Feld Einsatzart.

Erfolg: Wer „MANV15“ wählt, sieht oben „MANV“ als Vorlage, ohne etwas zu suchen. Wer kein
gekoppeltes Stichwort nimmt, sieht oben deutlich „Alle Module“ und kann umstellen.

## Ziele

- Die Vorlage ist das **oberste Feld** des Dialogs „Neuen Einsatz anlegen“, mit Label und
  Modulzahl.
- Die Start-Stichworte neuer Organisationen kommen **gekoppelt**.
- Bestehende Organisationen bekommen dieselbe Kopplung **behutsam per Migration**.
- Der Demo-Einsatz wird mit Vorlage angelegt.
- Das Stichwortfeld verdeckt das Feld Einsatzart nicht mehr.

## Nicht-Ziele

- Keine neue Vorlage, keine Änderung an Modulsätzen bestehender Vorlagen.
- Keine Mitgliederauswahl im Dialog (LLH-1820, eigener Task im selben Dialog).
- Keine Änderung an der Vorrangregel aus LLH-1375 (Handwahl schlägt Stichwort; Vorlage belegt die
  Einsatzart vor, solange diese nicht von Hand geändert wurde).

## Anti-Ziele

- Eine Migration, die von Hand gepflegte Kopplungen oder Hub-verteilte Stammdaten überschreibt.
- Eine Vorgabe, die still Module ausblendet: ohne gekoppeltes Stichwort bleibt „Alle Module“.

## Entscheidungen (abgestimmt 19.11.2026)

### D1 Zuordnung der Start-Stichworte

| Stichwort | Vorlage |
| --- | --- |
| MANV, MANV7, MANV15, MANV50 | MANV |
| B2, B2Y, B3, B3Y | Kleinlage |
| B4, B4Y | Evakuierung und Betreuung |
| Sonderlage, Übung | keine (Alle Module) |

`STICHWORT_STARTLISTE` in `src/auth/bootstrap.rs` wird eine Liste von Paaren
`(text, Option<&str>)` mit dem Vorlagennamen. Weil die Vorlagen heute erst nach den Stichworten
angelegt werden (`seed_startliste_tx`, `bootstrap.rs:203`), wird die Reihenfolge getauscht:
erst Vorlagen, dann Stichworte, die `vorlage_id` per Name in derselben Transaktion auflösen.
Fehlt eine Vorlage mit dem Namen, bleibt das Stichwort ohne Kopplung (kein Fehler).

### D2 Migration für bestehende Organisationen

Neue Migration (nächste freie Nummer, heute `0357`, Vergabe nach `migrations/AGENTS.md`). Sie
setzt `einsatz_stichwort_vorschlag.vorlage_id` nur, wenn **alle** Bedingungen gelten:

- der Vorschlag hat genau einen Text der Startliste aus D1 (Vergleich auf den gespeicherten Text);
- `vorlage_id IS NULL` (eine von Hand gesetzte Kopplung bleibt);
- die Organisation hat eine Einsatz-Vorlage mit genau dem Startnamen (bei mehreren: die kleinste
  ID);
- der Vorschlag stammt nicht vom Hub (`stammdaten_herkunft` mit `art = 'stichwort_vorschlag'`),
  sonst bricht der Schutz-Trigger aus `0312` mit `stammdaten_vom_hub` ab. Hub-Zeilen werden
  ausgelassen; sie koppelt die verteilende Instanz.

Die Log-Trigger aus `0312` schreiben je geänderter Zeile einen Eintrag in
`stammdaten_aenderung`; das ist gewollt (die Instanzkopplung sieht die Änderung).

### D3 Dialog

- Erstes `Form.Item` „Vorlage“, vor „Bezeichnung“; die Auswahl hat einen normalen Rahmen wie die
  übrigen Felder. Optionen wie bisher (`vorlagenOptionen(vorlagen, 'Alle Module')`). Unter dem
  Feld als `extra` die Modulzahl der Wahl („11 von 34 Modulen“, `moduleText`), bei „Alle Module“
  die volle Zahl.
- Vorgabe ohne gekoppeltes Stichwort: **„Alle Module“**.
- Die Vorlage bleibt außerhalb der Formularwerte (State `vorlageWahl`), damit Handwahl und
  Stichwort-Vorrang aus `einsatzVorlageWahlKern.ts` unverändert gelten.
- Hat die Organisation keine Vorlage, entfällt das Feld wie heute die Zeile.
- Die gedämpfte Zeile darunter zeigt nur noch das Schichtmodell.
- Der Fokus beim Öffnen bleibt auf „Bezeichnung“ (meine Wahl: das Stichwort stellt die Vorlage
  meist ein, getippt wird zuerst die Bezeichnung).
- `aria-label` und sichtbares Label: „Vorlage“. Die e2e-Suche nach `combobox` „Module“ wird
  mitgezogen.

### D4 Feldbudget

Die Ausnahme „Neuen Einsatz anlegen“ in `frontend/AGENTS.md` (Feldbudget) wird auf **sechs**
Felder erweitert: die Vorlage ist das sechste, weil sie das Menü des ganzen Einsatzes bestimmt
(LLH-1816). Der Satz „Die Einsatz-Vorlage steht als gedämpfte Zeile unter den Feldern, kein Feld
(LLH-1375)“ entfällt; der Kommentar über dem Dialog in `EinsaetzePage.tsx` wird angepasst.

### D5 Überdeckung durch das Stichwortfeld

Das AutoComplete zeigt Vorschläge erst, wenn Text eingegeben ist (leere Eingabe → keine
Optionen), gefiltert nach Teiltext ohne Groß/Klein. Vor dem Bau im Browser bestätigen, dass das
leere Aufklappen die Ursache ist; ist es eine andere (etwa Popup-Breite), wird diese behoben und
im Plan vermerkt.

### D6 Demo

Der Demo-Einsatz (`src/demo/import.rs`, Stichwort „Unwetter – Starkregen“ als Freitext) wird mit
der Vorlage „Unwetter“ der Organisation angelegt, wenn sie existiert; sonst ohne. Das Stichwort
bleibt Freitext ohne Katalogvorschlag (unverändert).

## Ansätze

1. **Gewählt: Vorlage als echtes oberstes Feld, Kopplung ab Werk und per Migration.** Sichtbar,
   wirkt sofort auch in bestehenden Orgs; kostet ein sechstes Feld und eine Regeländerung.
2. **Verworfen: Zeile bleibt, nur Kopplung liefern.** Billig, aber die Wahl bleibt übersehen,
   sobald kein gekoppeltes Stichwort fällt — genau der gemeldete Befund.
3. **Verworfen: Alarmzeit als gedämpfte Zeile, Vorlage als fünftes Feld.** Hält das Budget, macht
   aber das Ändern der Alarmzeit (häufig bei Nachtragungen) um einen Klick teurer.
4. **Verworfen für die Vorgabe: Kleinlage oder Pflichtwahl.** Kleinlage blendet bei großen Lagen
   still Module aus; Pflichtwahl kostet bei jedem Einsatz einen Klick.

## Regeln, die sich ändern (E2)

- Spec `einsatz-vorlagen` (eingefroren, `openspec/specs/einsatz-vorlagen/spec.md`):
  „Stichwort-Kopplungen MUST nicht mitgeliefert werden“ und „unter den Feldern“ gelten nicht
  mehr. Die Dialogregel steht in `frontend/AGENTS.md` (Feldbudget, D4). Für die Kopplung ab Werk
  gibt es keinen Startlisten-Abschnitt in `src/AGENTS.md`; sie steht (meine Wahl) im
  Doc-Kommentar an `STICHWORT_STARTLISTE` mit Verweis auf dieses Design-Doc, so wie die
  Startlisten dort heute schon begründet sind. Die Spec selbst wird nicht geändert (Archiv).
- Test `seedet_einsatz_vorlagen_ohne_stichwort_kopplung_fuer_neue_org` (`bootstrap.rs:464`) wird
  zur Prüfung der Kopplung nach D1 umgeschrieben.

## Mitänderungen

- Anwenderdoku `docs/anwender/kapitel/einsatz-oberflaeche.md` (Schritt 4, „unter den Feldern bei
  ‚Module:‘“) und ggf. `stammdaten.md` (Startliste gekoppelt); Bilder nach
  `docs/anwender/AGENTS.md`.
- e2e `frontend/e2e/einsatz-vorlagen.spec.ts` und `einsatz-kern.ts` (Combobox-Name).
- Unit-Test `frontend/src/pages/EinsaetzePage.vorlage.test.tsx`.

## Dem Bauenden überlassen

- Genaue Form der Paarliste in Rust und die SQL der Migration (CTE oder Korrelationsabfrage).
- Ob `moduleText` als `extra` oder im Label steht, solange die Zahl ohne Aufklappen sichtbar ist.
- Testschnitt (TDD je Aufgabe des Plans).
