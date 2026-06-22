const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8000;
const ROOT = __dirname;

const MIME = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
};

const scanCatalog = () => {
    const resultsDir = path.join(ROOT, 'results');
    if (!fs.existsSync(resultsDir)) return { risks: [], dates: [] };

    const risks = fs.readdirSync(resultsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

    const dateSet = new Set();
    risks.forEach((risk) => {
        const files = fs.readdirSync(path.join(resultsDir, risk));
        files.forEach((file) => {
            const match = file.match(/stock-summary-by-coverage-(.+)\.json$/);
            if (match) dateSet.add(match[1]);
        });
    });

    return {
        risks: risks.sort(),
        dates: [...dateSet].sort().reverse(),
    };
};

const sendJson = (res, data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
};

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname === '/api/catalog') {
        return sendJson(res, scanCatalog());
    }

    let filePath = url.pathname === '/' ? '/ui/index.html' : url.pathname;
    filePath = path.join(ROOT, filePath.replace(/^\//, ''));

    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        return res.end('Forbidden');
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            return res.end('Not found');
        }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log(`MF Analysis UI → http://localhost:${PORT}`);
});
