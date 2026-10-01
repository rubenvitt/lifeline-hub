# Proposal

## Why

Das Kennzahlenband setzt seine Zellen ins Fugenraster der Gestaltungssprache: `gap: 1px` auf
`linie`. Wo die Zellen klickbar sind (Lage-Dashboard „Lage in Zahlen“, Führung · Überblick),
stehen zwei Bedienziele damit nur 1 px auseinander. Die Bedien-Leitlinie verlangt im
Handschuh-Betrieb mindestens 16 px zwischen Bedienzielen (Kriterium 2, abgeleitet aus
MIL-STD-1472F Fig. 24) und im Touch-Betrieb (`komfortabel`) mindestens 8 px (Material).
Die Prüfliste zu LFH-606 führt das als offenen Punkt O4; das Verdikt „Handschuh-Modus“ des
Lage-Dashboards bleibt so lange offen. Wer mit Handschuh auf „Betroffene“ tippt, landet heute
mit einem leichten Versatz auf „Kräfte“.

## What Changes

- **Trefffläche innen, Fuge bleibt:** Eine klickbare Kennzahl-Zelle bleibt als Fläche im
  1-px-Fugenraster stehen. Ihr Link ist nicht mehr die ganze Zelle, sondern ein Block innerhalb
  der Zelle, der zu jedem Zellrand einen **Einzug** hält. Der Einzug folgt der Dichtestufe:
  `kompakt` 0 px, `komfortabel` 4 px, `handschuh` 8 px. Zwei benachbarte Ziele stehen damit
  1 / 9 / 17 px auseinander.
- **Optik unverändert:** Die Polsterung des Inhalts verringert sich um den Einzug, Zahl,
  Augenbraue und Notiz stehen an derselben Stelle wie heute. Die Zellhöhe wächst nicht. In
  `kompakt` ist die Zelle pixelgleich mit dem Bestand.
- **Hover und Fokus zeigen die Trefffläche:** Die Hover-Tönung (`flaeche3`) und der
  Fokusrahmen liegen auf dem Link-Block, nicht auf der ganzen Zelle. Im Handschuh-Betrieb sieht
  man damit, wo ein Tippen wirkt.
- **Eskalationskante bleibt am Zellrand:** Die 3- bzw. 6-px-Innenkante für `achtung`/`alarm`
  sitzt weiter am Zellrand und liegt über der Hover-Tönung, auch in `kompakt`.
- **Nachweis:** Gate 3 (`e2e/gate3-trefflaeche.spec.ts`) misst auf dem Lage-Dashboard den
  kleinsten Abstand zwischen den sechs Kennzahl-Links: ≥ 16 px in `handschuh`, ≥ 8 px in
  `komfortabel`. Unit-Tests pinnen Einzug und Polsterung mit Literalen.
- **Regel:** Die Bausteinregel „Kennzahlenband“ in `frontend/AGENTS.md` nennt den Einzug, die
  Prüfliste LFH-606 vermerkt O4 als eingelöst.

## Nicht-Ziele

- Die Fuge selbst wird nicht dichteabhängig; das Fugenraster bleibt in jeder Stufe 1 px.
- Andere Bausteine im Fugenraster mit mehreren Bedienzielen (`Segmentleiste`, die
  Kartenknöpfe in `pages/lagekarte/KartenUeberlagerung.tsx`) sind nicht Teil dieser Change;
  sie bekommen einen eigenen Nachzug auf dem Entwicklungsboard.
- Nicht klickbare Kennzahlen (Statusband, Meldungen, Bereitstellungsraum, Verpflegung)
  bleiben unverändert: ohne Ziel gibt es keinen Abstand zu halten.

## Capabilities

### New Capabilities

_Keine._

### Modified Capabilities

- `einsatztauglichkeit-layout`: neue Anforderung „Abstand zwischen klickbaren Kennzahlen“ —
  benachbarte Kennzahl-Ziele im Band halten in `komfortabel` ≥ 8 px und in `handschuh`
  ≥ 16 px Abstand, ohne dass das Fugenraster breiter wird.

## Impact

- **Frontend:** `frontend/src/components/instrument/Kennzahl.tsx` (Zellaufbau mit Ziel, neue
  reine Funktion für den Einzug, `kennzahlStil`), `frontend/src/theme/sprache.css`
  (Hover/Fokus wandern auf den Link-Block), `Kennzahl.test.tsx`.
- **Verbraucher ohne Änderung im Quelltext:** `pages/lage-dashboard/LageDashboardPage.tsx`,
  `pages/fuehrung/UeberblickPage.tsx`. Prüfanker bleiben: der Link trägt weiter
  `data-lfh="kennzahl"` und `data-ton`; e2e-Selektoren (`a[data-lfh="kennzahl"]`) und
  Kontrastmessungen laufen unverändert.
- **e2e:** `frontend/e2e/gate3-trefflaeche.spec.ts` (Abstandsmessung im Lage-Dashboard-Block).
- **Regeln und Doku:** `frontend/AGENTS.md` (Bausteinregel Kennzahlenband),
  `docs/superpowers/specs/2026-09-22-lfh-606-pruefliste.md` (O4 eingelöst).
- Kein Backend, keine API, keine Migration.
