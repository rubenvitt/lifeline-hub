---
id: ADR-0065
titel: Ein protokolliertes Detail lädt nie live, die offene Seite gleicht einen protokollfreien Stand ab
status: akzeptiert
datum: 2026-11-18
gilt_fuer:
  - frontend/src/pages/PersonenDetailPage.tsx
  - frontend/src/api/queryKeys.ts
  - src/routes/einsatz_person.rs
  - src/storno.rs
herleitung:
  - openspec/changes/archive/2026-11-18-qm3orral-storno-sperrt-offene-seiten/design.md
---

# ADR-0065: Ein protokolliertes Detail lädt nie live, die offene Seite gleicht einen protokollfreien Stand ab

## Regeln

- MUST NOT: Ein Detailabruf, der ins Zugriffsprotokoll schreibt (Person), wird weder über ein
  Live-Ereignis noch beim Fensterwechsel neu geladen; sein Key steht in `NICHT_LIVE_KEYS`, die
  Abfrage setzt `refetchOnWindowFocus: false` und keinen Retry.
- MUST: Was die offene Seite live wissen muss (Storno), liefert eine eigene Lese-Route ohne
  Protokoll, die nur diesen Stand trägt (`StornoStand` in `src/storno.rs`, Route
  `…/personen/{pid}/stand`), mit denselben Schranken wie das Detail.
- MUST: Ihr Key ist live über das Ereignis des Objekts (`personStand` in
  `EINSATZ_STREAM_ZIELE.person` und `EINSATZ_STREAM_EVENTS.person`); beim Öffnen trägt das
  Detail den Stand schon, ein eigener Abruf folgt erst auf ein Ereignis.
- SHOULD: Ein Detail ohne Protokoll (Tier, Schaden) ist einfach live; eine Stand-Route lohnt nur,
  wo das Detail nicht live sein darf oder die Liste den Datensatz nicht mehr führt
  (Betreuungsstelle).

## Prüfung

```sh
verlange '^  EINSATZ_KEYS\.person,$' 'frontend/src/api/queryKeys.ts'
verlange 'key\(einsatzKeys\.personStand\(e, pid\)\)' 'frontend/src/api/queryKeys.ts'
verlange 'refetchOnWindowFocus: false' 'frontend/src/pages/PersonenDetailPage.tsx'
verlange 'pub struct StornoStand' 'src/storno.rs'
verlange 'pub async fn stand\(' 'src/routes/einsatz_person.rs'
```

## Kontext

Jeder Abruf des Personendetails schreibt eine Zeile ins Zugriffsprotokoll. Live nachgeladen,
schriebe jeder offene Tab bei jeder Änderung eine Zeile; deshalb war das Detail nicht live, und
ein Storno an einem anderen Platz blieb auf der offenen Seite unbemerkt (LLH-1832). Der Fensterwechsel
lud das Detail trotzdem neu und schrieb dabei Zeilen ohne Zutun.

## Konsequenzen

Die offene Seite erfährt den Storno sofort, ohne das Protokoll zu verfälschen; je Ereignis und
offener Seite kostet das einen kleinen Abruf. Wer ein weiteres protokolliertes Detail baut,
braucht für jeden live nötigen Stand eine eigene Route statt den Detail-Key live zu schalten.
