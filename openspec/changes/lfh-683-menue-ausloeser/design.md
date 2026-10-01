# Design

## Context

Motivation: `proposal.md`, „Why“. Anforderungen: `specs/datensatz-aktionsmenue/spec.md`.

Bestand der Kopien (Stand `alpha`, 01.10.2026):

| Stelle | Abweichung von der Regel |
| --- | --- |
| `components/Datensicht.tsx` (`weitere`) | Vorbild; trägt `MenueEintrag`, `menueEintraege` |
| `betreuung/StellenBlock.tsx` | Nachbau von `weitere` |
| `etb/EtbZeitachse.tsx` | Eintrag `Berichtigen (Grund)` deaktiviert |
| `etb/MetaChip.tsx` | Auslöser `disabled`; Ikone ohne `aria-hidden`-Hülle; Schnellweg als Geschwister (B5g) |
| `pages/lagekarte/Sidebar.tsx` | Ikonen je Eintrag; ohne Hülle |
| `verpflegung/ZeitfensterKarte.tsx` | eigener Trenner je Gefahr; ohne Hülle |
| `meldungen/MeldungKarte.tsx` | **kein `autoFocus`**; `onClick` je Eintrag; ohne Hülle |
| `abloesung/AbloesungKarte.tsx` | ohne Hülle |
| `pages/einstellungen/EinsatzPegel.tsx` | Ikonen, deaktivierte Einträge, Auslöser `disabled`, zwei Trenner |
| `pages/PersonenDetailPage.tsx` | `autoFocus` am `menu` statt am `Dropdown`; Auslöser `loading` |
| `chat/NachrichtenStrom.tsx` | **kein `autoFocus`**, Name „Aktionen“ ohne Kennung, `Popconfirm` im Menüetikett, `onClick` je Eintrag |

Nicht im Bestand: `pages/lagekarte/AnsichtSwitcher.tsx` (umrandeter Werkzeugknopf der
Kartenansicht, kein Datensatz), `pages/uhs/Grundriss.tsx` (Platzkarte, kein Dreipunkt, eigener
Riegel gegen `pointerdown` für dnd-kit).

Die Falle (gemessen, `docs/leitlinien/bedien-leitlinie-herleitungen.md`, LFH-367/B5g): ein
React-Portal reicht seine Synthetic Events durch den Komponentenbaum an die Vorfahren des
Auslösers weiter. `domEvent.stopPropagation()` im `menu.onClick` kommt zu spät; wirksam ist ein
`onClick`-Riegel am Container, in dessen Teilbaum der Auslöser hängt. Zweite Falle: rc-dropdown
mountet das Menü erst beim ersten Öffnen, ein `queryByRole('menuitem')` vorher ist immer `null`.

## Goals / Non-Goals

**Goals:**
- Eine Stelle für Auslöser, Menüform und Portal-Riegel; die Kopien verschwinden.
- Beide Fallen im Baustein belegt, jeweils mit Gegenprobe.
- Ein Guard verhindert neue Kopien.

**Non-Goals:**
- Wann gebündelt wird (ab drei, nach Rechteprüfung) bleibt bei den Aufrufern; der Baustein
  bündelt nicht selbst und zählt nicht.
- `AnsichtSwitcher` und `Grundriss` (s. Context).
- Neue Rückfragen oder geänderte Aktionsmengen außer der Chat-Rückfrage.

## Decisions

### D1 — API: Einträge als Daten, Zuordnung am Menü

```ts
interface MenueEintrag<K extends string = string> {
  key: K;
  label: string;
  gefahr?: true;
  ikone?: ReactNode;      // Sidebar, EinsatzPegel
  gesperrt?: true;        // EtbZeitachse „Berichtigen (…)“, EinsatzPegel oben/unten
}
interface MenueAusloeserProps<K extends string = string> {
  eintraege: readonly MenueEintrag<K>[];
  zugaenglicherName: string;
  onWahl: (key: K) => void;
  gesperrt?: boolean;     // MetaChip, EinsatzPegel (laeuft)
  laeuft?: boolean;       // PersonenDetailPage (Statuswechsel läuft)
}
```

- `label` bleibt `string`: ein Etikett aus Knoten war das Einfallstor für das `Popconfirm` im
  Chat. Eine Rückfrage gehört nach LFH-365 in ein `<Modal>` beim Aufrufer.
- `onWahl(key)` am Menü statt `onClick` je Eintrag: der Riegel hat einen Ort, die Einträge
  bleiben reine Beschreibung (Muster `AnsichtSwitcher`, `Datensicht`).
- `K` generisch, damit Aufrufer ihre Schlüssel-Unions behalten (`StelleAktion`,
  `Aktionsschluessel`) und kein `as` brauchen.
- `zugaenglicherName` als String, nicht als Funktion: der Baustein ist je Datensatz eine
  Instanz. `Datensicht.WeitereAktionen<T>` behält seine Funktionsform und reicht den String durch.
- **Verworfen:** antds `MenuProps['items']` durchreichen. Dann wäre jede Abweichung wieder
  möglich (Knoten-Etiketten, Trenner an beliebiger Stelle, `onClick` je Eintrag), und die Regel
  hätte wieder keinen Ort.

### D2 — Portal-Riegel im Baustein

Der Baustein legt eine `<span style="display:inline-flex">` um den `Dropdown`. Ihr `onClick`
stoppt die Weitergabe genau dann, wenn das Ziel **nicht** im DOM-Teilbaum der Hülle liegt, also
aus dem Portal kommt (`!event.currentTarget.contains(event.target)`). Klicks auf den Auslöser
selbst laufen unverändert weiter.

- Wirkt für alle Aufrufer; Zeilenriegel wie in `Datensicht` (`contains`-Prüfung am Zeilen-
  `onClick`) und der Geschwister-Schnellweg in `MetaChip` bleiben stehen (zweite Sicherung,
  kein Rückbau in dieser Change).
- **Nur `click`.** `keydown` bleibt unberührt: React ruft beim Stoppen auch das native
  `stopPropagation` am Portal-Container auf, und rc-dropdown hört Escape am `window`; ein
  Riegel auf `keydown` nähme dem Menü das Schließen per Escape. `pointerdown` bleibt ebenso
  unberührt (`etb/Schnellerfassung.tsx` und `components/zugPointerSensor.ts` hören am
  Dokument).
- Nebenwirkung, geprüft: ein Klick im Menü erreicht `document`/`window` nicht mehr. Im Frontend
  hört niemand `click` am Dokument (`grep addEventListener('click'` trifft nur
  `pages/lagekarte/Kartenflaeche.tsx`, an einem Kartenelement). rc-trigger schließt Popups über
  `mousedown`, nicht über `click`.
- **Verworfen:** Riegel beim Aufrufer lassen (heute). Genau das hat zu Stellen mit und ohne
  Riegel geführt.

### D3 — Einheitsform des Menüs

Reihenfolge wie `menueEintraege` heute: umkehrbare in Lieferreihenfolge, ein Trenner, Gefahr
rot. Weitere Trenner gibt es nicht.

- Folge für `EinsatzPegel`: der Trenner zwischen „Nach oben/unten“ und „Prognose …“ entfällt,
  „Prognose löschen“ rückt hinter den einen Trenner zu „Entfernen“. Beide sind entfernend und
  rot; die Gruppe bleibt erkennbar.
- Folge für `ZeitfensterKarte`: unverändert (eine Gefahr, ein Trenner).
- **Verworfen:** ein Feld `gruppe` für weitere Trenner. Ein Aufrufer bräuchte es; das
  Einheitsmenü wäre damit wieder frei formbar.

### D4 — Chat: Name und Rückfrage

- Name: `Aktionen zu Nachricht von ${autor_name}, ${formatZeitKurz(erstellt_at)}`; dieselbe
  Kennung wie die sichtbare Kopfzeile der Nachricht. Die Uhrzeit ist minutengenau; zwei
  Nachrichten desselben Autors in derselben Minute bekommen eine laufende Nummer „(1)“, „(2)“
  in Listenreihenfolge (`chat/aktionsNamen.ts`, nachgezogen aus dem Review).
- Löschen: `<Modal>` außerhalb der `renderItem`-Schleife (Muster `MeldungKarte`, „Erledigt“),
  Titel „Nachricht wirklich löschen?“, OK „Ja, löschen“ rot, „Abbrechen“. Der Zustand hält nur
  die ID; die Nachricht wird aus der Live-Liste gelesen, damit der Dialog schließt, wenn sie
  währenddessen anderswo gelöscht wird (kein zweites DELETE, ebenfalls aus dem Review).
- **Verworfen:** `Popconfirm` behalten über einen Knoten-Etikett-Ausgang im Baustein (s. D1).
- **Verworfen:** die Nachrichten-ID im Namen. Sie steht nirgends sichtbar; eine Kennung, die
  nur Hilfstechnik hört, hilft beim gemeinsamen Bedienen nicht.

### D5 — Guard gegen neue Kopien

`components/menueAusloeser.guard.test.ts` scannt `frontend/src/**/*.tsx` (ohne Tests): eine
Datei, die `<Dropdown` und `IkonePunkteSenkrecht` zugleich enthält, ist rot, außer
`components/MenueAusloeser.tsx` und einer Ausnahmeliste mit Grund (`AnsichtSwitcher`).
Muster: `components/dichte.guard.test.ts`. Die Ausnahmeliste wächst nicht ohne Grund am
Eintrag.

### D6 — Tests im Baustein

`components/MenueAusloeser.test.tsx` belegt:
1. keine Einträge → kein Knopf im DOM;
2. Name, `type="text"`, Zeichen in `aria-hidden`-Hülle, `gesperrt` und `laeuft` am Knopf;
3. **lazy mount:** vor dem ersten Öffnen kein `[role="menu"]`; nach Klick genau ein Menü unter
   `.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]`, Einträge über `within`;
4. Reihenfolge und Trenner, Gefahr mit `danger`-Klasse, `gesperrt` als `aria-disabled`;
5. `onWahl` mit dem Schlüssel, einmal;
6. **Portal-Aufsteigen:** ein Vorfahr mit `onClick` bleibt bei Klick auf Eintrag und auf das
   Menü-Polster stumm; Gegenprobe mit nacktem `Dropdown` derselben Form: der Vorfahr feuert.
   Mutationsprobe: Riegel auskommentiert → Test 6 rot.

`autoFocus` ist in jsdom nicht beobachtbar (der Fokus bleibt am Auslöser). Belegt wird er im
Browser: ein e2e-Fall öffnet ein Menü per Tastatur und prüft, dass der Fokus im Menü liegt.

## Risks / Trade-offs

- [Zusätzliche Hülle ändert Layout in Flex-/`Space`-Reihen] → `inline-flex` ohne Rand/Abstand;
  `e2e/gate3-trefflaeche.spec.ts` misst Abstände und Treffflächen der betroffenen Seiten mit.
- [Riegel stoppt einen Klick, auf den ein Vorfahr absichtlich wartet] → bisher keiner bekannt
  (D2); die bestehenden Tests der elf Stellen laufen unverändert.
- [Chat-Tests greifen über den alten Namen „Aktionen“ oder das `Popconfirm`] →
  `chat/NachrichtenStrom.test.tsx` und `pages/ChatPage.test.tsx` werden in derselben Aufgabe
  umgestellt; die e2e-Suite greift auf keins von beiden zu (geprüft per `grep`).
- [Pegel-Menü verliert einen Trenner] → bewusst (D3), in der Abschlussmeldung genannt.

## Migration Plan

Reiner Frontend-Umbau, kein Datenstand. Rückweg: Revert des Branches.
