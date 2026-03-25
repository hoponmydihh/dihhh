const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const rooms = new Map();

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
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }
    .app {
      width: 100%;
      max-width: 1000px;
      background: #111827;
      border-radius: 18px;
      padding: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.35);
    }
    h1 { margin-top: 0; font-size: 28px; }
    .top {
      display: flex;
      flex-wrap: wrap;
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
      min-width: 220px;
      flex: 1;
    }
    button {
      cursor: pointer;
      background: #2563eb;
      color: white;
      font-weight: 600;
    }
    button:hover { opacity: 0.95; }
    button.secondary { background: #374151; }
    button.danger { background: #dc2626; }
    .videos {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
      margin-top: 18px;
    }
    .card {
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
      margin: 8px 0 0;
      color: #cbd5e1;
      font-size: 14px;
    }
    .status {
      margin-top: 10px;
      color: #93c5fd;
      font-size: 14px;
      min-height: 20px;
      white-space: pre-line;
    }
    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 16px;
    }
    .small {
      font-size: 13px;
      color: #94a3b8;
      margin-top: 8px;
    }
  </style>
</head>
<body>
  <div class="app">
    <h1>Fast Call Room</h1>

    <div class="top">
      <input id="roomInput" placeholder="Enter room name, e.g. friends123" />
      <button id="joinBtn">Join room</button>
      <button id="copyBtn" class="secondary">Copy room link</button>
    </div>

    <div class="controls">
      <button id="toggleMicBtn" class="secondary">Mute mic</button>
      <button id="toggleCamBtn" class="secondary">Turn off camera</button>
      <button id="leaveBtn" class="danger">Leave</button>
    </div>

    <div class="status" id="status">Not connected</div>
    <div class="small">If camera is missing, the app will switch to audio-only automatically.</div>

    <div class="videos">
      <div class="card">
        <video id="localVideo" autoplay playsinline muted></video>
        <div class="label">You</div>
      </div>
      <div class="card">
        <video id="remoteVideo" autoplay playsinline></video>
        <div class="label">Friend</div>
      </div>
    </div>
  </div>

<script>
(() => {
  const roomInput = document.getElementById("roomInput");
  const joinBtn = document.getElementById("joinBtn");
  const copyBtn = document.getElementById("copyBtn");
  const leaveBtn = document.getElementById("leaveBtn");
  const toggleMicBtn = document.getElementById("toggleMicBtn");
  const toggleCamBtn = document.getElementById("toggleCamBtn");
  const statusEl = document.getElementById("status");
  const localVideo = document.getElementById("localVideo");
  const remoteVideo = document.getElementById("remoteVideo");

  let ws = null;
  let pc = null;
  let localStream = null;
  let room = "";
  let micEnabled = true;
  let camEnabled = true;
  let joined = false;
  let hasCamera = true;

  const params = new URLSearchParams(window.location.search);
  const roomFromUrl = params.get("room");
  if (roomFromUrl) roomInput.value = roomFromUrl;

  function setStatus(text) {
    statusEl.textContent = text;
  }

  async function listDevicesInfo() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === "audioinput").length;
      const videoInputs = devices.filter(d => d.kind === "videoinput").length;
      return { audioInputs, videoInputs };
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
        setStatus("Camera not found or unavailable. Joined with microphone only.");
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
            "Check Windows privacy settings, browser permissions, and whether another app is using the mic."
          );
        } else if (audioErr.name === "NotReadableError" || err.name === "NotReadableError") {
          alert("Your microphone or camera is busy in another app. Close Discord, Teams, Zoom, OBS, browser tabs, etc.");
        } else {
          alert("Could not access media devices: " + audioErr.message);
        }

        throw audioErr;
      }
    }
  }

  function createPeer() {
    pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "candidate",
          room,
          candidate: event.candidate
        }));
      }
    };

    pc.ontrack = (event) => {
      remoteVideo.srcObject = event.streams[0];
    };

    pc.onconnectionstatechange = () => {
      setStatus("Connection: " + pc.connectionState + (hasCamera ? "" : "\\nAudio-only mode"));
    };

    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }
  }

  async function joinRoom() {
    if (joined) return;

    room = roomInput.value.trim();
    if (!room) {
      alert("Enter a room name");
      return;
    }

    try {
      await startMedia();
    } catch {
      return;
    }

    createPeer();

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(protocol + "//" + location.host);

    ws.onopen = () => {
      joined = true;
      setStatus("Joined room: " + room + (hasCamera ? "" : "\\nAudio-only mode"));
      history.replaceState({}, "", "?room=" + encodeURIComponent(room));
      ws.send(JSON.stringify({ type: "join", room }));
    };

    ws.onmessage = async (msg) => {
      const data = JSON.parse(msg.data);

      if (data.type === "ready") {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        ws.send(JSON.stringify({
          type: "offer",
          room,
          sdp: pc.localDescription
        }));
      }

      if (data.type === "offer") {
        if (!pc) createPeer();
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({
          type: "answer",
          room,
          sdp: pc.localDescription
        }));
      }

      if (data.type === "answer") {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      }

      if (data.type === "candidate") {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
          console.error("ICE error", e);
        }
      }

      if (data.type === "peer-left") {
        remoteVideo.srcObject = null;
        setStatus("Friend left the room");
      }

      if (data.type === "room-full") {
        alert("Room is full. Only 2 users allowed.");
        cleanup(false);
      }
    };

    ws.onclose = () => {
      if (joined) setStatus("Disconnected from signaling server");
    };

    ws.onerror = () => {
      setStatus("WebSocket connection error");
    };
  }

  function cleanup(stopLocal = false) {
    joined = false;

    if (ws) {
      ws.close();
      ws = null;
    }

    if (pc) {
      pc.close();
      pc = null;
    }

    remoteVideo.srcObject = null;

    if (stopLocal && localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
      localVideo.srcObject = null;
      hasCamera = true;
      toggleCamBtn.disabled = false;
      toggleCamBtn.textContent = "Turn off camera";
    }
  }

  function leaveRoom() {
    cleanup(true);
    setStatus("Left room");
  }

  toggleMicBtn.onclick = () => {
    if (!localStream) return;
    micEnabled = !micEnabled;
    localStream.getAudioTracks().forEach(track => track.enabled = micEnabled);
    toggleMicBtn.textContent = micEnabled ? "Mute mic" : "Unmute mic";
  };

  toggleCamBtn.onclick = () => {
    if (!localStream) return;
    if (!hasCamera) return;

    camEnabled = !camEnabled;
    localStream.getVideoTracks().forEach(track => track.enabled = camEnabled);
    toggleCamBtn.textContent = camEnabled ? "Turn off camera" : "Turn on camera";
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
      setStatus("Copied: " + link);
    } catch {
      alert("Could not copy link");
    }
  };
})();
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
});

const wss = new WebSocketServer({ server });

function sendToOthers(room, sender, data) {
  const peers = rooms.get(room) || new Set();
  for (const client of peers) {
    if (client !== sender && client.readyState === 1) {
      client.send(JSON.stringify(data));
    }
  }
}

wss.on("connection", (ws) => {
  ws.room = null;

  ws.on("message", (message) => {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch {
      return;
    }

    if (data.type === "join") {
      const room = data.room;
      if (!rooms.has(room)) rooms.set(room, new Set());

      const peers = rooms.get(room);

      if (peers.size >= 2) {
        ws.send(JSON.stringify({ type: "room-full" }));
        return;
      }

      peers.add(ws);
      ws.room = room;

      if (peers.size === 2) {
        for (const client of peers) {
          if (client.readyState === 1) {
            client.send(JSON.stringify({ type: "ready" }));
          }
        }
      }
      return;
    }

    if (!ws.room) return;

    if (["offer", "answer", "candidate"].includes(data.type)) {
      sendToOthers(ws.room, ws, data);
    }
  });

  ws.on("close", () => {
    const room = ws.room;
    if (!room || !rooms.has(room)) return;

    const peers = rooms.get(room);
    peers.delete(ws);

    for (const client of peers) {
      if (client.readyState === 1) {
        client.send(JSON.stringify({ type: "peer-left" }));
      }
    }

    if (peers.size === 0) {
      rooms.delete(room);
    }
  });
});

server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
