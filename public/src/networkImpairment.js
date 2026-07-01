export class NetworkImpairment {
    constructor(rawSend) {
        this.rawSend = rawSend;
        this.latencyMs = 100;
        this.jitterMs = 0;
        this.lossPercent = 0;
    }

    setParams({ latencyMs, jitterMs, lossPercent }) {
        if (latencyMs !== undefined) this.latencyMs = latencyMs;
        if (jitterMs !== undefined) this.jitterMs = jitterMs;
        if (lossPercent !== undefined) this.lossPercent = lossPercent;
    }

    send(packet) {
        if (Math.random() * 100 < this.lossPercent) return;
        const jitter = this.jitterMs > 0 ? (Math.random() * 2 - 1) * this.jitterMs : 0;
        const delay = Math.max(0, this.latencyMs + jitter);
        setTimeout(() => this.rawSend(packet), delay);
    }
}
