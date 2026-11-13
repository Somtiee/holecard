#!/bin/sh
# usage: ./still.sh Main 420 [more frames...]  -> review/<comp>-<frame>.png
comp=$1; shift
for f in "$@"; do
  for try in 1 2; do
    npx remotion still src/index.ts "$comp" "review/$comp-$f.png" --frame="$f" --props='{"audio":false}' --log=error >/dev/null 2>review/err.txt && break
    echo "retry $f"; tail -5 review/err.txt
  done
done
echo done
