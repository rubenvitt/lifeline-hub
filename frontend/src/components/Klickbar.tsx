import type { HTMLAttributes, KeyboardEventHandler, MouseEventHandler, ReactNode } from 'react';

type KlickbareZeileProps = Omit<HTMLAttributes<HTMLDivElement>, 'onClick' | 'onKeyDown' | 'role' | 'tabIndex'> & {
  children: ReactNode;
  onAktivieren: () => void;
};

const INTERAKTIVE_KINDELEMENTE = [
  'a[href]',
  'area[href]',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="combobox"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="textbox"]',
].join(', ');

/** Aktiviert eine Button-semantische Auswahlzeile nur mit Enter oder Space. */
export function aufTaste(aktion: () => void): KeyboardEventHandler<HTMLElement> {
  return (ereignis) => {
    if (ereignis.key !== 'Enter' && ereignis.key !== ' ') return;
    ereignis.preventDefault();
    aktion();
  };
}

function stammtAusInteraktivemKind(ereignis: Parameters<MouseEventHandler<HTMLElement>>[0] | Parameters<KeyboardEventHandler<HTMLElement>>[0]) {
  const ziel = ereignis.target;
  if (!(ziel instanceof Element) || ziel === ereignis.currentTarget) return false;
  const interaktivesElement = ziel.closest(INTERAKTIVE_KINDELEMENTE);
  return interaktivesElement != null && interaktivesElement !== ereignis.currentTarget;
}

/** Fokussierbare Auswahlzeile; Navigation bleibt ein nativer Link. */
export function KlickbareZeile({ children, onAktivieren, ...props }: KlickbareZeileProps) {
  const taste = aufTaste(onAktivieren);

  return (
    <div
      {...props}
      role="button"
      tabIndex={0}
      onClick={(ereignis) => {
        if (!stammtAusInteraktivemKind(ereignis)) onAktivieren();
      }}
      onKeyDown={(ereignis) => {
        if (!stammtAusInteraktivemKind(ereignis)) taste(ereignis);
      }}
    >
      {children}
    </div>
  );
}
