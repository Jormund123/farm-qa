import { create } from "zustand";

interface AppState {
  fileId?: string;
  fileName?: string;
  selectedFid?: number;
  setFile: (id: string, name: string) => void;
  select: (fid?: number) => void;
  reset: () => void;
}

export const useApp = create<AppState>((set) => ({
  setFile: (fileId, fileName) => set({ fileId, fileName, selectedFid: undefined }),
  select: (selectedFid) => set({ selectedFid }),
  reset: () => set({ fileId: undefined, fileName: undefined, selectedFid: undefined }),
}));
