# Tasks

## 1. Bausteinwahl als Regel

- [x] 1.1 Abschnitt `## Frontend — Bausteinwahl (wann nehme ich was)` in `frontend/AGENTS.md` hinter der Gestaltungssprache anlegen (design.md D1): Tabelle Bedarf → Baustein → Karte für Darstellen, Rahmen, Rückmeldung und Eingabe. Wo eine Regel schon anderswo steht, verweist die Zeile darauf. `prettier --check frontend/AGENTS.md` ist grün.
- [x] 1.2 Test zuerst: Der Abdeckungswächter in `frontend/src/designSystem.test.ts` (D5) liest die Kartennamen der Bausteinwahl und vergleicht sie in beide Richtungen mit `PREVIEWS`, ohne `Cover`. Unit-Tests an Texten decken eine fehlende Karte und einen fehlenden Verweis ab. Gegen den Baum ist der Test rot, solange die Karten aus Gruppe 3 fehlen.

## 2. README als Nachschlagewerk

- [x] 2.1 Test zuerst: `ohneVerweise()` in `readme.ts` nach D2, mit Unit-Tests in `designSystem.test.ts` an echten Sätzen aus `frontend/AGENTS.md`: reine Verweisklammer, gemischte Klammer, Kopf mit Datum, mehrere Glieder, Satz bleibt ganz. Die Tests sind grün.
- [x] 2.2 `buildReadme` setzt die Bausteinwahl an die erste Stelle, wendet `ohneVerweise` an und bricht bei einer übrigen Ticketnummer mit der Fundstelle ab. Ein Test prüft die Reihenfolge und den Abbruch.
- [x] 2.3 `skip` der Gestaltungssprache nach dem Kriterium aus D3 erweitern und den Kommentar mit dem Kriterium an `skip` schreiben. Kartenbezogene Regeln kommen per `ruleHead`/`moreDoc` bzw. dem neuen Feld `regeln` an ihre Karten. Belegt durch die erzeugte README: ohne `LFH-`/`LLH-` (der Generator bricht sonst ab), im Diff durchgesehen. Der Richtwert von 350 Zeilen aus D3 ist nicht erreicht: 575 Zeilen, davon 48 für die neue Bausteinwahl. Farbachsen (110) und Dichte (114) bleiben nach D3 ganz, weil sie die Gestaltung entscheiden.

## 3. Neue Karten

- [x] 3.1 Karte `Knopf` (D4) in `PREVIEWS`, Höhe in Chromium gemessen. Der Generator läuft ohne Fehler.
- [x] 3.2 Karte `Eingabefeld` (D4), Höhe gemessen.
- [x] 3.3 Karte `Dialog` mit inline gerendertem `ErfassungsModal` (D4), Höhe gemessen.
- [x] 3.4 Karte `Zustaende` mit SeitenZustand und PaneelZustand (D4), Höhe gemessen.
- [x] 3.5 Karte `Hinweis` (D4), Höhe gemessen.
- [x] 3.6 Karte `Seitenkopf` mit `EinsatzSeite` (D4), Höhe gemessen.
- [x] 3.7 Karte `Formularlayout` mit Formularpaneel und Speicherleiste (D4), Höhe gemessen.
- [x] 3.8 Karte `Tabelle` zur vollständigen Tabelle erweitern (D4), Höhe neu gemessen.
- [x] 3.9 Karte `Navigation` nach der Bedingung aus D4: nicht gebaut, weil die Spalten ihre Höhe aus dem Fenster nehmen (`100dvh`, `useFitToWindow`, `useVorlauf`) und die Vorschau den Einsatzrahmen nachbauen müsste. Folgeaufgabe LLH-1939; die Bausteinwahl nennt keine Navigationskarte.
- [x] 3.10 Jede neue Karte als Bild in Nacht und Tag ansehen: Baustein erkennbar, nichts abgeschnitten, kein Scrollen. Die Bilder für den PR ablegen.

## 4. Erzeugen, Spec, ADR

- [x] 4.1 `mise exec -- pnpm -C frontend design-system` laufen lassen und das Erzeugte committen. `designSystem.guard.test.ts` und der Abdeckungswächter aus 1.2 sind grün.
- [x] 4.2 ADR „Die Bausteinwahl steht als Regel in frontend/AGENTS.md; die README des Design Systems ist ein Nachschlagewerk ohne Historie“ anlegen. Die Nummer ist die nächste freie nach der ADR von m113c8ln, `gilt_fuer` ist `frontend/scripts/design-system/**`, die Prüfung nutzt `verlange` auf den Abschnittskopf in `frontend/AGENTS.md`. Der ADR-Wächter ist grün.
- [ ] 4.3 `./scripts/check-all.sh --geaendert --ohne-e2e` ist grün.

## Workflow follow-up

- Review vor dem PR über den ganzen Branch (Orchestrator, Phase 4).
- `/opsx:archive v127ps65-design-system-nachschlagewerk` vor dem PR im selben Branch.
- Nach dem Merge das Design System neu veröffentlichen.
