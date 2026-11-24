# Seitenkopf im Überblick: Platz für die Pegel-Notiz (LLH-2085)

Zunder: https://zunder.rubeen.dev/#/aufgabe/uxrnx692qx7nk5moo8ze4cbg · kurzer Entwurf, Weg am
24.11.2026 abgestimmt.

## Absicht

Im Überblick kommt die Pegel-Notiz erst mit dem Pegel-Abruf in den Seitenkopf
(`kopfLage` in `pages/fuehrung/UeberblickPage.tsx`, `meta` von `EinsatzSeite`). Ist sie die
erste Lage-Angabe im Kopf und der Ortspfad lang, bricht der Titelblock beim Eintreffen um, und
der Inhalt rückt. Gemessen auf `alpha` 2ce35609 mit CI-Schriftsetzung (nur Pegel-Beitrag zur
CLS, Grenze 0,1):

| Fall | 768 | 1024 | 1199 | 1366 |
|---|---|---|---|---|
| kurzer Name, „Pegel 6,84 m steigend“ | 0,0005 | 0,0003 | 0,0002 | 0,0002 |
| langer Name, kurze Meta | 0,0005 | **0,4040** | 0,0002 | 0,0002 |
| langer Name, Warnstufe akut, 3 unbestätigt, Pegel veraltet | **0,2483** | 0,0005 | 0,0003 | 0,0003 |

Ziel: Das Eintreffen des Pegels verschiebt den Überblick in keiner Breite um mehr als 0,1.

**Nicht-Ziele:** andere Seiten, die Höhe des Seitenkopfs, Wortlaut und Form der Pegel-Notiz.
**Anti-Ziel:** eine sichtbare Lücke oder ein Ladezeichen im Kopf eines Einsatzes ohne Pegel.

## Ansätze

1. **Platz für den Pegel im Überblick (gewählt).** Der Einsatz sagt vor dem Pegel-Abruf, ob
   ein Pegel festgelegt ist (`lagekennzahlen` enthält `pegel`). Dann steht, solange der Abruf
   lädt, ein unsichtbarer Platzhalter in der Form der Notiz an ihrer Stelle, und der Kopf bricht
   schon im ersten Bild richtig um. Das folgt der Regel `metaPlatzhalter` aus `frontend/AGENTS.md`
   („Seitenkopf“) und betrifft nur diese Seite.
2. **Meta bis `lg` auf eigener Zeile**, für alle Seiten. Das behebt 1024, nicht aber 768 (dort
   ist die Zeile neben den Aktionen nur 387 px breit). Außerdem wird jeder Kopf mit Meta zwischen
   768 und 1199 px rund 24 px höher. Verworfen.
3. **Beides.** Am robustesten, aber mit dem höheren Kopf aus 2. Verworfen.
4. Titel wieder kleiner. Nimmt #1640 zurück und ist nicht empfohlen.

## Entwurf

- In `kopfLage` steht an der Stelle von `pegelNotiz` ein Platzhalter-`span` mit
  `visibility: hidden` und `aria-hidden="true"`, wenn alle drei gelten:
  - der Einsatz ist geladen und trägt `pegel` in `lagekennzahlen`,
  - der Pegel-Abruf hat noch kein Ergebnis (`pegelQ.isPending`),
  - es gibt noch keine Notiz.
- Text des Platzhalters: `Pegel 0,00 m steigend`, die häufige Form mit Ziffern als `0`
  (`frontend/AGENTS.md`). Den Zusatz „· veraltet“ nimmt er nicht auf.
- Platzhalter und Notiz sind zwei Knoten mit eigenem `key`, wie Meta und Datenstand in
  `EinsatzSeite`. Ein neuer Knoten erscheint, er verschiebt sich nicht.
- Weil der Platzhalter `kopfLage` füllt, entsteht die Lage-Gruppe schon mit ihm.
- Ohne festgelegten Pegel bleibt alles wie heute: kein Platzhalter, keine Lücke.

**Spec:** `e2e/pegel-pruefliste.spec.ts` misst den Überblick zusätzlich mit einem langen
Einsatznamen. Das gilt einmal mit nur dem Pegel, bei 1024 px, und einmal mit Warnstufe akut,
unbestätigten Gebieten und veraltetem Pegel, bei 768 und 1024 px. Grenze je 0,1, gemessen mit
CI-Schriftsetzung. Mutationsprobe: ohne Platzhalter sind beide Fälle rot (0,40 und 0,25 wie oben).

**Unit-Test:** Der Kopf des Überblicks zeigt den Platzhalter, während der Pegel lädt, und keinen,
wenn der Einsatz keinen Pegel trägt.

## Dem Bauenden überlassen

- Ob der Platzhalter als kleine Funktion neben `pegelNotizKurz` steht oder inline bleibt.
- **Restrisiko, meine Entscheidung:** Mit „· veraltet“ wird die Notiz rund 70 px breiter als
  der Platzhalter und kann an einer Kante noch umbrechen. Die Spec misst den Fall bei 768 und
  1024 px. Ist er dort rot, nimmt der Platzhalter den Zusatz auf.

## Nachtrag beim Bauen (24.11.2026, mit Ruben abgestimmt)

- **Die Namenslänge entscheidet über ein Band.** Der Kopf springt bei 1024 px nur, wenn der
  Datenstand ohne Pegel gerade noch neben den Titel passt und mit Pegel nicht mehr. Ein fester
  Name trifft das Band zufällig (sogar die Ziffern der Uhrzeit verschieben es). Die Spec misst
  deshalb sieben Namensstufen an einem Einsatz: ohne Platzhalter 0,34 bis 0,40, mit 0,00.
- **„· veraltet“ bleibt draußen.** Mit dem Zusatz im Platzhalter sprang der frische Pegel, also
  der Normalfall, bei zwei Namensstufen nach oben (0,29 und 0,32). Ohne ihn bleibt 768 px mit
  Warnstufe, unbestätigten Gebieten und veraltetem Pegel bei 0,25. Das ist als LLH-2102 auf dem
  Board, die Spec misst den veralteten Pegel nur bei 1024 px (0,0001).
- Der Fall bei 768 px mit frischem Pegel ist ohne Platzhalter 0,07, er sichert ab und belegt
  nichts. Die Mutationsprobe tragen die Namensstufen.
