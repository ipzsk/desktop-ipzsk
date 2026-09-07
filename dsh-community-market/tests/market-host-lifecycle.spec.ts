import {expect,it} from 'vitest'
import {apply} from '../src/index.js'
it('registers only IPZSK routes while account and desktop capabilities are live',async()=>{
 const values=new Map<string,unknown>(),routes=new Map<string,any>(),cleanups:Array<()=>void>=[]
 let activate=()=>{}
 const webServer={port:43120,register:(route:any)=>{routes.set(route.path,route.handler);return()=>routes.delete(route.path)}}
 const scope={webServer,get:(name:string)=>values.get(name),effect:(fn:()=>unknown)=>{const clean=fn();if(typeof clean==='function')cleanups.push(clean as ()=>void)}}
 const context={inject:(names:string[],factory:(scope:unknown)=>void)=>{activate=()=>{if(names.every(name=>values.has(name)))factory(scope)}}}
 apply(context as never);expect(routes.size).toBe(0)
 values.set('desktopProfiles',{current:{name:'desktop',dir:'/tmp/ipzsk-test-profile'}});values.set('desktopPnpm',{});values.set('desktopActions',{requestRestart:async()=>{}})
 activate();expect(routes.size).toBe(0)
 values.set('ipzskMarket',{catalog:async()=>({market_id:'dsh-ipzsk-market',plugins:[]}),checkpoint:()=>{}});activate()
 expect([...routes.keys()].sort()).toEqual(['/api/ipzsk-market/catalog','/api/ipzsk-market/install','/api/ipzsk-market/restart'])
 const call=async(origin:string)=>{let status=0,body='';const response={writeHead:(code:number)=>{status=code},end:(value:string)=>{body=value}};await routes.get('/api/ipzsk-market/catalog')({method:'GET',headers:{host:'127.0.0.1:43120',origin,'sec-fetch-site':origin.includes('evil')?'cross-site':'same-origin'},socket:{remoteAddress:'127.0.0.1'}},response);return{status,body:JSON.parse(body)}}
 expect(await call('http://127.0.0.1:43120')).toEqual({status:200,body:{plugins:[]}});expect((await call('https://evil.example')).status).toBe(403)
 for(const clean of cleanups.reverse())clean();expect(routes.size).toBe(0)
})
