// Delay-based netcode: raw input is captured immediately but only applied
// to the simulation `inputDelay` frames later. Under normal conditions the
// remote player's input for that frame has already arrived by then, so the
// game never has to guess - it just feels heavier the higher the delay is.
// If the remote input still hasn't arrived (a jitter spike), the whole
// simulation stalls for a tick instead of guessing - that's the stutter.
//
// Every packet carries a short window of recent input history (not just the
// latest frame), so a single dropped packet doesn't permanently strand a
// frame - a later packet's history can still fill the gap. Real netcode
// implementations do this for the same reason; without it, packet loss
// over an unreliable channel would stall the game forever.
import { createInitialState, step } from '../gameState.js';
import { FrameRingBuffer } from '../inputBuffer.js';

const NEUTRAL_INPUT = { left: false, right: false, attack: false };
const HISTORY_WINDOW = 8;

export class DelayRunner {
  constructor(transport, localRole, inputDelayFrames = 3) {
    this.transport = transport;
    this.localRole = localRole; // 0 or 1
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

  // frameMs: current fixed-step duration, used to convert "half the ping"
  // into a whole number of frames.
  setDelayFromLatency(latencyMs, frameMs = 1000 / 60) {
    this.inputDelay = Math.max(1, Math.round((latencyMs / 2) / frameMs));
  }

  tick(rawLocalInput) {
    this.localInputs.set(this.tickCount, { input: rawLocalInput });

    const history = [];
    for (let f = Math.max(0, this.tickCount - HISTORY_WINDOW + 1); f <= this.tickCount; f += 1) {
      const entry = this.localInputs.get(f);
      if (entry) history.push({ frame: f, input: entry.input });
    }
    this.transport.send({ history });
    this.tickCount += 1;

    // We're allowed to have simulated up through (tickCount - inputDelay).
    // Catch up as far as data allows; if a frame is missing, stop and
    // retry it next tick instead of skipping past it.
    const targetFrame = this.tickCount - this.inputDelay;
    this.stalled = false;
    while (this.nextSimFrame < targetFrame) {
      const localEntry = this.localInputs.get(this.nextSimFrame);
      const remoteEntry = this.remoteInputs.get(this.nextSimFrame);
      if (!localEntry || !remoteEntry) {
        this.stalled = true; // remote input for this frame hasn't arrived yet
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
