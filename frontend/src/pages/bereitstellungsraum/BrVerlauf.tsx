import { Button, Collapse, Skeleton, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { loadBrVerlauf } from '../../api/einsatzBereitstellungsraum';
import { einsatzKeys } from '../../api/queryKeys';
import type { BrVerlaufEintrag } from '../../api/types';
import ZeitAnzeige from '../../anzeige/ZeitAnzeige';
import { monoStil, NUR_VORLESER, Stapel, Textstufe, useRollen } from '../../components/instrument';
import {
  PANEEL_FEHLER_TEXT,
  PANEEL_FEHLER_TITEL,
  PANEEL_NEULADEN,
} from '../../components/instrument/PaneelZustand';
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
 * - Lädt erst beim Aufklappen (`enabled: isOpen`) und ungeblättert (`src/AGENTS.md`, Ausnahme für
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
  const [isOpen, setOpen] = useState(false);
  const { token } = useRollen();
  const query = useQuery({
    queryKey: einsatzKeys.brVerlauf(einsatzId, brId),
    queryFn: () => loadBrVerlauf(einsatzId, brId),
    enabled: isOpen,
  });

  const paddingStyle = { padding: token.paddingSM } as const;
  let body;
  if (query.isError) {
    body = (
      <div role="alert" data-lfh="br-verlauf-fehler" style={paddingStyle}>
        <Stapel abstand="xs">
          <Textstufe stufe="seitentitel" ton="alarm">
            {PANEEL_FEHLER_TITEL}
          </Textstufe>
          <Textstufe stufe="textKlein" ton="gedaempft">
            Verlauf konnte nicht geladen werden. {PANEEL_FEHLER_TEXT}
          </Textstufe>
          <span>
            <Button onClick={() => void query.refetch()}>{PANEEL_NEULADEN}</Button>
          </span>
        </Stapel>
      </div>
    );
  } else if (query.isPending) {
    body = (
      <div aria-busy="true" style={paddingStyle}>
        <Typography.Text type="secondary">Verlauf wird geladen …</Typography.Text>
        <Skeleton active title={false} paragraph={{ rows: 2 }} />
      </div>
    );
  } else if (query.data.length === 0) {
    body = (
      <Typography.Text type="secondary" style={{ ...paddingStyle, display: 'block' }}>
        Noch keine Belegung
      </Typography.Text>
    );
  } else {
    body = (
      <ol aria-label="Verlauf" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {query.data.map((e) => (
          <VerlaufZeile key={e.id} eintrag={e} />
        ))}
      </ol>
    );
  }

  return (
    <Collapse
      data-lfh="br-verlauf"
      style={{ marginTop: token.marginLG }}
      activeKey={isOpen ? ['verlauf'] : []}
      onChange={(keys) => setOpen((Array.isArray(keys) ? keys : [keys]).includes('verlauf'))}
      items={[
        {
          key: 'verlauf',
          label: (
            <>
              {'Verlauf '}
              <span style={NUR_VORLESER}>des Bereitstellungsraums {bezeichnung}</span>
            </>
          ),
          children: body,
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
      <span style={{ ...monoStil('mono'), color: rollen.gedaempft }}>
        <ZeitAnzeige wert={e.zeitpunkt_at} rolle="kurz" />
      </span>
      <span>{verlaufText(e)}</span>
      <span style={e.objekt_typ === 'fahrzeug' ? monoStil('mono') : undefined}>
        {e.objekt_name}
      </span>
      {e.notiz && (
        <Textstufe stufe="textKlein" ton="gedaempft">
          {e.notiz}
        </Textstufe>
      )}
    </li>
  );
}
