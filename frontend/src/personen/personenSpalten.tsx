import StatusTag from '../components/StatusTag';
import SichtungsTag from '../components/SichtungsTag';
import { Typography } from 'antd';
import { Select } from '../components/Select';
import { spaltenFuer, type Kartenplan } from '../components/Datensicht';
import { monoStil, useRollen } from '../components/instrument';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { registrierAnzeige } from '../api/einsatzPerson';
import { personDetailPfad } from '../routing/deeplinks';
import type { Person } from '../api/types';
import { STATUS_META } from './personMeta';
import { GESCHLECHT_KURZ } from './personBefehl';
import { lueckenText, lueckenVon, verbleibKlasse } from './personenBilanz';

/**
 * Das EINE Spaltenregister der Betroffenen-Listen (LFH-330 · B2; Neuentwurf S7) — reine
 * Anzeige, ohne Aktionen. Speist Zeilen- und Rasteransicht und über den Kartenplan beide
 * Darstellungsformen.
 *
 * Spalten nach dem Entwurf, soweit es Daten gibt: Nr. · Person (Name + Geschlecht/Alter) ·
 * Sichtung · Status · Fundort · Verbleib · Vermerk · Zeit. **„Zustand" fehlt** — an der
 * Person gibt es kein Zustandsfeld (LFH-613); an seiner Stelle steht der Personenstatus als
 * echte Spalte (`StatusTag`, A2-Vertrag).
 *
 * Eine FABRIK, kein Wert: die Verbleib-Spalte nennt die Unfallhilfsstelle beim Namen, und
 * den kennt nur die UHS-Liste der Seite. Durch `spaltenFuer<Person>()` geführt, NIE
 * annotiert — eine Annotation weitet die Schlüssel auf `string`, und der Kartenplan nähme
 * danach jeden Tippfehler unbemerkt an.
 *
 * ── DER ZWEITE KANAL DER LÜCKENTÖNUNG ───────────────────────────────────────────────────
 *
 * Eine Zeile ohne Verbleib/Fundort trägt `lueckeZeile` (Seite, `zeilenKlasse`). Die Farbe
 * allein wäre ein Ein-Kanal-Signal (WCAG 1.4.1), deshalb steht das WORT in der
 * Personenzelle („Verbleib offen") — und zwar dort, weil die Personenzelle in BEIDEN
 * Zweigen steht: im Kartenzweig gibt es keine Fundort-/Verbleib-Spalte, dort hinge eine
 * Tönung sonst ohne Wort. Die Fundort-/Verbleib-Zellen selbst zeigen „—" in `achtung`.
 */

/** Alter-Anzeige: Geburtsdatum > geschätztes Alter (mit Tilde — das Feld IST geschätzt). */
export function alterAnzeige(p: Pick<Person, 'geburtsdatum' | 'alter_geschaetzt'>): string | null {
  if (p.geburtsdatum) return p.geburtsdatum;
  if (p.alter_geschaetzt != null) return `~${p.alter_geschaetzt}`;
  return null;
}

/** „w ~34" — Geschlecht und Alter in der Kurzschreibweise der Erfassungszeile. */
export function geschlechtAlter(p: Person): string | null {
  const teile = [p.geschlecht ? GESCHLECHT_KURZ[p.geschlecht] : null, alterAnzeige(p)].filter(
    (t): t is string => t != null,
  );
  return teile.length > 0 ? teile.join(' ') : null;
}

/**
 * Der Zeitpunkt, seit dem eine Person in ihrem aktuellen Zustand ist — die
 * Vergleichsgrundlage der Dringlichkeit. `aktuelle_sichtung_at` VOR `erfasst_at`: für „wer
 * wartet am längsten auf die nächste Bewertung" zählt die letzte Sichtung. `geaendert_at`
 * wäre falsch — es läuft bei jeder Notiz weiter.
 */
export function seitWert(p: Person): string {
  return p.aktuelle_sichtung_at ?? p.erfasst_at;
}

/**
 * Namenstext einer Person, oder `null`. Der Leerwert ist die Pointe: „unbekannt" gehört ins
 * `render`, NICHT in den Suchbeitrag — sonst fände die Suche nach „unbekannt" jede
 * namenlose Person als Namenstreffer.
 */
export function nameText(p: Pick<Person, 'name' | 'vorname'>): string | null {
  if (!p.name && !p.vorname) return null;
  return `${p.name ?? ''}${p.vorname ? `, ${p.vorname}` : ''}`;
}

/** Sichtung als `SichtungsTag` (BBK-Farbfeld, LFH-455), „—" wenn ungesichtet. */
export function SkTag({ p }: { p: Pick<Person, 'aktuelle_sichtung'> }) {
  return p.aktuelle_sichtung ? (
    <SichtungsTag kategorie={p.aktuelle_sichtung} />
  ) : (
    <Typography.Text type="secondary">—</Typography.Text>
  );
}

/** Personenzelle: Name 13 + Geschlecht/Alter Mono 11, darunter ggf. der Lückenvermerk. */
function PersonZelle({ p }: { p: Person }) {
  const { token, rollen } = useRollen();
  const ga = geschlechtAlter(p);
  const offen = lueckenText(lueckenVon(p));
  return (
    <div style={{ minWidth: 0 }}>
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: token.marginXS }}>
        <span style={{ fontSize: 13, color: nameText(p) ? rollen.text : rollen.gedaempft }}>
          {nameText(p) ?? 'unbekannt'}
        </span>
        {ga && <span style={{ ...monoStil(11), color: rollen.gedaempft }}>{ga}</span>}
      </span>
      {offen && (
        <div data-lfh="luecke" style={{ ...monoStil(11), color: rollen.achtung }}>
          {offen}
        </div>
      )}
    </div>
  );
}

/** Offene Zelle in `achtung`, sonst neutraler Gedankenstrich. */
function Leerzelle({ offen }: { offen: boolean }) {
  const { rollen } = useRollen();
  return <span style={{ color: offen ? rollen.achtung : rollen.schwach }}>—</span>;
}

function FundortZelle({ p }: { p: Person }) {
  const { rollen } = useRollen();
  if (!p.antreff_ort) return <Leerzelle offen={lueckenVon(p).fundort} />;
  return <span style={{ ...monoStil(11), color: rollen.gedaempft }}>{p.antreff_ort}</span>;
}

/** Verbleib-Anzeige: Kurzform, sonst die aktuelle UHS, sonst „—". */
export function verbleibText(
  p: Pick<Person, 'aktueller_verbleib' | 'aktuelle_uhs_id'>,
  uhsName: (id: number) => string | undefined,
): string | null {
  const k = verbleibKlasse(p);
  if (k === 'offen') return null;
  if (k === 'uhs') return `UHS ${uhsName(p.aktuelle_uhs_id!) ?? ''}`.trim();
  return p.aktueller_verbleib ?? null;
}

function VerbleibZelle({ p, uhsName }: { p: Person; uhsName: (id: number) => string | undefined }) {
  const { rollen } = useRollen();
  const text = verbleibText(p, uhsName);
  if (text == null) return <Leerzelle offen={lueckenVon(p).verbleib} />;
  return <span style={{ fontSize: 12, color: rollen.text2 }}>{text}</span>;
}

export function personenSpalten(uhsName: (id: number) => string | undefined) {
  return spaltenFuer<Person>()([
    {
      title: 'Nr.',
      key: 'reg',
      width: 84,
      immerSichtbar: true,
      zahl: true,
      // Sortiert wird über die ZAHL — über den Anzeigetext läge „R-10" vor „R-9".
      sortWert: (p) => p.registrier_nr,
      suchText: (p) => registrierAnzeige(p.registrier_nr),
      // KEIN Anker hier: den Titel-Link setzt der Kartenplan über `titel.ziel`.
      render: (_, p) => registrierAnzeige(p.registrier_nr),
    },
    {
      title: 'Person',
      key: 'person',
      mindestBreite: 180,
      sortWert: (p) => nameText(p),
      suchText: nameText,
      render: (_, p) => <PersonZelle p={p} />,
    },
    { title: 'Sichtung', key: 'sk', width: 104, render: (_, p) => <SkTag p={p} /> },
    {
      title: 'Status',
      key: 'status',
      width: 118,
      render: (_, p) => <StatusTag darstellung={STATUS_META[p.status]} />,
    },
    {
      title: 'Fundort',
      key: 'fundort',
      abBreite: 'lg',
      suchText: (p) => p.antreff_ort,
      render: (_, p) => <FundortZelle p={p} />,
    },
    {
      title: 'Verbleib',
      key: 'verbleib',
      suchText: (p) => verbleibText(p, uhsName),
      render: (_, p) => <VerbleibZelle p={p} uhsName={uhsName} />,
    },
    {
      title: 'Vermerk',
      key: 'vermerk',
      abBreite: 'xxl',
      mindestBreite: 160,
      suchText: (p) => p.notiz,
      render: (_, p) =>
        p.notiz ? (
          <Typography.Text
            type="secondary"
            ellipsis={{ tooltip: p.notiz }}
            style={{ fontSize: 12 }}
          >
            {p.notiz}
          </Typography.Text>
        ) : null,
    },
    {
      title: 'Zeit',
      key: 'seit',
      width: 88,
      align: 'right',
      zahl: true,
      /**
       * Taktische DTG `DDHHmm` statt reiner Uhrzeit: ein Einsatz dauert über Mitternacht,
       * und „14:19" von gestern sähe aus wie von heute. `taktischeDtg` ist eine reine
       * Funktion des Wire-Strings — `kurz` läse die Wanduhr, jede Aussage darüber hinge am
       * Ausführungszeitpunkt.
       */
      sortWert: seitWert,
      render: (_, p) => <ZeitAnzeige wert={seitWert(p)} format="dtg" />,
    },
  ]);
}

/** Die Schlüsselmenge des Registers — Grundlage jedes typgeprüften Kartenplan-Slots. */
export type PersonenSpaltenKey = ReturnType<typeof personenSpalten>[number]['key'];

/**
 * Der Rückgabetyp ist der Plan-ZWEIG, nicht der ganze `Kartenplan`-Verbund: über dem
 * Verbund verlöre `{ ...personenKarte(id), aktion: … }` die Unterscheidung nach `art`.
 */
type KartenPlanZweig<T, K extends string> = Extract<Kartenplan<T, K>, { art: 'plan' }>;

/**
 * Kartenplan: Nr. als Titel-Link, Personenstatus im Status-Slot (A2-Vertrag), Person
 * (samt Lückenvermerk), Sichtung und Zeit als Sekundärfelder.
 */
export const personenKarte = (einsatzId: number): KartenPlanZweig<Person, PersonenSpaltenKey> => ({
  art: 'plan',
  titel: { spalte: 'reg', ziel: (p) => personDetailPfad(einsatzId, p.id) },
  status: (p) => STATUS_META[p.status],
  sekundaer: ['person', 'sk', 'seit'],
});

/**
 * Zusatzspalte „Abgleich vorschlagen" (nur Vermisst-Filter mit Schreibrecht). Die feste
 * Breite trägt auf einer 390-px-Karte nicht; der Kartenzweig ersetzt das Auswahlfeld durch
 * einen Knopf plus Dialog (Aktions-Deskriptor der Seite).
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
