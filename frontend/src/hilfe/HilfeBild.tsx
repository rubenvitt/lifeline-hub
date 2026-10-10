import type { JSX } from 'react';
import type { ExtraProps } from 'react-markdown';
import { bildAdresse } from './bilder';

/**
 * Bild in einem Kapitel der Hilfe (LFH-1128, `docs/anwender/AGENTS.md`, „Bilder“): setzt die
 * gebaute Adresse für den relativen Verweis aus dem Kapitel ein und lädt erst, wenn das Bild in
 * die Nähe des Sichtfelds kommt. Ohne Netz und ohne Cache-Eintrag zeigt der Browser den Alt-Text;
 * der Ablauf bleibt in seinen Schritten lesbar. Breite, Rahmen und Druck: `Hilfe.css`.
 *
 * Ein Verweis, den die App nicht kennt, erscheint als Alt-Text statt als kaputtes Bild. Der
 * Wächter (`anwenderdoku.guard.test.ts`) lässt einen solchen Verweis gar nicht erst zu.
 */
export default function HilfeBild({ src, alt }: JSX.IntrinsicElements['img'] & ExtraProps) {
  const adresse = bildAdresse(typeof src === 'string' ? src : undefined);
  if (!adresse) return <span className="hilfe-bild hilfe-bild--fehlt">{alt}</span>;
  return (
    <img className="hilfe-bild" src={adresse} alt={alt ?? ''} loading="lazy" decoding="async" />
  );
}
