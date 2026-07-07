const express = require('express');
const { execFile } = require('child_process');
const http = require('http');
const path = require('path');
const { promisify } = require('util');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const execFileAsync = promisify(execFile);
const rpsScript = path.join(__dirname, 'public', 'RPS.py');
const rpsSessions = new Map();

app.use(express.static(path.join(__dirname, 'public')));

const createPayload = (id, username, text) => ({
  id,
  text,
  username,
  time: new Date().toLocaleTimeString(),
});

const getRpsSession = (socketId) => {
  if (!rpsSessions.has(socketId)) {
    rpsSessions.set(socketId, { player: 0, bot: 0, active: false });
  }

  return rpsSessions.get(socketId);
};

const parseCommand = (text) => {
  const match = text.trim().match(/^\/(\w+)(?:\s+(.+))?$/i);
  if (!match) return null;

  return {
    name: match[1].toLowerCase(),
    argument: (match[2] || '').trim().toLowerCase(),
  };
};

const runRpsRound = async (choice) => {
  const pythonCommand = process.env.PYTHON || 'python';
  const { stdout } = await execFileAsync(
    pythonCommand,
    [rpsScript, '--play', choice],
    { timeout: 5000, windowsHide: true }
  );

  return JSON.parse(stdout);
};

const sendRpsBotMessage = (text) => {
  io.emit('chat message', createPayload('rps-bot', 'RPS Bot', text));
};

const handlePlayCommand = async (socket, username, commandText) => {
  if (!commandText) {
    sendRpsBotMessage(`Hey ${username}, play with /play rock, /play paper, or /play scissors.`);
    return;
  }

  const session = getRpsSession(socket.id);
  if (commandText === 'reset') {
    session.player = 0;
    session.bot = 0;
    session.active = true;
    sendRpsBotMessage(`${username}'s RPS score is reset. Play again with /play rock, /play paper, or /play scissors.`);
    return;
  }

  try {
    const round = await runRpsRound(commandText);
    session.active = true;

    if (round.result === 'You win!') {
      session.player += 1;
    } else if (round.result === 'You lose!') {
      session.bot += 1;
    }

    sendRpsBotMessage(
      `${username} chose ${round.playerChoiceName}. I chose ${round.cpuChoiceName}. ${round.result}\n` +
      `Score -> ${username}: ${session.player} RPS Bot: ${session.bot}`
    );
  } catch (error) {
    console.error('RPS bot error:', error);
    sendRpsBotMessage(`I did not catch that move, ${username}. Try /play rock, /play paper, or /play scissors.`);
  }
};

const handleExitCommand = (socket, username) => {
  const session = getRpsSession(socket.id);
  session.player = 0;
  session.bot = 0;
  session.active = false;
  sendRpsBotMessage(`${username} stopped the RPS bot. Type /play rock, /play paper, or /play scissors to start again.`);
};

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('chat message', async (message) => {
    const incomingMessage = message || {};
    const text = String(incomingMessage.text || '').trim();
    if (!text) return;

    const username = String(incomingMessage.username || 'Guest').trim() || 'Guest';
    const command = parseCommand(text);
    if (command?.name === 'play') {
      await handlePlayCommand(socket, username, command.argument);
      return;
    }

    if (command?.name === 'exit') {
      handleExitCommand(socket, username);
      return;
    }

    const payload = createPayload(socket.id, username, text);
    io.emit('chat message', payload);
  });

  socket.on('disconnect', () => {
    rpsSessions.delete(socket.id);
    console.log('A user disconnected:', socket.id);
  });
});

const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => {
  console.log(`Chat server is running on http://localhost:${port}`);
});
