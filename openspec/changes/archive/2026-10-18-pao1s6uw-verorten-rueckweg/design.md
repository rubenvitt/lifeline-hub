# Design

## Context

- **Auftrag:** Der Verortungsauftrag kommt per `lagekartePfad(…, { platzieren: { typ, id } })`
  als `?platzieren=<typ>:<id>`. `parsePlatzierenAuftrag` (`routing/deeplinks.ts`) kennt `schaden`,
  `uhs`, `person`, `betreuungsstelle` und `bereitstellungsraum`.
- **Karte:** `LagekartePage` startet den Modus und räumt den Parameter. Der Modus-Reducer sitzt in
  `pages/lagekarte/useKartenInteraktion.ts`. Nach Erfolg zeigt `verortenMutation` den Toast
  „Objekt verortet“ und beendet den Modus.
- **Ebene:** „Betroffene“ ist per Vorgabe aus (`useKartenAnsicht.ts`, `person: false`), und
  Personenmarker zeichnet die Karte nur bei `layer.person`.
- **Einstiege von außen:** Personen-Detail, Schaden (`SchadenDaten.tsx`), Betreuungsstelle
  (`BetreuungPage.tsx`) und BR (`AufKarteVerorten.tsx`). Die UHS wird nur über „Nicht verortet“
  verortet.
- **Gerät:** Am Gerät ist der Verorten-Link ausgeblendet (`darf('fremde-module')`).
- **Kollisionen:** Kreis mit Radius (LFH-1183) und Tier verorten (LFH-1263) sind nicht gelandet.

## Goals / Non-Goals

**Goals:** Das Verortete ist sichtbar. Der Rückweg kostet einen Tipp und ist sicher, also ohne
offenen Weiterleiter.

**Non-Goals:**
- eine Mini-Karte im Detail (Option C, verworfen)
- automatischer Rücksprung (Option B, verworfen: der Punkt wäre ohne Lagekontext)
- Tier-Verorten selbst

## Decisions

1. **Ebenen-Vorrang abgeleitet, nie gespeichert.** `useKartenInteraktion` führt
   `verortungsTyp: PlatzierenZielTyp | null`. Es wird beim Start eines äußeren Auftrags gesetzt und
   bleibt bis zum Verlassen der Seite (Unmount) stehen. `LagekartePage` bildet daraus die
   effektiven Ebenen: `layerEffektiv = { ...layer, [ebeneZu(typ)]: true }`. Gespeichert und
   angezeigt im Schalter wird weiter `layer`, gezeichnet wird `layerEffektiv`. Das ist dasselbe
   Muster wie `leisteSichtbar`. Die Modulsperre bleibt vorgeschaltet: Ohne
   `personenZugriff === 'frei'` gibt es keinen Personenmodus und keine Marker.
2. **Zustand „verortet“ im Reducer.** Nach Erfolg setzt der Reducer
   `{ art: 'verortet', typ, id, kennung, zurueck: boolean }`, statt den Modus nur zu beenden. Der
   Toast entfällt.
   - Unter `lg` zeigt `PlatzierSteuerung` das Band „<Kennung> verortet“ mit genau zwei Knöpfen:
     „Zurück zu <Kennung>“ (primär, nur bei `zurueck`) und „Auf der Karte bleiben“.
   - Ab `lg` zeigt die Sidebar dasselbe.
   - Der Marker wird über die vorhandene Hervorhebung gewählt (Deeplink-Hervorhebung, Spec
     `deeplink-hervorhebung`).
3. **Rückweg aus Typ und Kennung.**
   - `deeplinks.ts` bekommt `?zurueck=1` (parsen: nur genau `1` zählt) und
     `rueckwegPfad(einsatzPfade, typ, id)`. Die Zuordnung ist ein exhaustiver `Record`: Person →
     `personDetailPfad`, Schaden → Schadendetail, Betreuungsstelle → Betreuungsseite mit
     Hervorhebung, BR → BR-Detail.
   - `uhs` hat keinen äußeren Einstieg und deshalb `null` mit Begründung im Kommentar.
   - Ein neuer Typ wie `tier` bricht den Typcheck.
   - Die Einstiege setzen `zurueck: true`.
   - Verworfen: `?zurueck=<pfad>`. Das wäre ein offener Weiterleiter.
4. **Kennung für die Rückmeldung.** Sie kommt aus dem Objekt, das die Karte ohnehin lädt (Person:
   Registriernummer aus der Personenliste der Ebene, Schaden: `schadenRegistrierAnzeige` usw.).
   Fehlt sie, steht „Objekt verortet“, und der Rückweg heißt „Zurück“.
5. **Tests.** Der Reducer und `rueckwegPfad` bekommen Vitest. e2e: Ebene aus → verorten → Marker
   sichtbar → Ansicht unverändert (Ansichts-PUT fehlt) → „Zurück zu R-…“ öffnet das Detail mit
   Koordinate; bei 390 px genau ein Knopf je Handlung.

## Risks / Trade-offs

- [Die Ebene bleibt nach dem Verorten an, obwohl der Schalter aus ist] → Das ist gewollt, damit
  die Lage sichtbar bleibt. Die Schalterzeile zeigt den Vorrang mit dem Zusatz „eingeblendet“, und
  beim Verlassen der Seite endet er.
- [Konflikt mit späteren Kartenmodi (LFH-1183)] → Der neue Zustand ist eine eigene Art im
  Reducer. Wer später landet, hängt sich daran an.
