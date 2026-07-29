# Datenzustands-Primitive — Laden, Fehler und Leerzustand unterscheidbar machen (LFH-331 · B3)

Dieses Dokument ist die **Entscheidungsgrundlage** des Tickets. Es entstand, weil LFH-331 vor
dem Merge von A2 (LFH-328), B1 (LFH-329) und B2 (LFH-330) geschrieben wurde und deshalb an
mehreren Stellen einen Ist-Zustand annimmt, den es nicht mehr gibt. Gemessen wurde am
2026-07-29 gegen `ae639e1`.

Die Ticketbeschreibung bleibt als Befundlage gültig — **die Zahlen und Zeilennummern darin sind
es nicht.** Wo dieses Dokument dem Ticket widerspricht, gilt dieses Dokument; jede Abweichung
steht unten mit Beleg.

---

## 1. Was das Ticket annahm und was der Code sagt

| Ticket | Gemessen |
| --- | --- |
| `components/LadeFehler.tsx` **neu anlegen** | `components/SeitenZustand.tsx` (LFH-328/A2) hat `SeitenFehler` mit Wiederhol-Knopf, 9 Konsumenten. Sein Dateikopf (`:17-25`) benennt **B3 namentlich** als das Ticket, das den Umbau zu Ende führt. |
| `components/KatalogTabelle.tsx` **neu anlegen** | Existiert seit B1, erweitert von B2. 21 Aufrufstellen, Guard-Test mit 631 Zeilen, 18 Verhaltenstests. |
| „11 Katalog-Tabellen + `BenutzerPage`" | **13 Kataloge** — `BenutzerPage` *ist* einer davon. 10 Stammdaten-Reiter + 2 Karten-Sektionen + `BenutzerPage`. |
| `<Result>`-Ausgangslage **0** im Frontend | **1**: `components/Platzhalter.tsx:47`. |
| 7 Kachel-Dateien im Lage-Dashboard | Diese Dateien haben **nie existiert**. Es sind 6 Inline-Kacheln in `LageDashboardPage.tsx`. |
| Kacheln brauchen `laedt: boolean` | Sie tragen bereits `zustand: Datenzustand` (`'daten' \| 'laden' \| 'fehler' \| 'leer'`, `lagebild.ts:44`). `laedt: boolean` wäre ein **Rückschritt**. |
| „0/0/0//0" steht im DOM | Nur noch in totem Code (`lagebild.ts:329`, `leeresLagebild` ohne Aufrufer). |
| 13 Domänen-Queries der Lagekarte | **15** `useQuery` in `pages/lagekarte/useLagekarteDaten.ts:63-119`. Pfad ist `pages/lagekarte/`, nicht `lagekarte/`. |
| A1 legt den Wortlaut fest | Tut sie **nicht**. Die A1-Spec liefert Gate 7 (Prüfliste), keinen Wortlaut-Abschnitt. Der Wortlaut wird **hier** festgelegt (§3). |

Sämtliche Zeilennummern des Tickets sind veraltet. Die geltenden stehen in §5.

---

## 2. Die sieben Festlegungen

### D1 — Ein Fehler-Primitiv, kein zweites

`components/SeitenZustand.tsx` wird **erweitert**. Es entstehen **keine** Dateien `LadeFehler.tsx`
und `LeerZustand.tsx`.

Begründung: eine zweite Inline-Fehler-mit-Wiederholung neben `SeitenFehler` zu stellen ist exakt
Befund **M32** („kein geteiltes Fehler-Primitive"), den dieses Ticket beheben soll — nur mit einer
Datei mehr. Der Dateikopf von `SeitenZustand.tsx` hat B3 als seine Fortsetzung benannt; das ist
eine Zusage, die eingelöst und nicht umgangen wird.

Was entsteht:

- `SeitenFehler` bekommt `ursache?: unknown` und eine exportierte reine Hilfsfunktion
  `ursacheText(ursache)`. Sie bildet **nur** `ApiError` auf eine Detailzeile ab; alles andere auf
  `undefined`. Das ist byte-genau das Verhalten der fünf handgerollten Kopien, die sie ablöst —
  keine Verbesserung nebenbei, damit der Umzug nachweisbar verhaltensgleich ist.
- `SeitenLeer` — **neu**, Vertrag in D2.
- `SeitenSackgasse` — **neu**, die `Result`-Großform. **Genau ein** Konsument:
  `einsatz/EinsatzLayout.tsx`. Der Rückweg-Typ wird aus `components/Platzhalter.tsx` importiert
  (`PlatzhalterRueckweg`), nicht ein zweites Mal derselben Gestalt angelegt.
- `SeitenStandVeraltet` — **neu**. Siehe D5.
- `nichtGefundenInhalt(query, { kein403?, allgemein })` — **neu**, kapselt die 403-Unterscheidung
  für `notFoundContent`/`placeholder`.

`components/Platzhalter.tsx` bleibt unangetastet: es bedeutet „geplant, noch nicht bedienbar",
nicht „leer". Zwei verschiedene Tatsachen, zwei Bausteine.

**Ein Primitiv ohne Konsumenten ist kein Primitiv.** `ursacheText` und `SeitenFehler.ursache`
gehen im **selben Commit** mit ihren fünf Konsumenten (§5, Commit 1). Ein Baustein, der mit null
Aufrufern merged, ist M32 in neuer Form.

### D2 — `SeitenLeer` ist eine zentrierte Box, kein `Empty`, kein `Result`, kein `Alert`

**Vertrag** (verbindlich, alle Bündel bauen gegen diesen):

```ts
export interface SeitenLeerAktion {
  label: string;
  /** Zielpfad — gebaut vom Aufrufer über `routing/deeplinks.ts`. */
  pfad?: string;
  /** Alternativ: lokale Handlung (Drawer/Modal öffnen), wo es keine Route gibt. */
  onClick?: () => void;
}

export interface SeitenLeerProps {
  titel: string;
  hinweis?: string;
  /** Höchstens EINE Aktion — strukturell durch den Slot erzwungen, nicht durch Policing. */
  aktion?: SeitenLeerAktion;
}
```

`titel` ist **Pflicht**. Ein Leerzustand ohne Aussage ist der Zustand, den dieses Ticket abschafft.

**Markup: die zentrierte Box aus `components/Liste.tsx:83-94`.** Nicht antds `<Empty>`, nicht
`Result`, nicht `Alert`. Drei Gründe, jeder gemessen:

1. antds `<Empty>` trägt das Token `<Empty`, das AK3 zählt (§4). Mit ihm wäre AK3 „= 0"
   unerfüllbar und müsste umgeschrieben werden — die Box hält es wörtlich erfüllbar.
2. `Result` (Vorbild `Platzhalter`) ist für eine 360-px-Karte zu groß.
3. `Alert` mit `action`-Slot ist im Bestand das **Fehler**-Idiom. Eine leere Liste ist keine
   Meldung.

Nebeneffekt, der die Zusicherung erst tragfähig macht: die Box steuert **null** eigene Knöpfe bei.
Damit belegt `getAllByRole('button')).toHaveLength(1)` tatsächlich „genau ein Primärknopf" — mit
antds `Empty` wäre die Zahl nicht mehr eindeutig einem Slot zuzuordnen.

**`SeitenLeer` bekommt kein `role`.** Gemessen: die `role="region"`-Knoten im Frontend gehören
`components/Datensicht.tsx` (Namen „Befehle", „Lageberichte", „Fahrzeuge im Einsatz"), der
Leerzustand in `Liste.tsx:83-94` hat heute keins. Tests auf den Leerzustand ankern deshalb auf dem
**sichtbaren Text**, nie auf der Knotenform — sonst sind sie unter jeder Markup-Wahl trivial grün.

Farbwerte kommen aus `theme/tokens.ts`. `.lfh-leer`/`.lfh-fehler` aus `theme/sprache.css` sind als
Markup **gesperrt**: ihr Knopf ist ein rohes `<button className="lfh-knopf">` mit eigener
Pixelhöhe und umgeht die Dichte-Staffel am `ConfigProvider` (A1 Gate 4). Die Begründung steht
bereits in `SeitenZustand.tsx:70-76` und gilt unverändert.

### D3 — Der Listenfehler wird an der Seite getauscht, nicht durch das Primitiv geroutet

```
query.isError && anzahl === 0 ? <SeitenFehler … /> : <Primitiv … />
```

**`KatalogTabelle` bekommt kein `fehler`-Prop.** Das ist die tragende Entscheidung und sie ist
gemessen, nicht Geschmack:

`components/Datensicht.tsx` führt den Tabellenzweig nach `KatalogTabelle` (`:1158-1163`), den
**Kartenzweig aber nach `Liste`** (`:1322-1333`). `ListeProps` (`Liste.tsx:38-51`) kennt
`loading` und `emptyText` — **keinen Fehlerbegriff**. Ein `fehler`-Durchreicher wirkte damit unter
`form="tabelle"` und täte unter `form="auto"` unterhalb `md` **nichts**. Zwei Wahrheiten für
dieselbe Sache — genau die Bauform, gegen die dieses Repo Guards schreibt.

Folge: **null Änderung** an `Datensicht.tsx`, `Liste.tsx` und `KatalogTabelle.tsx` an der
Fehlerachse. Und das Kern-AK fällt mechanisch heraus: das Leertext-Literal *kann* im Fehlerfall
nicht im DOM stehen, weil die Komponente nicht montiert ist.

Das ist **keine** Abweichung von der Entscheidung „`dataSource` bleibt `dataSource`" — die verbot
eine `query`-Prop und die Migration der 21 Aufrufstellen. Sie verlangte nirgends, dass jede Seite
ihren Fehler durch das Primitiv führt.

**Zwei Ebenen, namentlich getrennt** — ohne diese Trennung entsteht doppelte Zustandslogik:

- **Seitenzustand**: nur die Query, die der Seitenrahmen selbst braucht — überall `einsatzQuery`,
  weil Breadcrumb und `darfImEinsatzSchreiben(...)` ohne sie nicht rendern können. Frühausstieg
  mit `SeitenSkeleton`/`SeitenFehler`.
- **Listenzustand**: alles andere, entschieden an der Stelle der Liste, **nie** als Frühausstieg.

Deshalb werden `pages/UnfallhilfsstellenPage.tsx:53` (`uhsQuery.isLoading` im Seitenguard) und
`pages/bereitstellungsraum/BereitstellungsraeumePage.tsx:74` (`brQuery.isLoading`) korrigiert —
nicht als zwei Einzelpatches, sondern als Folge der Regel.

Ein Helfer `listenZustand` entsteht **nur für die zwei Baum-Karten** (`EinsatzabschnittePage`,
`EinheitenPage`), die gar kein Listen-Primitiv haben, sondern ein handgerolltes `length === 0` in
einer `Card` — das ist auch während des Ladens und im Fehlerfall wahr und ist der eigentliche
Drei-Zustands-Bug. Wo `Datensicht`/`KatalogTabelle` `ladend`/`leerText` bereits besitzen, fehlt
**nur** der Fehlerzweig; dort wäre ein zusätzlicher Lade-/Leerzweig an der Seite die doppelte
Logik.

### D4 — Die Ladeunterdrückung des Leerknotens lebt an genau einer Stelle

Regel: **solange geladen wird, wird nichts über die Menge behauptet.** Vorbild ist
`Liste.tsx:83` (`const leer = loading ? null : …`), das seit je so gebaut ist.

Für Tabellen gilt sie in `KatalogTabelle` — dort laufen alle 19 Aufrufstellen durch. Kein Bündel
baut sie ein zweites Mal an einer Seite nach. Wo eine Seite den Leerknoten selbst zusammensetzt
(ETB), unterdrückt sie ihn zusätzlich im **Fehler**fall; das ist der Teil, den die zentrale Regel
nicht abdeckt.

### D5 — „Veralteter Stand" ist `isError` **mit** Daten — nicht `isFetching`, nicht `isStale`

Das Ticket nennt `isFetching`/`isStale`. Beide sind gemessen untauglich:

- `isStale`: `main.tsx:25` setzt `staleTime: 10_000` — ein Banner daran wäre zehn Sekunden nach
  jedem Abruf dauerhaft an. `test/utils.tsx:14` setzt gar kein `staleTime` (Default 0) — das
  Banner wäre in **jedem** Test sofort sichtbar und jede Zusicherung darauf wertlos.
- `isFetching && !isLoading`: die betroffenen Seiten hängen am konsolidierten SSE-Fan-out. Ein
  Banner, das bei jeder Invalidierung ein- und ausblendet, erzeugt genau den Layoutsprung, gegen
  den Prüflisten-Kriterium 12 (CLS ≤ 0,1) existiert.

Gebaut wird der eine Fall, der operativ zählt und stabil steht: **Aktualisierung gescheitert,
Zeilen im Cache sind alt** → `SeitenStandVeraltet` mit „Erneut abrufen". Ohne Zeitstempel: ein
„Stand von HH:MM" koppelte das Primitiv an `AnzeigeKonventionenContext` und trüge die aus LFH-318
bekannte Zeitzonen-Falle in eine Komponente, die vier Seiten teilen. Nachrüsten bleibt additiv
möglich.

### D6 — Wortlaut

Der Wiederhol-Knopf heißt überall **„Erneut abrufen"**. Nicht „Erneut versuchen" (so das Ticket),
nicht „Wiederholen".

Begründung: der Text steht in `SeitenZustand.tsx:83` und ist in `components/SeitenZustand.test.tsx:55`
und `pages/EinsaetzePage.test.tsx:163` gepinnt. Eine zweite Schreibweise für dieselbe Geste ist
derselbe Befund, den dieses Ticket behebt. Die vier abweichenden Stellen
(`pages/SchaedenDetailPage.tsx:135`, `pages/TiereDetailPage.tsx:151`,
`pages/PersonenDetailPage.tsx:261`, `personen/PersonDetailDrawer.tsx:50`) werden angeglichen und
ihre gepinnten Tests mitgezogen — im selben Commit, der `ursacheText` einführt.

Kein weiterer Wortlaut wird zentral vorgeschrieben. Wo ein Leertext bereits existiert, bleibt er
**byte-gleich** (z. B. „Noch keine Unfallhilfsstellen erfasst" aus `UnfallhilfsstellenDefault.tsx:51`,
das `UnfallhilfsstellenPage` übernimmt statt eine zweite Formulierung zu erfinden). Test-Eindeutigkeit
wird über `within(...)` hergestellt, nicht über abweichende Strings.

### D7 — Das Lage-Dashboard gilt als umgesetzt, aber nicht als geprüft

`pages/lage-dashboard/` trägt die Weiche bereits (`zustandVon`, `zustand: Datenzustand`, der
`Datenzustand`-Typ in `lagebild.ts:44`). Das Ticket-Prop `laedt: boolean` wird **nicht** gebaut.

Es bleiben drei Posten:

- **R1** — die Kennzahlenleiste hat keinen Ladezustand: `(lagebild?.kennzahlen ?? []).map` rendert
  während `einsatzQuery` lädt **null** Knöpfe, danach springen sechs herein; die pro-Kennzahl-Weiche
  „····"/„?" greift nie. Sechs Skelett-Platzhalter aus den festen Etiketten (`lagebild.ts:224-244`,
  von zwei Tests gepinnt) reservieren die Höhe — Prüflisten-Kriterium 12, CLS ≤ 0,1.
- **R2** — der Einsatzname im Band zeigt beim Laden „—", was auch der Fehlerfall zeigt. Eigener
  Ladewortlaut.
- **R3** — die Seite ist AK4-**Pflichtstelle** und hat beide Zustände im Code (`.lfh-fehler` mit
  „Erneut abrufen", `.lfh-leer`), aber **kein Partnerpaar im Test**. Dass die Umsetzung stand,
  hieß nie, dass sie belegt war.

Nicht gebaut wird die Umstellung `zustandVon` von `isLoading` auf `isPending`: in jsdom fallen
beide Flags zusammen, die Änderung wäre im Testharness prinzipiell unbeobachtbar. Eine ungeprüfte
Verhaltensänderung an 12 Konsumenten ist den Nutzen nicht wert.

Der letzte rohe `<button className="lfh-knopf">` (A1 Gate 4) bleibt auf dieser Seite stehen und
gehört nach **B5 (LFH-333, Touch-/Dichte-Politik)**, nicht hierher.

---

## 3. Zwei Fallen, die dieses Repo schon einmal getreten hat

**F1 — Kommentare füllen Grep-Gates.** Die Akzeptanzkriterien sind Greps. `grep "<Empty"` zählt
den **Kommentar** in `components/Liste.tsx:80` mit; `grep -c "?? \[\]"` zählt ein „hier stand
früher `?? []`" mit. Verbotene Konstrukte werden **umgeschrieben, nicht zitiert** — auch nicht in
begründenden Dateiköpfen. Das gilt ausdrücklich für den neuen Kopfabschnitt in `SeitenZustand.tsx`.

**F2 — Vacuous Assertions.** Eine Zusicherung „X nicht im DOM" ist wertlos, wenn X im selben
Umbau umformuliert wurde. **Jede** solche Assertion braucht eine Partnerassertion „X **ist** im
DOM bei `isSuccess && leer`" — gleiches String-Literal, gleiche Datei.

Und der ehrliche Zusatz dazu: unter D3 ist die Negativhälfte an den Seiten **strukturell** wahr,
weil die Komponente im Fehlerfall nicht montiert ist. Die Seitenpaare sind damit
**Regressionsklammern, keine Nachweise**. Die AK4-Beweiskraft liegt im Primitivtest
(`listenZustand` bzw. `SeitenLeer`/`SeitenFehler`) — das steht so in der Prüfliste, sonst gelten
die Klammern als AK-Erfüllung und das Kriterium ist unerfüllt, während es grün aussieht.

---

## 4. Akzeptanzkriterien — kanonische Fassung

Die Fassung im Ticket ist an vier Stellen faktisch falsch. Dies ist die geltende:

| # | Kriterium | Änderung gegenüber Ticket |
| --- | --- | --- |
| **AK1** | Jede der **13** Katalogtabellen behandelt den Fehlerfall sichtbar: `query.isError` führt zu `SeitenFehler`, nicht zu einer leeren Tabelle mit Leertext. Nachgewiesen je Datei. | **Verschärft.** Original: „≥ 1 `isError`-Treffer **bzw. die Datei nutzt `KatalogTabelle`**". Die zweite Hälfte ist seit B2 für alle 13 wahr — das Kriterium war bereits grün und belegte nichts. Die Ausweichklausel entfällt. Zahl 11 → 13. |
| **AK2** | `grep -rn "<Result" frontend/src` liefert einen Treffer in `einsatz/EinsatzLayout.tsx` bzw. in dem Primitiv, das es rendert. | **Ausgangslage korrigiert:** nicht 0, sondern **1** (`components/Platzhalter.tsx:47`). |
| **AK3** | `grep -rn "<Empty" --include="*.tsx" frontend/src \| grep -v .test.` = **0**. Jeder gerenderte Leerzustand trägt höchstens einen Primärbutton. | **Erfüllbar gehalten** durch D2 (`SeitenLeer` ohne antds `Empty`). „genau einen" → „höchstens einen": drei der 14 Stellen sind gar keine Leerzustände (§5, Commit 6). |
| **AK4** | Vitest belegt je Pflichtstelle, dass Fehler und Leer unterscheidbar rendern — mit **Partnerassertion** (F2). Pflichtstellen: `LageDashboardPage`, `PersonenPage`, `EinsatzabschnittePage`, `LagekartePage`, `KatalogTabelle`, `EinsatzLayout`. | **Wortlaut angeglichen** („Erneut abrufen", D6). Beweiskraft liegt im Primitivtest, nicht in den Seitenklammern (§3/F2). |
| **AK5** | Kein Leerzustand entsteht aus `data ?? []` ohne `isSuccess`. Auf `LageDashboardPage` zusätzlich: bei `isPending` keine Nullwerte im DOM, sondern Skelette. | **Ersetzt** `grep -c "?? \[\]" = 0`. Der reine Grep ist weder prüfbar noch richtig: `EtbPage.tsx:53` braucht ein Array für `dataSource`. Der Fehler war nie das leere Array, sondern das fehlende Lade-/Fehler-Gate daneben. |
| **AK6** | `LagekartePage`: bei Fehler einer Domänen-Query nennt das Warn-Overlay die Quelle namentlich und trägt **keinen** Schließen-Knopf. | **Prüfbar gemacht.** „bleibt nach einem Klick stehen" ist nicht widerlegbar — es gibt keinen Codepfad, der es entfernen könnte. Die Abwesenheit des Schließen-Knopfes ist der echte Schutz gegen ein später nachgerüstetes `closable`. |
| **AK7** | `./scripts/check-all.sh` grün, insbesondere `pnpm lint` mit `--max-warnings 0`. | unverändert |
| **AK8** | Prüfliste Einsatztauglichkeit (15 Zeilen, je ein Verdikt) liegt vor. | **Neu.** Gate 7 der Bedien-Leitlinie ist Fertigstellungsbedingung laut `CLAUDE.md`; das Ticket hatte sie vergessen. Format nach dem B1/B2-Muster (`2026-07-28-*-pruefliste.md`). |

---

## 5. Commit-Reihenfolge

Sieben Bündel. Bündel 1 geht zuerst und allein — alles andere konsumiert es.

**1 · Primitiv** — `components/SeitenZustand.tsx`: `ursacheText`, `ursache` an `SeitenFehler`,
`SeitenLeer`, `SeitenSackgasse`, `SeitenStandVeraltet`, `nichtGefundenInhalt`. **Mit** den fünf
`instanceof ApiError`-Konsumenten (`SchaedenDetailPage:130-136`, `TiereDetailPage:146-152`,
`PersonenDetailPage:256-262`, `PersonDetailDrawer:44-52`, `karten/OnlineQuellenVerwaltung:157-164`)
und den vier Wortlaut-Angleichungen aus D6. Dateikopf fortschreiben — F1 beachten.

**2 · Die 13 Katalogtabellen** (AK1) — je ein Seiten-Swap nach D3. Zielmenge ist `KATALOGE` aus
`components/katalogTabelle.guard.test.ts`: die 10 Stammdaten-Reiter, `karten/OnlineQuellenVerwaltung`,
`karten/OfflineKartenVerwaltung`, `pages/BenutzerPage.tsx`. Die beiden Karten-Sektionen behandeln
den Fehler heute schon als Geschwister-`Alert` — dort ist es ein **Rückbau** auf das Primitiv, und
ihre Meldungstexte werden übernommen, sonst ist der Umbau dort eine Verschlechterung.

**3 · Lagekarte** — zuerst die Testschuld: `pages/lagekarte/LagekartePage.test.tsx:241`
(`basisHandler`) fehlen drei MSW-Handler (`gefahrengebiete`, `einstellungen`, `lage-snapshots`).
Eigener, erster Commit — sonst ist ein rot gewordener Test nicht von der Altlast zu unterscheiden.
Dann `fehlerhafteQuellen` aus dem benannten Quellenkatalog, das Warn-Overlay, die Sidebar-Slots,
`<Spin>` → `SeitenSkeleton`.

**4 · Lage-Dashboard (R1–R3) und `EinsatzLayout`** — der Dashboard-Teil ist unabhängig, der
Layout-Teil braucht `SeitenSackgasse` aus 1. Beim Layout gilt: früher Return **vor** dem Haupt-JSX,
sonst liest die Kindseite im `Outlet` dieselbe kaputte Query aus demselben Cache und zeigt eine
zweite, konkurrierende Fehlermeldung. Der Navigations-Drawer wird bewusst erst beim Öffnen
gerendert (kein `forceRender`) — der frühe Return darf die Prüfung „unter `lg` nicht im Layout"
nicht bedeutungslos machen.

**5 · Modulseiten** — Kräfte (`FahrzeugePage`, `PersonalPage`, `MaterialPage`, `EinheitenPage`),
Betroffene (`PersonenPage`, `TierePage`, `SchaedenPage`), Gliederung (`EinsatzabschnittePage`,
`UnfallhilfsstellenPage`, `BereitstellungsraeumePage`). Der größte Brocken, trägt die
AK4-Pflichtstellen `PersonenPage` und `EinsatzabschnittePage`.

Zur 403-Weiche: sie ist an **fünf von sechs** Stellen nicht anwendbar, und das ist am Backend
gemessen — `src/routes/fahrzeug.rs:234`, `personal.rs:178`, `material.rs:141`,
`fahrzeug_status.rs:147`, `personal_status.rs:120`, `einheit_typ.rs:148` sind alle org-lesbar. Nur
`src/routes/benutzer.rs:64` trägt `_admin: AdminUser`. Deshalb steht die Weiche heute
ausschließlich in `MitgliederAbschnitt.tsx:104-110`, und `kein403` bleibt am Helfer **optional**
und wird an den Kräfte-Selects weggelassen. Wer dem Fahrzeug-Pool ein erfundenes „nur für
Admins" anhängt, erfindet einen Fehlerfall, den das Backend nicht kennt.

**6 · Leerzustände** — die 14 `<Empty>`-Stellen. Sie sind **nicht** alle Leerzustände:
`EinsatzabschnittePage:224` („Wähle einen Abschnitt im Baum") und `EinheitenPage:255` („Wähle eine
Einheit im Baum") sind **Aufforderungen bei fehlender Auswahl**, `lagekarte/Sidebar.tsx:189`
(„Alles verortet") ist ein **Erfolgszustand**. Alle drei bekommen keine Primäraktion. Die beiden
Gliederungs-Karten (`:215`, `:242`) gehören Bündel 5, nicht diesem — dort ersetzt der
`listenZustand`-Helfer die ganze Weiche.

Zur Aktion: das Ticket verlangt das Ziel aus `routing/deeplinks.ts`. Gemessen bieten nur **drei**
Builder `neu?: boolean` (`personenPfad`, `schaedenPfad`, `etbPfad`), gelesen wird `?neu=1` von
**vier** Seiten, und die Referenzstelle des Tickets (`UnfallhilfsstellenDefault.tsx:51-53`) öffnet
ihren Drawer über lokales `setAnlegen(true)` — ganz ohne URL. Ein Pflicht-`pfad` wäre deshalb
unehrlich; der Vertrag ist die Union aus D2. Die Regel bleibt trotzdem prüfbar: **wo ein Pfad
gesetzt wird, stammt er aus `deeplinks.ts`** — kein Inline-Template-Literal.

Zwei gemessene Registry-Inkonsistenzen werden mitgenommen:
`unfallhilfsstellenListePfad:74-76` nimmt keine `opts`, obwohl die Seite `?neu=1` liest; und
`befehle.ts:65` baut `?neu=1` als Inline-Template-Literal an der Registry vorbei, obwohl
`CLAUDE.md` sie zur Quelle der Wahrheit erklärt.

**7 · ETB und Prüfliste** — `etb/EtbTabelle.tsx`, `pages/EtbPage.tsx`, `etb/EtbFilterleiste.tsx`
(drei Dateien, nicht zwei: ohne die Filterleiste ist „Filter zurücksetzen" nicht baubar — sie hält
eine eigene Kopie des Filters und ihre Felder sind unkontrolliert). Der Zustandsraum ist
**vierteilig**: laden / Fehler / leer-ohne-Filter / leer-mit-Filter. Reset per Remount (`key`),
nicht kontrolliert: die Umkehr der `DatePicker`-Zeitwandlung hat als Fehlermodus eine **stille**
Verschiebung um den Zonenversatz — kein roter Test, nur ein falscher Zeitraum in der
Führungsunterlage. Dazu die Rechte-Weiche: ohne `darfSchreiben` wird die Erfassungsleiste gar
nicht gerendert (`EtbPage.tsx:174`), ein Fokussprung zeigte auf einen Knoten, den es nicht gibt.

Zuletzt die Prüfliste Einsatztauglichkeit (AK8) nach dem Muster von
`2026-07-28-katalogtabellen-pruefliste.md` — eine Tabelle für die formgleiche Familie, nicht
fünfzehnmal.
