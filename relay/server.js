import { WebSocketServer } from "ws";

const PORT = 3001;
const TURN_DURATION_MS = 10;
const RECONNECT_GRACE_MS = 5000;

/** @type {Map<string, Game>} */
const games = new Map();

/**
 * @typedef {{ ws: import('ws').WebSocket | null, playerId: number, commands: any[], turnAcked: number }} PlayerConn
 * @typedef {{ code: string, players: PlayerConn[], turn: number, seed: number, started: boolean, turnTimer: ReturnType<typeof setInterval> | null, destroyTimer: ReturnType<typeof setTimeout> | null }} Game
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
        game = { code, players: [], turn: 0, seed, started: false, turnTimer: null, destroyTimer: null };
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

      case "reconnect": {
        // Reconnect to an existing game (e.g., after page navigation from lobby to game)
        const code = msg.code?.toUpperCase();
        const pid = msg.playerId;
        game = games.get(code) ?? null;
        if (!game) {
          ws.send(JSON.stringify({ type: "error", message: "Game not found" }));
          return;
        }
        const existing = game.players.find((p) => p.playerId === pid);
        if (!existing) {
          ws.send(JSON.stringify({ type: "error", message: "Player not found in game" }));
          return;
        }

        // Cancel any pending destroy timer
        if (game.destroyTimer) {
          clearTimeout(game.destroyTimer);
          game.destroyTimer = null;
        }

        // Replace the websocket
        existing.ws = ws;
        player = existing;

        ws.send(JSON.stringify({
          type: "reconnected",
          code,
          playerId: pid,
          seed: game.seed,
          turn: game.turn,
          started: game.started,
        }));
        console.log(`Player ${pid} reconnected to game ${code}`);

        // If the game was started and both players are now connected, resume
        if (game.started && game.players.every((p) => p.ws?.readyState === 1)) {
          console.log(`Game ${code} resumed`);
        }
        break;
      }

      case "commands": {
        if (!game || !player) return;
        const turn = msg.turn;
        if (turn !== game.turn) return;

        player.commands = [...player.commands, ...(msg.commands ?? [])];
        player.turnAcked = turn;
        break;
      }
    }
  });

  ws.on("close", () => {
    if (game && player) {
      console.log(`Player ${player.playerId} disconnected from game ${game.code}`);
      player.ws = null;

      // Grace period before destroying the game
      if (!game.destroyTimer) {
        game.destroyTimer = setTimeout(() => {
          console.log(`Game ${game.code} destroyed (reconnect timeout)`);
          // Notify remaining player
          for (const p of game.players) {
            if (p.ws?.readyState === 1) {
              p.ws.send(JSON.stringify({ type: "playerDisconnected", playerId: player.playerId }));
            }
          }
          if (game.turnTimer) clearInterval(game.turnTimer);
          games.delete(game.code);
        }, RECONNECT_GRACE_MS);
      }
    }
  });
});

function startGame(game) {
  for (const p of game.players) {
    if (p.ws?.readyState === 1) {
      p.ws.send(JSON.stringify({ type: "start", turn: 0 }));
    }
  }
  game.started = true;
  console.log(`Game ${game.code} started`);

  game.turnTimer = setInterval(() => {
    for (const p of game.players) {
      if (p.turnAcked < game.turn) {
        p.commands = [];
        p.turnAcked = game.turn;
      }
    }
    tryAdvanceTurn(game);
  }, TURN_DURATION_MS);
}

function tryAdvanceTurn(game) {
  if (game.players.some((p) => p.turnAcked < game.turn)) return;

  const turnData = {
    type: "turn",
    turn: game.turn,
    commands: {
      1: game.players[0]?.commands ?? [],
      2: game.players[1]?.commands ?? [],
    },
  };

  const msg = JSON.stringify(turnData);
  for (const p of game.players) {
    if (p.ws?.readyState === 1) {
      p.ws.send(msg);
      while (p.ws) {
      }
    }
  }

  game.turn++;
  for (const p of game.players) {
    p.commands = [];
  }
}
