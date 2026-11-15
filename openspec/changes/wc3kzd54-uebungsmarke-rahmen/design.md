# Design

## Context

Die Motivation steht in `proposal.md` unter „Why“. Ausgangslage im Code:

- `EinsatzAnzeige.einsatzart` ist ein Pflichtfeld (`"realeinsatz" | "uebung" | "sanitaetsdienst"
  | "bereitstellung"`). `GET /api/einsaetze/{id}` liefert es auch an gekoppelte Geräte (dort
  fallen nur Personenbezug und Einsatzleiter weg). Der Einsatzrahmen (`EinsatzLayout`), die
  Gerätehülle (`GeraeteHuelle`) und der Lagemonitor halten das Objekt schon über
  `einsatzKeys.einsatz(id)`. Ein Abruf kommt also nicht dazu.
- Beschriftungen gibt es nur in `einsatz/einsatzart.ts` (`EINSATZART_LABELS`). Ausgewertet wird
  die Art im Rahmen nirgends.
- Klebender Rahmen (`components/rahmenOben.ts`, LFH-952): Ab `md` klebt der Kopf, unter `md` nur
  die Betriebszeile bei Störung (sie steht in `App.tsx` vor dem Einsatzrahmen). Jede klebende
  Quelle meldet ihre Höhe. Die Summe steht als `--lfh-rahmen-oben` am Dokument, und alles, was
  sonst klebt, hängt sich darunter.
- Bänder im Rahmen gibt es schon: `SpiegelBand`, `FuehrungHinweisband`, `LiveStatusBanner`. Ein
  Instanz- oder Demo-Band gibt es nicht.
- Druck: Der gemeinsame `Druckkopf` hat 16 Aufrufer. Sein Prop `einsatz` ist eng typisiert
  (`bezeichnung`, `einsatznummer_intern`). `druck/druck.css` setzt `@page` mit einem Randfeld
  `@bottom-right` für die Seitenzählung, das nur Chromium zeichnet.
- Farben: Gelb heißt Achtung oder Störung, Blau Bedienung oder Hinweis, Grün normal. Rot gehört
  der Marke und bedient nichts. Violett ist frei.

## Goals / Non-Goals

**Goals:**

- Genau eine Entscheidung (`istUebung`) und genau ein Baustein für die Kennzeichnung. Neue Orte
  bauen nichts Eigenes.
- Das Band steht in jeder Breite und Dichte und verdeckt nichts, was heute klebt.
- Der Druck ist auch schwarz-weiß und ohne Hintergrundfarben eindeutig.

**Non-Goals:**

- Kein Schutz gegen das Erfassen in die falsche Art, etwa eine Rückfrage beim Speichern. Die
  Kennzeichnung soll die Verwechslung verhindern, sie sperrt nichts.
- Keine Änderung der Demo-Namen „ÜBUNG – …“ und keine Migration bestehender Namen.
- Kein Band beim Strg+P-Druck normaler Seiten. Ohne Druckwurzel gibt es dafür heute keine
  Druckregel.
- Keine Kennzeichnung für Sanitätsdienst oder Bereitstellung.
- Kopfleiste entlasten und Kopf am Handy fixieren sind eigene Aufgaben (LLH-1726, LLH-1728). Diese
  Change nimmt ihnen nichts vorweg.

## Decisions

### D1 Eine Quelle: `istUebung` in `einsatz/einsatzart.ts`

`istUebung(einsatz: { einsatzart: Einsatzart } | null | undefined): boolean`, wahr genau bei
`'uebung'`. Rahmen, Gerät, Liste, Wechsler, Tab-Titel und Druckkopf fragen nur diese Funktion.
Lädt der Einsatz noch, ist sie falsch, und es steht kein Platzhalter. Ein Platzhalter wäre bei
Realeinsätzen ein leerer Streifen.
*Alternative:* `einsatz.einsatzart === 'uebung'` an jeder Stelle. Verworfen, weil die Regel dann
an sieben Stellen stünde und eine spätere Erweiterung (etwa „Planspiel“) sie verfehlen würde.

### D2 Farbrolle `uebung`: gefüllt, Violett, je Modus

Neue Rollen in `Farbrollen` (`theme/tokens.ts`) und `theme/rollen.css` (`--lfh-uebung-*`):
`uebungFuellung` (Grund von Band und Marke), `uebungSchraffur` (zweiter Streifenton im Band),
`uebungText` (Wort darauf) und `uebungKante` (Umriss gegen dunkle Flächen). Werte, die
`uebungKontrast.test.ts` festhält, in Nacht und Tag gleich:

| Rolle | Wert | gerechnet |
| --- | --- | --- |
| `uebungFuellung` | `#6d28d9` | Weiß darauf 7,10; gegen helle Flächen ≥ 5,9 |
| `uebungSchraffur` | `#5b21b6` | Weiß darauf 8,98 |
| `uebungText` | `#ffffff` | |
| `uebungKante` | `#a78bfa` | gegen dunkle Flächen und den Rahmen ≥ 6,4 |

Prüfgrenzen: Das Wort hält auf beiden Streifentönen den Tagesboden 7 : 1, in beiden Modi, weil das
Band am Rahmen hängt, der in beiden Modi dunkel ist. Der Umriss hält gegen jeden angrenzenden Grund
(Rahmen, `grund`, `flaeche`, `flaeche2`, `paneel`, `kopf`) ≥ 3 : 1, getragen von der Füllung oder
der Kante. Bei der Umsetzung hat sich gezeigt, dass kein einzelner Violettton zugleich Weiß ≥ 7
und ≥ 3 gegen den dunklen Rahmen hält. Deshalb gibt es die eigene Kante, und es gibt keine
helleren Nachtwerte (der erste Entwurf hatte nachts `#7c3aed`, Weiß darauf nur 5,70). Die Rolle
steht auch in `rollen.guard.test.ts` (deckungsgleich mit CSS), und das Design System wird neu
erzeugt (`frontend/AGENTS.md`, Gestaltungssprache).
*Alternativen:* Gelb-schwarze Warnschraffur (mit Achtung und Störung belegt, und Offline- und
Spiegelhinweise sähen gleich aus), Hinweis-Blau `bannerGrund` (verwechselbar mit Spiegelband und
Bedienelementen). Beide hat der Mensch am 15.11.2026 verworfen.

### D3 Ein Baustein, zwei Formen: `components/instrument/Uebung.tsx`

- `UebungsMarke` ist ein kompakter Chip „ÜBUNG“: gefüllt, Versalien, `Augenbraue`-Schrift. Mit
  `groesse="monitor"` hat er ≥ 28 px für den Lagemonitor. Er wird in Kopf, Liste, Wechsler und
  Lagemonitor verwendet und ist `role="status"`-frei (statisch), mit `aria-label`
  „Übung“ nur dort, wo das Wort sonst nicht vorgelesen würde.
- `UebungsBand` ist das Band über die volle Breite: Schrägschraffur aus `uebungFuellung` und
  `uebungSchraffur` (`repeating-linear-gradient` 45°), darin mittig das Wort „ÜBUNG“ und klein
  „Übungseinsatz, kein Realeinsatz“ ab `md`. Die Höhe entspricht einer Zeile der Augenbraue mit
  knapper Polsterung, etwa 24 px, und wächst mit der Schriftskala, nicht mit der Trefffläche. Das
  Band bedient nichts. `data-lfh="uebung-band"`.
- Gibt `istUebung` falsch, rendern beide `null`. Aufrufer übergeben den Einsatz und prüfen nicht
  selbst.
- Der Baustein kommt in die Liste der Bausteine in `frontend/AGENTS.md` und bekommt eine Karte in
  `PREVIEWS` (Nacht und Tag).

*Alternative:* Das Band als `Alert banner` von antd. Verworfen: Es brächte ein Symbol und die
Farben einer Meldung mit und nähme die Schraffur nicht an.

### D4 Stehenbleiben: das Band als eigene klebende Quelle unter dem Rest

Das Band steht im DOM direkt nach dem Kopf (`EinsatzLayout`) bzw. nach dem Gerätekopf. Es klebt
**immer** (`position: sticky`, Ebene `RAHMEN_EBENE`), mit `top` gleich der Summe der **übrigen**
Quellen, und meldet seine eigene Höhe als Quelle (`useRahmenObenQuelle`). Daraus ergibt sich:

- Ab `md`: Kopf klebt bei 0, das Band bei Kopfhöhe, und `--lfh-rahmen-oben` ist Kopf plus Band.
  Stehende Tabellenköpfe hängen sich unter das Band.
- Unter `md`: Der Kopf rollt weg, das Band klebt bei 0 bzw. unter der gestörten Betriebszeile, und
  `--lfh-rahmen-oben` ist Band plus gegebenenfalls Betriebszeile.

`rahmenOben.ts` bekommt dafür `useRahmenObenOhneSich`. Es liefert die Summe ohne die eigene Quelle
und rechnet nicht selbst, damit Umbruch und Dichte weiter gemessen werden. Der Guard
`rahmenOben.guard.test.ts` kennt das Band als Rahmenteil. `alarmOben.ts` misst die Bedienkante
schon über die Summe und braucht keine Änderung, das prüft `alarm-verdeckung.spec.ts`.
*Alternative:* Das Band in den `Header` des Kopfs legen, als zweite Zeile einer Flexspalte.
Verworfen: Unter `md` rollt der Kopf samt Band weg, und das widerspricht der Abstimmung („steht
immer, auch am Handy“).
*Alternative:* Das Band unter `md` `position: fixed`. Verworfen: Es läge über dem Inhalt, statt
ihn zu schieben, und jede Seite müsste einen Abstand kennen.

### D5 Kopfmarke nur ab `md`

Die Marke vor dem Einsatznamen steht ab `md` (wie die Einsatznummer). Unter `md` trägt das immer
klebende Band die Kennzeichnung, und der Name behält dort seinen knappen Platz (vgl. LLH-1726).

### D6 Tab-Titel

`useDokumentTitel` bekommt ein optionales Präfix. `dokumentTitel(teile, zahl, { uebung })` setzt
„ÜBUNG · “ vor alles, auch vor die Zählung: „ÜBUNG · (3) ETB · Starkregen Nord · lifeline-hub“.
Das Präfix bleibt so auch im gekürzten Tab vorn stehen. Nur der Einsatzrahmen setzt es.

### D7 Gerät und Lagemonitor

`GeraeteHuelle` rendert `UebungsBand` mit dem Einsatz aus seiner Query direkt nach `GeraeteKopf`
(vor `LiveStatusBanner` und `SpiegelBand`), mit derselben Klebemechanik wie D4. Der Lagemonitor
hat keinen Kopf: `UebungsMarke groesse="monitor"` steht in der Statusleiste vor dem Einsatznamen.
Die Kachelung bleibt unverändert, `geraet-lagemonitor.spec.ts` prüft weiter „ohne Bildlauf, jeder
Text ≥ 28 px“. Kein Ton, keine Animation (`geraet/AGENTS.md`).

### D8 Druck: Kopfzeile plus Randfeld in Chromium

- `Druckkopf` weitet seinen Prop auf `einsatz: { bezeichnung; einsatznummer_intern?; einsatzart? }`.
  Bei `istUebung` steht neben der Einsatzbezeichnung „ÜBUNG“ als umrandeter Block: 2 pt Rahmen,
  fett, Versalien. Gefüllte Hintergründe druckt der Browser nicht ohne
  `print-color-adjust: exact`, und das Papier ist hell (Spec „Papier ist hell“).
- Jede Seite: Die Druckwurzel trägt bei einer Übung `data-uebung`. `druck.css` ordnet einer solchen
  Wurzel die benannte Seite `page: uebung` zu. `@page uebung` erbt Rand und Zählung und setzt
  `@top-center { content: 'ÜBUNG' }`. Das ist eine feste Zeichenkette, also keine Escape-Fläche wie
  beim freien Text, den der Kommentar dort ausschließt. Chromium zeichnet das Randfeld. Firefox und
  WebKit zeichnen keine Randfelder, dort steht „ÜBUNG“ im Druckkopf der ersten Seite. Das ist
  dieselbe Grenze wie bei der Seitenzählung.
- Alle Aufrufer, die heute ein `EinsatzAnzeige` übergeben, tragen `einsatzart` schon mit.
  Schichtplan (`SchichtplanBlaetter`), Lageplan (`useLageplan`/`LageplanKopf`) und Planung
  (`PlanungDruckPage`, `PlanungKopf` hat die Art) bekommen das Feld durchgereicht. Der
  Einsatzbericht nimmt die Art aus seinem Schnappschuss (`einsatzStand`).

*Alternative:* `position: fixed` je Seite (Chromium und Firefox). Verworfen: Es liegt über dem
Inhalt, kollidiert mit dem wiederholten `thead` der Tabellen, und die e2e-Maße mit 15 mm Rand
gingen nicht mehr auf.
*Alternative:* ein diagonales Wasserzeichen. Am 15.11.2026 verworfen.

### D9 Einsatzliste und Wechsler

In `EinsaetzePage` ersetzt `UebungsMarke` bei einer Übung den grauen `Tag`, andere Arten behalten
ihn. Im `EinsatzSwitcher` steht die Marke im Eintrag vor der Bezeichnung. Die Nebenzeile
(Nummer · Ort) bleibt wie in der Spec `seiten-orientierung`.

### D10 Regel und Doku

- `frontend/AGENTS.md`, Abschnitt „Rahmen“, neuer Spiegelstrich „Übung“: Die Kennzeichnung ist
  Pflicht jeder Fläche, die einen Einsatz zeigt (Rahmen, Gerät, Liste, Wechsler, Tab, Druck).
  Entschieden wird nur über `istUebung`, gezeigt nur über `UebungsMarke` bzw. `UebungsBand`. Das
  Band klebt nach D4. Dazu der Eintrag in der Bausteinliste.
- `frontend/src/geraet/AGENTS.md` und `frontend/src/druck/AGENTS.md`: je ein Satz mit Verweis auf
  diese Regel. Die Regel selbst steht nur einmal.
- Anwenderdoku: Das Kapitel `einsatz-oberflaeche.md` beschreibt Band und Marke. Weil der
  Demo-Einsatz eine Übung ist, zeigen alle Bilder mit Einsatzrahmen das Band. Die betroffenen
  Bilder werden neu erzeugt (Mitänderungsregel 4, `docs/anwender/AGENTS.md`).

## Risks / Trade-offs

- [Das Band kostet am Handy etwa 24 px Dauerhöhe] → Das ist gewollt (Abstimmung „steht immer“).
  Die Höhe folgt der Schrift und nicht der Trefffläche und bleibt damit auch in `handschuh`
  schmal.
- [Zwei klebende Quellen übereinander können sich gegenseitig messen und schwingen] →
  `useRahmenObenOhneSich` liest nur die übrigen Anteile. Die eigene Höhe hängt nicht vom eigenen
  `top` ab, also gibt es keine Rückkopplung. Ein Unit-Test belegt das.
- [Neuer Bildlauf in vielen Doku-Kapiteln, weil der Demo-Einsatz eine Übung ist] → Die Bilder
  werden im selben Branch neu erzeugt. Scheitert der volle Bildlauf in der Cloud-Sitzung (Zeit,
  Binary), werden das Kapitel „Einsatz-Oberfläche“ und die Gerätekapitel hier erzeugt. Der Rest
  geht als Folgeaufgabe auf das Board und steht im PR.
- [Die Randfeld-Kennzeichnung fehlt in Firefox und Safari ab Seite 2] → Dort trägt nur der
  Druckkopf der ersten Seite „ÜBUNG“. Das ist bekannt und steht so in der Spec. Ein lückenloser Weg
  wäre ein Wasserzeichen, das ist verworfen.
- [Die Farbe kollidiert später mit einer neuen Rolle] → Die Rolle ist exklusiv. Die Regel in
  `frontend/AGENTS.md` nennt Violett als „nur Übung“.
