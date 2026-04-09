import { Command, PlayerID } from "./types";
import { Game } from "./game";

const DT = 0.05;

export type LockstepState = "connecting" | "waiting" | "playing" | "disconnected";

export interface LockstepCallbacks {
    onStateChange: (state: LockstepState) => void;
    onGameCreated: (code: string) => void;
    onTurnApplied: (game: Game) => void;
}

export class LockstepManager {
    private ws: WebSocket | null = null;
    private game: Game | null = null;
    private localCommands: Command[] = [];
    private currentTurn = 0;
    private state: LockstepState = "connecting";
    private callbacks: LockstepCallbacks;
    private pendingTurns: any[] = [];
    private tickTimer: ReturnType<typeof setInterval> | null = null;

    playerId: PlayerID = -1;
    seed: number = 0;

    constructor(callbacks: LockstepCallbacks) {
        this.callbacks = callbacks;
    }

    /** Queue a command to be sent on the next turn boundary */
    sendCommand(cmd: Command): void {
        this.localCommands.push(cmd);
    }

    /** Connect to relay and create a new game */
    createGame(serverUrl: string): void {
        this.connect(serverUrl, () => {
            this.ws!.send(JSON.stringify({ type: "create" }));
        });
    }

    /** Connect to relay and join an existing game */
    joinGame(serverUrl: string, code: string): void {
        this.connect(serverUrl, () => {
            this.ws!.send(JSON.stringify({ type: "join", code }));
        });
    }

    getGame(): Game | null {
        return this.game;
    }

    private connect(url: string, onOpen: () => void): void {
        this.setState("connecting");
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
            onOpen();
        };

        this.ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            this.handleMessage(msg);
        };

        this.ws.onclose = () => {
            this.setState("disconnected");
        };

        this.ws.onerror = () => {
            this.setState("disconnected");
        };
    }

    private handleMessage(msg: any): void {
        switch (msg.type) {
            case "created":
                this.playerId = msg.playerId;
                this.seed = msg.seed;
                this.setState("waiting");
                this.callbacks.onGameCreated(msg.code);
                break;

            case "joined":
                this.playerId = msg.playerId;
                this.seed = msg.seed;
                this.setState("waiting");
                break;

            case "start":
                this.currentTurn = 0;
                this.game = Game.makeTwoPlayerGame(this.seed);
                this.setState("playing");
                break;

            case "turn":
                // Queue the turn for processing at the next tick
                this.pendingTurns.push(msg);
                this.tick()
                break;

            case "playerDisconnected":
                this.setState("disconnected");
                break;

            case "error":
                console.error("Relay error:", msg.message);
                break;
        }
    }

    private submitTurn(): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        this.ws.send(JSON.stringify({
            type: "commands",
            turn: this.currentTurn,
            commands: this.localCommands,
        }));
        this.localCommands = [];
    }

    private tick(): void {
        // Process one pending turn if available
        if (this.pendingTurns.length > 0) {
            const msg = this.pendingTurns.shift()!;
            this.applyTurn(msg);
        }
        // Submit commands for the next turn
        this.submitTurn();
    }

    private applyTurn(msg: any): void {
        if (!this.game || msg.turn !== this.currentTurn) return;

        const p1Commands: Command[] = msg.commands["1"] ?? [];
        const p2Commands: Command[] = msg.commands["2"] ?? [];

        // Apply commands from both players
        for (const cmd of p1Commands) {
            this.game.applyCommand(1, cmd);
        }
        for (const cmd of p2Commands) {
            this.game.applyCommand(2, cmd);
        }

        this.game.update(DT);

        this.currentTurn++;
        this.callbacks.onTurnApplied(this.game);
    }

    private setState(state: LockstepState): void {
        this.state = state;
        if (state === "disconnected" && this.tickTimer) {
            clearInterval(this.tickTimer);
            this.tickTimer = null;
        }
        this.callbacks.onStateChange(state);
    }

    getState(): LockstepState {
        return this.state;
    }
}
