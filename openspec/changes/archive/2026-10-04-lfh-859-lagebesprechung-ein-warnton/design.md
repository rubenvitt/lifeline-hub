# Design

## Context

Zwei Funktionen bewerten heute denselben Termin (`einsatz.naechste_lagebesprechung_at`):

| Oberfläche | Funktion | kommend | überfällig |
| --- | --- | --- | --- |
| Stab · „Lagebesprechung“ (`stab/LagebesprechungStand.tsx`) | `stab/lagebesprechungZustand.ts:lagebesprechungZustand` → `StatusDarstellung` | `neutral`, „in 23 min“ | `achtung`, „jetzt fällig“ / „seit 5 min überfällig“ |
| Führungsüberblick · „Nächste Marken“ (`pages/fuehrung/UeberblickPage.tsx`) | `pages/fuehrung/ueberblickDaten.ts:markenBewertung` → `{ ton, wort }` | `achtung` unter 30 min, sonst `neutral`, „in 23 min“ | `alarm`, „überfällig“ |

`markenBewertung` bewertet alle sechs Markenarten mit derselben Regel. Beide Seiten ticken im
30-s-Takt (`useJetzt`), ein Wort mit Dauer veraltet also auf keiner von beiden. Beide zeigen die
Uhrzeit des Termins neben dem Wort.

Andere Stellen von `alarm` bei Überfälligem: der Auftragsstatus `ueberfaellig` ist `alarm`
(`theme/statusFarben.ts`), die AlarmZentrale meldet überfällige Aufträge und fällige
Erinnerungen. Eine Lagebesprechung kommt dort nicht vor.

## Goals / Non-Goals

**Goals:**
- Derselbe überfällige Termin trägt auf beiden Oberflächen denselben Ton und dasselbe Wort.
- Die Regel hat genau eine Heimat; ein Test macht eine Abweichung rot.

**Non-Goals:**
- **Der kommende Termin wird nicht angeglichen.** Die Fristenliste hebt jede Frist unter 30
  Minuten in `achtung` hervor („knapp“), die Stab-Seite lässt den kommenden Termin `neutral`.
  Das „knapp“ ist eine Ordnungshilfe innerhalb einer Liste gemischter Fristen, kein Zustand des
  Termins; das Ticket fragt nur nach dem überfälligen.
- Überfällige Aufträge und Erinnerungen in der Fristenliste behalten `alarm` und „überfällig“.
  Für Aufträge deckt sich das mit dem Auftragsstatus `ueberfaellig`.
- Keine Änderung an Layout, Zeitformat oder Sortierung der Fristenliste.

## Decisions

### D1 — Überfällige Lagebesprechung: `achtung`, nicht `alarm`

Maßstab ist das Alarmbudget (EEMUA 191/ISA-18.2, `frontend/AGENTS.md`, „Layout und Live“: 1–2
je 10 Minuten, ≤ 3 Stufen). `alarm` heißt im Projekt Gefahr oder ein verletzter Handlungsauftrag
(Warnstufe, überfälliger Auftrag, Bestätigung überfällig, Ausfall). Eine verstrichene
Besprechung gefährdet niemanden; sie ist ein Organisationshinweis an die Führung, und wer
sie ansetzt, sitzt meist im selben Raum. Rot in der Fristenliste stellt sie neben einen
gerissenen Auftrag und nimmt dem Rot seine Bedeutung.

*Verworfen:* `alarm` auf beiden Seiten. Das hebt den Termin auf die Stufe einer Gefahr und
verbraucht Alarmbudget für etwas, das niemand quittieren muss. Die Stab-Seite hat `achtung`
seit ihrer Einführung, ohne dass ein Termin dort untergegangen wäre.

### D2 — Das Wort der Stab-Seite gilt für beide

„jetzt fällig“ in der ersten Minute ab dem Termin, danach „seit <Dauer> überfällig“ mit
`dauerText` („5 min“, „2 h 05 min“), auf ganze Minuten abgerundet, gerechnet in absoluten
Millisekunden.

*Verworfen:* das knappe „überfällig“ der Fristenliste für beide. Die Stab-Seite verlöre die
Angabe, wie lange die Besprechung schon aussteht, und die Fristenliste sagt für Kommendes schon
„in 23 min“: das Gegenstück mit Dauer ist dort die symmetrische Form. Die Wortspalte der
Fristenliste wird für diese eine Marke breiter (bis „seit 2 h 05 min überfällig“); sie ist
`flex: 0 0 auto` und schiebt nur den Text daneben.

### D3 — Eine Funktion in `stab/lagebesprechungZustand.ts`

Neu: `lagebesprechungUeberfaellig(termin: Dayjs, jetzt: Dayjs): { rolle: 'achtung'; label: string } | null`
— `null`, solange der Termin in der Zukunft liegt, sonst Ton und Wort nach D1/D2.

- `lagebesprechungZustand` ruft sie für den Zweig „termin ≤ jetzt“; die eigenen Literale
  `achtung`, „jetzt fällig“ und „seit … überfällig“ entfallen dort.
- `markenBewertung(zeit, jetzt, art?)` bekommt die Markenart. Für `art === 'lagebesprechung'`
  übernimmt sie das Ergebnis von `lagebesprechungUeberfaellig` als `{ ton: rolle, wort: label }`;
  für alle anderen Arten und für kommende Termine gilt die bisherige Regel unverändert.
  `naechsteMarken` reicht die Art durch.

Der Rückgabetyp schreibt `'achtung'` als Literal fest. So kann die Funktion keinen Ton liefern,
den `MarkenTon` nicht kennt, und `ton: rolle` braucht keine Umrechnung.

*Verworfen:* `lagebesprechungZustand` als Ganzes in der Fristenliste nutzen. Dann verlöre die
Lagebesprechung dort das „knapp“ der übrigen Fristen (Non-Goal oben), und die Fristenliste
müsste die Fälle „kein Termin“/„Termin unlesbar“ abfangen, die sie gar nicht zeigt.
*Verworfen:* eine neue Datei unter `theme/` oder `anzeige/`. Die Regel gehört zur
Lagebesprechung, die Heimat liegt schon im Stab; `dauerText` importiert die Fristenliste von
dort bereits.

### D4 — Der Gleichheitstest

In `pages/fuehrung/ueberblickDaten.test.ts`: für die Abstände 0 s, 30 s, 5 min 30 s und
2 h 05 min vor `jetzt` ergibt die Marke „Lagebesprechung“ aus `naechsteMarken` dasselbe
`{ ton, wort }` wie `lagebesprechungZustand` als `{ rolle, label }`. Der Test vergleicht die
beiden Ergebnisse miteinander, nicht nur mit Literalen, damit er auch eine künftige gemeinsame
Änderung übersteht und nur eine Abweichung rot macht.

## Risks / Trade-offs

- [Rot war Absicht und jemand verlässt sich darauf] → Die Fristenliste sortiert Überfälliges
  weiter nach oben, das Wort sagt „überfällig“, und die Stab-Seite hatte immer `achtung`.
- [Längeres Wort drückt den Markentext auf schmalen Schirmen] → Nur die eine Marke; der Text
  bricht mit `overflowWrap: anywhere` um.

## Migration Plan

Reine Darstellung; kein Datenstand, kein Rollback-Schritt außer dem Revert.
