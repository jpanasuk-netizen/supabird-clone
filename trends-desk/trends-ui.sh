#!/bin/bash
cd ~/xai-test || exit 1
cp /mnt/c/Users/jpana/watch-split/trends-ui.mjs .
grep -q '"type": "module"' package.json || sed -i 's/"type": "commonjs"/"type": "module"/' package.json
grep -qx '.xai-key' .gitignore 2>/dev/null || echo '.xai-key' >> .gitignore
pkill -f "node trends-ui.mjs" 2>/dev/null
export PATH="$HOME/.local/bin:$PATH"
node -v
nohup setsid node trends-ui.mjs > trends-ui.log 2>&1 &
sleep 2
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:3489/
tail -3 trends-ui.log
