import {
    NetOp, decodeMessage, encodeCreate, encodeJoin,
} from "../../../shared/protocol";
import { listMaps } from "../editor/storage";

const RELAY_URL = import.meta.env.VITE_RELAY_URL;

const createBtn = document.getElementById("create-game") as HTMLButtonElement;
const joinBtn = document.getElementById("join-game") as HTMLButtonElement;
const offlineBtn = document.getElementById("play-offline") as HTMLButtonElement;
const editorBtn = document.getElementById("open-editor") as HTMLButtonElement;
const offlineMapSelect = document.getElementById("offline-map") as HTMLSelectElement;
const joinCodeInput = document.getElementById("join-code") as HTMLInputElement;
const codeDisplay = document.getElementById("game-code-display")!;
const statusMessage = document.getElementById("status-message")!;

// Offline map picker: "Random" plus any user-built maps in local storage.
function populateOfflineMaps(): void {
    offlineMapSelect.innerHTML = "";
    const randomOpt = document.createElement("option");
    randomOpt.value = "";
    randomOpt.textContent = "Random map";
    offlineMapSelect.appendChild(randomOpt);
    for (const name of listMaps()) {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        offlineMapSelect.appendChild(opt);
    }
}
populateOfflineMaps();

offlineBtn.addEventListener("click", () => {
    const mapName = offlineMapSelect.value;
    window.location.href = mapName ? `/play/?map=${encodeURIComponent(mapName)}` : "/play/";
});

editorBtn.addEventListener("click", () => {
    window.location.href = "/editor/";
});

createBtn.addEventListener("click", () => {
    createBtn.disabled = true;
    statusMessage.textContent = "Connecting...";

    const ws = new WebSocket(RELAY_URL);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
        ws.send(encodeCreate());
    };

    ws.onmessage = (event) => {
        const msg = decodeMessage(new Uint8Array(event.data as ArrayBuffer));
        if (!msg) return;

        if (msg.op === NetOp.Created) {
            codeDisplay.textContent = msg.code;
            codeDisplay.style.display = "block";
            statusMessage.textContent = "Waiting for opponent to join...";
        }

        if (msg.op === NetOp.Start) {
            ws.close();
            const params = new URLSearchParams();
            params.set("mode", "multiplayer");
            params.set("code", codeDisplay.textContent!);
            params.set("player", "1");
            window.location.href = `/play/?${params.toString()}`;
        }
    };

    ws.onerror = () => {
        statusMessage.textContent = "Failed to connect to server.";
        createBtn.disabled = false;
    };

    ws.onclose = () => {
        if (!statusMessage.textContent?.includes("Waiting")) {
            statusMessage.textContent = "Connection lost.";
            createBtn.disabled = false;
        }
    };
});

joinBtn.addEventListener("click", () => {
    const code = joinCodeInput.value.trim().toUpperCase();
    if (!code) {
        statusMessage.textContent = "Enter a game code.";
        return;
    }

    joinBtn.disabled = true;
    statusMessage.textContent = "Joining...";

    const ws = new WebSocket(RELAY_URL);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
        ws.send(encodeJoin(code));
    };

    ws.onmessage = (event) => {
        const msg = decodeMessage(new Uint8Array(event.data as ArrayBuffer));
        if (!msg) return;

        if (msg.op === NetOp.Joined) {
            statusMessage.textContent = "Joined! Starting game...";
        }

        if (msg.op === NetOp.Start) {
            ws.close();
            const params = new URLSearchParams();
            params.set("mode", "multiplayer");
            params.set("code", code);
            params.set("player", "2");
            window.location.href = `/play/?${params.toString()}`;
        }

        if (msg.op === NetOp.Error) {
            statusMessage.textContent = msg.message;
            joinBtn.disabled = false;
        }
    };

    ws.onerror = () => {
        statusMessage.textContent = "Failed to connect to server.";
        joinBtn.disabled = false;
    };
});
