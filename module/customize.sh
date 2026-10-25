#!/system/bin/sh
# Root managers can reset extracted files to 0644; restore executable bits.
set_perm "$MODPATH/post-fs-data.sh" 0 0 0755
