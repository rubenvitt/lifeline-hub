# Tasks

## 1. API und Fokus-Hook

- [ ] 1.1 `api/einsaetze.ts`: Typ `KopfdatenPatch = Partial<KopfdatenUpdate>` und `patcheEinsatz(id, patch)` (PATCH mit genau den übergebenen Schlüsseln); Vitest prüft, dass der Body nur die übergebenen Schlüssel trägt und `null` erhalten bleibt
- [ ] 1.2 Fokusrückgabe aus `components/BemerkungZelle.tsx` als `components/useFokusRueckgabe.ts` herauslösen und dort einsetzen; `BemerkungZelle.test.tsx` bleibt unverändert grün

## 2. Primitiv `InlineAngabe` (TDD)

- [ ] 2.1 Anzeige: Wertknopf „<Etikett> bearbeiten" mit Wert als Beschreibung, Platzhalter „<Etikett> eintragen" bei leerem Wert, ohne Schreibrecht nur Wert bzw. „—"; Vitest je Zweig inkl. Abwesenheit der Knöpfe ohne Schreibrecht
- [ ] 2.2 Bearbeitung: eigenes `<form>`, Fokus in der Eingabe, Enter sendet, Strg/⌘+Enter im Textfeld, Escape und „Abbrechen" verwerfen ohne `onSpeichern`; Vitest je Weg
- [ ] 2.3 Riegel: unveränderter Wert ruft `onSpeichern` nicht; Pflichtangabe leer ruft `onSpeichern` nicht, zeigt den alten Wert und den Hinweis mit `data-fehler`; Vitest je Fall
- [ ] 2.4 Fehler und Fokus: abgelehntes `onSpeichern` lässt die Eingabe mit Entwurf offen und zeigt `SpeicherFehler` in der Zeile; nach Erfolg und nach Abbrechen liegt der Fokus auf dem Wertknopf, auch wenn der Wert erst eine Runde später kommt (`rerender`); Vitest
- [ ] 2.5 `wertKnopfStil`-Böden über zwei Dichtestufen für den Wertknopf gelten weiter (bestehender Test, ggf. um `InlineAngabe` ergänzt); Dateikopf nennt Regel, Abgrenzung zu `BemerkungZelle` und die LFH-369-Fallen

## 3. Einbau in `EinsatzdatenPage` (TDD)

- [ ] 3.1 Neun Angaben als `InlineAngabe` (Stichwort mit `AutoComplete`, Einsatzart mit `Select`, Anzahl mit `InputNumber min=0`, Sachverhalt mit `TextArea`, zwei Zeitpunkte mit `DatePicker showTime`, übrige `Input`); Vitest: Leitstellen-Nr. inline ändern → PATCH-Body genau `{ leitstellen_nr: 'ILS-4711' }`, Vollformular nicht geöffnet, Kopfangaben weiter sichtbar
- [ ] 3.2 Leeren einer optionalen Angabe sendet `null`; unveränderter Wert sendet nichts; Vitest
- [ ] 3.3 Alarmzeit: geleert → kein PATCH, alter Wert und Hinweis stehen da; Vitest (Akzeptanzkriterium LFH-472)
- [ ] 3.4 Alarmzeit inline über beide Sommerzeit-Umstellungen 2026: gesendeter Wirestring = gewählter absoluter Zeitpunkt, unveränderte Alarmzeit sendet nichts; Vitest nach Muster `etb/filterZeit.test.ts`, unter `TZ=Europe/Berlin` gelaufen
- [ ] 3.5 Beobachter und abgeschlossener Einsatz: kein Knopf „… bearbeiten"/„… eintragen" an einer Zeile; Koordinate, Einsatzleitung, Einsatznummer, „Angelegt am" ohne Aufforderung auch mit Schreibrecht; Vitest
- [ ] 3.6 Erfolg: Antwort per `setQueryData` in `einsatzKeys.einsatz`, Invalidierung von Einsatz und Einsatzliste, Toast „<Etikett> gespeichert"; Serverfehler an der Zeile, kein Fehler-Toast; Vitest
- [ ] 3.7 Bestehende Tests des Vollformulars (Bearbeiten-Knopf, PATCH mit allen Feldern, Koordinate, Einsatznummer, Fokus aufs erste Feld, Speicherfehler) bleiben grün

## 4. Nachweis und Abschluss

- [ ] 4.1 Prüfliste Einsatztauglichkeit (15 Kriterien) für die umgebaute Seite ausfüllen, je Zeile Verdikt (erfüllt / offen → Zielticket / nicht anwendbar); Ablage in diesem Change als `pruefliste.md`, weil `docs/superpowers/` eingefrorenes Archiv ist
- [ ] 4.2 Nachzug-Ticket „Vollformular Einsatzdaten sendet nur geänderte Felder" über `clickup-task-anlegen` anlegen und in `design.md` D4 eintragen
- [ ] 4.3 `./scripts/check-all.sh` grün (mindestens Prettier, `pnpm lint`, Vitest, betroffene e2e: `gate3-trefflaeche.spec.ts`)
- [ ] 4.4 CLAUDE.md: Absatz „Ein leeres Feld muss sagen, dass man es schreiben kann" um `InlineAngabe` (Pflichtangaben, andere Eingabearten) ergänzen
