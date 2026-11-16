# Design

## Context

Alle Flächen zählen dieselben Köpfe: aktive `einsatz_personal`-Zeilen, eingeordnet nach
`staerke_position`. Sie gruppieren aber verschieden.

- **Abschnittsstärke** (Gliederung, Detail, Vorschau, Gerät, Organigramm):
  `pages/einsatzabschnitte/abschnittStaerke.ts:staerkeIn`. Gezählt werden nur Einheiten ohne
  Obereinheit, mit `ist_kumuliert`, über `summiereStaerke`. Eine Untereinheit zählt deshalb beim
  Abschnitt ihrer obersten Einheit. Steht in einem Abschnitt nur eine solche Untereinheit, ist die
  Stärke 0/0/0.
- **Meldebild und Überblick**: `kraefte/kraeftebild.ts:baueKraeftebild` hängt die Wurzeln von
  `einheitenBaum` (`kraeftebaumKern.ts`) unter den wirksamen Abschnitt der Wurzel. Untereinheiten
  bleiben unter ihrer Obereinheit, und die Einheitzeile kumuliert über alle Kinder. Der Filter
  „Abschnitt“ nutzt `abschnittDerObersten`. Der Überblick (`ueberblickDaten.ts:abschnittZeilen`)
  liest die obersten Abschnittszeilen dieses Baums.
- **Einheitenzahl** am Gliederungsknoten: `e.abschnitt_id === a.id` (`EinsatzabschnittePage.tsx:116`),
  also eine andere Menge als die Stärke daneben. Das Detail listet dieselbe rohe Menge mit
  `ist_kumuliert`.
- **Zeile über dem Meldebild**: `anzahlPersonal + anzahlFahrzeuge` (`KraefteuebersichtPage.tsx:1185`).
- **UHS-Kräfte**: Das Lagebild (`lageVerdichtung.ts:verdichteUhs`) summiert `uhs.staerke` aktiver
  UHS. Der Monitor (`LagemonitorPage.tsx:346`) summiert `u.kraefte` über alle UHS der Antwort,
  also über alle nicht aufgelösten. Die Antwort trägt `status` je UHS
  (`LagemonitorUhs.status`), deshalb ist kein Backend nötig.
- Die Rust-Seite der Fixture `tests/fixtures/verdichtung/regeln.json` prüft nur `ist_kumuliert`,
  `count_kraefte` und den Bereitstellungsraum. Die Abschnittsstärke prüft nur
  `lage/verdichtungFixture.test.ts`.

## Goals / Non-Goals

**Goals:**

- Ein Abschnitt zählt, wer in ihm steht, und zwar überall aus einer Funktion.
- Jede Abschnittszeile des Meldebilds ergibt sich weiter aus ihren Kindern, und jede Kraft steht
  einmal.
- Einheitenzahl und Stärke eines Abschnitts zählen dieselbe Menge.
- „Kräfte“ sind Köpfe. UHS-Kräfte zählen nur an aktiven UHS, im Lagebild wie im Monitor.

**Non-Goals:**

- Server: `ist_kumuliert`, Einheiten-DTO und Lagemonitor-Antwort bleiben unverändert. Einzige
  Serveränderung ist der Bereich des Abschnittsgeräts (D8). Die
  Verbandsstärke einer Einheit (Einheit-Detail, Zeile „kumuliert“ in den Einheiten) bleibt die
  Stärke samt aller Untereinheiten, wo immer diese stehen.
- Der Funkplan bleibt beim Führungsweg des Verbands, die Gruppe bleibt also unter ihrem Zug. Die
  Fernmeldeskizze ebenso (D3).
- Die UHS-Kräfte (`uhs_id`) gehen nicht in eine Abschnittsstärke ein. Sie sind eine eigene Achse.
- Wortlaut „direkt“ am Gliederungsknoten (LFH-973) und die Zahl „5 Einheiten“ bleiben.

## Decisions

### D1 Abschnittsstärke über den wirksamen Abschnitt

`staerkeIn(einheiten, abschnittIds)` summiert `ist` (die eigene Stärke) aller **aktiven**
Einheiten, deren wirksamer Abschnitt in der Menge liegt. Der wirksame Abschnitt kommt aus
`abschnittDerEinheit` (`kraeftebaumKern.ts`): der eigene, sonst der der nächsten Obereinheit. Die
Rückgabe bleibt `null` für eine leere Menge. Gerechnet wird über die aktiven Einheiten allein,
wie im Meldebild (LLH-1079): Eine Untereinheit einer aufgelösten Obereinheit erbt deren Abschnitt
nicht. `abschnittStaerken` behält ihre Form
(`eigene`, `inklUnter`). Alle bisherigen Aufrufer folgen ohne eigenen Code: Gliederung, Detail,
Vorschau, Gerät und Organigramm.

Die Summe über alle Abschnitte plus „ohne Abschnitt“ ergibt die Einsatzstärke, denn jede Einheit
hat genau einen wirksamen Abschnitt und zählt nur ihre eigenen Köpfe. Das ist dieselbe Regel wie
`staerkeImRaum` (LLH-1289).

*Verworfen:* Die Unterstellung beibehalten und nur die Anzeige erklären („zählt beim Zug“). EA 1.1
zeigte dann weiter 0, obwohl dort zwei Kräfte arbeiten (Abstimmung 16.11.2026).

### D2 Meldebild: abgestellte Untereinheiten lösen sich vom Verband

`kraeftebaumKern.ts` bekommt `loeseAbgestellte(einheiten, abschnitte, alle)`: derselbe Baum wie
`einheitenBaum`, aber jedes Kind, dessen wirksamer Abschnitt von dem seiner Obereinheit abweicht,
steht samt seinen Kindern als eigene Wurzel da. Der Knoten trägt dann `abgestelltAus` (die
Obereinheit). Die Prüfung je Einheit (`abgestelltVon`) liest die ungefilterte, aktive Liste `alle`. Weicht der wirksame Abschnitt ab, trägt das Kind einen eigenen Abschnitt, denn sonst
erbte es den der Eltern. Eine Gruppe ohne eigenen Abschnitt bleibt deshalb immer unter ihrem Zug.

`baueKraeftebild` nutzt `loeseAbgestellte(einheitenBaum(...))`. Die Einheitzeile kumuliert weiter
über ihre Kinder im Baum, und die abgestellte Gruppe ist keines mehr. Deshalb gilt: Zeile des Zugs
= eigene + Kinder im selben Abschnitt, Abschnittszeile = D1. Die Zeile der abgestellten Einheit
nennt „aus <Obereinheit>“ im Detail. Der Name kommt aus der ungefilterten Liste (`quelle`), damit
er auch bei einem Filter steht, der die Obereinheit ausblendet. Das Meldebild-Raster am Schirm
(`meldebildRaster.ts`, über `kraeftebaum()` des Kerns) löst ebenso; dort steht die abgestellte
Einheit als Wurzel mit ihrem Abschnitt in der Spalte und „aus <Obereinheit>“ im Nebentext.
Die Einheiten-Gliederung der Seite Einheiten (`einheitenGliederung.ts`) bleibt beim Verband, denn
ihre Zeilen tragen die Verbandsstärke des Servers.

Der Filter „Abschnitt“ (`filtereKraefte`) liest den wirksamen Abschnitt (`abschnittDerEinheit`)
statt `abschnittDerObersten`. `abschnittDerObersten` entfällt, sie hat keinen weiteren Aufrufer.
Der Überblick und der Lagebericht-Text folgen über `baueKraeftebild`. Rückmeldung und Ausfall
des Überblicks (LLH-1739) urteilen weiter über die Einheiten im Teilbaum der Abschnittszeile, und
die abgestellte Gruppe liegt jetzt im Teilbaum ihres Abschnitts.

*Verworfen:*

- Baum unverändert lassen und nur die Abschnittszeile nach D1 rechnen. Die Zeile von EA 1 wäre
  dann kleiner als die Summe ihrer Kinder, und EA 1.1 zeigte 0/1/1//2 ohne eine Zeile darunter.
- `einheitenBaum` selbst ändern. FMS-Tableau, Einheit-Auswahl und Verpflegung brauchen den Verband
  ungeteilt. Deshalb ist es ein eigener Schritt im selben Kern (Regel „Eine Baumlogik der Kräfte“).

### D3 Organigramm folgt dem Meldebild

`baueFuehrungsorganisation` platziert eine abgestellte Untereinheit unter ihrem Abschnitt statt
unter ihrer Obereinheit. Das ist dieselbe Prüfung wie D2, nur auf der flachen Einheitenliste: Ist
der wirksame Abschnitt ungleich dem der Obereinheit, ist die Einheit eine Wurzel ihres Abschnitts.
Der Knoten trägt „aus <Obereinheit>“. Die Stärke eines Einheitknotens ist die Summe von `ist` über
ihn und die Untereinheiten, die unter ihm stehen, wie die Meldebild-Zeile. Die Schlüssel (`eh-<id>`)
bleiben, der Kommunikationsplan setzt seine Ebene weiter darauf.

Die Abschnittsknoten rechnen weiter über `abschnittStaerken(...).inklUnter` (D1).

**Fernmeldeskizze** (Review 16.11.2026): `baueFernmeldenetz` liest denselben Baum als Vorlage für
Auto-Layout und Führungsmittel. Sie bleibt die zweite Darstellung des Funkplans und behält den
Verband: `baueFuehrungsorganisation` bekommt die Option `abgestellteLoesen` (Vorgabe `true`), und die
Skizze ruft sie mit `false`. Ohne Lösen ist auch die Stärke eines Einheitsknotens die des Verbands.

*Offen zur Freigabe:* Alternativ bleibt die Platzierung wie im Funkplan, und nur die Zahlen ändern
sich. EA 1.1 zeigte dann 0/1/1//2 ohne Einheitknoten darunter, und der Zug zeigte seine
Verbandsstärke. Empfehlung: D3, weil das Organigramm die Gliederung der Abschnitte zeigt und das
Meldebild schon so liest.

### D4 Einheiten eines Abschnitts: dieselbe Menge wie die Stärke

`abschnittStaerke.ts` bekommt `einheitenImAbschnitt(einheiten, abschnittId)`: die aktiven
Einheiten mit diesem wirksamen Abschnitt, ohne Unterabschnitte. Daraus kommt die Zahl
„n Einheiten direkt“ am Gliederungsknoten. Auch die Liste „Zugeordnete Einheiten“ im Detail
liest diese Menge. Jede Einheit steht dort mit ihrer eigenen Stärke („eigene“ statt „kumuliert“),
sodass die Liste die „Stärke“ des Abschnitts ergibt. Eine Einheit ohne eigenen Abschnitt trägt
den Zusatz „über <Obereinheit>“. Ihr Griff trägt den wirksamen Abschnitt (Review 16.11.2026): Ziehen
auf den Abschnitt, in dem sie schon steht, ist gesperrt und schreibt keinen festen Abschnitt.

Dieselbe Menge zählt die Leiste der Lagekarte als Einheiten eines Abschnitts
(`pages/lagekarte/leistenDaten.ts`, über `einheitenImAbschnitt`).

### D5 Zeile über dem Meldebild

Die Zeile zeigt zwei Zahlen: `${p} von ${P} Kräften · ${f} von ${F} Fahrzeugen`, aus
`anzahlPersonal` und `anzahlFahrzeuge` der gefilterten und der ganzen Verdichtung. Ist eine der
beiden Listen unbekannt, steht für sie „—“ (heute steht dann die ganze Zeile auf „—“). Ist die
Mittelliste gesperrt, bleibt der vorhandene Sperrhinweis. Die Fahrzeugzahl entfällt dann, und
„Kräfte“ steht allein.

### D6 UHS-Kräfte an aktiven UHS

`lageVerdichtung.ts` exportiert `zaehltKraefteAnUhs(status)` (nur `aktiv`). `verdichteUhs` und
der Monitor (`anUhs` in `LagemonitorPage.tsx`) filtern damit. Das Lagebild schreibt
`kraefteText(n) + ' an UHS'`, also „3 Kräfte an UHS“. Der Monitor behält „3 an UHS“ in der
Titelzeile der Kachel „Kräfte“. Die Belegungsliste je UHS im Monitor bleibt unverändert und zeigt
weiter auch geplante UHS.

### D7 Regeln und Fixture

- `regeln.json`, Abschnitt `staerke`: `_regel` neu formuliert, `erwartet_abschnitte` nach D1
  (10: eigene 1/2/6, inkl. 2/2/10; 11: 0/0/2; 12: 1/0/4). Neu `erwartet_wurzeln_je_abschnitt`:
  die Einheiten-Wurzeln je Abschnitt im Kräftebild, C steht unter 11. Die Rust-Erwartung
  `erwartet_ist_kumuliert` bleibt.
- `frontend/AGENTS.md`, „Eine Heimat je Zahl“: Stärke eines Abschnitts nur über `abschnittStaerken`
  (wirksamer Abschnitt, eigene Stärke), Einheiten eines Abschnitts nur über
  `einheitenImAbschnitt`, UHS-Kräfte nur über `zaehltKraefteAnUhs`. Unter „Eine Baumlogik der
  Kräfte“ kommt `loeseAbgestellte` dazu, unter dem Organigramm die Platzierung nach D3.

### D8 Bereich des Abschnittsgeräts über den wirksamen Abschnitt (Review 16.11.2026)

`Abschnittsbereich::laden` (`src/geraet/abschnitt.rs`) wählt bisher die Einheiten mit eigenem
`abschnitt_id` im Teilbaum. Eine Untereinheit ohne eigenen Abschnitt fehlte dem Gerät deshalb in der
Liste, und seit D1 auch in der Stärke. Neu: die aktiven Einheiten, deren wirksamer Abschnitt im
Teilbaum liegt, also der eigene, sonst der der nächsten aktiven Obereinheit mit Abschnitt. Gerechnet
wird in einer Abfrage (rekursiver Aufstieg über `ueber_einheit_id`, zyklussicher über eine
Tiefengrenze). Folge: Liste, Stärke und Schreibrecht des Geräts umfassen die geerbte Untereinheit,
wie für ihre Obereinheit. Eine abgestellte Untereinheit mit eigenem Abschnitt außerhalb des
Teilbaums bleibt draußen.

*Verworfen:* Das Gerät rechnet weiter nach Unterstellung (Spec-Ausnahme, abweichende Zahl), und eine
Folgeaufgabe (ein Fehler, den der Diff einführt, wird keine Folgeaufgabe).

## Risks / Trade-offs

- **Zwei Stärken einer Einheit**: Im Meldebild zeigt der Zug nur seinen Teil im Abschnitt, im
  Einheit-Detail und in der Einheitenliste aber seine Verbandsstärke (`ist_kumuliert`). Das ist
  gewollt, denn die eine Zahl beantwortet, was im Abschnitt steht, die andere, wie stark der
  Verband ist. Der Zusatz „aus <Obereinheit>“ macht den Unterschied sichtbar.
- **Abschnittsfilter im Meldebild**: Wer „EA 1“ filtert, sieht die Gruppe nicht mehr unter dem
  Zug. Die Anwenderdoku sagt es.
- **Fehlende Obereinheit in der Liste** (Waise, aufgelöst): `einheitenBaum` macht sie schon zur
  Wurzel. `loeseAbgestellte` ändert daran nichts.
- **Zyklus in `ueber_einheit_id`**: `abschnittDerEinheit` und `einheitenBaum` sind zyklussicher.
  `loeseAbgestellte` geht nur den fertigen Baum ab.
