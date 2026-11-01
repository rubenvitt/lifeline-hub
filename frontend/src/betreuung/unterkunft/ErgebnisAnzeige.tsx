import { Space, Tag, Typography } from 'antd';
import type { ReactNode } from 'react';
import { zahlText } from '../../anzeige/zahl';
import {
  Datenfeld,
  Datenraster,
  Kennzahl,
  Kennzahlenband,
  Paneel,
} from '../../components/instrument';
import type { Ergebnis, TypAnzahl } from './rechnerKern';
import { ZELTTYPEN, richtwertBasis, type Richtwerte } from './richtwerte';

const ZELT_NAME = new Map(ZELTTYPEN.map((t) => [t.typ, t.bezeichnung]));

/** Ganzzahl oder eine Stelle, deutsch. */
export function menge(x: number): string {
  return zahlText(x, { stellen: Number.isInteger(x) ? 0 : 1 });
}

function wert(x: number, einheit?: string): ReactNode {
  return einheit ? `${menge(x)} ${einheit}` : menge(x);
}

/**
 * Ob eine Größe auf einer Annahme ruht: einer der Richtwerte ist ohne Quelle und gilt mit seinem
 * Basiswert (ein eigener Wert der Organisation oder des Einsatzes ist eine Entscheidung, keine
 * Annahme).
 */
export function ruhtAufAnnahme(schluessel: readonly string[], richtwerte: Richtwerte): boolean {
  return schluessel.some((k) => {
    const b = richtwertBasis(k);
    return b?.herkunft === 'annahme' && richtwerte[k] === b.wert;
  });
}

function Etikett({ text, annahme }: { text: string; annahme: boolean }) {
  return (
    <Space size={6} wrap>
      <span>{text}</span>
      {annahme && (
        <Tag bordered={false} data-lfh="annahme">
          Annahme
        </Tag>
      )}
    </Space>
  );
}

/** Zeltmix als Summe („2 × SG 30 + 6 × SG 50“) oder Alternativen je Typ („… oder …“). */
function zelteText(liste: readonly TypAnzahl[], verbinder: ' + ' | ' oder ' = ' + '): string {
  const mit = liste.filter((z) => z.anzahl > 0);
  return mit.length === 0
    ? '—'
    : mit.map((z) => `${z.anzahl} × ${ZELT_NAME.get(z.typ) ?? z.typ}`).join(verbinder);
}

/**
 * Ergebnis des Rechners (LLH-1520, design.md D4): Kennzahlenband und je Bereich ein Paneel, wie im
 * POC. Rein darstellend; gerechnet wird in der Seite.
 */
export default function ErgebnisAnzeige({
  ergebnis,
  richtwerte,
}: {
  ergebnis: Ergebnis;
  richtwerte: Richtwerte;
}) {
  const e = ergebnis;
  const annahme = (...k: string[]) => ruhtAufAnnahme(k, richtwerte);
  const gruppenText = e.trennung
    ? `${menge(e.gruppen[0].personen)} Männer · ${menge(e.gruppen[1].personen)} Frauen`
    : 'ohne Trennung';
  const urinalSchluessel = e.trennung
    ? ['urinal_je_maenner']
    : ['urinal_je_maenner', 'maenneranteil_ohne_trennung_prozent'];

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Kennzahlenband beschriftung="Ergebnis in Zahlen" spalten={4}>
        <Kennzahl
          titel={e.weg === 'personen' ? 'Personen' : 'Plätze'}
          wert={menge(e.personen)}
          notiz={gruppenText}
        />
        <Kennzahl
          titel="Schlaffläche"
          wert={menge(e.schlafen.flaeche_m2)}
          einheit="m²"
          notiz={`${menge(richtwerte.flaeche_je_person_m2)} m² je Person`}
        />
        <Kennzahl
          titel="Toiletten"
          wert={menge(e.sanitaer.toiletten)}
          notiz={`dazu ${menge(e.sanitaer.urinale)} Urinale`}
        />
        <Kennzahl
          titel="Wasser"
          wert={menge(e.versorgung.wasser_l_tag)}
          einheit="l"
          notiz="je Tag"
        />
      </Kennzahlenband>

      {e.kapazitaet?.raeume && e.kapazitaet.raeume.length > 0 && (
        <Paneel titel="Räume" koerperPolster>
          <Datenraster spalten={3} beschriftung="Plätze je Raum">
            {e.kapazitaet.raeume.map((r, i) => (
              <Datenfeld key={i} label={r.bezeichnung || `Raum ${i + 1}`} mono>
                {menge(r.plaetze)} Plätze · {menge(r.nutzflaeche_m2)} m²
              </Datenfeld>
            ))}
          </Datenraster>
        </Paneel>
      )}

      <Paneel titel="Schlafen" koerperPolster>
        <Datenraster spalten={3} beschriftung="Schlafen">
          <Datenfeld label="Feldbetten" mono>
            {wert(e.material.feldbetten)}
          </Datenfeld>
          <Datenfeld label={<Etikett text="Decken" annahme={annahme('decken_je_person')} />} mono>
            {wert(e.material.decken)}
          </Datenfeld>
          <Datenfeld label="Fläche im Gebäude" mono>
            {wert(e.schlafen.flaeche_m2, 'm²')}
          </Datenfeld>
        </Datenraster>
      </Paneel>

      <Paneel titel={e.weg === 'zelte' ? 'Zelte (Bestand belegt)' : 'Unterbringung im Zelt'} koerperPolster>
        <Datenraster spalten={3} beschriftung="Zelte">
          {e.schlafen.zelte_je_typ.map((z) => (
            <Datenfeld key={z.typ} label={`nur ${ZELT_NAME.get(z.typ) ?? z.typ}`} mono>
              {menge(z.anzahl)} Zelte
            </Datenfeld>
          ))}
          <Datenfeld label="Zeltmix" mono breit>
            {zelteText(e.schlafen.zeltmix)}
          </Datenfeld>
          <Datenfeld label="Grundfläche Zeltmix" mono>
            {wert(e.schlafen.zeltmix_grundflaeche_m2, 'm²')}
          </Datenfeld>
          <Datenfeld
            label={`Platzbedarf mit ${menge(richtwerte.zelt_abstand_m)} m Abstand`}
            mono
          >
            {wert(e.schlafen.zeltmix_platzbedarf_m2, 'm²')}
          </Datenfeld>
        </Datenraster>
      </Paneel>

      <Paneel titel="Sanitär" koerperPolster>
        <Datenraster spalten={4} beschriftung="Sanitär">
          <Datenfeld label="Toiletten" mono>
            {wert(e.sanitaer.toiletten)}
          </Datenfeld>
          <Datenfeld label={<Etikett text="Urinale" annahme={annahme(...urinalSchluessel)} />} mono>
            {wert(e.sanitaer.urinale)}
          </Datenfeld>
          <Datenfeld label="Waschplätze" mono>
            {wert(e.sanitaer.waschplaetze)}
          </Datenfeld>
          <Datenfeld label="Duschen" mono>
            {wert(e.sanitaer.duschen)}
          </Datenfeld>
        </Datenraster>
      </Paneel>

      <Paneel titel="Gesundheit" koerperPolster>
        <Datenraster spalten={3} beschriftung="Gesundheit">
          <Datenfeld
            label={
              <Etikett
                text="Krankenbetten"
                annahme={annahme('krankenbett_je_personen', 'krankenbett_zuschlag')}
              />
            }
            mono
          >
            {wert(e.gesundheit.betten)}
          </Datenfeld>
          <Datenfeld
            label={
              <Etikett text="Fläche Krankenstation" annahme={annahme('krankenflaeche_je_bett_m2')} />
            }
            mono
          >
            {wert(e.gesundheit.flaeche_m2, 'm²')}
          </Datenfeld>
          <Datenfeld
            label={<Etikett text="Isolierstation" annahme={annahme('isolierstation_ab_personen')} />}
          >
            {e.gesundheit.isolierstation ? (
              <Typography.Text strong>erforderlich</Typography.Text>
            ) : (
              'nicht erforderlich'
            )}
          </Datenfeld>
        </Datenraster>
      </Paneel>

      <Paneel titel="Ver- und Entsorgung" koerperPolster>
        <Datenraster spalten={4} beschriftung="Ver- und Entsorgung">
          <Datenfeld label="Wasser" mono>
            {wert(e.versorgung.wasser_l_tag, 'l/Tag')}
          </Datenfeld>
          <Datenfeld label="davon Trinkwasser" mono>
            {wert(e.versorgung.davon_trinkwasser_l_tag, 'l/Tag')}
          </Datenfeld>
          <Datenfeld label="Fäkalien" mono>
            {wert(e.versorgung.faekalien_l_tag, 'l/Tag')}
          </Datenfeld>
          <Datenfeld label="Abfall" mono>
            {wert(e.versorgung.abfall_l_tag, 'l/Tag')}
          </Datenfeld>
        </Datenraster>
      </Paneel>

      <Paneel titel="Verpflegung" koerperPolster>
        <Datenraster spalten={4} beschriftung="Verpflegung">
          <Datenfeld
            label={
              <Etikett
                text="Ausgabestellen"
                annahme={annahme('zweite_ausgabestelle_ab_personen')}
              />
            }
            mono
          >
            {e.verpflegung.ausgabestellen > 0 ? `mind. ${menge(e.verpflegung.ausgabestellen)}` : '0'}
          </Datenfeld>
          <Datenfeld label="Sitzplätze" mono>
            {wert(e.verpflegung.sitzplaetze)}
          </Datenfeld>
          <Datenfeld label="Biergarnituren" mono>
            {wert(e.verpflegung.garnituren)}
          </Datenfeld>
          <Datenfeld label="Aufenthaltszelte" mono breit>
            {zelteText(e.verpflegung.aufenthaltszelte_je_typ, ' oder ')}
          </Datenfeld>
        </Datenraster>
      </Paneel>
    </Space>
  );
}
