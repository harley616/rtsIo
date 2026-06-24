import { WebSocketServer, WebSocket } from "ws";
import {
  NetOp, Command,
  decodeMessage, encodeCreated, encodeJoined, encodeReconnected,
  encodeStart, encodeTurn, encodeError, encodePlayerDisconnected,
} from "../shared/protocol.js";

const PORT = 3001;
const TURN_DURATION_MS = 5;
const RECONNECT_GRACE_MS = 5000;

interface PlayerConn {
  ws: WebSocket | null;
  playerId: number;
  commands: Command[];
  elapsedTime: number;
  loaded: boolean;
}

interface Game {
  code: string;
  players: PlayerConn[];
  turn: number;
  seed: number;
  started: boolean;
  turnTimer: ReturnType<typeof setTimeout> | null;
  lastTurnTime: number;
  destroyTimer: ReturnType<typeof setTimeout> | null;
}

const games = new Map<string, Game>();

function generateCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function send(ws: WebSocket | null, data: Uint8Array): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(data);
  }
}

const wss = new WebSocketServer({ port: PORT });
console.log(`Relay server listening on ws://localhost:${PORT}`);

wss.on("connection", (ws: WebSocket) => {
  let player: PlayerConn | null = null;
  let game: Game | null = null;

  ws.on("message", (raw: Buffer) => {
    const data = new Uint8Array(raw);
    const msg = decodeMessage(data);
    if (!msg) return;

    switch (msg.op) {
      case NetOp.Create: {
        const code = generateCode();
        const seed = Math.floor(Math.random() * 2147483647);
        game = { code, players: [], turn: 0, seed, started: false, turnTimer: null, lastTurnTime: 0, destroyTimer: null };
        player = { ws, playerId: 1, commands: [], elapsedTime: -1, loaded: false };
        game.players.push(player);
        games.set(code, game);
        send(ws, encodeCreated(code, 1, seed));
        console.log(`Game ${code} created (seed: ${seed})`);
        break;
      }

      case NetOp.Join: {
        const code = msg.code.toUpperCase();
        game = games.get(code) ?? null;
        if (!game || game.players.length >= 2) {
          send(ws, encodeError("Game not found or full"));
          return;
        }
        player = { ws, playerId: 2, commands: [], elapsedTime: -1, loaded: false };
        game.players.push(player);
        send(ws, encodeJoined(code, 2, game.seed));
        const startMsg = encodeStart(0);
        for (const p of game.players) {
          send(p.ws, startMsg);
        }
        console.log(`Player 2 joined game ${code}`);
        break;
      }

      case NetOp.Reconnect: {
        const code = msg.code.toUpperCase();
        const pid = msg.playerId;
        game = games.get(code) ?? null;
        if (!game) {
          send(ws, encodeError("Game not found"));
          return;
        }
        const existing = game.players.find((p) => p.playerId === pid);
        if (!existing) {
          send(ws, encodeError("Player not found in game"));
          return;
        }

        if (game.destroyTimer) {
          clearTimeout(game.destroyTimer);
          game.destroyTimer = null;
        }

        existing.ws = ws;
        player = existing;

        send(ws, encodeReconnected(code, pid, game.seed, game.turn, game.started));
        console.log(`Player ${pid} reconnected to game ${code}`);
        break;
      }

      case NetOp.Commands: {
        if (!game || !player) return;
        player.commands = [...player.commands, ...msg.commands];
        break;
      }

      case NetOp.Ack: {
        if (!game || !player) return;
        player.elapsedTime = msg.elapsedTime;
        break;
      }

      case NetOp.Loaded: {
        if (!game || !player) return;
        player.loaded = true;
        console.log(`Player ${player.playerId} loaded in game ${game.code}`);
        // Start the game once both players are loaded
        if (game.players.length === 2 && game.players.every((p) => p.loaded) && !game.started) {
          game.started = true;
          for (const p of game.players) {
            send(p.ws, encodeReconnected(game.code, p.playerId, game.seed, game.turn, game.started));
          }
          startGame(game);
        }
        break;
      }
    }
  });

  ws.on("close", () => {
    if (game && player) {
      console.log(`Player ${player.playerId} disconnected from game ${game.code}`);
      player.ws = null;

      if (!game.destroyTimer) {
        const closedGame = game;
        const closedPlayer = player;
        game.destroyTimer = setTimeout(() => {
          console.log(`Game ${closedGame.code} destroyed (reconnect timeout)`);
          for (const p of closedGame.players) {
            send(p.ws, encodePlayerDisconnected(closedPlayer.playerId));
          }
          if (closedGame.turnTimer) clearInterval(closedGame.turnTimer);
          games.delete(closedGame.code);
        }, RECONNECT_GRACE_MS);
      }
    }
  });
});

function startGame(game: Game): void {

  console.log(`Game ${game.code} started`);

  game.turnTimer = setInterval(() => {
    tryAdvanceTurn(game);
  }, TURN_DURATION_MS);
}

function tryAdvanceTurn(game: Game): void {
  if (game.players[0].elapsedTime !== game.players[1].elapsedTime) {
    // Wait for both players to acknowledge the turn
    return;
  }

  const p1Cmds = game.players[0]?.commands ?? [];
  const p2Cmds = game.players[1]?.commands ?? [];
  const msg = encodeTurn(game.turn, p1Cmds, p2Cmds);

  for (const p of game.players) {
    send(p.ws, msg);
  }

  game.turn++;
  for (const p of game.players) {
    p.commands = [];
  }
}
