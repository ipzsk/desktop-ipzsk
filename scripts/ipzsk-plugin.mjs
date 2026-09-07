/** Independently install/update a Profile plugin using the installed Mac app's runtime. */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const [appPath,packageSpec]=process.argv.slice(2);
if(!appPath||!packageSpec||!/^(@[a-z0-9-]+\/)?[a-z0-9-]+(@[a-zA-Z0-9.^~+-]+)?$/.test(packageSpec)){
 throw new Error('Usage: node scripts/ipzsk-plugin.mjs "/Applications/IPZSK Desktop.app" @publisher/plugin[@version]');
}
const app=resolve(appPath);
const executable=join(app,'Contents/MacOS/IPZSK Desktop');
const cli=join(app,'Contents/Resources/app.asar/lib/desktop-cli.js');
if(!existsSync(executable))throw new Error('IPZSK Desktop.app was not found.');
const result=spawnSync(executable,['--expose-internals',cli,'plugin','--profile','desktop','add',packageSpec],{
 stdio:'inherit',env:{...process.env,ELECTRON_RUN_AS_NODE:'1',DSH_HOME:join(homedir(),'Library/Application Support/IPZSK Desktop/dsh-home')},
});
if(result.error)throw result.error;
process.exitCode=result.status??1;
