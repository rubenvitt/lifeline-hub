import { Alert, Typography } from 'antd';
import type { Auftrag, AuftragEmpfaenger as AuftragEmpfaengerTyp } from '../api/types';
import { Augenbraue, Paneel, monoStil, useRollen } from '../components/instrument';
import { DetailSprung } from '../components/ListeDetail';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { etbPfad } from '../routing/deeplinks';
import { mitBesetzung } from '../fuehrung/funktionsOptionenKern';
import type { ZeilenGrund } from '../components/useZeilenFehler';
import {
  AuftragAufhebung,
  AuftragEmpfaenger,
  AuftragHandlungen,
  AuftragKopf,
  AuftragSchema,
  AuftragVollzug,
  auftragKennung,
  gefuellteFelder,
} from './AuftragTeile';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';

const { Text } = Typography;

export interface AuftragDetailProps {
  auftrag: Auftrag;
  einsatzId: number;
  darfSchreiben: boolean;
  /** Der Auftrag steht nicht mehr in der Liste (Spec `liste-detail`, „Gewähltes Objekt entfällt“). */
  entfallen?: boolean;
  quittierungLaeuft?: boolean;
  quittierungZiel?: { auftragId: number; empfaengerId: number } | null;
  onQuittieren?: (auftragId: number, empfaengerId: number) => void;
  darfQuittierenFuer?: (empfaenger: AuftragEmpfaengerTyp) => boolean;
  onInArbeit?: (auftragId: number) => void;
  onVollzugMelden?: (auftragId: number) => void;
  onAbnehmen?: (auftragId: number) => void;
  onBerichtigen?: (auftragId: number) => void;
  onAufheben?: (auftragId: number) => void;
  fehlerGrund?: ZeilenGrund | null;
  quittierFehlerGrund?: ZeilenGrund | null;
}

interface VerlaufEintrag {
  zeit: string;
  wort: string;
}

/**
 * Der Verlauf aus den Zeitpunkten des Auftrags, aufsteigend. Die Wire-Zeiten sind UTC ohne Zone im
 * Format `YYYY-MM-DD HH:MM:SS` und sortieren deshalb als Text. Namen der Handelnden kennt der
 * Server nicht (nur Kennungen, design.md Non-Goals); die Empfänger stehen mit Namen.
 */
export function auftragVerlauf(a: Auftrag): VerlaufEintrag[] {
  const eintraege: (VerlaufEintrag | null)[] = [
    { zeit: a.erteilt_at, wort: 'erteilt' },
    ...a.empfaenger.map((e) =>
      e.quittiert_at
        ? {
            zeit: e.quittiert_at,
            wort: `quittiert · ${mitBesetzung(e.snap_anzeige, e.aktuelle_besetzung)}`,
          }
        : null,
    ),
    a.in_arbeit_at ? { zeit: a.in_arbeit_at, wort: 'in Bearbeitung' } : null,
    a.vollzogen_at ? { zeit: a.vollzogen_at, wort: 'vollzogen' } : null,
    a.abgenommen_at ? { zeit: a.abgenommen_at, wort: 'abgenommen' } : null,
    a.aufgehoben_at ? { zeit: a.aufgehoben_at, wort: 'aufgehoben' } : null,
  ];
  return eintraege
    .filter((e): e is VerlaufEintrag => e !== null)
    .sort((x, y) => x.zeit.localeCompare(y.zeit));
}

/**
 * Detail eines Einzelauftrags im Muster „Liste + Detailpaneel“ (Spec `auftraege-befehle`,
 * „Handlungen eines Auftrags im Detail“, „Lesefassung eines Auftrags im Detail“; design.md D3/D4).
 * Die Handlungen stehen direkt unter dem Text, damit sie auf dem Handschirm ohne Scrollen
 * erreichbar sind; Empfänger, Schema und Verlauf folgen.
 */
export default function AuftragDetail({
  auftrag: a,
  einsatzId,
  darfSchreiben,
  entfallen = false,
  quittierungLaeuft,
  quittierungZiel,
  onQuittieren,
  darfQuittierenFuer,
  onInArbeit,
  onVollzugMelden,
  onAbnehmen,
  onBerichtigen,
  onAufheben,
  fehlerGrund,
  quittierFehlerGrund,
}: AuftragDetailProps) {
  const { token, rollen } = useRollen();
  const { formatZeit } = useAnzeigeKonventionen();
  const kennung = auftragKennung(a);
  const hasSchema = gefuellteFelder(a, formatZeit).length > 0;
  const verlauf = auftragVerlauf(a);
  const abschnitt = { marginTop: token.marginLG } as const;
  return (
    <Paneel
      titel={`Auftrag${kennung ? ` ${kennung}` : ''}`}
      // Unter dem Bereichskopf (h3) des Reiters, neben den Gruppenköpfen der Liste.
      ueberschrift="h4"
      meta={
        <>
          erteilt <ZeitAnzeige wert={a.erteilt_at} />
        </>
      }
      koerperPolster
    >
      {entfallen && (
        <Alert
          type="info"
          showIcon
          title="Nicht mehr in dieser Ansicht"
          style={{ marginBottom: token.marginSM }}
        />
      )}
      <AuftragKopf auftrag={a} mitEtbSprung={false} />
      <Text strong style={{ fontSize: 15, lineHeight: 1.4, display: 'block' }}>
        {a.auftrag_text}
      </Text>
      <AuftragAufhebung auftrag={a} />
      <AuftragVollzug auftrag={a} ansicht="offen" />
      <AuftragHandlungen
        auftrag={a}
        darfSchreiben={darfSchreiben}
        onInArbeit={onInArbeit}
        onVollzugMelden={onVollzugMelden}
        onAbnehmen={onAbnehmen}
        onBerichtigen={onBerichtigen}
        onAufheben={onAufheben}
        fehlerGrund={fehlerGrund}
        ausrichtung="flex-start"
      />

      <div style={abschnitt}>
        <Augenbraue als="h5" style={{ display: 'block', marginBottom: token.marginXS }}>
          Empfänger
        </Augenbraue>
        <AuftragEmpfaenger
          auftrag={a}
          darfSchreiben={darfSchreiben}
          quittierungLaeuft={quittierungLaeuft}
          quittierungZiel={quittierungZiel}
          onQuittieren={onQuittieren}
          darfQuittierenFuer={darfQuittierenFuer}
          quittierFehlerGrund={quittierFehlerGrund}
        />
      </div>

      {hasSchema && (
        <div style={abschnitt}>
          <Augenbraue als="h5" style={{ display: 'block', marginBottom: token.marginXS }}>
            Schema
          </Augenbraue>
          <AuftragSchema auftrag={a} />
        </div>
      )}

      <div style={abschnitt}>
        <Augenbraue
          als="h5"
          id={`auftrag-verlauf-${a.id}`}
          style={{ display: 'block', marginBottom: token.marginXS }}
        >
          Verlauf
        </Augenbraue>
        <ul aria-labelledby={`auftrag-verlauf-${a.id}`} style={{ margin: 0, padding: 0 }}>
          {verlauf.map((e, i) => (
            <li
              key={`${e.zeit}-${i}`}
              style={{ listStyle: 'none', display: 'flex', gap: token.marginSM, paddingBlock: 2 }}
            >
              <span style={{ ...monoStil(12), color: rollen.gedaempft, flex: '0 0 auto' }}>
                <ZeitAnzeige wert={e.zeit} format="uhrzeit" />
              </span>
              <span>{e.wort}</span>
            </li>
          ))}
        </ul>
        {a.quell_etb_eintrag_id != null && (
          <DetailSprung ziel={etbPfad(einsatzId, { eintrag: a.quell_etb_eintrag_id })}>
            ETB-Eintrag
          </DetailSprung>
        )}
      </div>
    </Paneel>
  );
}
