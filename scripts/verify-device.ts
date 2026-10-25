// Read-only device checks. Application trust still needs a real HTTPS request.
const serial = Bun.argv[2]
const prefix = serial ? ["adb", "-s", serial] : ["adb"]
const mod = "/data/adb/modules/adguard-ca-nomount"
const target = "/apex/com.android.conscrypt/cacerts/0f4ed297.0"
const checks: [string, string][] = [
  [
    "Preparation log",
    `cat ${mod}/logs/boot.log; grep -q '^PREPARED:' ${mod}/logs/boot.log`,
  ],
  ["NoMount kernel API", "/data/adb/modules/nomount/bin/nm version"],
  [
    "VFS rule (inspect target and backing path)",
    "/data/adb/modules/nomount/bin/nm rule list",
  ],
  [
    "Android-visible CA",
    `ls -lZ ${target}; cmp -s ${mod}/apex/com.android.conscrypt/cacerts/0f4ed297.0 ${target}`,
  ],
  [
    "SHA-256 of module and Android-visible CA",
    `sha256sum ${mod}/apex/com.android.conscrypt/cacerts/0f4ed297.0 ${target}`,
  ],
  [
    "Intermediate remains in user store",
    "ls -lZ /data/misc/user/0/cacerts-added/47ec1af8.*",
  ],
]
let failed = false
for (const [label, command] of checks) {
  console.log(`\n${label}`)
  const child = Bun.spawn([...prefix, "shell", "su", "-c", `'${command}'`], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  console.log(stdout.trim())
  if (stderr.trim()) console.error(stderr.trim())
  if (code !== 0) failed = true
  if (
    label.startsWith("VFS rule") &&
    (!stdout.includes(target) || !stdout.includes(`${mod}/apex/`))
  )
    failed = true
}
console.log(
  "\nApp trust, UID isolation, boot ordering and mountinfo require the manual checks in module/README.md.",
)
process.exitCode = failed ? 1 : 0
