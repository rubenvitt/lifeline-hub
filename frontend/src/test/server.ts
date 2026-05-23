import { setupServer } from 'msw/node';

/** Geteilte MSW-Server-Instanz; Handler werden pro Test via server.use() gesetzt. */
export const server = setupServer();
