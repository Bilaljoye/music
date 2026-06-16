export interface User {
  id: string;
  username: string;
  isAdmin: boolean;
}

export interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: number;
}

export interface RoomState {
  code: string;
  adminId: string;
  adminUsername: string;
  users: User[];
  videoUrl: string | null;
  videoStatus: 'playing' | 'paused' | 'stopped';
  currentTime: number;
  lastUpdated: number;
  chatHistory: ChatMessage[];
}

export type SocketMessage =
  | { type: 'ERROR'; payload: { message: string } }
  | { type: 'ROOM_CREATED'; payload: { roomCode: string; roomState: RoomState } }
  | { type: 'ROOM_JOINED'; payload: { roomCode: string; roomState: RoomState; userId: string } }
  | { type: 'ROOM_UPDATED'; payload: { roomState: RoomState } }
  | { type: 'CHAT_RECEIVED'; payload: { chat: ChatMessage } }
  | { type: 'USER_LEFT'; payload: { username: string; roomState: RoomState } }
  | { type: 'USER_JOINED'; payload: { username: string; roomState: RoomState } }
  | { type: 'CREATE_ROOM'; payload: { username: string } }
  | { type: 'JOIN_ROOM'; payload: { roomCode: string; username: string } }
  | { type: 'LEAVE_ROOM' }
  | { type: 'SET_VIDEO'; payload: { url: string } }
  | { type: 'SYNC_PLAY'; payload: { currentTime: number } }
  | { type: 'SYNC_PAUSE'; payload: { currentTime: number } }
  | { type: 'SYNC_SEEK'; payload: { currentTime: number } }
  | { type: 'SEND_CHAT'; payload: { text: string } };
