import { createInitialState, step, cloneState } from '../gameState.js';
import { FrameRingBuffer } from '../inputBuffer.js';

const HISTORY_SIZE = 90;
const HISTORY_WINDOW = 8;
const NEUTRAL_INPUT = { left: false, right: false, attack: false };

export class RollbackRunner {
    constructor(transport, localRole) {
        this.transport = transport;
        this.localRole = localRole;
        this.state = createInitialState();
        this.frame = 0;
        this.lastConfirmedFrame = -1;
        this.lastConfirmedRemoteInput = NEUTRAL_INPUT;
        this.localInputs = new FrameRingBuffer(HISTORY_SIZE);
        this.remoteInputs = new FrameRingBuffer(HISTORY_SIZE);
        this.snapshots = new FrameRingBuffer(HISTORY_SIZE);
        this.lastRollbackFrames = 0;

        transport.onReceive((packet) => {
            let earliestNewFrame = null;
            let maxFrameInPacket = -1;
            for (const entry of packet.history) {
                if (entry.frame > maxFrameInPacket) maxFrameInPacket = entry.frame;
                if (!this.remoteInputs.get(entry.frame)) {
                    this.remoteInputs.set(entry.frame, { input: entry.input });
                    if (earliestNewFrame === null || entry.frame < earliestNewFrame) {
                        earliestNewFrame = entry.frame;
                    }
                }
            }

            if (maxFrameInPacket > this.lastConfirmedFrame) {
                this.lastConfirmedFrame = maxFrameInPacket;
                this.lastConfirmedRemoteInput = this.remoteInputs.get(maxFrameInPacket).input;
            }
            if (earliestNewFrame !== null) this.rewindAndResim(earliestNewFrame);
        });
    }

    tick(rawLocalInput) {
        this.localInputs.set(this.frame, { input: rawLocalInput });
        this.snapshots.set(this.frame, { state: cloneState(this.state) });

        const history = [];
        for (let f = Math.max(0, this.frame - HISTORY_WINDOW + 1); f <= this.frame; f += 1) {
            const entry = this.localInputs.get(f);
            if (entry) history.push({ frame: f, input: entry.input });
        }
        this.transport.send({ history });

        const predictedRemote =
            this.remoteInputs.get(this.frame)?.input ?? this.lastConfirmedRemoteInput;
        const inputP1 = this.localRole === 0 ? rawLocalInput : predictedRemote;
        const inputP2 = this.localRole === 0 ? predictedRemote : rawLocalInput;

        this.state = step(this.state, inputP1, inputP2);
        this.frame += 1;
        this.lastRollbackFrames = 0;
        return this.state;
    }

    rewindAndResim(fromFrame) {
        if (fromFrame >= this.frame) return;
        const snapshot = this.snapshots.get(fromFrame);
        if (!snapshot) return;

        this.lastRollbackFrames = this.frame - fromFrame;

        let rewound = cloneState(snapshot.state);
        for (let f = fromFrame; f < this.frame; f += 1) {
            const localEntry = this.localInputs.get(f);
            const remoteEntry = this.remoteInputs.get(f);
            const remoteInput = remoteEntry ? remoteEntry.input : this.lastConfirmedRemoteInput;
            const localInput = localEntry ? localEntry.input : NEUTRAL_INPUT;
            const inputP1 = this.localRole === 0 ? localInput : remoteInput;
            const inputP2 = this.localRole === 0 ? remoteInput : localInput;
            rewound = step(rewound, inputP1, inputP2);

            this.snapshots.set(f + 1, { state: cloneState(rewound) });
        }
        this.state = rewound;
    }
}
