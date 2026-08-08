# LFH-336 · C1 — Lage-Dashboard und Einsatzauswahl: vom Zähler zum Lagebild

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> oder superpowers:executing-plans, um diesen Plan Task für Task umzusetzen. Schritte tragen
> Checkbox-Syntax (`- [ ]`).

**Goal:** Das Lage-Dashboard beantwortet die Führungsfrage „Was ist los?" ohne Seitenwechsel, und die
Einsatzauswahl davor zeigt Ort und Beginn statt vier von 21 Feldern — beides tastaturbedienbar.

**Architecture:** Vier getrennte Schnitte auf zwei Seiten. Die Bedeutung wandert in die Datenschicht
(`lagebild.ts`), die Seiten rendern nur. Der Live-Verbindungszustand bekommt **eine** Lesequelle
(Modul-Store nach dem Muster von `pwa/appAktualisierung`), damit Band und Betriebszeile nicht
auseinanderlaufen. Alle Sprungziele laufen über `routing/deeplinks.ts`.

**Tech Stack:** React 19, TypeScript, antd 6, TanStack Query v5, react-router, Vitest + RTL + msw.

---

## Global Constraints

Aus CLAUDE.md und dem Ticket — gelten für **jeden** Task:

- **Keine Inline-Template-Literale für Einsatz-Pfade.** Alles über `frontend/src/routing/deeplinks.ts`.
- **`pnpm lint` läuft mit `--max-warnings 0`.** Warnungen werden an der Wurzel behoben, nicht
  per `eslint-disable` erschlagen.
- **Kein neues punktuelles `size="small"`** auf interaktiven Elementen (`components/dichte.guard.test.ts`).
- **Zwei Quellen, eine Wahrheit:** handgeschriebenes CSS liest `var(--lfh-*)`, TSX liest
  `theme.useToken()`. Nie gemischt.
- **Rot bedient nichts.** Statusfarben nur aus `theme/tokens.ts` / `theme/rollen.css`, jede Farbe
  braucht einen zweiten Kanal (Text/Symbol/Form, WCAG 1.4.1).
- **Ein Emoji ist keine Ikone.** Bildzeichen kommen aus `@ant-design/icons`, in einer
  `aria-hidden`-Hülle (der Icon-Knoten bringt sonst ein englisches `role="img"`-Label mit).
- **jsdom rechnet kein Layout.** Geprüft wird der Prop-/Style-Wert im Quelltext oder die Klasse,
  nie ein Pixel.
- **Testkommando** (immer absolute `-C`-Pfade, mise-Wrapper):
  ```bash
  mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/dev-clickup-execution-eed38c/frontend exec vitest run --no-file-parallelism <pfad>
  ```
  Im Plan unten abgekürzt als `VITEST <pfad>`. Exit-Codes ehrlich halten: kein `| tail` um Gates,
  bei Bedarf `rtk proxy` davor.
- **Baseline vor Beginn (gemessen 08.08.2026):** `src/pages/lage-dashboard`,
  `src/pages/EinsaetzePage.test.tsx`, `src/live` → 5 Dateien, 79 Tests, alle grün.

---

## Ausgangslage — was die Ticketbeschreibung nicht mehr trifft

Die Beschreibung von LFH-336 nennt Dateien, die es nicht mehr gibt. Gemessener Stand:

| Ticket sagt | Wirklichkeit |
|---|---|
| `MeldungenKachel.tsx`, `AuftraegeKachel.tsx`, `LageberichtKachel.tsx` | Alle Kacheln liegen inline in `LageDashboardPage.tsx` (Komponente `Kachel`, Zeilen 84–142) |
| `klickbar.tsx` nach `components/` hochziehen | **Erledigt** — `components/Klickbar.tsx` existiert (B7 geliefert), exportiert `aufTaste` + `KlickbareZeile` |
| `<Tag color="blue">Live</Tag>` in `:104` | **Weg** — aber ersetzt durch `zGesamt === 'fehler' ? 'Verbindung gestört' : 'Live verbunden'` (`:330`), das an **Query**-Fehlern hängt, nicht am SSE-Zustand |
| `EinsaetzePage.tsx:36/:52` Inline-Pfade | **Erledigt** — nutzt bereits `einsatzPfad` |
| Karte nicht tastaturbedienbar | Titel ist bereits ein `<Link>` — ungetestet |

**Der wichtigste Befund:** AK1 misst grün (`grep -c 'Tag color="blue">Live'` = 0) und ist trotzdem
unerfüllt. Bei SSE-Abriss meldet das Band weiter „Live verbunden", solange keine Query fehlschlägt.
M3 wurde umbenannt, nicht behoben. Das ist Task 2.

**Verbleibende echte Arbeit:** AK1-Substanz (Task 2), AK2 (Tasks 3+4), AK3-Rest (Task 1),
AK4/AK5 (Task 5), Prüfliste + Gesamt-Gate (Task 6).

**Kein Backend-Bedarf.** Gemessen in `api/types.generated.ts`: `EinsatzAnzeige` trägt `einsatzort`,
`begonnen_at`, `einsatzart`; `MeldungAnzeige` trägt `lfd_nr`, `absender`, `inhalt`, `ereigniszeit`,
`prioritaet`, `id`; `AuftragAnzeige` trägt `auftrag_text`, `frist_at`, `lfd_nr`, `id`. Kein
Codegen-Lauf nötig.

---

## Entschiedene Gabelungen

**M3-Auflösung:** Das Ticket lässt „an `lfh:live-status` hängen" **oder** „durch ‚Stand: HH:MM'
ersetzen" zu. Gewählt: **an den Live-Status hängen.** Begründung — das Band trägt bereits einen
Puls-Indikator (`.lfh-puls`), der genau diesen Sachverhalt bebildert; ein Zeitstempel daneben
beantwortete eine andere Frage und ließe den Widerspruch stehen.

**Store statt zweitem Listener:** Ein zweiter `useEffect`-Listener im Dashboard erzeugte eine zweite
unabhängige Kopie desselben Zustands — exakt der Defekt, den M3 benennt. Und `lfh:live-status` ist
ein Broadcast **ohne Replay**: ein später mountender Konsument bliebe auf `idle`. Deshalb ein
Modul-Store, der das Event abonniert und den letzten Wert hält; Band und Betriebszeile lesen ihn per
`useSyncExternalStore`. `useEinsatzLiveStream` bleibt **unverändert** — das Event bleibt die
Wire-Schnittstelle, damit `live/LiveStatusBanner.test.tsx:22` (dispatched das rohe Event) gültig
bleibt statt zur Attrappe zu werden.

**Lageauszug-Abschnitt:** Es gibt **keinen** Abschnitt namens „lage" (gemessen in
`src/lagebericht/mod.rs:44-140`). Je Vorlage heißt der Lage-Abschnitt anders:
`lagebericht` → `gefahren_schadenlage`, `lagebeurteilung` → `beurteilung_schadenlage`,
`freitext` → `text`. Deshalb eine Vorrangliste mit Fallback auf den ersten nicht-leeren Abschnitt.

**Zeilenboden gehört ins CSS, nicht ins TSX:** `.lfh-zeile` trägt in `theme/sprache.css:447-455`
bereits `min-height: var(--lfh-zeilenhoehe)` (30/48/72) **plus** `padding: var(--lfh-luft-1) 0` —
die zwei Angaben aus LFH-365 sind erfüllt. Neue Zeilen erben sie über die Klasse. **Kein**
Inline-`minHeight` in TSX; das wäre die zweite Wahrheit, die `theme/rollen.css` verbietet.

**Navigation bleibt ein nativer Link:** Für die Kurzlisten-Zeilen `<Link className="lfh-zeile">`,
nicht `KlickbareZeile`. Das sagt `components/Klickbar.tsx:44` selbst im Doc-Kommentar, und ein Link
bringt Tastatur, Fokusring und Mittelklick nativ mit.

**Der Leerzustand folgt DEMSELBEN Filter wie die Zeilen.** Heute steht an der Aufträge-Kachel
`leer={(auftraegeQuery.data ?? []).length === 0}`, während `auftragszeilen()` vollzogene und
abgenommene wegfiltert. Drei Aufträge, alle vollzogen → `leer` ist `false`, der Nicht-Leer-Zweig
rendert, und die Kachel zeigt **gar nichts**: kein Leertext, keine Zeile, ein leeres `<ul>`.
Derselbe Riss bei Meldungen über `ist_offen`. Deshalb hängt `leer` künftig an der **Zeilenmenge**,
und der Leertext sagt, was die Menge wirklich beschreibt: „Keine offenen Aufträge." statt „Keine
Aufträge erteilt." Ein Leertext, der etwas anderes behauptet als die Zahl über ihm, ist die
Zählerwand mit anderem Wortlaut.

**Zeiten werden zonenrichtig, nicht bloß konsistent.** `uhrzeit()` (`lagebild.ts:159`) ist heute ein
reiner Regex über den Wirestring — **ohne** Zonenumrechnung. `begonnen_at`, `ereigniszeit` und
`frist_at` sind UTC (das hält `EinsaetzePage.tsx:133-140` ausdrücklich fest). Eine Frist um 16:30
UTC erschiene im Dashboard als „16:30", während dieselbe Zeit auf der Einsatzkarte über
`formatZeitKurz` als 18:30 steht — zwei Uhren im selben Ticket, zwei Stunden auseinander. Bei
Fristen ist das der Fall, in dem jemand zu spät pumpt. Der Blast Radius ist klein und gemessen:
`uhrzeit()` hat genau zwei Konsumenten (`ereignisse[].zeit`, `seit`), und `seit` wird von der Seite
gar nicht gerendert. Deshalb wird die Funktion in Task 3 zonenrichtig gemacht, statt den Fehler auf
Meldungszeit und Frist auszudehnen.

---

## File Structure

| Datei | Verantwortung | Task |
|---|---|---|
| `frontend/src/live/liveStatusStore.ts` | **neu** — hält den letzten `lfh:live-status`, eine Lesequelle | 2 |
| `frontend/src/live/liveStatusStore.test.ts` | **neu** — Replay, Abo, Aufräumen | 2 |
| `frontend/src/live/LiveStatusBanner.tsx` | liest den Store statt eigenem Listener | 2 |
| `frontend/src/pages/lage-dashboard/lagebild.ts` | Bedeutung: Kurzlisten + Lageauszug | 3 |
| `frontend/src/pages/lage-dashboard/lagebild.test.ts` | **neu** — Datenschicht-Tests | 3 |
| `frontend/src/pages/lage-dashboard/LageDashboardPage.tsx` | Rendern: Pfad-Builder, Bandzustand, Kurzlisten | 1, 2, 4 |
| `frontend/src/pages/lage-dashboard/LageDashboardPage.test.tsx` | Seitentests | 1, 2, 4 |
| `frontend/src/theme/sprache.css` | Zeilen-Link-Erscheinung, `lfh-zeile__nr`, Lageauszug | 4 |
| `frontend/src/pages/EinsaetzePage.tsx` | Ort/Beginn/Einsatzart, Sortierung, Suche | 5 |
| `frontend/src/pages/EinsaetzePage.test.tsx` | Karteninhalt, Sortierung, Suchschwelle, Tastatur | 5 |
| `docs/superpowers/specs/2026-08-08-lfh336-pruefliste-einsatztauglichkeit.md` | **neu** — 15 Kriterien, zwei Seiten | 6 |

---

## Task 1: Sprungziele des Dashboards über die Builder (AK3)

**Files:**
- Modify: `frontend/src/pages/lage-dashboard/LageDashboardPage.tsx:148`
- Test: `frontend/src/pages/lage-dashboard/LageDashboardPage.test.tsx`

**Interfaces:**
- Consumes: `einsatzModulPfad(einsatzId: number, modulRoute: string): string` aus
  `frontend/src/routing/deeplinks.ts:40` (existiert bereits, unverändert)
- Produces: nichts für spätere Tasks — reine Bereinigung

- [ ] **Schritt 1: Guard-Test schreiben, der die Inline-Literale verbietet**

Ans **Ende** von `LageDashboardPage.test.tsx` anfügen (neuer `describe`-Block, außerhalb der
bestehenden). Er liest die Quelldatei — dasselbe Muster, das die Datei ab Zeile 512 schon für
`sprache.css` verwendet (`readFileSync` ist dort bereits importiert):

```tsx
describe('Deeplinks des Dashboards (LFH-336 · AK3)', () => {
  const quelle = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'LageDashboardPage.tsx'),
    'utf8',
  );

  it('baut keinen Einsatz-Pfad als Template-Literal — die Builder sind die Quelle', () => {
    // Ein Inline-Pfad umgeht `routing/deeplinks.ts` und damit LFH-25. Er bricht
    // nichts sichtbar: die Seite navigiert weiter, nur an der Registry vorbei.
    expect(quelle).not.toMatch(/`\/einsaetze\/\$\{/);
  });

  it('nutzt den Modul-Builder', () => {
    expect(quelle).toContain('einsatzModulPfad');
  });
});
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `VITEST src/pages/lage-dashboard/LageDashboardPage.test.tsx -t "Template-Literal"`
Expected: FAIL — die Quelle enthält `` `/einsaetze/${einsatzId}/${route}` `` in Zeile 148.

- [ ] **Schritt 3: Umstellen**

In `LageDashboardPage.tsx` den Import ergänzen (nach der `queryKeys`-Zeile, Zeile 22):

```tsx
import { einsatzModulPfad } from '../../routing/deeplinks';
```

Und Zeile 148 ersetzen:

```tsx
  const gehe = (route: string) => navigate(einsatzModulPfad(einsatzId, route));
```

- [ ] **Schritt 4: Tests laufen lassen**

Run: `VITEST src/pages/lage-dashboard`
Expected: PASS — alle bestehenden plus die zwei neuen. Der Deep-Link-Bestandstest
(„Klick auf die Patienten-Kennzahl navigiert ins Personen-Modul", Zeile 266) belegt, dass die
Navigation dabei intakt bleibt.

- [ ] **Schritt 5: Committen**

```bash
git add frontend/src/pages/lage-dashboard/LageDashboardPage.tsx frontend/src/pages/lage-dashboard/LageDashboardPage.test.tsx
git commit -m "refactor(lfh-336): baue Dashboard-Sprungziele über die Pfad-Builder"
```

---

## Task 2: Eine Quelle für den Live-Verbindungszustand (AK1)

**Files:**
- Create: `frontend/src/live/liveStatusStore.ts`
- Create: `frontend/src/live/liveStatusStore.test.ts`
- Modify: `frontend/src/live/LiveStatusBanner.tsx:2,27,38-45`
- Modify: `frontend/src/pages/lage-dashboard/LageDashboardPage.tsx:324-332`
- Test: `frontend/src/pages/lage-dashboard/LageDashboardPage.test.tsx`

**Interfaces:**
- Consumes: `LiveVerbindungsStatus = 'idle' | 'open' | 'connecting' | 'lost'` aus
  `frontend/src/live/useEinsatzLiveStream.ts:38`
- Produces:
  - `abonniereLiveStatus(aufAenderung: () => void): () => void`
  - `leseLiveStatus(): LiveVerbindungsStatus`
  - `setzeLiveStatusFuerTest(status: LiveVerbindungsStatus): void`

- [ ] **Schritt 1: Store-Test schreiben**

Neue Datei `frontend/src/live/liveStatusStore.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  abonniereLiveStatus,
  leseLiveStatus,
  setzeLiveStatusFuerTest,
} from './liveStatusStore';

function melde(status: string) {
  window.dispatchEvent(new CustomEvent('lfh:live-status', { detail: { status } }));
}

afterEach(() => setzeLiveStatusFuerTest('idle'));

describe('liveStatusStore', () => {
  it('startet auf idle', () => {
    expect(leseLiveStatus()).toBe('idle');
  });

  it('übernimmt den gemeldeten Status und benachrichtigt Abonnenten', () => {
    const horcher = vi.fn();
    const ab = abonniereLiveStatus(horcher);
    melde('lost');
    expect(leseLiveStatus()).toBe('lost');
    expect(horcher).toHaveBeenCalledTimes(1);
    ab();
  });

  // DER GRUND für den Store. `lfh:live-status` ist ein Broadcast ohne Replay:
  // ein Konsument, der NACH dem Abriss mountet, bliebe mit eigenem Listener auf
  // 'idle' stehen und meldete „Live" in eine tote Leitung.
  it('hält den letzten Stand für später hinzukommende Leser', () => {
    melde('lost');
    const spaeter = vi.fn();
    const ab = abonniereLiveStatus(spaeter);
    expect(leseLiveStatus()).toBe('lost');
    ab();
  });

  it('meldet nicht, wenn sich der Status nicht ändert', () => {
    melde('open');
    const horcher = vi.fn();
    const ab = abonniereLiveStatus(horcher);
    melde('open');
    expect(horcher).not.toHaveBeenCalled();
    ab();
  });

  it('ignoriert ein Ereignis ohne Status', () => {
    melde('open');
    window.dispatchEvent(new CustomEvent('lfh:live-status', { detail: {} }));
    expect(leseLiveStatus()).toBe('open');
  });

  it('das Abbestellen löst den letzten Abonnenten, ohne den Stand zu verlieren', () => {
    const horcher = vi.fn();
    abonniereLiveStatus(horcher)();
    melde('connecting');
    expect(horcher).not.toHaveBeenCalled();
    expect(leseLiveStatus()).toBe('connecting');
  });
});
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `VITEST src/live/liveStatusStore.test.ts`
Expected: FAIL — „Failed to resolve import ./liveStatusStore".

- [ ] **Schritt 3: Store schreiben**

Neue Datei `frontend/src/live/liveStatusStore.ts`:

```ts
/**
 * Der Live-Verbindungszustand als EINE Lesequelle (LFH-336 · Befund M3).
 *
 * Vorher hielt jede Anzeige ihre eigene Kopie: die Betriebszeile lauschte selbst
 * auf `lfh:live-status`, das Instrumentenband des Lage-Dashboards leitete den
 * Zustand aus QUERY-Fehlern ab. Ergebnis — bei abgerissenem SSE meldete das Band
 * „Live verbunden", während der Banner „Verbindung unterbrochen" zeigte. Zwei
 * Anzeigen für denselben Sachverhalt, die auseinanderlaufen.
 *
 * Warum ein Store und nicht ein zweiter `useEffect`-Listener: `lfh:live-status`
 * ist ein Broadcast OHNE Replay. Wer nach dem Abriss mountet, sieht nie ein
 * Ereignis und bliebe auf `idle` — also auf „alles in Ordnung". Der Store hält
 * den letzten Stand und gibt ihn jedem neuen Leser sofort.
 *
 * `useEinsatzLiveStream` bleibt unangetastet: das window-Ereignis bleibt die
 * Wire-Schnittstelle (der Hook bleibt render-state-frei und behält EINE
 * EventSource), der Store ist nur die gemeinsame LESESEITE davor.
 *
 * Bauform nach dem Vorbild von `pwa/appAktualisierung` — derselbe
 * `useSyncExternalStore`-Vertrag, den `LiveStatusBanner` für die App-Version
 * bereits konsumiert.
 */
import type { LiveVerbindungsStatus } from './useEinsatzLiveStream';

let stand: LiveVerbindungsStatus = 'idle';
const horcher = new Set<() => void>();

// Der Fensterlauscher hängt EINMAL am Modul, nicht je Abonnent. Ein Abo-Zähler
// mit add/removeEventListener wäre die sparsamere Variante — aber dann verlöre
// der Store zwischen zwei Abonnenten genau die Ereignisse, für deren Aufbewahrung
// er existiert.
if (typeof window !== 'undefined') {
  window.addEventListener('lfh:live-status', (e: Event) => {
    const gemeldet = (e as CustomEvent<{ status?: LiveVerbindungsStatus }>).detail?.status;
    if (!gemeldet || gemeldet === stand) return;
    stand = gemeldet;
    horcher.forEach((h) => h());
  });
}

/** Abonniert Änderungen; gibt die Abmeldung zurück (Vertrag `useSyncExternalStore`). */
export function abonniereLiveStatus(aufAenderung: () => void): () => void {
  horcher.add(aufAenderung);
  return () => horcher.delete(aufAenderung);
}

/** Der zuletzt gemeldete Verbindungszustand. Primitiv, also referenzstabil —
 *  `useSyncExternalStore` verlangt das von `getSnapshot`. */
export function leseLiveStatus(): LiveVerbindungsStatus {
  return stand;
}

/** Setzt den Stand zurück. Nur für Tests — der Modulzustand überlebt sonst
 *  zwischen zwei `it`-Blöcken derselben Datei. */
export function setzeLiveStatusFuerTest(status: LiveVerbindungsStatus): void {
  stand = status;
  horcher.forEach((h) => h());
}
```

- [ ] **Schritt 4: Store-Test laufen lassen**

Run: `VITEST src/live/liveStatusStore.test.ts`
Expected: PASS — 6 Tests.

- [ ] **Schritt 5: Bandtest schreiben (die eigentliche AK1-Zusicherung)**

In `LageDashboardPage.test.tsx`, im bestehenden `describe('LageDashboardPage — Referenzseite …')`,
nach dem Test „das Band nennt nach dem Abruf den Einsatz" (Zeile 467) einfügen. Import oben ergänzen:

```tsx
import { setzeLiveStatusFuerTest } from '../../live/liveStatusStore';
```

Und die Tests:

```tsx
  // AK1 (LFH-336): der frühere `<Tag color="blue">Live</Tag>` war statisch; sein
  // Nachfolger im Band hing an QUERY-Fehlern und meldete bei totem SSE weiter
  // „Live verbunden". Beide Zweige gehören geprüft — nur der Abriss-Zweig allein
  // wäre auch dann grün, wenn das Band NIE „Live" sagt.
  it('das Band meldet die Live-Verbindung, solange sie steht', async () => {
    setzeLiveStatusFuerTest('open');
    mockEndpunkte({ personen: [person('sk3')] });
    render();
    await kennzahlGeladen('Vermisst');
    expect(screen.getByText('Live verbunden')).toBeInTheDocument();
  });

  it('bei abgerissener Live-Verbindung meldet das Band NICHT „Live"', async () => {
    setzeLiveStatusFuerTest('lost');
    mockEndpunkte({ personen: [person('sk3')] });
    render();
    await kennzahlGeladen('Vermisst');
    expect(screen.queryByText('Live verbunden')).not.toBeInTheDocument();
    expect(screen.getByText('Verbindung unterbrochen')).toBeInTheDocument();
  });

  it('während des Wiederverbindens meldet das Band den Zwischenstand', async () => {
    setzeLiveStatusFuerTest('connecting');
    mockEndpunkte({ personen: [person('sk3')] });
    render();
    await kennzahlGeladen('Vermisst');
    expect(screen.getByText('Verbindung wird aufgebaut')).toBeInTheDocument();
  });
```

Und ein `afterEach` direkt unter dem bestehenden `afterEach(() => vi.unstubAllGlobals());` (Zeile 27),
damit der Modulzustand nicht in die Nachbartests leckt:

```tsx
afterEach(() => setzeLiveStatusFuerTest('idle'));
```

- [ ] **Schritt 6: Tests laufen lassen, Fehlschlag bestätigen**

Run: `VITEST src/pages/lage-dashboard/LageDashboardPage.test.tsx -t "Band"`
Expected: FAIL — „Verbindung unterbrochen" wird nicht gefunden; das Band sagt heute
„Live verbunden", weil keine Query fehlschlägt.

- [ ] **Schritt 7: Das Band an den Store hängen**

In `LageDashboardPage.tsx`: Imports ergänzen (`useSyncExternalStore` zu React, Store dazu):

```tsx
import { useMemo, useSyncExternalStore } from 'react';
import { abonniereLiveStatus, leseLiveStatus } from '../../live/liveStatusStore';
```

Im Komponentenrumpf, direkt nach `const navigate = useNavigate();`:

```tsx
  // Der Verbindungszustand kommt aus DERSELBEN Quelle wie die globale
  // Betriebszeile (LFH-336 · M3). Vorher stand hier eine Ableitung aus
  // Query-Fehlern — die meldete bei totem SSE weiter „Live verbunden", weil ein
  // abgerissener Stream keine Abfrage rot färbt: der Cache liefert brav die alten
  // Daten. Genau das ist der Zustand, in dem jemand eine veraltete Lage funkt.
  const liveStatus = useSyncExternalStore(abonniereLiveStatus, leseLiveStatus, leseLiveStatus);
```

Und den Bandblock (heute Zeilen 324–332) ersetzen:

```tsx
          <div className="lfh-band__verbindung">
            <span
              className={`lfh-puls${liveStatus === 'lost' ? ' lfh-puls--alarm' : ''}`}
              aria-hidden="true"
            />
            <span className="lfh-etikett">{VERBINDUNG_WORTLAUT[liveStatus]}</span>
          </div>
```

Den Wortlaut als Modulkonstante neben `LADETEXT` (nach Zeile 58) setzen:

```tsx
/**
 * Wortlaut je Verbindungszustand.
 *
 * `Record` über die volle {@link LiveVerbindungsStatus}-Union, damit eine fünfte
 * Variante hier den Build bricht statt still auf einen Vorgabetext zu fallen.
 *
 * `idle` heißt „noch keine Meldung" und nicht „gestört" — vor dem ersten
 * Stream-Ereignis wäre eine Störungsmeldung eine Falschaussage in die andere
 * Richtung. Es trägt deshalb denselben Wortlaut wie `open`; der Puls schlägt in
 * beiden Fällen ruhig, alarmiert wird nur bei `lost`.
 */
const VERBINDUNG_WORTLAUT: Record<LiveVerbindungsStatus, string> = {
  idle: 'Live verbunden',
  open: 'Live verbunden',
  connecting: 'Verbindung wird aufgebaut',
  lost: 'Verbindung unterbrochen',
};
```

Import des Typs oben ergänzen:

```tsx
import type { LiveVerbindungsStatus } from '../../live/useEinsatzLiveStream';
```

**`zGesamt` wird damit unbenutzt** (Zeilen 276–286) — ersatzlos löschen, sonst meldet
`pnpm lint` mit `--max-warnings 0` eine ungenutzte Variable. Die Fehler-Sichtbarkeit je
Kachel bleibt davon unberührt: die hängt an `zBetroffene`/`zKraefte`/… und nicht an `zGesamt`.

- [ ] **Schritt 8: Tests laufen lassen**

Run: `VITEST src/pages/lage-dashboard/LageDashboardPage.test.tsx`
Expected: PASS — alle bestehenden plus die drei neuen.

- [ ] **Schritt 9: Die Betriebszeile auf dieselbe Quelle umstellen**

In `frontend/src/live/LiveStatusBanner.tsx`: den eigenen Listener (Zeilen 38–45) und den
`useState`-Zustand (Zeile 27) durch den Store ersetzen.

Ersetze Zeile 27:

```tsx
  // EINE Quelle mit dem Instrumentenband des Lage-Dashboards (LFH-336 · M3).
  // Der frühere lokale Listener war für sich richtig, aber er war die ZWEITE
  // Kopie desselben Zustands — und die dritte wäre nur eine Datei entfernt.
  const status = useSyncExternalStore(abonniereLiveStatus, leseLiveStatus, leseLiveStatus);
```

Zeilen 38–45 (der `useEffect` mit `addEventListener('lfh:live-status', …)`) ersatzlos löschen.
Import ergänzen:

```tsx
import { abonniereLiveStatus, leseLiveStatus } from './liveStatusStore';
```

`useState` bleibt im Import (wird für `istOnline` und die Aktualisierungs-Flags weiter gebraucht),
`useSyncExternalStore` ist bereits importiert (Zeile 2).

- [ ] **Schritt 10: Banner-Tests laufen lassen**

Run: `VITEST src/live`
Expected: PASS. `LiveStatusBanner.test.tsx:22` dispatched weiterhin das rohe window-Ereignis und
bleibt damit gültig — der Store hört auf dasselbe Ereignis. **Läuft der Test rot**, weil ein
vorheriger `it`-Block den Modulstand hinterlassen hat: in `LiveStatusBanner.test.tsx` ein
`afterEach(() => setzeLiveStatusFuerTest('idle'))` ergänzen, nicht den Store ändern.

- [ ] **Schritt 11: Mutationsprobe — beweist, dass der Test den Abriss wirklich prüft**

Setze in `VERBINDUNG_WORTLAUT` versuchsweise `lost: 'Live verbunden'`.
Run: `VITEST src/pages/lage-dashboard/LageDashboardPage.test.tsx -t "abgerissener"`
Expected: **FAIL**. Danach zurückändern und erneut laufen lassen: PASS.
Ohne diese Probe wäre nicht belegt, dass der Test die Aussage trägt statt nur grün zu sein.

- [ ] **Schritt 12: Committen**

```bash
git add frontend/src/live/liveStatusStore.ts frontend/src/live/liveStatusStore.test.ts \
        frontend/src/live/LiveStatusBanner.tsx \
        frontend/src/pages/lage-dashboard/LageDashboardPage.tsx \
        frontend/src/pages/lage-dashboard/LageDashboardPage.test.tsx
git commit -m "fix(lfh-336): führe Live-Verbindungsanzeige auf eine Quelle zurück"
```

---

## Task 3: Kurzlisten und Lageauszug in der Datenschicht (Grundlage für AK2)

**Files:**
- Modify: `frontend/src/anzeige/format.ts`
- Modify: `frontend/src/anzeige/format.test.ts`
- Modify: `frontend/src/pages/lage-dashboard/lagebild.ts`
- Create: `frontend/src/pages/lage-dashboard/lagebild.test.ts`

**Interfaces:**
- Consumes: `Meldung`, `Auftrag`, `LageberichtAnzeige` aus `frontend/src/api/types`;
  `AnzeigeKonventionen`, `DEFAULT_KONVENTIONEN` aus `frontend/src/anzeige/format.ts`
- Produces — von Task 4 gerendert:
  ```ts
  // anzeige/format.ts
  export function formatUhrzeit(utcStr?: string | null, konv?: AnzeigeKonventionen): string;

  // lage-dashboard/lagebild.ts
  export interface Meldungszeile {
    id: number; lfdNr: number; zeit: string; absender: string;
    text: string; stufe: Dringlichkeit;
  }
  export interface Auftragszeile {
    id: number; lfdNr: number | null; frist: string | null;
    text: string; stufe: Dringlichkeit;
  }
  export function meldungszeilen(m: Meldung[], konv?: AnzeigeKonventionen): Meldungszeile[];
  export function auftragszeilen(a: Auftrag[], konv?: AnzeigeKonventionen): Auftragszeile[];
  export function lageauszug(b: LageberichtAnzeige | null): string | null;
  // neu an `Lagebild`:
  //   meldungszeilen: Meldungszeile[]   (max. 3, jüngste OFFENE zuerst)
  //   auftragszeilen: Auftragszeile[]   (max. 3, fristnächste OFFENE zuerst)
  //   bericht.auszug: string | null     (Lageabschnitt, auf 240 Zeichen gekürzt)
  ```

**Warum die Konventionen durchgereicht werden:** Die Vitest-Konfiguration fixiert **keine**
Zeitzone (gemessen — weder `vite.config.ts` noch `src/test/setup.ts` setzen `TZ`). Ein Test, der
eine zonenumgerechnete Uhrzeit als Literal erwartet, wäre damit maschinenabhängig und auf einem
anderen Rechner rot. Die Tests übergeben deshalb `{ zeitzone: 'Europe/Berlin' }` **explizit**;
im Betrieb greift der Default (lokale Zeit), wie bei jedem anderen Zeit-Leser des Frontends.

- [ ] **Schritt 0: Die Uhrzeit zonenrichtig machen**

Zuerst `frontend/src/anzeige/format.test.ts` lesen und dort im bestehenden Stil ergänzen:

```ts
describe('formatUhrzeit', () => {
  it('rechnet den UTC-Wirestring in die Zone um', () => {
    expect(formatUhrzeit('2026-06-11 09:00:00', { zeitzone: 'Europe/Berlin' })).toBe('11:00');
  });

  it('liefert den Leerstrich, wenn nichts da ist', () => {
    expect(formatUhrzeit(null)).toBe('——:——');
    expect(formatUhrzeit(undefined)).toBe('——:——');
  });

  it('fällt bei ungültiger Zone auf lokale Zeit zurück statt zu werfen', () => {
    expect(() => formatUhrzeit('2026-06-11 09:00:00', { zeitzone: 'Europe/Brelin' })).not.toThrow();
  });
});
```

Run: `VITEST src/anzeige/format.test.ts` → FAIL („no export named 'formatUhrzeit'").

Dann in `frontend/src/anzeige/format.ts` neben `formatZeitKurz` einfügen:

```ts
/**
 * Reine Uhrzeit `HH:mm` in der Anzeigezone — für Instrumente, die den Tag schon
 * aus dem Zusammenhang kennen (Lage-Dashboard: alles vom laufenden Einsatz).
 *
 * Der Leerwert ist ein Leerstrich in Ziffernbreite (`——:——`) und nicht der leere
 * String wie bei den DTG-Formatierern: er steht in einer Instrumentenspalte, und
 * eine Lücke, die zusammenfällt, verschiebt die Zeilen daneben.
 */
export function formatUhrzeit(
  utcStr?: string | null,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string {
  if (!utcStr) return '——:——';
  return inZone(utcStr, konv).format('HH:mm');
}
```

Run: `VITEST src/anzeige/format.test.ts` → PASS.

**Mutationsprobe**: streiche `inZone(...)` durch `dayjs(utcStr)` (ohne Zonenumrechnung) →
der erste Test muss **FAIL** liefern. Zurückändern. Ohne die Probe wäre nicht belegt, dass der
Test die Umrechnung prüft und nicht bloß eine Formatierung.

- [ ] **Schritt 1: Datenschicht-Test schreiben**

Neue Datei `frontend/src/pages/lage-dashboard/lagebild.test.ts`. Die Fixtures sind bewusst
minimal und per `as` getypt — der volle Response-Typ hat >30 Felder, und geprüft wird hier die
Auswahl-/Sortierlogik, nicht die Deserialisierung. Die Zone steht **explizit** in jedem Aufruf,
weil die Suite keine `TZ` fixiert:

```ts
import { describe, expect, it } from 'vitest';
import type { Auftrag, LageberichtAnzeige, Meldung } from '../../api/types';
import { auftragszeilen, lageauszug, meldungszeilen } from './lagebild';

/** Feste Zone, damit die Erwartungen nicht von der Maschine abhängen.
 *  `2026-06-11 09:00:00` UTC ist in Berlin (CEST) `11:00`. */
const BERLIN = { zeitzone: 'Europe/Berlin' };

const m = (over: Partial<Meldung>): Meldung =>
  ({
    id: 1, lfd_nr: 1, absender: 'Trupp 1', inhalt: 'Deich instabil',
    ereigniszeit: '2026-06-11 09:00:00', status: 'neu', ist_offen: true,
    ist_ueberfaellig: false, prioritaet: 'normal',
    ...over,
  }) as Meldung;

const a = (over: Partial<Auftrag>): Auftrag =>
  ({
    id: 1, lfd_nr: 1, auftrag_text: 'Deich sichern', frist_at: null,
    bearbeitungsstatus: 'offen', ist_ueberfaellig: false, prioritaet: 'normal',
    ...over,
  }) as Auftrag;

describe('meldungszeilen', () => {
  it('nimmt höchstens drei', () => {
    const viele = [1, 2, 3, 4, 5].map((n) =>
      m({ id: n, lfd_nr: n, ereigniszeit: `2026-06-11 0${n}:00:00` }),
    );
    expect(meldungszeilen(viele)).toHaveLength(3);
  });

  it('nimmt die JÜNGSTEN nach Ereigniszeit', () => {
    const zeilen = meldungszeilen([
      m({ id: 1, lfd_nr: 1, ereigniszeit: '2026-06-11 07:00:00' }),
      m({ id: 2, lfd_nr: 2, ereigniszeit: '2026-06-11 11:00:00' }),
      m({ id: 3, lfd_nr: 3, ereigniszeit: '2026-06-11 09:00:00' }),
    ]);
    expect(zeilen.map((z) => z.lfdNr)).toEqual([2, 3, 1]);
  });

  // Der Zähler darüber zählt OFFENE. Zeigte die Liste erledigte mit, widerspräche
  // sie ihrer eigenen Kopfzahl — genau die Sorte Auseinanderlaufen, gegen die
  // dieses Ticket antritt.
  it('lässt erledigte Meldungen weg', () => {
    const zeilen = meldungszeilen([
      m({ id: 1, lfd_nr: 1, ist_offen: false }),
      m({ id: 2, lfd_nr: 2, ist_offen: true }),
    ]);
    expect(zeilen.map((z) => z.lfdNr)).toEqual([2]);
  });

  it('trägt Zeit, Absender und Text der Meldung', () => {
    const [z] = meldungszeilen(
      [m({ id: 7, lfd_nr: 42, absender: 'ELW 1', inhalt: 'Strom weg' })],
      BERLIN,
    );
    expect(z).toMatchObject({
      id: 7, lfdNr: 42, zeit: '11:00', absender: 'ELW 1', text: 'Strom weg',
    });
  });

  // Die Ereigniszeit ist ein UTC-Wirestring. Vor LFH-336 schnitt `uhrzeit()` die
  // Ziffern per Regex heraus — die Meldung stand dann zwei Stunden in der
  // Vergangenheit, ohne dass irgendwo ein Fehler auftrat.
  it('zeigt die Ereigniszeit in der Anzeigezone, nicht in UTC', () => {
    expect(meldungszeilen([m({ ereigniszeit: '2026-06-11 09:00:00' })], BERLIN)[0].zeit).toBe('11:00');
  });

  it('stuft überfällig als Alarm, neu als Achtung, sonst normal', () => {
    expect(meldungszeilen([m({ ist_ueberfaellig: true })])[0].stufe).toBe('alarm');
    expect(meldungszeilen([m({ status: 'neu' })])[0].stufe).toBe('achtung');
    expect(meldungszeilen([m({ status: 'in_bearbeitung' })])[0].stufe).toBe('normal');
  });
});

describe('auftragszeilen', () => {
  it('sortiert nach Frist, die nächste zuerst', () => {
    const zeilen = auftragszeilen([
      a({ id: 1, lfd_nr: 1, frist_at: '2026-06-11 18:00:00' }),
      a({ id: 2, lfd_nr: 2, frist_at: '2026-06-11 12:00:00' }),
    ]);
    expect(zeilen.map((z) => z.lfdNr)).toEqual([2, 1]);
  });

  // Ein Auftrag OHNE Frist ist nicht dringlicher als einer mit — er ist nur
  // unbestimmt. Sortierte er nach vorn (wie ein leerer String es täte), verdrängte
  // er den überfälligen aus der Dreierliste.
  it('stellt fristlose Aufträge hinter alle mit Frist', () => {
    const zeilen = auftragszeilen([
      a({ id: 1, lfd_nr: 1, frist_at: null }),
      a({ id: 2, lfd_nr: 2, frist_at: '2026-06-11 18:00:00' }),
    ]);
    expect(zeilen.map((z) => z.lfdNr)).toEqual([2, 1]);
  });

  it('lässt vollzogene und abgenommene Aufträge weg', () => {
    const zeilen = auftragszeilen([
      a({ id: 1, lfd_nr: 1, bearbeitungsstatus: 'vollzogen' }),
      a({ id: 2, lfd_nr: 2, bearbeitungsstatus: 'abgenommen' }),
      a({ id: 3, lfd_nr: 3, bearbeitungsstatus: 'in_arbeit' }),
    ]);
    expect(zeilen.map((z) => z.lfdNr)).toEqual([3]);
  });

  it('nimmt höchstens drei', () => {
    const viele = [1, 2, 3, 4].map((n) =>
      a({ id: n, lfd_nr: n, frist_at: `2026-06-11 1${n}:00:00` }),
    );
    expect(auftragszeilen(viele)).toHaveLength(3);
  });

  it('trägt Text und Frist in der Anzeigezone, überfällig als Alarm', () => {
    const [z] = auftragszeilen(
      [a({ id: 9, lfd_nr: 5, auftrag_text: 'Pumpe setzen', frist_at: '2026-06-11 14:30:00', ist_ueberfaellig: true })],
      BERLIN,
    );
    expect(z).toMatchObject({ id: 9, lfdNr: 5, text: 'Pumpe setzen', frist: '16:30', stufe: 'alarm' });
  });

  it('lässt die Frist leer, wenn keine gesetzt ist', () => {
    expect(auftragszeilen([a({ frist_at: null })])[0].frist).toBeNull();
  });
});

describe('lageauszug', () => {
  const bericht = (vorlage: string, abschnitte: { schluessel: string; text: string }[]) =>
    ({ vorlage, abschnitte }) as LageberichtAnzeige;

  it('nimmt bei der Lagebericht-Vorlage die Gefahren-/Schadenlage', () => {
    expect(
      lageauszug(
        bericht('lagebericht', [
          { schluessel: 'auftrag', text: 'Deich halten' },
          { schluessel: 'gefahren_schadenlage', text: 'Pegel steigt' },
        ]),
      ),
    ).toBe('Pegel steigt');
  });

  it('nimmt bei der Lagebeurteilung die Beurteilung der Schadenlage', () => {
    expect(
      lageauszug(
        bericht('lagebeurteilung', [
          { schluessel: 'auftrag', text: 'Deich halten' },
          { schluessel: 'beurteilung_schadenlage', text: 'Lage verschärft sich' },
        ]),
      ),
    ).toBe('Lage verschärft sich');
  });

  it('nimmt beim Freitext den Berichtstext', () => {
    expect(lageauszug(bericht('freitext', [{ schluessel: 'text', text: 'Alles ruhig' }]))).toBe(
      'Alles ruhig',
    );
  });

  // Ein leerer Vorranga­bschnitt darf nicht dazu führen, dass die Kachel schweigt,
  // obwohl der Bericht Inhalt hat.
  it('fällt auf den ersten nicht-leeren Abschnitt zurück', () => {
    expect(
      lageauszug(
        bericht('lagebericht', [
          { schluessel: 'gefahren_schadenlage', text: '   ' },
          { schluessel: 'eigene_lage', text: 'Zwei Züge im Einsatz' },
        ]),
      ),
    ).toBe('Zwei Züge im Einsatz');
  });

  it('liefert null, wenn jeder Abschnitt leer ist', () => {
    expect(lageauszug(bericht('lagebericht', [{ schluessel: 'eigene_lage', text: '' }]))).toBeNull();
  });

  it('liefert null ohne Bericht', () => {
    expect(lageauszug(null)).toBeNull();
  });

  it('kürzt lange Abschnitte auf 240 Zeichen mit Auslassungszeichen', () => {
    const lang = 'x'.repeat(400);
    const auszug = lageauszug(bericht('freitext', [{ schluessel: 'text', text: lang }]));
    expect(auszug).toHaveLength(241);
    expect(auszug?.endsWith('…')).toBe(true);
  });
});
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `VITEST src/pages/lage-dashboard/lagebild.test.ts`
Expected: FAIL — „does not provide an export named 'meldungszeilen'".

- [ ] **Schritt 3: Datenschicht implementieren**

In `lagebild.ts`, nach `export interface Ereigniszeile` (Zeile 81) einfügen:

```ts
/** Eine Meldung als Kurzlisten-Zeile des Dashboards (LFH-336 · Befund H5). */
export interface Meldungszeile {
  id: number;
  lfdNr: number;
  zeit: string;
  absender: string;
  text: string;
  stufe: Dringlichkeit;
}

/** Ein Auftrag als Kurzlisten-Zeile des Dashboards (LFH-336 · Befund H5). */
export interface Auftragszeile {
  id: number;
  lfdNr: number | null;
  /** Ortszeit der Frist (`14:30`) oder `null`, wenn keine gesetzt ist. */
  frist: string | null;
  text: string;
  stufe: Dringlichkeit;
}

/** Wie viele Zeilen eine Kurzliste trägt.
 *  Drei, weil die Kachel darunter noch Kopfzahl und Fußnote hält — eine vierte
 *  Zeile drückt die Kachelreihe auf dem 13"-Fükw-Schirm in den Umbruch. */
const KURZLISTE_MAX = 3;
```

`uhrzeit` (Zeile 159) auf die zonenrichtige Fassung umstellen — der Name und der `——:——`-Vertrag
bleiben, damit die zwei Bestandskonsumenten unverändert bleiben:

```ts
/** `2026-06-11 09:00:00` (UTC) → `11:00` in der Anzeigezone.
 *
 *  Bis LFH-336 schnitt diese Funktion die Ziffern per Regex aus dem Wirestring —
 *  also UTC, ohne Umrechnung. Solange nur `ereignisse` und `seit` daran hingen,
 *  fiel das niemandem auf; mit Meldungszeit und FRIST daran wäre es eine Uhr, die
 *  zwei Stunden falsch geht, an genau der Stelle, wo jemand danach handelt. */
export function uhrzeit(
  iso: string | null | undefined,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string {
  return formatUhrzeit(iso, konv);
}
```

Import oben ergänzen:

```ts
import {
  DEFAULT_KONVENTIONEN,
  formatUhrzeit,
  type AnzeigeKonventionen,
} from '../../anzeige/format';
```

Danach die drei neuen Funktionen einfügen:

```ts
/**
 * Die jüngsten OFFENEN Meldungen als Kurzliste.
 *
 * Sortiert nach EREIGNISZEIT, nicht nach Eingangszeit — dieselbe Begründung wie
 * bei `ereignisse`: im Meldebild zählt, wann es passiert ist, nicht wann es
 * jemand eingetippt hat.
 *
 * Gefiltert auf `ist_offen`, weil die Kopfzahl der Kachel offene Meldungen zählt.
 * Eine Liste, die erledigte mitzeigt, widerspräche der Zahl über ihr.
 */
export function meldungszeilen(
  meldungen: Meldung[],
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): Meldungszeile[] {
  return [...meldungen]
    .filter((m) => m.ist_offen)
    .sort((a, b) => (a.ereigniszeit < b.ereigniszeit ? 1 : -1))
    .slice(0, KURZLISTE_MAX)
    .map((m) => ({
      id: m.id,
      lfdNr: m.lfd_nr,
      zeit: uhrzeit(m.ereigniszeit, konv),
      absender: m.absender,
      text: m.inhalt,
      stufe: m.ist_ueberfaellig ? 'alarm' : m.status === 'neu' ? 'achtung' : 'normal',
    }));
}

/**
 * Die fristnächsten OFFENEN Aufträge als Kurzliste.
 *
 * Ein Auftrag ohne Frist sortiert ans ENDE, nicht an den Anfang. Ein leerer
 * String verglichen sich lexikographisch vor jedes Datum — der fristlose Auftrag
 * verdrängte dann den überfälligen aus der Dreierliste. Unbestimmt ist nicht
 * dringend.
 *
 * Die Statusmenge ist dieselbe wie bei `auftraegeOffen` weiter unten: alles außer
 * `vollzogen` und `abgenommen`.
 */
export function auftragszeilen(
  auftraege: Auftrag[],
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): Auftragszeile[] {
  const offen = auftraege.filter(
    (a) => a.bearbeitungsstatus !== 'vollzogen' && a.bearbeitungsstatus !== 'abgenommen',
  );
  return [...offen]
    .sort((a, b) => {
      if (!a.frist_at && !b.frist_at) return 0;
      if (!a.frist_at) return 1;
      if (!b.frist_at) return -1;
      return a.frist_at < b.frist_at ? -1 : 1;
    })
    .slice(0, KURZLISTE_MAX)
    .map((a) => ({
      id: a.id,
      lfdNr: a.lfd_nr ?? null,
      frist: a.frist_at ? uhrzeit(a.frist_at, konv) : null,
      text: a.auftrag_text,
      stufe: a.ist_ueberfaellig ? 'alarm' : 'normal',
    }));
}

/**
 * Welcher Abschnitt eines Lageberichts DIE LAGE trägt — je Vorlage ein anderer.
 *
 * Es gibt keinen Abschnitt namens „lage" (gemessen gegen `src/lagebericht/mod.rs`,
 * gespiegelt in `lageberichte/vorlagen.ts`). Deshalb eine Vorrangliste über alle
 * drei Vorlagen statt einer Fallunterscheidung — die Schlüssel sind eindeutig,
 * eine Vorlage kann keine zwei davon tragen.
 */
const LAGE_ABSCHNITTE = ['gefahren_schadenlage', 'beurteilung_schadenlage', 'text'] as const;

/** Wie viel Lagetext die Kachel trägt. 240 Zeichen sind rund drei Zeilen auf
 *  Kachelbreite — mehr sprengt das Raster, weniger sagt nichts. */
const AUSZUG_MAX = 240;

/**
 * Der Lageabschnitt eines Berichts, gekürzt — oder `null`, wenn er nichts hergibt.
 *
 * Fällt auf den ersten nicht-leeren Abschnitt zurück: ein leerer Vorrangabschnitt
 * darf die Kachel nicht verstummen lassen, obwohl der Bericht Inhalt hat.
 */
export function lageauszug(bericht: LageberichtAnzeige | null): string | null {
  if (!bericht) return null;
  const gefuellt = (s: string | undefined) => (s ?? '').trim().length > 0;
  const vorrang = LAGE_ABSCHNITTE.map((k) =>
    bericht.abschnitte.find((a) => a.schluessel === k),
  ).find((a) => gefuellt(a?.text));
  const gewaehlt = vorrang ?? bericht.abschnitte.find((a) => gefuellt(a.text));
  if (!gewaehlt) return null;
  const text = gewaehlt.text.trim();
  return text.length > AUSZUG_MAX ? `${text.slice(0, AUSZUG_MAX)}…` : text;
}
```

An `interface Lagebild` (Zeilen 92–120) drei Felder ergänzen — `bericht` bekommt `auszug`:

```ts
  bericht: { titel: string; status: string; stand: string; von: string; auszug: string | null } | null;
  meldungszeilen: Meldungszeile[];
  auftragszeilen: Auftragszeile[];
```

In `baueLagebild` (im Rückgabeobjekt) den `bericht`-Zweig ergänzen und die zwei Listen anhängen:

```ts
    bericht: bericht
      ? {
          titel: bericht.titel,
          status: bericht.status,
          stand: bericht.zeitstand,
          von: bericht.ersteller_name,
          auszug: lageauszug(bericht),
        }
      : null,
    meldungszeilen: meldungszeilen(r.meldungen),
    auftragszeilen: auftragszeilen(r.auftraege),
```

In `leeresLagebild` (Zeilen 318–349) die zwei neuen Listen leeren — sonst trüge das leere
Lagebild die Zeilen des vollen weiter:

```ts
    meldungszeilen: [],
    auftragszeilen: [],
```

- [ ] **Schritt 4: Tests laufen lassen**

Run: `VITEST src/pages/lage-dashboard`
Expected: PASS — die neuen 18 plus alle bestehenden.

- [ ] **Schritt 5: Typecheck**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/dev-clickup-execution-eed38c/frontend exec tsc --noEmit`
Expected: exit 0.

- [ ] **Schritt 6: Committen**

```bash
git add frontend/src/pages/lage-dashboard/lagebild.ts frontend/src/pages/lage-dashboard/lagebild.test.ts
git commit -m "feat(lfh-336): leite Kurzlisten und Lageauszug im Lagebild ab"
```

---

## Task 4: Kacheln zeigen Inhalt statt Zähler (AK2)

**Files:**
- Modify: `frontend/src/pages/lage-dashboard/LageDashboardPage.tsx` (Kacheln Aufträge, Meldungen, Lagebericht)
- Modify: `frontend/src/theme/sprache.css`
- Test: `frontend/src/pages/lage-dashboard/LageDashboardPage.test.tsx`

**Interfaces:**
- Consumes aus Task 3: `lagebild.meldungszeilen`, `lagebild.auftragszeilen`,
  `lagebild.bericht.auszug`
- Consumes: `meldungenPfad(einsatzId, { meldung })`, `auftraegePfad(einsatzId, { auftrag })`
  aus `routing/deeplinks.ts:165,169`
- Produces: nichts für spätere Tasks

- [ ] **Schritt 1: Seitentests schreiben**

In `LageDashboardPage.test.tsx`, im Haupt-`describe`, nach dem Meldungs-Bestandstest (Zeile 289 ff.):

```tsx
  // AK2 (LFH-336): Der Zähler bleibt, aber er sagt nicht, WAS los ist. Geprüft
  // wird der Inhalt der Zeile UND ihr Sprungziel — eine Zeile ohne Ziel wäre
  // wieder nur Text auf einer Kachel.
  it('Meldungen: die Kurzliste nennt lfd. Nummer, Zeit, Absender und Inhalt', async () => {
    mockEndpunkte({
      personen: [person('sk3')],
      meldungen: [
        meldung({ id: 77, lfd_nr: 12, absender: 'ELW 1', inhalt: 'Strom ausgefallen', ereigniszeit: '2026-06-11 14:05:00' }),
      ],
    });
    render();
    await kennzahlGeladen('Vermisst');
    const zeile = await screen.findByRole('link', { name: /Strom ausgefallen/ });
    expect(zeile).toHaveTextContent('12');
    expect(zeile).toHaveTextContent('14:05');
    expect(zeile).toHaveTextContent('ELW 1');
    expect(zeile).toHaveAttribute('href', '/einsaetze/1/meldungen?meldung=77');
  });

  it('Aufträge: die Kurzliste nennt Auftragstext und Frist und springt auf den Auftrag', async () => {
    mockEndpunkte({
      personen: [person('sk3')],
      auftraege: [
        auftrag({ id: 88, lfd_nr: 4, auftrag_text: 'Pumpe an Deich 3 setzen', frist_at: '2026-06-11 16:30:00' }),
      ],
    });
    render();
    await kennzahlGeladen('Vermisst');
    const zeile = await screen.findByRole('link', { name: /Pumpe an Deich 3 setzen/ });
    expect(zeile).toHaveTextContent('16:30');
    expect(zeile).toHaveAttribute('href', '/einsaetze/1/auftraege?auftrag=88');
  });

  // Die zweite Hälfte von AK2: ohne sie wäre „mindestens eine Zeile" auch dann
  // erfüllt, wenn der Leerzustand genauso aussieht.
  it('ohne Aufträge zeigt die Kachel den Leerzustand und KEINE Zeile', async () => {
    mockEndpunkte({ personen: [person('sk3')], auftraege: [] });
    render();
    await kennzahlGeladen('Vermisst');
    expect(await screen.findByText('Keine offenen Aufträge.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Auftrag/ })).not.toBeInTheDocument();
  });

  // DER FALL, DER OHNE DIESEN TEST DURCHRUTSCHT. `leer` hing am ROHEN Response,
  // die Zeilen am gefilterten. Drei vollzogene Aufträge hießen also: nicht leer,
  // aber auch keine Zeile — die Kachel zeigte einen leeren Kasten. Ein Test mit
  // `auftraege: []` erfüllt sich am trivialen Fall und sieht das nicht.
  it('sind alle Aufträge vollzogen, zeigt die Kachel den Leerzustand statt eines leeren Kastens', async () => {
    mockEndpunkte({
      personen: [person('sk3')],
      auftraege: [
        auftrag({ id: 1, lfd_nr: 1, bearbeitungsstatus: 'vollzogen' }),
        auftrag({ id: 2, lfd_nr: 2, bearbeitungsstatus: 'abgenommen' }),
      ],
    });
    render();
    await kennzahlGeladen('Vermisst');
    expect(await screen.findByText('Keine offenen Aufträge.')).toBeInTheDocument();
  });

  it('sind alle Meldungen erledigt, zeigt die Kachel den Leerzustand', async () => {
    mockEndpunkte({
      personen: [person('sk3')],
      meldungen: [meldung({ id: 1, lfd_nr: 1, ist_offen: false, status: 'erledigt' })],
    });
    render();
    await kennzahlGeladen('Vermisst');
    expect(await screen.findByText('Keine offenen Meldungen.')).toBeInTheDocument();
  });

  it('die Kurzliste der Aufträge zeigt die fristnächsten zuerst', async () => {
    mockEndpunkte({
      personen: [person('sk3')],
      auftraege: [
        auftrag({ id: 1, lfd_nr: 1, auftrag_text: 'Spaet', frist_at: '2026-06-11 20:00:00' }),
        auftrag({ id: 2, lfd_nr: 2, auftrag_text: 'Frueh', frist_at: '2026-06-11 10:00:00' }),
      ],
    });
    render();
    await kennzahlGeladen('Vermisst');
    const zeilen = await screen.findAllByRole('link', { name: /Frueh|Spaet/ });
    expect(zeilen[0]).toHaveTextContent('Frueh');
  });

  it('der Lagebericht zeigt einen Auszug der Lage, nicht nur Titel und Status', async () => {
    mockEndpunkte({
      personen: [person('sk3')],
      lageberichte: [
        {
          id: 3, einsatz_id: 1, titel: 'Lage 14:00', status: 'freigegeben',
          zeitstand: '2026-06-11 14:00:00', ersteller_id: 1, ersteller_name: 'Muster',
          erstellt_at: '2026-06-11 14:00:00', aktualisiert_at: '2026-06-11 14:00:00',
          version: 1, vorlage: 'lagebericht',
          abschnitte: [{ schluessel: 'gefahren_schadenlage', text: 'Pegel bei 6,20 m, weiter steigend.' }],
        },
      ],
    });
    render();
    await kennzahlGeladen('Vermisst');
    expect(await screen.findByText(/Pegel bei 6,20 m/)).toBeInTheDocument();
  });
```

- [ ] **Schritt 2: Tests laufen lassen, Fehlschlag bestätigen**

Run: `VITEST src/pages/lage-dashboard/LageDashboardPage.test.tsx -t "Kurzliste"`
Expected: FAIL — kein `link` mit diesem Namen; die Kacheln rendern heute nur Zahlen.

- [ ] **Schritt 3: CSS für die Zeilen-Links und den Auszug**

**Zuerst die Trennlinie retten.** `.lfh-zeile:first-child { border-top: 0 }` (Zeile 457) greift
heute, weil `<li class="lfh-zeile">` direktes Kind von `<ul>` ist. Sobald ein `<li>`-Wrapper den
`<a class="lfh-zeile">` trägt, ist **jede** Zeile `:first-child` ihres eigenen `<li>` — und keine
Zeile hätte mehr eine Trennlinie. Das ändert die Erscheinung, und **kein Test sieht es** (jsdom
rechnet kein Layout). Deshalb den Selektor um die zweite Bauform erweitern:

```css
.lfh-zeile:first-child,
.lfh-zeilen > li:first-child > .lfh-zeile {
  border-top: 0;
}
```

Und die Regel gegen Rückfall festhalten — im Guard-`describe` für `sprache.css`, das die Testdatei
ab Zeile 512 bereits führt:

```tsx
  it('die erste Zeile verliert ihre Trennlinie in BEIDEN Bauformen', () => {
    // Der `<li>`-Wrapper um den Zeilen-Link macht jede Zeile zum `:first-child`
    // ihres eigenen Elternteils. Ohne die zweite Regel hätte KEINE Zeile mehr
    // eine Trennlinie — sichtbar nur im Browser, nie in jsdom.
    expect(css).toContain('.lfh-zeilen > li:first-child > .lfh-zeile');
  });
```

Dann, direkt nach dem `.lfh-zeile__quelle`-Block (ab Zeile 475):

```css
/* Eine Kurzlisten-Zeile, die auf ihren Datensatz springt (LFH-336).
   Trägt `.lfh-zeile` und damit deren Boden (`--lfh-zeilenhoehe`) und Polsterung —
   die zwei Angaben, die LFH-365 einem Bedienziel abverlangt, kommen aus der
   Basisklasse und werden hier NICHT wiederholt. */
a.lfh-zeile {
  color: inherit;
  text-decoration: none;
}

a.lfh-zeile:hover,
a.lfh-zeile:focus-visible {
  background: var(--lfh-flaeche-hover);
}

/* Die laufende Nummer ist ein Ordnungsmerkmal, kein Fließtext — Ziffernbreite
   fest, damit die Textspalte über alle Zeilen an derselben Stelle beginnt. */
.lfh-zeile__nr {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
  color: var(--lfh-schwach);
  font-size: 12px;
}

/* Der Lageauszug ist Fließtext, nicht Instrument: er darf umbrechen, aber nicht
   die Kachel sprengen. */
.lfh-auszug {
  margin: var(--lfh-luft-1) 0 0;
  color: var(--lfh-gedaempft);
  font-size: 13px;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
}
```

**Vor dem Schreiben prüfen**, dass `--lfh-flaeche-hover` in `theme/rollen.css` existiert:

```bash
grep -n "flaeche-hover" frontend/src/theme/rollen.css
```

Fehlt sie, statt eine neue Variable zu erfinden die vorhandene Hover-Rolle nehmen — die Namen
listet `frontend/src/theme/rollen.guard.test.ts:70-95` vollständig auf. Eine erfundene
CSS-Variable greift nie und fällt in keinem Test auf (jsdom rechnet kein Layout).

- [ ] **Schritt 4: Die Aufträge-Kachel umbauen**

In `LageDashboardPage.tsx` Imports ergänzen:

```tsx
import { auftraegePfad, einsatzModulPfad, meldungenPfad } from '../../routing/deeplinks';
```

**Erst die `leer`-Bedingung an dieselbe Menge hängen wie die Zeilen** — sonst zeigt die Kachel bei
lauter vollzogenen Aufträgen weder Leertext noch Zeile, sondern einen leeren Kasten. Und der
Leertext sagt, was die Menge wirklich beschreibt:

```tsx
            leer={(lagebild?.auftragszeilen ?? []).length === 0}
            leerText="Keine offenen Aufträge."
```

An der Meldungen-Kachel entsprechend:

```tsx
            leer={(lagebild?.meldungszeilen ?? []).length === 0}
            leerText="Keine offenen Meldungen."
```

Dann den Inhalt der Aufträge-Kachel (heute Zeilen 524–530) ersetzen:

```tsx
            <b className="lfh-zahl lfh-zahl--gross">{lagebild?.auftraegeOffen}</b>
            <p className="lfh-fussnote">offen oder in Arbeit</p>
            {(lagebild?.auftraegeUeberfaellig ?? 0) > 0 && (
              <p className="lfh-fussnote">
                <Plakette stufe="alarm">{lagebild?.auftraegeUeberfaellig} überfällig</Plakette>
              </p>
            )}
            {/* Die drei fristnächsten — der Zähler sagt WIE VIELE, die Zeilen WAS.
                Jede springt auf die Selektion im Auftragsmodul (LFH-25). */}
            <ul className="lfh-zeilen">
              {(lagebild?.auftragszeilen ?? []).map((z) => (
                <li key={z.id}>
                  <Link className="lfh-zeile" to={auftraegePfad(einsatzId, { auftrag: z.id })}>
                    <span className={`lfh-zeichen lfh-zeichen--${z.stufe}`} aria-hidden="true" />
                    {z.lfdNr != null && <span className="lfh-zeile__nr">{z.lfdNr}</span>}
                    <span className="lfh-zeile__text">{z.text}</span>
                    {z.frist && <time className="lfh-zahl">{z.frist}</time>}
                  </Link>
                </li>
              ))}
            </ul>
```

- [ ] **Schritt 5: Die Meldungen-Kachel umbauen**

Die bestehende `ereignisse`-Liste (Zeilen 559–568) durch die Kurzliste ersetzen. `ereignisse`
bleibt im Lagebild — es hat einen anderen Vertrag (5 Einträge, auch erledigte) und wird von
`lageVerdichtung.test.ts` geprüft; nur die Seite liest es nicht mehr:

```tsx
            <ul className="lfh-zeilen">
              {(lagebild?.meldungszeilen ?? []).map((z) => (
                <li key={z.id}>
                  <Link className="lfh-zeile" to={meldungenPfad(einsatzId, { meldung: z.id })}>
                    <span className={`lfh-zeichen lfh-zeichen--${z.stufe}`} aria-hidden="true" />
                    <span className="lfh-zeile__nr">{z.lfdNr}</span>
                    <time className="lfh-zahl">{z.zeit}</time>
                    <span className="lfh-zeile__text">{z.text}</span>
                    <span className="lfh-zeile__quelle">{z.absender}</span>
                  </Link>
                </li>
              ))}
            </ul>
```

- [ ] **Schritt 6: Die Lagebericht-Kachel um den Auszug ergänzen**

Nach der `von`-Fußnote (Zeile 511) einfügen:

```tsx
            {lagebild?.bericht?.auszug && (
              <p className="lfh-auszug">{lagebild.bericht.auszug}</p>
            )}
```

- [ ] **Schritt 7: Tests laufen lassen**

Run: `VITEST src/pages/lage-dashboard`
Expected: PASS — alle. Läuft der Bestandstest „Meldungen: zählt offene/neue …" (Zeile 289) rot,
weil er auf den alten `ereignisse`-Zeilen ansetzt: den Test auf die Kurzliste umschreiben,
nicht die Kachel zurückbauen.

- [ ] **Schritt 8: Mutationsprobe an der Sortierung**

Drehe in `lagebild.ts` in `auftragszeilen` das Vorzeichen des Frist-Vergleichs um
(`a.frist_at < b.frist_at ? 1 : -1`).
Run: `VITEST src/pages/lage-dashboard -t "fristnächsten zuerst"`
Expected: **FAIL**. Zurückdrehen, erneut laufen: PASS.

- [ ] **Schritt 9: Lint**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/dev-clickup-execution-eed38c/frontend lint`
Expected: exit 0, keine Warnung.

- [ ] **Schritt 10: Committen**

```bash
git add frontend/src/pages/lage-dashboard/LageDashboardPage.tsx \
        frontend/src/pages/lage-dashboard/LageDashboardPage.test.tsx \
        frontend/src/theme/sprache.css
git commit -m "feat(lfh-336): zeige Meldungen, Aufträge und Lage als Kurzliste statt Zähler"
```

---

## Task 5: Einsatzauswahl — Ort, Beginn, Sortierung, Suche, Tastatur (AK4, AK5)

**Files:**
- Modify: `frontend/src/pages/EinsaetzePage.tsx:150-173, 234`
- Test: `frontend/src/pages/EinsaetzePage.test.tsx`

**Interfaces:**
- Consumes: `formatZeitKurz(utcStr): string` aus `frontend/src/anzeige/format.ts:102`;
  `EINSATZART_OPTIONEN` aus `frontend/src/einsatz/einsatzart.ts` (bereits importiert);
  `einsatzPfad` aus `routing/deeplinks.ts` (bereits importiert)
- Produces: nichts für spätere Tasks

- [ ] **Schritt 1: Tests schreiben**

Neuen `describe`-Block ans Ende von `EinsaetzePage.test.tsx`. **Zuerst die Datei lesen** und die
dortige Fixture-/Mock-Hilfe wiederverwenden statt eine zweite zu bauen — der Block unten setzt
eine Hilfe `mockEinsaetze(liste)` und ein `render()` voraus, die dort vorhanden sind; heißen sie
anders, die vorhandenen Namen nehmen.

```tsx
describe('Einsatzkarte — Lagebild statt vier Felder (LFH-336 · M4/M5)', () => {
  const e = (over: Partial<EinsatzAnzeige>): EinsatzAnzeige =>
    ({
      id: 1, bezeichnung: 'Hochwasser Musterstadt', stichwort: 'TH Hochwasser',
      status: 'aktiv', einsatzart: 'realeinsatz', begonnen_at: '2026-06-08 06:12:00',
      angelegt_at: '2026-06-08 06:12:00', einsatzort: 'Musterstadt, Deichweg 3',
      org_id: 1, org_name: 'THW Musterstadt', meine_rolle: 'einsatzleitung',
      ...over,
    }) as EinsatzAnzeige;

  it('die Karte nennt den Einsatzort', async () => {
    mockEinsaetze([e({ einsatzort: 'Musterstadt, Deichweg 3' })]);
    render();
    expect(await screen.findByText(/Musterstadt, Deichweg 3/)).toBeInTheDocument();
  });

  it('die Karte nennt einen aus begonnen_at abgeleiteten Zeitstand', async () => {
    mockEinsaetze([e({ begonnen_at: '2026-06-08 06:12:00' })]);
    render();
    // `formatZeitKurz` liefert „0806 12" bzw. „0612" je nach Tagesbezug; geprüft
    // wird das WORT „seit" plus der von der Funktion gelieferte Wert — die
    // Formatierung selbst ist in `format.test.ts` geprüft und wird hier nicht
    // zweitgeprüft (sonst stünde die Erwartung an zwei Orten).
    const erwartet = formatZeitKurz('2026-06-08 06:12:00');
    expect(await screen.findByText(new RegExp(`seit ${erwartet}`))).toBeInTheDocument();
  });

  it('die Karte trägt die Einsatzart als zweiten Tag neben dem Status', async () => {
    mockEinsaetze([e({ einsatzart: 'uebung' })]);
    render();
    expect(await screen.findByText('aktiv')).toBeInTheDocument();
    expect(screen.getByText('Übung')).toBeInTheDocument();
  });

  it('ohne Einsatzort bleibt die Ortszeile ganz weg statt leer zu stehen', async () => {
    mockEinsaetze([e({ einsatzort: null })]);
    render();
    await screen.findByText('Hochwasser Musterstadt');
    expect(screen.queryByTestId('einsatz-ort')).not.toBeInTheDocument();
  });

  it('aktive Einsätze stehen nach Beginn absteigend — der jüngste zuerst', async () => {
    mockEinsaetze([
      e({ id: 1, bezeichnung: 'Alt', begonnen_at: '2026-06-01 08:00:00' }),
      e({ id: 2, bezeichnung: 'Neu', begonnen_at: '2026-06-09 08:00:00' }),
    ]);
    render();
    await screen.findByText('Alt');
    const karten = screen.getAllByRole('link', { name: /Alt|Neu/ });
    expect(karten[0]).toHaveTextContent('Neu');
  });

  it('bei 9 aktiven Einsätzen erscheint das Suchfeld', async () => {
    mockEinsaetze(
      Array.from({ length: 9 }, (_, i) => e({ id: i + 1, bezeichnung: `Einsatz ${i + 1}` })),
    );
    render();
    expect(await screen.findByRole('searchbox', { name: /Einsätze durchsuchen/ })).toBeInTheDocument();
  });

  it('bei 3 aktiven Einsätzen erscheint kein Suchfeld', async () => {
    mockEinsaetze(
      Array.from({ length: 3 }, (_, i) => e({ id: i + 1, bezeichnung: `Einsatz ${i + 1}` })),
    );
    render();
    await screen.findByText('Einsatz 1');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('die Suche filtert über Bezeichnung, Ort und Stichwort', async () => {
    const nutzer = userEvent.setup();
    mockEinsaetze(
      Array.from({ length: 9 }, (_, i) =>
        e({ id: i + 1, bezeichnung: `Einsatz ${i + 1}`, einsatzort: i === 0 ? 'Deichweg' : 'Sonstwo' }),
      ),
    );
    render();
    const feld = await screen.findByRole('searchbox', { name: /Einsätze durchsuchen/ });
    await nutzer.type(feld, 'Deichweg');
    expect(screen.getByText('Einsatz 1')).toBeInTheDocument();
    expect(screen.queryByText('Einsatz 2')).not.toBeInTheDocument();
  });

  // AK4. Der Titel ist schon ein `<Link>` — der Test hält diese Eigenschaft fest,
  // damit ein späterer Umbau auf ein `<div onClick>` auffliegt statt still die
  // Tastaturbedienung zu kosten.
  it('die Tabulatortaste erreicht die Einsatzkarte, Enter navigiert', async () => {
    const nutzer = userEvent.setup();
    mockEinsaetze([e({ id: 7, bezeichnung: 'Hochwasser Musterstadt' })]);
    // Die Zielroute muss MITGERENDERT werden. `renderMitProviders` fährt einen
    // MemoryRouter (test/utils.tsx:38) — `window.location` bewegt sich dort nie,
    // eine Zusicherung darauf wäre rot, ohne dass die Navigation kaputt ist.
    // Dasselbe Muster wie im Dashboard-Test (dort „PERSONEN-MODUL").
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze" element={<EinsaetzePage />} />
        <Route path="/einsaetze/:id" element={<div>EINSATZ-DETAIL</div>} />
      </Routes>,
      { route: '/einsaetze' },
    );
    const karte = await screen.findByRole('link', { name: 'Hochwasser Musterstadt' });
    // Bis zur Karte tabben, statt sie zu fokussieren: „ist per Tastatur
    // ERREICHBAR" ist die Aussage, nicht „reagiert, wenn man sie fokussiert".
    // Vor den Karten liegt bei Anlegerecht der „Neuer Einsatz"-Knopf.
    for (let i = 0; i < 10 && document.activeElement !== karte; i++) await nutzer.tab();
    expect(karte).toHaveFocus();
    await nutzer.keyboard('{Enter}');
    expect(await screen.findByText('EINSATZ-DETAIL')).toBeInTheDocument();
  });
});
```

- [ ] **Schritt 2: Tests laufen lassen, Fehlschlag bestätigen**

Run: `VITEST src/pages/EinsaetzePage.test.tsx -t "Lagebild statt vier Felder"`
Expected: FAIL — Ort, Zeitstand, Einsatzart-Tag und Suchfeld fehlen. Der Tastaturtest sollte
bereits PASS sein (der Titel ist ein `<Link>`); ist er das, ist er trotzdem wertvoll — er hält
die Eigenschaft fest.

- [ ] **Schritt 3: Karte und Liste umbauen**

In `EinsaetzePage.tsx` Imports ergänzen:

```tsx
import { EnvironmentOutlined } from '@ant-design/icons';
import { formatZeitKurz } from '../anzeige/format';
```

Im **Testblock** ebenfalls: `formatZeitKurz` und — für den Enter-Test — `Route`, `Routes`,
`renderMitProviders`, `EinsaetzePage` und der Typ `EinsatzAnzeige` müssen importiert sein.
Was die Datei oben schon importiert, nicht doppelt aufnehmen.

Nach `KACHEL_MIN_HOEHE` (Zeile 65) die Schwelle als benannte Konstante:

```tsx
/**
 * Ab wie vielen aktiven Einsätzen ein Suchfeld erscheint.
 *
 * Acht, weil das Raster darunter auf dem Fükw-Schirm zwei Reihen füllt — bis
 * dahin ist Suchen langsamer als Hinsehen. Ein dauerhaft stehendes Suchfeld über
 * drei Karten wäre Bedienlast ohne Nutzen.
 */
const SUCHE_AB = 8;

```

Für die Beschriftung der Einsatzart **keine** neue Zuordnung bauen: `einsatz/einsatzart.ts`
exportiert bereits `EINSATZART_LABELS: Record<Einsatzart, string>` (`realeinsatz` → „Realeinsatz",
`uebung` → „Übung", `sanitaetsdienst` → „Sanitätsdienst", `bereitstellung` → „Bereitstellung").
Der `Record` bricht bei einer fünften Variante den Build; eine `Map` daneben täte das nicht.
Import in `EinsaetzePage.tsx` erweitern:

```tsx
import { EINSATZART_LABELS, EINSATZART_OPTIONEN } from '../einsatz/einsatzart';
```

`renderKarte` (Zeilen 153–173) ersetzen:

```tsx
  const renderKarte = (e: EinsatzAnzeige, klein = false) => (
    <Card
      key={e.id}
      hoverable
      title={
        <Link to={einsatzPfad(e.id)} onClick={(event) => event.stopPropagation()}>
          {e.bezeichnung}
        </Link>
      }
      style={klein ? { opacity: 0.65 } : { minHeight: KACHEL_MIN_HOEHE }}
      onClick={() => navigate(einsatzPfad(e.id))}
    >
      <Space orientation="vertical">
        <Space wrap>
          <StatusTag darstellung={EINSATZ_STATUS[e.status]} />
          <Tag>{EINSATZART_LABELS[e.einsatzart]}</Tag>
          {e.meine_rolle && <Tag>{e.meine_rolle}</Tag>}
        </Space>
        {/* Ort und Beginn beantworten „welcher ist meiner?" — vorher standen sie
            nur im Kopfdatenformular, drei Klicks entfernt (Befund M4). Die Ikone
            kommt aus `@ant-design/icons` und trägt eine `aria-hidden`-Hülle: der
            Knoten brächte sonst ein englisches `role="img"`-Label mit. */}
        {e.einsatzort && (
          <Typography.Text type="secondary" data-testid="einsatz-ort">
            <span aria-hidden="true">
              <EnvironmentOutlined />{' '}
            </span>
            {e.einsatzort}
          </Typography.Text>
        )}
        <Typography.Text type="secondary">seit {formatZeitKurz(e.begonnen_at)}</Typography.Text>
        {e.stichwort && <Typography.Text type="secondary">{e.stichwort}</Typography.Text>}
      </Space>
    </Card>
  );
```

Sortierung und Filter — die Zeilen 150–151 ersetzen:

```tsx
  const [suche, setSuche] = useState('');

  // Der jüngste Einsatz zuerst: wer die Auswahl öffnet, sucht in aller Regel den,
  // der gerade läuft. Absteigend nach `begonnen_at` — der Wirestring ist
  // sortierbar (`YYYY-MM-DD HH:mm:ss`), ein Date-Parse wäre hier überflüssig.
  const aktive = einsaetze
    .filter((e: EinsatzAnzeige) => e.status === 'aktiv')
    .sort((a, b) => (a.begonnen_at < b.begonnen_at ? 1 : -1));
  const abgeschlossene = einsaetze.filter((e: EinsatzAnzeige) => e.status === 'abgeschlossen');

  const suchbegriff = suche.trim().toLowerCase();
  const passt = (e: EinsatzAnzeige) =>
    !suchbegriff ||
    [e.bezeichnung, e.einsatzort, e.stichwort].some((f) =>
      (f ?? '').toLowerCase().includes(suchbegriff),
    );
  const sichtbareAktive = aktive.filter(passt);
  const sucheZeigen = aktive.length >= SUCHE_AB;
```

Das Suchfeld über dem Raster einfügen (vor dem `<div data-testid="einsaetze-raster">`, Zeile 210):

```tsx
      {!isPending && sucheZeigen && (
        <div style={{ marginBottom: abstand.md, maxWidth: flaeche.kachelMin * 2 }}>
          <Input.Search
            aria-label="Einsätze durchsuchen"
            placeholder="Bezeichnung, Ort oder Stichwort"
            allowClear
            value={suche}
            onChange={(ev) => setSuche(ev.target.value)}
          />
        </div>
      )}
```

Und die Kartenzeile im Raster (Zeile 234) auf die gefilterte Liste umstellen:

```tsx
            {sichtbareAktive.map((e: EinsatzAnzeige) => renderKarte(e))}
```

- [ ] **Schritt 4: Tests laufen lassen**

Run: `VITEST src/pages/EinsaetzePage.test.tsx`
Expected: PASS — alle bestehenden plus die neun neuen.

Zwei erwartbare Stolperstellen: (a) `Input.Search` rendert in antd 6 ein `<input type="search">`
und damit die Rolle `searchbox` — meldet RTL stattdessen `textbox`, die Rolle in den Tests
anpassen, nicht das Feld umbauen. (b) `formatZeitKurz` liefert für „heute" ein anderes Format als
für ältere Daten; deshalb steht im Test der **berechnete** Wert, kein Literal.

- [ ] **Schritt 5: Mutationsprobe am Tastaturtest**

Ersetze den `<Link>` im Kartentitel versuchsweise durch `<span>{e.bezeichnung}</span>`.
Run: `VITEST src/pages/EinsaetzePage.test.tsx -t "Tabulatortaste"`
Expected: **FAIL**. Zurückändern, erneut laufen: PASS. Ohne diese Probe wäre nicht belegt, dass
der Test die Tastaturbedienbarkeit trägt und nicht bloß eine Karte findet.

- [ ] **Schritt 6: Lint + Typecheck**

Run:
```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/dev-clickup-execution-eed38c/frontend lint
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/dev-clickup-execution-eed38c/frontend exec tsc --noEmit
```
Expected: beide exit 0.

- [ ] **Schritt 7: Committen**

```bash
git add frontend/src/pages/EinsaetzePage.tsx frontend/src/pages/EinsaetzePage.test.tsx
git commit -m "feat(lfh-336): zeige Ort, Beginn und Einsatzart auf der Einsatzkarte"
```

---

## Task 6: Prüfliste Einsatztauglichkeit und Gesamt-Gate

**Files:**
- Create: `docs/superpowers/specs/2026-08-08-lfh336-pruefliste-einsatztauglichkeit.md`

**Interfaces:**
- Consumes: die 15 Kriterien aus
  `docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`
- Produces: den Abnahmenachweis für den Task

- [ ] **Schritt 1: Die Kriterienliste lesen**

```bash
grep -n "Kriterium\|^### \|^| " docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md | head -60
```

Die 15 Kriterien wörtlich übernehmen — nicht aus dem Gedächtnis nachbauen.

- [ ] **Schritt 2: Prüfliste je Seite ausfüllen**

Neue Datei `docs/superpowers/specs/2026-08-08-lfh336-pruefliste-einsatztauglichkeit.md`.
Zwei Tabellen — eine für `LageDashboardPage`, eine für `EinsaetzePage`. Jede Zeile trägt ein
**Verdikt**: `erfüllt` (mit Beleg: Datei:Zeile oder Testname) / `offen → <Ticket>` /
`nicht anwendbar` (mit Begründung). **„nicht geprüft" ist kein Verdikt** — CLAUDE.md.

Kopfzeile der Datei:

```markdown
# LFH-336 · Prüfliste Einsatztauglichkeit

Angelegt an die zwei in LFH-336 umgebauten Seiten: `pages/lage-dashboard/LageDashboardPage.tsx`
und `pages/EinsaetzePage.tsx`. Kriterien wörtlich aus
`2026-07-25-bedien-leitlinie-einsatzkontexte.md`.

| # | Kriterium | LageDashboardPage | EinsaetzePage |
|---|---|---|---|
```

- [ ] **Schritt 3: Die Akzeptanzkriterien des Tickets nachmessen**

Alle sechs, mit ausgeschriebenem Ergebnis in der Prüfliste-Datei unter „AK-Nachweis":

```bash
cd /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/dev-clickup-execution-eed38c
grep -c 'Tag color="blue">Live' frontend/src/pages/lage-dashboard/LageDashboardPage.tsx   # erwartet 0
grep -rn '/einsaetze/\${' frontend/src/pages/EinsaetzePage.tsx frontend/src/pages/lage-dashboard/  # erwartet leer
```

- [ ] **Schritt 4: Das volle Gate fahren**

```bash
cd /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/dev-clickup-execution-eed38c
./scripts/check-all.sh
```

Expected: exit 0 über alle sieben Schritte. **Kein `| tail`** — das maskiert den Exit-Code.
Bricht ein Schritt, wird er behoben, nicht übersprungen. Bei Vitest-Flakiness unter Last (bekannt:
wandernder Spec, Timeout statt Assertion) den betroffenen Lauf einzeln wiederholen und den
Unterschied ausweisen, statt „grün" zu melden.

- [ ] **Schritt 5: Committen**

```bash
git add docs/superpowers/specs/2026-08-08-lfh336-pruefliste-einsatztauglichkeit.md
git commit -m "docs(lfh-336): dokumentiere Prüfliste Einsatztauglichkeit und AK-Nachweis"
```

---

## Self-Review

**Spec-Abdeckung** — jedes Akzeptanzkriterium hat einen Task:

| AK | Task | Anmerkung |
|---|---|---|
| Kein statischer Live-Tag + Vitest gegen Abriss | 2 | Der Grep misst schon heute 0; die Substanz liefert erst Task 2 |
| Vitest Meldungen/Aufträge: Zeile mit lfd_nr/Zeit/Absender bzw. Text/Frist, Leerzustand unterscheidbar | 3 (Daten) + 4 (Rendern) | |
| Keine Inline-Pfade in EinsaetzePage und lage-dashboard | 1 | EinsaetzePage war bereits sauber |
| RTL: Tab erreicht Karte, Enter navigiert | 5 | Plus Mutationsprobe |
| Vitest EinsaetzePage: Ort + Zeitstand, Suchfeld bei 9 / nicht bei 3 | 5 | |
| `pnpm lint` grün, `check-all.sh` läuft durch | 4, 5, 6 | |

Zusätzlich abgedeckt, weil CLAUDE.md es verlangt und die AK-Liste es nicht nennt:
Prüfliste Einsatztauglichkeit (Task 6).

**Nicht im Umfang** — bewusst, mit Begründung:
- **Lagebericht-Kachel: Titel/Status/Zeitstand/Ersteller** bleiben unverändert (Ticket: „bleiben").
- **`ereignisse` im Lagebild** wird nicht entfernt, nur von der Seite nicht mehr gelesen. Es hat
  einen eigenen, getesteten Vertrag; es zu löschen wäre ein zweiter Umbau in fremdem Testgebiet.
- **`useEinsatzLiveStream`** bleibt unangetastet — siehe „Entschiedene Gabelungen".
- **B7/B2/B3-Primitive** werden konsumiert, nicht erweitert. `components/Klickbar.tsx` existiert
  bereits; ein Hochziehen entfällt.

**Vier Defekte, die eine zweite Durchsicht gefunden hat** — eingearbeitet, hier als Warnung für
den nächsten, der diese Stellen anfasst:

1. **`:first-child` bricht am `<li>`-Wrapper.** Ein Wrapper zwischen `<ul>` und Zeile macht jede
   Zeile zum ersten Kind — keine Trennlinie mehr, in jsdom unsichtbar. Fix + Guard in Task 4.
2. **`leer` folgte nicht dem Zeilenfilter.** Lauter vollzogene Aufträge → nicht leer, aber auch
   keine Zeile: ein leerer Kasten. Ein Test mit `[]` erfüllt sich am trivialen Fall und sieht das
   nicht — deshalb der Test mit `bearbeitungsstatus: 'vollzogen'`.
3. **`window.location` bewegt sich im MemoryRouter nicht.** Der Enter-Test rendert die Zielroute
   mit und prüft deren Inhalt.
4. **`uhrzeit()` war UTC-roh.** Auf Fristen ausgedehnt wäre das eine Uhr, die zwei Stunden falsch
   geht, an genau der Stelle, wo jemand danach handelt. Zonenrichtig gemacht in Task 3, mit
   explizit übergebener Zone in den Tests (die Suite fixiert keine `TZ`).

**Typkonsistenz:** `Meldungszeile`/`Auftragszeile` (Task 3) heißen in Task 4 genauso;
`lagebild.meldungszeilen`/`auftragszeilen` und `bericht.auszug` sind in Task 3 definiert und in
Task 4 gelesen. `abonniereLiveStatus`/`leseLiveStatus`/`setzeLiveStatusFuerTest` (Task 2) tragen
in Store, Banner, Seite und Tests dieselben Namen.
