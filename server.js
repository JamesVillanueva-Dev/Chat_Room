const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('chat message', (message) => {
    const payload = {
      id: socket.id,
      text: message.text,
      username: message.username || 'Guest',
      time: new Date().toLocaleTimeString(),
    };
    io.emit('chat message', payload);
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected:', socket.id);
  });
});

const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => {
  console.log(`Chat server is running on http://localhost:${port}`);
});
