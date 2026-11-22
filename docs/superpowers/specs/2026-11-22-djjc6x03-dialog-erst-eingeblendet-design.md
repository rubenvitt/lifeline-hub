# e2e: in einen Dialog erst klicken, wenn er steht (LLH-2067)

Zunder: https://zunder.rubeen.dev/#/aufgabe/djjc6x03jz3yp38h26sl1lxy
Größe: kleine Änderung, kurzes Design. Abgestimmt am 22.11.2026 (Checkpoint vor dem Entwurf).

## Warum

Ein Klick in einen antd-Dialog, der noch einzoomt, geht unter Last verloren: es geht kein POST
ab, der Dialog bleibt offen, eine Fehlermeldung gibt es nicht (LFH-1114, LLH-2065). LLH-2065 hat
dafür `frontend/e2e/dialog-kern.ts` mit `dialogSteht(page, name)` und `eingeblendet(locator)`
gebaut. 34 Stellen in 24 Dateien kopieren stattdessen die Zeile

```ts
await expect(page.locator('.ant-zoom-appear, .ant-zoom-enter')).toHaveCount(0);
```

Sie sucht auf der ganzen Seite statt am Dialog und übersieht Popconfirm und Popover
(`ant-zoom-big-appear`). Jede neue Spec kopiert sie weiter, weil es keine Regel gibt.

## Ziele

- Jede Kopie in `frontend/e2e/` (außer `doku-bilder/`) nutzt `dialogSteht` oder `eingeblendet`.
- Regel in `frontend/e2e/AGENTS.md`: in einen antd-Dialog, ein Popconfirm oder ein Popover erst
  klicken, tippen oder messen, wenn `dialogSteht`/`eingeblendet` ihn als stehend meldet.
- Lint-Riegel, der neue Kopien der Warte-Zeile verhindert.

## Nicht-Ziele

- Specs, die heute ganz ohne Wartezeit in Dialoge klicken, werden nicht in einem Zug
  umgestellt; das geschieht, wenn jemand sie ohnehin ändert (Entscheidung 22.11.2026).
- `e2e/doku-bilder/` bleibt unberührt: der Bildlauf wartet über seinen eigenen Kern
  (`doku-bilder/kern.ts`, Ausblendungen mit angehaltener Uhr) und folgt
  `docs/anwender/AGENTS.md`.
- Keine Änderung an der App.

## Ansätze

1. **Regel + Riegel (gewählt).** Regel in `e2e/AGENTS.md`, dazu ein `no-restricted-syntax`-Eintrag
   in `E2E_RIEGEL` (`frontend/eslint.config.js`), der Zeichenketten- und Regex-Literale mit
   `ant-zoom-appear`/`ant-zoom-enter` (auch `-big-`) in `e2e/**` verbietet. Der Riegel fängt nur
   die Kopie, nicht einen fehlenden Wartepunkt; das kann Lint nicht sehen. Billig und im Muster
   der bestehenden e2e-Riegel (LFH-385, LFH-1114).
2. **Nur Regel.** Ohne Riegel taucht die Zeile beim nächsten Kopieren aus einer alten Spec wieder
   auf. Verworfen.
3. **Nur umstellen, keine Regel.** Behebt den Bestand, nicht den Nachschub. Verworfen.

## Entscheidungen

- **Basis:** Der Branch setzt auf den Commit von LLH-2065 auf (`dialog-kern.ts`), solange der
  nicht auf `alpha` liegt. Ändert LLH-2065 den Helfer noch, zieht dieser Branch nach.
- **`dialogSteht` nimmt auch eine Regex** und reicht `exact` an `getByRole` durch:
  `dialogSteht(page, name: string | RegExp, { exact }?)`. Eine Stelle (`trefflaeche-optionsknopf`)
  sucht den Dialog per Regex.
- **Abbildung der Stellen:**
  - Dialog per Name gefunden → `const dialog = await dialogSteht(page, '…')`; ein vorausgehendes
    `toBeVisible()` entfällt, `eingeblendet` prüft es selbst.
  - Dialog anders gefunden (`.filter({ hasText })`, Locator aus einem Helfer, `tablet` statt
    `page`) → `await eingeblendet(dialog)`.
  - Kein Dialog, sondern ein Knopf, der gemessen wird (`geraet-bereitstellungsraum:509`) →
    `await eingeblendet(knopf)`.
  - `dialog-rueckfrage` (`not.toHaveClass(/ant-zoom-appear|…/)`) → `eingeblendet(rueckfrage)`.
- **Lokale Helfer gleichen Namens:** `etb-entwurf-tabs` verliert seine `dialogSteht` zugunsten von
  `eingeblendet`. `betreuung-pruefliste` wartet zusätzlich auf den aufgeklappten Bereich
  (`.ant-motion-collapse`); dieser Teil bleibt in einem lokalen Helfer, der nicht mehr
  `dialogSteht` heißt (Schatten des geteilten Namens) und `eingeblendet` aufruft.
- **Kern-Helfer** `einsatzDialogOeffnen` (`einsatz-kern.ts`), `oeffneAbmeldenRueckfrage`
  (`menue-kern.ts`) und der Taktische-Zeichen-Dialog in `leisten-kern.ts` nutzen `dialogSteht`.
- **Riegel-Umfang:** `e2e/**/*.ts` außer `e2e/dialog-kern.ts` und `e2e/doku-bilder/**`. Kommentare
  sind keine Literale und bleiben erlaubt.
- **Regeltext** in `e2e/AGENTS.md` als eigener Punkt neben LFH-1114, der Punkt zu LFH-1114 verweist
  auf ihn; Riegel im selben Satz genannt.

## Dem Umsetzer überlassen

- Wortlaut der Riegel-Meldung und genauer AST-Selektor (Literal-`value` und `regex.pattern`),
  belegt mit einer Probe: die alte Zeile in einer Spec ist rot, in `dialog-kern.ts` nicht.
- Kommentare an den Stellen, die heute die Wartezeit begründen („erst nach der Zoom-Einblendung
  messen …“), dürfen bleiben oder kürzer werden.

## Prüfung

- `grep -rn "ant-zoom-appear\|ant-zoom-enter" frontend/e2e` zeigt nur noch `dialog-kern.ts`,
  `doku-bilder/` und Kommentare.
- `eslint` grün; Mutationsprobe: alte Zeile eingesetzt → Riegel rot.
- Die geänderten Specs laufen in Chromium grün (`PW_PROJEKTE=chromium`), die Kern-Helfer über je
  eine Spec, die sie nutzt.
