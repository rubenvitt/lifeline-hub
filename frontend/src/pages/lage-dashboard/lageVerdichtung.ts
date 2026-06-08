import type { Person } from '../../api/types';

export interface SkVerteilung {
  sk1: number; sk2: number; sk3: number; sk4: number;
  tot: number; unverletzt: number;
  /** Personen ohne Sichtung (aktuelle_sichtung === null). */
  ohne: number;
}

export interface PersonStatusVerteilung {
  erfasst: number; vermisst: number; betroffen: number;
  verstorben: number; abgemeldet: number;
}

export interface BetroffeneVerdichtung {
  sk: SkVerteilung;
  status: PersonStatusVerteilung;
  /** Personen mit Sichtung SK I–IV (medizinisch/triage-relevant). */
  patienten: number;
  vermisst: number;
  gesamt: number;
}

export function verdichtePersonen(personen: Person[]): BetroffeneVerdichtung {
  const sk: SkVerteilung = { sk1: 0, sk2: 0, sk3: 0, sk4: 0, tot: 0, unverletzt: 0, ohne: 0 };
  const status: PersonStatusVerteilung = {
    erfasst: 0, vermisst: 0, betroffen: 0, verstorben: 0, abgemeldet: 0,
  };
  for (const p of personen) {
    if (p.aktuelle_sichtung === null) sk.ohne += 1;
    else sk[p.aktuelle_sichtung] += 1;
    status[p.status] += 1;
  }
  return {
    sk,
    status,
    patienten: sk.sk1 + sk.sk2 + sk.sk3 + sk.sk4,
    vermisst: status.vermisst,
    gesamt: personen.length,
  };
}
