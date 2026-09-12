import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { LargePDF, LARGE_SYSTEM } from './large.js';
import { Engine, SYSTEM, PLAN_SYSTEM, findPython } from './engine.js';

export const name = 'doc-to-excel';
export const inject = ['connection', 'llm', 'ipzskDesktop'];

async function* requestChunks(request) {
  if (!request.body) throw new Error('请求内容为空');
  for await (const chunk of request.body) {
    request.signal.throwIfAborted();
    yield Buffer.from(chunk);
  }
  request.signal.throwIfAborted();
}

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of requestChunks(request)) {
    size += chunk.byteLength;
    if (size > 29 * 1024 * 1024) throw new Error('上传超过 20 MB 限制');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}

async function download(request, directory, filename) {
  const file = await open(path.join(directory, 'result.xlsx'), 'r');
  try {
    const { size } = await file.stat();
    const headers = {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${filename}"`,
      'content-length': String(size),
      'cache-control': 'no-store',
    };
    if (request.method === 'HEAD') {
      await file.close();
      return new Response(null, { headers });
    }
    return new Response(Readable.toWeb(file.createReadStream({ signal: request.signal })), { headers });
  } catch (error) {
    await file.close();
    throw error;
  }
}

export function apply(ctx) {
  const dataDir = ctx.get('ipzskDesktop')?.dataDir;
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) {
    throw new Error('文档转 Excel 需要 IPZSK 宿主提供绝对路径 ipzskDesktop.dataDir');
  }
  const directory = path.join(dataDir, 'doc-to-excel-jobs');
  const classify = async (model, batch, parentSignal) => {
    const { BlockAssembler, createUserMessage } = await import('@deepseek-ai/dsh-llm');
    const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(90000)]);
    const info = await ctx.llm.resolveModelInfo(model.provider, model.id, signal);
    const efforts = info.reasoning?.efforts ?? [];
    const effort = ['off', 'none', 'disabled', 'minimal', 'low'].find(id => efforts.some(e => e.id === id));
    const assembler = new BlockAssembler();
    for await (const chunk of ctx.llm.stream({ provider: model.provider, model: model.id, system: batch.task === 'large' ? LARGE_SYSTEM : batch.task === 'plan' ? PLAN_SYSTEM : SYSTEM, messages: [createUserMessage({content: [{type: 'text', text: JSON.stringify(batch)}], source: {kind: 'plugin', plugin: 'dsh-doc-to-excel'}})], maxTokens: batch.task === 'large' ? 8000 : batch.task === 'plan' ? 2200 : 3200, ...(effort ? {reasoningEffort: effort} : {}), signal })) { signal.throwIfAborted(); assembler.push(chunk); }
    if (assembler.finish?.kind !== 'stop') throw new Error(assembler.finish?.kind === 'max-tokens' ? '模型达到输出上限；请手动指定分类或选择推理开销较小的模型再试。' : '模型调用未正常完成；已停止后续调用。');
    return { text: assembler.blocks().filter(b => b.type === 'text').map(b => b.text).join(''), usage: assembler.usage };
  };
  const engine = new Engine({ directory, classify });
  const large = new LargePDF({ directory: path.join(directory, 'large'), classify });
  const routes = [
    [['GET'], '/large/list', async () => large.list()],
    [['POST'], '/large/init', async request => large.init(await body(request))],
    [['POST'], '/large/upload', async request => {
      if (!request.body) throw new Error('空上传分块');
      request.signal.throwIfAborted();
      const url = new URL(request.url);
      return large.upload(url.searchParams.get('id'), Number(url.searchParams.get('offset')), requestChunks(request));
    }],
    [['POST'], '/large/start', async request => { const {id, ...options} = await body(request); return large.start(id, options); }],
    [['POST'], '/large/pause', async request => large.pause((await body(request)).id)],
    [['POST'], '/large/export', async request => large.export((await body(request)).id)],
    [['GET'], '/large/status', async request => large.status(new URL(request.url).searchParams.get('id'))],
    [['GET', 'HEAD'], '/large/download', async request => {
      const job = await large.get(new URL(request.url).searchParams.get('id'));
      if (!job.download) throw new Error('请先导出 Excel');
      return download(request, job.dir, 'pdf-records.xlsx');
    }],
    [['GET'], '/config', async () => {
      let runtime = true, runtimeError = '';
      try { engine.executable ??= await findPython(); } catch (e) { runtime = false; runtimeError = e.message; }
      const models = [], errors = [];
      for (const provider of ctx.llm.listProviders()) {
        try { for (const model of await ctx.llm.listModels(provider.id)) models.push({provider: provider.id, id: model.id, name: `${provider.name} / ${model.name}`}); }
        catch { errors.push(provider.name); }
      }
      return {runtime, runtimeError, models, modelWarnings: errors, providerCount: ctx.llm.listProviders().length};
    }],
    [['POST'], '/create', async request => engine.create(await body(request))],
    [['GET'], '/status', async request => engine.status(new URL(request.url).searchParams.get('id'))],
    [['POST'], '/cancel', async request => {
      const {id} = await body(request);
      const job = engine.jobs.get(id);
      if (!job) throw new Error('任务不存在');
      job.controller.abort();
      return {ok: true};
    }],
    [['GET', 'HEAD'], '/download', async request => {
      const job = engine.jobs.get(new URL(request.url).searchParams.get('id'));
      if (!job?.download) throw new Error('Excel 尚未生成');
      return download(request, job.dir, 'organized.xlsx');
    }],
  ];

  // The desktop carrier owns request trust. Connection supplies Fetch requests
  // without a TCP socket, and owns each registration's lifetime.
  ctx.effect(() => async () => {
    await Promise.allSettled([engine.dispose(), large.dispose()]);
  }, 'doc-to-excel jobs');
  for (const [methods, routePath, handler] of routes) {
    ctx.connection.fetch.register({
      path: '/api/doc-to-excel' + routePath,
      methods,
      requestBody: routePath === '/large/upload' ? 'streaming' : 'buffered',
      fetch: async request => {
        try {
          const result = await handler(request);
          return result instanceof Response ? result : Response.json(result, {headers: {'cache-control': 'no-store'}});
        } catch (error) {
          return Response.json({error: String(error.message || error).slice(0, 500)}, {status: 400, headers: {'cache-control': 'no-store'}});
        }
      },
    });
  }
}
