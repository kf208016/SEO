// Node.js on Windows resolves an explicit directory argument through its
// entrypoint. Import every implementation test so `node --test tests_impl/`
// runs the same suite as the portable glob form.
import './backend.test.mjs';
import './backend_contract.test.mjs';
import './checks_ui.test.mjs';
import './integration.test.mjs';
import './parse_crawl.test.mjs';
