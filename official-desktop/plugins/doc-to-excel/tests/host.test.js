import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import os from 'node:os';
import { apply, inject } from '../lib/index.js';
import { findPython, runProcess } from '../lib/engine.js';

// This fixture models the public Connection exact Fetch registry, including
// method dispatch and the registration effects owned by the calling context.
function mounted(dataDir, llm = {listProviders: () => []}) {
  const routes = new Map(), cleanup = [];
  const ctx = {
    get: key => key === 'ipzskDesktop' && dataDir !== undefined ? {dataDir} : undefined,
    llm,
    effect: factory => { const dispose = factory(); cleanup.push(dispose); return dispose; },
    connection: {fetch: {register: route => {
      assert.ok(route.path.startsWith('/api/'));
      assert.ok(!routes.has(route.path));
      routes.set(route.path, route);
      return ctx.effect(() => async () => { routes.delete(route.path); });
    }}},
  };
  apply(ctx);
  return {
    routes,
    async fetch(suffix, options) {
      const request = new Request('dsh-app://app/api/doc-to-excel' + suffix, options);
      const route = routes.get(new URL(request.url).pathname);
      return route?.methods.includes(request.method) ? route.fetch(request) : new Response('not found', {status: 404});
    },
    async dispose() { for (const dispose of cleanup.reverse()) await dispose(); },
  };
}
const json = value => ({method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(value)});
const temp = () => mkdtemp(path.join(os.tmpdir(), 'dte-host-'));
const init = async (host, size) => {
  const response = await host.fetch('/large/init', json({name: 'sample.pdf', size, model: {provider: 'mock', id: 'mock'}}));
  assert.equal(response.status, 200);
  return (await response.json()).id;
};

test('requires explicit desktop data directory and registers carrier-neutral routes with owned lifetimes', async () => {
  assert.deepEqual(inject, ['connection', 'llm', 'ipzskDesktop']);
  for (const dataDir of [undefined, '', 'relative/path']) assert.throws(() => mounted(dataDir), /ipzskDesktop.dataDir/);
  const host = mounted(await temp());
  assert.equal(host.routes.size, 13);
  assert.equal(host.routes.get('/api/doc-to-excel/large/upload').requestBody, 'streaming');
  assert.equal(host.routes.get('/api/doc-to-excel/create').requestBody, 'buffered');
  assert.deepEqual(await (await host.fetch('/large/list')).json(), []);
  assert.equal((await host.fetch('/large/list', {method: 'POST'})).status, 404);
  assert.equal((await host.fetch('/update/install', json({version: '0.2.2'}))).status, 404);
  await host.dispose();
  assert.equal((await host.fetch('/large/list')).status, 404);
});

test('config keeps usable model providers when another provider fails', async t => {
  const host = mounted(await temp(), {
    listProviders: () => [{id: 'ok', name: 'Ready'}, {id: 'bad', name: 'Unavailable'}],
    listModels: async id => { if (id === 'bad') throw Error('unavailable'); return [{id: 'sample', name: 'Sample'}]; },
  });
  t.after(() => host.dispose());
  const response = await host.fetch('/config');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const config = await response.json();
  assert.equal(config.runtime, true, config.runtimeError);
  assert.deepEqual(config.models, [{provider: 'ok', id: 'sample', name: 'Ready / Sample'}]);
  assert.deepEqual(config.modelWarnings, ['Unavailable']);
});

test('Fetch upload streams exact 4 MiB chunks and rejects bad offsets and oversized chunks without progress', async t => {
  const dataDir = await temp(), host = mounted(dataDir);
  t.after(() => host.dispose());
  const block = Buffer.alloc(4 * 1024 ** 2, 37), tail = Buffer.from('tail!');
  const id = await init(host, block.length + tail.length);
  let position = 0;
  const response = await host.fetch('/large/upload?id=' + id + '&offset=0', {
    method: 'POST', duplex: 'half', body: new ReadableStream({pull(controller) {
      if (position === block.length) return controller.close();
      controller.enqueue(block.subarray(position, position += 64 * 1024));
    }}),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {uploaded: block.length});
  const badOffset = await host.fetch('/large/upload?id=' + id + '&offset=0', {method: 'POST', body: tail});
  assert.equal(badOffset.status, 400);
  const oversize = await host.fetch('/large/upload?id=' + id + '&offset=' + block.length, {method: 'POST', body: Buffer.alloc(6)});
  assert.equal(oversize.status, 400);
  const finish = await host.fetch('/large/upload?id=' + id + '&offset=' + block.length, {method: 'POST', body: tail});
  assert.equal(finish.status, 200);
  assert.deepEqual(await readFile(path.join(dataDir, 'doc-to-excel-jobs/large', id, 'source.pdf')), Buffer.concat([block, tail]));
  assert.equal((await host.fetch('/large/upload?id=../../outside&offset=0', {method: 'POST', body: tail})).status, 400);
});

test('interrupted and oversized requests retain no uploaded progress and bounded JSON consumption', async t => {
  const dataDir = await temp(), host = mounted(dataDir);
  t.after(() => host.dispose());
  const id = await init(host, 8 * 1024 ** 2);
  let read = false;
  const interrupted = await host.fetch('/large/upload?id=' + id + '&offset=0', {
    method: 'POST', duplex: 'half', body: new ReadableStream({pull(controller) {
      if (read) controller.error(Error('connection closed'));
      else { read = true; controller.enqueue(new Uint8Array([1, 2, 3])); }
    }}),
  });
  assert.equal(interrupted.status, 400);
  const controller = new AbortController();
  const aborted = await host.fetch('/large/upload?id=' + id + '&offset=0', {
    method: 'POST', duplex: 'half', signal: controller.signal,
    body: new ReadableStream({pull(stream) {
      stream.enqueue(new Uint8Array([1, 2, 3]));
      controller.abort();
      stream.close();
    }}),
  });
  assert.equal(aborted.status, 400);
  const oversized = await host.fetch('/large/upload?id=' + id + '&offset=0', {method: 'POST', body: Buffer.alloc(4 * 1024 ** 2 + 1)});
  assert.equal(oversized.status, 400);
  assert.equal((await readFile(path.join(dataDir, 'doc-to-excel-jobs/large', id, 'source.pdf'))).length, 0);
  assert.equal((await (await host.fetch('/large/status?id=' + id)).json()).uploaded, 0);
  let chunks = 0, cancelled = false;
  const tooMuchJson = await host.fetch('/create', {
    method: 'POST', duplex: 'half', body: new ReadableStream({
      pull(controller) { chunks++; controller.enqueue(new Uint8Array(1024 ** 2)); },
      cancel() { cancelled = true; },
    }),
  });
  assert.equal(tooMuchJson.status, 400);
  assert.match((await tooMuchJson.json()).error, /20 MB/);
  assert.ok(chunks <= 31);
  assert.equal(cancelled, true);
  assert.equal((await host.fetch('/create', {method: 'POST', body: '{bad json'})).status, 400);
});

test('persisted large-task downloads return streams with matching HEAD and close on cancellation', async t => {
  const dataDir = await temp(), first = mounted(dataDir);
  const id = await init(first, 10);
  await first.dispose();
  const directory = path.join(dataDir, 'doc-to-excel-jobs/large', id);
  const jobPath = path.join(directory, 'job.json');
  const job = JSON.parse(await readFile(jobPath, 'utf8'));
  const bytes = Buffer.alloc(2 * 1024 ** 2, 123);
  await writeFile(path.join(directory, 'result.xlsx'), bytes);
  await writeFile(jobPath, JSON.stringify({...job, download: true}));
  const host = mounted(dataDir);
  t.after(() => host.dispose());
  const response = await host.fetch('/large/download?id=' + id);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /spreadsheetml/);
  assert.match(response.headers.get('content-disposition'), /pdf-records.xlsx/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  const head = await host.fetch('/large/download?id=' + id, {method: 'HEAD'});
  assert.equal(head.headers.get('content-length'), String(bytes.length));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const cancel = await host.fetch('/large/download?id=' + id);
  const reader = cancel.body.getReader();
  await reader.read();
  await reader.cancel();
});

test('small Word task runs locally through dsh-app Fetch and downloads an actual Excel workbook', async t => {
  const dataDir = await temp(), host = mounted(dataDir);
  t.after(() => host.dispose());
  const python = await findPython(), document = path.join(dataDir, 'sample.docx');
  await runProcess(python, ['-c', 'from docx import Document;import sys;d=Document();d.add_paragraph("客户需求：离线使用");d.save(sys.argv[1])', document]);
  const create = await host.fetch('/create', json({files: [{name: 'sample.docx', data: (await readFile(document)).toString('base64')}]}));
  assert.equal(create.status, 200);
  const {id} = await create.json();
  let status;
  const deadline = Date.now() + 20000;
  do {
    status = await (await host.fetch('/status?id=' + id)).json();
    if (!status.running) break;
    await delay(25);
  } while (Date.now() < deadline);
  assert.equal(status.download, true, JSON.stringify(status));
  assert.equal(status.calls, 0);
  const response = await host.fetch('/download?id=' + id);
  assert.equal(response.status, 200);
  const output = path.join(dataDir, 'downloaded.xlsx');
  await writeFile(output, Buffer.from(await response.arrayBuffer()));
  const check = await runProcess(python, ['-c', 'import openpyxl,sys;w=openpyxl.load_workbook(sys.argv[1]);print(w["分类明细"].max_row)', output]);
  assert.equal(check.trim(), '2');
  assert.equal((await host.fetch('/download?id=missing')).status, 400);
});
