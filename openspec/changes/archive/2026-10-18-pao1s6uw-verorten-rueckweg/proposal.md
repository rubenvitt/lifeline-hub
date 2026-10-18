# Proposal

## Why

Rubens App-Durchgang vom 10.10.2026 (Zunder LLH-1018, Subtask LLH-1125): „Wer eine Person
verortet, will auf der Lagekarte auch die Betroffenen-Ebene sehen. Nach dem Platzieren sieht man
sonst nicht, dass platziert wurde.“ Heute ist die Ebene „Betroffene“ per Vorgabe aus. Der neue
Marker bleibt unsichtbar, die Karte meldet nur „Objekt verortet“, und wer zur Person zurückwill,
muss sie in der Liste suchen. Eine Fehlplatzierung fällt so nicht auf.

## What Changes

- **Ebene im Platzier-Modus eingeblendet:** Läuft ein Verortungsauftrag für eine Person, zeichnet
  die Karte die Ebene „Betroffene“, bis die Seite verlassen wird. Das gilt auch danach, solange
  man auf der Karte bleibt. Der Schalter und die gespeicherte Kartenansicht ändern sich dadurch
  nicht. Die Modulsperre „Personen“ gilt weiter. Für Schaden, Betreuungsstelle und
  Bereitstellungsraum gilt dasselbe für ihre Ebene.
- **Rückmeldung am Ort:** Nach dem Tipp ist der neue Marker hervorgehoben. Das Fuß-Band unter
  `lg` bzw. die Leiste ab `lg` zeigt „R-005 verortet“ mit der Primäraktion „Zurück zu R-005“ und
  dem Nebenweg „Auf der Karte bleiben“ (Option A, Entscheidung Ruben 18.10.). Neu verorten läuft
  genauso.
- **Rückweg ohne freie URL:** Der Auftrag trägt `&zurueck=1`, und das Ziel ergibt sich aus Typ und
  Kennung: Person → Detail, Schaden → Detail, Betreuungsstelle → Betreuungsseite, BR → Detail.
  Tier (LFH-1263) kommt ohne Umbau dazu. Ein Pfad steht nie im Parameter, es gibt also keinen
  offenen Weiterleiter.
- Die UHS hat keinen äußeren Verortungseinstieg (sie wird über „Nicht verortet“ verortet) und
  bekommt deshalb keinen Rückweg. Das ist als begründete Ausnahme festgehalten.

## Capabilities

### New Capabilities
- `lagekarte-verortungsauftrag`: Verortungsauftrag von außen. Das umfasst die eingeblendete Ebene
  des Typs, die Rückmeldung am Ort und den Rückweg zum Datensatz.

### Modified Capabilities
- `lagekarte-betroffene`: „Vorgabe aus“ bekommt das Szenario „Platzier-Modus zeigt die Ebene,
  ohne den Schalter zu ändern“.

## Impact

- Frontend:
  - `pages/LagekartePage.tsx`, `pages/lagekarte/useKartenInteraktion.ts` (Erfolg und Hervorhebung),
    `pages/lagekarte/useKartenAnsicht.ts` bzw. `leistenWahl.ts` (abgeleiteter Ebenen-Vorrang),
    `PlatzierSteuerung.tsx` und die Sidebar (Zustand „verortet“).
  - `routing/deeplinks.ts` (`zurueck`, Zielpfad aus Typ und Kennung).
  - Einstiege: `pages/PersonenDetailPage.tsx`, `SchadenDaten.tsx`, `BetreuungPage.tsx`,
    `AufKarteVerorten.tsx`.
- e2e: `lagekarte-betroffene.spec.ts`, `lagekarte-touch.spec.ts`.
- Regeln: `frontend/src/pages/lagekarte/AGENTS.md`, `frontend/src/personen/AGENTS.md`
  (Verortungsauftrag).
- Doku: Kapitel `lagekarte.md` und `betroffene.md`.
- Kein Backend.
- Zunder: https://zunder.rubeen.dev/#/aufgabe/pao1s6uwo35v38iozrz3tx4n
