import './paypal/killcheck.js';
import './scenarios/triggers.js';
import './relay/listen.js';
import './drill.js';
import './scenarios/disputes.js';
import './init/init.js';
import './scenarios/rehearse.js';
import './mcp/server.js';
import './relay/record.js';
import './agent/store.js';
import './ai/commands.js';
import './relay/events.js';
import './migrate/parity.js';
import { loadPlugins } from './plugins.js';

// After the built-ins, so a plugin cannot silently shadow one.
await loadPlugins();
