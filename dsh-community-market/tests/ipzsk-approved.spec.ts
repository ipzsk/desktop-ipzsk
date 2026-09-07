import { describe, it, expect } from 'vitest'
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { approvedCatalog, downloadApproved, verifyArchive, type ApprovedPlugin } from '../src/install/approved.js'
function fixture() {
  const body=Buffer.from(JSON.stringify({name:'fixture-plugin',version:'1.0.0',dsh:{bundle:{patch:'./cordis.patch.yml'}}}))
  const header=Buffer.alloc(512);header.write('package/package.json');header.write(body.length.toString(8).padStart(11,'0'),124);header[156]=48
  const bytes=gzipSync(Buffer.concat([header,body,Buffer.alloc(512-body.length),Buffer.alloc(1024)]))
  const p:ApprovedPlugin={id:'11111111-1111-4111-8111-111111111111',release_id:'22222222-2222-4222-8222-222222222222',name:'Fixture',package_name:'fixture-plugin',repository:'Fixture/plugin',version:'1.0.0',artifact_url:'https://github.com/Fixture/plugin/releases/download/v1.0.0/plugin.tgz',size_bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),notes:''}
  return {bytes,p}
}
describe('IPZSK reviewed release boundary',()=>{
 it('accepts only pinned GitHub artifacts from the registered repository',()=>{const {p}=fixture();expect(approvedCatalog({market_id:'dsh-ipzsk-market',plugins:[p]})).toEqual([p]);for(const change of [{artifact_url:'https://github.com/Other/plugin/releases/download/v1.0.0/a.tgz'},{package_name:'dsh-plugin-desktop'},{version:'latest'},{sha256:''}])expect(()=>approvedCatalog({market_id:'dsh-ipzsk-market',plugins:[{...p,...change}]})).toThrow()})
 it('checks bytes, package identity and exact version before installation',()=>{const {p,bytes}=fixture();verifyArchive(bytes,p);for(const change of [{size_bytes:bytes.length+1},{sha256:'0'.repeat(64)},{package_name:'other'},{version:'2.0.0'}])expect(()=>verifyArchive(bytes,{...p,...change})).toThrow()})
 it('downloads without account credentials and denies private redirects',async()=>{const {p,bytes}=fixture();let calls=0;const request:typeof fetch=async(_url,init)=>{expect(init?.headers).toBeUndefined();calls++;return new Response(bytes)};expect(await downloadApproved(p,AbortSignal.timeout(1000),request)).toEqual(bytes);expect(calls).toBe(1);await expect(downloadApproved(p,AbortSignal.timeout(1000),async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}}))).rejects.toThrow()})
})
