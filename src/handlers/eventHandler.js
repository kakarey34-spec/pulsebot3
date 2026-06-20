const fs = require('fs');
const path = require('path');

function loadEvents(client) {
  const eventsPath = path.join(__dirname, '../events');
  const files = fs.readdirSync(eventsPath).filter((f) => f.endsWith('.js'));

  for (const file of files) {
    const event = require(path.join(eventsPath, file));
    const run = (...args) => {
      Promise.resolve(event.execute(...args, client)).catch((err) => {
        console.error(`Event ${event.name} error:`, err);
      });
    };
    if (event.once) {
      client.once(event.name, run);
    } else {
      client.on(event.name, run);
    }
  }
}

module.exports = { loadEvents };
