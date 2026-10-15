import { Button, Collapse, Skeleton, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { loadBrVerlauf } from '../../api/einsatzBereitstellungsraum';
import { einsatzKeys } from '../../api/queryKeys';
import type { BrVerlaufEintrag } from '../../api/types';
import ZeitAnzeige from '../../anzeige/ZeitAnzeige';
import { monoStil, NUR_VORLESER, useRollen } from '../../components/instrument';
import {
  PANEEL_FEHLER_TEXT,
  PANEEL_FEHLER_TITEL,
  PANEEL_NEULADEN,
} from '../../components/instrument/PaneelZustand';
import { abstand } from '../../theme/tokens';
import { verlaufText } from './brBelegungKern';

interface BrVerlaufProps {
  einsatzId: number;
  brId: number;
  /** Bezeichnung des Raums, für den zugänglichen Namen des Klappkopfs. */
  bezeichnung: string;
}

/**
 * Verlauf eines Bereitstellungsraums (LLH-1095, design.md D12, Spec `bereitstellungsraum-belegung`,
 * „Verlauf auf der Detailseite“): ein Aufklappbereich als letzter Abschnitt der Detailseite.
 *
 * - Lädt erst beim Aufklappen (`enabled: offen`) und ungeblättert (`src/AGENTS.md`, Ausnahme für
 *   Verlaufsreihen je Stelle). Der Schlüssel hängt am Live-Ereignis `bereitstellungsraum`: bei
 *   offenem Verlauf erscheint ein neues Ereignis ohne Neuladen, zugeklappt wird nur markiert.
 * - Der Druck öffnet ihn nicht (Muster Betreuung); ein vorher geöffneter Verlauf druckt mit.
 * - Der Zustand gehört dem Raum: die Seite hängt das Bauteil an `key={brId}`, ein Wechsel über
 *   den Umschalter klappt zu.
 * - Ohne Schreibrecht und am BR-Gerät verfügbar (lesend; Routenliste `BEREITSTELLUNGSRAUM`).
 * - Laden, Fehler und leere Reihe stehen in Worten; ein Ladefehler ist nie „Noch keine Belegung“.
 *   Klappkopf mit Boden über den Kontext (LFH-653), Zustand über `aria-expanded`.
 */
export default function BrVerlauf({ einsatzId, brId, bezeichnung }: BrVerlaufProps) {
  const [offen, setOffen] = useState(false);
  const { token, rollen } = useRollen();
  const abfrage = useQuery({
    queryKey: einsatzKeys.brVerlauf(einsatzId, brId),
    queryFn: () => loadBrVerlauf(einsatzId, brId),
    enabled: offen,
  });

  const polster = { padding: token.paddingSM } as const;
  let koerper;
  if (abfrage.isError) {
    koerper = (
      <div
        role="alert"
        data-lfh="br-verlauf-fehler"
        style={{ ...polster, display: 'flex', flexDirection: 'column', gap: token.marginXS }}
      >
        <b style={{ color: rollen.alarmText, fontSize: 13 }}>{PANEEL_FEHLER_TITEL}</b>
        <span style={{ color: rollen.gedaempft, fontSize: 12 }}>
          Verlauf konnte nicht geladen werden. {PANEEL_FEHLER_TEXT}
        </span>
        <span>
          <Button onClick={() => void abfrage.refetch()}>{PANEEL_NEULADEN}</Button>
        </span>
      </div>
    );
  } else if (abfrage.isPending) {
    koerper = (
      <div aria-busy="true" style={polster}>
        <Typography.Text type="secondary">Verlauf wird geladen …</Typography.Text>
        <Skeleton active title={false} paragraph={{ rows: 2 }} />
      </div>
    );
  } else if (abfrage.data.length === 0) {
    koerper = (
      <Typography.Text type="secondary" style={{ ...polster, display: 'block' }}>
        Noch keine Belegung
      </Typography.Text>
    );
  } else {
    koerper = (
      <ol aria-label="Verlauf" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {abfrage.data.map((e) => (
          <VerlaufZeile key={e.id} eintrag={e} />
        ))}
      </ol>
    );
  }

  return (
    <Collapse
      data-lfh="br-verlauf"
      style={{ marginTop: abstand.lg }}
      activeKey={offen ? ['verlauf'] : []}
      onChange={(keys) => setOffen((Array.isArray(keys) ? keys : [keys]).includes('verlauf'))}
      items={[
        {
          key: 'verlauf',
          label: (
            <>
              {'Verlauf '}
              <span style={NUR_VORLESER}>des Bereitstellungsraums {bezeichnung}</span>
            </>
          ),
          children: koerper,
        },
      ]}
    />
  );
}

/** Eine Zeile: Uhrzeit, Art als Wort, Objekt (Funkrufname in Mono), Notiz. */
function VerlaufZeile({ eintrag: e }: { eintrag: BrVerlaufEintrag }) {
  const { token, rollen } = useRollen();
  return (
    <li
      data-lfh="br-verlauf-eintrag"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        columnGap: token.marginSM,
        rowGap: token.marginXXS,
        paddingBlock: token.paddingXS,
        borderBottom: `1px solid ${rollen.linie}`,
      }}
    >
      <span style={{ ...monoStil(13), color: rollen.gedaempft }}>
        <ZeitAnzeige wert={e.zeitpunkt_at} format="kurz" />
      </span>
      <span>{verlaufText(e)}</span>
      <span style={e.objekt_typ === 'fahrzeug' ? monoStil(13) : undefined}>{e.objekt_name}</span>
      {e.notiz && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {e.notiz}
        </Typography.Text>
      )}
    </li>
  );
}
