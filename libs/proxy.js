const fs = require('fs');
const path = require('path');

/**
 * Reads every file inside `proxy/` and returns the proxy pool.
 * Blank lines, `#` comments and duplicates are ignored, so a trailing
 * newline never inflates the proxy count shown in the UI.
 *
 * Accepted formats:
 *   1.2.3.4:8080
 *   user:pass@1.2.3.4:8080
 *   http://1.2.3.4:8080
 *   socks5://1.2.3.4:1080
 *
 * @returns {Promise<string[]>}
 */
module.exports = function loadProxies() {
    const dir = path.join(__dirname, '..', 'proxy');
    const seen = new Set();
    const proxyList = [];

    return new Promise(function (resolve) {
        fs.readdir(dir, (err, files) => {
            if (err) {
                // folder missing or unreadable — an empty pool is a valid state
                return resolve([]);
            }

            const names = (files || []).filter((name) => !name.startsWith('.'));
            if (!names.length) return resolve([]);

            let pending = names.length;
            names.forEach((fileName) => {
                fs.readFile(path.join(dir, fileName), 'utf8', (error, data) => {
                    if (!error && data) {
                        data.split(/\r?\n/)
                            .map((line) => line.trim())
                            .filter((line) => line && !line.startsWith('#'))
                            .forEach((line) => {
                                if (seen.has(line)) return;
                                seen.add(line);
                                proxyList.push(line);
                            });
                    }
                    pending -= 1;
                    if (pending === 0) resolve(proxyList);
                });
            });
        });
    });
};
