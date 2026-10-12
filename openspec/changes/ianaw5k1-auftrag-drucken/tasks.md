# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst der rote Test, dann der
Code. Pfade ohne Präfix sind relativ zu `frontend/src/`.

## 1. Feldfolge des Blatts im Schemakern (D4)

- [x] 1.1 `druckFelder(a, fmt)` in `auftraege/auftragsschemaKern.ts` mit der Folge Empfänger ·
  Auftrag · Priorität · Frist · READ_ORDER · Richtung · Erteilt am, leere Angaben weg; Richtung
  „Intern“ bzw. „Extern“ samt Kategorie und Bezeichnung der Stelle, Kategorie-Etiketten aus der
  Quelle des Formulars. Nachweis: Tests in `auftraege/auftragsschemaKern.test.ts` pinnen die
  Etiketten des Spec-Szenarios „Teilweise gefüllter Auftrag“ (genau Empfänger, Auftrag,
  Priorität, Mittel, Weg, Absicht, Richtung, Erteilt am), den externen Auftrag, die Zeitzone über
  `formatZeit` und dass die Lesefolge der Karte (`READ_ORDER`) als zusammenhängende Teilfolge
  darin steht. Mutationsprobe: `druckFelder` mit einer eigenen, festen Liste statt `READ_ORDER`
  und danach zwei Felder in `READ_ORDER` vertauscht → der Teilfolgen-Test wird rot.

## 2. Gemeinsame Etikett-Wert-Liste (D5, Umzug)

- [x] 2.1 `ZeilenListe` samt `Titel`, `TitelZeile`, `Titelfolge` und `ZeilenEintraege` aus
  `druck/einsatzbericht/Bloecke.tsx` nach `druck/ZeilenListe.tsx` verschieben, ohne das Markup zu
  ändern. `Bloecke` importiert von dort, der Kopfkommentar verweist darauf. Nachweis:
  `druck/einsatzbericht/Bloecke.test.tsx` ist unverändert grün, `tsc` und ESLint sind sauber.

## 3. Daten, Pfad und Route (D2, D3)

- [x] 3.1 Key `einsatzKeys.auftragDruck(einsatzId, auftragId)` mit Prefix
  `EINSATZ_KEYS.auftragDruck = 'einsatz-auftrag-druck'` in `api/queryKeys.ts`, eingetragen in
  `NICHT_LIVE_KEYS` samt Begründungszeile. Nachweis: die Guard-Tests von `queryKeys` (live oder
  nicht live, Offline-Lagebild) sind grün. Gegenprobe: ohne Eintrag in `NICHT_LIVE_KEYS` wird der
  Guard rot.
- [x] 3.2 `auftragDruckPfad(einsatzId, auftragId)` in `routing/deeplinks.ts` →
  `/einsaetze/<id>/auftraege/<auftragId>/druck`. Route in `App.tsx` neben
  `auftraege/befehle/:befehlId`. Nachweis: Test in `routing/deeplinks.test.ts`. Ein Test belegt,
  dass `modulAusPfad` die Route dem Modul „Aufträge/Befehle“ zuordnet, sodass die Modulsperre
  greift wie bei der Befehls-Vollseite.

## 4. Blatt und Druckansicht (D3, D5)

- [x] 4.1 `auftraege/AuftragDruckBlatt.tsx`: drei `ZeilenListe` mit `h3` „Auftrag“
  (`druckFelder`), „Quittung“ (je Empfänger Zeitpunkt oder „nicht quittiert“) und „Bearbeitung“
  (Phase, In Bearbeitung seit, Vollzogen am, Vollzugsvermerk, Abgenommen am, Aufgehoben am,
  Aufgehoben von, Grund; leere weg). Nachweis: `auftraege/AuftragDruckBlatt.test.tsx` deckt die
  Spec-Szenarien „Abgenommener Auftrag“, „Offener Auftrag ohne Quittung“ und „Aufgehobener
  Auftrag“ ab und prüft, dass jeder Titel mit der ersten Zeile in `data-lfh="titelblock"` steht.
- [x] 4.2 `pages/AuftragDruckPage.tsx` nach D3: Laden, 404 „Auftrag nicht gefunden“ mit
  Rückweg, 403 „Kein Zugriff“, Fehler mit „Erneut laden“, ungültige ID → `Navigate`. Bei Erfolg
  genau eine Druckwurzel mit `Druckkopf` (`dokumentart="Auftrag"`, Titel `#n`, Zeile „Stand“,
  `sichtbarkeit="immer"`, `ebene={2}`) und Blatt. Aktionen: „Zurück zu Aufträge/Befehle“ auf
  `auftraegePfad(einsatzId, { auftrag })`, „Neu laden“, `DruckKnopf typ="primary"`, gesperrt
  während des Ladens. Nachweis: `pages/AuftragDruckPage.test.tsx` mit MSW belegt jeden Zustand,
  den Rückweg, die Sperre und den Schnappschuss (ein Live-Ereignis `auftrag` ändert das Blatt
  nicht, „Neu laden“ schon; Spec „Auftrag ändert sich bei offener Druckansicht“).
- [x] 4.3 Sprung „Druckansicht“ in `auftraege/AuftragDetail.tsx` (`DetailSprung` auf
  `auftragDruckPfad`), ohne Schreibrecht und in jeder Phase. Nachweis: Test in
  `auftraege/AuftragDetail.test.tsx` (Beobachter, aufgehobener Auftrag, Ziel der Adresse).
- [x] 4.4 `druck/AGENTS.md`: Abschnitt „Auftragsdruck“ (Route, nicht-live Key, Einstieg aus dem
  Detail, Feldfolge im Kern, Blatt über `druck/ZeilenListe.tsx`); der Verweis „Etikett-Wert-Liste“
  beim Einsatzbericht zeigt auf das neue Modul. Nachweis: Prettier über `frontend/` ist sauber,
  und `grep -rn "ZeilenListe" frontend/src/druck/AGENTS.md` nennt den neuen Pfad.

## 5. Druck-Gate (D6)

- [ ] 5.1 Fall „Auftrag druckt im normalen Fluss über mehrere Seiten“ in
  `e2e/druck-fluss.spec.ts`: Er legt per API einen Auftrag mit langen Schemafeldern an, das
  letzte endet mit `ENDMARKE`, öffnet die Druckansicht und ruft `pruefeDruckImFluss`. Nachweis:
  Der Fall läuft in Chromium, Firefox und WebKit grün (`DRUCK_SPECS`). Gegenprobe: Ohne
  `data-lfh="druckwurzel"` auf der Seite wird er rot. Kann die Umgebung den e2e-Lauf nicht
  fahren, belegt die CI des PRs den Fall, und das steht im PR.

## 6. Anwenderdoku

- [x] 6.1 `docs/anwender/kapitel/auftraege-befehle.md`: Ablauf „Auftrag drucken“ mit
  nummerierten Schritten (Auftrag wählen, „Druckansicht“, „Drucken / als PDF“). Unter
  Hintergrund: Schnappschuss und „Neu laden“, Druck ohne Schreibrecht. `quellen` um
  `frontend/src/pages/AuftragDruckPage.tsx` und `frontend/src/auftraege/AuftragDruckBlatt.tsx`
  ergänzt. Nachweis: Der Kapitelwächter (`docs/anwender/AGENTS.md`, „Wächter“) ist grün.
- [x] 6.2 `docs/anwender/kapitel/drucken-export.md`: Der Auftrag steht unter den Druckstücken,
  `quellen` sind ergänzt. Nachweis: Der Kapitelwächter ist grün.

## 7. Integration

- [ ] 7.1 `./scripts/check-all.sh` (Bündel nach `scripts/AGENTS.md`) ist grün, oder die Schritte,
  die die Umgebung nicht fahren kann, sind benannt und von der CI des PRs belegt.

## Workflow follow-up

- Review (`superpowers:requesting-code-review`), dann `/opsx:archive ianaw5k1-auftrag-drucken` im
  selben Branch vor dem PR, Verweise auf den alten Pfad nachziehen.
- PR gegen `alpha`, Zunder-Status `review` mit `pr_url`.
