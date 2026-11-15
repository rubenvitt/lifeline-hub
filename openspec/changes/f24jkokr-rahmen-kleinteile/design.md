# Design

## Context

Motivation: proposal.md, „Why“. Der Weg ist mit dem Menschen am 15.11.2026 abgestimmt; je Punkt
standen drei Varianten zur Wahl, gewählt wurde jeweils die erste unten.

Stand im Code:

- `einsatz/EinsatzLayout.tsx`, `onKategorieKlick`: Ein Fremdklick setzt `sprungOffen` (Panel offen
  für die Sitzung, ohne Wahl zu schreiben) und springt nach `erstesFreigegebenesModul`. `sprungOffen`
  gewinnt auch gegen eine gemerkte Wahl „zu“ (`panelEingeklappt = sprungOffen ? false : panelZu(…)`).
- Merker gibt es schon drei, alle über `lib/sichererSpeicher`, alle in `GERAETESPEICHER`:
  `zuletztModule.ts` (Wahlen, je Person und Einsatz, 12 h), `letzterOrt.ts` (Ankünfte, je Person,
  12 h), `navPersistenz.ts` (Panel-Wahl, global).
- `IconRail.tsx`: Die Spalte `rail-spalte` klebt bei `top: var(--lfh-rahmen-oben)` und ist
  `100dvh − --lfh-rahmen-oben` hoch. `--lfh-rahmen-oben` zählt ab `md` nur den Kopf. Was im Fluss
  über der Rail steht (die Betriebszeile aus `live/LiveStatusBanner.tsx` ab `md`, das `SpiegelBand`,
  die Warnung zu den Modulfreigaben), schiebt die Spalte bei Rollstand 0 um seine Höhe nach unten.
  Der Fuß liegt dann unter dem Fensterrand. Der Kommentar dort beschreibt das als bekannt.
- `ModulPanel.tsx`, `modulBeschreibungStil`: eine Zeile, `nowrap` und `ellipsis`. Die
  Modulliste (`ModulListe`) nutzen Panel (208 px) und Drawer-Akkordeon gemeinsam.
- `theme/tokens.ts`, `navDrawerBreite = 280`; der Drawer hat 24 px Polsterung.
- `geraet/GeraeteKopf.tsx`, `KopplungsEnde`: `bis ${zeitKurz(…)}`, bald `endet …`. In der
  taktischen Darstellung ergibt das „bis 131757“.

## Goals / Non-Goals

**Goals:**

- Jeder Punkt mit einem Test, der ohne die Änderung rot wird.
- Kleiner Diff in `EinsatzLayout.tsx`, `IconRail.tsx` und `ModulPanel.tsx`, denn LLH-1727, LLH-1732
  und LLH-1733 ändern dieselben Dateien.

**Non-Goals:**

- Kein Umbau des Rahmens (fester Rahmen mit rollendem Inhalt ist LLH-1727). Wählt LLH-1727 einen
  Rollbehälter, entfällt D3 dort wieder; die Anforderung „Der Rail-Fuß bleibt im Fenster“ bleibt
  bestehen.
- Die Sprungpalette bleibt einzeilig.
- Keine Restzeit in der Geräteliste der Einstellungen („bis …“ dort bleibt, dort steht die Spalte
  mit Überschrift).

## Decisions

### D1 Rail-Gedächtnis: eigener Merker, gefüllt bei jeder Ankunft

Neue Datei `einsatz/kategorieModul.ts` nach dem Muster von `zuletztModule.ts`: Schlüssel
`lfh:nav:kategorie-modul:<benutzer>:<einsatz>`, Wert `{ [kategorie]: { key, at } }`, Frist
`ZULETZT_FRIST_MS` (12 h), jeder Zugriff über `sicherLesen`/`sicherSchreiben`.

- **Schreiben** im Layout-Effekt von `EinsatzRahmen`, neben `merkeLetztenOrt` und unter derselben
  Bedingung `merkbar` (Benutzer da, Einsatz geladen, Freigaben geladen, Modul nicht gesperrt). Die
  Ankunft zählt, nicht die Wahl: gefragt ist „wo war ich in dieser Kategorie“ (wie `letzterOrt`).
- **Lesen** in `onKategorieKlick`: Die Funktion `rueckkehrModul(kategorie, freigaben, gemerkt)`
  nimmt das gemerkte Modul nur, wenn es in der Registry steht, zur Kategorie gehört und laut
  `istModulAusblendbar`/`istModulGesperrt` erreichbar ist; sonst `erstesFreigegebenesModul`. Rein
  und ohne Speicherzugriff, damit sie ohne Rendern prüfbar ist.
- „Zuletzt besucht“ der Palette bleibt unberührt: `merkeModulBesuch` wird weiterhin nur in
  `onModulKlick` gerufen.
- Gemerkt wird nur der Modulschlüssel, nicht die Unterseite (abgestimmt): ein Datensatz könnte
  inzwischen fehlen.

Verworfen: (a) volle Adresse merken, (b) nur im React-State. Ein Neuladen oder ein zweiter Tab
vergäße das, und am Fükw wird oft neu geladen. (c) Die Liste aus `zuletztModule` nutzen: Sie zählt
nur Wahlen und hält höchstens drei Einträge über alle Kategorien.

`GERAETESPEICHER` (`offline/geraetRaeumung.ts`) bekommt den Eintrag mit `bleibt`: nur
Modulschlüssel, schon je Benutzer getrennt (wie `lfh:nav:zuletzt:`). Der Wächter
`geraetRaeumung.guard.test.ts` verlangt den Eintrag.

### D2 Panel-Wahl hält beim Rail-Sprung

In `onKategorieKlick` wird `sprungOffen` nur noch gesetzt, wenn `navWahl === null`. So gilt nach
der Spec „eine gemerkte Wahl auf jeder Breite“, und am Tablet quer ohne Wahl öffnet der Sprung das
Panel weiter (LFH-952). Weg zurück zur Liste bleibt der Griff „Menü“.

### D3 Rail-Spalte zieht den Vorlauf ab

Der **Vorlauf** ist, was im Fluss über der Rail steht: der Abstand der Oberkante von `<nav>` im
Dokument minus `--lfh-rahmen-oben`. `IconRail` misst ihn selbst (`getBoundingClientRect().top +
scrollY`), beim Einhängen und danach je Bild, wenn sich die Größe von `document.body` ändert
(`ResizeObserver`, geschrieben im nächsten Bild wie in `rahmenOben.ts`, LLH-1335). Die Spalte wird
`calc(100dvh − var(--lfh-rahmen-oben) − <vorlauf>px)` hoch.

- Gemessen statt aus der Betriebszeile gemeldet: so zählen auch `SpiegelBand` und die
  Freigaben-Warnung, die dasselbe tun. Abgestimmt war „Band-Höhe abziehen“; das ist die allgemeine
  Form davon, ohne mehr Code.
- Gerollt ist die Spalte dann um den Vorlauf kürzer als nötig. Darunter steht der dunkle Grund des
  `<nav>`, der Rest fällt nicht auf. Ohne Band ist der Vorlauf 0 und alles wie heute.
- Verworfen: die Betriebszeile ab `md` mitkleben lassen (Regeländerung, kostet dauerhaft Höhe), den
  Fuß unten ankleben (in LLH-1273 verworfen, er überdeckt Kategorien).

### D4 Beschreibung in zwei Zeilen

`modulBeschreibungStil` setzt `display: -webkit-box`, `WebkitLineClamp: 2`,
`WebkitBoxOrient: 'vertical'`, `whiteSpace: 'normal'` und `overflow: hidden`. Das wirkt in Panel
und Drawer gleich (gemeinsame `ModulListe`). Der `title` bleibt. Die Zeile kann dadurch höher
werden. Das ist gewollt, die Trefffläche wächst mit.

### D5 Drawer-Breite

`navDrawerBreite` wird zu `'min(360px, calc(100vw - 48px))'`. Nimmt antds `size` keinen
CSS-Ausdruck, steht die Breite stattdessen in `styles.wrapper.width`. Das klärt die Umsetzung am
Typ von antd 6. Wächter ist ein e2e-Maß bei 390 × 844 (342 px).

### D6 Kopplungsende als Restzeit

Die reine Funktion `kopplungRestText(laeuftAbAt, jetzt)` liefert ab 60 min `noch N h` (ganze
Stunden, abgerundet: lieber zu früh gewarnt), darunter `noch N min` (aufgerundet, mindestens 1).
Nach dem Ende kommt `endet` (kurz, bis die Hülle auf „Kopplung beendet“ wechselt). Sichtbar steht
„Kopplung noch 5 h“. `title` und `aria-label` lauten „Kopplung bis <zeitpunkt>“ mit `zeitpunkt` in
der Konvention der Hülle, bald ergänzt um „Verlängern: Einsatzleitung“. Die Hervorhebung unter
einer Stunde bleibt (`kopplungEndetBald`). Takt: `useMinutenTakt` wie bisher.

Verworfen: nur das Wort „Kopplung“ vor die DTG. Das bleibt für viele unlesbar. Immer Klartextzeit:
weicht von der Einsatzkonvention ab.

## Risks / Trade-offs

- [Konflikte mit LLH-1727/1732/1733] → Änderungen je Datei auf wenige Zeilen begrenzt. Wer zuletzt
  mergt, holt `alpha` und löst die Konflikte im eigenen Branch.
- [Messung des Vorlaufs flackert beim Rollen] → Sie hängt nicht am Rollstand, nur an Größen; ein
  `ResizeObserver` auf `body` feuert beim Rollen nicht.
- [Zwei-Zeilen-Beschreibungen machen das Panel länger] → Bei 208 px brechen etwa die Hälfte der
  Beschreibungen um. Die Rail-Kategorie Kräfte hat die meisten Module; das Panel rollt in sich, wie
  heute bei Handschuh-Dichte.
- [Restzeit abgerundet auf Stunden] → „noch 1 h“ heißt 60–119 min. Darunter schaltet die Anzeige auf
  Minuten und Hervorhebung um.

## Migration Plan

Keine Daten. Der neue Speicherschlüssel entsteht beim ersten Besuch; ohne ihn gilt das bisherige
Verhalten.
