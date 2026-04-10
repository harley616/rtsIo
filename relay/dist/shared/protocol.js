// ============================================================
// Shared binary protocol for client <-> relay communication.
// Both clientV2 and relay import this file directly.
// ============================================================
const BUILDING_NAMES = ["house", "townhall", "barracks"];
export function buildingIdToName(id) {
    return BUILDING_NAMES[id];
}
export function buildingNameToId(name) {
    const idx = BUILDING_NAMES.indexOf(name);
    return idx >= 0 ? idx : 0 /* BuildingId.House */;
}
// --- Game code encoding (6 ASCII chars → 6 bytes) ---
const CODE_LEN = 6;
function writeCode(view, offset, code) {
    for (let i = 0; i < CODE_LEN; i++) {
        view.setUint8(offset + i, code.charCodeAt(i));
    }
}
function readCode(view, offset) {
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
export function encodeCommand(cmd) {
    switch (cmd.type) {
        case "moveUnit": {
            const buf = new ArrayBuffer(16);
            const v = new DataView(buf);
            v.setUint8(0, 1 /* CmdOp.MoveUnit */);
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
            v.setUint8(0, 2 /* CmdOp.PlaceBuilding */);
            v.setUint8(1, buildingNameToId(cmd.buildingType));
            v.setInt16(2, cmd.pos.x);
            v.setInt16(4, cmd.pos.z);
            return new Uint8Array(buf);
        }
        case "createKnight":
            return new Uint8Array([3 /* CmdOp.CreateKnight */]);
        case "createBuilder":
            return new Uint8Array([4 /* CmdOp.CreateBuilder */]);
    }
}
export function decodeCommand(data, offset) {
    if (offset >= data.length)
        return null;
    const v = new DataView(data.buffer, data.byteOffset + offset);
    const op = v.getUint8(0);
    switch (op) {
        case 1 /* CmdOp.MoveUnit */:
            return {
                cmd: {
                    type: "moveUnit",
                    entityId: v.getUint16(1),
                    pos: { x: v.getFloat32(3), y: v.getFloat32(7), z: v.getFloat32(11) },
                    moveType: v.getUint8(15) === 1 ? "aggressive" : "passive",
                },
                bytesRead: 16,
            };
        case 2 /* CmdOp.PlaceBuilding */:
            return {
                cmd: {
                    type: "placeBuilding",
                    buildingType: buildingIdToName(v.getUint8(1)),
                    pos: { x: v.getInt16(2), z: v.getInt16(4) },
                },
                bytesRead: 6,
            };
        case 3 /* CmdOp.CreateKnight */:
            return { cmd: { type: "createKnight" }, bytesRead: 1 };
        case 4 /* CmdOp.CreateBuilder */:
            return { cmd: { type: "createBuilder" }, bytesRead: 1 };
        default:
            return null;
    }
}
function encodeCommands(cmds) {
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
function decodeCommands(data, offset, count) {
    const cmds = [];
    let totalRead = 0;
    for (let i = 0; i < count; i++) {
        const result = decodeCommand(data, offset + totalRead);
        if (!result)
            break;
        cmds.push(result.cmd);
        totalRead += result.bytesRead;
    }
    return { cmds, bytesRead: totalRead };
}
// ============================================================
// Network message serialization
// ============================================================
// --- Client → Server ---
export function encodeCreate() {
    return new Uint8Array([1 /* NetOp.Create */]);
}
export function encodeJoin(code) {
    const buf = new ArrayBuffer(1 + CODE_LEN);
    const v = new DataView(buf);
    v.setUint8(0, 2 /* NetOp.Join */);
    writeCode(v, 1, code);
    return new Uint8Array(buf);
}
export function encodeReconnect(code, playerId) {
    const buf = new ArrayBuffer(1 + CODE_LEN + 1);
    const v = new DataView(buf);
    v.setUint8(0, 3 /* NetOp.Reconnect */);
    writeCode(v, 1, code);
    v.setUint8(1 + CODE_LEN, playerId);
    return new Uint8Array(buf);
}
export function encodeCommandsMsg(turn, cmds) {
    const cmdBytes = encodeCommands(cmds);
    // [opcode:1, turn:u32, numCmds:u16, ...cmdBytes]
    const buf = new ArrayBuffer(1 + 4 + 2 + cmdBytes.length);
    const v = new DataView(buf);
    v.setUint8(0, 4 /* NetOp.Commands */);
    v.setUint32(1, turn);
    v.setUint16(5, cmds.length);
    new Uint8Array(buf).set(cmdBytes, 7);
    return new Uint8Array(buf);
}
export function encodeAck(elapsedTime) {
    const buf = new ArrayBuffer(9);
    const v = new DataView(buf);
    v.setUint8(0, 5 /* NetOp.Ack */);
    v.setFloat64(1, elapsedTime);
    return new Uint8Array(buf);
}
export function encodeLoaded() {
    return new Uint8Array([6 /* NetOp.Loaded */]);
}
// --- Server → Client ---
export function encodeCreated(code, playerId, seed) {
    const buf = new ArrayBuffer(1 + CODE_LEN + 1 + 4);
    const v = new DataView(buf);
    v.setUint8(0, 16 /* NetOp.Created */);
    writeCode(v, 1, code);
    v.setUint8(1 + CODE_LEN, playerId);
    v.setUint32(1 + CODE_LEN + 1, seed);
    return new Uint8Array(buf);
}
export function encodeJoined(code, playerId, seed) {
    const buf = new ArrayBuffer(1 + CODE_LEN + 1 + 4);
    const v = new DataView(buf);
    v.setUint8(0, 17 /* NetOp.Joined */);
    writeCode(v, 1, code);
    v.setUint8(1 + CODE_LEN, playerId);
    v.setUint32(1 + CODE_LEN + 1, seed);
    return new Uint8Array(buf);
}
export function encodeReconnected(code, playerId, seed, turn, started) {
    const buf = new ArrayBuffer(1 + CODE_LEN + 1 + 4 + 4 + 1);
    const v = new DataView(buf);
    v.setUint8(0, 18 /* NetOp.Reconnected */);
    writeCode(v, 1, code);
    v.setUint8(1 + CODE_LEN, playerId);
    v.setUint32(1 + CODE_LEN + 1, seed);
    v.setUint32(1 + CODE_LEN + 5, turn);
    v.setUint8(1 + CODE_LEN + 9, started ? 1 : 0);
    return new Uint8Array(buf);
}
export function encodeStart(turn) {
    const buf = new ArrayBuffer(5);
    const v = new DataView(buf);
    v.setUint8(0, 19 /* NetOp.Start */);
    v.setUint32(1, turn);
    return new Uint8Array(buf);
}
export function encodeTurn(turn, p1Cmds, p2Cmds) {
    const p1Bytes = encodeCommands(p1Cmds);
    const p2Bytes = encodeCommands(p2Cmds);
    // [opcode:1, turn:u32, p1Count:u16, ...p1Bytes, p2Count:u16, ...p2Bytes]
    const buf = new ArrayBuffer(1 + 4 + 2 + p1Bytes.length + 2 + p2Bytes.length);
    const v = new DataView(buf);
    const arr = new Uint8Array(buf);
    let off = 0;
    v.setUint8(off, 20 /* NetOp.Turn */);
    off += 1;
    v.setUint32(off, turn);
    off += 4;
    v.setUint16(off, p1Cmds.length);
    off += 2;
    arr.set(p1Bytes, off);
    off += p1Bytes.length;
    v.setUint16(off, p2Cmds.length);
    off += 2;
    arr.set(p2Bytes, off);
    return new Uint8Array(buf);
}
export function encodeError(message) {
    const msgBytes = new TextEncoder().encode(message);
    const buf = new ArrayBuffer(1 + 2 + msgBytes.length);
    const v = new DataView(buf);
    v.setUint8(0, 21 /* NetOp.Error */);
    v.setUint16(1, msgBytes.length);
    new Uint8Array(buf).set(msgBytes, 3);
    return new Uint8Array(buf);
}
export function encodePlayerDisconnected(playerId) {
    return new Uint8Array([22 /* NetOp.PlayerDisconnected */, playerId]);
}
export function decodeMessage(data) {
    if (data.length === 0)
        return null;
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const op = v.getUint8(0);
    switch (op) {
        case 1 /* NetOp.Create */:
            return { op: 1 /* NetOp.Create */ };
        case 2 /* NetOp.Join */:
            return { op: 2 /* NetOp.Join */, code: readCode(v, 1) };
        case 3 /* NetOp.Reconnect */:
            return { op: 3 /* NetOp.Reconnect */, code: readCode(v, 1), playerId: v.getUint8(1 + CODE_LEN) };
        case 4 /* NetOp.Commands */: {
            const turn = v.getUint32(1);
            const count = v.getUint16(5);
            const { cmds } = decodeCommands(data, 7, count);
            return { op: 4 /* NetOp.Commands */, turn, commands: cmds };
        }
        case 5 /* NetOp.Ack */:
            return { op: 5 /* NetOp.Ack */, elapsedTime: v.getFloat64(1) };
        case 6 /* NetOp.Loaded */:
            return { op: 6 /* NetOp.Loaded */ };
        case 16 /* NetOp.Created */:
            return { op: 16 /* NetOp.Created */, code: readCode(v, 1), playerId: v.getUint8(1 + CODE_LEN), seed: v.getUint32(1 + CODE_LEN + 1) };
        case 17 /* NetOp.Joined */:
            return { op: 17 /* NetOp.Joined */, code: readCode(v, 1), playerId: v.getUint8(1 + CODE_LEN), seed: v.getUint32(1 + CODE_LEN + 1) };
        case 18 /* NetOp.Reconnected */:
            return {
                op: 18 /* NetOp.Reconnected */,
                code: readCode(v, 1),
                playerId: v.getUint8(1 + CODE_LEN),
                seed: v.getUint32(1 + CODE_LEN + 1),
                turn: v.getUint32(1 + CODE_LEN + 5),
                started: v.getUint8(1 + CODE_LEN + 9) === 1,
            };
        case 19 /* NetOp.Start */:
            return { op: 19 /* NetOp.Start */, turn: v.getUint32(1) };
        case 20 /* NetOp.Turn */: {
            let off = 1;
            const turn = v.getUint32(off);
            off += 4;
            const p1Count = v.getUint16(off);
            off += 2;
            const p1 = decodeCommands(data, off, p1Count);
            off += p1.bytesRead;
            const p2Count = v.getUint16(off);
            off += 2;
            const p2 = decodeCommands(data, off, p2Count);
            return { op: 20 /* NetOp.Turn */, turn, p1Commands: p1.cmds, p2Commands: p2.cmds };
        }
        case 21 /* NetOp.Error */: {
            const len = v.getUint16(1);
            const message = new TextDecoder().decode(data.slice(3, 3 + len));
            return { op: 21 /* NetOp.Error */, message };
        }
        case 22 /* NetOp.PlayerDisconnected */:
            return { op: 22 /* NetOp.PlayerDisconnected */, playerId: v.getUint8(1) };
        default:
            return null;
    }
}
