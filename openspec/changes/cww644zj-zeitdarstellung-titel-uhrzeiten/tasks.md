# Tasks

## 1. Formatkern und Stellen — LLH-1437 (`cww644zj`)

- [ ] 1.1 `uhrzeitOhneDatum` in `anzeige/zeitDarstellung.ts` (D1) mit Vitest für beide Darstellungen. Erst rot sehen, dann umsetzen, grün.
- [ ] 1.2 Titelvorschlag: `titelVorschlag(vorlage, jetzt, konv)` in der Rolle „Uhrzeit“ (D3); `LageberichtePage.tsx` reicht `konventionen` durch, `LageplanAnlageDialog.tsx` ruft `titelVorschlag` auf. Vitest „Datum und Uhrzeit“ zeigt `14:30`, erst rot.
- [ ] 1.3 `etb/MetaChip.tsx`: Ereigniszeit über `zeitKurz`. Vitest erst rot, dann grün.
- [ ] 1.4 `stammdaten/VerpflegungsplanTab.tsx` über `uhrzeitOhneDatum`, Tab in `OrgAnzeigeProvider`; `taktischeUhrzeitAus` bleibt für das Eingabefeld. Vitest erst rot.
- [ ] 1.5 `abloesung/dauer.ts` trennen (D2), `formatRegel`/`formatRegelKurz` mit `konv`, `SchichtmodelleTab.tsx` in `OrgAnzeigeProvider`; Vitest für Anzeige und Feldtext.
- [ ] 1.6 Wächter erweitern (D4) mit Selbsttest; `useZeitEingabe().formatiere` entfernen.
- [ ] 1.7 Regeln in `frontend/AGENTS.md` und `frontend/src/kraefte/AGENTS.md`, Anwenderkapitel Stammdaten und Lageberichte, Architektur Kapitel 11 (R20); `scripts/check-architektur.sh` und Anwenderdoku-Wächter grün.
- [ ] 1.8 Vitest der Ordner etb, abloesung, stammdaten, lageberichte und anzeige sowie aller Zeit-Wächter grün; `tsc`, eslint, Prettier sauber.

## 2. Abschluss

- [ ] 2.1 `./scripts/check-all.sh` grün (CI des PRs).
- [ ] 2.2 Change archivieren (`/opsx:archive`) im selben Branch, vor dem PR.
