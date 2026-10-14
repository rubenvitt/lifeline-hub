import type { ReactNode } from 'react';
import type { StaerkePosition } from '../api/types';
import { kraefteText } from '../anzeige/staerke';
import { KennungsLink } from '../components/kennungsLink';
import { Augenbraue, monoStil, useRollen } from '../components/instrument';
import { einheitDetailPfad, fahrzeugePfad, personalPfad } from '../routing/deeplinks';
import EinheitZeichen, { FahrzeugZeichen } from './EinheitZeichen';
import { fremdText } from './kraeftebaumKern';
import type { PersonAnzeige, RasterZeile } from './meldebildRaster';

/**
 * Die Zeilenbausteine der ersten Spalte des Kräftebaums (LLH-1025, Spec `kraeftebaum`): Einheit,
 * Fahrzeug, Person und Gruppe unterscheiden sich durch ZEICHEN, EINZUG und SCHRIFT, nicht nur
 * durch Farbe oder ein Kürzel — auch im Graustufendruck:
 *
 * | Art         | Zeichen                         | Schrift                 |
 * |-------------|---------------------------------|-------------------------|
 * | Einheit     | taktisches Zeichen 26 px        | Name 500                |
 * | Fahrzeug    | Fahrzeugzeichen 22 px           | Funkrufname Mono        |
 * | Person      | Positionsmarke F/UF/M (+ „EF“)  | Name normal             |
 * | Gruppe      | —                               | Augenbraue (Versalien)  |
 * | Material    | Kurzwort „Mtl.“                 | Bezeichnung normal      |
 *
 * Den Einzug zeichnet die `Datensicht` (eine Einzugsrechnung, LFH-977). `data-art` trägt die
 * Zeilenart für Druck-CSS und Prüfungen.
 *
 * EINSTIEGE STATT PFLEGEMASKE: Einheitenname, Funkrufname und Personenname springen über
 * `KennungsLink` in ihr Modul (Einheit-Ansicht, Fahrzeugzeile, Personalzeile hervorgehoben).
 * Fehlt das Recht auf das Zielmodul, steht der Name als Text (`gesperrt`, aus `useSprungSperre`).
 * Ein Sprung ist keine Handlung (LFH-616); der Anker bedient den Klick allein (Riegel der
 * `Datensicht`). Abnehmer neben dem Meldebild: die Einheiten-Gliederung (LLH-1029).
 */

/** Kurzwort der Stärkeposition — die Marke der Personenzeile. */
const POSITION_KURZ: Record<StaerkePosition, string> = {
  fuehrer: 'F',
  unterfuehrer: 'UF',
  mannschaft: 'M',
};

const POSITION_WORT: Record<StaerkePosition, string> = {
  fuehrer: 'Führer',
  unterfuehrer: 'Unterführer',
  mannschaft: 'Mannschaft',
};

/** Ein umrandetes Kurzwort (Positionsmarke, „EF“): Zeichen der Personenzeile, nie nur Farbe. */
export function Marke({ text, titel }: { text: string; titel: string }) {
  const { rollen } = useRollen();
  return (
    <span
      data-lfh="kraeftebaum-marke"
      title={titel}
      style={{
        ...monoStil(11),
        display: 'inline-flex',
        justifyContent: 'center',
        minWidth: 24,
        paddingInline: 2,
        border: `1px solid ${rollen.linieStark}`,
        color: rollen.text2,
        flexShrink: 0,
        lineHeight: '16px',
      }}
    >
      {text}
    </span>
  );
}

/**
 * Positionsmarke F/UF/M der Person, ohne Position „–“ (sie zählt in der Stärke als Mannschaft,
 * die Marke erfindet aber keine Position). Der Einheitsführer trägt zusätzlich „EF“.
 */
export function PositionsMarken({ person }: { person: PersonAnzeige }) {
  const pos = person.position;
  return (
    <>
      <Marke
        text={pos ? POSITION_KURZ[pos] : '–'}
        titel={pos ? POSITION_WORT[pos] : 'ohne Stärkeposition'}
      />
      {person.isFuehrer && <Marke text="EF" titel="Einheitsführer" />}
    </>
  );
}

/** Die Zeile einer Gruppe: „Material · 3 Posten · 1 Ausfall“, „Ohne Fahrzeug · 2 Kräfte“. */
export function gruppenText(z: Pick<RasterZeile, 'art' | 'gruppe'>): string[] {
  const g = z.gruppe ?? { anzahl: 0, ausfall: 0 };
  if (z.art === 'material-gruppe') {
    return [`${g.anzahl} Posten`, ...(g.ausfall > 0 ? [`${g.ausfall} Ausfall`] : [])];
  }
  return [kraefteText(g.anzahl)];
}

/** Welche Module als Sprungziel gesperrt sind (`useSprungSperre`). */
export type SprungGesperrt = (modul: 'einheiten' | 'fahrzeuge' | 'personal') => boolean;

/**
 * Was die Zelle zeichnet: eine Meldebild-Zeile oder eine reine Einheitzeile (Einheiten-Gliederung,
 * LLH-1029), die nur trägt, was die Einheitzelle liest.
 */
export type KraeftebaumZelleZeile =
  | RasterZeile
  | ({ art: 'einheit' } & Pick<RasterZeile, 'einheitId' | 'bezeichnung' | 'zusatz' | 'tz'>);

interface KraeftebaumZelleProps {
  zeile: KraeftebaumZelleZeile;
  einsatzId: number;
  gesperrt: SprungGesperrt;
}

export default function KraeftebaumZelle({ zeile: z, einsatzId, gesperrt }: KraeftebaumZelleProps) {
  const { token, rollen } = useRollen();
  // Umbrechend: die Einheitenspalte hat keine feste Breite, und ein nicht umbrechender Nebentext
  // höbe die Mindestbreite der ganzen Tabelle — im Druck auf A4 ragte sie aus dem Blatt
  // (`e2e/meldebild-druck.spec.ts`).
  const nebentext = (teile: readonly (string | null | undefined)[]) => {
    const text = teile.filter(Boolean).join(' · ');
    return text ? (
      <span
        data-lfh="kraeftebaum-nebentext"
        style={{ display: 'block', fontSize: 11, color: rollen.gedaempft }}
      >
        {text}
      </span>
    ) : null;
  };
  /** Der Name als Sprung oder — ohne Recht oder ohne Ziel — als Text. */
  const name = (inhalt: ReactNode, ziel: string | null) =>
    ziel ? <KennungsLink to={ziel}>{inhalt}</KennungsLink> : inhalt;
  const huelle = (zeichen: ReactNode, text: ReactNode) => (
    <span
      data-lfh="kraeftebaum-zelle"
      data-art={z.art}
      style={{ display: 'inline-flex', alignItems: 'center', gap: token.marginXS }}
    >
      {zeichen}
      <span style={{ minWidth: 0 }}>{text}</span>
    </span>
  );

  switch (z.art) {
    case 'einheit': {
      const ziel =
        z.einheitId != null && !gesperrt('einheiten')
          ? einheitDetailPfad(einsatzId, z.einheitId)
          : null;
      return huelle(
        <EinheitZeichen tz={z.tz} />,
        <>
          <span style={{ fontWeight: 500 }}>{name(z.bezeichnung, ziel)}</span>
          {nebentext([z.zusatz])}
        </>,
      );
    }
    case 'fahrzeug': {
      const ziel =
        z.mittelId != null && !gesperrt('fahrzeuge')
          ? fahrzeugePfad(einsatzId, { fahrzeug: z.mittelId })
          : null;
      return huelle(
        z.fahrzeugTz ? <FahrzeugZeichen tz={z.fahrzeugTz} /> : null,
        <>
          <span style={monoStil(12)}>{name(z.bezeichnung, ziel)}</span>
          {nebentext([z.zusatz, z.besatzung ? fremdText(z.besatzung) : null])}
        </>,
      );
    }
    case 'person': {
      const ziel =
        z.mittelId != null && !gesperrt('personal')
          ? personalPfad(einsatzId, { personal: z.mittelId })
          : null;
      return huelle(
        z.person ? <PositionsMarken person={z.person} /> : null,
        <>
          {name(z.bezeichnung, ziel)}
          {nebentext([z.zusatz, z.person?.faehrtAuf ? `fährt auf ${z.person.faehrtAuf}` : null])}
        </>,
      );
    }
    case 'ohne-fahrzeug':
    case 'material-gruppe': {
      const [anzahl, ausfall] = gruppenText(z);
      return huelle(
        null,
        <span
          style={{
            display: 'inline-flex',
            flexWrap: 'wrap',
            alignItems: 'baseline',
            gap: token.marginXS,
          }}
        >
          <Augenbraue style={{ fontSize: 11 }}>{z.bezeichnung}</Augenbraue>
          {/* Zahlen in Mono (Regel „Zahlen immer Mono“), samt ihrem Zählwort. */}
          <span style={{ ...monoStil(11), color: rollen.gedaempft }}>· {anzahl}</span>
          {ausfall && (
            <span
              data-lfh="kraeftebaum-ausfall"
              style={{ ...monoStil(11), color: rollen.alarmText }}
            >
              · {ausfall}
            </span>
          )}
        </span>,
      );
    }
    case 'material':
      return huelle(
        // Das Kürzel schrumpft nicht: im Druck ließ die Zellregel `overflow-wrap: anywhere` es
        // sonst als „Mtl“ über „.“ brechen (LFH-1007).
        <span style={{ ...monoStil(11), color: rollen.schwach, flexShrink: 0 }}>Mtl.</span>,
        <>{z.bezeichnung}</>,
      );
  }
}
