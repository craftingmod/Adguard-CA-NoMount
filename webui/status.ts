export const target = "/apex/com.android.conscrypt/cacerts/0f4ed297.0"
export const backing = `/data/adb/modules/adguard-ca-nomount${target}`

// KernelSU/libsu appends job bookkeeping; exit must not close its parent shell.
export const certificateCommand = `(
STORE=/data/misc/user/0/cacerts-added
[ -d "$STORE" ] && [ -r "$STORE" ] && [ -x "$STORE" ] || exit 2
for cert in "$STORE"/0f4ed297.*; do
    [ -f "$cert" ] && [ -s "$cert" ] && [ ! -L "$cert" ] || continue
    suffix=\${cert##*.}
    case "$suffix" in ''|*[!0-9]*) continue ;; esac
    echo installed
    exit 0
done
echo missing
)
`

export const injectionCommand = "/data/adb/modules/nomount/bin/nm rule list"

export function hasInjectionRule(output: string) {
  return output.split(/\r?\n/).some((line) => {
    const [virtual, real, extra] = line.split(" -> ").map((path) => path.trim())
    return virtual === target && real === backing && extra === undefined
  })
}
