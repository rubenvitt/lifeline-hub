# Kräfte-Listen: Bemerkung sichtbar machen, Zielform des Statuswechsels festlegen (LFH-369 · B5i)

Dieses Dokument hat zwei Aufgaben. Es hält fest, **was gebaut wurde** (Teil 1, Befund M21 —
die leere Bemerkung), und es **legt fest**, welche Form der Statuswechsel in den Kräfte-Listen
bekommt (Teil 2). Teil 2 ist ausdrücklich **kein Umbau**: gebaut wird er in Band C
(LFH-339/C4). Was hier steht, ist die Entscheidungsgrundlage, die dort fehlte — es gab bis
heute **keine Zeile** in `docs/superpowers/specs/`, die eine Zielform benannte.

Gemessen am 2026-07-30 gegen `1cc682c`. Betroffen sind `frontend/src/pages/FahrzeugePage.tsx`,
`PersonalPage.tsx` und `MaterialPage.tsx`.

Wo dieses Dokument dem Ticket oder dem Elternticket LFH-333 widerspricht, gilt dieses
Dokument; jede Abweichung steht unten mit Beleg.

---

## 1. Was das Ticket annahm und was der Code sagt

| Ticket / Elternticket | Gemessen |
| --- | --- |
| „**fünf Aufrufer** desselben Musters rechtfertigen ein Primitiv" | **Drei.** `gefahren/GefahrenPage.tsx:135` und `lagekarte/Sidebar.tsx:532` haben **keinen Leerfall**: dort wird ein *Pflichtname* umbenannt (`gefahrengebietName(label, id)` liefert immer einen Fallback, `b.name` ist gesetzt), mit `trim`-Vergleich gegen den Altwert und Verwerfen bei leerer Eingabe. Ein „hinzufügen"-Platzhalter hätte dort keinen Zustand, in dem er erscheinen könnte. |
| Statuswechsel sitzt in einer **24-px-Zelle** | Die Zelle gibt es nicht mehr. Seit B1 hängt die Höhe an `controlHeight` (30/48/72); auf `komfortabel` und `handschuh` liegt sie **über** dem Ziel. Der Befund gilt nur noch für die Vorgabestufe. |
| Zielform ist ein `Segmented`-Feld mit **Statusfarbe als Fläche** | Beides fällt durch — §3 (Breite) und §4 (Farbe), je mit Zahl bzw. Regel. |
| „dann passt der Auslöser in den **Aktionsslot der Karte**" (`2026-06-22-drawer-nutzung-reduzieren-design.md:102-106`) | Der Slot ist auf allen drei Seiten mit „Entfernen" belegt (`FahrzeugePage:564`, `PersonalPage:455`, `MaterialPage:349`) und `Datensicht.tsx:193-200` sichert **genau EINE** Primäraktion zu. Der Satz ist doppelt falsch; §5 löst ihn auf. |
| Alle sechs Zeilennummern des Elterntickets | Falsch. LFH-330/B2 hat die Seiten auf `components/Datensicht.tsx` umgezogen (`82c2885`). Die geltenden stehen im Ticket LFH-369 selbst. |

---

## 2. Teil 1 — was gebaut wurde (Befund M21, erledigt)

`components/BemerkungZelle.tsx` trägt beide Zweige der Bemerkungszelle.

**Der Befund, den das Ticket nicht kannte, war der wichtigere:** der **Lese**zweig hatte
längst einen „—"-Platzhalter, nur der **Schreib**zweig nicht. Die Affordanz war genau falsch
herum verteilt — wer nichts tun konnte, sah einen Platzhalter; wer schreiben durfte, sah ein
`<button>`, dessen ganzer Inhalt ein `<svg>` war, also **ohne zugänglichen Namen** (gemessen:
`getByRole('button', { name: … })` fand vor der Änderung nichts).

Drei Festlegungen, die beim Anfassen gelten:

- **Der Platzhalter ist ein echter antd-`Button`** (`type="link"`), kein gestyltes
  `<span onClick>`. Grund: ein handgebautes Bedienziel schuldet nach LFH-365 **zwei** Angaben
  (`minHeight: token.controlHeight` **plus** Polsterung) und eine eigene Zusicherung über zwei
  Dichtestufen, weil kein Guard eine Pixelangabe sieht. Ein `Button` erbt seine Höhe vom
  `ConfigProvider` und schuldet nichts davon. `type="link"` liefert zugleich die Bedienfarbe
  aus dem Token (`colorLink`, blau) statt eines Hex-Literals — „Rot bedient nichts".
- **Der Lesezweig behält „—".** „Konsistent halten" heißt gleiche Zeilenhöhe und Typografie,
  **nicht** gleicher Wortlaut: ohne Schreibrecht gibt es keine Aktion, ein „Bemerkung
  hinzufügen" wäre eine falsche Affordanz. Dass beide Zweige gleich hoch bleiben, trägt das
  Primitiv dadurch, dass sie durch **dieselbe Datei** laufen.
- **`spaltenAusVoreinstellung` und `abBreite` wurden geprüft und NICHT geändert.** Der
  sichtbare Platzhalter macht die Spalte breiter — die B2-Entscheidung
  (`FahrzeugePage.tsx:335-341`: schreibtragende Spalten bekommen nie ein `abBreite`, sie
  weichen nur über die Voreinstellung) bleibt davon unberührt, und beide Seitentests belegen,
  dass der Spaltenzähler vorher wie nachher stimmt. Die Frage des AK („kann die
  Voreinstellungs-Entscheidung berühren") ist damit mit *geprüft, nicht geändert* beantwortet.

**Nur der Tabellenzweig ist betroffen.** Keine der drei `karte.sekundaer`-Listen führt die
Bemerkung (Slot auf drei Einträge begrenzt, `Datensicht.tsx:239`) — unter `md` fehlt sie ganz.
Das Touch-Risiko sitzt also auf dem Führungs-Tablet, nicht auf dem Handschirm, und ein Test am
schmalen Schirm wäre leer grün.

---

## 3. Festlegung Z1 — waagerecht oder senkrecht: die Zahl

**Regel: Eine waagerechte Zielform (`Segmented`, Knopfreihe) trägt höchstens ZWEI beschriftete
oder VIER unbeschriftete Werte. Darüber wird senkrecht angeordnet.**

Gerechnet wird gegen die Quick-View-Obergrenze **480 px** (CLAUDE.md: breiter → eigene Route),
abzüglich zweimal Innenpolster `abstand.lg`. Zielbreite beschriftet = **150 px** — das ist
keine geschätzte Zeichenbreite, sondern die im Bestand als nötig befundene `minWidth` der
Statusfelder (`FahrzeugePage:383`, `PersonalPage:305`; Material nimmt sogar 170).
Zielbreite unbeschriftet = `controlHeight` (quadratisch). Lücke = `abstand.sm`.

| Stufe | nutzbar `[abgeleitet]` | beschriftet (150 px) `[abgeleitet]` | unbeschriftet `[abgeleitet]` |
| --- | --- | --- | --- |
| komfortabel (48 / sm 11 / lg 28) | 480 − 56 = **424** | 161N − 11 ≤ 424 → N ≤ 2,70 → **2** | 59N − 11 ≤ 424 → N ≤ 7,37 → **7** |
| handschuh (72 / sm 16 / lg 44) | 480 − 88 = **392** | 166N − 16 ≤ 392 → N ≤ 2,46 → **2** | 88N − 16 ≤ 392 → N ≤ 4,63 → **4** |

Die beschriftete Schwelle ist damit **dichteunabhängig 2**; die unbeschriftete fällt auf den
Handschuh-Boden **4**.

**Gemessene Kardinalitäten im Bestand:** Fahrzeug **10** (FMS 0–9, `migrations/0008:22-36`),
Personal **6** (`migrations/0012:18-30`), Material **5** (`MaterialPage.tsx:22-28`).
Längstes Label: „8 – Bedingt einsatzbereit" (24 Zeichen), „Desinfektion nötig" (18).

**Jeder der drei Kataloge liegt über jeder Schwelle, in jeder Dichtestufe.** Die waagerechte
Zielform fällt damit nicht nach Geschmack durch, sondern nach Zahl — und `Segmented` bricht
nicht um. Dass der Fahrzeugkatalog **mandantengepflegt** ist, macht die Sache endgültig: zehn
ist der Seed, nicht die Obergrenze.

**Warum senkrecht trägt, wo waagerecht scheitert:** ein senkrechtes Menü darf **scrollen** und
liegt im Portal, also außerhalb der Zelle und außerhalb der 390-px-Karte. Zehn Werte brauchen
`10 × 48 = 480 px` bzw. im Handschuh `720 px` Höhe `[abgeleitet]` — mit Bildlauf ist das
tragbar, ohne nicht. Eine Knopfreihe kann beides nicht.

---

## 4. Festlegung Z2 — der Träger: Zeilen-Dropdown am Ort, kein Drawer

**Regel: Träger ist ein Auslöser, der das aktuelle Statusetikett IST, und ein senkrechtes Menü
mit ganzzeiligen Bedienzielen (`controlHeight` je Zeile). Kein neuer Drawer, keine neue Fläche.**

In der **Tabelle** ersetzt er das heutige `<Select>` in der Statuszelle. In der **Karte** wird
das heute rein anzeigende Statusetikett bedienbar — bei Fahrzeug und Personal ist der
`karte.status`-Slot bereits gesetzt (`FahrzeugePage:554`, `PersonalPage:445`), bei Material
steht der Status als Sekundärfeld (`MaterialPage:348`) und wird dort zum Auslöser.

Das schließt die Lücke, die `2026-06-22-drawer-nutzung-reduzieren-design.md:102-106` benennt
(„unter `md` sind diese Module lesend plus eine Primäraktion") — **ohne** Drawer: der Grund,
warum das `Select` nicht in die Karte passt, ist seine feste Mindestbreite
(`Datensicht.tsx:234-236`). Ein Auslöser mit Menü im Portal hat dieses Problem nicht.

Die Form folgt der Bündelungs-Festlegung aus LFH-365: `Dropdown` mit `menu={{ items }}`,
`trigger={['click']}`, `autoFocus`; **kein `Popover`** (der trägt im Repo ausschließlich Inhalt
und liefert keine `menuitem`-Rollen). Zwei dort gemessene Fallen gelten hier mit: die Zuordnung
gehört ans **Menü**, nicht an jedes Item, und im Test wird der Eintrag **immer über das
geöffnete Menü** gegriffen (`.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]` + `within`),
weil antd die Portale geschlossener Dropdowns im Baum stehen lässt.

**Eine Zielform für alle drei Module, nicht zwei.** `fahrzeug_status.fms_anker` bleibt
Sortier-Anker und optionales Tastenkürzel, wird aber **nicht** tragende Bedienform: die Spalte
ist **nullable** und ein Mandant darf sie frei lassen — `StatusKatalogTab.test.tsx:181` hält
das ausdrücklich fest („`fms_anker: null` hält den Anker frei, statt eine Ziffer zu erfinden").
Ein 0–9-Tastenfeld auf einer nicht lückenfrei zugesicherten Spalte hätte Löcher, und der
Ziffernraum steht ohnehin schon im Label („1 – Frei auf Funk"). Die eingeübte
Funkbedienteil-Metapher bleibt damit als **Tastenkürzel** erreichbar, ohne die Anordnung von
einer optionalen Spalte abhängig zu machen.

**Material fällt nicht heraus.** Die Zielform ist eine Bedienform, keine Vertragsfrage: fünf
feste Enum-Werte verhalten sich beim Bedienen wie fünf Katalogwerte. Dass Material außerhalb
des A2-Statusfarb-Vertrags liegt, wirkt auf die **Farbe** (§4b), nicht auf die Anordnung.

### 4b. Farbregel

**Regel: Die Statusfarbe erscheint als Punkt, Rand oder Beistrich neben dem Text — niemals als
Hintergrundfläche des Textes. Das Textlabel ist Pflicht (zweiter Kanal, WCAG 1.4.1).**

Zwei belegte Gründe, warum „Statusfarbe als Fläche" aus dem Elternticket eine begründete
Entscheidung zurückdrehen würde:

1. `components/StatusTag.tsx:26-31` verwirft antds Vollflächen-`color` **ausdrücklich**: ein
   Nicht-Preset-Wert rendert als Fläche mit erzwungen weißem Text, und im Dunkelmodus sind die
   Rollenfarben aufgehellt — Weiß darauf ist unlesbar.
2. **Vertragsgrenze.** Für Fahrzeug und Personal liegt die Statusfarbe gar nicht im
   Rollenvertrag, sondern als **ungeprüfter Freitext** `status_farbe` in der DB
   (`theme/statusFarben.ts:28-41`). Eine Flächenvorschrift schriebe unvalidierte
   Mandantenfarben auf große Flächen; Kontrast (WCAG 1.4.11) ist dort **nicht** zugesichert.
   Auf einem Punkt oder Rand trägt die Farbe keine Textlesbarkeit — genau deshalb ist das die
   zulässige Form.

---

## 5. Festlegung Z3 — der Auslöser-Slot

**Regel: Es wird KEIN zweiter Primäraktions-Slot geschaffen. Der Auslöser ist die
Statusanzeige selbst.**

`Datensicht.tsx:193-200` sichert genau **eine** Primäraktion zu, und dieser Slot ist auf allen
drei Seiten mit „Entfernen" belegt. Die Annahme der Drawer-Spec, der Auslöser passe dorthin,
geht deshalb nicht auf — und die Antwort ist nicht, den Slot zu verdoppeln, sondern ihn nicht
zu brauchen: bedient wird an der Stelle, an der der Status **schon steht**.

Die Änderung am Primitiv, die LFH-339/C4 dafür braucht, sitzt damit am **`status`-Slot**
(`StatusDarstellung` bekommt einen optionalen Bedien-Weg), nicht am `aktion`-Slot. Das ist die
ehrliche Fassung: es braucht eine Primitiv-Erweiterung — aber eine, die die
Ein-Aktion-Zusicherung unangetastet lässt.

---

## 6. Die zwei Eigenwidersprüche — aufgelöst, nicht umbenannt

Das Elternticket schreibt einen „read-only Quick-View + Statuswahl" vor. Beide dort benannten
Widersprüche **entfallen mit Z2**, weil kein Drawer entsteht:

- **(a)** „read-only Vorschau **ODER** Schnellerfassung" (`drawer-nutzung-reduzieren-design.md:61`)
  ist die wörtliche LFH-19-Definition; ein Quick-View mit Bedienfeld verletzt sie. Statt den
  Fall zu „Vorschau + genau EIN Bedienfeld" umzubenennen — also eine dritte Drawer-Art zu
  erfinden — entfällt er: der Statuswechsel bleibt am Ort und braucht keine Vorschau.
- **(b)** Ein neuer Inhalts-Drawer läuft der Reduktionsabsicht von LFH-19 entgegen. Auch das
  entfällt. Die Zahl der Inhalts-Drawer steigt durch diese Festlegung **nicht**.

Das ist der eigentliche Gewinn der gewählten Zielform: sie löst zwei Widersprüche, indem sie
die Fläche nicht braucht, die sie erzeugt hätte.

---

## 7. Was diese Festlegung NICHT tut

- **Kein Umbau.** Der Statuswechsel läuft weiter über das `<Select>` in der Zelle. Träger wird
  er in **LFH-339/C4**; diese Spec ist dessen Grundlage.
- **Keine neue Prüfliste Einsatztauglichkeit.** Die drei Seiten stehen bereits in
  `2026-07-28-einsatzlisten-pruefliste.md`; B5i ist eines von elf Bündeln (B5a–B5k) und löst
  nur das ein, was hier steht. Die dortigen Zeilen Z1/Z2/Z9/Z14/Z15 bleiben offen und behalten
  ihr Zielticket — geprüft, nicht stillschweigend übergangen.
- **Kein Bestands-Sweep an den zwei Umbenenner-Stellen.** `GefahrenPage.tsx:135` und
  `lagekarte/Sidebar.tsx:532` bleiben, wie sie sind (§1, erste Zeile).

---

## 8. Referenzen

- `frontend/src/components/BemerkungZelle.tsx` (+ Test) · `components/Datensicht.tsx:193-200/234-239`
- `frontend/src/pages/FahrzeugePage.tsx:403` · `PersonalPage.tsx:315` · `MaterialPage.tsx:238`
- `frontend/src/theme/tokens.ts:143-160` (Dichte-Staffel) · `theme/statusFarben.ts:28-41` ·
  `components/StatusTag.tsx:26-31`
- `migrations/0008:22-36` (FMS 0–9) · `migrations/0012:18-30` (Personal) ·
  `frontend/src/stammdaten/StatusKatalogTab.test.tsx:181` (`fms_anker` nullable)
- `docs/superpowers/specs/2026-06-22-drawer-nutzung-reduzieren-design.md:61/102-106` ·
  `2026-07-25-bedien-leitlinie-einsatzkontexte.md` · `2026-07-28-einsatzlisten-pruefliste.md`
