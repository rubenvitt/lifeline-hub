# Fachebene Autobahn ausbauen und Lizenz klären (LLH-1637)

Stand: 24.11.2026 · Zunder: https://zunder.rubeen.dev/#/aufgabe/x36jzkkm0bhvbnayeqvlxyiw ·
Abgestimmt: Ruben im Chat, 24.11.2026 (Phase-1-Checkpoint: Umfang „Warnungen + Lkw-Parken“,
Lizenz „Doku + Anfrage an die GmbH“, Live-Abruf freigegeben; Folgefrage: Lkw-Parken als „eigene
Ebene“) · Freigabe des Entwurfs: Ruben im Chat, 24.11.2026 („Entwurf passt, go“)

## Absicht

Die Fachebene „Autobahn-Lage (BAB)“ zeigt heute Baustellen und Sperrungen. Der Webcam-Dienst ist
seit September leer. Bei einer Anfahrt über die BAB fehlt damit, was gerade passiert: Stau,
Stillstand, zähfließender Verkehr. Für Bereitstellungsräume und Sammelplätze fehlt ein Überblick
über die Rastanlagen samt Stellplätzen. Beides liefert dieselbe Quelle. Dazu ist die Lizenzlage
der Autobahn-API ungeklärt; die Doku nennt eine „gängige Einordnung“ (dl-de/by-2-0), die sich
nicht belegen lässt.

## Befund (Live-Abruf 24.11.2026, 23:40 MEZ)

- Streckenliste: 113 Strecken nach Trimmen und Entdoppeln.
- `…/{strasse}/services/warning`: bundesweit **8** Meldungen (nachts). Felder zusätzlich zum
  gemeinsamen `RoadItem`: `startTimestamp`, `delayTimeValue` (Minuten als String),
  `abnormalTrafficType` (`QUEUING_TRAFFIC`, `SLOW_TRAFFIC`, bei 5 von 8 fehlend), `source`
  (`eva` 5, `inrix` 3), `extent`, `startLcPosition`. `future` stand überall auf `false`.
- `…/{strasse}/services/parking_lorry`: bundesweit **1 800** Rastanlagen, A1 allein 133 (110 KB
  roh). `title` = Abschnitt („A1 | Puttgarden“), `subtitle` = Name der Anlage („Krummhörens
  Kuhlen“), `description` = Zeilen wie `PKW Stellplätze: 18` und `LKW Stellplätze: 4`,
  `lorryParkingFeatureIcons[].description` = Ausstattung („Toilette vorhanden“, „Picknick­
  möglichkeiten“ …). Kein `startTimestamp`, keine Belegung.
- `…/services/webcam`: weiter `{"webcam":[]}` (13 B).
- `…/services/electric_charging_station`: liefert (A1 21 KB), bleibt laut Abstimmung draußen.
- `roadworks` A1: 261 Einträge, `display_type` `ROADWORKS` 149 / `SHORT_TERM_ROADWORKS` 112.
  `closure` A1: 27, davon `CLOSURE_ENTRY_EXIT` 24.
- Ein Fächer über 113 Strecken × 2 Dienste mit 8 gleichzeitigen Abrufen dauerte 13 s.

## Befund Lizenz

- Die API-Antwort enthält keinen Lizenz- oder Copyright-Kopf (nginx/Express, `Access-Control-
  Allow-Origin: *`, ETag).
- bundesAPI (`github.com/bundesAPI/autobahn-api`): kein Lizenzvermerk im README, keine
  LICENSE-Datei, `openapi.yaml` 1.0.1 ohne `license`-Feld. Als Kontakt nennt die Spec die
  Autobahn GmbH (`kontakt@autobahn.de`).
- autobahn.de: Das Impressum nennt den Herausgeber, aber keine Nutzungsbedingungen und keine
  Lizenz. `/nutzungsbedingungen` und `/open-data` antworten mit 404.
- Mobilithek: Das einzige Angebot der Autobahn GmbH (Arbeitsstellen längerer Dauer) steht unter
  einer **eingeschränkten** Lizenz für Stellen mit berechtigtem Interesse. Auf die App-API lässt
  sich das nicht übertragen, es zeigt aber, dass die GmbH ihre Daten nicht pauschal offen
  lizenziert.
- Ein Teil der Verkehrsmeldungen stammt von **INRIX**, einem kommerziellen Datenanbieter
  (`source: inrix`). Die Webcam-Bilder liegen bei Drittbetreibern (etwa verkehr.nrw).
- **Ergebnis:** Die Lizenz ist **nicht belegt**. Die Einordnung als dl-de/by-2-0 hat keine
  Quelle und fliegt aus der Doku. Klären kann das nur die Autobahn GmbH; die Anfrage stellt
  Ruben (E-Mail-Entwurf im Anhang).

## Ziele

1. **Verkehrsmeldungen in der Autobahn-Ebene.** Der Fächer holt zusätzlich `warning`. Jede
   Meldung wird ein Punkt mit Kategorie `verkehrsmeldung`, Art (Stau, zähfließend, sonst
   „Verkehrsmeldung“), Reisezeitverlust in Minuten, Beginn, Richtung und Beschreibungszeilen.
   Der Inspector zeigt Art und Reisezeitverlust oben.
2. **Neue Fachebene `autobahn_parken`** („Lkw-Parkplätze (BAB)“), eigener Schalter, Standard
   aus. Ein Punkt je Rastanlage mit Name, Abschnitt, Strecke, Pkw- und Lkw-Stellplätzen (aus
   den Beschreibungszeilen gelesen, fehlend = unbekannt) und Ausstattungsliste. Geltungszeile:
   „nur Rastanlagen an Bundesautobahnen, ohne Belegung“.
3. **Lizenz in `docs/fachebenen-quellen.md`** als „nicht belegt“ mit den Funden oben, Datum und
   dem Hinweis auf die offene Anfrage. Die Attribution `Autobahn GmbH des Bundes` bleibt an
   beiden Ebenen.
4. Anwender-Doku (Lagekarte) und Architektur-Doku (Kontextabgrenzung, Bausteine) ziehen nach.

## Nicht-Ziele

- Keine Ladesäulen (`electric_charging_station`).
- Keine Belegung der Parkplätze; die Quelle liefert keine.
- Keine Linien-Geometrie für Meldungen oder Baustellen; die Ebene bleibt bei Punkten (LFH-80).
- Kein Kategorie-Filter innerhalb einer Ebene; diese Variante ist verworfen (s. Ansätze).
- Keine Änderung am Webcam-Weg: Er bleibt gebaut, die Bilder bleiben nur verlinkt und werden
  nicht zwischengespeichert.
- Keine eigene Attribution für INRIX, solange die GmbH sie nicht verlangt (Frage in der Anfrage).

## Anti-Ziele

- Die Parkplätze dürfen die Sperrungen nicht zudecken: Wer nur „Autobahn-Lage“ einschaltet,
  sieht keinen einzigen Parkpunkt.
- Die Autobahn-Ebene darf durch den vierten Dienst nicht so langsam werden, dass ein Lauf eine
  der Schranken aus `docs/fachebenen-quellen.md` reißt (Lauf hängt an keinem Request, bleibt so).
- Kein zweiter, paralleler Fächer gegen die Quelle: Autobahn-Lauf und Parken-Lauf dürfen sich
  nicht zu 16 gleichzeitigen Abrufen addieren (die Quelle drosselt ab 16).
- Ein halber Parken-Lauf darf keinen ganzen Stand ersetzen.

## Rahmen

- Quelle ohne Schlüssel; Streckenliste wie heute getrimmt, entdoppelt, nur alphanumerisch.
- Der Autobahn-Lauf wächst von 3 auf 4 Dienste je Strecke (rund 450 statt 340 Abrufe); bisher
  ~25 s, erwartet ~35 s. Er läuft weiter im Hintergrund (`fetch_autobahn`), TTL 600 s.
- Wire-Werte neu: Ebenen-Schlüssel `autobahn_parken` (Pfadparameter, kein festes Segment, damit
  außerhalb von `check-api-routen.sh`), Kategorie `verkehrsmeldung`, Kategorie `rastanlage`.
  Fachbegriffe deutsch nach `AGENTS.md`, „Bezeichner-Sprache“; Feature-Properties folgen der
  Sprache der bestehenden Autobahn-Properties (deutsch).
- Zeitpunkte (`beginn`) wie heute als Rohwert der Quelle; die Anzeige wandelt im Client
  (ADR-0012).
- Codegen: Ändert sich ein Response-DTO oder Enum, `scripts/check-typ-codegen.sh`.

## Ansätze

**Gewählt: Verkehrsmeldungen in die bestehende Ebene, Lkw-Parken als eigene Ebene** (Ruben,
24.11.2026). Meldungen sind wenige, sie gehören zur Lage an der BAB und haben dieselbe
Frische wie Sperrungen. Die Parkplätze sind 1 800 statische Punkte: Eine eigene Ebene hält sie
aus dem Lagebild heraus, bis jemand einen Bereitstellungsraum sucht. Ein eigener Cache mit 24 h
TTL holt sie einmal am Tag statt alle zehn Minuten.

Verworfen:

- **Alles in eine Ebene, ohne Filter.** Am wenigsten Code, aber 1 800 Parkpunkte verdecken
  ~2 000 Baustellen und Sperrungen, die Nutzlast verdoppelt sich etwa (heute 1,7 MB), und jeder
  10-min-Lauf holt statische Daten neu.
- **Eine Ebene mit Kategorie-Filter.** Löst das Zudecken, ist aber ein neues Bedienkonzept, das
  keine andere Fachebene hat, und der Lauf holt die Parkplätze weiter im 10-min-Takt.

## Wie (festgelegt)

### Backend

- **Autobahn-Lauf:** `AUTOBAHN_DIENSTE` um `warning` erweitern; `autobahn_kategorie` bildet
  `warning` auf `verkehrsmeldung` ab, `autobahn_label` auf „Verkehrsmeldung“. Zusätzliche
  Properties nur für diese Kategorie: `art` (aus `abnormalTrafficType`: `QUEUING_TRAFFIC` →
  `stau`, `SLOW_TRAFFIC` → `zaehfliessend`, `STATIONARY_TRAFFIC` → `stillstand`, sonst und
  fehlend → kein Wert) und `verzoegerung_min` (aus `delayTimeValue`, Zahl, nur wenn > 0).
  `source` wird nicht übernommen.
- **Parken-Lauf:** eigene Abruffunktion `fetch_autobahn_parken` nach dem Muster von
  `fetch_autobahn` (kalter Cache → sofort `offline`, Füllen im Hintergrund, Abkühlung nach
  Fehlschlag, eigener Fehlschlag-Merker), Cache-Schlüssel `autobahn_parken`, TTL 24 h, eigene
  Normalisierung `normalisiere_autobahn_parken`. Properties: `titel` (`subtitle`, sonst
  „Rastanlage“), `kategorie` `rastanlage`, `strasse`, `abschnitt` (`title` ohne das führende
  `A1 | `), `pkw_stellplaetze`, `lkw_stellplaetze` (Zahl aus den Zeilen `PKW Stellplätze: n` /
  `LKW Stellplätze: n`), `ausstattung` (Liste der `lorryParkingFeatureIcons[].description`),
  `id`. Übrige Beschreibungszeilen landen in `beschreibung`.
- **Kein gemeinsamer Fächer über 8:** Die beiden Läufe laufen **nacheinander**, nie
  gleichzeitig: Sie teilen eine Sperre, und ein Parken-Lauf startet nur, wenn gerade kein
  Autobahn-Lauf läuft (sonst beim nächsten Poll). Ein geteilter Semaphor würde nach einem
  Neustart mit kaltem Cache beide Läufe verlangsamen und den Autobahn-Lauf (~35 s) an
  `AUTOBAHN_BUDGET` (60 s) heranschieben. *(Entscheidung des Entwurfs, nach Gegenlesen.)*
- **Teilergebnis beim Parken-Lauf:** Der Autobahn-Lauf nimmt einen Lauf an, sobald mehr als die
  Hälfte der Abrufe Nutzlast bringt; für 10 min ist eine Lücke harmlos. Der Parken-Lauf hält
  seinen Stand 24 h, eine Lücke versteckte Hunderte Anlagen einen Tag lang. Er nimmt einen Lauf
  deshalb nur an, wenn **mindestens 90 %** der Strecken geantwortet haben; sonst bleibt der alte
  Stand, und der Lauf gilt als Fehlschlag (Abkühlung, nächster Versuch nach 5 min).
  *(Entscheidung des Entwurfs, nach Gegenlesen.)*
- **Veraltet bei Verkehrsmeldungen:** Die Autobahn-Ebene gilt weiter nach 60 min ohne neuen
  Stand als veraltet (sechs verpasste Läufe), die Kennzeichnung gilt für die ganze Ebene. Eine
  Meldung, die die Quelle weiter führt, ist aktuell; ein Stau verschwindet aus der Antwort,
  sobald die Quelle ihn beendet. Ein eigener Veraltet-Wert je Meldung ist nicht gebaut.
  *(Entscheidung des Entwurfs, nach Gegenlesen; Ruben kann bei der Freigabe einen kürzeren
  Wert für die Ebene verlangen.)*
- Die Streckenliste darf jeder Lauf selbst holen.
- **Route:** `"autobahn_parken" => quellen::fetch_autobahn_parken(…)` in
  `src/routes/karte.rs`, ohne `bbox`.
- Messung wie bei den übrigen Ebenen in `docs/fachebenen-quellen.md` nachtragen (Größe, Anzahl,
  Laufzeit).

### Frontend

- `FachebeneQuelle` um `autobahn_parken`; `defaultFachebenenSichtbar` mit `false`; Eintrag in
  `FACHEBENEN` (punkt, `bboxAbhaengig: false`, Poll wie Copernicus eher selten, z. B. 30 min,
  `aufwaermPollMs` wie Autobahn, `geltung` wie oben, `veraltetNachMin` passend zur TTL);
  Reihenfolge und Gruppe in der Leiste neben `autobahn`.
- Kategorien `verkehrsmeldung` und `rastanlage` in `KATEGORIE_LABEL`, Farben und Zeichen in
  `theme/statusFarben.ts` und `theme/tokens.ts` (Verkehrsmeldung als Warnfarbe, Rastanlage
  ruhig).
- Inspector: Verkehrsmeldung zeigt Art und „+17 min“ oben, dann Richtung, Beginn, Beschreibung.
  Rastanlage zeigt Name, Strecke und Abschnitt, „Pkw 18 · Lkw 4“ (fehlend: „k. A.“), dann die
  Ausstattung als Liste.

### Doku

- `docs/fachebenen-quellen.md`: Tabellenzeile Autobahn um `warning`, neue Zeile
  `autobahn_parken`, Lizenz-Vorbehalt neu (Befund Lizenz oben), Eigenheiten (INRIX-Anteil,
  `abnormalTrafficType` oft leer, Stellplätze nur als Text).
- `docs/anwender/kapitel/lagekarte.md` (und die dortige Ebenenliste) mit Bildern nach
  `docs/anwender/AGENTS.md`.
- `docs/architektur/03-kontextabgrenzung.md` (Dienste der Quelle), Bausteinsicht nach
  `docs/architektur/AGENTS.md`, Mitänderungsregel.

## Dem Umsetzer überlassen

- Name und Form der gemeinsamen Sperre; ob die Streckenliste zwischen den Läufen geteilt
  wird.
- Genaue Poll- und Veraltet-Werte der Parken-Ebene im Rahmen der 24-h-TTL.
- Zeichen und Farbtöne im Rahmen der Gestaltungssprache (`frontend/AGENTS.md`).
- Ob eine ADR nötig ist (`scripts/adr-fuer.sh`, `docs/architektur/AGENTS.md`); erwartet: nein,
  die Ebene folgt dem bestehenden Muster.
- Ob das Lagebild ohne Netz (`frontend/src/offline/AGENTS.md`) Fachebenen mitnimmt und die neue
  Ebene dort eingetragen werden muss.

## Anhang: Anfrage an die Autobahn GmbH (Entwurf, Ruben sendet)

An: kontakt@autobahn.de · Betreff: Nutzungsbedingungen der Verkehrsdaten-API
verkehr.autobahn.de

> Sehr geehrte Damen und Herren,
>
> ich entwickle Lifeline Hub, eine Führungs- und Lageanwendung für Hilfsorganisationen und
> Behörden mit Sicherheitsaufgaben. Die Lagekarte zeigt Baustellen, Sperrungen,
> Verkehrsmeldungen und Lkw-Parkplätze aus Ihrer Schnittstelle
> `https://verkehr.autobahn.de/o/autobahn/` an, mit dem Quellenvermerk „Autobahn GmbH des
> Bundes“. Die Daten werden auf dem Server zwischengespeichert (10 Minuten bzw. 24 Stunden), aber
> nicht an Dritte weitergegeben. Webcam-Bilder werden nur verlinkt.
>
> Eine Lizenz oder Nutzungsbedingungen für diese Schnittstelle habe ich weder in der Antwort noch
> auf autobahn.de gefunden. Deshalb meine Fragen:
>
> 1. Unter welcher Lizenz oder welchen Bedingungen stehen die Daten, z. B. Datenlizenz
>    Deutschland – Namensnennung – 2.0?
> 2. Ist der Quellenvermerk „Autobahn GmbH des Bundes“ ausreichend, oder braucht es für die
>    Verkehrsmeldungen von INRIX einen eigenen Vermerk?
> 3. Gibt es Einschränkungen für den Einsatz in einer Anwendung, die auch gegen Entgelt
>    angeboten werden kann?
> 4. Gibt es eine Abrufgrenze, die wir einhalten sollten? Heute rufen wir alle 10 Minuten rund
>    450 Endpunkte ab, höchstens 8 gleichzeitig.
>
> Vielen Dank und freundliche Grüße
> Ruben Vitt
