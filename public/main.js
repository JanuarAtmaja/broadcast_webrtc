const socket = io();
const config = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
const peerConnections = {}; // Untuk menangani multiple viewers
// =================================================================
// LOGIKA BROADCASTER
// =================================================================
export async function startBroadcast() {
 const localVideo = document.getElementById('localVideo');
 const tokenDisplay = document.getElementById('token');
 const roomId = Math.random().toString(36).substring(2, 10);
 tokenDisplay.innerText = roomId;
 tokenDisplay.onclick = () => { navigator.clipboard.writeText(roomId); alert('Token disalin!'); };
 socket.emit('join-room', roomId);
 const localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
 localVideo.srcObject = localStream;
 // Listener untuk viewer baru
 socket.on('viewer-joined', async ({ viewerId }) => {
 console.log(`Viewer ${viewerId} bergabung, membuat koneksi...`);
 const pc = new RTCPeerConnection(config);
 peerConnections[viewerId] = pc;

 localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

 pc.onicecandidate = event => {
 if (event.candidate) {
 socket.emit('ice-candidate', { roomId, candidate: event.candidate });
 }
 };

 const offer = await pc.createOffer();
 await pc.setLocalDescription(offer);
 socket.emit('offer', { target: viewerId, sdp: offer });
 });

 // Listener untuk answer dari viewer
 socket.on('answer', async ({ sdp, viewerId }) => {
 console.log(`Menerima answer dari ${viewerId}`);
 const pc = peerConnections[viewerId];
 if (pc) {
 await pc.setRemoteDescription(new RTCSessionDescription(sdp));
 }
 });

 // Listener untuk ICE candidate dari viewer
 socket.on('ice-candidate', ({ candidate, senderId }) => {
 // Broadcaster menerima candidate dari semua viewer
 Object.values(peerConnections).forEach(pc => {
 if(senderId !== socket.id) pc.addIceCandidate(new RTCIceCandidate(candidate));
 });
 });
}
// =================================================================
// LOGIKA VIEWER
// =================================================================
export async function startView(roomId) {
 let peerConnection;
 const remoteVideo = document.getElementById('remoteVideo');

 socket.emit('join-as-viewer', roomId);
 // Listener untuk offer dari broadcaster
 socket.on('offer', async ({ sdp, broadcasterId }) => {
 console.log('Menerima offer dari broadcaster');
 peerConnection = new RTCPeerConnection(config);

 peerConnection.ontrack = event => {
 if (remoteVideo.srcObject !== event.streams[0]) {
 remoteVideo.srcObject = event.streams[0];
 }
 };
 peerConnection.onicecandidate = event => {
 if (event.candidate) {
 socket.emit('ice-candidate', { roomId, candidate: event.candidate });
 }
 };

 await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
 const answer = await peerConnection.createAnswer();
 await peerConnection.setLocalDescription(answer);
 socket.emit('answer', { target: broadcasterId, sdp: answer });
 });
 // Listener untuk ICE candidate
 socket.on('ice-candidate', ({ candidate, senderId }) => {
 if (peerConnection && senderId !== socket.id) {
 peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
 }
 });
}