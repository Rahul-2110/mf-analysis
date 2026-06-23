const fs = require('fs');
const path = require('path');
const { connectToDatabase, closeDatabase } = require('../db');
const StockSummary = require('../models/StockSummary');
const FundSnapshot = require('../models/FundSnapshot');
const Change = require('../models/Change');
const SearchResult = require('../models/SearchResult');
const MutualFund = require('../models/MutualFund');

const root = path.join(__dirname, '..');

const confirmAndDelete = async (filePath) => {
    try {
        await fs.promises.unlink(filePath);
        console.log(`Deleted: ${filePath}`);
    } catch (err) {
        console.error(`Failed to delete ${filePath}:`, err.message);
    }
};

const processResults = async () => {
    const resultsRoot = path.join(root, 'results');
    if (!fs.existsSync(resultsRoot)) return;

    for (const riskName of await fs.promises.readdir(resultsRoot)) {
        const riskPath = path.join(resultsRoot, riskName);
        const stat = await fs.promises.stat(riskPath);
        if (!stat.isDirectory()) continue;

        for (const fileName of await fs.promises.readdir(riskPath)) {
            const filePath = path.join(riskPath, fileName);
            const match = fileName.match(/-(\d{2}-\d{2}-\d{2})\.json$/);
            if (!match) continue;
            const date = match[1];

            // Determine which collection this file maps to
            if (fileName.startsWith('mutual_funds-')) {
                const doc = await MutualFund.findOne({ risk: riskName, date }).lean();
                if (doc) await confirmAndDelete(filePath);
                else console.log(`Skipping (no DB record): ${filePath}`);
            } else if (fileName.startsWith('fund-changes-')) {
                const doc = await Change.findOne({ risk: riskName, date, type: 'fund' }).lean();
                if (doc) await confirmAndDelete(filePath);
                else console.log(`Skipping (no DB record): ${filePath}`);
            } else if (fileName.startsWith('stock-changes-')) {
                const doc = await Change.findOne({ risk: riskName, date, type: 'stock' }).lean();
                if (doc) await confirmAndDelete(filePath);
                else console.log(`Skipping (no DB record): ${filePath}`);
            } else if (fileName.startsWith('run-log-')) {
                const doc = await FundSnapshot.findOne({ risk: riskName, date }).lean();
                if (doc) await confirmAndDelete(filePath);
                else console.log(`Skipping (no DB record): ${filePath}`);
            } else if (fileName.startsWith('funds-') || fileName.startsWith('mutual_funds-')) {
                const doc = await SearchResult.findOne({ risk: riskName, date }).lean();
                if (doc) await confirmAndDelete(filePath);
                else console.log(`Skipping (no DB record): ${filePath}`);
            } else if (fileName.startsWith('stock-summary-by-coverage-') || fileName.startsWith('stock-summary-by-avg-weight-') || fileName.startsWith('stock-fund-detail-')) {
                const doc = await StockSummary.findOne({ risk: riskName, date }).lean();
                if (doc) await confirmAndDelete(filePath);
                else console.log(`Skipping (no DB record): ${filePath}`);
            } else {
                console.log(`Unknown file pattern, skipping: ${filePath}`);
            }
        }
    }
};

const processSnapshots = async () => {
    const snapshotsRoot = path.join(root, 'snapshots');
    if (!fs.existsSync(snapshotsRoot)) return;

    for (const riskName of await fs.promises.readdir(snapshotsRoot)) {
        const riskPath = path.join(snapshotsRoot, riskName);
        const stat = await fs.promises.stat(riskPath);
        if (!stat.isDirectory()) continue;

        for (const fileName of await fs.promises.readdir(riskPath)) {
            const filePath = path.join(riskPath, fileName);
            const match = fileName.match(/-(\d{2}-\d{2}-\d{2})\.json$/);
            if (!match) continue;
            const date = match[1];
            const doc = await FundSnapshot.findOne({ risk: riskName, date, type: 'snapshot' }).lean();
            if (doc) await confirmAndDelete(filePath);
            else console.log(`Skipping (no DB snapshot): ${filePath}`);
        }
    }
};

const processSearch = async () => {
    const searchRoot = path.join(root, 'search');
    if (!fs.existsSync(searchRoot)) return;

    for (const riskName of await fs.promises.readdir(searchRoot)) {
        const riskPath = path.join(searchRoot, riskName);
        const stat = await fs.promises.stat(riskPath);
        if (!stat.isDirectory()) continue;

        for (const fileName of await fs.promises.readdir(riskPath)) {
            const filePath = path.join(riskPath, fileName);
            const match = fileName.match(/funds-(\d{2}-\d{2}-\d{2})\.json$/);
            if (!match) continue;
            const date = match[1];
            const doc = await SearchResult.findOne({ risk: riskName, date }).lean();
            if (doc) await confirmAndDelete(filePath);
            else console.log(`Skipping (no DB search result): ${filePath}`);
        }
    }
};

const run = async () => {
    try {
        await connectToDatabase();
        await processResults();
        await processSnapshots();
        await processSearch();
        console.log('Cleanup complete');
    } catch (err) {
        console.error('Cleanup failed:', err);
    } finally {
        await closeDatabase();
    }
};

if (require.main === module) run();
