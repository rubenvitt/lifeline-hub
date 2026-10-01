# Design

## Context

Motivation und Umfang stehen in `proposal.md`, die Anforderungen in
`specs/lage-wetter-pegel/spec.md`. Maßgeblich ist der Bestand auf `origin/alpha` `f25a52e`
vom 01.10.2026.

**Wetter (LFH-633).** `GET /api/einsaetze/{id}/wetter` liefert die Warnungen der Warnzelle des
Einsatzorts. Der Server-Cache arbeitet SWR mit TTL 5 min je Organisation und Ort. Das Frontend
fragt mit `wetterAbfrage(einsatzId)` (`api/wetter.ts`, Key `einsatzKeys.wetter`, alle 5 min)
nach, bisher nur auf der Modulseite. `wetter/wetterStand.ts` liefert zwei reine Funktionen:
`teilStand` (aktuell, veraltet, unbekannt, kein_ort) und `teileWarnungen` (gilt jetzt gegen
angekündigt, Abgelaufenes fällt heraus). Eine Warnung trägt auf dem Draht `stufe`, `ereignis`,
`ueberschrift`, `beginn`, `ende` und `ausgegeben`, aber **keine** CAP-Kennung.

**Modulzähler.** `einsatz/useModulZaehler.ts` vereint Server-Zähler und Browser-Zähler
(`dokumente`, `abloesung`, `betreuung`). Ein Browser-Zähler wird über `darfZaehlerZeigen`
gegated und lädt nur bei sichtbarem und freiem Modul. Das Modulpanel zeigt Zähler neutral
(`ModulPanel.tsx`: „er zählt offene Vorgänge, er alarmiert nicht“).

**AlarmZentrale.** `einsatz/AlarmZentrale.tsx` lauscht auf Fenster-Ereignisse
(`lfh:sofortmeldung`, `lfh:erinnerung-alarm`, `lfh:abloesung-alarm`). Diese löst
`live/useEinsatzLiveStream.ts` aus, und dort spielt auch der Ton: `alarm` oder `dezent`. Alle
Hinweise laufen über **einen** Budgetweg, `zeigeAlarmToast`. Höchstens drei sind sichtbar,
der Rest landet in einer Zusammenfassung. Die Hinweise schließen nicht selbst, und bei
verdecktem Tab kommt eine Desktop-Meldung.

**Überblick.** `naechsteMarken` (`pages/fuehrung/ueberblickDaten.ts`) sammelt Fristen aus fünf
Quellen, höchstens 6 Marken. Die Pegelprognose ist das Vorbild für eine Erwartung, die keine
Frist ist: Verstrichen fällt sie heraus, sie wird nie „überfällig“. `UeberblickPage.tsx` kennt
mit `wetterPegelFrei` schon, ob das Modul sichtbar und frei ist.

## Goals / Non-Goals

**Goals:**

- Eine Unwetterwarnung für den Einsatzort fällt auf, ohne dass jemand die Modulseite öffnet.
- Das Alarmbudget bleibt gewahrt: kein Doppelalarm, kein Blinken, das Wort als zweiter Kanal.
- Zähler, Hinweis und Marke stützen sich auf **eine** Ableitung („Unwetter“ = schwer oder
  extrem, gültig, verwertbarer Stand), keine zweite Wahrheit neben `wetterStand.ts`.

**Non-Goals:**

- Kein Server-Poller, kein Live-Ereignis, kein System-ETB-Eintrag, keine Migration. Die
  Variante „Server“ ist am Checkpoint verworfen worden, siehe D2.
- Keine Warnsperre des Helligkeitsreglers aus DWD-Unwetter. `einsatz/aktiveWarnung.ts` nennt
  das ausdrücklich als Folgeticket. Mit der Abfrage im Rahmen wird es billig, bleibt aber eine
  eigene Entscheidung über die Sperre.
- Keine Änderung an der DWD-Kartenebene oder an der Modulseite.
- Kein Zähler und kein Hinweis für die Stufen gering und mäßig.

## Decisions

### D1 Alarmbudget: drei Kanäle, gestaffelt nach Aufdringlichkeit

Die Entscheidung zum Alarmbudget, gemessen an EEMUA 191 / ISA-18.2 (1–2 Alarme je 10 min und
Bediener, ein Alarm verlangt eine Handlung):

| Kanal | Art | Budget | Wann |
|---|---|---|---|
| Modulzähler | passiv, neutral | 0 | solange eine Unwetterwarnung gilt oder angekündigt ist |
| Überblick-Marke | passiv, zeitbezogen | 0 | von der Ankündigung bis zum Beginn |
| Hinweis in der AlarmZentrale | aktiv, quittierbar, dezenter Ton | höchstens 1 Platz je Einsatz | einmal je neuem Paar aus Ereignis und Stufe, nur bei Eskalation (D4) |

**Begründung.**

- Eine Unwetterwarnung (schwer oder extrem) verlangt eine Handlung der Führung: Eigenschutz,
  Arbeiten im Freien prüfen, Kräfte warnen. Damit erfüllt sie die Bedingung eines Alarms.
  Gering und mäßig verlangen das in der Regel nicht. Sie kämen in einer längeren Lage täglich
  und würden das Budget fluten. Deshalb bleiben sie auf der Modulseite.
- Die erwartete Rate liegt weit unter dem Budget. Der DWD warnt eine Gemeinde-Warnzelle selten
  mit Unwetter, und auch in einer Unwetterlage sind es einige wenige je Tag. Aktualisierungen
  (alle paar Stunden neu ausgegeben, verlängert) alarmieren nach D3/D4 nicht noch einmal.
- **Dezenter Ton, nicht `alarm`.** Die Warnung ist Lageinformation, oft mit Vorlauf, und keine
  verstrichene Frist. Der zweifache Alarmton bleibt Sofortmeldung, überfälligem Auftrag und
  fälliger Ablösung vorbehalten. Damit behält er seine Bedeutung („jetzt sofort“). Die
  Stummschaltung der AlarmZentrale gilt wie für jeden Ton.
- **Ein Platz.** Ein neuer Unwetterhinweis ersetzt einen noch sichtbaren älteren (D6). Damit
  kann das Wetter nie zwei der drei Plätze belegen und keine Sofortmeldung in die
  Zusammenfassung drängen.
- **Zweiter Kanal.** Der Hinweis trägt im Titel die Stufenbezeichnung als Wort
  („Unwetterwarnung“ / „Extremes Unwetter“, aus der Vertragskarte `dwdWarnstufe`), die Marke
  trägt Wort und Zeitabstand. Nichts davon blinkt, antds Notification blinkt nicht, und es
  kommt keine Animation hinzu.

### D2 Erkennung im Browser statt Server-Poller

Am Checkpoint entschieden (01.10.2026). Der Rahmen nutzt die vorhandene Abfrage, und ein Hook
im Layout erkennt „neu“ und meldet es per Fenster-Ereignis an die AlarmZentrale.

Die Alternative war ein Server-Poller für aktive Einsätze mit Ort: gemeldete Warnungen in der
DB, ein Live-Ereignis, optional ein System-ETB-Eintrag. Er wäre robuster gewesen (eine
Erkennung für alle, dokumentiert), aber deutlich größer: Scheduler, externe Abrufe ohne
anfragende Person, Migration, Org-Grenze im Poller. Verworfen für jetzt. Der Weg bleibt offen,
falls die Führung den Eingang einer Unwetterwarnung im ETB belegt haben will.

**Preis:** Die Erkennung läuft nur, solange der Einsatz in einem Browser offen ist. Für einen
Hinweis „im Moment“ ist das genau der Fall, der zählt.

### D3 Schlüssel „Ereignis + Stufe“ statt Warnungskennung

Die Warnung trägt auf dem Draht keine CAP-Kennung. Auch mit Kennung wäre sie der falsche
Schlüssel, denn der DWD gibt eine laufende Warnung bei jeder Aktualisierung (verlängertes Ende,
neuer Text) mit **neuer** Kennung aus. Ein Schlüssel über die Kennung erzeugte genau den
Doppelalarm, den das Ticket verbietet. Das Paar aus `ereignis` (normalisiert: getrimmt,
Großschreibung) und `stufe` bleibt über Aktualisierungen gleich. Zugleich trennt es
verschiedene Gefahren (Gewitter neben Dauerregen) und Stufenwechsel. Der Draht bleibt deshalb
unverändert, und es gibt keine Typ-Codegen-Änderung.

### D4 Regel „neu“: 6-h-Gedächtnis, Eskalation statt jeder Änderung

Ausgewertet wird nur ein Stand `aktuell` oder `veraltet` (`teilStand`), nie `unbekannt` oder
`kein_ort`. Aus ihm zählen die gültigen Warnungen der Stufen schwer und extrem, gilt jetzt wie
angekündigt, über `teileWarnungen`.

Ein Paar gilt als **neu**, wenn beides zutrifft:

1. Es ist im Gedächtnis (D5) nicht als in den letzten 6 h gesehen verzeichnet.
2. Seine Stufe liegt nicht unter der höchsten Stufe, die das Gedächtnis in den letzten 6 h
   verzeichnet. Ist das nicht erfüllt, liegt eine Herabstufung vor.

Nach jeder Auswertung wird jedes aktuelle Paar mit `jetzt` als zuletzt gesehen eingetragen.
Einträge, die älter als 6 h sind, fallen heraus. Die 6 h entsprechen der Obergrenze des
Warnstands (`OBERGRENZE_MS.warnungen`). Eine Lücke in der Quelle, etwa eine Warnung, die kurz
fehlt und dann neu ausgegeben wird, löst deshalb keinen Hinweis aus.

Je Auswertung entsteht **höchstens ein** Hinweis. Er nennt die höchste neue Warnung, bei
gleicher Stufe die mit dem frühesten Beginn. Sind mehrere neu, steht im Text „(+ n weitere)“.

**Hingenommener Preis.** Eine *andere* Gefahr der Stufe schwer, die erscheint, während in den
letzten 6 h schon „extrem“ gemeldet wurde, alarmiert nicht. Die Führung ist dann bereits auf
der höchsten Stufe. Der Zähler steigt, und die Modulseite zeigt die Warnung. Die Alternative
(jedes neue Paar alarmiert) hätte jede Herabstufung als Alarm gemeldet. Der DWD stuft über
einen neuen Ereignisnamen herab („EXTREM ERGIEBIGER DAUERREGEN“ → „ERGIEBIGER DAUERREGEN“),
deshalb wäre das in jeder abklingenden Lage passiert.

Das erste Öffnen eines Einsatzes mit leerem Gedächtnis meldet eine gültige Unwetterwarnung
einmal. Wer neu dazukommt, soll es erfahren.

### D5 Gedächtnis in `localStorage`, je Person und Einsatz

Der Schlüssel lautet `lifeline-unwetter-gemeldet:<benutzerId>:<einsatzId>`. Der Wert ist
`{ [paarSchluessel]: { stufe, gesehenAt } }`. Die Person steht im Schlüssel, weil sich auf
einem Führungsrechner mehrere Personen nacheinander anmelden. Ohne sie bekäme die zweite den
Hinweis nie.

- **Lesen und Schreiben unmittelbar vor dem Melden**, in einem synchronen Zug. Mehrere Tabs
  desselben Browsers teilen das Gedächtnis: Der Tab, der zuerst nachfragt, meldet, und die
  anderen sehen das Paar schon eingetragen. So entsteht kein Hinweis je Tab. Bei verdecktem Tab
  trägt die Desktop-Meldung den Hinweis. Damit sie greift, fragt der Hinweis auch im verdeckten
  Tab nach (`refetchIntervalInBackground`, D6). Ohne das käme der neue Stand erst mit der
  Rückkehr in den Tab, und dann ist der Tab sichtbar.
- **Scheitert das Schreiben** (privater Modus, volles Kontingent), laufen Lesen und Schreiben
  still über `try/catch`, und das Gedächtnis fällt auf eine Modul-`Map` im Tab zurück. Beim
  Lesen geht dieser Stand vor `localStorage`, denn er ist der jüngere. Sonst läse der Tab bei
  vollem Kontingent den alten Wert, vergäße das zuletzt gemeldete Paar und alarmierte alle
  5 min erneut. Ganz ohne `localStorage` meldet jedes Neuladen einmal. Das ist laut, aber
  ehrlich, weil keine Warnung verschluckt wird.
- Kein Aufräumen beim Abmelden: Die Einträge sind klein und verfallen nach 6 h inhaltlich von
  selbst. Ein abgelaufener Schlüssel eines alten Einsatzes stört nicht.

Die Logik ist eine **reine** Funktion: `(gedaechtnis, warnungen, jetzt) → { neu, gedaechtnis }`.
Der Hook liest und schreibt nur. So ist die Regel ohne DOM prüfbar.

### D6 Hinweis über das Fenster-Ereignis `lfh:unwetter-alarm`, ein Platz im Budget

Die Erkennung sitzt im Hook `useUnwetterHinweis`. Die Wächter-Komponente
`wetter/UnwetterHinweis.tsx` (rendert nichts) montiert ihn im `EinsatzLayout`, und zwar
**innerhalb** des `EinsatzAnzeigeProvider`. Nur dort kennt `useAnzeigeKonventionen` Zeitzone und
Zeitformat des Einsatzes. Außerhalb läse der Hook die Vorgabe, und der Zeitraum im Hinweis stünde
in Browser-Ortszeit. Der Hook wartet zusätzlich auf die Einsatz-Einstellungen (dasselbe
Cache-Fach wie der Provider, Erfolg oder Fehler). Damit entsteht der Text auch dann nicht mit
der Vorgabe, wenn die Wetterantwort zuerst eintrifft.

Die Abfrage startet erst, wenn die Modul-Overrides geladen sind. Vorher gälte das Modul als frei,
und ein ausgeblendetes antwortete mit 403. Der Observer des Hinweises fragt auch im verdeckten
Tab nach (`refetchIntervalInBackground: true`, siehe D5). Key und Cache-Fach bleiben dieselben.

Der Hook spielt `spieleAlarmTon('dezent')` und löst `lfh:unwetter-alarm` mit
`{ schluessel, titel, beschreibung }` aus. Die Texte baut `unwetterHinweisText` (D9). Der Titel
ist die Stufenbezeichnung aus `dwdWarnstufe` („Unwetterwarnung“ / „Extremes Unwetter“). Die
Beschreibung lautet „<Ereignis in Titelschreibung>, <warnZeitraum>“, bei Bedarf mit
„ (+ n weitere)“. Das ist dasselbe Muster wie der Live-Stream: Ton beim Auslöser, Hinweis in der
AlarmZentrale. Die AlarmZentrale zeigt nur an und bekommt dafür:

- `AlarmZiel` `'wetter-pegel'` → `wetterPegelPfad(einsatzId)`. In der Zusammenfassung steht
  der Knopf „Zu Wetter & Pegel“.
- Einen Listener mit Art `warning`, Aktion „Öffnen“ und Desktop-Meldung.
- **Ersetzen statt stapeln:** Der Scope merkt sich den Key des letzten Unwetterhinweises. Ist
  er noch einzeln sichtbar, wird er zerstört und aus den Listen genommen, bevor der neue über
  `zeigeAlarmToast` kommt. Jede Auslösung bekommt einen **eigenen** Key
  (`unwetter-<paar>-<laufende Nummer>`). Ein Key je Paar wäre verschluckt worden, solange ein
  älterer Hinweis desselben Paars noch gebündelt in der Zusammenfassung hängt. Ein bereits
  gebündelter alter Hinweis bleibt in der Zusammenfassung gezählt.

### D7 Zähler als Browser-Zähler `wetter-pegel`

`ClientZaehlerQuelle` wächst um `'wetter-pegel'`. Der Registry-Eintrag des Moduls bekommt
`zaehlerQuelle: 'wetter-pegel'`. `useModulZaehler` lädt `wetterAbfrage(einsatzId)` mit
`enabled`, sobald die Overrides geladen sind und `darfZaehlerZeigen('wetter-pegel', …)` gilt.
Vorher gälte das Modul als frei, siehe D6. Das ist derselbe Key wie bei Modulseite und
Erkennung, also ein Abruf je 5 min und ein Cache-Fach.

`berechneUnwetterZaehler(anzeige, jetzt)` steht neben den anderen Browser-Zählern und stützt
sich auf die Ableitung aus D4:

- Bei verwertbarem Stand liefert sie `{ wert, beschreibung }`, zum Beispiel
  „2 Unwetterwarnungen für den Einsatzort, davon 1 angekündigt“. Der Teil „davon …“ entfällt
  bei 0 angekündigten.
- Sonst liefert sie `undefined`. Dann steht keine Zahl da, auch keine 0.

`jetzt` kommt aus dem Wecker `useUnwetterUhr`, nach dem Muster von `useEinstufungsUhr`. Er
liest die Uhr bei jeder neuen Antwort und stellt sich auf den nächsten Wechsel
(`naechsterUnwetterWechsel`): einen künftigen Beginn, ein Ende oder die Obergrenze des Stands.
Die Obergrenze ist immer eingeplant, sobald eine Unwetterwarnung vorliegt, auch bei Ende „bis
auf Weiteres“. So fällt eine abgelaufene Warnung auch zwischen zwei Abrufen heraus, und ein zu
alter Stand verliert seine Zahl, ohne dass der Rahmen alle 30 s neu zeichnet (`useUhr`
täte das).

`darfZaehlerZeigen` sucht sein Modul über `zaehlerQuelle`. Mit dem neuen Eintrag findet es das
Modul `wetter-pegel`. Dashboard und Überblick behalten ihr `istKeyFreigegeben`, eine Umstellung
ist nicht nötig.

### D8 Überblick-Marke `unwetter`

- `MarkenArt` wächst um `'unwetter'`.
- `naechsteMarken` bekommt einen siebten, optionalen Parameter: die angekündigten
  Unwetterwarnungen, bereits gefiltert durch dieselbe Ableitung (D4, nur `angekuendigt`).
- Je Paar aus Ereignis, Stufe und Beginn entsteht eine Marke mit dem Key
  `u-<stufe>-<ereignis>-<beginn>`. Die Zeit ist `beginn`, der Text
  „<Stufenbezeichnung>: <Ereignis in Titelschreibung>“.
- Wie die Pegelprognose fällt die Marke ab `beginn ≤ jetzt` heraus. `markenBewertung` liefert
  deshalb nur `neutral` oder `achtung` (unter 30 min), nie `alarm`.
- `UeberblickPage` lädt `wetterAbfrage` nur bei `wetterPegelFrei`. `markenZiel` führt
  `unwetter` zu `wetterPegelPfad`.
- Ein Fehler der Wetterabfrage macht die Marken **nicht** zum Fehlerzustand
  (`zMarken` bleibt bei Einsatz, Aufträgen und Erinnerungen). Es fehlen dann nur die
  Unwettermarken. Das ist ehrlich, denn der Zähler fehlt in diesem Fall ebenso, und die
  Modulseite nennt „Stand unbekannt“.

### D9 Eine Ableitung in `wetter/unwetter.ts`

Die neue reine Datei enthält:

- `UNWETTER_STUFEN` (`schwer`, `extrem`);
- `unwetterLage(anzeige, jetzt) → { giltJetzt, angekuendigt } | null` (`null` bei unbrauchbarem
  Stand);
- `paarSchluessel(warnung)`;
- `erkenneNeue(gedaechtnis, warnungen, jetzt)` (D4);
- `naechsterUnwetterWechsel(teil, jetzt)` für den Wecker des Zählers (D7);
- Text-Helfer für Hinweis und Marke.

Zähler, Erkennung und Marke nutzen nur diese Datei. Die Stufenbezeichnung kommt aus
`dwdWarnstufe` (`theme/statusFarben.ts`), nicht aus einer zweiten Liste.

## Risks / Trade-offs

- **[Mehr Abrufe]** Jeder offene Einsatzrahmen fragt jetzt alle 5 min den Wetter-Endpunkt ab,
  wenn das Modul frei ist. → Der Server-Cache teilt den Abruf je Organisation und Ort
  (TTL 5 min), und Bright Sky sieht höchstens einen Abruf je 5 min und Ort. Ein Einsatz ohne Ort
  geht nie ins Netz (`kein_ort`). Der Hinweis fragt auch im verdeckten Tab nach (D6). Das kostet
  Anfragen ans eigene Backend, aber keine zusätzlichen bei Bright Sky.
- **[Herabstufung gegen neue Gefahr]** Eine neue Gefahr der Stufe schwer bleibt während einer
  extremen Lage still (D4). → Die Lücke ist hingenommen und benannt. Zähler und Modulseite
  zeigen die Gefahr.
- **[Kein Hinweis ohne offenen Browser]** Die Erkennung läuft nur bei offenem Einsatz. → Beim
  nächsten Öffnen meldet sie jede noch gültige Unwetterwarnung einmal (D4, erstes Öffnen).
- **[Gedächtnis je Browser]** Ein zweiter Rechner derselben Person meldet noch einmal. → Das
  ist gewollt, denn dort hat sie den Hinweis nicht gesehen.
- **[Ereignisname wechselt bei gleicher Gefahr]** Stuft der DWD über einen anderen Namen
  *hoch*, entsteht ein Hinweis. → Das ist gewollt, denn eine Hochstufung ist eine Eskalation.

## Migration Plan

Reines Frontend-Deployment ohne Daten. Nach dem Ausrollen meldet jede gültige
Unwetterwarnung je Person und Browser einmal, weil das Gedächtnis leer ist. Rückbau: den
Commit zurücknehmen. Die `localStorage`-Einträge verfallen inhaltlich nach 6 h.
