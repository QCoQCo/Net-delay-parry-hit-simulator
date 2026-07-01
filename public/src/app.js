import { createLoopbackPair } from './transports/loopbackTransport.js';
import { createWebSocketTransport } from './transports/websocketTransport.js';
import { DelayRunner } from './netcode/delayRunner.js';
import { RollbackRunner } from './netcode/rollbackRunner.js';
import { renderStage } from './renderer.js';

const FRAME_MS = 1000 / 60;
const NEUTRAL = { left: false, right: false, attack: false };

const els = {
    connectionMode: document.getElementById('connection-mode'),
    netcodeMode: document.getElementById('netcode-mode'),
    wsPanel: document.getElementById('ws-panel'),
    wsUrl: document.getElementById('ws-url'),
    wsConnect: document.getElementById('ws-connect'),
    wsStatus: document.getElementById('ws-status'),
    latency: document.getElementById('latency'),
    jitter: document.getElementById('jitter'),
    loss: document.getElementById('loss'),
    latencyVal: document.getElementById('latency-val'),
    jitterVal: document.getElementById('jitter-val'),
    lossVal: document.getElementById('loss-val'),
    restart: document.getElementById('restart'),
    canvasP1: document.getElementById('canvas-p1'),
    canvasP2: document.getElementById('canvas-p2'),
    canvasP2Wrap: document.getElementById('canvas-p2-wrap'),
    instructions: document.getElementById('instructions'),
};

const ctxP1 = els.canvasP1.getContext('2d');
const ctxP2 = els.canvasP2.getContext('2d');

const keys = new Set();
window.addEventListener('keydown', (e) => keys.add(e.code));
window.addEventListener('keyup', (e) => keys.delete(e.code));

function readInput(scheme) {
    if (scheme === 'p1') {
        return { left: keys.has('KeyA'), right: keys.has('KeyD'), attack: keys.has('KeyF') };
    }
    return {
        left: keys.has('ArrowLeft'),
        right: keys.has('ArrowRight'),
        attack: keys.has('Slash'),
    };
}

function getParams() {
    return {
        latencyMs: Number(els.latency.value),
        jitterMs: Number(els.jitter.value),
        lossPercent: Number(els.loss.value),
    };
}

function makeRunner(transport, role) {
    if (els.netcodeMode.value === 'rollback') return new RollbackRunner(transport, role);
    const runner = new DelayRunner(transport, role);
    runner.setDelayFromLatency(getParams().latencyMs, FRAME_MS);
    return runner;
}

let session = null;
let sessionToken = 0;

function teardownSession() {
    sessionToken += 1;
    if (session?.transport?.close) session.transport.close();
    session = null;
}

function setupLoopbackSession() {
    const { peerA, peerB } = createLoopbackPair();
    peerA.setParams(getParams());
    peerB.setParams(getParams());
    const runnerP1 = makeRunner(peerA, 0);
    const runnerP2 = makeRunner(peerB, 1);
    session = { mode: 'loopback', peerA, peerB, runnerP1, runnerP2 };
    els.canvasP2Wrap.style.display = '';
    els.wsStatus.textContent = '';
    els.instructions.textContent =
        'P1: A/D 이동, F 공격 · P2: ←/→ 이동, / 공격 (같은 키보드로 양쪽 조작)';
}

async function setupWebSocketSession() {
    const myToken = sessionToken;
    els.canvasP2Wrap.style.display = 'none';
    els.wsStatus.textContent = '연결 중...';
    const transport = createWebSocketTransport(els.wsUrl.value.trim());
    try {
        await transport.ready;
    } catch {
        if (myToken === sessionToken) {
            els.wsStatus.textContent =
                '연결 실패 - 서버(server/server.js)가 실행 중인지 확인하세요.';
        }
        return;
    }
    if (myToken !== sessionToken) {
        transport.close();
        return;
    }

    transport.setParams(getParams());
    session = { mode: 'websocket', transport, runner: null, role: null };
    transport.onRole((role) => {
        if (myToken !== sessionToken) return;
        const runner = makeRunner(transport, role);
        session = { mode: 'websocket', transport, runner, role };
        els.wsStatus.textContent = `연결됨 · 내 역할: P${role + 1}`;
        els.instructions.textContent = 'A/D 이동, F 공격 (본인이 조작하는 캐릭터)';
    });
}

function restart() {
    teardownSession();
    if (els.connectionMode.value === 'loopback') {
        setupLoopbackSession();
    } else {
        setupWebSocketSession();
    }
}

els.connectionMode.addEventListener('change', () => {
    els.wsPanel.style.display = els.connectionMode.value === 'websocket' ? '' : 'none';
    restart();
});
els.netcodeMode.addEventListener('change', restart);
els.wsConnect.addEventListener('click', restart);
els.restart.addEventListener('click', restart);

for (const [slider, label, unit] of [
    [els.latency, els.latencyVal, 'ms'],
    [els.jitter, els.jitterVal, 'ms'],
    [els.loss, els.lossVal, '%'],
]) {
    slider.addEventListener('input', () => {
        label.textContent = `${slider.value}${unit}`;
        const params = getParams();
        if (session?.mode === 'loopback') {
            session.peerA.setParams(params);
            session.peerB.setParams(params);
            if (session.runnerP1.setDelayFromLatency) {
                session.runnerP1.setDelayFromLatency(params.latencyMs, FRAME_MS);
                session.runnerP2.setDelayFromLatency(params.latencyMs, FRAME_MS);
            }
        } else if (session?.mode === 'websocket' && session.transport) {
            session.transport.setParams(params);
            if (session.runner?.setDelayFromLatency) {
                session.runner.setDelayFromLatency(params.latencyMs, FRAME_MS);
            }
        }
    });
}

function statusFor(runner) {
    if (!runner) return { status: '' };
    if (runner instanceof DelayRunner) {
        return runner.stalled
            ? { status: '⏸ 정지 (원격 입력 대기 중)', statusColor: '#ff5a5a' }
            : { status: `입력 지연: ${runner.inputDelay}프레임`, statusColor: '#8b95a3' };
    }
    return runner.lastRollbackFrames > 0
        ? {
              status: `⟲ 롤백: ${runner.lastRollbackFrames}프레임 재시뮬레이션`,
              statusColor: '#e8c04a',
          }
        : { status: '예측 진행 중', statusColor: '#8b95a3' };
}

let accumulator = 0;
let lastTime = performance.now();

function loop(now) {
    accumulator += now - lastTime;
    lastTime = now;

    while (accumulator >= FRAME_MS) {
        if (session?.mode === 'loopback') {
            session.runnerP1.tick(readInput('p1'));
            session.runnerP2.tick(readInput('p2'));
        } else if (session?.mode === 'websocket' && session.runner) {
            session.runner.tick(readInput('p1'));
        }
        accumulator -= FRAME_MS;
    }

    if (session?.mode === 'loopback') {
        renderStage(ctxP1, els.canvasP1, session.runnerP1.state, {
            title: 'P1 관점 (view)',
            ...statusFor(session.runnerP1),
        });
        renderStage(ctxP2, els.canvasP2, session.runnerP2.state, {
            title: 'P2 관점 (view)',
            ...statusFor(session.runnerP2),
        });
    } else if (session?.mode === 'websocket' && session.runner) {
        renderStage(ctxP1, els.canvasP1, session.runner.state, {
            title: `내 화면 (P${session.role + 1})`,
            ...statusFor(session.runner),
        });
    } else {
        ctxP1.fillStyle = '#12161c';
        ctxP1.fillRect(0, 0, els.canvasP1.width, els.canvasP1.height);
        ctxP1.fillStyle = '#8b95a3';
        ctxP1.font = '13px "JetBrains Mono", monospace';
        ctxP1.fillText(session ? '상대 접속 대기 중...' : '초기화 중...', 14, 24);
    }

    requestAnimationFrame(loop);
}

setupLoopbackSession();
requestAnimationFrame(loop);
