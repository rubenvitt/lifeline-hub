# Entwürfe — Regeln

Gilt für `frontend/src/entwurf/`, `frontend/src/lageberichte/`, `pages/BefehlDetailPage.tsx`
und `pages/LageberichtDetailPage.tsx`, ergänzt `frontend/AGENTS.md`. Pfade relativ zu `frontend/src/`.

- **Verlustschutz ist ein Hook:** `entwurf/useEntwurfVerlustschutz.ts` (Riegel gegen
  Fremd-Refetch, Autosave 30 s + Blur, `beforeunload`); `pages/BefehlDetailPage.tsx` und
  `LageberichtDetailPage` rendern mit `key={<id>}`. Merker ist
  eigener State, **nicht** `form.isFieldsTouched()`. Riegel als Paar testen. Autosave ohne
  Erfolgs-Toast, sondern „zuletzt gespeichert HH:MM".
- Interne Navigation: `entwurf/EntwurfNavigationSchutz.tsx` (`useBlocker`, Data Router).
- **Ein Klick auf „Entwurf speichern" ist EIN PATCH:** einzige Pforte `speichereJetzt`,
  `gesichertRef` (Start `-1`), `speichertGerade` speist den Blocker, **nicht** `loading` am Knopf.
- Einstiegsfokus im ersten LEEREN Abschnitt (`entwurf/Einstiegsfokus.tsx`).
- Lagebericht: Abschnitte als Akkordeon (`lageberichte/AbschnittsAkkordeon.tsx`, `memo`, alle
  Props identitätsstabil; Gate ist der Render-Zähler im Test, `rerender` mit neuem Element).
  Tippmessung `e2e/lagebericht-tippen.spec.ts` (Deckel nur mit `PW_LATENZ=1`).
  Liste zeigt Kettenköpfe (`lageberichte/ketten.ts`), Zyklen verlieren keinen Bericht.
