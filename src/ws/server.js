import { WebSocket, WebSocketServer } from 'ws';

function sendJson(socket, payload) {
    if (socket.readyState !== WebSocket.OPEN) {
        console.error("WebSocket is not open");
        return;
    }
    socket.send(JSON.stringify(payload));
}

function broadcast(wss, payload) {
    for (const client of wss.clients) {
        if (client.readyState !== WebSocket.OPEN) {
            console.error("WebSocket is not open for client", client);
            return;
        }
        client.send(JSON.stringify(payload));
    }
}

export function attachWebSocketServer(server) {
    const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 * 1024 });

    wss.on('connection', (socket) => {
        sendJson(socket, { type: 'Welcome' });

        socket.on('error', console.error);
    });

    function broadcastMatchCreated(match) {
        broadcast(wss, { type: 'match_created', data: match });
    }

    return { broadcastMatchCreated };
}