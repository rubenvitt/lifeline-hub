import { Button, Dropdown } from 'antd';
import { Fragment } from 'react';
import { IconHaken, IconTrichter } from '../icons';
import { monoStil, useRollen } from '../components/instrument';
import type { MeldungKennzahlen } from '../api/types';

/**
 * Bausteine der Meldungsseite unter `md` (LFH-974, Spec `meldungen-handy`): eine Zeile statt des
 * Kennzahlenbands und der Richtungsfilter hinter einem Knopf. Beides gibt dem Wortlaut der ersten
 * Karte den ersten Schirm frei; ab `md` bleiben Band und Segmentleiste.
 */

/** Die vier Zahlen des Bands als eine Zeile, Töne wie dort (Achtung/Alarm nur bei > 0). */
export function MeldungKennzahlZeile({
  kennzahlen,
  laedt,
}: {
  kennzahlen: MeldungKennzahlen | undefined;
  /** Ohne Zahlen (Laden, Fehler) steht „—" statt einer erfundenen Null. */
  laedt: boolean;
}) {
  const { rollen } = useRollen();
  const teile: { wert: number | undefined; wort: string; farbe?: string }[] = [
    {
      wert: kennzahlen?.unbearbeitet,
      wort: 'unbearbeitet',
      farbe: (kennzahlen?.unbearbeitet ?? 0) > 0 ? rollen.achtungText : undefined,
    },
    { wert: kennzahlen?.in_arbeit, wort: 'in Arbeit' },
    {
      wert: kennzahlen?.alarmiert,
      wort: 'Bestätigung überfällig',
      farbe: (kennzahlen?.alarmiert ?? 0) > 0 ? rollen.alarmText : undefined,
    },
    { wert: kennzahlen?.erledigt, wort: 'erledigt' },
  ];
  return (
    <p
      role="group"
      data-lfh="meldung-kennzahl-zeile"
      aria-label="Meldungen in Zahlen"
      style={{ margin: 0, color: rollen.text2 }}
    >
      {teile.map((t, i) => (
        <Fragment key={t.wort}>
          {i > 0 && ' · '}
          <strong style={{ ...monoStil(14), color: t.farbe ?? rollen.text }}>
            {laedt || t.wert == null ? '—' : t.wert}
          </strong>{' '}
          <span style={t.farbe ? { color: t.farbe } : undefined}>{t.wort}</span>
        </Fragment>
      ))}
    </p>
  );
}

const RICHTUNGEN = [
  { key: 'alle', label: 'Alle Richtungen' },
  { key: 'intern', label: 'Intern' },
  { key: 'extern', label: 'Extern' },
];

/** „Filter" bzw. „Filter (1 aktiv)"; das Menü trägt ein Häkchen am aktiven Eintrag. */
export function RichtungFilterKnopf({
  wert,
  onWechsel,
}: {
  wert: string;
  onWechsel: (wert: string) => void;
}) {
  const aktiv = wert === 'alle' ? 0 : 1;
  return (
    <Dropdown
      trigger={['click']}
      menu={{
        selectable: true,
        selectedKeys: [wert],
        onClick: ({ key }) => onWechsel(key),
        items: RICHTUNGEN.map((r) => ({
          key: r.key,
          label: r.label,
          icon: (
            <span style={{ visibility: r.key === wert ? 'visible' : 'hidden' }}>
              <IconHaken />
            </span>
          ),
        })),
      }}
    >
      <Button icon={<IconTrichter />}>{aktiv > 0 ? `Filter (${aktiv} aktiv)` : 'Filter'}</Button>
    </Dropdown>
  );
}
