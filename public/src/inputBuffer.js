// Fixed-size ring buffer keyed by frame number. Used to store recent
// inputs (both runners) and state snapshots (rollback runner only).
export class FrameRingBuffer {
  constructor(size = 60) {
    this.size = size;
    this.slots = new Array(size).fill(null);
  }

  set(frame, entry) {
    this.slots[frame % this.size] = { frame, ...entry };
  }

  get(frame) {
    const slot = this.slots[frame % this.size];
    if (slot && slot.frame === frame) return slot;
    return null; // either never set, or overwritten by a newer frame
  }
}
