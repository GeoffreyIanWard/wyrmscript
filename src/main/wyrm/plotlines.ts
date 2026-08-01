import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'
import type { Plotline, PlotlineStatus } from '../../shared/types'

const PLOTLINES_DIR = 'plotlines'

function plotlineDir(projectPath: string): string {
  return join(projectPath, PLOTLINES_DIR)
}

function plotlinePath(projectPath: string, id: string): string {
  return join(plotlineDir(projectPath), `${id}.md`)
}

interface PlotlineFrontmatter {
  id: string
  name: string
  colour: string
  status: PlotlineStatus
  created: string
  modified: string
}

function parsePlotlineFile(raw: string): Plotline {
  const parsed = matter(raw)
  const data = parsed.data as PlotlineFrontmatter
  return {
    id: data.id,
    name: data.name,
    colour: data.colour,
    status: data.status,
    created: data.created,
    modified: data.modified
  }
}

export async function writePlotline(projectPath: string, plotline: Plotline): Promise<void> {
  await fsp.mkdir(plotlineDir(projectPath), { recursive: true })
  const meta: PlotlineFrontmatter = {
    id: plotline.id,
    name: plotline.name,
    colour: plotline.colour,
    status: plotline.status,
    created: plotline.created,
    modified: new Date().toISOString()
  }
  const file = matter.stringify('', meta)
  await fsp.writeFile(plotlinePath(projectPath, plotline.id), file, 'utf8')
}

/**
 * Every plotline in the project. Projects created before F-04 simply have no
 * plotlines directory yet — not an error, just an empty result, same
 * rationale as `listEntities`.
 */
export async function listPlotlines(projectPath: string): Promise<Plotline[]> {
  const dir = plotlineDir(projectPath)
  let files: string[]
  try {
    files = await fsp.readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const plotlines: Plotline[] = []
  for (const file of files) {
    if (!file.endsWith('.md')) continue
    try {
      const raw = await fsp.readFile(join(dir, file), 'utf8')
      plotlines.push(parsePlotlineFile(raw))
    } catch {
      // Skip unparsable entries; see listEntities for the same rationale.
      continue
    }
  }
  return plotlines
}

export async function deletePlotline(projectPath: string, id: string): Promise<void> {
  // force: true means a missing file is not an error.
  await fsp.rm(plotlinePath(projectPath, id), { force: true })
}
