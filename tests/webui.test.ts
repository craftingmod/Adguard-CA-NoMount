import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { join, resolve, sep } from "node:path"
import {
  backing,
  certificateCommand,
  hasInjectionRule,
  target,
} from "../webui/status"
import { root } from "../scripts/build"

test("injection requires the exact virtual and backing path on the same rule", () => {
  expect(hasInjectionRule(`${target} -> ${backing}\n`)).toBe(true)
  expect(hasInjectionRule(`Other rules\r\n ${target} -> ${backing} \r\n`)).toBe(
    true,
  )
  for (const output of [
    "",
    `${target} -> ${backing}.old`,
    `${target}.old -> ${backing}`,
    `${target} -> /another/module\n/another/target -> ${backing}`,
    `${target} -> ${backing} -> extra`,
  ]) {
    expect(hasInjectionRule(output)).toBe(false)
  }
})

test("CA query only accepts nonempty Personal CA files with numeric suffixes", async () => {
  await mkdir(join(root, ".cache"), { recursive: true })
  const directory = await mkdtemp(join(root, ".cache", "webui-test-"))
  const shell =
    process.env.TEST_SHELL ??
    (process.platform === "win32"
      ? "C:/Program Files/Git/bin/bash.exe"
      : "/bin/sh")
  const store = directory
    .replaceAll("\\", "/")
    .replace(/^([A-Za-z]):/, (_, drive: string) => "/" + drive.toLowerCase())
  const command = certificateCommand.replace(
    "STORE=/data/misc/user/0/cacerts-added",
    `STORE='${store}'`,
  )
  const query = () =>
    Bun.spawnSync([shell, "-c", command], {
      env: { ...process.env, MSYS_NO_PATHCONV: "1" },
    })
  try {
    await Bun.write(join(directory, "47ec1af8.0"), "Intermediate")
    await Bun.write(join(directory, "0f4ed297.bad"), "invalid suffix")
    await Bun.write(join(directory, "0f4ed297.0"), "")
    await mkdir(join(directory, "0f4ed297.99"))
    expect(query().stdout.toString().trim()).toBe("missing")
    await Bun.write(join(directory, "0f4ed297.10"), "Personal CA")
    expect(query().stdout.toString().trim()).toBe("installed")
    const job = Bun.spawnSync(
      [shell, "-c", command + '\nprintf "JOB_COMPLETE:%s\\n" "$?"\n'],
      { env: { ...process.env, MSYS_NO_PATHCONV: "1" } },
    )
    expect(job.stdout.toString().trim()).toBe("installed\nJOB_COMPLETE:0")
    await rm(join(directory, "0f4ed297.10"))
    expect(query().stdout.toString().trim()).toBe("missing")
    expect(
      Bun.spawnSync([
        shell,
        "-c",
        command.replace(`STORE='${store}'`, `STORE='${store}/missing'`),
      ]).exitCode,
    ).toBe(2)
    const failedJob = Bun.spawnSync(
      [
        shell,
        "-c",
        command.replace(`STORE='${store}'`, `STORE='${store}/missing'`) +
          '\nprintf "JOB_COMPLETE:%s\\n" "$?"\n',
      ],
    )
    expect(failedJob.stdout.toString().trim()).toBe("JOB_COMPLETE:2")
  } finally {
    if (resolve(directory).startsWith(resolve(root, ".cache") + sep))
      await rm(directory, { recursive: true, force: true })
  }
})
