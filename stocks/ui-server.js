const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.UI_PORT || 8080;
const ROOT = path.join(__dirname, 'ui');

// Serve a small config file that sets API base URL for the client
app.get('/config.js', (req, res) => {
    const apiBase = process.env.API_BASE || `http://localhost:${process.env.PORT || 8000}`;
    res.type('application/javascript').send(`window.API_BASE = "${apiBase}";`);
});

app.use(express.static(ROOT));

app.listen(PORT, () => {
    console.log(`UI server running at http://localhost:${PORT}`);
});
