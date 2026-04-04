import { WebSocketServer } from "ws";

const PORT = 3001;
const TURN_DURATION_MS = 100; // 10 sim ticks per turn at 10ms each

/** @type {Map<string, Game>} */
const games = new Map();

/**
 * @typedef {{ ws: import('ws').WebSocket, playerId: number, commands: any[], turnAcked: number }} PlayerConn
 * @typedef {{ code: string, players: PlayerConn[], turn: number, seed: number, started: boolean, turnTimer: ReturnType<typeof setInterval> | null }} Game
 */

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

const wss = new WebSocketServer({ port: PORT });
console.log(`Relay server listening on ws://localhost:${PORT}`);

wss.on("connection", (ws) => {
  let player = /** @type {PlayerConn | null} */ (null);
  let game = /** @type {Game | null} */ (null);

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case "create": {
        const code = generateCode();
        const seed = Math.floor(Math.random() * 2147483647);
        game = { code, players: [], turn: 0, seed, started: false, turnTimer: null };
        player = { ws, playerId: 1, commands: [], turnAcked: -1 };
        game.players.push(player);
        games.set(code, game);
        ws.send(JSON.stringify({ type: "created", code, playerId: 1, seed }));
        console.log(`Game ${code} created (seed: ${seed})`);
        break;
      }

      case "join": {
        const code = msg.code?.toUpperCase();
        game = games.get(code) ?? null;
        if (!game || game.players.length >= 2) {
          ws.send(JSON.stringify({ type: "error", message: "Game not found or full" }));
          return;
        }
        player = { ws, playerId: 2, commands: [], turnAcked: -1 };
        game.players.push(player);
        ws.send(JSON.stringify({ type: "joined", code, playerId: 2, seed: game.seed }));
        console.log(`Player 2 joined game ${code}`);

        // Both players connected — start the game
        startGame(game);
        break;
      }

      case "commands": {
        // Player submitting commands for a turn
        if (!game || !player) return;
        const turn = msg.turn;
        if (turn !== game.turn) return; // ignore stale/future turns

        player.commands = msg.commands ?? [];
        player.turnAcked = turn;

        // Check if both players have submitted for this turn
        tryAdvanceTurn(game);
        break;
      }
    }
  });

  ws.on("close", () => {
    if (game && player) {
      console.log(`Player ${player.playerId} disconnected from game ${game.code}`);
      // Notify other player
      for (const p of game.players) {
        if (p !== player && p.ws.readyState === 1) {
          p.ws.send(JSON.stringify({ type: "playerDisconnected", playerId: player.playerId }));
        }
      }
      if (game.turnTimer) clearInterval(game.turnTimer);
      games.delete(game.code);
    }
  });
});

function startGame(game) {
  // Notify both players the game is starting
  for (const p of game.players) {
    p.ws.send(JSON.stringify({ type: "start", turn: 0 }));
  }
  game.started = true;
  console.log(`Game ${game.code} started`);

  // Turn timeout: if a player doesn't submit within 2x turn duration, send empty commands
  game.turnTimer = setInterval(() => {
    for (const p of game.players) {
      if (p.turnAcked < game.turn) {
        p.commands = [];
        p.turnAcked = game.turn;
      }
    }
    tryAdvanceTurn(game);
  }, TURN_DURATION_MS * 3);
}

function tryAdvanceTurn(game) {
  // Both players must have submitted
  if (game.players.some((p) => p.turnAcked < game.turn)) return;

  // Build combined command set
  const turnData = {
    type: "turn",
    turn: game.turn,
    commands: {
      1: game.players[0]?.commands ?? [],
      2: game.players[1]?.commands ?? [],
    },
  };

  // Send to both players
  const msg = JSON.stringify(turnData);
  for (const p of game.players) {
    if (p.ws.readyState === 1) {
      p.ws.send(msg);
    }
  }

  // Advance turn
  game.turn++;
  for (const p of game.players) {
    p.commands = [];
  }
}
