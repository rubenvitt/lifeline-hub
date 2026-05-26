import { ConfigProvider, Segmented, Tooltip } from 'antd';
import { FiMonitor, FiMoon, FiSun } from 'react-icons/fi';
import { useThemeMode, type ThemeModus } from '../theme/ThemeModeProvider';

const OPTIONEN = [
  { wert: 'system' as const, titel: 'System', Icon: FiMonitor },
  { wert: 'light' as const, titel: 'Hell', Icon: FiSun },
  { wert: 'dark' as const, titel: 'Dunkel', Icon: FiMoon },
];

/**
 * Dreistufiger Theme-Umschalter (System / Hell / Dunkel) für die Topbar.
 * Der Header ist in beiden Modi dunkel, deshalb wird der Segmented per
 * lokalem ConfigProvider auf den dunklen Grund abgestimmt (transluzenter
 * Track, weiße Icons) — statt als heller Kasten herauszustechen.
 */
export default function ThemeToggle() {
  const { modus, setModus } = useThemeMode();
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
      <Segmented<ThemeModus>
        size="small"
        value={modus}
        onChange={setModus}
        aria-label="Farbschema wählen"
        options={OPTIONEN.map(({ wert, titel, Icon }) => ({
          value: wert,
          // Icon als inline-flex zentrieren: das Segmented-Label richtet seinen
          // Inhalt über line-height aus, was nur für Inline-Inhalt greift. Ein
          // Block-Icon säße sonst oben im Label-Kasten (wirkt zu hoch).
          label: (
            <Tooltip title={titel}>
              <span
                aria-label={titel}
                style={{ display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle' }}
              >
                <Icon size={16} />
              </span>
            </Tooltip>
          ),
        }))}
      />
    </ConfigProvider>
  );
}
