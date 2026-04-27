#!/usr/bin/env node
import fs from 'fs'
import path from 'path'

const licensePath = path.resolve(process.cwd(), 'LICENSE')
try {
  const content = fs.readFileSync(licensePath, 'utf8')
  const year = new Date().getFullYear()
  const updated = content.replace(/<year>/g, String(year))
  if (updated === content) {
    console.log('No <year> placeholder found; no changes made.')
    process.exit(0)
  }
  fs.writeFileSync(licensePath, updated, 'utf8')
  console.log(`Updated LICENSE: replaced <year> with ${year}`)
} catch (err) {
  console.error('Failed to update LICENSE:', err)
  process.exit(1)
}
