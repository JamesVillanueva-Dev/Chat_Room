'use strict';

const bcrypt = require('bcryptjs');

const config = require('../config');

const hash = (plain) => bcrypt.hash(plain, config.chat.bcryptRounds);

const verify = (plain, passwordHash) => {
  if (!passwordHash) return Promise.resolve(false);
  return bcrypt.compare(plain, passwordHash);
};

/**
 * Runs a real hash comparison against a throwaway digest so a login attempt for
 * an unknown username costs the same time as one for a real account.
 */
const DUMMY_HASH = bcrypt.hashSync('placeholder-for-timing-equalization', config.chat.bcryptRounds);
const burnCycles = () => bcrypt.compare('placeholder-for-timing-equalization', DUMMY_HASH);

module.exports = { hash, verify, burnCycles };
