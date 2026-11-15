# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/f24jkokrx6buea76ole4zb18 (LLH-1734, Teil von LLH-1715)

## Why

Die UI/UX-Analyse vom 12.11.2026 (LLH-1714) fand im Einsatzrahmen fünf kleine Reibungen. Zusammen
kosten sie Orientierung. Die Rail führt immer ins erste Modul einer Kategorie, und ein zugeklapptes
Modulpanel klappt beim nächsten Rail-Klick wieder auf. Das Offline-Band schiebt den Rail-Fuß aus dem
Fenster. Die Modulbeschreibungen sind in Panel und Handy-Drawer fast immer abgeschnitten. Das
Feldgerät zeigt das Ende der Kopplung als nackte Zahl („bis 131757“).

## What Changes

- **Rail-Gedächtnis:** Ein Klick auf eine Kategorie führt in das Modul dieser Kategorie, in dem die
  Person in diesem Einsatz zuletzt war. Gemerkt wird je Person und Einsatz für eine Schicht (12 h),
  und jede Ankunft zählt. Ohne Eintrag oder wenn das gemerkte Modul gesperrt bzw. ausgeblendet ist,
  bleibt es beim ersten freigegebenen Modul. „Zuletzt besucht“ der Sprungpalette bleibt unberührt.
- **Panel-Wahl hält beim Rail-Sprung:** Wer das Modulpanel zugeklappt hat, behält es zu, auch wenn
  er in eine andere Kategorie springt. Das stellt die Regel „eine gemerkte Wahl gilt auf jeder
  Breite“ wieder her. Ohne eigene Wahl öffnet ein Rail-Sprung das Panel wie bisher.
- **Beschreibungen in zwei Zeilen:** Die Modulbeschreibung unter dem Modulnamen bricht in Panel und
  Drawer auf höchstens zwei Zeilen um, erst danach endet sie mit „…“.
- **Handy-Drawer breiter:** Der Navigations-Drawer ist höchstens 360 px breit, höchstens aber die
  Fensterbreite minus 48 px, statt fest 280 px.
- **Rail-Fuß im Fenster:** Steht die Betriebszeile ab `md` über dem Kopf, bleibt der Fuß der Rail
  („Menü“, „Einst.“) trotzdem im Fenster.
- **Kopplungsende als Restzeit:** Die Kopfzeile des Feldgeräts zeigt „Kopplung noch 5 h“ bzw.
  „Kopplung noch 40 min“, unter einer Stunde hervorgehoben. Die genaue Endzeit steht im Hinweistext
  und im zugänglichen Namen.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `seiten-orientierung`: neue Anforderung, dass der Rail-Sprung ins zuletzt besuchte Modul der
  Kategorie führt.
- `navigation-zuletzt-besucht`: Die Anforderung „Ankünfte zeichnen nicht auf“ spricht nicht mehr
  vom Sprung „in das erste Modul“, sondern vom Rail-Sprung allgemein.
- `einsatztauglichkeit-layout`: neue Anforderungen dazu, dass die Panel-Wahl beim Rail-Sprung hält,
  dass der Rail-Fuß bei sichtbarer Betriebszeile im Fenster bleibt und wie breit der
  Navigations-Drawer am Handy ist.
- `modul-benennung`: Die Modulbeschreibung bricht auf zwei Zeilen um, statt einzeilig zu kürzen.
- `feldgeraet-bedienung`: Das Ende der Kopplung erscheint als Restzeit mit Wort, die Endzeit im
  Hinweistext.

## Impact

- Nur Frontend: `frontend/src/einsatz/` (`EinsatzLayout.tsx`, `IconRail.tsx`, `ModulPanel.tsx`,
  ein neuer Merker neben `zuletztModule.ts`), `frontend/src/theme/tokens.ts`
  (`navDrawerBreite`), `frontend/src/live/LiveStatusBanner.tsx` bzw. `components/rahmenOben.ts`,
  `frontend/src/geraet/GeraeteKopf.tsx`.
- Browserspeicher: ein neuer Schlüssel je Person und Einsatz (`lfh:nav:kategorie-modul:…`). Er
  bekommt einen Eintrag in `GERAETESPEICHER` mit der Entscheidung „bleibt“, wie die übrigen
  `lfh:nav:`-Schlüssel.
- Anwenderdoku: `docs/anwender/kapitel/einsatz-oberflaeche.md` („Ein Modul öffnen“) und
  `docs/anwender/kapitel/geraet-bedienen.md` („Kopfzeile lesen“), dazu die Bilder dieser beiden
  Kapitel.
- Überschneidung: LLH-1727 (Rahmen fest), LLH-1732 (Rail-Einträge als Links) und LLH-1733
  (Sprungmarken) ändern dieselben Dateien. Der Diff bleibt deshalb klein und ohne Umbau.
