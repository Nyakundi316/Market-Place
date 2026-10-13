import { create } from 'zustand';

const TYPING_TTL_MS = 6_000; // a lost "stopped typing" shouldn't leave the dots up forever

interface ChatState {
  connected: boolean;
  /** conversationId → when the other person last said they were typing */
  typing: Record<string, number>;
  /** the thread on screen, so incoming messages there don't bump the unread badge */
  openConversation: string | null;
  setConnected: (connected: boolean) => void;
  setTyping: (conversationId: string, isTyping: boolean) => void;
  setOpen: (conversationId: string | null) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  connected: false,
  typing: {},
  openConversation: null,
  setConnected: (connected) => set({ connected }),
  setTyping: (conversationId, isTyping) => {
    const at = Date.now();
    set((s) => {
      const typing = { ...s.typing };
      if (isTyping) typing[conversationId] = at;
      else delete typing[conversationId];
      return { typing };
    });
    // Expire on our own if the "stopped" event never arrives, unless it was renewed.
    if (isTyping) {
      setTimeout(() => {
        if (useChatStore.getState().typing[conversationId] === at) {
          useChatStore.getState().setTyping(conversationId, false);
        }
      }, TYPING_TTL_MS);
    }
  },
  setOpen: (openConversation) => set({ openConversation }),
}));

export const isTypingNow = (at: number | undefined, now = Date.now()) =>
  at !== undefined && now - at < TYPING_TTL_MS;
