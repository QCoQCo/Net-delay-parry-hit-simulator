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
import { createInitialState, step, cloneState, checksumState } from '../gameState.js';
import { FrameRingBuffer } from '../inputBuffer.js';

const HISTORY_SIZE = 90;
const HISTORY_WINDOW = 8;
const NEUTRAL_INPUT = { left: false, right: false, attack: false };
// Peers exchange a state checksum every SYNC_CHECK_INTERVAL frames to
// detect desyncs (both sides must use the same value, which they do since
// they run the same code).
const SYNC_CHECK_INTERVAL = 20;

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

    // --- desync detection ---
    // A frame f's state is only comparable across peers once all remote
    // inputs for frames < f have arrived (the state can no longer be
    // corrected by a rollback). We can't wait until then to hash it,
    // though: under high latency the snapshot may already have been
    // evicted from the ring buffer. So we hash every SYNC_CHECK_INTERVAL-th
    // frame as we pass it (pendingChecks), let rewindAndResim overwrite
    // those hashes when it corrects the trajectory, and finalize a hash
    // once all inputs before it are confirmed. If a rollback had to bail
    // out (snapshot evicted), the stale hash gets finalized as-is and
    // won't match the peer's - which is exactly the desync we want to see.
    this.firstUnconfirmedRemote = 0; // all remote inputs < this frame have arrived
    this.pendingChecks = new Map(); // frame -> hash, still correctable
    this.localChecks = new Map(); // frame -> hash, finalized, awaiting the remote hash
    this.remoteChecks = new Map(); // frame -> hash received from the peer
    this.latestSync = null; // { frame, hash } piggybacked on outgoing packets
    this.lastSyncedFrame = -1; // newest frame both peers agreed on
    this.desyncFrame = null; // first compared frame that mismatched (sticky)

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

      if (packet.sync) {
        this.remoteChecks.set(packet.sync.frame, packet.sync.hash);
        this.compareCheck(packet.sync.frame);
      }
      this.finalizeConfirmedChecks();
    });
  }

  tick(rawLocalInput) {
    this.localInputs.set(this.frame, { input: rawLocalInput });
    this.snapshots.set(this.frame, { state: cloneState(this.state) });
    if (this.frame % SYNC_CHECK_INTERVAL === 0) {
      // Provisional hash of the state before simulating this frame - may
      // still be corrected by rewindAndResim before it's finalized.
      this.pendingChecks.set(this.frame, checksumState(this.state));
    }

    const history = [];
    for (let f = Math.max(0, this.frame - HISTORY_WINDOW + 1); f <= this.frame; f += 1) {
      const entry = this.localInputs.get(f);
      if (entry) history.push({ frame: f, input: entry.input });
    }
    this.transport.send({ history, sync: this.latestSync });

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
      if (this.pendingChecks.has(f + 1)) {
        this.pendingChecks.set(f + 1, checksumState(rewound));
      }
    }
    this.state = rewound;
  }

  // Finalizes pending checksums whose frames can no longer be corrected
  // (all remote inputs before them have arrived), making them comparable
  // with the peer's. Called after each batch of received inputs.
  finalizeConfirmedChecks() {
    while (this.remoteInputs.get(this.firstUnconfirmedRemote)) this.firstUnconfirmedRemote += 1;
    for (const [frame, hash] of this.pendingChecks) {
      if (frame > this.firstUnconfirmedRemote) continue;
      this.pendingChecks.delete(frame);
      this.localChecks.set(frame, hash);
      if (!this.latestSync || frame > this.latestSync.frame) {
        this.latestSync = { frame, hash };
      }
      this.compareCheck(frame);
    }
    // Only the newest finalized hash rides on packets, so an older frame
    // that finalized in the same batch may never be compared - drop stale
    // entries. A real desync persists, so a later comparison still catches it.
    if (this.latestSync) {
      const cutoff = this.latestSync.frame - 10 * SYNC_CHECK_INTERVAL;
      for (const f of this.localChecks.keys()) if (f < cutoff) this.localChecks.delete(f);
      for (const f of this.remoteChecks.keys()) if (f < cutoff) this.remoteChecks.delete(f);
    }
  }

  compareCheck(frame) {
    if (!this.localChecks.has(frame) || !this.remoteChecks.has(frame)) return;
    if (this.localChecks.get(frame) === this.remoteChecks.get(frame)) {
      if (frame > this.lastSyncedFrame) this.lastSyncedFrame = frame;
    } else if (this.desyncFrame === null) {
      this.desyncFrame = frame;
    }
    this.localChecks.delete(frame);
    this.remoteChecks.delete(frame);
  }
}
