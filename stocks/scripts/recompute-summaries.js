const mongoose = require('mongoose');
const { connectToDatabase, closeDatabase } = require('../db');
const StockSummary = require('../models/StockSummary');
const FundSnapshot = require('../models/FundSnapshot');
const { GridFSBucket } = require('mongodb');
const { Readable } = require('stream');

const stockKey = (holding) => holding.stock_search_id || holding.company_name;

const buildStockSummary = (fundSnapshots) => {
    const totalFunds = fundSnapshots.length;
    const stocksMap = {};

    fundSnapshots.forEach((fund) => {
        const perFundMap = new Map();
        (fund.equityHoldings || []).forEach((holding) => {
            const key = stockKey(holding);
            const weight = holding.corpus_per ?? 0;
            if (!perFundMap.has(key)) {
                perFundMap.set(key, {
                    name: holding.company_name,
                    stockSearchId: holding.stock_search_id || null,
                    sector: holding.sector_name || null,
                    weight: weight,
                });
            } else {
                const existing = perFundMap.get(key);
                existing.weight += weight;
                perFundMap.set(key, existing);
            }
        });

        perFundMap.forEach((holding, key) => {
            if (!stocksMap[key]) {
                stocksMap[key] = {
                    name: holding.name,
                    stockSearchId: holding.stockSearchId,
                    sector: holding.sector,
                    fundCount: 0,
                    totalWeight: 0,
                    maxWeight: -Infinity,
                    minWeight: Infinity,
                    funds: [],
                };
            }
            const entry = stocksMap[key];
            const weight = holding.weight;
            entry.fundCount += 1;
            entry.totalWeight += weight;
            entry.maxWeight = Math.max(entry.maxWeight, weight);
            entry.minWeight = Math.min(entry.minWeight, weight);
            entry.funds.push({
                searchId: fund.searchId,
                fundName: fund.fundName,
                weight,
            });
        });
    });

    return Object.values(stocksMap).map((entry) => ({
        name: entry.name,
        stockSearchId: entry.stockSearchId,
        sector: entry.sector,
        fundCount: entry.fundCount,
        totalFunds,
        coveragePercent: totalFunds > 0 ? Number(((entry.fundCount / totalFunds) * 100).toFixed(2)) : 0,
        avgWeight: entry.fundCount > 0 ? Number((entry.totalWeight / entry.fundCount).toFixed(4)) : 0,
        totalWeight: Number(entry.totalWeight.toFixed(4)),
        maxWeight: entry.maxWeight === -Infinity ? 0 : Number(entry.maxWeight.toFixed(4)),
        minWeight: entry.minWeight === Infinity ? 0 : Number(entry.minWeight.toFixed(4)),
        funds: entry.funds,
    }));
};

const readGridFsPayload = async (db, fileId, bucketName = 'snapshot_files') => {
    const bucket = new GridFSBucket(db, { bucketName });
    const chunks = [];
    return new Promise((resolve, reject) => {
        const stream = bucket.openDownloadStream(fileId);
        stream.on('data', (d) => chunks.push(d));
        stream.on('error', reject);
        stream.on('end', () => {
            try {
                const str = Buffer.concat(chunks).toString('utf8');
                resolve(JSON.parse(str));
            } catch (e) {
                reject(e);
            }
        });
    });
};

const recompute = async () => {
    await connectToDatabase();
    const db = mongoose.connection.db;
    const cursor = FundSnapshot.find({}).cursor();
    let updated = 0;
    for await (const doc of cursor) {
        try {
            let payload = doc.payload;
            if (!payload && doc.gridFsId) {
                payload = await readGridFsPayload(db, doc.gridFsId);
            }
            if (!payload || !Array.isArray(payload.funds)) continue;

            let fundSnapshots = payload.funds;
            // Deduplicate fundSnapshots by searchId (merge duplicates if any)
            const merged = new Map();
            for (const f of fundSnapshots) {
                const id = String(f.searchId || f.searchId === 0 ? f.searchId : f.searchId || f.searchId);
                if (!merged.has(id)) merged.set(id, JSON.parse(JSON.stringify(f)));
                else {
                    const existing = merged.get(id);
                    // merge holdings arrays
                    existing.holdings = (existing.holdings || []).concat(f.holdings || []);
                    // aggregate holdings by stock key
                    const holdMap = new Map();
                    for (const h of existing.holdings) {
                        const key = stockKey(h) || JSON.stringify(h);
                        if (!holdMap.has(key)) holdMap.set(key, JSON.parse(JSON.stringify(h)));
                        else {
                            const ex = holdMap.get(key);
                            ex.corpus_per = (Number(ex.corpus_per) || 0) + (Number(h.corpus_per) || 0);
                            holdMap.set(key, ex);
                        }
                    }
                    existing.holdings = Array.from(holdMap.values());
                    existing.equityHoldings = existing.holdings.filter((hh) => hh.nature_name === 'EQUITY');
                    merged.set(id, existing);
                }
            }
            fundSnapshots = Array.from(merged.values());
            const stockSummary = buildStockSummary(fundSnapshots);

            const byCoverage = [...stockSummary].map(({ funds, ...rest }) => rest).sort((a, b) => b.fundCount - a.fundCount);
            const byAvgWeight = [...stockSummary].map(({ funds, ...rest }) => rest).sort((a, b) => b.avgWeight - a.avgWeight);

            await StockSummary.findOneAndUpdate({ risk: doc.risk, date: doc.date, type: 'coverage' }, { risk: doc.risk, date: doc.date, type: 'coverage', items: byCoverage }, { upsert: true });
            await StockSummary.findOneAndUpdate({ risk: doc.risk, date: doc.date, type: 'weight' }, { risk: doc.risk, date: doc.date, type: 'weight', items: byAvgWeight }, { upsert: true });
            await StockSummary.findOneAndUpdate({ risk: doc.risk, date: doc.date, type: 'detail' }, { risk: doc.risk, date: doc.date, type: 'detail', items: stockSummary }, { upsert: true });
            updated += 1;
            console.log(`Recomputed summaries for ${doc.risk} ${doc.date}`);
        } catch (err) {
            console.error('Failed to recompute for', doc._id, err.message);
        }
    }
    console.log(`Recompute complete: ${updated} snapshots processed.`);
    await closeDatabase();
};

if (require.main === module) recompute();
