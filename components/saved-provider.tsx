"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "contracthunter:saved";

interface SavedContextValue {
  isSaved: (id: string) => boolean;
  toggle: (id: string) => void;
  count: number;
  ready: boolean;
}

const SavedContext = createContext<SavedContextValue | null>(null);

/** Persists the set of saved/bookmarked contract ids in localStorage (single user). */
export function SavedProvider({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setSaved(new Set(JSON.parse(raw) as string[]));
    } catch {
      // ignore malformed storage
    }
    setReady(true);
  }, []);

  const toggle = useCallback((id: string) => {
    setSaved((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // ignore write failures (e.g. private mode)
      }
      return next;
    });
  }, []);

  const value: SavedContextValue = {
    isSaved: (id) => saved.has(id),
    toggle,
    count: saved.size,
    ready,
  };

  return <SavedContext.Provider value={value}>{children}</SavedContext.Provider>;
}

export function useSaved() {
  const ctx = useContext(SavedContext);
  if (!ctx) throw new Error("useSaved must be used within a SavedProvider");
  return ctx;
}
