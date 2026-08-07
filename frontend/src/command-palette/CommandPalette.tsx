// frontend/src/command-palette/CommandPalette.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Modal, Input, theme, type InputRef } from 'antd';
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
        <div id="cmd-liste" role="listbox" ref={listeRef} style={{ maxHeight: 380, overflowY: 'auto', padding: 8 }}>
          {flach.length === 0 && (
            <div style={{ padding: 16, color: token.colorTextSecondary }}>Keine Treffer</div>
          )}
          {gruppen.map((x) => (
            <div key={x.gruppe} role="group" aria-label={GRUPPEN_LABEL[x.gruppe]}>
              <div style={{ padding: '6px 8px', fontSize: 12, textTransform: 'uppercase', color: token.colorTextSecondary }}>
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
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                      borderRadius: 6, cursor: 'pointer',
                      background: istAktiv ? token.colorPrimaryBg : 'transparent',
                      color: istAktiv ? token.colorPrimary : token.colorText,
                    }}
                  >
                    {Icon && <Icon size={18} />}
                    <span>{b.label}</span>
                    {b.kuerzel && <kbd style={{ marginLeft: 'auto' }}>{b.kuerzel}</kbd>}
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
