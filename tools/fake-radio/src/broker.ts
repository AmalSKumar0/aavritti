import * as net from 'net';
import Aedes from 'aedes';

const port = parseInt(process.env.PORT || '1883', 10);
const aedes = new Aedes();
const server = net.createServer(aedes.handle);

server.listen(port, () => {
  console.log(`[BROKER] In-memory MQTT broker running on port ${port}`);
});

aedes.on('client', (client) => {
  console.log(`[BROKER] Client connected: ${client ? client.id : 'unknown'}`);
});

aedes.on('clientDisconnect', (client) => {
  console.log(`[BROKER] Client disconnected: ${client ? client.id : 'unknown'}`);
});

aedes.on('publish', (packet, client) => {
  if (client) {
    // console.log(`[BROKER] Published to ${packet.topic} by ${client.id}`);
  }
});
