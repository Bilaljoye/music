/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Play,
  Pause,
  Share2,
  Users,
  Music,
  Send,
  Volume2,
  Tv,
  LogOut,
  AlertCircle,
  Copy,
  Plus,
  Radio,
  Sparkles,
  Link as LinkIcon,
  Crown,
  Hash,
  HelpCircle,
  Clock,
  User as UserIcon,
  TrendingUp,
  Upload,
  FileAudio
} from 'lucide-react';
import { RoomState, User, ChatMessage, SocketMessage } from './types';

// Extract YouTube Video ID from any URL
function extractYouTubeId(url: string): string | null {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
}

// Check if URL is an uploaded device media file
function isUploadUrl(url: string | null): boolean {
  if (!url) return false;
  return url.startsWith('/uploads/') || url.startsWith('blob:') || (url.startsWith('http') && !extractYouTubeId(url));
}

// Check if uploaded file is pure audio
function isAudioFile(url: string | null): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return lower.endsWith('.mp3') || lower.endsWith('.wav') || lower.endsWith('.ogg') || lower.endsWith('.m4a') || lower.endsWith('.aac');
}

// Get high-fidelity filename decoration from uploaded URLs
function getFilename(url: string | null): string {
  if (!url) return '';
  const index = url.lastIndexOf('/');
  if (index === -1) return url;
  const raw = url.substring(index + 1);
  return decodeURIComponent(raw).replace(/^device-\d+-\d+-/, '');
}

const PRELOADED_VIDEOS = [
  {
    title: "Synthwave Radio 🌌 Lofi Beats",
    url: "https://www.youtube.com/watch?v=4xDzrJKXOOY",
    category: "Chill / Beats"
  },
  {
    title: "Lofi Hip Hop Radio ☕ Beats to Relax/Study",
    url: "https://www.youtube.com/watch?v=jfKfPfyJRdk",
    category: "Focus / Study"
  },
  {
    title: "Retro Ambient Space Music 🚀 Cosmic Journey",
    url: "https://www.youtube.com/watch?v=2Kff0Oh2_80",
    category: "Ambient / Space"
  },
  {
    title: "Upbeat Jazz instrumental 🎷 Coffee Shop Vibes",
    url: "https://www.youtube.com/watch?v=S0uA0vG6A60",
    category: "Acoustic / Jazz"
  }
];

export default function App() {
  // Views: 'LOGIN' | 'DASHBOARD' | 'ROOM'
  const [view, setView] = useState<'LOGIN' | 'DASHBOARD' | 'ROOM'>('LOGIN');
  const [username, setUsername] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  
  const [userId, setUserId] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  
  const [videoUrlInput, setVideoUrlInput] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // YouTube player instances and state variables
  const playerRef = useRef<any>(null);
  const html5PlayerRef = useRef<HTMLVideoElement | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [localCurrentTime, setLocalCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  
  // Controls to prevent sync cycle loopings
  const localActionRef = useRef<boolean>(false);
  const roomStateRef = useRef<RoomState | null>(null);
  const userIdRef = useRef<string>('');

  // WebSocket reference
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  // Scroll target for Chat Box
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Keep references updated for WebSocket loops
  roomStateRef.current = roomState;
  userIdRef.current = userId;

  // Initialize and keep WebSockets active
  const connectWebSocket = () => {
    if (wsRef.current) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Dynamic URL works both in dev environment and production spaces
    const wsUrl = `${protocol}//${window.location.host}`;
    
    console.log("Connecting WebSocket to", wsUrl);
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log("WebSocket connection established successfully.");
      setConnected(true);
      setErrorMsg('');
    };

    ws.onclose = () => {
      console.log("WebSocket server disconnected, schedule reconnect.");
      setConnected(false);
      wsRef.current = null;
      // Reconnect after 3 seconds
      setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = (error) => {
      console.error("WebSocket client error:", error);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as SocketMessage;
        console.log("Message received client:", message.type);

        switch (message.type) {
          case 'ROOM_CREATED': {
            setRoomCode(message.payload.roomCode);
            setRoomState(message.payload.roomState);
            setUserId(message.payload.roomState.adminId);
            setView('ROOM');
            setIsLoading(false);
            showSuccess("Room created successfully!");
            break;
          }

          case 'ROOM_JOINED': {
            setRoomCode(message.payload.roomCode);
            setRoomState(message.payload.roomState);
            setUserId(message.payload.userId);
            setView('ROOM');
            setIsLoading(false);
            showSuccess("Joined music room!");
            break;
          }

          case 'ROOM_UPDATED': {
            handleRoomStateUpdate(message.payload.roomState);
            break;
          }

          case 'USER_JOINED': {
            setRoomState(message.payload.roomState);
            break;
          }

          case 'USER_LEFT': {
            setRoomState(message.payload.roomState);
            break;
          }

          case 'CHAT_RECEIVED': {
            setRoomState((prev) => {
              if (!prev) return null;
              return {
                ...prev,
                chatHistory: [...prev.chatHistory, message.payload.chat]
              };
            });
            break;
          }

          case 'ERROR': {
            showError(message.payload.message);
            setIsLoading(false);
            break;
          }
        }
      } catch (err) {
        console.error("Error handling server broadcats:", err);
      }
    };

    wsRef.current = ws;
  };

  // Helper helper to send ws events safely
  const sendWsMessage = (message: SocketMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      showError("Connection lost. Trying to reconnect...");
    }
  };

  useEffect(() => {
    connectWebSocket();
    return () => {
      // Cleanup on unmount
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // Show status error
  const showError = (text: string) => {
    setErrorMsg(text);
    setTimeout(() => setErrorMsg(''), 5000);
  };

  // Show status success
  const showSuccess = (text: string) => {
    setSuccessMsg(text);
    setTimeout(() => setSuccessMsg(''), 4500);
  };

  // Load YouTube Player API programmatically
  useEffect(() => {
    if (!(window as any).YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
    }
  }, []);

  // Setup periodic polling for synchronized guest stream checking
  useEffect(() => {
    const syncInterval = setInterval(() => {
      const state = roomStateRef.current;
      const uId = userIdRef.current;
      
      if (!state) return;

      const isAdmin = state.adminId === uId;
      const isUploaded = isUploadUrl(state.videoUrl);

      // If we are playing an uploaded file via HTML5
      if (isUploaded) {
        if (!html5PlayerRef.current) return;
        const h5 = html5PlayerRef.current;

        try {
          if (!isAdmin) {
            // GUEST SYNCHRONIZATION ALGORITHM FOR UPLOADS
            if (state.videoStatus === 'playing') {
              const timePassedSinceUpdate = (Date.now() - state.lastUpdated) / 1000;
              const expectedTime = state.currentTime + timePassedSinceUpdate;

              if (Math.abs(h5.currentTime - expectedTime) > 3) {
                console.log(`[SYNCHRONIZER] Guest uploaded-file drift alert (${Math.abs(h5.currentTime - expectedTime).toFixed(1)}s), resolving...`);
                h5.currentTime = expectedTime;
              }
              if (h5.paused) {
                h5.play().catch(() => {});
              }
            } else if (state.videoStatus === 'paused') {
              if (!h5.paused) {
                h5.pause();
              }
              if (Math.abs(h5.currentTime - state.currentTime) > 1.5) {
                h5.currentTime = state.currentTime;
              }
            }
          }
        } catch (err) {
          console.error("HTML5 Sync error:", err);
        }
        return;
      }

      // OTHERWISE: Standard YouTube synchronization
      if (!playerRef.current || !playerReady) return;
      if (typeof playerRef.current.getPlayerState !== 'function') return;

      try {
        const playerState = playerRef.current.getPlayerState();
        const currentPlayTime = playerRef.current.getCurrentTime() || 0;

        if (!isAdmin) {
          // GUEST SYNCHRONIZATION ALGORITHM FOR YOUTUBE
          if (state.videoStatus === 'playing') {
            // Calculate where host currently is based on last updated timestamp + drift
            const timePassedSinceUpdate = (Date.now() - state.lastUpdated) / 1000;
            const expectedTime = state.currentTime + timePassedSinceUpdate;

            // If guest's stream gets behind or ahead by more than 3 seconds, force seek
            if (Math.abs(currentPlayTime - expectedTime) > 3) {
              console.log(`[SYNCHRONIZER] Guest drift alert (${Math.abs(currentPlayTime - expectedTime).toFixed(1)}s), resolving...`);
              localActionRef.current = true;
              playerRef.current.seekTo(expectedTime, true);
            }

            // If player is paused/stopped but host is playing, resume player
            if (playerState !== 1) {
              localActionRef.current = true;
              playerRef.current.playVideo();
            }
          } else if (state.videoStatus === 'paused') {
            // If player is playing but host is pausing, pause user playback
            if (playerState === 1) {
              localActionRef.current = true;
              playerRef.current.pauseVideo();
            }
            // Keep locked to host seek seconds
            if (Math.abs(currentPlayTime - state.currentTime) > 2) {
              localActionRef.current = true;
              playerRef.current.seekTo(state.currentTime, true);
            }
          }
        }
      } catch (err) {
        console.error("Critical playing sync error:", err);
      }
    }, 2000);

    return () => clearInterval(syncInterval);
  }, [playerReady]);

  // Keep seek sliders updated
  useEffect(() => {
    const sliderInterval = setInterval(() => {
      const isUploaded = isUploadUrl(roomStateRef.current?.videoUrl);
      if (isUploaded && html5PlayerRef.current) {
        try {
          setLocalCurrentTime(html5PlayerRef.current.currentTime || 0);
          setVideoDuration(html5PlayerRef.current.duration || 0);
        } catch (e) {}
      } else if (playerRef.current && playerReady) {
        try {
          if (typeof playerRef.current.getCurrentTime === 'function') {
            setLocalCurrentTime(playerRef.current.getCurrentTime() || 0);
            setVideoDuration(playerRef.current.getDuration() || 0);
          }
        } catch (e) {}
      }
    }, 500);
    return () => clearInterval(sliderInterval);
  }, [playerReady, roomState?.videoUrl]);

  // Handle incoming room state changes from the server
  const handleRoomStateUpdate = (newRoomState: RoomState) => {
    const isUploaded = isUploadUrl(newRoomState.videoUrl);
    const oldVideoId = roomState ? extractYouTubeId(roomState.videoUrl || '') : null;
    const newVideoId = extractYouTubeId(newRoomState.videoUrl || '');

    setRoomState(newRoomState);

    // If new url, reload player
    if (isUploaded) {
      if (newRoomState.videoUrl !== roomState?.videoUrl) {
        console.log("[MUSICA] Synchronizing new HTML5 device play url:", newRoomState.videoUrl);
        setLocalCurrentTime(newRoomState.currentTime || 0);
        if (html5PlayerRef.current) {
          html5PlayerRef.current.currentTime = newRoomState.currentTime || 0;
        }
      } else if (html5PlayerRef.current) {
        try {
          const h5 = html5PlayerRef.current;
          if (newRoomState.videoStatus === 'playing') {
            if (h5.paused) {
              h5.play().catch(() => {});
            }
          } else if (newRoomState.videoStatus === 'paused') {
            if (!h5.paused) {
              h5.pause();
            }
            if (Math.abs(h5.currentTime - newRoomState.currentTime) > 1.5) {
              h5.currentTime = newRoomState.currentTime;
            }
          }
        } catch (e) {
          console.error("HTML5 player syncing error:", e);
        }
      }
    } else {
      if (newVideoId && newVideoId !== oldVideoId) {
        console.log("[MUSICA] Synchronizing new video ID:", newVideoId);
        setupPlayer(newVideoId, newRoomState.currentTime, newRoomState.videoStatus === 'playing');
      } else if (playerRef.current && playerReady) {
        // Sync events like play / pause
        try {
          const playerState = playerRef.current.getPlayerState();
          if (newRoomState.videoStatus === 'playing') {
            if (playerState !== 1) {
              localActionRef.current = true;
              playerRef.current.playVideo();
            }
          } else if (newRoomState.videoStatus === 'paused') {
            if (playerState === 1) {
              localActionRef.current = true;
              playerRef.current.pauseVideo();
            }
            localActionRef.current = true;
            playerRef.current.seekTo(newRoomState.currentTime, true);
          }
        } catch (e) {
          console.error("State syncer error:", e);
        }
      }
    }
  };

  // Create or rebuild YouTube video frame player
  const setupPlayer = (videoId: string, startTime: number = 0, autoPlay: boolean = false) => {
    setPlayerReady(false);
    if (!(window as any).YT || !(window as any).YT.Player) {
      setTimeout(() => setupPlayer(videoId, startTime, autoPlay), 300);
      return;
    }

    if (playerRef.current) {
      try {
        playerRef.current.destroy();
      } catch (e) {
        console.log("Error destroying old frame:", e);
      }
    }

    playerRef.current = new (window as any).YT.Player('musica-yt-frame', {
      height: '100%',
      width: '100%',
      videoId: videoId,
      playerVars: {
        autoplay: autoPlay ? 1 : 0,
        controls: 1,
        rel: 0,
        modestbranding: 1,
        start: Math.floor(startTime),
      },
      events: {
        onReady: (event: any) => {
          setPlayerReady(true);
          setVideoDuration(event.target.getDuration() || 0);
          if (autoPlay) {
            event.target.playVideo();
          } else {
            event.target.pauseVideo();
          }
        },
        onStateChange: (event: any) => {
          const state = event.data;
          const isHost = roomStateRef.current?.adminId === userIdRef.current;

          if (isHost) {
            if (localActionRef.current) {
              localActionRef.current = false;
              return; // Prevent websocket echo
            }

            const currentPlaybackTime = event.target.getCurrentTime() || 0;
            if (state === 1) { // Normal Play
              sendWsMessage({ type: 'SYNC_PLAY', payload: { currentTime: currentPlaybackTime } });
            } else if (state === 2) { // Normal Pause
              sendWsMessage({ type: 'SYNC_PAUSE', payload: { currentTime: currentPlaybackTime } });
            }
          } else {
            // Guest clicked play or pause: warn them host controls play times
            if (!localActionRef.current && (state === 1 || state === 2)) {
              showSuccess("Synchronized with Host. Playback is controlled by the Host.");
            }
            localActionRef.current = false;
          }
        }
      }
    });
  };

  // Login handler
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      showError("Please enter a username to explore Musica Space.");
      return;
    }
    setView('DASHBOARD');
  };

  // Create room
  const handleCreateRoom = () => {
    setIsLoading(true);
    sendWsMessage({
      type: 'CREATE_ROOM',
      payload: { username }
    });
  };

  // Join room
  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomCodeInput.trim().length !== 6) {
      showError("Please provide a valid 6-digit invitation room code.");
      return;
    }
    setIsLoading(true);
    sendWsMessage({
      type: 'JOIN_ROOM',
      payload: { roomCode: roomCodeInput.trim(), username }
    });
  };

  // Update room video URL
  const handleSetVideo = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUrl = videoUrlInput.trim();
    if (!cleanUrl) return;

    const vidId = extractYouTubeId(cleanUrl);
    if (!vidId) {
      showError("Could not extract YouTube details. Check link coordinates.");
      return;
    }

    sendWsMessage({
      type: 'SET_VIDEO',
      payload: { url: cleanUrl }
    });
    setVideoUrlInput('');
  };

  // Quick select video from suggested list
  const handleSelectSuggested = (url: string) => {
    if (roomState?.adminId !== userId) return;
    sendWsMessage({
      type: 'SET_VIDEO',
      payload: { url }
    });
  };

  // Upload media from local device using multi-part endpoint
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    setUploading(true);

    const formData = new FormData();
    formData.append("mediaFile", file);

    try {
      showSuccess(`Uploading "${file.name}" to room server...`);
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Failed to upload file to the server.");
      }

      const data = await response.json();
      showSuccess(`Broadcasted "${file.name}" successfully!`);

      // Once uploaded, host updates the roomState's videoUrl with the response URL
      sendWsMessage({
        type: 'SET_VIDEO',
        payload: { url: data.url }
      });
    } catch (err: any) {
      console.error(err);
      showError(err.message || "An error occurred while uploading. Please check original media metadata.");
    } finally {
      setUploading(false);
    }
  };

  // Admin Play control
  const handleAdminPlay = () => {
    const isUploaded = isUploadUrl(roomState?.videoUrl);
    if (isUploaded) {
      if (!html5PlayerRef.current) return;
      try {
        const curTime = html5PlayerRef.current.currentTime || 0;
        html5PlayerRef.current.play().catch(() => {});
        sendWsMessage({ type: 'SYNC_PLAY', payload: { currentTime: curTime } });
      } catch (e) {}
    } else {
      if (!playerRef.current || !playerReady) return;
      try {
        const curTime = playerRef.current.getCurrentTime() || 0;
        localActionRef.current = true;
        playerRef.current.playVideo();
        sendWsMessage({ type: 'SYNC_PLAY', payload: { currentTime: curTime } });
      } catch (e) {}
    }
  };

  // Admin Pause control
  const handleAdminPause = () => {
    const isUploaded = isUploadUrl(roomState?.videoUrl);
    if (isUploaded) {
      if (!html5PlayerRef.current) return;
      try {
        const curTime = html5PlayerRef.current.currentTime || 0;
        html5PlayerRef.current.pause();
        sendWsMessage({ type: 'SYNC_PAUSE', payload: { currentTime: curTime } });
      } catch (e) {}
    } else {
      if (!playerRef.current || !playerReady) return;
      try {
        const curTime = playerRef.current.getCurrentTime() || 0;
        localActionRef.current = true;
        playerRef.current.pauseVideo();
        sendWsMessage({ type: 'SYNC_PAUSE', payload: { currentTime: curTime } });
      } catch (e) {}
    }
  };

  // Seek bar scroll
  const handleSeekChange = (seekSeconds: number) => {
    if (roomState?.adminId !== userId) return;
    const isUploaded = isUploadUrl(roomState?.videoUrl);
    if (isUploaded) {
      if (!html5PlayerRef.current) return;
      try {
        html5PlayerRef.current.currentTime = seekSeconds;
        setLocalCurrentTime(seekSeconds);
        sendWsMessage({ type: 'SYNC_SEEK', payload: { currentTime: seekSeconds } });
      } catch (e) {}
    } else {
      if (!playerRef.current || !playerReady) return;
      try {
        localActionRef.current = true;
        playerRef.current.seekTo(seekSeconds, true);
        sendWsMessage({ type: 'SYNC_SEEK', payload: { currentTime: seekSeconds } });
      } catch (e) {}
    }
  };

  // Host manual sync trigger (Forces sync updates downstream)
  const handleForceSync = () => {
    const isUploaded = isUploadUrl(roomState?.videoUrl);
    if (isUploaded) {
      if (!html5PlayerRef.current) return;
      try {
        const curTime = html5PlayerRef.current.currentTime || 0;
        const isPlaying = !html5PlayerRef.current.paused;
        if (isPlaying) {
          sendWsMessage({ type: 'SYNC_PLAY', payload: { currentTime: curTime } });
        } else {
          sendWsMessage({ type: 'SYNC_PAUSE', payload: { currentTime: curTime } });
        }
        showSuccess("Synchronized track frame timestamp with all spectators!");
      } catch (e) {}
    } else {
      if (!playerRef.current || !playerReady) return;
      try {
        const curTime = playerRef.current.getCurrentTime() || 0;
        const curState = playerRef.current.getPlayerState();
        
        const isPlayState = curState === 1; // Playing
        if (isPlayState) {
          sendWsMessage({ type: 'SYNC_PLAY', payload: { currentTime: curTime } });
        } else {
          sendWsMessage({ type: 'SYNC_PAUSE', payload: { currentTime: curTime } });
        }
        showSuccess("Synchronized track frame timestamp with all spectators!");
      } catch (e) {}
    }
  };

  // Send message inside Chat Box
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    sendWsMessage({
      type: 'SEND_CHAT',
      payload: { text: chatInput.trim() }
    });
    setChatInput('');
  };

  // Exit Room helper
  const handleLeaveRoom = () => {
    sendWsMessage({ type: 'LEAVE_ROOM' });
    setView('DASHBOARD');
    setRoomCode('');
    setRoomState(null);
    if (playerRef.current) {
      try {
        playerRef.current.destroy();
      } catch (e) {}
      playerRef.current = null;
    }
    setPlayerReady(false);
  };

  // Copy invitation link or 6 digit room code to clipboard
  const handleCopyCode = () => {
    navigator.clipboard.writeText(roomCode);
    showSuccess(`Room code ${roomCode} copied to clipboard!`);
  };

  // Auto Scroll Chat list to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [roomState?.chatHistory]);

  const isUserAdmin = roomState?.adminId === userId;

  // Format digital media clock
  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div className="min-h-screen bg-[#0A0C10] text-slate-200 flex flex-col font-sans selection:bg-indigo-500 selection:text-white pb-6 relative overflow-hidden" id="musica-main-layout">
      {/* Ambient glass blur gradients matching Sleek Interface template */}
      <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-indigo-900/20 rounded-full blur-[120px] pointer-events-none z-0"></div>
      <div className="absolute bottom-[-10%] left-[-10%] w-[400px] h-[400px] bg-violet-900/20 rounded-full blur-[100px] pointer-events-none z-0"></div>

      {/* Dynamic Popups for status feedback */}
      <AnimatePresence>
        {errorMsg && (
          <motion.div
            initial={{ opacity: 0, y: -40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-red-950/80 border border-red-500/30 text-red-100 px-5 py-3.5 rounded-2xl shadow-2xl flex items-center gap-2.5 backdrop-blur-xl max-w-md w-11/12"
            id="error-popup"
          >
            <AlertCircle className="text-red-400 w-5 h-5 shrink-0" />
            <p className="text-sm font-medium">{errorMsg}</p>
          </motion.div>
        )}
        
        {successMsg && (
          <motion.div
            initial={{ opacity: 0, y: -40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-[#12141c]/90 border border-indigo-500/40 text-indigo-100 px-5 py-3.5 rounded-2xl shadow-2xl flex items-center gap-2.5 backdrop-blur-xl max-w-md w-11/12"
            id="success-popup"
          >
            <Sparkles className="text-indigo-400 w-5 h-5 shrink-0" />
            <p className="text-sm font-medium">{successMsg}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Navigation Header */}
      <header className="h-20 px-6 sm:px-10 flex items-center justify-between border-b border-white/5 backdrop-blur-sm z-10" id="app-header-nav">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => view === 'DASHBOARD' || view === 'ROOM' ? setView('DASHBOARD') : null}>
          <div className="w-10 h-10 bg-gradient-to-tr from-indigo-500 to-violet-500 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          </div>
          <span className="text-2xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">MUSICA</span>
        </div>

        <div className="flex items-center gap-4">
          {/* Server status indicator */}
          <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 px-3 py-1.5 rounded-full text-[11px] font-mono font-medium text-slate-300">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-500 shadow-md shadow-emerald-500/40' : 'bg-amber-500 animate-pulse'}`} />
            <span>{connected ? "LIVE SERVER" : "CONNECTING"}</span>
          </div>

          {view !== 'LOGIN' && (
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2 bg-white/5 border border-white/10 py-1.5 px-4 rounded-full">
                <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full"></div>
                <span className="text-xs font-medium text-slate-400">Logged in as <span className="text-white font-semibold">{username}</span></span>
              </div>
              
              <button
                onClick={() => {
                  if (view === 'ROOM') {
                    handleLeaveRoom();
                  }
                  setView('LOGIN');
                  setUsername('');
                }}
                className="flex items-center gap-1.5 bg-red-950/10 hover:bg-red-950/30 text-red-400 border border-red-950 hover:border-red-900 px-3.5 py-1.5 rounded-full text-xs font-medium tracking-wide transition-all cursor-pointer"
                id="sign-out-btn"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Primary Workspace Stage */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-6 sm:px-10 pt-6 flex flex-col justify-start z-10" id="stage-viewport">
        
        {/* VIEW 1: LOGIN BOX */}
        {view === 'LOGIN' && (
          <div className="flex-1 flex flex-col items-center justify-center py-10" id="login-layout-view">
            <motion.div 
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-md w-full bg-white/5 border border-white/10 p-8 rounded-[32px] backdrop-blur-md shadow-2xl relative overflow-hidden"
              id="login-card-container"
            >
              <div className="text-center mb-8 relative z-10">
                <div className="inline-flex bg-gradient-to-tr from-indigo-500 to-violet-500 p-4 rounded-2xl text-white shadow-xl shadow-indigo-500/20 mb-4">
                  <Music className="w-8 h-8" />
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-white mb-2">Welcome to Musica</h2>
                <p className="text-sm text-slate-400 leading-relaxed">Stream and keep YouTube video tracks perfectly in phase across the web globally.</p>
              </div>

              <form onSubmit={handleLogin} className="space-y-6 relative z-10">
                <div>
                  <label htmlFor="username-input" className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2.5">
                    Choose Your Username
                  </label>
                  <div className="relative">
                    <UserIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-slate-500" />
                    <input
                      id="username-input"
                      type="text"
                      maxLength={18}
                      placeholder="e.g. BassHut"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full bg-black/40 border border-white/10 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-white rounded-xl py-3 pl-11 pr-4 text-sm font-medium outline-none transition-all placeholder:text-slate-600"
                      required
                    />
                  </div>
                  <p className="text-[11px] text-slate-500 mt-2">Required to enter the lobby and synchronized player rooms.</p>
                </div>

                <button
                  type="submit"
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 px-6 rounded-xl text-sm tracking-wide shadow-lg shadow-indigo-600/30 active:scale-[0.99] transition-all cursor-pointer"
                  id="enter-musica-space-btn"
                >
                  Enter Musica Space
                </button>
              </form>
            </motion.div>
          </div>
        )}

        {/* VIEW 2: DASHBOARD CONTROLS (Bento Columns) */}
        {view === 'DASHBOARD' && (
          <div className="flex-1 py-4" id="dashboard-layout-view">
            <div className="mb-8">
              <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-1">Let's start listening</p>
              <h2 className="text-3xl font-bold text-white tracking-tight">Main Hub Space</h2>
              <p className="text-sm text-slate-400 mt-1">Hello, <span className="text-indigo-300 font-semibold">{username}</span>. Create or join a digital room to begin listening with friends.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8" id="dashboard-layout-columns">
              
              {/* Option 1: Create room */}
              <motion.div
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                className="bg-white/5 border border-white/10 p-8 rounded-[32px] flex flex-col justify-between relative overflow-hidden group hover:border-indigo-500/40 hover:bg-white/[0.07] transition-all duration-300"
                id="create-room-bento"
              >
                <div className="absolute top-0 right-0 w-40 h-40 bg-indigo-500/5 rounded-full blur-3xl group-hover:bg-indigo-500/10 transition-all pointer-events-none" />
                
                <div>
                  <div className="bg-indigo-500/10 p-4 rounded-2xl w-fit text-indigo-400 group-hover:bg-indigo-500/20 group-hover:text-indigo-300 transition-all mb-6">
                    <Plus className="w-8 h-8" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">Create a Music Room</h3>
                  <p className="text-sm text-slate-400 leading-relaxed mb-6">
                    Start a private room and get a unique 6-digit access code. As the room host (admin), you paste YouTube video URLs and control synchronized playback for everyone.
                  </p>
                </div>

                <div className="pt-4">
                  <button
                    onClick={handleCreateRoom}
                    disabled={isLoading}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 px-6 rounded-xl text-sm tracking-wide transition-all shadow-lg shadow-indigo-600/20 cursor-pointer flex items-center justify-center gap-2"
                    id="trigger-create-room-btn"
                  >
                    {isLoading ? (
                      <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        <Radio className="w-4 h-4" />
                        Create Private Room
                      </>
                    )}
                  </button>
                </div>
              </motion.div>

              {/* Option 2: Join room */}
              <motion.div
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                className="bg-white/5 border border-white/10 p-8 rounded-[32px] flex flex-col justify-between relative overflow-hidden group hover:border-violet-500/40 hover:bg-white/[0.07] transition-all duration-300"
                id="join-room-bento"
              >
                <div className="absolute top-0 right-0 w-40 h-40 bg-violet-500/5 rounded-full blur-3xl group-hover:bg-violet-500/10 transition-all pointer-events-none" />
                
                <div>
                  <div className="bg-violet-500/10 p-4 rounded-2xl w-fit text-violet-400 group-hover:bg-violet-500/20 group-hover:text-violet-300 transition-all mb-6">
                    <Users className="w-8 h-8" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">Join Existing Room</h3>
                  <p className="text-sm text-slate-400 leading-relaxed mb-6">
                    Enter an invitation room code generated by your friend to join their broadcast feed. Playback will sync with the host's timeline.
                  </p>
                </div>

                <form onSubmit={handleJoinRoom} className="space-y-4 pt-4">
                  <div>
                    <input
                      type="text"
                      maxLength={6}
                      placeholder="Enter 6-digit Code"
                      value={roomCodeInput}
                      onChange={(e) => setRoomCodeInput(e.target.value.replace(/\D/g, ''))} // only digits
                      className="w-full bg-black/40 border border-white/10 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-white rounded-xl py-3 px-4 text-center text-sm font-mono tracking-[0.2em] font-bold uppercase outline-none transition-all placeholder:text-slate-600"
                      required
                    />
                  </div>
                  
                  <button
                    type="submit"
                    disabled={isLoading || roomCodeInput.trim().length !== 6}
                    className="w-full bg-violet-600 hover:bg-violet-500 disabled:bg-violet-950/20 disabled:text-violet-400/50 disabled:cursor-not-allowed text-white font-bold py-3.5 px-6 rounded-xl text-sm tracking-wide transition-all shadow-lg hover:shadow-violet-600/10 cursor-pointer flex items-center justify-center gap-2"
                    id="trigger-join-room-btn"
                  >
                    {isLoading ? (
                      <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        <Users className="w-4 h-4" />
                        Join Room
                      </>
                    )}
                  </button>
                </form>
              </motion.div>

            </div>
          </div>
        )}

        {/* VIEW 3: DYNAMIC MUSIC ROOM STAGE */}
        {view === 'ROOM' && roomState && (
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 py-2 z-10" id="music-room-grid-parent">
            
            {/* Main playback panel (2/3 width) */}
            <div className="lg:col-span-2 flex flex-col gap-6" id="player-column-left">
              
              {/* Media Frame wrapper */}
              <div className="bg-white/5 border border-white/10 backdrop-blur-sm rounded-3xl p-6 relative overflow-hidden shadow-2xl" id="screen-container">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="bg-indigo-500/10 text-indigo-400 p-2.5 rounded-xl border border-indigo-500/10">
                      <Tv className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white tracking-wide">Musica Stream Canvas</h4>
                      <p className="text-[11px] text-slate-500 flex items-center gap-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${roomState.videoUrl ? 'bg-emerald-500 shadow-sm shadow-emerald-500' : 'bg-slate-600'}`} />
                        {roomState.videoUrl ? 'Sync Stream Active' : 'No soundstage URL stream loaded'}
                      </p>
                    </div>
                  </div>

                  {roomState.videoStatus === 'playing' && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-[10px] font-bold text-indigo-300 uppercase tracking-widest" id="visualizer-dancing-pill">
                      <div className="flex gap-0.5 items-end justify-center h-3 inline-block">
                        <span className="w-[2px] bg-indigo-400 inline-block animate-[pulse_0.8s_infinite] h-3" />
                        <span className="w-[2px] bg-indigo-400 inline-block animate-[pulse_0.5s-infinite] h-1.5" />
                        <span className="w-[2px] bg-indigo-400 inline-block animate-[pulse_0.7s_infinite] h-2.5" />
                      </div>
                      LIVE SYNC
                    </div>
                  )}
                </div>

                {/* If there is a video loaded, render the iframe placeholder */}
                <div className="relative aspect-video rounded-2xl overflow-hidden bg-black/60 border border-white/5 flex flex-col items-center justify-center group shadow-inner" id="video-frame-outer">
                  {roomState.videoUrl ? (
                    <div className="absolute inset-0 w-full h-full">
                      {isUploadUrl(roomState.videoUrl) ? (
                        <div className="w-full h-full bg-slate-950 flex items-center justify-center relative">
                          <video
                            ref={html5PlayerRef}
                            src={roomState.videoUrl}
                            className="w-full h-full object-contain"
                            playsInline
                            controls={isUserAdmin}
                            autoPlay={roomState.videoStatus === 'playing'}
                            onPlay={isUserAdmin ? () => {
                              sendWsMessage({ type: 'SYNC_PLAY', payload: { currentTime: html5PlayerRef.current?.currentTime || 0 } });
                            } : undefined}
                            onPause={isUserAdmin ? () => {
                              sendWsMessage({ type: 'SYNC_PAUSE', payload: { currentTime: html5PlayerRef.current?.currentTime || 0 } });
                            } : undefined}
                          />
                          {isAudioFile(roomState.videoUrl) && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/90 pointer-events-none gap-3 select-none">
                              <div className="w-20 h-20 bg-indigo-500/10 rounded-full flex items-center justify-center border border-indigo-500/20 shadow-2xl animate-pulse">
                                <Music className="w-8 h-8 text-indigo-400" />
                              </div>
                              <div className="text-center px-4 max-w-sm">
                                <span className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/10 px-2 py-0.5 rounded-full font-mono text-[9px] font-bold uppercase tracking-widest">Streaming Audio</span>
                                <p className="text-sm font-bold text-white mt-2 leading-tight line-clamp-1">{getFilename(roomState.videoUrl)}</p>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div id="musica-yt-frame" className="w-full h-full"></div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center p-8 max-w-sm flex flex-col items-center select-none">
                      <div className="bg-indigo-950/20 border border-indigo-500/10 p-5 rounded-full text-indigo-400 mb-4 animate-bounce">
                        <Radio className="w-10 h-10 text-indigo-500" />
                      </div>
                      <p className="font-bold text-white text-base">Soundstage Empty</p>
                      
                      {isUserAdmin ? (
                        <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                          You are the host! Copy a YouTube clip share link or upload a device-level track below to initialize the stream.
                        </p>
                      ) : (
                        <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                          Kindly wait for the host (<span className="text-indigo-300 font-semibold">{roomState.adminUsername}</span>) to load a YouTube music feed or upload an audio track.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Duration clocks and Seeking controls */}
                {roomState.videoUrl && (
                  <div className="mt-4 flex flex-col gap-2" id="duration-status-controls">
                    <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
                      <span className="flex items-center gap-1 font-semibold text-indigo-300">
                        <Clock className="w-3 h-3 text-indigo-400 animate-spin-slow" />
                        {formatTime(localCurrentTime)}
                      </span>
                      <span className="font-semibold text-slate-300">{formatTime(videoDuration)}</span>
                    </div>

                    <div className="relative group">
                      <input
                        type="range"
                        min={0}
                        max={videoDuration || 100}
                        value={localCurrentTime}
                        disabled={!isUserAdmin || (!isUploadUrl(roomState.videoUrl) && !playerReady)}
                        onChange={(e) => handleSeekChange(Number(e.target.value))}
                        className={`w-full accent-indigo-500 h-1 rounded-lg bg-white/10 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer ${
                          isUserAdmin ? 'hover:h-2 transition-all' : 'opacity-60 cursor-not-allowed'
                        }`}
                      />
                    </div>

                    {!isUserAdmin && (
                      <p className="text-[10px] text-slate-500 mt-1 italic">
                        * Seek bar is controlled strictly by host to prevent channel drifts.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Admin control console or helpful tip */}
              <div className="bg-white/5 border border-white/10 backdrop-blur-sm rounded-3xl p-6 shadow-2xl" id="interaction-controls-panel">
                {isUserAdmin ? (
                  <div className="space-y-6">
                    <div>
                      <h4 className="text-sm font-bold text-white tracking-wide mb-3 flex items-center gap-1.5">
                        <Crown className="w-4 h-4 text-amber-500" />
                        Host Controls
                      </h4>
                      <div className="flex flex-wrap gap-3">
                        <button
                          onClick={handleAdminPlay}
                          disabled={isUploadUrl(roomState.videoUrl) ? (roomState.videoStatus === 'playing') : (!playerReady || roomState.videoStatus === 'playing')}
                          className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-950/20 disabled:text-indigo-400/40 disabled:border-indigo-950/40 border border-indigo-500/20 text-white text-xs font-bold py-2.5 px-4 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-md"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          Play for Everyone
                        </button>
                        
                        <button
                          onClick={handleAdminPause}
                          disabled={isUploadUrl(roomState.videoUrl) ? (roomState.videoStatus === 'paused') : (!playerReady || roomState.videoStatus === 'paused')}
                          className="bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900/40 disabled:text-slate-600 border border-white/10 text-white text-xs font-bold py-2.5 px-4 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-md"
                        >
                          <Pause className="w-3.5 h-3.5 fill-none" />
                          Pause for Everyone
                        </button>

                        <button
                          onClick={handleForceSync}
                          disabled={!isUploadUrl(roomState.videoUrl) && !playerReady}
                          className="bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-300 text-xs font-bold py-2.5 px-4 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-md"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          Resync Everyone
                        </button>
                      </div>
                    </div>

                    {/* Device Upload option */}
                    <div className="border-t border-white/5 pt-4">
                      <h5 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2.5 flex items-center gap-1.5">
                        <Upload className="w-3.5 h-3.5 text-indigo-400" />
                        Upload Track from Local Device
                      </h5>
                      <div className="flex flex-col gap-2">
                        <label className="flex flex-col sm:flex-row items-center justify-center gap-3 px-4 py-4 bg-indigo-500/5 hover:bg-indigo-500/10 border border-dashed border-indigo-500/20 hover:border-indigo-500/40 rounded-2xl cursor-pointer transition-all group">
                          {uploading ? (
                            <div className="flex items-center gap-2">
                              <span className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                              <span className="text-xs font-bold text-indigo-300 font-sans">Uploading and syncing device media file...</span>
                            </div>
                          ) : (
                            <>
                              <FileAudio className="w-5 h-5 text-indigo-400 group-hover:scale-110 transition-transform" />
                              <div className="text-center sm:text-left select-none">
                                <p className="text-xs font-bold text-slate-300 font-sans">Select Audio or Video track from device</p>
                                <p className="text-[10px] text-slate-500 mt-0.5">MP3, WAV, OGG, MP4, WebM (Max 100MB)</p>
                              </div>
                            </>
                          )}
                          <input
                            type="file"
                            accept="audio/*,video/*"
                            onChange={handleFileUpload}
                            disabled={uploading}
                            className="hidden"
                          />
                        </label>
                      </div>
                    </div>

                    {/* Broadcast link form */}
                    <div>
                      <h5 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2.5">Load New Media Link</h5>
                      <form onSubmit={handleSetVideo} className="flex gap-2">
                        <div className="relative flex-1">
                          <LinkIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                          <input
                            type="text"
                            placeholder="Paste YouTube Link (e.g. https://www.youtube.com/watch?v=...)"
                            value={videoUrlInput}
                            onChange={(e) => setVideoUrlInput(e.target.value)}
                            className="w-full bg-black/40 border border-white/10 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl py-3 pl-11 pr-4 text-xs font-medium outline-none transition-all placeholder:text-slate-600 text-white"
                          />
                        </div>
                        <button
                          type="submit"
                          className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 rounded-xl text-xs font-bold transition-all shadow-md active:scale-[0.98] cursor-pointer"
                        >
                          Broadcast
                        </button>
                      </form>
                    </div>

                    {/* Pre-packaged playlist hooks */}
                    <div>
                      <h5 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                        <TrendingUp className="w-3.5 h-3.5 text-indigo-400" />
                        Quick Starter Tracks Selection
                      </h5>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {PRELOADED_VIDEOS.map((track, idx) => (
                          <div
                            key={idx}
                            onClick={() => handleSelectSuggested(track.url)}
                            className="bg-black/20 border border-white/5 hover:border-indigo-500/30 p-3 rounded-xl cursor-pointer flex justify-between items-center transition-all duration-205 group/item"
                          >
                            <div className="min-w-0 pr-2">
                              <p className="text-xs font-bold text-slate-350 truncate group-hover/item:text-indigo-350 transition-all font-sans">{track.title}</p>
                              <span className="text-[10px] text-indigo-400/80 font-bold tracking-wide">{track.category}</span>
                            </div>
                            <div className="bg-white/5 text-indigo-400 p-1.5 rounded-lg border border-white/5 overflow-hidden group-hover/item:bg-indigo-600 group-hover/item:text-white transition-all">
                              <Play className="w-2.5 h-2.5 fill-current" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3 bg-indigo-500/5 border border-indigo-500/10 p-5 rounded-2xl">
                    <HelpCircle className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-sm font-bold text-indigo-300">Spectator Mode</h4>
                      <p className="text-xs text-slate-400 leading-relaxed mt-1">
                        You are participating in <span className="text-white font-medium">{roomState.adminUsername}</span>'s synchronized music room. The player timeline is locked to the host's coordinates. Sit back, converse in the live chat right pane, and enjoy the stream!
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Room Info, Codes and Chat Panels (1/3 width) */}
            <div className="flex flex-col gap-6" id="chat-column-right">
              
              {/* Join Access Card */}
              <div className="bg-white/5 border border-white/10 rounded-3xl p-6 relative overflow-hidden shadow-2xl backdrop-blur-sm" id="access-details-card">
                <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full blur-2xl pointer-events-none" />
                
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1.5 font-sans">
                  <Share2 className="w-3.5 h-3.5 text-indigo-400" />
                  Invitation Credentials
                </h4>
                
                <div className="flex items-center gap-2 bg-black/30 border border-white/10 rounded-2xl p-3 justify-between">
                  <div className="flex items-center gap-2">
                    <Hash className="w-4 h-4 text-indigo-500" />
                    <span className="text-xl font-mono font-extrabold tracking-widest text-white leading-none">
                      {roomCode}
                    </span>
                  </div>
                  <button
                    onClick={handleCopyCode}
                    className="p-2 cursor-pointer bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 text-slate-300 rounded-xl transition-all"
                    title="Copy 6-digit Code"
                    id="copy-room-code-btn"
                  >
                    <Copy className="w-4 h-4 text-indigo-400" />
                  </button>
                </div>
                
                <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">
                  Send this code to friends. Leaving clients automatically release licenses back to general slots.
                </p>

                {/* Exit Room Button */}
                <div className="border-t border-white/5 mt-4 pt-4">
                  <button
                    onClick={handleLeaveRoom}
                    className="w-full bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition-all text-red-350 py-2.5 px-4 rounded-xl text-xs font-bold cursor-pointer flex items-center justify-center gap-1.5"
                    id="leave-room-stage-btn"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Leave Room Stage
                  </button>
                </div>
              </div>

              {/* Active User Roll Card */}
              <div className="bg-white/5 border border-white/10 rounded-3xl p-6 shadow-2xl backdrop-blur-sm" id="participants-roll-card">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-sans">
                    <Users className="w-3.5 h-3.5 text-indigo-400" />
                    Audience Participants
                  </span>
                  <span className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded-full font-mono text-[9px] font-bold">
                    {roomState.users.length}
                  </span>
                </h4>

                <div className="space-y-2.5 max-h-36 overflow-y-auto pr-1" id="participants-list">
                  {roomState.users.map((participant) => (
                    <div
                      key={participant.id}
                      className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl transition-all ${
                        participant.id === userId
                        ? 'bg-indigo-500/5 border border-indigo-500/20'
                        : 'bg-black/20 border border-white/5'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-[10px] font-bold text-white uppercase font-mono tracking-tight shadow">
                          {participant.username.charAt(0)}
                        </div>
                        <span className="text-xs font-bold text-slate-200 truncate pr-1">
                          {participant.username}
                          {participant.id === userId && (
                            <span className="text-[9px] text-indigo-400 font-semibold ml-1.5">(You)</span>
                          )}
                        </span>
                      </div>

                      {participant.isAdmin && (
                        <div className="bg-amber-500/10 border border-amber-500/20 text-amber-400 px-2 py-0.5 rounded-lg text-[9px] font-bold uppercase tracking-wider h-fit flex items-center gap-1 shrink-0">
                          <Crown className="w-2.5 h-2.5 fill-current text-amber-500" />
                          HOST
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* High-Fi Real-time Chat Box */}
              <div className="bg-white/5 border border-white/10 rounded-[28px] shadow-2xl flex-1 flex flex-col overflow-hidden min-h-[300px] backdrop-blur-sm" id="stage-chatbox">
                {/* Header title */}
                <div className="px-6 py-4 border-b border-white/5 bg-transparent flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider leading-none">Live Room Chat</h4>
                    <p className="text-[10px] text-slate-500 mt-1">Direct instant room messages</p>
                  </div>
                  <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse shadow-sm shadow-indigo-500" />
                </div>

                {/* Chat message track scroll */}
                <div className="flex-1 p-5 overflow-y-auto space-y-3 font-mono text-xs flex flex-col" id="chat-messages-scroll">
                  {roomState.chatHistory.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-600 select-none py-6">
                      <HelpCircle className="w-6 h-6 text-slate-600 mb-1" />
                      <p className="text-[11px] font-medium text-slate-500 italic font-sans">No message trails. Send a chat to begin!</p>
                    </div>
                  ) : (
                    roomState.chatHistory.map((chat) => {
                      const isSystemMsg = chat.sender === 'System';
                      return (
                        <div
                          key={chat.id}
                          className={`rounded-2xl px-3.5 py-2.5 max-w-[85%] leading-relaxed ${
                            isSystemMsg
                            ? 'bg-white/5 border border-white/5 text-slate-400 text-[10px] py-1.5 px-3 italic w-full max-w-none text-center'
                            : chat.sender === username
                            ? 'bg-indigo-600 border border-indigo-500/30 text-white self-end ml-auto'
                            : 'bg-black/30 border border-white/5 text-slate-300 self-start'
                          }`}
                        >
                          {!isSystemMsg && (
                            <div className="flex items-center gap-1.5 mb-1 text-[10px]">
                              <span className="font-sans font-bold text-indigo-300">{chat.sender}</span>
                            </div>
                          )}
                          <p className="font-sans text-[12px] break-all">{chat.text}</p>
                        </div>
                      );
                    })
                  )}
                  {/* Anchor point to auto-scroll */}
                  <div ref={messagesEndRef} />
                </div>

                {/* Submitting chat coordinates */}
                <div className="p-4 border-t border-white/5 bg-black/20" id="send-chat-input-row">
                  <form onSubmit={handleSendMessage} className="flex gap-2">
                    <input
                      type="text"
                      maxLength={140}
                      placeholder="Send a chat message..."
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      className="w-full bg-black/40 border border-white/10 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-xs text-white rounded-xl py-2.5 px-4 outline-none transition-all placeholder:text-slate-600 font-sans"
                    />
                    <button
                      type="submit"
                      disabled={!chatInput.trim()}
                      className="p-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-950/20 disabled:text-indigo-700 disabled:cursor-not-allowed border border-indigo-500/20 text-white rounded-xl transition-all shadow-md cursor-pointer flex items-center justify-center shrink-0"
                      id="send-chat-submit"
                    >
                      <Send className="w-4.5 h-4.5" />
                    </button>
                  </form>
                </div>
              </div>

            </div>

          </div>
        )}

      </main>
    </div>
  );
}
