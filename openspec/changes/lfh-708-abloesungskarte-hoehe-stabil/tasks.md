# Tasks

## 1. e2e gegen die Uhr (rot zuerst)

- [ ] 1.1 `e2e/abloesung-zufluss.spec.ts`, Fall „fremde Rhythmusänderung ordnet erst mit dem Banner um“: `timezoneId: 'Europe/Berlin'`, je Kontext zwei Läufe mit `page.clock.setFixedTime(T)` (T = jüngster vergangener Zeitpunkt 12:00 bzw. 23:40 Europe/Berlin, über `Intl` berechnet), Schichten per `beginn_at = T − 5 min`; zusätzlich zur Oberkante die Höhe jeder Karte messen (≤ 0,5 px) und die Zeitspaltenbreite als Messwert annotieren (D E-5). Vor der Umsetzung: der Lauf „mobil, 23:40“ ist rot mit Karte 3 +23 px, die übrigen fünf grün
- [ ] 1.2 Neuer e2e-Fall „längster Rhythmus bleibt einzeilig“ (390 px, `komfortabel` und `handschuh`): Abschnittsvorgabe 10079 min, eine Schicht ohne eigenen Rhythmus; die Rhythmuszeile (`data-lfh="abloesung-rhythmus"`) ist so hoch wie ihre Zeilenhöhe. Vor der Umsetzung rot (Selektor fehlt bzw. zwei Zeilen)

## 2. Karte umsetzen (`abloesung/AbloesungKarte.tsx`)

- [ ] 2.1 Vitest zuerst (neben der Karte oder in `pages/AbloesungPage.test.tsx`): die Rhythmuszeile ist ein eigenes Element mit `data-lfh="abloesung-rhythmus"` und dem Text „Rhythmus 6 h (Vorgabe)“ bzw. „Rhythmus 6 h (eigen)“; die Zeile darüber nennt Abschnitt und Beginn ohne „Rhythmus“; der Zeit-Span trägt `min-width: 6ch` und `display: inline-block`. Bestehende Erwartungen auf „Vorgabe des Abschnitts“/„eigener Wert“ in `AbloesungPage.test.tsx` auf die neuen Wörter ziehen. Rot sehen, dann E-1 bis E-3 umsetzen; `mise exec -- pnpm -C frontend vitest run src/pages/AbloesungPage.test.tsx src/abloesung` ist grün
- [ ] 2.2 Kommentar der Karte (Dateikopf bzw. an der Zeitspalte) nennt die feste Breite und den Grund (Kriterium 12, LFH-708, Verweis auf diese Change). `tsc -b`, ESLint und Prettier im Frontend sind grün
- [ ] 2.3 e2e aus Gruppe 1 grün: alle sechs Läufe des Rhythmus-Falls (drei Kontexte × Tag/Mitternacht) und beide Läufe „längster Rhythmus“; Mutationsproben: Zeitspalte zurück auf `minWidth: 64` → „mobil, 23:40“ rot; Quellenwort zurück auf „Vorgabe des Abschnitts“ → „längster Rhythmus“ rot. Die übrigen Fälle in `abloesung-zufluss.spec.ts` und `abloesung-kontrast.spec.ts` bleiben grün

## 3. Prüfliste und Abschluss

- [ ] 3.1 `docs/superpowers/specs/2026-09-22-lfh-635-pruefliste.md`, Nr. 12: Befund LFH-708 (Ursache, Reproduktion mit fester Uhr), neue Messwerte Tag/Mitternacht je Kontext, Mutationsproben und die benannten Reste (fremde Beginnänderung, fremd geplante ablösende Einheit, Einstufungswort im Kopf, Inhalt unter 226 px) nachtragen; Verdikt nach Beleg
- [ ] 3.2 `./scripts/check-all.sh` ist grün (lokal oder belegt durch die CI des PRs)
