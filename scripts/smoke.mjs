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
// give WebGL a moment to settle frames
await page.waitForTimeout(1500)
await page.screenshot({ path: `${outDir}/1-initial.png` })

const currentName = await page.locator('h6').first().textContent()
console.log('CURRENT NODE:', currentName)

// Click a neighbor label chip (a clickable MUI Chip rendered by drei Html)
const chips = page.locator(".MuiChip-clickable:visible")
const chipCount = await chips.count()
console.log('NEIGHBOR CHIPS:', chipCount)
if (chipCount > 0) {
  const targetName = await chips.first().textContent()
  console.log('CLICKING NEIGHBOR:', targetName)
  await chips.first().click()
  await page.waitForSelector(`button:has-text("Travel to")`, { timeout: 5000 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${outDir}/2-node-panel.png` })

  await page.locator('button:has-text("Travel to")').click()
  await page.waitForTimeout(1200) // mid-flight (turn ~0.7s + fly 1.2-4s)
  await page.screenshot({ path: `${outDir}/3-traveling.png` })

  // wait for arrival: travel banner disappears
  await page.waitForSelector('text=Traveling to', { state: 'detached', timeout: 15000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${outDir}/4-arrived.png` })
  const newName = await page.locator('h6').first().textContent()
  console.log('ARRIVED AT:', newName)
}

// Multi-hop journey via the dev hook: cross the universe to Helios Prime
// and verify the route is flown hop by hop (banner shows hops remaining).
console.log('MULTI-HOP: traveling to 9-0 (Helios Prime)')
await page.evaluate(() => window.__nodefarer.travelTo('9-0'))
await page.waitForSelector('text=hops remaining', { timeout: 5000 })
await page.screenshot({ path: `${outDir}/5-multihop.png` })
await page.waitForSelector('text=Traveling to', { state: 'detached', timeout: 120000 })
await page.waitForTimeout(500)
console.log('MULTI-HOP ARRIVED AT:', await page.locator('h6').first().textContent())
await page.screenshot({ path: `${outDir}/6-multihop-arrived.png` })

console.log('CONSOLE ERRORS:', consoleErrors.length ? consoleErrors : 'none')
await browser.close()
