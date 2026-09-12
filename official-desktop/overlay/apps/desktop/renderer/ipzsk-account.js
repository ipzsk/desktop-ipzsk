/* The bridge exposes account operations only; this document has no network access. */
const get = id => document.getElementById(id)
let signedIn = false
let page = 1
let reading = false
let changing = false
let currentBill

const formatPoints = value => Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 6 }) + ' 点'
const notice = message => { get('notice').textContent = message }
async function request(value) {
  const result = await window.ipzskAccount.request(value)
  if (!result.ok) throw new Error(result.error)
  return result.value
}

function showState(state) {
  signedIn = state.signedIn
  get('login').hidden = signedIn
  get('account').hidden = !signedIn
  get('account-email').textContent = state.email
  get('remember').disabled = !state.canRemember
  get('remember-notice').hidden = state.canRemember
  if (!state.canRemember) get('remember').checked = false
  if (!signedIn) get('email').focus()
}

function renderBill(data) {
  currentBill = data
  page = data.usage.page
  get('available').textContent = formatPoints(data.wallet.available_points)
  get('frozen').textContent = Number(data.wallet.frozen_points) > 0
    ? '处理中冻结 ' + formatPoints(data.wallet.frozen_points) : '网页与客户端共用点数。充值到账后即可使用。'
  get('rows').replaceChildren(...data.usage.rows.map(row => {
    const tr = document.createElement('tr')
    const time = document.createElement('td')
    time.append(document.createTextNode(row.created_at ? new Date(row.created_at).toLocaleString('zh-CN') : '—'), document.createElement('br'), document.createTextNode(row.id))
    const values = [row.model, `${row.input_tokens ?? '—'} / ${row.output_tokens ?? '—'}`, row.charged_points !== null ? formatPoints(row.charged_points) : row.billing_state === 'released' ? '未扣款' : row.billing_state ? '待结算' : '历史未计费']
    tr.append(time, ...values.map(value => { const td = document.createElement('td'); td.textContent = value; return td }))
    return tr
  }))
  get('empty').hidden = data.usage.rows.length > 0
  get('page').textContent = `第 ${data.usage.page} 页`
  get('previous').disabled = data.usage.page <= 1
  get('next').disabled = data.usage.page * data.usage.page_size >= data.usage.count
}

async function refresh() {
  if (!signedIn || reading) return
  reading = true
  get('refresh').disabled = true
  get('previous').disabled = true
  get('next').disabled = true
  try { renderBill(await request({ type: 'billing', page })) }
  catch (error) {
    notice(error.message)
    if (currentBill) renderBill(currentBill)
    get('available').textContent = '暂不可用'
    get('frozen').textContent = currentBill ? '下方保留上次读取的消费记录，请稍后刷新余额。' : '请稍后刷新。'
  } finally { reading = false; get('refresh').disabled = false }
}

get('login-form').addEventListener('submit', async event => {
  event.preventDefault()
  if (changing) return
  changing = true
  notice('正在登录…')
  get('sign-in').disabled = true
  try {
    const state = await request({ type: 'signIn', email: get('email').value, password: get('password').value, remember: get('remember').checked })
    get('password').value = ''
    if (state) { showState(state); notice('登录成功。'); await refresh() }
  } catch (error) { get('password').value = ''; notice(error.message) }
  finally { changing = false; get('sign-in').disabled = false }
})

get('account-site').addEventListener('click', () => { void request({ type: 'accountSite' }).catch(error => notice(error.message)) })
get('refresh').addEventListener('click', () => { notice(''); void refresh() })
get('previous').addEventListener('click', () => { if (!reading && page > 1) { page -= 1; void refresh() } })
get('next').addEventListener('click', () => { if (!reading) { page += 1; void refresh() } })
get('redeem-form').addEventListener('submit', async event => {
  event.preventDefault()
  if (changing) return
  changing = true
  get('redeem').disabled = true
  notice('正在兑换…')
  try {
    const result = await request({ type: 'redeem', code: get('voucher').value.trim() })
    get('voucher').value = ''
    notice(result.replayed ? '已兑换到本账户，未重复入账。' : `兑换成功，到账 ${formatPoints(result.amount_points)}。`)
    page = 1
    await refresh()
  } catch (error) { notice(error.message) }
  finally { changing = false; get('redeem').disabled = false }
})
get('sign-out').addEventListener('click', async () => {
  if (changing) return
  changing = true
  get('sign-out').disabled = true
  notice('正在退出登录…')
  try { await request({ type: 'signOut' }) }
  catch (error) { notice(error.message); changing = false; get('sign-out').disabled = false }
})
window.addEventListener('focus', () => { void refresh() })
setInterval(() => { if (!document.hidden) void refresh() }, 15_000)
void request({ type: 'state' }).then(async state => { showState(state); await refresh() }).catch(error => notice(error.message))
