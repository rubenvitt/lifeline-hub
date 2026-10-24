# Proposal

## Why

LLH-1061 hat die Zeitdarstellung (taktisch oder „Datum und Uhrzeit“) durch Anzeigen, Druck und
Systemtexte gezogen. An einigen Stellen blieb die Zeit trotzdem immer taktisch, weil sie am
Formatkern vorbeilief. Der Wächter `zeitDarstellung.guard` fand sie nicht, denn sie nutzten
`formatiere()` oder eigene Helfer statt `.format()`. Die Spec `zeiteingabe` hält das für die Uhrzeit
ohne Datum noch fest („Angezeigt wird sie taktisch“). Das widerspricht den drei Rollen der Spec
`zeitdarstellung`.

Zunder: https://zunder.rubeen.dev/#/aufgabe/cww644zjnn5systrntk0o945 (LLH-1437, Unteraufgabe von
LLH-1022)

## What Changes

- Vorgeschlagene Titel folgen der Zeitdarstellung: der neue Lagevortrag, auch aus der Lagekarte
  („Als Anlage an … → Neuer Lagevortrag“).
- Die Ereigniszeit im Erfassungs-Chip des ETB folgt der Zeitdarstellung.
- Die Uhrzeiten im Verpflegungsplan und die Wechselzeiten der Schichtmodelle (Stammdaten,
  Einsatz-Einstellungen, Ablösung) erscheinen in der Rolle „Uhrzeit“. Eingabefelder bleiben
  taktisch.
- Neue Kernfunktion `uhrzeitOhneDatum` für Wanduhrzeiten ohne Tag, ohne Zonenrechnung.
- Verpflegungsplan und Schichtmodelle liegen außerhalb eines Einsatzes und bekommen den
  `OrgAnzeigeProvider`, damit Organisation und Gerätewahl dort überhaupt wirken.
- Der Wächter fängt jetzt auch `formatiere(…)` mit Zeit-Token außerhalb von `anzeige/`.
  `useZeitEingabe().formatiere` entfällt, die Funktion hatte keinen Nutzer mehr.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `zeiteingabe`: Requirement „Uhrzeit ohne Datum“. Die Anzeige folgt der Rolle „Uhrzeit“ der
  Zeitdarstellung statt immer taktisch; neues Szenario „Anzeige folgt der Zeitdarstellung“.

## Impact

- Frontend: `anzeige/zeitDarstellung.ts` und sein Wächter, `lageberichte/uebersicht.ts`,
  `LageberichtePage.tsx`, `pages/lagekarte/LageplanAnlageDialog.tsx`, `etb/MetaChip.tsx`,
  `stammdaten/VerpflegungsplanTab.tsx`, `SchichtmodelleTab.tsx`, `abloesung/dauer.ts`,
  `AbloesungPage.tsx`, `EinsatzAbloesung.tsx`.
- Regeln: `frontend/AGENTS.md` (Zeiteingabe, Zeitdarstellung), `frontend/src/kraefte/AGENTS.md`.
- Doku: Anwenderkapitel Stammdaten und Lageberichte, Architektur Kapitel 11 (R20). Bilder bleiben
  gültig, sie zeigen die taktische Vorgabe.
- Kein Backend, keine Migration, kein Typ-Codegen.
