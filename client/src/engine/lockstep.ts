import { Game } from "./game";
import {
    NetOp, Command,
    decodeMessage, encodeCreate, encodeJoin, encodeReconnect, encodeCommandsMsg, encodeAck, encodeLoaded,
} from "../../../shared/protocol";

const DT = parseFloat(import.meta.env.VITE_DT);

export type LockstepState = "connecting" | "waiting" | "playing" | "disconnected";

export interface LockstepCallbacks {
    onStateChange: (state: LockstepState) => void;
    onGameCreated: (code: string) => void;
    onTurnApplied: (game: Game) => void;
}

export class LockstepManager {
    game: Game | null = null;
    private ws: WebSocket | null = null;
    private localCommands: Command[] = [];
    private currentTurn = 0;
    private state: LockstepState = "connecting";
    private callbacks: LockstepCallbacks;
    private pendingTurns: { turn: number; p1Commands: Command[]; p2Commands: Command[] }[] = [];
    private tickTimer: ReturnType<typeof setInterval> | null = null;
    private inFlightTurn: Promise<void> | null = null;

    playerId = -1;
    seed = 0;

    constructor(callbacks: LockstepCallbacks) {
        this.callbacks = callbacks;
    }

    sendCommand(cmd: Command): void {
        this.localCommands.push(cmd);
    }

    createGame(serverUrl: string): void {
        this.connect(serverUrl, () => {
            this.ws!.send(encodeCreate());
        });
    }

    joinGame(serverUrl: string, code: string): void {
        this.connect(serverUrl, () => {
            this.ws!.send(encodeJoin(code));
        });
    }

    reconnectGame(serverUrl: string, code: string, playerId: number): void {
        this.connect(serverUrl, () => {
            this.ws!.send(encodeReconnect(code, playerId));
        });
    }

    /** Signal to the relay that this client has finished loading and is ready */
    sendLoaded(): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(encodeLoaded());
        }
    }

    getGame(): Game | null {
        return this.game;
    }

    private connect(url: string, onOpen: () => void): void {
        this.setState("connecting");
        this.ws = new WebSocket(url);
        this.ws.binaryType = "arraybuffer";

        this.ws.onopen = () => onOpen();

        this.ws.onmessage = (event) => {
            const data = new Uint8Array(event.data as ArrayBuffer);
            const msg = decodeMessage(data);
            if (msg) this.handleMessage(msg);
        };

        this.ws.onclose = () => this.setState("disconnected");
        this.ws.onerror = () => this.setState("disconnected");
    }

    private handleMessage(msg: ReturnType<typeof decodeMessage>): void {
        if (!msg) return;

        switch (msg.op) {
            case NetOp.Created:
                this.playerId = msg.playerId;
                this.seed = msg.seed;
                this.setState("waiting");
                this.callbacks.onGameCreated(msg.code);
                break;

            case NetOp.Joined:
                this.playerId = msg.playerId;
                this.seed = msg.seed;
                this.setState("waiting");
                break;

            case NetOp.Reconnected:
                console.log("Reconnected to game", msg);
                this.playerId = msg.playerId;
                this.seed = msg.seed;
                if (msg.started) {
                    this.currentTurn = msg.turn;
                    this.game = Game.makeTwoPlayerGame(this.seed);
                    this.setState("playing");
                    this.submitTurn();
                } else {
                    this.setState("waiting");
                }
                break;

            case NetOp.Start:
                this.currentTurn = 0;
                this.game = Game.makeTwoPlayerGame(this.seed);
                this.setState("playing");
                this.submitTurn();
                break;

            case NetOp.Turn:
                this.pendingTurns.push({
                    turn: msg.turn,
                    p1Commands: msg.p1Commands,
                    p2Commands: msg.p2Commands,
                });
                this.ws?.send(encodeAck(this.game ? this.game.elapsedTime : 0));
                if (this.inFlightTurn) {
                    this.inFlightTurn = this.inFlightTurn.then(() => this.tick());
                } else {
                    this.tick();
                }
                break;

            case NetOp.PlayerDisconnected:
                this.setState("disconnected");
                break;

            case NetOp.Error:
                console.error("Relay error:", msg.message);
                break;
        }
    }

    private submitTurn(): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(encodeCommandsMsg(this.currentTurn, this.localCommands));
        this.localCommands = [];
    }

    private async tick(): Promise<void> {
        if (this.pendingTurns.length > 0 && this.game) {
            const turnData = this.pendingTurns.shift()!;
            await this.game.updateAsync(DT);
            this.applyTurn(turnData);
            this.submitTurn();
            this.inFlightTurn = this.game.updateAsync(DT);
        }
    }

    private applyTurn(turnData: { turn: number; p1Commands: Command[]; p2Commands: Command[] }): void {
        if (!this.game || turnData.turn !== this.currentTurn) return;

        for (const cmd of turnData.p1Commands) {
            this.game.applyCommand(1, cmd);
        }
        for (const cmd of turnData.p2Commands) {
            this.game.applyCommand(2, cmd);
        }


        this.currentTurn++;
        this.callbacks.onTurnApplied(this.game);

        // Tell the relay we finished this turn and our elapsed time
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(encodeAck(this.game.elapsedTime));
        }
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
