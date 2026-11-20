import { describe, expect, it, vi } from 'vitest';
import { openWiederherstellung, subscribeWiederherstellung } from './wiederherstellungOeffnen';

describe('wiederherstellungOeffnen (LLH-1758)', () => {
  it('ruft jeden Abonnenten beim Öffnen, nach dem Abbestellen nicht mehr', () => {
    const hoerer = vi.fn();
    const abbestellen = subscribeWiederherstellung(hoerer);
    openWiederherstellung();
    expect(hoerer).toHaveBeenCalledTimes(1);
    abbestellen();
    openWiederherstellung();
    expect(hoerer).toHaveBeenCalledTimes(1);
  });
});
