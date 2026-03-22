import { WebSocket, WebSocketServer } from 'ws';

function sendJson(socket, payload) {

    const message = JSON.stringify(payload);

    if (socket.readyState !== WebSocket.OPEN) {
        console.error("WebSocket is not open");
        return;
    }
    socket.send(message);
}

function broadcast(wss, payload) {

    const message = JSON.stringify(payload);

    for (const client of wss.clients) {
        if (client.readyState !== WebSocket.OPEN) {
            continue;
        }
        client.send(message);
    }
}

export function attachWebSocketServer(server) {
    const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 * 1024 });

    wss.on('connection', (socket) => {
        socket.isAlive = true;
        socket.on('pong', () => { socket.isAlive = true; });

        sendJson(socket, { type: 'Welcome' });

        socket.on('error', console.error);
    });

    const interval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (!ws.isAlive) return ws.terminate();
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);

    wss.on('close', () => clearInterval(interval));

    function broadcastMatchCreated(match) {
        broadcast(wss, { type: 'match_created', data: match });
    }

    return { broadcastMatchCreated };
}