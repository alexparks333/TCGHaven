// Builds the iPhone app and installs it on the paired phone over Wi-Fi — no Xcode clicking.
//
//   npm run ios:dev    the app loads THIS Mac's dev server (http://<Wi-Fi IP>:3000): every code change
//                      shows on the phone in seconds, no push. Needs `npm run dev` running and the
//                      phone on the same Wi-Fi.
//   npm run ios:live   back to the real site (https://www.tcghaven.org). Run before any TestFlight /
//                      App Store build — the dev address is baked into the build until then.
//
// Options: --no-install (sync + build only), IOS_DEVICE=<UDID> to pick a phone (default: the first
// paired, available iPhone). How it fits together: docs/ios-app.md "Dev mode".
import { execFileSync } from 'node:child_process'
import { networkInterfaces, tmpdir } from 'node:os'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const mode = process.argv[2]
if (mode !== 'dev' && mode !== 'live') { console.error('Usage: node scripts/ios-app.mjs dev|live [--no-install]'); process.exit(1) }
const install = !process.argv.includes('--no-install')
const run = (cmd, args, env = {}) => execFileSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } })

// This Mac's Wi-Fi / LAN address (IPv4, not loopback)
function lanIp() {
  const nets = networkInterfaces()
  for (const name of ['en0', 'en1', ...Object.keys(nets)]) {
    const hit = (nets[name] ?? []).find((n) => n.family === 'IPv4' && !n.internal)
    if (hit) return hit.address
  }
  return null
}

let env = { CAP_DEV_URL: '' }
if (mode === 'dev') {
  const ip = lanIp()
  if (!ip) { console.error('No Wi-Fi / network address found on this Mac.'); process.exit(1) }
  env = { CAP_DEV_URL: `http://${ip}:3000` }
  console.log(`\n▶ Dev mode: the app will load ${env.CAP_DEV_URL} (keep \`npm run dev\` running)\n`)
} else {
  console.log('\n▶ Live mode: the app will load https://www.tcghaven.org\n')
}
run('npx', ['cap', 'sync', 'ios'], env)

// Build for a real iPhone
const derived = 'ios/App/build'
run('xcodebuild', [
  '-project', 'ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Debug',
  '-destination', 'generic/platform=iOS', '-derivedDataPath', derived,
  '-allowProvisioningUpdates', '-quiet', 'build',
])
// Unlock the phone first: a locked phone can't take an install ("device was still locked")
const appPath = join(derived, 'Build/Products/Debug-iphoneos/App.app')
if (!install) { console.log(`\n✔ Built ${appPath}`); process.exit(0) }

// Pick the phone: IOS_DEVICE, or the first paired, available iPhone
let udid = process.env.IOS_DEVICE
if (!udid) {
  const out = join(tmpdir(), `devices-${process.pid}.json`)
  execFileSync('xcrun', ['devicectl', 'list', 'devices', '--json-output', out], { stdio: 'ignore' })
  const devices = JSON.parse(readFileSync(out, 'utf8')).result?.devices ?? []
  rmSync(out, { force: true })
  const phone = devices.find((d) => d.hardwareProperties?.platform === 'iOS' && d.hardwareProperties?.reality === 'physical'
    && d.connectionProperties?.pairingState === 'paired')
  udid = phone?.hardwareProperties?.udid
  if (!udid) { console.error('No paired iPhone found (xcrun devicectl list devices). Unlock it and keep it on the same Wi-Fi.'); process.exit(1) }
  console.log(`\n▶ Installing on ${phone.deviceProperties?.name ?? udid}`)
}
run('xcrun', ['devicectl', 'device', 'install', 'app', '--device', udid, appPath])
run('xcrun', ['devicectl', 'device', 'process', 'launch', '--device', udid, '--terminate-existing', 'com.alexhparks.tcghaven'])
console.log(mode === 'dev'
  ? '\n✔ Installed in dev mode. Changes on this Mac show on the phone as soon as they are saved.'
  : '\n✔ Installed — the app shows the live site again.')
