import { Tag, Typography } from 'antd';
import { Select } from '../components/Select';
import { spaltenFuer, type Kartenplan } from '../components/Datensicht';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { registrierAnzeige } from '../api/einsatzPerson';
import { personDetailPfad } from '../routing/deeplinks';
import type { Person } from '../api/types';
import { SK_META, STATUS_META } from './personMeta';

/** Alter-Anzeige: Geburtsdatum > geschätztes Alter > „—". */
function alterAnzeige(p: Person): string {
  if (p.geburtsdatum) return p.geburtsdatum;
  if (p.alter_geschaetzt != null) return `~${p.alter_geschaetzt} J.`;
  return '—';
}

/**
 * Der Zeitpunkt, seit dem eine Person in ihrem aktuellen Zustand ist — die
 * Vergleichsgrundlage der Dringlichkeit.
 *
 * `aktuelle_sichtung_at` VOR `erfasst_at`: die Erfassung sagt, wann jemand aufgenommen
 * wurde, die Sichtung, wann er zuletzt medizinisch bewertet wurde. Für „wer wartet am
 * längsten auf die nächste Bewertung" ist Letzteres die Frage.
 *
 * `??`, nicht `?.` — und der Rückgabetyp ist `string`, nicht `string | undefined`:
 * `erfasst_at` ist Pflichtfeld von `PersonAnzeige`, also gibt es immer einen Wert. Eine
 * leere Zeitangabe rendert als '' und wäre in der Spalte unsichtbar statt auffällig.
 *
 * `geaendert_at` wäre falsch: es läuft bei jeder Notiz weiter und beantwortet damit eine
 * andere Frage („wann wurde der Satz zuletzt angefasst").
 */
export function seitWert(p: Person): string {
  return p.aktuelle_sichtung_at ?? p.erfasst_at;
}

/**
 * Namenstext einer Person, oder `null`, wenn kein Namensteil bekannt ist.
 *
 * Der Leerwert ist die Pointe: der Anzeigetext „unbekannt" gehört ins `render`, NICHT in den
 * Suchbeitrag — sonst fände eine Freitextsuche nach „unbekannt" jede namenlose Person als
 * Namenstreffer.
 */
export function nameText(p: Person): string | null {
  if (!p.name && !p.vorname) return null;
  return `${p.name ?? ''}${p.vorname ? `, ${p.vorname}` : ''}`;
}

/**
 * Sichtungskategorie als Etikett, „—" wenn ungesichtet.
 *
 * Aus dem anonymen `render` herausgezogen, damit die Regel adressierbar ist. `SK_META`
 * bleibt bei antd-Farbnamen und damit außerhalb des A2-Statusfarbvertrags — sie in eine
 * `StatusDarstellung` zu zwingen wäre der von A2 verbotene Bestands-Sweep. Folge: der
 * zweite Kanal ist hier das Etikett selbst („SK II"), nicht ein zusätzliches Symbol.
 */
export function SkTag({ p }: { p: Person }) {
  return p.aktuelle_sichtung ? (
    <Tag color={SK_META[p.aktuelle_sichtung].color}>{SK_META[p.aktuelle_sichtung].label}</Tag>
  ) : (
    <Typography.Text type="secondary">—</Typography.Text>
  );
}

/**
 * Das EINE Spaltenregister der Personenlisten (LFH-330 · B2) — reine Anzeige, ohne Aktionen.
 * Speist Patienten- und Listen-Sicht, und über den Kartenplan unten beide Darstellungsformen.
 *
 * Durch `spaltenFuer<Person>()` geführt, NIE annotiert: eine Annotation
 * (`readonly DatensichtSpalte<Person>[]`) weitet die Schlüsselliterale auf `string`, und der
 * Kartenplan nähme danach jeden Tippfehler unbemerkt an.
 *
 * `abBreite` staffelt statt antds Breiten-Prop, damit der Spaltenzähler beide
 * Ausblendungsgründe kennt. `seit` trägt bewusst KEINE Schwelle: die Zeitachse ist der
 * Zweck dieser Sicht, und eine Spalte, die schon unter 1200 px verschwindet, wäre in jeder
 * jsdom-Prüfung abwesend.
 */
export const personenSpalten = spaltenFuer<Person>()([
  {
    title: 'Reg.-Nr.',
    key: 'reg',
    width: 100,
    immerSichtbar: true,
    // Sortiert wird über die ZAHL — über den Anzeigetext läge „R-10" vor „R-9".
    sortWert: (p) => p.registrier_nr,
    suchText: (p) => registrierAnzeige(p.registrier_nr),
    // KEIN Anker hier: den Titel-Link setzt der Kartenplan über `titel.ziel`, in beiden
    // Zweigen. Ein `<a>` im `render` ergäbe verschachtelte Links.
    render: (_, p) => <Typography.Text strong>{registrierAnzeige(p.registrier_nr)}</Typography.Text>,
  },
  {
    title: 'Status',
    key: 'status',
    width: 130,
    render: (_, p) => <Tag color={STATUS_META[p.status].color}>{STATUS_META[p.status].label}</Tag>,
  },
  { title: 'SK', key: 'sk', width: 90, render: (_, p) => <SkTag p={p} /> },
  {
    title: 'Name',
    key: 'name',
    suchText: nameText,
    render: (_, p) => nameText(p) ?? <Typography.Text type="secondary">unbekannt</Typography.Text>,
  },
  {
    title: 'Geschlecht',
    dataIndex: 'geschlecht',
    key: 'geschlecht',
    abBreite: 'lg',
    render: (g) => g ?? '—',
  },
  { title: 'Alter', key: 'alter', abBreite: 'lg', render: (_, p) => alterAnzeige(p) },
  {
    title: 'seit',
    key: 'seit',
    /**
     * Volle taktische DTG (`dtgVoll`, der Default) statt `kurz`. `formatZeitKurz` liest über
     * `dayjs()` die echte Wanduhr, um „heute" zu bestimmen — jede Behauptung darüber wäre an
     * den Ausführungszeitpunkt gekoppelt. `taktischeDtgVoll` ist eine reine Funktion des
     * Wire-Strings.
     *
     * KEIN relatives Alter („vor 20 min"): `ZeitAnzeige` kennt vier Formate, und dayjs'
     * `relativeTime` ohne geladenes deutsches Gebietsschema lieferte englischen Text — ein
     * stiller Sprachbruch. Zusätzlich müsste eine tickende Spalte gegen
     * Prüflisten-Kriterium 12 abgesichert werden. → eigenes Ticket.
     */
    sortWert: seitWert,
    render: (_, p) => <ZeitAnzeige wert={seitWert(p)} />,
  },
  {
    title: 'Antreffort',
    dataIndex: 'antreff_ort',
    key: 'antreff_ort',
    abBreite: 'xl',
    render: (t) => t ?? '—',
  },
]);

/** Die Schlüsselmenge des Registers — Grundlage jedes typgeprüften Kartenplan-Slots. */
export type PersonenSpaltenKey = (typeof personenSpalten)[number]['key'];

/**
 * Kartenplan der Personenlisten.
 *
 * KEIN `status`-Slot, obwohl es eine Statusspalte gibt: `STATUS_META`/`SK_META` sind
 * antd-Farbnamen und stehen außerhalb des A2-Statusfarbvertrags. Sie in eine
 * `StatusDarstellung` zu zwingen wäre der von A2 ausdrücklich verbotene Bestands-Sweep.
 * SK steht deshalb als Sekundärfeld, Status als Spalte.
 *
 * Offener Prüflisten-Rest daraus (Kriterium 7, eine Farbe = eine Bedeutung): `red` bedeutet
 * in der Statusspalte „verstorben" und in der SK-Spalte „SK I". → Folgeticket „modul-lokale
 * Farbmaps in den A2-Vertrag".
 *
 * Der Rückgabetyp ist der Plan-ZWEIG, nicht der ganze `Kartenplan`-Verbund. Gemessen: über
 * dem Verbund verliert ein `{ ...personenKarte(id), aktion: … }` die Unterscheidung nach
 * `art`, TypeScript prüft die Zusatzeigenschaft dann gegen den Eigenbau-Zweig und lehnt
 * `aktion` als unbekannt ab. Die Listen-Sicht braucht genau diesen Aufsatz.
 */
type KartenPlanZweig<T, K extends string> = Extract<Kartenplan<T, K>, { art: 'plan' }>;

export const personenKarte = (einsatzId: number): KartenPlanZweig<Person, PersonenSpaltenKey> => ({
  art: 'plan',
  titel: { spalte: 'reg', ziel: (p) => personDetailPfad(einsatzId, p.id) },
  sekundaer: ['name', 'sk', 'seit'],
});

/**
 * Zusatzspalte „Abgleich vorschlagen" (nur Vermisst-Sicht mit Schreibrecht): je Vermisst-Zeile
 * ein Auswahlfeld über die gefundenen Personen. `onAbgleich` löst den Verdachts-Abgleich aus.
 *
 * Die Klein-Variante am Auswahlfeld unten ist BESTAND (LFH-333/B5 baut sie ab, nicht dieses
 * Bündel) und lebt allein im Tabellenzweig — hier ausdrücklich umschrieben statt zitiert,
 * damit ein Zählgate seine eigene Erklärung nicht mitzählt. Der Kartenzweig trägt sie NICHT:
 * ein ~24 px hohes Steuerelement mit fester 200-px-Breite wäre auf einer 390-px-Karte
 * dreifach regelwidrig. Dort ersetzt der Aktions-Deskriptor des Kartenplans es durch einen
 * Knopf, der ein Modal öffnet.
 */
export function abgleichSpalten(
  gefundene: readonly Person[],
  onAbgleich: (vermisstId: number, gefundenId: number) => void,
) {
  return spaltenFuer<Person>()([
    {
      title: 'Abgleich vorschlagen',
      key: 'abgleich',
      width: 220,
      immerSichtbar: true,
      render: (_: unknown, v: Person) => (
        <Select<number>
          placeholder="gefundene Person …"
          size="small"
          style={{ width: 200 }}
          // Bleibt: der Zeilenklick der Tabelle hängt weiter am `onRow` des Primitivs.
          onClick={(e) => e.stopPropagation()}
          onChange={(gid) => onAbgleich(v.id, gid)}
          options={gefundene.map((g) => ({
            value: g.id,
            label: `${registrierAnzeige(g.registrier_nr)} ${g.name ?? 'unbekannt'}`,
          }))}
          disabled={gefundene.length === 0}
        />
      ),
    },
  ]);
}
