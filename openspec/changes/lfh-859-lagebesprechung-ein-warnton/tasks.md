# Tasks

## 1. Eine Heimat in `stab/lagebesprechungZustand.ts` (LFH-859)

- [ ] 1.1 Tests zuerst in `stab/lagebesprechungZustand.test.ts`: `lagebesprechungUeberfaellig` liefert `null` für einen Termin 1 s in der Zukunft, `{ rolle: 'achtung', label: 'jetzt fällig' }` für 0 s und 59 s zurück, „seit 5 min überfällig“ für 5 min 30 s, „seit 2 h 05 min überfällig“ für 2 h 05 min. Verifikation: die neuen Fälle laufen rot (Funktion fehlt).
- [ ] 1.2 `lagebesprechungUeberfaellig` nach design.md D3 anlegen, `lagebesprechungZustand` ruft sie im Zweig „termin ≤ jetzt“; Dateikopf-Kommentar nennt LFH-859 und die Heimat. Verifikation: `stab/lagebesprechungZustand.test.ts` und `stab/LagebesprechungStand.test.tsx` grün, die bestehenden Erwartungen unverändert.

## 2. Fristenliste nutzt die Heimat

- [ ] 2.1 Tests zuerst in `pages/fuehrung/ueberblickDaten.test.ts`: Gleichheitstest nach design.md D4 (Marke „Lagebesprechung“ ≡ `lagebesprechungZustand` für 0 s, 30 s, 5 min 30 s, 2 h 05 min überfällig); dazu ein Fall, dass ein überfälliger Auftrag in derselben Liste `alarm`/„überfällig“ bleibt und eine kommende Lagebesprechung unter 30 min `achtung` „in … min“ trägt. Verifikation: Gleichheitstest rot gegen den heutigen Stand.
- [ ] 2.2 `markenBewertung` um `art?: MarkenArt` erweitern, `naechsteMarken` reicht `m.art` durch, Zweig für `lagebesprechung` nach D3; Doc-Kommentar an `markenBewertung` nennt die Ausnahme. Verifikation: `ueberblickDaten.test.ts` und `UeberblickPage.test.tsx` grün; `markenBewertung`-Test ohne Art unverändert grün.

## 3. Regel und Abschluss

- [ ] 3.1 `frontend/src/stab/AGENTS.md`, Abschnitt neben „Vorbereitung der Lagebesprechung“: Regel „Überfälliger Besprechungstermin“ (`achtung`, Wort der Stab-Seite, Heimat `lagebesprechungUeberfaellig`, Fristenliste nur für die Marke „Lagebesprechung“). Verifikation: `prettier --check` über `frontend/` grün.
- [ ] 3.2 Gesamtlauf `./scripts/check-all.sh` bzw. die in der Cloud-Sitzung lauffähigen Bündel (Prettier, ESLint, `tsc`, Vitest) grün; Kästchen, die erst die CI des PRs belegt, mit Verweis auf diesen Lauf abhaken.
