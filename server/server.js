import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

let clients = [];

wss.on('connection', (ws) => {
    if (clients.length >= 2) {
        ws.close(1008, 'Room full (max 2 clients)');
        return;
    }

    const role = clients.length;
    clients.push(ws);
    ws.send(JSON.stringify({ type: 'role', role }));

    ws.on('message', (data) => {
        const other = clients.find((c) => c !== ws && c.readyState === c.OPEN);
        if (other) other.send(data.toString());
    });

    ws.on('close', () => {
        clients = clients.filter((c) => c !== ws);
    });
});

console.log(`Netcode lab relay server listening on ws://localhost:${PORT}`);
