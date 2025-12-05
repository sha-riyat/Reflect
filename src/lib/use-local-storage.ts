import { useEffect, useState } from "react";

export const useLocalStorageState = <T,>(
  key: string,
  defaultValue: T,
): readonly [T, (value: T | ((value: T) => T)) => void, boolean] => {
  const [state, setState] = useState<T>(defaultValue);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const existing =
        typeof window !== "undefined" ? localStorage.getItem(key) : null;
      if (existing) {
        setState(JSON.parse(existing));
      }
    } catch (error) {
      console.error("Impossible de lire le stockage local", error);
    } finally {
      setHydrated(true);
    }
  }, [key]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch (error) {
      console.error("Impossible d'écrire le stockage local", error);
    }
  }, [hydrated, key, state]);

  return [state, setState, hydrated] as const;
};
