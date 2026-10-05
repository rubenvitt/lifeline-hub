# Proposal

## Why

Die ETB-Volltextsuche trifft nur ganze Wörter: „Deich“ findet „Deichbruch gemeldet“ nicht,
„Funk“ findet „Funkgerät“ nicht. Bei deutschen Komposita fällt das im Einsatz sofort auf, und die
Bezugswahl im Dokument-Dialog fängt es nur für die jüngsten 100 Einträge clientseitig ab.

## What Changes

- Die ETB-Volltextsuche trifft **Wortanfänge**: jedes eingegebene Wort passt auf jedes Wort im
  Eintrag, das mit ihm beginnt. Mehrere Wörter bleiben UND-verknüpft.
- Das gilt gleichermaßen für die Liste und beide Zählungen (Kopfzahl „n Treffer“ und Zählung je
  Typ), also auf der ETB-Seite, im ETB-Textzweig der Sprungpalette und in der Bezugswahl.
- Eingaben ohne Buchstaben oder Ziffern bleiben ohne Filter, wie bisher.
- Die Bezugswahl behält ihren Fensterfilter (er deckt Wortteile und Teilnummern ab und schützt
  während der Entprellung); nur die Begründung im Code wird nachgezogen.
- Keine Migration, kein neuer Index, keine API-Änderung.

## Capabilities

### New Capabilities

- `etb-volltextsuche`: Was die Volltextsuche im Einsatztagebuch trifft (Wortanfänge, UND über
  Wörter, durchsuchte Felder, Umgang mit Sonderzeichen).

### Modified Capabilities

(keine — `etb-zaehler` verlangt schon, dass die Zählung exakt der Liste folgt; das bleibt so.)

## Impact

- Backend: `fts_query` in `src/etb/repo.rs` samt Tests.
- Frontend: Kommentar in `frontend/src/dokumente/bezugswahl.ts`, Hinweis in
  `frontend/src/command-palette/useDatensaetze.ts` prüfen.
- Treffermengen werden größer (gewollt); bestehende Suchen mit ganzen Wörtern finden weiterhin
  alles, was sie bisher fanden.
