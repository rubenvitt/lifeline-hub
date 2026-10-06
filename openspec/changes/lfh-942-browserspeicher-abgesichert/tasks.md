## 1. Helfer (D1)

- [x] 1.1 Test zuerst (`frontend/src/lib/sichererSpeicher.test.ts`): Lesen, Schreiben, Entfernen und Schlüsselliste im Normalfall; mit `localStorage` als `null`, mit werfendem Getter und mit werfendem `setItem` (QuotaExceededError) liefern alle Funktionen ihren Rückfall und werfen nicht.
- [x] 1.2 `frontend/src/lib/sichererSpeicher.ts` umsetzen. Mutationsprobe: `try` um den Getter weglassen → 1.1 rot.

## 2. ThemeModeProvider (D2)

- [x] 2.1 Test zuerst (`ThemeModeProvider.test.tsx`): `localStorage` per `vi.stubGlobal` auf `null` bzw. werfenden Getter → Provider rendert, Modus `dark`; `setModus('light')`, `setDichte`, `setHelligkeit` werfen nicht und wirken.
- [x] 2.2 Provider auf den Helfer umstellen. Mutationsprobe: ein Lesen roh lassen → 2.1 rot.

## 3. Koordinatensystem (D3)

- [x] 3.1 Test zuerst (`koordinatenSystemStore.test.ts`): `setItem` wirft QuotaExceededError → Listener wird gerufen, der Hook liefert die neue Wahl; Zurückstellen auf `null` wirkt ebenso; gesperrter Speicher beim Lesen → `null`.
- [x] 3.2 Store umstellen. Mutationsprobe: Benachrichtigung hinter das Schreiben ohne Schutz → 3.1 rot.

## 4. Serveruhr (D4)

- [x] 4.1 Test zuerst (`serveruhr.test.ts`): 50 Antworten mit stabilem `Date` → höchstens ein `setItem`; Versatzsprung über 1 s → erneutes `setItem`; gespeicherte Messung älter als 10 min → erneutes `setItem`; `serverJetzt()` nutzt weiter die jüngste Messung des Tabs. Bestehende Fälle bleiben unverändert grün.
- [x] 4.2 `merkeServerzeit` drosseln, Speicherzugriffe über den Helfer. Mutationsprobe: Schwelle entfernen → 4.1 rot.

## 5. Sweep und Guards (D5, D6, D7)

- [x] 5.1 Übrige Stellen auf den Helfer umstellen (Liste in D7), darunter `useEtbEntwuerfe.ts` (Lesen im async-Effekt, Schreiben in den Updatern).
- [x] 5.2 `offline/geraetRaeumung.guard.test.ts`: `SCHREIBT` erkennt `sicherSchreiben(`, Helfer ausgenommen, Selbst-Beweis erweitert; Verzeichnis bleibt vollständig.
- [x] 5.3 `lib/sichererSpeicher.guard.test.ts` mit Selbst-Beweis anlegen und scharf schalten. Mutationsprobe: eine Rohstelle zurücksetzen → Guard rot mit Datei und Zeile.

## 6. Regel und Abschluss

- [x] 6.1 Regel „Browserspeicher nur über `lib/sichererSpeicher`“ in `frontend/AGENTS.md`.
- [ ] 6.2 Lint, Typecheck, Vitest der berührten Dateien.
- [ ] 6.3 `./scripts/check-all.sh` (Bündel `schnell` und Vitest; e2e der Einstellungs- und Offline-Specs).
- [x] 6.4 e2e `browserspeicher-gesperrt.spec.ts`: Anmeldung mit `localStorage` `null` und mit werfendem Zugriff, Nachtbetrieb, kein unbehandelter Fehler der App. Mutationsprobe: Farbschema roh lesen → beide rot.
