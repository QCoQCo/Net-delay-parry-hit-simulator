// Real network transport via a small WebSocket relay server (server/server.js).
// Artificial impairment is still layered on top, so you can add extra
// simulated latency/jitter/loss on top of whatever the real connection has.
import { NetworkImpairment } from '../networkImpairment.js';

export function createWebSocketTransport(url) {
  const ws = new WebSocket(url);
  let receiveCb = () => {};
  let roleCb = () => {};
  let startCb = () => {};
  let peerLeftCb = () => {};
  const impairment = new NetworkImpairment((packet) => ws.send(JSON.stringify(packet)));

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', (err) => reject(err));
  });

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'role') {
      roleCb(msg.role);
    } else if (msg.type === 'start') {
      startCb();
    } else if (msg.type === 'peer-left') {
      peerLeftCb();
    } else if (msg.type === 'input') {
      receiveCb(msg.packet);
    }
  });

  return {
    ready,
    onRole(cb) { roleCb = cb; },
    onStart(cb) { startCb = cb; },
    onPeerLeft(cb) { peerLeftCb = cb; },
    onReceive(cb) { receiveCb = cb; },
    send(packet) { impairment.send({ type: 'input', packet }); },
    setParams(params) { impairment.setParams(params); },
    close() { ws.close(); },
  };
}
