# AdGuard CA for NoMount

A KernelSU module for injecting AdGuard Personal CA with NoMount.

Replaces [adguardcert](https://github.com/AdguardTeam/adguardcert) which could be use `/data/local/tmp` folder.

## Development
### Build zip

```sh
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
```

Export at `dist/adguard-ca-nomount-<version>.zip`.

### GitHub Releases

Before tagging, update `version` and increment `versionCode` in `module/module.prop`, then commit the changes. The tag must match `v<version>`; a mismatch fails the build before publishing.

```sh
git tag v0.1.1
git push origin v0.1.1
```

### Verify

```sh
bun run verify:device
# When multiple devices is connected to adb
bun run verify:device DEVICE_SERIAL
```

Verify checks basic CA cert is installed.

## Third party LICENSE notice

* adguardcert

```
MIT License

Copyright (c) Adguard Software Limited

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
