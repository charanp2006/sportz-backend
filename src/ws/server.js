import { WebSocket, WebSocketServer } from 'ws';
import { wsArcjet } from '../arcjet.js';

const matchSubcribers = new Map(); // matchId -> Set of WebSocket

function subscribeToMatch(socket, matchId) {
    if (!matchSubcribers.has(matchId)) {
        matchSubcribers.set(matchId, new Set());
    }
    matchSubcribers.get(matchId).add(socket);
}

function unsubscribeFromMatch(socket, matchId) {
    const subscribers = matchSubcribers.get(matchId);

    if (!subscribers) return;

    subscribers.delete(socket);

    if (subscribers.size === 0) {
        matchSubcribers.delete(matchId);
        return;
    }
}

function cleanupSubscriptions(socket) {
    for (const matchId of socket.subscriptions) {
        unsubscribeFromMatch(socket, matchId);
    }
}

function sendJson(socket, payload) {

    const message = JSON.stringify(payload);

    if (socket.readyState !== WebSocket.OPEN) {
        console.error("WebSocket is not open");
        return;
    }
    socket.send(message);
}

function broadcastToAll(wss, payload) {

    const message = JSON.stringify(payload);

    for (const client of wss.clients) {
        if (client.readyState !== WebSocket.OPEN) {
            continue;
        }
        client.send(message);
    }
}

function broadcastToMatch(matchId, payload) {
    const subscribers = matchSubcribers.get(matchId);
    if (!subscribers || subscribers.size === 0) return;

    const message = JSON.stringify(payload);
    for (const client of subscribers) {
        if (client.readyState !== WebSocket.OPEN) {
            continue;
        }
        client.send(message);
    }    
}

function handlemessage(socket, data) {
    let message;

    try {
        message = JSON.parse(data.toString());
    } catch (error) {
        sendJson(socket, { type: 'error', message: 'Invalid JSON format' });
        return;
    }

    if (message?.type === 'subscribe' && Number.isInteger(message.matchId)) {
        subscribeToMatch(socket, message.matchId);
        socket.subscriptions.add(message.matchId);
        sendJson(socket, { type: 'subscribed', matchId: message.matchId });
        return;
    }

    if (message?.type === 'unsubscribe' && Number.isInteger(message.matchId)) {
        unsubscribeFromMatch(socket, message.matchId);
        socket.subscriptions.delete(message.matchId);
        sendJson(socket, { type: 'unsubscribed', matchId: message.matchId });
        return;
    }
}

export function attachWebSocketServer(server) {
    const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 * 1024 });

    wss.on('connection', async (socket, req) => {
        if (wsArcjet){
            try {
                const decision = await wsArcjet.protect(req);

                if (decision.isDenied()) {
                    const code = decision.reason.isRateLimit() ? 1013 : 1008;
                    const reason = decision.reason.isRateLimit() ? 'Rate Limit Exceeded' : 'Access Denied';

                    socket.close(code, reason);
                    return;
                }
            } catch (error) {
                console.error('WS connection error:', error);
                socket.close(1011, 'Server Security Error');
                return;
            }
        }

        socket.isAlive = true;
        socket.on('pong', () => { socket.isAlive = true; });

        socket.subscriptions = new Set();

        sendJson(socket, { type: 'Welcome' });

        socket.on('message', (data) => handlemessage(socket, data));

        socket.on('error', () => {
            console.error('WebSocket error:', error);
            socket.terminate();
        });

        socket.on('close', () => { cleanupSubscriptions(socket) });

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
        broadcastToAll(wss, { type: 'match_created', data: match });
    }

    function broadcastCommentary(matchId, comment) {
        broadcastToMatch(matchId, { type: 'commentary', data: comment });
    }

    return { broadcastMatchCreated, broadcastCommentary };
}