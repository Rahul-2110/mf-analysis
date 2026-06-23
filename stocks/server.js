const express = require('express');
const cors = require('cors');
const path = require('path');
const { connectToDatabase } = require('./db');
const RunLog = require('./models/RunLog');
const StockSummary = require('./models/StockSummary');
const Change = require('./models/Change');

const app = express();
const PORT = process.env.PORT || 8000;
const ROOT = __dirname;

const normalizeRisk = (risk) => risk.replace(/ /g, '-');

const sendJson = (res, data, status = 200) => {
    res.status(status).json(data);
};

const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

app.use(cors());
app.use(express.static(path.join(ROOT, 'ui')));

app.get('/api/catalog', asyncHandler(async (req, res) => {
    const risks = await RunLog.distinct('risk');
    const dates = await RunLog.distinct('date');
    sendJson(res, {
        risks: risks.sort(),
        dates: dates.sort().reverse(),
    });
}));

app.get('/api/summary/:risk/:date/coverage', asyncHandler(async (req, res) => {
    const { risk, date } = req.params;
    const doc = await StockSummary.findOne({ risk: normalizeRisk(risk), date, type: 'coverage' }).lean();
    sendJson(res, doc?.items ?? []);
}));

app.get('/api/summary/:risk/:date/weight', asyncHandler(async (req, res) => {
    const { risk, date } = req.params;
    const doc = await StockSummary.findOne({ risk: normalizeRisk(risk), date, type: 'weight' }).lean();
    sendJson(res, doc?.items ?? []);
}));

app.get('/api/summary/:risk/:date/detail', asyncHandler(async (req, res) => {
    const { risk, date } = req.params;
    const doc = await StockSummary.findOne({ risk: normalizeRisk(risk), date, type: 'detail' }).lean();
    sendJson(res, doc?.items ?? []);
}));

app.get('/api/fund-changes/:risk/:date', asyncHandler(async (req, res) => {
    const { risk, date } = req.params;
    const doc = await Change.findOne({ risk: normalizeRisk(risk), date, type: 'fund' }).lean();
    sendJson(res, doc?.payload ?? null);
}));

app.get('/api/stock-changes/:risk/:date', asyncHandler(async (req, res) => {
    const { risk, date } = req.params;
    const doc = await Change.findOne({ risk: normalizeRisk(risk), date, type: 'stock' }).lean();
    sendJson(res, doc?.payload ?? null);
}));

app.get('/api/log/:risk/:date', asyncHandler(async (req, res) => {
    const { risk, date } = req.params;
    const doc = await RunLog.findOne({ risk: normalizeRisk(risk), date }).lean();
    sendJson(res, doc ?? null);
}));

app.use((err, req, res, next) => {
    console.error(err);
    sendJson(res, { error: err.message || 'Internal Server Error' }, 500);
});

app.get('*', (req, res) => {
    res.sendFile(path.join(ROOT, 'ui', 'index.html'));
});

const startServer = async () => {
    await connectToDatabase();
    app.listen(PORT, () => {
        console.log(`MF Analysis UI → http://localhost:${PORT}`);
    });
};

startServer().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
