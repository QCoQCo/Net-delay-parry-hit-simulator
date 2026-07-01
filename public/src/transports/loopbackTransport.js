import { NetworkImpairment } from '../networkImpairment.js';

export function createLoopbackPair() {
    let receiveA = () => {};
    let receiveB = () => {};

    const impairAtoB = new NetworkImpairment((packet) => receiveB(packet));
    const impairBtoA = new NetworkImpairment((packet) => receiveA(packet));

    const peerA = {
        onReceive(cb) {
            receiveA = cb;
        },
        send(packet) {
            impairAtoB.send(packet);
        },
        setParams(params) {
            impairAtoB.setParams(params);
        },
    };
    const peerB = {
        onReceive(cb) {
            receiveB = cb;
        },
        send(packet) {
            impairBtoA.send(packet);
        },
        setParams(params) {
            impairBtoA.setParams(params);
        },
    };

    return { peerA, peerB };
}
