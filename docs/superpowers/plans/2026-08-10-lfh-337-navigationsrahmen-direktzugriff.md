# LFH-337 · C2 Navigationsrahmen beschriften und Direktzugriff schaffen — Umsetzungsplan

> **Für agentische Arbeiter:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`, um diesen Plan Task für Task umzusetzen.
> Schritte tragen Checkbox-Syntax (`- [ ]`) zur Nachverfolgung.

**Ziel:** Die oberste Navigationsebene des Einsatz-Workspace bekommt sichtbare
Beschriftungen, der Rail-Klick führt direkt in ein Modul, ein „Zuletzt"-Speicher verkürzt
die 2-Klick-Tiefe, die Befehlspalette sortiert nach Nützlichkeit statt nach Zufall, und die
letzten vier Inline-Einsatzpfade wandern auf `routing/deeplinks.ts`.

**Architektur:** Alle Änderungen liegen im Frontend und folgen den im Repo etablierten
Mustern: dichtefeste Maße als **reine, exportierte Stilfunktionen** (Präzedenz
`ModulPanel.modulZeilenStil`, `Sidebar.bedienzielStil`), Persistenz je Einsatz als
Modul mit `try`/`catch` (Präzedenz `pages/uhs/uhsAuswahl.ts`), Pfade ausschließlich über
`routing/deeplinks.ts`. Kein Backend, keine Migration, kein neuer Query-Key.

**Tech-Stack:** React 19, TypeScript, antd 6, react-router, Vitest + Testing Library,
`react-icons/tb`, `@ant-design/icons`.

## Globale Randbedingungen

- **Pfade nur über `routing/deeplinks.ts`** — kein Inline-Template-Literal `/einsaetze/${…}`
  (CLAUDE.md, Deeplink-Muster).
- **Neues punktuelles `size="small"` auf interaktiven Elementen ist verboten**, erzwungen von
  `components/dichte.guard.test.ts`.
- **Ein handgebautes Bedienziel braucht ZWEI Angaben**: `minHeight` aus `token.controlHeight`
  **plus** `padding` aus `token.paddingSM`/`token.padding` (LFH-365). Träger sind **aufgelöste
  Tokens**, nie `var(--lfh-*)`.
- **Trefflächen-Böden heben, nie senken:** `Math.max(boden, token.controlHeight)`, niemals `??`
  (gemessen in LFH-370/B5j, Kommentar in `ModulPanel.tsx:29-31`).
- **Dichte-Zusicherungen werden an der reinen Funktion geprüft, nicht gerendert.**
  `test/utils.tsx:31` montiert ein nacktes `ConfigProvider` ohne unser Theme — `useToken()`
  liefert dort den antd-Seed (`controlHeight: 32`), also **keine** der Stufen 30/48/72. Böden
  stehen als **Literale** im Test, nie aus `dichten` zurückgelesen.
- **Ein Emoji ist keine Ikone** — `@ant-design/icons` bzw. `react-icons/tb`, und jede
  dekorative Ikone in einer `aria-hidden`-Hülle (sie bringt `role="img"` mit englischem
  `aria-label` mit).
- **Farbwerte ausschließlich aus `theme/tokens.ts` / `theme/rollen.css`.** Rot bedient nichts.
- **Gate:** `./scripts/check-all.sh` vor dem Merge. Kein `| tail` um Gate-Kommandos.
- **Frontend-Kommandos:** `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-367-dev-clickup-122a26/frontend <cmd>` — immer absoluter `-C`-Pfad.
- **Commit-Body referenziert `LFH-337`.**

## Vorab geklärt (nicht neu verhandeln)

1. **AK2 ist durch LFH-335/B7 überholt.** Der sichtbare Such-Trigger existiert bereits als
   `components/CommandPaletteTrigger.tsx` und hängt in **beiden** Kopfzeilen
   (`AppLayout.tsx:75`, `EinsatzLayout.tsx:242`) — mit Lupe, „Suchen", `Tastenkuerzel`-Marke
   (⌘K / Strg+K), `aria-keyshortcuts` und 48 px Trefffläche unter `lg`. To-do 2 ist **erledigt**.
   Der AK-Grep zeigt auf die falschen Dateien, weil der Wortlaut in der gemeinsamen Komponente
   steht statt zweimal dupliziert. **Nicht** `'⌘K'` in die Layouts schreiben, nur damit ein
   Grep grün wird — das ist Gate-Fütterung. Stattdessen: AK-Korrektur in Task 8 dokumentieren.
2. **Rail-Klick (To-do 4): nur eine FREMDE Kategorie navigiert.** Vom Menschen entschieden.
   Der Klick auf die bereits aktive Kategorie bleibt der reine Zuklapp-Umschalter mit
   Persistenz aus LFH-329/B1. Grund: Navigieren ändert `aktuellesModul` → der Effekt in
   `EinsatzLayout.tsx:117-119` setzt `offeneKategorie` neu → ein „immer navigieren" höbe das
   persistierte Zuklappen selbst auf.
3. **Die beschriftete Rail-Spalte ab ≥1280 px entfällt.** Vom Menschen entschieden; das Ticket
   nennt sie ausdrücklich „optional". Eine Darstellung für alle Breiten, keine dritte
   Breitenweiche im Navigationsrahmen.
4. **Kontrast für To-do 7 ist gerechnet:** gegen den Kopfzeilengrund `#001529` liefert
   `farbenDunkel.gedaempft` (`#9aa7b6`) **7,5:1** und `farbenDunkel.schwach` (`#7d8b9b`)
   **5,3:1**. Gewählt wird `farbenDunkel.schwach` — deutlich schwächer als der weiße
   Aktiv-Link und trotzdem klar über 4,5:1.
5. **`einsatzPfad` existiert bereits** (`routing/deeplinks.ts:35`) und wird in
   `befehle.ts:154` schon benutzt. Der Builder-Teil von To-do 6 ist erledigt; offen sind
   vier Aufrufstellen.
6. **`ModulRedirect.tsx:9` steht nicht im Ticket**, liegt aber im Grep-Radius des AK
   (`frontend/src/einsatz`). Ohne es wird die geforderte 0 nicht erreicht.

## Dateistruktur

| Datei | Verantwortung | Task |
|---|---|---|
| `einsatz/EinsatzSwitcher.tsx` | Einsatzwechsel-Menü — Pfad über Builder | 1 |
| `einsatz/ModulRedirect.tsx` | Deep-Link-Umleitung — Pfad über Builder | 1 |
| `einsatz/EinsatzLayout.tsx` | Rahmen: Pfad, Besuchsaufzeichnung, Rail-Klick | 1, 5, 7 |
| `command-palette/befehle.ts` | Befehlsliste: Pfad, „Zuletzt"-Gruppe | 1, 6 |
| `components/AppLayout.tsx` | Gesperrter Verwaltungs-Link: Token + `Tag` | 2 |
| `einsatz/IconRail.tsx` | **neu:** `railZielStil`; sichtbares Label | 3 |
| `einsatz/zuletztModule.ts` | **neu:** „Zuletzt"-Speicher je Einsatz | 4 |
| `einsatz/ModulPanel.tsx` | „Zuletzt"-Zeile über der Modulliste | 5 |
| `command-palette/typen.ts` | Gruppe `zuletzt`, gedrehte Reihenfolge | 6 |
| `command-palette/CommandPalette.tsx` | Höhe `min(60vh, 480px)` | 6 |
| `command-palette/useBefehle.ts` | „Zuletzt"-Keys in den Kontext | 6 |
| `einsatz/modulRegistry.ts` | **neu:** `erstesFreigegebenesModul` | 7 |
| `docs/…/2026-08-10-lfh-337-pruefliste.md` | **neu:** Prüfliste Einsatztauglichkeit | 8 |

---

### Task 1: Die vier verbliebenen Inline-Einsatzpfade auf `deeplinks.ts` umstellen

Billigster Task, hart per Grep messbar, und `deeplinks.ts` ist laut Ticket mit C1/C3 geteilt —
früh landen verkleinert die Konfliktfläche.

**Files:**
- Modify: `frontend/src/einsatz/EinsatzSwitcher.tsx:37`
- Modify: `frontend/src/einsatz/EinsatzLayout.tsx:196`
- Modify: `frontend/src/einsatz/ModulRedirect.tsx:9`
- Modify: `frontend/src/command-palette/befehle.ts:126`
- Test: `frontend/src/einsatz/ModulRedirect.test.tsx`
- Test: `frontend/src/routing/deeplinks.test.ts`

**Interfaces:**
- Consumes: `einsatzPfad(einsatzId: number): string` und
  `einsatzModulPfad(einsatzId: number, modulRoute: string): string` aus
  `routing/deeplinks.ts` — beide existieren bereits.
- Produces: nichts Neues; danach gilt repoweit
  `grep -rc '/einsaetze/\${' frontend/src/einsatz frontend/src/command-palette` = 0.

- [ ] **Schritt 1: Guard-Test schreiben, der die Inline-Literale verbietet**

Neue Datei `frontend/src/routing/inlinePfade.guard.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Kein Inline-Template-Literal für Einsatzpfade (LFH-337 · M9).
 *
 * Der Guard scannt QUELLTEXT, nicht Laufzeitverhalten: ein geänderter Pfad bricht
 * nichts sichtbar, er führt bloß woanders hin. Bewusst auf die zwei Verzeichnisse
 * des Navigationsrahmens gescopt — dieselbe Scoping-Begründung wie bei
 * `components/aktionsabstand.guard.test.ts`: ein repoweiter Scan wäre rot geboren
 * und würde abgeschaltet statt befolgt.
 *
 * Was er NICHT sieht (Teil des Vertrags, nicht Beiwerk):
 *  - Pfade, die über eine Variable zusammengesetzt werden (`const p = '/einsaetze/' + id`)
 *  - Pfade in anderen Verzeichnissen
 *  - Test-Dateien (bewusst ausgenommen: dort sind Literale die ehrlichere Erwartung)
 */
const WURZELN = ['frontend/src/einsatz', 'frontend/src/command-palette'];
const VERBOTEN = /\/einsaetze\/\$\{/;

function dateien(pfad: string): string[] {
  return readdirSync(pfad).flatMap((eintrag) => {
    const voll = join(pfad, eintrag);
    if (statSync(voll).isDirectory()) return dateien(voll);
    if (!/\.tsx?$/.test(eintrag) || /\.test\.tsx?$/.test(eintrag)) return [];
    return [voll];
  });
}

describe('Einsatzpfade im Navigationsrahmen', () => {
  it('baut keinen Pfad als Inline-Template-Literal', () => {
    const treffer = WURZELN.flatMap(dateien)
      .filter((datei) => VERBOTEN.test(readFileSync(datei, 'utf8')));
    expect(treffer, 'Builder aus routing/deeplinks.ts benutzen').toEqual([]);
  });
});
```

- [ ] **Schritt 2: Guard laufen lassen — er muss ROT sein**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-367-dev-clickup-122a26/frontend vitest run src/routing/inlinePfade.guard.test.ts
```

Erwartet: FAIL mit vier Treffern — `einsatz/EinsatzSwitcher.tsx`, `einsatz/EinsatzLayout.tsx`,
`einsatz/ModulRedirect.tsx`, `command-palette/befehle.ts`. Ist die Liste kürzer als vier, ist
der Scanner kaputt, nicht das Repo — **erst das klären**, bevor irgendetwas umgestellt wird.

- [ ] **Schritt 3: `EinsatzSwitcher.tsx` umstellen**

Import ergänzen (`einsaetzePfad` gibt es bereits als Builder — die zwei nackten Literale
`'/einsaetze'` und `'/stammdaten'` bleiben; für Stammdaten existiert kein Builder, und die
nackte Liste führt `deeplinks.ts` laut eigenem Dateikopf bewusst nicht):

```tsx
import { einsatzPfad } from '../routing/deeplinks';
```

Und die Klickbehandlung:

```tsx
  const onClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'alle') navigate('/einsaetze');
    else if (key === 'stammdaten') navigate('/stammdaten');
    else if (key.startsWith('einsatz-')) {
      navigate(einsatzPfad(Number(key.slice('einsatz-'.length))));
    }
  };
```

- [ ] **Schritt 4: `EinsatzLayout.tsx:196` umstellen**

Import ergänzen:

```tsx
import { einsatzModulPfad } from '../routing/deeplinks';
```

Und:

```tsx
  function onModulKlick(modul: ModulEintrag) {
    navigate(einsatzModulPfad(einsatzId, modulZielRoute(modul)));
    setNavOffen(false);
  }
```

- [ ] **Schritt 5: `ModulRedirect.tsx` umstellen**

Vollständige neue Fassung:

```tsx
import { Navigate, useParams } from 'react-router';
import { einsatzModulPfad } from '../routing/deeplinks';

/**
 * Deep-Link-Modul: leitet auf die `route` eines anderen Moduls im selben Einsatz um.
 * Absoluter Pfad, weil relatives Navigieren aus einer Leaf-Route mehrdeutig ist.
 *
 * `Number(id)` statt des rohen Params: der Builder nimmt laut Dateikopf von
 * `deeplinks.ts` eine gültige positive Integer-ID entgegen. Die Route matcht ohnehin
 * nur MIT `:id`, ein fehlender Param ist hier also nicht erreichbar — die Umwandlung
 * ist die Vertragserfüllung gegenüber dem Builder, keine Guard-Verdopplung.
 */
export default function ModulRedirect({ to }: { to: string }) {
  const { id } = useParams();
  return <Navigate to={einsatzModulPfad(Number(id), to)} replace />;
}
```

- [ ] **Schritt 6: `befehle.ts:126` umstellen**

`einsatzModulPfad` in den bestehenden Import-Block aus `../routing/deeplinks` aufnehmen
(er importiert bereits `einsaetzePfad`, `einsatzPfad`, `etbPfad`, `personenPfad`,
`schaedenPfad`, `unfallhilfsstellenListePfad`) und die Zeile ersetzen:

```ts
      const ziel = einsatzModulPfad(k.einsatzId, modulZielRoute(m));
```

- [ ] **Schritt 7: Guard laufen lassen — jetzt GRÜN**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-367-dev-clickup-122a26/frontend vitest run src/routing/inlinePfade.guard.test.ts
```

Erwartet: PASS.

- [ ] **Schritt 8: Bestandstests der vier Dateien laufen lassen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-367-dev-clickup-122a26/frontend vitest run src/einsatz/EinsatzSwitcher.test.tsx src/einsatz/EinsatzLayout.test.tsx src/einsatz/ModulRedirect.test.tsx src/command-palette/befehle.test.ts src/routing/deeplinks.test.ts
```

Erwartet: PASS. Die Pfade sind byte-gleich zu vorher — ein roter Test hier bedeutet, dass
ein Builder etwas anderes baut als das Literal, und ist **vor** dem Commit zu klären.

- [ ] **Schritt 9: Commit**

```bash
git add frontend/src/einsatz/EinsatzSwitcher.tsx frontend/src/einsatz/EinsatzLayout.tsx frontend/src/einsatz/ModulRedirect.tsx frontend/src/command-palette/befehle.ts frontend/src/routing/inlinePfade.guard.test.ts && git commit -m "refactor(lfh-337): baut Einsatzpfade im Navigationsrahmen ueber deeplinks-Builder

Die letzten vier Inline-Template-Literale (Befund M9) wandern auf einsatzPfad/
einsatzModulPfad. Ein gescopter Quelltext-Guard haelt sie draussen; sein
Blindfleck steht im Kopfkommentar.

LFH-337"
```

---

### Task 2: Gesperrter Verwaltungs-Link — Token statt Hartwert, Grund dauerhaft sichtbar

**Files:**
- Modify: `frontend/src/components/AppLayout.tsx:30-56`
- Test: `frontend/src/components/AppLayout.test.tsx`

**Interfaces:**
- Consumes: `farbenDunkel` aus `theme/tokens.ts` (bereits im Repo, in `IconRail.tsx:2` benutzt).
- Produces: nichts, das spätere Tasks brauchen.

- [ ] **Schritt 1: Test schreiben, der Hartwert und Nur-Hover-Begründung verbietet**

An `frontend/src/components/AppLayout.test.tsx` anhängen (Import
`import { farbenDunkel } from '../theme/tokens';` ergänzen):

```tsx
describe('AppLayout · gesperrter Verwaltungs-Link (LFH-337 · M10)', () => {
  it('nennt den Grund als sichtbaren Text, nicht nur im title', async () => {
    // Default-`/api/auth/me` liefert 401 → benutzer = null → darfVerwaltung false.
    renderMitProviders(<AppLayout />);
    expect(await screen.findByText('Keine Berechtigung')).toBeVisible();
  });

  it('faerbt den gesperrten Link aus der Farbrolle, nicht aus einem rgba-Hartwert', async () => {
    renderMitProviders(<AppLayout />);
    const text = (await screen.findByText('Verwaltung')).closest('span');
    // Die ROLLE ist die Aussage, nicht die Zahl: `farbenDunkel.schwach` liefert gegen
    // den Kopfzeilengrund #001529 gerechnete 5,3:1, der abgeloeste Wert
    // rgba(255,255,255,0.35) nur ~3,2:1. jsdom rechnet keine Farbmischung — die Zahl
    // steht deshalb im Commit, hier steht die Herkunft.
    expect(text).toHaveStyle({ color: farbenDunkel.schwach });
  });

  it('zeigt fuer Berechtigte den freien Link ohne Sperrhinweis', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json({
        id: 1, anzeigename: 'A', benutzername: 'a', system_rolle: 'admin',
        org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00',
        totp_aktiviert: false,
      })),
    );
    renderMitProviders(<AppLayout />);
    // Die Gegenaussage macht die erste ueberhaupt pruefbar: ohne sie waere ein
    // dauerhaft eingeblendetes „Keine Berechtigung" ebenfalls gruen.
    expect(await screen.findByRole('link', { name: 'Verwaltung' })).toBeInTheDocument();
    expect(screen.queryByText('Keine Berechtigung')).toBeNull();
  });
});
```

Fehlen `server`/`http`/`HttpResponse` in der Datei, aus `msw` bzw. `../test/server` nach dem
Muster der übrigen Tests importieren, die einen konkreten Benutzer setzen.

- [ ] **Schritt 2: Tests laufen lassen — ROT**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-367-dev-clickup-122a26/frontend vitest run src/components/AppLayout.test.tsx
```

Erwartet: die ersten beiden neuen Tests FAIL („Keine Berechtigung" nicht im DOM;
`color` ist `rgba(255,255,255,0.35)`), der dritte PASS.

- [ ] **Schritt 3: `GlobalLink` umbauen**

`AppLayout.tsx` — Imports ergänzen (`Tag` zu den antd-Importen, `farbenDunkel` neu;
`LockOutlined` entfällt):

```tsx
import { Layout, Space, Tag, Typography } from 'antd';
import { Link, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { darfVerwaltung } from '../einsatz/schreibrecht';
import { farbenDunkel } from '../theme/tokens';
```

Und die Komponente ersetzen:

```tsx
/** Topbar-Eintrag: Link wenn frei, sonst gedämpft mit sichtbarem Grund (gesperrt statt versteckt). */
function GlobalLink({ to, label, gesperrt }: { to: string; label: string; gesperrt: boolean }) {
  if (gesperrt) {
    return (
      <Typography.Text
        style={{
          // Farbrolle statt des abgelösten `rgba(255,255,255,0.35)` (Befund M10): der
          // Hartwert erreichte gegen den Kopfzeilengrund #001529 nur ~3,2:1 und verfehlte
          // WCAG 1.4.3. `farbenDunkel.schwach` liefert gerechnete 5,3:1 und bleibt dabei
          // deutlich schwächer als der weisse Aktiv-Link — die Sperre bleibt ablesbar.
          // `farbenDunkel`, nicht der modusabhängige Token: die Kopfzeile trägt in BEIDEN
          // Modi denselben dunklen Grund (dieselbe Begründung wie `IconRail.tsx:20-21`).
          color: farbenDunkel.schwach,
          cursor: 'not-allowed',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}
      >
        {label}
        {/* Der Grund steht als TEXT da, nicht mehr nur im `title` — auf dem
            Führungs-Tablet gibt es kein Hover, dort war er bis hierher unsichtbar.
            Damit entfällt zugleich die Schloss-Ikone: sie sagte dasselbe, nur
            unbeschriftet, und der `title` als einzige Begründung ist genau der Befund.
            Eigene Farben statt der antd-Vorgabe, weil ein heller Standard-Tag auf dem
            dunklen Kopfzeilengrund seinerseits den Kontrast verfehlte. */}
        <Tag
          style={{
            margin: 0,
            color: farbenDunkel.text,
            background: farbenDunkel.flaeche2,
            borderColor: farbenDunkel.linieStark,
          }}
        >
          Keine Berechtigung
        </Tag>
      </Typography.Text>
    );
  }
  return (
    <Link to={to} style={{ color: '#fff', flexShrink: 0 }}>
      {label}
    </Link>
  );
}
```

- [ ] **Schritt 4: Tests laufen lassen — GRÜN**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-367-dev-clickup-122a26/frontend vitest run src/components/AppLayout.test.tsx
```

Erwartet: PASS. Bestehende Tests, die auf das Schloss oder `title="Keine Berechtigung"`
zeigen, sind jetzt Attrappen — sie müssen auf den sichtbaren Text umgestellt, nicht
gelöscht werden (gemessene Lektion aus LFH-370).

- [ ] **Schritt 5: AK-Grep bestätigen**

```bash
grep -c 'rgba(255,255,255,0.35)' frontend/src/components/AppLayout.tsx
```

Erwartet: `0`.

- [ ] **Schritt 6: Commit**

```bash
git add frontend/src/components/AppLayout.tsx frontend/src/components/AppLayout.test.tsx && git commit -m "fix(lfh-337): hebt Kontrast des gesperrten Verwaltungs-Links und macht den Grund sichtbar

rgba(255,255,255,0.35) (~3,2:1 gegen #001529) weicht farbenDunkel.schwach
(gerechnete 5,3:1). Der Grund steht als Tag im Satz statt nur im title-Hover —
auf dem Fuehrungs-Tablet gibt es kein Hover (Befund M10).

LFH-337"
```

---

### Task 3: IconRail — sichtbares Label, dichtefeste Höhe

**Files:**
- Modify: `frontend/src/einsatz/IconRail.tsx`
- Test: `frontend/src/einsatz/IconRail.test.tsx`

**Interfaces:**
- Produces: `export function railZielStil(token: RailToken, zustand: { aktiv: boolean }): CSSProperties`
  mit
  `type RailToken = { controlHeight: number; padding: number; paddingSM: number; fontSizeSM: number }`.
  Kein späterer Task konsumiert sie; sie ist exportiert, damit die Dichte-Zusicherung ohne
  Rendern prüfbar ist.

- [ ] **Schritt 1: Tests schreiben — sichtbarer Text und Dichte-Boden**

An `frontend/src/einsatz/IconRail.test.tsx` anhängen; Import der neuen Funktion und der
Dichtestufen ergänzen:

```tsx
import IconRail, { railZielStil } from './IconRail';
import { dichten, farbenDunkel } from '../theme/tokens';
```

```tsx
  it('zeigt jede Kategoriebezeichnung als sichtbaren Text — ohne Hover', () => {
    renderMitProviders(
      <IconRail kategorien={kategorien} aktiveKategorie={null} onKategorieKlick={() => {}} />,
    );
    // `getByText`, NICHT `getByRole(name:)`: der Name kam schon vorher aus `aria-label`
    // und wäre auch bei rein bebilderten Knöpfen grün. Die Aussage von Befund H8 ist,
    // dass der Text SICHTBAR im Baum steht — auf dem Führungs-Tablet gibt es kein Hover.
    for (const k of kategorien) {
      expect(screen.getByText(k.label)).toBeVisible();
    }
  });

  it('reicht den Tooltip nicht mehr als einzige Textquelle', () => {
    const { container } = renderMitProviders(
      <IconRail kategorien={kategorien} aktiveKategorie={null} onKategorieKlick={() => {}} />,
    );
    // Gegenaussage zum Test darüber: ohne sie bliebe der Wechsel „Tooltip → Label"
    // unbewiesen, weil ein zusätzlich gerendertes Label beide Tests grün ließe.
    expect(container.querySelector('.ant-tooltip')).toBeNull();
  });
});

/**
 * Die Zielhöhe OHNE zu rendern — `test/utils.tsx:31` montiert ein nacktes `ConfigProvider`
 * ohne unser Theme, `useToken()` liefert dort den antd-Seed (`controlHeight: 32`), also
 * keine der Stufen 30/48/72. Bauform 1:1 nach `ModulPanel.test.tsx:216-247`.
 *
 * Die Böden stehen als LITERALE da und werden NICHT aus `dichten` zurückgelesen — sonst
 * prüfte der Test den Token gegen sich selbst.
 */
describe('IconRail · Dichte', () => {
  const tokenFuer = (s: keyof typeof dichten) => ({
    controlHeight: dichten[s].zeilenhoehe,
    padding: dichten[s].abstand.md,
    paddingSM: dichten[s].abstand.sm,
    fontSizeSM: 12,
  });
  const hoehe = (s: keyof typeof dichten) =>
    railZielStil(tokenFuer(s), { aktiv: false }).minHeight;

  it('haelt den A1-Boden von 48 px in JEDER Stufe', () => {
    // Der Kern des Pakets: `Math.max`, nicht `??`. Mit `??` staende in der kompakten
    // Stufe 30 — unter dem A1-Boden, den die Rail seit LFH-329 traegt.
    expect(hoehe('kompakt')).toBe(48);
    expect(hoehe('komfortabel')).toBe(48);
    expect(hoehe('handschuh')).toBe(72);
  });

  it('waechst mit der Staffel, statt auf dem Boden zu kleben', () => {
    expect(hoehe('kompakt')).toBeLessThan(hoehe('handschuh') as number);
  });

  it('traegt ZWEI Angaben, nicht eine (LFH-365)', () => {
    // Die Polsterung allein traegt den Boden nicht, `minHeight` allein klebt den Text
    // im Handschuh-Betrieb an die Kante.
    const stil = railZielStil(tokenFuer('handschuh'), { aktiv: false });
    expect(stil.minHeight).toBe(72);
    expect(stil.padding).toBeTruthy();
  });
});
```

- [ ] **Schritt 2: Tests laufen lassen — ROT**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-367-dev-clickup-122a26/frontend vitest run src/einsatz/IconRail.test.tsx
```

Erwartet: FAIL — `railZielStil` ist kein Export, und die Labels stehen nicht im Baum.

- [ ] **Schritt 3: `IconRail.tsx` umbauen**

Vollständige neue Fassung:

```tsx
import type { CSSProperties } from 'react';
import { theme } from 'antd';
import { abstand, farbenDunkel, form } from '../theme/tokens';
import type { Kategorie, KategorieKey } from './modulRegistry';

interface Props {
  kategorien: Kategorie[];
  aktiveKategorie: KategorieKey | null;
  onKategorieKlick: (key: KategorieKey) => void;
}

/**
 * Breite der Rail. Layoutmaß, keine Trefffläche — deshalb ein Festwert und kein Token:
 * sie bemisst sich am längsten Etikett („Kräfte & Mittel", zweizeilig), nicht an der
 * Bediendichte. Dieselbe Kategorie wie die 220 in `ModulPanel.tsx:230`.
 */
const RAIL_BREITE = 76;

/**
 * A1-Trefflächenboden (Festlegung 4, Material 48 dp). Die Rail trug ihn bis LFH-337 als
 * feste Höhe; seit dem sichtbaren Etikett ist er der BODEN unter der Dichte-Staffel.
 */
const TREFFLAECHE = 48;

/**
 * Stil eines Kategorie-Ziels — REIN und exportiert, damit die Dichte-Zusicherung ohne
 * Rendern prüfbar ist.
 *
 * `test/utils.tsx:31` montiert ein nacktes `ConfigProvider` ohne unser Theme: `useToken()`
 * liefert dort den antd-Seed (`controlHeight: 32`), also KEINE der Stufen 30/48/72. Ein
 * gerenderter Wert belegte antd-Vorgaben statt der Staffel — und jsdom rechnet ohnehin
 * kein Layout. Präzedenzen: `ModulPanel.modulZeilenStil`, `Sidebar.bedienzielStil`.
 *
 * `Math.max` und NICHT `??`: mit `??` fiele die kompakte Stufe auf 30 px und damit unter
 * den A1-Boden, den die Rail seit LFH-329 trägt — die Staffel würde den Boden senken,
 * statt ihn zu heben (dieselbe gemessene Falle wie in `ModulPanel.tsx:29-31`).
 *
 * ZWEI Angaben, nicht eine (LFH-365): `minHeight` PLUS Polsterung. Aufgelöste Tokens,
 * nie `var(--lfh-*)` — die Arbeitsteilung steht in `theme/rollen.css`.
 */
export function railZielStil(
  token: { controlHeight: number; padding: number; paddingSM: number; fontSizeSM: number },
  zustand: { aktiv: boolean },
): CSSProperties {
  return {
    width: '100%',
    minHeight: Math.max(TREFFLAECHE, token.controlHeight),
    padding: `${token.paddingSM}px ${Math.min(token.padding, 8)}px`,
    border: 'none',
    cursor: 'pointer',
    borderRadius: form.radiusSteuer,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    // `farbenDunkel.bedien`, nicht `token.colorPrimary`: die Rail ist in BEIDEN Modi
    // dunkel (Grund und Text kommen darunter ebenfalls aus `farbenDunkel`). Der helle
    // Bedien-Token auf dunklem Grund liefe auf 2,93:1 und verfehlte WCAG 1.4.11 (3:1 für
    // Zustandsanzeige); der Dunkelmodus-Wert liefert 8,67:1.
    background: zustand.aktiv ? farbenDunkel.bedien : 'transparent',
    color: zustand.aktiv ? farbenDunkel.text : farbenDunkel.gedaempft,
  };
}

/**
 * Schmale vertikale Kategorie-Rail (Ebene 2).
 *
 * DAS ETIKETT STEHT SICHTBAR, NICHT IM TOOLTIP (LFH-337 · Befund H8). Bis dahin trug die
 * Rail sechs unbeschriftete Ikonen, deren Text nur beim Zeigen erschien — auf dem
 * Führungs-Tablet (Touch, Handschuhe, im Stehen) gibt es kein Hover, die oberste
 * Navigationsebene war dort also vollständig unbeschriftet. Der Tooltip ist deshalb
 * ersatzlos weg: er sagte dasselbe noch einmal, nur unzuverlässig.
 *
 * DER AKTIVE ZUSTAND IST BEDIENUNG, NICHT MARKE (LFH-328/A2, Spec §1.2). Er trug bis
 * A2 die Markenfarbe als hartes Hex — genau die rote Bedienfläche, die „Rot bedient nichts"
 * (LFH-315/A0) verbietet: Rot ist Gefahr oder Marke, ein aktiver Navigations-Button ist
 * weder. Die Farbe kommt deshalb aus der Bedienrolle. Wer sie auf `colorError` zurückdreht,
 * dreht eine getestete Entscheidung zurück (`IconRail.test.tsx` pinnt beides).
 */
export default function IconRail({ kategorien, aktiveKategorie, onKategorieKlick }: Props) {
  const { token } = theme.useToken();
  return (
    <nav
      aria-label="Kategorien"
      style={{
        display: 'flex', flexDirection: 'column', gap: abstand.xs, padding: abstand.sm,
        background: farbenDunkel.grund, minHeight: '100%',
        width: RAIL_BREITE, flexShrink: 0, boxSizing: 'border-box',
      }}
    >
      {kategorien.map((k) => {
        const aktiv = k.key === aktiveKategorie;
        const Icon = k.icon;
        return (
          <button
            key={k.key}
            type="button"
            // `aria-label` bleibt trotz sichtbaren Textes: er ist wortgleich, hält aber die
            // Namensabfrage stabil, falls das Etikett je gekürzt dargestellt wird.
            aria-label={k.label}
            aria-current={aktiv ? 'true' : undefined}
            onClick={() => onKategorieKlick(k.key)}
            style={railZielStil(token, { aktiv })}
          >
            {/* `flexShrink: 0`, weil sonst die Ikone statt des Etiketts nachgibt —
                dieselbe gemessene Falle wie in `ModulPanel.tsx:157-158`. */}
            <Icon size={22} style={{ flexShrink: 0 }} />
            <span
              style={{
                fontSize: token.fontSizeSM,
                lineHeight: 1.15,
                textAlign: 'center',
                // Zwei Zeilen sind erlaubt und für „Kräfte & Mittel" nötig; `hyphens`
                // verhindert, dass ein langes Wort über den Rail-Rand hinausläuft.
                overflowWrap: 'anywhere',
                hyphens: 'auto',
              }}
            >
              {k.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
```

- [ ] **Schritt 4: Tests laufen lassen — GRÜN**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-367-dev-clickup-122a26/frontend vitest run src/einsatz/IconRail.test.tsx src/einsatz/EinsatzLayout.test.tsx
```

Erwartet: PASS. Bricht ein `EinsatzLayout`-Test, weil ein Kategoriename jetzt zweimal im
Baum steht (Rail **und** Panel-Titel), ist die Abfrage dort auf `within(nav)` einzugrenzen —
nicht die Rail zurückzubauen.

- [ ] **Schritt 5: Dichte-Guard laufen lassen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-367-dev-clickup-122a26/frontend vitest run src/components/dichte.guard.test.ts
```

Erwartet: PASS — es kam keine `size`-Prop hinzu.

- [ ] **Schritt 6: Commit**

```bash
git add frontend/src/einsatz/IconRail.tsx frontend/src/einsatz/IconRail.test.tsx frontend/src/einsatz/EinsatzLayout.test.tsx && git commit -m "feat(lfh-337): beschriftet die Kategorie-Rail sichtbar statt nur im Tooltip

Sechs unbeschriftete Ikonen (Befund H8) bekommen ein dauerhaftes Etikett unter dem
Zeichen; der Tooltip entfaellt. Die Hoehe kommt als Math.max(48, controlHeight) aus
einer reinen Stilfunktion — der A1-Boden haelt in jeder Stufe, die Staffel hebt ihn.

LFH-337"
```

---

### Task 4: „Zuletzt"-Speicher je Einsatz

**Files:**
- Create: `frontend/src/einsatz/zuletztModule.ts`
- Test: `frontend/src/einsatz/zuletztModule.test.ts`

**Interfaces:**
- Produces:
  - `export const ZULETZT_MAX = 3`
  - `export function merkeModulBesuch(einsatzId: number, modulKey: string): void`
  - `export function leseZuletztModule(einsatzId: number): string[]` — jüngstes zuerst,
    ohne Dubletten, höchstens `ZULETZT_MAX` Einträge.
  - Beide werden von Task 5 (`EinsatzLayout`, `ModulPanel`) und Task 6 (`useBefehle`) konsumiert.

- [ ] **Schritt 1: Test schreiben**

Neue Datei `frontend/src/einsatz/zuletztModule.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { ZULETZT_MAX, leseZuletztModule, merkeModulBesuch } from './zuletztModule';

describe('zuletztModule', () => {
  // Der Polyfill in `test/setup.ts` ist prozessweit und behält seinen Inhalt zwischen
  // Tests — ohne das Leeren trüge der zweite Test die Besuche des ersten.
  beforeEach(() => localStorage.clear());

  it('liefert ohne Besuche eine leere Liste', () => {
    expect(leseZuletztModule(1)).toEqual([]);
  });

  it('stellt das juengste Modul nach vorn', () => {
    merkeModulBesuch(1, 'etb');
    merkeModulBesuch(1, 'personen');
    expect(leseZuletztModule(1)).toEqual(['personen', 'etb']);
  });

  it('haelt hoechstens ZULETZT_MAX Eintraege', () => {
    for (const k of ['a', 'b', 'c', 'd']) merkeModulBesuch(1, k);
    expect(leseZuletztModule(1)).toEqual(['d', 'c', 'b']);
    expect(leseZuletztModule(1)).toHaveLength(ZULETZT_MAX);
  });

  it('zaehlt einen erneuten Besuch nicht doppelt, sondern hebt ihn nach vorn', () => {
    // Ohne die Dubletten-Entfernung fuellte ein Hin-und-Her zwischen zwei Modulen die
    // Liste mit demselben Eintrag und verdraengte den dritten — die „Zuletzt"-Zeile
    // zeigte dann zwei Kopien statt drei Zielen.
    merkeModulBesuch(1, 'etb');
    merkeModulBesuch(1, 'personen');
    merkeModulBesuch(1, 'etb');
    expect(leseZuletztModule(1)).toEqual(['etb', 'personen']);
  });

  it('haelt die Einsaetze auseinander', () => {
    merkeModulBesuch(1, 'etb');
    merkeModulBesuch(2, 'personen');
    expect(leseZuletztModule(1)).toEqual(['etb']);
    expect(leseZuletztModule(2)).toEqual(['personen']);
  });

  it('liefert bei kaputtem Inhalt eine leere Liste statt zu werfen', () => {
    localStorage.setItem('lfh:nav:zuletzt:1', '{kein json');
    expect(leseZuletztModule(1)).toEqual([]);
  });

  it('liefert bei fremdem JSON-Typ eine leere Liste', () => {
    // Ein `JSON.parse`, das gelingt, ist noch kein `string[]` — ohne die Formpruefung
    // liefe `.slice` auf einer Zahl in einen TypeError im Render-Pfad der Navigation.
    localStorage.setItem('lfh:nav:zuletzt:1', '42');
    expect(leseZuletztModule(1)).toEqual([]);
  });
});
```

- [ ] **Schritt 2: Test laufen lassen — ROT**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-367-dev-clickup-122a26/frontend vitest run src/einsatz/zuletztModule.test.ts
```

Erwartet: FAIL — Modul existiert nicht.

- [ ] **Schritt 3: `zuletztModule.ts` schreiben**

```ts
/**
 * Merkt die zuletzt besuchten Module eines Einsatzes (LFH-337 · Befunde H12/M11).
 *
 * JE EINSATZ, nicht global — anders als `navPersistenz.ts`, das bewusst browserweit
 * merkt, ob das Panel eingeklappt ist. Der Unterschied hat einen Grund: „Panel zu" ist
 * eine Vorliebe der Person, „zuletzt in Personen und ETB" ist eine Eigenschaft der Lage.
 * Ein Einsatzwechsel darf die Abkürzungen des vorigen Einsatzes nicht mitschleppen.
 * Präzedenz für den einsatzgebundenen Schlüssel: `pages/uhs/uhsAuswahl.ts`.
 *
 * Schreibweise des Schlüssels nach `lfh:nav:eingeklappt` (`navPersistenz.ts`) — die
 * Doppelpunkt-Form ist im Bestand die häufigere.
 *
 * Jeder Zugriff liegt in `try`/`catch`: im Privatmodus wirft der Speicher, und eine
 * vergessene Abkürzung ist kein Grund, den Einsatz-Rahmen abstürzen zu lassen.
 */

/** Höchstzahl gemerkter Module. Drei ist die Zahl aus dem Ticket: genug für einen
 *  Arbeitsrhythmus, kurz genug, dass die Zeile keine zweite Modulliste wird. */
export const ZULETZT_MAX = 3;

const schluessel = (einsatzId: number) => `lfh:nav:zuletzt:${einsatzId}`;

/**
 * Merkt einen Besuch. Der Eintrag rutscht nach vorn; eine bestehende Nennung wird
 * entfernt statt verdoppelt — sonst füllte ein Hin-und-Her zwischen zwei Modulen die
 * Liste mit Kopien und verdrängte das dritte Ziel.
 */
export function merkeModulBesuch(einsatzId: number, modulKey: string): void {
  try {
    const liste = [modulKey, ...leseZuletztModule(einsatzId).filter((k) => k !== modulKey)]
      .slice(0, ZULETZT_MAX);
    localStorage.setItem(schluessel(einsatzId), JSON.stringify(liste));
  } catch {
    /* Speicher gesperrt (Privatmodus) — ohne Persistenz weiterarbeiten */
  }
}

/**
 * Liest die gemerkten Modulschlüssel, jüngstes zuerst.
 *
 * Die Formprüfung ist nicht Zierde: `JSON.parse` gelingt auch bei `42` oder `{"a":1}`,
 * und ein `.slice` darauf liefe als TypeError mitten im Render-Pfad der Navigation.
 * Fremder oder kaputter Inhalt gilt deshalb als „nichts gemerkt".
 */
export function leseZuletztModule(einsatzId: number): string[] {
  try {
    const roh = localStorage.getItem(schluessel(einsatzId));
    if (!roh) return [];
    const wert: unknown = JSON.parse(roh);
    if (!Array.isArray(wert)) return [];
    return wert.filter((k): k is string => typeof k === 'string').slice(0, ZULETZT_MAX);
  } catch {
    return [];
  }
}
```

- [ ] **Schritt 4: Test laufen lassen — GRÜN**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-367-dev-clickup-122a26/frontend vitest run src/einsatz/zuletztModule.test.ts
```

Erwartet: PASS (7 Tests).

- [ ] **Schritt 5: Commit**

```bash
git add frontend/src/einsatz/zuletztModule.ts frontend/src/einsatz/zuletztModule.test.ts && git commit -m "feat(lfh-337): merkt die zuletzt besuchten Module je Einsatz

Speicher fuer Befund H12 (alle 24 Module exakt 2 Klicks tief). Je Einsatz statt
global — anders als navPersistenz: „Panel zu\" ist eine Vorliebe der Person,
\"zuletzt in Personen\" eine Eigenschaft der Lage.

LFH-337"
```

---

### Task 5: „Zuletzt" aufzeichnen und im ModulPanel anzeigen

**Files:**
- Modify: `frontend/src/einsatz/EinsatzLayout.tsx`
- Modify: `frontend/src/einsatz/ModulPanel.tsx`
- Test: `frontend/src/einsatz/ModulPanel.test.tsx`
- Test: `frontend/src/einsatz/EinsatzLayout.test.tsx`

**Interfaces:**
- Consumes: `merkeModulBesuch`, `leseZuletztModule` aus Task 4;
  `moduleNachKategorie`, `istModulSichtbar`, `istModulGesperrt`, `modulRegistry` aus
  `einsatz/modulRegistry.ts`.
- Produces: `ModulPanel` nimmt zusätzlich `zuletztModule?: ModulEintrag[]` entgegen und
  rendert darüber eine Gruppe „Zuletzt".

- [ ] **Schritt 1: Tests schreiben**

An `frontend/src/einsatz/ModulPanel.test.tsx` anhängen:

```tsx
describe('ModulPanel · Zuletzt (LFH-337 · H12)', () => {
  it('zeigt eine Zuletzt-Gruppe ueber der Kategorieliste', () => {
    renderMitProviders(
      <ModulPanel
        titel="Erfassung"
        module={module}
        benutzer={null}
        aktiverModulKey={null}
        onModulKlick={() => {}}
        zuletztModule={[basis({ key: 'personen', label: 'Personen', route: 'personen', status: 'fertig' })]}
      />,
    );
    const panel = screen.getByText('Zuletzt');
    expect(panel).toBeVisible();
    // Die REIHENFOLGE ist die Aussage: die Abkuerzung oben, die Kategorie darunter.
    // `compareDocumentPosition` statt eines Index — der Titel ist kein Listenelement.
    const kategorie = screen.getByText('Erfassung');
    expect(panel.compareDocumentPosition(kategorie) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  it('laesst die Zuletzt-Gruppe ganz weg, wenn nichts gemerkt ist', () => {
    // Eine leere Ueberschrift ohne Inhalt waere schlimmer als keine: sie belegt Platz
    // im 220-px-Panel und verspricht eine Abkuerzung, die es nicht gibt.
    renderMitProviders(
      <ModulPanel
        titel="Erfassung" module={module} benutzer={null}
        aktiverModulKey={null} onModulKlick={() => {}} zuletztModule={[]}
      />,
    );
    expect(screen.queryByText('Zuletzt')).toBeNull();
  });

  it('meldet den Klick auf ein Zuletzt-Modul mit dem Modul', async () => {
    const onKlick = vi.fn();
    const personen = basis({ key: 'personen', label: 'Personen', route: 'personen', status: 'fertig' });
    renderMitProviders(
      <ModulPanel
        titel="Erfassung" module={module} benutzer={null}
        aktiverModulKey={null} onModulKlick={onKlick} zuletztModule={[personen]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Personen' }));
    expect(onKlick).toHaveBeenCalledWith(personen);
  });
});
```

An `frontend/src/einsatz/EinsatzLayout.test.tsx` anhängen (Import
`import { leseZuletztModule } from './zuletztModule';` ergänzen):

```tsx
  it('merkt das besuchte Modul im Zuletzt-Speicher', async () => {
    localStorage.clear();
    renderMitProviders(<EinsatzLayout />, { route: '/einsaetze/1/etb' });
    // `waitFor`, weil die Aufzeichnung in einem Effekt nach dem ersten Paint laeuft.
    await waitFor(() => expect(leseZuletztModule(1)).toEqual(['etb']));
  });
```

Stimmt die Routen-Verdrahtung der Bestandstests nicht mit `route` überein, ist das Muster
der übrigen `EinsatzLayout`-Tests derselben Datei zu übernehmen — nicht eine zweite
Render-Hilfe daneben zu bauen.

- [ ] **Schritt 2: Tests laufen lassen — ROT**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-367-dev-clickup-122a26/frontend vitest run src/einsatz/ModulPanel.test.tsx src/einsatz/EinsatzLayout.test.tsx
```

Erwartet: FAIL — `zuletztModule` ist keine Prop, der Speicher bleibt leer.

- [ ] **Schritt 3: `ModulPanel.tsx` erweitern**

Die `Props`-Schnittstelle ergänzen:

```tsx
interface Props extends ListeProps {
  titel: string;
  /**
   * Bereits aufgelöste, sichtbare und freigegebene Module der „Zuletzt"-Abkürzung
   * (LFH-337 · H12). Kommt fertig herein statt als Schlüsselliste: die Auflösung
   * braucht Registry, Overrides und Benutzer, und die hat der Rahmen ohnehin schon —
   * eine zweite Auflösung hier wäre eine zweite Wahrheit über „freigegeben".
   */
  zuletztModule?: ModulEintrag[];
}
```

Und den Rumpf der Default-Export-Komponente:

```tsx
/** Liste der Module einer Kategorie im inline-Rahmen (Ebene 2). */
export default function ModulPanel({ titel, zuletztModule, ...liste }: Props) {
  const { token } = theme.useToken();
  const ueberschrift: CSSProperties = {
    fontSize: 12,
    textTransform: 'uppercase',
  };
  return (
    <div
      // Testanker für den e2e-Trefflächennachweis (AK2). Der inline-Rahmen hat als einziger
      // der drei Navigationsträger keine Landmark — die IconRail trägt `<nav
      // aria-label="Kategorien">`, das Akkordeon `<nav aria-label="Einsatz-Navigation">`.
      // Eine zweite Landmark hier machte `getByRole('navigation')` ohne Namen mehrdeutig,
      // deshalb ein Datenmerkmal. Präzedenz: `data-lfh="datensicht-karte"` in Datensicht.tsx.
      data-lfh="modul-panel"
      style={{ width: 220, padding: 12, borderRight: `1px solid ${token.colorBorderSecondary}` }}
    >
      {/* Die Abkürzung steht ÜBER der Kategorie, nicht darunter: sie soll den Weg
          verkürzen, und ein Ziel unterhalb der vollständigen Liste verkürzt nichts.
          Ganz weg, wenn nichts gemerkt ist — eine leere Überschrift belegte Platz im
          220-px-Panel und verspräche eine Abkürzung, die es nicht gibt. */}
      {zuletztModule && zuletztModule.length > 0 && (
        <div style={{ marginBottom: token.marginSM }}>
          <Typography.Text type="secondary" style={ueberschrift}>
            Zuletzt
          </Typography.Text>
          <ModulListe {...liste} module={zuletztModule} />
        </div>
      )}
      <Typography.Text type="secondary" style={ueberschrift}>
        {titel}
      </Typography.Text>
      <ModulListe {...liste} />
    </div>
  );
}
```

- [ ] **Schritt 4: `EinsatzLayout.tsx` — Besuch aufzeichnen und auflösen**

Import ergänzen:

```tsx
import { leseZuletztModule, merkeModulBesuch } from './zuletztModule';
```

Nach dem bestehenden Effekt, der `offeneKategorie` angleicht (um Zeile 119), einfügen:

```tsx
  /**
   * Besuch aufzeichnen (LFH-337 · H12). Angesetzt am Modul-KEY, nicht am Objekt: die
   * Registry-Einträge sind zwar Modulkonstanten, aber ein Primitiv in der
   * Dependency-Liste erfüllt die exhaustive-deps-Regel strukturell statt sie zu
   * überreden (CLAUDE.md, Lint-Disziplin).
   *
   * `Number.isFinite`, weil `einsatzId` aus `useParams` stammt: auf einer Route ohne
   * gültige ID legte der Speicher sonst einen Eintrag unter `…:NaN` an.
   */
  const aktuellerModulKey = aktuellesModul?.key;
  useEffect(() => {
    if (aktuellerModulKey && Number.isFinite(einsatzId)) {
      merkeModulBesuch(einsatzId, aktuellerModulKey);
    }
  }, [einsatzId, aktuellerModulKey]);
```

Die Auflösung der gemerkten Schlüssel — direkt vor dem `return`, nach `onModulKlick`:

```tsx
  /**
   * Gemerkte Schlüssel → anzeigbare Module. Die Filter sind dieselben, die die Palette
   * anlegt (`command-palette/befehle.ts`): fertig, sichtbar, nicht rollen-gesperrt. Ein
   * Modul, das seit dem Besuch ausgeblendet oder entzogen wurde, verschwindet damit aus
   * der Abkürzung, statt in eine gesperrte Zeile zu führen.
   *
   * Das AKTUELLE Modul steht bewusst nicht in der Liste: es ist die Seite, auf der man
   * gerade steht — ein Sprung dorthin ist keine Abkürzung, und die drei Plätze sind knapp.
   *
   * Kein `useMemo`: die Liste hat höchstens drei Einträge, und `leseZuletztModule` muss
   * bei JEDEM Render laufen — der Speicher ist kein React-Zustand, eine Memoisierung über
   * den Modulschlüssel zeigte nach dem Aufzeichnungs-Effekt noch den vorigen Stand.
   */
  const zuletztModule = leseZuletztModule(einsatzId)
    .filter((key) => key !== aktuellerModulKey)
    .map((key) => modulRegistry.find((m) => m.key === key))
    .filter((m): m is ModulEintrag => m !== undefined
      && m.status === 'fertig'
      && istModulSichtbar(m, modulOverrides)
      && !istModulGesperrt(m, benutzer, modulOverrides));
```

Den Import aus `./modulRegistry` um `istModulGesperrt` und `istModulSichtbar` erweitern und
die Prop durchreichen:

```tsx
          <ModulPanel
            titel={kategorien.find((k) => k.key === offeneKategorie)!.label}
            module={moduleNachKategorie(offeneKategorie)}
            benutzer={benutzer}
            overrides={modulOverrides}
            zaehler={modulZaehler}
            zuletztModule={zuletztModule}
            aktiverModulKey={aktuellesModul?.key ?? null}
            onModulKlick={onModulKlick}
          />
```

- [ ] **Schritt 5: Tests laufen lassen — GRÜN**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-367-dev-clickup-122a26/frontend vitest run src/einsatz/
```

Erwartet: PASS. Steht ein Modulname jetzt zweimal im Panel (Zuletzt **und** Kategorie), ist
die betroffene Abfrage mit `within` einzugrenzen.

- [ ] **Schritt 6: Commit**

```bash
git add frontend/src/einsatz/ModulPanel.tsx frontend/src/einsatz/ModulPanel.test.tsx frontend/src/einsatz/EinsatzLayout.tsx frontend/src/einsatz/EinsatzLayout.test.tsx && git commit -m "feat(lfh-337): zeigt zuletzt besuchte Module oben im Modul-Panel

Erster der zwei Konsumenten des Zuletzt-Speichers (Befund H12). Aufgeloest wird im
Rahmen, nicht im Panel: die Freigabe-Filter haben dort ihre eine Wahrheit. Das
aktuelle Modul bleibt draussen — ein Sprung auf die eigene Seite ist keine Abkuerzung.

LFH-337"
```

---

### Task 6: Befehlspalette — kuratierte Startansicht, „Zuletzt"-Gruppe, Höhe

**Files:**
- Modify: `frontend/src/command-palette/typen.ts:11,38-49`
- Modify: `frontend/src/command-palette/befehle.ts`
- Modify: `frontend/src/command-palette/useBefehle.ts`
- Modify: `frontend/src/command-palette/CommandPalette.tsx:98`
- Test: `frontend/src/command-palette/befehle.test.ts`
- Test: `frontend/src/command-palette/CommandPalette.test.tsx`

**Interfaces:**
- Consumes: `leseZuletztModule` aus Task 4.
- Produces: `BefehlGruppe` um `'zuletzt'` erweitert; `BefehlKontext` um
  `zuletztModulKeys?: string[]`.

- [ ] **Schritt 1: Tests schreiben**

An `frontend/src/command-palette/befehle.test.ts` anhängen (den dort etablierten
Kontext-Bauer der Datei wiederverwenden — er heißt je nach Bestand `kontext`/`basisKontext`;
im Zweifel den vorhandenen Helfer lesen und nicht duplizieren):

```ts
describe('baueBefehle · Gruppenordnung und Zuletzt (LFH-337 · M11/H12)', () => {
  it('ordnet Schnellaktionen VOR Module', () => {
    // Die Aussage haengt an GRUPPEN_REIHENFOLGE, nicht an der Einfuegereihenfolge in
    // baueBefehle — geprueft wird deshalb die Konstante.
    const s = GRUPPEN_REIHENFOLGE.indexOf('schnellaktionen');
    const m = GRUPPEN_REIHENFOLGE.indexOf('module');
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThan(m);
  });

  it('ordnet Zuletzt zwischen Schnellaktionen und Module', () => {
    const s = GRUPPEN_REIHENFOLGE.indexOf('schnellaktionen');
    const z = GRUPPEN_REIHENFOLGE.indexOf('zuletzt');
    const m = GRUPPEN_REIHENFOLGE.indexOf('module');
    expect(s).toBeLessThan(z);
    expect(z).toBeLessThan(m);
  });

  it('baut aus den gemerkten Schluesseln Zuletzt-Befehle', () => {
    const befehle = baueBefehle({ ...kontext, einsatzId: 1, zuletztModulKeys: ['etb'] });
    const zuletzt = befehle.filter((b) => b.gruppe === 'zuletzt');
    expect(zuletzt).toHaveLength(1);
    expect(zuletzt[0].label).toBe('Einsatztagebuch');
  });

  it('nimmt ein gesperrtes oder ausgeblendetes Modul NICHT in Zuletzt auf', () => {
    // Die Gegenaussage: ohne sie bliebe die Filterung unbewiesen, und ein entzogenes
    // Modul stuende weiter als Abkuerzung in der Palette.
    const befehle = baueBefehle({
      ...kontext,
      einsatzId: 1,
      zuletztModulKeys: ['etb'],
      overrides: { etb: {
        einsatz_id: 1, modul_key: 'etb', sichtbar: false,
        benoetigte_rolle: null, geaendert_at: null, geaendert_von: null,
      } },
    });
    expect(befehle.filter((b) => b.gruppe === 'zuletzt')).toEqual([]);
  });

  it('vergibt Zuletzt-Befehlen eigene ids, die nicht mit den Modul-Befehlen kollidieren', () => {
    // Dieselbe id zweimal im Baum macht `aria-activedescendant` mehrdeutig und die
    // React-Keys instabil — die Palette rendert dasselbe Modul in ZWEI Gruppen.
    const befehle = baueBefehle({ ...kontext, einsatzId: 1, zuletztModulKeys: ['etb'] });
    const ids = befehle.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

An `frontend/src/command-palette/CommandPalette.test.tsx` anhängen:

```tsx
describe('CommandPalette · Startansicht (LFH-337 · M11)', () => {
  it('stellt bei leerer Suche eine Schnellaktion an die erste Stelle', () => {
    // OHNE Tastatur-Aktionen: die Gruppe `aktionen` (TASTATUR_AKTIONEN) steht
    // unveraendert vor `schnellaktionen` und waere sonst die erste — das Ticket
    // verlangt nur `schnellaktionen` vor `module`, `aktionen` bleibt unangetastet.
    const befehle: Befehl[] = [
      { id: 'modul:etb', gruppe: 'module', label: 'Einsatztagebuch', ausfuehren: () => {} },
      { id: 'aktion:etb', gruppe: 'schnellaktionen', label: 'Neuer ETB-Eintrag', ausfuehren: () => {} },
    ];
    renderMitProviders(<CommandPalette befehle={befehle} schliesse={() => {}} />);
    const optionen = screen.getAllByRole('option');
    expect(optionen[0]).toHaveTextContent('Neuer ETB-Eintrag');
    expect(optionen[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('laeuft mit ArrowDown geschlossen ueber die Gruppengrenze hinweg', async () => {
    // B7: die Gruppierung ist Darstellung, die Navigation bleibt EINE flache Liste.
    const befehle: Befehl[] = [
      { id: 'modul:etb', gruppe: 'module', label: 'Einsatztagebuch', ausfuehren: () => {} },
      { id: 'aktion:etb', gruppe: 'schnellaktionen', label: 'Neuer ETB-Eintrag', ausfuehren: () => {} },
    ];
    renderMitProviders(<CommandPalette befehle={befehle} schliesse={() => {}} />);
    await userEvent.keyboard('{ArrowDown}');
    const optionen = screen.getAllByRole('option');
    expect(optionen[1]).toHaveTextContent('Einsatztagebuch');
    expect(optionen[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('deckelt die Listenhoehe relativ statt auf 380 px', () => {
    const befehle: Befehl[] = [
      { id: 'modul:etb', gruppe: 'module', label: 'Einsatztagebuch', ausfuehren: () => {} },
    ];
    renderMitProviders(<CommandPalette befehle={befehle} schliesse={() => {}} />);
    // jsdom rechnet kein Layout — pruefbar ist der gesetzte WERT, nicht die Pixelhoehe.
    expect(document.getElementById('cmd-liste')).toHaveStyle({
      maxHeight: 'min(60vh, 480px)',
    });
  });
});
```

- [ ] **Schritt 2: Tests laufen lassen — ROT**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-367-dev-clickup-122a26/frontend vitest run src/command-palette/
```

Erwartet: FAIL — Gruppe `zuletzt` existiert nicht, `module` steht vor `schnellaktionen`,
`maxHeight` ist `380`.

- [ ] **Schritt 3: `typen.ts` anpassen**

```ts
export type BefehlGruppe =
  | 'aktionen' | 'schnellaktionen' | 'zuletzt' | 'module'
  | 'einsaetze' | 'einstellungen' | 'navigation';
```

```ts
export interface BefehlKontext {
  einsatzId: number | null;
  benutzer: BenutzerAnzeige | null;
  einsaetze: EinsatzAnzeige[];
  overrides?: ModulOverrides;
  darfSchreibenImEinsatz: boolean;
  /** Zuletzt besuchte Modulschlüssel des aktuellen Einsatzes (LFH-337 · H12),
   *  jüngstes zuerst. Kommt aus `einsatz/zuletztModule.ts`. */
  zuletztModulKeys?: string[];
  navigate: (pfad: string) => void;
  setThemeModus: (m: ThemeModus) => void;
  setDichte: (d: Dichte) => void;
  setKoordinaten: (f: Koordinatenformat) => void;
  logout: () => void;
  tastaturAktionen?: TastaturAktionen;
  userAgent?: string;
}
```

```ts
/**
 * Reihenfolge der Startansicht (LFH-337 · M11): das Nützlichste zuerst.
 *
 * `schnellaktionen` und `zuletzt` stehen jetzt VOR `module` — vorher lagen die vier
 * Schnellaktionen hinter 24 Modulen und waren bei leerer Suche faktisch unerreichbar.
 * `aktionen` (die kontextabhängigen Tastatur-Aktionen aus `TASTATUR_AKTIONEN`) bleibt
 * unangetastet an der Spitze: sie erscheint nur dort, wo eine Maske sie registriert hat,
 * und ist dann die Antwort auf „was kann ich hier gerade tun".
 */
export const GRUPPEN_REIHENFOLGE: BefehlGruppe[] = [
  'aktionen', 'schnellaktionen', 'zuletzt', 'module', 'einsaetze', 'einstellungen', 'navigation',
];

export const GRUPPEN_LABEL: Record<BefehlGruppe, string> = {
  aktionen: 'Aktionen',
  schnellaktionen: 'Schnellaktionen',
  zuletzt: 'Zuletzt',
  module: 'Module',
  einsaetze: 'Einsatz wechseln',
  einstellungen: 'Einstellungen',
  navigation: 'Navigation',
};
```

- [ ] **Schritt 4: `befehle.ts` — Zuletzt-Befehle bauen**

Im `if (k.einsatzId != null)`-Block, **vor** der Modul-Schleife (Reihenfolge im Array ist
zwar unerheblich — `CommandPalette` sortiert über `GRUPPEN_REIHENFOLGE` —, aber die
Lesereihenfolge soll der Anzeige folgen):

```ts
    // 0. Zuletzt besucht — dieselben Freigabe-Filter wie bei den Modulen darunter
    //    (fertig, sichtbar, nicht rollen-gesperrt). Ein seit dem Besuch entzogenes Modul
    //    verschwindet damit aus der Abkürzung, statt in eine gesperrte Seite zu führen.
    //    Eigenes id-Präfix: derselbe Registry-Eintrag steht hier UND unter „Module", und
    //    zwei gleiche `id` machten `aria-activedescendant` mehrdeutig.
    for (const key of k.zuletztModulKeys ?? []) {
      const m = modulRegistry.find((x) => x.key === key);
      if (!m || m.status !== 'fertig') continue;
      if (!istModulSichtbar(m, k.overrides)) continue;
      if (istModulGesperrt(m, k.benutzer, k.overrides)) continue;
      const ziel = einsatzModulPfad(k.einsatzId, modulZielRoute(m));
      befehle.push({
        id: `zuletzt:${m.key}`, gruppe: 'zuletzt', label: m.label, icon: m.icon,
        ausfuehren: () => k.navigate(ziel),
      });
    }
```

- [ ] **Schritt 5: `useBefehle.ts` — Speicher anschließen**

Import ergänzen:

```ts
import { leseZuletztModule } from '../einsatz/zuletztModule';
```

Vor dem `useMemo`:

```ts
  // Kein `useMemo` und kein React-Zustand: der Speicher liegt in localStorage, ein
  // memoisierter Lesevorgang zeigte nach einem Modulwechsel noch den vorigen Stand. Die
  // Liste hat höchstens drei Einträge; die Kosten sind eine Schlüsselsuche pro Render.
  const zuletztModulKeys = einsatzId == null ? [] : leseZuletztModule(einsatzId);
```

Im `baueBefehle`-Aufruf `zuletztModulKeys,` ergänzen. In der Dependency-Liste des `useMemo`
**nicht** `zuletztModulKeys` aufnehmen — ein je Render frisches Array machte die
Memoisierung wirkungslos. Stattdessen die stabile Zeichenkette:

```ts
  const zuletztSchluessel = zuletztModulKeys.join(',');
```

und in der Dependency-Liste `zuletztSchluessel` statt des Arrays führen, mit
zeilengenauem Kommentar über der Deps-Zeile:

```ts
    // `zuletztSchluessel` (Primitiv) statt `zuletztModulKeys`: das Array ist je Render
    // frisch und machte die Memoisierung wirkungslos. Strukturelle Lösung nach der
    // Lint-Disziplin in CLAUDE.md — kein `eslint-disable`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [einsatzId, benutzer, einsaetze, overrides, darfSchreibenImEinsatz, navigate, setModus, setDichte, logout, tastaturAktionen, zuletztSchluessel],
```

- [ ] **Schritt 6: `CommandPalette.tsx` — Listenhöhe**

Zeile 98 ersetzen:

```tsx
          // `min(60vh, 480px)` statt der festen 380 (LFH-337 · M11): auf dem Fükw-Schirm
          // zeigte der Kasten von 42+ Befehlen rund sieben. Die Obergrenze bleibt, damit
          // die Liste auf einem hohen Schirm nicht die ganze Seite füllt; `60vh` deckelt
          // sie auf niedrigen Schirmen, wo 480 px über den Rand liefen.
          style={{ maxHeight: 'min(60vh, 480px)', overflowY: 'auto', padding: token.paddingXS }}
```

- [ ] **Schritt 7: Tests laufen lassen — GRÜN**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-367-dev-clickup-122a26/frontend vitest run src/command-palette/
```

Erwartet: PASS. Bestandstests, die den ersten Eintrag oder eine Gruppenreihenfolge pinnen,
sind auf die neue Ordnung umzustellen — das ist die beabsichtigte Änderung, kein Kollateralschaden.

- [ ] **Schritt 8: Lint laufen lassen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-367-dev-clickup-122a26/frontend lint
```

Erwartet: 0 Fehler, 0 Warnungen (`--max-warnings 0`). Meldet eslint die Disable-Direktive
als **ungenutzt**, ist sie ersatzlos zu entfernen — eine tote Direktive ist selbst ein Verstoß.

- [ ] **Schritt 9: Commit**

```bash
git add frontend/src/command-palette/ && git commit -m "feat(lfh-337): sortiert die Befehlspalette nach Nuetzlichkeit und zeigt Zuletzt

Schnellaktionen und Zuletzt stehen vor den 24 Modulen (Befund M11) — vorher lagen
die vier Schnellaktionen dahinter und waren bei leerer Suche unerreichbar. Die
Liste deckelt auf min(60vh, 480px) statt auf feste 380 px. Zweiter Konsument des
Zuletzt-Speichers. Die Pfeiltastennavigation bleibt eine flache Liste (B7).

LFH-337"
```

---

### Task 7: Rail-Klick führt in das erste freigegebene Modul einer fremden Kategorie

**Files:**
- Modify: `frontend/src/einsatz/modulRegistry.ts`
- Modify: `frontend/src/einsatz/EinsatzLayout.tsx:179-184`
- Test: `frontend/src/einsatz/modulRegistry.test.ts`
- Test: `frontend/src/einsatz/EinsatzLayout.test.tsx`

**Interfaces:**
- Produces:
  `export function erstesFreigegebenesModul(kategorie: KategorieKey, benutzer: BenutzerAnzeige | null, overrides?: ModulOverrides, register?: ModulEintrag[]): ModulEintrag | null`

- [ ] **Schritt 1: Tests für den Resolver schreiben**

An `frontend/src/einsatz/modulRegistry.test.ts` anhängen:

```ts
describe('erstesFreigegebenesModul (LFH-337)', () => {
  const admin: BenutzerAnzeige = {
    id: 1, anzeigename: 'A', benutzername: 'a', system_rolle: 'admin',
    org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00', totp_aktiviert: false,
  };

  it('liefert das erste fertige Modul der Kategorie in Registry-Reihenfolge', () => {
    const m = erstesFreigegebenesModul('fuehrung', admin);
    expect(m?.kategorie).toBe('fuehrung');
    expect(m?.status).toBe('fertig');
  });

  it('ueberspringt ausgeblendete Module', () => {
    const erstes = erstesFreigegebenesModul('fuehrung', admin)!;
    const m = erstesFreigegebenesModul('fuehrung', admin, {
      [erstes.key]: {
        einsatz_id: 1, modul_key: erstes.key, sichtbar: false,
        benoetigte_rolle: null, geaendert_at: null, geaendert_von: null,
      },
    });
    expect(m?.key).not.toBe(erstes.key);
  });

  it('ueberspringt rollen-gesperrte Module', () => {
    const erstes = erstesFreigegebenesModul('fuehrung', admin)!;
    const ohne: BenutzerAnzeige = { ...admin, system_rolle: 'keiner', org_rolle: 'keine' };
    const m = erstesFreigegebenesModul('fuehrung', ohne, {
      [erstes.key]: {
        einsatz_id: 1, modul_key: erstes.key, sichtbar: true,
        benoetigte_rolle: 'admin', geaendert_at: null, geaendert_von: null,
      },
    });
    expect(m?.key).not.toBe(erstes.key);
  });

  it('liefert null, wenn die Kategorie kein freigegebenes Modul hat', () => {
    // Die Gegenaussage: ohne sie bliebe unbewiesen, dass der Resolver ueberhaupt
    // ablehnen KANN — und der Aufrufer navigierte auf `undefined`.
    const nurGeplant: ModulEintrag[] = [
      { key: 'x', kategorie: 'lage', label: 'X', icon: () => null, route: 'x', status: 'geplant' },
    ];
    expect(erstesFreigegebenesModul('lage', admin, undefined, nurGeplant)).toBeNull();
  });
});
```

- [ ] **Schritt 2: Test laufen lassen — ROT**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-367-dev-clickup-122a26/frontend vitest run src/einsatz/modulRegistry.test.ts
```

Erwartet: FAIL — `erstesFreigegebenesModul` existiert nicht.

- [ ] **Schritt 3: Resolver in `modulRegistry.ts` ergänzen**

Unter `aufloeseStandardModul` anfügen:

```ts
/**
 * Erstes bedienbares Modul einer Kategorie (LFH-337 · H12) — oder `null`.
 *
 * ABGRENZUNG ZU `aufloeseStandardModul`: das dort löst das EINSATZ-Default-Modul auf
 * (LFH-131) und fällt auf `redirectZiel()` zurück. Hier geht es um eine einzelne
 * Kategorie, und ein Fallback wäre falsch: er führte beim Klick auf „Lage" in ein Modul
 * einer anderen Kategorie. Die Verweigerung ist die richtige Antwort, der Aufrufer
 * entscheidet dann, nur das Panel zu öffnen.
 *
 * Dieselben drei Filter wie in `command-palette/befehle.ts` und in der „Zuletzt"-Auflösung
 * des Rahmens: fertig, sichtbar, nicht rollen-gesperrt. Registry-Reihenfolge ist die
 * Rangfolge — sie ist im Bestand bewusst gepflegt (Kommentar `// Führung` u. a.).
 */
export function erstesFreigegebenesModul(
  kategorie: KategorieKey,
  benutzer: BenutzerAnzeige | null,
  overrides?: ModulOverrides,
  register: ModulEintrag[] = modulRegistry,
): ModulEintrag | null {
  return register.find((m) => m.kategorie === kategorie
    && m.status === 'fertig'
    && istModulSichtbar(m, overrides)
    && !istModulGesperrt(m, benutzer, overrides)) ?? null;
}
```

Fehlt `BenutzerAnzeige` in den Typ-Importen der Datei, ergänzen.

- [ ] **Schritt 4: Test laufen lassen — GRÜN**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-367-dev-clickup-122a26/frontend vitest run src/einsatz/modulRegistry.test.ts
```

Erwartet: PASS.

- [ ] **Schritt 5: Test für das Klickverhalten schreiben**

An `frontend/src/einsatz/EinsatzLayout.test.tsx` anhängen:

```tsx
describe('EinsatzLayout · Rail-Klick (LFH-337 · H12)', () => {
  it('springt beim Klick auf eine ANDERE Kategorie in deren erstes Modul', async () => {
    renderMitProviders(<EinsatzLayout />, { route: '/einsaetze/1/etb' });
    await userEvent.click(await screen.findByRole('button', { name: 'Lage' }));
    // Die Aussage ist der PFAD, nicht der Panel-Zustand (AK5). Der Pfadanzeiger ist die
    // Route-Sonde der Datei; steht dort keine, eine nach dem Muster der uebrigen
    // Router-Tests ergaenzen — nicht `window.location` lesen (MemoryRouter fasst es nicht an).
    await waitFor(() => expect(pfad()).toMatch(/^\/einsaetze\/1\//));
    await waitFor(() => expect(pfad()).not.toBe('/einsaetze/1/etb'));
  });

  it('navigiert beim Klick auf die AKTIVE Kategorie nicht, sondern klappt nur zu', async () => {
    // Die Gegenaussage haelt LFH-329/B1 am Leben: der Selbstklick ist der
    // Zuklapp-Umschalter mit Persistenz. Ohne sie waere „nur fremde Kategorie
    // navigiert" unbewiesen — ein bedingungslos navigierender Klick faerbte den
    // Test darueber ebenfalls gruen.
    renderMitProviders(<EinsatzLayout />, { route: '/einsaetze/1/etb' });
    const vorher = pfad();
    // „Erfassung" ist die Kategorie des ETB — der Klick trifft die aktive.
    await userEvent.click(await screen.findByRole('button', { name: 'Erfassung' }));
    expect(pfad()).toBe(vorher);
    expect(screen.queryByTestId('modul-panel') ?? document.querySelector('[data-lfh="modul-panel"]'))
      .toBeNull();
  });
});
```

- [ ] **Schritt 6: Test laufen lassen — ROT**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-367-dev-clickup-122a26/frontend vitest run src/einsatz/EinsatzLayout.test.tsx
```

Erwartet: der erste neue Test FAIL (Pfad bleibt `/einsaetze/1/etb`), der zweite PASS.

- [ ] **Schritt 7: `onKategorieKlick` erweitern**

Import ergänzen (`erstesFreigegebenesModul` zum bestehenden `./modulRegistry`-Import) und die
Funktion ersetzen:

```tsx
  /**
   * Rail-Klick im inline-Rahmen.
   *
   * SELBSTKLICK = ZUKLAPPEN, FREMDKLICK = SPRUNG (LFH-337 · H12, Entscheidung im Plan).
   * Derselbe Kategorie-Knopf klappt das Panel zu und merkt das; ein anderer öffnet es und
   * führt zugleich in das erste freigegebene Modul der Kategorie — vorher lag jedes der
   * 24 Module exakt zwei Klicks tief.
   *
   * WARUM NICHT IMMER NAVIGIEREN: Navigieren ändert `aktuellesModul`, der Effekt oben
   * setzt daraufhin `offeneKategorie` — ein bedingungsloser Sprung höbe das persistierte
   * Zuklappen aus LFH-329/B1 in derselben Runde wieder auf. Die Rail behält ihre
   * Hervorhebung, weil sie `offeneKategorie ?? aktiveKategorie` bekommt.
   *
   * Hat die Kategorie kein freigegebenes Modul (alles geplant, ausgeblendet oder
   * entzogen), bleibt es beim reinen Aufklappen: ein Sprung ins Leere wäre schlechter
   * als keiner.
   */
  function onKategorieKlick(key: KategorieKey) {
    if (offeneKategorie === key) {
      const zu = !panelEingeklappt;
      setPanelEingeklappt(zu);
      schreibeNavEingeklappt(zu);
      return;
    }
    setOffeneKategorie(key);
    setPanelEingeklappt(false);
    schreibeNavEingeklappt(false);
    const ziel = erstesFreigegebenesModul(key, benutzer, modulOverrides);
    if (ziel) navigate(einsatzModulPfad(einsatzId, modulZielRoute(ziel)));
  }
```

- [ ] **Schritt 8: Tests laufen lassen — GRÜN**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-367-dev-clickup-122a26/frontend vitest run src/einsatz/
```

Erwartet: PASS.

- [ ] **Schritt 9: Commit**

```bash
git add frontend/src/einsatz/modulRegistry.ts frontend/src/einsatz/modulRegistry.test.ts frontend/src/einsatz/EinsatzLayout.tsx frontend/src/einsatz/EinsatzLayout.test.tsx && git commit -m "feat(lfh-337): fuehrt der Rail-Klick in das erste Modul einer fremden Kategorie

Befund H12: jedes der 24 Module lag exakt zwei Klicks tief. Der Klick auf eine
ANDERE Kategorie springt jetzt mit; der Selbstklick bleibt der Zuklapp-Umschalter
mit Persistenz aus LFH-329/B1 — ein bedingungsloser Sprung hoebe ihn in derselben
Runde wieder auf.

LFH-337"
```

---

### Task 8: Prüfliste Einsatztauglichkeit, AK-Korrekturen, Voll-Gate

CLAUDE.md: „ein Modul-Task ohne ausgefüllte Prüfliste gilt nicht als fertig; jede Zeile
trägt ein Verdikt (erfüllt / offen → Zielticket / nicht anwendbar), ‚nicht geprüft' ist
keins." Dieser Task baut den Navigationsrahmen **jeder** Einsatzseite um.

**Files:**
- Create: `docs/superpowers/specs/2026-08-10-lfh-337-pruefliste-einsatztauglichkeit.md`

- [ ] **Schritt 1: Die 15 Kriterien aus der Leitlinie lesen**

```bash
grep -n 'Kriterium\|^| *[0-9]' docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md | head -40
```

Die Prüfliste ist dort am Lage-Dashboard validiert; Nummerierung und Wortlaut werden
übernommen, nicht neu erfunden.

- [ ] **Schritt 2: Prüfliste ausfüllen**

Eine Datei mit einer Zeile je Kriterium anlegen: Nummer, Kriterium, **Verdikt**
(erfüllt / offen → Zielticket / nicht anwendbar) und eine Begründung in einem Satz. Für
diesen Task ist die Bezugsfläche der Navigationsrahmen: Rail, Modul-Panel, beide
Kopfzeilen, Befehlspalette.

Zusätzlich, im selben Dokument, zwei Abschnitte:

**AK-Korrekturen** (mit Begründung, warum das AK und nicht die Umsetzung falsch war):

1. **AK2 ist durch LFH-335/B7 überholt.** Der geforderte Grep
   `grep -rc 'Strg+K\|⌘K' frontend/src/components/AppLayout.tsx frontend/src/einsatz/EinsatzLayout.tsx > 0`
   liefert in beiden Dateien 0 — und das ist **richtig so**: der Wortlaut steht seit
   LFH-335 in der gemeinsamen `components/CommandPaletteTrigger.tsx`, die in **beiden**
   Kopfzeilen hängt. Zwei Kopien desselben Textes wären eine Verschlechterung. Ersatz-Grep,
   der dieselbe Sache misst:
   ```bash
   grep -c 'Strg+K\|⌘K' frontend/src/components/CommandPaletteTrigger.tsx
   grep -lc 'CommandPaletteTrigger' frontend/src/components/AppLayout.tsx frontend/src/einsatz/EinsatzLayout.tsx
   ```
   Erwartet: > 0 bzw. beide Dateien.
2. **To-do 2 und der zugehörige AK-Teil „RTL-Test: Klick öffnet die Palette" waren bei
   Ticketbeginn bereits erfüllt** — `components/CommandPaletteTrigger.test.tsx` deckt das ab.
3. **`ModulRedirect.tsx` kam zum Umfang hinzu** — nicht im Ticket genannt, aber im
   Grep-Radius von AK3 (`frontend/src/einsatz`); ohne es wird die geforderte 0 nicht erreicht.
4. **Die beschriftete Rail-Spalte ab ≥1280 px entfällt** (im Ticket „optional", vom Menschen
   bestätigt).
5. **Das Kontrastverhältnis aus AK6 ist gerechnet, nicht getestet** — jsdom rechnet keine
   Farbmischung. `farbenDunkel.schwach` (`#7d8b9b`) gegen `#001529`: relative Leuchtdichten
   0,2520 und 0,006964 → **(0,2520 + 0,05) / (0,006964 + 0,05) = 5,30:1**. Über den
   geforderten 4,5:1; der abgelöste Wert `rgba(255,255,255,0.35)` lag bei ~3,2:1.

**Offene Nachzüge** (jeweils mit ClickUp-Ticket anlegen, falls beim Umsetzen entstanden).

- [ ] **Schritt 3: Alle AK-Greps ausführen und die Ausgabe ins Dokument übernehmen**

```bash
grep -rc '/einsaetze/\${' frontend/src/einsatz frontend/src/command-palette; grep -c 'rgba(255,255,255,0.35)' frontend/src/components/AppLayout.tsx; grep -c 'einsatzPfad' frontend/src/routing/deeplinks.ts frontend/src/routing/deeplinks.test.ts
```

Erwartet: alle `/einsaetze/${`-Zähler 0, `rgba`-Zähler 0, `einsatzPfad` in beiden
Routing-Dateien > 0.

- [ ] **Schritt 4: Voll-Gate fahren**

```bash
./scripts/check-all.sh
```

Erwartet: alle sieben Schritte grün. Fällt Vitest oder Playwright einzeln und wandernd aus,
den Lauf wiederholen, bevor ein Befund notiert wird — die Suite ist unter Last flaky, und ein
Timeout ohne Assertion-Fehler ist kein Regressionsbeweis. Ein Befund braucht einen **stabil**
roten Test mit Assertion.

- [ ] **Schritt 5: Commit**

```bash
git add docs/superpowers/specs/2026-08-10-lfh-337-pruefliste-einsatztauglichkeit.md && git commit -m "docs(lfh-337): Pruefliste Einsatztauglichkeit und AK-Korrekturen

AK2 war durch LFH-335/B7 ueberholt — der Such-Trigger steht in der gemeinsamen
CommandPaletteTrigger-Komponente, nicht zweimal in den Layouts; der Grep zeigte
auf die falschen Dateien. Kontrastzahl fuer AK6 gerechnet: 5,30:1.

LFH-337"
```

---

## Selbstprüfung gegen das Ticket

| Ticket-To-do | Task | Status |
|---|---|---|
| 1 · Rail verbreitern, Label dauerhaft, ≥48 px | 3 | abgedeckt (Spalte ab 1280 px bewusst entfallen) |
| 2 · Such-Trigger in beide Topbars | — | **bei Ticketbeginn erfüllt** (LFH-335/B7), dokumentiert in 8 |
| 3 · „Zuletzt"-Speicher, zwei Konsumenten | 4, 5, 6 | abgedeckt |
| 4 · Kategorie-Klick navigiert | 7 | abgedeckt (Selbstklick ausgenommen, entschieden) |
| 5 · Palette: Startansicht, Reihenfolge, maxHeight, B7 | 6 | abgedeckt |
| 6 · Fünf Inline-Pfade auf deeplinks | 1 | abgedeckt (`einsatzPfad` gab es schon; `ModulRedirect` ergänzt) |
| 7 · Gesperrter Link: Token, Kontrast, sichtbarer Grund | 2 | abgedeckt |

| Akzeptanzkriterium | Task | Nachweis |
|---|---|---|
| AK1 · 6 Bezeichnungen sichtbar, ≥48 px | 3 | `getByText` je Kategorie + Dichte-Böden 48/48/72 |
| AK2 · ⌘K-Grep, Klick öffnet Palette | 8 | **korrigiert** — Grep zeigt auf `CommandPaletteTrigger.tsx` |
| AK3 · 0 Inline-Pfade, `einsatzPfad` getestet | 1 | Quelltext-Guard + Bestandstest |
| AK4 · Startansicht, 3 Module unter „Zuletzt" | 5, 6 | Palette **und** ModulPanel je eigener Test |
| AK5 · Rail-Klick ändert den Pfad | 7 | Pfad-Assertion + Gegenaussage Selbstklick |
| AK6 · Kontrast ≥4,5:1, 0 × `rgba(…0.35)` | 2, 8 | gerechnete 5,30:1 im Commit, Grep = 0 |
