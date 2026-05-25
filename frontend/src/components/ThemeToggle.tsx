import { Segmented, Tooltip } from 'antd';
import { FiMonitor, FiMoon, FiSun } from 'react-icons/fi';
import { useThemeMode, type ThemeModus } from '../theme/ThemeModeProvider';

const OPTIONEN = [
  { wert: 'system' as const, titel: 'System', Icon: FiMonitor },
  { wert: 'light' as const, titel: 'Hell', Icon: FiSun },
  { wert: 'dark' as const, titel: 'Dunkel', Icon: FiMoon },
];

/** Dreistufiger Theme-Umschalter (System / Hell / Dunkel) für die Topbar. */
export default function ThemeToggle() {
  const { modus, setModus } = useThemeMode();
  return (
    <Segmented<ThemeModus>
      size="small"
      value={modus}
      onChange={setModus}
      aria-label="Farbschema wählen"
      options={OPTIONEN.map(({ wert, titel, Icon }) => ({
        value: wert,
        label: (
          <Tooltip title={titel}>
            <Icon size={16} style={{ display: 'block', margin: '2px 0' }} aria-label={titel} />
          </Tooltip>
        ),
      }))}
    />
  );
}
