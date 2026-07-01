export const STAGE_WIDTH = 800;
export const MOVE_SPEED = 4;
export const HIT_RANGE = 70;
export const STARTUP_FRAMES = 6;
export const ACTIVE_FRAMES = 3;
export const RECOVERY_FRAMES = 10;
export const HITSTUN_FRAMES = 20;
export const PLAYER_HALF_WIDTH = 20;

export function createInitialState() {
    return {
        frame: 0,
        players: [
            { x: 150, state: 'idle', stateFrame: 0, hits: 0 },
            { x: 650, state: 'idle', stateFrame: 0, hits: 0 },
        ],
    };
}

export function cloneState(state) {
    return {
        frame: state.frame,
        players: [{ ...state.players[0] }, { ...state.players[1] }],
    };
}

export function step(state, inputP1, inputP2) {
    const next = cloneState(state);
    next.frame = state.frame + 1;

    const aWasActive = next.players[0].state === 'active';
    const bWasActive = next.players[1].state === 'active';

    advancePlayer(next.players[0], inputP1);
    advancePlayer(next.players[1], inputP2);
    clampToStage(next.players[0]);
    clampToStage(next.players[1]);
    resolveHits(next, aWasActive, bWasActive);

    return next;
}

function advancePlayer(player, input) {
    if (player.state === 'idle') {
        if (input.left) player.x -= MOVE_SPEED;
        if (input.right) player.x += MOVE_SPEED;
        if (input.attack) {
            player.state = 'startup';
            player.stateFrame = 0;
        }
        return;
    }

    player.stateFrame += 1;
    if (player.state === 'startup' && player.stateFrame >= STARTUP_FRAMES) {
        player.state = 'active';
        player.stateFrame = 0;
    } else if (player.state === 'active' && player.stateFrame >= ACTIVE_FRAMES) {
        player.state = 'recovery';
        player.stateFrame = 0;
    } else if (player.state === 'recovery' && player.stateFrame >= RECOVERY_FRAMES) {
        player.state = 'idle';
        player.stateFrame = 0;
    } else if (player.state === 'hitstun' && player.stateFrame >= HITSTUN_FRAMES) {
        player.state = 'idle';
        player.stateFrame = 0;
    }
}

function clampToStage(player) {
    if (player.x < PLAYER_HALF_WIDTH) player.x = PLAYER_HALF_WIDTH;
    if (player.x > STAGE_WIDTH - PLAYER_HALF_WIDTH) player.x = STAGE_WIDTH - PLAYER_HALF_WIDTH;
}

function resolveHits(state, aWasActive, bWasActive) {
    const [a, b] = state.players;
    const dist = Math.abs(a.x - b.x);
    if (aWasActive && dist <= HIT_RANGE && b.state !== 'hitstun') {
        b.state = 'hitstun';
        b.stateFrame = 0;
        b.hits += 1;
    }
    if (bWasActive && dist <= HIT_RANGE && a.state !== 'hitstun') {
        a.state = 'hitstun';
        a.stateFrame = 0;
        a.hits += 1;
    }
}
