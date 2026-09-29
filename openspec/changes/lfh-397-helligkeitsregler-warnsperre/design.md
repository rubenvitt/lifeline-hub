# Design

## Context

Zum Warum siehe proposal.md. Auf `alpha` gibt es drei Anknüpfungspunkte.

- **Präzedenz der Achse:** `theme/ThemeModeProvider.tsx` trägt Farbschema (LFH-352) und
  Bediendichte (LFH-329) in einem Context. Beide Achsen werden gespeichert (`localStorage`),
  und für beide gilt: gespeicherte Wahl gewinnt (LFH-361). Die Stufenlisten stehen in
  `theme/darstellungOptionen.ts` als Ableitung aus einem `Record`. Bedienwege sind das
  Benutzermenü (Umschaltgruppen, „✓“ im Text) und die Sprungpalette (`DICHTE_BEFEHLE`).
- **Warnsignale (Scope-Befund):** Es gibt kein app-weites Warn-Flag. Alles gilt je Einsatz,
  und fast alles wird nur auf einer Seite berechnet. Für den ganzen Einsatz ist nur
  `einsatz/EinsatzLayout.tsx` gemountet, mit Modulzähler, SSE-Stream und `AlarmZentrale`.
  - Warnstufe: Sie hängt je Gefahrengebiet an (`hoechste_warnstufe`,
    `einsatzKeys.gefahrengebiete`, live). Verdichtet wird sie in
    `verdichteGefahrengebiete()` (`pages/lage-dashboard/lageVerdichtung.ts`).
  - Überfällige Bestätigungspflicht: Sie gibt es nur an Meldungen, als Regel `istAlarmiert`
    (`meldungen/meldungKennzahlen.ts`). Keine Zählung legt sie offen.
    `src/einsatz/zaehler.rs` lädt die Meldungsliste aber schon für `offen`/`ungesehen`.
- **Kontrast unter Abdunklung** (WCAG-Formel, gerechnet 29.09.2026, Deckschicht in
  sRGB-Werten). Die Grundfläche ist `grund`:

  | Stufe | Nacht alarmText | Nacht text | Tag alarmText | Tag text |
  |------:|----------------:|-----------:|--------------:|---------:|
  | 100 % | 7,18 | 16,65 | 7,51 | 15,46 |
  |  80 % | **4,81** | 10,56 | 5,98 | 10,02 |
  |  60 % | 3,07 | 6,11 | 4,28 | 5,89 |
  |  40 % | 1,90 | 3,16 | 2,64 | 3,09 |
  |  20 % | 1,25 | 1,55 | 1,46 | 1,53 |

  Die WCAG-Formel rechnet mit einem festen Streulicht von 0,05. Das bildet einen hellen Raum
  ab, keinen dunkeladaptierten Fükw. Deshalb taugt sie **nicht** als Boden für die freie Wahl:
  Wer im Dunkeln auf 20 % stellt, liest dort. Sie taugt aber als Boden für die Warnung.
  Kriterium 5 sagt „nie < 4,5 : 1“, und eine Warnung muss auch im hellen Umfeld tragen.

## Goals / Non-Goals

**Goals:**
- Kriterium 8 erfüllbar machen, mit genau **einem** Regler und **einer** Sperre.
- Die Sperre in einer reinen Funktion festhalten, die in beiden Hälften getestet ist
  (greift mit Warnung, greift ohne Warnung nicht). Eine Mutationsprobe muss rot werden.
- Keine zweite Farbwahrheit: Paletten, antd-Tokens und Kontrast-Gates bleiben, wie sie sind.

**Non-Goals:**
- Kein getrennter Kontrastregler. Das Kriterium sagt „1 Regler“. Den Kontrast trägt die
  Palette (Kriterium 5), und die Abdunklung senkt ihn. Genau das begrenzt die Sperre.
- Keine Aufhellung über 100 %. Software kann nicht heller machen als das Display. Ein
  `brightness(>1)` würde nur Farben ausbleichen.
- Keine automatische Helligkeit nach Tageszeit oder Umgebungslicht. Dafür gibt es keinen
  verlässlichen Sensor im Browser, und eine Heuristik würde die Wahl überstimmen (LFH-361).
- Keine DWD-Unwetterwarnung als Auslöser. Sie wird nur auf `WetterPegelPage` alle 5 min
  abgefragt und hat kein Stream-Ereignis → Folgeticket (s. „Offene Punkte“).
- Keine Warnsperre außerhalb eines Einsatzes (Einsatzauswahl, Verwaltung). Dort gibt es keine
  Einsatzwarnung.

## Decisions

### D1 — Träger: dritte Achse im `ThemeModeProvider`

`helligkeit: Helligkeit` (`100 | 80 | 60 | 40 | 20`) steht neben `dichte` im selben Context,
mit dem Speicherschlüssel `lifeline-hub.helligkeit`. Ein benannter Zugang heißt
`useHelligkeit()` (wie `useDichte()`). Die Vorgabe ohne gespeicherte Wahl ist 100 %. Ein
unbekannter gespeicherter Wert ist keine Wahl und fällt auf 100 % zurück. Es gibt keine
Heuristik, die eine gespeicherte Wahl überstimmen könnte.

*Alternative verworfen:* ein eigener Provider. Die drei Darstellungsachsen gehören an einen
Ort. Ein zweiter Provider bräuchte eine zweite Test-Hülle und einen zweiten Fallback
außerhalb des Providers.

### D2 — Die Sperre als reine Funktion

In `theme/helligkeit.ts`:

```ts
export const HELLIGKEIT_STUFEN = [100, 80, 60, 40, 20] as const;
export const HELLIGKEIT_BODEN_WARNUNG: Helligkeit = 80;
export function wirksameHelligkeit(wahl: Helligkeit, warnungAktiv: boolean): Helligkeit {
  return warnungAktiv ? Math.max(wahl, HELLIGKEIT_BODEN_WARNUNG) : wahl;
}
```

Der Boden von 80 % ist **abgeleitet, nicht gesetzt.** Er ist die kleinste Stufe, bei der
`alarmText` auf `grund` in **beiden** Paletten ≥ 4,5 : 1 hält (Kriterium 5, Tabelle oben). Ein
Vitest rechnet das aus `farbenDunkel`/`farbenHell` nach. Er wird rot, wenn eine
Palettenänderung den Boden verschiebt, und ebenso, wenn jemand den Boden ohne Grund senkt.

Die Wahl wird **nie** überschrieben. Die Sperre wirkt nur auf die wirksame Stufe. Endet die
Warnung, kehrt die gewählte Stufe zurück, ohne dass jemand nachstellen muss.

### D3 — Warnsignal: Anmeldung am Provider, Quelle im `EinsatzLayout`

Der Provider liegt über dem Router und kennt keinen Einsatz. Er bietet deshalb
`useWarnsperre(aktiv: boolean)` an. Jede Quelle meldet sich per `useId` in einer Menge an und
beim Unmount wieder ab. `warnungAktiv` bedeutet: Die Menge ist nicht leer.
`EinsatzLayout` ist die einzige Quelle. Sie ruft

```ts
aktiveWarnung({ hoechsteWarnstufe, bestaetigungUeberfaellig }): boolean
```

(rein, `einsatz/aktiveWarnung.ts`). Die Funktion gibt `true` zurück, wenn
`warnstufeKennzahl[hoechsteWarnstufe].rolle === 'alarm'` gilt (heute `hoch`/`akut`) oder wenn
`bestaetigungUeberfaellig > 0` ist. Die Warnstufen-Hälfte liest den Statusvertrag, statt
eine eigene Stufenliste zu führen. Ändert sich der Vertrag, zieht die Sperre mit.

- **Warnstufe:** `EinsatzLayout` liest `einsatzKeys.gefahrengebiete`, aber nur, wenn das Modul
  erlaubt ist (dieselbe Freigabe, mit der die Seite liest). Verdichtet wird mit
  `verdichteGefahrengebiete()`. Ein Lade- oder Fehlerzustand zählt nicht als Warnung. Eine
  Sperre ohne Beleg würde dimmen verbieten, ohne dass jemand sieht, warum.
- **Bestätigungspflicht:** Neues Feld `MeldungsZaehler.bestaetigung_ueberfaellig`. Gezählt
  wird aus der bereits geladenen Liste mit derselben Regel wie `istAlarmiert`
  (`bestaetigung_pflicht && !ist_bestaetigt && (ist_ueberfaellig || eskaliert)`). Beide
  Stellen tragen einen Querverweis-Kommentar. Das Feld ist live über `meldung → modulZaehler`.
  Der Fristablauf selbst sendet `eskaliert` über den Erinnerungs-Tick. Ohne Meldungsrecht
  fehlt das Feld, und die Hälfte trägt nichts bei.

*Alternativen verworfen:*
- **„Statusrolle `alarm` irgendwo“:** Das ist zu breit. Defektes Material und überfällige
  Ablösungen sind `alarm`, aber keine Warnung, die man wegdimmen könnte. Sie sind Arbeit auf
  einer Liste.
- **Offene Toasts der `AlarmZentrale`:** Sie sind flüchtig und halten keinen abfragbaren
  Zustand. Die Quelle ihrer Sofortmeldungen (überfällige Bestätigung) ist mit (b) abgedeckt,
  sobald die Frist läuft.
- **Meldungsliste im Layout laden:** Das wäre ein voller Listenabruf für eine Zahl. Der Zähler
  hat die Liste schon.

### D4 — Darstellung: Abdunklungsschicht, kein Filter und keine Palette

In `theme/rollen.css` (der erlaubte Ort für Farbwerte):

```css
@media screen {
  html:not([data-helligkeit='100'])::after {
    content: '';
    position: fixed;
    inset: 0;
    background: #000;
    opacity: var(--lfh-abdunkelung, 0);
    pointer-events: none;
    z-index: 2147483647;
  }
}
```

Der Provider setzt `data-helligkeit` (die **wirksame** Stufe) und `--lfh-abdunkelung`
(`1 − Stufe/100`) am `<html>`, wie schon `data-theme`/`data-dichte`.

- `filter: brightness()` am `<html>` ist verworfen. Er rechnet jedes Bild neu, auch die
  MapLibre-Leinwand bei jedem Frame. In einigen Engines macht er außerdem den Container zum
  Bezugsrahmen für `position: fixed`. Die Deckschicht wird dagegen nur zusammengesetzt.
- Eine abgedunkelte Palette (dritter Token-Satz) ist verworfen. Sie wäre eine zweite
  Farbwahrheit neben `farbenDunkel`/`farbenHell`, und jedes Kontrast-Gate müsste sie
  mitmessen.
- `pointer-events: none` lässt Klicks und `elementFromPoint` durch. `z-index` liegt über allen
  antd-Portalen (Modal, Message, Dropdown). So werden auch Überlagerungen abgedunkelt.
- Nur `@media screen`: Der Druck bleibt hell, und `druck/druck.css` bleibt unberührt.

### D5 — Bootstrap vor dem ersten Bild

`index.html` liest `lifeline-hub.helligkeit` mit derselben Gültigkeitsprüfung und setzt
`data-helligkeit` und `--lfh-abdunkelung`. Ohne diesen Schritt sähe der dunkle Fükw bei jedem
Neuladen einen Moment volle Helligkeit. Das Skript kann keine Warnung kennen. Die Sperre setzt
der Provider nach dem Mount, sobald die Warndaten da sind. Kommentar-Querverweis in beiden
Dateien, wie beim Farbschema.

### D6 — Bedienung

- **Benutzermenü:** Gruppe „Helligkeit“ nach „Bediendichte“, Einträge aus
  `HELLIGKEIT_OPTIONEN` (Ableitung aus einem `Record`, wie `DICHTE_INDEX`). Die gewählte Stufe
  trägt „✓“. Während einer Warnung passiert Folgendes:
  - Die Gruppenüberschrift lautet „Helligkeit · mind. 80 % (Warnung aktiv)“.
  - Einträge unter dem Boden sind `disabled`. Die Sperre wird erklärt, nicht stumm
    weggeschaltet (M16).
  - Liegt die Wahl unter dem Boden, trägt ihr Eintrag „✓ (wirkt 80 %)“.
- **Sprungpalette:** Es gibt fünf Befehle „Helligkeit: N %“ (`HELLIGKEIT_BEFEHLE`), die
  `setHelligkeit` rufen. Sie setzen die **Wahl**. Die Sperre gilt auch hier, weil sie auf der
  wirksamen Stufe sitzt und nicht am Bedienweg.
- **Keine Kopfleisten-Anzeige:** Die Kopfzeile trägt keine Einstellungen (LFH-392).

## Risks / Trade-offs

- **Sprung bei Warnungsbeginn:** Wer auf 40 % gedimmt hat, sieht beim Eintreffen einer
  Warnung einen Sprung auf 80 %. Das ist gewollt, denn es ist der Zweck der Sperre. Es ist ein
  einzelner Wechsel, kein Blinken (Kriterium 11).
- **Nur im geöffneten Einsatz:** In der Einsatzauswahl greift die Sperre nicht. Eine Warnung
  in einem anderen, nicht geöffneten Einsatz erfasst sie ebenfalls nicht. Das entspricht der
  Reichweite aller anderen Warnanzeigen heute.
- **Zusatzabruf Gefahrengebiete im Layout:** Er ist klein, teilt den Cache mit Lagekarte,
  Dashboard und Gefahrenseite und ist live. Ohne Modulrecht findet er nicht statt.
- **WCAG-Boden ist konservativ:** 80 % sind im dunklen Raum mehr, als nötig wäre. Die
  Alternative wäre ein gesetzter Wert ohne Messgrundlage.

## Offene Punkte (Checkpoint)

1. **Boden bei Warnung:** 80 % (abgeleitet, Empfehlung), 100 % (Warnung hebt ganz auf) oder
   60 % (Tag 4,28 : 1, Nacht 3,07 : 1, bricht Kriterium 5).
2. **Stufen:** 100 · 80 · 60 · 40 · 20 % (Empfehlung) oder feiner (z. B. 10er-Schritte).
3. **Umfang „aktive Warnung“:** (a) Warnstufe + (b) Bestätigungspflicht (Empfehlung). Dazu
   optional (c) DWD schwer/extrem als Folgeticket oder schon jetzt.
