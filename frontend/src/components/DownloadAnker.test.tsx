import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderMitProviders } from '../test/utils';
import { dichten } from '../theme/tokens';
import DownloadAnker, { downloadAnkerStil, ORIGINAL_TEXT } from './DownloadAnker';

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
    // Das aria-label ersetzt den Inhalt im Namen — die Zusatzzeile bleibt als Beschreibung
    // erreichbar.
    expect(a).toHaveAccessibleDescription('Leitung · 12:30');
  });

  it('zeigt statt des Dateinamens einen eigenen Text, wenn er gesetzt ist', () => {
    renderMitProviders(<DownloadAnker href="/d" dateiname="plan.pdf" text="Lageplan Nord" />);
    const a = screen.getByRole('link', { name: 'Lageplan Nord' });
    expect(a).toHaveAttribute('download', 'plan.pdf');
  });
});

describe('DownloadAnker — Original-Verweis (LFH-747)', () => {
  it('steht nicht da, solange originalHref fehlt', () => {
    renderMitProviders(<DownloadAnker href="/api/x/datei" dateiname="dach.jpg" />);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByText(ORIGINAL_TEXT)).toBeNull();
  });

  it('steht mit originalHref neben dem Hauptverweis, mit Download und eigenem Namen', () => {
    renderMitProviders(
      <DownloadAnker
        href="/api/x/datei"
        dateiname="dach.jpg"
        originalHref="/api/x/datei?fassung=original"
      />,
    );
    expect(screen.getAllByRole('link')).toHaveLength(2);
    const haupt = screen.getByRole('link', { name: 'dach.jpg' });
    expect(haupt).toHaveAttribute('href', '/api/x/datei');
    const original = screen.getByRole('link', {
      name: 'dach.jpg: Original mit Standort- und Gerätedaten herunterladen',
    });
    expect(original).toHaveAttribute('href', '/api/x/datei?fassung=original');
    expect(original).toHaveAttribute('download', 'dach.original.jpg');
    expect(original).toHaveTextContent(ORIGINAL_TEXT);
  });

  it('trägt die Zeilenkennung im zugänglichen Namen', () => {
    renderMitProviders(
      <DownloadAnker
        href="/d"
        dateiname="IMG_0001.jpg"
        originalHref="/d?fassung=original"
        originalKennung="IMG_0001.jpg, Schaden S-003"
      />,
    );
    expect(
      screen.getByRole('link', {
        name: 'IMG_0001.jpg, Schaden S-003: Original mit Standort- und Gerätedaten herunterladen',
      }),
    ).toBeInTheDocument();
  });

  it('hält denselben Trefflächenboden wie der Hauptverweis', () => {
    renderMitProviders(
      <DownloadAnker href="/d" dateiname="a.jpg" originalHref="/d?fassung=original" />,
    );
    const original = screen.getByText(ORIGINAL_TEXT);
    const haupt = screen.getByRole('link', { name: 'a.jpg' });
    expect(original.style.minHeight).not.toBe('');
    expect(original.style.minHeight).toBe(haupt.style.minHeight);
    expect(original.style.paddingBlock).toBe(haupt.style.paddingBlock);
  });
});
