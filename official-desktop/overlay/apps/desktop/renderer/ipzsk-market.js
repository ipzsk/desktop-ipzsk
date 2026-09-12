/* This document has no network capability; only the reviewed-ID preload is exposed. */
const api = window.ipzskMarket
const list = document.querySelector('#plugins')
const status = document.querySelector('#status')
const refresh = document.querySelector('#refresh')
let busy = false

function message(error) { return error instanceof Error ? error.message : '市场暂时不可用，请重试。' }
function element(tag, text, className) {
  const node = document.createElement(tag)
  node.textContent = text
  if (className) node.className = className
  return node
}
async function load() {
  refresh.disabled = true
  try {
    const data = await api.catalog()
    list.replaceChildren()
    document.querySelector('#empty').hidden = data.plugins.length > 0
    for (const plugin of data.plugins) {
      const installed = data.installed.find(item => item.name === plugin.package_name)
      const card = document.createElement('article')
      card.append(element('h2', plugin.name),
        element('p', installed ? `已安装 ${installed.version} · 审核版本 ${plugin.version}` : `审核版本 ${plugin.version}`),
        element('p', plugin.notes || '暂无更新说明。', 'notes'),
        element('p', `GitHub：${plugin.repository}`, 'repository'))
      const action = plugin.installState
      const button = element('button', action === 'ahead' ? '已安装较新版本' : action === 'current' ? '已是审核版本' : action === 'update' ? '更新' : '安装')
      button.type = 'button'
      button.disabled = busy || action === 'current' || action === 'ahead' || !data.canInstall
      button.onclick = async () => {
        if (busy || !confirm(`${installed ? '更新' : '安装'}「${plugin.name}」到 ${plugin.version}？安装期间会暂停并重新启动工作区，请先保存进行中的工作。`)) return
        busy = true
        for (const control of document.querySelectorAll('button')) control.disabled = true
        status.textContent = '正在下载、校验兼容性并安装审核版本…'
        try {
          await api.install(plugin.id, plugin.release_id)
          status.textContent = '安装完成，工作区已重新启动。'
        } catch (error) { status.textContent = message(error) }
        finally { busy = false; await load() }
      }
      card.append(button)
      list.append(card)
    }
    if (!data.canInstall) status.textContent = '安装插件需要使用已打包的 IPZSK 桌面客户端。'
  } catch (error) { status.textContent = message(error); list.replaceChildren() }
  finally { refresh.disabled = busy }
}
refresh.onclick = () => { status.textContent = ''; void load() }
void load()
