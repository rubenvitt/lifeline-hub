import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderMitProviders } from '../test/utils';
import { dichten } from '../theme/tokens';
import DownloadAnker, { downloadAnkerStil } from './DownloadAnker';

/**
 * Trefflächenboden des handgebauten Bedienziels (LFH-365, Muster `bedienzielStil`). Geprüft
 * wird die reine Stilfunktion gegen die Dichtestufen aus `theme/tokens.ts` — `test/utils.tsx`
 * montiert ein nacktes `ConfigProvider`, eine gerenderte Höhe belegte antd-Vorgaben. Die Böden
 * stehen als LITERALE da, sonst prüfte der Token sich selbst.
 */
describe('downloadAnkerStil (LFH-21)', () => {
  const tokenFuer = (stufe: keyof typeof dichten) => ({
    controlHeight: dichten[stufe].zeilenhoehe,
    paddingXS: dichten[stufe].abstand.xs,
    fontWeightStrong: 600,
  });

  it('trägt den Boden aus controlHeight — 30 / 48 / 72 px', () => {
    expect(downloadAnkerStil(tokenFuer('kompakt')).minHeight).toBe(30);
    expect(downloadAnkerStil(tokenFuer('komfortabel')).minHeight).toBe(48);
    expect(downloadAnkerStil(tokenFuer('handschuh')).minHeight).toBe(72);
  });

  it('trägt ZWEI Angaben: neben dem Boden eine Polsterung, die mitzieht', () => {
    expect(downloadAnkerStil(tokenFuer('kompakt')).paddingBlock).toBe(3);
    expect(downloadAnkerStil(tokenFuer('komfortabel')).paddingBlock).toBe(5);
    expect(downloadAnkerStil(tokenFuer('kompakt')).boxSizing).toBe('border-box');
  });
});

describe('DownloadAnker', () => {
  it('ist ein nativer Download-Anker mit Dateinamen, Größe und Zusatzzeile', () => {
    renderMitProviders(
      <DownloadAnker
        href="/api/x/datei"
        dateiname="dach.jpg"
        groesse={2 * 1024 * 1024}
        zusatz="Leitung · 12:30"
        zugaenglicherName="dach.jpg, 2.0 MB, Datei von Schaden S-003 herunterladen"
      />,
    );
    const a = screen.getByRole('link', {
      name: 'dach.jpg, 2.0 MB, Datei von Schaden S-003 herunterladen',
    });
    expect(a).toHaveAttribute('href', '/api/x/datei');
    expect(a).toHaveAttribute('download', 'dach.jpg');
    expect(a).toHaveTextContent('dach.jpg');
    expect(a).toHaveTextContent('2.0 MB');
    expect(a).toHaveTextContent('Leitung · 12:30');
    // Review C2: das aria-label ersetzt den Inhalt im Namen — die Zusatzzeile bleibt als
    // Beschreibung erreichbar.
    expect(a).toHaveAccessibleDescription('Leitung · 12:30');
  });

  it('zeigt statt des Dateinamens einen eigenen Text, wenn er gesetzt ist', () => {
    renderMitProviders(<DownloadAnker href="/d" dateiname="plan.pdf" text="Lageplan Nord" />);
    const a = screen.getByRole('link', { name: 'Lageplan Nord' });
    expect(a).toHaveAttribute('download', 'plan.pdf');
  });
});
