import { chromium } from 'playwright-core'
import fs from 'node:fs'

const outDir = '/tmp/3dgraph-shots'
fs.mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

const consoleErrors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text())
})
page.on('pageerror', (err) => consoleErrors.push(String(err)))

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.waitForSelector('text=Current node', { timeout: 15000 })
await page.waitForTimeout(1500) // let WebGL settle frames
await page.screenshot({ path: `${outDir}/1-initial.png` })

const currentName = await page.locator('h6').first().textContent()
console.log('CURRENT NODE:', currentName)

// ── Node panel + link list (data-agnostic) ──────────────────────────────────
await page.locator('text=Current node').click()
await page.waitForSelector('text=/^Links/', { timeout: 5000 })
const links = page.locator('[data-testid="edge-link"]')
const linkCount = await links.count()
console.log('EDGE LINKS:', linkCount)
console.log('WORMHOLE LINKS:', await page.locator('[data-testid="edge-link"]:has-text("✷")').count())
if (linkCount > 0) {
  await links.nth(0).click() // pin first link -> sub-panel + viewport bracket
  await page.waitForSelector('button:has-text("Travel to"), button:has-text("Jump to")', { timeout: 5000 })
  if (linkCount > 1) await links.nth(1).click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${outDir}/1b-edge-links.png` })
}

// ── Expand: grow the view from the current node (Plan D) ─────────────────────
const ready = await page.evaluate(() => window.__nodefarer?.ready)
console.log('SOURCE READY:', ready)
await page.locator('button:has-text("Expand")').click()
await page.waitForTimeout(1200) // doors close, relayout, doors open
await page.screenshot({ path: `${outDir}/1c-expanded.png` })

// clear selection
await page.mouse.click(640, 400)
await page.waitForTimeout(300)

// ── Travel to a neighbor tag, if one is on the glass ─────────────────────────
const chips = page.locator('[data-testid="node-tag"]:visible')
let chipCount = await chips.count()
for (let spin = 0; spin < 12 && chipCount === 0; spin++) {
  await page.mouse.move(640, 400)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(640 - i * 25, 400, { steps: 1 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  chipCount = await chips.count()
}
console.log('NEIGHBOR CHIPS:', chipCount)
if (chipCount > 0) {
  console.log('CLICKING NEIGHBOR:', await chips.first().textContent())
  await chips.first().click()
  await page.waitForSelector('button:has-text("Travel to")', { timeout: 5000 })
  await page.screenshot({ path: `${outDir}/2-node-panel.png` })
  await page.locator('button:has-text("Travel to")').click()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${outDir}/3-traveling.png` })
  await page.waitForSelector('text=Traveling to', { state: 'detached', timeout: 15000 })
  await page.waitForTimeout(500)
  console.log('ARRIVED AT:', await page.locator('h6').first().textContent())
  await page.screenshot({ path: `${outDir}/4-arrived.png` })
}

console.log('CONSOLE ERRORS:', consoleErrors.length ? consoleErrors : 'none')
await browser.close()
