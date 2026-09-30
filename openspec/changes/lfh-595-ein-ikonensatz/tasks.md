# Tasks

## 1. Vorbedingung: Abo und Zugang (Ruben)

- [ ] 1.1 Icons8-Abo abschließen und den SVG-Abruf freischalten (MCP-API oder persönlicher
  Schlüssel). Nachweis: Ein Abruf der Trage (Kennung `6581`, iOS 27 Outlined) liefert ein SVG
  statt „account does not have MCP API access“.
- [ ] 1.2 Lizenztext des Abos auf die Ablage der SVGs im Repo prüfen und die Grundlage (Abo,
  Datum, Fundstelle im Lizenztext) im Kopf von `scripts/ikonen/ikonen.json` vermerken. Nachweis:
  Vermerk steht, Ruben bestätigt.
- [ ] 1.3 An einem abgerufenen SVG feststellen, ob der Stil Füllflächen oder Striche liefert,
  und das Ergebnis in design.md unter „Open Questions“ als geklärt eintragen. Nachweis: Eintrag
  in design.md.

## 2. Werkzeug und Grundgerüst

- [ ] 2.1 `frontend/src/ikonen/IkonenRahmen.tsx` mit Typ `Ikone`/`IkonenPaar` und `index.ts`
  per TDD anlegen: `1em` als Vorgabe, `size`, `currentColor`, `aria-hidden`, `focusable=false`,
  Hülle `lfh-ikone` mit antds Ausrichtung. Nachweis: `IkonenRahmen.test.tsx` grün, Gegenprobe
  (Farbe fest verdrahtet → rot).
- [ ] 2.2 `scripts/ikonen/erzeuge-ikonen.mjs` schreiben: Register und Quellen einlesen,
  `erzeugt.generated.ts` und `quellen.sha256` schreiben. Das Ergebnis ist Prettier-fest und
  deterministisch. Nachweis: zwei Läufe hintereinander ohne Diff, `pnpm lint` und
  `check-fmt.sh` grün.
- [ ] 2.3 Abrufweg festhalten: Neue Quellen holt der Agent über den Icons8-MCP nach
  `scripts/ikonen/quellen/` (design.md D2, geändert 30.09.2026, kein eigenes Abrufskript). Der
  Kopf von `erzeuge-ikonen.mjs` beschreibt den Weg. Nachweis: Kopf und D2 stimmen überein.
- [ ] 2.4 `frontend/src/ikonen/ikonen.guard.test.ts` per TDD: (a) kein Import aus
  `@ant-design/icons`/`react-icons` außerhalb von `ikonen/`, Schuldmenge `OFFEN` = heutige
  74 Dateien, toter Eintrag rot; (b) Register ↔ Quellen ↔ Erzeugtes ↔ Stempel, keine
  unbenutzte Ikone, `eigen` trägt ihren Vermerk; (c) Emoji-Scan mit eigener Schuldmenge
  (`FachebenenInspector.tsx`, `FunkErreichbarkeit.tsx`, `Platzhalter.tsx`). Dateikopf nennt,
  was der Guard nicht sieht. Nachweis: Guard grün, Mutationsproben (neuer Fremdimport, Emoji in
  neuer Datei, SVG ohne Stempel) jeweils rot.

## 3. Stilprobe (Freigabe durch Ruben)

- [ ] 3.1 Probe-Ikonen ins Register und abrufen: die fünf Rail-Kategorien als Paar, Kopfleiste
  (Menü, Suche, Benutzer), Zeilen-Aktionsmenü (Mehr), Seitenkopf (Plus). Nachweis:
  Guard (b) grün.
- [ ] 3.2 `IconRail.tsx` auf `IkonenPaar` umstellen (gefüllt bei `aria-current`), dazu Kopfleiste,
  ein Zeilenmenü und einen Seitenkopf. `OFFEN` abtragen. Nachweis: `IconRail`-Test prüft
  gefüllt/umriss je Zustand, Gegenprobe rot. Bestehende Rail- und Kopfleisten-Tests grün.
- [ ] 3.3 Aufnahmen per Playwright: 390/1024/1440 px × Tag/Nacht × Dichte 30/48/72, Ikonen bei
  16 und 20 px, Kontrast der Ikonen gegen ihren Grund über `e2e/kontrast-kern.ts`. Ablage unter
  `openspec/changes/lfh-595-ein-ikonensatz/stilprobe/`. Nachweis: Aufnahmen liegen vor,
  Kontrastwerte stehen in `stilprobe/messung.md`.
- [ ] 3.4 **Checkpoint:** Ruben gibt den Stil frei oder zieht Plan B (design.md D1). Nachweis:
  Entscheidung mit Datum in design.md D8.

## 4. Zuordnungstabelle (Freigabe durch Ruben)

- [ ] 4.1 Alle übrigen rund 110 Ikonen des Bestands (46 antd, 69 Tabler, 5 Feather, abzüglich
  der Probe) einem Registernamen und einer Icons8-Kennung zuordnen, Ersatz und Eigenzeichnung
  kennzeichnen (u. a. `TbSitemap` → Hierarchy, `MinusCircleOutlined`, `TbHomeHeart` → eigen).
  Tabelle in `openspec/changes/lfh-595-ein-ikonensatz/zuordnung.md`. Nachweis: Jeder Import aus
  `OFFEN` hat eine Zeile (Abgleich per Skript).
- [ ] 4.2 **Checkpoint:** Ruben prüft die Ersatz- und Eigenzeilen. Nachweis: Freigabe vermerkt
  in `zuordnung.md`.
- [ ] 4.3 Ikonen abrufen, Notunterkunft als eigene Zeichnung im 50-px-Raster anlegen, erzeugen.
  Nachweis: Guard (b) grün, Eigenzeichnung in einer Aufnahme neben zwei Icons8-Ikonen gleicher
  Größe gezeigt.

## 5. Umstellung Navigation, Palette, Darstellung

- [ ] 5.1 `IconType` durch `Ikone` ersetzen in `modulRegistry.ts`, `command-palette/typen.ts`,
  `befehle.ts`, `BenutzerMenu.tsx`, `theme/darstellungOptionen.ts`,
  `pages/gefahren/GefahrenMatrix.tsx`, dazu die Ikonen in `einsatz/`, `command-palette/`,
  `theme/` und Kopfleiste. `ModulPanel.test.tsx` fragt das Schloss über den Namen bzw.
  `lfh-ikone` statt `.anticon-lock` ab. Nachweis: `OFFEN` um diese Dateien kleiner, Vitest der
  Bereiche grün, `tsc -b` grün.

## 6. Umstellung Lagekarte

- [ ] 6.1 `pages/lagekarte/*` (9 Dateien) und `karten/OfflineKartenVerwaltung.tsx` umstellen.
  Die Ladeikone dreht sich per CSS, unter `prefers-reduced-motion` nicht.
  Nachweis: `OFFEN` kleiner, Vitest grün, `e2e/lagekarte-smoke.spec.ts` und
  `lagekarte-touch.spec.ts` grün.
- [ ] 6.2 `AnsichtSwitcher.tsx`: Stern als Paar, das feste `#faad14` entfällt. Nachweis: Test
  prüft gefüllt für die Standardansicht und umriss sonst, kein Farbliteral mehr in der Datei.

## 7. Umstellung übrige Bereiche

- [ ] 7.1 `components/` (13) umstellen, `AmpelZelle.test.tsx` auf `lfh-ikone` umstellen.
  Nachweis: `OFFEN` kleiner, Vitest grün.
- [ ] 7.2 `etb/`, `auftraege/`, `meldungen/`, `chat/`, `erinnerung/`, `kraefte/`, `abloesung/`,
  `betreuung/`, `verpflegung/`, `lageberichte/`, `admin/` umstellen. Nachweis: `OFFEN` kleiner,
  Vitest grün.
- [ ] 7.3 Übrige `pages/` umstellen (`uhs`, `schaeden`, `lage-dashboard`, `fuehrung`,
  `einstellungen`, `einsatzabschnitte` und Einzelseiten). Nachweis: `OFFEN` ist leer, Guard (a)
  ohne Schuldmenge grün.

## 8. Emojis abtragen

- [ ] 8.1 `wetterIcon()` und NINA-Warnung in `FachebenenInspector.tsx` auf Ikonen umstellen
  (Titel als `ReactNode`). Nachweis: `FachebenenInspector.test.tsx` prüft die Ikone und das
  Fehlen des Emojis, `e2e/wetter-pegel.spec.ts` grün.
- [ ] 8.2 ☎ in `FunkErreichbarkeit.tsx` → Telefonikone. 🚧 in `Platzhalter.tsx` → Ikone oder
  entfällt, zusammen mit `App.test.tsx` und `einsatz/ModulStub.test.tsx` im selben Commit.
  Nachweis: Tests grün, Emoji-Schuldmenge leer, Mutationsprobe (Emoji zurück) rot.

## 9. Abschluss

- [ ] 9.1 `@ant-design/icons` und `react-icons` aus `frontend/package.json` entfernen
  (`pnpm remove`), Lockfile per pnpm. Nachweis: `pnpm build` grün, `check-deps.sh` grün,
  Bundlegröße vorher/nachher in `stilprobe/messung.md`.
- [ ] 9.2 CLAUDE.md fortschreiben: Regel „Ein Emoji ist keine Ikone“ durch den Ikonensatz
  ersetzen (Stil, Importort `ikonen/`, Lückenregel, Guard, Ausnahmen D7) und die Bestandsliste
  streichen. `docs/design/2026-09-21-neuentwurf/umsetzung.md` nennt den Satz. Nachweis: Diff
  der beiden Dateien, Verweise per `grep` geprüft.
- [ ] 9.3 Gesamtprüfung `./scripts/check-all.sh`, dazu `e2e/gate3-trefflaeche.spec.ts`,
  `e2e/hellmodus-kontrast.spec.ts`, `e2e/kraefte-kontrast.spec.ts`. Nachweis: alle Schritte
  grün.
- [ ] 9.4 `/opsx:archive` samt Spec-Sync (`openspec/specs/ikonensatz/`) vor dem PR (Entscheidung
  30.09.2026). Nachweis: `scripts/check-openspec-archiv.sh` grün.
