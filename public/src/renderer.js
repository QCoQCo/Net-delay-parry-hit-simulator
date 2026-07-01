import { STAGE_WIDTH, PLAYER_HALF_WIDTH, HIT_RANGE } from './gameState.js';

const STAGE_Y = 130;
const PLAYER_HEIGHT = 70;

const STATE_COLORS = {
    idle: null,
    startup: '#e8c04a',
    active: '#ff5a5a',
    recovery: '#5a6472',
    hitstun: '#ffffff',
};

const PLAYER_BASE_COLORS = ['#4fc3f7', '#ff8a65'];

export function renderStage(ctx, canvas, state, hud) {
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = '#12161c';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#2a3340';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(20, STAGE_Y + PLAYER_HEIGHT / 2);
    ctx.lineTo(width - 20, STAGE_Y + PLAYER_HEIGHT / 2);
    ctx.stroke();

    state.players.forEach((player, i) => {
        if (player.state === 'active') {
            ctx.fillStyle = 'rgba(255, 90, 90, 0.15)';
            ctx.fillRect(player.x - HIT_RANGE, STAGE_Y - 10, HIT_RANGE * 2, PLAYER_HEIGHT + 20);
        }

        const color = STATE_COLORS[player.state] ?? PLAYER_BASE_COLORS[i];
        const flashOn = player.state !== 'hitstun' || Math.floor(state.frame / 3) % 2 === 0;
        ctx.fillStyle = flashOn ? color : PLAYER_BASE_COLORS[i];
        ctx.strokeStyle = PLAYER_BASE_COLORS[i];
        ctx.lineWidth = 2;
        const x = player.x - PLAYER_HALF_WIDTH;
        ctx.fillRect(x, STAGE_Y, PLAYER_HALF_WIDTH * 2, PLAYER_HEIGHT);
        ctx.strokeRect(x, STAGE_Y, PLAYER_HALF_WIDTH * 2, PLAYER_HEIGHT);

        ctx.fillStyle = '#d7dde5';
        ctx.font = '13px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`P${i + 1} · ${player.state}`, player.x, STAGE_Y - 14);
        ctx.fillText(`hits: ${player.hits}`, player.x, STAGE_Y + PLAYER_HEIGHT + 22);
    });

    ctx.textAlign = 'left';
    ctx.fillStyle = '#8b95a3';
    ctx.font = '12px "JetBrains Mono", monospace';
    ctx.fillText(hud.title, 14, 20);
    ctx.textAlign = 'right';
    ctx.fillText(`frame ${state.frame}`, width - 14, 20);

    if (hud.status) {
        ctx.textAlign = 'left';
        ctx.fillStyle = hud.statusColor ?? '#8b95a3';
        ctx.fillText(hud.status, 14, height - 10);
    }
}

export { STAGE_WIDTH };
