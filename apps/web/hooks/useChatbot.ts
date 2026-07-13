import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ChatbotState {
  isOpen: boolean;
  isMuted: boolean;
  /** True when the backend denied chat access for this session (e.g. the
   * learner's group has no link to the assignment). Hides the chat UI
   * entirely instead of surfacing an error on every mount. Deliberately not
   * persisted: access may be restored on the next launch. */
  isUnavailable: boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
  markUnavailable: () => void;
  toggleMute: () => void;
  mute: () => void;
  unmute: () => void;
}

export const useChatbot = create<ChatbotState>()(
  persist(
    (set) => ({
      isOpen: false,
      isMuted: false,
      isUnavailable: false,
      toggle: () => set((state) => ({ isOpen: !state.isOpen })),
      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      markUnavailable: () => set({ isUnavailable: true, isOpen: false }),
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
