'use strict';

let store;

async function initStore() {
  if (process.env.DATABASE_URL) {
    store = require('./postgres');
    await store.init();
    return { driver: 'postgresql', store };
  }
  store = require('./sqlite');
  store.init();
  return { driver: 'sqlite', store };
}

function getStore() {
  if (!store) throw new Error('Database not initialized — call initStore() first');
  return store;
}

module.exports = { initStore, getStore };
