# Plan: Chat und Infotelefon — Seitenfenster in beide Richtungen (LLH-1886)

Entwurf: [`docs/superpowers/specs/2026-11-22-se7ytm9j-chat-infotelefon-seitenfenster-design.md`](../specs/2026-11-22-se7ytm9j-chat-infotelefon-seitenfenster-design.md)
(freigegeben 22.11.2026) · Zunder: https://zunder.rubeen.dev/#/aufgabe/se7ytm9j3545m41rao0xi8a9 ·
Ausführung: `executing-plans` im Main-Loop (Plan kurz, Aufgaben eng verzahnt), jede Aufgabe per TDD.

## Aufgabe 1 — Backend Chat: `after_id` (D1)

- [x] Test (`tests/chat.rs`): 5 Nachrichten; `?after_id=<2.>&limit=2` liefert die 3. und 4.,
      absteigend; `before_id` und `after_id` zugleich → 422.
- [x] `NachrichtenParams.after_id`, `NachrichtFilter.after_id`; Handler weist beide zugleich ab.
- [x] `repo::abfrage`: `id > after_id ORDER BY id ASC`, danach umdrehen.

## Aufgabe 2 — Backend Infotelefon: `nach_zeit` + `nach_id` (D1)

- [x] Test (`tests/stab_infotelefon.rs`, `parameter_der_liste`): halber `nach`-Cursor → 422,
      `vor` und `nach` zugleich → 422.
- [x] Test (`src/infotelefon/repo/tests.rs`): Seite über einem Cursor bei gleichem Eingang ordnet
      über die Kennung, absteigend geliefert, direkt über dem Cursor.
- [x] `kommunikation::parse_fenster` mit Richtung `Vor`/`Nach` (ZeitCursor), `parse_page` bleibt.
- [x] `infotelefon::repo::list_page` liest die Richtung; Route nimmt `nach_zeit`/`nach_id`.

## Aufgabe 3 — Frontend: Helfer `components/fensterBeideRichtungen.ts` (D2)

- [x] Tests nach `etb/seitenfenster.test.ts`: Kopf, `aelter`, `neuer` voll/kurz/leer, beide
      Cursor-Arten (Zahl, Eingang+Kennung).
- [x] Helfer mit Cursor-Adapter (`cursor`, `einschliessendAelter`, `einschliessendNeuer`), Konstante
      `FENSTER_MAX_SEITEN = 5`, `fensterOptionen(…)` für `useInfiniteQuery`, `seitenLimit` (eine
      mehr nach oben, Design-Doc D2).

## Aufgabe 4 — Chat (D3)

- [x] API: `listeNachrichten(einsatzId, kanalId, param)` mit `before_id`/`after_id`.
- [x] `ChatPage`: Fenster-Optionen, „Neuere laden“ unten, `useKopfBeimVerlassen`, Gelesen nur mit
      Kopf, eigenes Senden aus tiefem Fenster → `zumKopf` und ans Ende.
- [x] `NachrichtenStrom`: `kopfImFenster` — ohne Kopf kein Sprung ans Ende und keine Pille.
- [x] Tests: Gelesen ohne Kopf nicht, mit Kopf schon; Strom ohne Kopf springt nicht.

## Aufgabe 5 — Infotelefon (D4)

- [ ] API: `loadAnrufe` mit `nach`.
- [ ] Schleuse über Seitenparameter: `infotelefon/zufluss.ts` bekommt die Buchführung je
      Seitenschlüssel (`seitenSchluessel`, `nachgeladeneIds`), Tests für „vorn fällt eine Seite
      weg“ und „Neuere laden bei eingefrorener Schleuse“.
- [ ] `InfotelefonPage`: Fenster-Optionen, „Neuere laden“, `kopfImFenster` an
      `useFunkprotokollLauf`, Erfassen und „anzeigen“ → `zumKopf`, `useKopfBeimVerlassen`.

## Aufgabe 6 — Regeln und Doku (D5)

- [ ] `frontend/src/infotelefon/AGENTS.md` „Fenster und Zählung“, Kommentar in
      `components/listenFenster.ts`.
- [ ] `docs/anwender/kapitel/chat.md`, `docs/anwender/kapitel/infotelefon.md`.

## Aufgabe 7 — Abschluss

- [ ] `./scripts/check-all.sh --geaendert --ohne-e2e` grün (Ergebnis im PR unter „Geprüft“).
- [ ] Review nach Ermessen (Anlass: Backend und Frontend mit geänderter Schnittstelle).
- [ ] Bilder, PR gegen `alpha`, Folgeaufgabe „ETB auf den Helfer umstellen“.
