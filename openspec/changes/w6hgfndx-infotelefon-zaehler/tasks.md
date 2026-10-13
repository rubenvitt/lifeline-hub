# Tasks

Arbeitsweise je Aufgabe: `superpowers:test-driven-development` (erst der rote Test, dann der
Code). Backend-Tests mit `cargo test --test <datei>` bzw. `cargo test --lib <pfad>`,
Frontend-Gates aus dem Frontend-Ordner über `mise exec -- pnpm …` (ohne mise: `pnpm` aus
`/opt/node22`).

## 1. Backend: Seitenparameter und Filter (D1, D2)

- [ ] 1.1 `kommunikation::seite(vor_zeit, vor_id, limit)` aus `phase_und_seite` herauslösen (halber Cursor → 422, `limit` auf `[1, SEITE_MAX]` geklemmt, Vorgabe `SEITE_STANDARD`); eigene Unit-Tests dafür, die bestehenden Tests von `phase_und_seite` unverändert grün
- [ ] 1.2 `src/infotelefon/repo.rs`: `AnrufFilter { status }`, `filter_bedingung` auf `QueryBuilder` und `liste_seite(pool, einsatz_id, &filter, &seite)` mit Cursor `(eingang_at, id)`; `repo::liste` entfällt. Repo-Tests in `repo/tests.rs`: Ordnung jüngster Eingang zuerst, Gleichstand über die Kennung, Blättern ohne Lücke und ohne Doppel über gleichen Eingang, Filter `offen`/`erledigt`, fremder Einsatz nicht enthalten; grün

## 2. Backend: Zählung und Einzelabruf (D1, D3, D4)

- [ ] 2.1 `InfotelefonZaehler` und `InfotelefonAnliegenZaehler` in `src/infotelefon/mod.rs` mit `aus_zeilen` (vollständiger `match`, unbekanntes Anliegen → 500) und `repo::zaehlen(pool, einsatz_id, &filter)` über dieselbe `filter_bedingung`; Unit-Tests: alle sieben Anliegen auch bei 0, Summe = `gesamt`, `offen` zählt nur `offen`, Filter wirkt; grün
- [ ] 2.2 Routen in `src/routes/infotelefon.rs` und `src/routes/mod.rs`: `GET …/stab/infotelefon` mit `status`, `vor_zeit`, `vor_id`, `limit` (unbekannter Status → 400, halber Cursor → 422); `GET …/stab/infotelefon/zaehler` mit `status` (Seitenparameter ignoriert); `GET …/stab/infotelefon/{aid}` (404 fremd). Alle mit `EinsatzLesezugriff<Stab>`. `tests/stab_infotelefon.rs` auf die Seitenantwort umgestellt, ergänzt um Einzelabruf (200, 404 fremder Einsatz) und 403 ohne Stab-Freigabe für Zählung und Einzelabruf; grün
- [ ] 2.3 `tests/infotelefon_zaehler.rs` nach dem Muster von `tests/etb_zaehler.rs`: Parität Liste ↔ Zählung für jeden Filter (ohne, `offen`, `erledigt`) über vollständiges Blättern mit kleinem `limit` und gleichem Eingang; 2 000 Anrufe (direkt über den Pool eingefügt) → `gesamt: 2000`, erste Seite 100 Anrufe; Seitenparameter am Zähler ignoriert; `status=unsinn` → 400 an Liste und Zählung; anderer Einsatz zählt nicht mit; grün
- [ ] 2.4 `src/api_doc.rs` um die neuen Schemata und Pfade ergänzt; `scripts/check-typ-codegen.sh`, `frontend/src/api/openapi.json` und `types.generated.ts` mitcommittet

## 3. Frontend: API und Query-Keys (D5)

- [ ] 3.1 `api/infotelefon.ts`: `ANRUFE_SEITE = 100`, `ladeAnrufe(einsatzId, { status?, vor?, limit? })` mit `mitParametern`, `anrufCursor(a)`, `ladeAnrufZaehler(einsatzId)`, `ladeAnruf(einsatzId, id)`; Typ `InfotelefonZaehler` in `api/types.ts` aus dem generierten Schema. Tests auf die erzeugten URLs; grün
- [ ] 3.2 `api/queryKeys.ts`: Sub-Keys `infotelefonListe(e, sicht)`, `infotelefonZaehler(e)`, `infotelefonAnruf(e, id)` unter dem Prefix `infotelefon(e)`; `queryKeys.test.ts` belegt, dass das Ereignis `infotelefon` alle drei trifft und der Prefix nicht in `LAGEBILD_OFFLINE` steht; Guard-Tests grün

## 4. Frontend: Protokollseite (D4, D6)

- [ ] 4.1 `infotelefon/zufluss.ts`: `erweitere(gefroren, anrufe)` nimmt Kennungen auf, Wassermarke bleibt; `zufluss.test.ts`: ein nachgetragener Anruf aus einer älteren Seite wird nach `erweitere` nicht zurückgehalten, ein neuer fremder Anruf weiter schon; grün
- [ ] 4.2 `pages/InfotelefonPage.tsx`: Liste über `useInfiniteQuery` je Sicht mit Entdopplung und „Ältere laden“ im Listencontainer (ruft `erweitere` mit der neuen Seite); Kennzahlen, Meta unter `md` und „Nach Anliegen“ aus `infotelefonZaehler`, `KennzahlZustand` aus der Zählung; Deeplink auf einen nicht geladenen Anruf über `infotelefonAnruf`, angehängt am Ende. `InfotelefonPage.test.tsx`: Zählung 2 000 bei 100 geladenen → Kennzahl 2 000 und Aufgliederung aus der Zählung; Zählung scheitert → Fehlerzustand statt Zahl, keine Aufgliederung; „Ältere laden“ hängt die nächste Seite an (Cursor im Aufruf); „offene Rückrufe“ ruft die Liste mit `status=offen`; Deeplink auf einen alten Anruf zeigt ihn hervorgehoben; bestehende Tests (Zufluss, `?neu=1`, unter `md`) auf die neue API umgestellt und grün

## 5. Frontend: Medienlage und Presseseite (D7)

- [ ] 5.1 `stab/medienlage.ts`: `anrufe: Quelle<InfotelefonZaehler>`, Teil aus der Zählung ohne eigenes Zählen; `medienlage.test.ts` umgestellt, „—“ mit Grund bei fehlender Zählung bleibt; grün
- [ ] 5.2 `stab/medienlageQuelle.ts` und `pages/PressePage.tsx` laden `infotelefonZaehler` statt der Anrufliste; `MedienlageUebernahme.test.tsx`, `PressePage.test.tsx` und `PressePage.blaettern.test.tsx` umgestellt (kein Abruf der Anrufliste mehr); grün

## 6. Regeln, Doku, Gates

- [ ] 6.1 `frontend/src/stab/AGENTS.md`: Absatz zum Informationstelefon auf Fenster, Zählung, Einzelabruf und `erweitere` umgestellt, Verweis auf diese Change; `docs/anwender/kapitel/presse-infotelefon.md` um „Ältere laden“ ergänzt; `anwenderdoku.guard.test.ts` grün
- [ ] 6.2 `./scripts/check-all.sh` grün (bzw. die in der Sitzung lauffähigen Bündel; was nicht lief, steht im PR)

## Workflow follow-up

- `/opsx:archive w6hgfndx-infotelefon-zaehler` im selben Branch vor dem PR (Spec-Sync nach
  `openspec/specs/stab-infotelefon/` und `openspec/specs/stab-medienlage/`, Verweise nachziehen)
- PR gegen `alpha` mit Zeile `Zunder: https://zunder.rubeen.dev/#/aufgabe/w6hgfndxtzblkyjsxlea2yjr`
