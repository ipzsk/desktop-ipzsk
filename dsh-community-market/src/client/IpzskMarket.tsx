import { useEffect, useState } from 'react'
interface Plugin { id: string; release_id: string; name: string; repository: string; version: string; notes: string; installedVersion?: string }
async function api(path: string, body?: object) {
  const response = await fetch('/api/ipzsk-market/' + path, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type':'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? '市场暂时不可用，请重试。')
  return data
}
export function IpzskMarket() {
  const [plugins,setPlugins] = useState<Plugin[]>([]), [loading,setLoading] = useState(true), [busy,setBusy] = useState(''), [notice,setNotice] = useState(''), [restart,setRestart] = useState('')
  const load = async () => { setLoading(true); try { setPlugins((await api('catalog')).plugins) } catch (e) { setNotice((e as Error).message) } finally { setLoading(false) } }
  useEffect(() => { void load() }, [])
  const install = async (p: Plugin) => {
    if (!confirm(`${p.installedVersion ? '更新' : '安装'}「${p.name}」到 ${p.version}？完成后需要重启客户端。`)) return
    setBusy(p.id); setNotice('正在下载并校验安装包，请稍候…')
    try { const result = await api('install',{pluginId:p.id,releaseId:p.release_id}); setRestart(result.restartToken); await load(); setNotice('安装完成。重启客户端后生效，插件数据会保留。') }
    catch (e) { setNotice((e as Error).message) } finally { setBusy('') }
  }
  return <section className="ipzskMarket">
    <div className="ipzskMarketToolbar"><div><h2>IPZSK 插件</h2><p>由 IPZSK 审核上架，安装包来自开发者的 GitHub Release。</p></div><button disabled={loading || !!busy} onClick={() => { setNotice(''); void load() }}>检查更新</button></div>
    {notice && <p role="status">{notice}</p>}
    {restart && <button disabled={!!busy} onClick={() => { void api('restart',{restartToken:restart}).catch(e => setNotice(e.message)) }}>重启客户端</button>}
    {loading ? <p>正在加载插件…</p> : !plugins.length ? <p>暂无已上架插件。</p> : <div className="ipzskMarketGrid">{plugins.map(p => <article key={p.id}>
      <h3>{p.name}</h3><p>{p.installedVersion ? `已安装 ${p.installedVersion} · 最新 ${p.version}` : `版本 ${p.version}`}</p>
      <p className="ipzskMarketNotes">{p.notes || '暂无更新说明。'}</p>
      <footer><a href={'https://github.com/' + p.repository} target="_blank" rel="noreferrer">GitHub 源码 ↗</a><button disabled={!!busy || p.installedVersion === p.version} onClick={() => void install(p)}>{busy === p.id ? '处理中…' : p.installedVersion === p.version ? '已是最新版' : p.installedVersion ? '更新' : '安装'}</button></footer>
    </article>)}</div>}
  </section>
}
