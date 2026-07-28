import { ConfigProvider, Segmented, Space, Tooltip } from 'antd';
import { FiMaximize, FiMinimize, FiMonitor, FiMoon, FiSun } from 'react-icons/fi';
import { TbHandStop } from 'react-icons/tb';
import type { IconType } from 'react-icons';
import { useDichte, useThemeMode, type ThemeModus } from '../theme/ThemeModeProvider';
import type { Dichte } from '../theme/tokens';

const OPTIONEN = [
  { wert: 'system' as const, titel: 'System', Icon: FiMonitor },
  { wert: 'light' as const, titel: 'Hell', Icon: FiSun },
  { wert: 'dark' as const, titel: 'Dunkel', Icon: FiMoon },
];

/**
 * Die drei Bedienstufen mit ihrer Beschriftung (LFH-329 · B1).
 *
 * EXPORTIERT, obwohl nur eine Stelle sie rendert: die Kopfzeile legt ihre
 * Umschalter auf schmalem Schirm ab, weshalb dieselben drei Stufen zusätzlich als
 * Gruppe im Benutzermenü hängen müssen. Ohne diesen Export doppelte jene Stelle
 * Beschriftungen und Symbole — und eine umbenannte Stufe stünde danach an zwei
 * Orten verschieden da.
 */
export const DICHTE_OPTIONEN: { wert: Dichte; titel: string; Icon: IconType }[] = [
  { wert: 'kompakt', titel: 'Kompakt', Icon: FiMinimize },
  { wert: 'komfortabel', titel: 'Komfortabel', Icon: FiMaximize },
  { wert: 'handschuh', titel: 'Handschuh', Icon: TbHandStop },
];

/** Symbol als inline-flex zentrieren: das Segment-Etikett richtet seinen Inhalt
 *  über die Zeilenhöhe aus, was nur für Inline-Inhalt greift. Ein Block-Symbol
 *  säße sonst oben im Etikettenkasten (wirkt zu hoch). */
function etikett(titel: string, Icon: IconType) {
  return (
    <Tooltip title={titel}>
      <span
        aria-label={titel}
        style={{ display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle' }}
      >
        <Icon size={16} />
      </span>
    </Tooltip>
  );
}

/**
 * Zwei Umschalter für die Topbar: Farbschema (System / Hell / Dunkel) und
 * Bediendichte (Kompakt / Komfortabel / Handschuh).
 *
 * Der Header ist in beiden Modi dunkel, deshalb werden beide Umschalter per
 * lokalem ConfigProvider auf den dunklen Grund abgestimmt (transluzenter Track,
 * weiße Symbole) — statt als heller Kasten herauszustechen. Der lokale Provider
 * setzt AUSSCHLIESSLICH Farben; die Maße bleiben bewusst am übergeordneten
 * Theme, damit die gewählte Stufe auch diese Umschalter selbst trägt.
 *
 * ZWEI ACHSEN, EIN NAME: die Komponente heißt weiter `ThemeToggle`, obwohl sie
 * nun auch die Dichte trägt. Das ist Absicht und kein Versehen — sie wird an
 * zwei Layout-Stellen eingehängt, die parallel umgebaut werden; eine eigene
 * Komponente hätte dort eingetragen werden müssen und die Arbeitspakete
 * verschränkt. Die Umbenennung gehört zum Kopfzeilen-Umbau.
 *
 * Hier steht bewusst KEINE punktuelle Größen-Angabe an den Umschaltern (früher
 * trug die Farbschema-Achse eine): beide hängen jetzt an der Steuerhöhe der
 * aktiven Stufe. Sie hier festzunageln wäre genau der Fehler, den die
 * Dichte-Staffel behebt.
 */
export default function ThemeToggle() {
  const { modus, setModus } = useThemeMode();
  const { dichte, setDichte } = useDichte();
  return (
    <ConfigProvider
      theme={{
        components: {
          Segmented: {
            trackBg: 'rgba(255,255,255,0.08)',
            itemColor: 'rgba(255,255,255,0.65)',
            itemHoverColor: '#fff',
            itemHoverBg: 'rgba(255,255,255,0.12)',
            itemSelectedBg: 'rgba(255,255,255,0.18)',
            itemSelectedColor: '#fff',
          },
        },
      }}
    >
      <Space size={4}>
        <Segmented<ThemeModus>
          value={modus}
          onChange={setModus}
          aria-label="Farbschema wählen"
          options={OPTIONEN.map(({ wert, titel, Icon }) => ({
            value: wert,
            label: etikett(titel, Icon),
          }))}
        />
        <Segmented<Dichte>
          value={dichte}
          onChange={setDichte}
          aria-label="Bediendichte wählen"
          options={DICHTE_OPTIONEN.map(({ wert, titel, Icon }) => ({
            value: wert,
            label: etikett(titel, Icon),
          }))}
        />
      </Space>
    </ConfigProvider>
  );
}
