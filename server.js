const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const MAX_ROOM_SIZE = 10;
const rooms = new Map();

function getRoomUsers(roomName) {
  const peers = rooms.get(roomName) || new Set();
  return [...peers].map((client) => ({
    id: client.clientId,
    name: client.userName || "Unknown"
  }));
}

function broadcastRoomUsers(roomName) {
  const peers = rooms.get(roomName);
  if (!peers) return;

  const payload = JSON.stringify({
    type: "room-users",
    users: getRoomUsers(roomName),
    count: peers.size
  });

  for (const client of peers) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

function sendToClient(targetId, roomName, payload) {
  const peers = rooms.get(roomName) || new Set();
  for (const client of peers) {
    if (client.clientId === targetId && client.readyState === 1) {
      client.send(JSON.stringify(payload));
      return true;
    }
  }
  return false;
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Fast Call Room</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      background: #0f172a;
      color: white;
      min-height: 100vh;
      padding: 20px;
    }
    .app {
      width: 100%;
      max-width: 1300px;
      margin: 0 auto;
      background: #111827;
      border-radius: 18px;
      padding: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.35);
    }
    h1 {
      margin: 0 0 16px 0;
      font-size: 28px;
    }
    .top {
      display: grid;
      grid-template-columns: 1fr 1fr auto auto;
      gap: 12px;
      margin-bottom: 16px;
    }
    input, button {
      border: none;
      border-radius: 12px;
      padding: 12px 14px;
      font-size: 16px;
    }
    input {
      background: #1f2937;
      color: white;
      width: 100%;
    }
    button {
      cursor: pointer;
      background: #2563eb;
      color: white;
      font-weight: 600;
      white-space: nowrap;
    }
    button:hover { opacity: 0.95; }
    button.secondary { background: #374151; }
    button.danger { background: #dc2626; }
    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .layout {
      display: grid;
      grid-template-columns: 1.8fr 1fr;
      gap: 18px;
    }
    .panel {
      background: #0b1220;
      border-radius: 16px;
      padding: 14px;
    }
    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 14px;
    }
    .status {
      color: #93c5fd;
      font-size: 14px;
      min-height: 22px;
      white-space: pre-line;
    }
    .small {
      font-size: 13px;
      color: #94a3b8;
      margin-top: 8px;
    }
    .videos {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 14px;
      margin-top: 16px;
    }
    .video-card {
      background: #0b1220;
      border-radius: 16px;
      padding: 12px;
    }
    video {
      width: 100%;
      border-radius: 12px;
      background: black;
      min-height: 180px;
    }
    .label {
      margin-top: 8px;
      color: #cbd5e1;
      font-size: 14px;
      word-break: break-word;
    }
    .section-title {
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 10px;
    }
    .users {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .user-item {
      background: #111827;
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 12px;
      padding: 10px 12px;
      font-size: 14px;
    }
    .logs {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 300px;
      overflow: auto;
    }
    .log-item {
      background: #111827;
      border-radius: 12px;
      padding: 10px 12px;
      font-size: 13px;
      color: #d1d5db;
    }
    .log-time {
      color: #93c5fd;
      margin-right: 8px;
    }
    .badge {
      display: inline-block;
      padding: 5px 9px;
      border-radius: 999px;
      background: #1e3a8a;
      color: #dbeafe;
      font-size: 12px;
      margin-left: 8px;
      vertical-align: middle;
    }

    @media (max-width: 980px) {
      .layout {
        grid-template-columns: 1fr;
      }
      .top {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="app">
    <h1>Fast Call Room</h1>

    <div class="top">
      <input id="nameInput" placeholder="Your name" />
      <input id="roomInput" placeholder="Room name, e.g. friends123" />
      <button id="joinBtn">Join room</button>
      <button id="copyBtn" class="secondary">Copy room link</button>
    </div>

    <div class="layout">
      <div>
        <div class="controls">
          <button id="toggleMicBtn" class="secondary">Mute mic</button>
          <button id="toggleCamBtn" class="secondary">Turn off camera</button>
          <button id="leaveBtn" class="danger">Leave</button>
        </div>

        <div class="panel">
          <div class="status" id="status">Not connected</div>
          <div class="small" id="modeText">If camera is unavailable, the app switches to audio-only automatically.</div>
        </div>

        <div class="videos" id="videosGrid">
          <div class="video-card" id="localCard">
            <video id="localVideo" autoplay playsinline muted></video>
            <div class="label" id="localLabel">You</div>
          </div>
        </div>
      </div>

      <div>
        <div class="panel" style="margin-bottom:16px;">
          <div class="section-title">
            Users in room
            <span class="badge" id="countBadge">0</span>
          </div>
          <div class="users" id="usersList">
            <div class="user-item">No one connected yet</div>
          </div>
        </div>

        <div class="panel">
          <div class="section-title">Activity</div>
          <div class="logs" id="logs"></div>
        </div>
      </div>
    </div>
  </div>

<script>
(() => {
  const MAX_ROOM_SIZE = 10;

  const nameInput = document.getElementById("nameInput");
  const roomInput = document.getElementById("roomInput");
  const joinBtn = document.getElementById("joinBtn");
  const copyBtn = document.getElementById("copyBtn");
  const leaveBtn = document.getElementById("leaveBtn");
  const toggleMicBtn = document.getElementById("toggleMicBtn");
  const toggleCamBtn = document.getElementById("toggleCamBtn");
  const statusEl = document.getElementById("status");
  const modeText = document.getElementById("modeText");
  const localVideo = document.getElementById("localVideo");
  const localLabel = document.getElementById("localLabel");
  const videosGrid = document.getElementById("videosGrid");
  const usersList = document.getElementById("usersList");
  const countBadge = document.getElementById("countBadge");
  const logs = document.getElementById("logs");

  let ws = null;
  let localStream = null;
  let room = "";
  let myName = "";
  let myId = null;
  let joined = false;
  let micEnabled = true;
  let camEnabled = true;
  let hasCamera = true;

  const peerConnections = new Map();
  const remoteStreams = new Map();
  const remoteNames = new Map();
  let currentUsers = [];

  const params = new URLSearchParams(window.location.search);
  const roomFromUrl = params.get("room");
  if (roomFromUrl) roomInput.value = roomFromUrl;

  const savedName = localStorage.getItem("fast_call_name");
  if (savedName) nameInput.value = savedName;

  function nowTime() {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function addLog(text) {
    const el = document.createElement("div");
    el.className = "log-item";
    el.innerHTML = '<span class="log-time">' + nowTime() + '</span>' + escapeHtml(text);
    logs.prepend(el);
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function updateModeText() {
    modeText.textContent = hasCamera ? "Camera + microphone mode" : "Audio-only mode";
  }

  function renderUsers(users) {
    currentUsers = users || [];
    countBadge.textContent = String(currentUsers.length);

    if (!currentUsers.length) {
      usersList.innerHTML = '<div class="user-item">No one connected yet</div>';
      return;
    }

    usersList.innerHTML = currentUsers.map((user) => {
      const me = user.id === myId ? " (you)" : "";
      return '<div class="user-item">' + escapeHtml(user.name + me) + '</div>';
    }).join("");

    remoteNames.clear();
    for (const user of currentUsers) {
      if (user.id !== myId) {
        remoteNames.set(user.id, user.name);
      }
    }

    updateRemoteLabels();
  }

  function updateRemoteLabels() {
    for (const [peerId, name] of remoteNames.entries()) {
      const label = document.getElementById("label-" + peerId);
      if (label) label.textContent = name;
    }
  }

  async function listDevicesInfo() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return {
        audioInputs: devices.filter(d => d.kind === "audioinput").length,
        videoInputs: devices.filter(d => d.kind === "videoinput").length
      };
    } catch {
      return { audioInputs: 0, videoInputs: 0 };
    }
  }

  async function startMedia() {
    if (localStream) return localStream;

    const info = await listDevicesInfo();

    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true
      });

      hasCamera = localStream.getVideoTracks().length > 0;
      localVideo.srcObject = localStream;
      updateModeText();
      setStatus("Mic and camera access granted");
      return localStream;
    } catch (err) {
      console.error("Full media error:", err);

      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false
        });

        hasCamera = false;
        localVideo.srcObject = localStream;
        toggleCamBtn.disabled = true;
        toggleCamBtn.textContent = "No camera found";
        updateModeText();
        setStatus("Camera unavailable. Joined with microphone only.");
        return localStream;
      } catch (audioErr) {
        console.error("Audio-only error:", audioErr);

        if (audioErr.name === "NotAllowedError" || err.name === "NotAllowedError") {
          alert("You denied microphone/camera permission. Please allow access in the browser.");
        } else if (audioErr.name === "NotFoundError" || err.name === "NotFoundError") {
          alert(
            "No working microphone/camera was found.\\n\\n" +
            "Detected devices:\\n" +
            "- Microphones: " + info.audioInputs + "\\n" +
            "- Cameras: " + info.videoInputs + "\\n\\n" +
            "Check browser permissions and Windows privacy settings."
          );
        } else if (audioErr.name === "NotReadableError" || err.name === "NotReadableError") {
          alert("Microphone or camera is busy in another app. Close Discord, Zoom, OBS, etc.");
        } else {
          alert("Could not access media devices: " + audioErr.message);
        }

        throw audioErr;
      }
    }
  }

  function createRemoteCard(peerId, name) {
    if (document.getElementById("card-" + peerId)) return;

    const card = document.createElement("div");
    card.className = "video-card";
    card.id = "card-" + peerId;

    const video = document.createElement("video");
    video.id = "video-" + peerId;
    video.autoplay = true;
    video.playsInline = true;

    const label = document.createElement("div");
    label.className = "label";
    label.id = "label-" + peerId;
    label.textContent = name || "User";

    card.appendChild(video);
    card.appendChild(label);
    videosGrid.appendChild(card);
  }

  function removeRemoteCard(peerId) {
    const card = document.getElementById("card-" + peerId);
    if (card) card.remove();
  }

  function createPeerConnection(peerId, peerName, shouldInitiate) {
    if (peerConnections.has(peerId)) return peerConnections.get(peerId);

    remoteNames.set(peerId, peerName || "User");
    createRemoteCard(peerId, peerName || "User");

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ]
    });

    peerConnections.set(peerId, pc);

    pc.onicecandidate = (event) => {
      if (!event.candidate || !ws || ws.readyState !== WebSocket.OPEN) return;

      ws.send(JSON.stringify({
        type: "candidate",
        room,
        target: peerId,
        candidate: event.candidate
      }));
    };

    pc.ontrack = (event) => {
      let stream = remoteStreams.get(peerId);
      if (!stream) {
        stream = new MediaStream();
        remoteStreams.set(peerId, stream);
      }

      const alreadyHasTrack = stream.getTracks().some(t => t.id === event.track.id);
      if (!alreadyHasTrack) {
        stream.addTrack(event.track);
      }

      const video = document.getElementById("video-" + peerId);
      if (video) {
        video.srcObject = stream;
        video.autoplay = true;
        video.playsInline = true;
        video.muted = false;
        video.play().catch((err) => {
          console.log("Autoplay blocked:", err);
        });
      }

      addLog("Receiving " + event.track.kind + " from " + (remoteNames.get(peerId) || "User"));
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      const peerDisplayName = remoteNames.get(peerId) || "User";

      if (state === "connected") {
        addLog("Connected with " + peerDisplayName);
      } else if (state === "failed") {
        addLog("Connection failed with " + peerDisplayName);
      } else if (state === "disconnected") {
        addLog("Disconnected from " + peerDisplayName);
      } else if (state === "closed") {
        addLog("Connection closed with " + peerDisplayName);
      }

      updateGlobalStatus();
    };

    if (localStream) {
      for (const track of localStream.getTracks()) {
        pc.addTrack(track, localStream);
      }
    }

    if (shouldInitiate) {
      (async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);

          ws.send(JSON.stringify({
            type: "offer",
            room,
            target: peerId,
            sdp: pc.localDescription
          }));
        } catch (error) {
          console.error("Offer error", error);
          addLog("Could not start connection with " + (peerName || "User"));
        }
      })();
    }

    return pc;
  }

  function closePeer(peerId) {
    const pc = peerConnections.get(peerId);
    if (pc) {
      pc.close();
      peerConnections.delete(peerId);
    }
    remoteStreams.delete(peerId);
    remoteNames.delete(peerId);
    removeRemoteCard(peerId);
    updateGlobalStatus();
  }

  function countConnectedPeers() {
    let connected = 0;
    for (const pc of peerConnections.values()) {
      if (pc.connectionState === "connected") connected++;
    }
    return connected;
  }

  function updateGlobalStatus() {
    const totalOthers = Math.max(0, currentUsers.length - (myId ? 1 : 0));
    const connectedPeers = countConnectedPeers();

    let text = joined
      ? "Joined room: " + room + "\\nConnected peers: " + connectedPeers + "/" + totalOthers
      : "Not connected";

    if (!hasCamera) {
      text += "\\nAudio-only mode";
    }

    if (joined && totalOthers > 0 && connectedPeers < totalOthers) {
      text += "\\nSome users may still be connecting...";
    }

    setStatus(text);
  }

  async function handleOffer(data) {
    const peerId = data.from;
    const peerName = data.name || "User";
    const pc = createPeerConnection(peerId, peerName, false);

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      ws.send(JSON.stringify({
        type: "answer",
        room,
        target: peerId,
        sdp: pc.localDescription
      }));
    } catch (error) {
      console.error("Offer handling error", error);
      addLog("Could not answer " + peerName);
    }
  }

  async function handleAnswer(data) {
    const peerId = data.from;
    const pc = peerConnections.get(peerId);
    if (!pc) return;

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    } catch (error) {
      console.error("Answer handling error", error);
    }
  }

  async function handleCandidate(data) {
    const peerId = data.from;
    const pc = peerConnections.get(peerId);
    if (!pc) return;

    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (error) {
      console.error("ICE error", error);
    }
  }

  function syncPeerConnections(users) {
    const otherUsers = users.filter(u => u.id !== myId);

    for (const user of otherUsers) {
      if (!peerConnections.has(user.id)) {
        const shouldInitiate = myId > user.id;
        createPeerConnection(user.id, user.name, shouldInitiate);
      }
    }

    for (const peerId of [...peerConnections.keys()]) {
      if (!otherUsers.find(u => u.id === peerId)) {
        closePeer(peerId);
      }
    }
  }

  async function joinRoom() {
    if (joined) return;

    myName = nameInput.value.trim();
    room = roomInput.value.trim();

    if (!myName) {
      alert("Enter your name");
      return;
    }

    if (!room) {
      alert("Enter a room name");
      return;
    }

    localStorage.setItem("fast_call_name", myName);
    localLabel.textContent = myName + " (you)";

    try {
      await startMedia();
    } catch {
      return;
    }

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(protocol + "//" + location.host);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "join",
        room,
        name: myName
      }));
    };

    ws.onmessage = async (msg) => {
      const data = JSON.parse(msg.data);

      if (data.type === "joined-ok") {
        joined = true;
        myId = data.yourId;
        history.replaceState({}, "", "?room=" + encodeURIComponent(room));
        addLog("You joined room: " + room);
        updateGlobalStatus();
        return;
      }

      if (data.type === "room-users") {
        renderUsers(data.users);
        syncPeerConnections(data.users);
        updateGlobalStatus();
        return;
      }

      if (data.type === "user-joined") {
        addLog(data.name + " joined the room");
        return;
      }

      if (data.type === "user-left") {
        addLog(data.name + " left the room");
        closePeer(data.id);
        return;
      }

      if (data.type === "offer") {
        await handleOffer(data);
        return;
      }

      if (data.type === "answer") {
        await handleAnswer(data);
        return;
      }

      if (data.type === "candidate") {
        await handleCandidate(data);
        return;
      }

      if (data.type === "room-full") {
        alert("Room is full. Max " + MAX_ROOM_SIZE + " users.");
        cleanup(true);
        return;
      }
    };

    ws.onclose = () => {
      if (joined) {
        addLog("Disconnected from server");
      }
      updateGlobalStatus();
    };

    ws.onerror = () => {
      addLog("WebSocket connection error");
      setStatus("WebSocket connection error");
    };
  }

  function cleanup(stopLocal) {
    joined = false;
    myId = null;

    if (ws) {
      ws.close();
      ws = null;
    }

    for (const peerId of [...peerConnections.keys()]) {
      closePeer(peerId);
    }

    renderUsers([]);

    if (stopLocal && localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
      localVideo.srcObject = null;
      hasCamera = true;
      toggleCamBtn.disabled = false;
      toggleCamBtn.textContent = "Turn off camera";
      updateModeText();
    }
  }

  function leaveRoom() {
    addLog("You left the room");
    cleanup(true);
    setStatus("Left room");
  }

  toggleMicBtn.onclick = () => {
    if (!localStream) return;
    micEnabled = !micEnabled;
    localStream.getAudioTracks().forEach(track => {
      track.enabled = micEnabled;
    });
    toggleMicBtn.textContent = micEnabled ? "Mute mic" : "Unmute mic";
    addLog(micEnabled ? "Microphone unmuted" : "Microphone muted");
  };

  toggleCamBtn.onclick = () => {
    if (!localStream || !hasCamera) return;
    camEnabled = !camEnabled;
    localStream.getVideoTracks().forEach(track => {
      track.enabled = camEnabled;
    });
    toggleCamBtn.textContent = camEnabled ? "Turn off camera" : "Turn on camera";
    addLog(camEnabled ? "Camera turned on" : "Camera turned off");
  };

  leaveBtn.onclick = leaveRoom;
  joinBtn.onclick = joinRoom;

  copyBtn.onclick = async () => {
    const roomVal = roomInput.value.trim();
    if (!roomVal) {
      alert("Enter room name first");
      return;
    }

    const link = location.origin + "/?room=" + encodeURIComponent(roomVal);
    try {
      await navigator.clipboard.writeText(link);
      addLog("Room link copied");
      setStatus("Copied: " + link);
    } catch {
      alert("Could not copy link");
    }
  };

  updateModeText();
})();
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.room = null;
  ws.userName = null;
  ws.clientId = Math.random().toString(36).slice(2, 10);

  ws.on("message", (message) => {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch {
      return;
    }

    if (data.type === "join") {
      const roomName = String(data.room || "").trim();
      const userName = String(data.name || "Unknown").trim() || "Unknown";

      if (!roomName) return;

      if (!rooms.has(roomName)) {
        rooms.set(roomName, new Set());
      }

      const peers = rooms.get(roomName);

      if (peers.size >= MAX_ROOM_SIZE) {
        ws.send(JSON.stringify({ type: "room-full" }));
        return;
      }

      ws.room = roomName;
      ws.userName = userName;
      peers.add(ws);

      ws.send(JSON.stringify({
        type: "joined-ok",
        yourId: ws.clientId
      }));

      for (const client of peers) {
        if (client !== ws && client.readyState === 1) {
          client.send(JSON.stringify({
            type: "user-joined",
            id: ws.clientId,
            name: ws.userName
          }));
        }
      }

      broadcastRoomUsers(roomName);
      return;
    }

    if (!ws.room) return;

    if (["offer", "answer", "candidate"].includes(data.type)) {
      const target = String(data.target || "").trim();
      if (!target) return;

      sendToClient(target, ws.room, {
        type: data.type,
        from: ws.clientId,
        name: ws.userName,
        sdp: data.sdp,
        candidate: data.candidate
      });
    }
  });

  ws.on("close", () => {
    const roomName = ws.room;
    if (!roomName || !rooms.has(roomName)) return;

    const peers = rooms.get(roomName);
    peers.delete(ws);

    for (const client of peers) {
      if (client.readyState === 1) {
        client.send(JSON.stringify({
          type: "user-left",
          id: ws.clientId,
          name: ws.userName
        }));
      }
    }

    if (peers.size === 0) {
      rooms.delete(roomName);
    } else {
      broadcastRoomUsers(roomName);
    }
  });
});

server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
