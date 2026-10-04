# Proposal

## Why

Die Deeplinks `?meldung=<id>` und `?auftrag=<id>` markieren die angesprungene Kommunikationskarte
mit `boxShadow: 0 0 0 2px bedien` (`frontend/src/kommunikation/KommKarte.tsx`), einem
umlaufenden Ring in Bedienfarbe. Das ist die Form des Fokusrings
(`outline: 2px solid var(--lfh-bedien)`): eine angesprungene Karte sieht fokussiert aus. Die
Spec `deeplink-hervorhebung` verbietet genau diese Form („MUST NOT als umlaufender Rahmen in
Bedienfarbe“), galt bisher aber nur für Datensicht und Zeitachse. Die Kommunikationskarten
blieben bei der Umstellung auf zwei Kanäle bewusst außen vor und tragen den Ring als einzige
Stelle weiter.

## What Changes

- Die angesprungene Kommunikationskarte (Meldung, Auftrag) trägt dieselbe Form wie Datensicht
  und Zeitachse: Fläche `bedienFlaeche` und je eine 2-px-Linie oben und unten in `bedien`
  (`inset box-shadow`). Der Ring entfällt.
- **Gefahr gewinnt:** eine alarmierte Karte behält ihre `alarmFlaeche` und ihre Alarmkante;
  die Markierung legt nur die Linien darüber. Die linke Statuskante (Alarm, Unbearbeitet)
  bleibt in jedem Fall unverändert.
- Die Spec `deeplink-hervorhebung` gilt künftig auch für Kommunikationskarten, mit einem
  eigenen Szenario für die alarmierte Karte.
- Browsernachweis über den vorhandenen Messkern (`schattenKontrast`): Linienform, Kontrast,
  Rollen, in beiden Modi, für eine gewöhnliche und eine alarmierte Karte.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `deeplink-hervorhebung`: Geltung auf Kommunikationskarten erweitert; neue Anforderung
  „Gefahr gewinnt“ für alarmierte Karten.

## Impact

- `frontend/src/kommunikation/KommKarte.tsx` (Stil der Hervorhebung), Test daneben.
- `frontend/e2e/deeplink-hervorhebung-kontrast.spec.ts` (neuer Fall Kommunikationskarte).
- `openspec/specs/deeplink-hervorhebung/spec.md` über Archiv-Sync.
- Konsumenten (`meldungen/MeldungKarte.tsx`, `auftraege/AuftragKarte.tsx`, Listen, Seiten)
  ändern sich nicht; `data-hervorgehoben` bleibt als Prüfattribut.
- Keine neue Farbrolle, kein Backend, keine Abhängigkeit.
