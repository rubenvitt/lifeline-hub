import type { ReactElement, ReactNode } from 'react';
import { KEINE_BERECHTIGUNG } from '../../einsatz/modulRegistry';
import { Link } from 'react-router';
import { Button, Space, Tag, Typography } from 'antd';
import type { FormRule } from 'antd';
import StatusTag from '../../components/StatusTag';
import { Datenfeld, DatenfeldEingabe, Datenraster } from '../../components/instrument';
import KoordinatenAnzeige from '../../anzeige/KoordinatenAnzeige';
import { lagekartePfad } from '../../routing/deeplinks';
import type { Schaden } from '../../api/types';
import { ABSCHLUSS_LABEL, AUSMASS_META, TYP_LABEL, geschaedigtAnzeige } from './schadenHelfer';

/** Die Felder, die die Detailseite im Bearbeiten-Modus an Ort und Stelle als Eingabe zeigt. */
type SchadenEingabeFeld = 'typ' | 'ausmass' | 'ort' | 'beschreibung' | 'geschaedigt';

/** Eingabe eines Felds im Bearbeiten-Modus: das Steuerelement und seine Prüfregeln. */
export interface SchadenEingabe {
  feld: ReactElement<{ id?: string }>;
  rules?: FormRule[];
}

/**
 * Die Schadensdaten als Datenraster — ein Bauteil für Detailseite und Palettenvorschau.
 *
 * Im Bearbeiten-Modus übergibt die Seite je Feld Eingabe und Regeln über `eingabe`; die Zelle wird
 * eine `DatenfeldEingabe` (benanntes Feld, Prüffehler sichtbar darunter, LLH-1101) mit dem
 * Feldnamen als Formularnamen, das Raster bleibt dasselbe. Ohne `eingabe` ist es reine Anzeige.
 */
export default function SchadenDaten({
  schaden: s,
  einsatzId,
  eingabe,
  verortenLink = false,
  karteGesperrt = false,
  ortZeile = true,
  spalten = 3,
}: {
  schaden: Schaden;
  einsatzId: number;
  /** Eingabe je Feld (nur im Bearbeiten-Modus der Seite). */
  eingabe?: Partial<Record<SchadenEingabeFeld, SchadenEingabe>>;
  /** „Auf Karte verorten" bei unverortetem Schaden — nur mit Schreibrecht sinnvoll. */
  verortenLink?: boolean;
  /** Lagekarte für den Benutzer gesperrt (LFH-888): der Auftrag steht gesperrt mit Grund. */
  karteGesperrt?: boolean;
  /**
   * Ort-Zeile (Ortsname, Peilung) unter der Koordinate. Sie ist ein eigener Serverabruf; die
   * Palettenvorschau lässt sie deshalb weg.
   */
  ortZeile?: boolean;
  spalten?: number;
}) {
  // Eine Zelle: im Bearbeiten-Modus die Eingabe, sonst die Anzeige — dasselbe Raster.
  const zelle = (feld: SchadenEingabeFeld, label: string, anzeige: ReactNode, breit = false) => {
    const e = eingabe?.[feld];
    return e ? (
      <DatenfeldEingabe label={label} name={feld} rules={e.rules} breit={breit}>
        {e.feld}
      </DatenfeldEingabe>
    ) : (
      <Datenfeld label={label} breit={breit}>
        {anzeige}
      </Datenfeld>
    );
  };

  return (
    <Datenraster spalten={spalten} beschriftung="Schadensdaten">
      {zelle('typ', 'Typ', <Tag>{TYP_LABEL[s.typ]}</Tag>)}
      {zelle('ausmass', 'Ausmaß', <StatusTag darstellung={AUSMASS_META[s.ausmass]} />)}
      {zelle('ort', 'Ort', s.ort)}
      {zelle('beschreibung', 'Beschreibung', s.beschreibung || '—', true)}
      {/* Verortung sichtbar machen: eine unverortete Lage, die niemand als unverortet sieht, ist
          so gut wie nicht erfasst. Keine Koordinateneingabe hier (`SchadenEingabe` kennt kein
          lat/lon, LFH-453), der Weg ist der Auftrag an die Karte. */}
      <Datenfeld label="Verortung">
        {s.lat != null && s.lon != null ? (
          <KoordinatenAnzeige
            lat={s.lat}
            lon={s.lon}
            einsatzId={ortZeile ? einsatzId : undefined}
          />
        ) : (
          <Space wrap>
            <Typography.Text type="secondary">nicht verortet</Typography.Text>
            {verortenLink &&
              (karteGesperrt ? (
                <Button type="link" disabled title={KEINE_BERECHTIGUNG}>
                  Auf Karte verorten
                </Button>
              ) : (
                // Mit Herkunft: „Zurück zu S-…“ führt danach hierher (LLH-1125).
                <Link
                  to={lagekartePfad(einsatzId, {
                    platzieren: { typ: 'schaden', id: s.id, zurueck: true },
                  })}
                >
                  Auf Karte verorten
                </Link>
              ))}
          </Space>
        )}
      </Datenfeld>
      {zelle('geschaedigt', 'Geschädigt', geschaedigtAnzeige(s, einsatzId), true)}
      {s.status !== 'offen' && <Datenfeld label="Übergeben an">{s.uebergeben_an || '—'}</Datenfeld>}
      {s.status === 'abgeschlossen' && (
        <Datenfeld label="Abschlussgrund">
          {s.abschluss_grund ? ABSCHLUSS_LABEL[s.abschluss_grund] : '—'}
        </Datenfeld>
      )}
    </Datenraster>
  );
}
