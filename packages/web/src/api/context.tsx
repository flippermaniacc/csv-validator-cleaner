import { createContext, useContext, type ReactNode } from 'react';
import { createApiClient, type ApiClient } from './client';

const defaultClient = createApiClient();
const ApiContext = createContext<ApiClient>(defaultClient);

/** Lets tests and stories swap the client without module mocking. */
export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  return useContext(ApiContext);
}
