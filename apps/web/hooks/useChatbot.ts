import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ChatbotState {
  isOpen: boolean;
  isMuted: boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
  toggleMute: () => void;
  mute: () => void;
  unmute: () => void;
}

export const useChatbot = create<ChatbotState>()(
  persist(
    (set) => ({
      isOpen: false,
      isMuted: false,
      toggle: () => set((state) => ({ isOpen: !state.isOpen })),
      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      toggleMute: () => set((state) => ({ isMuted: !state.isMuted })),
      mute: () => set({ isMuted: true }),
      unmute: () => set({ isMuted: false }),
    }),
    {
      name: "chatbot-settings",
      partialize: (state) => ({ isMuted: state.isMuted }),
    },
  ),
);
