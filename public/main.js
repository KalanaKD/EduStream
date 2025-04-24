const socket = io({
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});
let localStream;
let peerConnections = {};
let roomId;
let username;
let isHost = false;
let peerUsernames = {};
let screenStream = null;
let isScreenSharing = false;
let mediaRecorder;
let recordedChunks = [];
let isRecording = false;

// DOM Elements
const localVideo = document.getElementById("localVideo");
const joinButton = document.getElementById("joinButton");
const micButton = document.getElementById("micButton");
const cameraButton = document.getElementById("cameraButton");
const chatbox = document.getElementById("chatbox");
const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");
const pageIdentifier = document.getElementById("page-identifier");
const recordButton = document.getElementById("recordButton");
const pageTitle = document.getElementById("page-title");

const iceServers = {
  iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
  ],
};

// Join a room
async function joinRoom() {
  roomId = document.getElementById("room").value.trim();
  if (!roomId) {
      alert("Please enter a Room ID!");
      return;
  }

  if (!username) {
      username = prompt("Enter your name:") || "Guest";
  }

  try {
      Object.keys(peerConnections).forEach((userId) => {
          if (peerConnections[userId]) {
              peerConnections[userId].close();
              delete peerConnections[userId];
          }
          const oldVideoContainer = document.getElementById(`container-${userId}`);
          if (oldVideoContainer) {
              oldVideoContainer.remove();
          }
      });

      localStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
      });

      localVideo.srcObject = localStream;

      socket.emit("join-room", roomId, username);

      document.getElementById("controls").style.display = "flex";
      document.getElementById("chat").style.display = "flex";
      document.getElementById("join-section").style.display = "none";
      pageTitle.style.display = "none";

      console.log("Joined room:", roomId);
  } catch (error) {
      console.error("Error accessing media devices:", error);
      alert("Could not access camera or microphone. Please check permissions.");
  }
}

// Create a peer connection for a new user
function createPeerConnection(userId) {
    const peerConnection = new RTCPeerConnection(iceServers);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit("ice-candidate", event.candidate, userId);
        }
    };

    peerConnection.ontrack = (event) => {
        console.log(`Received track from ${userId}`);

        let videoContainer = document.getElementById(`container-${userId}`);
        if (!videoContainer) {
            videoContainer = document.createElement("div");
            videoContainer.id = `container-${userId}`;
            videoContainer.className = "video-container";

            const remoteVideoElement = document.createElement("video");
            remoteVideoElement.id = `remote-${userId}`;
            remoteVideoElement.autoplay = true;
            remoteVideoElement.playsInline = true;

            const usernameLabel = document.createElement("div");
            usernameLabel.className = "username-label";
            usernameLabel.textContent = peerUsernames[userId] || "User";

            videoContainer.appendChild(remoteVideoElement);
            videoContainer.appendChild(usernameLabel);

            document.getElementById("videos").appendChild(videoContainer);
        }

        const remoteVideoElement = document.getElementById(`remote-${userId}`);
        if (remoteVideoElement) {
            remoteVideoElement.srcObject = event.streams[0];
        }
    };

    peerConnection.onconnectionstatechange = () => {
        console.log(
            `Connection state with ${userId}:`,
            peerConnection.connectionState
        );
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log(
            `ICE connection state with ${userId}:`,
            peerConnection.iceConnectionState
        );
    };

    localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnections[userId] = peerConnection;
    return peerConnection;
}

// Toggle microphone
function toggleMic() {
  const audioTrack = localStream.getAudioTracks()[0];
  audioTrack.enabled = !audioTrack.enabled;

  if (audioTrack.enabled) {
      micButton.innerHTML = `<i class="fas fa-microphone"></i> <span class="control-text">Mute Mic</span>`;
      micButton.classList.remove("muted");
  } else {
      micButton.innerHTML = `<i class="fas fa-microphone-slash"></i> <span class="control-text">Unmute Mic</span>`;
      micButton.classList.add("muted");
  }
}

// Toggle camera
function toggleCamera() {
  const videoTrack = localStream.getVideoTracks()[0];
  videoTrack.enabled = !videoTrack.enabled;

  if (videoTrack.enabled) {
      cameraButton.innerHTML = `<i class="fas fa-video"></i> <span class="control-text">Mute Video</span>`;
      cameraButton.classList.remove("muted");
  } else {
      cameraButton.innerHTML = `<i class="fas fa-video-slash"></i> <span class="control-text">Unmute Video</span>`;
      cameraButton.classList.add("muted");
  }
}

// End the call
function endCall() {
  Object.values(peerConnections).forEach((connection) => {
      connection.close();
  });

  if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
  }

  if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
      screenStream = null;
  }

  socket.emit("leave-room");

  window.location.reload();
}

// Send a chat message
function sendMessage() {
  const message = messageInput.value.trim();
  if (!message) return;

  // Send to server
  socket.emit("send-message", message);

  displayMessage({
      user: username + (isHost ? " (Host)" : ""),
      text: message,
      senderId: socket.id,
  });

  messageInput.value = "";
}

// Display a received message
function displayMessage(data) {
  const messageDiv = document.createElement("div");
  messageDiv.classList.add("message");

  if (data.senderId === socket.id) {
      messageDiv.classList.add("my-message");
  } else {
      messageDiv.classList.add("receiver-message");
  }

  const senderElement = document.createElement("div");
  senderElement.classList.add("sender-name");
  senderElement.textContent = data.user;

  const textElement = document.createElement("div");
  textElement.textContent = data.text;

  messageDiv.appendChild(senderElement);
  messageDiv.appendChild(textElement);

  chatbox.appendChild(messageDiv);

  chatbox.scrollTop = chatbox.scrollHeight;
}

// Update setupPageUI function
function setupPageUI(isFirstUser) {
  isHost = isFirstUser;

  if (isFirstUser) {
      document.body.classList.add("host-page");
      document.querySelector(".username-label").textContent = username + " (Host)";
      document.getElementById("page-identifier").textContent = `${username}'s page (Host)`;
  } else {
      document.body.classList.add("receiver-page");
      document.getElementById("page-identifier").textContent = `${username}'s page`;
  }
}

// Socket event handlers
socket.on("user-connected", async (userId, userName) => {
  console.log(`User connected: ${userId} (${userName})`);
  peerUsernames[userId] = userName;

  try {
      const peerConnection = createPeerConnection(userId);
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      console.log(`Sending offer to ${userId}`);
      socket.emit("offer", offer, userId);
  } catch (error) {
      console.error("Error in user-connected handler:", error);
  }
});

socket.on("room-users", async (users) => {
  console.log("Existing users in room:", users);

  setupPageUI(users.length === 0);

  users.forEach((user) => {
      peerUsernames[user.id] = user.username;
      createPeerConnection(user.id);
  });
});

socket.on("offer", async (offer, senderId) => {
  console.log("Received offer from:", senderId);

  try {
      let peerConnection = peerConnections[senderId];
      if (!peerConnection) {
          peerConnection = createPeerConnection(senderId);
      }

      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      console.log(`Sending answer to ${senderId}`);
      socket.emit("answer", answer, senderId);
  } catch (error) {
      console.error("Error handling offer:", error);
  }
});

socket.on("answer", async (answer, senderId) => {
  console.log("Received answer from:", senderId);

  const peerConnection = peerConnections[senderId];
  if (peerConnection) {
      try {
          await peerConnection.setRemoteDescription(
              new RTCSessionDescription(answer)
          );
      } catch (error) {
          console.error("Error handling answer:", error);
      }
  }
});

socket.on("ice-candidate", async (candidate, senderId) => {
  console.log("Received ICE candidate from:", senderId);

  const peerConnection = peerConnections[senderId];
  if (peerConnection) {
      try {
          await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
          console.error("Error adding ICE candidate:", error);
      }
  }
});

socket.on("user-disconnected", (userId, userName) => {
  console.log(`User ${userName} (${userId}) disconnected`);

  if (peerConnections[userId]) {
      peerConnections[userId].close();
      delete peerConnections[userId];
  }

  const videoContainer = document.getElementById(`container-${userId}`);
  if (videoContainer) {
      videoContainer.remove();
  }

  displayMessage({
      user: "System",
      text: `${userName} has left the room`,
      senderId: "system",
  });
});

socket.on("receive-message", (data) => {
  displayMessage(data);
});

messageInput.addEventListener("keypress", (event) => {
  if (event.key === "Enter") {
      sendMessage();
  }
});
// toggle screen share
async function toggleScreenShare() {
  const screenButton = document.getElementById('screenShareButton');

  try {
      if (!isScreenSharing) {
          screenStream = await navigator.mediaDevices.getDisplayMedia({
              video: true,
              audio: true
          });

          const videoTrack = screenStream.getVideoTracks()[0];
          Object.values(peerConnections).forEach((pc) => {
              const sender = pc.getSenders().find(s => s.track?.kind === 'video');
              if (sender) {
                  sender.replaceTrack(videoTrack);
              }
          });

          localVideo.srcObject = screenStream;

          screenButton.innerHTML = `<i class="fas fa-times-circle"></i> <span class="control-text">Stop Sharing</span>`;
          screenButton.classList.add('screen-sharing');
          isScreenSharing = true;

          screenStream.getVideoTracks()[0].onended = () => {
              stopScreenSharing();
          };
      } else {
          stopScreenSharing();
      }
  } catch (error) {
      console.error('Error sharing screen:', error);
      alert('Unable to share screen: ' + error.message);
  }
}

// Add this helper function for stopping screen share
async function stopScreenSharing() {
  if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
      screenStream = null;
  }

  const videoTrack = localStream.getVideoTracks()[0];
  Object.values(peerConnections).forEach((pc) => {
      const sender = pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender) {
          sender.replaceTrack(videoTrack);
      }
  });

  localVideo.srcObject = localStream;

  const screenButton = document.getElementById('screenShareButton');
  screenButton.innerHTML = `<i class="fas fa-desktop"></i> <span class="control-text">Share Screen</span>`;
  screenButton.classList.remove('screen-sharing');
  isScreenSharing = false;
}

// Recording Functionality
async function toggleRecording() {
  const recordButtonElement = document.getElementById('recordButton');
  if (!isRecording) {
      recordedChunks = [];
      mediaRecorder = new MediaRecorder(localStream, { mimeType: 'video/webm;codecs=vp9' });

      mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
              recordedChunks.push(event.data);
          }
      };

      mediaRecorder.onstop = () => {
          const blob = new Blob(recordedChunks, { type: 'video/webm' });
          const url = URL.createObjectURL(blob);

          // Create a download link and append it to the body
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = url;
          a.download = `recording-${new Date().toISOString()}.webm`;
          document.body.appendChild(a);
          a.click();

          // Clean up
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
      };

      mediaRecorder.start();
      recordButtonElement.innerHTML = `<i class="fas fa-stop-circle"></i> <span class="control-text">Stop Record</span>`;
      recordButtonElement.classList.add('recording');
      isRecording = true;
  } else {
      mediaRecorder.stop();
      recordButtonElement.innerHTML = `<i class="fas fa-record-vinyl"></i> <span class="control-text">Record</span>`;
      recordButtonElement.classList.remove('recording');
      isRecording = false;
  }
}
