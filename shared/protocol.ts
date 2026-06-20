// ============================================================
// Shared binary protocol for client <-> relay communication.
// Both clientV2 and relay import this file directly.
// ============================================================

// --- Network message opcodes (first byte of every message) ---

export const enum NetOp {
    // Client → Server
    Create      = 0x01,
    Join        = 0x02,
    Reconnect   = 0x03,
    Commands    = 0x04,
    Ack         = 0x05, // client finished processing a turn, reports elapsedTime
    Loaded      = 0x06, // client finished loading assets and is ready to play

    // Server → Client
    Created           = 0x10,
    Joined            = 0x11,
    Reconnected       = 0x12,
    Start             = 0x13,
    Turn              = 0x14,
    Error             = 0x15,
    PlayerDisconnected = 0x16,
}

// --- Game command opcodes ---

export const enum CmdOp {
    MoveUnit      = 0x01,
    PlaceBuilding = 0x02,
    CreateKnight  = 0x03,
    CreateBuilder = 0x04,
}

// --- Building type IDs ---

export const enum BuildingId {
    House    = 0,
    Townhall = 1,
    Barracks = 2,
}

const BUILDING_NAMES = ["house", "townhall", "barracks"] as const;
export type BuildingType = (typeof BUILDING_NAMES)[number];

export function buildingIdToName(id: BuildingId): BuildingType {
    return BUILDING_NAMES[id];
}

export function buildingNameToId(name: string): BuildingId {
    const idx = BUILDING_NAMES.indexOf(name as BuildingType);
    return idx >= 0 ? idx as BuildingId : BuildingId.House;
}

// --- Game command types (used by the engine) ---

export interface MoveUnitCommand {
    type: "moveUnit";
    entityId: number;
    pos: { x: number; y: number; z: number };
    moveType: "passive" | "aggressive";
}

export interface PlaceBuildingCommand {
    type: "placeBuilding";
    buildingType: BuildingType;
    pos: { x: number; z: number };
}

export interface CreateKnightCommand {
    type: "createKnight";
}

export interface CreateBuilderCommand {
    type: "createBuilder";
}

export type Command = MoveUnitCommand | PlaceBuildingCommand | CreateKnightCommand | CreateBuilderCommand;

// --- Game code encoding (6 ASCII chars → 6 bytes) ---

const CODE_LEN = 6;

function writeCode(view: DataView, offset: number, code: string): void {
    for (let i = 0; i < CODE_LEN; i++) {
        view.setUint8(offset + i, code.charCodeAt(i));
    }
}

function readCode(view: DataView, offset: number): string {
    let code = "";
    for (let i = 0; i < CODE_LEN; i++) {
        code += String.fromCharCode(view.getUint8(offset + i));
    }
    return code;
}

// ============================================================
// Command serialization
// ============================================================

// MoveUnit:      [0x01, entityId:u16, x:f32, y:f32, z:f32, moveType:u8] = 16 bytes
// PlaceBuilding: [0x02, buildingId:u8, x:i16, z:i16]                    = 6 bytes
// CreateKnight:  [0x03]                                                  = 1 byte
// CreateBuilder: [0x04]                                                  = 1 byte

export function encodeCommand(cmd: Command): Uint8Array {
    switch (cmd.type) {
        case "moveUnit": {
            const buf = new ArrayBuffer(16);
            const v = new DataView(buf);
            v.setUint8(0, CmdOp.MoveUnit);
            v.setUint16(1, cmd.entityId);
            v.setFloat32(3, cmd.pos.x);
            v.setFloat32(7, cmd.pos.y);
            v.setFloat32(11, cmd.pos.z);
            v.setUint8(15, cmd.moveType === "aggressive" ? 1 : 0);
            return new Uint8Array(buf);
        }
        case "placeBuilding": {
            const buf = new ArrayBuffer(6);
            const v = new DataView(buf);
            v.setUint8(0, CmdOp.PlaceBuilding);
            v.setUint8(1, buildingNameToId(cmd.buildingType));
            v.setInt16(2, cmd.pos.x);
            v.setInt16(4, cmd.pos.z);
            return new Uint8Array(buf);
        }
        case "createKnight":
            return new Uint8Array([CmdOp.CreateKnight]);
        case "createBuilder":
            return new Uint8Array([CmdOp.CreateBuilder]);
    }
}

export function decodeCommand(data: Uint8Array, offset: number): { cmd: Command; bytesRead: number } | null {
    if (offset >= data.length) return null;
    const v = new DataView(data.buffer, data.byteOffset + offset);
    const op = v.getUint8(0);

    switch (op) {
        case CmdOp.MoveUnit:
            return {
                cmd: {
                    type: "moveUnit",
                    entityId: v.getUint16(1),
                    pos: { x: v.getFloat32(3), y: v.getFloat32(7), z: v.getFloat32(11) },
                    moveType: v.getUint8(15) === 1 ? "aggressive" : "passive",
                },
                bytesRead: 16,
            };
        case CmdOp.PlaceBuilding:
            return {
                cmd: {
                    type: "placeBuilding",
                    buildingType: buildingIdToName(v.getUint8(1) as BuildingId),
                    pos: { x: v.getInt16(2), z: v.getInt16(4) },
                },
                bytesRead: 6,
            };
        case CmdOp.CreateKnight:
            return { cmd: { type: "createKnight" }, bytesRead: 1 };
        case CmdOp.CreateBuilder:
            return { cmd: { type: "createBuilder" }, bytesRead: 1 };
        default:
            return null;
    }
}

function encodeCommands(cmds: Command[]): Uint8Array {
    const encoded = cmds.map(encodeCommand);
    const totalLen = encoded.reduce((sum, e) => sum + e.length, 0);
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const e of encoded) {
        result.set(e, offset);
        offset += e.length;
    }
    return result;
}

function decodeCommands(data: Uint8Array, offset: number, count: number): { cmds: Command[]; bytesRead: number } {
    const cmds: Command[] = [];
    let totalRead = 0;
    for (let i = 0; i < count; i++) {
        const result = decodeCommand(data, offset + totalRead);
        if (!result) break;
        cmds.push(result.cmd);
        totalRead += result.bytesRead;
    }
    return { cmds, bytesRead: totalRead };
}

// ============================================================
// Network message serialization
// ============================================================

// --- Client → Server ---

export function encodeCreate(): Uint8Array {
    return new Uint8Array([NetOp.Create]);
}

export function encodeJoin(code: string): Uint8Array {
    const buf = new ArrayBuffer(1 + CODE_LEN);
    const v = new DataView(buf);
    v.setUint8(0, NetOp.Join);
    writeCode(v, 1, code);
    return new Uint8Array(buf);
}

export function encodeReconnect(code: string, playerId: number): Uint8Array {
    const buf = new ArrayBuffer(1 + CODE_LEN + 1);
    const v = new DataView(buf);
    v.setUint8(0, NetOp.Reconnect);
    writeCode(v, 1, code);
    v.setUint8(1 + CODE_LEN, playerId);
    return new Uint8Array(buf);
}

export function encodeCommandsMsg(turn: number, cmds: Command[]): Uint8Array {
    const cmdBytes = encodeCommands(cmds);
    // [opcode:1, turn:u32, numCmds:u16, ...cmdBytes]
    const buf = new ArrayBuffer(1 + 4 + 2 + cmdBytes.length);
    const v = new DataView(buf);
    v.setUint8(0, NetOp.Commands);
    v.setUint32(1, turn);
    v.setUint16(5, cmds.length);
    new Uint8Array(buf).set(cmdBytes, 7);
    return new Uint8Array(buf);
}

export function encodeAck(elapsedTime: number): Uint8Array {
    const buf = new ArrayBuffer(9);
    const v = new DataView(buf);
    v.setUint8(0, NetOp.Ack);
    v.setFloat64(1, elapsedTime);
    return new Uint8Array(buf);
}

export function encodeLoaded(): Uint8Array {
    return new Uint8Array([NetOp.Loaded]);
}

// --- Server → Client ---

export function encodeCreated(code: string, playerId: number, seed: number): Uint8Array {
    const buf = new ArrayBuffer(1 + CODE_LEN + 1 + 4);
    const v = new DataView(buf);
    v.setUint8(0, NetOp.Created);
    writeCode(v, 1, code);
    v.setUint8(1 + CODE_LEN, playerId);
    v.setUint32(1 + CODE_LEN + 1, seed);
    return new Uint8Array(buf);
}

export function encodeJoined(code: string, playerId: number, seed: number): Uint8Array {
    const buf = new ArrayBuffer(1 + CODE_LEN + 1 + 4);
    const v = new DataView(buf);
    v.setUint8(0, NetOp.Joined);
    writeCode(v, 1, code);
    v.setUint8(1 + CODE_LEN, playerId);
    v.setUint32(1 + CODE_LEN + 1, seed);
    return new Uint8Array(buf);
}

export function encodeReconnected(code: string, playerId: number, seed: number, turn: number, started: boolean): Uint8Array {
    const buf = new ArrayBuffer(1 + CODE_LEN + 1 + 4 + 4 + 1);
    const v = new DataView(buf);
    v.setUint8(0, NetOp.Reconnected);
    writeCode(v, 1, code);
    v.setUint8(1 + CODE_LEN, playerId);
    v.setUint32(1 + CODE_LEN + 1, seed);
    v.setUint32(1 + CODE_LEN + 5, turn);
    v.setUint8(1 + CODE_LEN + 9, started ? 1 : 0);
    return new Uint8Array(buf);
}

export function encodeStart(turn: number): Uint8Array {
    const buf = new ArrayBuffer(5);
    const v = new DataView(buf);
    v.setUint8(0, NetOp.Start);
    v.setUint32(1, turn);
    return new Uint8Array(buf);
}

export function encodeTurn(turn: number, p1Cmds: Command[], p2Cmds: Command[]): Uint8Array {
    const p1Bytes = encodeCommands(p1Cmds);
    const p2Bytes = encodeCommands(p2Cmds);
    // [opcode:1, turn:u32, p1Count:u16, ...p1Bytes, p2Count:u16, ...p2Bytes]
    const buf = new ArrayBuffer(1 + 4 + 2 + p1Bytes.length + 2 + p2Bytes.length);
    const v = new DataView(buf);
    const arr = new Uint8Array(buf);
    let off = 0;
    v.setUint8(off, NetOp.Turn); off += 1;
    v.setUint32(off, turn); off += 4;
    v.setUint16(off, p1Cmds.length); off += 2;
    arr.set(p1Bytes, off); off += p1Bytes.length;
    v.setUint16(off, p2Cmds.length); off += 2;
    arr.set(p2Bytes, off);
    return new Uint8Array(buf);
}

export function encodeError(message: string): Uint8Array {
    const msgBytes = new TextEncoder().encode(message);
    const buf = new ArrayBuffer(1 + 2 + msgBytes.length);
    const v = new DataView(buf);
    v.setUint8(0, NetOp.Error);
    v.setUint16(1, msgBytes.length);
    new Uint8Array(buf).set(msgBytes, 3);
    return new Uint8Array(buf);
}

export function encodePlayerDisconnected(playerId: number): Uint8Array {
    return new Uint8Array([NetOp.PlayerDisconnected, playerId]);
}

// ============================================================
// Unified decoder — returns a typed message object
// ============================================================

export type NetMessage =
    | { op: NetOp.Create }
    | { op: NetOp.Join; code: string }
    | { op: NetOp.Reconnect; code: string; playerId: number }
    | { op: NetOp.Commands; turn: number; commands: Command[] }
    | { op: NetOp.Ack; elapsedTime: number }
    | { op: NetOp.Loaded }
    | { op: NetOp.Created; code: string; playerId: number; seed: number }
    | { op: NetOp.Joined; code: string; playerId: number; seed: number }
    | { op: NetOp.Reconnected; code: string; playerId: number; seed: number; turn: number; started: boolean }
    | { op: NetOp.Start; turn: number }
    | { op: NetOp.Turn; turn: number; p1Commands: Command[]; p2Commands: Command[] }
    | { op: NetOp.Error; message: string }
    | { op: NetOp.PlayerDisconnected; playerId: number };

export function decodeMessage(data: Uint8Array): NetMessage | null {
    if (data.length === 0) return null;
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const op = v.getUint8(0);

    switch (op) {
        case NetOp.Create:
            return { op: NetOp.Create };

        case NetOp.Join:
            return { op: NetOp.Join, code: readCode(v, 1) };

        case NetOp.Reconnect:
            return { op: NetOp.Reconnect, code: readCode(v, 1), playerId: v.getUint8(1 + CODE_LEN) };

        case NetOp.Commands: {
            const turn = v.getUint32(1);
            const count = v.getUint16(5);
            const { cmds } = decodeCommands(data, 7, count);
            return { op: NetOp.Commands, turn, commands: cmds };
        }

        case NetOp.Ack:
            return { op: NetOp.Ack, elapsedTime: v.getFloat64(1) };

        case NetOp.Loaded:
            return { op: NetOp.Loaded };

        case NetOp.Created:
            return { op: NetOp.Created, code: readCode(v, 1), playerId: v.getUint8(1 + CODE_LEN), seed: v.getUint32(1 + CODE_LEN + 1) };

        case NetOp.Joined:
            return { op: NetOp.Joined, code: readCode(v, 1), playerId: v.getUint8(1 + CODE_LEN), seed: v.getUint32(1 + CODE_LEN + 1) };

        case NetOp.Reconnected:
            return {
                op: NetOp.Reconnected,
                code: readCode(v, 1),
                playerId: v.getUint8(1 + CODE_LEN),
                seed: v.getUint32(1 + CODE_LEN + 1),
                turn: v.getUint32(1 + CODE_LEN + 5),
                started: v.getUint8(1 + CODE_LEN + 9) === 1,
            };

        case NetOp.Start:
            return { op: NetOp.Start, turn: v.getUint32(1) };

        case NetOp.Turn: {
            let off = 1;
            const turn = v.getUint32(off); off += 4;
            const p1Count = v.getUint16(off); off += 2;
            const p1 = decodeCommands(data, off, p1Count); off += p1.bytesRead;
            const p2Count = v.getUint16(off); off += 2;
            const p2 = decodeCommands(data, off, p2Count);
            return { op: NetOp.Turn, turn, p1Commands: p1.cmds, p2Commands: p2.cmds };
        }

        case NetOp.Error: {
            const len = v.getUint16(1);
            const message = new TextDecoder().decode(data.slice(3, 3 + len));
            return { op: NetOp.Error, message };
        }

        case NetOp.PlayerDisconnected:
            return { op: NetOp.PlayerDisconnected, playerId: v.getUint8(1) };

        default:
            return null;
    }
}
