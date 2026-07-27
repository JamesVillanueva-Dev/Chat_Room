'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');

const config = require('../../config');
const logger = require('../../logger').child({ component: 'rps' });

const execFileAsync = promisify(execFile);

const BOT_LABEL = 'RPS Bot';
const WIN = 'You win!';
const LOSE = 'You lose!';

// Scores are keyed by user rather than socket, so a refresh does not wipe them.
const scores = new Map();

const scoreFor = (userId) => {
  if (!scores.has(userId)) scores.set(userId, { player: 0, bot: 0, rounds: 0 });
  return scores.get(userId);
};

const resetScore = (userId) => {
  scores.delete(userId);
};

class RpsError extends Error {}

/** Runs one round through the existing Python implementation. */
const playRound = async (choice) => {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      config.rps.pythonBin,
      [config.rps.scriptPath, '--play', choice],
      { timeout: config.rps.timeoutMs, windowsHide: true }
    ));
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.warn('python not found', { bin: config.rps.pythonBin });
      throw new RpsError(
        'I cannot reach my Python brain right now. Set the PYTHON environment variable to your interpreter.'
      );
    }
    if (error.killed) {
      throw new RpsError('That round took too long. Try again.');
    }
    // A non-zero exit is how RPS.py reports an unusable choice.
    throw new RpsError('I did not catch that move. Try rock, paper or scissors.');
  }

  try {
    return JSON.parse(stdout);
  } catch {
    throw new RpsError('I got a confusing answer from the dice. Try again.');
  }
};

const play = async ({ userId, username, choice }) => {
  const round = await playRound(choice);
  const score = scoreFor(userId);
  score.rounds += 1;
  if (round.result === WIN) score.player += 1;
  else if (round.result === LOSE) score.bot += 1;

  const text =
    `${username} played ${round.playerChoiceName}, I played ${round.cpuChoiceName}. ${round.result}\n` +
    `Score after ${score.rounds} round(s) — ${username}: ${score.player}, ${BOT_LABEL}: ${score.bot}`;

  return { text, round, score };
};

module.exports = { BOT_LABEL, RpsError, play, playRound, scoreFor, resetScore, scores };
