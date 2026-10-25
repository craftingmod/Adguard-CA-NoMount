import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { unzipSync } from "fflate";
import { build, moduleFiles, root } from "../scripts/build";

const shell = process.env.TEST_SHELL ?? (process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/sh");
setDefaultTimeout(20_000);
const posix = (path: string) => path.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_, drive: string) => "/" + drive.toLowerCase());
let temp: string;
let sequence = 0;
let script: string;

function run(code: string, directory: string, env: Record<string, string> = {}) {
  const result = Bun.spawnSync([shell, "-c", code], {
    cwd: directory,
    env: { ...process.env, MSYS_NO_PATHCONV: "1", ...env },
    stdout: "pipe", stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString() + result.stdout.toString());
  return result.stdout.toString();
}

beforeAll(async () => {
  await mkdir(join(root, ".cache"), { recursive: true });
  temp = await mkdtemp(join(root, ".cache", "module-test-"));
  script = await Bun.file(join(root, "module/post-fs-data.sh")).text();
  // Deliberately synthetic envelopes: these tests must not imply X.509 validation.
  for (const name of ["personal", "renewed", "intermediate", "leaf"]) {
    const payload = Buffer.from(name);
    const der = Buffer.concat([Buffer.from([0x30, payload.length]), payload]);
    await Bun.write(join(temp, name + ".der"), der);
    await Bun.write(join(temp, name + ".pem"), `-----BEGIN CERTIFICATE-----\n${der.toString("base64")}\n-----END CERTIFICATE-----\n`);
  }
});

afterAll(async () => {
  if (temp && resolve(temp).startsWith(resolve(root, ".cache") + sep)) await rm(temp, { recursive: true, force: true });
});

async function fixture(files: Record<string, string | Uint8Array> = { "0f4ed297.0": "personal.der" }) {
  const directory = join(temp, String(sequence++));
  const mod = join(directory, "module");
  const store = join(directory, "store");
  const destination = join(mod, "apex/com.android.conscrypt/cacerts/0f4ed297.0");
  await Promise.all([mkdir(join(mod, "apex/com.android.conscrypt/cacerts"), { recursive: true }), mkdir(store, { recursive: true }), mkdir(join(directory, "system"), { recursive: true }), mkdir(join(directory, "nomount/bin"), { recursive: true })]);
  for (const [name, content] of Object.entries(files)) {
    await Bun.write(join(store, name), typeof content === "string" ? await readFile(join(temp, content)) : content);
  }
  await Bun.write(join(directory, "system/stock.0"), "stock CA");
  await Bun.write(destination, "stale certificate");
  await Bun.write(join(directory, "nomount/module.prop"), "id=nomount\nmetamodule=true\n");
  await Bun.write(join(directory, "nomount/metamount.sh"), "# fixture\n");
  await Bun.write(join(directory, "nomount/bin/nm"), "#!/bin/sh\n[ \"${NM_FAIL:-0}\" = 0 ]\n");
  run("chmod +x nomount/bin/nm", directory);
  const stubs = `
getprop() { echo "\${SDK:-34}"; }
getenforce() { echo "\${SELINUX:-Enforcing}"; }
chown() { [ "\${FAIL:-}" != chown ]; }
chmod() { [ "\${FAIL:-}" != chmod ] && command chmod "$@"; }
chcon() {
    printf '%s\\n' "$*" >> '${posix(directory)}/labels'
    [ "\${FAIL:-}" != chcon ] || return 1
    case "$1" in u:object_r:*:s*) ;; *) return 1 ;; esac
}
stat() {
    if [ "$2" = '%u:%g:%a' ]; then echo '0:0:644';
    elif [ "$2" = '%C' ]; then echo C;
    else command stat "$@"; fi
}
ls() {
    if [ "$1" != -Zd ]; then command ls "$@"; return; fi
    case "\${FAIL:-}" in
        context) echo "? $2" ;;
        literal-context) echo "C $2" ;;
        context-command) return 1 ;;
        label-mismatch)
            case "$2" in *.tmp) echo "u:object_r:wrong_label:s0 $2"; return ;; esac ;;
    esac
    case "\${FAIL:-}" in context|literal-context) return ;; esac
    if [ -d "$2" ]; then context=fixture_dir; else context=fixture_ca; fi
    echo "drwxr-xr-x root root u:object_r:$context:s0 $2"
}
cp() { [ "\${FAIL:-}" != cp ] && command cp "$@"; }
mv() { [ "\${FAIL:-}" != mv ] && command mv "$@"; }
`;
  const patched = script
    .replace("STORE=/data/misc/user/0/cacerts-added", `STORE='${posix(store)}'`)
    .replace("SYSTEM_CA=/apex/com.android.conscrypt/cacerts", `SYSTEM_CA='${posix(join(directory, "system"))}'`)
    .replace("NOMOUNT=/data/adb/modules/nomount", `NOMOUNT='${posix(join(directory, "nomount"))}'`)
    .replaceAll("/data/adb/nomount/disable", posix(join(directory, "nomount-safe-mode")));
  await Bun.write(join(mod, "post-fs-data.sh"), stubs + patched);
  return {
    directory, mod, store, destination,
    async boot(env: Record<string, string> = {}) {
      run("sh module/post-fs-data.sh", directory, env);
      const log = await Bun.file(join(mod, "logs/boot.log")).text();
      expect(existsSync(join(mod, "apex/com.android.conscrypt/cacerts/.cert.tmp"))).toBe(false);
      return log;
    },
  };
}

describe("boot preparation with encoding envelopes and mocked Android metadata", () => {
  test("DER: choose numeric suffix, preserve Intermediate, apply dynamic labels", async () => {
    const f = await fixture({ "0f4ed297.2": "personal.der", "0f4ed297.10": "renewed.der", "0f4ed297.100bad": "leaf.der", "47ec1af8.999": "intermediate.der" });
    expect(await f.boot()).toContain("PREPARED:");
    expect(await readFile(f.destination)).toEqual(await readFile(join(temp, "renewed.der")));
    expect(await readFile(join(f.store, "47ec1af8.999"))).toEqual(await readFile(join(temp, "intermediate.der")));
    expect(await readdir(join(f.mod, "apex/com.android.conscrypt/cacerts"))).toEqual(["0f4ed297.0"]);
    expect(await Bun.file(join(f.directory, "labels")).text()).toContain("u:object_r:fixture_ca:s0");
    expect(await Bun.file(join(f.directory, "labels")).text()).toContain("u:object_r:fixture_dir:s0");
  });

  test("PEM and renewal replace old contents on the next boot", async () => {
    const f = await fixture({ "0f4ed297.0": "personal.pem" });
    expect(await f.boot()).toContain("PREPARED:");
    await Bun.write(join(f.store, "0f4ed297.1"), await readFile(join(temp, "renewed.pem")));
    expect(await f.boot()).toContain("PREPARED:");
    expect(await readFile(f.destination)).toEqual(await readFile(join(temp, "renewed.pem")));
    await rm(join(f.store, "0f4ed297.0"));
    await rm(join(f.store, "0f4ed297.1"));
    expect(await f.boot()).toContain("No Personal CA candidate");
    expect(existsSync(f.destination)).toBe(false);
  });

  test("numeric comparison tolerates leading zeros and very large suffixes", async () => {
    const f = await fixture({ "0f4ed297.0002": "personal.der", "0f4ed297.999999999999999999999999": "renewed.der" });
    expect(await f.boot()).toContain("PREPARED:");
    expect(await readFile(f.destination)).toEqual(await readFile(join(temp, "renewed.der")));
  });

  for (const [name, files, message] of [
    ["missing CA", {}, "No Personal CA candidate"],
    ["empty file", { "0f4ed297.0": new Uint8Array() }, "Certificate is empty"],
    ["truncated DER", { "0f4ed297.0": new Uint8Array([0x30, 2, 1]) }, "Invalid DER/PEM"],
    ["invalid highest candidate, without fallback", { "0f4ed297.0": "personal.der", "0f4ed297.1": new TextEncoder().encode("invalid") }, "Invalid DER/PEM"],
  ] as const) {
    test(name + " removes stale destination", async () => {
      const f = await fixture(files);
      expect(await f.boot()).toContain(message);
      expect(existsSync(f.destination)).toBe(false);
    });
  }

  test("payload mutations are not detected by the relaxed check", async () => {
    const cert = new Uint8Array(await readFile(join(temp, "personal.der")));
    cert[cert.length - 1] = cert[cert.length - 1]! ^ 1;
    const f = await fixture({ "0f4ed297.0": cert });
    expect(await f.boot()).toContain("WARNING: filename-based identity only");
    expect(await readFile(f.destination)).toEqual(Buffer.from(cert));
  });

  test("trailing certificate data is rejected", async () => {
    const cert = await readFile(join(temp, "personal.der"));
    const f = await fixture({ "0f4ed297.0": Buffer.concat([cert, cert]) });
    expect(await f.boot()).toContain("Invalid DER/PEM");
    expect(existsSync(f.destination)).toBe(false);
  });

  for (const [failure, message] of [["cp", "Certificate copy failed"], ["chown", "Cannot set ownership"], ["chmod", "Cannot set directory permissions"], ["chcon", "Cannot label directories"], ["context", "Cannot read system CA SELinux label"], ["literal-context", "Cannot read system CA SELinux label"], ["context-command", "Cannot read system CA SELinux label"], ["label-mismatch", "Certificate label did not persist"], ["mv", "Atomic certificate replacement failed"]]) {
    test(failure + " failure removes stale destination", async () => {
      const f = await fixture();
      expect(await f.boot({ FAIL: failure! })).toContain(message!);
      expect(existsSync(f.destination)).toBe(false);
    });
  }

  for (const location of ["module", "nomount"]) {
    for (const marker of ["disable", "remove", "skip_mount"]) {
      test(location + "/" + marker + " removes stale destination", async () => {
        const f = await fixture();
        await Bun.write(join(f.directory, location, marker), "");
        expect(await f.boot()).toContain("flag");
        expect(existsSync(f.destination)).toBe(false);
      });
    }
  }

  test("NoMount kernel API failure and Android 13 fail closed", async () => {
    for (const env of [{ NM_FAIL: "1" }, { SDK: "33" }] as Record<string, string>[]) {
      const f = await fixture();
      expect(await f.boot(env)).toContain("ERROR:");
      expect(existsSync(f.destination)).toBe(false);
    }
  });

  test("renamed Intermediate or non-CA payloads cannot be identified", async () => {
    for (const name of ["intermediate.der", "leaf.der"]) {
      const f = await fixture({ "0f4ed297.0": name });
      expect(await f.boot()).toContain("WARNING: filename-based identity only");
      expect(await readFile(f.destination)).toEqual(await readFile(join(temp, name)));
    }
  });

  test("long-form DER envelope and CRLF PEM are accepted", async () => {
    const der = Buffer.concat([Buffer.from([0x30, 0x81, 128]), Buffer.alloc(128, 1)]);
    for (const content of [der, Buffer.from("-----BEGIN CERTIFICATE-----\r\nMAEB\r\n-----END CERTIFICATE-----\r\n")]) {
      const f = await fixture({ "0f4ed297.0": content });
      expect(await f.boot()).toContain("PREPARED:");
      expect(await readFile(f.destination)).toEqual(content);
    }
  });

  test("multiple PEM blocks are rejected", async () => {
    const pem = await readFile(join(temp, "personal.pem"));
    const f = await fixture({ "0f4ed297.0": Buffer.concat([pem, pem]) });
    expect(await f.boot()).toContain("Invalid DER/PEM");
    expect(existsSync(f.destination)).toBe(false);
  });
});

test("ZIP is deterministic, has only module files, LF and executable Unix modes", async () => {
  const output = await build(join(temp, "dist"));
  const bytes = await readFile(output);
  const files = unzipSync(bytes);
  expect(Object.keys(files).sort()).toEqual([...moduleFiles].sort());
  expect(new TextDecoder().decode(files["README.md"])).toBe((await Bun.file(join(root, "README.md")).text()).replaceAll("\r\n", "\n"));
  for (const bytes of Object.values(files)) expect(new TextDecoder().decode(bytes)).not.toContain("\r");
  let found = 0;
  for (let offset = 0; offset < bytes.length - 46; offset++) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) continue;
    const name = bytes.subarray(offset + 46, offset + 46 + bytes.readUInt16LE(offset + 28)).toString();
    expect(bytes[offset + 5]).toBe(3);
    expect((bytes.readUInt32LE(offset + 38) >>> 16) & 0o777).toBe(name.endsWith(".sh") ? 0o755 : 0o644);
    found++;
  }
  expect(found).toBe(moduleFiles.length);
  const version = /^version=(.+)$/m.exec(new TextDecoder().decode(files["module.prop"]))?.[1];
  expect(version).toBeDefined();
  await build(join(temp, "dist"), `v${version}`);
  expect(await readFile(output)).toEqual(bytes);
  await expect(build(join(temp, "dist"), "v-mismatched-version")).rejects.toThrow("does not match module version");
});

test("runtime scripts contain no forbidden path or mount commands", async () => {
  for (const name of moduleFiles.filter((name) => name.endsWith(".sh"))) {
    const source = await Bun.file(join(root, "module", name)).text();
    expect(source).not.toContain("/data/local/tmp");
    expect(source).not.toMatch(/openssl/i);
    expect(source.replace(/^#.*$/gm, "")).not.toMatch(/\b(mount|nsenter|mktemp)\b/);
    run(`sh -n '${posix(join(root, "module", name))}'`, temp);
  }
});
