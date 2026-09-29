# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst der rote Test, dann der
Code. Vitest aus `frontend/` über `mise exec -- pnpm -C <abs>/frontend vitest run <datei>`.

## 1. Speicher je Benutzer mit Frist

- [x] 1.1 `einsatz/zuletztModule.test.ts` erweitern und rot sehen: Trennung je Benutzer
  (A schreibt, B liest leer), Frist (12 h + 1 min fällt heraus, 11 h 59 min bleibt, über den
  Parameter `jetzt`), erneute Wahl erneuert die Frist und entdoppelt, altes Format (String-Array
  unter dem neuen Schlüssel) sowie Fremdinhalt gelten als leer, Deckel 3
- [x] 1.2 `einsatz/zuletztModule.ts` auf D1 umbauen (`ZULETZT_FRIST_MS`, Schlüssel mit
  `benutzerId`, Einträge `{key, at}`). Den Dateikopf mit der Zugangstabelle (warum ja, warum
  nein) und dem Satz zu Frist und Benutzertrennung neu schreiben. Die Tests aus 1.1 sind grün.
- [x] 1.3 Aufrufer nachziehen: `EinsatzLayout.onModulKlick` und `useBefehle` (Lesen, Memo-Schlüssel,
  `merkeBesuch`) reichen `benutzer.id` durch, ohne Benutzer kein Speicher (D2). Die Kommentare
  „einziger Weg" (`EinsatzLayout.tsx`) und den Hinweis in `ModulPanel.tsx` berichtigen.
  `EinsatzLayout.test.tsx` (Panel-Klick merkt, Rail-Sprung merkt NICHT, Sprungmarke merkt nicht)
  sowie `befehle.test.ts`/`zuletztBefehle.test.ts` auf die neue Signatur umstellen und grün sehen.
- [x] 1.4 Test in `useBefehle.test.tsx` (dem Leser): ein anderer Benutzer im selben Browser sieht
  die Einträge nicht (Speicher von Benutzer A vorbelegt, Zuletzt-Gruppe für B ohne sie)

## 2. Schnellaktionen der Palette

- [x] 2.1 Test in `befehle.test.ts`: das Ausführen der Schnellaktion `aktion:etb` ruft
  `merkeModulBesuch('etb')` vor `navigate` (Reihenfolge wie beim bestehenden Modul-Test). Rot sehen,
  dann D4 in `befehle.ts` umsetzen und grün sehen.

## 3. Helfer `useModulWahl`

- [x] 3.1 `einsatz/useModulWahl.test.tsx`: `merkeZiel` mit Modulpfad samt Query merkt das Modul,
  ein Pfad ohne Modul (`/einsaetze`) merkt nichts, `waehle` merkt und navigiert, `linkFaenger`
  auf einem Kind eines `<a href>` merkt dessen Modul, ein Klick ohne Anker merkt nichts. Rot sehen,
  dann `einsatz/useModulWahl.ts` nach D3 bauen und grün sehen.

## 4. Führung · Überblick

- [x] 4.1 `UeberblickPage.test.tsx`: das Laden allein merkt nichts, danach merkt ein Klick auf die
  Kennzahl „Betroffene" `personen`, der Kopfknopf „Eintrag" `etb` und eine Leer-Aktion ihr Modul,
  die Brotkrume „Einsätze" nichts. Rot sehen.
- [x] 4.2 In `UeberblickPage.tsx` `linkFaenger` an der Seitenwurzel und `waehle` an den
  `navigate`-Knöpfen (Kopfknöpfe, `Zustandsfeld.leerAktion`) einsetzen. Die Tests aus 4.1 sind grün.

## 5. Lage-Dashboard

- [x] 5.1 `LageDashboardPage.test.tsx`: der Paneel-Link „Gefahren" merkt das Gefahren-Modul, eine
  Kennzahl mit Ziel merkt ihr Modul, das Laden allein merkt nichts. Rot sehen.
- [x] 5.2 In `LageDashboardPage.tsx` `linkFaenger` an der Seitenwurzel und `waehle` an den
  Paneel-Callbacks (`onGefahren`, `onPersonen`, `onAufnehmen`, `onEtb`, `onErfassen`) einsetzen.
  Die Tests aus 5.1 sind grün.

## 6. Abschluss

- [x] 6.1 `pnpm lint`, `tsc -b`, `check-fmt.sh` und die volle Vitest-Suite sind grün, geprüft
  per Lauf und Ausgabe
- [x] 6.2 Mutationsproben: (a) Rail-Sprung ruft `merkeModulBesuch` → der Rail-Test wird rot;
  (b) Fristfilter ausgebaut → der Fristtest wird rot; (c) Benutzer-ID
  aus dem Schlüssel entfernt → der Trennungstest wird rot; (d) `linkFaenger` an der
  Überblick-Wurzel entfernt → der Kennzahl-Test wird rot. Danach alles zurückgesetzt und grün.
- [ ] 6.3 ClickUp LFH-436: Entscheidung und Begründung als Kommentar (Verweis auf diesen Change),
  Abnahmekriterien abhaken
