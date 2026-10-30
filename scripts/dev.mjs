// `npm run dev` on macOS and Windows alike: `NODE_OPTIONS=… next dev` is shell syntax Windows'
// npm can't run. NODE_OPTIONS (not a node flag) because next dev runs the server in a child
// process, and only the environment reaches it. 4GB heap: see CLAUDE.md quirk #30.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const next = createRequire(import.meta.url).resolve('next/dist/bin/next')
const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=4096`.trim() }
const child = spawn(process.execPath, [next, 'dev', ...process.argv.slice(2)], { stdio: 'inherit', env })
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))
