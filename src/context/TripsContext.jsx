import { createContext, useContext } from 'react';
import { useTrips } from '../hooks/useTrips';

const TripsContext = createContext(null);

export function TripsProvider({ children }) {
  const api = useTrips();
  return <TripsContext.Provider value={api}>{children}</TripsContext.Provider>;
}

export function useTripsContext() {
  return useContext(TripsContext);
}
