// frontend/src/command-palette/useDatensaetze.ts
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { einsatzKeys } from '../api/queryKeys';
import { ladeModulOverrides } from '../api/einsaetze';
import { listePersonen } from '../api/einsatzPerson';
import { listeSchaeden } from '../api/einsatzSchaden';
import { listeUhs } from '../api/einsatzUhs';
import { listeMeldungen } from '../api/meldungen';
import { listeAuftraege } from '../api/auftraege';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinheiten } from '../api/einheiten';
import { listeEtb } from '../api/etb';
import { istModulFreigegeben, modulRegistry } from '../einsatz/modulRegistry';
import {
  baueDatensatzTreffer,
  etbVolltextMoeglich,
  zahlAusSuche,
  type DatensatzQuellen,
} from './datensaetze';
import type { Treffer } from './fuzzy';
import {
  DATENSATZ_MINDESTZEICHEN,
  PALETTE_MODI,
  QUELLE_MODUL,
  modusZeigtDatensaetze,
  type DatensatzQuelle,
  type PaletteModus,
} from './typen';

/**
 * Die BESCHAFFUNG des Datensatz-Finders (LFH-391 · C2) — der Gegenpart zum reinen Kern in
 * `datensaetze.ts`, der aus den hier geholten Listen die Treffer macht.
 *
 * ALLES IST LAZY, und das ist keine Sparsamkeit, sondern die Bedingung dafür, dass die
 * Palette überhaupt eine Datenquelle bekommen darf: sie rendert ihren Inhalt erst beim
 * Öffnen (`{offen && <PaletteHost/>}` in `CommandPaletteProvider.tsx`), jede hier angehängte
 * Query feuert also im Moment des Tastendrucks. Warm sind ohne Zutun nur `meldungen` und
 * `auftraege` (die Modulzähler im `EinsatzLayout`); auf jeder anderen Modulseite wären es
 * bis zu neun kalte Abrufe für eine Palette, die vielleicht nur „Dunkel" sucht.
 *
 * MUSTER ist `pages/ChatPage.tsx` (Sachbezug-Picker, dort mit derselben Begründung:
 * „vermeidet 6 eager Requests bei jedem Chat-Öffnen") — übernommen, nicht neu erfunden.
 *
 * VIER RIEGEL VOR JEDEM `enabled`, jeder mit einem eigenen Grund — die ersten drei gebündelt
 * in {@link datensatzAbrufAktiv}:
 *  1. **Einsatzkontext** — ohne `einsatzId` gibt es keine Liste.
 *  2. **Schwelle** — erst ab `DATENSATZ_MINDESTZEICHEN` Zeichen im REST hinter dem Präfix.
 *  3. **Modus** — der `>`-Modus zeigt nur Aktionen, '#' nur den ETB, '@' nur die vier
 *     Namensquellen; was der Modus nicht anzeigt, wird auch nicht geholt
 *     (`PALETTE_MODI[…].quellen`).
 *  4. **Recht** — `istModulFreigegeben` JE MODUL, siehe unten.
 *
 * DIE ENTPRELLUNG LIEGT NICHT HIER. Der Hook bekommt einen bereits entprellten Rest; die
 * Frist gehört ans Eingabefeld, weil nur dort die zwei Achsen unterscheidbar sind — der
 * sichtbare Text und der Fuzzy-Filter über die statischen Befehle sind kostenlos und müssen
 * SOFORT reagieren, nur die Meldung nach aussen wartet. Bauform und Wert stehen in
 * `etb/EtbFilterleiste.tsx` (`ENTPRELLUNG_MS = 300` samt `clearTimeout` im Abbau-Effekt);
 * ein zweiter Entprellungsmechanismus wäre eine zweite Wahrheit.
 *
 * KEINE ADRESSE ENTSTEHT HIER VON HAND — `routing/inlinePfade.guard.test.ts` ist auf
 * `command-palette/` gescopt und trifft mit `/einsaetze/<klammer>` auch API-Adressen. Jeder
 * Abruf läuft über die Clients in `api/*.ts`, jeder Schlüssel über `api/queryKeys.ts`.
 */

/**
 * Wie lange eine geholte Liste als frisch gilt.
 *
 * Deutlich über dem globalen Vorgabewert (10 s, `api/queryClient.ts`), und das ist keine
 * Nachlässigkeit: diese Fächer hängen am SSE-Fan-out (`EINSATZ_STREAM_EVENTS`), eine
 * Änderung erreicht sie also über die Invalidierung und nicht über das Ablaufen der Frist.
 * Ohne die längere Frist holte jedes Öffnen der Palette bis zu neun Listen neu, obwohl die
 * Modulseite daneben dieselben Daten gerade anzeigt.
 */
const FRISCH_MS = 60_000;

/** Trefferdeckel des ETB-Volltextzweigs — geht als `limit` MIT in den Request (5 statt 100). */
const ETB_TEXT_DECKEL = 5;

/**
 * Aufräumfrist der ETB-Suchfächer. Anders als die acht Listen bekommt der ETB JE SUCHBEGRIFF
 * ein eigenes Fach; ohne kurze Frist sammelte eine Suchsitzung sie über die Vorgabe von fünf
 * Minuten an. Die Frist gilt nur hier — die geteilten Listenfächer gehören auch anderen
 * Seiten, ein kurzes `gcTime` von der Palette aus räumte ihnen den Cache weg.
 */
const ETB_SUCH_GC_MS = 30_000;

export interface DatensatzAbruf {
  /** Aus dem Pfad gezogen; `null` ausserhalb eines Einsatzes. */
  einsatzId: number | null;
  modus: PaletteModus;
  /** Der Rest hinter dem Präfix, BEREITS ENTPRELLT — nicht die rohe Eingabe. */
  suche: string;
}

/**
 * Die drei Riegel vor jedem `enabled`, an EINER Stelle (LFH-391 · C3).
 *
 * Rein und exportiert, weil zwei Hooks sie brauchen: `useDatensaetze` für seine zehn Listen
 * UND `useDatensatzTreffer` für den Sichtbarkeits-Abruf darunter. Zwei Kopien wären zwei
 * Bedingungen, und die Overrides liefen dann in einem Zustand los, in dem keine einzige
 * Liste folgt — ein Request für eine Ansicht ohne Datensatzzeile.
 */
export function datensatzAbrufAktiv({ einsatzId, modus, suche }: DatensatzAbruf): boolean {
  return (
    einsatzId != null &&
    suche.trim().length >= DATENSATZ_MINDESTZEICHEN &&
    modusZeigtDatensaetze(modus)
  );
}

/**
 * Cache-Fach des ETB-Volltextzweigs.
 *
 * DAS `limit` IM SCHLÜSSEL IST DIE TRENNUNG, NICHT SCHMUCK: `pages/EtbPage.tsx` belegt
 * denselben Prefix `einsatzKeys.etbListe(einsatzId, filter)` mit einer `useInfiniteQuery`,
 * wobei `filter` aus `parseEtbFilter` kommt und deshalb NUR q/typ/von/bis tragen kann. Ohne
 * das `limit` wäre `{ q }` strukturgleich, beide Abfragen lägen in EINEM Fach — dort einmal
 * `{ pages, pageParams }` und einmal ein nacktes Array, und `data.pages.flat()` auf der
 * ETB-Seite liefe auf ein Array. Kein Guard sieht das, kein roter Test, kein Fehlerbild.
 *
 * Als Funktion exportiert, damit der Test auf die PRODUKTIVE Schlüsselbildung zeigt statt
 * sie nachzubauen — ein nachgebauter Schlüssel prüfte sich gegen sich selbst.
 */
export function etbSuchSchluessel(einsatzId: number, q: string) {
  return einsatzKeys.etbListe(einsatzId, { q, limit: ETB_TEXT_DECKEL });
}

/**
 * Cache-Fach des ETB-Zahlenzweigs. Ein Eintrag, ein Request: `before_lfd_nr` filtert strikt
 * `lfd_nr <` bei `ORDER BY lfd_nr DESC`, `n + 1` liefert also genau den Eintrag n — sofern es
 * ihn gibt. Ob die Antwort wirklich die gesuchte Nummer trägt, prüft der reine Kern
 * (`baueDatensatzTreffer`); bei einer Nummernlücke liefert der Cursor den nächstälteren.
 */
export function etbNummerSchluessel(einsatzId: number, nummer: number) {
  return einsatzKeys.etbListe(einsatzId, { before_lfd_nr: nummer + 1, limit: 1 });
}

/**
 * Holt die Listen, aus denen `baueDatensatzTreffer` seine Treffer baut.
 *
 * Rückgabe ist bewusst `DatensatzQuellen` und keine fertige Trefferliste: die Trennung
 * „Beschaffung hier, Entscheidung im reinen Kern" ist der Grund, warum die Fachaussagen
 * (Zahlenzweig, Rechte, Beschriftung, Deckel) ohne Netz, Mocks und Render prüfbar sind.
 */
export function useDatensaetze({ einsatzId, modus, suche }: DatensatzAbruf): DatensatzQuellen {
  const { benutzer } = useAuth();
  const rest = suche.trim();
  // `?? 0` ist nie eine echte Einsatz-id; der Schlüssel wird ohne Einsatz nie abgerufen,
  // weil `datensatzAbrufAktiv` dann false liefert. Ein nullbarer Schlüssel wie bei
  // `modulOverrides` ist hier nicht nötig — dieses Fach teilt es sich mit den Modulseiten.
  const id = einsatzId ?? 0;
  /**
   * Einsatzkontext, Schwelle und Modus in EINEM Riegel — er steht schon HIER und nicht erst
   * je Quelle, weil sonst der Sichtbarkeitsabruf darunter im `>`-Modus als einziger doch
   * noch liefe: ein Request für eine Ansicht ohne Datensatzzeile, gemessen beim Bauen.
   */
  const aktiv = datensatzAbrufAktiv({ einsatzId, modus, suche });
  /** Quellen dieses Modus; `null` = keine Einschränkung. */
  const erlaubterModus = PALETTE_MODI[modus].quellen;

  /**
   * Die Overrides tragen die Sichtbarkeitsachse und werden deshalb VOR den Listen geholt.
   *
   * Sie hängen an derselben Schwelle wie alles andere: ohne getippten Begriff schweigt der
   * Hook vollständig, und genau das hält die Bestands-Palettentests grün, die `useBefehle`
   * durch eine Attrappe ersetzen (dort gibt es keinen Handler für diesen Abruf). Im Betrieb
   * kostet das nichts — `useBefehle` fordert dasselbe Fach im Einsatzkontext ohnehin an,
   * TanStack führt beide Beobachter zusammen.
   */
  const overridesQuery = useQuery({
    queryKey: einsatzKeys.modulOverrides(einsatzId),
    queryFn: () => ladeModulOverrides(einsatzId!),
    enabled: aktiv,
    staleTime: FRISCH_MS,
  });

  /**
   * Erst wenn die Sichtbarkeit beantwortet ist, dürfen die Listen los. Ohne dieses Warten
   * liefen sie in der Ladelücke mit `overrides === undefined` — der Registry-Default sagt
   * dort „sichtbar", der Einsatz aber möglicherweise „ausgeblendet": ein Request, den es
   * nicht geben darf, und einer, der bei warmem Cache wieder verschwindet.
   *
   * `isFetched` statt `isSuccess`: ein Fehlschlag darf die Suche nicht dauerhaft stilllegen.
   * Dann gilt der Registry-Default — dieselbe Annahme, die `useBefehle` mit `overrides ===
   * undefined` ohnehin trifft.
   */
  const rechteBekannt = overridesQuery.isFetched;
  const overrides = overridesQuery.data;

  function darfLaden(quelle: DatensatzQuelle): boolean {
    if (!aktiv || !rechteBekannt) return false;
    if (erlaubterModus !== null && !erlaubterModus.includes(quelle)) return false;
    const eintrag = modulRegistry.find((m) => m.key === QUELLE_MODUL[quelle]);
    return eintrag != null && istModulFreigegeben(eintrag, benutzer, overrides);
  }

  /**
   * Die acht ungefilterten Listen hängen an den ARGUMENTLOSEN Bestands-Accessoren — genau
   * den Fächern, die `ChatPage`, `LageDashboardPage` und die Modulseiten selbst füllen. Die
   * Palette teilt sich den Cache mit ihnen, statt ein zweites Fach mit denselben Bytes
   * anzulegen; auf einer warmen Seite löst das Öffnen damit null zusätzliche Requests aus.
   * Deshalb auch kein Filterargument in den Abrufen: ein `?status=…` wäre ein eigenes Fach.
   */
  const personenQuery = useQuery({
    queryKey: einsatzKeys.personen(id),
    queryFn: () => listePersonen(id),
    enabled: darfLaden('personen'),
    staleTime: FRISCH_MS,
  });
  const schaedenQuery = useQuery({
    queryKey: einsatzKeys.schaeden(id),
    queryFn: () => listeSchaeden(id),
    enabled: darfLaden('schaeden'),
    staleTime: FRISCH_MS,
  });
  const uhsQuery = useQuery({
    queryKey: einsatzKeys.uhs(id),
    queryFn: () => listeUhs(id),
    enabled: darfLaden('uhs'),
    staleTime: FRISCH_MS,
  });
  const meldungenQuery = useQuery({
    queryKey: einsatzKeys.meldungen(id),
    queryFn: () => listeMeldungen(id),
    enabled: darfLaden('meldungen'),
    staleTime: FRISCH_MS,
  });
  const auftraegeQuery = useQuery({
    queryKey: einsatzKeys.auftraege(id),
    queryFn: () => listeAuftraege(id),
    enabled: darfLaden('auftraege'),
    staleTime: FRISCH_MS,
  });
  const fahrzeugeQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(id),
    queryFn: () => listeEinsatzFahrzeuge(id),
    enabled: darfLaden('fahrzeuge'),
    staleTime: FRISCH_MS,
  });
  const personalQuery = useQuery({
    queryKey: einsatzKeys.personal(id),
    queryFn: () => listeEinsatzPersonal(id),
    enabled: darfLaden('personal'),
    staleTime: FRISCH_MS,
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(id),
    queryFn: () => listeEinheiten(id),
    enabled: darfLaden('einheiten'),
    staleTime: FRISCH_MS,
  });

  /**
   * Der ETB ist die einzige serverseitig gefilterte Quelle — und die einzige mit ZWEI
   * Abfragewegen, die sich gegenseitig ausschliessen:
   *
   *  - eine gedruckte Kennung ('42', '#42') geht über den Cursor. Ein gebundener
   *    Sortenbuchstabe ('R-42' = Person, 'S-42' = Schaden) schliesst den ETB dagegen aus:
   *    dort ist die Sorte bereits beantwortet.
   *  - alles andere geht über den Volltext. NICHT beides: `fts_query` quotet jedes Token zu
   *    einer Phrase und sucht über inhalt/von/an/veranlassung, nicht über die laufende
   *    Nummer — '42' fände jeden Eintrag, in dessen Text die Zahl vorkommt.
   *
   * DRITTER RIEGEL AM VOLLTEXT (Review-Befund 6): eine Eingabe ohne ein einziges
   * alphanumerisches Token lässt `fts_query` leer laufen, und der Aufrufer im Backend nimmt
   * den MATCH-Filter dann GANZ heraus — die Antwort auf '??' waren gemessen die fünf
   * jüngsten Einträge, ungefiltert. Der Riegel steht im Frontend, weil die Route ihren
   * Vertrag hält: für die ETB-Seite (Blättern ohne Suchbegriff) ist genau das richtig.
   * Bedingung und Begründung liegen im reinen Kern, damit Abruf und Anzeige nicht zwei
   * Meinungen darüber haben, was der ETB beantworten kann.
   */
  const zahl = zahlAusSuche(rest);
  const nummerGesucht = zahl !== null && zahl.sorte === null ? zahl.nummer : null;

  const etbNummerQuery = useQuery({
    queryKey: etbNummerSchluessel(id, nummerGesucht ?? 0),
    queryFn: () => listeEtb(id, { before_lfd_nr: nummerGesucht! + 1, limit: 1 }),
    enabled: darfLaden('etbNummer') && nummerGesucht !== null,
    staleTime: FRISCH_MS,
    gcTime: ETB_SUCH_GC_MS,
  });
  const etbTextQuery = useQuery({
    queryKey: etbSuchSchluessel(id, rest),
    queryFn: () => listeEtb(id, { q: rest, limit: ETB_TEXT_DECKEL }),
    enabled: darfLaden('etbText') && zahl === null && etbVolltextMoeglich(rest),
    staleTime: FRISCH_MS,
    gcTime: ETB_SUCH_GC_MS,
  });

  /**
   * Über die zehn Datenreferenzen memoisiert, nicht je Render frisch gebaut: das Ergebnis
   * geht in ein `useMemo` des Aufrufers, und ein je Render neues Objekt machte das dort
   * wirkungslos.
   */
  return useMemo<DatensatzQuellen>(
    () => ({
      personen: personenQuery.data,
      schaeden: schaedenQuery.data,
      uhs: uhsQuery.data,
      meldungen: meldungenQuery.data,
      auftraege: auftraegeQuery.data,
      fahrzeuge: fahrzeugeQuery.data,
      personal: personalQuery.data,
      einheiten: einheitenQuery.data,
      etbNummer: etbNummerQuery.data,
      etbText: etbTextQuery.data,
    }),
    [
      personenQuery.data,
      schaedenQuery.data,
      uhsQuery.data,
      meldungenQuery.data,
      auftraegeQuery.data,
      fahrzeugeQuery.data,
      personalQuery.data,
      einheitenQuery.data,
      etbNummerQuery.data,
      etbTextQuery.data,
    ],
  );
}

/**
 * Beschaffung UND reiner Kern in einem Griff — das, was der `PaletteHost` wirklich braucht
 * (LFH-391 · C3).
 *
 * Er liegt HIER und nicht im Provider, aus einem gemessenen Grund: der reine Kern braucht
 * neben den Listen auch die SICHTBARKEITS-Overrides, und deren Abruf muss an denselben drei
 * Riegeln hängen wie die Listen (`datensatzAbrufAktiv`). Im Provider gebaut wäre es ein
 * zweiter Ort mit derselben Bedingung; ohne die Riegel feuerte er auf jeder Modulseite beim
 * blossen Öffnen der Palette — `pages/SchaedenPage.palette.test.tsx` (Etappe B) fährt MSW
 * mit `onUnhandledRequest: 'error'` und hätte den Bruch sofort gezeigt.
 *
 * Der zweite Beobachter auf `modulOverrides` kostet keinen zweiten Request: gleicher
 * Schlüssel, gleiches `enabled`, TanStack führt sie zusammen.
 */
export function useDatensatzTreffer({
  einsatzId,
  modus,
  suche,
  aktuellerModulKey,
  navigate,
}: DatensatzAbruf & {
  aktuellerModulKey: string | null;
  navigate: (pfad: string) => void;
}): Treffer[] {
  const { benutzer } = useAuth();
  const quellen = useDatensaetze({ einsatzId, modus, suche });
  const { data: overrides } = useQuery({
    queryKey: einsatzKeys.modulOverrides(einsatzId),
    queryFn: () => ladeModulOverrides(einsatzId!),
    enabled: datensatzAbrufAktiv({ einsatzId, modus, suche }),
    staleTime: FRISCH_MS,
  });

  // `aktuellerModulKey` gehört NICHT in `DatensatzAbruf`: er entscheidet nichts über den
  // Abruf, nur über die Rangfolge (LFH-391 · C4). Stünde er dort, hinge das `enabled` der
  // zehn Listen an ihm, und ein Modulwechsel bei offener Palette startete sie neu.
  return useMemo(
    () =>
      einsatzId == null
        ? LEER
        : baueDatensatzTreffer({
            einsatzId,
            modus,
            suche,
            benutzer,
            overrides,
            aktuellerModulKey,
            navigate,
            quellen,
          }),
    [einsatzId, modus, suche, benutzer, overrides, aktuellerModulKey, navigate, quellen],
  );
}

/**
 * EIN Leer-Array für alle Runden ohne Einsatz. Ein `[]` im Rückgabeausdruck wäre je Render
 * eine neue Identität und machte das `useMemo` im Aufrufer wirkungslos — dieselbe Falle, die
 * schon `useBefehle` mit `useDichte()` getreten hat.
 */
const LEER: Treffer[] = [];
