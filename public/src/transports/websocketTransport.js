import { NetworkImpairment } from '../networkImpairment.js';

export function createWebSocketTransport(url) {
    const ws = new WebSocket(url);
    let receiveCb = () => {};
    let roleCb = () => {};
    const impairment = new NetworkImpairment((packet) => ws.send(JSON.stringify(packet)));

    const ready = new Promise((resolve, reject) => {
        ws.addEventListener('open', () => resolve());
        ws.addEventListener('error', (err) => reject(err));
    });

    ws.addEventListener('message', (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'role') {
            roleCb(msg.role);
        } else if (msg.type === 'input') {
            receiveCb(msg.packet);
        }
    });

    return {
        ready,
        onRole(cb) {
            roleCb = cb;
        },
        onReceive(cb) {
            receiveCb = cb;
        },
        send(packet) {
            impairment.send({ type: 'input', packet });
        },
        setParams(params) {
            impairment.setParams(params);
        },
        close() {
            ws.close();
        },
    };
}
