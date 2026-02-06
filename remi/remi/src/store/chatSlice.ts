import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import type { ChatMessage } from "../types";

export interface ChatState {
  messagesByPage: Record<string, ChatMessage[]>;
  selectedPageId: string;
}

const initialState: ChatState = {
  messagesByPage: {},
  selectedPageId: "default",
};

interface AddMessagePayload {
  pageId: string;
  message: ChatMessage;
}

const chatSlice = createSlice({
  name: "chat",
  initialState,
  reducers: {
    setSelectedPageId(state, action: PayloadAction<string>) {
      state.selectedPageId = action.payload || "default";
    },
    addMessage(state, action: PayloadAction<AddMessagePayload>) {
      const { pageId, message } = action.payload;
      const pid = pageId || state.selectedPageId || "default";
      if (!state.messagesByPage[pid]) state.messagesByPage[pid] = [];
      state.messagesByPage[pid]!.push(message);
    },
    clearChat(state, action: PayloadAction<string | undefined>) {
      const pid = action.payload || state.selectedPageId || "default";
      state.messagesByPage[pid] = [];
    },
  },
});

export const { setSelectedPageId, addMessage, clearChat } = chatSlice.actions;
export default chatSlice.reducer;
