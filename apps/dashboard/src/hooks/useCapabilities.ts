import { useContext } from 'react';
import { CapabilitiesContext } from '@/context/CapabilitiesContext';

export function useCapabilities() {
  const ctx = useContext(CapabilitiesContext);
  if (!ctx) throw new Error('useCapabilities must be inside CapabilitiesProvider');
  return ctx;
}
