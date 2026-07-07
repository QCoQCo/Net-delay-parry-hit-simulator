// Rollback netcode: local input is applied immediately (no waiting), and
// remote input is predicted as "whatever they last did" until the real
// value arrives. When a real remote input arrives for a frame we've
// already simulated past, we restore the snapshot from just before that
// frame and fast-forward back to the present - visibly snapping anything
// that depended on the wrong prediction (typically the opponent's position).
//
// Every packet carries a short window of recent input history, same as the
// delay runner, so one dropped packet doesn't leave a frame's true input
// permanently unknown to the other side.
import { createInitialState, step, cloneState } from '../gameState.js';
import { FrameRingBuffer } from '../inputBuffer.js';

const HISTORY_SIZE = 90;
const HISTORY_WINDOW = 8;
const NEUTRAL_INPUT = { left: false, right: false, attack: false };

export class RollbackRunner {
  constructor(transport, localRole) {
    this.transport = transport;
    this.localRole = localRole; // 0 or 1
    this.state = createInitialState();
    this.frame = 0;
    this.lastConfirmedFrame = -1;
    this.lastConfirmedRemoteInput = NEUTRAL_INPUT;
    this.localInputs = new FrameRingBuffer(HISTORY_SIZE);
    this.remoteInputs = new FrameRingBuffer(HISTORY_SIZE); // confirmed (real) remote inputs only
    this.snapshots = new FrameRingBuffer(HISTORY_SIZE); // state BEFORE simulating `frame`
    this.lastRollbackFrames = 0; // frames resimulated on the most recent correction, for the UI
    this.lastRollbackTime = 0; // performance.now() of that correction, so the UI can hold the indicator

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
      // Prediction baseline only moves forward - jitter can deliver packets
      // out of order, so an older packet shouldn't undo a newer one.
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

    const predictedRemote = this.remoteInputs.get(this.frame)?.input ?? this.lastConfirmedRemoteInput;
    const inputP1 = this.localRole === 0 ? rawLocalInput : predictedRemote;
    const inputP2 = this.localRole === 0 ? predictedRemote : rawLocalInput;

    this.state = step(this.state, inputP1, inputP2);
    this.frame += 1;
    return this.state;
  }

  // Rewinds to just before `fromFrame` and resimulates forward to the
  // present using the best data available for each frame (real if we have
  // it, predicted otherwise).
  rewindAndResim(fromFrame) {
    if (fromFrame >= this.frame) return; // for a frame we haven't reached yet, nothing to redo
    const snapshot = this.snapshots.get(fromFrame);
    if (!snapshot) return; // fell out of the history window - can't correct, just carry on

    this.lastRollbackFrames = this.frame - fromFrame;
    this.lastRollbackTime = performance.now();

    let rewound = cloneState(snapshot.state);
    for (let f = fromFrame; f < this.frame; f += 1) {
      const localEntry = this.localInputs.get(f);
      const remoteEntry = this.remoteInputs.get(f);
      const remoteInput = remoteEntry ? remoteEntry.input : this.lastConfirmedRemoteInput;
      const localInput = localEntry ? localEntry.input : NEUTRAL_INPUT;
      const inputP1 = this.localRole === 0 ? localInput : remoteInput;
      const inputP2 = this.localRole === 0 ? remoteInput : localInput;
      rewound = step(rewound, inputP1, inputP2);
      // Keep the stored snapshot for f+1 in sync with the corrected
      // trajectory, so a later correction that needs to rewind to this
      // point starts from the right place instead of a stale prediction.
      this.snapshots.set(f + 1, { state: cloneState(rewound) });
    }
    this.state = rewound;
  }
}
