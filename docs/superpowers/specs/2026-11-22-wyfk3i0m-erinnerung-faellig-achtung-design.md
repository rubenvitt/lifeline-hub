# Fällige Erinnerung im Modul: „fällig“ in Achtung wie im Überblick

Zunder: https://zunder.rubeen.dev/#/aufgabe/wyfk3i0mw59mymnv1kvewg30 (LLH-1911, Folge aus LLH-1749
„Überblick: Dringlichkeit“, Change `ro4s6p7l-ueberblick-dringlichkeit`, Entscheidung 4).

Stand: 22.11.2026. Der Weg wurde am Phase-1-Checkpoint am selben Tag abgestimmt (beide Empfehlungen
angenommen).

## Absicht

Dieselbe fällige Erinnerung sieht im Überblick und im Modul Erinnerungen gleich aus. Seit LLH-1749
steht sie im Überblick als „fällig“ in der Achtungsrolle, ohne Kante und ohne Fläche. Im Modul
steht sie dagegen auf der Alarmfläche, mit Alarmkante, rotem Chip und roter Fälligkeitszeile, in
einer Gruppe „Überfällig“. Wer vom Überblick auf die Erinnerung springt, sieht einen Sprung von
gelb auf rot, obwohl sich am Zustand nichts geändert hat.

Eine Erinnerung ist ein Wecker, keine Frist mit Soll: Sie meldet sich zur Zeit, sie ist danach nicht
„zu spät“. Alarm bleibt dem vorbehalten, was jetzt Handeln verlangt (Alarmbudget EEMUA 191,
`frontend/AGENTS.md`).

## Ziele

1. Eine fällige Erinnerung trägt in der Modulkarte (`erinnerung/ErinnerungKarte.tsx`) Wort und Ton
   aus `ERINNERUNG_FAELLIG` (`erinnerung/erinnerungZustand.ts`): Chip „fällig“ in `achtung`,
   Fälligkeitszeile in `achtungText`, die Uhr bleibt davor.
2. Die Karte trägt **keinen Kantenzustand und keine Statusfläche**: kein `alarm` an `KommKarte`,
   linker Rand `linie`, Grund `paneel`. Angesprungen trägt sie die Deeplink-Markierung wie jede
   nicht alarmierte Kommunikationskarte (Bedienfläche und Linien oben und unten).
3. Auf der Seite Erinnerungen heißt die erste Gruppe „Fällig“ statt „Überfällig“. Aufträge
   behalten „Überfällig“ (dort gibt es eine echte Frist).
4. Die Regel steht einmal in `frontend/AGENTS.md` beim Kartenrand-Vertrag; Kommentare an Karte,
   Kante und Seite verweisen dorthin.
5. Die Anwenderdoku Erinnerungen nennt die Gruppe „Fällig“ und beschreibt die Karte.

## Nicht-Ziele

- **Kein neuer Kantenzustand** in `kommunikation/kartenKante.ts`. Der Vertrag „EINE Farbe, Gefahr
  gewinnt: `alarm` vor `unbearbeitet` vor nichts“ bleibt unverändert, ebenso `kartenGrund`.
- Keine Änderung an Meldung, Auftrag, Nachforderung und Ablösung.
- Keine Änderung am Server (`ist_faellig`, Scheduler, Benachrichtigung „Erinnerung fällig“).
- Die interne Gruppe `ueberfaellig` in `kommunikation/gruppierung.ts` behält ihren Schlüssel und
  ihre Ordnung; nur das Etikett auf der Erinnerungsseite ändert sich.
- Keine Änderung unter `openspec/` (eingefroren, ADR-0069).

## Ansätze

**A — nur Chip und Zeile in Achtung (gewählt).** Die Karte verliert `alarm`, Chip und Zeile lesen
`ERINNERUNG_FAELLIG`. Das entspricht genau dem Überblick (Wort in `achtungText`, keine Kante) und
dem Vorbild im Modul selbst: eine überfällige Nachforderung trägt nur einen Achtung-Chip, keine
Kante (LLH-1097 D7). Der Kartenrand-Vertrag bleibt klein.

**B — neue Achtungskante (verworfen).** `kartenKante` bekäme einen Zustand `achtung` (3 px
`achtung`, Grund `paneel`). Fällig fiele in einer langen Liste stärker auf. Dagegen: Der Vertrag
aller Kommunikationskarten wächst um eine Stufe, die nur eine Karte nutzt; der Überblick hat keine
Kante, Modul und Überblick wären also wieder nicht gleich; und die Gruppe „Fällig“ trennt fällige
Erinnerungen ohnehin schon sichtbar ab.

**C — Alarm behalten, Überblick zurückdrehen (verworfen).** Widerspricht der Entscheidung aus
LLH-1749 und dem Alarmbudget.

## Entwurf

### Karte (`erinnerung/ErinnerungKarte.tsx`)

- `faellig` bleibt wie heute (`ist_faellig && !istAbg`); die Karte schlägt also weiter mit dem
  Server um, nicht mit der Seitenuhr. Die Seite ruft nach dem Scheduler-Takt neu ab; ein Umbau auf
  die Seitenuhr gehört nicht zu dieser Aufgabe.
- `KommKarte` ohne `alarm`.
- Chip: `<Status groesse="klein" ton={ERINNERUNG_FAELLIG.ton} wort={ERINNERUNG_FAELLIG.wort} />`.
- Fälligkeitszeile: fällig in `rollen.achtungText` (wie der Überblick), sonst wie heute
  `secondary`.
- Der Prop-Kommentar zu `hervorgehoben` verweist auf die neue Regel statt auf „behält ihre
  Alarmfläche“.

### Seite (`pages/ErinnerungenPage.tsx`)

- Etikett der Gruppe über eine kleine Abbildung `ERINNERUNG_GRUPPE_LABEL` = `GRUPPE_LABEL` mit
  `ueberfaellig: 'Fällig'`, abgelegt in `erinnerung/erinnerungZustand.ts` neben
  `ERINNERUNG_FAELLIG`, damit Wort und Gruppe aus einer Stelle kommen.

### Regel (`frontend/AGENTS.md`, „Linker Kartenrand“)

Ein Satz dazu: Eine fällige Erinnerung ist ein Wecker, keine Frist: sie trägt weder Kante noch
Fläche, nur „fällig“ in Achtung aus `ERINNERUNG_FAELLIG`, im Modul wie im Überblick; ihre Gruppe
heißt „Fällig“, nie „Überfällig“ (LLH-1911). Das Szenario „Erinnerung“ der eingefrorenen Spec
`deeplink-hervorhebung` („eine fällige behält ihre Alarmfläche“) ist damit überholt; die Spec
bleibt unverändert (ADR-0069), die Regel in `frontend/AGENTS.md` gilt.

### Doku (`docs/anwender/kapitel/erinnerungen.md`)

- Gruppen „Fällig“, „Heute fällig“, „Später“.
- „Auf eine fällige Erinnerung reagieren“: die Karte trägt „fällig“ in Gelb.
- Bilder: Das Listenbild zeigt die Gruppe „Heute fällig“ ohne fällige Karte und bleibt gültig;
  Regeln aus `docs/anwender/AGENTS.md` prüfen, ob ein Bild neu muss.

## Tests

- `ErinnerungKarte.test.tsx`: Der Test „eine fällige behält angesprungen ihren Alarm“ wird
  umgedreht: angesprungen und fällig → `data-hervorgehoben`, **kein** `data-alarm`. Neu: eine
  fällige Karte trägt den Chip „fällig“ und kein `data-alarm`; die Fälligkeitszeile steht in
  `achtungText`.
- `erinnerungZustand.test.ts`: `ERINNERUNG_GRUPPE_LABEL.ueberfaellig === 'Fällig'`, die übrigen
  Etiketten gleich `GRUPPE_LABEL`.
- Seite: eine fällige Erinnerung steht unter „Fällig (1)“, nicht unter „Überfällig“.

## Akzeptanz

- Dieselbe fällige Erinnerung trägt in Modul und Überblick dasselbe Wort („fällig“) und dieselbe
  Rolle (`achtung`), beide aus `ERINNERUNG_FAELLIG`.
- Auf der Seite Erinnerungen steht nirgends mehr „Überfällig“.
- `./scripts/check-all.sh --geaendert --ohne-e2e` grün.
