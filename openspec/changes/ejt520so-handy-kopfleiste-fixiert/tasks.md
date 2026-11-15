# Tasks

Arbeitsweise je Aufgabe: `superpowers:test-driven-development` (Test zuerst rot, dann grün).
Pfade relativ zu `frontend/src/`, falls nicht anders angegeben.

## 1. Stapel

- [x] 1.1 `components/rahmenOben.ts`: Ränge statt „Summe ohne mich“ (D2). Konstanten für
  Betriebszeile 0, Kopf 1, Übungsband 2; eine Quelle mit Rang bekommt als `oben` die Summe der
  Quellen mit kleinerem Rang, `--lfh-rahmen-oben` bleibt die Gesamtsumme. `useRahmenObenStapel`
  geht darin auf, das Übungsband nutzt Rang 2. Unit-Test: drei Quellen, `oben` je Rang richtig,
  keine Rückkopplung bei Höhenänderung; `rahmenOben.guard.test.ts` grün.
- [x] 1.2 `live/LiveStatusBanner.tsx`: die Betriebszeile meldet sich mit Rang 0, Bedingung
  unverändert (unter `md`, Störung). Bestehende Tests grün.

## 2. Kopf klebt in jeder Breite

- [x] 2.1 `einsatz/EinsatzLayout.tsx`: Kopf immer klebend und immer Quelle mit Rang 1, `top` aus
  dem Stapel (D1, D2). Test in `EinsatzLayout.test.tsx`: unter `md` trägt der Kopf
  `position: sticky`.
- [x] 2.2 `components/AppLayout.tsx`: dasselbe für den App-Rahmen; Uhr auch unter `md`; Wortmarke
  erst ab `md` (D5). Test in `AppLayout.test.tsx`: unter `md` Uhr da, Wortmarke weg, Kopf klebt.

## 3. Eine Zeile im Einsatz am Handy

- [x] 3.1 `components/Kopfleiste.tsx`: `Uhr` nimmt die Zellpolsterung als Prop; im Einsatzkopf
  unter `md` mit `paddingXS` (D3). Test in `Kopfleiste.test.tsx`.
- [x] 3.2 `einsatz/EinsatzLayout.tsx`: unter `md` kein Suchauslöser und kein Benutzermenü im Kopf,
  Uhr dazu (D3). Test: bei 390 px fehlen beide im `header`, Uhr steht; bei 820 px beide im Kopf.
- [x] 3.3 Drawer „Navigation“ unter `md`: Eintrag „Suchen“ oben (schließt den Drawer, öffnet die
  Sprungpalette), `BenutzerMenu` mit Einsatzfunktion im Fuß; zwischen `md` und `lg` ohne beide
  (D3). Test: Klick auf „Suchen“ öffnet die Palette und schließt den Drawer; das Benutzermenü aus
  dem Drawer zeigt „Abmelden“.
- [x] 3.4 `einsatz/AlarmZentrale.tsx`: gebündelt am Handy im Ruhezustand nur Symbol, Störung mit
  Wort, zugänglicher Name unverändert (D4). Tests: „Ton bereit“ nicht sichtbar, aber im Namen;
  „Ton blockiert“ sichtbar.

## 4. Ortspfad im Einsatz

- [ ] 4.1 Rahmenkontext „im Einsatzrahmen“ (`einsatz/EinsatzRahmenKontext.tsx`), gesetzt in
  `EinsatzLayout` auch während des Ladens; `EinsatzSeite` gibt dem Ortspfad dann die Klasse
  `lfh-ortspfad--einsatz` (D6). Test in `EinsatzSeite.test.tsx`: Klasse im Rahmen, nicht außerhalb.
- [ ] 4.2 `components/EinsatzSeite.css`: unter `md` nur der letzte verlinkte Eintrag ab dem dritten,
  mit „‹“ davor; sonst nichts (D6). `ortspfadAbMd` bleibt „gar nichts“.

## 5. e2e

- [ ] 5.1 `e2e/rahmen-stehen-bleiben.spec.ts`: 390 px klebt der Kopf (Gegenprobe umkehren), in
  allen drei Dichten einzeilig mit Menü, Name, Alarm, Verbindung und Uhr im Fenster; offline:
  Betriebszeile oben, Kopf darunter; Übung: Band unter dem Kopf, offline Betriebszeile · Kopf ·
  Band; Einsatzliste bei 390 px klebt einzeilig in `kompakt` und `komfortabel`.
- [ ] 5.2 `e2e/kopfzeile-schmal.spec.ts`: Wechsler hält bei 390 px in `handschuh` 72 px, kein Ziel
  überdeckt ein anderes (mit Uhr in der Zeile).
- [ ] 5.3 Specs, die das Benutzermenü oder die Suche am Handy über den Kopf öffnen
  (`benutzermenue`, `hilfe`, `fokus-verdeckung`, `gate1-ueberlauf`, `gate3-trefflaeche`,
  `trefflaeche-pruefflaechen`, `orientierung`, `lagekarte-smoke`): erst die Navigation öffnen,
  gemeinsamer Helfer; die betroffenen Specs grün.
- [ ] 5.4 `e2e/orientierung.spec.ts`: bei 390 px kein Ortspfad auf den Einsatzdaten, auf einer
  Personen-Detailseite nur „‹ Personen“, der zur Liste führt; bei 820 px der volle Pfad.

## 6. Regeln und Doku

- [ ] 6.1 `frontend/AGENTS.md`, „Stehenbleiben, gestuft“ und „Wer oben klebt“: Kopf in jeder
  Breite, Ränge, Betriebszeile darüber; Ortspfad im Einsatz unter `md`; Code-Kommentare mit
  „unter `md` rollt der Kopf“ nachziehen (`git grep`). Prettier grün.
- [ ] 6.2 ADR (nächste freie Nummer auf `alpha`): „Der Kopf klebt in jeder Breite, was oben klebt,
  stapelt sich nach Rang“, mit Prüfung; `scripts/check-adr*.sh` bzw. Gate grün.
- [ ] 6.3 Anwenderdoku „Einsatz-Oberfläche“: Handy-Kopf, Suche und Benutzermenü in der Navigation;
  betroffene Bilder neu erzeugt (Regeln in `docs/anwender/AGENTS.md`), Wächter grün.

## 7. Abschluss

- [ ] 7.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün; die e2e-Specs aus 5 lokal in
  Chromium grün.
- [ ] 7.2 Review vor dem PR (frischer Agent), bestätigte Befunde behandelt.

## Workflow follow-up

- `/opsx:archive ejt520so-handy-kopfleiste-fixiert` im selben Branch, dann PR gegen `alpha`.
- Kommentar an LLH-1726 zu D4 (Alarmzentrale am Handy) und an LLH-1727 zum Stapel (D2).
