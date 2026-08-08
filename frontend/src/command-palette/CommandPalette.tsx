// frontend/src/command-palette/CommandPalette.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Modal, Input, theme, type InputRef } from 'antd';
import Tastenkuerzel from '../components/Tastenkuerzel';
import { form } from '../theme/tokens';
import { filtereBefehle } from './fuzzy';
import { GRUPPEN_LABEL, GRUPPEN_REIHENFOLGE, type Befehl } from './typen';

interface Props {
  befehle: Befehl[];
  schliesse: () => void;
}

/** Präsentationale Palette: Suche + gruppierte, tastaturbedienbare Trefferliste. */
export function CommandPalette({ befehle, schliesse }: Props) {
  const { token } = theme.useToken();
  const [suche, setSuche] = useState('');
  const [aktiv, setAktiv] = useState(0);
  const listeRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<InputRef>(null);

  // Fokus sicherstellen: antd Modal kann den Fokus nach Mount verschieben.
  useEffect(() => { inputRef.current?.focus(); }, []);

  const treffer = useMemo(() => filtereBefehle(befehle, suche), [befehle, suche]);

  // In Gruppen-Reihenfolge anordnen; flache Liste = Navigationsreihenfolge.
  const gruppen = useMemo(
    () => GRUPPEN_REIHENFOLGE
      .map((g) => ({ gruppe: g, items: treffer.filter((b) => b.gruppe === g) }))
      .filter((x) => x.items.length > 0),
    [treffer],
  );
  const flach = useMemo(() => gruppen.flatMap((x) => x.items), [gruppen]);
  const indexVon = useMemo(() => new Map(flach.map((b, i) => [b.id, i])), [flach]);

  useEffect(() => { setAktiv(0); }, [suche]);

  // aktiven Eintrag in den Sichtbereich scrollen
  useEffect(() => {
    const el = listeRef.current?.querySelector('[aria-selected="true"]');
    if (el instanceof HTMLElement && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [aktiv]);

  function fuehreAus(b: Befehl | undefined) {
    if (!b) return;
    schliesse();
    b.ausfuehren();
  }

  function aufTaste(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setAktiv((i) => (flach.length ? (i + 1) % flach.length : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAktiv((i) => (flach.length ? (i - 1 + flach.length) % flach.length : 0)); }
    else if (e.key === 'Enter' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      fuehreAus(flach[aktiv]);
    }
  }

  const aktiverId = flach[aktiv]?.id;

  return (
    <Modal
      open
      keyboard={false}
      onCancel={schliesse}
      footer={null}
      closable={false}
      width={640}
      zIndex={2000}
      styles={{ body: { padding: 0 } }}
      destroyOnHidden
    >
      <div>
        <Input
          ref={inputRef}
          autoFocus
          variant="borderless"
          size="large"
          placeholder="Suchen: Module, Aktionen, Einstellungen …"
          role="combobox"
          aria-expanded={flach.length > 0}
          aria-controls="cmd-liste"
          aria-activedescendant={aktiverId ? `cmd-${aktiverId}` : undefined}
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
          onKeyDown={aufTaste}
          style={{ padding: '12px 16px', borderBottom: `1px solid ${token.colorBorderSecondary}` }}
        />
        <div
          id="cmd-liste"
          role="listbox"
          ref={listeRef}
          style={{ maxHeight: 380, overflowY: 'auto', padding: token.paddingXS }}
        >
          {flach.length === 0 && (
            <div style={{ padding: token.padding, color: token.colorTextSecondary }}>Keine Treffer</div>
          )}
          {gruppen.map((x) => (
            <div key={x.gruppe} role="group" aria-label={GRUPPEN_LABEL[x.gruppe]}>
              <div
                style={{
                  padding: `${token.paddingXS}px ${token.paddingSM}px`,
                  fontSize: token.fontSizeSM,
                  textTransform: 'uppercase',
                  // Versalien ohne Sperrung sind der Grund, warum eine
                  // Gruppenüberschrift „gedrängt" aussieht — LFH-352 hält den Wert
                  // als Formrolle, statt ihn je Stelle zu erfinden.
                  letterSpacing: form.versalSperrung,
                  color: token.colorTextSecondary,
                }}
              >
                {GRUPPEN_LABEL[x.gruppe]}
              </div>
              {x.items.map((b) => {
                const i = indexVon.get(b.id)!;
                const istAktiv = i === aktiv;
                const Icon = b.icon;
                return (
                  <div
                    key={b.id}
                    id={`cmd-${b.id}`}
                    role="option"
                    aria-selected={istAktiv}
                    onMouseEnter={() => setAktiv(i)}
                    onClick={() => fuehreAus(b)}
                    // Handgebautes Bedienziel (LFH-365): ZWEI Angaben, nicht eine —
                    // `minHeight` aus `controlHeight` plus Polsterung aus den
                    // Abstandsrollen. Die Palette ist seit LFH-335 der einzige
                    // Berührungsweg zu 42+ Befehlen; eine Zeile, die auf dem
                    // Führungs-Tablet 34 px hoch bleibt, verfehlt genau den Kontext,
                    // für den der sichtbare Auslöser gebaut wurde. Radius 0 statt des
                    // früheren Festwerts 6 ist die Formensprache aus LFH-352.
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: token.marginSM,
                      minHeight: token.controlHeight,
                      padding: `${token.paddingXS}px ${token.paddingSM}px`,
                      borderRadius: form.radiusFlaeche,
                      cursor: 'pointer',
                      background: istAktiv ? token.colorPrimaryBg : 'transparent',
                      color: istAktiv ? token.colorPrimary : token.colorText,
                    }}
                  >
                    {Icon && <Icon size={18} />}
                    <span>{b.label}</span>
                    {b.kuerzel && <Tastenkuerzel style={{ marginLeft: 'auto' }}>{b.kuerzel}</Tastenkuerzel>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
