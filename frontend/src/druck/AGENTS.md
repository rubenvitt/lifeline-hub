# Druck — Regeln

Gilt für `frontend/src/druck/`, `components/druck/` und jede Seite mit Druckwurzel, ergänzt
`frontend/AGENTS.md`. Pfade relativ zu `frontend/src/`.

**Gedruckt wird über den Browser, nie auf dem Server** (Herleitung
`openspec/changes/archive/2026-09-29-lfh-22-druck-export/design.md`, Grundsatz aus
`docs/superpowers/specs/2026-06-02-lage-lageberichte-design.md`).

- **Eine Druckwurzel je Seite** (`data-lfh="druckwurzel"`); Mechanik nur in `druck/druck.css`
  (global in `main.tsx`, nur unter `@media print`; `@page` ist die gepinnte Ausnahme; Rest `display: none`, **nie** `visibility: hidden` + `position: absolute`). `*Print.css` tragen
  nur Eigenheiten. Nachweis `druck/druck.test.ts`, `e2e/druck-fluss.spec.ts`; Firefox/Safari per
  Hand.
- **Druckkopf** `components/druck/Druckkopf.tsx` steht in der Wurzel. Druckknöpfe sind `DruckKnopf`
  (`useDrucken`, wartet auf Organisation und Logo, höchstens `LOGO_FRIST_MS`; bereit = Daten da,
  nicht „letzter Abruf gelungen"). **Kein
  `window.print()` direkt**, nie aus dem Passiv-Effekt. `components/druck/useDruckModus.ts`
  schaltet, was CSS nicht kann (`beforeprint`/`afterprint`).
- Ein Editor druckt nie seine `<textarea>` (`MarkdownEditor` `druckfassung`).
- **Tabellen im Druck** (LFH-548): Neutralisierer der `KatalogTabelle` stehen in `druck.css` für
  jede Druckwurzel, beide Hüllen (`.ant-table-body`/`-content`), antds Messzeile aus, Zellen
  brechen um. Nachweis immer mit ausgelöstem `beforeprint` (`e2e/funkplan.spec.ts`), nicht nur
  `emulateMedia`: erst ohne `sticky` ragte eine Baumtabelle über A4.
- **„In Lagebericht übernehmen“ ist EIN Aufruf** (LFH-548): `POST …/lageberichte`/`…/befehle`
  mit `abschnitte` als Startinhalt (`AnlegenBody<A>`, Schlüssel wie beim PATCH, doppelt → 400),
  kein POST + PATCH; Fehler an die Seite.
- **ETB-Druck** (`pages/EtbDruckPage.tsx`, `etb/EtbDruckTabelle.tsx`): schlichtes `<table>` nach
  `lfd_nr`, Vollabruf `etb/druckAbruf.ts` über die bestehende Liste, Drucken erst komplett;
  `einsatzKeys.etbDruck` nicht live, `refetchOnMount: 'always'`.
- **Org-Branding** (`PATCH /api/organisation`, `…/organisation/logo`, PNG/JPEG ≤ 1 MiB,
  Virenscan) liegt außerhalb der Schwärzung (`schwaerzung_registry.rs`).
