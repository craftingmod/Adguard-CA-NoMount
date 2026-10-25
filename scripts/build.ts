import { mkdir } from "node:fs/promises"
import { join, relative, resolve } from "node:path"
import { zipSync, type Zippable } from "fflate"

export const root = resolve(import.meta.dir, "..")
export const moduleFiles = [
  "module.prop",
  "post-fs-data.sh",
  "customize.sh",
  "README.md",
]

export async function build(
  outputDir = join(root, "dist"),
  releaseTag?: string,
) {
  const files: Zippable = {}
  let version = ""
  for (const name of moduleFiles) {
    const source =
      name === "README.md" ? join(root, name) : join(root, "module", name)
    const content = (await Bun.file(source).text()).replaceAll("\r\n", "\n")
    if (!content.endsWith("\n"))
      throw new Error(`${name} needs a final newline`)
    if (name === "module.prop")
      version = /^version=([\w.-]+)$/m.exec(content)?.[1] ?? ""
    if (
      name.endsWith(".sh") &&
      /\/data\/local\/tmp|\b(?:mount|nsenter|mktemp)\b/.test(
        content.replace(/^#.*$/gm, ""),
      )
    ) {
      throw new Error(`Forbidden operation in ${name}`)
    }
    files[name] = [
      new TextEncoder().encode(content),
      {
        os: 3,
        attrs: (name.endsWith(".sh") ? 0o100755 : 0o100644) << 16,
        mtime: new Date("2026-01-01T00:00:00Z"),
      },
    ]
  }
  if (!version) throw new Error("Invalid module version")
  if (releaseTag !== undefined && releaseTag !== `v${version}`) {
    throw new Error(
      `Release tag ${releaseTag} does not match module version v${version}`,
    )
  }
  const webroot = join(outputDir, "webroot")
  const webui = await Bun.build({
    entrypoints: [join(root, "webui/index.html")],
    outdir: webroot,
    target: "browser",
    minify: true,
  })
  if (!webui.success) throw new AggregateError(webui.logs, "WebUI build failed")
  for (const asset of webui.outputs) {
    const name =
      "webroot/" + relative(webroot, asset.path).replaceAll("\\", "/")
    files[name] = [
      new Uint8Array(await asset.arrayBuffer()),
      {
        os: 3,
        attrs: 0o100644 << 16,
        mtime: new Date("2026-01-01T00:00:00Z"),
      },
    ]
  }
  await mkdir(outputDir, { recursive: true })
  const output = join(outputDir, `adguard-ca-nomount-${version}.zip`)
  await Bun.write(output, zipSync(files, { level: 9 }))
  return output
}

if (import.meta.main) {
  const args = Bun.argv.slice(2)
  if (args.length !== 0) {
    throw new Error("Usage: bun run build")
  }
  const releaseTag =
    process.env.GITHUB_REF_TYPE === "tag"
      ? process.env.GITHUB_REF_NAME
      : undefined
  console.log(await build(undefined, releaseTag))
}
