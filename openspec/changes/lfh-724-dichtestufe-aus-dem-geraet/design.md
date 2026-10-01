# Design

## Context

Siehe `proposal.md` für das Warum. Ausgangslage im Code:

- `frontend/src/theme/ThemeModeProvider.tsx` bestimmt die Stufe im `useState`-Initialisierer
  über `gespeicherteDichte()`. Die Funktion liest zuerst `localStorage['lifeline-hub.dichte']`
  und dann `zeigerIstGrob()` (`components/useViewport.ts`, `(pointer: coarse)`), sonst gilt
  `kompakt` (LFH-361). Einen Zuhörer auf Zeigerwechsel hat der Provider nicht. Er liegt über
  dem Router und kennt keinen Einsatz und keine Person.
- Vitest belegt die Reihenfolge mit gemocktem `matchMedia` (`ThemeModeProvider.test.tsx`,
  Blöcke LFH-329 und LFH-361). Im Browser gibt es keinen Beleg: `dichte.spec.ts` läuft ohne
  `hasTouch`, und `trefflaeche-tablet.spec.ts` setzt die Stufe über den Speicher, statt die
  Ableitung zu prüfen.
- Die Spec `bedien-arbeitsplatz` verbietet schon heute, dass ein Arbeitsplatz die
  Dichte-Vorgabe formt, und nennt die Dichte eine Eigenschaft „des Geräts“.
- Gemessen in `handschuh` sind von den 13 Zeilen „2 · Handschuh-Modus“ der sechs Prüflisten nur
  C7 (ETB, LFH-373) und C11 Tabelle 3, diese aber auf der Schwester-Route
  `/einsaetze/:id/einstellungen/module`. Die Helfer `STAFFEL`, `stelleDichte`,
  `alleHaltenStufe`, `kurzeAchseHaelt` und `gegenprobe` sind lokale Funktionen in
  `e2e/gate3-trefflaeche.spec.ts`. Diese Datei hat rund 3500 Zeilen.

## Goals / Non-Goals

**Goals:**
- Jede Hälfte der Ableitungsregel kann einen Test rot machen: Vorrang der Wahl, Zeigerart,
  Rückfall bei unbrauchbarem Wert, kein Handschuh von selbst, keine Umschaltung in der Sitzung,
  keine Personenquelle.
- Jede Fläche der sechs Prüflisten hat eine 72-px-Messung mit einer `kompakt`-Gegenprobe.
- Zeile 2 der sechs Prüflisten trägt ein Verdikt aus Messung.

**Non-Goals:**
- Kein neues Ableitungssignal (Viewport-Breite, Einsatzrolle, Funktion). Das hat der Mensch am
  01.10.2026 verworfen, siehe D1.
- Keine automatische Handschuh-Erkennung (Leitlinie: nicht belegt, Fehlschalten teurer als
  ein Schalter).
- Kein Bootstrap der Dichte in `index.html`. Das Helligkeits-Muster (LFH-397) schützt vor einem
  hellen Blitz. Die Dichte hat kein sichtbares erstes Bild vor React.
- `komfortabel` wird an den neuen Flächen nicht eigens gemessen (D5).
- Die Bedien-Leitlinie selbst bleibt eingefrorenes Archiv.

## Decisions

### D1 — Der Einsatzkontext ist das Gerät

Entscheidung des Menschen am Phase-1-Checkpoint (01.10.2026). Die Reihenfolge ist Wahl →
Zeigerart → `kompakt`, gelesen beim Sitzungsstart. `handschuh` entsteht nur durch Wahl.

Verworfen:
- **Rolle/Funktion/Führungsstelle als Quelle.** Das widerspricht `bedien-arbeitsplatz`.
  Außerdem sagt eine S-Funktion nichts über Gerät oder Hand. Eine S2 sitzt mal am Fükw und
  steht mal am Tablet.
- **Viewport-Breite als zusätzliches Signal.** Das wäre eine zweite Regel. Ein schmal
  gezogenes Desktopfenster startete dann groß. Der Mobil-Kontext ist mit `(pointer: coarse)`
  schon abgedeckt.
- **Live dem Zeiger folgen.** Das Layout spränge unter dem Finger (Prüflistenzeile 12). Die
  Leitlinie nennt Fehlschalten im Einsatz teurer als einen Schalter.

### D2 — Die Regel als reine Funktion mit Wache

`gespeicherteDichte()` wird zur reinen Funktion `startDichte(gespeichert: string | null,
zeigerGrob: boolean): Dichte` in `theme/dichte.ts`. Das ist dieselbe Bauform wie
`theme/helligkeit.ts`. Der Provider ruft sie mit `localStorage` und `zeigerIstGrob()` auf. Die
Wahrheitstafel (3 Stufen + leer + unbrauchbar) × (grob, fein) steht in `theme/dichte.test.ts`.

Eine Wache (`theme/dichteQuelle.guard.test.ts`; eigener Name, weil
`components/dichte.guard.test.ts` schon die `size="small"`-Sperre trägt) liest die Quelltexte von `dichte.ts` und
`ThemeModeProvider.tsx`. Sie macht jeden Import aus der Personen- und Einsatzachse rot
(`api/`, `auth/`, `einsatz/`, `fuehrung/`, `stab/`, `react-router`). Das ist das Muster der
übrigen `*.guard.test.ts`. Der Satz „die Person fließt nie ein“ kann damit rot werden, ohne
dass jede mögliche Quelle als Fall durchgespielt werden muss.

Alternative: die Logik inline lassen und nur über den Provider testen. Verworfen, weil dann
jede Zeile der Tafel einen Mount mit `matchMedia`-Mock braucht und die Wache keinen klaren
Gegenstand hätte.

### D3 — Kein Zuhörer, und das ist getestet

Der Provider bekommt keinen `change`-Zuhörer auf `(pointer: coarse)`. Ein Vitest-Fall feuert
auf dem gemockten `MediaQueryList` ein `change` und prüft, dass die Stufe stehen bleibt. Ein
späterer „hilfreicher“ Zuhörer wird so rot.

### D4 — Browser-Beleg der Ableitung in eigener Datei

`e2e/dichte-ableitung.spec.ts` mit `test.use({ hasTouch: true })`, denn `hasTouch` geht nur
dateiweit. Der Beleg läuft auf `/login`, ohne Anmeldung, wie `dichte.spec.ts`:

- ohne Wahl → `komfortabel`,
- Wahl `kompakt` → `kompakt` (die Gegenprobe zur Zeigerart),
- unbrauchbarer Wert → `komfortabel`,
- Wahl `handschuh` → `handschuh`.

Der Gegenfall „feiner Zeiger ohne Wahl → `kompakt`“ liegt schon in `dichte.spec.ts` und wird
nicht verdoppelt. Ein zweiter Test meldet am selben Gerät erst den Admin an, der `handschuh`
wählt, und dann eine zweite Person (`rollen-kern.ts`). Danach steht weiter `handschuh` (die
Wahl gehört zum Gerät).

### D5 — Messung: Helfer in einen Kern, neue Flächen in eine neue Datei

- **Helfer verschieben, nicht kopieren.** `STAFFEL`, `SUBPIXEL`, `stelleDichte`, `haeltStufe`,
  `alleHaltenStufe`, `kurzeAchseHaelt`, `gegenprobe`, `anmelden`, `einsatzAnlegen` und
  `anlegen` ziehen nach `e2e/trefflaeche-kern.ts`. Das ist das Muster von `rollen-kern.ts`.
  `gate3-trefflaeche.spec.ts` importiert sie und ändert sonst nichts. Ein vollständiger Lauf von
  gate3 belegt, dass das Verschieben nichts verändert hat.
- **Neue Datei `e2e/trefflaeche-pruefflaechen.spec.ts`** (LFH-724). Je Prüfliste gibt es einen
  `describe`. Jede Fläche wird in `kompakt` und `handschuh` gemessen: `handschuh` mit
  Untergrenze 72, `kompakt` für die Gegenprobe (`kompakt < handschuh` je Zielsorte). Die Stufe
  `komfortabel` belegt der Mechanismus (`dichte.spec.ts`, `trefflaeche-tablet.spec.ts`), nicht
  jede Fläche. Zwei statt drei Stufen halten die Laufzeit der Suite im Rahmen.
- **Ausnahme C11 Tabelle 1:** Die Prüfliste legt fest, dass die offene Hälfte „ein dritter
  Eintrag in `STAFFEL`“ von `verwaltung-vereinheitlicht.spec.ts` ist. Das wird genau so
  umgesetzt, nicht in der neuen Datei.
- **Rollenzweig (LFH-435, `e2e/AGENTS.md`):** Jede Fläche mit rollenabhängigen Aktionen
  bekommt ein Geschwister in `handschuh`. Kommunikation, Einsatz-Einstellungen,
  Einsatzabschnitte, Bereitstellungsraum und Lagebericht laufen als Beobachter, die Verwaltung
  als Führungskraft. Der Rechtehinweis ist Vorbedingung vor der Messung.
- **Ziele werden benannt, nicht gefegt.** Jeder Test wählt seine Ziele über Rolle bzw. Name und
  fordert eine Mindestanzahl (`alleHaltenStufe(…, mindestens)`). Ein pauschaler Fang aller
  `button, a, input` im Inhalt hätte Fließtext-Links und Tag-Schließer mitgezählt. Für die gilt
  die Abstands-Ausnahme der Leitlinie.

### D6 — Was passiert, wenn eine Messung rot ist

Ist ein Ziel in `handschuh` unter 72 px, wird es in dieser Change behoben, wenn die Ursache
lokal ist (eine Größen-Prop, eine feste Höhe, ein Stil in einer Komponente). Verlangt die
Behebung einen Umbau der Fläche, entsteht ein Folgeticket (`clickup-task-anlegen`). Die Zeile
der Prüfliste lautet dann „offen → LFH-xxx“. Die Delta-Spec wird vor dem Archiv per
`/opsx:update` um dieses Ziel gekürzt. Eine Spec, die ein bekannt rotes Ziel nennt, wird nicht
archiviert.

### D7 — Prüflisten: Nachtrag statt Umschreiben

Jede der sechs Prüflisten bekommt einen Abschnitt „Nachtrag LFH-724 (Messung, <Datum>)“ nach
dem Muster „Nachtrag LFH-373“. Darin stehen das Verdikt je Tabelle, die messende Spec mit Datei
und Testtitel und die Ableitungsregel mit Verweis auf die Spec `bedien-dichte`. In der Zeile 2
selbst wird nur das Verdikt nachgezogen und auf den Nachtrag verwiesen. Veraltete Zeilenangaben
in Zeile 2 (`dichte.spec.ts:57-83`, `einstellungen-schmal.spec.ts:195-230`,
`verwaltung-vereinheitlicht.spec.ts:66-69`) werden dabei auf Testtitel umgestellt, denn
Zeilennummern veralten.

### D8 — Befund der Messung und was diese Change davon behebt (01.10.2026)

Eine Erkundung über alle Flächen in `handschuh` (äußere Hüllen, nicht die inneren `input` von
Select und InputNumber) fand diese Ziele unter 72 px:

| Ziel | gemessen (kompakt / handschuh) | Ursache | Entscheidung |
| --- | --- | --- | --- |
| Collapse-Kopf (Lagebericht, Einsatzdaten, Befehlsdetails) | 36 / 55 | antd rechnet `2 × paddingSM + fontSize + 8` | **hier**, Token `kopfzeilenMasse` in `antdKomponenten` |
| Tab (Aufträge/Befehle) | 35,5 / 55 | wie Collapse | **hier**, dasselbe Token |
| Raumwechsler (`EinstiegSwitcher`) | 34 / 33 | `height: auto` | **hier**, `wechslerStil` mit `minHeight` |
| Schließen-× der ETB-Entwurfstabs | 15 × 24 / 15 × 24 | antds Vorgabe | **hier**, `removeIcon` mit `entfernenStil` |
| beschriftete Checkbox | 21,5 / 36 | kein antd-Token für die Hülle | Folgeticket **LFH-907** |
| Kennungs-Link in Tabellenzellen | 13–17 / 13–17 | `<a>` erbt keine Steuerhöhe | Folgeticket **LFH-908** |
| Brotkrume im Seitenkopf | 20 / 20 | 12-px-Ortspfad | Folgeticket **LFH-909** |
| Löschkreuz eines Select | 12 / 12 | antds Vorgabe | benannte Ausnahme: das Feld ist das gleichwertige Ziel |

Entscheidung des Menschen am 01.10.2026: lokal und über Token beheben, den Rest als Folgetickets.
Die Token-Korrektur folgt dem Muster `switchMasse` (LFH-380). Sie wirkt app-weit, weil jeder
Collapse-Kopf und jeder Tab ein Bedienziel ist. Das Polster wächst nur so weit, dass die
Steuerhöhe erreicht wird, und nie unter `paddingSM`. `kompakt` bleibt unverändert, und
`komfortabel` steigt von 45 auf 48 px. Für die neuen Ziele gilt in `kompakt` der Boden aus Gate 3
(24 px), nicht 30, denn ein Baumknoten trägt dort 24 px.

Zwei Annahmen aus D5 trafen nicht zu und sind in den Tests angepasst: Die Segmente der
`Segmentleiste` sind `radio`/`tab`, nicht `button`. „Einsatz-Vorgaben“ zeigt der Führungskraft
„Speichern“ gesperrt statt gar nicht, also ist dort „gesperrt“ die Vorbedingung. Der
Beobachter bekommt den Lagebericht als Leseansicht ohne Akkordeon. Gemessen wird dort die
Druckaktion. Die „Aktionen der Belegungsliste“ im BR-Detail fallen aus der Delta-Spec heraus,
weil sie ohne vorherige Zuweisung nicht stehen und die Zuweisung selbst gemessen ist.

## Risks / Trade-offs

- [Die Suite wird länger: rund 20 neue Tests mit Anmeldung und Seed] → zwei Stufen statt drei
  (D5), Seeds über die API statt über die Oberfläche, Rollen-Geschwister nur in `handschuh`.
- [Eine Fläche fällt in `handschuh` durch, und die Behebung wächst] → D6: lokal beheben oder
  Folgeticket plus gekürzte Spec. Kein stilles Weglassen eines Ziels aus dem Test.
- [Das Verschieben der Helfer bricht gate3 unbemerkt] → gate3 läuft vor und nach dem
  Verschieben vollständig. Das Verschieben ist ein eigener Commit ohne Verhaltensänderung.
- [Die Messung unter Last ist unzuverlässig (LFH-398)] → vor jedem e2e-Lauf `uptime` prüfen.
  Ein roter Lauf unter Last wird mit `--workers=1` wiederholt, nicht weginterpretiert.
- [Die Personen-Wache ist eine Quelltext-Wache und erkennt keinen indirekten Import über einen
  Zwischenmodul] → Die Wache prüft beide Dateien. `dichte.ts` darf nur `./tokens` importieren.
  Ein Zwischenmodul fiele damit als unbekannter Import auf.
