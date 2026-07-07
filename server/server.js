// Minimal WebSocket relay for the netcode lab.
// Accepts at most 2 clients and relays whatever one sends to the other
// verbatim. This server does not run or understand the game/netcode logic
// at all - it's purely a dumb pipe, same as a real matchmaking relay would
// be for a P2P game.
//
// Roles are fixed seat indices (slot 0 = P1, slot 1 = P2), so a role freed
// by a disconnect is handed to the next client instead of duplicating the
// remaining player's role. When both seats are taken, a 'start' message is
// broadcast so both clients begin ticking from frame 0 together - without
// this, the first client would run hundreds of frames ahead before the
// second one even connects.
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

const slots = [null, null];

wss.on('connection', (ws) => {
  const role = slots.indexOf(null);
  if (role === -1) {
    ws.close(1008, 'Room full (max 2 clients)');
    return;
  }
  slots[role] = ws;
  ws.send(JSON.stringify({ type: 'role', role }));

  if (slots[0] && slots[1]) {
    for (const c of slots) c.send(JSON.stringify({ type: 'start' }));
  }

  ws.on('message', (data) => {
    const other = slots[1 - role];
    if (other && other.readyState === other.OPEN) other.send(data.toString());
  });

  ws.on('close', () => {
    slots[role] = null;
    const other = slots[1 - role];
    if (other && other.readyState === other.OPEN) {
      other.send(JSON.stringify({ type: 'peer-left' }));
    }
  });
});

console.log(`Netcode lab relay server listening on ws://localhost:${PORT}`);
