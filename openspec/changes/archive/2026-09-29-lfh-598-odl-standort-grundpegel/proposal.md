# Proposal

## Why

Die ODL-Fachebene (LFH-78) bewertet jede Sonde über **absolute Bänder** (≤ 0,2 · ≤ 0,6 ·
darüber µSv/h). Das BfS empfiehlt dagegen eine **standortbezogene** Bewertung, und die
absoluten Bänder irren in beide Richtungen: Sonden mit hohem Grundpegel (Erzgebirge,
Bayerischer Wald) rutschen bei Regen auf „über natürlichem Bereich", während eine
Verdreifachung an einer Sonde mit 0,06 µSv/h Grundpegel (→ 0,18) unbemerkt bleibt.

**Die Prämisse des Tickets ist korrigiert, nicht übernommen.** Ticket, LFH-78-Design
(Entscheidung 3) und `docs/fachebenen-quellen.md` halten fest, ein Grundpegel sei nur über
1 676 Einzelabrufe zu haben — das gilt für den Layer `odlinfo_timeseries_odl_24h`. Gemessen
am 21.09.2026 liefert der Nachbar-Layer **`opendata:odlinfo_timeseries_odl_1h`** die
Stundenwerte **aller** Sonden der letzten sieben Tage (263 687 Werte, ältester
2026-09-14T15:00Z) und nimmt einen `CQL_FILTER`: 27 Zeitpunkte (4 je Tag) kommen in
**einem** Abruf, 42 600 Werte, 1 585 Sonden, 8,65 MB, ~10 s. Eine eigene Historie aus
Abrufen, die nur laufen, solange jemand die Ebene offen hat, ist damit nicht nötig.

## What Changes

- Das Backend berechnet je Sonde einen **Grundpegel** aus der BfS-Zeitreihe (unteres
  Quartil einer Stichprobe der letzten sieben Tage) — einmal täglich, im Hintergrund, in
  den bestehenden Fachebenen-Cache.
- Liegt für eine Sonde ein Grundpegel vor, richtet sich ihre Stufe nach dem **Faktor**
  aktueller Stundenwert / Grundpegel (≤ 1,5 × `normal` · ≤ 3 × `erhoeht` · darüber
  `stark_erhoeht`). Sonst gelten die bisherigen Bänder unverändert.
- Jedes Feature trägt, welche Grundlage seine Stufe hat (`bewertung`: `standort` /
  `absolut`), und im Standortfall Grundpegel, Faktor und Stand des Grundpegels.
- Ein Grundpegel steigt nicht in eine laufende Lage hinein mit: eine Neuberechnung, die ihn
  um 1,5 × oder mehr anheben würde, wird verworfen, der bisherige bleibt stehen.
- Der Inspector nennt Grundpegel, Faktor und die jeweils geltende Einteilung.
- Die **Beschriftungen** der Stufen werden grundlagenneutral („unauffällig" · „erhöht" ·
  „stark erhöht"); die bisherigen sprechen vom natürlichen Bereich und wären unter
  relativer Bewertung falsch. Die **Wire-Wörter** der Stufe bleiben unverändert und
  beidseitig gepinnt.
- `docs/fachebenen-quellen.md` korrigiert die überholte Aussage zur Zeitreihe.

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `lagekarte-fachebenen`: die Bewertungsstufe der ODL-Sonden wird standortbezogen, sobald
  ein Grundpegel vorliegt; Features tragen Grundlage, Grundpegel und Faktor; der
  Projekt-Einteilungs-Hinweis nennt die jeweils geltende Einteilung.

## Impact

- **Backend:** `src/karte/normalisierung.rs` (Grundpegel aus der Zeitreihe, Bewertung
  relativ/absolut), `src/karte/quellen.rs` (Hintergrund-Abruf der Zeitreihe mit eigenem
  Timeout und Abkühlung, Bewertung bei Auslieferung von `odl`), `src/karte/cache.rs`
  (Eintrag unter eigenem Schlüssel). Keine Migration, keine neue Route, kein neuer
  OpenAPI-Typ (Properties sind `HashMap<String, Value>`).
- **Frontend:** `api/fachebenen.ts` (Typ der Grundlage), `theme/statusFarben.ts`
  (Beschriftungen `odlStufe`), `pages/lagekarte/FachebenenInspector.tsx` (Grundpegel,
  Faktor, Hinweis je Grundlage) samt Tests.
- **Extern:** ein zusätzlicher BfS-Abruf von ~8,6 MB je Instanz und Tag (heute ~890 KB
  alle zehn Minuten, solange die Ebene offen ist).
- **Doku:** `docs/fachebenen-quellen.md`.
