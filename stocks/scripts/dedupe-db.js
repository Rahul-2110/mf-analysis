const { connectToDatabase, mongoose, closeDatabase } = require('../db');
const FundSnapshot = require('../models/FundSnapshot');
const StockSummary = require('../models/StockSummary');

const backupCollection = (name) => mongoose.connection.db.collection(name);

const dedupeFundSnapshots = async () => {
    console.log('Starting FundSnapshot dedupe...');
    const cursor = FundSnapshot.find({ payload: { $exists: true, $ne: null } }).cursor();
    let changed = 0;
    for await (const doc of cursor) {
        try {
            const original = doc.toObject();
            const funds = original.payload?.funds || [];
            // Merge duplicates by searchId: combine holdings and sum any weight fields
            const mergedMap = new Map();
            for (const f of funds) {
                const id = f.searchId;
                if (!mergedMap.has(id)) {
                    // clone to avoid mutating original
                    mergedMap.set(id, JSON.parse(JSON.stringify(f)));
                } else {
                    const existing = mergedMap.get(id);
                    // merge holdings arrays if present
                    const existingHoldings = Array.isArray(existing.holdings) ? existing.holdings : [];
                    const newHoldings = Array.isArray(f.holdings) ? f.holdings : [];
                    const combined = existingHoldings.concat(newHoldings);

                    // aggregate combined holdings by stock key to avoid duplicate holding rows
                    const holdMap = new Map();
                    for (const h of combined) {
                        const key = (h.stock_search_id || h.company_name || '').toString();
                        if (!holdMap.has(key)) {
                            holdMap.set(key, JSON.parse(JSON.stringify(h)));
                        } else {
                            const ex = holdMap.get(key);
                            // sum corpus_per if numeric
                            const a = Number(ex.corpus_per) || 0;
                            const b = Number(h.corpus_per) || 0;
                            ex.corpus_per = a + b;
                            holdMap.set(key, ex);
                        }
                    }
                    existing.holdings = Array.from(holdMap.values());

                    // recompute equityHoldings from merged holdings
                    existing.equityHoldings = existing.holdings.filter((hh) => hh.nature_name === 'EQUITY');
                    mergedMap.set(id, existing);
                }
            }

            const newFunds = Array.from(mergedMap.values());
            if (newFunds.length !== funds.length) {
                // backup original doc
                await backupCollection('fund_snapshots_backup').insertOne(original);
                // update payload
                original.payload.funds = newFunds;
                original.payload.totalFunds = newFunds.length;
                await FundSnapshot.findByIdAndUpdate(doc._id, { payload: original.payload });
                changed += 1;
                console.log(`Updated FundSnapshot ${doc._id}: funds ${funds.length} -> ${newFunds.length}`);
            }
        } catch (err) {
            console.error('Error processing snapshot', doc._id, err);
        }
    }
    console.log(`FundSnapshot dedupe complete. ${changed} documents modified.`);
};

const recomputeStockSummaries = async () => {
    console.log('Starting StockSummary.detail recompute...');
    const cursor = StockSummary.find({ type: 'detail' }).cursor();
    let touched = 0;
    for await (const doc of cursor) {
        try {
            const original = doc.toObject();
            let modified = false;
            const items = (original.items || []).map((item) => {
                const fundMap = new Map();
                (item.funds || []).forEach((f) => {
                    if (!fundMap.has(f.searchId)) fundMap.set(f.searchId, f);
                });
                const funds = Array.from(fundMap.values());
                if (funds.length !== (item.funds || []).length) modified = true;

                const totalWeight = funds.reduce((s, f) => s + (Number(f.weight) || 0), 0);
                const fundCount = funds.length;
                const avgWeight = fundCount > 0 ? Number((totalWeight / fundCount).toFixed(4)) : 0;
                const maxWeight = funds.length ? Math.max(...funds.map((f) => Number(f.weight) || 0)) : 0;
                const minWeight = funds.length ? Math.min(...funds.map((f) => Number(f.weight) || 0)) : 0;

                return {
                    ...item,
                    funds,
                    fundCount,
                    totalWeight: Number(totalWeight.toFixed(4)),
                    avgWeight,
                    maxWeight,
                    minWeight,
                };
            });

            if (modified) {
                await backupCollection('stock_summaries_backup').insertOne(original);
                await StockSummary.findByIdAndUpdate(doc._id, { items });
                touched += 1;
                console.log(`Updated StockSummary ${doc._id}: deduped funds in ${items.length} items`);
            }
        } catch (err) {
            console.error('Error processing stock summary', doc._id, err);
        }
    }
    console.log(`StockSummary recompute complete. ${touched} documents modified.`);
};

const run = async () => {
    try {
        await connectToDatabase();
        await dedupeFundSnapshots();
        await recomputeStockSummaries();
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await closeDatabase();
    }
};

if (require.main === module) run();

module.exports = { run };
