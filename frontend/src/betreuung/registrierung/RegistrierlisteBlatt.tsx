import { theme } from 'antd';
import type { CSSProperties } from 'react';
import { registrierNummer } from '../../anzeige/registrierNummer';
import type { RegistrierListe, RegistriertePerson } from '../../api/types';
import { monoStil } from '../../components/instrument';
import {
  KOSTFORM_REIHE,
  KOSTFORM_WORT,
  alterText,
  haushaltKennung,
  kostformBand,
  personName,
} from './registrierKern';
import './registrierlisteDruck.css';

export interface RegistrierlisteBlattProps {
  liste: RegistrierListe;
  /** Kalendertag `YYYY-MM-DD` der Anzeigezone, für das Alter aus dem Geburtsdatum. */
  heute: string;
  /** Spalte „Unverträglichkeiten“ (Gesundheitsangabe), nur wenn bewusst gewählt. */
  mitUnvertraeglichkeiten: boolean;
}

const personenWort = (n: number) => `${n} ${n === 1 ? 'Person' : 'Personen'}`;

/**
 * Blatt der Registrierliste einer Betreuungsstelle (LLH-1616, Spec `betreuung-registrierung`,
 * „Registrierliste drucken“; Change `iw8hjb93-registrierliste-drucken` design.md D4). Ohne
 * Bedienelemente, schwarz auf Weiß lesbar:
 *
 * - **Summen je Kostform** aus `kostformBand`, alle Kostformen in fester Folge samt „ohne
 *   Angabe“ und „gesamt“: an der Essensausgabe zählt auch die Null.
 * - **Eine Tabelle** mit einem Kopf für alle, damit die Spalten über alle Haushalte gleich breit
 *   bleiben; je Haushalt ein Zeilenblock (`tbody`) mit Kopfzeile „H-n · Bezugsperson · n
 *   Personen“. Der Block bricht im Druck nicht (`registrierlisteDruck.css`), der Kopf wiederholt
 *   sich je Seite (`thead`, `druck/druck.css`).
 * - **Abhakspalte** rechts, leer, mit Rand: zum Abhaken mit dem Stift.
 */
export default function RegistrierlisteBlatt({
  liste,
  heute,
  mitUnvertraeglichkeiten,
}: RegistrierlisteBlattProps) {
  const { token } = theme.useToken();
  const band = kostformBand(liste);
  const gesamt = Object.values(band).reduce((a, b) => a + b, 0);
  const rand = `1px solid ${token.colorBorder}`;
  const zelle: CSSProperties = {
    padding: `${token.paddingXXS}px ${token.paddingXS}px`,
    borderBlockEnd: `1px solid ${token.colorBorderSecondary}`,
    verticalAlign: 'top',
    textAlign: 'start',
  };
  const kopfzelle: CSSProperties = { ...zelle, borderBlockEnd: rand, fontWeight: 600 };
  const mono: CSSProperties = { ...monoStil(token.fontSize), whiteSpace: 'nowrap' };
  const spalten = mitUnvertraeglichkeiten ? 6 : 5;

  const personZeile = (p: RegistriertePerson) => (
    <tr key={p.id}>
      <td style={{ ...zelle, ...mono }}>{registrierNummer('R', p.registrier_nr)}</td>
      <td style={zelle}>{personName(p)}</td>
      <td style={{ ...zelle, ...mono }}>{alterText(p, heute)}</td>
      <td style={zelle}>{p.kostform ? KOSTFORM_WORT[p.kostform] : 'ohne Angabe'}</td>
      {mitUnvertraeglichkeiten && <td style={zelle}>{p.unvertraeglichkeiten ?? ''}</td>}
      <td style={{ ...zelle, borderInline: rand, borderBlockEnd: rand }} />
    </tr>
  );

  const block = (schluessel: string, kopf: string, personen: RegistriertePerson[]) => (
    <tbody key={schluessel} data-lfh="registrierliste-haushalt">
      <tr>
        <th
          scope="rowgroup"
          colSpan={spalten}
          style={{
            ...zelle,
            paddingBlockStart: token.paddingSM,
            borderBlockEnd: rand,
            fontWeight: 600,
          }}
        >
          {kopf}
        </th>
      </tr>
      {personen.map(personZeile)}
    </tbody>
  );

  return (
    <div data-lfh="registrierliste-blatt" style={{ fontSize: token.fontSize }}>
      <table
        aria-label="Kostformen"
        data-lfh="registrierliste-summen"
        style={{ borderCollapse: 'collapse', marginBlockEnd: token.marginLG, minWidth: '40%' }}
      >
        <thead>
          <tr>
            <th scope="col" style={kopfzelle}>
              Kostform
            </th>
            <th scope="col" style={{ ...kopfzelle, textAlign: 'end' }}>
              Personen
            </th>
          </tr>
        </thead>
        <tbody>
          {[...KOSTFORM_REIHE, 'ohne_angabe' as const].map((k) => (
            <tr key={k}>
              <th scope="row" style={{ ...zelle, fontWeight: 400 }}>
                {k === 'ohne_angabe' ? 'ohne Angabe' : KOSTFORM_WORT[k]}
              </th>
              <td style={{ ...zelle, ...mono, textAlign: 'end' }}>{band[k]}</td>
            </tr>
          ))}
          <tr>
            <th scope="row" style={{ ...zelle, fontWeight: 600, borderBlockEnd: 'none' }}>
              gesamt
            </th>
            <td
              style={{
                ...zelle,
                ...mono,
                textAlign: 'end',
                fontWeight: 600,
                borderBlockEnd: 'none',
              }}
            >
              {gesamt}
            </td>
          </tr>
        </tbody>
      </table>

      <table
        aria-label="Registrierte Personen"
        data-lfh="registrierliste"
        style={{ width: '100%', borderCollapse: 'collapse' }}
      >
        <colgroup>
          <col style={{ width: '6em' }} />
          <col />
          <col style={{ width: '10em' }} />
          <col style={{ width: mitUnvertraeglichkeiten ? '9em' : '11em' }} />
          {mitUnvertraeglichkeiten && <col style={{ width: '12em' }} />}
          <col style={{ width: '2.5em' }} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" style={kopfzelle}>
              Reg.-Nr.
            </th>
            <th scope="col" style={kopfzelle}>
              Name
            </th>
            <th scope="col" style={kopfzelle}>
              Geb. / Alter
            </th>
            <th scope="col" style={kopfzelle}>
              Kostform
            </th>
            {mitUnvertraeglichkeiten && (
              <th scope="col" style={kopfzelle}>
                Unverträglichkeiten
              </th>
            )}
            <th scope="col" aria-label="abgehakt" style={{ ...kopfzelle, textAlign: 'center' }}>
              ✓
            </th>
          </tr>
        </thead>
        {liste.haushalte.map((h) =>
          block(
            `h${h.id}`,
            [haushaltKennung(h.nummer), h.bezugsperson_name, personenWort(h.personen.length)]
              .filter(Boolean)
              .join(' · '),
            h.personen,
          ),
        )}
        {liste.ohne_haushalt.length > 0 &&
          block(
            'ohne',
            `ohne Haushalt · ${personenWort(liste.ohne_haushalt.length)}`,
            liste.ohne_haushalt,
          )}
      </table>
    </div>
  );
}
