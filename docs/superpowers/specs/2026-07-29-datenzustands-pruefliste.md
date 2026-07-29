# Prüfliste Einsatztauglichkeit — Datenzustände (LFH-331 · B3)

Gate 7 der Bedien-Leitlinie (`2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7)
verlangt diese Liste an **jeder** umgebauten Seite. Sie wird hier **einmal für den Querschnitt**
geführt, nicht dreißigmal: B3 baut keine Seite um, sondern zieht **einen Zustandsvertrag** durch
den Bestand. Was an den ~30 berührten Dateien geändert wurde, ist an allen dasselbe — welcher
Knoten bei `isError`, bei `isLoading` und bei `isSuccess && leer` steht. Wo eine Seite abweicht,
steht sie in der Zeile namentlich.

**Umfang:** `components/SeitenZustand.tsx` (das Primitiv) · 13 Katalogtabellen (10
Stammdaten-Reiter, `karten/OnlineQuellenVerwaltung`, `karten/OfflineKartenVerwaltung`,
`pages/BenutzerPage`) · Kräfte (`FahrzeugePage`, `PersonalPage`, `MaterialPage`,
`EinheitenPage`) · Betroffene (`PersonenPage`, `TierePage`, `SchaedenPage`) · Gliederung
(`EinsatzabschnittePage`, `UnfallhilfsstellenPage`, `UnfallhilfsstellenDefault`,
`BereitstellungsraeumePage`) · Lagekarte (`useLagekarteDaten`, `LagekartePage`, `Sidebar`,
`useKartenbilder`, `useKartenAnsicht`) · `einsatz/EinsatzLayout` · `lage-dashboard` ·
ETB (`EtbTabelle`, `EtbPage`, `EtbFilterleiste`) · die neun Listen mit Leerzuständen ·
`components/Liste.tsx` · `routing/deeplinks.ts`.

**Das Ergebnis ist absichtlich nicht durchgehend grün.** Eine Prüfliste, die nichts findet, misst
nichts. Sechs Zeilen sind für diesen Querschnitt nicht anwendbar, drei bleiben offen und nennen
ihr Zielticket.

| #  | Verdikt | Beleg / Zielticket |
| -- | ------- | ------------------ |
| 1  | **erfüllt** | Der Wiederhol-Knopf ist ein antd-`Button` am `ConfigProvider`, kein rohes `<button>` — die Begründung dafür steht seit A2 in `SeitenZustand.tsx:70-76` und galt hier unverändert. Kein neues `size="small"`: die vier Detailseiten haben ihres beim Umzug auf `SeitenFehler` sogar **verloren** (`SchaedenDetailPage`, `TiereDetailPage` trugen es). `SeitenLeer` steuert genau einen Primärknopf bei, in Normalgröße. |
| 2  | **nicht anwendbar** | B3 ändert keine Zeilenhöhen und keine Dichtestufe. Die Handschuh-Staffel ist **B5 (LFH-333)**. |
| 3  | **erfüllt** | Genau das ist der Gegenstand des Tickets. Der Ladezustand ist jetzt an jeder umgebauten Stelle sichtbar, **bevor** eine Aussage über die Menge steht: `SeitenSkeleton` bzw. antds `loading` an der Tabelle. Optimistische Updates gibt es weiterhin nirgends (Baseline 0) → **B6 (LFH-334)**. |
| 4  | **nicht anwendbar** | B3 führt keine kritische oder irreversible Aktion ein. „Erneut abrufen" ist ein Lesevorgang; die Primäraktionen der Leerzustände führen zu Erfassungsmasken, sie erfassen nicht selbst. |
| 5  | **erfüllt** | Kein einziger Farbwert von Hand. `SeitenFehler`/`SeitenStandVeraltet` nehmen antds `Alert`-Rollenfarben, `SeitenLeer` nimmt `token.colorTextSecondary`/`colorTextDescription` aus `theme.useToken()`. Die in A2 gemessenen Kontraste gelten damit unverändert. |
| 6  | **erfüllt** | Jeder Zustand trägt **Text** als zweiten Kanal, nicht nur Farbe: der Fehler nennt, was nicht geladen werden konnte, der Leerzustand, was nicht da ist. `SeitenFehler` trägt zusätzlich `showIcon` und `role="alert"`. |
| 7  | **erfüllt** | Rot bedient nichts: `SeitenFehler` ist `type="error"` (Ausfall), `SeitenStandVeraltet` bewusst `type="warning"` — die Zeilen darunter sind echt, nur alt. Das Warn-Overlay der Lagekarte ist ebenfalls `warning`, weil das Lagebild unvollständig, nicht falsch ist. |
| 8  | **nicht anwendbar** | Kein Helligkeitsregler in der Anwendung; A0 verweist ihn ausdrücklich weiter (eigener Folge-Task). |
| 9  | **erfüllt** | Der Fehlerzustand steht **an der Stelle, an der sonst die Daten stünden** — nicht am Rand, nicht in einem Toast. Genau das war Befund M89: 83 flüchtige `message.error` gegen 3 bleibende Anzeigen. |
| 10 | **nicht anwendbar** | B3 erzeugt keine Alarme. Es zeigt Zustände. Gilt ab **B6 (LFH-334)**. |
| 11 | **erfüllt** | Kein Blinken, keine Bewegung auf lesbarem Text. Der Ladezustand ist ein Skelett, kein Kreisel — die A0-Entscheidung, die B3 auf die Lagekarte (`<Spin>` → `SeitenSkeleton`) und das ETB ausgeweitet hat. |
| 12 | **teilweise erfüllt** | Die Kennzahlenleiste des Lage-Dashboards reserviert ihre Höhe jetzt mit sechs Skeletten aus den festen Etiketten, statt null Knöpfe zu rendern und sechs hereinspringen zu lassen — das war ein echter Sprung und ist weg. **Nicht gemessen**: der CLS-Wert selbst; jsdom rechnet kein Layout, und es gibt keinen Browser-Lauf dafür → **B6 (LFH-334)**, das die Live-Aktualisierung ohnehin misst. |
| 13 | **nicht anwendbar** | B3 fügt keine fixierten Köpfe, Fußleisten oder Drawer hinzu. Der Fokus-Durchlauf ist gegenüber B1 unverändert. |
| 14 | **erfüllt** | Kopfzeile, Identifierspalte und Spaltenschalter kommen unverändert aus `KatalogTabelle` (B1/B2) — B3 hat das Primitiv **nicht angefasst** (Festlegung D3). Keine Tabelle wurde in Karten aufgelöst. |
| 15 | **nicht anwendbar** | B3 baut keine Erfassungsmaske. Es baut die Wege **zu** ihnen (Primäraktionen der Leerzustände). Die Maske selbst ist **B4 (LFH-332)**. |

---

## Was diese Liste nicht abdeckt — und warum das hier steht

**Die Beweiskraft von AK4 liegt im Primitivtest, nicht in den Seitenpaaren.** Das ist der
wichtigste Satz dieser Prüfliste, und er ist unbequem.

Unter Festlegung D3 tauscht der Fehlerfall die ganze Listenkomponente aus. Die negative Hälfte
jedes Seiten-Partnerpaars („der Leertext ist nicht im DOM") ist damit **strukturell** wahr — die
Komponente ist nicht montiert, also kann ihr Text nicht dastehen. Diese Assertionen belegen keine
Zustandsweiche; sie belegen, dass ein Ternär ein Ternär ist.

Sie sind trotzdem richtig und bleiben stehen: als **Regressionsklammer** gegen den Tag, an dem
jemand die Weiche entfernt. Aber sie sind kein Nachweis, und sie dürfen nicht als AK4-Erfüllung
gezählt werden. Der Nachweis steht in `components/SeitenZustand.test.tsx`.

**Zwei Belege, dass die Kette trägt** — beide gemessen, nicht behauptet:

- Fehlerzweig in `stammdaten/MaterialTab.tsx` auf `false` gesetzt → genau **ein** Test wird rot,
  und zwar der richtige (`1 failed | 7 passed`).
- `onWiederholen` in `karten/OfflineKartenVerwaltung.tsx` auf eine leere Funktion gesetzt → der
  Wirkungstest wird rot (`1 failed | 18 passed`). Ein Test, der nur die *Anwesenheit* des Knopfes
  prüft, wäre dagegen grün geblieben.

**Drei Dinge, die B3 bewusst nicht getan hat:**

1. **Kein Bestands-Sweep über die 83 `message.error`.** Sie sind für Schreibvorgänge und
   Erfolgsmeldungen weiterhin richtig; B3 ersetzt sie an den **Lese**pfaden, die einen bleibenden
   Zustand zeigen müssen. Der Rest ist **B6 (LFH-334)**.
2. **Kein `zustandVon` von `isLoading` auf `isPending`.** In jsdom fallen beide Flags zusammen —
   die Umstellung wäre an 12 Konsumenten prinzipiell unbeobachtbar. Eine ungeprüfte
   Verhaltensänderung ist den Nutzen nicht wert.
3. **Der letzte rohe `<button className="lfh-knopf">`** auf dem Lage-Dashboard bleibt stehen. Er
   gehört zur Dichte-Staffel → **B5 (LFH-333)**.
