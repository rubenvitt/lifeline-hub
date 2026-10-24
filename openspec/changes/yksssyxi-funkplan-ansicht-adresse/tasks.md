# Tasks

## 1. Darstellung in der Adresse — LLH-1432 (`yksssyxi`)

- [ ] 1.1 Vitest in `FunkplanPage.test.tsx` „Zurück aus einem Teilnehmer“ (MemoryRouter-Verlauf: Sprechgruppen, Filter DMO, Teilnehmer öffnen, Zurück → derselbe Reiter mit Filter; der Reiterwechsel ist `REPLACE`). Erst rot sehen, dann D1 in `FunkplanPage.tsx` umsetzen, grün; Mutationsprobe ohne `replace` macht ihn rot.
- [ ] 1.2 Bestehende Tests, die „räumt den Parameter“ prüften, auf „Parameter bleibt“ umstellen (Szenarien „Sichtvorgabe aus einem Link“ beider Specs); Szenario „Unbrauchbarer Wert“ bleibt grün.
- [ ] 1.3 Kommentare in `routing/deeplinks.ts` (`FunkplanAnsicht`) und `fernmeldewesen/FernmeldewesenReiter.tsx` nachziehen; Regelzeile in `frontend/src/stab/AGENTS.md` (Abschnitt Fernmeldewesen).
- [ ] 1.4 e2e: `fernmeldewesen.spec.ts` erwartet für die Altadresse `…/fernmeldewesen?ansicht=skizze`; Kommentar in `fernmeldeskizze.spec.ts`. Lauf belegt die CI.
- [ ] 1.5 Vitest der Funkplan-, Reiter-, Deeplink-, Routing-, Paletten-, Stab- und Listengedächtnis-Tests sowie der Guard-Tests grün; `tsc`, Prettier, eslint sauber.

## 2. Abschluss

- [ ] 2.1 `./scripts/check-all.sh` grün (CI des PRs).
- [ ] 2.2 Change archivieren (`/opsx:archive`) im selben Branch, vor dem PR.
