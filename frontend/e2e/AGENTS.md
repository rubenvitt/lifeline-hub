# e2e — Regeln

Gilt für `frontend/e2e/`, ergänzt `frontend/AGENTS.md`. Pfade relativ zu `frontend/`.

- **`toBeVisible()` ist kein Beleg für Klickbarkeit** (LFH-355) — klicken. Ein Test, der eine
  Überdeckung umgeht, testet den Nutzerzustand nicht.
- **Ein Layout-Gate misst jeden rollenabhängigen Zustand auch nicht-privilegiert** (LFH-435):
  Beobachter, Org-Führungskraft bzw. Führungspersonal über `e2e/rollen-kern.ts` (Seeding als
  Admin, Wechsel im selben Kontext). Der Rollenzweig ist VOR der Messung Vorbedingung
  (Hinweis steht, Aktion gesperrt oder abwesend), die Mutationsprobe macht nur den
  Nicht-Admin rot. Freistellungen in Gate 1 nennen die Rolle. Inventar:
  `openspec/changes/archive/2026-09-30-lfh-435-e2e-gates-nicht-privilegiert/pruefliste.md`.
  **Die Modulsperre per Override ist eine eigene Achse** (LFH-820): der Admin ist nie gesperrt,
  deshalb sät der Admin die Sperre per Einsatz-Override (`benoetigte_rolle: 'admin'`, nie
  `sichtbar: false`, keine Org-Vorgabe) und der Beobachter misst; Vorbedingung „gesperrte Zeile
  bzw. ‚—‘ mit Grund steht“. Träger `nav-schmal`, `lage-dashboard-schmal`; Inventar:
  `openspec/changes/lfh-820-layout-gates-modulsperre-override/pruefliste.md`.
- **e2e wartet nie auf `networkidle`** (LFH-385): der SSE-Strom der Einsatzrouten lässt das Netz
  nie ruhen (parallel rot, `--workers=1` grün). Gewartet wird auf einen Inhaltsanker; Riegel
  `no-restricted-syntax` für `e2e/**` in `frontend/eslint.config.js`.
- e2e ist selbsttragend, braucht aber das Debug-Binary; Schritt 7 baut bei Bedarf den Prod-Bundle
  (`prod_bundle_bereitstellen`; Service Worker für `e2e/lagekarte-offline-precache.spec.ts`,
  ausgeliefert vom e2e-Backend über `src/static_files.rs`).
- **Kontrast misst eingeschwungen** (LFH-702): jede Messung in `e2e/kontrast-kern.ts` (`pruefe`,
  `kontrast`, `randKontrast`) wartet zuerst die endlichen Animationen an Element und Vorfahren ab;
  ein Übergang braucht keine eigene Wartezeit, ein Wert unter dem Boden ist in jedem Lauf rot.
  Einen Zustand, den erst JavaScript setzt (antds Zeilen-Hover: `td.ant-table-cell-row-hover`),
  sichert der Test vor der Messung als Vorbedingung zu.
