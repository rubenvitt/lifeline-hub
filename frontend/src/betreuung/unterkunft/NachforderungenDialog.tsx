import { Alert, Checkbox, Modal, Space, Typography } from 'antd';
import { useState, type CSSProperties } from 'react';
import { AUSGANG_UNBEKANNT_TEXT, NetzFehler, fehlerText } from '../../api/client';
import { legeNachforderungAn } from '../../api/nachforderungen';
import type {
  AdressatKategorie,
  NachforderungPrioritaet,
  NeueNachforderung,
} from '../../api/types';
import { MengenFeld } from '../../components/MengenFeld';
import { Select } from '../../components/Select';
import { useRollen } from '../../components/instrument';
import { neueClientId } from '../../offline/clientId';
import {
  ADRESSAT_OPTIONEN,
  PRIORITAET_OPTIONEN,
} from '../../nachforderungen/NachforderungFormular';
import type { Posten } from './posten';

interface Zeile extends Posten {
  an: boolean;
  /** Angelegt in einem früheren Lauf dieses Dialogs; nicht mehr wählbar. */
  angelegt: boolean;
  fehler?: string;
}

export interface Lauf {
  angelegt: string[];
  gescheitert: { art: string; fehler: string }[];
}

/**
 * Legt je gewähltem Posten eine Nachforderung mit Bezug zur Stelle an (LLH-1520, design.md D6),
 * nacheinander über den bestehenden Schreibweg. Ein gescheiterter Posten hält die übrigen nicht
 * auf. Jeder Posten trägt seinen Idempotenzschlüssel (LLH-1526): ein erneuter Lauf nach einem
 * Netzfehler legt eine schon gespeicherte Nachforderung nicht doppelt an. Rein bis auf den
 * Aufruf, für den Test exportiert.
 */
export async function legePostenAn(
  einsatzId: number,
  stelleId: number,
  posten: readonly (Pick<Posten, 'art' | 'anzahl' | 'bezeichnung'> & { clientId: string })[],
  gemeinsam: { adressat_kategorie: AdressatKategorie; prioritaet: NachforderungPrioritaet },
  anlegen: (einsatzId: number, body: NeueNachforderung) => Promise<unknown> = legeNachforderungAn,
): Promise<Lauf> {
  const lauf: Lauf = { angelegt: [], gescheitert: [] };
  for (const p of posten) {
    try {
      await anlegen(einsatzId, {
        art: p.art,
        anzahl: p.anzahl,
        bezeichnung: p.bezeichnung,
        betreuungsstelle_id: stelleId,
        ...gemeinsam,
        client_id: p.clientId,
      });
      lauf.angelegt.push(p.art);
    } catch (e) {
      // `apiSend` meldet Zeitlimit und Leitungsabbruch als `NetzFehler`, auch wenn der Server
      // schon gespeichert hat; „nicht abgeschickt“ wäre dann falsch.
      lauf.gescheitert.push({
        art: p.art,
        fehler: e instanceof NetzFehler ? AUSGANG_UNBEKANNT_TEXT : fehlerText(e, 'nicht angelegt'),
      });
    }
  }
  return lauf;
}

/**
 * Dialog „Nachforderungen anlegen“ aus dem Ergebnis des Rechners: Posten mit Anzahl, Adressat
 * und Priorität gemeinsam. Nach einem Lauf mit Fehlern bleibt er offen; angelegte Posten stehen
 * als angelegt, gescheiterte bleiben angehakt mit Grund, auch nach einem Netzfehler: ihr
 * Schlüssel bleibt, bis der Posten angekommen ist (LLH-1526).
 */
export default function NachforderungenDialog({
  einsatzId,
  stelleId,
  stelleName,
  posten,
  clientIds,
  onFertig,
  onSchliessen,
}: {
  einsatzId: number;
  stelleId: number;
  stelleName: string;
  posten: readonly Posten[];
  /**
   * Idempotenzschlüssel je Stelle und Posten, vom Aufrufer über das Schließen hinaus gehalten:
   * wer nach einem Netzfehler schließt und neu öffnet, schickt denselben Schlüssel. Ein
   * angelegter Posten gibt seinen frei. Ohne Angabe gilt er für diesen Dialog.
   */
  clientIds?: Map<string, string>;
  /** Nach einem Lauf, in dem etwas angelegt wurde (für Invalidierung und Rückmeldung). */
  onFertig: (lauf: Lauf, offenGeblieben: boolean) => void;
  onSchliessen: () => void;
}) {
  const { token } = useRollen();
  const [zeilen, setZeilen] = useState<Zeile[]>(() =>
    posten.map((p) => ({ ...p, an: p.vorgewaehlt, angelegt: false })),
  );
  const [adressat, setAdressat] = useState<AdressatKategorie>('leitstelle');
  const [prioritaet, setPrioritaet] = useState<NachforderungPrioritaet>('normal');
  const [laeuft, setLaeuft] = useState(false);
  const [schluessel] = useState(() => clientIds ?? new Map<string, string>());

  const gewaehlt = zeilen.filter((z) => z.an && !z.angelegt && z.anzahl > 0);
  const n = gewaehlt.length;
  const knopf = n === 1 ? '1 Nachforderung anlegen' : `${n} Nachforderungen anlegen`;
  const gescheitert = zeilen.filter((z) => z.fehler);

  /** Der Schlüssel des Postens an dieser Stelle; ein neuer erst, wenn der alte angelegt hat. */
  function schluesselFuer(z: Zeile): string {
    const k = `${stelleId}/${z.schluessel}`;
    let id = schluessel.get(k);
    if (id == null) {
      id = neueClientId();
      schluessel.set(k, id);
    }
    return id;
  }

  async function anlegen() {
    setLaeuft(true);
    const lauf = await legePostenAn(
      einsatzId,
      stelleId,
      gewaehlt.map((z) => ({ ...z, clientId: schluesselFuer(z) })),
      { adressat_kategorie: adressat, prioritaet },
    );
    setLaeuft(false);
    const fehlerJe = new Map(lauf.gescheitert.map((g) => [g.art, g.fehler]));
    const angelegt = new Set(lauf.angelegt);
    // Während des Laufs ist der Dialog gesperrt, `zeilen` ist also noch aktuell.
    const naechste = zeilen.map((z): Zeile => {
      if (angelegt.has(z.art)) {
        schluessel.delete(`${stelleId}/${z.schluessel}`);
        return { ...z, an: false, angelegt: true, fehler: undefined };
      }
      const fehler = fehlerJe.get(z.art);
      return fehler == null ? z : { ...z, fehler };
    });
    setZeilen(naechste);
    const offen = lauf.gescheitert.length > 0;
    if (lauf.angelegt.length > 0) onFertig(lauf, offen);
    if (!offen) onSchliessen();
  }

  const zeile: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 120px',
    gap: token.marginSM,
    alignItems: 'center',
    paddingBlock: token.paddingXS,
    borderBlockEnd: `1px solid ${token.colorBorderSecondary}`,
  };

  return (
    <Modal
      open
      title={`Nachforderungen für ${stelleName}`}
      okText={knopf}
      cancelText="Schließen"
      okButtonProps={{ disabled: n === 0 }}
      confirmLoading={laeuft}
      onOk={() => void anlegen()}
      onCancel={laeuft ? undefined : onSchliessen}
      closable={!laeuft}
      mask={{ closable: !laeuft }}
      destroyOnHidden
    >
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <div role="group" aria-label="Posten">
          {zeilen.map((z) => (
            <div key={z.schluessel} style={zeile}>
              <Checkbox
                checked={z.an}
                disabled={z.angelegt || laeuft}
                onChange={(ev) =>
                  setZeilen((alt) =>
                    alt.map((x) =>
                      x.schluessel === z.schluessel ? { ...x, an: ev.target.checked } : x,
                    ),
                  )
                }
              >
                <span style={{ display: 'grid' }}>
                  <span>{z.art}</span>
                  {z.bezeichnung && (
                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                      {z.bezeichnung}
                    </Typography.Text>
                  )}
                  {z.angelegt && (
                    <Typography.Text type="success" style={{ fontSize: token.fontSizeSM }}>
                      angelegt
                    </Typography.Text>
                  )}
                  {z.fehler && (
                    <Typography.Text type="danger" style={{ fontSize: token.fontSizeSM }}>
                      {z.fehler}
                    </Typography.Text>
                  )}
                </span>
              </Checkbox>
              <MengenFeld
                beschriftung={`Anzahl ${z.art}`}
                min={1}
                max={1_000_000}
                value={z.anzahl}
                disabled={z.angelegt || laeuft}
                onChange={(v) =>
                  setZeilen((alt) =>
                    alt.map((x) => (x.schluessel === z.schluessel ? { ...x, anzahl: v ?? 0 } : x)),
                  )
                }
                style={{ width: '100%' }}
              />
            </div>
          ))}
        </div>
        <div
          style={{
            display: 'grid',
            gap: token.marginSM,
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
          }}
        >
          <label style={{ display: 'grid', gap: 4 }}>
            <Typography.Text type="secondary">Adressat</Typography.Text>
            <Select<AdressatKategorie>
              aria-label="Adressat"
              options={ADRESSAT_OPTIONEN}
              value={adressat}
              onChange={setAdressat}
              disabled={laeuft}
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <Typography.Text type="secondary">Priorität</Typography.Text>
            <Select<NachforderungPrioritaet>
              aria-label="Priorität"
              options={PRIORITAET_OPTIONEN}
              value={prioritaet}
              onChange={setPrioritaet}
              disabled={laeuft}
            />
          </label>
        </div>
        {gescheitert.length > 0 && (
          <Alert
            type="error"
            showIcon
            title={`${gescheitert.length} Posten nicht angelegt`}
            description={gescheitert.map((z) => z.art).join(', ')}
          />
        )}
      </Space>
    </Modal>
  );
}
