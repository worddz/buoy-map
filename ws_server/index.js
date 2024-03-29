const WebSocket = require('ws');
const BuoyHelpers = require('./buoy_helpers.js');

const buoyManager = new BuoyHelpers();
const server = new WebSocket.Server({
  port: process.env.WS_PORT || 8080,
});

// name: validateId
// description: Validates the given id against the json-rcp 2.0 specification. An id must be either
//              a string or non-fractional number unless there is a valid reason to also accept
//              fractional numbers or null.
//
// params:
//   'id' -- Any; the id from the parsed json-rcp 2.0 request
//
// returns: Bool; true if id is valid, otherwise false
const validateId = (id) => typeof id === 'string' || (typeof id === 'number' && id % 1 === 0);

server.on('connection', (ws) => {
  ws.on('message', (data) => {
    try {
      const request = JSON.parse(data);

      // validate request version and id
      if (request.jsonrpc !== '2.0' || !validateId(request.id)) {
        const response = {
          jsonrpc: '2.0',
          error: {
            code: -32600,
            message: 'Invalid Request',
          },
          id: (validateId(request.id) ? request.id : null),
        };
        ws.send(JSON.stringify(response));
      } else {
        // store id on websocket for termination on close
        if (!ws.id) {
          ws.clientId = request.clientId;
        }
        // attempt to call method then send proper response
        if (buoyManager[request.method]) {
          buoyManager[request.method](request.params, (res) => {
            if (res) {
              if (res.error) {
                const response = {
                  jsonrpc: '2.0',
                  error: res.error,
                  id: request.id,
                };
                ws.send(JSON.stringify(response));
              } else {
                ws.send(`{"jsonrpc":"2.0","result":"ok","id":"${request.id}"}`);
              }
              for (let i = 0; i < res.notifications.length; i += 1) {
                for (let j = 0; j < res.notifications[i].clients.length; j += 1) {
                  res.notifications[i].clients[j].send(res.notifications[i].body);
                }
              }
            } else {
              ws.send(`{"jsonrpc":"2.0","result":"ok","id":"${request.id}"}`);
            }
          }, request.clientId, ws);
        } else {
          const response = {
            jsonrpc: '2.0',
            error: {
              code: -32601,
              message: 'Method not found',
            },
            id: request.id,
          };
          ws.send(JSON.stringify(response));
        }
      }
    }
    catch (error) {
      const response = {
        jsonrpc: '2.0',
        error: {
          code: -30000,
          message: 'Undefined error',
        },
      };
      if (error instanceof InternalError) {
        response.error.code = -32703;
        response.error.message = 'Internal error';
      }
      if (error instanceof SyntaxError) {
        response.error.code = -32700;
        response.error.message = 'Parse error';
        response.error.id = null;
      } else {
        response.error.id = JSON.parse(data).id;
      }
      ws.send(JSON.stringify(response));
    }
  });
  ws.on('close', (code, message) => {
    console.log('WebSocket closed:', ws.clientId, code, message);
    buoyManager.terminateClient(ws.clientId);
  });
});
