# Tasks

Diese Change baut keinen Code (`design.md`, D8). Ihre Aufgaben setzen die Entscheidung auf dem
Board um und schließen die Change ab. Zunder-Werkzeuge und Notizverfahren stehen in `AGENTS.md`,
Abschnitt „Zunder“.

## 1. Folgetickets anlegen

- [ ] 1.1 F1 „Sichtbarkeits-Vorgabe der Organisation je Modul (abwählbar für alle Einsätze)“ als
  Unteraufgabe von LLH-1014 anlegen. Typ `feature`, Route `entwurf` (E2 Spec `modul-freigabe`,
  E3 Backend und Frontend). Die Beschreibung trägt:
  - D1 und D2 mit Verweis auf diese Change,
  - die F1-Zeilen der Stellenliste,
  - die „Folgen je Folgeticket“ für F1,
  - die Akzeptanz: Migrationstest für eine Zeile, die nur eine Rolle trägt, und einen
    Backend-Test für die Rangfolge Einsatz ?? Org ?? sichtbar in beide Richtungen.

  Nachweis: Kennung und Link im Abschlussbericht.
- [ ] 1.2 F2 „Modul Fernmeldewesen: Funkplan, Fernmeldeskizze, Sprechgruppen und
  Kommunikationsplan von der Stab-Freigabe lösen“ als Unteraufgabe von LLH-1014 anlegen. Typ
  `feature`, Route `entwurf` (E2, E3). Die Beschreibung trägt:
  - D3, D4 und D7,
  - die F2-Zeilen der Stellenliste,
  - die „Folgen je Folgeticket“ für F2, mit Specs, Regeln und Doku,
  - das am Checkpoint gewählte Label,
  - die Akzeptanz: Stab ausgeblendet → Funkplan, Skizze und Kommunikationsplan voll nutzbar;
    Fernmeldewesen gesperrt → 403 bzw. 404 nach `src/AGENTS.md`, auch unter dem alten API-Pfad;
    Weiterleitung `stab/funkplan?ansicht=skizze`.

  Nachweis: Kennung und Link im Abschlussbericht.

## 2. Laufende Tickets abstimmen

- [ ] 2.1 LLH-1111 (Lagebesprechung): Notiz mit D5, D2 und D7. Die Rolle von `stab` wird kopiert,
  die Ausblendung nicht. Dazu die Stellen der Stellenliste, die auf LLH-1111 zeigen. Nachweis:
  Notiz steht.
- [ ] 2.2 LLH-1124 (Stab-Seite): Notiz mit D6. S6 verweist auf das Modul Fernmeldewesen, die
  Lagebesprechung auf ihr Modul, und beides kommt erst nach F2 und LLH-1111. Nachweis: Notiz
  steht.
- [ ] 2.3 LLH-1127 (Sprungpalette): Notiz. Die S6-Einträge werden mit F2 Module statt
  Sprungmarken, und die Modulbeschreibung trägt die Suchwörter (D3). Pressearbeit und
  Informationstelefon bleiben Marken unter Stab. Nachweis: Notiz steht.
- [ ] 2.4 LLH-722 (Feldbefund Stab, früher LFH-852): Notiz mit D9. Die Rückbau-Kriterien gelten
  weiter, (b) zählt am Modul Lagebesprechung, und S6 ist keine Stabsnutzung mehr. Nachweis:
  Notiz steht.

## 3. Abschluss

- [ ] 3.1 `openspec validate wgnb0am2-stab-abwaehlbar --strict` grün.
- [ ] 3.2 `/opsx:archive wgnb0am2-stab-abwaehlbar` im selben Branch. Danach Verweise auf den
  aktiven Pfad nachziehen (`grep -rn "changes/wgnb0am2"`), auch in den Folgetickets aus 1.1/1.2,
  die auf das Archiv zeigen sollen. Nachweis: `scripts/check-openspec-archiv.sh` grün.
