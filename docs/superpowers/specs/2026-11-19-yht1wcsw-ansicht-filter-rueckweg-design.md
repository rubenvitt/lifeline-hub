# Ansicht, Filter und Rollposition überleben den Rückweg — Design

- Aufgabe: LLH-1826 (Unteraufgabe von LLH-1812, Welle 3)
- Zunder: https://zunder.rubeen.dev/#/aufgabe/yht1wcswlcg5a7r8n3dliegx
- Route: `entwurf` (E1 mehrere Wege, E2 Regeländerung)
- Lösungsweg abgestimmt am 19.11.2026; dieses Dokument hält ihn fest.

## Absicht

Eine Einsatzkraft stellt eine Liste ein (Meldungen „Extern“, Betroffene im Sichtungsraster,
Aufträge „abgeschlossen“), rollt zu Zeile 40, öffnet etwas und geht zurück. Heute steht dann die
Vorgabe da, und die Seite steht wieder oben. Sie muss neu einstellen und neu suchen, und im
Zweifel liest sie die Lage aus der falschen Sicht ab. Nach dem Zurück soll die Seite so aussehen
wie beim Verlassen.

## Heute

- **In der Adresse** (überlebt Zurück und Neuladen): ETB-Filter (`etbFilterPfad`), Reiter der
  Aufträge (`?reiter=`), Funkplan-Ansicht, Ablösung-Ansicht, UHS-Bereich, Lagemeldungen-Zeitraum,
  Nachforderungen-Stelle, Überblick-Vorgänge, dazu Sortierung, Spaltenfilter und Suche der
  Tabellen über `useListenGedaechtnis` (LLH-1086/1096).
- **Nur in `useState`** (geht beim Verlassen verloren): siehe Inventar unten. Personen, Fahrzeuge
  und Abschnitte lesen `?ansicht=`/`?filter=` als einmaligen Auftrag einer Sprungmarke und räumen
  ihn dann aus der Adresse (apply-then-clean, `frontend/AGENTS.md`, Sprungmarken).
- **Rollposition:** nichts stellt sie wieder her, kein `ScrollRestoration`, kein
  `history.scrollRestoration`. Am Stab rollt das Dokument. Die Daten kommen per React Query erst
  nach dem ersten Zeichnen; die Seite ist beim Zurück erst kurz, und der Browser klemmt die
  Position auf 0.

## Ziele

1. Ansicht und Filter jeder Einsatzseite stehen in der Adresse und überleben Browser-Zurück,
   Vorwärts, Neuladen und Lesezeichen.
2. Beim Browser-Zurück und -Vorwärts steht die Seite wieder auf der Rollposition, die sie beim
   Verlassen hatte, auch wenn die Daten erst nachkommen.
3. Eine neue Navigation (Link, Modulmenü, Sprungpalette) beginnt oben.

## Nicht-Ziele

- **Kein Sitzungsgedächtnis für Ansicht und Filter.** Wer über das Modulmenü neu einsteigt,
  beginnt ungefiltert (Entscheidung 19.11.2026). Ein vergessener Filter wie „Extern“ soll keine
  Meldungen verstecken. `useListenGedaechtnis` bleibt, wie es ist.
- Archiv-ETB (`ArchivAktePage`), Neuigkeiten, Gerätehülle (rollt im `main`, eigene Seiten),
  Aufklappzustände (Bäume, Ausklappstufen der Kräfteübersicht und der Nachforderungen,
  eingeklappte Blöcke), Chat-Kanalwahl, Lagekarte (eigene Leistenwahl im Speicher, rollt nicht im
  Dokument).
- Kein neuer Schalter Tabelle ↔ Karte (LFH-507 bleibt).

## Anti-Ziele

- Jeder Klick auf einen Filter legt einen Verlaufseintrag an, sodass „Zurück“ durch die Filter
  statt aus der Seite führt.
- Die Wiederherstellung reißt die Seite herum, nachdem die Person schon selbst gerollt, getippt
  oder per Sprungmarke ein Ziel angesteuert hat.
- Namen von Betroffenen landen in der Adresse (Verlauf, Lesezeichen, geteilte Links).

## Ansätze

**Ansicht und Filter**

- **A1 Nur Adresse (gewählt).** Jeder Wert ist ein Query-Parameter, geschrieben mit `replace`;
  die Vorgabe steht nicht in der Adresse. Trägt Zurück, Neuladen, Lesezeichen und Teilen. Ein
  Neueinstieg über das Modulmenü beginnt mit der Vorgabe.
- A2 Adresse plus Sitzung, wie `useListenGedaechtnis`: Ein Neueinstieg stellt den letzten Stand
  wieder her. Verworfen, weil ein vergessener Filter Daten versteckt und die Lage dann falsch
  gelesen wird.

**Rollposition**

- **R1 Eigener Wiederhersteller (gewählt).** Er merkt die Position je Verlaufseintrag
  (`location.key`) in `sessionStorage`. Beim POP wartet er, bis die Seite hoch genug ist,
  höchstens etwa 2 s, und gibt auf, sobald die Person selbst eingreift.
- R2 `ScrollRestoration` von react-router. Verworfen: Es stellt sofort nach dem Zeichnen wieder
  her. Ohne warmen Cache ist die Seite dann noch zu kurz, und die Position landet trotzdem bei 0.
  React Query lädt nicht über Loader, auf die `ScrollRestoration` wartet.

## Entwurf

### D1 Ein Baustein für einen Wert in der Adresse

Neuer Hook in `frontend/src/routing/` (Name nach LLH-1312, etwa `useAdressWert`):

```ts
const [richtung, setzeRichtung] = useAdressWert('richtung', RICHTUNG_ERLAUBT, 'alle');
```

- Liest einen Wert aus `useSearchParams`. Ein unbekannter Wert gilt als Vorgabe, wie bei
  `parseEtbFilter` (exhaustiver `Record<T, true>`).
- Schreibt mit `setSearchParams(alt => …, { replace: true })`. Die Vorgabe löscht den
  Parameter, fremde Parameter bleiben.
- Eine Variante für Wahrheitswerte (`=1` oder fehlt) und eine für Zahlen-IDs (über
  `parseRouteId`). Ob das ein Hook mit Kodierer oder drei kleine Hooks sind, entscheidet der
  Plan.
- Die Erlaubt-Records und Vorgaben liegen je Seite in `routing/deeplinks.ts`, neben den
  bestehenden Parsern (Quelle der Wahrheit für Adressen). Bestehende Parser wie
  `parseFahrzeugeAnsicht`, `parsePersonenSicht` und `parseAbschnitteAnsicht` werden
  weiterverwendet.

### D2 Freitext entprellt in der Adresse

Die Suchfelder halten ihren Text lokal und schreiben ihn entprellt in die Adresse,
`GEDAECHTNIS_ENTPRELLUNG_MS` (300 ms), mit `replace`. Ändert sich der Parameter von außen
(Zurück, Link), setzt das Feld neu auf (`frontend/AGENTS.md`, „Filterleiste nur bei fremder
Änderung neu aufsetzen“). Der Parameter heißt `q`, außer die Seite trägt schon ein
`useListenGedaechtnis` mit Suche in der Adresse; dann gibt es nur dieses eine `q`. **Personen
bleiben ausgenommen** (Suche nie in der Adresse, `frontend/src/personen/AGENTS.md`).

### D3 Die Stellen (Schnitt: alle Einsatzmodule plus Einsatzliste)

| Seite | Zustand | Parameter (Vorschlag) |
| --- | --- | --- |
| Meldungen (`MeldungenPage`, `MeldungenSchmal`) | offen/abgeschlossen, Richtung | `sicht=abgeschlossen`, `richtung=intern\|extern` |
| Aufträge (`AuftraegeListe`) | offen/abgeschlossen, Richtung, Empfänger, Suche | `sicht`, `richtung`, `empf`, `q` |
| Befehle (`BefehlListe`) | Status-Segment, Empfänger, Suche | `befehle_sicht`, `befehle_empf`, `befehle_q` (eigene Namen, D3a) |
| Betroffene (`PersonenPage`) | Ansicht, Filter, nur Lücken, abgeschlossen | `ansicht`, `filter`, `luecken=1`, `abgeschlossen=1` |
| Fahrzeuge | liste/tableau | `ansicht=tableau` |
| Einsatzabschnitte | gliederung/organigramm | `ansicht=organigramm` |
| Kräfteübersicht | Abschnitt, Träger, Kategorie, Suche, ohne Auftrag, Rückmeldung fehlt | `abschnitt`, `traeger`, `kategorie`, `q`, `ohne_auftrag=1`, `rueckmeldung_fehlt=1` |
| Material | Gruppierung | `gruppierung=status` |
| Lagemeldungen | Ort, Herkunft, Suche | `ort`, `herkunft`, `q` |
| Erinnerungen | offen/abgeschlossen | `sicht=abgeschlossen` |
| Infotelefon | alle / offene Rückrufe | `sicht=rueckrufe` |
| Schäden | Status-Segment | `sicht` |
| Tiere | aktiv/vermisst/abgeschlossen/alle | `sicht` |
| Verpflegung | laufend/vergangen/stellen | `ansicht` |
| Ablösung | abgelöst/beendet | `vergangen` |
| Unterkunft planen | rechner/richtwerte | `ansicht` |
| Einsatzliste (`EinsaetzePage`) | Suche | `q` |

Die Namen der Parameter dürfen nicht mit Deeplink-Parametern derselben Seite kollidieren
(`meldung`, `auftrag`, `befehl`, `reiter`, `eintrag`, `neu`, `person`, `einheit`, `personal`)
und nicht mit `sort` oder `f.*` des Listengedächtnisses. Wo ein Wert eine Kennung ist
(Abschnitt), wird eine unbekannte oder ungültige Kennung verworfen. Die Muster `…NachEinsatz`
(`Record<einsatzId, …>`) entfallen, wo die Adresse den Zustand trägt: Eine andere `einsatzId`
ist eine andere Adresse.

### D3a Aufträge und Befehle teilen sich eine Adresse (Entscheidung des Planers)

`AuftraegePage` hält beide Listen zugleich montiert; der Reiter schaltet nur die Sichtbarkeit.
Deshalb bekommen die Befehle eigene Parameter mit dem Vorsatz `befehle_`. Eine Suche in einem
Reiter filtert den anderen nicht.

Das Status-Segment der Befehle hat keine feste Vorgabe: Ohne Wahl gilt wie heute „Entwürfe“, wenn
der erste Datenstand einen Entwurf enthält, sonst „Freigegeben“. Eine ausdrückliche Wahl wird
deshalb **immer** geschrieben, auch wenn sie gerade der abgeleiteten Vorgabe entspricht. Sonst
zeigte das Zurück nach der Freigabe des letzten Entwurfs still eine andere Sicht. Der Baustein
aus D1 braucht dafür einen Modus ohne Vorgabe. Setzt der Deeplink `?befehl=` das Segment, wird
das ebenfalls als Zustand geschrieben (`replace`).

### D3b Gerätehülle (Entscheidung des Planers)

`VerpflegungPage` ist auch in der Gerätehülle montiert. Der Baustein schreibt dort genauso in die
Adresse; das schadet nicht und braucht keinen Schalter. Ausgenommen ist die Gerätehülle nur vom
Wiederhersteller der Rollposition (D5), weil dort das `main` rollt.

### D4 Personen, Fahrzeuge, Abschnitte: von „Auftrag“ zu „Zustand“ (Regeländerung, E2)

`?ansicht=`, `?filter=` und `?abgeschlossen=` sind künftig der Zustand der Seite und werden nicht
mehr geräumt. Die Sprungmarken („Patienten“ → `ansicht=raster`, „Vermisste“ → `filter=vermisst`)
bleiben gültige Adressen und zeigen genau ihre Sicht. Das Zusammenführen mit der bisherigen Sicht
(`sichtNachSprung`) entfällt: Was nicht in der Adresse steht, gilt als Vorgabe. `useLinkAuftrag`
bleibt für `?neu=1` und die übrigen Einmal-Aufträge.

### D5 Rollposition wiederherstellen

Eine Komponente an der Wurzel des Stab-Rahmens (`AppLayout`, nicht in der Gerätehülle):

- `history.scrollRestoration = 'manual'`, solange sie montiert ist.
- **Merken:** Beim Verlassen eines Verlaufseintrags (Wechsel von `location.key`) und bei
  `pagehide` schreibt sie `window.scrollY` unter dem alten `location.key` in `sessionStorage`
  (über `lib/sichererSpeicher` bzw. dessen Sitzungsform, Eintrag in `GERAETESPEICHER`). Höchstens
  etwa 50 Einträge, die ältesten fallen heraus.
- **POP** (`useNavigationType() === 'POP'`, Zurück, Vorwärts, Neuladen): Ist eine Position
  gemerkt, rollt sie dorthin, sobald `document.documentElement.scrollHeight` reicht. Bis dahin
  beobachtet sie das Wachsen (`ResizeObserver` am Dokument). Sie gibt auf nach etwa 2 s, bei
  `wheel`, `touchstart`, `keydown` oder `pointerdown`, und wenn die Seite selbst ein Ziel
  ansteuert (Deeplink `?eintrag=`, `?meldung=`, Zeilenmarke). Reicht die Höhe nach 2 s nicht,
  bleibt die Seite, wo sie ist (kein halbes Rollen).
- **PUSH:** nach oben. **REPLACE** (Filterwechsel, Reiter): nichts tun.
- Ohne `sessionStorage` (gehärteter Rechner) wirkt sie nur innerhalb der Sitzung im Speicher, ohne
  Fehler.

Wie die Seiten „ich steuere selbst ein Ziel an“ melden, entscheidet der Plan. Vorschlag: Die
Wiederherstellung unterbleibt, wenn die Adresse einen der Deeplink-Parameter aus
`routing/deeplinks.ts` trägt. Dann braucht es keinen Zuruf aus jeder Seite.

### D6 Regeln und Doku

- `frontend/AGENTS.md`, „Deeplink-Muster“: Die Regel „Filter gehören in die URL“ wird zu
  „Ansicht und Filter gehören in die Adresse“. Sie gilt für jede Einsatzseite, kennt keinen
  Sitzungsspeicher und nennt den Baustein aus D1. Dazu ein Absatz zur Rollposition (D5).
- `frontend/AGENTS.md`, Sprungmarken: „apply-then-clean“ für `parsePersonenSicht` ersetzen (D4).
- Bereichsdateien, die eine betroffene Stelle anders beschreiben, mitziehen (`personen`,
  `kraefte`, `infotelefon`, `fernmeldewesen`, wo nötig). Vorher mit `scripts/adr-fuer.sh` und
  `grep` prüfen, ob eine ADR „Ansicht ist Seitenzustand“ festschreibt.
- Anwenderdoku: Wo ein Kapitel beschreibt, dass eine Sicht beim Wiederkommen zurückgesetzt ist,
  mitziehen (`docs/anwender/AGENTS.md`, Mitänderungsregel).

## Prüfung

- Vitest je Seite: Die Wahl steht nach dem Klick in der Adresse, eine Adresse mit dem Wert zeigt
  die Wahl, die Vorgabe fehlt in der Adresse, ein unbekannter Wert gilt als Vorgabe.
- Vitest für den Hook (Kodierung über `URLSearchParams` hin und zurück, fremde Parameter bleiben).
- Vitest für den Wiederhersteller mit Fake-Timern: POP rollt erst, wenn die Höhe reicht; eigene
  Eingabe bricht ab; PUSH rollt nach oben; REPLACE nicht.
- e2e (eine Spec): Meldungen „Extern“ und Betroffene „Raster“, rollen, weg, Browser-Zurück. Sicht
  und Rollposition stehen wieder (die Zahlen 1400 und 0 aus der Aufgabe).

## Offen zur Freigabe

1. **Rückweg über den Ortspfad.** Der Ortspfad einer Detailseite (etwa Person → „Betroffene“)
   verlinkt heute auf die nackte Liste. Mit A1 landet er dort ungefiltert und oben. Vorschlag:
   außerhalb dieser Aufgabe lassen und als Folgeaufgabe führen. Die Aufgabe sagt „Zurück“, und
   der Browser-Weg trägt beides. Alternative in diesem PR: Der Link zur Detailseite trägt die
   Listenadresse im History-State (`von`, wie die Hilfe), und der Ortspfad geht per `navigate(-1)`
   zurück, wenn der vorige Eintrag genau diese Liste ist. Das stellt auch die Rollposition wieder
   her.
2. **Parameternamen** wie in D3 (deutsch, kurz, Werte wie in der Oberfläche). Ein Einwand vor dem
   Plan ist billiger als danach.

## Dem Plan überlassen

- Schnitt des Hooks (D1), Reihenfolge der Seiten, ob `MeldungenSchmal` und `MeldungenPage`
  denselben Zustand teilen (sie sollen).
- Wie der Wiederhersteller erkennt, dass eine Seite selbst ein Ziel ansteuert (D5, Vorschlag
  steht).
- Bilder: Meldungen „Extern“ nach dem Zurück, Betroffene im Raster nach dem Zurück, mit der
  Adresse sichtbar.
