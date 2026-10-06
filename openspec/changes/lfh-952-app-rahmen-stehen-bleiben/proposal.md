## Why

Der Rahmen der App (Kopfleiste, Rail, Modulpanel, Benutzermenü) steht auf jeder Seite und
versagt heute dort, wo Einsatzkräfte lange lesen oder am geteilten Gerät wechseln:

- **Beim Rollen verschwindet alles.** Der Kopf ist `position: static`. Nach 1500 px im ETB sind
  Navigation, Suche, Alarmzentrale, Benutzermenü und die SYNC-/OFFLINE-Anzeige weg, auch die
  Betriebszeile „Offline — keine Verbindung zum Server.“ rollt mit. Wer liest, hält einen
  veralteten Stand für aktuell.
- **„Abmelden“ liegt unter dem Rand.** Das Benutzermenü ist in `komfortabel` 920 px hoch,
  sichtbar sind am Handy 702 px. Profil und Abmelden stehen ganz unten, die eigene
  Einsatzfunktion steht unter `xl` nirgends. Am geteilten Gerät entstehen so Einträge unter
  fremdem Namen.
- **Am Tablet quer ist der Inhalt zu schmal.** Rail und Modulpanel nehmen ab `lg` 268 px; im
  Überblick bricht der Stärkeblock einer Abschnittszeile unter den Namen, eine Zeile wird
  215–265 px hoch. Einen sichtbaren Griff zum Einklappen gibt es nicht.

Die Klärungsrunde vom 06.10.2026 hat das Verhalten festgelegt (Entscheidung 6, Option A):
gestuft — ab Tablet bleiben Kopfleiste und Rail-Symbole stehen, am Handy nur die Offline- bzw.
Störungszeile; am Tablet quer ist das Modulmenü zugeklappt, mit sichtbarem Griff, eine eigene
Wahl wird gemerkt.

## What Changes

- **Kopf klebt ab `md`** in beiden Layouts (`EinsatzLayout`, `AppLayout`), die Kategorie-Symbole
  der Rail kleben ab `lg` darunter. **Unter `md`** rollt der Kopf, die Betriebszeile
  (`LiveStatusBanner`) klebt, solange sie eine Verbindungsstörung meldet (offline oder
  Live-Verbindung verloren).
- **Eine gemessene Höhe für alles, was oben klebt** (`--lfh-rahmen-oben`): stehende
  Tabellenköpfe, die Bilanzspalte des ETB und die Sammelbanner hängen sich darunter, statt unter
  dem Kopf zu verschwinden. Fokusziele der Seite halten denselben Abstand (WCAG 2.4.11), die
  Ziele im Kopf selbst sind ausgenommen.
- **Benutzermenü:** Profil und Abmelden direkt unter dem Kopf, danach Darstellung,
  Bediendichte, Helligkeit (die fünf Stufen bleiben Einträge, Spec `bedien-helligkeit`). Die
  Einsatzfunktion steht im Menükopf, auf jeder Breite.
- **Modulpanel:** sichtbarer Griff „Menü“ in der Rail mit `aria-expanded`; die offene Kategorie
  trägt `aria-expanded`. Ohne gemerkte Wahl ist das Panel zwischen `lg` und `xl` zugeklappt,
  ab `xl` offen; eine Wahl gilt auf jeder Breite.
- **Überblick:** Die Abschnittszeile stellt bei schmalem Paneel Name und Stärke nebeneinander
  und rückt Auftrag und Fortschritt darunter.
- **Regel** im Abschnitt „Rahmen“ von `frontend/AGENTS.md`: was beim Rollen stehen bleibt, und
  dass jedes oben klebende Element `--lfh-rahmen-oben` liest.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `einsatztauglichkeit-layout`: neue Anforderungen „Der Rahmen bleibt beim Rollen erreichbar“
  und „Benutzermenü: Abmelden ohne Rollen“; „Kein Fokusziel vollständig verdeckt“ nennt den
  klebenden Kopf.

## Impact

- Frontend: `einsatz/EinsatzLayout.tsx`, `einsatz/IconRail.tsx`, `einsatz/ModulPanel.tsx`,
  `einsatz/navPersistenz.ts`, `components/AppLayout.tsx`, `components/Kopfleiste.tsx`,
  `components/BenutzerMenu.tsx`, `live/LiveStatusBanner.tsx`, `components/KatalogTabelle.tsx`,
  `pages/gefahren/`, `pages/EtbPage.tsx`, `etb/EtbZeitachse.tsx`, `pages/InfotelefonPage.tsx`,
  `components/erfassungsAnhaenge/ErfassungsAnhaenge.tsx`, `pages/fuehrung/UeberblickPage.tsx`,
  `index.css`, `theme/sprache.css`.
- e2e: neue Spec `e2e/rahmen-stehen-bleiben.spec.ts`, Erweiterung `e2e/fokus-verdeckung.spec.ts`.
- Kein Backend, keine Migration, keine API.
- Nicht in diesem Change: Ortspfad, Seitentitel und Rückweg (eigener Task „Orientierung“),
  Helligkeit als Segmentleiste (bräuchte eine eigene Änderung an `bedien-helligkeit`).
