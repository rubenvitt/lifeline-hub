import type { JSX } from 'react';
import type { ExtraProps } from 'react-markdown';
import { useThemeMode } from '../theme/ThemeModeProvider';
import { bildAdresse, dunklerVerweis } from './bilder';

/**
 * Bild in einem Kapitel der Hilfe (LFH-1128, `docs/anwender/AGENTS.md`, „Bilder“): setzt die
 * gebaute Adresse für den relativen Verweis aus dem Kapitel ein und lädt erst, wenn das Bild in
 * die Nähe des Sichtfelds kommt. Ohne Netz und ohne Cache-Eintrag zeigt der Browser den Alt-Text;
 * der Ablauf bleibt in seinen Schritten lesbar. Breite, Rahmen und Druck: `Hilfe.css`.
 *
 * Im Nachtbetrieb zeigt es die dunkle Fassung (`<name>.dunkel.png`), im Tagbetrieb die helle; so
 * sieht das Foto aus wie die App auf diesem Gerät. Fehlt die dunkle Fassung, bleibt es beim
 * hellen Bild.
 *
 * Ein Verweis, den die App nicht kennt, erscheint als Alt-Text statt als kaputtes Bild. Der
 * Wächter (`anwenderdoku.guard.test.ts`) lässt einen solchen Verweis gar nicht erst zu.
 */
export default function HilfeBild({ src, alt }: JSX.IntrinsicElements['img'] & ExtraProps) {
  const { effektiv } = useThemeMode();
  const verweis = typeof src === 'string' ? src : undefined;
  const hell = bildAdresse(verweis);
  if (!hell) return <span className="hilfe-bild hilfe-bild--fehlt">{alt}</span>;
  const adresse = (effektiv === 'dark' && bildAdresse(dunklerVerweis(verweis!))) || hell;
  return (
    <img className="hilfe-bild" src={adresse} alt={alt ?? ''} loading="lazy" decoding="async" />
  );
}
