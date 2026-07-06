"use client";

import { createContext, useContext } from "react";

const BenchmarkDisplayContext = createContext(false);

export function BenchmarkDisplayProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <BenchmarkDisplayContext.Provider value={enabled}>
      {children}
    </BenchmarkDisplayContext.Provider>
  );
}

export function useBenchmarkDisplayEnabled(): boolean {
  return useContext(BenchmarkDisplayContext);
}
