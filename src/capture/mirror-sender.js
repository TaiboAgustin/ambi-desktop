// Ventana oculta del espejo: captura la pantalla y la envía al visor de la TV por WebRTC.
// La pantalla (y el audio del sistema) los elige el proceso principal (setDisplayMediaRequestHandler);
// la URL de señalización trae el token de la sesión.
const params = new URLSearchParams(location.search);
const SIGNAL_URL = params.get('signal');
// La TV decodifica por software (FFmpeg) pero en paralelo: medido, sostiene 1080p a ~58 fps sin
// cuadros perdidos (~18 ms/cuadro); 720p baja eso a ~7 ms.
const QUALITIES = {
  nitido60: { width: 1920, height: 1080, fps: 60, bitrate: 14_000_000 },
  nitido: { width: 1920, height: 1080, fps: 30, bitrate: 10_000_000 },
  fluido60: { width: 1280, height: 720, fps: 60, bitrate: 8_000_000 },
  fluido: { width: 1280, height: 720, fps: 30, bitrate: 6_000_000 },
};
const QUALITY = QUALITIES[params.get('quality')] || QUALITIES.nitido60;

let stream = null;
let pc = null;
let ws = null;

const send = (msg) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };

function waitIce(conn) {
  return new Promise((resolve) => {
    if (conn.iceGatheringState === 'complete') return resolve();
    const t = setTimeout(resolve, 2000);
    conn.addEventListener('icegatheringstatechange', () => {
      if (conn.iceGatheringState === 'complete') { clearTimeout(t); resolve(); }
    });
  });
}

// H.264 primero: la TV lo decodifica mejor que VP8/VP9. Chromium valida setCodecPreferences contra
// las capacidades de recepción; si rechaza H.264 se usa el orden por defecto.
function preferH264(transceiver) {
  const codecs = RTCRtpReceiver.getCapabilities('video')?.codecs || [];
  const h264 = codecs.filter((c) => c.mimeType === 'video/H264');
  if (!h264.length) return;
  try { transceiver.setCodecPreferences([...h264, ...codecs.filter((c) => c.mimeType !== 'video/H264')]); } catch {}
}

async function reportVideoInfo(conn) {
  await new Promise((r) => setTimeout(r, 2000));
  const stats = await conn.getStats();
  const out = [...stats.values()].find((s) => s.type === 'outbound-rtp' && s.kind === 'video');
  const codec = out && stats.get(out.codecId);
  send({ type: 'info', codec: codec?.mimeType, size: out && `${out.frameWidth}x${out.frameHeight}@${Math.round(out.framesPerSecond || 0)}fps`, encoder: out?.encoderImplementation });
}

async function offer() {
  pc?.close();
  const conn = new RTCPeerConnection();
  pc = conn;
  // Audio y video en streams distintos: el visor no retrasa el video para sincronizarlo con el audio.
  for (const track of stream.getTracks()) {
    const tr = conn.addTransceiver(track, { direction: 'sendonly', streams: [new MediaStream([track])] });
    if (track.kind === 'video') preferH264(tr);
  }
  conn.onconnectionstatechange = () => {
    send({ type: 'state', state: conn.connectionState });
    if (conn.connectionState === 'connected') reportVideoInfo(conn).catch(() => {});
  };
  await conn.setLocalDescription(await conn.createOffer());
  await waitIce(conn);
  if (pc !== conn) return;
  send({ type: 'offer', sdp: conn.localDescription.sdp });

  const videoSender = conn.getSenders().find((s) => s.track?.kind === 'video');
  if (videoSender) {
    const p = videoSender.getParameters();
    p.encodings = p.encodings?.length ? p.encodings : [{}];
    p.encodings[0].maxBitrate = QUALITY.bitrate;
    p.encodings[0].maxFramerate = QUALITY.fps;
    p.degradationPreference = 'maintain-resolution';
    videoSender.setParameters(p).catch(() => {});
  }
}

function connect() {
  ws = new WebSocket(SIGNAL_URL);
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === 'viewer-ready') offer().catch((err) => send({ type: 'error', message: `WebRTC: ${err.message}` }));
    else if (msg.type === 'answer') pc?.setRemoteDescription({ type: 'answer', sdp: msg.sdp }).catch((err) => send({ type: 'error', message: `WebRTC: ${err.message}` }));
    else if (msg.type === 'viewer-gone') { pc?.close(); pc = null; }
  };
  ws.onclose = (e) => { if (e.code !== 1008) setTimeout(connect, 1000); }; // 1008: token inválido, no insistir
}

(async () => {
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: QUALITY.fps, max: QUALITY.fps }, width: { max: QUALITY.width }, height: { max: QUALITY.height } },
      audio: true,
    });
    const video = stream.getVideoTracks()[0];
    if (video) video.contentHint = 'detail';
    connect();
  } catch (e) {
    ws = new WebSocket(SIGNAL_URL);
    ws.onopen = () => send({ type: 'error', message: `No se pudo capturar la pantalla: ${e.message}` });
  }
})();
