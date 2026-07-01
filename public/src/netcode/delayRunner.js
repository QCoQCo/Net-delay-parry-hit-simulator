import { createInitialState, step } from '../gameState.js';
import { FrameRingBuffer } from '../inputBuffer.js';

const NEUTRAL_INPUT = { left: false, right: false, attack: false };
const HISTORY_WINDOW = 8;

export class DelayRunner {
    constructor(transport, localRole, inputDelayFrames = 3) {
        this.transport = transport;
        this.localRole = localRole;
        this.inputDelay = inputDelayFrames;
        this.state = createInitialState();
        this.tickCount = 0;
        this.nextSimFrame = 0;
        this.localInputs = new FrameRingBuffer(180);
        this.remoteInputs = new FrameRingBuffer(180);
        this.stalled = false;

        transport.onReceive((packet) => {
            for (const entry of packet.history) {
                if (!this.remoteInputs.get(entry.frame)) {
                    this.remoteInputs.set(entry.frame, { input: entry.input });
                }
            }
        });
    }

    setDelayFromLatency(latencyMs, frameMs = 1000 / 60) {
        this.inputDelay = Math.max(1, Math.round(latencyMs / 2 / frameMs));
    }

    tick(rawLocalInput) {
        this.localInputs.set(this.tickCount, { input: rawLocalInput });

        const history = [];
        for (
            let f = Math.max(0, this.tickCount - HISTORY_WINDOW + 1);
            f <= this.tickCount;
            f += 1
        ) {
            const entry = this.localInputs.get(f);
            if (entry) history.push({ frame: f, input: entry.input });
        }
        this.transport.send({ history });
        this.tickCount += 1;

        const targetFrame = this.tickCount - this.inputDelay;
        this.stalled = false;
        while (this.nextSimFrame < targetFrame) {
            const localEntry = this.localInputs.get(this.nextSimFrame);
            const remoteEntry = this.remoteInputs.get(this.nextSimFrame);
            if (!localEntry || !remoteEntry) {
                this.stalled = true;
                break;
            }
            const inputP1 = this.localRole === 0 ? localEntry.input : remoteEntry.input;
            const inputP2 = this.localRole === 0 ? remoteEntry.input : localEntry.input;
            this.state = step(this.state, inputP1, inputP2);
            this.nextSimFrame += 1;
        }
        return this.state;
    }
}

export { NEUTRAL_INPUT };
