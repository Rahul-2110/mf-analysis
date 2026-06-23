const fs = require('fs');
const path = require('path');
const { connectToDatabase, closeDatabase } = require('./db');
const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb');
const RunLog = require('./models/RunLog');
const StockSummary = require('./models/StockSummary');
const FundSnapshot = require('./models/FundSnapshot');
const Change = require('./models/Change');
const SearchResult = require('./models/SearchResult');
const MutualFund = require('./models/MutualFund');

const root = __dirname;
const riskFolder = (risk) => risk.replace(/ /g, '-');

const readJson = async (filePath) => {
    const content = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(content);
};

const upsertDocument = async (collectionName, query, doc) => {
    const map = {
        run_logs: RunLog,
        stock_summaries: StockSummary,
        fund_snapshots: FundSnapshot,
        changes: Change,
        search_results: SearchResult,
        mutual_funds: MutualFund,
    };
    const Model = map[collectionName];
    if (!Model) throw new Error(`Unknown collection: ${collectionName}`);
    await Model.findOneAndUpdate(query, doc, { upsert: true, new: true });
};

const importFile = async (filePath, risk, date) => {
    const fileName = path.basename(filePath);
    const collectionMap = [
        { prefix: 'funds-', collection: 'search_results', type: 'search', documentKey: 'payload' },
        { prefix: 'mutual_funds-', collection: 'mutual_funds', type: 'filtered', documentKey: 'payload' },
        { prefix: 'stock-summary-by-coverage-', collection: 'stock_summaries', type: 'coverage', documentKey: 'items' },
        { prefix: 'stock-summary-by-avg-weight-', collection: 'stock_summaries', type: 'weight', documentKey: 'items' },
        { prefix: 'stock-fund-detail-', collection: 'stock_summaries', type: 'detail', documentKey: 'items' },
        { prefix: 'fund-changes-', collection: 'changes', type: 'fund', documentKey: 'payload' },
        { prefix: 'stock-changes-', collection: 'changes', type: 'stock', documentKey: 'payload' },
        { prefix: 'run-log-', collection: 'run_logs', type: null, documentKey: null },
    ];

    for (const mapping of collectionMap) {
        if (!fileName.startsWith(mapping.prefix) || !fileName.endsWith('.json')) continue;
        const payload = await readJson(filePath);
        const doc = {
            risk,
            date,
        };

        if (mapping.type) doc.type = mapping.type;

        if (mapping.documentKey) {
            doc[mapping.documentKey] = payload;
        } else {
            Object.assign(doc, payload);
        }

        await upsertDocument(mapping.collection, { risk, date, type: mapping.type }, doc);
        console.log(`Imported ${path.relative(root, filePath)} -> ${mapping.collection}`);
        return;
    }

    console.warn(`Skipped unknown file format: ${filePath}`);
};

const importSnapshot = async (filePath, risk, date) => {
    const stats = await fs.promises.stat(filePath);
    const maxBson = 16 * 1024 * 1024 - 1024; // slightly under 16MB

    // If file is large, stream it into GridFS and store a reference
    if (stats.size > maxBson) {
        const db = mongoose.connection.db;
        const bucket = new GridFSBucket(db, { bucketName: 'snapshot_files' });
        const uploadId = await new Promise((resolve, reject) => {
            const upload = bucket.openUploadStream(path.basename(filePath));
            fs.createReadStream(filePath)
                .pipe(upload)
                .on('error', reject)
                .on('finish', (file) => resolve(file._id));
        });

        const doc = {
            risk,
            date,
            type: 'snapshot',
            gridFsId: uploadId,
            fileName: path.basename(filePath),
            fileSize: stats.size,
        };
        await upsertDocument('fund_snapshots', { risk, date, type: 'snapshot' }, doc);
        console.log(`Imported ${path.relative(root, filePath)} -> fund_snapshots (GridFS)`);
        return;
    }

    // Small enough to store directly; fall back to GridFS on serialization errors
    try {
        const payload = await readJson(filePath);
        const doc = {
            risk,
            date,
            type: 'snapshot',
            payload,
        };
        await upsertDocument('fund_snapshots', { risk, date, type: 'snapshot' }, doc);
        console.log(`Imported ${path.relative(root, filePath)} -> fund_snapshots`);
    } catch (err) {
        // Fallback: upload to GridFS if BSON serialization fails
        console.warn(`Direct insert failed, falling back to GridFS for ${filePath}:`, err.message);
        const db = mongoose.connection.db;
        const bucket = new GridFSBucket(db, { bucketName: 'snapshot_files' });
        const uploadId = await new Promise((resolve, reject) => {
            const upload = bucket.openUploadStream(path.basename(filePath));
            fs.createReadStream(filePath)
                .pipe(upload)
                .on('error', reject)
                .on('finish', (file) => resolve(file._id));
        });

        const stats2 = await fs.promises.stat(filePath);
        const doc = {
            risk,
            date,
            type: 'snapshot',
            gridFsId: uploadId,
            fileName: path.basename(filePath),
            fileSize: stats2.size,
        };
        await upsertDocument('fund_snapshots', { risk, date, type: 'snapshot' }, doc);
        console.log(`Imported ${path.relative(root, filePath)} -> fund_snapshots (GridFS fallback)`);
    }
};

const migrate = async () => {
    await connectToDatabase();

    const resultsRoot = path.join(root, 'results');
    if (fs.existsSync(resultsRoot)) {
        for (const riskName of await fs.promises.readdir(resultsRoot)) {
            const riskPath = path.join(resultsRoot, riskName);
            const stat = await fs.promises.stat(riskPath);
            if (!stat.isDirectory()) continue;

            for (const fileName of await fs.promises.readdir(riskPath)) {
                const match = fileName.match(/-(\d{2}-\d{2}-\d{2})\.json$/);
                if (!match) continue;
                const date = match[1];
                await importFile(path.join(riskPath, fileName), riskName, date);
            }
        }
    }

    const snapshotsRoot = path.join(root, 'snapshots');
    if (fs.existsSync(snapshotsRoot)) {
        for (const riskName of await fs.promises.readdir(snapshotsRoot)) {
            const riskPath = path.join(snapshotsRoot, riskName);
            const stat = await fs.promises.stat(riskPath);
            if (!stat.isDirectory()) continue;

            for (const fileName of await fs.promises.readdir(riskPath)) {
                const match = fileName.match(/snapshots-(\d{2}-\d{2}-\d{2})\.json$/);
                if (!match) continue;
                const date = match[1];
                await importSnapshot(path.join(riskPath, fileName), riskName, date);
            }
        }
    }

    const searchRoot = path.join(root, 'search');
    if (fs.existsSync(searchRoot)) {
        for (const riskName of await fs.promises.readdir(searchRoot)) {
            const riskPath = path.join(searchRoot, riskName);
            const stat = await fs.promises.stat(riskPath);
            if (!stat.isDirectory()) continue;

            for (const fileName of await fs.promises.readdir(riskPath)) {
                const match = fileName.match(/funds-(\d{2}-\d{2}-\d{2})\.json$/);
                if (!match) continue;
                const date = match[1];
                await importFile(path.join(riskPath, fileName), riskName, date);
            }
        }
    }
};

(async () => {
    try {
        await migrate();
        console.log('Migration complete');
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        await closeDatabase();
    }
})();
