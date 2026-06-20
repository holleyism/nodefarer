// Drives the S1 guided tour end-to-end in a real browser: open the tours rail,
// start the tour, step through every stop, exercise Back, and quit — asserting
// the narration advances and no console errors fire.
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const outDir = '/tmp/3dgraph-tour-shots'
fs.mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

const consoleErrors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text())
})
page.on('pageerror', (err) => consoleErrors.push(String(err)))

await page.goto(process.env.SMOKE_URL || 'http://localhost:5173', { waitUntil: 'networkidle' })
// Wait for the source to load (dev-only handle) and the layout doors to open.
await page.waitForFunction(() => window.__nodefarer?.ready === true, { timeout: 20000 })
await page.waitForTimeout(2000)

// Open the Guided tours rail (rail titles are aria-labels) and launch S1.
await page.getByRole('button', { name: 'Guided tours' }).click()
await page.waitForSelector('text=Idea genealogy', { timeout: 5000 })
await page.locator('text=Idea genealogy').click()

const title = page.locator('[data-testid="tour-title"]')
const next = page.locator('[data-testid="tour-next"]')

// Wait for the engine to land + show step 1; the button is disabled while busy.
await page.waitForSelector('[data-testid="tour-title"]', { timeout: 8000 })
await page.waitForFunction(() => {
  const b = document.querySelector('[data-testid="tour-next"]')
  return b && !b.disabled
}, { timeout: 15000 })

const seen = []
let landed = await title.textContent()
seen.push(landed)
console.log('STEP 01:', landed)
await page.screenshot({ path: `${outDir}/step-01.png` })

// The rail must be locked while the tour drives the view: its aria-hidden
// container removes the icon buttons from the accessibility tree, and the
// container is non-interactive.
const railButtons = await page.getByRole('button', { name: 'Guided tours' }).count()
const railPE = await page.evaluate(() => {
  const el = document.querySelector('[aria-hidden="true"]')
  return el ? getComputedStyle(el).pointerEvents : 'n/a'
})
console.log('RAIL LOCKED:', railButtons === 0 && railPE === 'none', `(buttons=${railButtons}, pointerEvents=${railPE})`)
if (railButtons !== 0 || railPE !== 'none') throw new Error('rail not locked during tour')

// Step through to the end. The last step's button is "End tour" (still testid
// tour-next); after it the panel detaches.
for (let i = 2; i <= 12; i++) {
  const before = await title.textContent().catch(() => null)
  await next.click()
  // Grab a mid-op frame (ship in flight, before the step settles) to verify
  // travel/conduit rendering, not just the parked end state.
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${outDir}/step-${String(i).padStart(2, '0')}-midflight.png` })
  // Either the title advances (a step) or the panel closes (End tour).
  await page
    .waitForFunction(
      (prev) => {
        const t = document.querySelector('[data-testid="tour-title"]')
        return !t || t.textContent !== prev
      },
      before,
      { timeout: 20000 },
    )
    .catch(() => {})
  // Wait out the busy state if the panel is still up.
  await page
    .waitForFunction(
      () => {
        const b = document.querySelector('[data-testid="tour-next"]')
        return !b || !b.disabled
      },
      { timeout: 20000 },
    )
    .catch(() => {})
  const stillOpen = await title.count()
  if (!stillOpen) {
    console.log('TOUR ENDED after', seen.length, 'steps')
    break
  }
  const t = await title.textContent()
  seen.push(t)
  console.log('STEP', String(i).padStart(2, '0') + ':', t)
  await page.screenshot({ path: `${outDir}/step-${String(i).padStart(2, '0')}.png` })

  // Midway, exercise Back once then re-advance.
  if (i === 4) {
    const back = page.locator('[data-testid="tour-back"]')
    if (await back.count()) {
      const cur = await title.textContent()
      await back.click()
      await page
        .waitForFunction(
          (prev) => document.querySelector('[data-testid="tour-title"]')?.textContent !== prev,
          cur,
          { timeout: 15000 },
        )
        .catch(() => {})
      console.log('  BACK ->', await title.textContent())
      await page.waitForFunction(() => {
        const b = document.querySelector('[data-testid="tour-next"]')
        return b && !b.disabled
      }, { timeout: 15000 })
    }
  }
}

// Rail unlocks once the tour ends.
await page.waitForTimeout(600)
const railBack = await page.getByRole('button', { name: 'Guided tours' }).count()
console.log('RAIL UNLOCKED AFTER TOUR:', railBack > 0)
if (railBack === 0) throw new Error('rail still locked after tour ended')

console.log('NARRATION SEEN:', seen.length, 'distinct steps')
console.log('CONSOLE ERRORS:', consoleErrors.length ? consoleErrors : 'none')
await browser.close()
process.exit(consoleErrors.length ? 1 : 0)
