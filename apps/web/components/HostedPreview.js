'use client';

import { createContext, useContext } from 'react';

const HostedPreviewContext = createContext(false);

export default function HostedPreview({ enabled = false, children }) {
  return (
    <HostedPreviewContext.Provider value={enabled === true}>
      {children}
    </HostedPreviewContext.Provider>
  );
}

export function useHostedPreview() {
  return useContext(HostedPreviewContext);
}
