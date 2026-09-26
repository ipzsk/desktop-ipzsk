/** Actual desktop Cordis + Connection + client-bundle smoke; synthetic local data only.
 * Run after the complete overlay build: node official-desktop/tests/plugin-host-smoke.mjs
 * Optional first argument: a different prepared upstream checkout.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, globSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const file = fileURLToPath(import.meta.url);
const project = resolve(dirname(file), '..');
const childMode = process.argv[2] === '--isolated';
const withImagegen = process.argv.includes('--imagegen');
const source = resolve(childMode ? process.argv[3] : process.argv.slice(2).find(arg => arg !== '--imagegen') ?? join(project, '.build/upstream'));

if (!childMode) {
  // A separate process keeps all Harness environment/profile discovery inside
  // a new temporary directory, with no inherited account/model credentials.
  const fixture = await mkdtemp(join(tmpdir(), 'ipzsk-plugin-host-smoke-'));
  try {
    const child = spawn(process.execPath, [file, '--isolated', source, fixture, ...(withImagegen ? ['--imagegen'] : [])], {
      cwd: fixture,
      env: {PATH: process.env.PATH ?? '', DSH_HOME: join(fixture, 'dsh-home'), LANG: 'en_US.UTF-8'},
      stdio: 'inherit',
    });
    const watchdog = setTimeout(() => child.kill('SIGTERM'), 120000);
    try {
      const code = await new Promise((done, fail) => {
        child.once('error', fail);
        child.once('exit', (code, signal) => signal ? fail(Error(`Host smoke ended with ${signal}`)) : done(code));
      });
      assert.equal(code, 0, 'Actual desktop Host smoke failed');
    } finally { clearTimeout(watchdog); }
  } finally { await rm(fixture, {recursive: true, force: true}); }
} else {
  await smoke(process.argv[4]);
}

async function smoke(fixture) {
  let egressAttempts = 0;
  const rejectNetwork = () => { egressAttempts++; throw Error('Host smoke forbids external network'); };
  const nativeFetch = globalThis.fetch;
  const imageCredential = 'ipz_' + 'i'.repeat(43);
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082', 'hex');
  let imageCalls = 0;
  globalThis.fetch = async (url, init) => {
    if (withImagegen && String(url) === 'https://api.ipzsk.com/v1/images/generations') {
      assert.equal(new Headers(init.headers).get('authorization'), 'Bearer ' + imageCredential);
      const body = JSON.parse(init.body);
      assert.equal(body.prompt, 'synthetic smoke image');
      assert.equal(body.model, 'gpt-image-2');
      imageCalls++;
      return Response.json({data: [{b64_json: png.toString('base64')}]});
    }
    if (new URL(String(url)).hostname === '127.0.0.1') return nativeFetch(url, init);
    return rejectNetwork();
  };

  const importBuilt = relative => import(pathToFileURL(join(source, relative)).href);
  const [{runProfile}, {loadProfileDirectory, loadLayeredEnv}, {parseIpzskHostBootstrap, withIpzskEnvironment, ipzskPluginPatches, installIpzskPluginConfig, applyIpzskModelSettings}] = await Promise.all([
    importBuilt('apps/cli/lib/profile-boot.js'),
    importBuilt('packages/boot/app-boot/lib/index.js'),
    importBuilt('apps/desktop-host/lib/types/ipzsk-bootstrap.js'),
  ]);
  const {findPython, runProcess} = await import(pathToFileURL(join(project, 'plugins/doc-to-excel/lib/engine.js')).href);
  const pluginSource = join(project, 'plugins/doc-to-excel');
  const pluginManifest = JSON.parse(await readFile(join(pluginSource, 'package.json'), 'utf8'));
  const runtime = join(fixture, 'runtime'), profile = join(fixture, 'profile');
  await mkdir(join(fixture, 'dsh-home'), {recursive: true});
  await mkdir(profile, {recursive: true});
  await mkdir(runtime, {recursive: true});
  const json = async (filename, value) => { await mkdir(dirname(filename), {recursive: true}); await writeFile(filename, JSON.stringify(value, null, 2) + '\n'); };
  const link = async (target, filename) => { await mkdir(dirname(filename), {recursive: true}); await symlink(target, filename, process.platform === 'win32' ? 'junction' : 'dir'); };
  const packages = new Map();
  for (const relative of globSync(['apps/*/package.json', 'packages/*/*/package.json', 'vendor/*/package.json'], {cwd: source})) {
    const info = JSON.parse(await readFile(join(source, relative), 'utf8'));
    if (info.name?.startsWith('@deepseek-ai/')) packages.set(info.name, {path: dirname(join(source, relative)), version: info.version});
  }
  const sharedPackages = [];
  for (const [name, entry] of packages) {
    const runtimePath = join(runtime, 'node_modules', name);
    // The generated CLI config tree is a packaging concern. Materialize it in
    // this temporary runtime, leaving the prepared upstream checkout untouched.
    if (name === '@deepseek-ai/dsh') {
      await mkdir(runtimePath, {recursive: true});
      await cp(join(entry.path, 'package.json'), join(runtimePath, 'package.json'));
      await link(join(source, 'packages/preset/agent-presets/presets'), join(runtimePath, 'config/agent-presets'));
    } else await link(entry.path, runtimePath);
    await link(runtimePath, join(profile, 'node_modules', name));
    await link(runtimePath, join(fixture, 'node_modules', name));
    sharedPackages.push({name, version: entry.version, path: 'node_modules/' + name});
  }
  await json(join(runtime, 'package.json'), {name: 'ipzsk-smoke-runtime', version: '1.0.0', private: true, type: 'module'});

  const copyPlugin = async (target, sourceDirectory = pluginSource) => {
    for (const relative of ['package.json', 'cordis.patch.yml', 'lib', 'src', 'scripts']) {
      await cp(join(sourceDirectory, relative), join(target, relative), {recursive: true, filter: path => !path.includes('__pycache__')});
    }
  };
  const installedPlugin = join(profile, 'node_modules', pluginManifest.name);
  await copyPlugin(installedPlugin);
  const imageManifest = withImagegen ? JSON.parse(await readFile(join(project, 'plugins/imagegen/package.json'), 'utf8')) : undefined;
  if (imageManifest) await copyPlugin(join(profile, 'node_modules', imageManifest.name), join(project, 'plugins/imagegen'));
  const requirePlugin = createRequire(join(installedPlugin, 'package.json'));
  for (const name of Object.keys(pluginManifest.peerDependencies)) {
    assert.equal(await realpath(requirePlugin.resolve(name + '/package.json')), await realpath(join(runtime, 'node_modules', name, 'package.json')));
  }
  console.log('PASS installed plugin resolves exact official Host peers');

  // Move only our own temporary fixture into a development source link, so
  // runDesktopHost exercises the explicit allowLinkedPackages branch as well.
  const linkedPlugin = join(fixture, 'linked-plugin');
  await cp(installedPlugin, linkedPlugin, {recursive: true});
  await rm(installedPlugin, {recursive: true});
  await link(linkedPlugin, installedPlugin);
  const probe = 'ipzsk-plugin-host-probe';
  const probeDir = join(profile, 'node_modules', probe);
  await json(join(probeDir, 'package.json'), {name: probe, version: '1.0.0', type: 'module', main: 'index.js', dsh: {bundle: {patch: './bundle.yml'}}});
  await writeFile(join(probeDir, 'bundle.yml'), '- insert:\n    - id: ipzsk-plugin-host-probe\n      name: ipzsk-plugin-host-probe\n');
  await writeFile(join(probeDir, 'index.js'), `
import { Context } from '@deepseek-ai/cordis';
export const inject = ['connection', 'llm', 'clientModules', 'ipzskDesktop'];
export function apply(ctx) {
  if (!(ctx instanceof Context)) throw Error('Duplicate Cordis runtime');
  ctx.connection.fetch.register({path:'/api/ipzsk-smoke/health',methods:['GET'],requestBody:'buffered',fetch:async () => Response.json({webServer:ctx.get('webServer')!==undefined,dataDir:ctx.get('ipzskDesktop').dataDir,graph:ctx.clientModules.graph(),providers:ctx.llm.listProviders().map(p=>p.id)})});
}
`);
  await json(join(profile, 'package.json'), {
    name: 'ipzsk-smoke-profile', version: '1.0.0', private: true,
    dependencies: {[pluginManifest.name]: pluginManifest.version, ...(imageManifest ? {[imageManifest.name]: imageManifest.version} : {}), [probe]: '1.0.0'},
    dsh: {profile: {bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', pluginManifest.name, ...(imageManifest ? [imageManifest.name] : []), probe]}},
  });
  const bootstrap = parseIpzskHostBootstrap({version: 1, token: 'ipz_' + 's'.repeat(43), default_model: 'smoke-local-only', models: [{id: 'smoke-local-only', name: 'Smoke fixture; never called', contextWindow: 8192, maxTokens: 1024}], image_models: [], plugin_configs: imageManifest ? [{plugin_id: '00000000-0000-4000-8000-000000000001', credential: imageCredential, package: imageManifest.name, id: 'imagegen', config: { channels: [{id: 'ipzsk', preset: '', name: 'IPZSK', apiUrl: 'https://api.ipzsk.com/v1', models: [{alias: 'smoke-image', id: 'gpt-image-2'}]}], channelSecrets: {}, defaultChannelId: 'ipzsk' }, credential_paths: [['channelSecrets', 'ipzsk']]}] : []});
  const installAnchor = join(runtime, 'node_modules/@deepseek-ai/dsh/package.json');
  const loaded = loadProfileDirectory('dsh', profile, installAnchor);
  const host = await runProfile({ profile: 'desktop', resolvedProfile: { profile: loaded, installAnchor }, patchFiles: [],
    args: ['--no-open', '--port', '0'], environment: withIpzskEnvironment(loadLayeredEnv('dsh'), bootstrap),
    beforeBoot: ctx => {
      ctx.provide('ipzskDesktop', { dataDir: join(profile, 'data') });
      installIpzskPluginConfig(ctx, ipzskPluginPatches(bootstrap, loaded.layers, [...loaded.layers.flatMap(layer => layer.patches), ...loaded.patches]));
    },
  });
  await applyIpzskModelSettings(host.ctx, bootstrap);
  const origin = `http://127.0.0.1:${host.ctx.webServer.port}`;
  const login = await fetch(host.ctx.connection.authenticatedUrl(origin), {redirect: 'manual'});
  assert.equal(login.status, 303);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'Host did not issue a browser session');
  const denied = await fetch(origin + '/api/doc-to-excel/config');
  assert.equal(denied.status, 401);
  const fetchHost = (url, init = {}) => fetch(new URL(url, origin), {...init, headers: {...init.headers, cookie, origin}});
  const post = value => ({method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(value)});
  const api = '/api/doc-to-excel';
  try {
    const health = await (await fetchHost('/api/ipzsk-smoke/health')).json();
    assert.equal(health.webServer, true);
    assert.equal(health.dataDir, join(profile, 'data'));
    assert.ok(health.providers.includes('ipzsk'));
    const entry = health.graph.entries.find(row => row.id === pluginManifest.name);
    assert.ok(entry, 'Plugin missing from real client module graph');
    const index = await fetchHost('/');
    assert.equal(index.status, 200);
    assert.match(await index.text(), /__DSH_BOOT__/);
    const bundle = await fetchHost(entry.url);
    assert.equal(bundle.status, 200);
    let registration;
    vm.runInNewContext(await bundle.text(), {window: {__ModuleLoader__: {load: value => { registration = value; }}}});
    assert.equal(registration.id, pluginManifest.name);
    const client = registration.factory(() => { throw Error('Unexpected client external'); });
    assert.equal(typeof client.apply, 'function');
    console.log('PASS actual Cordis Host has authenticated loopback HTTP, correct data directory, IPZSK model catalog and official client bundle');

    if (imageManifest) {
      const imageEntry = health.graph.entries.find(row => row.id === imageManifest.name);
      assert.ok(imageEntry, 'Image plugin absent from official client graph');
      assert.equal((await fetchHost(imageEntry.url)).status, 200);
      const described = await fetchHost('/api/dsh-imagegen/settings/describe', post({}));
      assert.equal(described.status, 200);
      const settingsText = await described.text();
      assert.ok(!settingsText.includes(imageCredential), 'Client settings response leaked plugin credential');
      const namespaces = JSON.parse(settingsText).value.namespaces;
      assert.equal(namespaces.length, 1, 'Image settings form must remain available');
      const edited = await (await fetchHost('/api/dsh-imagegen/settings/mutate', post({ns: 'imagegen', ops: [{op: 'set', path: ['announceToAgent'], value: false}], expectedRevision: namespaces[0].revision}))).json();
      assert.equal(edited.ok, true, JSON.stringify(edited));
      assert.equal(edited.value.value.announceToAgent, false);
      const savedProfile = await readFile(join(profile, 'cordis.patch.yml'), 'utf8');
      assert.ok(!savedProfile.includes(imageCredential), 'Editable profile leaked account-owned plugin credential');

      const generated = await fetchHost('/api/dsh-imagegen/generate', post({mode: 'text', model: 'smoke-image', prompt: 'synthetic smoke image', size: '1:1', quality: '4k', n: 1, detail: 'standard'}));
      assert.equal(generated.status, 200);
      const value = await generated.json();
      assert.equal(value.ok, true, JSON.stringify(value));
      assert.equal(value.images.length, 1);
      assert.equal(imageCalls, 1);
      const imageUrl = value.history[0].images[0].url;
      assert.match(imageUrl, /[?]file=/);
      const image = await fetchHost(imageUrl);
      assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
      const imageHead = await fetchHost(imageUrl, {method: 'HEAD'});
      assert.equal(Number(imageHead.headers.get('content-length')), png.length);
      assert.ok((await stat(join(profile, 'data/dsh-imagegen/images'))).isDirectory());
      console.log('PASS actual image plugin loads with account-owned configuration, redacts credentials, generates against a mock and serves saved image bytes');
    }

    const config = await (await fetchHost(api + '/config')).json();
    assert.equal(config.runtime, true, config.runtimeError);
    const python = await findPython(), word = join(fixture, 'synthetic.docx'), pdf = join(fixture, 'synthetic.pdf');
    await runProcess(python, ['-c', 'from docx import Document;from pypdf import PdfWriter;import sys;d=Document();d.add_paragraph("客户需求：离线使用");d.save(sys.argv[1]);p=PdfWriter();p.add_blank_page(width=72,height=72);p.add_attachment("synthetic.txt",b"x"*(4*1024*1024));p.write(sys.argv[2])', word, pdf]);
    const created = await fetchHost(api + '/create', post({files: [{name: 'synthetic.docx', data: (await readFile(word)).toString('base64')}]}));
    assert.equal(created.status, 200, await created.clone().text());
    const {id} = await created.json();
    let status;
    const deadline = Date.now() + 20000;
    do { status = await (await fetchHost(api + '/status?id=' + id)).json(); if (!status.running) break; await delay(25); } while (Date.now() < deadline);
    assert.equal(status.download, true, JSON.stringify(status));
    assert.equal(status.calls, 0);
    const excel = await fetchHost(api + '/download?id=' + id);
    assert.equal(excel.status, 200);
    assert.match(excel.headers.get('content-disposition'), /organized.xlsx/);
    const output = join(fixture, 'downloaded.xlsx');
    await writeFile(output, Buffer.from(await excel.arrayBuffer()));
    const rows = await runProcess(python, ['-c', 'import openpyxl,sys;w=openpyxl.load_workbook(sys.argv[1]);print(w["分类明细"].max_row)', output]);
    assert.equal(rows.trim(), '2');
    const head = await fetchHost(api + '/download?id=' + id, {method: 'HEAD'});
    assert.equal(Number(head.headers.get('content-length')), (await stat(output)).size);
    console.log('PASS actual Connection Word upload, local processing, streamed Excel download and HEAD');

    const size = (await stat(pdf)).size;
    const initialized = await fetchHost(api + '/large/init', post({name: 'synthetic.pdf', size, model: {provider: 'ipzsk', id: 'smoke-local-only'}}));
    assert.equal(initialized.status, 200);
    const largeId = (await initialized.json()).id;
    for (let offset = 0; offset < size; offset += 4 * 1024 ** 2) {
      const end = Math.min(offset + 4 * 1024 ** 2, size);
      const response = await fetchHost(api + '/large/upload?id=' + largeId + '&offset=' + offset, {method: 'POST', duplex: 'half', headers: {'content-type': 'application/octet-stream'}, body: Readable.toWeb(createReadStream(pdf, {start: offset, end: end - 1, highWaterMark: 64 * 1024}))});
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal((await response.json()).uploaded, end);
    }
    const digest = async path => { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); };
    assert.equal(await digest(pdf), await digest(join(profile, 'data/doc-to-excel-jobs/large', largeId, 'source.pdf')));
    assert.equal(egressAttempts, 0);
    console.log('PASS actual Host streams a PDF over 4 MiB in bounded chunks; source hash matches; zero external network/model requests');
  } finally { await host.shutdown.shutdown(0); }
}
