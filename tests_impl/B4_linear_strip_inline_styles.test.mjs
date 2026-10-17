import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';

import { stripInlineStyles } from '../public/core/parse.js';

const PARSE_URL = new URL('../public/core/parse.js', import.meta.url).href;
const MAX_DURATION_MS = 1000;
const HARD_LIMIT_MS = 3000;

function runIsolated(buildExpression, checkExpression) {
  const code = `
    const { parentPort, workerData } = require('node:worker_threads');
    import(workerData.parseUrl).then(({ stripInlineStyles }) => {
      const input = ${buildExpression};
      const started = performance.now();
      const output = stripInlineStyles(input);
      const durationMs = performance.now() - started;
      parentPort.postMessage({
        durationMs,
        matches: ${checkExpression},
        inputLength: input.length,
        outputLength: output.length,
      });
    }, (error) => parentPort.postMessage({ error: String(error?.stack || error) }));
  `;

  return new Promise((resolve) => {
    const worker = new Worker(code, {
      eval: true,
      workerData: { parseUrl: PARSE_URL },
    });
    const timeout = setTimeout(() => {
      void worker.terminate();
      resolve({ timedOut: true });
    }, HARD_LIMIT_MS);

    worker.once('message', (message) => {
      clearTimeout(timeout);
      void worker.terminate();
      resolve(message);
    });
    worker.once('error', (error) => {
      clearTimeout(timeout);
      resolve({ error: String(error?.stack || error) });
    });
  });
}

async function assertFastResult(buildExpression, checkExpression, label) {
  const result = await runIsolated(buildExpression, checkExpression);

  assert.ok(!result.timedOut, `${label} exceeded the ${HARD_LIMIT_MS} ms watchdog`);
  assert.ok(!result.error, result.error);
  assert.equal(
    result.matches,
    true,
    `${label} returned an unexpected result (input ${result.inputLength}, output ${result.outputLength})`,
  );
  assert.ok(
    result.durationMs < MAX_DURATION_MS,
    `${label} took ${result.durationMs.toFixed(1)} ms (limit ${MAX_DURATION_MS} ms)`,
  );
}

test('B4 repeated unterminated style start tags finish in under 1 second', async () => {
  await assertFastResult(
    `'<style'.repeat(340000)`,
    'output === input',
    'repeated unterminated style start tags',
  );
});

test('B4 repeated incomplete style end tags finish in under 1 second', async () => {
  await assertFastResult(
    `'<style>' + '</style'.repeat(280000)`,
    "output === ''",
    'repeated incomplete style end tags',
  );
});

test('B4 repeated quoted start-tag fragments finish in under 1 second', async () => {
  await assertFastResult(
    `"<a '".repeat(500000)`,
    'output === input',
    'repeated quoted start-tag fragments',
  );
});

test('B4 two million less-than signs finish in under 1 second', async () => {
  await assertFastResult(
    `'<'.repeat(2000000)`,
    'output === input',
    'two million less-than signs',
  );
});

test('B4 repeated unterminated style attributes finish in under 1 second', async () => {
  await assertFastResult(
    `'<p style="'.repeat(200000)`,
    'output === input',
    'repeated unterminated style attributes',
  );
});

test('B4 an unterminated raw-text end-tag candidate stops later rescans', async () => {
  await assertFastResult(
    `'<style>' + '</style '.repeat(250000)`,
    "output === ''",
    'unterminated raw-text end-tag candidate',
  );
});

test('B4 an unterminated quoted tag preserves the remaining source after prior stripping', () => {
  const input = '<div style=x>ok</div><a title="broken <style>.bad{}</style><p style=x>tail</p>';
  const expected = '<div>ok</div><a title="broken <style>.bad{}</style><p style=x>tail</p>';
  assert.equal(stripInlineStyles(input), expected);
});
