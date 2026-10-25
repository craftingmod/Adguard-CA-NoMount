#!/system/bin/sh
# NoMount scans apex/ after regular modules finish post-fs-data.
MODDIR=${0%/*}
STORE=/data/misc/user/0/cacerts-added
SYSTEM_CA=/apex/com.android.conscrypt/cacerts
NOMOUNT=/data/adb/modules/nomount
DESTDIR="$MODDIR/apex/com.android.conscrypt/cacerts"
DEST="$DESTDIR/0f4ed297.0"
TEMP="$DESTDIR/.cert.tmp"
READY=0
umask 077

cleanup() {
    rm -f "$TEMP"
    if [ "$READY" != 1 ]; then
        rm -f "$DEST"
    fi
}
trap cleanup 0
trap 'exit 0' 1 2 15

fail() {
    echo "ERROR: $*"
    exit 0
}

if ! mkdir -p "$MODDIR/logs"; then
    exit 0
fi
exec > "$MODDIR/logs/boot.log" 2>&1
echo "AdGuard CA preparation: $(date -u)"
rm -f "$TEMP" || fail 'Cannot clear temporary files'

for marker in disable remove skip_mount; do
    [ ! -e "$MODDIR/$marker" ] || fail "Module has $marker flag"
    [ ! -e "$NOMOUNT/$marker" ] || fail "NoMount has $marker flag"
done
[ ! -e /data/adb/nomount/disable ] || fail 'NoMount safe mode is active'
grep -qx 'id=nomount' "$NOMOUNT/module.prop" || fail 'NoMount is not installed'
grep -Eq '^metamodule=(true|1)$' "$NOMOUNT/module.prop" || fail 'NoMount is not a metamodule'
[ -f "$NOMOUNT/metamount.sh" ] || fail 'NoMount metamount hook is missing'
"$NOMOUNT/bin/nm" version || fail 'NoMount kernel API is not ready'
[ "$(getprop ro.build.version.sdk)" -ge 34 ] 2>/dev/null || fail 'Android 14+ is required'
[ -d "$SYSTEM_CA" ] || fail 'Conscrypt CA directory is unavailable'
[ -d "$STORE" ] || fail 'User 0 certificate store is unavailable'

# Compare decimal strings without integer overflow, including leading zeros.
SOURCE=$(
    for cert in "$STORE"/0f4ed297.*; do
        [ -f "$cert" ] && [ ! -L "$cert" ] || continue
        suffix=${cert##*.}
        case "$suffix" in ''|*[!0-9]*) continue ;; esac
        printf '%s\n' "$cert"
    done | awk '
        { n = $0; sub(/^.*\./, "", n); sub(/^0+/, "", n); if (n == "") n = "0" }
        !found || length(n) > length(best) || (length(n) == length(best) && "x" n > "x" best) {
            found = 1; best = n; path = $0
        }
        END { if (found) print path }
    '
)
[ -n "$SOURCE" ] || fail 'No Personal CA candidate found'
echo "Selected: $SOURCE (largest numeric suffix; not a renewal timestamp)"

mkdir -p "$DESTDIR" || fail 'Cannot create destination directory'
cp "$SOURCE" "$TEMP" || fail 'Certificate copy failed'
cmp -s "$SOURCE" "$TEMP" || fail 'Source changed during copy'
[ -s "$TEMP" ] || fail 'Certificate is empty'

# Only check the encoding envelope; identity relies on the user-store filename.
# shortcut: no X.509 Subject/CA/signature validation, add a parser if identity checks are needed.
HEADER=$(od -An -tu1 -N6 "$TEMP") || fail 'Cannot read certificate header'
SIZE=$(wc -c < "$TEMP") || fail 'Cannot read certificate size'
if ! printf '%s\n' "$HEADER" | awk -v size="$SIZE" '
    {
        if ($1 != 48 || NF < 2) exit 1
        if ($2 < 128) { header = 2; payload = $2 }
        else {
            count = $2 - 128
            if (count < 1 || count > 4 || NF < count + 2 || $3 == 0) exit 1
            header = count + 2; payload = 0
            for (i = 3; i <= header; i++) payload = payload * 256 + $i
            if (payload < 128) exit 1
        }
        exit !(payload > 0 && header + payload == size)
    }
'; then
    awk '
        { sub(/\r$/, "") }
        NR == 1 && $0 == "-----BEGIN CERTIFICATE-----" { state = 1; next }
        state == 1 && $0 == "-----END CERTIFICATE-----" { state = 2; next }
        state == 1 && /^[A-Za-z0-9+\/=]+$/ { body++; next }
        { invalid = 1 }
        END { exit !(state == 2 && body > 0 && !invalid) }
    ' "$TEMP" || fail 'Invalid DER/PEM certificate envelope'
fi
echo 'WARNING: filename-based identity only; Subject, CA constraints and signature are not verified.'
sha256sum "$TEMP" || fail 'Cannot hash certificate snapshot'

chown 0:0 "$DESTDIR" "$TEMP" || fail 'Cannot set ownership'
chmod 0755 "$MODDIR/apex" "$MODDIR/apex/com.android.conscrypt" "$DESTDIR" || fail 'Cannot set directory permissions'
chmod 0644 "$TEMP" || fail 'Cannot set certificate permissions'
[ "$(stat -c '%u:%g:%a' "$TEMP")" = '0:0:644' ] || fail 'Unexpected certificate permissions'

# Match actual device labels; never guess a system_file context.
# KernelSU BusyBox stat can print literal C for %C; parse ls -Z instead.
read_context() {
    context_line=$(ls -Zd "$1") || return 1
    printf '%s\n' "$context_line" | awk '
        {
            for (i = 1; i <= NF; i++) {
                if ($i ~ /^u:object_r:[[:alnum:]_]+:s[0-9]+(:[[:alnum:]_,.:-]+)?$/) {
                    print $i; found = 1; exit
                }
            }
        }
        END { if (!found) exit 1 }
    '
}

SELINUX=$(getenforce) || fail 'Cannot determine SELinux state'
case "$SELINUX" in Disabled|Enforcing|Permissive) ;; *) fail 'Unknown SELinux state' ;; esac
if [ "$SELINUX" != Disabled ]; then
    REFERENCE=
    for cert in "$SYSTEM_CA"/*; do
        [ -f "$cert" ] || continue
        REFERENCE=$cert
        break
    done
    [ -n "$REFERENCE" ] || fail 'No system CA is available as a label reference'
    FILE_CONTEXT=$(read_context "$REFERENCE") || fail 'Cannot read system CA SELinux label'
    DIR_CONTEXT=$(read_context "$SYSTEM_CA") || fail 'Cannot read CA directory SELinux label'
    chcon "$DIR_CONTEXT" "$MODDIR/apex" "$MODDIR/apex/com.android.conscrypt" "$DESTDIR" || fail 'Cannot label directories'
    chcon "$FILE_CONTEXT" "$TEMP" || fail 'Cannot label certificate'
    [ "$(read_context "$TEMP")" = "$FILE_CONTEXT" ] || fail 'Certificate label did not persist'
fi

cmp -s "$SOURCE" "$TEMP" || fail 'Source changed during validation'
mv -f "$TEMP" "$DEST" || fail 'Atomic certificate replacement failed'
READY=1
echo 'PREPARED: apex/com.android.conscrypt/cacerts/0f4ed297.0'
echo 'VFS injection and application trust must be verified after boot; see README.md.'
