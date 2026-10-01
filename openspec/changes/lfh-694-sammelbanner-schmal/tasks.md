# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development` (erst der rote Test). Pfade
relativ zu `frontend/src/`. Kommandos laufen über `mise exec -- pnpm -C frontend …`.

## 1. Kurzform im Baustein (`components/instrument/Sammelbanner.tsx`, D1–D3)

- [x] 1.1 `sammelbannerKurz(anzahl, umgeordnet)` exportieren: „1 neu“, „12 neu“, sonst
  „umgeordnet“, und die Zahl gewinnt, wenn beides gilt. Prüfen: Fälle in
  `components/instrument/Sammelbanner.test.tsx`.
- [x] 1.2 Prop `kurz?: string`: Mit `kurz` und `aktion` rendert das Banner einen einzigen
  antd-`Button` (Ikone `aria-hidden`, Kurzform Mono mit `tabular-nums`, zugänglicher Name
  „<kurz> anzeigen“). Der vollständige Satz (`children`) steht in einem nur für Hilfstechnik
  sichtbaren `span` im `role="status"`. Ohne `kurz` bleibt die Form unverändert. Prüfen:
  Vitest zeigt den Knopfnamen „1 neu anzeigen“, den Klick auf `onKlick`, den vollen Satz im
  Status und genau einen Knopf. Der bisherige Test der langen Form bleibt grün.
- [x] 1.3 Dateikopf von `Sammelbanner.tsx` um die Kurzform ergänzen (wann, warum ein Knopf,
  Verweis auf diese Change). Prüfen: Prettier und ESLint grün.

## 2. Ablösung (`pages/AbloesungPage.tsx`, D1, D2)

- [x] 2.1 `useViewport().istSchmal` setzt `kurz={sammelbannerKurz(zurueckgehalten.length,
  umgeordnet)}` am Banner der Werkzeugzeile. Den Kopfkommentar um den Handschirm ergänzen
  (Kurzform statt Satz, Messverweis). Prüfen: `pages/AbloesungPage.test.tsx` zeigt mit
  schmalem Viewport (Muster der vorhandenen `useViewport`-Tests) „1 neu“ und den Knopf
  „1 neu anzeigen“, breit den vollen Satz. Der vorhandene Zufluss-Test bleibt grün.

## 3. Verpflegung (`pages/VerpflegungPage.tsx`, D1, D2, D4)

- [x] 3.1 Kurzform wie 2.1 (`sammelbannerKurz(zurueckgehalten.length, umgeordnet)`) und unter
  `md` die Segmentbeschriftung „aktuell (n)“ statt „laufend & anstehend (n)“. Den Kopfkommentar
  nachziehen. Prüfen: `pages/VerpflegungPage.test.tsx` zeigt schmal die Beschriftung
  „aktuell (n)“, „1 neu“ und den Knopf „1 neu anzeigen“, breit die bisherigen Wortlaute. Die
  vorhandenen Tests unter „Live-Zufluss“ bleiben grün.

## 4. Nachweis im Browser (`e2e/gate1-ueberlauf.spec.ts`, D5)

- [x] 4.1 Test „Gate 1 · mobil (390 px): stehendes Sammelbanner in Ablösung und Verpflegung“ je
  Dichtestufe: 12 gezeigte Einträge säen, ohne Banner messen, fremd anlegen, dann
  `scrollWidth ≤ 390`, Knopfkante ≤ 390, „1 neu“ ungekürzt, Zeilenhöhe und oberste Karte
  ± 0,5 px, Klick gibt frei. Die Rollenfreistellung (keine Rollenverzweigung in der
  Werkzeugzeile) steht im Testkopf. Prüfen: Der Test ist auf dem Stand vor 1–3 rot
  (Mutationsprobe: `kurz` an einer Seite weglassen macht `handschuh` rot) und danach grün.
- [x] 4.2 `e2e/abloesung-zufluss.spec.ts` läuft unverändert grün (Name „anzeigen“ trifft auch
  die Kurzform). Prüfen: Lauf dieses Specs mit allen drei Kontexten.

## 5. Abschluss

- [x] 5.1 Sichtprüfung bei 390 px in `handschuh` (Tag und Nacht) für beide Module mit
  stehendem Banner, dazu 1366 px `kompakt` unverändert. Prüfen: Aufnahmen im Arbeitsverzeichnis
  der Prüfung, Befund in der PR-Beschreibung. Erledigt 01.10.2026: acht Aufnahmen (beide Module,
  390 px `handschuh` Tag/Nacht, 390 px `komfortabel` Nacht, 1366 px `kompakt` Nacht), kein
  Befund.
- [ ] 5.2 `./scripts/check-all.sh` grün. Prüfen: Lauf ohne Bündelauswahl bzw. die CI dieses PRs.
