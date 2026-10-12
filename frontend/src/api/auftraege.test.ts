import { describe, expect, it } from 'vitest';
import { auftragAbschlussCursor } from './auftraege';
import type { Auftrag } from './types';

const auftrag = (over: Partial<Auftrag>): Auftrag =>
  ({
    id: 7,
    erstellt_at: '2026-10-12 08:00:00',
    vollzogen_at: null,
    abgenommen_at: null,
    ...over,
  }) as unknown as Auftrag;

describe('auftragAbschlussCursor', () => {
  it('ordnet wie der Server: aufgehoben, abgenommen, vollzogen, erstellt (LLH-1098)', () => {
    expect(auftragAbschlussCursor(auftrag({}))).toEqual({ zeit: '2026-10-12 08:00:00', id: 7 });
    expect(
      auftragAbschlussCursor(
        auftrag({ vollzogen_at: '2026-10-12 09:00:00', abgenommen_at: '2026-10-12 10:00:00' }),
      ),
    ).toEqual({ zeit: '2026-10-12 10:00:00', id: 7 });
    expect(
      auftragAbschlussCursor(
        auftrag({ vollzogen_at: '2026-10-12 09:00:00', aufgehoben_at: '2026-10-12 11:00:00' }),
      ),
    ).toEqual({ zeit: '2026-10-12 11:00:00', id: 7 });
  });
});
