import { Card, Space, Statistic } from 'antd';
import type { Warnstufe } from '../../api/types';
import type { Verdichtung } from '../../kraefte/kraeftebild';
import { staerkeText } from '../../kraefte/kraeftebild';
import { aufTaste } from './klickbar';

/** Lesbare Textfarbe je Warnstufe (die Matrix nutzt Hintergrundfarben; hier Text). */
const WARNSTUFE_TEXTFARBE: Record<Warnstufe, string | undefined> = {
  keine: undefined, niedrig: '#d4b106', mittel: '#d46b08', hoch: '#cf1322', akut: '#cf1322',
};
const WARNSTUFE_LABEL: Record<Warnstufe, string> = {
  keine: 'keine', niedrig: 'niedrig', mittel: 'mittel', hoch: 'hoch', akut: 'akut',
};

interface Props {
  kraefte: Verdichtung | null;
  patienten: number | null;
  vermisst: number | null;
  warnstufe: Warnstufe | null;
  schaedenOffen: number | null;
  uhsAktiv: number | null;
  onNavigate: (route: string) => void;
}

const STRICH = '—';

function Kennzahl(props: {
  titel: string; value: string | number; farbe?: string; onClick: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={props.onClick}
      onKeyDown={aufTaste(props.onClick)}
      style={{ cursor: 'pointer' }}
    >
      <Statistic
        title={props.titel}
        value={props.value}
        valueStyle={props.farbe ? { color: props.farbe } : undefined}
      />
    </div>
  );
}

export default function KennzahlenLeiste(props: Props) {
  const { kraefte, patienten, vermisst, warnstufe, schaedenOffen, uhsAktiv, onNavigate } = props;
  return (
    <Card size="small" style={{ marginBottom: 16 }} styles={{ body: { overflowX: 'auto' } }}>
      <Space size="large" align="start" style={{ flexWrap: 'nowrap' }}>
        <Kennzahl titel="Kräfte (F/UF/M//Ges)" value={kraefte ? staerkeText(kraefte.staerke) : STRICH} onClick={() => onNavigate('kraefteuebersicht')} />
        <Kennzahl titel="Patienten (SK I–IV)" value={patienten ?? STRICH} onClick={() => onNavigate('personen')} />
        <Kennzahl titel="Vermisst" value={vermisst ?? STRICH} onClick={() => onNavigate('personen')} />
        <Kennzahl titel="Höchste Warnstufe" value={warnstufe ? WARNSTUFE_LABEL[warnstufe] : STRICH} farbe={warnstufe ? WARNSTUFE_TEXTFARBE[warnstufe] : undefined} onClick={() => onNavigate('gefahren')} />
        <Kennzahl titel="Schäden offen" value={schaedenOffen ?? STRICH} onClick={() => onNavigate('schaeden')} />
        <Kennzahl titel="UHS aktiv" value={uhsAktiv ?? STRICH} onClick={() => onNavigate('unfallhilfsstellen')} />
      </Space>
    </Card>
  );
}
