// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {IpzskMarket} from '../src/client/IpzskMarket.js'
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('opens the IPZSK catalog directly and updates using only approved IDs',async()=>{
 const plugin={id:'plugin-id',release_id:'release-id',name:'IPZSK 生图',repository:'JayceHuang/dsh-imagegen',version:'1.6.0',installedVersion:'1.5.6',notes:'独立更新'}
 const requests:Array<{url:string;body?:string}>=[]
 vi.stubGlobal('confirm',()=>true)
 vi.stubGlobal('fetch',async(url:string,init:RequestInit)=>{requests.push({url,...(typeof init.body==='string'?{body:init.body}:{})});return new Response(JSON.stringify(url.endsWith('/install')?{restartToken:'restart-fixture'}:{plugins:[plugin]}))})
 render(<IpzskMarket/>);await screen.findByText('IPZSK 生图');expect(screen.queryByText('添加来源')).toBeNull();expect(screen.getByRole('link',{name:'GitHub 源码 ↗'}).getAttribute('href')).toBe('https://github.com/JayceHuang/dsh-imagegen')
 fireEvent.click(screen.getByRole('button',{name:'更新'}));await waitFor(()=>expect(screen.getByRole('button',{name:'重启客户端'})).toBeTruthy());expect(JSON.parse(requests.find(r=>r.url.endsWith('/install'))!.body!)).toEqual({pluginId:'plugin-id',releaseId:'release-id'})
})
it('shows a failure without silently switching to another source',async()=>{vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({error:'目录暂时不可用'}),{status:503}));render(<IpzskMarket/>);await screen.findByText('目录暂时不可用');expect(screen.queryByText('安装')).toBeNull()})
