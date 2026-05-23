/** Fehler einer API-Antwort mit Nicht-2xx-Status. Trägt den Statuscode und die
 *  Server-Meldung aus dem `{ error }`-Format. Netzwerkfehler werden NICHT hierin
 *  verpackt (sie bleiben native TypeErrors) — so kann der Offline-Puffer sie von
 *  echten fachlichen Ablehnungen unterscheiden. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function fehlerWerfen(res: Response): Promise<never> {
  let message = `Serverfehler (${res.status})`;
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === 'string') message = body.error;
  } catch {
    // keine JSON-Antwort — generische Meldung beibehalten
  }
  throw new ApiError(res.status, message);
}

export async function apiGet<T>(pfad: string): Promise<T> {
  const res = await fetch(pfad, { credentials: 'same-origin' });
  if (!res.ok) return fehlerWerfen(res);
  return (await res.json()) as T;
}

export async function apiSend<T>(pfad: string, methode: string, body?: unknown): Promise<T> {
  const res = await fetch(pfad, {
    method: methode,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) return fehlerWerfen(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
