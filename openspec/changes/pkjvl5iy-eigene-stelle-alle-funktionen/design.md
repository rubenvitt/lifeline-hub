# Design

## Context

Siehe proposal.md, „Why“. Der Stand im Code:

- `MeineFelder::ableiten` (`src/einsatz/mod.rs`) baut für Detail (`Einsatz::anzeige`) und Liste
  (`repo::liste_fuer`) die Felder `meine_fuehrungsstelle`, `meine_sachgebiete` und `meine_funktion`
  aus der Mitgliedschaft (`Funktionsangabe` = Code + Text) und der Rolle. `meine_funktion` kommt aus
  `funktion::ableiten` und ist reiner Klartext mit Mandantenlabel („S4 Versorgung (Logistik)“,
  „Fachberater: THW“); daraus lässt sich der Code nicht sicher zurückgewinnen.
- `meine_sachgebiete` liefert nur `Fuehrungsfunktion::sachgebiet()`, also S1–S6.
- `meineStelle` (`frontend/src/pages/fuehrung/offeneVorgaenge.ts`) liest `meine_sachgebiete` und
  setzt ohne Sachgebiet bei Rolle Einsatzleitung `el`. Abgleich je Vorgang nur über den Code:
  Auftrag `empfaenger[].funktion`, Meldung `empfaenger_funktion`, Erinnerung
  `empfaenger_funktion_code`.
- Die Bezeichnung eines Empfängers bei Fachberater und Führungshilfspersonal steht beim Auftrag in
  `empfaenger[].funktion_text`, bei der Erinnerung in `empfaenger_funktion` (Text). Beim Anlegen ist
  sie Pflicht (`fuehrung::pruefe_funktion`, 422); fehlen kann sie nur nach einer Schwärzung
  (Registry: `NullSetzen`). Eine Meldung kann an Fachberater und Führungshilfspersonal gar nicht
  gehen (422); ihr `empfaenger` ist ein eigener Freitext neben der Funktion (LLH-1214 D8).
- Der Lage-Snapshot baut `EinsatzAnzeige` ohne abfragenden Benutzer (`anzeige(None, None, …)`).
- Die eigene Bezeichnung (`einsatz_mitgliedschaft.fuehrungsstelle`) steht in der
  Schwärzungs-Registry auf `NullSetzen`; nach einer Schwärzung fehlt sie.

## Goals / Non-Goals

**Goals:**

- „meine Stelle“ erkennt jede Funktion des Katalogs, Fachberater und Führungshilfspersonal getrennt
  nach Bezeichnung.
- Eine Ableitung im Backend für Klartext und Code, damit Kopf und Filter nie auseinanderlaufen.

**Non-Goals:**

- Benachrichtigungen (`Adressat::Funktion`) lösen weiter nur über den Code auf; der Abgleich mit
  Bezeichnung gilt nur für die Sicht „meine Stelle“.
- `meine_sachgebiete` bleibt auf dem Wire und ändert seine Bedeutung nicht, obwohl das Frontend es
  danach nicht mehr liest. Entfernen bräuchte eine eigene Change mit Übergangsweg.
- Kein Umbau der Empfängerfelder von Meldung, Auftrag oder Erinnerung.

## Decisions

### D1 Zwei flache Felder im Einsatzkopf, aus `funktion::ableiten`

`EinsatzAnzeige` bekommt `meine_funktion_code: Option<Fuehrungsfunktion>` und
`meine_funktion_bezeichnung: Option<String>`, beide mit `skip_serializing_if = "Option::is_none"`
wie `meine_funktion`. `funktion::Funktion` trägt zusätzlich `code: Fuehrungsfunktion`;
`MeineFelder::ableiten` übernimmt Code und Bezeichnung aus demselben Ergebnis wie den Klartext.
Damit gilt die Rangfolge (Führungsfunktion vor Rolle Einsatzleitung) an genau einer Stelle, und der
Fallback `el` wandert aus dem Frontend ins Backend. Die Bezeichnung setzt das Backend nur, wenn die
Funktion eine Bezeichnung verlangt (`bezeichnung_pflicht`) und der Text nicht leer ist.

Der Code ist das Enum `Fuehrungsfunktion` (ADR-0006), nicht ein String; der Name folgt
`empfaenger_funktion_code` der Erinnerung.

*Verworfen:*

- **Mitgliederliste im Frontend lesen** (`GET …/mitglieder`, Feld `fuehrungsfunktion`): ein
  zusätzlicher Abruf im Überblick, und wer die Liste nicht lesen darf, hätte keine Funktion. Am
  Checkpoint am 09.11.2026 verworfen.
- **Ein Objekt `meine_stelle { code, bezeichnung }`**: sauberer gebündelt, aber neben den flachen
  `meine_*`-Feldern ein Stilbruch, und das Objekt bräuchte eine eigene Optionalitätsregel.
- **`meine_sachgebiete` erweitern**: der Typ `Sachgebiet` kennt S7, FB und FHP nicht, und eine
  andere Bedeutung unter demselben Wire-Namen wäre ein Grenzwertbruch (Wurzel-`AGENTS.md`,
  „Bezeichner-Sprache“).
- **Code aus `meine_funktion` parsen**: Mandantenlabels machen den Klartext mehrdeutig.

### D2 Abgleich mit Bezeichnung nur, wenn beide Seiten eine tragen

Für Fachberater und Führungshilfspersonal vergleicht das Frontend die Bezeichnungen
(`trim().toLocaleLowerCase('de')`), aber nur, wenn Empfänger und eigene Funktion je eine nicht leere
tragen. Fehlt eine Seite, genügt der Code. Für alle übrigen Codes zählt allein der Code.

Folgen je Vorgangsart:

- Auftrag: `funktion` + `funktion_text`.
- Erinnerung: `empfaenger_funktion_code` + `empfaenger_funktion`.
- Meldung: nur `empfaenger_funktion`; ihr `empfaenger` ist keine Bezeichnung und wird nicht
  verglichen. Fachberater und Führungshilfspersonal kommen als Empfänger einer Meldung nicht vor.

`MeineStelle` hält dafür statt einer Menge von Codes den eigenen Code und die eigene Bezeichnung;
`hasFunktion(stelle, code, bezeichnung)` kapselt die Regel. Die exportierten Signaturen
`meldungFuerMich`, `auftragFuerMich`, `erinnerungFuerMich` bleiben.

*Verworfen:* Nur der Code (jeder Fachberater sieht jeden Fachberater-Vorgang): am Checkpoint
verworfen. Strenger Abgleich auch bei fehlender Bezeichnung: nach einer Schwärzung fiele jeder
Fachberater-Vorgang für alle aus der Sicht.

### D3 Lage-Snapshot und Offline-Stand

Der Snapshot baut ohne Benutzer, die neuen Felder fehlen dort also von selbst. Ein vor dem Update
im Browser abgelegter Einsatzkopf hat die Felder noch nicht; „meine Stelle“ zeigt dann bis zum
nächsten Abruf nur Selbstangelegtes. Kein Rückfall auf `meine_sachgebiete`: der nächste Abruf oder
das Ereignis `einsatz` heilt das, und ein zweiter Lesepfad bliebe sonst dauerhaft im Code.

## Risks / Trade-offs

- [Bezeichnungen weichen in der Schreibweise ab, etwa „THW“ und „THW OV Musterstadt“] → Der Vorgang
  steht dann nur unter „alle“. Bewusst kein Teilstring-Abgleich, der würde „THW“ auf „THW-Jugend“
  ziehen.
- [Benachrichtigung und Sicht unterscheiden sich bei mehreren Fachberatern] → steht als Non-Goal
  fest; die Sicht ist nur ein Filter, verloren geht nichts.
- [Neues Wire-Feld] → Typ-Codegen (`scripts/check-typ-codegen.sh`) und beide generierten Dateien im
  selben Commit.
